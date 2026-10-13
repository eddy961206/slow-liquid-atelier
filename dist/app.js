import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';
import { Reflector } from 'three/addons/objects/Reflector.js';

const $ = s => document.querySelector(s);
const stage = $('#stage');
const palettes = [
 {a:'#4ed8ef',b:'#ff947b',light:'#bba2cc',name:'산호와 바다'},
 {a:'#ffc35d',b:'#ec7093',light:'#dba68e',name:'햇살과 꿀'},
 {a:'#ac8bff',b:'#73e1c7',light:'#b29ddf',name:'보랏빛 꿈'}
];
const toys = [
 {title:'오일 캐스케이드',desc:'천천히, 흘러가는 대로',action:'뒤집기',hint:'다시, 천천히 흘러요'},
 {title:'라바 램프',desc:'몽글몽글, 빛이 피어나는 시간',action:'흔들기',hint:'빛이 천천히 섞여요'},
 {title:'리퀴드 오빗',desc:'작은 우주를 떠도는 물방울',action:'회오리 만들기',hint:'작은 소용돌이를 만들었어요'},
 {title:'빛의 파도',desc:'잔잔한 물결에 반짝이는 조각들',action:'물결 만들기',hint:'물결이 번져 나가요'}
];
let renderer;
try { renderer = new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'}); }
catch(e) { $('#loading').hidden=true; $('#webgl-error').hidden=false; throw e; }
renderer.setClearColor(0x101014);
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.13;
renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));
renderer.shadowMap.enabled=false;
stage.appendChild(renderer.domElement);
renderer.domElement.setAttribute('aria-hidden','true');
const scene = new THREE.Scene();
scene.background=new THREE.Color('#101014');
scene.fog=new THREE.FogExp2('#101014',.035);
const camera = new THREE.PerspectiveCamera(32,1,.1,90);
const environment = new RoomEnvironment();
// Large colored studio softboxes produce real image-based glass reflections.
function softbox(x,y,z,w,h,color){let m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide}));m.position.set(x,y,z);m.lookAt(0,0,0);environment.add(m);}
softbox(-3,1,4,.5,7,'#b1eaff');softbox(3,2,3,.7,8,'#ffb6a1');softbox(0,5,-2,8,1,'#dbd7ff');
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment=pmrem.fromScene(environment,.035).texture;
scene.environmentIntensity=.82;
environment.dispose();pmrem.dispose();
const hemi=new THREE.HemisphereLight('#d6ceff','#242035',2.0);scene.add(hemi);
const key=new THREE.DirectionalLight('#f8eaff',4);key.position.set(-4,6,5);scene.add(key);
const blue=new THREE.PointLight('#68dfff',35,12,2);blue.position.set(-3,0,2);scene.add(blue);
const coral=new THREE.PointLight('#ff9b81',32,12,2);coral.position.set(3,1,1);scene.add(coral);
const rim=new THREE.DirectionalLight('#c5cbff',3);rim.position.set(0,4,-6);scene.add(rim);
const anchor=new THREE.Group();scene.add(anchor);
let model=new THREE.Group();anchor.add(model);

// A low-contrast real planar reflection anchors each glass sculpture to the room.
const mirror=new Reflector(new THREE.PlaneGeometry(80,80),{textureWidth:768,textureHeight:768,color:0x343039,multisample:0});
mirror.rotation.x=-Math.PI/2;mirror.position.y=-2.37;
mirror.material.fragmentShader=mirror.material.fragmentShader.replace('gl_FragColor = vec4( blendOverlay( base.rgb, color ), 1.0 );','gl_FragColor = vec4( mix(vec3(0.026,0.023,0.031), blendOverlay( base.rgb, color ), 0.43), 1.0 );');
scene.add(mirror);
const glowUniforms={time:{value:0},a:{value:new THREE.Color(palettes[0].a)},b:{value:new THREE.Color(palettes[0].b)}};
const glow=new THREE.Mesh(new THREE.PlaneGeometry(22,18),new THREE.ShaderMaterial({uniforms:glowUniforms,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:`varying vec2 vUv;uniform float time;uniform vec3 a;uniform vec3 b;void main(){vec2 p=(vUv-.5)*vec2(8.,8.);float g=exp(-dot(p,p)*1.5);float ripple=pow(.5+.5*sin(length(p*vec2(1.,1.6))*18.-time*.3+sin(p.x*6.)*.7),6.);vec3 c=mix(a,b,smoothstep(-.8,.8,p.x));gl_FragColor=vec4(c,g*(.06+ripple*.06));}`}));
glow.rotation.x=-Math.PI/2;glow.position.set(.8,-2.365,.5);scene.add(glow);
const backdrop=new THREE.Mesh(new THREE.PlaneGeometry(35,24),new THREE.ShaderMaterial({depthWrite:false,uniforms:{t:{value:0}},vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:`varying vec2 vUv;void main(){vec2 p=vUv;vec3 c=vec3(.015,.014,.019);float l=exp(-pow((p.x-.50)*3.5,2.)-pow((p.y-.28)*6.,2.));c+=vec3(.025,.016,.029)*l;float l2=exp(-pow((p.x-.68)*8.,2.)-pow((p.y-.31)*7.,2.));c+=vec3(.025,.021,.034)*l2;gl_FragColor=vec4(c,1.);}`}));
backdrop.position.set(0,5,-7);scene.add(backdrop);

const glass = new THREE.MeshPhysicalMaterial({color:'#f0f3ff',metalness:0,roughness:.065,transmission:.96,transparent:true,opacity:.34,depthWrite:false,ior:1.46,thickness:.24,clearcoat:1,clearcoatRoughness:.05,envMapIntensity:1.3});
const glassEdge=new THREE.MeshPhysicalMaterial({color:'#d6ddea',metalness:.22,roughness:.075,transmission:.55,ior:1.5,thickness:.35,clearcoat:1,envMapIntensity:1.5});
const metal = new THREE.MeshStandardMaterial({color:'#3c3545',metalness:.93,roughness:.25,envMapIntensity:1.2});
const darkMetal = new THREE.MeshStandardMaterial({color:'#1e1b24',metalness:.82,roughness:.27});
const oilA=new THREE.MeshPhysicalMaterial({color:palettes[0].a,metalness:.02,roughness:.135,transmission:0,thickness:.6,ior:1.39,clearcoat:1,clearcoatRoughness:.035,envMapIntensity:1.3});
const oilB=oilA.clone();oilB.color.set(palettes[0].b);
const glowA=oilA.clone();glowA.transmission=0;glowA.emissive=new THREE.Color(palettes[0].a);glowA.emissiveIntensity=.26;glowA.roughness=.17;
const glowB=glowA.clone();glowB.color.set(palettes[0].b);glowB.emissive.set(palettes[0].b);
const sphereGeo=new THREE.SphereGeometry(1,32,24);
let dynamic=[], fluid=null, fluid2=null, sparkle=null, waveUniforms=null, toyIndex=0, paletteIndex=0;
let simTime=10,paused=matchMedia('(prefers-reduced-motion: reduce)').matches,speed=1,energy=0,flipTarget=0,flipAngle=0,flipSign=1;
let yaw=-.11,pitch=.015,targetYaw=-.11,targetPitch=.015,zoom=1,activeTime=0,frame=0;
function mesh(geo,mat,parent=model){const m=new THREE.Mesh(geo,mat);parent.add(m);return m;}
function box(w,h,d,r,mat,parent=model){return mesh(new RoundedBoxGeometry(w,h,d,5,r),mat,parent);}
function sphere(r,mat,parent=model){const m=mesh(sphereGeo,mat,parent);m.scale.setScalar(r);return m;}
function ring(r,t,y,mat,parent=model){const m=mesh(new THREE.TorusGeometry(r,t,12,80),mat,parent);m.rotation.x=Math.PI/2;m.position.y=y;return m;}
function roundOutline(w,h,r,z,mat,t=.027){const pts=[];for(let i=0;i<4;i++){const cx=(i===0||i===3?1:-1)*(w/2-r),cy=(i<2?1:-1)*(h/2-r);for(let j=0;j<=12;j++){const angle=(i*.5+j/12*.5)*Math.PI;pts.push(new THREE.Vector3(cx+r*Math.cos(angle),cy+r*Math.sin(angle),z));}}const c=new THREE.CatmullRomCurve3(pts,true);return mesh(new THREE.TubeGeometry(c,128,t,8,true),mat);}
function clearModel(){anchor.remove(model);model.traverse(o=>{if(o.geometry&&o.geometry!==sphereGeo)o.geometry.dispose();});model=new THREE.Group();anchor.add(model);dynamic=[];fluid=null;fluid2=null;sparkle=null;waveUniforms=null;flipAngle=flipTarget=0;flipSign=1;energy=0;}
function createCascade(){
 const body=box(2.64,5.64,.78,.29,glass);body.renderOrder=8;
 roundOutline(2.61,5.60,.29,.39,glassEdge,.034);roundOutline(2.61,5.60,.29,-.39,glassEdge,.024);
 // Six alternating optical-glass ramps.
 for(let i=0;i<6;i++){
  const side=i%2===0?1:-1,y=1.52-i*.60;
  const ramp=box(1.92,.067,.47,.032,glassEdge);ramp.position.set(-side*.19,y,0);ramp.rotation.z=-side*.20;
  const rail=mesh(new THREE.CylinderGeometry(.018,.018,1.95,10),glassEdge);rail.rotation.z=Math.PI/2-side*.20;rail.position.set(-side*.19,y+.018,.255);
 }
 // Clear upper feeder cups and saturated liquid reservoirs.
 for(let i=0;i<2;i++){
  const x=i? .57:-.57,mat=i?oilB:oilA;
  const cup=box(1.11,.58,.59,.18,glassEdge);cup.position.set(x,2.27,0);
  const pond=sphere(.49,mat);pond.position.set(x,2.20,0);pond.scale.set(.48,.11,.25);
  const meniscus=ring(.43,.015,2.23,mat);meniscus.position.x=x;meniscus.scale.set(1,.59,1);
  const neck=sphere(.06,mat);neck.position.set(x,2.02,0);neck.scale.set(.065,.18,.064);dynamic.push({kind:'neck',mesh:neck,i});
  const pool=sphere(.51,mat);pool.position.set(x,-2.42,0);pool.scale.set(.61,.145,.27);dynamic.push({kind:'pool',mesh:pool,i});
 }
 for(let i=0;i<32;i++){
  const m=sphere(.12,i%2?oilB:oilA);dynamic.push({kind:'drop',mesh:m,i,r:.075+(Math.sin(i*31.7)*.5+.5)*.07,offset:i*.947});
 }
 for(let i=0;i<16;i++){
  const m=sphere(.018+((i*7)%9)*.003,glassEdge);dynamic.push({kind:'bubble',mesh:m,i});
 }
}
function lathe(points,mat){return mesh(new THREE.LatheGeometry(points.map(p=>new THREE.Vector2(...p)),96),mat);}
function createLava(){
 const base=lathe([[0,-2.8],[.81,-2.8],[.88,-2.70],[.81,-2.57],[.52,-1.88],[.54,-1.75],[0,-1.75]],metal);
 ring(.82,.025,-2.72,glassEdge);ring(.53,.033,-1.79,metal);
 const vessel=lathe([[0,-1.78],[.50,-1.78],[.62,-1.64],[.78,-.93],[.76,.35],[.62,1.51],[.39,2.24],[.35,2.36],[0,2.36]],glass);vessel.renderOrder=9;
 lathe([[0,2.24],[.37,2.24],[.4,2.35],[.33,2.68],[.29,2.74],[0,2.74]],metal);
 ring(.37,.024,2.34,glassEdge);
 const baseGlow=mesh(new THREE.CylinderGeometry(.46,.43,.06,64),new THREE.MeshBasicMaterial({color:palettes[paletteIndex].b}));baseGlow.position.y=-1.76;
 fluid=new MarchingCubes(44,glowB,false,false,22000);fluid.isolation=65;fluid.scale.set(1.27,2.75,1.27);fluid.position.y=.1;model.add(fluid);
 const light=new THREE.PointLight(palettes[paletteIndex].b,7,5);light.position.y=-1.35;model.add(light);
 for(let i=0;i<10;i++){const m=sphere(.025,glassEdge);dynamic.push({kind:'lavaBubble',mesh:m,i});}
}
function createOrbit(){
 const globe=sphere(2.02,glass);globe.renderOrder=9;
 ring(1.03,.08,-2.5,metal);const stand=mesh(new THREE.CylinderGeometry(.89,1.16,.19,80),darkMetal);stand.position.y=-2.69;
 ring(1.11,.016,-2.77,glassEdge);
 const hoop=mesh(new THREE.TorusGeometry(2.16,.025,12,150),glassEdge);hoop.rotation.set(.40,.2,.12);
 fluid=new MarchingCubes(40,oilA,false,false,22000);fluid.isolation=72;fluid.scale.setScalar(2.1);model.add(fluid);
 fluid2=new MarchingCubes(36,oilB,false,false,16000);fluid2.isolation=75;fluid2.scale.setScalar(2.1);model.add(fluid2);
 for(let i=0;i<64;i++){let m=sphere(.015+((i*13)%7)*.007,i%3===0?oilB:glassEdge);dynamic.push({kind:'orbitPearl',mesh:m,i});}
}
function createWave(){
 const base=box(3.75,.20,1.66,.13,metal);base.position.y=-2.66;
 const vessel=box(3.68,3.73,1.56,.48,glass);vessel.position.y=-.64;vessel.renderOrder=9;
 roundOutline(3.63,3.69,.44,.78,glassEdge,.035).position.y=-.64;
 roundOutline(3.63,3.69,.44,-.78,glassEdge,.025).position.y=-.64;
 waveUniforms={time:{value:0},power:{value:0}};
 const waveMat=oilA.clone();waveMat.transmission=.5;waveMat.roughness=.09;waveMat.opacity=.87;waveMat.transparent=true;waveMat.depthWrite=false;
 waveMat.onBeforeCompile=s=>{s.uniforms.uTime=waveUniforms.time;s.uniforms.uPower=waveUniforms.power;s.vertexShader='uniform float uTime;uniform float uPower;\n'+s.vertexShader;s.vertexShader=s.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>\nfloat surf=smoothstep(-.4,.4,position.y);float wave=sin(position.x*2.2+uTime*.9)*.13+sin(position.z*5.-uTime*.75)*.075+sin(position.x*4.-uTime*1.5)*uPower*.10;transformed.y+=wave*surf;`);};
 const liquid=box(3.28,1.83,1.20,.32,waveMat);liquid.position.y=-1.60;
 const upper=oilB.clone();upper.transparent=true;upper.opacity=.6;upper.transmission=.45;upper.depthWrite=false;upper.onBeforeCompile=waveMat.onBeforeCompile;
 const band=box(3.28,.21,1.21,.1,upper);band.position.y=-.60;
 const sparkMat=new THREE.MeshStandardMaterial({color:'#f4e8bf',metalness:1,roughness:.18,emissive:'#e9bb6a',emissiveIntensity:.23,side:THREE.DoubleSide});
 sparkle=new THREE.InstancedMesh(new THREE.OctahedronGeometry(.026,0),sparkMat,300);sparkle.instanceMatrix.setUsage(THREE.DynamicDrawUsage);model.add(sparkle);
 for(let i=0;i<22;i++){let m=sphere(.024+(i%5)*.008,glassEdge);dynamic.push({kind:'waterBubble',mesh:m,i});}
}
function makeToy(index){clearModel();[createCascade,createLava,createOrbit,createWave][index]();}
makeToy(0);

// Deterministic kinetic paths: fluid-inspired animation, rather than a CFD solver.
function cascadePoint(u){
 const rows=6,section=u*7;
 if(section<1){const f=section;return {x:-.56,y:2.01-f*f*.24,z:.05,fall:true,f};}
 const row=Math.min(5,Math.floor(section-1)),f=(section-1)-row,dir=row%2===0?1:-1;
 const top=1.52-row*.60;
 if(f<.76){const q=f/.76;return {x:dir*(-1.05+1.72*q),y:top+.20-.344*q+.105,z:0,fall:false,f:q};}
 const q=(f-.76)/.24;return {x:dir*(.67+.11*Math.sin(q*Math.PI)),y:top-.04-(row===5?.87:.39)*q*q,z:0,fall:true,f:q};
}
const helper=new THREE.Object3D();
function updateToy(t,dt){
 if(toyIndex===0){for(const d of dynamic){let m=d.mesh;
  if(d.kind==='drop'){
   const u=((t*.037+d.offset*.083)%1+1)%1;let p=cascadePoint(u);
   const lane=d.i%2?1:-1; m.position.set((p.x+lane*.11)*flipSign,p.y*flipSign,.05+lane*.115);
   const landing=!p.fall?(1+Math.exp(-p.f*18)*.20):1;
   const stretch=p.fall?1+.38*p.f: .83;
   m.scale.set(d.r*(p.fall?.92:1.27)*landing,d.r*stretch,d.r*.83);
   m.rotation.z=p.fall?.08*Math.sin(t+d.i):(.16*lane);
  }else if(d.kind==='neck'){m.scale.y=.13+.045*Math.sin(t*1.7+d.i*2);}
  else if(d.kind==='pool'){m.scale.y=.135+.013*Math.sin(t*.8+d.i);}
  else if(d.kind==='bubble'){m.position.set(Math.sin(d.i*3.1)*1.12,-2.22+((t*.021+d.i*.313)%1)*4.67,Math.sin(d.i)*.2);}
 }}else if(toyIndex===1 && (frame%2===0||paused)){
  fluid.reset();
  for(let i=0;i<9;i++){
   const phase=t*.19+i*2.39;
   const y=.50+.29*Math.sin(phase);
   const x=.5+Math.sin(phase*.77+i)*(.072+.04*Math.sin(phase));
   const z=.5+.12*Math.cos(phase*.62+i*2.1);
   fluid.addBall(x,y,z,.62+(i%3)*.11,12);
  }
  fluid.addBall(.5,.18,.5,1.45,12);fluid.addBall(.5,.82,.5,.48,12);fluid.update();
  for(const d of dynamic){let y=((t*.026+d.i*.137)%1);d.mesh.position.set(Math.sin(d.i*2.71)*.35,-1.5+y*3.5,Math.cos(d.i)*.3);}
 }else if(toyIndex===2){
  if(frame%2===0||paused){fluid.reset();fluid2.reset();
   for(let i=0;i<7;i++){const a=t*.15+i*.55;const r=.22+.028*Math.sin(t*.25+i);fluid.addBall(.5+Math.cos(a)*r,.5+Math.sin(a)*r*.75,.5+Math.sin(a*.8)*.11,.48+(i%3)*.19,12);}
   for(let i=0;i<5;i++){const a=-t*.12+i*.67+2.8;fluid2.addBall(.5+Math.cos(a)*.24,.5+Math.sin(a)*.23,.5+Math.cos(a*.7)*.12,.6,12);}
   fluid.update();fluid2.update();
  }
  for(const d of dynamic){const a=t*.11+d.i*.36,r=1.13+.36*Math.sin(d.i*3.72);d.mesh.position.set(Math.cos(a)*r,Math.sin(a)*r*.87,Math.sin(a*.63+d.i)*.7);}
 }else if(toyIndex===3){
  waveUniforms.time.value=t;waveUniforms.power.value=energy;
  for(let i=0;i<300;i++){
   let u=((i*.61803398875)%1),v=((i*.4142135)%1),w=((i*.73205)%1);
   let drift=Math.sin(t*.15+i)*.10+Math.sin(t*.75+i*.3)*energy*.13;
   helper.position.set((u-.5)*3.0+drift,-2.34+v*1.68+Math.sin(t*.4+i*.8)*.09+Math.sin(t+i)*energy*.09,(w-.5)*1.0);
   helper.rotation.set(t*.22+i,t*.3+i*1.7,t*.17+i*.5);helper.scale.setScalar(.6+(i%7)*.17);helper.updateMatrix();sparkle.setMatrixAt(i,helper.matrix);
  }sparkle.instanceMatrix.needsUpdate=true;
  for(const d of dynamic){const y=((t*.016+d.i*.175)%1);d.mesh.position.set(Math.sin(d.i*9)*1.44,-2.3+y*1.75,Math.cos(d.i*5)*.49);}
 }
}
function applyPalette(index){paletteIndex=index;const p=palettes[index];oilA.color.set(p.a);oilB.color.set(p.b);glowA.color.set(p.a);glowA.emissive.set(p.a);glowB.color.set(p.b);glowB.emissive.set(p.b);blue.color.set(p.a);coral.color.set(p.b);glowUniforms.a.value.set(p.a);glowUniforms.b.value.set(p.b);
 document.querySelectorAll('.swatch').forEach((b,i)=>{b.classList.toggle('active',i===index);b.setAttribute('aria-pressed',i===index)});
 if(toyIndex===3)makeToy(3);toast(p.name);
}
function setToy(index){if(index===toyIndex)return;toyIndex=index;simTime=10;targetYaw=-.11;targetPitch=.015;zoom=1;makeToy(index);
 $('#toy-title').textContent=toys[index].title;$('#toy-desc').textContent=toys[index].desc;$('#interact').setAttribute('aria-label',toys[index].action);$('#interact').title=toys[index].action+' (R)';
 document.querySelectorAll('.toy').forEach((b,i)=>{b.classList.toggle('active',i===index);b.setAttribute('aria-pressed',i===index)});
 stage.setAttribute('aria-label',toys[index].title+'. 드래그하면 다른 각도로 볼 수 있습니다.');resize();
}
function setPaused(value){paused=value;$('#pause-icon').hidden=paused;$('#play-icon').hidden=!paused;$('#play').setAttribute('aria-label',paused?'재생':'일시정지');$('#play').title=paused?'재생 (Space)':'일시정지 (Space)';}
function interact(){if(toyIndex===0){flipTarget+=Math.PI;flipSign*=-1;simTime=10;}else energy=3;toast(toys[toyIndex].hint);}
let toastTimer;function toast(message){$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),2100);}
function toggleFocus(force){const on=typeof force==='boolean'?force:!document.body.classList.contains('immersive');document.body.classList.toggle('immersive',on);$('#focus').setAttribute('aria-pressed',on);resize();}
document.querySelectorAll('[data-toy]').forEach(b=>b.addEventListener('click',()=>setToy(+b.dataset.toy)));
document.querySelectorAll('[data-palette]').forEach(b=>b.addEventListener('click',()=>applyPalette(+b.dataset.palette)));
$('#play').onclick=()=>setPaused(!paused);$('#speed').onclick=()=>{const rates=[.5,1,1.5,2];speed=rates[(rates.indexOf(speed)+1)%rates.length];$('#speed').textContent=speed+'×';$('#speed').setAttribute('aria-label','재생 속도 '+speed+'배');};$('#interact').onclick=interact;$('#focus').onclick=()=>toggleFocus();$('#exit-focus').onclick=()=>toggleFocus(false);
window.addEventListener('keydown',e=>{if(e.target.tagName==='BUTTON'&&(e.code==='Space'||e.code==='Enter'))return;if(e.code==='Space'){e.preventDefault();setPaused(!paused)}if(e.code==='KeyH')toggleFocus();if(e.code==='Escape')toggleFocus(false);if(e.code==='KeyR')interact();if(['Digit1','Digit2','Digit3','Digit4'].includes(e.code))setToy(+e.code.slice(-1)-1);});
let pointer=null;
stage.addEventListener('pointerdown',e=>{pointer={x:e.clientX,y:e.clientY,id:e.pointerId};stage.setPointerCapture(e.pointerId)});
stage.addEventListener('pointermove',e=>{if(!pointer)return;targetYaw+=(e.clientX-pointer.x)*.007;targetPitch+=(e.clientY-pointer.y)*.003;targetPitch=THREE.MathUtils.clamp(targetPitch,-.24,.24);pointer.x=e.clientX;pointer.y=e.clientY;});
stage.addEventListener('pointerup',()=>pointer=null);stage.addEventListener('pointercancel',()=>pointer=null);
stage.addEventListener('dblclick',()=>{targetYaw=-.11;targetPitch=.015;zoom=1;resize();toast('처음 시점으로 돌아왔어요')});
stage.addEventListener('wheel',e=>{e.preventDefault();zoom=THREE.MathUtils.clamp(zoom+e.deltaY*.00025,.86,1.18);resize();},{passive:false});
function resize(){const w=stage.clientWidth,h=stage.clientHeight,mobile=w<=700;renderer.setSize(w,h);camera.aspect=w/h;camera.position.set(0,.40,13.55*zoom);camera.lookAt(0,.1,0);camera.updateProjectionMatrix();const immersed=document.body.classList.contains('immersive');let sc=mobile?(immersed?.92:.76):1;
 if(mobile&&w/h<.46)sc*=.9;if(!mobile&&h<650)sc=.85;
 anchor.scale.setScalar(sc);anchor.position.set(mobile?0:.72,mobile?(immersed?.25:-.12):.46,0);mirror.position.y=anchor.position.y-2.83*sc;glow.position.set(anchor.position.x,mirror.position.y+.007,.15);glow.scale.setScalar(sc);}
window.addEventListener('resize',resize);resize();setPaused(paused);
let last=performance.now(),sampleStart=last,frames=0,qualityAdjusted=false;
function tick(now){requestAnimationFrame(tick);if(document.hidden){last=now;return;}const dt=Math.min((now-last)/1000,.045);last=now;frame++;if(!paused){simTime+=dt*speed*(1+energy*.10);activeTime+=dt;energy=Math.max(0,energy-dt*.35);}yaw=THREE.MathUtils.damp(yaw,targetYaw,5,dt);pitch=THREE.MathUtils.damp(pitch,targetPitch,5,dt);flipAngle=THREE.MathUtils.damp(flipAngle,flipTarget,4,dt);
 anchor.rotation.y=yaw;anchor.rotation.x=pitch;model.rotation.z=flipAngle+(toyIndex===3?Math.sin(simTime*.45)*.028+Math.sin(simTime*1.2)*energy*.014:0);
 updateToy(simTime,dt);glowUniforms.time.value=simTime;renderer.render(scene,camera);frames++;
 if(!qualityAdjusted&&now-sampleStart>7000){const fps=frames*1000/(now-sampleStart);if(fps<29){renderer.setPixelRatio(Math.min(devicePixelRatio,1));mirror.getRenderTarget().setSize(384,384);}qualityAdjusted=true;}
 if(frame===3){$('#loading').style.opacity=0;setTimeout(()=>$('#loading').hidden=true,650);}
}
requestAnimationFrame(tick);
renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();$('#webgl-error').hidden=false});
// Progressive enhancement: the same public controls can be used by supporting agents.
if(document.modelContext?.registerTool){try{document.modelContext.registerTool({name:'configure_liquid_toy',title:'물멍 장난감 조절',description:'Select a liquid toy, palette, speed, and playback state using the same visible controls.',inputSchema:{type:'object',properties:{toy:{type:'integer',minimum:0,maximum:3},palette:{type:'integer',minimum:0,maximum:2},paused:{type:'boolean'},speed:{type:'number',enum:[.5,1,1.5,2]}},additionalProperties:false},annotations:{readOnlyHint:false},execute:input=>{if(input.toy!==undefined&&(!Number.isInteger(input.toy)||input.toy<0||input.toy>3))throw Error('Invalid toy');if(input.palette!==undefined&&(!Number.isInteger(input.palette)||input.palette<0||input.palette>2))throw Error('Invalid palette');if(input.speed!==undefined&&![.5,1,1.5,2].includes(input.speed))throw Error('Invalid speed');if(input.paused!==undefined&&typeof input.paused!=='boolean')throw Error('Invalid pause');if(input.toy!==undefined)setToy(input.toy);if(input.palette!==undefined)applyPalette(input.palette);if(input.paused!==undefined)setPaused(input.paused);if(input.speed!==undefined){speed=input.speed;$('#speed').textContent=speed+'×';}return{toy:toyIndex,palette:paletteIndex,paused,speed};}});}catch(e){console.info('Optional control integration unavailable');}}
