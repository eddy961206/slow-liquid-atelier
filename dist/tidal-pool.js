import * as THREE from "three";

// A shallow elliptical ceramic pool with a damped finite-difference water surface.
export function createTidalPool({ model, materials, palette }) {
  const group = new THREE.Group();
  group.position.y = -0.5;
  group.rotation.x = 0;
  model.add(group);
  const ceramic = new THREE.MeshStandardMaterial({
    color: 0x787d78,
    roughness: 0.86,
    metalness: 0.02,
  });
  const bottomMaterial = new THREE.MeshStandardMaterial({
    color: 0x344d4e,
    roughness: 0.72,
  });
  const waterMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xb7d7d7,
    roughness: 0.055,
    metalness: 0,
    transmission: 0.86,
    thickness: 0.24,
    ior: 1.333,
    transparent: false,
    opacity: 1,
    clearcoat: 0,
    clearcoatRoughness: 0.16,
    attenuationColor: new THREE.Color(0x406e72),
    attenuationDistance: 3.5,
    side: THREE.DoubleSide,
  });
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
  // Solid bottom and a continuous raised lip: no nested transparent enclosure.
  const bottom = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 0.15, 96),
    bottomMaterial,
  );
  bottom.scale.set(2.18, 1, 1.34);
  bottom.position.y = -0.19;
  group.add(bottom);
  const profile = [
    new THREE.Vector2(0.94, -0.23),
    new THREE.Vector2(1, -0.23),
    new THREE.Vector2(1.055, -0.17),
    new THREE.Vector2(1.066, -0.06),
    new THREE.Vector2(1.048, 0.055),
    new THREE.Vector2(1.025, 0.075),
    new THREE.Vector2(1.002, 0.052),
    new THREE.Vector2(0.985, -0.09),
    new THREE.Vector2(0.94, -0.13),
  ];
  const rim = new THREE.Mesh(new THREE.LatheGeometry(profile, 96), ceramic);
  rim.scale.set(2.18, 1, 1.34);
  group.add(rim);

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
  const stoneMaterial = new THREE.MeshStandardMaterial({
    color: 0x5c625e,
    roughness: 0.48,
  });
  const stone = new THREE.Mesh(
    new THREE.SphereGeometry(1, 28, 18),
    stoneMaterial,
  );
  stone.position.set(-1.35, -0.075, -0.58);
  stone.scale.set(0.28, 0.16, 0.21);
  group.add(stone);
  // Remove covered cells from propagation; the submerged stone reflects waves.
  for (let i = 0; i < count; i++) {
    const sx = (positions[i * 3] + 1.35) / 0.255;
    const sz = (positions[i * 3 + 2] + 0.58) / 0.19;
    if (sx * sx + sz * sz < 1) active[i] = 0;
  }

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
  }
  function setPalette(p) {
    // Restrained basin colors keep the water readable across the app's palettes.
    ceramic.color.set(
      p?.name === "보랏빛 꿈"
        ? 0x96958a
        : p?.name === "햇살과 꿀"
          ? 0x8e7c65
          : 0x787d78,
    );
  }
  setPalette(palette);
  return {
    update,
    setPalette,
    kick() {
      impulse(0.15, 0.12, -0.52);
    },
  };
}
