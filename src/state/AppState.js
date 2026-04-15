/**
 * AppState.js - Single source of truth for application state
 * Provides reactive state management with subscription support
 */

/** Maximum line-array elements (convolver / Resonance source budget). */
export const ARRAY_MAX_ELEMENTS = 16;

class AppState {
  constructor() {
    // Speaker state
    this.speakerPosition = { x: 0, y: 0, z: 0 };
    this.speakerRotation = 0; // Y-axis rotation in radians

    // Line array (acoustic centers in speaker space; shared polar FRD per element)
    this.arrayElementCount = 1;
    this.arraySpacingMeters = 0.5;
    /** 'x' = along local ±X (left-right on baffle); 'z' = along local ±Z (forward-back) */
    this.arrayLineAxis = 'x';
    /** One entry per element; delay is electronic steering (seconds), gain is shading (dB) */
    this.arrayElements = [{ delaySec: 0, gainDb: 0 }];

    // Per-frame geometry (world space, Y-up; filled in _updateComputedValues)
    this.elementWorldPositions = [];
    this.elementAzimuthsDeg = [];

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
    this.currentPreset = 'none'; // 'none', 'flat', 'woofer', 'horn', 'custom'
    this.customMeasurementInfo = null; // { fileCount, angles, source } when custom data loaded

    // LVT Demo state
    this.lvtDemoMode = false; // Whether LVT Demo mode is active
    this.activeConfigurationId = null; // Current speaker config ID
    this.configurations = []; // Array of available config metadata

    // Directivity overlay state
    this.directivityOverlayVisible = true;
    this.directivityFrequencies = [1000, 2000, 4000, 8000];

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

  /**
   * True when more than one array element is active (exclusive with LVT dual-engine mode).
   */
  isArrayMode() {
    return this.arrayElementCount > 1;
  }

  _clampArrayElementCount(n) {
    const count = Math.max(1, Math.min(ARRAY_MAX_ELEMENTS, Math.round(Number(n)) || 1));
    return count;
  }

  _ensureArrayElementParams() {
    while (this.arrayElements.length < this.arrayElementCount) {
      this.arrayElements.push({ delaySec: 0, gainDb: 0 });
    }
    if (this.arrayElements.length > this.arrayElementCount) {
      this.arrayElements.length = this.arrayElementCount;
    }
  }

  setArrayElementCount(count) {
    const next = this._clampArrayElementCount(count);
    if (next > 1 && this.lvtDemoMode) {
      this._notify('lvtExitForArray', null);
      this.setLVTDemoMode(false);
    }
    this.arrayElementCount = next;
    this._ensureArrayElementParams();
    this._notify('arrayLayout', this.getArrayLayoutSummary());
    this._updateComputedValues();
  }

  setArraySpacingMeters(spacing) {
    const s = Math.max(0, Math.min(10, Number(spacing) || 0));
    this.arraySpacingMeters = s;
    this._notify('arrayLayout', this.getArrayLayoutSummary());
    this._updateComputedValues();
  }

  setArrayLineAxis(axis) {
    this.arrayLineAxis = axis === 'z' ? 'z' : 'x';
    this._notify('arrayLayout', this.getArrayLayoutSummary());
    this._updateComputedValues();
  }

  setArrayElementDelay(index, delaySec) {
    if (index < 0 || index >= this.arrayElementCount) return;
    const maxDelay = 0.02;
    const d = Math.max(0, Math.min(maxDelay, Number(delaySec) || 0));
    this.arrayElements[index].delaySec = d;
    this._notify('arrayElementDSP', { index, delaySec: d });
    this._notify('arrayLayout', this.getArrayLayoutSummary());
  }

  setArrayElementGainDb(index, gainDb) {
    if (index < 0 || index >= this.arrayElementCount) return;
    const g = Math.max(-60, Math.min(12, Number(gainDb) || 0));
    this.arrayElements[index].gainDb = g;
    this._notify('arrayElementDSP', { index, gainDb: g });
    this._notify('arrayLayout', this.getArrayLayoutSummary());
  }

  /**
   * Local-space offsets (meters) of each element acoustic center; symmetric about array origin.
   * @returns {{ x: number, y: number, z: number }[]}
   */
  getElementLocalOffsets() {
    const n = this.arrayElementCount;
    const spacing = this.arraySpacingMeters;
    const axis = this.arrayLineAxis;
    const offsets = [];
    if (n === 1) {
      offsets.push({ x: 0, y: 0, z: 0 });
      return offsets;
    }
    const span = (n - 1) * spacing;
    const start = -span / 2;
    for (let i = 0; i < n; i++) {
      const t = start + i * spacing;
      if (axis === 'x') {
        offsets.push({ x: t, y: 0, z: 0 });
      } else {
        offsets.push({ x: 0, y: 0, z: t });
      }
    }
    return offsets;
  }

  getArrayLayoutSummary() {
    return {
      elementCount: this.arrayElementCount,
      spacingMeters: this.arraySpacingMeters,
      lineAxis: this.arrayLineAxis,
      elements: this.arrayElements.map((e) => ({ ...e })),
    };
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

  // Directivity overlay methods
  setDirectivityOverlayVisible(visible) {
    this.directivityOverlayVisible = visible;
    this._notify('directivityOverlayVisible', visible);
  }

  setDirectivityFrequencies(frequencies) {
    this.directivityFrequencies = [...frequencies];
    this._notify('directivityFrequencies', this.directivityFrequencies);
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
    if (preset !== 'custom') {
      this.customMeasurementInfo = null;
    }
    this._notify('currentPreset', preset);
  }

  setCustomMeasurement(info) {
    this.customMeasurementInfo = info;
    this.currentPreset = 'custom';
    this._notify('currentPreset', 'custom');
    this._notify('customMeasurement', info);
  }

  // LVT Demo methods
  setLVTDemoMode(enabled) {
    if (enabled && this.arrayElementCount > 1) {
      this.setArrayElementCount(1);
    }
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
    this._ensureArrayElementParams();

    const cosR = Math.cos(this.speakerRotation);
    const sinR = Math.sin(this.speakerRotation);

    const lx = this.listenerPosition.x;
    const ly = this.listenerPosition.y;
    const lz = this.listenerPosition.z;
    const sx = this.speakerPosition.x;
    const sy = this.speakerPosition.y;
    const sz = this.speakerPosition.z;

    // Array centroid = speaker anchor (enclosure reference)
    const dx = lx - sx;
    const dy = ly - sy;
    const dz = lz - sz;

    this.currentDistance = Math.sqrt(dx * dx + dy * dy + dz * dz);

    const cosNegR = Math.cos(-this.speakerRotation);
    const sinNegR = Math.sin(-this.speakerRotation);
    const localX = dx * cosNegR - dz * sinNegR;
    const localZ = dx * sinNegR + dz * cosNegR;
    this.currentAzimuth = Math.atan2(localX, localZ) * (180 / Math.PI);
    this.isRearHemisphere = Math.abs(this.currentAzimuth) > 90;

    if (this.currentDistance > 0) {
      this.currentSPL =
        this.onAxisSensitivity - 20 * Math.log10(this.currentDistance);
    }

    // Per-element world positions and azimuths (for array audio + charts)
    const offsets = this.getElementLocalOffsets();
    this.elementWorldPositions = [];
    this.elementAzimuthsDeg = [];

    for (let i = 0; i < this.arrayElementCount; i++) {
      const o = offsets[i];
      const wx = sx + o.x * cosR - o.z * sinR;
      const wy = sy + o.y;
      const wz = sz + o.x * sinR + o.z * cosR;
      this.elementWorldPositions.push({ x: wx, y: wy, z: wz });

      const dxi = lx - wx;
      const dyi = ly - wy;
      const dzi = lz - wz;
      const lix = dxi * cosNegR - dzi * sinNegR;
      const liz = dxi * sinNegR + dzi * cosNegR;
      const az = Math.atan2(lix, liz) * (180 / Math.PI);
      this.elementAzimuthsDeg.push(az);
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

  /**
   * Per-element azimuths for polar FR lookup (absolute value, rear clamped to 90°).
   * @returns {number[]}
   */
  getEffectiveElementAzimuths() {
    return this.elementAzimuthsDeg.map((az) => {
      let a = Math.abs(az);
      if (a > 90) a = 90;
      return a;
    });
  }
}

// Export singleton instance
export const appState = new AppState();
export default appState;
