/**
 * UIManager.js - lil-gui control panel management
 */

import GUI from 'lil-gui';
import { appState, ARRAY_MAX_ELEMENTS } from '../state/AppState.js';
import { generateSyntheticSpeaker } from '../presets/SyntheticSpeakers.js';
import { frdToAudioBuffer } from '../audio/IRGenerator.js';
import { parseMultipleFRD } from '../data/FRDParser.js';
import { polarDataStore } from '../data/PolarDataStore.js';
import { configurationManager } from '../config/ConfigurationManager.js';
import { createAllLVTConfigurations } from '../presets/LVTSpeakers.js';
import { getAllProfiles } from '../data/HeadphoneProfiles.js';

export class UIManager {
  constructor(audioEngine) {
    this.audioEngine = audioEngine;
    this.gui = null;
    this.controllers = {};

    this._init();
  }

  _init() {
    const container = document.getElementById('right-panel');
    this.gui = new GUI({ container, autoPlace: false, width: 260 });

    this._createAudioControls();
    this._createViewControls();
    this._createDirectivityControls();
    this._createArrayControls();
    this._createPresetControls();
    this._createLVTDemoControls();
    this._createHeadphoneCalibrationControls();
    this._createAdvancedControls();
  }

  _createAudioControls() {
    const audioFolder = this.gui.addFolder('Audio');

    // Play/Stop button
    const playState = { playing: false };
    this.controllers.play = audioFolder
      .add(playState, 'playing')
      .name('Play')
      .onChange((value) => {
        if (value) {
          this.audioEngine.play();
        } else {
          this.audioEngine.stop();
        }
      });

    // Stimulus type
    const stimulusOptions = {
      'Pink Noise': 'pink',
      'White Noise': 'white',
      'Log Sweep': 'sweep',
      'WAV File': 'wav',
    };
    this.controllers.stimulus = audioFolder
      .add(appState, 'stimulusType', stimulusOptions)
      .name('Stimulus')
      .onChange((value) => {
        // Validate stimulus type change - revert if invalid
        const success = this.audioEngine.stimulus?.setType(value);
        if (success === false) {
          // Revert to the actual current type on the stimulus engine.
          // NOTE: appState.stimulusType has ALREADY been mutated to `value` by
          // lil-gui before this onChange fired, so we cannot use it for reverting.
          // stimulus.currentType still holds the previous valid type since setType
          // returned false before touching currentType or stopping playback.
          const actualCurrentType = this.audioEngine.stimulus?.currentType ?? 'pink';
          appState.stimulusType = actualCurrentType;
          // Use updateDisplay() (not setValue()) to avoid re-firing onChange
          this.controllers.stimulus.updateDisplay();
          this._showStimulusWarning(value);
        } else {
          // Update app state only if successful
          appState.stimulusType = value;
        }
      });

    // Master volume
    this.controllers.volume = audioFolder
      .add(appState, 'masterVolume', -40, 6, 1)
      .name('Volume (dB)')
      .onChange((value) => {
        appState.setMasterVolume(value);
      });

    // WAV file upload button
    const wavUpload = {
      loadWAV: () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.wav,.mp3,.ogg,.flac';
        input.onchange = async (e) => {
          const file = e.target.files[0];
          if (file) {
            try {
              await this.audioEngine.loadWavFile(file);
              // Now that WAV is loaded, switch to it
              appState.stimulusType = 'wav';
              this.audioEngine.stimulus?.setType('wav');
              this.controllers.stimulus.updateDisplay();
              console.log('WAV file loaded:', file.name);

              // Show success toast
              this._showSuccessToast(`Loaded: ${file.name}`);
            } catch (err) {
              console.error('Failed to load WAV:', err);
              this._showStimulusWarning('wav');
            }
          }
        };
        input.click();
      },
    };
    audioFolder.add(wavUpload, 'loadWAV').name('Load WAV File');

    audioFolder.open();

    // Subscribe to playing state
    appState.subscribe('isPlaying', (isPlaying) => {
      playState.playing = isPlaying;
      this.controllers.play.updateDisplay();
    });
  }

  _createViewControls() {
    const viewFolder = this.gui.addFolder('View');

    // View mode toggle
    const viewOptions = {
      'Top-Down (Ortho)': 'ortho',
      'Perspective': 'perspective',
    };
    this.controllers.viewMode = viewFolder
      .add(appState, 'viewMode', viewOptions)
      .name('Camera')
      .onChange((value) => {
        appState.setViewMode(value);
      });

    // On-axis sensitivity
    this.controllers.sensitivity = viewFolder
      .add(appState, 'onAxisSensitivity', 70, 100, 0.5)
      .name('Sensitivity (dB)')
      .onChange((value) => {
        appState.setOnAxisSensitivity(value);
      });

    viewFolder.open();
  }

  _createDirectivityControls() {
    const folder = this.gui.addFolder('Directivity Plot');

    const ALL_FREQS = [250, 500, 1000, 2000, 4000, 8000, 16000];
    const defaultSet = new Set(appState.directivityFrequencies);

    this.controllers.directivityVisible = folder
      .add(appState, 'directivityOverlayVisible')
      .name('Show Overlay')
      .onChange((v) => {
        appState.setDirectivityOverlayVisible(v);
      });

    const freqState = {};
    const freqControllers = [];

    for (const f of ALL_FREQS) {
      const label = f >= 1000 ? `${f / 1000}k Hz` : `${f} Hz`;
      const key = `f${f}`;
      freqState[key] = defaultSet.has(f);

      const ctrl = folder
        .add(freqState, key)
        .name(label)
        .onChange(() => {
          const selected = ALL_FREQS.filter((freq) => freqState[`f${freq}`]);
          appState.setDirectivityFrequencies(selected);
        });
      freqControllers.push(ctrl);
    }

    appState.subscribe('directivityOverlayVisible', (v) => {
      appState.directivityOverlayVisible = v;
      this.controllers.directivityVisible.updateDisplay();
    });

    appState.subscribe('directivityFrequencies', (freqs) => {
      const s = new Set(freqs);
      for (const f of ALL_FREQS) {
        freqState[`f${f}`] = s.has(f);
      }
      freqControllers.forEach((c) => c.updateDisplay());
    });

    folder.open();
  }

  _createArrayControls() {
    const folder = this.gui.addFolder('Line array');

    this.controllers.arrayCount = folder
      .add(appState, 'arrayElementCount', 1, ARRAY_MAX_ELEMENTS, 1)
      .name('Elements')
      .onChange((v) => {
        appState.setArrayElementCount(v);
      });

    this.controllers.arraySpacing = folder
      .add(appState, 'arraySpacingMeters', 0, 2, 0.02)
      .name('Spacing (m)')
      .onChange((v) => {
        appState.setArraySpacingMeters(v);
      });

    const axisOpts = {
      'Along X (left-right)': 'x',
      'Along Z (front-back)': 'z',
    };
    this.controllers.arrayAxis = folder
      .add(appState, 'arrayLineAxis', axisOpts)
      .name('Line axis')
      .onChange((v) => {
        appState.setArrayLineAxis(v);
      });

    const note = {
      tip: 'Multi-element mode disables LVT Demo. All elements share the loaded FRD.',
    };
    folder.add(note, 'tip').name('Note').disable();

    this._arrayElementFolders = [];
    for (let i = 0; i < ARRAY_MAX_ELEMENTS; i++) {
      const idx = i;
      const ef = folder.addFolder(`Element ${i}`);
      const delayProxy = {
        get ms() {
          return (appState.arrayElements[idx]?.delaySec ?? 0) * 1000;
        },
        set ms(v) {
          appState.setArrayElementDelay(idx, v / 1000);
        },
      };
      ef.add(delayProxy, 'ms', 0, 20, 0.05).name('Delay (ms)');
      const gainProxy = {
        get gainDb() {
          return appState.arrayElements[idx]?.gainDb ?? 0;
        },
        set gainDb(v) {
          appState.setArrayElementGainDb(idx, v);
        },
      };
      ef.add(gainProxy, 'gainDb', -24, 12, 0.5).name('Gain (dB)');
      this._arrayElementFolders.push(ef);
    }

    const syncArrayFolderVisibility = () => {
      const n = appState.arrayElementCount;
      this._arrayElementFolders.forEach((f, i) => {
        f.domElement.style.display = i < n ? '' : 'none';
      });
      const multi = n > 1;
      if (this.controllers.lvtMode) {
        if (multi) {
          this.controllers.lvtMode.disable();
        } else {
          this.controllers.lvtMode.enable();
        }
      }
    };
    syncArrayFolderVisibility();
    appState.subscribe('arrayLayout', syncArrayFolderVisibility);

    folder.open();
  }

  _createPresetControls() {
    const presetFolder = this.gui.addFolder('Speaker Preset');

    this._presetState = {
      preset: 'none',
    };

    const presetOptions = {
      'None': 'none',
      'Flat Response': 'flat',
      '2-Way Bookshelf': 'bookshelf',
      'Horn (Narrow HF)': 'horn',
      'Woofer Only': 'woofer',
    };

    this.controllers.preset = presetFolder
      .add(this._presetState, 'preset', presetOptions)
      .name('Preset')
      .onChange(async (value) => {
        if (value === 'custom') return;
        if (value !== 'none') {
          await this._loadPreset(value);
        }
      });

    // Upload measurement FRDs button
    const uploadActions = {
      uploadFRD: () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = '.frd,.txt';
        input.onchange = async (e) => {
          const files = Array.from(e.target.files);
          if (files.length > 0) {
            await this._loadCustomFRDFiles(files);
          }
        };
        input.click();
      },
    };
    this.controllers.uploadFRD = presetFolder
      .add(uploadActions, 'uploadFRD')
      .name('Upload Measurement FRDs');

    // Measurement status (hidden until custom data loaded)
    this._measurementStatus = { info: '' };
    this.controllers.measurementStatus = presetFolder
      .add(this._measurementStatus, 'info')
      .name('Loaded')
      .disable();
    this.controllers.measurementStatus.domElement.style.display = 'none';

    // Help text about naming conventions
    const namingHelp = {
      info: 'Name FRD files with angle, e.g. speaker_030deg.frd or speaker_30.frd. Drag-drop onto canvas also works.',
    };
    presetFolder.add(namingHelp, 'info').name('Tip').disable();

    presetFolder.open();

    // Sync preset dropdown when custom measurement loaded (e.g. via drag-drop)
    appState.subscribe('customMeasurement', (info) => {
      if (info) {
        this._updatePresetDropdownForCustom(info);
      }
    });
  }

  _createLVTDemoControls() {
    const lvtFolder = this.gui.addFolder('LVT Demo');

    // LVT Demo mode toggle
    const lvtState = {
      enabled: false,
      config: 'lvt_5lb',
    };

    this.controllers.lvtMode = lvtFolder
      .add(lvtState, 'enabled')
      .name('Enable LVT Demo')
      .onChange(async (enabled) => {
        if (enabled) {
          if (appState.arrayElementCount > 1) {
            appState.setArrayElementCount(1);
          }
          await this._enableLVTDemo();
        } else {
          this._disableLVTDemo();
        }
      });

    // Configuration selector (disabled until LVT mode is enabled)
    const configOptions = {
      '5 lb - Compression': 'lvt_5lb',
      '7 lb - Array': 'lvt_7lb',
      '10 lb - 2-Way': 'lvt_10lb',
    };

    this.controllers.lvtConfig = lvtFolder
      .add(lvtState, 'config', configOptions)
      .name('Configuration')
      .onChange((configId) => {
        if (appState.lvtDemoMode) {
          configurationManager.switchTo(configId);
        }
      })
      .disable();

    // Keyboard shortcut hint
    const keyHint = {
      info: 'Keys: 1/2/3 switch configs, Space play/pause',
    };
    lvtFolder.add(keyHint, 'info').name('Shortcuts').disable();

    lvtFolder.open();

    // Subscribe to LVT state changes
    appState.subscribe('lvtDemoMode', (enabled) => {
      lvtState.enabled = enabled;
      this.controllers.lvtMode.updateDisplay();

      if (enabled) {
        this.controllers.lvtConfig.enable();
      } else {
        this.controllers.lvtConfig.disable();
      }
    });

    appState.subscribe('activeConfiguration', (configId) => {
      if (configId) {
        lvtState.config = configId;
        this.controllers.lvtConfig.updateDisplay();
      }
    });

    appState.subscribe('lvtExitForArray', () => {
      configurationManager.clearConfigurations();
      this.audioEngine.disableDualEngine();
      appState.setActiveConfiguration(null);
      lvtState.enabled = false;
      if (this.controllers.lvtMode) {
        this.controllers.lvtMode.updateDisplay();
      }
      if (this.controllers.lvtConfig) {
        this.controllers.lvtConfig.disable();
      }
    });
  }

  async _enableLVTDemo() {
    console.log('Enabling LVT Demo mode...');

    try {
      // Generate all LVT configurations
      const configs = createAllLVTConfigurations();
      const audioContext = this.audioEngine.getAudioContext();

      // Convert FRD to IRs for each configuration
      for (const config of configs) {
        for (const [angle, frd] of config.frdSet) {
          const audioBuffer = frdToAudioBuffer(frd, audioContext, {
            irSize: appState.irSize,
            useMinimumPhase: appState.useMinimumPhase,
          });
          config.setIR(angle, audioBuffer);
        }
        config.markLoaded();

        // Register with configuration manager
        configurationManager.registerConfiguration(config);
      }

      // Enable LVT mode
      appState.setLVTDemoMode(true);

      // Set up configuration switch handler
      configurationManager.onSwitch((newConfigId) => {
        const config = configurationManager.getConfiguration(newConfigId);
        if (config) {
          this.audioEngine.crossfadeToConfiguration(config);

          // Push the new config's FRD data into the global store so FRChart updates
          polarDataStore.clear();
          for (const [angle, frd] of config.frdSet) {
            polarDataStore.setFRD(angle, frd);
          }
          appState.setFRDLoaded(true, [...config.frdSet.keys()].sort((a, b) => a - b));
        }
      });

      // Switch to first configuration
      const firstConfigId = configs[0].id;
      configurationManager.switchTo(firstConfigId);

      // Load first config into audio engine (populates the active convolver)
      const firstConfig = configurationManager.getConfiguration(firstConfigId);
      this.audioEngine.loadConfiguration(firstConfig);

      // Auto-select voice stimulus if available
      if (this.audioEngine.stimulus && this.audioEngine.stimulus.hasVoice) {
        appState.setStimulusType('voice');
      }

      console.log('LVT Demo mode enabled with', configs.length, 'configurations');
    } catch (err) {
      console.error('Failed to enable LVT Demo:', err);
      appState.setLVTDemoMode(false);
    }
  }

  _disableLVTDemo() {
    console.log('Disabling LVT Demo mode...');

    // Clear configurations
    configurationManager.clearConfigurations();

    // Switch back to single directivity model
    this.audioEngine.disableDualEngine();

    // Clear LVT FRD data from global store so the chart resets cleanly
    polarDataStore.clear();
    appState.setFRDLoaded(false, []);

    // Disable LVT mode
    appState.setLVTDemoMode(false);

    // Reset to pink noise
    appState.setStimulusType('pink');
  }

  _createHeadphoneCalibrationControls() {
    const hpFolder = this.gui.addFolder('Headphone Calibration');

    const hpState = {
      enabled: false,
      model: 'flat',
    };

    // Build model options map from profiles catalog
    const modelOptions = {};
    for (const profile of getAllProfiles()) {
      modelOptions[profile.name] = profile.id;
    }

    // Enable toggle
    this.controllers.hpEnabled = hpFolder
      .add(hpState, 'enabled')
      .name('Enable')
      .onChange((enabled) => {
        appState.setHeadphoneCalibration(enabled);
        if (enabled) {
          this.controllers.hpModel.enable();
          this.controllers.hpUpload.enable();
        } else {
          this.controllers.hpModel.disable();
          this.controllers.hpUpload.disable();
        }
      });

    // Model selector (disabled until calibration is on)
    this.controllers.hpModel = hpFolder
      .add(hpState, 'model', modelOptions)
      .name('Headphone Model')
      .onChange((profileId) => {
        appState.setHeadphoneModel(profileId);
      })
      .disable();

    // Custom FRD upload
    const uploadActions = {
      loadCustomFRD: () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.frd,.txt';
        input.onchange = (e) => {
          const file = e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = (evt) => {
            try {
              const frdText = evt.target.result;
              this.audioEngine.loadCustomHeadphoneProfile(frdText);
              hpState.model = 'custom';
              appState.setHeadphoneModel('custom');
              appState.setHeadphoneCalibration(true);
              hpState.enabled = true;
              this.controllers.hpEnabled.updateDisplay();
              this.controllers.hpModel.enable();
              this.controllers.hpUpload.enable();
              console.log('HeadphoneEQ: custom profile loaded from', file.name);
            } catch (err) {
              console.error('Failed to load custom headphone FRD:', err);
            }
          };
          reader.readAsText(file);
        };
        input.click();
      },
    };

    this.controllers.hpUpload = hpFolder
      .add(uploadActions, 'loadCustomFRD')
      .name('Load Custom FRD')
      .disable();

    // Informational label
    const info = { note: 'Corrects for headphone coloration during remote listening. Built-in profiles are approximate — upload a measured .frd for accuracy.' };
    hpFolder.add(info, 'note').name('ⓘ Note').disable();

    hpFolder.close();

    // Sync with appState
    appState.subscribe('headphoneCalibrationEnabled', (enabled) => {
      hpState.enabled = enabled;
      this.controllers.hpEnabled.updateDisplay();
    });

    appState.subscribe('headphoneModel', (profileId) => {
      hpState.model = profileId;
      this.controllers.hpModel.updateDisplay();
    });
  }

  _createAdvancedControls() {
    const advFolder = this.gui.addFolder('Advanced');

    // Minimum phase toggle
    this.controllers.minPhase = advFolder
      .add(appState, 'useMinimumPhase')
      .name('Minimum Phase')
      .onChange((value) => {
        appState.setMinimumPhase(value);
        // Note: Changing this requires reprocessing FRDs
        console.log('Min phase changed - reprocess FRDs if needed');
      });

    // IR size
    const irSizeOptions = {
      '1024 samples': 1024,
      '2048 samples': 2048,
    };
    this.controllers.irSize = advFolder
      .add(appState, 'irSize', irSizeOptions)
      .name('IR Size')
      .onChange((value) => {
        appState.setIRSize(value);
      });

    // Distance model
    const distanceOptions = {
      'Logarithmic': 'logarithmic',
      'Linear': 'linear',
    };
    this.controllers.distance = advFolder
      .add(appState, 'distanceModel', distanceOptions)
      .name('Distance Model')
      .onChange((value) => {
        appState.setDistanceModel(value);
      });

    advFolder.close();
  }

  async _loadPreset(presetName) {
    console.log(`Loading preset: ${presetName}`);

    try {
      // Generate synthetic speaker data
      const angles = [0, 15, 30, 45, 60, 75, 90];
      const frdMap = new Map();

      for (const angle of angles) {
        const frd = generateSyntheticSpeaker(presetName, angle);
        frdMap.set(angle, frd);
      }

      // Clear existing data
      polarDataStore.clear();

      // Convert to AudioBuffers
      const audioContext = this.audioEngine.getAudioContext();

      for (const [angle, frd] of frdMap) {
        polarDataStore.setFRD(angle, frd);

        const audioBuffer = frdToAudioBuffer(frd, audioContext, {
          irSize: appState.irSize,
          useMinimumPhase: appState.useMinimumPhase,
        });

        polarDataStore.set(angle, 0, audioBuffer);
      }

      // Update state and audio engine
      appState.setFRDLoaded(true, polarDataStore.getLoadedAngles());
      this.audioEngine.loadIRs(polarDataStore);
      appState.setCurrentPreset(presetName);

      console.log(`Preset ${presetName} loaded successfully`);
    } catch (err) {
      console.error(`Failed to load preset ${presetName}:`, err);
    }
  }

  async _loadCustomFRDFiles(files) {
    try {
      const frdMap = await parseMultipleFRD(files);

      if (frdMap.size === 0) {
        this._showStimulusWarning('frd');
        return;
      }

      polarDataStore.clear();

      const audioContext = this.audioEngine.getAudioContext();
      const angles = Array.from(frdMap.keys()).sort((a, b) => a - b);

      for (const angle of angles) {
        const frd = frdMap.get(angle);
        polarDataStore.setFRD(angle, frd);

        const audioBuffer = frdToAudioBuffer(frd, audioContext, {
          irSize: appState.irSize,
          useMinimumPhase: appState.useMinimumPhase,
        });

        polarDataStore.set(angle, 0, audioBuffer);
      }

      appState.setFRDLoaded(true, polarDataStore.getLoadedAngles());
      this.audioEngine.loadIRs(polarDataStore);

      const info = {
        fileCount: frdMap.size,
        angles,
        source: 'upload',
      };
      appState.setCustomMeasurement(info);

      this._showSuccessToast(
        `Loaded ${frdMap.size} measurement${frdMap.size > 1 ? 's' : ''}: ${angles.map((a) => a + '\u00B0').join(', ')}`
      );

      console.log(`Custom measurement loaded: ${frdMap.size} files, angles: ${angles}`);
    } catch (err) {
      console.error('Failed to load custom FRD files:', err);
      this._showStimulusWarning('frd');
    }
  }

  _updatePresetDropdownForCustom(info) {
    const dropdown = this.controllers.preset;
    const domSelect = dropdown.domElement.querySelector('select');

    if (domSelect) {
      let customOption = domSelect.querySelector('option[value="custom"]');
      if (!customOption) {
        customOption = document.createElement('option');
        customOption.value = 'custom';
        domSelect.appendChild(customOption);
      }
      customOption.textContent = `Custom (${info.fileCount} angle${info.fileCount > 1 ? 's' : ''})`;
    }

    this._presetState.preset = 'custom';
    dropdown.updateDisplay();

    this._measurementStatus.info =
      `${info.fileCount} angle${info.fileCount > 1 ? 's' : ''}: ${info.angles.map((a) => a + '\u00B0').join(', ')}`;
    this.controllers.measurementStatus.updateDisplay();
    this.controllers.measurementStatus.domElement.style.display = '';
  }

  /**
   * Show a temporary success toast message
   * @param {string} message - The message to display
   * @private
   */
  _showSuccessToast(message) {
    const toast = document.createElement('div');
    toast.className = 'success-toast';
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: #51cf66;
      color: white;
      padding: 12px 24px;
      border-radius: 6px;
      font-family: sans-serif;
      font-size: 14px;
      z-index: 10000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      animation: fadeInOut 2s ease-in-out forwards;
    `;

    // Ensure animation styles exist
    if (!document.getElementById('stimulus-warning-styles')) {
      const style = document.createElement('style');
      style.id = 'stimulus-warning-styles';
      style.textContent = `
        @keyframes fadeInOut {
          0% { opacity: 0; transform: translateX(-50%) translateY(-10px); }
          15% { opacity: 1; transform: translateX(-50%) translateY(0); }
          85% { opacity: 1; transform: translateX(-50%) translateY(0); }
          100% { opacity: 0; transform: translateX(-50%) translateY(-10px); }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(toast);

    setTimeout(() => {
      toast.remove();
    }, 2000);
  }

  /**
   * Show a temporary warning message for stimulus selection
   * @param {string} type - The stimulus type that failed
   * @private
   */
  _showStimulusWarning(type) {
    const messages = {
      wav: 'Please load a WAV file first using the "Load WAV File" button',
      voice: 'Voice stimulus not available',
      frd: 'No valid FRD files found. Ensure files contain frequency/magnitude data and filenames include the angle (e.g. speaker_030deg.frd).',
    };

    const message = messages[type] || `Stimulus type "${type}" not available`;

    // Create toast notification
    const toast = document.createElement('div');
    toast.className = 'stimulus-warning-toast';
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: #ff6b6b;
      color: white;
      padding: 12px 24px;
      border-radius: 6px;
      font-family: sans-serif;
      font-size: 14px;
      z-index: 10000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      animation: fadeInOut 3s ease-in-out forwards;
    `;

    // Add animation keyframes if not already present
    if (!document.getElementById('stimulus-warning-styles')) {
      const style = document.createElement('style');
      style.id = 'stimulus-warning-styles';
      style.textContent = `
        @keyframes fadeInOut {
          0% { opacity: 0; transform: translateX(-50%) translateY(-10px); }
          15% { opacity: 1; transform: translateX(-50%) translateY(0); }
          85% { opacity: 1; transform: translateX(-50%) translateY(0); }
          100% { opacity: 0; transform: translateX(-50%) translateY(-10px); }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(toast);

    // Remove after animation
    setTimeout(() => {
      toast.remove();
    }, 3000);
  }

  /**
   * Destroy the GUI
   */
  destroy() {
    if (this.gui) {
      this.gui.destroy();
      this.gui = null;
    }
  }
}
