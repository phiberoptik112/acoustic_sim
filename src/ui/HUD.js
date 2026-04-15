/**
 * HUD.js - Heads-up display overlay showing azimuth, distance, SPL
 */

import { appState } from '../state/AppState.js';

export class HUD {
  constructor() {
    this.azimuthEl = document.getElementById('hud-azimuth');
    this.distanceEl = document.getElementById('hud-distance');
    this.splEl = document.getElementById('hud-spl');
    this.warningEl = document.getElementById('hud-warning');
    this.noteEl = this.azimuthEl?.parentElement?.querySelector('.hud-note');

    // LVT configuration display elements
    this.configRowEl = document.getElementById('hud-config');
    this.configNameEl = document.getElementById('hud-config-name');
    this.configSensitivityEl = document.getElementById('hud-config-sensitivity');
    this.configIndicatorEl = document.getElementById('hud-config-indicator');

    this._subscribe();
    this._createConfigElements();
  }

  _createConfigElements() {
    // Create configuration display elements if they don't exist
    const hudContainer = document.getElementById('hud-container');
    if (!hudContainer || this.configRowEl) return;

    // Create config row
    const configRow = document.createElement('div');
    configRow.id = 'hud-config';
    configRow.className = 'hud-row hud-config-row hidden';

    configRow.innerHTML = `
      <span id="hud-config-indicator" class="hud-config-dot"></span>
      <span id="hud-config-name" class="hud-value">Config</span>
      <span id="hud-config-sensitivity" class="hud-note">(85 dB)</span>
    `;

    // Insert at the top of the HUD
    hudContainer.insertBefore(configRow, hudContainer.firstChild);

    // Update element references
    this.configRowEl = document.getElementById('hud-config');
    this.configNameEl = document.getElementById('hud-config-name');
    this.configSensitivityEl = document.getElementById('hud-config-sensitivity');
    this.configIndicatorEl = document.getElementById('hud-config-indicator');
  }

  _subscribe() {
    appState.subscribe('computed', (data) => {
      this._updateDisplay(data);
    });

    // Subscribe to LVT configuration changes
    appState.subscribe('activeConfiguration', (configId) => {
      this._updateConfigDisplay(configId);
    });

    appState.subscribe('lvtDemoMode', (enabled) => {
      this._setConfigRowVisible(enabled);
    });

    appState.subscribe('arrayLayout', () => this.refresh());
  }

  _updateConfigDisplay(configId) {
    if (!configId) {
      this._setConfigRowVisible(false);
      return;
    }

    const configInfo = appState.getActiveConfigurationInfo();
    if (!configInfo) return;

    // Update config name
    if (this.configNameEl) {
      this.configNameEl.textContent = configInfo.name;
    }

    // Update sensitivity
    if (this.configSensitivityEl) {
      this.configSensitivityEl.textContent = `(${configInfo.sensitivity} dB)`;
    }

    // Update color indicator
    if (this.configIndicatorEl) {
      this.configIndicatorEl.style.backgroundColor = configInfo.color;
    }

    this._setConfigRowVisible(true);
  }

  _setConfigRowVisible(visible) {
    if (this.configRowEl) {
      if (visible) {
        this.configRowEl.classList.remove('hidden');
      } else {
        this.configRowEl.classList.add('hidden');
      }
    }
  }

  _updateDisplay({ azimuth, distance, spl, isRearHemisphere }) {
    // Update azimuth
    if (this.azimuthEl) {
      this.azimuthEl.textContent = `${Math.abs(azimuth).toFixed(1)}°`;
    }

    // Update azimuth note
    if (this.noteEl) {
      if (Math.abs(azimuth) < 5) {
        this.noteEl.textContent = '(on-axis)';
      } else if (Math.abs(azimuth) < 30) {
        this.noteEl.textContent = '(off-axis)';
      } else if (Math.abs(azimuth) < 60) {
        this.noteEl.textContent = '(wide off-axis)';
      } else {
        this.noteEl.textContent = '(extreme off-axis)';
      }
    }

    const arrayHint = appState.arrayElementCount > 1;

    // Update distance
    if (this.distanceEl) {
      this.distanceEl.textContent = arrayHint
        ? `${distance.toFixed(2)} m · array center`
        : `${distance.toFixed(2)} m`;
    }

    // Update SPL estimate
    if (this.splEl) {
      this.splEl.textContent = arrayHint
        ? `${spl.toFixed(1)} dB · approx`
        : `${spl.toFixed(1)} dB`;
    }

    // Update rear hemisphere warning
    if (this.warningEl) {
      if (isRearHemisphere) {
        this.warningEl.classList.remove('hidden');
      } else {
        this.warningEl.classList.add('hidden');
      }
    }
  }

  /**
   * Force update display with current state values
   */
  refresh() {
    this._updateDisplay({
      azimuth: appState.currentAzimuth,
      distance: appState.currentDistance,
      spl: appState.currentSPL,
      isRearHemisphere: appState.isRearHemisphere,
    });
  }
}
