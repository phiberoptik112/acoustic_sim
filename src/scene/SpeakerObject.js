/**
 * SpeakerObject.js - Draggable speaker mesh with forward-axis indicator
 */

import * as THREE from 'three';
import { appState } from '../state/AppState.js';

export class SpeakerObject {
  constructor() {
    this.mesh = this._createMesh();
  }

  _createMesh() {
    // Main group
    const group = new THREE.Group();
    group.name = 'speaker';

    // Speaker cabinet (box)
    const cabinetGeometry = new THREE.BoxGeometry(0.4, 0.6, 0.3);
    const cabinetMaterial = new THREE.MeshStandardMaterial({
      color: 0x2a2a4a,
      roughness: 0.7,
      metalness: 0.1,
    });
    const cabinet = new THREE.Mesh(cabinetGeometry, cabinetMaterial);
    cabinet.position.y = 0.3;
    group.add(cabinet);

    // Front baffle (slightly different color to show front)
    const baffleGeometry = new THREE.PlaneGeometry(0.38, 0.58);
    const baffleMaterial = new THREE.MeshStandardMaterial({
      color: 0x1a1a2e,
      roughness: 0.9,
    });
    const baffle = new THREE.Mesh(baffleGeometry, baffleMaterial);
    baffle.position.set(0, 0.3, 0.151);
    group.add(baffle);

    // Woofer cone
    const wooferGeometry = new THREE.CircleGeometry(0.12, 32);
    const wooferMaterial = new THREE.MeshStandardMaterial({
      color: 0x404060,
      roughness: 0.5,
    });
    const woofer = new THREE.Mesh(wooferGeometry, wooferMaterial);
    woofer.position.set(0, 0.2, 0.152);
    group.add(woofer);

    // Tweeter dome
    const tweeterGeometry = new THREE.CircleGeometry(0.04, 32);
    const tweeterMaterial = new THREE.MeshStandardMaterial({
      color: 0x606080,
      metalness: 0.3,
      roughness: 0.4,
    });
    const tweeter = new THREE.Mesh(tweeterGeometry, tweeterMaterial);
    tweeter.position.set(0, 0.45, 0.152);
    group.add(tweeter);

    // Forward axis arrow (+Z direction)
    const arrowLength = 0.8;
    const arrowDir = new THREE.Vector3(0, 0, 1);
    const arrowOrigin = new THREE.Vector3(0, 0.3, 0.2);
    const arrowHelper = new THREE.ArrowHelper(
      arrowDir,
      arrowOrigin,
      arrowLength,
      0x4fc3f7,
      0.15,
      0.1
    );
    group.add(arrowHelper);

    // Ground shadow (simple circle)
    const shadowGeometry = new THREE.CircleGeometry(0.25, 16);
    const shadowMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.2,
    });
    const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.01;
    group.add(shadow);

    return group;
  }

  setPosition(x, y, z) {
    this.mesh.position.set(x, y, z);
    appState.setSpeakerPosition(x, y, z);
  }

  setRotation(radians) {
    this.mesh.rotation.y = radians;
    appState.setSpeakerRotation(radians);
  }

  getPosition() {
    return this.mesh.position.clone();
  }

  getRotation() {
    return this.mesh.rotation.y;
  }
}
