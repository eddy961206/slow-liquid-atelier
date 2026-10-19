import * as THREE from "three";
import { createLiquid } from "./liquid.js";

/*
 * A photographic product studio.
 * - A seamless cyclorama sweep (floor curving into the wall) catches a real
 *   pool of light and soft shadows, so every object sits on something.
 * - An HDR environment made of finite, soft-edged softboxes gives glass,
 *   water and metal shaped reflections instead of grey blobs.
 * - The flat part of the sweep is a soft gloss: a blurred planar reflection
 *   rendered once per frame and mixed in with a Fresnel term.
 * - Glass shells sample a separate scene buffer that already contains the
 *   (transmissive) liquids, so nested transmission reads correctly.
 */
export function createStudio(stage) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  stage.appendChild(renderer.domElement);
  renderer.domElement.setAttribute("aria-hidden", "true");

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0.006, 0.0065, 0.0075);
  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 200);
  const anchor = new THREE.Group(); // turntable: sits on the floor at y = 0
  scene.add(anchor);

  // ---------------------------------------------------------------- environment
  const environment = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.SphereGeometry(30, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader:
        "varying vec3 vP;void main(){vP=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
      fragmentShader:
        "varying vec3 vP;void main(){float y=vP.y;vec3 c=mix(vec3(.012,.010,.009),vec3(.006,.007,.009),smoothstep(-.3,.6,y));gl_FragColor=vec4(c,1.);}",
    }),
  );
  environment.add(room);
  const softboxMaterial = (color, strength, feather) =>
    new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: {
        tint: { value: new THREE.Color(color).multiplyScalar(strength) },
        feather: { value: feather },
      },
      vertexShader:
        "varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
      fragmentShader:
        "uniform vec3 tint;uniform float feather;varying vec2 vUv;void main(){vec2 q=abs(vUv-.5)*2.;float m=(1.-smoothstep(1.-feather,1.,q.x))*(1.-smoothstep(1.-feather,1.,q.y));m*=.82+.18*(1.-q.y*q.y);gl_FragColor=vec4(tint*m,1.);}",
    });
  function softbox(x, y, z, w, h, color, strength, feather = 0.35) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      softboxMaterial(color, strength, feather),
    );
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    environment.add(m);
  }
  softbox(0, 8, 1.5, 7, 3.5, "#fff6ec", 18); // overhead
  softbox(-7, 2.4, 5, 1.3, 8, "#eef4ff", 48, 0.3); // key strip
  softbox(7.5, 1.8, 2.5, 0.8, 8, "#ffeedd", 26, 0.3); // warm side strip
  softbox(0, 5.5, -8, 12, 3.6, "#eef5ff", 7); // back top, read by water
  softbox(-5.5, 1.2, -6, 1.1, 7, "#dfeef2", 8, 0.2); // rims
  softbox(5.5, 1.2, -6, 1.1, 7, "#fff2e6", 6, 0.2);
  softbox(0, -6, 0, 14, 14, "#2a2420", 0.18, 0.8); // floor bounce
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environmentTarget = pmrem.fromScene(environment, 0.006);
  scene.environment = environmentTarget.texture;
  scene.environmentIntensity = 0.55;
  environment.traverse((o) => {
    o.geometry?.dispose();
    o.material?.dispose();
  });
  pmrem.dispose();

  // --------------------------------------------------------------------- sweep
  const wallZ = -9,
    bend = 6;
  const profile = [];
  profile.push([40, 0], [12, 0], [wallZ + bend + 0.001, 0]);
  for (let i = 1; i < 24; i++) {
    const a = (i / 24) * Math.PI * 0.5;
    profile.push([wallZ + bend - Math.sin(a) * bend, bend - Math.cos(a) * bend]);
  }
  profile.push([wallZ, bend], [wallZ, 18], [wallZ, 60]);
  const columns = 2;
  const sweepPositions = [],
    sweepNormals = [],
    sweepIndex = [];
  for (let i = 0; i < profile.length; i++) {
    const [z, y] = profile[i];
    const prev = profile[Math.max(0, i - 1)],
      next = profile[Math.min(profile.length - 1, i + 1)];
    const tz = next[0] - prev[0],
      ty = next[1] - prev[1];
    const len = Math.hypot(tz, ty) || 1;
    // Normal faces the camera side (+z / +y).
    let ny = -tz / len,
      nz = ty / len;
    if (ny < 0 || (ny === 0 && nz < 0)) {
      ny = -ny;
      nz = -nz;
    }
    for (let c = 0; c <= columns; c++) {
      sweepPositions.push(-70 + (140 * c) / columns, y, z);
      sweepNormals.push(0, ny, nz);
    }
  }
  for (let i = 0; i < profile.length - 1; i++)
    for (let c = 0; c < columns; c++) {
      const a = i * (columns + 1) + c,
        b = a + columns + 1;
      sweepIndex.push(a, a + 1, b, a + 1, b + 1, b);
    }
  const sweepGeometry = new THREE.BufferGeometry();
  sweepGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(sweepPositions, 3),
  );
  sweepGeometry.setAttribute(
    "normal",
    new THREE.Float32BufferAttribute(sweepNormals, 3),
  );
  sweepGeometry.setIndex(sweepIndex);

  const reflectionTarget = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
  });
  const reflectionMatrix = new THREE.Matrix4();
  const floorUniforms = {
    reflectionMap: { value: reflectionTarget.texture },
    reflectionMatrix: { value: reflectionMatrix },
    reflectionStrength: { value: 1 },
  };
  const floorMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.034, 0.035, 0.038),
    roughness: 0.5,
    metalness: 0,
    // Three only honours envMapIntensity with an explicit envMap; without it
    // the bright softbox environment would light the floor diffusely.
    envMap: environmentTarget.texture,
    envMapIntensity: 0.02,
  });
  floorMaterial.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, floorUniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform mat4 reflectionMatrix;varying vec4 vReflect;varying float vFlat;varying vec3 vSweep;",
      )
      .replace(
        "#include <worldpos_vertex>",
        "#include <worldpos_vertex>\nvReflect=reflectionMatrix*modelMatrix*vec4(transformed,1.);vFlat=normal.y;vSweep=position;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform sampler2D reflectionMap;uniform float reflectionStrength;varying vec4 vReflect;varying float vFlat;varying vec3 vSweep;",
      )
      .replace(
        "#include <opaque_fragment>",
        `{
          vec2 ruv=vReflect.xy/vReflect.w;
          vec3 refl=vec3(0.);
          refl+=textureLod(reflectionMap,ruv,2.2).rgb*.4;
          refl+=textureLod(reflectionMap,ruv+vec2(.004,.003),3.).rgb*.15;
          refl+=textureLod(reflectionMap,ruv-vec2(.004,.003),3.).rgb*.15;
          refl+=textureLod(reflectionMap,ruv+vec2(-.003,.005),3.4).rgb*.15;
          refl+=textureLod(reflectionMap,ruv-vec2(-.003,.005),3.4).rgb*.15;
          float NdV=clamp(dot(normal,normalize(vViewPosition)),0.,1.);
          float fres=.035+.965*pow(1.-NdV,5.);
          float flatMask=smoothstep(.985,1.,vFlat);
          float near=exp(-dot(vSweep.xz*vec2(.08,.11),vSweep.xz*vec2(.08,.11)));
          outgoingLight+=refl*flatMask*near*reflectionStrength*(.16+fres*.9);
        }
        #include <opaque_fragment>`,
      );
  };
  floorMaterial.customProgramCacheKey = () => "atelier-sweep-v1";
  const sweep = new THREE.Mesh(sweepGeometry, floorMaterial);
  sweep.receiveShadow = true;
  scene.add(sweep);

  // ------------------------------------------------------------------- lights
  scene.add(new THREE.HemisphereLight("#b9c4d0", "#17130f", 0.12));
  const key = new THREE.SpotLight("#fff1e2", 420, 0, 0.42, 1, 2);
  key.position.set(-7, 12, 8);
  key.target.position.set(0, 1.4, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 6;
  key.shadow.camera.far = 40;
  key.shadow.bias = -0.00015;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 6;
  scene.add(key, key.target);
  const wash = new THREE.SpotLight("#c9d4de", 260, 0, 0.5, 1, 2);
  wash.position.set(3, 11, 4);
  wash.target.position.set(0.5, 3.5, wallZ);
  scene.add(wash, wash.target);
  const rim = new THREE.SpotLight("#d8ecf2", 150, 0, 0.45, 1, 2);
  rim.position.set(7, 7, -7);
  rim.target.position.set(0, 1.8, 0);
  scene.add(rim, rim.target);
  const rake = new THREE.DirectionalLight("#fff0dc", 0);
  rake.position.set(-8, 3.2, -2);
  rake.castShadow = true;
  rake.shadow.mapSize.set(2048, 2048);
  Object.assign(rake.shadow.camera, {
    left: -4,
    right: 4,
    top: 4,
    bottom: -4,
    near: 1,
    far: 25,
  });
  rake.shadow.bias = -0.0003;
  rake.shadow.normalBias = 0.01;
  scene.add(rake);

  /** Per-object lighting looks. */
  function setLook(look = {}) {
    key.intensity = look.key ?? 420;
    wash.intensity = (look.wash ?? 260) * 0.55;
    rim.intensity = look.rim ?? 150;
    rake.intensity = look.rake ?? 0;
    rake.position.set(...(look.rakePosition ?? [-8, 3.2, -2]));
    key.position.set(...(look.keyPosition ?? [-7, 12, 8]));
    key.target.position.y = look.keyTargetY ?? 1.4;
    renderer.toneMappingExposure = look.exposure ?? 1.05;
    floorUniforms.reflectionStrength.value = look.reflection ?? 1;
  }

  // ---------------------------------------------------------------- materials
  const glass = new THREE.MeshPhysicalMaterial({
    color: "#ffffff",
    metalness: 0,
    roughness: 0.015,
    transmission: 1,
    thickness: 0.18,
    ior: 1.5,
    dispersion: 0.25,
    attenuationColor: new THREE.Color("#e9f4f1"),
    attenuationDistance: 6,
    specularIntensity: 1,
    envMap: environmentTarget.texture,
    envMapIntensity: 0.9,
  });
  const glassEdge = glass.clone();
  glassEdge.thickness = 0.6;
  glassEdge.roughness = 0.03;
  const metal = new THREE.MeshPhysicalMaterial({
    color: "#d4d6d8",
    metalness: 1,
    roughness: 0.16,
  });
  const darkMetal = new THREE.MeshPhysicalMaterial({
    color: "#141518",
    metalness: 0.55,
    roughness: 0.34,
    clearcoat: 0.6,
    clearcoatRoughness: 0.22,
  });
  const brass = new THREE.MeshPhysicalMaterial({
    color: "#d9b679",
    metalness: 1,
    roughness: 0.2,
  });

  function makeLiquid(color) {
    const m = new THREE.MeshPhysicalMaterial({
      color: "#ffffff",
      metalness: 0,
      roughness: 0.06,
      transmission: 0.62,
      thickness: 1.6,
      ior: 1.42,
      attenuationColor: new THREE.Color(color),
      attenuationDistance: 0.7,
      specularIntensity: 1,
      clearcoat: 0.5,
      clearcoatRoughness: 0.05,
      envMapIntensity: 1.2,
    });
    m.emissive = new THREE.Color(color);
    m.emissiveIntensity = 0.14;
    return m;
  }
  const oilA = makeLiquid("#159aab"),
    oilB = makeLiquid("#c07835");
  function tintLiquid(material, color) {
    const c = new THREE.Color(color);
    // Deepen the absorption colour so thin films stay clear and the core saturates.
    material.attenuationColor.copy(c).multiplyScalar(1.05);
    material.emissive.copy(c);
    material.color.copy(c).lerp(new THREE.Color("#ffffff"), 0.12);
  }

  // ------------------------------------------------- nested glass transmission
  const transmissionTarget = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
  });
  transmissionTarget.texture.generateMipmaps = true;
  transmissionTarget.texture.minFilter = THREE.LinearMipmapLinearFilter;
  const transmissionSize = { value: new THREE.Vector2(1, 1) };
  // What lies behind the liquids: the scene without glass shells or liquids.
  const behindTarget = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
  });
  const nestedKey = "atelier-nested-transmission-v3";
  function makeNested(material) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.atelierTransmission = {
        value: transmissionTarget.texture,
      };
      shader.uniforms.atelierTransmissionSize = transmissionSize;
      shader.uniforms.atelierMainCamera = { value: camera.position };
      // The reflection camera keeps Three's native buffer; only the main view
      // samples the buffer that already contains the transmissive contents.
      const chunk = THREE.ShaderChunk.transmission_pars_fragment.replace(
        "float lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );",
        `if(distance(cameraPosition,atelierMainCamera)<.001){
          float nestedLod=log2(atelierTransmissionSize.x)*applyIorToRoughness(roughness,ior);
          return textureBicubic(atelierTransmission,fragCoord.xy,nestedLod);
        }
        float lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );`,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <transmission_pars_fragment>",
        "uniform sampler2D atelierTransmission;uniform vec2 atelierTransmissionSize;uniform vec3 atelierMainCamera;\n" +
          chunk,
      );
    };
    material.customProgramCacheKey = () => nestedKey;
    material.userData.nested = true;
    return material;
  }
  makeNested(glass);
  makeNested(glassEdge);

  let shells = [],
    liquids = [];
  function setModel(model) {
    shells = [];
    liquids = [];
    model.traverse((o) => {
      if (o.isMesh && o.material?.userData?.nested) shells.push(o);
      if (o.isMesh && o.userData.liquid) liquids.push(o);
    });
  }
  function makeRaymarchedLiquid(options) {
    return createLiquid({
      envMap: environmentTarget.texture,
      scene: behindTarget.texture,
      mainCamera: camera.position,
      envIntensity: 0.55,
      ...options,
    });
  }
  function setVisible(list, visible) {
    for (const o of list) o.visible = visible;
  }

  // ----------------------------------------------------------- planar mirror
  const mirrorCamera = new THREE.PerspectiveCamera();
  const lookTarget = new THREE.Vector3();
  const bias = new THREE.Matrix4().set(
    0.5, 0, 0, 0.5,
    0, 0.5, 0, 0.5,
    0, 0, 0.5, 0.5,
    0, 0, 0, 1,
  );
  function renderReflection(size) {
    const w = Math.max(1, Math.round(size.x * 0.5)),
      h = Math.max(1, Math.round(size.y * 0.5));
    if (reflectionTarget.width !== w || reflectionTarget.height !== h)
      reflectionTarget.setSize(w, h);
    mirrorCamera.copy(camera);
    mirrorCamera.position.set(camera.position.x, -camera.position.y, camera.position.z);
    mirrorCamera.up.set(0, -1, 0);
    mirrorCamera.lookAt(lookTarget.x, -lookTarget.y, lookTarget.z);
    mirrorCamera.updateMatrixWorld();
    // The mirrored camera's local x axis points the other way, so the
    // horizontal view offset changes sign to cover the same reflected region.
    if (mirrorCamera.view) mirrorCamera.view.offsetX = -camera.view.offsetX;
    mirrorCamera.updateProjectionMatrix();
    reflectionMatrix
      .copy(bias)
      .multiply(mirrorCamera.projectionMatrix)
      .multiply(mirrorCamera.matrixWorldInverse);
    sweep.visible = false;
    renderer.setRenderTarget(reflectionTarget);
    renderer.clear();
    renderer.render(scene, mirrorCamera);
    sweep.visible = true;
  }

  // --------------------------------------------------------------- framing
  const v = new THREE.Vector3();
  /**
   * Place the camera so that `box` (world space) fills `rect` (CSS pixels of a
   * width×height canvas), viewed from `elevation` radians above the horizon.
   * A view offset moves the object on screen without skewing its perspective.
   */
  function frame(box, rect, width, height, elevation, zoom = 1) {
    const center = box.getCenter(new THREE.Vector3());
    lookTarget.copy(center);
    const dir = new THREE.Vector3(0, Math.sin(elevation), Math.cos(elevation));
    camera.aspect = width / height;
    camera.clearViewOffset();
    let distance = 16;
    const corners = [];
    for (let i = 0; i < 8; i++)
      corners.push(
        new THREE.Vector3(
          i & 1 ? box.max.x : box.min.x,
          i & 2 ? box.max.y : box.min.y,
          i & 4 ? box.max.z : box.min.z,
        ),
      );
    let minX, maxX, minY, maxY;
    for (let iteration = 0; iteration < 5; iteration++) {
      camera.position.copy(center).addScaledVector(dir, distance);
      camera.lookAt(center);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      minX = minY = Infinity;
      maxX = maxY = -Infinity;
      for (const c of corners) {
        v.copy(c).project(camera);
        const px = (v.x * 0.5 + 0.5) * width,
          py = (-v.y * 0.5 + 0.5) * height;
        minX = Math.min(minX, px);
        maxX = Math.max(maxX, px);
        minY = Math.min(minY, py);
        maxY = Math.max(maxY, py);
      }
      const fit = Math.min(rect.w / (maxX - minX), rect.h / (maxY - minY));
      distance /= fit;
    }
    distance *= zoom;
    camera.position.copy(center).addScaledVector(dir, distance);
    camera.lookAt(center);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    // Recompute the projected centre once more at the final distance.
    minX = minY = Infinity;
    maxX = maxY = -Infinity;
    for (const c of corners) {
      v.copy(c).project(camera);
      const px = (v.x * 0.5 + 0.5) * width,
        py = (-v.y * 0.5 + 0.5) * height;
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
    }
    const cx = (minX + maxX) / 2,
      cy = (minY + maxY) / 2;
    const tx = rect.x + rect.w / 2,
      ty = rect.y + rect.h / 2;
    camera.setViewOffset(width, height, cx - tx, cy - ty, width, height);
    camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- render
  const renderSize = new THREE.Vector2();
  function render() {
    const size = renderer.getSize(renderSize);
    const previousTarget = renderer.getRenderTarget();
    renderer.shadowMap.needsUpdate = true;
    try {
      renderReflection(size);
      if (shells.length || liquids.length) {
        const scale = Math.min(1, 1280 / size.x);
        const w = Math.max(1, Math.round(size.x * scale)),
          h = Math.max(1, Math.round(size.y * scale));
        if (transmissionTarget.width !== w || transmissionTarget.height !== h) {
          transmissionTarget.setSize(w, h);
          transmissionSize.value.set(w, h);
          behindTarget.setSize(w, h);
        }
        setVisible(shells, false);
        if (liquids.length) {
          // 1. The scene behind the liquids (no glass, no liquid).
          setVisible(liquids, false);
          renderer.setRenderTarget(behindTarget);
          renderer.render(scene, camera);
          setVisible(liquids, true);
        }
        // 2. Everything inside the glass, liquids included, for the shells.
        if (shells.length) {
          renderer.setRenderTarget(transmissionTarget);
          renderer.render(scene, camera);
        }
        setVisible(shells, true);
      }
    } finally {
      renderer.setRenderTarget(previousTarget);
    }
    renderer.render(scene, camera);
  }

  return {
    renderer,
    scene,
    camera,
    anchor,
    glass,
    glassEdge,
    metal,
    darkMetal,
    brass,
    oilA,
    oilB,
    makeLiquid,
    tintLiquid,
    makeNested,
    makeRaymarchedLiquid,
    environmentTarget,
    setModel,
    setLook,
    frame,
    render,
  };
}
