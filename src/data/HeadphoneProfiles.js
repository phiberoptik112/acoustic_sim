/**
 * HeadphoneProfiles.js - Correction curves for common headphone models
 *
 * Each profile's magDb values represent the headphone's average measured
 * frequency response deviation from flat (positive = boosted by the headphone,
 * negative = cut). The correction IR applies the inverse of this curve.
 *
 * Curves are simplified approximations sourced from published measurements
 * (ASR, rtings.com, InnerFidelity). For maximum accuracy, use the custom
 * FRD upload to supply your own measurement.
 */

/**
 * @typedef {Object} HeadphoneProfile
 * @property {string} id - Unique identifier
 * @property {string} name - Display name
 * @property {string} description - Short description for UI
 * @property {number[]} freqs - Frequency points in Hz
 * @property {number[]} magDb - Headphone deviation from flat at each frequency (dB)
 */

/** @type {HeadphoneProfile[]} */
const HEADPHONE_PROFILES = [
  {
    id: 'flat',
    name: 'Flat Reference (No Correction)',
    description: 'Bypass — no EQ applied',
    freqs: [20, 20000],
    magDb: [0, 0],
  },

  {
    id: 'airpods_2nd',
    name: 'Apple AirPods (2nd gen)',
    description: 'Heavy bass boost, bright 8–10 kHz peak, recessed mids',
    freqs: [20, 40, 80, 120, 200, 400, 800, 1000, 2000, 3000, 4000, 6000, 8000, 10000, 12000, 16000, 20000],
    magDb: [7, 8, 7, 5, 2, 0, -1, -1, -2, -1, 0, 2, 6, 7, 4, 1, -1],
  },

  {
    id: 'airpods_pro',
    name: 'Apple AirPods Pro',
    description: 'Moderate bass boost, extended low end, smooth treble',
    freqs: [20, 40, 80, 120, 200, 400, 800, 1000, 2000, 3000, 4000, 6000, 8000, 10000, 12000, 16000, 20000],
    magDb: [6, 7, 7, 5, 3, 1, 0, 0, -1, 0, 1, 2, 3, 3, 2, 1, 0],
  },

  {
    id: 'sony_xm4',
    name: 'Sony WH-1000XM4',
    description: 'Deep bass shelf, slightly recessed low mids, neutral upper mids',
    freqs: [20, 40, 80, 120, 200, 400, 800, 1000, 2000, 3000, 4000, 6000, 8000, 10000, 12000, 16000, 20000],
    magDb: [9, 9, 8, 6, 3, 0, -1, -1, -2, -1, 0, 1, 2, 3, 2, 0, -2],
  },

  {
    id: 'sennheiser_hd650',
    name: 'Sennheiser HD 650',
    description: 'Slight sub-bass rolloff, flat mids, gently rolled treble',
    freqs: [20, 40, 80, 120, 200, 400, 800, 1000, 2000, 3000, 4000, 6000, 8000, 10000, 12000, 16000, 20000],
    magDb: [-3, -2, -1, 0, 0, 0, 0, 0, 0, 0, -1, -2, -3, -4, -5, -6, -8],
  },

  {
    id: 'beyerdynamic_dt990',
    name: 'Beyerdynamic DT 990 Pro',
    description: 'Modest bass boost, neutral mids, prominent 10 kHz treble peak',
    freqs: [20, 40, 80, 120, 200, 400, 800, 1000, 2000, 3000, 4000, 6000, 8000, 10000, 12000, 16000, 20000],
    magDb: [3, 3, 2, 1, 0, 0, 0, 0, -1, -1, 0, 2, 5, 7, 5, 2, 0],
  },
];

/**
 * Get a headphone profile by ID
 * @param {string} id
 * @returns {HeadphoneProfile|undefined}
 */
export function getProfile(id) {
  return HEADPHONE_PROFILES.find((p) => p.id === id);
}

/**
 * Get all available headphone profiles
 * @returns {HeadphoneProfile[]}
 */
export function getAllProfiles() {
  return HEADPHONE_PROFILES;
}

/**
 * Build a correction FRD from a headphone profile.
 * The correction is the inverse of the headphone's deviation — applying it
 * compensates for the headphone's coloration.
 * @param {HeadphoneProfile} profile
 * @returns {{ freqs: number[], magDb: number[], phaseDeg: number[] }}
 */
export function buildCorrectionFRD(profile) {
  return {
    freqs: profile.freqs,
    magDb: profile.magDb.map((db) => -db),
    phaseDeg: new Array(profile.freqs.length).fill(0),
  };
}

/**
 * Build a correction FRD from a raw headphone measurement FRD.
 * Treats the measured response as the headphone deviation and inverts it
 * relative to the measurement's own average level (mean magnitude).
 * @param {{ freqs: number[], magDb: number[], phaseDeg: number[] }} rawFRD
 * @returns {{ freqs: number[], magDb: number[], phaseDeg: number[] }}
 */
export function buildCorrectionFRDFromMeasurement(rawFRD) {
  const mean = rawFRD.magDb.reduce((a, b) => a + b, 0) / rawFRD.magDb.length;
  return {
    freqs: rawFRD.freqs,
    magDb: rawFRD.magDb.map((db) => -(db - mean)),
    phaseDeg: new Array(rawFRD.freqs.length).fill(0),
  };
}

export default HEADPHONE_PROFILES;
