/**
 * ConfigurationManager.js - Manages multiple speaker configurations and switching
 *
 * Handles registration, storage, and switching between speaker configurations.
 * Emits events to AppState for UI synchronization.
 */

import { appState } from '../state/AppState.js';

class ConfigurationManager {
  constructor() {
    // Map of configuration ID to SpeakerConfiguration
    this.configurations = new Map();

    // Currently active configuration ID
    this.activeConfigId = null;

    // Previous configuration ID for A/B toggle
    this.previousConfigId = null;

    // Ordered list of configuration IDs (for keyboard shortcuts)
    this.configOrder = [];

    // Callback for when configuration switches (audio engine uses this)
    this._onSwitchCallback = null;
  }

  /**
   * Register a configuration
   * @param {SpeakerConfiguration} config - Configuration to register
   */
  registerConfiguration(config) {
    this.configurations.set(config.id, config);

    if (!this.configOrder.includes(config.id)) {
      this.configOrder.push(config.id);
    }

    // Update AppState with available configurations
    this._updateAppStateConfigurations();

    console.log(`ConfigurationManager: Registered configuration '${config.id}'`);
  }

  /**
   * Register multiple configurations
   * @param {SpeakerConfiguration[]} configs - Array of configurations
   */
  registerConfigurations(configs) {
    configs.forEach((config) => this.registerConfiguration(config));
  }

  /**
   * Unregister a configuration
   * @param {string} configId - Configuration ID to remove
   */
  unregisterConfiguration(configId) {
    this.configurations.delete(configId);
    this.configOrder = this.configOrder.filter((id) => id !== configId);

    if (this.activeConfigId === configId) {
      this.activeConfigId = null;
    }
    if (this.previousConfigId === configId) {
      this.previousConfigId = null;
    }

    this._updateAppStateConfigurations();
  }

  /**
   * Clear all configurations
   */
  clearConfigurations() {
    this.configurations.clear();
    this.configOrder = [];
    this.activeConfigId = null;
    this.previousConfigId = null;
    this._updateAppStateConfigurations();
  }

  /**
   * Get a configuration by ID
   * @param {string} configId - Configuration ID
   * @returns {SpeakerConfiguration|undefined}
   */
  getConfiguration(configId) {
    return this.configurations.get(configId);
  }

  /**
   * Get the currently active configuration
   * @returns {SpeakerConfiguration|null}
   */
  getActiveConfiguration() {
    if (!this.activeConfigId) return null;
    return this.configurations.get(this.activeConfigId) || null;
  }

  /**
   * Get all registered configurations
   * @returns {SpeakerConfiguration[]}
   */
  getAllConfigurations() {
    return Array.from(this.configurations.values());
  }

  /**
   * Get configuration IDs in order
   * @returns {string[]}
   */
  getConfigurationOrder() {
    return [...this.configOrder];
  }

  /**
   * Switch to a configuration by ID
   * @param {string} configId - Configuration ID to switch to
   * @returns {boolean} True if switch was initiated
   */
  switchTo(configId) {
    if (!this.configurations.has(configId)) {
      console.warn(`ConfigurationManager: Unknown configuration '${configId}'`);
      return false;
    }

    if (configId === this.activeConfigId) {
      // Already active, no switch needed
      return false;
    }

    // Store previous for A/B toggle
    if (this.activeConfigId) {
      this.previousConfigId = this.activeConfigId;
    }

    const oldConfigId = this.activeConfigId;
    this.activeConfigId = configId;

    // Update AppState
    appState.setActiveConfiguration(configId);

    // Update sensitivity for SPL calculations
    const config = this.configurations.get(configId);
    if (config) {
      appState.setOnAxisSensitivity(config.sensitivity);
    }

    // Trigger switch callback (for audio engine)
    if (this._onSwitchCallback) {
      this._onSwitchCallback(configId, oldConfigId);
    }

    console.log(`ConfigurationManager: Switched from '${oldConfigId}' to '${configId}'`);
    return true;
  }

  /**
   * Switch to configuration by slot number (1-indexed for keyboard)
   * @param {number} slot - Slot number (1, 2, 3, ...)
   * @returns {boolean} True if switch was initiated
   */
  switchToSlot(slot) {
    const index = slot - 1;
    if (index < 0 || index >= this.configOrder.length) {
      console.warn(`ConfigurationManager: No configuration in slot ${slot}`);
      return false;
    }

    return this.switchTo(this.configOrder[index]);
  }

  /**
   * Toggle between current and previous configuration (A/B comparison)
   * @returns {boolean} True if toggle was performed
   */
  toggleAB() {
    if (!this.previousConfigId || !this.activeConfigId) {
      console.warn('ConfigurationManager: No previous configuration for A/B toggle');
      return false;
    }

    // Swap active and previous
    const temp = this.activeConfigId;
    return this.switchTo(this.previousConfigId);
  }

  /**
   * Set callback for configuration switches
   * @param {function} callback - Called with (newConfigId, oldConfigId)
   */
  onSwitch(callback) {
    this._onSwitchCallback = callback;
  }

  /**
   * Check if a configuration is active
   * @param {string} configId - Configuration ID
   * @returns {boolean}
   */
  isActive(configId) {
    return this.activeConfigId === configId;
  }

  /**
   * Get slot number for a configuration (1-indexed)
   * @param {string} configId - Configuration ID
   * @returns {number|null} Slot number or null if not found
   */
  getSlotNumber(configId) {
    const index = this.configOrder.indexOf(configId);
    return index >= 0 ? index + 1 : null;
  }

  /**
   * Update AppState with current configurations
   * @private
   */
  _updateAppStateConfigurations() {
    const configInfos = this.configOrder.map((id) => {
      const config = this.configurations.get(id);
      return config ? config.getDisplayInfo() : null;
    }).filter(Boolean);

    appState.setConfigurations(configInfos);
  }

  /**
   * Get display info for all configurations
   * @returns {Object[]} Array of display info objects
   */
  getDisplayInfos() {
    return this.configOrder.map((id) => {
      const config = this.configurations.get(id);
      if (!config) return null;

      return {
        ...config.getDisplayInfo(),
        isActive: id === this.activeConfigId,
        slot: this.getSlotNumber(id),
      };
    }).filter(Boolean);
  }
}

// Export singleton instance
export const configurationManager = new ConfigurationManager();
export default configurationManager;
