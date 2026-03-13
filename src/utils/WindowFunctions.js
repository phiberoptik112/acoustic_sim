/**
 * WindowFunctions.js - Window functions for signal processing
 */

/**
 * Generate a Tukey (tapered cosine) window
 * @param {number} length - Window length in samples
 * @param {number} alpha - Taper ratio (0 = rectangular, 1 = Hann)
 * @returns {Float32Array} Window coefficients
 */
export function tukey(length, alpha = 0.15) {
  const window = new Float32Array(length);
  const taperLength = Math.floor((alpha * length) / 2);

  for (let i = 0; i < length; i++) {
    if (i < taperLength) {
      // Rising taper
      window[i] = 0.5 * (1 - Math.cos((Math.PI * i) / taperLength));
    } else if (i > length - 1 - taperLength) {
      // Falling taper
      window[i] =
        0.5 * (1 - Math.cos((Math.PI * (length - 1 - i)) / taperLength));
    } else {
      // Flat region
      window[i] = 1;
    }
  }

  return window;
}

/**
 * Generate a Hann window
 * @param {number} length - Window length in samples
 * @returns {Float32Array} Window coefficients
 */
export function hann(length) {
  const window = new Float32Array(length);

  for (let i = 0; i < length; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (length - 1)));
  }

  return window;
}

/**
 * Generate a Hamming window
 * @param {number} length - Window length in samples
 * @returns {Float32Array} Window coefficients
 */
export function hamming(length) {
  const window = new Float32Array(length);

  for (let i = 0; i < length; i++) {
    window[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (length - 1));
  }

  return window;
}

/**
 * Generate a Blackman window
 * @param {number} length - Window length in samples
 * @returns {Float32Array} Window coefficients
 */
export function blackman(length) {
  const window = new Float32Array(length);
  const a0 = 0.42;
  const a1 = 0.5;
  const a2 = 0.08;

  for (let i = 0; i < length; i++) {
    window[i] =
      a0 -
      a1 * Math.cos((2 * Math.PI * i) / (length - 1)) +
      a2 * Math.cos((4 * Math.PI * i) / (length - 1));
  }

  return window;
}

/**
 * Apply a window function to an array in-place
 * @param {Float32Array} signal - Signal to window
 * @param {Float32Array} window - Window coefficients
 */
export function applyWindow(signal, window) {
  const length = Math.min(signal.length, window.length);
  for (let i = 0; i < length; i++) {
    signal[i] *= window[i];
  }
}

/**
 * Apply a Tukey window to an array in-place
 * @param {Float32Array} signal - Signal to window
 * @param {number} alpha - Taper ratio
 */
export function applyTukeyWindow(signal, alpha = 0.15) {
  const window = tukey(signal.length, alpha);
  applyWindow(signal, window);
}
