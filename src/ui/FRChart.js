/**
 * FRChart.js - Frequency response and SPL vs distance charts
 */

import { Chart, registerables } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { polarDataStore } from '../data/PolarDataStore.js';
import { appState } from '../state/AppState.js';
import { splAtDistance } from '../utils/MathUtils.js';
import { configurationManager } from '../config/ConfigurationManager.js';

// Register Chart.js components
Chart.register(...registerables, zoomPlugin);

/** Inner chart surface is this multiple of the visible viewport (enables native scrollbars). */
const CHART_SCROLL_SURFACE_SCALE = 2;

export class FRChart {
  constructor() {
    this.frChart = null;
    this.splChart = null;
    this.currentAzimuth = 0;
    this.currentDistance = 1;
    /** @type {HTMLDivElement | null} */
    this._chartScrollViewport = null;
    /** @type {HTMLDivElement | null} */
    this._chartScrollContent = null;
    /** @type {'fr' | 'spl'} */
    this._activeChartTab = 'fr';

    this._initCharts();
    this._setupTabSwitching();
    this._setupFitToWindowControl();
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
            // Wheel/pinch zoom; Shift+drag to pan (avoids fighting hover tooltips).
            zoom: {
              limits: {
                x: { min: 20, max: 20000, minRange: 50 },
                y: { min: 0, max: 130, minRange: 10 },
              },
              pan: {
                enabled: true,
                mode: 'xy',
                modifierKey: 'shift',
              },
              zoom: {
                wheel: { enabled: true, speed: 0.08 },
                pinch: { enabled: true },
                mode: 'xy',
              },
            },
          },
          interaction: {
            mode: 'nearest',
            axis: 'x',
            intersect: false,
          },
        },
      });
      frCanvas.addEventListener('dblclick', () => {
        this.frChart?.resetZoom();
        this._resetChartScrollPosition();
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
          layout: {
            padding: {
              left: 4,
              right: 8,
              top: 2,
              bottom: 14,
            },
          },
          scales: {
            x: {
              type: 'linear',
              min: 0.5,
              max: 10,
              grace: '4%',
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
              grace: '8%',
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

      splCanvas.addEventListener('dblclick', () => {
        if (this._activeChartTab !== 'spl') return;
        this._fitActiveChartToWindow();
      });

      // Generate initial SPL curve
      this._updateSPLChart();
    }

    this._setupChartScrollSurface();
  }

  /**
   * Oversized inner box + overflow on the viewport yields X/Y scrollbars that only pan pixels;
   * chart axis min/max are unchanged. SPL uses 1× viewport so axes stay in the visible panel.
   */
  _setupChartScrollSurface() {
    this._chartScrollViewport = document.querySelector('.chart-scroll-viewport');
    this._chartScrollContent = document.querySelector('.chart-scroll-content');
    if (!this._chartScrollViewport || !this._chartScrollContent) return;

    this._updateChartScrollSurfaceSize();
    const ro = new ResizeObserver(() => {
      this._updateChartScrollSurfaceSize();
    });
    ro.observe(this._chartScrollViewport);
  }

  _scrollSurfaceScale() {
    return this._activeChartTab === 'spl' ? 1 : CHART_SCROLL_SURFACE_SCALE;
  }

  _updateChartScrollSurfaceSize() {
    if (!this._chartScrollViewport || !this._chartScrollContent) return;
    const vp = this._chartScrollViewport;
    const scale = this._scrollSurfaceScale();
    const w = Math.max(1, Math.round(vp.clientWidth * scale));
    const h = Math.max(1, Math.round(vp.clientHeight * scale));
    this._chartScrollContent.style.width = `${w}px`;
    this._chartScrollContent.style.height = `${h}px`;
    this.frChart?.resize();
    this.splChart?.resize();
  }

  _fitActiveChartToWindow() {
    this._resetChartScrollPosition();
    if (this._activeChartTab === 'fr') {
      this.frChart?.resetZoom();
    } else {
      this._applySPLDefaultScales();
      this.splChart?.update('none');
    }
    this._updateChartScrollSurfaceSize();
  }

  _setupFitToWindowControl() {
    const btn = document.getElementById('chart-fit-window');
    if (!btn) return;
    btn.addEventListener('click', () => this._fitActiveChartToWindow());
  }

  /**
   * SPL axis bounds for current mode (normal vs LVT).
   */
  _applySPLDefaultScales() {
    if (!this.splChart) return;
    const lvt = appState.lvtDemoMode;
    const x = this.splChart.options.scales.x;
    const y = this.splChart.options.scales.y;
    x.min = 0.5;
    x.max = lvt ? 50 : 10;
    y.min = lvt ? 40 : 50;
    y.max = lvt ? 130 : 100;
  }

  _resetChartScrollPosition() {
    if (this._chartScrollViewport) {
      this._chartScrollViewport.scrollLeft = 0;
      this._chartScrollViewport.scrollTop = 0;
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
        this._activeChartTab = tabType === 'spl' ? 'spl' : 'fr';
        if (tabType === 'fr') {
          frChart?.classList.remove('hidden');
          splChart?.classList.add('hidden');
        } else {
          frChart?.classList.add('hidden');
          splChart?.classList.remove('hidden');
        }
        requestAnimationFrame(() => {
          this._updateChartScrollSurfaceSize();
        });
      });
    });
  }

  _subscribeToState() {
    appState.subscribe('frdLoaded', () => {
      this._updateFRChart();
    });

    appState.subscribe('onAxisSensitivity', () => {
      this._updateFRChart();
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
        this._updateFRChart();
        this._updateSPLChart();
      }
    });
  }

  /**
   * Enable LVT mode - expand distance range and show multi-config curves
   */
  _enableLVTMode() {
    this._applySPLDefaultScales();
    this._updateSPLChart();
  }

  /**
   * Disable LVT mode - restore normal distance range
   */
  _disableLVTMode() {
    this._applySPLDefaultScales();
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
    if (!this.frChart) return;

    const distAtten = this.currentDistance > 0
      ? 20 * Math.log10(this.currentDistance)
      : 0;

    const datasets = [];

    if (!polarDataStore.hasFRDData) {
      const flatLevel = appState.onAxisSensitivity - distAtten;
      const freqs = this._generateLogFrequencies(20, 20000, 200);
      datasets.push({
        label: `Flat (no speaker data) – ${flatLevel.toFixed(1)} dB @ ${this.currentDistance.toFixed(1)}m`,
        data: freqs.map((f) => ({ x: f, y: flatLevel })),
        borderColor: 'rgba(255, 255, 255, 0.35)',
        borderWidth: 1,
        borderDash: [6, 4],
        pointRadius: 0,
        tension: 0,
      });

      this._applyDynamicYAxis(flatLevel);
      this.frChart.data.datasets = datasets;
      this.frChart.update('none');
      return;
    }

    // Reference: on-axis (0°) at 1m
    const onAxisFRD = polarDataStore.getFRD(0);
    if (onAxisFRD) {
      datasets.push({
        label: '0° On-axis (1m ref)',
        data: this._frdToChartData(onAxisFRD),
        borderColor: 'rgba(79, 195, 247, 0.35)',
        borderWidth: 1,
        borderDash: [6, 4],
        pointRadius: 0,
        tension: 0.1,
      });
    }

    // Reference: interpolated angle at 1m
    const absAzimuth = Math.abs(this.currentAzimuth);
    const interpolatedFRD = polarDataStore.getInterpolatedFRD(absAzimuth);
    if (interpolatedFRD) {
      datasets.push({
        label: `${absAzimuth.toFixed(1)}° (1m ref)`,
        data: this._frdToChartData(interpolatedFRD),
        borderColor: 'rgba(129, 199, 132, 0.35)',
        borderWidth: 1,
        pointRadius: 0,
        tension: 0.1,
      });
    }

    // Reference: off-axis (90°) at 1m
    const offAxisFRD = polarDataStore.getFRD(90);
    if (offAxisFRD) {
      datasets.push({
        label: '90° Off-axis (1m ref)',
        data: this._frdToChartData(offAxisFRD),
        borderColor: 'rgba(229, 115, 115, 0.35)',
        borderWidth: 1,
        borderDash: [6, 4],
        pointRadius: 0,
        tension: 0.1,
      });
    }

    // Primary: experienced response at listener position (angle + distance)
    let listenerMin = 110;
    if (interpolatedFRD) {
      const listenerData = interpolatedFRD.freqs.map((freq, i) => {
        const y = interpolatedFRD.magDb[i] - distAtten;
        if (y < listenerMin) listenerMin = y;
        return { x: freq, y };
      });

      datasets.push({
        label: `At Listener (${this.currentDistance.toFixed(1)}m, ${absAzimuth.toFixed(1)}°)`,
        data: listenerData,
        borderColor: '#ffffff',
        backgroundColor: 'rgba(255, 255, 255, 0.06)',
        borderWidth: 3,
        pointRadius: 0,
        tension: 0.1,
        fill: true,
      });
    }

    this._applyDynamicYAxis(listenerMin);
    this.frChart.data.datasets = datasets;
    this.frChart.update('none');
  }

  /**
   * Adjust the FR chart Y-axis lower bound so the listener curve stays visible.
   */
  _applyDynamicYAxis(lowestDb) {
    if (!this.frChart) return;
    const y = this.frChart.options.scales.y;
    const padded = Math.floor(lowestDb / 5) * 5 - 5;
    y.min = Math.max(20, Math.min(padded, 40));
    y.max = 110;
  }

  /**
   * Generate log-spaced frequencies for fallback flat line.
   */
  _generateLogFrequencies(startHz, endHz, numPoints) {
    const freqs = [];
    const logStart = Math.log10(startHz);
    const step = (Math.log10(endHz) - logStart) / (numPoints - 1);
    for (let i = 0; i < numPoints; i++) {
      freqs.push(Math.pow(10, logStart + i * step));
    }
    return freqs;
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
