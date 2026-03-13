/**
 * HeadphoneEQ.js - Output-stage EQ correction for known headphone models
 *
 * Inserts a ConvolverNode between masterGain and AudioContext.destination.
 * When disabled, holds a 1-sample Dirac delta (identity / allpass).
 * When enabled, holds an inverse correction IR derived from the headphone's
 * measured frequency response deviation.
 *
 * Graph topology:
 *   input (GainNode) → ConvolverNode → makeupGain (GainNode) → output (GainNode)
 */

import { frdToAudioBuffer } from './IRGenerator.js';
import { getProfile, buildCorrectionFRD, buildCorrectionFRDFromMeasurement } from '../data/HeadphoneProfiles.js';

const CORRECTION_IR_SIZE = 4096;

export class HeadphoneEQ {
  /**
   * @param {AudioContext} audioContext
   */
  constructor(audioContext) {
    this.audioContext = audioContext;
    this.enabled = false;
    this.currentProfileId = 'flat';

    this.input = audioContext.createGain();
    this.output = audioContext.createGain();
    this.convolver = audioContext.createConvolver();
    this.convolver.normalize = false;

    this.makeupGain = audioContext.createGain();
    this.makeupGain.gain.value = 1.0;

    this.input.connect(this.convolver);
    this.convolver.connect(this.makeupGain);
    this.makeupGain.connect(this.output);

    this._loadIdentity();
  }

  /**
   * Enable correction for the given headphone profile ID.
   * @param {string} profileId
   */
  enable(profileId) {
    const profile = getProfile(profileId);
    if (!profile) {
      console.warn(`HeadphoneEQ: unknown profile "${profileId}", using flat`);
      this._loadIdentity();
      this.enabled = false;
      this.currentProfileId = 'flat';
      return;
    }

    if (profile.id === 'flat') {
      this._loadIdentity();
      this.enabled = false;
      this.currentProfileId = 'flat';
      return;
    }

    const correctionFRD = buildCorrectionFRD(profile);
    this._loadCorrectionFRD(correctionFRD);
    this.enabled = true;
    this.currentProfileId = profileId;
    console.log(`HeadphoneEQ: enabled correction for "${profile.name}"`);
  }

  /**
   * Disable correction — reverts to identity (allpass).
   */
  disable() {
    this._loadIdentity();
    this.enabled = false;
    this.currentProfileId = 'flat';
    console.log('HeadphoneEQ: disabled');
  }

  /**
   * Apply correction from a raw headphone measurement FRD (custom upload).
   * The FRD should represent the headphone's measured absolute response.
   * The correction inverts the deviation from the measurement's mean level.
   * @param {{ freqs: number[], magDb: number[], phaseDeg: number[] }} rawFRD
   */
  loadCustomMeasurement(rawFRD) {
    const correctionFRD = buildCorrectionFRDFromMeasurement(rawFRD);
    this._loadCorrectionFRD(correctionFRD);
    this.enabled = true;
    this.currentProfileId = 'custom';
    console.log('HeadphoneEQ: loaded custom headphone correction');
  }

  /**
   * Load a Dirac delta IR — 1-sample buffer [1.0] — perfect allpass bypass.
   * @private
   */
  _loadIdentity() {
    const buffer = this.audioContext.createBuffer(1, 1, this.audioContext.sampleRate);
    buffer.getChannelData(0)[0] = 1.0;
    this.convolver.buffer = buffer;
    this.makeupGain.gain.value = 1.0;
  }

  /**
   * Convert a correction FRD to an IR and load it into the convolver.
   * Also sets makeup gain to compensate for peak normalization in frdToIR.
   * @param {{ freqs: number[], magDb: number[], phaseDeg: number[] }} correctionFRD
   * @private
   */
  _loadCorrectionFRD(correctionFRD) {
    const buffer = frdToAudioBuffer(correctionFRD, this.audioContext, {
      irSize: CORRECTION_IR_SIZE,
      useMinimumPhase: true,
    });

    this.convolver.buffer = buffer;

    // frdToIR normalizes peak to 0.9. The correction curve near-flat profiles
    // will peak near 1.0 in amplitude after inversion. We compensate so that
    // a flat-ish headphone correction doesn't noticeably change output level.
    // The makeup gain is set to the inverse of the expected normalization factor.
    // For moderate corrections (< ±10 dB swing), 1/0.9 ≈ 1.11 is appropriate.
    this.makeupGain.gain.value = 1 / 0.9;
  }
}
