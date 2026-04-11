/**
 * DualDirectivityEngine.js - Dual DirectivityModel with master crossfade
 *
 * Manages two parallel DirectivityModel instances for glitch-free configuration switching.
 * Reuses the same A/B crossfade pattern from DirectivityModel, but at the configuration level.
 *
 * Architecture:
 *   Input -> DirectivityModelA -> masterGainA -+
 *         -> DirectivityModelB -> masterGainB -+-> sumGain -> Output
 */

import { DirectivityModel } from './DirectivityModel.js';
import { PolarDataStore } from '../data/PolarDataStore.js';

// Master crossfade time in seconds (100ms for configuration switching)
const MASTER_XFADE_TIME = 0.1;

export class DualDirectivityEngine {
  constructor(audioContext) {
    this.audioContext = audioContext;

    // Create two DirectivityModel instances
    this.directivityModelA = new DirectivityModel(audioContext);
    this.directivityModelB = new DirectivityModel(audioContext);

    // Master gain nodes for crossfading between models
    this.masterGainA = audioContext.createGain();
    this.masterGainB = audioContext.createGain();

    // Input splitter
    this.inputGain = audioContext.createGain();
    this.inputGain.gain.value = 1.0;

    // Output sum
    this.sumGain = audioContext.createGain();
    this.sumGain.gain.value = 1.0;

    // Connect the graph
    // Input -> both DirectivityModels
    this.inputGain.connect(this.directivityModelA.input);
    this.inputGain.connect(this.directivityModelB.input);

    // DirectivityModels -> master gains -> sum
    this.directivityModelA.connect(this.masterGainA);
    this.directivityModelB.connect(this.masterGainB);
    this.masterGainA.connect(this.sumGain);
    this.masterGainB.connect(this.sumGain);

    // Initial state: Model A active, Model B standby
    this.masterGainA.gain.value = 1.0;
    this.masterGainB.gain.value = 0.0;

    // Track which model is active
    this.activeModel = 'A'; // 'A' or 'B'

    // Track loaded configurations
    this.configIdA = null;
    this.configIdB = null;

    // Polar data stores for each model
    this.polarDataStoreA = null;
    this.polarDataStoreB = null;

    // Pending crossfade timeout
    this.pendingCrossfade = null;

    // Gain normalization offset (dB)
    this.normalizationGainA = 1.0;
    this.normalizationGainB = 1.0;

    // Reference sensitivity for normalization
    this.referenceSensitivity = 111; // 5lb system as reference
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
   * Load a configuration into the active model
   * @param {SpeakerConfiguration} config - Configuration to load
   */
  loadConfiguration(config) {
    const targetModel = this.activeModel;
    this._loadConfigIntoModel(config, targetModel);
  }

  /**
   * Load a configuration into a specific model
   * @param {SpeakerConfiguration} config - Configuration to load
   * @param {string} model - 'A' or 'B'
   * @private
   */
  _loadConfigIntoModel(config, model) {
    // Create a PolarDataStore from the configuration's IR set
    const polarDataStore = new PolarDataStore();

    // Copy FRD data for visualization
    for (const [angle, frd] of config.frdSet) {
      polarDataStore.setFRD(angle, frd);
    }

    // Copy IR buffers
    for (const [angle, buffer] of config.irSet) {
      polarDataStore.set(angle, 0, buffer);
    }

    // Load into the appropriate DirectivityModel
    if (model === 'A') {
      this.polarDataStoreA = polarDataStore;
      this.directivityModelA.loadIRs(polarDataStore);
      this.configIdA = config.id;

      // Calculate normalization gain
      this.normalizationGainA = this._calculateNormalizationGain(config.sensitivity);
    } else {
      this.polarDataStoreB = polarDataStore;
      this.directivityModelB.loadIRs(polarDataStore);
      this.configIdB = config.id;

      this.normalizationGainB = this._calculateNormalizationGain(config.sensitivity);
    }

    console.log(`DualDirectivityEngine: Loaded '${config.id}' into model ${model}`);
  }

  /**
   * Switch to a new configuration with crossfade
   * @param {SpeakerConfiguration} config - New configuration
   * @param {function} [onComplete] - Callback when crossfade completes
   */
  crossfadeToConfiguration(config, onComplete) {
    // Cancel any pending crossfade
    if (this.pendingCrossfade) {
      clearTimeout(this.pendingCrossfade);
      this.pendingCrossfade = null;
    }

    // Determine standby model
    const standbyModel = this.activeModel === 'A' ? 'B' : 'A';

    // Load new config into standby model
    this._loadConfigIntoModel(config, standbyModel);

    // Perform crossfade
    this._crossfadeTo(standbyModel, () => {
      if (onComplete) {
        onComplete();
      }
    });
  }

  /**
   * Crossfade to a specific model
   * @param {string} targetModel - 'A' or 'B'
   * @param {function} [callback] - Called when crossfade completes
   * @private
   */
  _crossfadeTo(targetModel, callback) {
    const now = this.audioContext.currentTime;

    // Get normalization gains
    const normA = this.normalizationGainA;
    const normB = this.normalizationGainB;

    if (targetModel === 'A') {
      this.masterGainA.gain.linearRampToValueAtTime(normA, now + MASTER_XFADE_TIME);
      this.masterGainB.gain.linearRampToValueAtTime(0, now + MASTER_XFADE_TIME);
    } else {
      this.masterGainA.gain.linearRampToValueAtTime(0, now + MASTER_XFADE_TIME);
      this.masterGainB.gain.linearRampToValueAtTime(normB, now + MASTER_XFADE_TIME);
    }

    this.activeModel = targetModel;

    // Schedule callback
    if (callback) {
      this.pendingCrossfade = setTimeout(() => {
        callback();
        this.pendingCrossfade = null;
      }, MASTER_XFADE_TIME * 1000 + 10);
    }

    console.log(`DualDirectivityEngine: Crossfading to model ${targetModel}`);
  }

  /**
   * Update directivity for the current listener azimuth
   * @param {number} azimuthDeg - Azimuth angle in degrees
   */
  update(azimuthDeg) {
    // Update both models (the inactive one is silent anyway)
    this.directivityModelA.update(azimuthDeg);
    this.directivityModelB.update(azimuthDeg);
  }

  /**
   * Calculate normalization gain to match perceptual loudness
   * @param {number} sensitivity - Configuration sensitivity in dB
   * @returns {number} Linear gain factor
   * @private
   */
  _calculateNormalizationGain(sensitivity) {
    // Normalize to reference sensitivity
    const deltaDb = this.referenceSensitivity - sensitivity;
    return Math.pow(10, deltaDb / 20);
  }

  /**
   * Set reference sensitivity for normalization
   * @param {number} sensitivity - Reference sensitivity in dB
   */
  setReferenceSensitivity(sensitivity) {
    this.referenceSensitivity = sensitivity;

    // Recalculate normalization gains
    // (Would need to know current config sensitivities to recalculate)
  }

  /**
   * Enable or disable gain normalization
   * @param {boolean} enabled - Whether to normalize gains
   */
  setNormalizationEnabled(enabled) {
    if (!enabled) {
      // Reset to unity gains
      this.normalizationGainA = 1.0;
      this.normalizationGainB = 1.0;

      const now = this.audioContext.currentTime;
      if (this.activeModel === 'A') {
        this.masterGainA.gain.linearRampToValueAtTime(1.0, now + 0.05);
      } else {
        this.masterGainB.gain.linearRampToValueAtTime(1.0, now + 0.05);
      }
    }
  }

  /**
   * Get the active model's polar data store (for visualization)
   * @returns {PolarDataStore|null}
   */
  getActivePolarDataStore() {
    if (this.activeModel === 'A') {
      return this.polarDataStoreA;
    }
    return this.polarDataStoreB;
  }

  /**
   * Get the active configuration ID
   * @returns {string|null}
   */
  getActiveConfigId() {
    if (this.activeModel === 'A') {
      return this.configIdA;
    }
    return this.configIdB;
  }

  /**
   * Check if a configuration is loaded in either model
   * @param {string} configId - Configuration ID
   * @returns {boolean}
   */
  hasConfiguration(configId) {
    return this.configIdA === configId || this.configIdB === configId;
  }

  /**
   * Check if the engine is loaded and ready
   * @returns {boolean}
   */
  get isLoaded() {
    if (this.activeModel === 'A') {
      return this.directivityModelA.isActive;
    }
    return this.directivityModelB.isActive;
  }

  /**
   * Load IRs directly into the active model from a PolarDataStore
   * Used when loading speaker presets while dual engine is active
   * @param {PolarDataStore} polarDataStore - Data store containing IRs
   */
  loadIRsDirectly(polarDataStore) {
    // Store reference and load into active model
    if (this.activeModel === 'A') {
      this.polarDataStoreA = polarDataStore;
      this.directivityModelA.loadIRs(polarDataStore);
      this.configIdA = 'preset'; // Mark as preset-loaded
    } else {
      this.polarDataStoreB = polarDataStore;
      this.directivityModelB.loadIRs(polarDataStore);
      this.configIdB = 'preset';
    }

    console.log(`DualDirectivityEngine: Loaded IRs directly into active model ${this.activeModel}`);
  }

  /**
   * Get current state for debugging
   * @returns {Object}
   */
  getState() {
    return {
      activeModel: this.activeModel,
      configIdA: this.configIdA,
      configIdB: this.configIdB,
      masterGainA: this.masterGainA.gain.value,
      masterGainB: this.masterGainB.gain.value,
      normalizationGainA: this.normalizationGainA,
      normalizationGainB: this.normalizationGainB,
      modelAState: this.directivityModelA.getState(),
      modelBState: this.directivityModelB.getState(),
    };
  }
}
