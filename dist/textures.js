import * as THREE from "three";

// Small procedural textures (no image assets): value-noise fBm.
function hash(x, y, seed) {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
function valueNoise(x, y, period, seed) {
  const ix = Math.floor(x),
    iy = Math.floor(y);
  let u = x - ix,
    v = y - iy;
  u = u * u * (3 - 2 * u);
  v = v * v * (3 - 2 * v);
  const w = (a) => ((a % period) + period) % period;
  const a = hash(w(ix), w(iy), seed),
    b = hash(w(ix + 1), w(iy), seed),
    c = hash(w(ix), w(iy + 1), seed),
    d = hash(w(ix + 1), w(iy + 1), seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/** Tileable fBm in [0, 1]. */
export function fbm(x, y, octaves = 5, period = 8, seed = 1) {
  let sum = 0,
    amp = 0.5,
    norm = 0,
    f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * f, y * f, period * f, seed + o * 17);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

/**
 * Stone / ceramic texture pair: a colour map and a matching greyscale bump.
 * `speckle` adds fine mineral grains; `veins` adds soft streaks.
 */
export function stoneTextures({
  size = 512,
  base = "#8b877e",
  dark = "#5f5b54",
  light = "#a7a297",
  speckle = 0.25,
  veins = 0,
  period = 6,
  seed = 3,
  repeat = [1, 1],
} = {}) {
  // DataTextures (not canvases) so the modules also run in Node tests.
  const colorData = new Uint8Array(size * size * 4),
    bumpData = new Uint8Array(size * size * 4);
  const cBase = new THREE.Color(base),
    cDark = new THREE.Color(dark),
    cLight = new THREE.Color(light);
  const tmp = new THREE.Color();
  const srgb = { r: 0, g: 0, b: 0 };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = (x / size) * period,
        v = (y / size) * period;
      const n = fbm(u, v, 5, period, seed);
      let t = n;
      if (veins > 0) {
        const vein = Math.abs(Math.sin((u + fbm(u * 0.5, v * 0.5, 4, period / 2, seed + 9) * 3) * 2.2));
        t = THREE.MathUtils.lerp(t, 1 - Math.pow(vein, 0.3), veins * 0.5);
      }
      const grain = hash(x, y, seed + 5);
      tmp.copy(cBase);
      if (t < 0.5) tmp.lerp(cDark, (0.5 - t) * 1.6);
      else tmp.lerp(cLight, (t - 0.5) * 1.6);
      if (grain > 1 - speckle * 0.12) tmp.lerp(cDark, 0.55);
      else if (grain < speckle * 0.08) tmp.lerp(cLight, 0.5);
      const i = (y * size + x) * 4;
      tmp.getRGB(srgb, THREE.SRGBColorSpace);
      colorData[i] = Math.round(Math.min(1, srgb.r) * 255);
      colorData[i + 1] = Math.round(Math.min(1, srgb.g) * 255);
      colorData[i + 2] = Math.round(Math.min(1, srgb.b) * 255);
      colorData[i + 3] = 255;
      const b = Math.round((n * 0.7 + grain * 0.3) * 255);
      bumpData[i] = bumpData[i + 1] = bumpData[i + 2] = b;
      bumpData[i + 3] = 255;
    }
  const map = new THREE.DataTexture(colorData, size, size, THREE.RGBAFormat);
  map.colorSpace = THREE.SRGBColorSpace;
  const bump = new THREE.DataTexture(bumpData, size, size, THREE.RGBAFormat);
  for (const t of [map, bump]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...repeat);
    t.anisotropy = 8;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.needsUpdate = true;
  }
  return { map, bump };
}
