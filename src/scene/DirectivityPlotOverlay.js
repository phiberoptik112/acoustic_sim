/**
 * DirectivityPlotOverlay.js - Floating polar directivity plot rendered on a
 * Canvas2D texture mapped to a Three.js plane in the 3D scene.
 */

import * as THREE from 'three';

const CANVAS_SIZE = 1024;
const PLOT_MARGIN = 90;
const PLOT_RADIUS = (CANVAS_SIZE / 2) - PLOT_MARGIN;

const FREQ_COLORS = {
  250:   '#a855f7',
  500:   '#6366f1',
  1000:  '#22d3ee',
  2000:  '#22c55e',
  4000:  '#eab308',
  8000:  '#f97316',
  16000: '#ef4444',
};

function formatFreq(hz) {
  return hz >= 1000 ? `${hz / 1000}k` : `${hz}`;
}

/**
 * Find the index in a sorted frequency array closest to the target.
 */
function findNearestFreqIndex(freqs, targetHz) {
  let best = 0;
  let bestDiff = Math.abs(freqs[0] - targetHz);
  for (let i = 1; i < freqs.length; i++) {
    const diff = Math.abs(freqs[i] - targetHz);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
    if (freqs[i] > targetHz) break;
  }
  return best;
}

/**
 * Extract SPL values at a target frequency for every loaded azimuth angle.
 * @returns {{ angle: number, magDb: number }[]}
 */
function extractPolarAtFrequency(polarDataStore, targetFreqHz) {
  const angles = polarDataStore.getLoadedAngles();
  const points = [];
  for (const angle of angles) {
    const frd = polarDataStore.getFRD(angle);
    if (!frd) continue;
    const idx = findNearestFreqIndex(frd.freqs, targetFreqHz);
    points.push({ angle, magDb: frd.magDb[idx] });
  }
  return points;
}

export class DirectivityPlotOverlay {
  constructor() {
    this._canvas = document.createElement('canvas');
    this._canvas.width = CANVAS_SIZE;
    this._canvas.height = CANVAS_SIZE;
    this._ctx = this._canvas.getContext('2d');

    this._texture = new THREE.CanvasTexture(this._canvas);
    this._texture.minFilter = THREE.LinearFilter;
    this._texture.magFilter = THREE.LinearFilter;

    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.MeshBasicMaterial({
      map: this._texture,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = 0.04;
    this.mesh.visible = false;

    this._dbRange = 30;
  }

  /**
   * Resize the plane to match the polar fan radius and reposition.
   */
  setScale(fanRadius) {
    const size = fanRadius * 2.1;
    this.mesh.scale.set(size, size, 1);
  }

  /**
   * Redraw the canvas with polar curves for the given frequencies.
   */
  update(polarDataStore, selectedFrequencies) {
    if (!polarDataStore || !polarDataStore.hasFRDData || selectedFrequencies.length === 0) {
      this.mesh.visible = false;
      return;
    }

    const ctx = this._ctx;
    const cx = CANVAS_SIZE / 2;
    const cy = CANVAS_SIZE / 2;

    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    // Semi-transparent background circle
    ctx.beginPath();
    ctx.arc(cx, cy, PLOT_RADIUS + 30, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(15, 15, 26, 0.75)';
    ctx.fill();

    this._drawGrid(ctx, cx, cy);
    this._drawAngleLines(ctx, cx, cy);

    // Determine global dB max across all frequencies for normalisation
    let globalMax = -Infinity;
    const curveData = [];
    for (const freq of selectedFrequencies) {
      const points = extractPolarAtFrequency(polarDataStore, freq);
      if (points.length === 0) continue;
      const maxMag = Math.max(...points.map(p => p.magDb));
      if (maxMag > globalMax) globalMax = maxMag;
      curveData.push({ freq, points });
    }

    if (curveData.length === 0) {
      this.mesh.visible = false;
      return;
    }

    for (const { freq, points } of curveData) {
      this._drawPolarCurve(ctx, cx, cy, points, globalMax, freq);
    }

    this._drawLegend(ctx, curveData.map(c => c.freq));

    this._texture.needsUpdate = true;
    this.mesh.visible = true;
  }

  _drawGrid(ctx, cx, cy) {
    const ringCount = 3;
    ctx.strokeStyle = 'rgba(79, 195, 247, 0.15)';
    ctx.lineWidth = 1;

    ctx.font = '22px sans-serif';
    ctx.fillStyle = 'rgba(79, 195, 247, 0.5)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let i = 1; i <= ringCount; i++) {
      const r = (i / ringCount) * PLOT_RADIUS;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();

      const dbLabel = `-${this._dbRange - (i / ringCount) * this._dbRange}`;
      const label = i === ringCount ? '0 dB' : `${dbLabel} dB`;
      ctx.fillText(label, cx + r + 6, cy + 14);
    }
  }

  _drawAngleLines(ctx, cx, cy) {
    const angles = [0, 30, 60, 90];
    ctx.strokeStyle = 'rgba(79, 195, 247, 0.12)';
    ctx.lineWidth = 1;
    ctx.font = '22px sans-serif';
    ctx.fillStyle = 'rgba(79, 195, 247, 0.45)';

    for (const deg of angles) {
      const rad = (deg * Math.PI) / 180;
      // 0° = forward = canvas-down (+Y canvas) so that after CanvasTexture flipY
      // and the -PI/2 X-rotation the lobe maps to scene +Z (speaker forward).
      const dx = Math.sin(rad) * PLOT_RADIUS;
      const dy = Math.cos(rad) * PLOT_RADIUS;

      // Positive side
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + dx, cy + dy);
      ctx.stroke();

      // Mirror (negative side)
      if (deg > 0) {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx - dx, cy + dy);
        ctx.stroke();
      }

      // Labels
      const labelR = PLOT_RADIUS + 20;
      const lx = Math.sin(rad) * labelR;
      const ly = Math.cos(rad) * labelR;
      ctx.textAlign = deg === 0 ? 'center' : 'left';
      ctx.fillText(`${deg}\u00B0`, cx + lx + (deg === 0 ? 0 : 4), cy + ly);
      if (deg > 0) {
        ctx.textAlign = 'right';
        ctx.fillText(`-${deg}\u00B0`, cx - lx - 4, cy + ly);
      }
    }
  }

  /**
   * Draw a single frequency's polar curve, mirrored for symmetry.
   */
  _drawPolarCurve(ctx, cx, cy, points, globalMax, freq) {
    const color = FREQ_COLORS[freq] || '#ffffff';
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';

    // Build full curve: mirror positive angles to create negative side.
    // points are sorted by angle ascending (0, 15, 30, ..., 90).
    const fullPoints = [];

    // Negative side (reverse order, skip 0)
    for (let i = points.length - 1; i >= 1; i--) {
      fullPoints.push({ angle: -points[i].angle, magDb: points[i].magDb });
    }
    // Positive side
    for (const p of points) {
      fullPoints.push(p);
    }

    ctx.beginPath();
    let started = false;
    for (const p of fullPoints) {
      const normDb = (p.magDb - globalMax + this._dbRange) / this._dbRange;
      const r = Math.max(0, Math.min(1, normDb)) * PLOT_RADIUS;
      const rad = (p.angle * Math.PI) / 180;
      const x = cx + Math.sin(rad) * r;
      const y = cy + Math.cos(rad) * r;
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    // Translucent fill
    ctx.fillStyle = color.replace(')', ', 0.06)').replace('rgb', 'rgba');
    if (color.startsWith('#')) {
      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.06)`;
    }
    ctx.lineTo(cx, cy);
    ctx.closePath();
    ctx.fill();
  }

  _drawLegend(ctx, frequencies) {
    const padding = 14;
    const lineHeight = 28;
    const boxW = 130;
    const boxH = padding * 2 + frequencies.length * lineHeight;
    const boxX = CANVAS_SIZE - boxW - 20;
    const boxY = CANVAS_SIZE - boxH - 20;

    ctx.fillStyle = 'rgba(15, 15, 26, 0.8)';
    ctx.strokeStyle = 'rgba(79, 195, 247, 0.25)';
    ctx.lineWidth = 1;
    this._roundedRect(ctx, boxX, boxY, boxW, boxH, 8);
    ctx.fill();
    ctx.stroke();

    ctx.font = '20px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    frequencies.forEach((freq, i) => {
      const y = boxY + padding + i * lineHeight + lineHeight / 2;
      const color = FREQ_COLORS[freq] || '#ffffff';

      ctx.fillStyle = color;
      ctx.fillRect(boxX + padding, y - 5, 16, 10);

      ctx.fillStyle = '#cccccc';
      ctx.fillText(`${formatFreq(freq)} Hz`, boxX + padding + 24, y);
    });
  }

  show() {
    this.mesh.visible = true;
  }

  hide() {
    this.mesh.visible = false;
  }

  _roundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this._texture.dispose();
  }
}
