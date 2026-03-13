/**
 * AppState.js - Single source of truth for application state
 * Provides reactive state management with subscription support
 */

class AppState {
  constructor() {
    // Speaker state
    this.speakerPosition = { x: 0, y: 0, z: 0 };
    this.speakerRotation = 0; // Y-axis rotation in radians

    // Listener state
    this.listenerPosition = { x: 0, y: 0, z: 3 };
    this.listenerOrientation = {
      forward: { x: 0, y: 0, z: -1 },
      up: { x: 0, y: 1, z: 0 },
    };

    // Computed values (updated each frame)
    this.currentAzimuth = 0; // Degrees, in speaker's local space
    this.currentDistance = 3; // Meters
    this.currentSPL = 85; // Estimated SPL at listener position
    this.isRearHemisphere = false; // True if |azimuth| > 90°

    // FRD data state
    this.frdLoaded = false;
    this.loadedAngles = []; // Array of loaded polar angles
    this.onAxisSensitivity = 85; // dB SPL at 1m, 2.83V

    // Audio settings
    this.isPlaying = false;
    this.stimulusType = 'pink'; // 'pink', 'sweep', 'wav'
    this.masterVolume = 0; // dB
    this.useMinimumPhase = true;
    this.irSize = 2048; // 1024 or 2048
    this.distanceModel = 'logarithmic'; // 'logarithmic' or 'linear'

    // View settings
    this.viewMode = 'ortho'; // 'ortho' or 'perspective'

    // Preset
    this.currentPreset = 'none'; // 'none', 'flat', 'woofer', 'horn'

    // LVT Demo state
    this.lvtDemoMode = false; // Whether LVT Demo mode is active
    this.activeConfigurationId = null; // Current speaker config ID
    this.configurations = []; // Array of available config metadata

    // Headphone calibration state
    this.headphoneCalibrationEnabled = false;
    this.headphoneModel = 'flat';

    // Subscribers for reactive updates
    this._subscribers = new Map();
  }

  /**
   * Subscribe to state changes
   * @param {string} key - State key to watch
   * @param {function} callback - Called when state changes
   * @returns {function} Unsubscribe function
   */
  subscribe(key, callback) {
    if (!this._subscribers.has(key)) {
      this._subscribers.set(key, new Set());
    }
    this._subscribers.get(key).add(callback);

    return () => {
      this._subscribers.get(key).delete(callback);
    };
  }

  /**
   * Notify subscribers of a state change
   * @param {string} key - State key that changed
   * @param {any} value - New value
   */
  _notify(key, value) {
    if (this._subscribers.has(key)) {
      this._subscribers.get(key).forEach((callback) => callback(value));
    }
  }

  // Speaker position methods
  setSpeakerPosition(x, y, z) {
    this.speakerPosition = { x, y, z };
    this._notify('speakerPosition', this.speakerPosition);
    this._updateComputedValues();
  }

  setSpeakerRotation(rotation) {
    this.speakerRotation = rotation;
    this._notify('speakerRotation', this.speakerRotation);
    this._updateComputedValues();
  }

  // Listener position/orientation methods
  setListenerPosition(x, y, z) {
    this.listenerPosition = { x, y, z };
    this._notify('listenerPosition', this.listenerPosition);
    this._updateComputedValues();
  }

  setListenerOrientation(forward, up) {
    this.listenerOrientation = { forward, up };
    this._notify('listenerOrientation', this.listenerOrientation);
  }

  // Audio control methods
  setPlaying(isPlaying) {
    this.isPlaying = isPlaying;
    this._notify('isPlaying', isPlaying);
  }

  setStimulusType(type) {
    this.stimulusType = type;
    this._notify('stimulusType', type);
  }

  setMasterVolume(db) {
    this.masterVolume = db;
    this._notify('masterVolume', db);
  }

  setMinimumPhase(useMinPhase) {
    this.useMinimumPhase = useMinPhase;
    this._notify('useMinimumPhase', useMinPhase);
  }

  setIRSize(size) {
    this.irSize = size;
    this._notify('irSize', size);
  }

  setDistanceModel(model) {
    this.distanceModel = model;
    this._notify('distanceModel', model);
  }

  // View methods
  setViewMode(mode) {
    this.viewMode = mode;
    this._notify('viewMode', mode);
  }

  // FRD data methods
  setFRDLoaded(loaded, angles = []) {
    this.frdLoaded = loaded;
    this.loadedAngles = angles;
    this._notify('frdLoaded', { loaded, angles });
  }

  setOnAxisSensitivity(sensitivity) {
    this.onAxisSensitivity = sensitivity;
    this._notify('onAxisSensitivity', sensitivity);
    this._updateComputedValues();
  }

  setCurrentPreset(preset) {
    this.currentPreset = preset;
    this._notify('currentPreset', preset);
  }

  // LVT Demo methods
  setLVTDemoMode(enabled) {
    this.lvtDemoMode = enabled;
    this._notify('lvtDemoMode', enabled);
  }

  setActiveConfiguration(configId) {
    this.activeConfigurationId = configId;
    this._notify('activeConfiguration', configId);
  }

  setConfigurations(configs) {
    this.configurations = configs;
    this._notify('configurations', configs);
  }

  // Headphone calibration methods
  setHeadphoneCalibration(enabled) {
    this.headphoneCalibrationEnabled = enabled;
    this._notify('headphoneCalibrationEnabled', enabled);
  }

  setHeadphoneModel(profileId) {
    this.headphoneModel = profileId;
    this._notify('headphoneModel', profileId);
  }

  /**
   * Get active configuration metadata
   * @returns {Object|null}
   */
  getActiveConfigurationInfo() {
    if (!this.activeConfigurationId) return null;
    return this.configurations.find((c) => c.id === this.activeConfigurationId) || null;
  }

  /**
   * Update computed values based on speaker/listener positions
   * Called whenever positions change
   */
  _updateComputedValues() {
    const dx = this.listenerPosition.x - this.speakerPosition.x;
    const dy = this.listenerPosition.y - this.speakerPosition.y;
    const dz = this.listenerPosition.z - this.speakerPosition.z;

    // Calculate distance
    this.currentDistance = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // Calculate azimuth in speaker's local space
    // Speaker forward is +Z, rotated by speakerRotation
    const cosR = Math.cos(-this.speakerRotation);
    const sinR = Math.sin(-this.speakerRotation);

    // Transform listener position to speaker's local space
    const localX = dx * cosR - dz * sinR;
    const localZ = dx * sinR + dz * cosR;

    // Azimuth from speaker's forward axis (+Z in local space)
    this.currentAzimuth = Math.atan2(localX, localZ) * (180 / Math.PI);

    // Check if in rear hemisphere
    this.isRearHemisphere = Math.abs(this.currentAzimuth) > 90;

    // Calculate estimated SPL using inverse square law
    // SPL = sensitivity - 20*log10(distance)
    if (this.currentDistance > 0) {
      this.currentSPL =
        this.onAxisSensitivity - 20 * Math.log10(this.currentDistance);
    }

    this._notify('computed', {
      azimuth: this.currentAzimuth,
      distance: this.currentDistance,
      spl: this.currentSPL,
      isRearHemisphere: this.isRearHemisphere,
    });
  }

  /**
   * Get the effective azimuth for directivity lookup
   * Mirrors negative angles and clamps to 90° max
   */
  getEffectiveAzimuth() {
    let azimuth = Math.abs(this.currentAzimuth);
    if (azimuth > 90) {
      azimuth = 90; // Clamp to 90° for rear hemisphere
    }
    return azimuth;
  }
}

// Export singleton instance
export const appState = new AppState();
export default appState;
