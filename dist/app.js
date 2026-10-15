import * as THREE from "three";
import { CascadePhysics } from "./cascade-physics.js";
import { createTidalPool } from "./tidal-pool.js";
import { createSandscape } from "./sandscape.js";
import { createKineticPendulum } from "./kinetic-pendulum.js";
import { ConvectionSystem } from "./fluid-dynamics.js";
import { createStudio } from "./studio.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { MarchingCubes } from "three/addons/objects/MarchingCubes.js";

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
let studio;
try {
  studio = createStudio(stage, palettes[0]);
} catch (error) {
  $("#loading").hidden = true;
  $("#webgl-error").hidden = false;
  throw error;
}
const {
  renderer,
  scene,
  camera,
  anchor,
  mirror,
  contact,
  glass,
  glassEdge,
  metal,
  darkMetal,
  oilA,
  oilB,
  glowA,
  glowB,
} = studio;
let model = new THREE.Group();
anchor.add(model);
const sharedMaterials = new Set([
  glass,
  glassEdge,
  metal,
  darkMetal,
  oilA,
  oilB,
  glowA,
  glowB,
]);
const sphereGeo = new THREE.SphereGeometry(1, 48, 32);
let dynamic = [],
  fluid = null,
  fluid2 = null,
  toyIndex = 2,
  paletteIndex = 0;
let simTime = 10,
  paused = matchMedia("(prefers-reduced-motion: reduce)").matches,
  speed = 1,
  energy = 0,
  flipTarget = 0,
  flipAngle = 0;
let yaw = -0.11,
  pitch = 0.015,
  targetYaw = -0.11,
  targetPitch = 0.015,
  zoom = 1,
  frame = 0;
let activeSimulation = null,
  cascadeSimulation = null,
  convection = null,
  modelMinY = -2.3;
const modelBounds = new THREE.Box3();
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
  ownedLights = [],
  orbitRing = null;
function mesh(geo, mat, parent = model) {
  const m = new THREE.Mesh(geo, mat);
  parent.add(m);
  m.castShadow = mat.transmission !== 1;
  return m;
}
function box(w, h, d, r, mat, parent = model) {
  return mesh(new RoundedBoxGeometry(w, h, d, 5, r), mat, parent);
}
function sphere(r, mat, parent = model) {
  const m = mesh(sphereGeo, mat, parent);
  m.scale.setScalar(r);
  return m;
}
function ring(r, t, y, mat, parent = model) {
  const m = mesh(new THREE.TorusGeometry(r, t, 12, 80), mat, parent);
  m.rotation.x = Math.PI / 2;
  m.position.y = y;
  return m;
}
function roundOutline(w, h, r, z, mat, t = 0.027) {
  const pts = [];
  for (let i = 0; i < 4; i++) {
    const cx = (i === 0 || i === 3 ? 1 : -1) * (w / 2 - r),
      cy = (i < 2 ? 1 : -1) * (h / 2 - r);
    for (let j = 0; j <= 12; j++) {
      const angle = (i * 0.5 + (j / 12) * 0.5) * Math.PI;
      pts.push(
        new THREE.Vector3(
          cx + r * Math.cos(angle),
          cy + r * Math.sin(angle),
          z,
        ),
      );
    }
  }
  const c = new THREE.CatmullRomCurve3(pts, true);
  return mesh(new THREE.TubeGeometry(c, 128, t, 8, true), mat);
}
function clearModel() {
  activeSimulation?.dispose?.();
  activeSimulation = null;
  cascadeSimulation = null;
  convection = null;
  anchor.remove(model);
  const geometries = new Set(),
    materials = new Set();
  model.traverse((o) => {
    if (o.geometry && o.geometry !== sphereGeo) geometries.add(o.geometry);
    if (o.material && !sharedMaterials.has(o.material))
      materials.add(o.material);
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
  model = new THREE.Group();
  anchor.add(model);
  dynamic = [];
  fluid = null;
  fluid2 = null;
  orbitRing = null;
  ownedLights = [];
  flipAngle = flipTarget = 0;
  energy = 0;
  fluidDirty = true;
}
function createCascade() {
  const body = box(2.64, 5.64, 0.78, 0.29, glass);
  body.renderOrder = 8;
  roundOutline(2.61, 5.6, 0.29, 0.39, glassEdge, 0.034);
  roundOutline(2.61, 5.6, 0.29, -0.39, glassEdge, 0.024);
  for (const y of [-2.48, 2.48]) {
    const cap = box(2.62, 0.64, 0.83, 0.1, darkMetal);
    cap.position.y = y;
  }
  const rampMaterial = new THREE.MeshStandardMaterial({
    color: "#69797b",
    metalness: 0.6,
    roughness: 0.28,
  });
  // Six thin, visible baffles. Opaque baffles also remain in the glass refraction pass.
  for (let i = 0; i < 6; i++) {
    const side = i % 2 === 0 ? 1 : -1,
      y = 1.52 - i * 0.6;
    const ramp = box(1.92, 0.045, 0.47, 0.02, rampMaterial);
    ramp.position.set(-side * 0.19, y, 0);
    ramp.rotation.z = -side * 0.2;
    const rail = mesh(
      new THREE.CylinderGeometry(0.013, 0.013, 1.95, 10),
      rampMaterial,
    );
    rail.rotation.z = Math.PI / 2 - side * 0.2;
    rail.position.set(-side * 0.19, y + 0.018, 0.255);
  }
  // Clear upper feeder cups and saturated liquid reservoirs.
  for (let i = 0; i < 2; i++) {
    const x = i ? 0.57 : -0.57,
      mat = i ? oilB : oilA;
    const cup = box(1.11, 0.58, 0.59, 0.18, glassEdge);
    cup.position.set(x, 2.27, 0);
    const pond = sphere(0.49, mat);
    pond.position.set(x, 2.2, 0);
    pond.scale.set(0.48, 0.11, 0.25);
    const meniscus = ring(0.43, 0.015, 2.23, mat);
    meniscus.position.x = x;
    meniscus.scale.set(1, 0.59, 1);
    const neck = sphere(0.06, mat);
    neck.position.set(x, 2.02, 0);
    neck.scale.set(0.065, 0.18, 0.064);
    dynamic.push({ kind: "neck", mesh: neck, i });
    const pool = sphere(0.51, mat);
    pool.position.set(x, -2.42, 0);
    pool.scale.set(0.61, 0.145, 0.27);
    dynamic.push({ kind: "pool", mesh: pool, i });
  }
  for (let i = 0; i < 32; i++) {
    const m = sphere(0.12, i % 2 ? glowB : glowA);
    dynamic.push({
      kind: "drop",
      mesh: m,
      i,
      r: 0.075 + (Math.sin(i * 31.7) * 0.5 + 0.5) * 0.07,
      offset: i * 0.947,
    });
  }
}
function lathe(points, mat) {
  return mesh(
    new THREE.LatheGeometry(
      points.map((p) => new THREE.Vector2(...p)),
      96,
    ),
    mat,
  );
}
function createLava() {
  convection = new ConvectionSystem(6);
  lathe(
    [
      [0, -2.8],
      [0.81, -2.8],
      [0.88, -2.7],
      [0.81, -2.57],
      [0.52, -1.88],
      [0.54, -1.75],
      [0, -1.75],
    ],
    metal,
  );
  ring(0.82, 0.025, -2.72, glassEdge);
  ring(0.53, 0.033, -1.79, metal);
  const vessel = lathe(
    [
      [0, -1.78],
      [0.5, -1.78],
      [0.62, -1.64],
      [0.78, -0.93],
      [0.76, 0.35],
      [0.62, 1.51],
      [0.39, 2.24],
      [0.35, 2.36],
      [0, 2.36],
    ],
    glass,
  );
  vessel.renderOrder = 9;
  lathe(
    [
      [0, 2.24],
      [0.37, 2.24],
      [0.4, 2.35],
      [0.33, 2.68],
      [0.29, 2.74],
      [0, 2.74],
    ],
    metal,
  );
  ring(0.37, 0.024, 2.34, glassEdge);
  const baseGlow = mesh(
    new THREE.CylinderGeometry(0.46, 0.43, 0.06, 64),
    new THREE.MeshBasicMaterial({ color: palettes[paletteIndex].b }),
  );
  baseGlow.position.y = -1.76;
  fluid = new MarchingCubes(48, glowB, false, false, 24000);
  fluid.isolation = 65;
  fluid.scale.set(1.27, 2.75, 1.27);
  fluid.position.y = 0.1;
  model.add(fluid);
  const light = new THREE.PointLight(palettes[paletteIndex].b, 1.8, 4);
  light.position.y = -1.35;
  model.add(light);
  ownedLights.push(light);
  ownedLights.push(baseGlow.material);
}
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
  const stand = mesh(
    new THREE.CylinderGeometry(2.08, 2.13, 0.23, 96),
    darkMetal,
  );
  stand.position.y = -2.17;
  ring(2.09, 0.013, -2.06, metal);
  const seat = mesh(new THREE.CylinderGeometry(0.48, 0.65, 0.15, 64), metal);
  seat.position.y = -1.98;
  orbitRing = mesh(new THREE.TorusGeometry(2.31, 0.027, 16, 180), metal);
  orbitRing.rotation.set(1.12, 0.24, -0.42);
  fluid = new MarchingCubes(52, oilA, false, false, 26000);
  fluid.isolation = 65;
  fluid.scale.setScalar(2.1);
  model.add(fluid);
  fluid2 = new MarchingCubes(48, oilB, false, false, 22000);
  fluid2.isolation = 65;
  fluid2.scale.setScalar(2.1);
  model.add(fluid2);
  for (let i = 0; i < 12; i++) {
    let m = sphere(0.022 + (i % 4) * 0.018, glassEdge);
    dynamic.push({ kind: "orbitPearl", mesh: m, i });
  }
}
function makeToy(index) {
  clearModel();
  const options = {
    model,
    materials: { metal, darkMetal, glassEdge },
    palette: palettes[paletteIndex],
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
    if (o.geometry) {
      o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox.clone();
      b.applyMatrix4(
        new THREE.Matrix4().multiplyMatrices(inverse, o.matrixWorld),
      );
      modelBounds.union(b);
    }
  });
  // The pendulum can swing beyond the frame's initial static bounds.
  if (index === 5) {
    modelBounds.min.x = -2.55;
    modelBounds.max.x = 2.55;
  }
  modelMinY = modelBounds.min.y;
  studio.setModel(model);
  model.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = !o.material.transmission;
      o.receiveShadow = !o.material.transmission;
    }
  });
}
makeToy(2);

function updateToy(t, dt) {
  if (activeSimulation) {
    // Modules use accumulated state; fixed substeps preserve speed and pause semantics.
    const steps = Math.max(1, Math.ceil(dt / 0.025));
    for (let i = 0; i < steps; i++) activeSimulation.update(t, dt / steps, 0);
  } else if (toyIndex === 0) {
    const steps = Math.max(1, Math.ceil(dt / 0.025));
    for (let i = 0; i < steps; i++)
      cascadeSimulation.step(dt / steps, flipAngle);
  } else if (toyIndex === 1) {
    convection.step(dt, 0);
    if (fluidDirty || (dt > 0 && frame % 2 === 0)) {
      fluid.reset();
      for (const n of convection.nodes)
        fluid.addBall(n.x, n.y, n.z, n.strength, 12);
      fluid.addBall(0.5, 0.18, 0.5, 0.42, 12);
      fluid.update();
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
      fluid.reset();
      fluid2.reset();
      // Two cohesive, rounded streams. A slow helical drift preserves surface tension;
      // the impulse adds damped lateral displacement, rather than teleporting droplets.
      for (let i = 0; i < 8; i++) {
        const f = i / 7,
          y = 0.23 + f * 0.54 + Math.sin(f * Math.PI) * orbitDrift.tilt,
          a = f * Math.PI * 1.65 + orbitDrift.phase;
        const radius =
          orbitDrift.radius + 0.02 * Math.sin(f * 4 + orbitDrift.tilt * 7);
        const wobble = Math.sin(t * 1.7 + f * 5) * energy * 0.009;
        fluid.addBall(
          0.5 + Math.sin(a) * radius + wobble,
          y,
          0.5 + Math.cos(a) * 0.12,
          0.55 + 0.22 * Math.sin(f * Math.PI),
          12,
        );
        fluid2.addBall(
          0.5 - Math.sin(a) * radius - wobble,
          y,
          0.5 - Math.cos(a) * 0.12,
          0.51 + 0.2 * Math.sin(f * Math.PI),
          12,
        );
      }
      fluid.update();
      fluid2.update();
      fluidDirty = false;
      lastFluidTime = t;
    }
    for (const d of dynamic) {
      const a = t * 0.055 + d.i * 2.36,
        r = 1.4 + 0.1 * Math.sin(d.i * 3.72);
      d.mesh.position.set(
        Math.cos(a) * r,
        Math.sin(a) * r * 0.88,
        Math.sin(a * 0.63 + d.i) * 0.6,
      );
    }
  }
}

function applyPalette(index) {
  paletteIndex = index;
  const p = palettes[index];
  oilA.color.set(p.a);
  oilB.color.set(p.b);
  oilA.color.lerp(new THREE.Color(0xffffff), 0.08);
  oilB.color.lerp(new THREE.Color(0xffffff), 0.08);
  oilA.attenuationColor.set(p.a);
  oilB.attenuationColor.set(p.b);
  glowA.color.set(p.a);
  glowB.color.set(p.b);
  ownedLights.forEach((o) => o.color.set(p.b));
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
  targetYaw = -0.11;
  targetPitch = index === 3 || index === 4 ? 0 : 0.015;
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
    if (e.code === "ArrowUp") targetPitch = Math.max(-0.24, targetPitch - 0.06);
    if (e.code === "ArrowDown")
      targetPitch = Math.min(0.24, targetPitch + 0.06);
    if (["Equal", "NumpadAdd"].includes(e.code))
      zoom = Math.max(0.86, zoom - 0.04);
    if (["Minus", "NumpadSubtract"].includes(e.code))
      zoom = Math.min(1.18, zoom + 0.04);
    if (e.code === "Home") {
      targetYaw = -0.11;
      targetPitch = 0.015;
      zoom = 1;
    }
    resize();
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
  targetPitch = THREE.MathUtils.clamp(targetPitch, -0.24, 0.24);
  pointer.x = e.clientX;
  pointer.y = e.clientY;
});
stage.addEventListener("pointerup", () => (pointer = null));
stage.addEventListener("pointercancel", () => (pointer = null));
stage.addEventListener("dblclick", () => {
  targetYaw = -0.11;
  targetPitch = 0.015;
  zoom = 1;
  resize();
  toast("처음 시점으로 돌아왔어요");
});
stage.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    zoom = THREE.MathUtils.clamp(zoom + e.deltaY * 0.00025, 0.86, 1.18);
    resize();
  },
  { passive: false },
);
function resize() {
  fluidDirty = true;
  const w = stage.clientWidth,
    h = stage.clientHeight,
    mobile = w <= 700,
    landscape = h < 500 && w > h;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  const trayView = toyIndex === 3 || toyIndex === 4;
  camera.position.set(
    0,
    trayView ? 7 * zoom : 0.25,
    trayView ? 14 * zoom : 15 * zoom,
  );
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  const immersed = document.body.classList.contains("immersive");
  const worldHeight =
    (2 * Math.tan(THREE.MathUtils.degToRad(16)) * camera.position.length()) /
    zoom;
  const bottom = landscape ? 150 : mobile ? 174 : Math.min(190, h * 0.24),
    top = landscape ? 65 : mobile ? (h < 700 ? 220 : 238) : 85;
  const available = immersed ? h * 0.83 : h - top - bottom;
  const span = Math.max(1, modelBounds.max.x - modelBounds.min.x);
  const widthLimit = (worldHeight * (w / h) * (mobile ? 0.88 : 0.48)) / span;
  const sc = Math.min(
    widthLimit,
    toyIndex === 3 || toyIndex === 4 ? 1.7 : 1.35,
    Math.max(
      0.25,
      ((available / h) * worldHeight) /
        (toyIndex === 3 || toyIndex === 4 ? 4.4 : toyIndex === 2 ? 5.1 : 5.7),
    ),
  );
  const centerY = immersed
    ? h * 0.47
    : top + available * (toyIndex === 2 ? 0.4 : 0.48);
  const offsetX = mobile || immersed ? 0 : worldHeight * (w / h) * 0.155 * zoom;
  anchor.scale.setScalar(sc);
  anchor.position.set(
    offsetX,
    (0.5 - centerY / h) * worldHeight * zoom +
      (toyIndex === 3 ? 0.5 : toyIndex === 4 ? 1.2 : 0) * sc,
    0,
  );
  const modelFloor = modelMinY;
  mirror.position.set(
    anchor.position.x,
    anchor.position.y + modelFloor * sc,
    0,
  );
  contact.position.set(anchor.position.x, mirror.position.y + 0.008, 0);
  contact.scale.setScalar(sc);
}
window.addEventListener("resize", resize);
resize();
setPaused(paused);
let last = performance.now(),
  sampleStart = last,
  frames = 0,
  qualityAdjusted = false;
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
  anchor.rotation.x = pitch;
  // Gravity is transformed into vessel space continuously throughout the flip.

  model.rotation.z = flipAngle;
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
    if (fps < 30) {
      renderer.setPixelRatio(Math.min(devicePixelRatio, 1));
      mirror.getRenderTarget().setSize(256, 256);
    }
    qualityAdjusted = true;
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
