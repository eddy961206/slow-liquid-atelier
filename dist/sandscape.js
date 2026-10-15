import * as THREE from "three";

// A ceramic sand table with a rolling tool and permanently accumulated tracks.
export function createSandscape({ model, materials, palette }) {
  const tray = new THREE.Group();
  tray.position.set(0, -0.55, 0);
  tray.rotation.x = 0;
  model.add(tray);

  const ceramic = new THREE.MeshStandardMaterial({
    color: "#34332f",
    roughness: 0.72,
    metalness: 0.06,
  });
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(2.28, 2.12, 0.26, 96),
    ceramic,
  );
  base.scale.z = 0.7;
  base.position.y = -1.04;
  base.castShadow = base.receiveShadow = true;
  tray.add(base);
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(2.23, 0.065, 12, 128),
    ceramic,
  );
  rim.rotation.x = Math.PI / 2;
  rim.scale.y = 0.7;
  rim.position.y = -0.88;
  rim.castShadow = rim.receiveShadow = true;
  tray.add(rim);
  const foot = new THREE.Mesh(
    new THREE.CylinderGeometry(1.84, 1.88, 0.1, 72),
    materials.darkMetal,
  );
  foot.scale.z = 0.7;
  foot.position.y = -1.21;
  foot.castShadow = foot.receiveShadow = true;
  tray.add(foot);

  let seed = 49237;
  function random() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  const textureSize = 128;
  const textureData = new Uint8Array(textureSize * textureSize * 4);
  for (let i = 0; i < textureData.length; i += 4) {
    const value = 145 + Math.floor(random() * 110);
    textureData[i] = textureData[i + 1] = textureData[i + 2] = value;
    textureData[i + 3] = 255;
  }
  const grain = new THREE.DataTexture(
    textureData,
    textureSize,
    textureSize,
    THREE.RGBAFormat,
  );
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
  grain.repeat.set(4, 3);
  grain.magFilter = THREE.LinearFilter;
  grain.minFilter = THREE.LinearMipmapLinearFilter;
  grain.generateMipmaps = true;
  grain.needsUpdate = true;
  const sandMaterial = new THREE.MeshStandardMaterial({
    color: "#c5ab7a",
    roughness: 1,
    metalness: 0,
    map: grain,
    bumpMap: grain,
    bumpScale: 0.026,
    roughnessMap: grain,
  });

  function hash(x, z) {
    let n = Math.imul(x, 374761393) ^ Math.imul(z, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  }
  function noise(x, z) {
    const ix = Math.floor(x),
      iz = Math.floor(z);
    let u = x - ix,
      v = z - iz;
    u = u * u * (3 - 2 * u);
    v = v * v * (3 - 2 * v);
    const a = hash(ix, iz),
      b = hash(ix + 1, iz),
      c = hash(ix, iz + 1),
      d = hash(ix + 1, iz + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function height(x, z) {
    const edge = Math.max(0, 1 - ((x * x) / 4.75 + (z * z) / 2.13));
    const envelope = Math.min(1, edge * 8);
    return -0.86 + envelope * (0.025 + 0.004 * (noise(x * 9 + 6, z * 9) - 0.5));
  }

  // A polar grid avoids square corners or overlapping layers at the ceramic rim.
  const rings = 70,
    segments = 100;
  const vertices = (rings + 1) * (segments + 1);
  const positions = new Float32Array(vertices * 3);
  const uvs = new Float32Array(vertices * 2);
  const indices = new Uint16Array(rings * segments * 6);
  let p = 0,
    uv = 0,
    face = 0;
  for (let r = 0; r <= rings; r++) {
    const radius = r / rings;
    for (let s = 0; s <= segments; s++) {
      const angle = (s / segments) * Math.PI * 2;
      const x = Math.cos(angle) * radius * 2.18,
        z = Math.sin(angle) * radius * 1.46;
      positions[p++] = x;
      positions[p++] = height(x, z);
      positions[p++] = z;
      uvs[uv++] = x / 4.36 + 0.5;
      uvs[uv++] = z / 2.92 + 0.5;
      if (r < rings && s < segments) {
        const a = r * (segments + 1) + s,
          b = a + segments + 1;
        indices[face++] = a;
        indices[face++] = a + 1;
        indices[face++] = b;
        indices[face++] = a + 1;
        indices[face++] = b + 1;
        indices[face++] = b;
      }
    }
  }
  const terrainGeometry = new THREE.BufferGeometry();
  terrainGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage),
  );
  terrainGeometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  terrainGeometry.setIndex(new THREE.BufferAttribute(indices, 1));
  terrainGeometry.computeVertexNormals();
  terrainGeometry.computeBoundingSphere();
  const terrain = new THREE.Mesh(terrainGeometry, sandMaterial);
  terrain.receiveShadow = true;
  tray.add(terrain);

  // A real rolling tool leaves a persistent depression with displaced shoulders.
  const ballRadius = 0.095;
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(ballRadius, 32, 24),
    new THREE.MeshStandardMaterial({
      color: "#bbbcb8",
      roughness: 0.23,
      metalness: 0.95,
    }),
  );
  ball.castShadow = ball.receiveShadow = true;
  tray.add(ball);
  const restHeight = new Float32Array(vertices);
  for (let i = 0; i < vertices; i++) restHeight[i] = positions[i * 3 + 1];
  // Seed an actual carved spiral: its endpoint is the live tool's first position.
  // Analytic distance sampling avoids hundreds of simulation passes at startup.
  const startAngle = Math.PI * 5,
    spiralSlope = 0.035;
  const startRadius = 0.18 + spiralSlope * startAngle;
  for (let i = 0; i < vertices; i++) {
    const j = i * 3,
      x = positions[j],
      z = positions[j + 2];
    const nx = x / 2.03,
      nz = z / 1.32;
    const radial = Math.sqrt(nx * nx + nz * nz);
    let angle = Math.atan2(nz, nx);
    if (angle < 0) angle += Math.PI * 2;
    let distance = Infinity;
    for (let turn = 0; turn < 3; turn++) {
      const theta = angle + turn * Math.PI * 2;
      if (theta > startAngle) continue;
      const radius = 0.18 + spiralSlope * theta;
      const radialScale = Math.sqrt(
        Math.pow(Math.cos(angle) * 2.03, 2) +
          Math.pow(Math.sin(angle) * 1.32, 2),
      );
      distance = Math.min(distance, Math.abs(radial - radius) * radialScale);
    }
    distance = Math.min(
      distance,
      Math.hypot(x - 0.18 * 2.03, z),
      Math.hypot(x + startRadius * 2.03, z),
    );
    if (distance < 0.14)
      positions[j + 1] +=
        -0.032 * Math.exp((-distance * distance) / 0.0018) +
        0.014 * Math.exp(-Math.pow((distance - 0.082) / 0.025, 2));
  }
  terrainGeometry.attributes.position.needsUpdate = true;
  terrainGeometry.computeVertexNormals();
  let elapsed = 0,
    terrainClock = 0,
    lastX = 0,
    lastZ = 0,
    ballX = 0,
    ballZ = 0,
    initialized = false;
  let angle = startAngle,
    radius = startRadius,
    radialVelocity = 0;
  let centerX = 0,
    centerZ = 0,
    angularRate = 0.1;
  let targetRadius = 0.56,
    targetCenterX = 0.02,
    targetCenterZ = -0.02,
    targetRate = 0.11,
    nextTarget = 11,
    lastEnergy = 0;
  function update(t, dt, energy = 0) {
    const delta = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.05)) : 0;
    const travelDt = delta * (1 + Math.min(Math.max(energy, 0), 3) * 0.32);
    elapsed += travelDt;
    terrainClock += delta;
    if (elapsed >= nextTarget || energy > lastEnergy + 0.1) {
      targetRadius = 0.23 + random() * 0.53;
      targetCenterX = (random() - 0.5) * 0.18;
      targetCenterZ = (random() - 0.5) * 0.16;
      targetRate = 0.055 + random() * 0.085;
      nextTarget = elapsed + 8 + random() * 12;
    }
    lastEnergy = energy;
    // Critically damped radial motion blends long arcs into new spiral segments.
    radialVelocity +=
      ((targetRadius - radius) * 0.025 - radialVelocity * 0.32) * travelDt;
    radius += radialVelocity * travelDt;
    const easing = 1 - Math.exp(-travelDt * 0.11);
    centerX += (targetCenterX - centerX) * easing;
    centerZ += (targetCenterZ - centerZ) * easing;
    angularRate += (targetRate - angularRate) * easing;
    angle += angularRate * travelDt;
    const x = (centerX + Math.cos(angle) * radius) * 2.03;
    const z = (centerZ + Math.sin(angle) * radius) * 1.32;
    if (!initialized) {
      lastX = ballX = x;
      lastZ = ballZ = z;
      initialized = true;
    }
    ball.position.set(x, height(x, z) + ballRadius - 0.019, z);
    ball.rotation.x += (z - ballZ) / ballRadius;
    ball.rotation.z -= (x - ballX) / ballRadius;
    ballX = x;
    ballZ = z;
    if (terrainClock >= 0.065) {
      terrainClock = 0;
      const dx = x - lastX,
        dz = z - lastZ;
      const lengthSq = dx * dx + dz * dz;
      for (let i = 0; i < vertices; i++) {
        const j = i * 3;
        const px = positions[j],
          pz = positions[j + 2];
        const u =
          lengthSq > 1e-10
            ? Math.max(
                0,
                Math.min(1, ((px - lastX) * dx + (pz - lastZ) * dz) / lengthSq),
              )
            : 0;
        const ox = px - (lastX + dx * u),
          oz = pz - (lastZ + dz * u);
        const distance = Math.sqrt(ox * ox + oz * oz);
        if (distance < 0.14) {
          const groove = -0.032 * Math.exp((-distance * distance) / 0.0018);
          const shoulder =
            0.014 * Math.exp(-Math.pow((distance - 0.082) / 0.025, 2));
          const target = restHeight[i] + groove + shoulder;
          // The passing ball reshapes earlier grooves without resetting the field.
          const weight = Math.max(0, 1 - Math.pow(distance / 0.14, 4));
          positions[j + 1] += (target - positions[j + 1]) * weight;
        }
      }
      terrainGeometry.attributes.position.needsUpdate = true;
      terrainGeometry.computeVertexNormals();
      lastX = x;
      lastZ = z;
    }
  }
  function setPalette(p) {
    // Small mineral variations retain the material's natural sand identity.
    const accent = new THREE.Color(p?.a || "#c5ab7a");
    sandMaterial.color.set("#c5ab7a").lerp(accent, 0.055);
  }
  setPalette(palette);
  update(0, 0, 0);
  return {
    update,
    setPalette,
    kick() {
      nextTarget = elapsed;
    },
    dispose() {
      grain.dispose();
    },
  };
}
