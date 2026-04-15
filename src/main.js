/**
 * main.js - Application bootstrap
 * Initializes scene, audio, state, and render loop
 */

import { appState } from './state/AppState.js';
import { SceneManager } from './scene/SceneManager.js';
import { HUD } from './ui/HUD.js';
import { AudioEngine } from './audio/AudioEngine.js';
import { UIManager } from './ui/UIManager.js';
import { DropZone } from './ui/DropZone.js';
import { FRChart } from './ui/FRChart.js';
import { setupPanelSplitter } from './ui/PanelSplitter.js';
import { configurationManager } from './config/ConfigurationManager.js';

class AcousticSim {
  constructor() {
    this.sceneManager = null;
    this.audioEngine = null;
    this.hud = null;
    this.uiManager = null;
    this.dropZone = null;
    this.frChart = null;
  }

  async init() {
    console.log('AcousticSim initializing...');

    // Get canvas element
    const canvas = document.getElementById('scene-canvas');
    if (!canvas) {
      console.error('Canvas element not found');
      return;
    }

    // Initialize scene
    this.sceneManager = new SceneManager(canvas);
    setupPanelSplitter(this.sceneManager);

    // Initialize HUD
    this.hud = new HUD();

    // Initialize audio engine
    this.audioEngine = new AudioEngine();
    await this.audioEngine.init();

    // Initialize UI manager (lil-gui controls)
    this.uiManager = new UIManager(this.audioEngine);

    // Initialize drop zone for FRD files
    this.dropZone = new DropZone(this.audioEngine);

    // Initialize frequency response chart
    this.frChart = new FRChart();

    // Setup frame update callback
    this.sceneManager.onUpdate(() => this._onFrame());

    // Start render loop
    this.sceneManager.start();

    // Setup keyboard shortcuts
    this._setupKeyboardShortcuts();

    // Trigger initial state update
    appState._updateComputedValues();
    this.hud.refresh();

    console.log('AcousticSim ready!');
  }

  _setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Ignore when typing in an input field
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
      }

      switch (e.code) {
        case 'Space':
          // Play/Pause toggle
          e.preventDefault();
          this.audioEngine.toggle();
          break;

        case 'Digit1':
        case 'Numpad1':
          // Switch to configuration 1 (5lb)
          if (appState.lvtDemoMode) {
            configurationManager.switchToSlot(1);
          }
          break;

        case 'Digit2':
        case 'Numpad2':
          // Switch to configuration 2 (7lb)
          if (appState.lvtDemoMode) {
            configurationManager.switchToSlot(2);
          }
          break;

        case 'Digit3':
        case 'Numpad3':
          // Switch to configuration 3 (10lb)
          if (appState.lvtDemoMode) {
            configurationManager.switchToSlot(3);
          }
          break;
      }
    });
  }

  _onFrame() {
    // Sync Three.js positions to audio engine
    const listenerPos = this.sceneManager.getListenerPosition();
    const speakerObj = this.sceneManager.getSpeakerObject();

    // Update listener orientation in Resonance
    if (this.audioEngine && this.audioEngine.isInitialized) {
      this.audioEngine.updateListenerPosition(
        listenerPos.x,
        listenerPos.y,
        listenerPos.z
      );

      // Get listener forward/up from the listener mesh
      const listener = this.sceneManager.listener;
      if (listener) {
        const forward = listener.getForward();
        const up = listener.getUp();
        this.audioEngine.updateListenerOrientation(
          forward.x,
          forward.y,
          forward.z,
          up.x,
          up.y,
          up.z
        );
      }

      if (appState.arrayElementCount > 1) {
        this.audioEngine.updateArraySourcePositions(appState.elementWorldPositions);
        this.audioEngine.updateDirectivity(appState.getEffectiveElementAzimuths());
      } else {
        const speakerPos = speakerObj.position;
        this.audioEngine.updateSourcePosition(
          speakerPos.x,
          speakerPos.y,
          speakerPos.z
        );
        this.audioEngine.updateDirectivity(appState.getEffectiveAzimuth());
      }
    }

    // Update chart with current position data
    if (this.frChart) {
      this.frChart.updatePosition(appState.currentAzimuth, appState.currentDistance);
    }
  }
}

// Initialize application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const app = new AcousticSim();
  app.init().catch((err) => {
    console.error('Failed to initialize AcousticSim:', err);
  });
});
