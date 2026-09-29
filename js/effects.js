// Эффекты страницы: появление по скроллу, счётчики, наклон карточек, параллакс,
// закреплённая кнопка и подстройка под экранную клавиатуру.
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const finePointer = matchMedia("(hover: hover) and (pointer: fine)");
const phoneLayout = matchMedia("(max-width: 767px), (max-height: 520px) and (orientation: landscape)");

export function initEffects({ stage, chat, input, log, fab }) {
  reveal();
  counters();
  if (finePointer.matches && !reduced.matches) {
    tilt();
    parallax();
  }
  stickyButton(chat, fab);
  keyboardViewport(stage, input, log);
}

// Появление блоков: fade + сдвиг, задержка задаётся --d в разметке
function reveal() {
  const items = document.querySelectorAll(".reveal");
  if (!("IntersectionObserver" in window) || reduced.matches) {
    items.forEach((n) => n.classList.add("in"));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      });
    },
    { threshold: 0.15, rootMargin: "0px 0px -6% 0px" },
  );
  items.forEach((n) => io.observe(n));
}

// Цифры досчитываются до значения при появлении на экране
function counters() {
  const nodes = document.querySelectorAll(".stat__n");
  if (reduced.matches || !("IntersectionObserver" in window)) return;
  const run = (n) => {
    const to = Number(n.dataset.count);
    const suffix = n.dataset.suffix || "";
    const t0 = performance.now();
    const dur = 1500;
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      n.textContent = Math.round(to * eased) + suffix;
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          run(e.target);
          io.unobserve(e.target);
        }
      });
    },
    { threshold: 0.6 },
  );
  nodes.forEach((n) => {
    n.textContent = "0" + (n.dataset.suffix || "");
    io.observe(n);
  });
}

// 3D-наклон карточек за курсором и свечение (только мышь)
function tilt() {
  document.querySelectorAll(".cats .card").forEach((card) => {
    let raf = 0;
    card.addEventListener("pointermove", (e) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        const y = (e.clientY - r.top) / r.height;
        card.style.setProperty("--ry", ((x - 0.5) * 12).toFixed(2) + "deg");
        card.style.setProperty("--rx", ((0.5 - y) * 9).toFixed(2) + "deg");
        card.style.setProperty("--mx", e.clientX - r.left + "px");
        card.style.setProperty("--my", e.clientY - r.top + "px");
      });
    });
    card.addEventListener("pointerleave", () => {
      card.style.setProperty("--rx", "0deg");
      card.style.setProperty("--ry", "0deg");
    });
  });
}

// Лёгкий параллакс силуэтов на фоне: мышь + скролл
function parallax() {
  const sils = [...document.querySelectorAll(".sil")];
  let mx = 0;
  let my = 0;
  let raf = 0;
  const apply = () => {
    raf = 0;
    const sy = window.scrollY;
    sils.forEach((s) => {
      const d = Number(s.dataset.depth) || 1;
      s.style.setProperty("--px", (mx * 26 * d).toFixed(1) + "px");
      s.style.setProperty("--py", (my * 20 * d - sy * 0.06 * d).toFixed(1) + "px");
    });
  };
  const queue = () => {
    if (!raf) raf = requestAnimationFrame(apply);
  };
  window.addEventListener("pointermove", (e) => {
    mx = e.clientX / innerWidth - 0.5;
    my = e.clientY / innerHeight - 0.5;
    queue();
  }, { passive: true });
  window.addEventListener("scroll", queue, { passive: true });
}

// Кнопка «Написать консультанту» появляется, когда чат ушёл с экрана
function stickyButton(chat, fab) {
  if (!("IntersectionObserver" in window)) return;
  new IntersectionObserver(
    ([e]) => {
      fab.hidden = e.isIntersecting;
    },
    { threshold: 0.05 },
  ).observe(chat);
}

// Экранная клавиатура на телефоне: держим поле ввода и последнее сообщение на виду
function keyboardViewport(stage, input, log) {
  const vv = window.visualViewport;
  const root = document.documentElement;
  if (!vv) return;
  let raf = 0;
  const update = () => {
    raf = 0;
    const keyboard = phoneLayout.matches && window.innerHeight - vv.height > 120;
    if (keyboard) {
      // iOS не меняет layout-viewport: сами задаём высоту и сдвиг первого экрана
      root.style.setProperty("--app-h", Math.round(vv.height) + "px");
      stage.style.transform = `translateY(${Math.round(vv.offsetTop)}px)`;
      log.scrollTop = log.scrollHeight;
    } else {
      root.style.removeProperty("--app-h");
      stage.style.transform = "";
    }
  };
  const queue = () => {
    if (!raf) raf = requestAnimationFrame(update);
  };
  vv.addEventListener("resize", queue);
  vv.addEventListener("scroll", queue);
  input.addEventListener("focus", () => setTimeout(queue, 250));
  input.addEventListener("blur", () => setTimeout(queue, 100));
}
