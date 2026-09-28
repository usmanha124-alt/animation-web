const canvas = document.getElementById("film");
const ctx = canvas.getContext("2d");
const track = document.getElementById("track");
const loader = document.getElementById("loader");
const loadbar = document.getElementById("loadbar");
const scrollCue = document.getElementById("scroll-cue");
const captions = [...document.querySelectorAll(".caption")];
const nav = document.getElementById("brandnav");

const KEEP = 120;
const AHEAD = 30;

const state = {
  blobs: [],
  bitmaps: new Map(),
  count: 0,
  pattern: "",
  current: -1,
  target: 0,
  smooth: 0,
  dir: 1,
  ready: false,
  decoding: new Set(),
};

async function loadManifest() {
  try {
    const res = await fetch("frames/frames.json");
    if (!res.ok) throw new Error("frames manifest unavailable");
    return res.json();
  } catch {
    return { count: 300, pattern: "frames/ezgif-frame-%03d.jpg" };
  }
}

function frameURL(i) {
  return state.pattern.replace("%03d", String(i + 1).padStart(3, "0"));
}

async function fetchBlob(i) {
  if (!state.blobs[i]) {
    const res = await fetch(frameURL(i));
    state.blobs[i] = await res.blob();
  }
  return state.blobs[i];
}

async function decode(i) {
  if (state.bitmaps.has(i) || state.decoding.has(i) || !state.blobs[i]) return;

  state.decoding.add(i);
  try {
    const bmp = await createImageBitmap(state.blobs[i]);
    state.bitmaps.set(i, bmp);
  } catch {
    // skip transient decode failure; retry on next window pass
  }
  state.decoding.delete(i);
}

function manageWindow(center) {
  for (let d = 0; d <= AHEAD; d++) {
    const fwd = center + d * state.dir;
    const back = center - Math.min(d, 8) * state.dir;

    if (fwd >= 0 && fwd < state.count) decode(fwd);
    if (back >= 0 && back < state.count) decode(back);
  }

  if (state.bitmaps.size > KEEP * 2) {
    for (const [idx, bmp] of state.bitmaps) {
      if (Math.abs(idx - center) > KEEP) {
        bmp.close();
        state.bitmaps.delete(idx);
      }
    }
  }
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
  state.current = -1;
}

function nearestDecoded(i) {
  if (state.bitmaps.has(i)) return i;

  for (let d = 1; d < state.count; d++) {
    if (state.bitmaps.has(i - d)) return i - d;
    if (state.bitmaps.has(i + d)) return i + d;
  }

  return -1;
}

function drawFrame(i) {
  const j = nearestDecoded(i);
  if (j < 0) return;

  const bmp = state.bitmaps.get(j);
  const cw = canvas.width;
  const ch = canvas.height;

  ctx.fillStyle = "#070707";
  ctx.fillRect(0, 0, cw, ch);

  const scale = Math.min(cw / bmp.width, ch / bmp.height) * 1.04;
  const w = bmp.width * scale;
  const h = bmp.height * scale;
  const x = (cw - w) / 2;
  const y = (ch - h) / 2;

  ctx.drawImage(bmp, x, y, w, h);
  state.current = j;
}

function progress() {
  const max = track.offsetHeight - window.innerHeight;
  return max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
}

function transformBase(el) {
  if (el.classList.contains("cap-center")) return "translate(-50%, -50%)";
  if (el.classList.contains("cap-top") || el.classList.contains("cap-bottom")) return "translateX(-50%)";
  return "translateY(-50%)";
}

function updateCaptions(p) {
  for (const el of captions) {
    const tIn = +el.dataset.in;
    const tHold = +el.dataset.hold;
    const tOut = +el.dataset.out;
    const rise = Math.max((tHold - tIn) * 0.4, 0.008);
    const fall = Math.max((tOut - tHold) * 0.6, 0.008);

    let opacity = 0;
    if (p >= tIn && p <= tOut) {
      opacity = Math.min((p - tIn) / rise, 1) * Math.min((tOut - p) / fall, 1);
      opacity = Math.min(Math.max(opacity, 0), 1);
    }

    el.style.opacity = opacity.toFixed(3);
    const drift = (p - tHold) * -42;
    el.style.transform = `${transformBase(el)} translateY(${drift.toFixed(1)}px)`;
  }

  scrollCue.style.opacity = p < 0.015 ? 1 : 0;
}

async function preload() {
  const total = state.count;
  const eager = Math.min(Math.ceil(total * 0.15), 80);

  let done = 0;
  await Promise.all(
    Array.from({ length: eager }, async (_, i) => {
      await fetchBlob(i);
      done += 1;
      loadbar.style.width = `${(done / eager) * 100}%`;
    })
  );

  await decode(0);
  state.ready = true;
  loader.classList.add("done");

  let next = eager;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < total) {
        const i = next++;
        try {
          await fetchBlob(i);
        } catch {
          // ignore background load failures; they can retry on scroll
        }
      }
    })
  );
}

let lastT = performance.now();
function tick(now) {
  const dt = Math.min((now - lastT) / 1000, 0.5) || 0.016;
  lastT = now;

  if (state.ready) {
    const p = progress();
    const prevTarget = state.target;
    state.target = p * (state.count - 1);

    if (state.target !== prevTarget) {
      state.dir = state.target >= prevTarget ? 1 : -1;
    }

    const k = 1 - Math.exp(-dt * 14);
    state.smooth += (state.target - state.smooth) * k;
    if (Math.abs(state.target - state.smooth) < 0.5) state.smooth = state.target;

    const i = Math.round(state.smooth);
    manageWindow(i);
    if (i !== state.current) drawFrame(i);
    updateCaptions(p);
  }

  requestAnimationFrame(tick);
}

function revealOnScroll() {
  const items = document.querySelectorAll("[data-reveal]");
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
        }
      });
    },
    { threshold: 0.18 }
  );

  items.forEach((el) => io.observe(el));

  const checkNow = () => {
    items.forEach((el) => {
      if (!el.classList.contains("in")) {
        const rect = el.getBoundingClientRect();
        if (rect.top < window.innerHeight * 0.92 && rect.bottom > 0) {
          el.classList.add("in");
        }
      }
    });
  };

  window.addEventListener("scroll", checkNow, { passive: true });
  checkNow();
}

function updateNav() {
  const filmEnd = (track.offsetHeight || window.innerHeight * 3) - window.innerHeight;
  nav.classList.toggle("on", window.scrollY > filmEnd * 0.95);
}

window.addEventListener("resize", () => {
  resize();
  updateNav();
});

window.addEventListener("scroll", () => {
  updateNav();
}, { passive: true });

resize();
revealOnScroll();
updateNav();

loadManifest().then((manifest) => {
  state.count = manifest.count || 300;
  state.pattern = manifest.pattern || "frames/ezgif-frame-%03d.jpg";
  state.blobs = new Array(state.count).fill(null);
  requestAnimationFrame(tick);
  return preload();
}).catch((error) => {
  console.error("Manifest failed:", error);
  loader.classList.add("done");
  const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
  g.addColorStop(0, "#151515");
  g.addColorStop(1, "#090909");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(209, 176, 111, 0.9)";
  ctx.font = "16px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Frames unavailable", canvas.width / 2, canvas.height / 2);
});
