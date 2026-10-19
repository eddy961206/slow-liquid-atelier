import * as THREE from "three";
import { stoneTextures } from "./textures.js";

// A shallow elliptical stone basin with a damped finite-difference water
// surface. The water refracts the basin floor, and the floor carries caustics
// computed from the live wave field: wave crests focus light, troughs spread it.
export function createTidalPool({ model, materials, palette, env }) {
  const group = new THREE.Group();
  group.position.y = -0.5;
  group.rotation.x = 0;
  model.add(group);
  const stoneTex = stoneTextures({
    size: 512,
    base: "#8d897f",
    dark: "#6e6a62",
    light: "#aaa59a",
    speckle: 0.7,
    period: 5,
    seed: 11,
    repeat: [2, 1.3],
  });
  const ceramic = new THREE.MeshPhysicalMaterial({
    color: "#ffffff",
    map: stoneTex.map,
    bumpMap: stoneTex.bump,
    bumpScale: 1.2,
    roughness: 0.82,
    metalness: 0,
  });
  const bottomMaterial = new THREE.MeshPhysicalMaterial({
    color: "#b4bdb6",
    map: stoneTex.map,
    bumpMap: stoneTex.bump,
    bumpScale: 0.8,
    roughness: 0.55,
  });
  const waterMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.02,
    metalness: 0,
    transmission: 1,
    thickness: 0.45,
    ior: 1.333,
    transparent: false,
    opacity: 1,
    specularIntensity: 1,
    attenuationColor: new THREE.Color(0x4f8a84),
    attenuationDistance: 1.4,
    side: THREE.FrontSide,
  });
  if (env) {
    waterMaterial.envMap = env;
    waterMaterial.envMapIntensity = 0.28;
  }
  waterMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = "varying vec2 vWaterXZ;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\nvWaterXZ = position.xz;",
    );
    shader.fragmentShader = "varying vec2 vWaterXZ;\n" + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <clipping_planes_fragment>",
      "#include <clipping_planes_fragment>\nif(dot(vWaterXZ/vec2(2.205,1.365),vWaterXZ/vec2(2.205,1.365))>1.)discard;",
    );
  };
  waterMaterial.customProgramCacheKey = () => "atelier-water-v2";

  // Basin: a thick honed-stone lip around a recessed floor.
  const bottom = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 0.15, 128),
    bottomMaterial,
  );
  bottom.scale.set(2.18, 1, 1.34);
  bottom.position.y = -0.34;
  group.add(bottom);
  const profile = [
    [0.9, -0.27],
    [0.975, -0.26],
    [1.005, -0.19],
    [1.012, 0.02],
    [1.02, 0.065],
    [1.045, 0.085],
    [1.11, 0.085],
    [1.14, 0.06],
    [1.15, -0.05],
    [1.14, -0.36],
    [1.12, -0.41],
    [0.9, -0.41],
  ]
    // Outer wall first so Lathe normals face out of the stone everywhere.
    .reverse()
    .map(([x, y]) => new THREE.Vector2(x, y));
  const rim = new THREE.Mesh(
    new THREE.LatheGeometry(
      new THREE.SplineCurve(profile).getPoints(90),
      160,
    ),
    ceramic,
  );
  rim.scale.set(2.18, 1, 1.34);
  group.add(rim);

  // Smooth river pebbles resting under the water.
  const pebbleGeometry = new THREE.SphereGeometry(1, 32, 20);
  const pebbleColors = ["#55585a", "#6f6b63", "#3f4245", "#7d786e", "#4b4d4a"];
  const pebbles = [
    [0.9, 0.35, 0.16, 0.055, 0.12, 0.5],
    [1.18, 0.12, 0.11, 0.045, 0.09, 1.3],
    [-0.4, 0.62, 0.13, 0.05, 0.1, 2.0],
    [0.35, -0.55, 0.1, 0.04, 0.08, 0.2],
    [-1.05, 0.25, 0.09, 0.035, 0.07, 2.6],
    [1.45, -0.3, 0.14, 0.05, 0.11, 0.9],
    [-0.1, 0.05, 0.075, 0.03, 0.06, 1.7],
  ];
  pebbles.forEach(([x, z, sx, sy, sz, rot], k) => {
    const m = new THREE.Mesh(
      pebbleGeometry,
      new THREE.MeshPhysicalMaterial({
        color: pebbleColors[k % pebbleColors.length],
        roughness: 0.5,
      }),
    );
    m.scale.set(sx, sy, sz);
    m.rotation.y = rot;
    m.position.set(x, -0.265 + sy * 0.55, z);
    group.add(m);
  });

  const nx = 81,
    nz = 55,
    count = nx * nz;
  const rx = 2.21,
    rz = 1.37,
    dx = (rx * 2) / (nx - 1),
    dz = (rz * 2) / (nz - 1);
  const height = new Float32Array(count),
    velocity = new Float32Array(count);
  const active = new Uint8Array(count);
  const positions = new Float32Array(count * 3),
    indices = [];
  for (let z = 0; z < nz; z++) {
    for (let x = 0; x < nx; x++) {
      const i = z * nx + x,
        px = x * dx - rx,
        pz = z * dz - rz;
      positions[i * 3] = px;
      positions[i * 3 + 1] = -0.015;
      positions[i * 3 + 2] = pz;
      active[i] = (px * px) / (rx * rx) + (pz * pz) / (rz * rz) <= 1 ? 1 : 0;
    }
  }
  for (let z = 0; z < nz - 1; z++) {
    for (let x = 0; x < nx - 1; x++) {
      const a = z * nx + x,
        b = a + 1,
        c = a + nx,
        d = c + 1;
      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(positions, 3);
  positionAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", positionAttribute);
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const water = new THREE.Mesh(geometry, waterMaterial);
  group.add(water);

  // One rounded river stone rises through the water near the rear edge.
  const stoneMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x6d6c66,
    map: stoneTex.map,
    bumpMap: stoneTex.bump,
    bumpScale: 1.5,
    roughness: 0.7,
  });
  const stone = new THREE.Mesh(
    new THREE.SphereGeometry(1, 40, 24),
    stoneMaterial,
  );
  stone.position.set(-1.35, -0.12, -0.58);
  stone.scale.set(0.28, 0.2, 0.21);
  group.add(stone);
  // Remove covered cells from propagation; the submerged stone reflects waves.
  for (let i = 0; i < count; i++) {
    const sx = (positions[i * 3] + 1.35) / 0.255;
    const sz = (positions[i * 3 + 2] + 0.58) / 0.19;
    if (sx * sx + sz * sz < 1) active[i] = 0;
  }

  // The wave heightfield as a texture, read by the basin floor for caustics.
  const heightData = new Float32Array(count);
  const heightTexture = new THREE.DataTexture(
    heightData,
    nx,
    nz,
    THREE.RedFormat,
    THREE.FloatType,
  );
  heightTexture.magFilter = heightTexture.minFilter = THREE.LinearFilter;
  heightTexture.needsUpdate = true;
  const causticUniforms = {
    causticHeight: { value: heightTexture },
    causticTexel: { value: new THREE.Vector2(1 / nx, 1 / nz) },
    causticTime: { value: 0 },
  };
  bottomMaterial.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, causticUniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vPool;")
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvPool = position.xz * vec2(2.18, 1.34);",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform sampler2D causticHeight;uniform vec2 causticTexel;uniform float causticTime;varying vec2 vPool;
        float ambientCaustic(vec2 p, float t){
          float c = 0.0;
          for (int k = 0; k < 3; k++) {
            float a = float(k) * 2.094 + 0.4;
            vec2 d = vec2(cos(a), sin(a));
            float w = sin(dot(p, d) * 5.5 + t * (0.5 + 0.17 * float(k)) + sin(dot(p, vec2(-d.y, d.x)) * 2.7 + t * 0.35) * 1.4);
            c += pow(1.0 - abs(w), 7.0);
          }
          return c / 3.0;
        }`,
      )
      .replace(
        "#include <opaque_fragment>",
        `{
          vec2 uv = vPool / vec2(4.42, 2.74) + 0.5;
          float h = texture2D(causticHeight, uv).r;
          float lap = texture2D(causticHeight, uv + vec2(causticTexel.x, 0.)).r
            + texture2D(causticHeight, uv - vec2(causticTexel.x, 0.)).r
            + texture2D(causticHeight, uv + vec2(0., causticTexel.y)).r
            + texture2D(causticHeight, uv - vec2(0., causticTexel.y)).r - 4.0 * h;
          float focus = clamp(-lap * 260.0, -0.6, 2.5);
          float edge = smoothstep(1.0, 0.82, length(vPool / vec2(2.1, 1.3)));
          float ambient = ambientCaustic(vPool * 1.3, causticTime) * edge;
          outgoingLight *= 0.8 + focus * 0.8 * edge + ambient * 0.38;
        }
        #include <opaque_fragment>`,
      );
  };
  bottomMaterial.customProgramCacheKey = () => "atelier-caustics-v1";

  let accumulator = 0,
    clock = 0,
    nextDrop = 1.2,
    lastEnergy = 0,
    impulseCooldown = 0;
  const fixed = 1 / 120,
    waveSpeedSquared = 0.55 * 0.55;
  const invDx2 = 1 / (dx * dx),
    invDz2 = 1 / (dz * dz);
  const damping = Math.exp(-0.22 * fixed);
  function impulse(cx, cz, strength) {
    for (let i = 0; i < count; i++) {
      if (!active[i]) continue;
      const x = positions[i * 3] - cx,
        z = positions[i * 3 + 2] - cz;
      velocity[i] = Math.max(
        -0.85,
        Math.min(
          0.85,
          velocity[i] + strength * Math.exp(-(x * x + z * z) / 0.016),
        ),
      );
    }
  }
  function update(t, dt, energy = 0) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const elapsed = Math.min(dt, 0.05);
    clock += elapsed;
    impulseCooldown -= elapsed;
    if (clock >= nextDrop) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.sqrt(Math.random()) * 0.76;
      impulse(
        Math.cos(angle) * radius * rx,
        Math.sin(angle) * radius * rz,
        -0.28 - Math.random() * 0.1,
      );
      nextDrop = clock + 2 + Math.random() * 4;
    }
    const e = Number.isFinite(energy) ? Math.max(0, Math.min(energy, 1)) : 0;
    if (e - lastEnergy > 0.06 && impulseCooldown <= 0) {
      impulse(0.15, 0.12, -Math.min(0.52, 0.2 + (e - lastEnergy) * 0.32));
      impulseCooldown = 0.5;
    }
    lastEnergy = e;
    accumulator += elapsed;
    while (accumulator >= fixed) {
      for (let z = 1; z < nz - 1; z++) {
        for (let x = 1; x < nx - 1; x++) {
          const i = z * nx + x;
          if (!active[i]) continue;
          const center = height[i];
          const left = active[i - 1] ? height[i - 1] : center;
          const right = active[i + 1] ? height[i + 1] : center;
          const back = active[i - nx] ? height[i - nx] : center;
          const front = active[i + nx] ? height[i + nx] : center;
          const laplacian =
            (left + right - 2 * center) * invDx2 +
            (back + front - 2 * center) * invDz2;
          velocity[i] =
            (velocity[i] + laplacian * waveSpeedSquared * fixed) * damping;
        }
      }
      // A separate integration pass keeps the finite-difference stencil symmetric.
      let mean = 0,
        wetCount = 0;
      for (let i = 0; i < count; i++) {
        if (!active[i]) continue;
        height[i] += velocity[i] * fixed;
        mean += height[i];
        wetCount++;
      }
      mean /= wetCount;
      for (let i = 0; i < count; i++) if (active[i]) height[i] -= mean;
      accumulator -= fixed;
    }
    for (let i = 0; i < count; i++) {
      const r2 =
        positions[i * 3] ** 2 / (rx * rx) +
        positions[i * 3 + 2] ** 2 / (rz * rz);
      const pin = Math.max(0, Math.min(1, (1 - r2) * 16));
      positions[i * 3 + 1] = -0.015 + height[i] * pin;
    }
    positionAttribute.needsUpdate = true;
    geometry.computeVertexNormals();
    heightData.set(height);
    heightTexture.needsUpdate = true;
    causticUniforms.causticTime.value = clock;
  }
  function setPalette(p) {
    // A restrained tint: clear, slightly green water that leans to the palette.
    waterMaterial.attenuationColor
      .set(0x4f8a84)
      .lerp(new THREE.Color(p?.a || "#159aab"), 0.35);
  }
  setPalette(palette);
  return {
    update,
    setPalette,
    kick() {
      impulse(0.15, 0.12, -0.52);
    },
    dispose() {
      heightTexture.dispose();
      stoneTex.map.dispose();
      stoneTex.bump.dispose();
      pebbleGeometry.dispose();
    },
  };
}
