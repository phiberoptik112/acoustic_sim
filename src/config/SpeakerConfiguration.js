/**
 * SpeakerConfiguration.js - Data class representing a speaker configuration
 *
 * Bundles all data needed to render a speaker system: FRD data, IRs, and display metadata.
 */

export class SpeakerConfiguration {
  /**
   * Create a speaker configuration
   * @param {Object} options Configuration options
   * @param {string} options.id - Unique identifier (e.g., 'lvt_5lb')
   * @param {string} options.name - Display name (e.g., '5 lb - Single Compression')
   * @param {string} options.description - One-line description for UI
   * @param {number} options.sensitivity - On-axis sensitivity in dB SPL at 1m
   * @param {string} options.bandwidthLabel - Frequency range label (e.g., '800 Hz - 12 kHz')
   * @param {string} options.color - UI accent color (hex string)
   * @param {number} [options.frequencyMin=20] - Minimum frequency in Hz
   * @param {number} [options.frequencyMax=20000] - Maximum frequency in Hz
   */
  constructor({
    id,
    name,
    description,
    sensitivity,
    bandwidthLabel,
    color,
    frequencyMin = 20,
    frequencyMax = 20000,
  }) {
    this.id = id;
    this.name = name;
    this.description = description;
    this.sensitivity = sensitivity;
    this.bandwidthLabel = bandwidthLabel;
    this.color = color;
    this.frequencyMin = frequencyMin;
    this.frequencyMax = frequencyMax;

    // FRD data indexed by angle: Map<number, { freqs, magDb, phaseDeg }>
    this.frdSet = new Map();

    // Pre-converted IR AudioBuffers indexed by angle: Map<number, AudioBuffer>
    this.irSet = new Map();

    // Track loaded state
    this.isLoaded = false;
  }

  /**
   * Set FRD data for a specific angle
   * @param {number} angle - Polar angle in degrees
   * @param {Object} frd - FRD data { freqs, magDb, phaseDeg }
   */
  setFRD(angle, frd) {
    this.frdSet.set(angle, frd);
  }

  /**
   * Get FRD data for a specific angle
   * @param {number} angle - Polar angle in degrees
   * @returns {Object|undefined} FRD data or undefined
   */
  getFRD(angle) {
    return this.frdSet.get(angle);
  }

  /**
   * Set IR AudioBuffer for a specific angle
   * @param {number} angle - Polar angle in degrees
   * @param {AudioBuffer} buffer - Pre-converted IR
   */
  setIR(angle, buffer) {
    this.irSet.set(angle, buffer);
  }

  /**
   * Get IR AudioBuffer for a specific angle
   * @param {number} angle - Polar angle in degrees
   * @returns {AudioBuffer|undefined} IR buffer or undefined
   */
  getIR(angle) {
    return this.irSet.get(angle);
  }

  /**
   * Get all loaded angles (sorted)
   * @returns {number[]} Array of angles
   */
  getLoadedAngles() {
    return Array.from(this.irSet.keys()).sort((a, b) => a - b);
  }

  /**
   * Check if configuration has data
   * @returns {boolean}
   */
  get hasData() {
    return this.irSet.size > 0;
  }

  /**
   * Mark configuration as fully loaded
   */
  markLoaded() {
    this.isLoaded = true;
  }

  /**
   * Get display metadata for UI
   * @returns {Object} Metadata object
   */
  getDisplayInfo() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      sensitivity: this.sensitivity,
      bandwidthLabel: this.bandwidthLabel,
      color: this.color,
    };
  }

  /**
   * Clear all data (for reloading)
   */
  clear() {
    this.frdSet.clear();
    this.irSet.clear();
    this.isLoaded = false;
  }
}
