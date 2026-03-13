/**
 * IRGenerator.js - Convert FRD data to impulse response AudioBuffers
 */

import FFT from 'fft.js';
import { interpolateLogFreq } from '../utils/MathUtils.js';
import { applyTukeyWindow } from '../utils/WindowFunctions.js';

const DEFAULT_IR_SIZE = 2048;
const DEFAULT_SAMPLE_RATE = 48000;

/**
 * Convert parsed FRD data to an impulse response
 * @param {Object} parsedFRD - { freqs, magDb, phaseDeg }
 * @param {Object} options - { irSize, sampleRate, useMinimumPhase }
 * @returns {Float32Array} - Impulse response samples
 */
export function frdToIR(parsedFRD, options = {}) {
  const {
    irSize = DEFAULT_IR_SIZE,
    sampleRate = DEFAULT_SAMPLE_RATE,
    useMinimumPhase = true,
  } = options;

  const { freqs, magDb, phaseDeg } = parsedFRD;
  const N = irSize;
  const numBins = N / 2 + 1;

  // Step 1: Build uniform linear frequency grid (0 → Nyquist)
  const uniformFreqs = new Array(numBins);
  for (let k = 0; k < numBins; k++) {
    uniformFreqs[k] = (k * sampleRate) / N;
  }

  // Step 2: Interpolate FRD (log-spaced) onto uniform grid
  const uniformMagDb = interpolateLogFreq(freqs, magDb, uniformFreqs);
  let uniformPhaseDeg;

  if (useMinimumPhase) {
    // Step 3a: Compute minimum phase from magnitude
    uniformPhaseDeg = computeMinimumPhase(uniformMagDb, N);
  } else {
    // Step 3b: Interpolate raw phase
    uniformPhaseDeg = interpolateLogFreq(freqs, phaseDeg, uniformFreqs);
  }

  // Step 4: Build complex spectrum with conjugate symmetry
  const fft = new FFT(N);
  const complexSpectrum = fft.createComplexArray();

  for (let k = 0; k < numBins; k++) {
    const amp = Math.pow(10, uniformMagDb[k] / 20);
    const phase = (uniformPhaseDeg[k] * Math.PI) / 180;
    const re = amp * Math.cos(phase);
    const im = amp * Math.sin(phase);

    complexSpectrum[2 * k] = re;
    complexSpectrum[2 * k + 1] = im;

    // Mirror for conjugate symmetry (produces real-valued IFFT output)
    if (k > 0 && k < N / 2) {
      complexSpectrum[2 * (N - k)] = re;
      complexSpectrum[2 * (N - k) + 1] = -im;
    }
  }

  // Step 5: IFFT
  const irComplex = fft.createComplexArray();
  fft.inverseTransform(irComplex, complexSpectrum);

  // Extract real part
  const ir = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    ir[i] = irComplex[2 * i];
  }

  // Step 6: Apply Tukey window to suppress edge artifacts
  applyTukeyWindow(ir, 0.15);

  // Step 7: Normalize peak to prevent clipping
  let peak = 0;
  for (let i = 0; i < N; i++) {
    peak = Math.max(peak, Math.abs(ir[i]));
  }
  if (peak > 0) {
    const scale = 0.9 / peak;
    for (let i = 0; i < N; i++) {
      ir[i] *= scale;
    }
  }

  return ir;
}

/**
 * Compute minimum phase from magnitude using cepstral method
 * @param {number[]} magDb - Magnitude in dB (uniform frequency bins)
 * @param {number} N - FFT size
 * @returns {number[]} - Phase in degrees
 */
function computeMinimumPhase(magDb, N) {
  const numBins = magDb.length;
  const fft = new FFT(N);

  // Convert magnitude to log magnitude (natural log for cepstrum)
  const logMag = fft.createComplexArray();
  for (let k = 0; k < numBins; k++) {
    // Convert dB to natural log: ln(amp) = dB * ln(10) / 20
    const lnAmp = (magDb[k] * Math.LN10) / 20;
    logMag[2 * k] = lnAmp;
    logMag[2 * k + 1] = 0;

    // Mirror for conjugate symmetry
    if (k > 0 && k < N / 2) {
      logMag[2 * (N - k)] = lnAmp;
      logMag[2 * (N - k) + 1] = 0;
    }
  }

  // IFFT to get cepstrum
  const cepstrum = fft.createComplexArray();
  fft.inverseTransform(cepstrum, logMag);

  // Apply minimum phase constraint:
  // - Keep sample 0 as-is
  // - Double samples 1 to N/2-1
  // - Zero samples N/2+1 to N-1
  // - Keep sample N/2 as-is
  const minPhaseCepstrum = fft.createComplexArray();
  minPhaseCepstrum[0] = cepstrum[0];
  minPhaseCepstrum[1] = 0;

  for (let n = 1; n < N / 2; n++) {
    minPhaseCepstrum[2 * n] = 2 * cepstrum[2 * n];
    minPhaseCepstrum[2 * n + 1] = 2 * cepstrum[2 * n + 1];
  }

  minPhaseCepstrum[N] = cepstrum[N]; // Sample N/2
  minPhaseCepstrum[N + 1] = 0;

  // Samples N/2+1 to N-1 are zero (already initialized to 0)

  // FFT back to get minimum phase spectrum
  const minPhaseSpectrum = fft.createComplexArray();
  fft.transform(minPhaseSpectrum, minPhaseCepstrum);

  // Extract phase from complex spectrum
  const phaseDeg = new Array(numBins);
  for (let k = 0; k < numBins; k++) {
    const re = minPhaseSpectrum[2 * k];
    const im = minPhaseSpectrum[2 * k + 1];
    // Phase is the imaginary part of the complex log magnitude
    phaseDeg[k] = (im * 180) / Math.PI;
  }

  return phaseDeg;
}

/**
 * Convert IR to AudioBuffer
 * @param {Float32Array} ir - Impulse response samples
 * @param {AudioContext} audioContext - Web Audio context
 * @returns {AudioBuffer}
 */
export function irToAudioBuffer(ir, audioContext) {
  const buffer = audioContext.createBuffer(1, ir.length, audioContext.sampleRate);
  buffer.copyToChannel(ir, 0);
  return buffer;
}

/**
 * Full conversion from FRD to AudioBuffer
 * @param {Object} parsedFRD - { freqs, magDb, phaseDeg }
 * @param {AudioContext} audioContext
 * @param {Object} options - { irSize, useMinimumPhase }
 * @returns {AudioBuffer}
 */
export function frdToAudioBuffer(parsedFRD, audioContext, options = {}) {
  const ir = frdToIR(parsedFRD, {
    ...options,
    sampleRate: audioContext.sampleRate,
  });
  return irToAudioBuffer(ir, audioContext);
}
