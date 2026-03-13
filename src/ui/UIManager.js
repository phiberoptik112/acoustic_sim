/**
 * UIManager.js - lil-gui control panel management
 */

import GUI from 'lil-gui';
import { appState } from '../state/AppState.js';
import { generateSyntheticSpeaker } from '../presets/SyntheticSpeakers.js';
import { frdToAudioBuffer } from '../audio/IRGenerator.js';
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
      'Log Sweep': 'sweep',
      'WAV File': 'wav',
    };
    this.controllers.stimulus = audioFolder
      .add(appState, 'stimulusType', stimulusOptions)
      .name('Stimulus')
      .onChange((value) => {
        appState.setStimulusType(value);
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
              appState.setStimulusType('wav');
              console.log('WAV file loaded:', file.name);
            } catch (err) {
              console.error('Failed to load WAV:', err);
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

  _createPresetControls() {
    const presetFolder = this.gui.addFolder('Speaker Preset');

    const presetState = {
      preset: 'none',
    };

    const presetOptions = {
      'None (Upload FRD)': 'none',
      'Flat Response': 'flat',
      '2-Way Bookshelf': 'bookshelf',
      'Horn (Narrow HF)': 'horn',
      'Woofer Only': 'woofer',
    };

    this.controllers.preset = presetFolder
      .add(presetState, 'preset', presetOptions)
      .name('Preset')
      .onChange(async (value) => {
        if (value !== 'none') {
          await this._loadPreset(value);
        }
      });

    // FRD upload hint
    const uploadHint = {
      info: 'Drag & drop FRD files onto the canvas to load custom speaker measurements',
    };
    presetFolder.add(uploadHint, 'info').name('Tip').disable();

    presetFolder.open();
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
      configurationManager.onSwitch((newConfigId, oldConfigId) => {
        const config = configurationManager.getConfiguration(newConfigId);
        if (config) {
          this.audioEngine.crossfadeToConfiguration(config);
        }
      });

      // Switch to first configuration
      const firstConfigId = configs[0].id;
      configurationManager.switchTo(firstConfigId);

      // Load first config into audio engine
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
