# 원본 리서치와 적용 범위

2026-10-15에 확인한 공개 원본. 코드와 이미지의 출처를 제품의 실제 실행 화면과 구분한다. 아래 프로젝트를 통째로 가져오거나 의존성으로 설치하지 않았다.

| 원본 | 라이선스/출처 | 적용한 원칙 |
| --- | --- | --- |
| [Three.js physical transmission](https://github.com/mrdoob/three.js/blob/dev/examples/webgl_materials_physical_transmission.html) | Three.js MIT | 유리의 opacity=1, transmission, IOR, 두께와 흡수색. 기존에 포함된 Three 물리 재질 및 shader chunk 사용 |
| [Drei MeshTransmissionMaterial](https://github.com/pmndrs/drei/blob/master/src/core/MeshTransmissionMaterial.tsx), [공식 설명](https://drei.docs.pmnd.rs/shaders/mesh-transmission-material), [vanilla 예](https://github.com/pmndrs/drei-vanilla/blob/main/.storybook/stories/MeshTransmissionMaterial.stories.ts) | MIT | 기본 transmission 버퍼는 다른 투과 물체를 담지 못한다는 제약. 외부 유리를 숨긴 별도 장면 캡처를 먼저 만들고, 외부 유리가 그 버퍼를 굴절시키는 구조를 자체 구현. 반사 카메라에는 메인 카메라 버퍼를 재사용하지 않음 |
| [Evan Wallace WebGL Water](https://github.com/evanw/webgl-water), [water.js](https://github.com/evanw/webgl-water/blob/master/water.js) | MIT | 이전 높이·속도를 유지하는 파동 전파. 수면 높이와 함께 법선을 갱신해야 반사가 물결을 따라 움직임. 현재 수조는 자체 CPU 유한차분 구현 |
| [Three.js Water2](https://github.com/mrdoob/three.js/blob/dev/examples/jsm/objects/Water2.js) | MIT | 시선 각도에 따라 바뀌는 반사, 작은 표면 변화의 중요성. Water2 평면 전체 구현은 복사하지 않음 |
| [David Li Fluid Particles](https://github.com/dli/fluid) | MIT | 밀집부·겹침·접촉에서 깊이를 읽을 수 있는 음영. GPU PIC/FLIP solver 자체는 도입하지 않음 |
| [Sisyphus 작동 원리](https://sisyphus-industries.com/about/how-sisyphus-works/), [sand-table-pattern-maker](https://github.com/markroland/sand-table-pattern-maker) | 제작사 설명 및 공개 구현 참고 | 움직이는 구슬이 모래에 남기는 누적 흔적. 현재는 높이장의 홈·양옆 둔덕과 변화하는 곡선을 자체 구현 |
| [Exploratorium Water Waves](https://annex.exploratorium.edu/xref/exhibits/water_waves.html) | 과학관 원본 | 서로 다른 위치에서 발생한 파동의 간섭과 반사 |
| [myPhysicsLab](https://github.com/myphysicslab/myphysicslab), [chaos-pendulum](https://github.com/nicklavers/chaos-pendulum) | 공개 물리 구현 참고 | 이중 진자는 각도와 각속도를 적분해야 초기 조건의 영향이 살아 있음. 현재는 표준 운동 방정식과 자체 RK4 구현 |
| [Mathmos FAQ](https://mathmos.com/faq/) | 제작사 설명 | 가열·냉각에 따라 부력이 달라지는 왁스. 각 덩어리의 온도와 상승/하강 상태를 유지 |
| [DuneScape](https://github.com/otto-link/DuneScape), [Sachiko Kodama](https://www.kodama.hc.uec.ac.jp/index-pf08.html) | MIT 프로젝트 / 작가 원본 | 사구와 자성 유체도 비교했지만, 이번에는 모래 흔적·수조·이중 진자를 추가하는 방향을 선택 |

## 렌더러 개편에 참고한 자료

| 자료 | 종류 | 적용한 내용 |
| --- | --- | --- |
| [Inigo Quilez, smooth minimum](https://iquilezles.org/articles/smin/) | 기법 설명 | 메타볼 액체를 다항식 smooth-min SDF로 합침 |
| Simon Green, *Screen Space Fluid Rendering* (NVIDIA, GDC 2010) | 발표 자료 | 두께 기반 Beer–Lambert 흡수, 프레넬 반사와 굴절의 혼합으로 액체 색을 만듦 |
| [Codrops: Liquid Raymarching Scene](https://tympanus.net/codrops/?p=78977) | 튜토리얼 | 레이마칭 루프와 SDF 법선 계산 구조 확인 |
| [drei MeshTransmissionMaterial](https://drei.docs.pmnd.rs/shaders/mesh-transmission-material) | 라이브러리 문서 | 별도 장면 버퍼로 중첩 투과를 처리하는 방식(코드는 복사하지 않음) |
| Three.js r180 `cube_uv_reflection_fragment` | 포함된 MIT 코드 | 레이마칭 셰이더에서 PMREM 환경맵을 샘플링 |

코드를 그대로 가져온 외부 프로젝트는 없다. 위 기법은 `dist/liquid.js`, `dist/studio.js`, `dist/tidal-pool.js`에 직접 구현했다.

## 반복이 덜 드러나게 한 방법

- 물결, 진자, 대류는 이전 상태에서 다음 상태를 계산한다. 정해진 길이의 영상을 반복하거나 일정 시각에 전체 위치를 초기화하지 않는다.
- 모래는 기존 홈을 유지한다. 구슬의 중심·반지름·각속도 목표가 서로 다른 간격으로 변하고 부드럽게 이어진다.
- 오빗은 천천히 바뀌는 흐름 매개변수를 사용한다. 물리 유체 solver는 아니며 이 장면은 조형적인 근사다.
- 캐스케이드의 순환 이동은 불투명한 양끝 저장부 뒤에서만 이뤄진다. 눈에 보이는 경사면 사이에는 순간이동을 사용하지 않는다.
- 진자에는 약한 감쇠를 적용한다. 아주 오래 지나 움직임이 거의 사라지면 작은 자기 구동 충격으로 이어 가며 위치를 되감지 않는다.

## 이미지 생성 자료

`docs/design-reference.png`는 내장 Image Gen으로 만든 `ui-mockup` 참고 자료다. 런타임 배경이나 3D 조형물로 사용하지 않는다. 최종 방향의 핵심 프롬프트는 다음과 같다.

> Same Korean editorial layout; believable tabletop glass sphere on a dark circular plinth, rounded teal and amber nonmetallic oil, natural studio softbox reflections, realistic glass thickness and refraction, smooth cohesive liquid with surface tension, grounded contact shadow, satin dark floor with soft reflection. Remove stars, smoke, glitter, glow, lens flares and neon. Real-time Three.js in the final implementation.

실제 실행 화면은 `docs/screenshots/`에 별도로 저장했다. 고정된 생성 이미지와 실시간 렌더의 세부 형태·투과 품질은 동일하지 않다.
