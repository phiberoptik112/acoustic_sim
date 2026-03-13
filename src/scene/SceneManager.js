/**
 * SceneManager.js - Three.js scene setup and render loop
 */

import * as THREE from 'three';
import { appState } from '../state/AppState.js';
import { SpeakerObject } from './SpeakerObject.js';
import { ListenerObject } from './ListenerObject.js';
import { LVTSceneOverlay } from './LVTSceneOverlay.js';

export class SceneManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = null;
    this.renderer = null;
    this.orthoCamera = null;
    this.perspCamera = null;
    this.activeCamera = null;

    this.speaker = null;
    this.listener = null;

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.dragObject = null;
    this.dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.dragOffset = new THREE.Vector3();

    this.polarFan = null;

    // LVT Demo overlay
    this.lvtOverlay = null;
    this.gridHelper = null;
    this.centerMarker = null;

    // Scene scale (1.0 = normal, 4.0 = LVT mode)
    this.scaleMultiplier = 1.0;
    this.baseFrustumSize = 10;

    this._onUpdate = null;

    this._init();
  }

  _init() {
    // Create scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0f0f1a);

    // Create renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Create cameras
    this._createCameras();

    // Add lighting
    this._addLighting();

    // Add grid floor
    this._addGrid();

    // Create speaker and listener objects
    this._createObjects();

    // Setup event listeners
    this._setupEventListeners();

    // Handle resize
    this._onResize();
    window.addEventListener('resize', () => this._onResize());

    // Subscribe to view mode changes
    appState.subscribe('viewMode', (mode) => {
      this.activeCamera =
        mode === 'perspective' ? this.perspCamera : this.orthoCamera;
    });

    // Subscribe to FRD loaded changes to update polar fan
    appState.subscribe('frdLoaded', ({ loaded, angles }) => {
      if (loaded) {
        this._updatePolarFan(angles);
      } else {
        this._clearPolarFan();
      }
    });

    // Subscribe to LVT Demo mode changes
    appState.subscribe('lvtDemoMode', (enabled) => {
      if (enabled) {
        this._enableLVTMode();
      } else {
        this._disableLVTMode();
      }
    });

    // Create LVT overlay (hidden by default)
    this.lvtOverlay = new LVTSceneOverlay(this.scene);
  }

  _createCameras() {
    const aspect = this.canvas.clientWidth / this.canvas.clientHeight;

    // Orthographic camera (top-down view)
    const frustumSize = 10;
    this.orthoCamera = new THREE.OrthographicCamera(
      (frustumSize * aspect) / -2,
      (frustumSize * aspect) / 2,
      frustumSize / 2,
      frustumSize / -2,
      0.1,
      100
    );
    this.orthoCamera.position.set(0, 15, 0);
    this.orthoCamera.lookAt(0, 0, 0);
    this.orthoCamera.up.set(0, 0, -1);

    // Perspective camera
    this.perspCamera = new THREE.PerspectiveCamera(60, aspect, 0.1, 100);
    this.perspCamera.position.set(8, 8, 8);
    this.perspCamera.lookAt(0, 0, 0);

    // Start with orthographic
    this.activeCamera = this.orthoCamera;
  }

  _addLighting() {
    // Ambient light
    const ambient = new THREE.AmbientLight(0x404060, 0.5);
    this.scene.add(ambient);

    // Directional light
    const directional = new THREE.DirectionalLight(0xffffff, 0.8);
    directional.position.set(5, 10, 5);
    this.scene.add(directional);

    // Hemisphere light for subtle fill
    const hemisphere = new THREE.HemisphereLight(0x4fc3f7, 0x1a1a2e, 0.3);
    this.scene.add(hemisphere);
  }

  _addGrid(size = 20, divisions = 20) {
    // Remove existing grid if any
    if (this.gridHelper) {
      this.scene.remove(this.gridHelper);
      this.gridHelper.geometry.dispose();
      this.gridHelper.material.dispose();
    }
    if (this.centerMarker) {
      this.scene.remove(this.centerMarker);
      this.centerMarker.geometry.dispose();
      this.centerMarker.material.dispose();
    }

    // Main grid
    this.gridHelper = new THREE.GridHelper(size, divisions, 0x2a2a4a, 0x1a1a2e);
    this.gridHelper.position.y = -0.01;
    this.scene.add(this.gridHelper);

    // Center marker
    const centerGeometry = new THREE.RingGeometry(0.05, 0.08, 16);
    const centerMaterial = new THREE.MeshBasicMaterial({
      color: 0x4fc3f7,
      side: THREE.DoubleSide,
    });
    this.centerMarker = new THREE.Mesh(centerGeometry, centerMaterial);
    this.centerMarker.rotation.x = -Math.PI / 2;
    this.centerMarker.position.y = 0.01;
    this.scene.add(this.centerMarker);
  }

  _createObjects() {
    // Create speaker
    this.speaker = new SpeakerObject();
    this.scene.add(this.speaker.mesh);

    // Create listener
    this.listener = new ListenerObject();
    this.scene.add(this.listener.mesh);

    // Position listener in front of speaker
    this.listener.setPosition(0, 0, 3);

    // Create empty polar fan (will be populated when FRD loads)
    this.polarFanGroup = new THREE.Group();
    this.scene.add(this.polarFanGroup);
  }

  _updatePolarFan(angles) {
    this._clearPolarFan();

    if (!angles || angles.length === 0) return;

    const fanRadius = this.polarFanRadius || 4;
    const material = new THREE.LineBasicMaterial({
      color: 0x4fc3f7,
      transparent: true,
      opacity: 0.3,
    });

    // Draw lines for each loaded angle (both positive and negative for symmetry)
    angles.forEach((angle) => {
      const radians = (angle * Math.PI) / 180;

      // Positive side
      const points1 = [
        new THREE.Vector3(0, 0.02, 0),
        new THREE.Vector3(
          Math.sin(radians) * fanRadius,
          0.02,
          Math.cos(radians) * fanRadius
        ),
      ];
      const geometry1 = new THREE.BufferGeometry().setFromPoints(points1);
      const line1 = new THREE.Line(geometry1, material);
      this.polarFanGroup.add(line1);

      // Negative side (mirror)
      if (angle > 0) {
        const points2 = [
          new THREE.Vector3(0, 0.02, 0),
          new THREE.Vector3(
            -Math.sin(radians) * fanRadius,
            0.02,
            Math.cos(radians) * fanRadius
          ),
        ];
        const geometry2 = new THREE.BufferGeometry().setFromPoints(points2);
        const line2 = new THREE.Line(geometry2, material);
        this.polarFanGroup.add(line2);
      }
    });

    // Draw arc at outer edge
    const arcPoints = [];
    const maxAngle = Math.max(...angles);
    for (let a = -maxAngle; a <= maxAngle; a += 5) {
      const radians = (a * Math.PI) / 180;
      arcPoints.push(
        new THREE.Vector3(
          Math.sin(radians) * fanRadius,
          0.02,
          Math.cos(radians) * fanRadius
        )
      );
    }
    const arcGeometry = new THREE.BufferGeometry().setFromPoints(arcPoints);
    const arcLine = new THREE.Line(arcGeometry, material);
    this.polarFanGroup.add(arcLine);
  }

  _clearPolarFan() {
    while (this.polarFanGroup.children.length > 0) {
      const child = this.polarFanGroup.children[0];
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
      this.polarFanGroup.remove(child);
    }
  }

  _setupEventListeners() {
    this.canvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this._onMouseMove(e));
    this.canvas.addEventListener('mouseup', () => this._onMouseUp());
    this.canvas.addEventListener('wheel', (e) => this._onWheel(e));

    // Touch support
    this.canvas.addEventListener('touchstart', (e) =>
      this._onTouchStart(e)
    );
    this.canvas.addEventListener('touchmove', (e) => this._onTouchMove(e));
    this.canvas.addEventListener('touchend', () => this._onMouseUp());
  }

  _getMousePosition(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  _onMouseDown(event) {
    this._getMousePosition(event);
    this.raycaster.setFromCamera(this.mouse, this.activeCamera);

    // Check for intersection with speaker or listener
    const objects = [this.speaker.mesh, this.listener.mesh];
    const intersects = this.raycaster.intersectObjects(objects, true);

    if (intersects.length > 0) {
      let obj = intersects[0].object;
      // Find parent draggable object
      while (obj.parent && !objects.includes(obj)) {
        obj = obj.parent;
      }

      if (objects.includes(obj)) {
        this.dragObject = obj;
        this.canvas.style.cursor = 'grabbing';

        // Calculate offset from intersection point to object center
        const intersectPoint = new THREE.Vector3();
        this.raycaster.ray.intersectPlane(this.dragPlane, intersectPoint);
        this.dragOffset.copy(obj.position).sub(intersectPoint);
      }
    }
  }

  _onMouseMove(event) {
    this._getMousePosition(event);

    if (this.dragObject) {
      this.raycaster.setFromCamera(this.mouse, this.activeCamera);
      const intersectPoint = new THREE.Vector3();
      this.raycaster.ray.intersectPlane(this.dragPlane, intersectPoint);

      const newPosition = intersectPoint.add(this.dragOffset);

      // Update object position
      this.dragObject.position.x = newPosition.x;
      this.dragObject.position.z = newPosition.z;

      // Sync to state
      if (this.dragObject === this.speaker.mesh) {
        appState.setSpeakerPosition(
          newPosition.x,
          this.dragObject.position.y,
          newPosition.z
        );
      } else if (this.dragObject === this.listener.mesh) {
        appState.setListenerPosition(
          newPosition.x,
          this.dragObject.position.y,
          newPosition.z
        );
      }
    } else {
      // Update cursor based on hover
      this.raycaster.setFromCamera(this.mouse, this.activeCamera);
      const objects = [this.speaker.mesh, this.listener.mesh];
      const intersects = this.raycaster.intersectObjects(objects, true);
      this.canvas.style.cursor = intersects.length > 0 ? 'grab' : 'default';
    }
  }

  _onMouseUp() {
    this.dragObject = null;
    this.canvas.style.cursor = 'default';
  }

  _onWheel(event) {
    event.preventDefault();

    if (this.activeCamera === this.orthoCamera) {
      // Zoom orthographic camera
      const zoomFactor = 1 + event.deltaY * 0.001;
      this.orthoCamera.zoom = Math.max(
        0.1,
        Math.min(5, this.orthoCamera.zoom / zoomFactor)
      );
      this.orthoCamera.updateProjectionMatrix();
    } else {
      // Move perspective camera closer/farther
      const direction = new THREE.Vector3();
      this.perspCamera.getWorldDirection(direction);
      this.perspCamera.position.addScaledVector(direction, -event.deltaY * 0.01);
    }
  }

  _onTouchStart(event) {
    if (event.touches.length === 1) {
      const touch = event.touches[0];
      this._onMouseDown({
        clientX: touch.clientX,
        clientY: touch.clientY,
      });
    }
  }

  _onTouchMove(event) {
    if (event.touches.length === 1) {
      event.preventDefault();
      const touch = event.touches[0];
      this._onMouseMove({
        clientX: touch.clientX,
        clientY: touch.clientY,
      });
    }
  }

  _onResize() {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const aspect = width / height;

    // Update orthographic camera
    const frustumSize = 10;
    this.orthoCamera.left = (frustumSize * aspect) / -2;
    this.orthoCamera.right = (frustumSize * aspect) / 2;
    this.orthoCamera.top = frustumSize / 2;
    this.orthoCamera.bottom = frustumSize / -2;
    this.orthoCamera.updateProjectionMatrix();

    // Update perspective camera
    this.perspCamera.aspect = aspect;
    this.perspCamera.updateProjectionMatrix();

    // Update renderer
    this.renderer.setSize(width, height, false);
  }

  /**
   * Set callback for frame updates
   */
  onUpdate(callback) {
    this._onUpdate = callback;
  }

  /**
   * Start the render loop
   */
  start() {
    const animate = () => {
      requestAnimationFrame(animate);

      // Call update callback
      if (this._onUpdate) {
        this._onUpdate();
      }

      // Update speaker rotation visual to match state
      this.speaker.mesh.rotation.y = appState.speakerRotation;

      // Update polar fan position to follow speaker
      this.polarFanGroup.position.copy(this.speaker.mesh.position);
      this.polarFanGroup.rotation.y = appState.speakerRotation;

      // Render
      this.renderer.render(this.scene, this.activeCamera);
    };

    animate();
  }

  /**
   * Get listener world position as Vector3
   */
  getListenerPosition() {
    return this.listener.mesh.position.clone();
  }

  /**
   * Get speaker object for azimuth calculations
   */
  getSpeakerObject() {
    return this.speaker.mesh;
  }

  /**
   * Enable LVT Demo mode - rescale scene for 30m range
   */
  _enableLVTMode() {
    console.log('SceneManager: Enabling LVT mode');

    this.scaleMultiplier = 4.0;

    // Rescale grid to 80x80m with 16 divisions (5m spacing)
    this._addGrid(80, 16);

    // Update camera frustum
    this._updateCameraForScale();

    // Move listener to 30m
    this.listener.setPosition(0, 0, 30);
    appState.setListenerPosition(0, 0, 30);

    // Update polar fan radius
    this._updatePolarFanRadius(16); // Larger fan for LVT mode

    // Show LVT overlay
    if (this.lvtOverlay) {
      this.lvtOverlay.show();
    }
  }

  /**
   * Disable LVT Demo mode - restore normal scale
   */
  _disableLVTMode() {
    console.log('SceneManager: Disabling LVT mode');

    this.scaleMultiplier = 1.0;

    // Restore normal grid
    this._addGrid(20, 20);

    // Update camera frustum
    this._updateCameraForScale();

    // Move listener back to 3m
    this.listener.setPosition(0, 0, 3);
    appState.setListenerPosition(0, 0, 3);

    // Restore polar fan radius
    this._updatePolarFanRadius(4);

    // Hide LVT overlay
    if (this.lvtOverlay) {
      this.lvtOverlay.hide();
    }
  }

  /**
   * Update camera settings for current scale
   * @private
   */
  _updateCameraForScale() {
    const aspect = this.canvas.clientWidth / this.canvas.clientHeight;
    const frustumSize = this.baseFrustumSize * this.scaleMultiplier;

    // Update orthographic camera
    this.orthoCamera.left = (frustumSize * aspect) / -2;
    this.orthoCamera.right = (frustumSize * aspect) / 2;
    this.orthoCamera.top = frustumSize / 2;
    this.orthoCamera.bottom = frustumSize / -2;
    this.orthoCamera.position.y = 15 * this.scaleMultiplier;
    this.orthoCamera.updateProjectionMatrix();

    // Update perspective camera position
    const perspDist = 8 * this.scaleMultiplier;
    this.perspCamera.position.set(perspDist, perspDist, perspDist);
    this.perspCamera.lookAt(0, 0, 0);
  }

  /**
   * Update polar fan radius
   * @param {number} radius - New radius in meters
   * @private
   */
  _updatePolarFanRadius(radius) {
    // Store radius for use in _updatePolarFan
    this.polarFanRadius = radius;

    // Rebuild if we have angles loaded
    if (appState.loadedAngles && appState.loadedAngles.length > 0) {
      this._updatePolarFan(appState.loadedAngles);
    }
  }

  /**
   * Set scene scale
   * @param {number} scale - Scale multiplier (1.0 = normal)
   */
  setSceneScale(scale) {
    this.scaleMultiplier = scale;
    this._updateCameraForScale();
    this._addGrid(20 * scale, Math.floor(20 / scale) * scale);
  }
}
