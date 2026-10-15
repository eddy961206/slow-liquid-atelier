import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { CascadePhysics } from "../dist/cascade-physics.js";
import { ConvectionSystem } from "../dist/fluid-dynamics.js";
import { createTidalPool } from "../dist/tidal-pool.js";
import { createSandscape } from "../dist/sandscape.js";
import { createKineticPendulum } from "../dist/kinetic-pendulum.js";

const palette = { a: "#159aab", b: "#c07835", name: "산호와 바다" };
function fixture(factory) {
  const model = new THREE.Group();
  const materials = {
    metal: new THREE.MeshStandardMaterial(),
    darkMetal: new THREE.MeshStandardMaterial(),
    glassEdge: new THREE.MeshPhysicalMaterial(),
  };
  return { model, simulation: factory({ model, materials, palette }) };
}
function fingerprint(model) {
  const result = [];
  model.traverse((o) => {
    result.push(...o.position, ...o.quaternion, ...o.scale);
    if (o.geometry?.attributes.position)
      result.push(...o.geometry.attributes.position.array);
  });
  return result;
}

test("cascade stays finite and inside the vessel through ten minutes of turning", () => {
  const drops = Array.from({ length: 16 }, (_, i) => {
    const r = 0.075 + (i % 5) * 0.012;
    return {
      i,
      r,
      mesh: {
        position: new THREE.Vector3(),
        scale: new THREE.Vector3(r, r, r),
      },
    };
  });
  const simulation = new CascadePhysics(drops);
  for (let i = 0; i < 36000; i++) {
    simulation.step(1 / 60, Math.floor(i / 2400) * Math.PI);
    if (i % 60 === 0)
      for (const d of drops) {
        assert.ok(Number.isFinite(d.mesh.position.x + d.mesh.position.y));
        assert.ok(Math.abs(d.mesh.position.x) <= 1.17 - d.r + 1e-8);
        assert.ok(Math.abs(d.mesh.position.y) <= 2.5 - d.r + 1e-8);
      }
  }
});

test("thermal convection circulates without leaving the glass or resetting positions", () => {
  const simulation = new ConvectionSystem(6);
  const phases = simulation.nodes.map((n) => n.phase);
  let changes = 0;
  for (let i = 0; i < 18000; i++) {
    simulation.step(1 / 60, i % 600 === 0 ? 1 : 0);
    simulation.nodes.forEach((n, j) => {
      assert.ok(Number.isFinite(n.x + n.y + n.z + n.temperature));
      assert.ok(n.y >= 0.2 && n.y <= 0.79);
      assert.ok(Math.hypot(n.x - 0.5, n.z - 0.5) <= 0.105 + 1e-8);
      if (phases[j] !== n.phase) {
        changes++;
        phases[j] = n.phase;
      }
    });
  }
  assert.ok(changes > 10, "individual blobs must keep warming and cooling");
  const before = JSON.stringify(simulation.nodes);
  simulation.step(0, 1);
  assert.equal(JSON.stringify(simulation.nodes), before);
});

test("water stays stable under repeated impulses and its surface normals follow the waves", () => {
  const { model, simulation } = fixture(createTidalPool);
  let surface;
  model.traverse((o) => {
    if (o.geometry?.attributes.position.count === 81 * 55) surface = o;
  });
  for (let i = 0; i < 1800; i++)
    simulation.update(i / 30, 1 / 30, i % 30 === 0 ? 1 : 0);
  const p = surface.geometry.attributes.position,
    n = surface.geometry.attributes.normal;
  let maximum = 0,
    slopes = 0;
  for (let i = 0; i < p.count; i++) {
    assert.ok(Number.isFinite(p.getY(i) + n.getY(i)));
    maximum = Math.max(maximum, Math.abs(p.getY(i) + 0.015));
    if (Math.abs(n.getX(i)) + Math.abs(n.getZ(i)) > 0.001) slopes++;
  }
  assert.ok(maximum < 0.18, "ripples must stay in the shallow basin");
  assert.ok(slopes > 30, "normal vectors must respond to the surface");
});

test("sand retains earlier grooves while the rolling tool adds new ones", () => {
  const { model, simulation } = fixture(createSandscape);
  let surface;
  model.traverse((o) => {
    if (o.geometry?.attributes.position.count === 71 * 101) surface = o;
  });
  const before = surface.geometry.attributes.position.array.slice();
  for (let i = 0; i < 600; i++) simulation.update(i / 30, 1 / 30, 0);
  const after = surface.geometry.attributes.position.array;
  let changed = 0,
    retained = 0;
  for (let i = 1; i < after.length; i += 3) {
    assert.ok(Number.isFinite(after[i]));
    if (Math.abs(after[i] - before[i]) > 0.0001) changed++;
    else retained++;
  }
  assert.ok(changed > 50);
  assert.ok(
    retained > changed,
    "untouched regions must not be reset each frame",
  );
  simulation.dispose();
});

test("all stateful scenes remain unchanged during a paused redraw", () => {
  for (const factory of [
    createTidalPool,
    createSandscape,
    createKineticPendulum,
  ]) {
    const { model, simulation } = fixture(factory);
    simulation.update(1, 0.025, 0);
    const before = fingerprint(model);
    simulation.update(1, 0, 0);
    assert.deepEqual(fingerprint(model), before);
    simulation.dispose?.();
  }
});

test("double pendulum uses the same fixed physics step at different display frame rates", () => {
  const a = fixture(createKineticPendulum),
    b = fixture(createKineticPendulum);
  for (let i = 0; i < 3600; i++) a.simulation.update(i / 60, 1 / 60, 0);
  for (let i = 0; i < 7200; i++) b.simulation.update(i / 120, 1 / 120, 0);
  const first = fingerprint(a.model),
    second = fingerprint(b.model);
  assert.equal(first.length, second.length);
  for (let i = 0; i < first.length; i++)
    assert.ok(Math.abs(first[i] - second[i]) < 1e-7);
});

test("closely repeated interactions apply distinct physical impulses", () => {
  const convection = new ConvectionSystem(6);
  const initial = convection.nodes[0].vy;
  convection.kick();
  const first = convection.nodes[0].vy;
  convection.kick();
  assert.ok(first > initial && convection.nodes[0].vy > first);

  for (const factory of [createTidalPool, createKineticPendulum]) {
    const a = fixture(factory),
      b = fixture(factory);
    a.simulation.kick();
    b.simulation.kick();
    a.simulation.update(0, 1 / 60, 0);
    b.simulation.update(0, 1 / 60, 0);
    a.simulation.kick();
    a.simulation.update(0, 1 / 60, 0);
    b.simulation.update(0, 1 / 60, 0);
    assert.notDeepEqual(fingerprint(a.model), fingerprint(b.model));
  }
});
