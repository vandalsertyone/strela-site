// «3D»-сцена сборки: слои на CSS 3D (perspective + translateZ), без WebGL и тяжёлых библиотек.
// Каждая категория — свой слой на своей глубине; выбранная деталь подсвечивается.
import { STEPS } from "./data.js";

const reduced = matchMedia("(prefers-reduced-motion: reduce)");

// Смещение и глубина слоя для каждой категории — собирает «взорванную» схему корпуса.
const LAYOUT = {
  case: { x: 0, y: 20, z: -170, scale: 3 },
  psu: { x: -78, y: 66, z: -130 },
  motherboard: { x: 0, y: 10, z: -100, scale: 1.9 },
  cooler: { x: -46, y: -48, z: -45 },
  cpu: { x: 34, y: -18, z: -15 },
  ram: { x: 78, y: -50, z: 15 },
  storage: { x: -78, y: -66, z: 45 },
  hdd: { x: 78, y: 70, z: 45 },
  gpu: { x: 0, y: 56, z: 75, scale: 1.4 },
};

export class SceneCss {
  constructor(root) {
    this.stage = root.querySelector("#sceneStage");
    this.layers = {};
    STEPS.forEach((s) => {
      const L = LAYOUT[s.key];
      const el = document.createElement("div");
      el.className = "scene__layer";
      el.style.transform = `translate3d(calc(-50% + ${L.x}px), calc(-50% + ${L.y}px), ${L.z}px) scale(${L.scale || 1})`;
      // Названия не дублируем в сцене — они и так видны в списке шагов ниже; здесь только иконки, чтобы не накладывались друг на друга.
      el.innerHTML = `<span class="scene__icon"><svg class="ico" aria-hidden="true"><use href="#i-${s.icon}"/></svg></span>`;
      el.title = s.title;
      this.stage.appendChild(el);
      this.layers[s.key] = el;
    });
    this.angle = { x: 8, y: -18 };
    this.apply();
    if (!reduced.matches) this.idle();
    this.drag(root);
    root.dataset.sceneReady = "css";
  }

  set(key, filled) {
    this.layers[key]?.classList.toggle("is-filled", !!filled);
  }

  apply() {
    this.stage.style.transform = `rotateX(${this.angle.x}deg) rotateY(${this.angle.y}deg)`;
  }

  idle() {
    let t = 0;
    const tick = () => {
      if (!this.dragging) {
        t += 0.0032;
        this.angle.y = -18 + Math.sin(t) * 10;
        this.apply();
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  drag(root) {
    let sx = 0;
    let start = { ...this.angle };
    const onMove = (e) => {
      const x = e.touches ? e.touches[0].clientX : e.clientX;
      this.angle.y = start.y + (x - sx) * 0.4;
      this.apply();
    };
    const onUp = () => {
      this.dragging = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    root.addEventListener("pointerdown", (e) => {
      this.dragging = true;
      sx = e.clientX;
      start = { ...this.angle };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  }
}
