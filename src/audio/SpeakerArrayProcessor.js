/**
 * SpeakerArrayProcessor.js - Per-element gain, delay, directivity, and Resonance source
 */

import { DirectivityModel } from './DirectivityModel.js';

/** Max electronic delay per element (steering), seconds */
export const ARRAY_MAX_DELAY_SEC = 0.02;

export class SpeakerArrayProcessor {
  /**
   * @param {AudioContext} audioContext
   * @param {function(): object} createSource - scene.createSource bound to scene
   */
  constructor(audioContext, createSource) {
    this.audioContext = audioContext;
    this._createSource = createSource;

    /** @type {{ shadingGain: GainNode, delayNode: DelayNode, directivity: DirectivityModel, resonanceSource: object }[]} */
    this.channels = [];
    this.splitterGain = audioContext.createGain();
    this.splitterGain.gain.value = 1;
    this._activeCount = 0;
    /** @type {import('../data/PolarDataStore.js').PolarDataStore|null} */
    this._lastPolarStore = null;
  }

  get input() {
    return this.splitterGain;
  }

  _ensureChannel(index) {
    while (this.channels.length <= index) {
      const resonanceSource = this._createSource();
      resonanceSource.setRolloff('logarithmic');
      resonanceSource.setMinDistance(1.0);
      resonanceSource.setMaxDistance(100.0);

      const shadingGain = this.audioContext.createGain();
      shadingGain.gain.value = 0;

      const delayNode = this.audioContext.createDelay(ARRAY_MAX_DELAY_SEC);
      delayNode.delayTime.value = 0;

      const directivity = new DirectivityModel(this.audioContext);

      this.splitterGain.connect(shadingGain);
      shadingGain.connect(delayNode);
      delayNode.connect(directivity.input);
      directivity.connect(resonanceSource.input);

      this.channels.push({
        shadingGain,
        delayNode,
        directivity,
        resonanceSource,
      });
    }
  }

  /**
   * @param {number} n - number of active array elements (0 = all muted, used in single-speaker mode)
   */
  setActiveChannelCount(n) {
    const count = Math.max(0, Math.floor(Number(n)) || 0);
    this._activeCount = count;
    for (let i = 0; i < count; i++) {
      this._ensureChannel(i);
    }
    for (let i = 0; i < this.channels.length; i++) {
      const on = i < count;
      this.channels[i].shadingGain.gain.value = on ? 1 : 0;
      if (!on) {
        this.channels[i].delayNode.delayTime.value = 0;
      }
    }

    if (this._lastPolarStore) {
      for (const ch of this.channels) {
        ch.directivity.loadIRs(this._lastPolarStore);
      }
    }
  }

  get activeChannelCount() {
    return this._activeCount;
  }

  /**
   * @param {import('../data/PolarDataStore.js').PolarDataStore} polarDataStore
   */
  loadIRs(polarDataStore) {
    this._lastPolarStore = polarDataStore;
    for (const ch of this.channels) {
      ch.directivity.loadIRs(polarDataStore);
    }
  }

  /**
   * @param {number[]} azimuthsDeg - effective (clamped) azimuth per active element
   */
  updateDirectivity(azimuthsDeg) {
    for (let i = 0; i < this._activeCount; i++) {
      const ch = this.channels[i];
      const az = azimuthsDeg[i] ?? 0;
      ch.directivity.update(az);
    }
  }

  setElementShadingGainLinear(index, linear) {
    const ch = this.channels[index];
    if (!ch || index >= this._activeCount) return;
    const g = Math.max(0, Math.min(100, Number(linear) || 0));
    ch.shadingGain.gain.value = g;
  }

  setElementDelaySec(index, sec) {
    const ch = this.channels[index];
    if (!ch || index >= this._activeCount) return;
    const d = Math.max(0, Math.min(ARRAY_MAX_DELAY_SEC, Number(sec) || 0));
    ch.delayNode.delayTime.value = d;
  }

  /**
   * @param {number} index
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  setSourcePosition(index, x, y, z) {
    const ch = this.channels[index];
    if (!ch) return;
    ch.resonanceSource.setPosition(x, y, z);
  }

  setRolloffModel(model) {
    for (const ch of this.channels) {
      ch.resonanceSource.setRolloff(model);
    }
  }

  muteAllPositions() {
    for (let i = 0; i < this.channels.length; i++) {
      this.channels[i].resonanceSource.setPosition(0, -1e6, 0);
    }
  }
}
