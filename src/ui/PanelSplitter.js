/**
 * Draggable horizontal splitter between the 3D canvas and bottom chart panel.
 * Updates #app --bottom-panel-height; does not persist across reloads.
 */

const MIN_BOTTOM_PX = 120;
const MIN_SCENE_PX = 160;
const SPLITTER_TRACK_PX = 6;

function parseBottomHeightPx(app) {
  const raw = getComputedStyle(app).getPropertyValue('--bottom-panel-height').trim();
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 200;
}

function maxBottomHeightPx() {
  return Math.max(
    MIN_BOTTOM_PX,
    window.innerHeight - MIN_SCENE_PX - SPLITTER_TRACK_PX - 8
  );
}

/**
 * @param {{ resize?: () => void } | null} sceneManager
 */
export function setupPanelSplitter(sceneManager) {
  const app = document.getElementById('app');
  const splitter = document.getElementById('main-splitter');
  if (!app || !splitter) return;

  const applyHeight = (px) => {
    const clamped = Math.round(Math.max(MIN_BOTTOM_PX, Math.min(maxBottomHeightPx(), px)));
    app.style.setProperty('--bottom-panel-height', `${clamped}px`);
    sceneManager?.resize?.();
  };

  let dragging = false;
  let startY = 0;
  let startHeight = 0;
  /** @type {number | null} */
  let activePointerId = null;

  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    if (activePointerId != null) {
      try {
        splitter.releasePointerCapture(activePointerId);
      } catch {
        // already released
      }
      activePointerId = null;
    }
    document.body.classList.remove('panel-splitter-dragging');
  };

  splitter.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    dragging = true;
    startY = e.clientY;
    startHeight = parseBottomHeightPx(app);
    activePointerId = e.pointerId;
    splitter.setPointerCapture(e.pointerId);
    document.body.classList.add('panel-splitter-dragging');
  });

  splitter.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    e.preventDefault();
    const delta = startY - e.clientY;
    applyHeight(startHeight + delta);
  });

  splitter.addEventListener('pointerup', endDrag);
  splitter.addEventListener('pointercancel', endDrag);

  window.addEventListener('resize', () => {
    const h = parseBottomHeightPx(app);
    const max = maxBottomHeightPx();
    if (h > max) {
      app.style.setProperty('--bottom-panel-height', `${max}px`);
    }
  });
}
