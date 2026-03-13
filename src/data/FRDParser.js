/**
 * FRDParser.js - Parse .frd (Frequency Response Data) files
 */

/**
 * Parse FRD file content
 * @param {string} content - File content as text
 * @returns {{ freqs: number[], magDb: number[], phaseDeg: number[] }}
 */
export function parseFRD(content) {
  const lines = content.split(/\r?\n/);
  const freqs = [];
  const magDb = [];
  const phaseDeg = [];

  for (const line of lines) {
    // Skip empty lines
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip comment lines
    if (trimmed.startsWith('#') || trimmed.startsWith('*') || trimmed.startsWith(';')) {
      continue;
    }

    // Split by whitespace (tabs or spaces)
    const parts = trimmed.split(/\s+/);

    if (parts.length >= 2) {
      const freq = parseFloat(parts[0]);
      const mag = parseFloat(parts[1]);
      const phase = parts.length >= 3 ? parseFloat(parts[2]) : 0;

      // Validate parsed values
      if (!isNaN(freq) && !isNaN(mag) && freq > 0) {
        freqs.push(freq);
        magDb.push(mag);
        phaseDeg.push(isNaN(phase) ? 0 : phase);
      }
    }
  }

  return { freqs, magDb, phaseDeg };
}

/**
 * Extract angle from FRD filename
 * Supports patterns like:
 *   speaker_030deg.frd -> 30
 *   speaker_-045deg.frd -> -45
 *   30.frd -> 30
 *   speaker_30.frd -> 30
 *
 * @param {string} filename - The filename
 * @returns {number|null} - Extracted angle or null if not found
 */
export function extractAngleFromFilename(filename) {
  // Remove extension
  const name = filename.replace(/\.[^.]+$/, '');

  // Pattern 1: explicit deg suffix (e.g., speaker_030deg, speaker_-045deg)
  const degMatch = name.match(/[-]?\d+deg$/i);
  if (degMatch) {
    return parseInt(degMatch[0].replace(/deg$/i, ''), 10);
  }

  // Pattern 2: underscore + number at end (e.g., speaker_30, speaker_090)
  const underscoreMatch = name.match(/_[-]?\d+$/);
  if (underscoreMatch) {
    return parseInt(underscoreMatch[0].substring(1), 10);
  }

  // Pattern 3: just a number (e.g., 30.frd, 090.frd)
  const justNumber = name.match(/^[-]?\d+$/);
  if (justNumber) {
    return parseInt(justNumber[0], 10);
  }

  // Pattern 4: number at end after non-digit (e.g., H30, V45)
  const endNumber = name.match(/\D([-]?\d+)$/);
  if (endNumber) {
    return parseInt(endNumber[1], 10);
  }

  return null;
}

/**
 * Parse multiple FRD files
 * @param {File[]} files - Array of File objects
 * @returns {Promise<Map<number, { freqs, magDb, phaseDeg }>>} - Map of angle to FRD data
 */
export async function parseMultipleFRD(files) {
  const results = new Map();

  for (const file of files) {
    try {
      const content = await readFileAsText(file);
      const frd = parseFRD(content);

      // Extract angle from filename
      const angle = extractAngleFromFilename(file.name);

      if (angle !== null && frd.freqs.length > 0) {
        results.set(angle, frd);
        console.log(`Parsed ${file.name} -> ${angle}° (${frd.freqs.length} points)`);
      } else {
        console.warn(`Could not parse angle from filename: ${file.name}`);
      }
    } catch (err) {
      console.error(`Failed to parse ${file.name}:`, err);
    }
  }

  return results;
}

/**
 * Read file as text
 */
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsText(file);
  });
}

/**
 * Validate FRD data
 * @param {Object} frd - Parsed FRD data
 * @returns {{ valid: boolean, issues: string[] }}
 */
export function validateFRD(frd) {
  const issues = [];

  if (!frd.freqs || frd.freqs.length === 0) {
    issues.push('No frequency data');
    return { valid: false, issues };
  }

  // Check frequency range
  const minFreq = Math.min(...frd.freqs);
  const maxFreq = Math.max(...frd.freqs);

  if (minFreq > 100) {
    issues.push(`Low frequency starts at ${minFreq}Hz (expected < 100Hz)`);
  }
  if (maxFreq < 10000) {
    issues.push(`High frequency ends at ${maxFreq}Hz (expected > 10kHz)`);
  }

  // Check for sorted frequencies
  let sorted = true;
  for (let i = 1; i < frd.freqs.length; i++) {
    if (frd.freqs[i] <= frd.freqs[i - 1]) {
      sorted = false;
      break;
    }
  }
  if (!sorted) {
    issues.push('Frequencies are not monotonically increasing');
  }

  // Check magnitude range (typical speaker response is 40-120 dB SPL)
  const minMag = Math.min(...frd.magDb);
  const maxMag = Math.max(...frd.magDb);

  if (maxMag - minMag > 100) {
    issues.push(`Very large magnitude range: ${(maxMag - minMag).toFixed(1)} dB`);
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}
