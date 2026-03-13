/**
 * MathUtils.js - Mathematical utilities for polar calculations and interpolation
 */

/**
 * Convert degrees to radians
 */
export function degToRad(deg) {
  return deg * (Math.PI / 180);
}

/**
 * Convert radians to degrees
 */
export function radToDeg(rad) {
  return rad * (180 / Math.PI);
}

/**
 * Linear interpolation between two values
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Clamp a value between min and max
 */
export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Calculate distance between two 3D points
 */
export function getDistance(pos1, pos2) {
  const dx = pos2.x - pos1.x;
  const dy = pos2.y - pos1.y;
  const dz = pos2.z - pos1.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Calculate the azimuth angle of the listener relative to the speaker's forward axis
 * @param {Object3D} speakerObj - Three.js speaker object
 * @param {Vector3} listenerPos - Listener world position
 * @returns {number} Azimuth in degrees (-180 to 180)
 */
export function getListenerAzimuth(speakerObj, listenerPos) {
  // Transform listener into speaker's local coordinate frame
  const local = speakerObj.worldToLocal(listenerPos.clone());
  // Azimuth from speaker's forward axis (+Z in Three.js)
  return Math.atan2(local.x, local.z) * (180 / Math.PI);
}

/**
 * Interpolate values on a log-frequency scale
 * Used for converting log-spaced FRD data to uniform linear grid
 *
 * @param {number[]} sourceFreqs - Source frequency points (log-spaced)
 * @param {number[]} sourceValues - Values at source frequencies
 * @param {number[]} targetFreqs - Target frequency points (linear-spaced)
 * @returns {number[]} Interpolated values at target frequencies
 */
export function interpolateLogFreq(sourceFreqs, sourceValues, targetFreqs) {
  const result = new Array(targetFreqs.length);

  // Convert source frequencies to log scale for interpolation
  const logSourceFreqs = sourceFreqs.map((f) => (f > 0 ? Math.log10(f) : -10));

  for (let i = 0; i < targetFreqs.length; i++) {
    const targetFreq = targetFreqs[i];

    // Handle DC (0 Hz) - use first value
    if (targetFreq <= 0) {
      result[i] = sourceValues[0];
      continue;
    }

    const logTarget = Math.log10(targetFreq);

    // Find surrounding source points
    let lowerIdx = 0;
    let upperIdx = logSourceFreqs.length - 1;

    for (let j = 0; j < logSourceFreqs.length - 1; j++) {
      if (logSourceFreqs[j] <= logTarget && logSourceFreqs[j + 1] >= logTarget) {
        lowerIdx = j;
        upperIdx = j + 1;
        break;
      }
    }

    // Handle extrapolation at edges
    if (logTarget < logSourceFreqs[0]) {
      result[i] = sourceValues[0];
      continue;
    }
    if (logTarget > logSourceFreqs[logSourceFreqs.length - 1]) {
      result[i] = sourceValues[sourceValues.length - 1];
      continue;
    }

    // Linear interpolation in log-frequency space
    const logLower = logSourceFreqs[lowerIdx];
    const logUpper = logSourceFreqs[upperIdx];
    const t = (logTarget - logLower) / (logUpper - logLower);

    result[i] = lerp(sourceValues[lowerIdx], sourceValues[upperIdx], t);
  }

  return result;
}

/**
 * Interpolate between two FRD datasets based on angle
 * @param {Object} frdLower - Lower angle FRD { freqs, magDb, phaseDeg }
 * @param {Object} frdUpper - Upper angle FRD { freqs, magDb, phaseDeg }
 * @param {number} alpha - Interpolation factor (0 = lower, 1 = upper)
 * @returns {Object} Interpolated FRD
 */
export function interpolateFRD(frdLower, frdUpper, alpha) {
  // Assume both FRDs have same frequency points
  const freqs = frdLower.freqs;
  const magDb = new Array(freqs.length);
  const phaseDeg = new Array(freqs.length);

  for (let i = 0; i < freqs.length; i++) {
    magDb[i] = lerp(frdLower.magDb[i], frdUpper.magDb[i], alpha);
    phaseDeg[i] = lerp(frdLower.phaseDeg[i], frdUpper.phaseDeg[i], alpha);
  }

  return { freqs, magDb, phaseDeg };
}

/**
 * Find the two nearest angles in a sorted array and compute interpolation weight
 * @param {number[]} angles - Sorted array of available angles
 * @param {number} targetAngle - Target angle to interpolate to
 * @returns {{ lowerAngle: number, upperAngle: number, alpha: number }}
 */
export function findBracketAngles(angles, targetAngle) {
  if (angles.length === 0) {
    return { lowerAngle: 0, upperAngle: 0, alpha: 0 };
  }

  if (angles.length === 1) {
    return { lowerAngle: angles[0], upperAngle: angles[0], alpha: 0 };
  }

  // Clamp target to available range
  const minAngle = angles[0];
  const maxAngle = angles[angles.length - 1];

  if (targetAngle <= minAngle) {
    return { lowerAngle: minAngle, upperAngle: minAngle, alpha: 0 };
  }

  if (targetAngle >= maxAngle) {
    return { lowerAngle: maxAngle, upperAngle: maxAngle, alpha: 0 };
  }

  // Find bracketing angles
  for (let i = 0; i < angles.length - 1; i++) {
    if (angles[i] <= targetAngle && angles[i + 1] >= targetAngle) {
      const lowerAngle = angles[i];
      const upperAngle = angles[i + 1];
      const alpha = (targetAngle - lowerAngle) / (upperAngle - lowerAngle);
      return { lowerAngle, upperAngle, alpha };
    }
  }

  // Fallback
  return { lowerAngle: maxAngle, upperAngle: maxAngle, alpha: 0 };
}

/**
 * Calculate SPL at a given distance using inverse square law
 * @param {number} sensitivityDb1m - Sensitivity in dB SPL at 1 meter
 * @param {number} distanceM - Distance in meters
 * @returns {number} SPL in dB
 */
export function splAtDistance(sensitivityDb1m, distanceM) {
  if (distanceM <= 0) return sensitivityDb1m;
  return sensitivityDb1m - 20 * Math.log10(distanceM);
}

/**
 * Convert linear amplitude to decibels
 */
export function ampToDb(amplitude) {
  return 20 * Math.log10(Math.max(amplitude, 1e-10));
}

/**
 * Convert decibels to linear amplitude
 */
export function dbToAmp(db) {
  return Math.pow(10, db / 20);
}

/**
 * Normalize an array to have peak absolute value of 1
 */
export function normalizeArray(arr) {
  const peak = Math.max(...arr.map(Math.abs));
  if (peak === 0) return arr;
  return arr.map((v) => v / peak);
}

/**
 * Bessel function of the first kind, order 1 (J1)
 * Uses polynomial approximation for |x| <= 8, asymptotic expansion for |x| > 8
 * Based on Abramowitz and Stegun approximations
 * @param {number} x - Input value
 * @returns {number} J1(x)
 */
export function besselJ1(x) {
  const ax = Math.abs(x);

  if (ax < 8.0) {
    // Polynomial approximation for small x
    const y = x * x;
    const ans1 =
      x *
      (72362614232.0 +
        y *
          (-7895059235.0 +
            y *
              (242396853.1 +
                y * (-2972611.439 + y * (15704.48260 + y * -30.16036606)))));
    const ans2 =
      144725228442.0 +
      y *
        (2300535178.0 +
          y *
            (18583304.74 +
              y * (99447.43394 + y * (376.9991397 + y * 1.0))));
    return ans1 / ans2;
  } else {
    // Asymptotic expansion for large x
    const z = 8.0 / ax;
    const y = z * z;
    const xx = ax - 2.356194491; // ax - 3*PI/4

    const ans1 =
      1.0 +
      y *
        (0.183105e-2 +
          y * (-0.3516396496e-4 + y * (0.2457520174e-5 + y * -0.240337019e-6)));
    const ans2 =
      0.04687499995 +
      y *
        (-0.2002690873e-3 +
          y *
            (0.8449199096e-5 +
              y * (-0.88228987e-6 + y * 0.105787412e-6)));

    const ans =
      Math.sqrt(0.636619772 / ax) *
      (Math.cos(xx) * ans1 - z * Math.sin(xx) * ans2);

    return x < 0 ? -ans : ans;
  }
}

/**
 * Calculate piston directivity factor using ka beaming approximation
 * Models how a circular piston driver beams sound at high frequencies
 *
 * D(theta) = 2 * J1(ka * sin(theta)) / (ka * sin(theta))
 *
 * @param {number} freq - Frequency in Hz
 * @param {number} driverDiameterM - Driver diameter in meters
 * @param {number} angleDeg - Off-axis angle in degrees
 * @param {number} [speedOfSound=343] - Speed of sound in m/s
 * @returns {number} Directivity factor (0 to 1, where 1 is on-axis)
 */
export function kaBeaming(freq, driverDiameterM, angleDeg, speedOfSound = 343) {
  // Handle on-axis case
  if (angleDeg === 0 || Math.abs(angleDeg) < 0.001) {
    return 1.0;
  }

  const radius = driverDiameterM / 2;
  const k = (2 * Math.PI * freq) / speedOfSound; // Wave number
  const ka = k * radius;

  const angleRad = degToRad(angleDeg);
  const x = ka * Math.sin(angleRad);

  // Handle small x (approaches 1 as x -> 0)
  if (Math.abs(x) < 0.001) {
    return 1.0;
  }

  // Piston directivity formula: D = 2 * J1(x) / x
  const directivity = Math.abs((2 * besselJ1(x)) / x);

  // Clamp to valid range
  return clamp(directivity, 0, 1);
}

/**
 * Calculate horn directivity pattern
 * Models a horn with specified coverage angle
 *
 * @param {number} angleDeg - Off-axis angle in degrees
 * @param {number} coverageAngleDeg - Horn -6dB coverage angle in degrees
 * @param {number} [transitionWidth=15] - Transition width at coverage edge in degrees
 * @returns {number} Directivity factor (0 to 1)
 */
export function hornDirectivity(angleDeg, coverageAngleDeg, transitionWidth = 15) {
  const absAngle = Math.abs(angleDeg);
  const halfCoverage = coverageAngleDeg / 2;

  if (absAngle <= halfCoverage) {
    // Inside coverage zone - flat response with mild rolloff
    const normalizedAngle = absAngle / halfCoverage;
    return 1.0 - normalizedAngle * normalizedAngle * 0.1; // Mild 1dB rolloff at edge
  } else {
    // Outside coverage - steep rolloff
    const beyondEdge = absAngle - halfCoverage;
    const rolloff = (beyondEdge / transitionWidth) * (beyondEdge / transitionWidth);
    return Math.max(0.1, 1.0 - rolloff); // Floor at -20dB
  }
}
