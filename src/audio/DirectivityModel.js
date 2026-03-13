/**
 * DirectivityModel.js - Dual-convolver A/B crossfading for glitch-free directivity
 *
 * The parallel A/B architecture prevents audible clicks when switching between
 * polar angle IRs. Only gains are adjusted during listener movement; buffer swaps
 * happen on the currently silent convolver after crossfade completes.
 */

import { appState } from '../state/AppState.js';

// Crossfade time in seconds
const XFADE_TIME = 0.05;

export class DirectivityModel {
  constructor(audioContext) {
    this.audioContext = audioContext;
    this.polarDataStore = null;

    // Dual convolver setup
    this.convolverA = audioContext.createConvolver();
    this.convolverB = audioContext.createConvolver();

    this.gainA = audioContext.createGain();
    this.gainB = audioContext.createGain();

    // Summation node
    this.sumGain = audioContext.createGain();
    this.sumGain.gain.value = 1.0;

    // Input splitter
    this.inputGain = audioContext.createGain();
    this.inputGain.gain.value = 1.0;

    // Bypass path (used when no IRs are loaded)
    this.bypassGain = audioContext.createGain();
    this.bypassGain.gain.value = 1.0;

    // Connect the graph
    // Input -> ConvolverA -> GainA -> Sum
    //       -> ConvolverB -> GainB -> Sum
    //       -> Bypass -> Sum (when no IRs)
    this.inputGain.connect(this.convolverA);
    this.inputGain.connect(this.convolverB);
    this.inputGain.connect(this.bypassGain);

    this.convolverA.connect(this.gainA);
    this.convolverB.connect(this.gainB);

    this.gainA.connect(this.sumGain);
    this.gainB.connect(this.sumGain);
    this.bypassGain.connect(this.sumGain);

    // Initial state: bypass mode
    this.gainA.gain.value = 0;
    this.gainB.gain.value = 0;
    this.bypassGain.gain.value = 1;

    // Current state tracking
    this.currentLowerAngle = null;
    this.currentUpperAngle = null;
    this.currentAlpha = 0;
    this.isLoaded = false;

    // Track which convolver has which angle loaded
    this.convolverAAngle = null;
    this.convolverBAngle = null;

    // Pending buffer swap (scheduled after crossfade)
    this.pendingSwap = null;
  }

  /**
   * Get the input node for connecting audio sources
   */
  get input() {
    return this.inputGain;
  }

  /**
   * Connect output to destination
   */
  connect(destination) {
    this.sumGain.connect(destination);
  }

  /**
   * Disconnect from all destinations
   */
  disconnect() {
    this.sumGain.disconnect();
  }

  /**
   * Load IRs from polar data store
   */
  loadIRs(polarDataStore) {
    this.polarDataStore = polarDataStore;

    if (!polarDataStore || !polarDataStore.hasData) {
      this._setBypassMode(true);
      this.isLoaded = false;
      return;
    }

    // Get first two angles to initialize
    const angles = polarDataStore.getLoadedAngles();
    if (angles.length === 0) {
      this._setBypassMode(true);
      this.isLoaded = false;
      return;
    }

    // Load initial IRs into convolvers
    const firstAngle = angles[0];
    const secondAngle = angles.length > 1 ? angles[1] : angles[0];

    const bufferA = polarDataStore.get(firstAngle);
    const bufferB = polarDataStore.get(secondAngle);

    if (bufferA) {
      this.convolverA.buffer = bufferA;
      this.convolverAAngle = firstAngle;
    }

    if (bufferB) {
      this.convolverB.buffer = bufferB;
      this.convolverBAngle = secondAngle;
    }

    this.currentLowerAngle = firstAngle;
    this.currentUpperAngle = secondAngle;
    this.currentAlpha = 0;

    // Switch from bypass to convolver mode
    this._setBypassMode(false);
    this.isLoaded = true;

    // Set initial gains
    this.gainA.gain.value = 1;
    this.gainB.gain.value = 0;

    console.log('DirectivityModel loaded with angles:', angles);
  }

  /**
   * Update directivity based on current azimuth angle
   * This is called every frame as the listener moves
   */
  update(azimuthDeg) {
    if (!this.isLoaded || !this.polarDataStore) {
      return;
    }

    // Get weighted pair for this azimuth
    const { lowerAngle, upperAngle, alpha } = this.polarDataStore.getWeightedPair(azimuthDeg);

    // Check if we need to swap buffers (new bracket)
    const bracketChanged =
      lowerAngle !== this.currentLowerAngle ||
      upperAngle !== this.currentUpperAngle;

    if (bracketChanged) {
      this._handleBracketChange(lowerAngle, upperAngle, alpha);
    } else {
      // Just update crossfade gains
      this._setCrossfadeGains(alpha);
    }

    this.currentLowerAngle = lowerAngle;
    this.currentUpperAngle = upperAngle;
    this.currentAlpha = alpha;
  }

  /**
   * Handle bracket change (swap buffers on silent convolver)
   */
  _handleBracketChange(newLower, newUpper, newAlpha) {
    const now = this.audioContext.currentTime;

    // Determine which convolver needs to change
    // We only swap the buffer that is NOT currently active (or about to become inactive)

    // If alpha is low (< 0.5), convolver A (lower angle) is dominant
    // If alpha is high (>= 0.5), convolver B (upper angle) is dominant

    if (newAlpha < 0.5) {
      // ConvolverA will be dominant, so load new lower into A if needed
      if (this.convolverAAngle !== newLower) {
        // First crossfade to B to make A silent
        this._quickCrossfadeTo('B', () => {
          // Then swap A's buffer
          this._swapBuffer('A', newLower);
          // Then crossfade back based on alpha
          this._setCrossfadeGains(newAlpha);
        });
        return;
      }

      // ConvolverB might need new upper
      if (this.convolverBAngle !== newUpper) {
        this._swapBuffer('B', newUpper);
      }
    } else {
      // ConvolverB will be dominant, so load new upper into B if needed
      if (this.convolverBAngle !== newUpper) {
        // First crossfade to A to make B silent
        this._quickCrossfadeTo('A', () => {
          // Then swap B's buffer
          this._swapBuffer('B', newUpper);
          // Then crossfade back based on alpha
          this._setCrossfadeGains(newAlpha);
        });
        return;
      }

      // ConvolverA might need new lower
      if (this.convolverAAngle !== newLower) {
        this._swapBuffer('A', newLower);
      }
    }

    // Set gains for the new bracket
    this._setCrossfadeGains(newAlpha);
  }

  /**
   * Set crossfade gains based on alpha
   * alpha=0 means full lower angle (A), alpha=1 means full upper angle (B)
   */
  _setCrossfadeGains(alpha) {
    const now = this.audioContext.currentTime;

    // Use equal-power crossfade for smoother transitions
    const gainAValue = Math.cos(alpha * Math.PI * 0.5);
    const gainBValue = Math.sin(alpha * Math.PI * 0.5);

    this.gainA.gain.linearRampToValueAtTime(gainAValue, now + XFADE_TIME);
    this.gainB.gain.linearRampToValueAtTime(gainBValue, now + XFADE_TIME);
  }

  /**
   * Quick crossfade to make one convolver silent
   */
  _quickCrossfadeTo(target, callback) {
    const now = this.audioContext.currentTime;

    if (target === 'A') {
      this.gainA.gain.linearRampToValueAtTime(1, now + XFADE_TIME);
      this.gainB.gain.linearRampToValueAtTime(0, now + XFADE_TIME);
    } else {
      this.gainA.gain.linearRampToValueAtTime(0, now + XFADE_TIME);
      this.gainB.gain.linearRampToValueAtTime(1, now + XFADE_TIME);
    }

    // Schedule callback after crossfade completes
    if (this.pendingSwap) {
      clearTimeout(this.pendingSwap);
    }
    this.pendingSwap = setTimeout(() => {
      callback();
      this.pendingSwap = null;
    }, XFADE_TIME * 1000 + 10);
  }

  /**
   * Swap a convolver's buffer (should only be called when convolver is silent)
   */
  _swapBuffer(convolver, angle) {
    const buffer = this.polarDataStore.get(angle);
    if (!buffer) {
      console.warn(`No buffer for angle ${angle}`);
      return;
    }

    if (convolver === 'A') {
      this.convolverA.buffer = buffer;
      this.convolverAAngle = angle;
    } else {
      this.convolverB.buffer = buffer;
      this.convolverBAngle = angle;
    }
  }

  /**
   * Set bypass mode (direct pass-through without convolution)
   */
  _setBypassMode(bypass) {
    const now = this.audioContext.currentTime;

    if (bypass) {
      this.gainA.gain.linearRampToValueAtTime(0, now + 0.01);
      this.gainB.gain.linearRampToValueAtTime(0, now + 0.01);
      this.bypassGain.gain.linearRampToValueAtTime(1, now + 0.01);
    } else {
      this.bypassGain.gain.linearRampToValueAtTime(0, now + 0.01);
      // Gains will be set by update()
    }
  }

  /**
   * Check if directivity model is loaded and active
   */
  get isActive() {
    return this.isLoaded;
  }

  /**
   * Get current state for debugging
   */
  getState() {
    return {
      isLoaded: this.isLoaded,
      convolverAAngle: this.convolverAAngle,
      convolverBAngle: this.convolverBAngle,
      currentLowerAngle: this.currentLowerAngle,
      currentUpperAngle: this.currentUpperAngle,
      currentAlpha: this.currentAlpha,
      gainA: this.gainA.gain.value,
      gainB: this.gainB.gain.value,
    };
  }
}
