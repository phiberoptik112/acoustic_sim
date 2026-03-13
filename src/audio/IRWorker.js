/**
 * IRWorker.js - Web Worker for off-thread IR generation
 *
 * This file can be used as a Web Worker for heavy IR processing.
 * For simplicity in the initial implementation, we also provide
 * a wrapper that runs on the main thread but can be swapped out.
 */

import { frdToIR } from './IRGenerator.js';

/**
 * IRWorkerWrapper - Manages IR generation, potentially in a worker
 */
export class IRWorkerWrapper {
  constructor() {
    this.worker = null;
    this.pendingTasks = new Map();
    this.taskId = 0;

    // Try to create a worker, fall back to main thread if not available
    this._initWorker();
  }

  _initWorker() {
    // For now, we'll use main-thread processing
    // A true Web Worker would require a separate bundled file
    // This can be enhanced later with Vite's worker support
    this.useWorker = false;
  }

  /**
   * Process FRD data into IR
   * @param {Object} parsedFRD - { freqs, magDb, phaseDeg }
   * @param {number} angle - The polar angle
   * @param {Object} options - { irSize, sampleRate, useMinimumPhase }
   * @returns {Promise<{ angle: number, ir: Float32Array }>}
   */
  async process(parsedFRD, angle, options) {
    return new Promise((resolve, reject) => {
      try {
        // Main thread processing
        const ir = frdToIR(parsedFRD, options);
        resolve({ angle, ir });
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Process multiple FRD datasets
   * @param {Map<number, Object>} frdMap - Map of angle -> FRD data
   * @param {Object} options
   * @param {function} onProgress - Called with (completed, total)
   * @returns {Promise<Map<number, Float32Array>>}
   */
  async processMultiple(frdMap, options, onProgress) {
    const results = new Map();
    const total = frdMap.size;
    let completed = 0;

    // Process sequentially to avoid blocking
    for (const [angle, frd] of frdMap) {
      const result = await this.process(frd, angle, options);
      results.set(result.angle, result.ir);
      completed++;
      if (onProgress) {
        onProgress(completed, total);
      }

      // Yield to allow UI updates
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    return results;
  }

  /**
   * Terminate the worker
   */
  terminate() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}

/**
 * Web Worker script (for use in an actual worker file)
 * This would be in a separate file like ir-worker.js
 */
export const workerScript = `
import FFT from 'fft.js';

// Inline the necessary functions for the worker
function interpolateLogFreq(sourceFreqs, sourceValues, targetFreqs) {
  const result = new Array(targetFreqs.length);
  const logSourceFreqs = sourceFreqs.map(f => f > 0 ? Math.log10(f) : -10);

  for (let i = 0; i < targetFreqs.length; i++) {
    const targetFreq = targetFreqs[i];
    if (targetFreq <= 0) {
      result[i] = sourceValues[0];
      continue;
    }

    const logTarget = Math.log10(targetFreq);
    let lowerIdx = 0;
    let upperIdx = logSourceFreqs.length - 1;

    for (let j = 0; j < logSourceFreqs.length - 1; j++) {
      if (logSourceFreqs[j] <= logTarget && logSourceFreqs[j + 1] >= logTarget) {
        lowerIdx = j;
        upperIdx = j + 1;
        break;
      }
    }

    if (logTarget < logSourceFreqs[0]) {
      result[i] = sourceValues[0];
      continue;
    }
    if (logTarget > logSourceFreqs[logSourceFreqs.length - 1]) {
      result[i] = sourceValues[sourceValues.length - 1];
      continue;
    }

    const logLower = logSourceFreqs[lowerIdx];
    const logUpper = logSourceFreqs[upperIdx];
    const t = (logTarget - logLower) / (logUpper - logLower);
    result[i] = sourceValues[lowerIdx] + (sourceValues[upperIdx] - sourceValues[lowerIdx]) * t;
  }

  return result;
}

self.onmessage = function(e) {
  const { parsedFRD, angle, irSize, sampleRate, useMinimumPhase, taskId } = e.data;

  try {
    // Process FRD to IR here
    // ... (full implementation)

    // Transfer the result
    const ir = new Float32Array(irSize);
    self.postMessage({ taskId, angle, ir }, [ir.buffer]);
  } catch (err) {
    self.postMessage({ taskId, error: err.message });
  }
};
`;
