/**
 * AudioEngine.js - Web Audio + Resonance Audio setup and management
 */

import { ResonanceAudio } from 'resonance-audio';
import { appState } from '../state/AppState.js';
import { Stimulus } from './Stimulus.js';
import { DirectivityModel } from './DirectivityModel.js';
import { DualDirectivityEngine } from './DualDirectivityEngine.js';
import { HeadphoneEQ } from './HeadphoneEQ.js';
import { parseFRD } from '../data/FRDParser.js';

export class AudioEngine {
  constructor() {
    this.audioContext = null;
    this.resonanceScene = null;
    this.resonanceSource = null;
    this.masterGain = null;
    this.stimulus = null;
    this.directivityModel = null; // Single DirectivityModel for standard presets
    this.dualDirectivityEngine = null; // DualDirectivityEngine for LVT configurations
    this.useDualEngine = false; // Toggle between single and dual mode
    this.headphoneEQ = null; // Output-stage headphone correction EQ
    this.isInitialized = false;
  }

  async init() {
    try {
      // Create AudioContext
      this.audioContext = new (window.AudioContext ||
        window.webkitAudioContext)({
        sampleRate: 48000,
      });

      // Create master gain
      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.value = this._dbToGain(appState.masterVolume);

      // Create headphone EQ (always in chain; identity IR when disabled)
      this.headphoneEQ = new HeadphoneEQ(this.audioContext);
      this.masterGain.connect(this.headphoneEQ.input);
      this.headphoneEQ.output.connect(this.audioContext.destination);

      // Create Resonance Audio scene
      this.resonanceScene = new ResonanceAudio(this.audioContext, {
        ambisonicOrder: 1, // First-order ambisonics for binaural
      });
      this.resonanceScene.output.connect(this.masterGain);

      // Set room properties (minimal room for direct sound focus)
      this.resonanceScene.setRoomProperties(
        { width: 20, height: 5, depth: 20 },
        {
          left: 'transparent',
          right: 'transparent',
          front: 'transparent',
          back: 'transparent',
          up: 'transparent',
          down: 'transparent',
        }
      );

      // Create Resonance source for the speaker
      this.resonanceSource = this.resonanceScene.createSource();
      this.resonanceSource.setRolloff('logarithmic');
      this.resonanceSource.setMinDistance(1.0);
      this.resonanceSource.setMaxDistance(100.0);

      // Create directivity model (dual convolver) for standard presets
      this.directivityModel = new DirectivityModel(this.audioContext);
      this.directivityModel.connect(this.resonanceSource.input);

      // Create dual directivity engine for LVT configurations
      this.dualDirectivityEngine = new DualDirectivityEngine(this.audioContext);
      this.dualDirectivityEngine.connect(this.resonanceSource.input);

      // Create stimulus (sound sources)
      this.stimulus = new Stimulus(this.audioContext);
      // Initially connect to single DirectivityModel
      this.stimulus.connect(this.directivityModel.input);

      // Subscribe to state changes
      this._subscribeToState();

      this.isInitialized = true;
      console.log('AudioEngine initialized');
    } catch (err) {
      console.error('Failed to initialize AudioEngine:', err);
      throw err;
    }
  }

  _subscribeToState() {
    // Master volume
    appState.subscribe('masterVolume', (db) => {
      if (this.masterGain) {
        this.masterGain.gain.linearRampToValueAtTime(
          this._dbToGain(db),
          this.audioContext.currentTime + 0.05
        );
      }
    });

    // Stimulus type
    appState.subscribe('stimulusType', (type) => {
      if (this.stimulus) {
        this.stimulus.setType(type);
      }
    });

    // Playing state
    appState.subscribe('isPlaying', (isPlaying) => {
      if (this.stimulus) {
        if (isPlaying) {
          this.stimulus.start();
        } else {
          this.stimulus.stop();
        }
      }
    });

    // Distance model
    appState.subscribe('distanceModel', (model) => {
      if (this.resonanceSource) {
        this.resonanceSource.setRolloff(model);
      }
    });

    // Headphone calibration
    appState.subscribe('headphoneCalibrationEnabled', (enabled) => {
      if (!this.headphoneEQ) return;
      if (enabled) {
        this.headphoneEQ.enable(appState.headphoneModel);
      } else {
        this.headphoneEQ.disable();
      }
    });

    appState.subscribe('headphoneModel', (profileId) => {
      if (!this.headphoneEQ) return;
      if (appState.headphoneCalibrationEnabled) {
        this.headphoneEQ.enable(profileId);
      }
    });
  }

  _dbToGain(db) {
    return Math.pow(10, db / 20);
  }

  /**
   * Resume audio context (required after user interaction)
   */
  async resume() {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  /**
   * Update listener position in Resonance
   */
  updateListenerPosition(x, y, z) {
    if (this.resonanceScene) {
      this.resonanceScene.setListenerPosition(x, y, z);
    }
  }

  /**
   * Update listener orientation in Resonance
   */
  updateListenerOrientation(forwardX, forwardY, forwardZ, upX, upY, upZ) {
    if (this.resonanceScene) {
      this.resonanceScene.setListenerOrientation(
        forwardX,
        forwardY,
        forwardZ,
        upX,
        upY,
        upZ
      );
    }
  }

  /**
   * Update source (speaker) position in Resonance
   */
  updateSourcePosition(x, y, z) {
    if (this.resonanceSource) {
      this.resonanceSource.setPosition(x, y, z);
    }
  }

  /**
   * Update directivity based on current azimuth angle
   */
  updateDirectivity(azimuthDeg) {
    if (this.useDualEngine && this.dualDirectivityEngine) {
      this.dualDirectivityEngine.update(azimuthDeg);
    } else if (this.directivityModel) {
      this.directivityModel.update(azimuthDeg);
    }
  }

  /**
   * Load FRD IRs into directivity model (for standard presets)
   */
  loadIRs(irCache) {
    if (this.directivityModel) {
      this.directivityModel.loadIRs(irCache);
    }
  }

  /**
   * Switch to dual engine mode for LVT configurations
   */
  enableDualEngine() {
    if (this.useDualEngine) return;

    // Disconnect stimulus from single model, connect to dual engine
    this.stimulus.disconnect();
    this.stimulus.connect(this.dualDirectivityEngine.input);
    this.useDualEngine = true;

    console.log('AudioEngine: Switched to dual directivity engine');
  }

  /**
   * Switch back to single directivity model
   */
  disableDualEngine() {
    if (!this.useDualEngine) return;

    // Disconnect stimulus from dual engine, connect to single model
    this.stimulus.disconnect();
    this.stimulus.connect(this.directivityModel.input);
    this.useDualEngine = false;

    console.log('AudioEngine: Switched to single directivity model');
  }

  /**
   * Load a speaker configuration into the dual engine
   * @param {SpeakerConfiguration} config - Configuration to load
   */
  loadConfiguration(config) {
    if (!this.dualDirectivityEngine) return;

    this.enableDualEngine();
    this.dualDirectivityEngine.loadConfiguration(config);
  }

  /**
   * Crossfade to a new configuration
   * @param {SpeakerConfiguration} config - Configuration to switch to
   * @param {function} [onComplete] - Callback when crossfade completes
   */
  crossfadeToConfiguration(config, onComplete) {
    if (!this.dualDirectivityEngine) return;

    this.enableDualEngine();
    this.dualDirectivityEngine.crossfadeToConfiguration(config, onComplete);
  }

  /**
   * Get the active polar data store (for visualization)
   * @returns {PolarDataStore|null}
   */
  getActivePolarDataStore() {
    if (this.useDualEngine && this.dualDirectivityEngine) {
      return this.dualDirectivityEngine.getActivePolarDataStore();
    }
    return null; // Single model uses polarDataStore directly
  }

  /**
   * Start playing the current stimulus
   */
  play() {
    this.resume();
    appState.setPlaying(true);
  }

  /**
   * Stop playing
   */
  stop() {
    appState.setPlaying(false);
  }

  /**
   * Toggle play/stop
   */
  toggle() {
    if (appState.isPlaying) {
      this.stop();
    } else {
      this.play();
    }
  }

  /**
   * Enable headphone calibration for the given profile ID.
   * @param {string} profileId
   */
  setHeadphoneModel(profileId) {
    if (this.headphoneEQ) {
      this.headphoneEQ.enable(profileId);
    }
  }

  /**
   * Load a custom headphone measurement FRD text and apply its inverse as correction.
   * @param {string} frdText - Raw .frd file content
   */
  loadCustomHeadphoneProfile(frdText) {
    if (!this.headphoneEQ) return;
    try {
      const rawFRD = parseFRD(frdText);
      this.headphoneEQ.loadCustomMeasurement(rawFRD);
    } catch (err) {
      console.error('HeadphoneEQ: failed to parse custom FRD', err);
    }
  }

  /**
   * Load a WAV file for playback
   */
  async loadWavFile(file) {
    if (this.stimulus) {
      await this.stimulus.loadWavFile(file);
    }
  }

  /**
   * Get current audio context time
   */
  getCurrentTime() {
    return this.audioContext ? this.audioContext.currentTime : 0;
  }

  /**
   * Get audio context sample rate
   */
  getSampleRate() {
    return this.audioContext ? this.audioContext.sampleRate : 48000;
  }

  /**
   * Get audio context for external use
   */
  getAudioContext() {
    return this.audioContext;
  }
}
