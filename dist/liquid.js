import * as THREE from "three";

/*
 * Raymarched metaball liquid.
 *
 * A proxy mesh (sphere or box) bounds the liquid. Each fragment marches a ray
 * through a smooth-min union of spheres/ellipsoids, then shades the hit the
 * way real liquid looks rather than like a lit, opaque surface:
 *   - Fresnel reflection of the studio environment (softbox strips),
 *   - refraction into the body, a second march to the exit surface, so the
 *     real optical thickness is known,
 *   - Beer–Lambert absorption over that thickness (thin rims stay clear,
 *     the core saturates), plus a little in-scattered light,
 *   - refraction out of the body into the scene behind (screen buffer),
 *   - up to two liquid layers along the ray (one liquid seen through another).
 * Depth is written at the hit point so it occludes correctly with geometry.
 *
 * Techniques follow well-known references: smooth-min SDF blending (Inigo
 * Quilez), screen-space fluid shading with thickness-based absorption (Simon
 * Green, NVIDIA "Screen Space Fluid Rendering", GDC 2010). No code copied.
 */
export const MAX_BALLS = 40;

const vertexShader = /* glsl */ `
varying vec3 vLocal;
void main(){
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const fragmentShader = /* glsl */ `
#include <common>
uniform mat4 modelMatrix;
uniform mat4 projectionMatrix;
#include <cube_uv_reflection_fragment>
#define MAX_BALLS ${MAX_BALLS}
uniform vec4 uBalls[MAX_BALLS];
uniform vec3 uScale[MAX_BALLS];
uniform float uOwner[MAX_BALLS];
uniform int uCount;
uniform float uK;
uniform vec3 uAbsorb[2];
uniform vec3 uScatter[2];
uniform float uIor;
uniform float uWax;
uniform float uHeatLow;
uniform float uHeatHigh;
uniform vec3 uMedium;
uniform float uMediumDensity;
uniform vec4 uProfile[6];
uniform vec3 uBoundMin;
uniform vec3 uBoundMax;
uniform sampler2D envMap;
uniform float uEnvIntensity;
uniform sampler2D uScene;
uniform vec3 uMainCamera;
uniform mat4 uInvModel;
varying vec3 vLocal;

float smin(float a, float b, float k){
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}
vec2 field(vec3 p){
  float d0 = 1e4, d1 = 1e4;
  for (int i = 0; i < MAX_BALLS; i++) {
    if (i >= uCount) break;
    vec3 s = uScale[i];
    vec3 q = (p - uBalls[i].xyz) / s;
    float d = (length(q) - uBalls[i].w) * min(min(s.x, s.y), s.z);
    if (uOwner[i] < 0.5) d0 = smin(d0, d, uK); else d1 = smin(d1, d, uK);
  }
  return vec2(d0, d1);
}
float liquid(vec3 p, int which){
  vec2 f = field(p);
  return which == 0 ? f.x : f.y;
}
vec3 liquidNormal(vec3 p, int which){
  const vec2 k = vec2(1.0, -1.0);
  const float h = 0.0025;
  return normalize(
    k.xyy * liquid(p + k.xyy * h, which) +
    k.yyx * liquid(p + k.yyx * h, which) +
    k.yxy * liquid(p + k.yxy * h, which) +
    k.xxx * liquid(p + k.xxx * h, which));
}
bool inBounds(vec3 p){
  return all(greaterThanEqual(p, uBoundMin - 0.02)) && all(lessThanEqual(p, uBoundMax + 0.02));
}
vec3 toWorldDir(vec3 d){ return normalize(mat3(modelMatrix) * d); }
vec3 env(vec3 localDir, float rough){
  return textureCubeUV(envMap, toWorldDir(localDir), rough).rgb * uEnvIntensity;
}
bool isMain(){ return distance(cameraPosition, uMainCamera) < 0.001; }
vec3 behind(vec3 p, vec3 dir){
  if (!isMain()) return env(dir, 0.08) * 0.35;
  vec4 clip = projectionMatrix * viewMatrix * modelMatrix * vec4(p + dir * 0.9, 1.0);
  vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
  return texture2D(uScene, clamp(uv, 0.001, 0.999)).rgb;
}
// March from p along d, outside any liquid. Returns t, or -1 when leaving.
float marchOut(vec3 p, vec3 d, out int which){
  float t = 0.0;
  which = 0;
  for (int i = 0; i < 110; i++) {
    vec3 q = p + d * t;
    if (!inBounds(q)) return -1.0;
    vec2 f = field(q);
    float m = min(f.x, f.y);
    if (m < 0.0006) { which = f.x < f.y ? 0 : 1; return t; }
    t += max(m * 0.92, 0.002);
  }
  return -1.0;
}
// March inside the liquid until the exit surface.
float marchIn(vec3 p, vec3 d, int which){
  float t = 0.004;
  for (int i = 0; i < 64; i++) {
    float m = liquid(p + d * t, which);
    if (m > -0.0006) break;
    t += max(-m * 0.9, 0.004);
  }
  return t;
}

// Radius of the lamp's inner volume at height y (piecewise linear profile).
float profileRadius(float y){
  float r = uProfile[0].y;
  for (int i = 0; i < 5; i++) {
    vec4 a = uProfile[i], b = uProfile[i + 1];
    if (y >= a.x && y <= b.x) r = mix(a.y, b.y, (y - a.x) / max(b.x - a.x, 1e-4));
  }
  if (y > uProfile[5].x) r = -1.0;
  if (y < uProfile[0].x) r = -1.0;
  return r;
}
// Glowing liquid between the eye and distance tMax: emission brighter low
// in the lamp, attenuated along the way.
vec4 medium(vec3 p, vec3 d, float tMax){
  vec3 glow = vec3(0.0);
  float trans = 1.0;
  float stepLen = 0.06;
  for (int i = 0; i < 64; i++) {
    float t = (float(i) + 0.5) * stepLen;
    if (t > tMax) break;
    vec3 q = p + d * t;
    float r = profileRadius(q.y);
    if (r < 0.0 || length(q.xz) > r) continue;
    float heat = mix(1.0, 0.25, smoothstep(uHeatLow, uHeatHigh, q.y));
    float a = uMediumDensity * stepLen;
    glow += trans * uMedium * heat * a;
    trans *= exp(-a * 0.6);
  }
  return vec4(glow, trans);
}

void main(){
  vec3 ro = (uInvModel * vec4(cameraPosition, 1.0)).xyz;
  vec3 mediumGlow = vec3(0.0);
  float mediumTrans = 1.0;
  vec3 rd = normalize(vLocal - ro);
  // Start where the camera ray enters the bounds (proxy front face).
  vec3 p = vLocal;
  int which;
  float t = marchOut(p, rd, which);
  if (uWax > 0.5) {
    // The lamp liquid: a dim glowing volume in front of the wax.
    float tEnd = t < 0.0 ? 4.0 : t;
    vec4 m = medium(p, rd, tEnd);
    if (t < 0.0) {
      vec3 col = m.rgb + m.a * behind(p + rd * 1.6, rd);
      gl_FragColor = vec4(col, 1.0);
      vec4 clipM = projectionMatrix * viewMatrix * modelMatrix * vec4(p, 1.0);
      gl_FragDepth = clamp((clipM.z / clipM.w) * 0.5 + 0.5, 0.0, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      return;
    }
    mediumGlow = m.rgb;
    mediumTrans = m.a;
  }
  if (t < 0.0) discard;
  p += rd * t;
  vec3 firstHit = p;

  float F0 = pow((uIor - 1.0) / (uIor + 1.0), 2.0);
  vec3 color = vec3(0.0);
  vec3 throughput = vec3(1.0);
  vec3 dir = rd;
  for (int layer = 0; layer < 2; layer++) {
    vec3 n = liquidNormal(p, which);
    float cosI = clamp(dot(-dir, n), 0.0, 1.0);
    float F = F0 + (1.0 - F0) * pow(1.0 - cosI, 5.0);
    vec3 refl = env(reflect(dir, n), 0.025);
    color += throughput * F * refl;
    // Into the body, across its real thickness, and out again.
    vec3 r1 = refract(dir, n, 1.0 / uIor);
    float thickness = marchIn(p, r1, which);
    vec3 exitP = p + r1 * thickness;
    vec3 n2 = liquidNormal(exitP, which);
    vec3 r2 = refract(r1, -n2, uIor);
    if (dot(r2, r2) < 0.001) r2 = reflect(r1, -n2); // total internal reflection
    vec3 absorb = uAbsorb[which];
    vec3 transmit = exp(-absorb * thickness);
    // Light scattered inside the body: strongest where it is thick, and for
    // wax, where the lamp heats it from below.
    vec3 scatter = uScatter[which] * (1.0 - exp(-thickness * 2.2));
    if (uWax > 0.5) {
      // Wax is lit by the heater below: undersides glow, tops fall into
      // shadow, thin edges let more light through.
      vec3 toHeater = normalize(vec3(0.0, uHeatLow - 0.4, 0.0) - p);
      float wrap = clamp((dot(n, toHeater) + 0.35) / 1.35, 0.0, 1.0);
      float heat = mix(1.0, 0.22, smoothstep(uHeatLow, uHeatHigh, p.y));
      float edge = pow(1.0 - cosI, 2.0);
      scatter = uScatter[which] * heat * (0.18 + 0.95 * wrap * wrap + 0.45 * edge)
        * (0.75 + 0.5 * exp(-thickness * 1.2));
    }
    color += throughput * (1.0 - F) * scatter;
    throughput *= (1.0 - F) * transmit;
    // Continue behind this body: another liquid, or the scene.
    dir = normalize(r2);
    p = exitP + dir * 0.003;
    int nextWhich;
    float tn = layer == 0 ? marchOut(p, dir, nextWhich) : -1.0;
    if (tn < 0.0) {
      color += throughput * behind(p, dir);
      break;
    }
    p += dir * tn;
    which = nextWhich;
  }

  color = mediumGlow + mediumTrans * color;
  gl_FragColor = vec4(color, 1.0);
  vec4 clip = projectionMatrix * viewMatrix * modelMatrix * vec4(firstHit, 1.0);
  gl_FragDepth = clamp((clip.z / clip.w) * 0.5 + 0.5, 0.0, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function absorptionFrom(color, density) {
  // A colour seen through `1 / density` units of liquid.
  const c = new THREE.Color(color);
  const clampc = (v) => Math.min(0.98, Math.max(0.02, v));
  return new THREE.Vector3(
    -Math.log(clampc(c.r)) * density,
    -Math.log(clampc(c.g)) * density,
    -Math.log(clampc(c.b)) * density,
  );
}

/**
 * @param {object} o
 * @param {THREE.BufferGeometry} o.geometry proxy bounding geometry (local space)
 * @param {THREE.Texture} o.envMap PMREM environment
 * @param {THREE.Texture} o.scene screen buffer of what lies behind liquids
 * @param {THREE.Vector3} o.mainCamera position of the main camera
 */
export function createLiquid({
  geometry,
  envMap,
  scene,
  mainCamera,
  envIntensity = 1,
  ior = 1.42,
  smooth = 0.32,
  wax = false,
  heatRange = [-1.5, 1.5],
  profile = null,
}) {
  geometry.computeBoundingBox();
  const { cubeUVSize } = cubeParams(envMap);
  const uniforms = {
    uBalls: { value: Array.from({ length: MAX_BALLS }, () => new THREE.Vector4()) },
    uScale: { value: Array.from({ length: MAX_BALLS }, () => new THREE.Vector3(1, 1, 1)) },
    uOwner: { value: new Float32Array(MAX_BALLS) },
    uCount: { value: 0 },
    uK: { value: smooth },
    uAbsorb: { value: [new THREE.Vector3(), new THREE.Vector3()] },
    uScatter: { value: [new THREE.Vector3(), new THREE.Vector3()] },
    uIor: { value: ior },
    uWax: { value: wax ? 1 : 0 },
    uHeatLow: { value: heatRange[0] },
    uHeatHigh: { value: heatRange[1] },
    uMedium: { value: new THREE.Vector3() },
    uMediumDensity: { value: 0 },
    uProfile: {
      value: (profile ?? [[-9, 0], [-8, 0], [-7, 0], [-6, 0], [-5, 0], [-4, 0]]).map(
        ([y, r]) => new THREE.Vector4(y, r, 0, 0),
      ),
    },
    uBoundMin: { value: geometry.boundingBox.min.clone() },
    uBoundMax: { value: geometry.boundingBox.max.clone() },
    envMap: { value: envMap },
    uEnvIntensity: { value: envIntensity },
    uScene: { value: scene },
    uMainCamera: { value: mainCamera },
    uInvModel: { value: new THREE.Matrix4() },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    defines: {
      ENVMAP_TYPE_CUBE_UV: "",
      CUBEUV_TEXEL_WIDTH: cubeUVSize.texelWidth,
      CUBEUV_TEXEL_HEIGHT: cubeUVSize.texelHeight,
      CUBEUV_MAX_MIP: cubeUVSize.maxMip.toFixed(1),
    },
  });
  material.userData.liquid = true;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.liquid = true;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.onBeforeRender = () => {
    uniforms.uInvModel.value.copy(mesh.matrixWorld).invert();
  };

  const api = {
    mesh,
    material,
    /** Set the colour and density (1/units) of liquid 0 or 1. */
    setLiquid(index, color, { density = 1.6, scatter = 0.12 } = {}) {
      uniforms.uAbsorb.value[index].copy(absorptionFrom(color, density));
      const c = new THREE.Color(color);
      uniforms.uScatter.value[index].set(c.r * scatter, c.g * scatter, c.b * scatter);
    },
    /** Glowing liquid medium around wax (lava lamp). */
    setMedium(color, density) {
      const c = new THREE.Color(color);
      uniforms.uMedium.value.set(c.r, c.g, c.b);
      uniforms.uMediumDensity.value = density;
    },
    count: 0,
    /** Begin a new frame of balls. */
    reset() {
      api.count = 0;
    },
    add(x, y, z, r, owner = 0, sx = 1, sy = 1, sz = 1) {
      if (api.count >= MAX_BALLS) return;
      const i = api.count++;
      uniforms.uBalls.value[i].set(x, y, z, r);
      uniforms.uScale.value[i].set(sx, sy, sz);
      uniforms.uOwner.value[i] = owner;
    },
    commit() {
      uniforms.uCount.value = api.count;
    },
    dispose() {
      material.dispose();
    },
  };
  return api;
}

function cubeParams(envMap) {
  const imageHeight = envMap.image.height;
  const maxMip = Math.log2(imageHeight) - 2;
  const texelHeight = 1.0 / imageHeight;
  const texelWidth = 1.0 / (3 * Math.max(Math.pow(2, maxMip), 7 * 16));
  return { cubeUVSize: { texelWidth, texelHeight, maxMip } };
}
