import * as THREE from "three";

export function createKineticPendulum({ model, materials, palette }) {
  const brass = new THREE.MeshStandardMaterial({
    color: 0xb49659,
    metalness: 0.85,
    roughness: 0.25,
  });
  const copper = new THREE.MeshStandardMaterial({
    color: 0xae7960,
    metalness: 0.82,
    roughness: 0.29,
  });
  const walnut = new THREE.MeshStandardMaterial({
    color: 0x36251c,
    roughness: 0.68,
  });
  const black = new THREE.MeshStandardMaterial({
    color: 0x202522,
    metalness: 0.7,
    roughness: 0.36,
  });
  const group = new THREE.Group();
  model.add(group);
  function box(w, h, d, material, x, y, z) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  }
  box(3.65, 0.24, 0.9, walnut, 0, -2.3, 0);
  box(3.48, 0.055, 0.81, brass, 0, -2.165, 0);
  box(0.13, 4.66, 0.16, black, -1.67, 0.18, -0.29);
  box(0.13, 4.66, 0.16, black, 1.67, 0.18, -0.29);
  box(3.47, 0.13, 0.16, black, 0, 2.44, -0.29);
  box(0.11, 1.88, 0.13, brass, 0, 1.49, -0.29);
  const bearing = new THREE.Mesh(
    new THREE.TorusGeometry(0.135, 0.033, 12, 48),
    brass,
  );
  bearing.position.set(0, 0.55, -0.08);
  group.add(bearing);
  const axle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.058, 0.058, 0.34, 24),
    black,
  );
  axle.rotation.x = Math.PI / 2;
  axle.position.set(0, 0.55, -0.17);
  group.add(axle);

  const l1 = 1.16,
    l2 = 1.08;
  const rodGeometry = new THREE.CylinderGeometry(0.026, 0.026, 1, 16);
  const rod1 = new THREE.Mesh(rodGeometry, brass),
    rod2 = new THREE.Mesh(rodGeometry.clone(), brass);
  group.add(rod1, rod2);
  const bob1 = new THREE.Mesh(new THREE.SphereGeometry(0.125, 32, 20), brass);
  const bob2 = new THREE.Mesh(new THREE.SphereGeometry(0.155, 32, 20), copper);
  group.add(bob1, bob2);
  const jointRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.14, 0.018, 10, 32),
    black,
  );
  group.add(jointRing);
  const origin = new THREE.Vector3(0, 0.55, 0.1);
  const joint = new THREE.Vector3(),
    end = new THREE.Vector3();
  const direction = new THREE.Vector3(),
    up = new THREE.Vector3(0, 1, 0);
  const state = new Float64Array([2.3, -1.0, 0, 0]);
  const temp = new Float64Array(4),
    k1 = new Float64Array(4),
    k2 = new Float64Array(4);
  const k3 = new Float64Array(4),
    k4 = new Float64Array(4);
  const gravity = 2.5,
    m1 = 1,
    m2 = 1.4,
    fixed = 1 / 120;
  let accumulator = 0,
    elapsed = 0,
    lastEnergy = 0,
    lastKick = -10;

  function derivative(s, out) {
    const a = s[0],
      b = s[1],
      wa = s[2],
      wb = s[3],
      delta = a - b;
    const sin = Math.sin(delta),
      cos = Math.cos(delta);
    const denominator = 2 * m1 + m2 - m2 * Math.cos(2 * delta);
    out[0] = wa;
    out[1] = wb;
    out[2] =
      (-gravity * (2 * m1 + m2) * Math.sin(a) -
        m2 * gravity * Math.sin(a - 2 * b) -
        2 * sin * m2 * (wb * wb * l2 + wa * wa * l1 * cos)) /
        (l1 * denominator) -
      0.001 * wa;
    out[3] =
      (2 *
        sin *
        (wa * wa * l1 * (m1 + m2) +
          gravity * (m1 + m2) * Math.cos(a) +
          wb * wb * l2 * m2 * cos)) /
        (l2 * denominator) -
      0.001 * wb;
  }
  function integrate() {
    derivative(state, k1);
    for (let i = 0; i < 4; i++) temp[i] = state[i] + k1[i] * fixed * 0.5;
    derivative(temp, k2);
    for (let i = 0; i < 4; i++) temp[i] = state[i] + k2[i] * fixed * 0.5;
    derivative(temp, k3);
    for (let i = 0; i < 4; i++) temp[i] = state[i] + k3[i] * fixed;
    derivative(temp, k4);
    for (let i = 0; i < 4; i++)
      state[i] += (fixed / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
    // Wrap angles only; this preserves position and angular velocity continuously.
    state[0] = Math.atan2(Math.sin(state[0]), Math.cos(state[0]));
    state[1] = Math.atan2(Math.sin(state[1]), Math.cos(state[1]));
  }
  function mechanicalEnergy() {
    const a = state[0],
      b = state[1],
      wa = state[2],
      wb = state[3];
    return (
      0.5 * (m1 + m2) * l1 * l1 * wa * wa +
      0.5 * m2 * l2 * l2 * wb * wb +
      m2 * l1 * l2 * wa * wb * Math.cos(a - b) +
      (m1 + m2) * gravity * l1 * (1 - Math.cos(a)) +
      m2 * gravity * l2 * (1 - Math.cos(b))
    );
  }
  function poseRod(rod, a, b) {
    direction.subVectors(b, a);
    rod.scale.y = direction.length();
    rod.position.copy(a).add(b).multiplyScalar(0.5);
    rod.quaternion.setFromUnitVectors(up, direction.normalize());
  }
  function render() {
    joint.set(l1 * Math.sin(state[0]), origin.y - l1 * Math.cos(state[0]), 0.1);
    end.set(
      joint.x + l2 * Math.sin(state[1]),
      joint.y - l2 * Math.cos(state[1]),
      0.1,
    );
    poseRod(rod1, origin, joint);
    poseRod(rod2, joint, end);
    bob1.position.copy(joint);
    bob2.position.copy(end);
    jointRing.position.copy(joint);
    jointRing.position.z += 0.1;
  }
  function update(t, dt, energy = 0) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const span = Math.min(dt, 0.05);
    elapsed += span;
    accumulator += span;
    const input = Number.isFinite(energy)
      ? Math.max(0, Math.min(1, energy))
      : 0;
    if (
      input - lastEnergy > 0.07 &&
      elapsed - lastKick > 0.6 &&
      mechanicalEnergy() < 24
    ) {
      state[3] +=
        (state[3] < 0 ? -1 : 1) *
        Math.min(0.3, 0.1 + (input - lastEnergy) * 0.25);
      lastKick = elapsed;
    }
    lastEnergy = input;
    // A restrained magnetic sustaining pulse after prolonged decay, not a reset.
    if (elapsed > 90 && elapsed - lastKick > 18 && mechanicalEnergy() < 0.75) {
      state[3] += (state[3] < 0 ? -1 : 1) * (0.13 + Math.random() * 0.06);
      lastKick = elapsed;
    }
    while (accumulator >= fixed) {
      integrate();
      accumulator -= fixed;
    }
    render();
  }
  function setPalette(p) {
    copper.color.set(
      p?.name === "보랏빛 꿈"
        ? 0xa4a5a0
        : p?.name === "햇살과 꿀"
          ? 0xc1a365
          : 0xae7960,
    );
  }
  setPalette(palette);
  render();
  return {
    update,
    setPalette,
    kick() {
      if (mechanicalEnergy() < 24) {
        state[3] += (state[3] < 0 ? -1 : 1) * 0.3;
        lastKick = elapsed;
      }
    },
  };
}
