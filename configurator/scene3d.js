// 3D-сцена сборки на three.js — «витринный» рендер: реальные пропорции (всё моделируется в миллиметрах),
// студийное освещение с отражениями (PMREM-окружение), мягкие тени, скруглённые металлические детали,
// вентиляторы с изогнутыми лопастями и лёгкое свечение подсветки (bloom). Это по-прежнему стилизация,
// не фото и не точные копии устройств, но форма зависит от КОНКРЕТНОЙ выбранной модели (см. визуальные
// подсказки armor/rgb/color/front/finish/... в data.js).
//
// Система координат корпуса (мм, центр корпуса в нуле): x — от задней стенки (−) к передней (+),
// y — вверх, z — от поддона платы (−) к боковому стеклу (+, смотрит на зрителя).
// У платы своя локальная система: u — вправо от края с разъёмами, v — вниз от верхнего края (как на схемах плат).
import { STEPS, FORM_RANK } from "./data.js";

const LIME = 0xb9ff01;
const CYAN = 0x22d3ee;
const U = 1 / 200; // мм → единицы сцены

const CASE_DIM = { mATX: { d: 400, h: 440, w: 215 }, ATX: { d: 450, h: 480, w: 230 } };
const BOARD_H = { mATX: 244, ATX: 305 };
const BOARD_W = 244;
const SOCKET = { u: 112, v: 88 };
const DIMM_U = [168, 177, 188, 197]; // заняты 2-й и 4-й слоты — как рекомендуют для пары модулей
const DIMM_TOP = 18;
const DIMM_LEN = 133;
const PCIE_V = 172;
const M2 = { u: 22, v: 151 };

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const easeOut = (p) => 1 - Math.pow(1 - p, 3);
const easeIn = (p) => p * p * p;

function canvas(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  return c;
}

export class Scene3D {
  static async create(root) {
    const [THREE, rb, bgu, ec, rp, ub, op] = await Promise.all([
      import("three"),
      import("three/addons/geometries/RoundedBoxGeometry.js"),
      import("three/addons/utils/BufferGeometryUtils.js"),
      import("three/addons/postprocessing/EffectComposer.js"),
      import("three/addons/postprocessing/RenderPass.js"),
      import("three/addons/postprocessing/UnrealBloomPass.js"),
      import("three/addons/postprocessing/OutputPass.js"),
    ]);
    return new Scene3D(root, THREE, {
      RoundedBoxGeometry: rb.RoundedBoxGeometry,
      mergeGeometries: bgu.mergeGeometries,
      EffectComposer: ec.EffectComposer,
      RenderPass: rp.RenderPass,
      UnrealBloomPass: ub.UnrealBloomPass,
      OutputPass: op.OutputPass,
    });
  }

  constructor(root, THREE, addons) {
    this.THREE = THREE;
    this.A = addons;
    this.root = root;

    // Сначала создаём WebGL-рендерер и только при успехе трогаем DOM — если WebGL не поднимется,
    // исключение вылетит ДО удаления CSS-заглушки, и createScene() спокойно откатится на неё.
    const cnv = document.createElement("canvas");
    cnv.className = "scene__gl";
    const renderer = new THREE.WebGLRenderer({ canvas: cnv, antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true });
    root.querySelector("#sceneStage")?.remove();
    root.prepend(cnv);
    this.canvas = cnv;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.3;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false; // тени пересчитываем только когда детали двигаются (свет вращается вместе со сборкой)
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.scene = scene;
    scene.background = this.backgroundTexture();
    scene.environment = this.studioEnvironment();

    const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 60);
    this.camera = camera;

    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x1a1c22, 0.7));

    // rig вращается целиком; model — масштаб мм→единицы, внутри всё в миллиметрах.
    this.rig = new THREE.Group();
    scene.add(this.rig);
    this.model = new THREE.Group();
    this.model.scale.setScalar(U);
    this.rig.add(this.model);

    // Ключевой свет «через стекло» сверху-спереди. Живёт внутри rig, поэтому тени не нужно
    // пересчитывать на каждом кадре вращения — только когда детали появляются/убираются.
    const key = new THREE.DirectionalLight(0xffffff, 3.2);
    key.position.set(0.9, 2.6, 2.4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -1.7, right: 1.7, top: 1.7, bottom: -1.7, near: 0.5, far: 7 });
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    this.rig.add(key, key.target);
    const rim = new THREE.DirectionalLight(0xcfe9ff, 0.8);
    rim.position.set(-2.5, 1.2, -1.5);
    this.rig.add(rim, rim.target);
    // мягкая заливка со стороны зрителя — чтобы тёмный текстолит и металл читались через стекло
    const fill = new THREE.DirectionalLight(0xe8f0ff, 1.1);
    fill.position.set(0.4, 0.5, 3);
    scene.add(fill);

    // Постобработка: сглаживание (MSAA в рендер-таргете) + мягкое свечение ярких элементов подсветки.
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new addons.EffectComposer(renderer, rt);
    this.composer.addPass(new addons.RenderPass(scene, camera));
    this.bloom = new addons.UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.45, 1.25);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new addons.OutputPass());

    this.tex = this.sharedTextures();
    this.geoCache = new Map();
    this.meshes = {};
    this.parts = Object.fromEntries(STEPS.map((s) => [s.key, null]));
    this.spinners = [];
    this.animQueue = [];
    this.layoutKey = "";
    this.updateLayout();
    this.addFloor();
    this.swap("case", false);

    this.yaw = -0.55;
    this.baseYaw = -0.55;
    this.time = 0;
    this.applyAngle();
    this.bindDrag();
    this.resize = new ResizeObserver(() => this.onResize());
    this.resize.observe(root);
    this.onResize();

    // Не рисуем, когда сцена за пределами экрана или вкладка скрыта — экономим батарею телефона.
    this.visible = true;
    new IntersectionObserver(([e]) => {
      this.visible = e.isIntersecting;
      this.wake();
    }).observe(root);
    document.addEventListener("visibilitychange", () => this.wake());

    this.clock = new THREE.Clock();
    this.shadowsDirty = true;
    this.raf = requestAnimationFrame(this.tick.bind(this));
    root.dataset.sceneReady = "3d"; // для тестов и отладки — какая версия сцены сейчас работает
  }

  // ———————————————————————————— окружение ————————————————————————————

  backgroundTexture() {
    const { THREE } = this;
    const c = canvas(512, 512, (g, w, h) => {
      g.fillStyle = "#07080d";
      g.fillRect(0, 0, w, h);
      let r = g.createRadialGradient(w * 0.5, h * 0.18, 0, w * 0.5, h * 0.18, w * 0.75);
      r.addColorStop(0, "rgba(185,255,1,.10)");
      r.addColorStop(1, "rgba(185,255,1,0)");
      g.fillStyle = r;
      g.fillRect(0, 0, w, h);
      r = g.createRadialGradient(w * 0.88, h * 0.95, 0, w * 0.88, h * 0.95, w * 0.6);
      r.addColorStop(0, "rgba(34,211,238,.09)");
      r.addColorStop(1, "rgba(34,211,238,0)");
      g.fillStyle = r;
      g.fillRect(0, 0, w, h);
    });
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /** Процедурная «фотостудия»: тёмная комната и несколько софтбоксов (белый сверху, холодный слева,
   * лаймовый и бирюзовый контровые). Её отражения и делают металл/стекло «дорогими». */
  studioEnvironment() {
    const { THREE } = this;
    const s = new THREE.Scene();
    s.add(new THREE.Mesh(new THREE.BoxGeometry(20, 14, 20), new THREE.MeshBasicMaterial({ color: 0x0b0c11, side: THREE.BackSide })));
    const panel = (w, h, color, k, pos) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
      m.position.set(...pos);
      m.lookAt(0, 0, 0);
      s.add(m);
    };
    panel(9, 3.5, 0xffffff, 5, [0, 6.5, 1.5]);
    panel(2.2, 7, 0xeaf2ff, 2.6, [-7, 1, 5]);
    panel(2.2, 6, 0xffffff, 1.6, [7, 1, 5]);
    panel(1.2, 7, LIME, 1.6, [8, 0, -3]);
    panel(1.2, 7, CYAN, 2.2, [-8, 0, -5]);
    panel(9, 2, 0xffffff, 0.5, [0, -5, 6]);
    const pm = new THREE.PMREMGenerator(this.renderer);
    const env = pm.fromScene(s, 0.035).texture;
    pm.dispose();
    s.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
    return env;
  }

  sharedTextures() {
    const { THREE } = this;
    const tex = (c, srgb = true, rep) => {
      const t = new THREE.CanvasTexture(c);
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      if (rep) {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
      }
      return t;
    };
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    // Текстолит платы: матово-чёрный, едва заметные дорожки и шелкография — как у современных плат.
    const pcb = tex(
      canvas(1024, 1024, (g, w, h) => {
        g.fillStyle = "#1b1e23";
        g.fillRect(0, 0, w, h);
        g.lineCap = "round";
        for (let i = 0; i < 260; i++) {
          g.strokeStyle = `rgba(160,175,190,${0.03 + rnd() * 0.04})`;
          g.lineWidth = 1 + rnd() * 1.5;
          let x = rnd() * w;
          let y = rnd() * h;
          g.beginPath();
          g.moveTo(x, y);
          for (let k = 0; k < 3; k++) {
            const len = 20 + rnd() * 90;
            const dir = Math.floor(rnd() * 4);
            if (dir === 0) x += len;
            else if (dir === 1) x -= len;
            else if (dir === 2) y += len;
            else y -= len;
            if (rnd() > 0.5) {
              x += 12;
              y += 12;
            }
            g.lineTo(x, y);
          }
          g.stroke();
        }
        g.strokeStyle = "rgba(210,220,230,.13)";
        g.lineWidth = 1.5;
        for (let i = 0; i < 70; i++) g.strokeRect(rnd() * w, rnd() * h, 6 + rnd() * 20, 6 + rnd() * 12);
        g.fillStyle = "rgba(200,210,220,.07)";
        for (let i = 0; i < 40; i++) g.fillRect(rnd() * w, rnd() * h, 20 + rnd() * 50, 3);
      }),
    );
    // Перфорация сетчатых панелей
    const mesh = tex(
      canvas(64, 64, (g) => {
        g.fillStyle = "#fff";
        g.fillRect(0, 0, 64, 64);
        g.fillStyle = "#1a1a1a";
        for (const [x, y] of [[16, 16], [48, 16], [0, 48], [32, 48], [64, 48]]) {
          g.beginPath();
          g.arc(x, y, 11, 0, Math.PI * 2);
          g.fill();
        }
      }),
      true,
      true,
    );
    // Рёбра радиатора СЖО / видеокарты
    const fins = tex(
      canvas(64, 16, (g) => {
        g.fillStyle = "#565c66";
        g.fillRect(0, 0, 64, 16);
        g.fillStyle = "#121418";
        for (let x = 0; x < 64; x += 4) g.fillRect(x, 0, 2, 16);
      }),
      true,
      true,
    );
    // Оплётка трубок СЖО (как карта рельефа)
    const braid = tex(
      canvas(64, 64, (g) => {
        g.fillStyle = "#808080";
        g.fillRect(0, 0, 64, 64);
        g.strokeStyle = "#fff";
        g.lineWidth = 3;
        for (let i = -64; i < 128; i += 8) {
          g.beginPath();
          g.moveTo(i, 0);
          g.lineTo(i + 64, 64);
          g.stroke();
        }
        g.strokeStyle = "#000";
        for (let i = -64; i < 128; i += 8) {
          g.beginPath();
          g.moveTo(i, 64);
          g.lineTo(i + 64, 0);
          g.stroke();
        }
      }),
      false,
      true,
    );
    // Мягкое пятно света на «полу» и контактная тень под корпусом
    const floor = tex(
      canvas(256, 256, (g, w) => {
        const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
        r.addColorStop(0, "rgba(190,220,255,.10)");
        r.addColorStop(0.5, "rgba(120,160,200,.04)");
        r.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = r;
        g.fillRect(0, 0, w, w);
      }),
    );
    const shadow = tex(
      canvas(256, 256, (g, w) => {
        g.filter = "blur(18px)";
        g.fillStyle = "rgba(0,0,0,.85)";
        g.fillRect(44, 60, w - 88, w - 120);
      }),
    );
    return { pcb, mesh, fins, braid, floor, shadow };
  }

  addFloor() {
    const { THREE } = this;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(1500, 1500), new THREE.MeshBasicMaterial({ map: this.tex.floor, transparent: true, depthWrite: false, dithering: true }));
    floor.rotation.x = -Math.PI / 2;
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.tex.shadow, transparent: true, depthWrite: false, dithering: true }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.5;
    const g = new THREE.Group();
    g.add(floor, shadow);
    this.floor = { group: g, shadow };
    this.model.add(g);
    this.placeFloor();
  }

  placeFloor() {
    const { d, h, w } = this.L.C;
    this.floor.group.position.y = -h / 2 - 12;
    this.floor.shadow.scale.set(d * 1.35, w * 1.9, 1);
  }

  // ———————————————————————————— раскладка ————————————————————————————

  /** Размер корпуса — по большему из форм-факторов корпуса и платы (ATX-плата «раздвигает» и пустой корпус). */
  updateLayout() {
    const caseForm = this.parts.case?.form;
    const mbForm = this.parts.motherboard?.form;
    const rank = Math.max(FORM_RANK[caseForm] || 1, FORM_RANK[mbForm] || 1);
    const cf = rank >= 2 ? "ATX" : "mATX";
    const key = cf + (mbForm || "");
    if (key === this.layoutKey) return false;
    this.layoutKey = key;
    const C = CASE_DIM[cf];
    const ox = -C.d / 2 + 22;
    const oy = C.h / 2 - 32;
    const oz = -C.w / 2 + 26;
    this.L = { cf, C, ox, oy, oz, boardH: BOARD_H[mbForm || "mATX"], at: (u, v, z = 0) => [ox + u, oy - v, oz + z] };
    return true;
  }

  // ———————————————————————————— строительные блоки ————————————————————————————

  mat(kind, color, rough) {
    const { THREE } = this;
    switch (kind) {
      case "metal":
        return new THREE.MeshStandardMaterial({ color, metalness: 0.92, roughness: rough ?? 0.28 });
      case "anod": // анодированный алюминий / порошковая краска
        return new THREE.MeshStandardMaterial({ color, metalness: 0.6, roughness: rough ?? 0.4 });
      case "glow":
        return new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(rough ?? 2) });
      default: // матовый пластик/краска
        return new THREE.MeshStandardMaterial({ color, metalness: 0.08, roughness: rough ?? 0.6 });
    }
  }

  mesh(geo, mat, x = 0, y = 0, z = 0) {
    const m = new this.THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    return m;
  }

  rbox(w, h, d, r, mat, x, y, z) {
    const rr = Math.max(0.05, Math.min(r, Math.min(w, h, d) / 2 - 0.05));
    return this.mesh(new this.A.RoundedBoxGeometry(w, h, d, 3, rr), mat, x, y, z);
  }

  box(w, h, d, mat, x, y, z) {
    return this.mesh(new this.THREE.BoxGeometry(w, h, d), mat, x, y, z);
  }

  /** Профиль (точки в плоскости XY) → объём толщиной depth вдоль Z, с мягкой фаской. */
  extrude(points, depth, bevel = 0.6, holes = []) {
    const { THREE } = this;
    const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
    holes.forEach((h) => shape.holes.push(h));
    return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 24 });
  }

  shared(key, make) {
    if (!this.geoCache.has(key)) {
      const g = make();
      g.userData.shared = true;
      this.geoCache.set(key, g);
    }
    return this.geoCache.get(key);
  }

  labelTexture(w, h, draw, holder) {
    const t = new this.THREE.CanvasTexture(canvas(w, h, draw));
    t.colorSpace = this.THREE.SRGBColorSpace;
    t.anisotropy = 4;
    (holder.userData.textures ||= []).push(t);
    return t;
  }

  /** Ротор: изогнутые лопасти с шагом (закрутка вдоль ширины лопасти), склеенные в одну геометрию. */
  rotorGeometry(r0, r1, n, sweep = 0.55) {
    return this.shared(`rotor${r0}|${r1}|${n}`, () => {
      const { THREE } = this;
      const pts = [];
      const width = (t) => ((Math.PI * 2) / n) * (0.5 + 0.28 * t);
      const lead = (t) => sweep * Math.pow(t, 1.15);
      const N = 12;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const r = r0 + (r1 - r0) * t;
        pts.push([r * Math.cos(lead(t)), r * Math.sin(lead(t))]);
      }
      for (let j = 1; j < 6; j++) {
        const a = lead(1) - (width(1) * j) / 6;
        pts.push([r1 * Math.cos(a), r1 * Math.sin(a)]);
      }
      for (let i = N; i >= 0; i--) {
        const t = i / N;
        const r = r0 * 0.98 + (r1 - r0 * 0.98) * t;
        const a = lead(t) - width(t);
        pts.push([r * Math.cos(a), r * Math.sin(a)]);
      }
      const blade = this.extrude(pts, 0.6, 0.35);
      // закрутка: сдвигаем по Z пропорционально углу внутри лопасти — появляется «шаг» пропеллера
      const p = blade.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        const y = p.getY(i);
        const r = Math.hypot(x, y);
        const t = Math.min(1, Math.max(0, (r - r0) / (r1 - r0)));
        const mid = lead(t) - width(t) / 2;
        let da = Math.atan2(y, x) - mid;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        p.setZ(i, p.getZ(i) + da * r * 0.42);
      }
      blade.computeVertexNormals();
      const copies = [];
      for (let i = 0; i < n; i++) copies.push(blade.clone().rotateZ((i / n) * Math.PI * 2));
      const merged = this.A.mergeGeometries(copies);
      blade.dispose();
      copies.forEach((c) => c.dispose());
      return merged;
    });
  }

  /** Вентилятор: ось — Z, лицевая сторона — +Z. frame — квадратная рамка 120-мм корпусного вентилятора. */
  fan(size, { frame = true, blades = 9, argb = false, frameColor = 0x16181c, ring = CYAN, speed = 2.4 } = {}) {
    const { THREE } = this;
    const g = new THREE.Group();
    const r1 = frame ? size / 2 - 5 : size / 2 - 1;
    const r0 = size * 0.15;
    const rotor = new THREE.Group();
    const bladeMat = argb
      ? new THREE.MeshStandardMaterial({ color: 0x2b313b, metalness: 0.1, roughness: 0.3, emissive: ring, emissiveIntensity: 0.12 })
      : new THREE.MeshStandardMaterial({ color: 0x1a1c21, metalness: 0.15, roughness: 0.45 });
    const bl = this.mesh(this.rotorGeometry(r0, r1, blades), bladeMat);
    bl.userData.noCast = true;
    rotor.add(bl);
    const hub = this.mesh(new THREE.CylinderGeometry(r0, r0, 12, 40), this.mat("plastic", 0x121317, 0.35));
    hub.rotation.x = Math.PI / 2;
    rotor.add(hub);
    const cap = this.mesh(new THREE.CylinderGeometry(r0 * 0.72, r0 * 0.72, 0.6, 40), this.mat("metal", 0x9aa1ab, 0.22), 0, 0, 6.2);
    cap.rotation.x = Math.PI / 2;
    rotor.add(cap);
    g.add(rotor);
    if (frame) {
      const s = size / 2;
      const hole = new THREE.Path();
      hole.absarc(0, 0, r1 + 1.5, 0, Math.PI * 2, true);
      const geo = this.shared(`frame${size}`, () => {
        const shape = new THREE.Shape();
        const c = 8;
        shape.moveTo(-s + c, -s);
        shape.lineTo(s - c, -s);
        shape.quadraticCurveTo(s, -s, s, -s + c);
        shape.lineTo(s, s - c);
        shape.quadraticCurveTo(s, s, s - c, s);
        shape.lineTo(-s + c, s);
        shape.quadraticCurveTo(-s, s, -s, s - c);
        shape.lineTo(-s, -s + c);
        shape.quadraticCurveTo(-s, -s, -s + c, -s);
        shape.holes.push(hole);
        return new THREE.ExtrudeGeometry(shape, { depth: 23, bevelEnabled: true, bevelThickness: 1, bevelSize: 1, bevelSegments: 2, curveSegments: 40 }).translate(0, 0, -11.5);
      });
      g.add(this.mesh(geo, this.mat("plastic", frameColor, 0.5)));
      // стойки мотора сзади
      const strutMat = this.mat("plastic", frameColor, 0.5);
      for (let i = 0; i < 4; i++) {
        const st = this.box(r1 - r0, 3, 3, strutMat, 0, 0, -10);
        st.geometry.translate((r1 + r0) / 2, 0, 0);
        st.rotation.z = Math.PI / 4 + (i * Math.PI) / 2;
        g.add(st);
      }
      const motor = this.mesh(new THREE.CylinderGeometry(r0 + 1, r0 + 1, 6, 32), this.mat("plastic", frameColor, 0.5), 0, 0, -9);
      motor.rotation.x = Math.PI / 2;
      g.add(motor);
      if (argb) {
        [12.2, -12.2].forEach((z, i) => {
          const t = this.mesh(new THREE.TorusGeometry(r1 + 1.5, 1.3, 10, 72), this.mat("glow", ring, i ? 1.2 : 2.8), 0, 0, z);
          t.userData.noCast = true;
          g.add(t);
        });
      }
    } else {
      const t = this.mesh(new THREE.TorusGeometry(r1 + 2, 1.6, 10, 72), this.mat("metal", 0x3a3f47, 0.3));
      g.add(t);
    }
    g.userData.spinner = { obj: rotor, speed };
    return g;
  }

  glassMaterial(w, h, border, holder) {
    // Закалённое стекло с тёмной шелкографией по краю — центр почти прозрачный
    const bw = Math.round((border / w) * 512);
    const bh = Math.round((border / h) * 512);
    const map = this.labelTexture(512, 512, (g) => {
      g.fillStyle = "rgba(8,10,14,.94)";
      g.fillRect(0, 0, 512, 512);
      g.clearRect(bw, bh, 512 - bw * 2, 512 - bh * 2);
      g.fillStyle = "rgba(40,48,60,.10)";
      g.fillRect(bw, bh, 512 - bw * 2, 512 - bh * 2);
    }, holder);
    return new this.THREE.MeshPhysicalMaterial({ map, transparent: true, roughness: 0.03, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, depthWrite: false, envMapIntensity: 1.6 });
  }

  // ———————————————————————————— детали ————————————————————————————

  buildCase(part) {
    const { THREE } = this;
    const { d, h, w } = this.L.C;
    const g = new THREE.Group();
    if (!part) {
      // Корпус ещё не выбран: тонкий «чертёж» габаритов с лаймовыми уголками.
      const lines = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(d, h, w)), new THREE.LineBasicMaterial({ color: 0xb8c4d6, transparent: true, opacity: 0.16 }));
      g.add(lines);
      const pts = [];
      const L = 26;
      for (const sx of [-1, 1])
        for (const sy of [-1, 1])
          for (const sz of [-1, 1]) {
            const x = (sx * d) / 2;
            const y = (sy * h) / 2;
            const z = (sz * w) / 2;
            pts.push(x, y, z, x - sx * L, y, z, x, y, z, x, y - sy * L, z, x, y, z, x, y, z - sz * L);
          }
      const cg = new THREE.BufferGeometry();
      cg.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      g.add(new THREE.LineSegments(cg, new THREE.LineBasicMaterial({ color: LIME, transparent: true, opacity: 0.85 })));
      const ghost = new THREE.MeshBasicMaterial({ color: 0x9fb4d0, transparent: true, opacity: 0.025, depthWrite: false, side: THREE.DoubleSide });
      g.add(this.box(d, h, w, ghost));
      return { group: g, from: new THREE.Vector3() };
    }

    const white = part.color === "white";
    const ext = white ? this.mat("plastic", 0xb9bdc4, 0.5) : this.mat("anod", 0x23262c, 0.32);
    const inner = white ? this.mat("plastic", 0xa9aeb6, 0.6) : this.mat("plastic", 0x202329, 0.55);
    const noCast = (m) => ((m.userData.noCast = true), m);

    // Каркас: верх, низ, задняя стенка, поддон платы, глухая правая боковина
    const top = noCast(this.rbox(d, 10, w, 4, ext, 0, h / 2 - 5, 0));
    g.add(top);
    const vent = new THREE.MeshStandardMaterial({ color: white ? 0xcfd3da : 0x0d0e11, metalness: 0.3, roughness: 0.5, alphaMap: this.tex.mesh, transparent: true, depthWrite: false });
    vent.alphaMap = this.tex.mesh.clone();
    vent.alphaMap.repeat.set((d - 80) / 9, (w - 70) / 9);
    vent.alphaMap.needsUpdate = true;
    (g.userData.textures ||= []).push(vent.alphaMap);
    const ventTop = noCast(this.box(d - 80, 0.6, w - 70, vent, 0, h / 2 + 0.4, 0));
    g.add(ventTop);
    g.add(this.rbox(d, 10, w, 4, ext, 0, -h / 2 + 5, 0));
    g.add(this.box(10, h - 20, w - 4, ext, -d / 2 + 5, 0, 0));
    g.add(this.box(d - 20, h - 20, 3, inner, 0, 0, -w / 2 + 3));
    g.add(noCast(this.box(d - 4, h - 4, 3, ext, 0, 0, -w / 2 - 0.5)));
    // Заглушки слотов расширения на задней стенке и резиновые кабельные проходы на поддоне
    const slotMat = this.mat("metal", white ? 0xc9cdd3 : 0x2a2d33, 0.35);
    for (let i = 0; i < (this.L.cf === "ATX" ? 7 : 4); i++) g.add(this.box(2, 12, w * 0.46, slotMat, -d / 2 + 11, this.L.oy - 168 - i * 20.3, -w / 2 + 26 + w * 0.23));
    const grom = this.mat("plastic", 0x0b0c0e, 0.8);
    for (let i = 0; i < 3; i++) g.add(this.rbox(14, 52, 2, 6, grom, this.L.ox + BOARD_W + 18, this.L.oy - 40 - i * 72, -w / 2 + 5));

    // Передняя панель: стекло «панорамой» или сетка
    if (part.front === "glass") {
      const fg = noCast(this.mesh(new THREE.PlaneGeometry(w - 8, h - 14), this.glassMaterial(w, h, 10, g), d / 2 - 1, 0, 0));
      fg.rotation.y = Math.PI / 2;
      fg.renderOrder = 10;
      g.add(fg);
      g.add(this.rbox(12, h, 12, 3, ext, d / 2 - 6, 0, -w / 2 + 6));
    } else {
      const meshFront = new THREE.MeshStandardMaterial({ color: white ? 0xdfe2e7 : 0x16181c, metalness: 0.35, roughness: 0.45, alphaMap: this.tex.mesh.clone(), transparent: true, side: THREE.DoubleSide });
      meshFront.alphaMap.repeat.set((w - 20) / 7, (h - 30) / 7);
      meshFront.alphaMap.needsUpdate = true;
      (g.userData.textures ||= []).push(meshFront.alphaMap);
      const fr = noCast(this.box(2, h - 30, w - 20, meshFront, d / 2 - 3, 0, 0));
      g.add(fr);
      // рамка вокруг сетки
      g.add(noCast(this.rbox(12, 14, w, 3, ext, d / 2 - 6, h / 2 - 8, 0)));
      g.add(noCast(this.rbox(12, 14, w, 3, ext, d / 2 - 6, -h / 2 + 8, 0)));
      g.add(noCast(this.rbox(12, h, 12, 3, ext, d / 2 - 6, 0, -w / 2 + 6)));
      g.add(noCast(this.rbox(12, h, 12, 3, ext, d / 2 - 6, 0, w / 2 - 6)));
    }
    // Задняя вертикальная стойка у стекла
    g.add(this.rbox(10, h, 10, 3, ext, -d / 2 + 5, 0, w / 2 - 5));

    // Кожух блока питания с окном, через которое видна наклейка БП
    const sy = -h / 2 + 104;
    const shroudX0 = -d / 2 + 10;
    const shroudX1 = d / 2 - 40;
    g.add(this.box(shroudX1 - shroudX0, 4, w - 8, ext, (shroudX0 + shroudX1) / 2, sy, 0));
    const wx0 = -d / 2 + 26;
    const wx1 = wx0 + 140;
    const face = w / 2 - 10;
    const fy0 = -h / 2 + 10;
    g.add(this.box(wx0 - shroudX0, sy - fy0, 3, ext, (shroudX0 + wx0) / 2, (sy + fy0) / 2, face));
    g.add(this.box(shroudX1 - wx1, sy - fy0, 3, ext, (wx1 + shroudX1) / 2, (sy + fy0) / 2, face));
    g.add(this.box(wx1 - wx0, 14, 3, ext, (wx0 + wx1) / 2, sy - 7, face));
    g.add(this.box(wx1 - wx0, 10, 3, ext, (wx0 + wx1) / 2, fy0 + 5, face));
    if (part.argb) {
      const strip = this.box(shroudX1 - wx1 - 30, 2.2, 2, this.mat("glow", LIME, 2), (wx1 + shroudX1) / 2, sy - 4, face + 2.6);
      strip.userData.noCast = true;
      g.add(strip);
    }

    // Ножки
    const foot = this.mat("plastic", 0x0c0d10, 0.7);
    for (const fx of [-1, 1])
      for (const fz of [-1, 1]) {
        const f = this.mesh(new THREE.CylinderGeometry(15, 17, 12, 32), foot, fx * (d / 2 - 45), -h / 2 - 6, fz * (w / 2 - 32));
        g.add(f);
      }

    // Боковое стекло — последним, чтобы корректно смешивалось поверх внутренностей
    const glass = noCast(this.mesh(new THREE.PlaneGeometry(d - 8, h - 8), this.glassMaterial(d, h, 12, g), 0, 0, w / 2 - 1));
    glass.renderOrder = 10;
    glass.userData.noReceive = true;
    g.add(glass);

    // Вентиляторы: 3 на вдув спереди, 1 на выдув сзади
    const fanOpts = { argb: part.argb, frameColor: white ? 0xb4b8bf : 0x16181c, speed: 1.6 };
    for (let i = 0; i < 3; i++) {
      const f = this.fan(120, fanOpts);
      f.rotation.y = -Math.PI / 2;
      f.position.set(d / 2 - 28, -h / 2 + 76 + i * 124, 4);
      g.add(f);
    }
    const rear = this.fan(120, fanOpts);
    rear.rotation.y = Math.PI / 2;
    rear.position.set(-d / 2 + 24, h / 2 - 82, this.L.oz + 44 + 62);
    g.add(rear);

    // Внутренняя подсветка: нейтральная «лента» под крышкой есть всегда, у ARGB-корпусов добавляется холодный отсвет вентиляторов
    const inside = new THREE.PointLight(0xe6eeff, 1.6, 0, 2);
    inside.position.set(0, h / 2 - 40, w / 2 - 50);
    g.add(inside);
    if (part.argb) {
      const light = new THREE.PointLight(0x7fdcff, 1.2, 0, 2);
      light.position.set(d / 2 - 60, 20, 0);
      g.add(light);
    }
    return { group: g, from: new THREE.Vector3(0, 0, 0), fadeOnly: true };
  }

  buildBoard(part) {
    const { THREE } = this;
    const L = this.L;
    const H = BOARD_H[part.form] || 244;
    const armor = part.armor || "basic";
    const g = new THREE.Group();
    g.position.set(L.ox, L.oy, L.oz);
    const P = (u, v, z = 0) => [u, -v, z];

    const pcbMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: this.tex.pcb, metalness: 0.25, roughness: 0.62 });
    g.add(this.box(BOARD_W, H, 2, pcbMat, ...P(BOARD_W / 2, H / 2, -1)));
    // крепёжные отверстия
    const ringMat = this.mat("metal", 0x8a9099, 0.4);
    for (const [u, v] of [[8, 8], [8, H / 2], [8, H - 8], [160, 8], [160, H - 8], [BOARD_W - 8, 8], [BOARD_W - 8, H / 2], [BOARD_W - 8, H - 8]]) {
      const r = this.mesh(new THREE.TorusGeometry(3, 0.8, 8, 24), ringMat, ...P(u, v, 0.3));
      g.add(r);
    }

    const hsColor = armor === "flagship" ? 0x4a4f58 : armor === "gaming" ? 0x5b616b : 0x6d737d;
    const hs = this.mat("metal", hsColor, armor === "basic" ? 0.42 : 0.3);
    const cover = this.mat("anod", armor === "flagship" ? 0x25282e : 0x2e3238, 0.3);
    const plastic = this.mat("plastic", 0x17181c, 0.55);

    // Дроссели питания над сокетом (частично видны из-под радиатора VRM)
    const choke = this.mat("anod", 0x26282d, 0.45);
    for (let i = 0; i < 9; i++) g.add(this.rbox(8, 8, 6, 1, choke, ...P(46 + i * 11, 38, 3)));

    // Радиаторы VRM и крышка разъёмов
    if (armor === "basic") {
      g.add(this.rbox(26, 150, 26, 2, this.mat("metal", 0x3c4047, 0.4), ...P(14, 80, 13)));
      g.add(this.rbox(90, 20, 16, 2, hs, ...P(96, 16, 8)));
      g.add(this.rbox(18, 64, 16, 2, hs, ...P(42, 74, 8)));
    } else {
      g.add(this.rbox(36, 158, 34, 5, cover, ...P(18, 81, 17)));
      const top = this.rbox(106, 26, 28, 4, hs, ...P(94, 17, 14));
      g.add(top);
      g.add(this.rbox(20, 92, 28, 4, hs, ...P(46, 76, 14)));
      // проточки на радиаторе
      const groove = this.mat("metal", 0x14161a, 0.5);
      for (let i = 0; i < 6; i++) g.add(this.box(1.6, 22, 1, groove, ...P(52 + i * 15, 17, 28.3)));
      if (armor === "flagship") {
        const line = this.box(2, 120, 1.2, this.mat("glow", LIME, 1.8), ...P(30, 84, 34.4));
        line.userData.noCast = true;
        g.add(line);
        g.add(this.rbox(24, 30, 3, 2, this.mat("metal", 0xb9bec7, 0.25), ...P(18, 30, 34.5)));
      }
    }

    // Сокет: рамка крепления + сам сокет (виден, пока нет процессора)
    g.add(this.rbox(78, 94, 7, 2, plastic, ...P(SOCKET.u, SOCKET.v, 3.5)));
    g.add(this.box(44, 44, 4, this.mat("metal", 0xa7adb6, 0.35), ...P(SOCKET.u, SOCKET.v, 7)));

    // Слоты памяти
    const slot = this.mat("plastic", armor === "basic" ? 0x2b2e34 : 0x1f2126, 0.5);
    const latch = this.mat("plastic", armor === "basic" ? 0x3c4048 : 0x9aa0a9, 0.45);
    DIMM_U.forEach((u) => {
      g.add(this.box(6, DIMM_LEN, 7, slot, ...P(u, DIMM_TOP + DIMM_LEN / 2, 3.5)));
      g.add(this.box(6.5, 6, 9, latch, ...P(u, DIMM_TOP - 1, 4.5)));
      g.add(this.box(6.5, 6, 9, latch, ...P(u, DIMM_TOP + DIMM_LEN + 1, 4.5)));
    });
    // 24-pin
    g.add(this.rbox(13, 54, 16, 1.5, plastic, ...P(234, 108, 8)));

    // Слоты PCIe (у игровых/топовых — в металлическом «армировании»)
    const pcieMat = armor === "basic" ? plastic : this.mat("metal", 0xb4b9c2, 0.28);
    const slotsV = [PCIE_V, PCIE_V + 60, PCIE_V + 108].filter((v) => v + 6 < H);
    slotsV.forEach((v, i) => g.add(this.rbox(i === 1 && armor !== "basic" ? 89 : i === 0 ? 89 : 40, 7, 11, 1, i === 0 ? pcieMat : plastic, ...P(48 + (i === 0 || (i === 1 && armor !== "basic") ? 44.5 : 20), v, 5.5))));

    // Радиатор чипсета
    g.add(this.rbox(64, 48, 10, 3, armor === "basic" ? hs : cover, ...P(182, H - 44, 5)));
    if (armor === "flagship") {
      const l2 = this.box(40, 1.6, 1, this.mat("glow", LIME, 1.6), ...P(182, H - 44, 10.4));
      l2.userData.noCast = true;
      g.add(l2);
      g.add(this.rbox(BOARD_W - 150, H - PCIE_V - 30, 5, 3, cover, ...P(65, (PCIE_V + 22 + H) / 2 + 2, 2.5)));
    }
    // Твердотельные конденсаторы
    for (let i = 0; i < 5; i++) {
      const c = this.mesh(new THREE.CylinderGeometry(3, 3, 8, 16), this.mat("metal", 0xb9bec5, 0.3), ...P(218, 176 + i * 9, 4));
      c.rotation.x = Math.PI / 2;
      g.add(c);
    }
    return { group: g, from: new THREE.Vector3(0, 0, 70) };
  }

  buildCpu(part) {
    const { THREE } = this;
    const g = new THREE.Group();
    g.position.set(...this.L.at(SOCKET.u, SOCKET.v, 9));
    g.add(this.box(40, 40, 1.4, this.mat("plastic", 0x1d3b2c, 0.5), 0, 0, 0.7));
    // IHS: у AM5 характерные вырезы по бокам («осьминог»), у AM4 — простой квадрат
    const s = 17.5;
    const pts =
      part.socket === "AM5"
        ? [[-s, -s], [s, -s], [s, -10], [s - 4.5, -10], [s - 4.5, -3.5], [s, -3.5], [s, 3.5], [s - 4.5, 3.5], [s - 4.5, 10], [s, 10], [s, s], [-s, s], [-s, 10], [-s + 4.5, 10], [-s + 4.5, 3.5], [-s, 3.5], [-s, -3.5], [-s + 4.5, -3.5], [-s + 4.5, -10], [-s, -10]]
        : [[-s, -s], [s, -s], [s, s], [-s, s]];
    const ihs = this.mesh(this.extrude(pts, 3.2, 0.5), this.mat("metal", 0xd6d9df, 0.2), 0, 0, 1.4);
    g.add(ihs);
    const tri = this.mesh(new THREE.CircleGeometry(2.2, 3), this.mat("metal", 0xd4a94a, 0.3), -17.6, -17.6, 1.45);
    tri.rotation.z = Math.PI / 4;
    g.add(tri);
    return { group: g, from: new THREE.Vector3(0, 0, 40) };
  }

  buildRam(part) {
    const { THREE } = this;
    const g = new THREE.Group();
    const ddr5 = part.ram === "DDR5";
    const Hs = part.rgb ? 41 : ddr5 ? 37 : 33;
    const color = part.rgb ? 0x24272d : ddr5 ? 0x4a4f57 : 0x121316;
    // Профиль радиатора памяти (длина × высота), выдавленный по толщине модуля
    const prof = part.rgb
      ? [[0, 0], [DIMM_LEN, 0], [DIMM_LEN, Hs - 6], [DIMM_LEN - 6, Hs], [6, Hs], [0, Hs - 6]]
      : [[0, 0], [DIMM_LEN, 0], [DIMM_LEN, Hs - 5], [DIMM_LEN - 18, Hs], [70, Hs], [64, Hs - 4], [4, Hs - 4], [0, Hs - 8]];
    // перестановка осей: профиль X→Y (вдоль слота), Y→Z (от платы), толщина Z→X — определитель +1
    const M = new THREE.Matrix4().set(0, 0, 1, -3.8, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1);
    const geo = this.extrude(prof, 7.6, 0.7).applyMatrix4(M);
    const spreader = this.mat("anod", color, part.rgb ? 0.3 : 0.4);
    const accent = this.mat("metal", 0xc4c9d1, 0.22);
    [DIMM_U[1], DIMM_U[3]].forEach((u) => {
      const s = new THREE.Group();
      s.position.set(...this.L.at(u, DIMM_TOP + DIMM_LEN, 7));
      s.add(this.mesh(geo, spreader));
      s.add(this.box(9.4, DIMM_LEN * 0.55, 1.2, accent, 0, DIMM_LEN * 0.4, Hs * 0.55));
      if (part.rgb) {
        // рассеиватель подсветки сверху: градиент лайм → бирюза по длине
        const bar = new THREE.BoxGeometry(6, DIMM_LEN - 10, 6, 1, 24, 1);
        const col = [];
        const p = bar.attributes.position;
        const a = new THREE.Color(LIME);
        const b = new THREE.Color(CYAN);
        for (let i = 0; i < p.count; i++) {
          const t = (p.getY(i) + (DIMM_LEN - 10) / 2) / (DIMM_LEN - 10);
          const c = a.clone().lerp(b, t).multiplyScalar(1.8);
          col.push(c.r, c.g, c.b);
        }
        bar.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
        const m = this.mesh(bar, new THREE.MeshBasicMaterial({ vertexColors: true }), 0, DIMM_LEN / 2, Hs + 3);
        m.userData.noCast = true;
        s.add(m);
      }
      g.add(s);
    });
    return { group: g, from: new THREE.Vector3(0, 0, 60) };
  }

  buildGpu(part) {
    const { THREE } = this;
    const large = part.lengthClass === "large";
    const tdp = part.tdp || 150;
    const len = large ? 332 : tdp >= 200 ? 270 : 244;
    const T = large ? 66 : tdp >= 200 ? 52 : 42; // толщина (2–3.5 слота)
    const Hc = large ? 136 : 118; // высота карты от слота к стеклу
    const n = part.fans || (large ? 3 : 2);
    const g = new THREE.Group();
    const [bx, by, bz] = this.L.at(-12, PCIE_V, 0);
    g.position.set(bx, by, bz);

    // Бэкплейт сверху
    g.add(this.rbox(len, 3, Hc, 1.2, this.mat("metal", 0x1c1f24, 0.34), len / 2, 3.5, 8 + Hc / 2));
    if (large) g.add(this.box(len * 0.2, 0.8, Hc * 0.7, new THREE.MeshStandardMaterial({ map: this.tex.fins, metalness: 0.6, roughness: 0.5 }), len - len * 0.13, 5.4, 8 + Hc / 2));
    g.add(this.box(len - 12, 1.6, Hc - 6, this.mat("plastic", 0x0e1012, 0.6), len / 2, 1, 8 + Hc / 2));

    // Кожух: гранёный профиль, выдавленный на всю высоту карты
    const prof = [[0, 0], [len, 0], [len, -T + 12], [len - 12, -T], [len * 0.64, -T], [len * 0.6, -T + 4], [len * 0.4, -T + 4], [len * 0.36, -T], [12, -T], [0, -T + 12]];
    const shroud = this.mesh(this.extrude(prof, Hc - 3, 1.4), this.mat("anod", large ? 0x191b20 : 0x24272d, 0.34), 0, -0.5, 9.5);
    g.add(shroud);
    const face = 8 + Hc + 1.5;
    // Видимые рёбра радиатора и акценты на торце, обращённом к стеклу
    const finTex = this.tex.fins.clone();
    finTex.repeat.set((len * 0.4) / 6, 1);
    finTex.needsUpdate = true;
    (g.userData.textures ||= []).push(finTex);
    g.add(this.box(len * 0.4, T * 0.62, 0.8, new THREE.MeshStandardMaterial({ map: finTex, metalness: 0.55, roughness: 0.45 }), len * 0.77, -T * 0.47, face));
    // Накладная панель торца: гранёная пластина из более светлого металла + тонкий хромированный кант
    const plate = [[0, 0], [len * 0.58, 0], [len * 0.54, -T * 0.72], [0, -T * 0.72]];
    const pl = this.mesh(this.extrude(plate, 1.2, 0.4), this.mat("metal", large ? 0x3a3e45 : 0x44484f, 0.3), 6, -T * 0.12, face - 0.4);
    g.add(pl);
    g.add(this.box(len * 0.5, 2.2, 1, this.mat("metal", 0xd2d6dc, 0.16), len * 0.3, -T * 0.12 - 3, face + 1.6));
    const logo = this.box(large ? len * 0.3 : len * 0.2, 2.6, 1, this.mat("glow", large ? LIME : 0xe8f4ff, large ? 2.4 : 1.8), len * 0.3, -T * 0.12 - 8, face + 1.6);
    logo.userData.noCast = true;
    g.add(logo);
    // Разъём питания
    g.add(this.rbox(large ? 20 : 18, 8, 10, 1, this.mat("plastic", 0x0c0d0f, 0.6), len * 0.68, 7, face - 5));
    // Планка крепления
    g.add(this.box(1.6, T + 10, Hc + 14, this.mat("metal", 0x6f757e, 0.62), -1, -T / 2 + 4, 8 + Hc / 2));

    // Вентиляторы снизу (смотрят вниз)
    const r = large ? 47 : 44;
    const spacing = (len - 24) / n;
    for (let i = 0; i < n; i++) {
      const f = this.fan(r * 2, { frame: false, blades: 11, speed: 3 });
      f.rotation.x = Math.PI / 2;
      f.position.set(12 + spacing * (i + 0.5), -T - 1, 8 + Hc / 2);
      g.add(f);
    }
    return { group: g, from: new THREE.Vector3(0, 0, 90) };
  }

  buildStorage(part) {
    const { THREE } = this;
    const g = new THREE.Group();
    g.position.set(...this.L.at(M2.u, M2.v, 5));
    g.add(this.box(80, 22, 0.9, this.mat("plastic", 0x0f1114, 0.5), 40, 0, 0.45));
    g.add(this.box(4, 20, 1, this.mat("metal", 0xc9a24c, 0.3), 2, 0, 0.5));
    const cap = part.capacity >= 1000 ? `${part.capacity / 1000} TB` : `${part.capacity} GB`;
    const map = this.labelTexture(512, 160, (c, w, h) => {
      c.fillStyle = "#1b1e24";
      c.fillRect(0, 0, w, h);
      c.fillStyle = "#b9ff01";
      c.fillRect(0, 0, 10, h);
      c.fillStyle = "#f2f4f7";
      c.font = "700 64px Inter, system-ui, sans-serif";
      c.textBaseline = "middle";
      c.fillText(cap, 40, h * 0.42);
      c.fillStyle = "rgba(242,244,247,.55)";
      c.font = "500 26px Inter, system-ui, sans-serif";
      c.fillText("NVMe · PCIe · M.2 2280", 42, h * 0.78);
    }, g);
    g.add(this.box(64, 20, 0.3, new THREE.MeshStandardMaterial({ map, metalness: 0.2, roughness: 0.45 }), 44, 0, 1.1));
    const screw = this.mesh(new THREE.CylinderGeometry(2.4, 2.4, 2, 16), this.mat("metal", 0xc4c9cf, 0.3), 80, 0, 1.4);
    screw.rotation.x = Math.PI / 2;
    g.add(screw);
    return { group: g, from: new THREE.Vector3(0, 0, 40) };
  }

  buildPsu(part) {
    const { THREE } = this;
    const { d, h, w } = this.L.C;
    const len = part.watt <= 550 ? 140 : part.watt <= 850 ? 160 : 180;
    const g = new THREE.Group();
    g.position.set(-d / 2 + 12, -h / 2 + 10, -w / 2 + 12);
    const body = this.mat("anod", 0x15171b, 0.5);
    g.add(this.rbox(len, 86, 150, 3, body, len / 2, 43, 75));
    const rating = /Gold/i.test(part.name) ? "GOLD" : /Bronze/i.test(part.name) ? "BRONZE" : "";
    const accent = rating === "GOLD" ? "#d9b45a" : rating === "BRONZE" ? "#c48a5c" : "#9aa3ad";
    const map = this.labelTexture(512, 256, (c, W, H) => {
      c.fillStyle = "#101216";
      c.fillRect(0, 0, W, H);
      c.fillStyle = accent;
      c.fillRect(0, H - 12, W, 12);
      c.fillStyle = "#f3f5f8";
      c.font = "700 104px Inter, system-ui, sans-serif";
      c.textBaseline = "alphabetic";
      c.fillText(`${part.watt}`, 36, 140);
      const tw = c.measureText(`${part.watt}`).width;
      c.font = "600 52px Inter, system-ui, sans-serif";
      c.fillStyle = "rgba(243,245,248,.7)";
      c.fillText("W", 50 + tw, 140);
      c.font = "600 30px Inter, system-ui, sans-serif";
      c.fillStyle = accent;
      c.fillText(rating ? `80 PLUS ${rating}` : "80 PLUS", 38, 200);
    }, g);
    g.add(this.box(len - 20, 56, 0.6, new THREE.MeshStandardMaterial({ map, metalness: 0.35, roughness: 0.4 }), len / 2, 43, 150.4));
    // Модульная панель спереди
    g.add(this.box(1, 62, 120, this.mat("plastic", 0x0b0c0e, 0.6), len + 0.5, 43, 75));
    for (let i = 0; i < 4; i++) g.add(this.box(4, 14, 22, this.mat("plastic", 0x050506, 0.7), len + 2, 60 - (i % 2) * 24, 40 + Math.floor(i / 2) * 60));
    return { group: g, from: new THREE.Vector3(-90, 0, 0) };
  }

  buildCooler(part) {
    return part.type === "aio" ? this.buildAio(part) : this.buildTower(part);
  }

  buildTower(part) {
    const { THREE } = this;
    const g = new THREE.Group();
    g.position.set(...this.L.at(SOCKET.u, SOCKET.v, 0));
    const towers = part.towers || 1;
    const small = part.tdpMax <= 150;
    const pipes = part.heatpipes || (small ? 3 : 4);
    const finD = towers > 1 ? 40 : small ? 42 : 50; // толщина пакета рёбер по ходу воздуха
    const finH = small ? 110 : 122; // ширина рёбер (под 120-мм вентилятор)
    const z0 = towers > 1 ? 52 : 44;
    const z1 = small ? 132 : towers > 1 ? 160 : 152;
    const black = part.finish === "black";
    const nickel = this.mat("metal", small ? 0xc07a4c : 0xd0d4da, 0.24);

    // Основание: медная/никелированная подошва, блок, прижимная планка
    g.add(this.box(38, 38, 4, this.mat("metal", 0xd8dbe0, 0.18), 0, 0, 16));
    g.add(this.rbox(46, 42, 14, 2, this.mat("metal", black ? 0x1d1f23 : 0x8f959e, 0.3), 0, 0, 25));
    g.add(this.rbox(94, 10, 4, 1.5, this.mat("anod", 0x0f1012, 0.4), 0, 0, 33));

    // Пакеты рёбер: инстансами — десятки тонких пластин одной отрисовкой
    const stacks = towers > 1 ? [-33, 33] : [0];
    const finGeo = (() => {
      const pts = [[-finD / 2, -finH / 2], [finD / 2, -finH / 2]];
      const teeth = 10;
      for (let i = 1; i <= teeth; i++) pts.push([finD / 2 - (i % 2 ? 3 : 0), -finH / 2 + (finH * i) / teeth]);
      pts.push([-finD / 2, finH / 2]);
      return this.extrude(pts, 0.45, 0);
    })();
    const finMat = black ? this.mat("metal", 0x3b3f46, 0.3) : this.mat("metal", 0xd2d6dc, 0.24);
    const pitch = 2.3;
    const count = Math.floor((z1 - z0) / pitch);
    stacks.forEach((sx) => {
      const inst = new THREE.InstancedMesh(finGeo, finMat, count);
      const m = new THREE.Matrix4();
      for (let i = 0; i < count; i++) inst.setMatrixAt(i, m.makeTranslation(sx, 0, z0 + i * pitch));
      g.add(inst);
      // крышка сверху
      g.add(this.rbox(finD + 6, finH + 6, 6, 2.5, this.mat("anod", black ? 0x121316 : 0x1b1d21, 0.3), sx, 0, z1 + 3));
      if (part.argb) {
        const ring = new THREE.Group();
        const gm = this.mat("glow", CYAN, 2.6);
        const iw = finD - 4;
        const ih = finH - 4;
        ring.add(this.box(iw, 1.4, 1, gm, 0, ih / 2, 0), this.box(iw, 1.4, 1, gm, 0, -ih / 2, 0), this.box(1.4, ih, 1, gm, iw / 2, 0, 0), this.box(1.4, ih, 1, gm, -iw / 2, 0, 0));
        ring.position.set(sx, 0, z1 + 6.4);
        ring.traverse((o) => (o.userData.noCast = true));
        g.add(ring);
        g.add(this.rbox(finD - 16, finH * 0.42, 1.2, 1, this.mat("metal", 0x9aa1ab, 0.2), sx, 0, z1 + 6.3));
      } else {
        g.add(this.box(finD - 8, finH * 0.5, 0.6, this.mat("metal", 0xb9bec6, 0.22), sx, 0, z1 + 6.2));
      }
    });

    // Тепловые трубки: U-образные, проходят сквозь рёбра
    const spread = Math.min(16, (finH - 34) / Math.max(1, pipes - 1));
    for (let i = 0; i < pipes; i++) {
      const y = (i - (pipes - 1) / 2) * spread;
      const xa = towers > 1 ? stacks[0] + (i % 2 ? 7 : -7) : -finD / 2 + 12 + (i % 2) * 5;
      const xb = towers > 1 ? stacks[1] - (i % 2 ? 7 : -7) : finD / 2 - 12 - (i % 2) * 5;
      const curve = new THREE.CatmullRomCurve3(
        [[xa, z1 + 2], [xa, z0], [xa * 0.85, 30], [xa * 0.4, 20], [xb * 0.4, 20], [xb * 0.85, 30], [xb, z0], [xb, z1 + 2]].map(([x, z]) => new THREE.Vector3(x, y, z)),
        false,
        "centripetal",
      );
      g.add(this.mesh(new THREE.TubeGeometry(curve, 64, 3, 12, false), nickel));
    }

    // Вентиляторы: у двухбашенного — между башнями и спереди
    const fanZ = (z0 + z1) / 2;
    const fanOpts = { argb: part.argb, frameColor: black ? 0x131417 : 0x1a1c20, speed: 2.2 };
    const fanXs = towers > 1 ? [0, stacks[1] + finD / 2 + 13] : [finD / 2 + 13];
    fanXs.forEach((fx) => {
      const f = this.fan(small ? 110 : 120, fanOpts);
      f.rotation.y = Math.PI / 2;
      f.position.set(fx, 0, fanZ);
      g.add(f);
    });
    return { group: g, from: new THREE.Vector3(0, 0, 80) };
  }

  buildAio(part) {
    const { THREE } = this;
    const L = this.L;
    const { d, h, w } = L.C;
    const g = new THREE.Group();

    // Помпа на процессоре: скруглённый блок, стеклянная крышка и «бесконечное зеркало» из колец подсветки
    const [px, py, pz] = L.at(SOCKET.u, SOCKET.v, 12);
    const pump = new THREE.Group();
    pump.position.set(px, py, pz);
    pump.add(this.rbox(62, 62, 36, 14, this.mat("anod", 0x17191d, 0.3), 0, 0, 18));
    const ring = this.mesh(new THREE.TorusGeometry(27, 1.8, 16, 72), this.mat("metal", 0xc9cdd4, 0.2), 0, 0, 36);
    pump.add(ring);
    const glassTop = this.mesh(new THREE.CylinderGeometry(26, 26, 1.2, 64), new THREE.MeshPhysicalMaterial({ color: 0x050608, metalness: 0.2, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.03 }), 0, 0, 36.4);
    glassTop.rotation.x = Math.PI / 2;
    pump.add(glassTop);
    [[22, 2.6], [17, 1.4], [12, 0.7]].forEach(([r, k]) => {
      const t = this.mesh(new THREE.TorusGeometry(r, 0.9, 8, 72), this.mat("glow", LIME, k), 0, 0, 36.8);
      t.userData.noCast = true;
      pump.add(t);
    });
    g.add(pump);

    // Радиатор сверху корпуса + вентиляторы под ним
    const len = Math.min(part.radiatorMm >= 360 ? 397 : 277, d - 24);
    const cx = Math.max(d / 2 - 14 - len / 2, -d / 2 + 12 + len / 2);
    const ry = h / 2 - 10 - 14;
    const rz = Math.min(L.oz + 133, w / 2 - 64);
    const core = this.mat("anod", 0x15171b, 0.45);
    const finsMat = new THREE.MeshStandardMaterial({ map: this.tex.fins.clone(), metalness: 0.5, roughness: 0.5 });
    finsMat.map.repeat.set((len - 40) / 5, 1);
    finsMat.map.needsUpdate = true;
    (g.userData.textures ||= []).push(finsMat.map);
    g.add(this.box(len - 40, 26, 118, core, cx, ry, rz));
    g.add(this.box(len - 40, 20, 0.6, finsMat, cx, ry, rz + 59.3));
    const tank = this.mat("anod", 0x1c1e23, 0.32);
    g.add(this.rbox(20, 30, 124, 3, tank, cx - len / 2 + 10, ry, rz));
    g.add(this.rbox(20, 30, 124, 3, tank, cx + len / 2 - 10, ry, rz));
    const n = part.radiatorMm >= 360 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const f = this.fan(120, { argb: true, speed: 1.9 });
      f.rotation.x = Math.PI / 2;
      f.position.set(cx + (i - (n - 1) / 2) * 122, ry - 13 - 12.5, rz);
      g.add(f);
    }

    // Гибкие трубки в оплётке от помпы к бачку радиатора
    const braid = this.tex.braid.clone();
    braid.repeat.set(30, 1);
    braid.needsUpdate = true;
    (g.userData.textures ||= []).push(braid);
    const tubeMat = new THREE.MeshStandardMaterial({ color: 0x131417, roughness: 0.7, metalness: 0.2, bumpMap: braid, bumpScale: 0.6 });
    const fitMat = this.mat("metal", 0x1c1e22, 0.3);
    [-1, 1].forEach((side) => {
      const s = new THREE.Vector3(px + 30, py + side * 12, pz + 26);
      const e = new THREE.Vector3(cx + len / 2 - 10, ry - 22, rz + side * 24);
      const pts = [s, s.clone().add(new THREE.Vector3(34, 6, 12)), new THREE.Vector3((s.x + e.x) / 2 + 30, (s.y + e.y) / 2 - 20, (s.z + e.z) / 2 + 10), e.clone().add(new THREE.Vector3(0, -40, 0)), e];
      const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
      g.add(this.mesh(new THREE.TubeGeometry(curve, 80, 5.5, 14, false), tubeMat));
      const fit = this.mesh(new THREE.CylinderGeometry(7, 7, 12, 24), fitMat, e.x, e.y + 5, e.z);
      g.add(fit);
      const fit2 = this.mesh(new THREE.CylinderGeometry(7, 7, 10, 24), fitMat, s.x - 3, s.y, s.z);
      fit2.rotation.z = Math.PI / 2;
      g.add(fit2);
    });
    return { group: g, from: new THREE.Vector3(0, 0, 60) };
  }

  build(key, part) {
    switch (key) {
      case "case":
        return this.buildCase(part);
      case "motherboard":
        return this.buildBoard(part);
      case "cpu":
        return this.buildCpu(part);
      case "ram":
        return this.buildRam(part);
      case "gpu":
        return this.buildGpu(part);
      case "storage":
        return this.buildStorage(part);
      case "psu":
        return this.buildPsu(part);
      case "cooler":
        return this.buildCooler(part);
    }
    return null;
  }

  // ———————————————————————————— жизненный цикл деталей ————————————————————————————

  finalize(built) {
    const spinners = [];
    built.group.traverse((o) => {
      if (o.userData.spinner) spinners.push(o.userData.spinner);
      if (!o.isMesh) return;
      const basic = o.material?.isMeshBasicMaterial;
      if (o.material?.isMeshStandardMaterial && o.material.envMapIntensity === 1) o.material.envMapIntensity = 1.5;
      o.castShadow = !basic && !o.userData.noCast;
      o.receiveShadow = !basic && !o.userData.noReceive;
    });
    built.spinners = spinners;
    return built;
  }

  materialsOf(obj) {
    const out = [];
    obj.traverse((o) => {
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => out.push(m));
    });
    return out;
  }

  /** Плавное проявление/скрытие: материалы детали уникальны (создаются при сборке), так что их можно менять. */
  fadePrep(obj) {
    for (const m of this.materialsOf(obj)) {
      if (m.userData.baseOpacity == null) {
        m.userData.baseOpacity = m.opacity;
        m.userData.baseTransparent = m.transparent;
      }
      if (!m.transparent) {
        m.transparent = true;
        m.needsUpdate = true;
      }
    }
  }

  fadeSet(obj, a) {
    for (const m of this.materialsOf(obj)) m.opacity = m.userData.baseOpacity * a;
  }

  fadeEnd(obj) {
    for (const m of this.materialsOf(obj)) {
      m.opacity = m.userData.baseOpacity;
      if (m.transparent !== m.userData.baseTransparent) {
        m.transparent = m.userData.baseTransparent;
        m.needsUpdate = true;
      }
    }
  }

  disposeMesh(obj) {
    obj.traverse((o) => {
      if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose?.());
      (o.userData.textures || []).forEach((t) => t.dispose());
    });
  }

  remove(key, animate) {
    const old = this.meshes[key];
    if (!old) return;
    delete this.meshes[key];
    this.spinners = this.spinners.filter((s) => !old.spinners.includes(s));
    const finish = () => {
      this.model.remove(old.group);
      this.disposeMesh(old.group);
      this.shadowsDirty = true;
    };
    if (!animate) return finish();
    const base = old.group.position.clone();
    this.fadePrep(old.group);
    this.tween(300, (p) => {
      if (!old.fadeOnly) old.group.position.copy(base).addScaledVector(old.from, easeIn(p) * 0.6);
      this.fadeSet(old.group, 1 - p);
    }, finish);
  }

  swap(key, animate) {
    this.remove(key, animate);
    const part = this.parts[key];
    if (!part && key !== "case") return;
    const built = this.build(key, part);
    if (!built) return;
    this.finalize(built);
    built.partId = part?.id || null;
    this.meshes[key] = built;
    this.model.add(built.group);
    this.spinners.push(...built.spinners);
    this.shadowsDirty = true;
    if (key === "case") this.floor.shadow.visible = !!part;
    if (!animate) return;
    const base = built.group.position.clone();
    this.fadePrep(built.group);
    this.fadeSet(built.group, 0);
    if (!built.fadeOnly) built.group.position.copy(base).add(built.from);
    this.tween(built.fadeOnly ? 600 : 750, (p) => {
      if (!built.fadeOnly) built.group.position.copy(base).addScaledVector(built.from, 1 - easeOut(p));
      this.fadeSet(built.group, Math.min(1, p * 1.8));
    }, () => this.fadeEnd(built.group));
  }

  /** @param part — объект детали из CATALOG (см. data.js) или null, если деталь не выбрана. */
  set(key, part) {
    if (!STEPS.some((s) => s.key === key)) return;
    const next = part || null;
    if ((this.parts[key]?.id || null) === (next?.id || null)) return;
    this.parts[key] = next;
    const animate = !reduced();
    if (this.updateLayout()) {
      // Сменился форм-фактор — всё пересобирается под новые габариты; анимируется только то, что выбрали сейчас.
      // незаконченные анимации доводим до конца (иначе уезжающая деталь так и осталась бы в сцене)
      const pending = this.animQueue;
      this.animQueue = [];
      pending.forEach((a) => a.step(1e6));
      for (const k of Object.keys(this.meshes)) this.remove(k, false);
      this.placeFloor();
      this.swap("case", animate && key === "case");
      for (const s of STEPS) if (s.key !== "case" && this.parts[s.key]) this.swap(s.key, animate && s.key === key);
      return;
    }
    this.swap(key, animate);
  }

  // ———————————————————————————— камера, ввод, кадр ————————————————————————————

  onResize() {
    const w = this.root.clientWidth;
    const h = this.root.clientHeight;
    if (!w || !h) return;
    const pr = Math.min(devicePixelRatio || 1, matchMedia("(pointer:coarse)").matches ? 1.5 : 2); // на телефонах экономим заполнение (bloom + MSAA)
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    const cam = this.camera;
    cam.aspect = w / h;
    // Вписываем самый крупный (ATX) корпус с запасом на покачивание — mATX при этом честно выглядит меньше.
    const t = Math.tan((cam.fov * Math.PI) / 360);
    const halfH = 276 * U;
    const halfW = 300 * U;
    const dist = Math.max(halfH / t, halfW / (t * cam.aspect)) + 170 * U;
    cam.position.set(0, dist * 0.2, dist);
    cam.lookAt(0, -26 * U, 0);
    cam.updateProjectionMatrix();
    this.wake();
  }

  applyAngle() {
    this.rig.rotation.y = this.yaw;
  }

  bindDrag() {
    let sx = 0;
    let start = 0;
    const onMove = (e) => {
      this.yaw = Math.max(-1.5, Math.min(0.6, start + (e.clientX - sx) * 0.008));
      this.applyAngle();
      this.wake();
    };
    const onUp = () => {
      this.dragging = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    this.root.addEventListener("pointerdown", (e) => {
      this.dragging = true;
      sx = e.clientX;
      start = this.yaw;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  }

  wake() {
    if (this.clock && !this.raf && this.visible && !document.hidden) {
      this.clock.getDelta();
      this.raf = requestAnimationFrame(this.tick.bind(this));
    }
  }

  tick() {
    this.raf = null;
    if (!this.visible || document.hidden) return;
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const still = reduced();
    if (!still && !this.dragging) {
      // Медленное «витринное» покачивание вокруг ракурса 3/4 (стекло + фронт), без полного оборота
      this.time += dt;
      const target = this.baseYaw + Math.sin(this.time * 0.32) * 0.34;
      this.yaw += (target - this.yaw) * Math.min(1, dt * 1.2);
      this.applyAngle();
    }
    if (!still) for (const s of this.spinners) s.obj.rotation.z += dt * s.speed;
    if (this.animQueue.length) {
      this.animQueue = this.animQueue.filter((a) => a.step(dt));
      this.shadowsDirty = true;
    }
    if (this.shadowsDirty) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowsDirty = false;
    }
    this.composer.render(dt);
    this.raf = requestAnimationFrame(this.tick.bind(this));
  }

  /** duration — в миллисекундах; dt из тика приходит в секундах (THREE.Clock). */
  tween(duration, onUpdate, onDone) {
    let t = 0;
    onUpdate(0);
    this.animQueue.push({
      step: (dt) => {
        t += (dt * 1000) / duration;
        const p = Math.min(1, t);
        onUpdate(p);
        if (p >= 1) {
          onDone?.();
          return false;
        }
        return true;
      },
    });
    this.wake();
  }
}
