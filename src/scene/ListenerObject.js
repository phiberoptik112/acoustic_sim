/**
 * ListenerObject.js - Binaural listener/head mesh with orientation indicator
 */

import * as THREE from 'three';
import { appState } from '../state/AppState.js';

export class ListenerObject {
  constructor() {
    this.mesh = this._createMesh();
  }

  _createMesh() {
    // Main group
    const group = new THREE.Group();
    group.name = 'listener';

    // Head (sphere)
    const headGeometry = new THREE.SphereGeometry(0.15, 32, 24);
    const headMaterial = new THREE.MeshStandardMaterial({
      color: 0x4fc3f7,
      roughness: 0.6,
      metalness: 0.1,
    });
    const head = new THREE.Mesh(headGeometry, headMaterial);
    head.position.y = 0.3;
    group.add(head);

    // Ears (to show orientation)
    const earGeometry = new THREE.SphereGeometry(0.04, 16, 12);
    const earMaterial = new THREE.MeshStandardMaterial({
      color: 0x29b6f6,
      roughness: 0.6,
    });

    const leftEar = new THREE.Mesh(earGeometry, earMaterial);
    leftEar.position.set(-0.16, 0.3, 0);
    leftEar.scale.set(0.6, 1, 1);
    group.add(leftEar);

    const rightEar = new THREE.Mesh(earGeometry, earMaterial);
    rightEar.position.set(0.16, 0.3, 0);
    rightEar.scale.set(0.6, 1, 1);
    group.add(rightEar);

    // Face indicator (nose direction - shows where listener is facing)
    const noseGeometry = new THREE.ConeGeometry(0.04, 0.08, 8);
    const noseMaterial = new THREE.MeshStandardMaterial({
      color: 0x81c784,
      roughness: 0.5,
    });
    const nose = new THREE.Mesh(noseGeometry, noseMaterial);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 0.3, -0.17);
    group.add(nose);

    // Forward direction line (subtle)
    const lineGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.3, -0.2),
      new THREE.Vector3(0, 0.3, -0.5),
    ]);
    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0x81c784,
      transparent: true,
      opacity: 0.5,
    });
    const line = new THREE.Line(lineGeometry, lineMaterial);
    group.add(line);

    // Body cylinder (simplified torso)
    const bodyGeometry = new THREE.CylinderGeometry(0.08, 0.1, 0.15, 16);
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0x3a8fc2,
      roughness: 0.7,
    });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = 0.1;
    group.add(body);

    // Ground shadow
    const shadowGeometry = new THREE.CircleGeometry(0.15, 16);
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
    appState.setListenerPosition(x, y, z);
  }

  setOrientation(forward, up) {
    // Update mesh rotation to match orientation
    const lookTarget = new THREE.Vector3(
      this.mesh.position.x + forward.x,
      this.mesh.position.y + forward.y,
      this.mesh.position.z + forward.z
    );
    this.mesh.lookAt(lookTarget);

    appState.setListenerOrientation(forward, up);
  }

  getPosition() {
    return this.mesh.position.clone();
  }

  getForward() {
    const forward = new THREE.Vector3(0, 0, -1);
    forward.applyQuaternion(this.mesh.quaternion);
    return forward;
  }

  getUp() {
    const up = new THREE.Vector3(0, 1, 0);
    up.applyQuaternion(this.mesh.quaternion);
    return up;
  }
}
