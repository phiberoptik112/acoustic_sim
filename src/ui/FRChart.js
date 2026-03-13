/**
 * FRChart.js - Frequency response and SPL vs distance charts
 */

import { Chart, registerables } from 'chart.js';
import { polarDataStore } from '../data/PolarDataStore.js';
import { appState } from '../state/AppState.js';
import { splAtDistance } from '../utils/MathUtils.js';
import { configurationManager } from '../config/ConfigurationManager.js';

// Register Chart.js components
Chart.register(...registerables);

export class FRChart {
  constructor() {
    this.frChart = null;
    this.splChart = null;
    this.currentAzimuth = 0;
    this.currentDistance = 1;

    this._initCharts();
    this._setupTabSwitching();
    this._subscribeToState();
  }

  _initCharts() {
    // Frequency Response Chart
    const frCanvas = document.getElementById('fr-chart');
    if (frCanvas) {
      this.frChart = new Chart(frCanvas, {
        type: 'line',
        data: {
          datasets: [],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: {
            duration: 0,
          },
          scales: {
            x: {
              type: 'logarithmic',
              min: 20,
              max: 20000,
              title: {
                display: true,
                text: 'Frequency (Hz)',
                color: '#a0a0a0',
              },
              ticks: {
                color: '#a0a0a0',
                callback: (value) => {
                  if ([20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].includes(value)) {
                    return value >= 1000 ? `${value / 1000}k` : value;
                  }
                  return '';
                },
              },
              grid: {
                color: '#2a2a4a',
              },
            },
            y: {
              min: 40,
              max: 110,
              title: {
                display: true,
                text: 'SPL (dB)',
                color: '#a0a0a0',
              },
              ticks: {
                color: '#a0a0a0',
              },
              grid: {
                color: '#2a2a4a',
              },
            },
          },
          plugins: {
            legend: {
              display: true,
              position: 'top',
              labels: {
                color: '#eaeaea',
                usePointStyle: true,
                pointStyle: 'line',
              },
            },
            tooltip: {
              mode: 'index',
              intersect: false,
            },
          },
          interaction: {
            mode: 'nearest',
            axis: 'x',
            intersect: false,
          },
        },
      });
    }

    // SPL vs Distance Chart
    const splCanvas = document.getElementById('spl-chart');
    if (splCanvas) {
      this.splChart = new Chart(splCanvas, {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            {
              label: 'SPL vs Distance',
              data: [],
              borderColor: '#4fc3f7',
              backgroundColor: 'rgba(79, 195, 247, 0.1)',
              fill: true,
              tension: 0.4,
            },
            {
              label: 'Current Position',
              data: [],
              borderColor: '#81c784',
              backgroundColor: '#81c784',
              pointRadius: 8,
              pointStyle: 'circle',
              showLine: false,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: {
            duration: 0,
          },
          scales: {
            x: {
              type: 'linear',
              min: 0.5,
              max: 10,
              title: {
                display: true,
                text: 'Distance (m)',
                color: '#a0a0a0',
              },
              ticks: {
                color: '#a0a0a0',
              },
              grid: {
                color: '#2a2a4a',
              },
            },
            y: {
              min: 50,
              max: 100,
              title: {
                display: true,
                text: 'SPL (dB)',
                color: '#a0a0a0',
              },
              ticks: {
                color: '#a0a0a0',
              },
              grid: {
                color: '#2a2a4a',
              },
            },
          },
          plugins: {
            legend: {
              display: true,
              position: 'top',
              labels: {
                color: '#eaeaea',
                usePointStyle: true,
              },
            },
          },
        },
      });

      // Generate initial SPL curve
      this._updateSPLChart();
    }
  }

  _setupTabSwitching() {
    const tabs = document.querySelectorAll('.chart-tab');
    const frChart = document.getElementById('fr-chart');
    const splChart = document.getElementById('spl-chart');

    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        tabs.forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');

        const tabType = tab.dataset.tab;
        if (tabType === 'fr') {
          frChart?.classList.remove('hidden');
          splChart?.classList.add('hidden');
        } else {
          frChart?.classList.add('hidden');
          splChart?.classList.remove('hidden');
        }
      });
    });
  }

  _subscribeToState() {
    appState.subscribe('frdLoaded', () => {
      this._updateFRChart();
    });

    appState.subscribe('onAxisSensitivity', () => {
      this._updateSPLChart();
    });

    // Subscribe to LVT configuration changes
    appState.subscribe('lvtDemoMode', (enabled) => {
      if (enabled) {
        this._enableLVTMode();
      } else {
        this._disableLVTMode();
      }
    });

    appState.subscribe('activeConfiguration', () => {
      if (appState.lvtDemoMode) {
        this._updateSPLChart();
      }
    });
  }

  /**
   * Enable LVT mode - expand distance range and show multi-config curves
   */
  _enableLVTMode() {
    if (this.splChart) {
      // Expand distance range to 50m
      this.splChart.options.scales.x.max = 50;
      this.splChart.options.scales.y.min = 40;
      this.splChart.options.scales.y.max = 130;
      this.splChart.update();
    }
    this._updateSPLChart();
  }

  /**
   * Disable LVT mode - restore normal distance range
   */
  _disableLVTMode() {
    if (this.splChart) {
      // Restore normal range
      this.splChart.options.scales.x.max = 10;
      this.splChart.options.scales.y.min = 50;
      this.splChart.options.scales.y.max = 100;
      this.splChart.update();
    }
    this._updateSPLChart();
  }

  /**
   * Update charts based on current listener position
   */
  updatePosition(azimuth, distance) {
    this.currentAzimuth = azimuth;
    this.currentDistance = distance;

    this._updateFRChart();
    this._updateSPLChart();
  }

  _updateFRChart() {
    if (!this.frChart || !polarDataStore.hasData) return;

    const datasets = [];

    // Get on-axis response (0°)
    const onAxisFRD = polarDataStore.getFRD(0);
    if (onAxisFRD) {
      datasets.push({
        label: '0° (On-axis)',
        data: this._frdToChartData(onAxisFRD),
        borderColor: 'rgba(79, 195, 247, 0.5)',
        borderWidth: 1,
        pointRadius: 0,
        tension: 0.1,
      });
    }

    // Get interpolated response at current position
    const interpolatedFRD = polarDataStore.getInterpolatedFRD(
      Math.abs(this.currentAzimuth)
    );
    if (interpolatedFRD) {
      datasets.push({
        label: `${Math.abs(this.currentAzimuth).toFixed(1)}° (Current)`,
        data: this._frdToChartData(interpolatedFRD),
        borderColor: '#81c784',
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.1,
      });
    }

    // Show 90° response if available
    const offAxisFRD = polarDataStore.getFRD(90);
    if (offAxisFRD) {
      datasets.push({
        label: '90° (Off-axis)',
        data: this._frdToChartData(offAxisFRD),
        borderColor: 'rgba(229, 115, 115, 0.5)',
        borderWidth: 1,
        pointRadius: 0,
        tension: 0.1,
      });
    }

    this.frChart.data.datasets = datasets;
    this.frChart.update('none');
  }

  _frdToChartData(frd) {
    if (!frd || !frd.freqs) return [];

    return frd.freqs.map((freq, i) => ({
      x: freq,
      y: frd.magDb[i],
    }));
  }

  _updateSPLChart() {
    if (!this.splChart) return;

    // Check if we're in LVT mode with multiple configurations
    if (appState.lvtDemoMode && configurationManager.getAllConfigurations().length > 0) {
      this._updateMultiConfigSPLChart();
      return;
    }

    const sensitivity = appState.onAxisSensitivity;

    // Generate SPL curve
    const distances = [];
    const spls = [];
    const maxDist = appState.lvtDemoMode ? 50 : 10;
    for (let d = 0.5; d <= maxDist; d += 0.5) {
      distances.push(d);
      spls.push(splAtDistance(sensitivity, d));
    }

    // Reset to single curve mode
    this.splChart.data.datasets = [
      {
        label: 'SPL vs Distance',
        data: distances.map((d, i) => ({ x: d, y: spls[i] })),
        borderColor: '#4fc3f7',
        backgroundColor: 'rgba(79, 195, 247, 0.1)',
        fill: true,
        tension: 0.4,
      },
      {
        label: 'Current Position',
        data: [
          {
            x: this.currentDistance,
            y: splAtDistance(sensitivity, this.currentDistance),
          },
        ],
        borderColor: '#81c784',
        backgroundColor: '#81c784',
        pointRadius: 8,
        pointStyle: 'circle',
        showLine: false,
      },
    ];

    this.splChart.update('none');
  }

  /**
   * Update SPL chart with curves for all LVT configurations
   * @private
   */
  _updateMultiConfigSPLChart() {
    const configs = configurationManager.getAllConfigurations();
    const activeConfigId = appState.activeConfigurationId;
    const maxDist = 50;

    const datasets = [];

    // Generate curve for each configuration
    configs.forEach((config) => {
      const isActive = config.id === activeConfigId;
      const distances = [];
      const spls = [];

      for (let d = 0.5; d <= maxDist; d += 0.5) {
        distances.push(d);
        spls.push(splAtDistance(config.sensitivity, d));
      }

      datasets.push({
        label: config.name,
        data: distances.map((d, i) => ({ x: d, y: spls[i] })),
        borderColor: config.color,
        backgroundColor: isActive
          ? `${config.color}33`
          : 'transparent',
        borderWidth: isActive ? 3 : 1,
        fill: isActive,
        tension: 0.4,
        pointRadius: 0,
      });
    });

    // Add current position marker
    const activeConfig = configurationManager.getActiveConfiguration();
    if (activeConfig) {
      datasets.push({
        label: 'Current Position',
        data: [
          {
            x: this.currentDistance,
            y: splAtDistance(activeConfig.sensitivity, this.currentDistance),
          },
        ],
        borderColor: '#ffffff',
        backgroundColor: activeConfig.color,
        pointRadius: 10,
        pointStyle: 'circle',
        showLine: false,
      });
    }

    this.splChart.data.datasets = datasets;
    this.splChart.update('none');
  }

  /**
   * Force refresh all charts
   */
  refresh() {
    this._updateFRChart();
    this._updateSPLChart();
  }
}
