/**
 * LVTSceneOverlay.js - Visual overlays for LVT Demo mode
 *
 * Adds distance rings, coverage arc, and labels to the scene
 * for visualizing the 30m deployment range.
 */

import * as THREE from 'three';

export class LVTSceneOverlay {
  constructor(scene) {
    this.scene = scene;

    // Container group for all overlay elements
    this.group = new THREE.Group();
    this.group.name = 'LVTOverlay';
    this.group.visible = false;

    // Store references to elements
    this.distanceRings = [];
    this.distanceLabels = [];
    this.coverageArc = null;

    // Colors
    this.ringColor = 0x4fc3f7;
    this.coverageColor = 0x81c784;
    this.labelColor = 0x4fc3f7;

    this._createDistanceRings([10, 20, 30]);
    this._createCoverageArc(180);

    this.scene.add(this.group);
  }

  /**
   * Create distance rings at specified radii
   * @param {number[]} radii - Array of distances in meters
   * @private
   */
  _createDistanceRings(radii) {
    radii.forEach((radius) => {
      // Create ring geometry
      const innerRadius = radius - 0.05;
      const outerRadius = radius + 0.05;
      const geometry = new THREE.RingGeometry(innerRadius, outerRadius, 64);

      const material = new THREE.MeshBasicMaterial({
        color: this.ringColor,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.3,
      });

      const ring = new THREE.Mesh(geometry, material);
      ring.rotation.x = -Math.PI / 2; // Lay flat on ground
      ring.position.y = 0.01; // Slightly above ground to prevent z-fighting

      this.group.add(ring);
      this.distanceRings.push(ring);

      // Create distance label
      const label = this._createTextSprite(`${radius}m`, radius);
      this.group.add(label);
      this.distanceLabels.push(label);
    });
  }

  /**
   * Create a text sprite for distance labels
   * @param {string} text - Label text
   * @param {number} radius - Distance from origin
   * @returns {THREE.Sprite}
   * @private
   */
  _createTextSprite(text, radius) {
    const canvas = document.createElement('canvas');
    const size = 128;
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'transparent';
    ctx.fillRect(0, 0, size, size);

    ctx.font = 'bold 48px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#4fc3f7';
    ctx.fillText(text, size / 2, size / 2);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });

    const sprite = new THREE.Sprite(material);
    sprite.scale.set(3, 3, 1);

    // Position at +Z (front of speaker)
    sprite.position.set(0, 0.5, radius + 1.5);

    return sprite;
  }

  /**
   * Create coverage arc visualization
   * @param {number} angleDeg - Coverage angle in degrees
   * @private
   */
  _createCoverageArc(angleDeg) {
    const radius = 35; // Slightly beyond 30m
    const startAngle = -((angleDeg / 2) * Math.PI) / 180;
    const endAngle = ((angleDeg / 2) * Math.PI) / 180;

    // Create arc shape
    const shape = new THREE.Shape();

    // Start at origin
    shape.moveTo(0, 0);

    // Line to start of arc
    const startX = Math.sin(startAngle) * radius;
    const startZ = Math.cos(startAngle) * radius;
    shape.lineTo(startX, startZ);

    // Arc
    const segments = 32;
    const angleStep = (endAngle - startAngle) / segments;
    for (let i = 1; i <= segments; i++) {
      const angle = startAngle + angleStep * i;
      const x = Math.sin(angle) * radius;
      const z = Math.cos(angle) * radius;
      shape.lineTo(x, z);
    }

    // Close back to origin
    shape.lineTo(0, 0);

    const geometry = new THREE.ShapeGeometry(shape);

    const material = new THREE.MeshBasicMaterial({
      color: this.coverageColor,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.1,
    });

    this.coverageArc = new THREE.Mesh(geometry, material);
    this.coverageArc.rotation.x = -Math.PI / 2; // Lay flat
    this.coverageArc.position.y = 0.005; // Just above ground

    this.group.add(this.coverageArc);

    // Add arc outline
    const outlinePoints = [];
    for (let i = 0; i <= segments; i++) {
      const angle = startAngle + angleStep * i;
      const x = Math.sin(angle) * radius;
      const z = Math.cos(angle) * radius;
      outlinePoints.push(new THREE.Vector3(x, 0.02, z));
    }

    const outlineGeometry = new THREE.BufferGeometry().setFromPoints(outlinePoints);
    const outlineMaterial = new THREE.LineBasicMaterial({
      color: this.coverageColor,
      transparent: true,
      opacity: 0.5,
    });

    const outlineLine = new THREE.Line(outlineGeometry, outlineMaterial);
    this.group.add(outlineLine);
  }

  /**
   * Show the overlay
   */
  show() {
    this.group.visible = true;
  }

  /**
   * Hide the overlay
   */
  hide() {
    this.group.visible = false;
  }

  /**
   * Toggle overlay visibility
   * @returns {boolean} New visibility state
   */
  toggle() {
    this.group.visible = !this.group.visible;
    return this.group.visible;
  }

  /**
   * Check if overlay is visible
   * @returns {boolean}
   */
  get isVisible() {
    return this.group.visible;
  }

  /**
   * Update distance rings with new radii
   * @param {number[]} radii - New radii to display
   */
  updateDistanceRings(radii) {
    // Remove existing rings
    this.distanceRings.forEach((ring) => {
      this.group.remove(ring);
      ring.geometry.dispose();
      ring.material.dispose();
    });
    this.distanceLabels.forEach((label) => {
      this.group.remove(label);
      label.material.map.dispose();
      label.material.dispose();
    });
    this.distanceRings = [];
    this.distanceLabels = [];

    // Create new rings
    this._createDistanceRings(radii);
  }

  /**
   * Update coverage arc angle
   * @param {number} angleDeg - New coverage angle
   */
  updateCoverageAngle(angleDeg) {
    if (this.coverageArc) {
      this.group.remove(this.coverageArc);
      this.coverageArc.geometry.dispose();
      this.coverageArc.material.dispose();
    }
    this._createCoverageArc(angleDeg);
  }

  /**
   * Set overlay position (e.g., to follow speaker)
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  setPosition(x, y, z) {
    this.group.position.set(x, y, z);
  }

  /**
   * Set overlay rotation (e.g., to follow speaker rotation)
   * @param {number} yRotation - Y-axis rotation in radians
   */
  setRotation(yRotation) {
    this.group.rotation.y = yRotation;
  }

  /**
   * Clean up resources
   */
  dispose() {
    this.distanceRings.forEach((ring) => {
      ring.geometry.dispose();
      ring.material.dispose();
    });
    this.distanceLabels.forEach((label) => {
      label.material.map.dispose();
      label.material.dispose();
    });
    if (this.coverageArc) {
      this.coverageArc.geometry.dispose();
      this.coverageArc.material.dispose();
    }
    this.scene.remove(this.group);
  }
}
