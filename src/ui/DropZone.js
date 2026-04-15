/**
 * DropZone.js - Drag-and-drop FRD file upload handling
 */

import { parseMultipleFRD, parseFRD } from '../data/FRDParser.js';
import { frdToAudioBuffer } from '../audio/IRGenerator.js';
import { polarDataStore } from '../data/PolarDataStore.js';
import { appState } from '../state/AppState.js';

export class DropZone {
  constructor(audioEngine) {
    this.audioEngine = audioEngine;
    this.dropZone = document.getElementById('drop-zone');
    this.fileInput = document.getElementById('file-input');
    this.loadingOverlay = document.getElementById('loading-overlay');
    this.loadingText = document.getElementById('loading-text');
    this.loadingProgress = document.getElementById('loading-progress');
    this.canvasContainer = document.getElementById('canvas-container');

    this._setupEventListeners();
  }

  _setupEventListeners() {
    // Show drop zone when dragging over canvas
    this.canvasContainer.addEventListener('dragenter', (e) => {
      e.preventDefault();
      this._showDropZone();
    });

    // Drop zone events
    this.dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.dropZone.classList.add('drag-over');
    });

    this.dropZone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      this.dropZone.classList.remove('drag-over');
      // Only hide if leaving the drop zone entirely
      if (!this.dropZone.contains(e.relatedTarget)) {
        this._hideDropZone();
      }
    });

    this.dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      this.dropZone.classList.remove('drag-over');
      this._hideDropZone();

      const files = Array.from(e.dataTransfer.files).filter(
        (f) => f.name.endsWith('.frd') || f.name.endsWith('.txt')
      );

      if (files.length > 0) {
        this._processFiles(files);
      }
    });

    // Click to select files
    this.dropZone.addEventListener('click', () => {
      this.fileInput.click();
    });

    this.fileInput.addEventListener('change', (e) => {
      const files = Array.from(e.target.files);
      if (files.length > 0) {
        this._hideDropZone();
        this._processFiles(files);
      }
    });

    // Also allow dropping anywhere on canvas
    this.canvasContainer.addEventListener('drop', (e) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files).filter(
        (f) => f.name.endsWith('.frd') || f.name.endsWith('.txt')
      );

      if (files.length > 0) {
        this._processFiles(files);
      }
    });

    this.canvasContainer.addEventListener('dragover', (e) => {
      e.preventDefault();
    });
  }

  _showDropZone() {
    this.dropZone.classList.remove('hidden');
  }

  _hideDropZone() {
    this.dropZone.classList.add('hidden');
  }

  _showLoading() {
    this.loadingOverlay.classList.remove('hidden');
  }

  _hideLoading() {
    this.loadingOverlay.classList.add('hidden');
  }

  _updateProgress(message, current, total) {
    if (this.loadingText) {
      this.loadingText.textContent = message;
    }
    if (this.loadingProgress) {
      this.loadingProgress.textContent = `${current} / ${total}`;
    }
  }

  async _processFiles(files) {
    this._showLoading();
    this._updateProgress('Parsing FRD files...', 0, files.length);

    try {
      // Parse all FRD files
      const frdMap = await parseMultipleFRD(files);

      if (frdMap.size === 0) {
        throw new Error('No valid FRD files found');
      }

      // Clear existing data
      polarDataStore.clear();

      // Convert to AudioBuffers
      const audioContext = this.audioEngine.getAudioContext();
      const angles = Array.from(frdMap.keys()).sort((a, b) => a - b);
      let processed = 0;

      for (const angle of angles) {
        const frd = frdMap.get(angle);

        this._updateProgress(
          `Converting ${angle}° to IR...`,
          processed,
          angles.length
        );

        // Store raw FRD for visualization
        polarDataStore.setFRD(angle, frd);

        // Convert to AudioBuffer
        const audioBuffer = frdToAudioBuffer(frd, audioContext, {
          irSize: appState.irSize,
          useMinimumPhase: appState.useMinimumPhase,
        });

        // Store in cache
        polarDataStore.set(angle, 0, audioBuffer);

        processed++;

        // Yield for UI update
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      // Update state
      const loadedAngles = polarDataStore.getLoadedAngles();
      appState.setFRDLoaded(true, loadedAngles);

      // Load IRs into audio engine
      this.audioEngine.loadIRs(polarDataStore);

      appState.setCustomMeasurement({
        fileCount: angles.length,
        angles,
        source: 'drop',
      });

      console.log(
        `Loaded ${polarDataStore.size} polar angles:`,
        loadedAngles
      );

      this._hideLoading();
    } catch (err) {
      console.error('Failed to process FRD files:', err);
      this._updateProgress(`Error: ${err.message}`, 0, 0);

      // Hide loading after a delay to show error
      setTimeout(() => this._hideLoading(), 2000);
    }
  }

  /**
   * Load preset FRD data (synthetic or from public folder)
   */
  async loadPreset(presetName) {
    this._showLoading();
    this._updateProgress(`Loading ${presetName} preset...`, 0, 7);

    try {
      // Fetch sample FRD files from public folder
      const angles = [0, 15, 30, 45, 60, 75, 90];
      const frdMap = new Map();

      for (let i = 0; i < angles.length; i++) {
        const angle = angles[i];
        const paddedAngle = angle.toString().padStart(3, '0');
        const url = `/sample_frd/${presetName}_${paddedAngle}deg.frd`;

        this._updateProgress(`Fetching ${angle}°...`, i, angles.length);

        try {
          const response = await fetch(url);
          if (response.ok) {
            const content = await response.text();
            const frd = parseFRD(content);
            if (frd.freqs.length > 0) {
              frdMap.set(angle, frd);
            }
          }
        } catch (err) {
          console.warn(`Could not load ${url}:`, err);
        }
      }

      if (frdMap.size === 0) {
        throw new Error('No preset files found');
      }

      // Process same as uploaded files
      polarDataStore.clear();

      const audioContext = this.audioEngine.getAudioContext();
      let processed = 0;

      for (const [angle, frd] of frdMap) {
        polarDataStore.setFRD(angle, frd);

        const audioBuffer = frdToAudioBuffer(frd, audioContext, {
          irSize: appState.irSize,
          useMinimumPhase: appState.useMinimumPhase,
        });

        polarDataStore.set(angle, 0, audioBuffer);
        processed++;

        this._updateProgress(
          `Converting ${angle}°...`,
          processed,
          frdMap.size
        );
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      appState.setFRDLoaded(true, polarDataStore.getLoadedAngles());
      this.audioEngine.loadIRs(polarDataStore);
      appState.setCurrentPreset(presetName);

      this._hideLoading();
    } catch (err) {
      console.error('Failed to load preset:', err);
      this._updateProgress(`Error: ${err.message}`, 0, 0);
      setTimeout(() => this._hideLoading(), 2000);
    }
  }
}
