/**
 * Stimulus.js - Sound source generators (pink noise, log sweep, WAV)
 */

export class Stimulus {
  constructor(audioContext) {
    this.audioContext = audioContext;
    this.outputGain = audioContext.createGain();
    this.outputGain.gain.value = 1.0;

    this.currentSource = null;
    this.currentType = 'pink';
    this.isPlaying = false;

    // Pre-generated buffers
    this.pinkNoiseBuffer = null;
    this.logSweepBuffer = null;
    this.wavBuffer = null;
    this.voiceBuffer = null;

    // Voice loading state
    this.voiceLoading = false;
    this.voiceLoadError = null;

    // Generate buffers
    this._generatePinkNoise();
    this._generateLogSweep();
  }

  /**
   * Connect output to a destination node
   */
  connect(destination) {
    this.outputGain.connect(destination);
  }

  /**
   * Disconnect from all destinations
   */
  disconnect() {
    this.outputGain.disconnect();
  }

  /**
   * Set the stimulus type
   */
  setType(type) {
    const wasPlaying = this.isPlaying;
    if (wasPlaying) {
      this.stop();
    }
    this.currentType = type;
    if (wasPlaying) {
      this.start();
    }
  }

  /**
   * Start playback
   */
  start() {
    if (this.isPlaying) {
      this.stop();
    }

    let buffer = null;
    switch (this.currentType) {
      case 'pink':
        buffer = this.pinkNoiseBuffer;
        break;
      case 'sweep':
        buffer = this.logSweepBuffer;
        break;
      case 'wav':
        buffer = this.wavBuffer;
        break;
      case 'voice':
        buffer = this.voiceBuffer;
        // Fallback to pink noise if voice not loaded
        if (!buffer) {
          console.warn('Voice stimulus not loaded, falling back to pink noise');
          buffer = this.pinkNoiseBuffer;
        }
        break;
    }

    if (!buffer) {
      console.warn(`No buffer available for stimulus type: ${this.currentType}`);
      return;
    }

    this.currentSource = this.audioContext.createBufferSource();
    this.currentSource.buffer = buffer;
    this.currentSource.loop = true;
    this.currentSource.connect(this.outputGain);
    this.currentSource.start();
    this.isPlaying = true;
  }

  /**
   * Stop playback
   */
  stop() {
    if (this.currentSource) {
      try {
        this.currentSource.stop();
      } catch (e) {
        // Ignore if already stopped
      }
      this.currentSource.disconnect();
      this.currentSource = null;
    }
    this.isPlaying = false;
  }

  /**
   * Load a WAV file
   */
  async loadWavFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const arrayBuffer = e.target.result;
          this.wavBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
          console.log('WAV file loaded successfully');
          resolve(this.wavBuffer);
        } catch (err) {
          console.error('Failed to decode WAV file:', err);
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * Generate pink noise buffer (5 seconds)
   */
  _generatePinkNoise() {
    const sampleRate = this.audioContext.sampleRate;
    const duration = 5; // seconds
    const length = sampleRate * duration;
    const buffer = this.audioContext.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    // Pink noise using Voss-McCartney algorithm
    const numRows = 16;
    const rows = new Array(numRows).fill(0);
    let runningSum = 0;

    for (let i = 0; i < length; i++) {
      // Generate white noise value
      const white = Math.random() * 2 - 1;

      // Update rows based on bit pattern
      for (let j = 0; j < numRows; j++) {
        if ((i & (1 << j)) === 0) {
          runningSum -= rows[j];
          rows[j] = Math.random() * 2 - 1;
          runningSum += rows[j];
        }
      }

      // Combine with white noise for better high-frequency content
      data[i] = (runningSum / numRows + white) * 0.5;
    }

    // Normalize
    let maxAbs = 0;
    for (let i = 0; i < length; i++) {
      maxAbs = Math.max(maxAbs, Math.abs(data[i]));
    }
    if (maxAbs > 0) {
      const scale = 0.5 / maxAbs;
      for (let i = 0; i < length; i++) {
        data[i] *= scale;
      }
    }

    // Apply fade in/out to prevent clicks on loop
    const fadeLength = Math.floor(sampleRate * 0.05);
    for (let i = 0; i < fadeLength; i++) {
      const fade = i / fadeLength;
      data[i] *= fade;
      data[length - 1 - i] *= fade;
    }

    this.pinkNoiseBuffer = buffer;
  }

  /**
   * Generate logarithmic sweep buffer (20Hz - 20kHz, 10 seconds)
   */
  _generateLogSweep() {
    const sampleRate = this.audioContext.sampleRate;
    const duration = 10; // seconds
    const length = sampleRate * duration;
    const buffer = this.audioContext.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    const f1 = 20; // Start frequency
    const f2 = 20000; // End frequency
    const T = duration;

    // Log sweep formula: f(t) = f1 * (f2/f1)^(t/T)
    // Phase: phi(t) = 2*pi*f1*T/ln(f2/f1) * ((f2/f1)^(t/T) - 1)
    const k = Math.log(f2 / f1);
    const L = (2 * Math.PI * f1 * T) / k;

    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const phase = L * (Math.pow(f2 / f1, t / T) - 1);
      data[i] = Math.sin(phase) * 0.5;
    }

    // Apply fade in/out
    const fadeLength = Math.floor(sampleRate * 0.1);
    for (let i = 0; i < fadeLength; i++) {
      const fade = i / fadeLength;
      data[i] *= fade;
      data[length - 1 - i] *= fade;
    }

    this.logSweepBuffer = buffer;
  }

  /**
   * Load voice stimulus from a URL (built-in asset)
   * @param {string} url - URL to the voice WAV file
   * @returns {Promise<AudioBuffer>}
   */
  async loadVoiceFromURL(url) {
    if (this.voiceLoading) {
      console.log('Voice already loading...');
      return this.voiceBuffer;
    }

    this.voiceLoading = true;
    this.voiceLoadError = null;

    try {
      console.log('Loading voice stimulus from:', url);
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to fetch voice: ${response.status} ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      this.voiceBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

      // Apply loop crossfade to prevent clicks
      this._applyLoopCrossfade(this.voiceBuffer, 0.05);

      console.log('Voice stimulus loaded successfully');
      this.voiceLoading = false;
      return this.voiceBuffer;
    } catch (err) {
      console.warn('Failed to load voice stimulus:', err.message);
      this.voiceLoadError = err;
      this.voiceLoading = false;
      return null;
    }
  }

  /**
   * Apply crossfade at loop boundary to prevent clicks
   * @param {AudioBuffer} buffer - Audio buffer to process
   * @param {number} fadeDurationSec - Fade duration in seconds
   * @private
   */
  _applyLoopCrossfade(buffer, fadeDurationSec) {
    const sampleRate = buffer.sampleRate;
    const fadeLength = Math.floor(sampleRate * fadeDurationSec);

    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const data = buffer.getChannelData(channel);
      const length = data.length;

      // Crossfade end into beginning for seamless loop
      for (let i = 0; i < fadeLength; i++) {
        const t = i / fadeLength;
        // Equal-power crossfade
        const fadeOut = Math.cos(t * Math.PI / 2);
        const fadeIn = Math.sin(t * Math.PI / 2);

        const endIdx = length - fadeLength + i;

        // Blend end sample with beginning sample
        const startSample = data[i];
        const endSample = data[endIdx];

        data[endIdx] = endSample * fadeOut + startSample * fadeIn;
      }
    }
  }

  /**
   * Get available stimulus types
   */
  getAvailableTypes() {
    const types = ['pink', 'sweep'];
    if (this.wavBuffer) {
      types.push('wav');
    }
    if (this.voiceBuffer) {
      types.push('voice');
    }
    return types;
  }

  /**
   * Check if WAV is loaded
   */
  hasWavLoaded() {
    return this.wavBuffer !== null;
  }

  /**
   * Check if voice is loaded
   */
  get hasVoice() {
    return this.voiceBuffer !== null;
  }

  /**
   * Check if voice is currently loading
   */
  get isVoiceLoading() {
    return this.voiceLoading;
  }
}
