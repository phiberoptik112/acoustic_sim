/**
 * PolarDataStore.js - Cache for polar impulse response AudioBuffers
 */

import { findBracketAngles } from '../utils/MathUtils.js';

export class PolarDataStore {
  constructor() {
    // Key: `${azimuthDeg}_${elevationDeg}` e.g., "30_0", "45_0"
    // Value: AudioBuffer (pre-converted IR)
    this.irCache = new Map();

    // Also store raw FRD data for visualization
    this.frdCache = new Map();

    // Loaded angle sets
    this.loadedAzimuths = []; // e.g., [0, 15, 30, 45, 60, 75, 90]
    this.loadedElevations = [0]; // Stub for future vertical expansion

    // Rear hemisphere warning flag
    this.rearHemisphereWarning = false;
  }

  /**
   * Generate cache key from azimuth and elevation
   */
  _getKey(azimuthDeg, elevationDeg = 0) {
    return `${azimuthDeg}_${elevationDeg}`;
  }

  /**
   * Store an AudioBuffer for a polar angle
   */
  set(azimuthDeg, elevationDeg = 0, audioBuffer) {
    const key = this._getKey(azimuthDeg, elevationDeg);
    this.irCache.set(key, audioBuffer);

    // Update loaded azimuths if this is a new angle
    if (!this.loadedAzimuths.includes(azimuthDeg)) {
      this.loadedAzimuths.push(azimuthDeg);
      this.loadedAzimuths.sort((a, b) => a - b);
    }
  }

  /**
   * Store raw FRD data for visualization
   */
  setFRD(azimuthDeg, frdData) {
    this.frdCache.set(azimuthDeg, frdData);
  }

  /**
   * Get AudioBuffer for a polar angle
   */
  get(azimuthDeg, elevationDeg = 0) {
    const key = this._getKey(azimuthDeg, elevationDeg);
    return this.irCache.get(key);
  }

  /**
   * Get raw FRD data for an angle
   */
  getFRD(azimuthDeg) {
    return this.frdCache.get(azimuthDeg);
  }

  /**
   * Check if an angle is loaded
   */
  has(azimuthDeg, elevationDeg = 0) {
    const key = this._getKey(azimuthDeg, elevationDeg);
    return this.irCache.has(key);
  }

  /**
   * Get the two nearest angles and interpolation weight for a given azimuth
   * Applies mirroring for negative azimuths and clamping for rear hemisphere
   *
   * @param {number} azimuthDeg - Target azimuth angle
   * @param {number} elevationDeg - Elevation (stub, defaults to 0)
   * @returns {{ lowerAngle: number, upperAngle: number, alpha: number, clamped: boolean }}
   */
  getWeightedPair(azimuthDeg, elevationDeg = 0) {
    // Mirror negative azimuths (symmetric polar data)
    let effectiveAzimuth = Math.abs(azimuthDeg);

    // Check for rear hemisphere (|azimuth| > 90°)
    let clamped = false;
    if (effectiveAzimuth > 90) {
      effectiveAzimuth = 90;
      clamped = true;
      this.rearHemisphereWarning = true;
    } else {
      this.rearHemisphereWarning = false;
    }

    // Find bracket angles
    const bracket = findBracketAngles(this.loadedAzimuths, effectiveAzimuth);

    return {
      lowerAngle: bracket.lowerAngle,
      upperAngle: bracket.upperAngle,
      alpha: bracket.alpha,
      clamped,
    };
  }

  /**
   * Get AudioBuffers for the weighted pair
   * @returns {{ bufferA: AudioBuffer, bufferB: AudioBuffer, alpha: number, clamped: boolean }}
   */
  getWeightedBuffers(azimuthDeg, elevationDeg = 0) {
    const { lowerAngle, upperAngle, alpha, clamped } = this.getWeightedPair(
      azimuthDeg,
      elevationDeg
    );

    return {
      bufferA: this.get(lowerAngle, elevationDeg),
      bufferB: this.get(upperAngle, elevationDeg),
      alpha,
      clamped,
      lowerAngle,
      upperAngle,
    };
  }

  /**
   * Clear all cached data
   */
  clear() {
    this.irCache.clear();
    this.frdCache.clear();
    this.loadedAzimuths = [];
    this.rearHemisphereWarning = false;
  }

  /**
   * Get number of loaded angles
   */
  get size() {
    return this.irCache.size;
  }

  /**
   * Check if any data is loaded
   */
  get hasData() {
    return this.irCache.size > 0;
  }

  /**
   * Get all loaded angles
   */
  getLoadedAngles() {
    return [...this.loadedAzimuths];
  }

  /**
   * Get FRD data interpolated to a specific angle
   * Used for chart display
   */
  getInterpolatedFRD(azimuthDeg) {
    const { lowerAngle, upperAngle, alpha } = this.getWeightedPair(azimuthDeg);

    const frdLower = this.getFRD(lowerAngle);
    const frdUpper = this.getFRD(upperAngle);

    if (!frdLower || !frdUpper) {
      return frdLower || frdUpper || null;
    }

    // Interpolate magnitude (use same frequencies as lower)
    const freqs = frdLower.freqs;
    const magDb = new Array(freqs.length);

    for (let i = 0; i < freqs.length; i++) {
      magDb[i] =
        frdLower.magDb[i] * (1 - alpha) + frdUpper.magDb[i] * alpha;
    }

    return { freqs, magDb };
  }
}

// Export singleton instance
export const polarDataStore = new PolarDataStore();
export default polarDataStore;
