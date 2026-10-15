import * as THREE from "three";
import { Reflector } from "three/addons/objects/Reflector.js";

/** A photographed-object lighting rig: finite softboxes, dark flags, no bloom. */
export function createStudio(stage, palette) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setClearColor("#101114");
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  stage.appendChild(renderer.domElement);
  renderer.domElement.setAttribute("aria-hidden", "true");
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#101114");
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 80);
  const anchor = new THREE.Group();
  scene.add(anchor);
  // A real backdrop keeps transmission and the visible background in the same
  // linear-light/tone-mapping path (a flat Scene.background is not tone-mapped).
  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(100, 100),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.0163, 0.017, 0.0195),
    }),
  );
  backdrop.position.z = -12;
  scene.add(backdrop);

  // A purpose-built HDR studio, with large black areas between the softboxes.
  // Brightness is linear radiance. Reflective materials retain dark contours.
  const environment = new THREE.Scene();
  environment.background = new THREE.Color("#080a0d");
  function softbox(x, y, z, width, height, color, strength) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).multiplyScalar(strength),
        side: THREE.DoubleSide,
      }),
    );
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    environment.add(m);
  }
  softbox(-4, 4, 4, 3, 5, "#e9f3ff", 5);
  softbox(4, 1, 2, 1.1, 6, "#fff0dc", 3);
  softbox(-5, 7, -2, 3, 2, "#ffffff", 3);
  softbox(-4, -1, -4, 0.7, 5, "#d1e9ed", 2);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environmentTarget = pmrem.fromScene(environment, 0.025);
  scene.environment = environmentTarget.texture;
  scene.environmentIntensity = 1;
  environment.traverse((o) => {
    o.geometry?.dispose();
    o.material?.dispose();
  });
  pmrem.dispose();

  scene.add(new THREE.HemisphereLight("#c9d6e1", "#141319", 0.35));
  const key = new THREE.DirectionalLight("#fff4e9", 0.65);
  key.position.set(-3, 7, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, {
    left: -7,
    right: 7,
    top: 7,
    bottom: -7,
    near: 0.1,
    far: 25,
  });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.025;
  scene.add(key);
  const rim = new THREE.DirectionalLight("#c2dde2", 0.8);
  rim.position.set(3, 3, -4);
  scene.add(rim);
  const fill = new THREE.DirectionalLight("#ffffff", 0.2);
  fill.position.set(0, 0, 6);
  scene.add(fill);

  const mirror = new Reflector(new THREE.PlaneGeometry(100, 100), {
    textureWidth: 512,
    textureHeight: 512,
    color: 0x25272a,
    multisample: 0,
  });
  mirror.rotation.x = -Math.PI / 2;
  mirror.material.fragmentShader = mirror.material.fragmentShader
    .replace(
      "vec4 base = texture2DProj( tDiffuse, vUv );",
      `vec4 base = vec4(0.);
    for(int x=-1;x<=1;x++) for(int y=-1;y<=1;y++) {
      vec4 uv = vUv; uv.xy += vec2(float(x),float(y)) * .003 * uv.w;
      base += texture2DProj(tDiffuse,uv) / 9.;
    }`,
    )
    .replace(
      "gl_FragColor = vec4( blendOverlay( base.rgb, color ), 1.0 );",
      "gl_FragColor = vec4(mix(vec3(.0052,.0057,.007),base.rgb,.13),1.);",
    );
  mirror.material.vertexShader = mirror.material.vertexShader
    .replace("varying vec4 vUv;", "varying vec4 vUv; varying vec2 vFloor;")
    .replace(
      "vUv = textureMatrix",
      "vFloor = position.xy; vUv = textureMatrix",
    );
  mirror.material.fragmentShader = mirror.material.fragmentShader
    .replace("varying vec4 vUv;", "varying vec4 vUv; varying vec2 vFloor;")
    .replace(
      "gl_FragColor = vec4(mix(vec3(.0052,.0057,.007),base.rgb,.13),1.);",
      "float fade = exp(-dot(vFloor/vec2(5.,4.),vFloor/vec2(5.,4.))); gl_FragColor = vec4(mix(vec3(.013,.014,.017),base.rgb,.3),fade*.55);",
    );
  mirror.material.transparent = true;
  mirror.material.depthWrite = false;
  scene.add(mirror);

  // Contact shading, with a broad falloff rather than a luminous halo.
  const contact = new THREE.Mesh(
    new THREE.PlaneGeometry(9, 7),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexShader:
        "varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
      fragmentShader:
        "varying vec2 vUv;void main(){vec2 p=(vUv-.5)*vec2(3.,4.);gl_FragColor=vec4(0.,0.,0.,exp(-dot(p,p)*2.)*.7);}",
    }),
  );
  contact.rotation.x = -Math.PI / 2;
  scene.add(contact);

  const glass = new THREE.MeshPhysicalMaterial({
    color: "#ffffff",
    metalness: 0,
    roughness: 0.025,
    transmission: 1,
    opacity: 1,
    ior: 1.46,
    thickness: 0.08,
    attenuationColor: new THREE.Color("#d8ece8"),
    attenuationDistance: 8,
    specularIntensity: 0.65,
    envMapIntensity: 1,
    clearcoat: 0.15,
  });
  const glassEdge = glass.clone();
  glassEdge.thickness = 0.32;
  glassEdge.roughness = 0.08;
  const metal = new THREE.MeshStandardMaterial({
    color: "#797b79",
    metalness: 0.94,
    roughness: 0.26,
  });
  const darkMetal = new THREE.MeshStandardMaterial({
    color: "#22262a",
    metalness: 0.45,
    roughness: 0.4,
  });
  // Wax stays opaque; the orbit uses dielectric liquid with measured-style
  // absorption. Its transmission is rendered before the enclosing glass.
  const oilA = new THREE.MeshPhysicalMaterial({
    color: palette.a,
    metalness: 0,
    roughness: 0.11,
    transmission: 0.42,
    thickness: 0.85,
    ior: 1.44,
    attenuationColor: new THREE.Color(palette.a),
    attenuationDistance: 2.5,
    clearcoat: 0.35,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.2,
  });
  const oilB = oilA.clone();
  oilB.color.set(palette.b);
  oilB.attenuationColor.set(palette.b);
  oilA.color.lerp(new THREE.Color(0xffffff), 0.08);
  oilB.color.lerp(new THREE.Color(0xffffff), 0.08);
  const glowA = oilA.clone();
  glowA.transmission = 0;
  glowA.roughness = 0.17;
  const glowB = oilB.clone();
  glowB.transmission = 0;
  glowB.roughness = 0.17;

  // The separate scene buffer follows the front/back-buffer approach documented
  // by pmndrs/drei. Native transmission cannot see another transmissive object.
  // No Drei source is copied: this rig uses Three's own physical shader chunk.
  const transmissionTarget = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
  });
  transmissionTarget.texture.generateMipmaps = true;
  transmissionTarget.texture.minFilter = THREE.LinearMipmapLinearFilter;
  const transmissionSize = { value: new THREE.Vector2(1, 1) };
  for (const material of [glass, glassEdge]) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.atelierTransmission = {
        value: transmissionTarget.texture,
      };
      shader.uniforms.atelierTransmissionSize = transmissionSize;
      shader.uniforms.atelierMainCamera = { value: camera.position };
      // A planar reflection is rendered from a virtual camera. It must use that
      // view's native buffer, rather than sampling the main camera's image.
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
    material.customProgramCacheKey = () => "atelier-nested-transmission-v2";
  }
  let shells = [],
    shellVisibility = [];
  const renderSize = new THREE.Vector2();
  function setModel(model) {
    shells = [];
    model.traverse((o) => {
      if (o.isMesh && (o.material === glass || o.material === glassEdge))
        shells.push(o);
    });
    shellVisibility = new Array(shells.length);
  }
  function render() {
    if (shells.length) {
      const size = renderer.getSize(renderSize);
      const scale = Math.min(1, 1024 / size.x);
      const w = Math.max(1, Math.round(size.x * scale)),
        h = Math.max(1, Math.round(size.y * scale));
      if (transmissionTarget.width !== w || transmissionTarget.height !== h) {
        transmissionTarget.setSize(w, h);
        transmissionSize.value.set(w, h);
      }
      const previousTarget = renderer.getRenderTarget(),
        mirrorVisible = mirror.visible;
      shells.forEach((o, i) => (shellVisibility[i] = o.visible));
      shells.forEach((o) => (o.visible = false));
      mirror.visible = false;
      try {
        renderer.setRenderTarget(transmissionTarget);
        renderer.render(scene, camera);
      } finally {
        renderer.setRenderTarget(previousTarget);
        shells.forEach((o, i) => (o.visible = shellVisibility[i]));
        mirror.visible = mirrorVisible;
      }
    }
    renderer.render(scene, camera);
  }
  return {
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
    environmentTarget,
    setModel,
    render,
  };
}
