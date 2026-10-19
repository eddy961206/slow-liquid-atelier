import * as THREE from "three";
import { CascadePhysics } from "./cascade-physics.js";
import { createTidalPool } from "./tidal-pool.js";
import { createSandscape } from "./sandscape.js";
import { createKineticPendulum } from "./kinetic-pendulum.js";
import { ConvectionSystem } from "./fluid-dynamics.js";
import { createStudio } from "./studio.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const $ = (s) => document.querySelector(s);
const stage = $("#stage");
const palettes = [
  { a: "#159aab", b: "#c07835", name: "산호와 바다" },
  { a: "#cb962d", b: "#a94e42", name: "햇살과 꿀" },
  { a: "#7561a6", b: "#519b8f", name: "보랏빛 꿈" },
];
const toys = [
  {
    title: "오일 캐스케이드",
    desc: "천천히, 흘러가는 대로",
    action: "뒤집기",
    hint: "다시, 천천히 흘러요",
  },
  {
    title: "라바 램프",
    desc: "몽글몽글, 빛이 피어나는 시간",
    action: "흔들기",
    hint: "빛이 천천히 섞여요",
  },
  {
    title: "리퀴드 오빗",
    desc: "작은 우주를 떠도는 물방울",
    action: "회오리 만들기",
    hint: "작은 소용돌이를 만들었어요",
  },
  {
    title: "잔잔한 수조",
    desc: "작은 파문이 만나, 새로운 물결로",
    action: "물결 만들기",
    hint: "물결이 번져 나가요",
  },
  {
    title: "모래의 궤적",
    desc: "지나간 자리에 남는, 오늘만의 무늬",
    action: "흐름 바꾸기",
    hint: "새로운 궤적을 그려요",
  },
  {
    title: "느린 균형",
    desc: "두 움직임이 만나는, 예측할 수 없는 궤적",
    action: "살짝 밀기",
    hint: "작은 힘으로, 다른 움직임",
  },
];
// Per-object camera height (radians above the horizon) and lighting look.
const views = [
  { elevation: 0.07, look: { key: 380, wash: 240, rim: 200 } },
  { elevation: 0.08, look: { key: 260, wash: 170, rim: 150, exposure: 1.0 } },
  { elevation: 0.09, look: { key: 380, wash: 240, rim: 190 } },
  {
    elevation: 0.62,
    look: { key: 340, wash: 220, rim: 120, rake: 0.55, reflection: 0.7 },
  },
  {
    elevation: 0.66,
    look: {
      key: 110,
      wash: 200,
      rim: 60,
      rake: 1.9,
      rakePosition: [-8, 1.7, -1.2],
      reflection: 0.6,
      exposure: 0.95,
    },
  },
  { elevation: 0.05, look: { key: 420, wash: 260, rim: 220 } },
];

let studio;
try {
  studio = createStudio(stage);
} catch (error) {
  $("#loading").hidden = true;
  $("#webgl-error").hidden = false;
  throw error;
}
const {
  renderer,
  camera,
  anchor,
  glass,
  glassEdge,
  metal,
  darkMetal,
  brass,
  oilA,
  oilB,
} = studio;
studio.tintLiquid(oilA, palettes[0].a);
studio.tintLiquid(oilB, palettes[0].b);

// The flip of the cascade lifts the vessel off the floor; the lift lives on
// this group so the model itself keeps rotating around its own centre.
const lift = new THREE.Group();
anchor.add(lift);
let model = new THREE.Group();
lift.add(model);
const sharedMaterials = new Set([
  glass,
  glassEdge,
  metal,
  darkMetal,
  brass,
  oilA,
  oilB,
]);
const sphereGeo = new THREE.SphereGeometry(1, 48, 32);
let dynamic = [],
  liquid = null,
  toyIndex = 2,
  paletteIndex = 0;
let simTime = 10,
  paused = matchMedia("(prefers-reduced-motion: reduce)").matches,
  speed = 1,
  energy = 0,
  flipTarget = 0,
  flipAngle = 0;
let yaw = -0.28,
  pitch = 0,
  targetYaw = -0.28,
  targetPitch = 0,
  zoom = 1,
  frame = 0;
let activeSimulation = null,
  cascadeSimulation = null,
  convection = null,
  lampLight = null,
  lampGlow = null;
const modelBounds = new THREE.Box3();
const frameBox = new THREE.Box3();
let orbitDrift = {
  phase: 0,
  radius: 0.13,
  target: 0.13,
  tilt: 0,
  tiltTarget: 0,
  next: 0,
};
let fluidDirty = true,
  lastFluidTime = -1,
  orbitRing = null,
  contactShadow = null;

// --------------------------------------------------------------- helpers
function mesh(geo, mat, parent = model) {
  const m = new THREE.Mesh(geo, mat);
  parent.add(m);
  return m;
}
function box(w, h, d, r, mat, parent = model) {
  return mesh(new RoundedBoxGeometry(w, h, d, 6, r), mat, parent);
}
function sphere(r, mat, parent = model) {
  const m = mesh(sphereGeo, mat, parent);
  m.scale.setScalar(r);
  return m;
}
function ring(r, t, y, mat, parent = model) {
  const m = mesh(new THREE.TorusGeometry(r, t, 16, 128), mat, parent);
  m.rotation.x = Math.PI / 2;
  m.position.y = y;
  return m;
}
function lathe(points, mat, segments = 128) {
  return mesh(
    new THREE.LatheGeometry(
      points.map((p) => new THREE.Vector2(...p)),
      segments,
    ),
    mat,
  );
}
/** Smooth a coarse lathe profile with a Catmull-Rom pass. */
function smoothProfile(points, samples = 8) {
  const curve = new THREE.SplineCurve(
    points.map((p) => new THREE.Vector2(...p)),
  );
  return curve.getPoints(points.length * samples).map((p) => [p.x, p.y]);
}
let contactTexture;
function contactTextureOnce() {
  if (contactTexture) return contactTexture;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(0,0,0,0.85)");
  grad.addColorStop(0.45, "rgba(0,0,0,0.45)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  contactTexture = new THREE.CanvasTexture(c);
  return contactTexture;
}
/** A soft ambient-occlusion pad where the object meets the floor. */
function addContact(w, d) {
  contactShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: contactTextureOnce(),
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  contactShadow.rotation.x = -Math.PI / 2;
  contactShadow.scale.set(w, d, 1);
  contactShadow.renderOrder = -1;
  anchor.add(contactShadow);
}

function clearModel() {
  activeSimulation?.dispose?.();
  activeSimulation = null;
  cascadeSimulation = null;
  convection = null;
  lampLight = null;
  lampGlow = null;
  lift.remove(model);
  const geometries = new Set(),
    materials = new Set();
  const collect = (o) => {
    if (o.geometry && o.geometry !== sphereGeo) geometries.add(o.geometry);
    if (o.material && !sharedMaterials.has(o.material))
      materials.add(o.material);
  };
  model.traverse(collect);
  if (contactShadow) {
    anchor.remove(contactShadow);
    collect(contactShadow);
    contactShadow = null;
  }
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
  model = new THREE.Group();
  lift.add(model);
  lift.position.set(0, 0, 0);
  dynamic = [];
  liquid?.dispose();
  liquid = null;
  orbitRing = null;
  flipAngle = flipTarget = 0;
  energy = 0;
  fluidDirty = true;
}

// ------------------------------------------------------- 01 oil cascade
function createCascade() {
  const body = box(2.64, 5.64, 0.78, 0.29, glass);
  body.renderOrder = 8;
  for (const y of [-2.5, 2.5]) {
    const cap = box(2.78, 0.62, 0.92, 0.16, darkMetal);
    cap.position.y = y;
    const band = box(2.8, 0.035, 0.94, 0.016, brass);
    band.position.y = y - Math.sign(y) * 0.28;
  }
  const shelf = new THREE.MeshPhysicalMaterial({
    color: "#c9d0d2",
    metalness: 1,
    roughness: 0.28,
  });
  for (let i = 0; i < 6; i++) {
    const side = i % 2 === 0 ? 1 : -1,
      y = 1.52 - i * 0.6;
    const ramp = box(1.92, 0.04, 0.5, 0.018, shelf);
    ramp.position.set(-side * 0.19, y, 0);
    ramp.rotation.z = -side * 0.2;
    // A small lip at the low end where the drops gather before falling.
    const lip = mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.5, 12), shelf);
    lip.rotation.x = Math.PI / 2;
    lip.position.set(-side * 0.19 + side * 0.94 * Math.cos(0.2), y - 0.94 * Math.sin(0.2) + 0.02, 0);
  }
  // Oil drops, the upper reservoirs and the collected pools are one
  // raymarched liquid: drops that touch merge, everything refracts.
  for (let i = 0; i < 2; i++) {
    const x = i ? 0.57 : -0.57;
    dynamic.push({ kind: "pond", x, y: 2.08, i });
    dynamic.push({ kind: "pool", x, y: -2.12, i });
  }
  for (let i = 0; i < 32; i++) {
    const holder = new THREE.Object3D();
    model.add(holder);
    dynamic.push({
      kind: "drop",
      mesh: holder,
      i,
      r: 0.075 + (Math.sin(i * 31.7) * 0.5 + 0.5) * 0.07,
      offset: i * 0.947,
    });
  }
  liquid = studio.makeRaymarchedLiquid({
    geometry: new THREE.BoxGeometry(2.36, 5.0, 0.62),
    smooth: 0.07,
    ior: 1.45,
  });
  model.add(liquid.mesh);
  setLiquidColours();
}
function updateCascadeLiquid() {
  liquid.reset();
  for (const d of dynamic) {
    if (d.kind === "pond")
      liquid.add(d.x, d.y, 0, 0.49, d.i, 0.5, 0.1, 0.26);
    else if (d.kind === "pool")
      liquid.add(d.x, d.y, 0, 0.51, d.i, 0.58, 0.1, 0.27);
  }
  for (const d of dynamic) {
    if (d.kind !== "drop") continue;
    const m = d.mesh;
    liquid.add(
      m.position.x,
      m.position.y,
      m.position.z,
      1,
      d.i % 2,
      m.scale.x,
      m.scale.y,
      m.scale.z,
    );
  }
  liquid.commit();
}

// ----------------------------------------------------------- 02 lava lamp
function lampRadius(y) {
  const pts = [
    [-1.84, 0.5],
    [-1.66, 0.6],
    [-0.98, 0.73],
    [0.12, 0.74],
    [1.2, 0.63],
    [1.94, 0.44],
  ];
  if (y <= pts[0][0]) return pts[0][1];
  for (let i = 0; i < pts.length - 1; i++)
    if (y <= pts[i + 1][0])
      return THREE.MathUtils.lerp(
        pts[i][1],
        pts[i + 1][1],
        (y - pts[i][0]) / (pts[i + 1][0] - pts[i][0]),
      );
  return pts[pts.length - 1][1];
}
function createLava() {
  convection = new ConvectionSystem(6);
  const p = palettes[paletteIndex];
  // Base: a tapered satin shell with a brass seam.
  lathe(
    smoothProfile([
      [0, -2.8],
      [0.8, -2.8],
      [0.86, -2.74],
      [0.83, -2.6],
      [0.62, -2.0],
      [0.55, -1.86],
      [0.56, -1.78],
      [0, -1.78],
    ]),
    darkMetal,
  );
  ring(0.83, 0.018, -2.66, brass);
  ring(0.565, 0.02, -1.8, brass);
  const vessel = lathe(
    smoothProfile([
      [0, -1.8],
      [0.52, -1.8],
      [0.62, -1.6],
      [0.76, -0.9],
      [0.77, 0.2],
      [0.66, 1.3],
      [0.46, 2.05],
      [0.38, 2.3],
      [0, 2.3],
    ]),
    glass,
  );
  vessel.renderOrder = 9;
  lathe(
    smoothProfile([
      [0, 2.22],
      [0.39, 2.22],
      [0.41, 2.32],
      [0.33, 2.66],
      [0.28, 2.76],
      [0, 2.76],
    ]),
    darkMetal,
  );
  ring(0.4, 0.016, 2.3, brass);
  // A glowing heating coil seen through the wax pool.
  lampGlow = mesh(
    new THREE.CylinderGeometry(0.42, 0.4, 0.04, 64),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(p.b).multiplyScalar(2.2),
    }),
  );
  lampGlow.position.y = -1.77;
  // Wax: a raymarched, strongly scattering body heated from below.
  liquid = studio.makeRaymarchedLiquid({
    geometry: new THREE.LatheGeometry(
      smoothProfile([
        [0.001, -1.84],
        [0.5, -1.84],
        [0.6, -1.66],
        [0.74, -0.98],
        [0.75, 0.12],
        [0.64, 1.2],
        [0.45, 1.94],
        [0.001, 1.94],
      ]).map((q) => new THREE.Vector2(...q)),
      64,
    ),
    smooth: 0.32,
    ior: 1.45,
    wax: true,
    heatRange: [-1.6, 1.4],
    // Inner radius by height (proxy space), for the glowing liquid.
    profile: [
      [-1.84, 0.5],
      [-1.66, 0.6],
      [-0.98, 0.73],
      [0.12, 0.74],
      [1.2, 0.63],
      [1.94, 0.44],
    ],
  });
    model.add(liquid.mesh);
  setLiquidColours();
  lampLight = new THREE.PointLight(p.b, 9, 7, 2);
  lampLight.position.y = -1.1;
  model.add(lampLight);
}

// --------------------------------------------------------- 03 liquid orbit
function createOrbit() {
  orbitDrift = {
    phase: 0,
    radius: 0.13,
    target: 0.13,
    tilt: 0,
    tiltTarget: 0,
    next: 0,
  };
  const globe = sphere(2.02, glass);
  globe.renderOrder = 9;
  // A turned pedestal: a low disc with a cup that cradles the globe.
  lathe(
    smoothProfile([
      [0, -2.42],
      [1.55, -2.42],
      [1.62, -2.36],
      [1.6, -2.24],
      [1.4, -2.16],
      [0.82, -2.08],
      [0.7, -1.98],
      [0.66, -1.9],
      [0, -1.9],
    ]),
    darkMetal,
  );
  ring(1.58, 0.012, -2.25, brass);
  ring(0.68, 0.016, -1.93, brass);
  orbitRing = mesh(new THREE.TorusGeometry(2.36, 0.022, 20, 220), metal);
  orbitRing.rotation.set(1.12, 0.24, -0.42);
  liquid = studio.makeRaymarchedLiquid({
    geometry: new THREE.SphereGeometry(1.96, 48, 32),
    smooth: 0.34,
    ior: 1.42,
  });
  model.add(liquid.mesh);
  setLiquidColours();
  for (let i = 0; i < 14; i++) {
    const m = sphere(0.02 + (i % 4) * 0.014, glassEdge);
    dynamic.push({ kind: "orbitPearl", mesh: m, i });
  }
}

function makeToy(index) {
  clearModel();
  const options = {
    model,
    materials: { metal, darkMetal, glassEdge, brass },
    palette: palettes[paletteIndex],
    env: studio.environmentTarget.texture,
  };
  if (index === 0) {
    createCascade();
    const drops = dynamic.filter((d) => d.kind === "drop");
    drops.forEach((d) => d.mesh.scale.setScalar(d.r));
    cascadeSimulation = new CascadePhysics(drops);
  }
  if (index === 1) createLava();
  if (index === 2) createOrbit();
  if (index === 3) activeSimulation = createTidalPool(options);
  if (index === 4) activeSimulation = createSandscape(options);
  if (index === 5) activeSimulation = createKineticPendulum(options);
  model.updateWorldMatrix(true, true);
  modelBounds.makeEmpty();
  const inverse = new THREE.Matrix4().copy(model.matrixWorld).invert();
  model.traverse((o) => {
    if (o.geometry && o.visible && !o.isMarchingCubes) {
      o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox.clone();
      b.applyMatrix4(
        new THREE.Matrix4().multiplyMatrices(inverse, o.matrixWorld),
      );
      modelBounds.union(b);
    }
  });
  // The model rests on the floor (y = 0 in anchor space).
  model.position.y = -modelBounds.min.y;
  const height = modelBounds.max.y - modelBounds.min.y;
  const halfW = Math.max(-modelBounds.min.x, modelBounds.max.x);
  const halfD = Math.max(-modelBounds.min.z, modelBounds.max.z);
  frameBox.min.set(-halfW, 0, -halfD);
  frameBox.max.set(halfW, height, halfD);
  if (index === 5) {
    // The pendulum swings beyond its frame; reserve that space.
    frameBox.min.x = Math.min(frameBox.min.x, -2.3);
    frameBox.max.x = Math.max(frameBox.max.x, 2.3);
  }
  addContact(halfW * 2.3, Math.max(halfD * 2.6, 1.4));
  studio.setModel(model);
  studio.setLook(views[index].look);
  model.traverse((o) => {
    if (!o.isMesh) return;
    if (o.userData.liquid) {
      o.castShadow = o.receiveShadow = false;
      return;
    }
    const transmissive = o.material.transmission > 0.5;
    o.castShadow = !transmissive || o.material === oilA || o.material === oilB;
    o.receiveShadow = !transmissive;
  });
}
makeToy(2);

// ------------------------------------------------------------ simulation
function updateToy(t, dt) {
  if (activeSimulation) {
    const steps = Math.max(1, Math.ceil(dt / 0.025));
    for (let i = 0; i < steps; i++) activeSimulation.update(t, dt / steps, 0);
  } else if (toyIndex === 0) {
    const steps = Math.max(1, Math.ceil(dt / 0.025));
    for (let i = 0; i < steps; i++)
      cascadeSimulation.step(dt / steps, flipAngle);
    updateCascadeLiquid();
  } else if (toyIndex === 1) {
    convection.step(dt, 0);
    if (fluidDirty || (dt > 0 && frame % 2 === 0)) {
      liquid.reset();
      for (const n of convection.nodes) {
        // The convection runs in a narrow normalized column; spread it across
        // the lamp's real width. Proxy space: y spans -1.825..1.825.
        const y = (n.y - 0.5) * 2 * 2.75 + 0.1;
        const r = 0.13 + n.strength * 0.66;
        // Keep each blob inside the tapering glass.
        const inner = Math.max(0.05, lampRadius(y) - r * 0.9);
        let x = (n.x - 0.5) * 2 * 2.2 * 1.5,
          z = (n.z - 0.5) * 2 * 2.2 * 1.5;
        const radial = Math.hypot(x, z);
        if (radial > inner) {
          x *= inner / radial;
          z *= inner / radial;
        }
        // Rising and sinking wax stretches along its motion.
        const stretch = 1 + Math.min(0.55, Math.abs(n.vy) * 34);
        const squeeze = 1 / Math.sqrt(stretch);
        liquid.add(x, y, z, r, 0, squeeze, stretch, squeeze);
      }
      // The pool of wax resting on the heater.
      liquid.add(0, -1.8, 0, 0.62, 0, 0.9, 0.32, 0.9);
      liquid.add(-0.12, -1.62, 0.08, 0.2, 0);
      liquid.commit();
      lastFluidTime = t;
    }
  } else if (toyIndex === 2) {
    if (dt > 0) {
      if (t > orbitDrift.next) {
        orbitDrift.target = 0.1 + Math.random() * 0.06;
        orbitDrift.tiltTarget = (Math.random() - 0.5) * 0.17;
        orbitDrift.next = t + 9 + Math.random() * 13;
      }
      orbitDrift.radius = THREE.MathUtils.damp(
        orbitDrift.radius,
        orbitDrift.target,
        0.09,
        dt,
      );
      orbitDrift.tilt = THREE.MathUtils.damp(
        orbitDrift.tilt,
        orbitDrift.tiltTarget,
        0.1,
        dt,
      );
      orbitDrift.phase +=
        dt * (0.035 + orbitDrift.radius * 0.2 + energy * 0.04);
    }
    if (fluidDirty || (t !== lastFluidTime && frame % 2 === 0)) {
      liquid.reset();
      // Two cohesive liquids winding around each other: lobes joined by
      // thinner necks, so each colour reads as one viscous body.
      const n = 15,
        S = 4.2;
      for (let i = 0; i < n; i++) {
        const f = i / (n - 1),
          y = 0.25 + f * 0.5 + Math.sin(f * Math.PI) * orbitDrift.tilt,
          a = f * Math.PI * 1.45 + orbitDrift.phase;
        const radius =
          orbitDrift.radius * 1.2 + 0.03 * Math.sin(f * 4 + orbitDrift.tilt * 7);
        const wobble = Math.sin(t * 1.7 + f * 5) * energy * 0.009;
        const lobeA = Math.pow(
          Math.max(0, Math.sin(f * Math.PI * 2 + 0.5 + t * 0.05)),
          2,
        );
        const lobeB = Math.pow(
          Math.max(0, Math.sin(f * Math.PI * 2 + 2.1 - t * 0.04)),
          2,
        );
        const taper = 0.55 + 0.45 * Math.sin(f * Math.PI);
        liquid.add(
          (Math.sin(a) * radius + wobble) * S,
          (y - 0.5) * S,
          Math.cos(a) * 0.12 * S,
          (0.2 + 0.26 * lobeA) * taper,
          0,
        );
        liquid.add(
          (-Math.sin(a) * radius - wobble) * S,
          (y - 0.5) * S,
          -Math.cos(a) * 0.12 * S,
          (0.2 + 0.24 * lobeB) * taper,
          1,
        );
      }
      // A few satellite droplets that drift away and rejoin.
      for (let k = 0; k < 3; k++) {
        const a = orbitDrift.phase * (1.3 + k * 0.2) + k * 2.1;
        const r = 0.27 + 0.03 * Math.sin(t * 0.21 + k);
        liquid.add(
          Math.cos(a) * r * S,
          Math.sin(a * 0.7 + k) * 0.22 * S,
          Math.sin(a) * r * 0.55 * S,
          0.1,
          k % 2,
        );
      }
      liquid.commit();
      fluidDirty = false;
      lastFluidTime = t;
    }
    for (const d of dynamic) {
      const a = t * 0.055 + d.i * 2.36,
        r = 1.35 + 0.12 * Math.sin(d.i * 3.72);
      d.mesh.position.set(
        Math.cos(a) * r,
        Math.sin(a) * r * 0.86,
        Math.sin(a * 0.63 + d.i) * 0.62,
      );
    }
  }
}

function setLiquidColours() {
  if (!liquid) return;
  const p = palettes[paletteIndex];
  if (toyIndex === 1) {
    liquid.setLiquid(0, p.b, { density: 4.5, scatter: 2.1 });
    const medium = new THREE.Color(p.a).lerp(new THREE.Color(p.b), 0.35);
    liquid.setMedium(medium, 0.2);
  } else if (toyIndex === 0) {
    liquid.setLiquid(0, p.a, { density: 3.2, scatter: 0.22 });
    liquid.setLiquid(1, p.b, { density: 3.2, scatter: 0.22 });
  } else {
    liquid.setLiquid(0, p.a, { density: 1.9, scatter: 0.16 });
    liquid.setLiquid(1, p.b, { density: 1.9, scatter: 0.16 });
  }
}
function applyPalette(index) {
  paletteIndex = index;
  const p = palettes[index];
  studio.tintLiquid(oilA, p.a);
  studio.tintLiquid(oilB, p.b);
  setLiquidColours();
  lampLight?.color.set(p.b);
  lampGlow?.material.color.set(p.b).multiplyScalar(2.2);
  document.querySelectorAll(".swatch").forEach((b, i) => {
    b.classList.toggle("active", i === index);
    b.setAttribute("aria-pressed", i === index);
  });
  activeSimulation?.setPalette(p);
  fluidDirty = true;
  toast(p.name);
}
function setToy(index) {
  if (index === toyIndex) return;
  toyIndex = index;
  simTime = 10;
  targetYaw = yaw = index === 5 || index === 0 ? -0.18 : -0.28;
  targetPitch = pitch = 0;
  zoom = 1;
  makeToy(index);
  qualityAdjusted = false;
  sampleStart = performance.now();
  frames = 0;
  $("#toy-title").textContent = toys[index].title.replace(" ", "\n");
  $("#toy-number").textContent = String(index + 1).padStart(2, "0");
  $("#hero-action").textContent = toys[index].action;
  $("#toy-desc").textContent = toys[index].desc;
  $("#interact").setAttribute("aria-label", toys[index].action);
  $("#interact").title = toys[index].action + " (R)";
  document.querySelectorAll(".toy").forEach((b, i) => {
    b.classList.toggle("active", i === index);
    b.setAttribute("aria-pressed", i === index);
    if (i === index)
      b.scrollIntoView({
        block: "nearest",
        inline: "nearest",
        behavior: "smooth",
      });
  });
  stage.setAttribute(
    "aria-label",
    toys[index].title + ". 드래그하면 다른 각도로 볼 수 있습니다.",
  );
  resize();
}
function setPaused(value) {
  fluidDirty = true;
  paused = value;
  $("#pause-icon").hidden = paused;
  $("#play-icon").hidden = !paused;
  $("#play").setAttribute("aria-label", paused ? "재생" : "일시정지");
  $("#play").title = paused ? "재생 (Space)" : "일시정지 (Space)";
}
function interact() {
  if (paused) setPaused(false);
  if (toyIndex === 0) {
    flipTarget += Math.PI;
  } else {
    energy = 3;
    activeSimulation?.kick?.();
    convection?.kick();
  }
  fluidDirty = true;
  toast(toys[toyIndex].hint);
}
let toastTimer;
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 2100);
}
function toggleFocus(force) {
  const on =
    typeof force === "boolean"
      ? force
      : !document.body.classList.contains("immersive");
  document.body.classList.toggle("immersive", on);
  $("#focus").setAttribute("aria-pressed", on);
  (on ? $("#exit-focus") : $("#focus")).focus({ preventScroll: true });
  resize();
}
document
  .querySelectorAll("[data-toy]")
  .forEach((b) => b.addEventListener("click", () => setToy(+b.dataset.toy)));
document
  .querySelectorAll("[data-palette]")
  .forEach((b) =>
    b.addEventListener("click", () => applyPalette(+b.dataset.palette)),
  );
$("#hero-interact").onclick = interact;
$("#play").onclick = () => setPaused(!paused);
$("#speed").onclick = () => {
  const rates = [0.5, 1, 1.5, 2];
  speed = rates[(rates.indexOf(speed) + 1) % rates.length];
  $("#speed").textContent = speed + "×";
  $("#speed").setAttribute("aria-label", "재생 속도 " + speed + "배");
};
$("#interact").onclick = interact;
$("#focus").onclick = () => toggleFocus();
$("#exit-focus").onclick = () => toggleFocus(false);
window.addEventListener("keydown", (e) => {
  if (
    e.ctrlKey ||
    e.metaKey ||
    e.altKey ||
    e.target.matches("input,textarea,select,[contenteditable]")
  )
    return;
  if (
    e.target.tagName === "BUTTON" &&
    (e.code === "Space" || e.code === "Enter")
  )
    return;
  if (e.code === "Space") {
    e.preventDefault();
    setPaused(!paused);
  }
  if (e.code === "KeyH") toggleFocus();
  if (e.code === "Escape") toggleFocus(false);
  if (e.code === "KeyR") interact();
  if (
    ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6"].includes(
      e.code,
    )
  )
    setToy(+e.code.slice(-1) - 1);
});
const PITCH_MIN = -0.06,
  PITCH_MAX = 0.42;
function homeView() {
  targetYaw = toyIndex === 5 || toyIndex === 0 ? -0.18 : -0.28;
  targetPitch = 0;
  zoom = 1;
}
stage.addEventListener("keydown", (e) => {
  if (
    [
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "Equal",
      "Minus",
      "NumpadAdd",
      "NumpadSubtract",
      "Home",
    ].includes(e.code)
  ) {
    e.preventDefault();
    fluidDirty = true;
    if (e.code === "ArrowLeft") targetYaw -= 0.15;
    if (e.code === "ArrowRight") targetYaw += 0.15;
    if (e.code === "ArrowUp")
      targetPitch = Math.min(PITCH_MAX, targetPitch + 0.06);
    if (e.code === "ArrowDown")
      targetPitch = Math.max(PITCH_MIN, targetPitch - 0.06);
    if (["Equal", "NumpadAdd"].includes(e.code))
      zoom = Math.max(0.82, zoom - 0.04);
    if (["Minus", "NumpadSubtract"].includes(e.code))
      zoom = Math.min(1.25, zoom + 0.04);
    if (e.code === "Home") homeView();
  }
});
let pointer = null;
stage.addEventListener("pointerdown", (e) => {
  pointer = { x: e.clientX, y: e.clientY, id: e.pointerId };
  stage.setPointerCapture(e.pointerId);
});
stage.addEventListener("pointermove", (e) => {
  if (!pointer) return;
  fluidDirty = true;
  targetYaw += (e.clientX - pointer.x) * 0.007;
  targetPitch += (e.clientY - pointer.y) * 0.003;
  targetPitch = THREE.MathUtils.clamp(targetPitch, PITCH_MIN, PITCH_MAX);
  pointer.x = e.clientX;
  pointer.y = e.clientY;
});
stage.addEventListener("pointerup", () => (pointer = null));
stage.addEventListener("pointercancel", () => (pointer = null));
stage.addEventListener("dblclick", () => {
  homeView();
  toast("처음 시점으로 돌아왔어요");
});
stage.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    fluidDirty = true;
    zoom = THREE.MathUtils.clamp(zoom + e.deltaY * 0.00025, 0.82, 1.25);
  },
  { passive: false },
);

// ----------------------------------------------------------------- layout
// The object is framed inside the space the interface actually leaves free.
const layoutRect = { x: 0, y: 0, w: 1, h: 1 };
function measureLayout() {
  const w = stage.clientWidth,
    h = stage.clientHeight;
  const immersed = document.body.classList.contains("immersive");
  if (immersed) {
    Object.assign(layoutRect, {
      x: w * 0.12,
      y: h * 0.09,
      w: w * 0.76,
      h: h * 0.8,
    });
    return;
  }
  const box = (s) => $(s).getBoundingClientRect();
  const header = box("header"),
    intro = box(".intro"),
    transport = box(".transport");
  const transportCenter = (transport.left + transport.right) / 2;
  const sideBySide = intro.right < w * 0.6 && w > 700;
  if (sideBySide) {
    const left = intro.right + 36,
      right = w - Math.max(64, w * 0.055);
    const half = Math.max(
      80,
      Math.min(transportCenter - left, right - transportCenter),
    );
    const top = header.bottom + 18,
      bottom = transport.top - 22;
    Object.assign(layoutRect, {
      x: transportCenter - half,
      y: top,
      w: half * 2,
      h: Math.max(80, bottom - top),
    });
  } else {
    const top = intro.bottom + 6,
      bottom = transport.top - 10;
    Object.assign(layoutRect, {
      x: 14,
      y: top,
      w: w - 28,
      h: Math.max(80, bottom - top),
    });
  }
}
function frameView() {
  const w = stage.clientWidth,
    h = stage.clientHeight;
  studio.frame(
    frameBox,
    layoutRect,
    w,
    h,
    views[toyIndex].elevation + pitch,
    zoom,
  );
}
function resize() {
  fluidDirty = true;
  const w = stage.clientWidth,
    h = stage.clientHeight;
  renderer.setSize(w, h);
  measureLayout();
  frameView();
}
window.addEventListener("resize", resize);
resize();
setPaused(paused);

let last = performance.now(),
  sampleStart = last,
  frames = 0,
  qualityAdjusted = false,
  lastZoom = zoom,
  lastPitch = pitch;
function flipLift(angle) {
  // A turned vessel rotates about its centre and is lifted clear of the floor.
  const h = modelBounds.max.y - modelBounds.min.y,
    w = modelBounds.max.x - modelBounds.min.x;
  const c = Math.abs(Math.cos(angle)),
    s = Math.abs(Math.sin(angle));
  return (h / 2) * c + (w / 2) * s - h / 2;
}
function tick(now) {
  requestAnimationFrame(tick);
  if (document.hidden) {
    last = now;
    return;
  }
  const dt = Math.min((now - last) / 1000, 0.045);
  last = now;
  frame++;
  const moving =
    Math.abs(yaw - targetYaw) +
      Math.abs(pitch - targetPitch) +
      Math.abs(zoom - lastZoom) +
      (paused ? 0 : Math.abs(flipAngle - flipTarget)) >
    0.0001;
  if (paused && !moving && !fluidDirty && frame > 3) return;
  if (!paused) {
    simTime += dt * speed;
    energy = Math.max(0, energy - dt * 0.6);
  }
  yaw = THREE.MathUtils.damp(yaw, targetYaw, 5, dt);
  pitch = THREE.MathUtils.damp(pitch, targetPitch, 5, dt);
  if (!paused) flipAngle = THREE.MathUtils.damp(flipAngle, flipTarget, 4, dt);
  anchor.rotation.y = yaw;
  if (Math.abs(pitch - lastPitch) > 1e-5 || zoom !== lastZoom) {
    frameView();
    lastPitch = pitch;
    lastZoom = zoom;
  }
  // Gravity is transformed into vessel space continuously throughout the flip.
  // The vessel turns about its centre and is lifted so it clears the floor.
  if (toyIndex === 0) {
    model.rotation.z = flipAngle;
    lift.position.y = flipLift(flipAngle);
  }
  updateToy(simTime, paused ? 0 : dt * speed);
  fluidDirty = false;
  studio.render();
  frames++;
  stage.dataset.flipAngle = flipAngle.toFixed(6);
  stage.dataset.currentToy = String(toyIndex);
  stage.dataset.simTime = simTime.toFixed(3);
  stage.dataset.renderFrame = String(frame);
  stage.dataset.geometries = String(renderer.info.memory.geometries);
  if (!paused && !qualityAdjusted && now - sampleStart > 6000) {
    const fps = (frames * 1000) / (now - sampleStart);
    if (fps < 30) renderer.setPixelRatio(Math.min(devicePixelRatio, 1));
    qualityAdjusted = true;
    resize();
  }
  if (frame === 3) {
    $("#loading").style.opacity = 0;
    setTimeout(() => ($("#loading").hidden = true), 450);
  }
}
requestAnimationFrame(tick);
renderer.domElement.addEventListener("webglcontextlost", (e) => {
  e.preventDefault();
  $("#webgl-error").hidden = false;
});
// Progressive enhancement: the same public controls can be used by supporting agents.
if (document.modelContext?.registerTool) {
  try {
    document.modelContext.registerTool({
      name: "configure_liquid_toy",
      title: "물멍 장난감 조절",
      description:
        "Select a liquid toy, palette, speed, and playback state using the same visible controls.",
      inputSchema: {
        type: "object",
        properties: {
          toy: { type: "integer", minimum: 0, maximum: 5 },
          palette: { type: "integer", minimum: 0, maximum: 2 },
          paused: { type: "boolean" },
          speed: { type: "number", enum: [0.5, 1, 1.5, 2] },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      execute: (input) => {
        if (
          input.toy !== undefined &&
          (!Number.isInteger(input.toy) || input.toy < 0 || input.toy > 5)
        )
          throw Error("Invalid toy");
        if (
          input.palette !== undefined &&
          (!Number.isInteger(input.palette) ||
            input.palette < 0 ||
            input.palette > 2)
        )
          throw Error("Invalid palette");
        if (
          input.speed !== undefined &&
          ![0.5, 1, 1.5, 2].includes(input.speed)
        )
          throw Error("Invalid speed");
        if (input.paused !== undefined && typeof input.paused !== "boolean")
          throw Error("Invalid pause");
        if (input.toy !== undefined) setToy(input.toy);
        if (input.palette !== undefined) applyPalette(input.palette);
        if (input.paused !== undefined) setPaused(input.paused);
        if (input.speed !== undefined) {
          speed = input.speed;
          $("#speed").textContent = speed + "×";
          $("#speed").setAttribute("aria-label", "재생 속도 " + speed + "배");
        }
        return { toy: toyIndex, palette: paletteIndex, paused, speed };
      },
    });
  } catch (e) {
    console.info("Optional control integration unavailable");
  }
}
