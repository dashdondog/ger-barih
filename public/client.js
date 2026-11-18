/**
 * Гэр барих: the client. The server is authoritative; this file only sends
 * intents and draws the `view` it gets back. The ger parts are built from
 * three.js primitives so every piece lands exactly where the previous one ends.
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// ── net (template harness, kept) ─────────────────────────────────────────────

/** Each visitor without ?room= gets a fresh room, so the link they share is theirs. */
function resolveRoom() {
  const params = new URLSearchParams(location.search);
  let name = params.get("room");
  if (!name) {
    name = Math.random().toString(36).slice(2, 8);
    params.set("room", name);
    history.replaceState(null, "", `${location.pathname}?${params}`);
  }
  return name;
}
const room = resolveRoom();

function playerId() {
  const key = "hf:game:playerId";
  let id = localStorage.getItem(key);
  if (!id) {
    id = Math.random().toString(36).slice(2, 10);
    localStorage.setItem(key, id);
  }
  return id;
}
const ME = playerId();

const PING = "__ping";
const PONG = "__pong";
let socket = null;
let retry = 0;

function connect() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${proto}//${location.host}/ws/${encodeURIComponent(room)}`);
  socket.addEventListener("open", () => {
    retry = 0;
    send({ type: "join", playerId: ME });
  });
  socket.addEventListener("message", (event) => {
    if (event.data === PONG) return;
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.type === "state") onState(msg);
    else if (msg.type === "error") toast(msg.error, true);
  });
  socket.addEventListener("close", () => {
    retry = Math.min(retry + 1, 6);
    const wait = 500 * 2 ** (retry - 1);
    toast(`Холболт тасарлаа, ${Math.round(wait / 1000)} секундын дараа дахин оролдоно`, true);
    setTimeout(connect, wait);
  });
}
function send(msg) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}
setInterval(() => {
  if (socket?.readyState === WebSocket.OPEN) socket.send(PING);
}, 30_000);

// ── strings & data ──────────────────────────────────────────────────────────

const PART = {
  door: { name: "Хаалга", text: "Гэрийн хаалгыг өмнө зүг рүү харуулж хамгийн түрүүнд босгоно." },
  khana: { name: "Хана", text: "Эвхэгддэг торон ханыг хаалганаас эхлэн тойруулан дэлгэнэ." },
  toono: { name: "Тооно", text: "Гэрийн оройн цагираг. Гэрэл орж, утаа гарна." },
  bagana: { name: "Багана", text: "Тоонын жинг даадаг хос тулгуур." },
  uni: { name: "Унь", text: "Тоононоос ханын толгой руу налуулан тавьж дээврийг бүрдүүлнэ." },
  esgii: { name: "Эсгий", text: "Ханыг туурга, дээврийг дээвэр эсгийгээр бүрж дулаална." },
  gadar: { name: "Гадар", text: "Ус, салхинаас хамгаалах цагаан даавуун бүрээс." },
  bus: { name: "Бүслүүр", text: "Хялгасан оосроор бүрээсийг чангалж бэхэлнэ." },
  storm: { name: "Шуурга", text: "Өрсөлдөгчийн хамгийн сүүлд тавьсан бүрээсийг хийсгэнэ." },
};
const STEP_LABEL = ["Хаалга", "Хана (зүүн)", "Хана (баруун)", "Тооно", "Багана", "Унь (1)", "Унь (2)", "Эсгий (туурга)", "Эсгий (дээвэр)", "Гадар", "Бүслүүр"];
const COLORS = ["#c8502e", "#2f6fb3", "#4f8a2b", "#8a4fb0"];
const NAME_KEY = "hf:ger:name";
const cardSrc = (c) => `/assets/cards/${c}.webp`;

// ── dom ─────────────────────────────────────────────────────────────────────

const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

let toastTimer = 0;
function toast(text, isError = false) {
  const t = $("#toast");
  t.textContent = text;
  t.classList.toggle("err", isError);
  t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("on"), isError ? 3200 : 2600);
}

const shareUrl = () => `${location.origin}${location.pathname}?room=${encodeURIComponent(room)}`;
async function copyLink() {
  try {
    await navigator.clipboard.writeText(shareUrl());
    toast("Урилгын линк хуулагдлаа. Найздаа илгээгээрэй!");
  } catch {
    toast(shareUrl());
  }
}
$("#copy-link").addEventListener("click", copyLink);
$("#share-copy").addEventListener("click", copyLink);
$("#share-url").textContent = shareUrl();

// ── sound (synthesised, no files) ───────────────────────────────────────────

let audio = null;
let soundOn = localStorage.getItem("hf:ger:sound") !== "off";
const soundBtn = $("#sound");
const paintSound = () => {
  soundBtn.textContent = soundOn ? "🔊" : "🔇";
  soundBtn.setAttribute("aria-pressed", String(soundOn));
};
paintSound();
soundBtn.addEventListener("click", () => {
  soundOn = !soundOn;
  localStorage.setItem("hf:ger:sound", soundOn ? "on" : "off");
  paintSound();
});
function ctx() {
  if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
  if (audio.state === "suspended") audio.resume();
  return audio;
}
function tone(freq, dur, type = "sine", gain = 0.15, when = 0) {
  if (!soundOn) return;
  const a = ctx();
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.value = freq;
  const t = a.currentTime + when;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur);
}
function noise(dur, from, to, gain = 0.25) {
  if (!soundOn) return;
  const a = ctx();
  const buf = a.createBuffer(1, a.sampleRate * dur, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = "bandpass";
  f.Q.value = 1.2;
  f.frequency.setValueAtTime(from, a.currentTime);
  f.frequency.exponentialRampToValueAtTime(to, a.currentTime + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, a.currentTime);
  g.gain.exponentialRampToValueAtTime(gain, a.currentTime + dur * 0.3);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  src.connect(f).connect(g).connect(a.destination);
  src.start();
}
const sfx = {
  place: () => { tone(140, 0.18, "triangle", 0.25); tone(320, 0.08, "square", 0.05, 0.02); },
  storm: () => noise(1.1, 300, 2400, 0.3),
  swap: () => { tone(520, 0.08, "triangle", 0.08); tone(660, 0.08, "triangle", 0.08, 0.07); },
  turn: () => { tone(880, 0.35, "sine", 0.08); tone(1320, 0.3, "sine", 0.05, 0.08); },
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.5, "triangle", 0.12, i * 0.13)),
};

// ── three.js scene ──────────────────────────────────────────────────────────

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const canvas = $("#scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color("#cfe6f1");
scene.fog = new THREE.Fog("#d9ebf2", 22, 60);

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
camera.position.set(0, 6.4, 9.6);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.7, -1.8);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 4;
controls.maxDistance = 22;
controls.minPolarAngle = 0.35;
controls.maxPolarAngle = 1.35;

scene.add(new THREE.HemisphereLight("#fff6e0", "#7aa457", 0.9));
const sun = new THREE.DirectionalLight("#ffe2b0", 2.1);
sun.position.set(-8, 12, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 40 });
scene.add(sun);

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, flatShading: true, ...extra });

// ground + hills (low-poly)
{
  const geo = new THREE.CircleGeometry(60, 48, 0, Math.PI * 2);
  geo.rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(geo, mat("#86b35c"));
  ground.receiveShadow = true;
  scene.add(ground);
  const hillGeo = new THREE.IcosahedronGeometry(1, 1);
  const hillMats = [mat("#94bd6b"), mat("#7fa95a"), mat("#b7b6d6")];
  const hills = [];
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + (i % 3) * 0.1;
    const r = 40 + (i % 4) * 6;
    hills.push({ a, r, s: 3 + (i % 5) * 1.4, m: i % 3 });
  }
  for (const m of [0, 1, 2]) {
    const list = hills.filter((h) => h.m === m);
    const inst = new THREE.InstancedMesh(hillGeo, hillMats[m], list.length);
    const d = new THREE.Object3D();
    list.forEach((h, i) => {
      d.position.set(Math.sin(h.a) * h.r, -h.s * 0.45, -Math.cos(h.a) * h.r);
      d.scale.set(h.s * 1.8, h.s, h.s * 1.4);
      d.rotation.y = h.a;
      d.updateMatrix();
      inst.setMatrixAt(i, d.matrix);
    });
    scene.add(inst);
  }
}

// ── ger geometry ────────────────────────────────────────────────────────────

const R = 1.2;          // wall radius
const H = 0.78;         // wall height
const TOP = 1.55;       // crown height
const TR = 0.26;        // crown radius
const GAP = 0.46;       // door gap, radians

function latticeTexture() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const g = c.getContext("2d");
  g.strokeStyle = "#c8502e";
  g.lineWidth = 5;
  for (let x = -64; x < 320; x += 22) {
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 64, 64); g.stroke();
    g.beginPath(); g.moveTo(x + 64, 0); g.lineTo(x, 64); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(3, 1);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function canvasCoverTexture() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#fbfaf5";
  g.fillRect(0, 0, 512, 128);
  g.fillStyle = "#2f6fb3";
  g.fillRect(0, 96, 512, 22);
  g.fillStyle = "#fbfaf5";
  for (let x = 0; x < 512; x += 24) {
    g.fillRect(x + 4, 100, 12, 4);
    g.fillRect(x + 12, 100, 4, 10);
    g.fillRect(x + 8, 106, 8, 4);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(4, 1);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const M = {
  wood: mat("#c8502e"),
  woodDark: mat("#9c3c22"),
  blue: mat("#2f6fb3"),
  gold: mat("#f2b53a", { emissive: "#6b4200", emissiveIntensity: 0.25 }),
  lattice: new THREE.MeshStandardMaterial({ map: latticeTexture(), transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 }),
  felt: mat("#e9dcc2", { side: THREE.DoubleSide }),
  canvas: new THREE.MeshStandardMaterial({ map: canvasCoverTexture(), side: THREE.DoubleSide, roughness: 0.8 }),
  rope: mat("#5a3b24"),
  floor: mat("#b88a5a"),
};
// the lattice texture is drawn with transparent gaps; clear the canvas first
{
  const t = M.lattice.map;
  const g = t.image.getContext("2d");
  const copy = g.getImageData(0, 0, 256, 64);
  g.clearRect(0, 0, 256, 64);
  g.putImageData(copy, 0, 0);
  t.needsUpdate = true;
}

function rod(a, b, radius, material) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(radius, radius, len, 6);
  geo.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  geo.applyQuaternion(q);
  geo.translate(a.x, a.y, a.z);
  return geo;
}

/** Eleven groups, one per build step, positioned in the ger's local frame (door faces +z). */
function buildParts() {
  const parts = [];
  const add = (...meshes) => {
    const g = new THREE.Group();
    for (const m of meshes) {
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
    parts.push(g);
  };

  // 0 door
  {
    const frame = new THREE.Group();
    const w = 0.5, h = 0.66;
    const post = new THREE.BoxGeometry(0.06, h, 0.08);
    const left = new THREE.Mesh(post, M.woodDark); left.position.set(-w / 2, h / 2, 0);
    const right = new THREE.Mesh(post, M.woodDark); right.position.set(w / 2, h / 2, 0);
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, 0.07, 0.09), M.woodDark); lintel.position.set(0, h + 0.03, 0);
    const leafL = new THREE.Mesh(new THREE.BoxGeometry(w / 2 - 0.02, h - 0.04, 0.04), M.wood); leafL.position.set(-w / 4, h / 2, 0.01);
    const leafR = leafL.clone(); leafR.position.x = w / 4;
    const knotL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.012), M.blue); knotL.position.set(-w / 4, h * 0.62, 0.035); knotL.rotation.z = Math.PI / 4;
    const knotR = knotL.clone(); knotR.position.x = w / 4;
    frame.add(left, right, lintel, leafL, leafR, knotL, knotR);
    frame.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    frame.position.set(0, 0, R + 0.02);
    const g = new THREE.Group(); g.add(frame); parts.push(g);
  }
  // 1-2 khana halves
  for (const [start, len] of [[GAP / 2, Math.PI - GAP / 2], [Math.PI, Math.PI - GAP / 2]]) {
    const geo = new THREE.CylinderGeometry(R, R, H, 32, 1, true, start, len);
    geo.translate(0, H / 2, 0);
    add(new THREE.Mesh(geo, M.lattice));
  }
  // 3 toono
  {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(TR, 0.04, 6, 24), M.wood);
    ring.rotation.x = Math.PI / 2; ring.position.y = TOP;
    const bar1 = new THREE.Mesh(new THREE.BoxGeometry(TR * 2, 0.035, 0.04), M.blue); bar1.position.y = TOP + 0.05;
    const bar2 = bar1.clone(); bar2.rotation.y = Math.PI / 2;
    add(ring, bar1, bar2);
  }
  // 4 bagana
  {
    const geo = mergeGeometries([
      rod(new THREE.Vector3(-0.13, 0, 0), new THREE.Vector3(-0.13, TOP - 0.03, 0), 0.035, M.wood),
      rod(new THREE.Vector3(0.13, 0, 0), new THREE.Vector3(0.13, TOP - 0.03, 0), 0.035, M.wood),
    ]);
    add(new THREE.Mesh(geo, M.wood));
  }
  // 5-6 uni (roof poles), split even / odd
  for (const parity of [0, 1]) {
    const geos = [];
    const count = 40;
    for (let i = parity; i < count; i += 2) {
      const a = (i / count) * Math.PI * 2;
      const lo = new THREE.Vector3(Math.sin(a) * R, H, Math.cos(a) * R);
      const hi = new THREE.Vector3(Math.sin(a) * TR, TOP, Math.cos(a) * TR);
      geos.push(rod(lo, hi, 0.016));
    }
    add(new THREE.Mesh(mergeGeometries(geos), M.wood));
  }
  // 7 esgii wall felt (keeps the door clear)
  {
    const geo = new THREE.CylinderGeometry(R + 0.03, R + 0.03, H, 36, 1, true, GAP / 2, Math.PI * 2 - GAP);
    geo.translate(0, H / 2, 0);
    add(new THREE.Mesh(geo, M.felt));
  }
  // 8 esgii roof felt
  {
    const geo = new THREE.CylinderGeometry(TR + 0.03, R + 0.1, TOP - H, 36, 1, true);
    geo.translate(0, (H + TOP) / 2 + 0.02, 0);
    add(new THREE.Mesh(geo, M.felt));
  }
  // 9 gadar: white canvas over wall and roof
  {
    const wall = new THREE.CylinderGeometry(R + 0.07, R + 0.07, H + 0.02, 40, 1, true, GAP / 2, Math.PI * 2 - GAP);
    wall.translate(0, H / 2, 0);
    const roof = new THREE.CylinderGeometry(TR + 0.05, R + 0.15, TOP - H, 40, 1, true);
    roof.translate(0, (H + TOP) / 2 + 0.05, 0);
    add(new THREE.Mesh(wall, M.canvas), new THREE.Mesh(roof, M.canvas));
  }
  // 10 bus: three ropes round the wall
  {
    const geos = [0.18, 0.42, 0.66].map((y) => {
      const g = new THREE.TorusGeometry(R + 0.09, 0.022, 5, 48);
      g.rotateX(Math.PI / 2);
      g.translate(0, y, 0);
      return g;
    });
    add(new THREE.Mesh(mergeGeometries(geos), M.rope));
  }
  return parts;
}

// ── sites (one per player) ──────────────────────────────────────────────────

const SLOT = [
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(-3.9, 0, -3.6),
  new THREE.Vector3(3.9, 0, -3.6),
  new THREE.Vector3(0, 0, -6.4),
];
// a phone held upright is narrow: stack the sites deeper instead of wider
const SLOT_TALL = [
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(-2.2, 0, -3.8),
  new THREE.Vector3(2.2, 0, -3.8),
  new THREE.Vector3(0, 0, -6.6),
];
let tall = innerWidth < innerHeight;
const slotAt = (index) => (tall ? SLOT_TALL : SLOT)[index];

function labelSprite() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(2.4, 0.6, 1);
  sprite.renderOrder = 10;
  const draw = (text, color, active) => {
    const g = c.getContext("2d");
    g.clearRect(0, 0, 512, 128);
    g.font = "700 46px Manrope, sans-serif";
    const w = Math.min(500, g.measureText(text).width + 70);
    const x = (512 - w) / 2;
    g.fillStyle = active ? "#f2b53a" : "rgba(251,246,234,0.94)";
    g.beginPath();
    g.roundRect(x, 24, w, 80, 40);
    g.fill();
    g.fillStyle = color;
    g.beginPath();
    g.arc(x + 38, 64, 13, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#2a2118";
    g.textBaseline = "middle";
    g.fillText(text, x + 60, 66, w - 76);
    tex.needsUpdate = true;
  };
  return { sprite, draw };
}

const sites = new Map(); // playerId -> site

function placeRoot(root, index) {
  const at = slotAt(index);
  root.position.copy(at);
  root.rotation.y = index === 0 ? 0 : Math.atan2(-at.x, -at.z + 9) * 0.6;
}

function makeSite(index) {
  const root = new THREE.Group();
  placeRoot(root, index);
  const floor = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.35, R + 0.42, 0.08, 32), M.floor);
  floor.position.y = -0.03;
  floor.receiveShadow = true;
  root.add(floor);
  const glow = new THREE.Mesh(new THREE.TorusGeometry(R + 0.55, 0.05, 6, 48), M.gold);
  glow.rotation.x = Math.PI / 2;
  glow.position.y = 0.02;
  glow.visible = false;
  root.add(glow);
  const parts = buildParts();
  for (const p of parts) {
    p.visible = false;
    p.userData.base = p.position.clone();
    root.add(p);
  }
  const label = labelSprite();
  label.sprite.position.set(0, TOP + 0.75, 0);
  root.add(label.sprite);
  scene.add(root);
  return { root, parts, glow, label, shown: 0, index, labelKey: "" };
}

function disposeSite(site) {
  scene.remove(site.root);
}

// ── tweens & particles ──────────────────────────────────────────────────────

const tweens = [];
const easeOutBack = (t) => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2);
const easeIn = (t) => t * t;
function tween(dur, step, done) {
  if (reduced) { step(1); done?.(); return; }
  tweens.push({ start: performance.now(), dur, step, done });
}

const puffGeo = new THREE.IcosahedronGeometry(0.07, 0);
const puffMat = new THREE.MeshStandardMaterial({ color: "#e7dcc4", transparent: true, roughness: 1, flatShading: true });
const PUFFS = 64;
const puffs = new THREE.InstancedMesh(puffGeo, puffMat, PUFFS);
puffs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
puffs.count = 0;
scene.add(puffs);
const puffData = [];
const dummy = new THREE.Object3D();
function emitPuffs(origin, n, spread, rise) {
  if (reduced) return;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    puffData.push({
      p: origin.clone().add(new THREE.Vector3(Math.cos(a) * spread, 0.05, Math.sin(a) * spread)),
      v: new THREE.Vector3(Math.cos(a) * 0.9, rise * (0.6 + Math.random() * 0.8), Math.sin(a) * 0.9),
      life: 0,
      max: 0.7 + Math.random() * 0.5,
    });
  }
  while (puffData.length > PUFFS) puffData.shift();
}

function placePart(site, i) {
  const p = site.parts[i];
  p.visible = true;
  const base = p.userData.base;
  tween(650, (t) => {
    const e = easeOutBack(t);
    p.position.set(base.x, base.y + (1 - e) * 2.2, base.z);
    p.scale.setScalar(0.8 + 0.2 * Math.min(1, e));
  }, () => {
    p.position.copy(base);
    p.scale.setScalar(1);
    emitPuffs(site.root.position.clone().add(new THREE.Vector3(0, 0, 0)), 14, R + 0.2, 0.8);
  });
}
function blowPart(site, i) {
  const p = site.parts[i];
  const base = p.userData.base;
  emitPuffs(site.root.position.clone(), 22, R + 0.4, 2.4);
  tween(950, (t) => {
    const e = easeIn(t);
    p.position.set(base.x + e * 2.5, base.y + e * 4, base.z - e * 1.5);
    p.rotation.set(e * 1.5, e * 4, e * 0.8);
    p.scale.setScalar(1 - e * 0.6);
  }, () => {
    p.visible = false;
    p.position.copy(base);
    p.rotation.set(0, 0, 0);
    p.scale.setScalar(1);
  });
}
function setBuilt(site, n, animate) {
  if (!animate) {
    site.parts.forEach((p, i) => {
      p.visible = i < n;
      p.position.copy(p.userData.base);
      p.rotation.set(0, 0, 0);
      p.scale.setScalar(1);
    });
    site.shown = n;
    return;
  }
  if (n > site.shown) {
    for (let i = site.shown; i < n; i++) setTimeout(() => placePart(site, i), (i - site.shown) * 220);
  } else if (n < site.shown) {
    for (let i = n; i < site.shown; i++) blowPart(site, i);
  }
  site.shown = n;
}

// ── frame loop ──────────────────────────────────────────────────────────────

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  const portrait = w < h;
  if (portrait !== tall) {
    tall = portrait;
    for (const site of sites.values()) placeRoot(site.root, site.index);
  }
  camera.fov = portrait ? 50 : 42;
  // the narrower the screen, the further back the camera sits to fit the sites
  const back = portrait ? Math.min(1.6, Math.max(1.15, 0.7 / (w / h))) : 1;
  camera.position.set(0, (portrait ? 8.6 : 6.4) * back, (portrait ? 7.6 : 9.6) * back);
  controls.target.set(0, 0.7, portrait ? -3.2 : -1.8);
  // the hand panel covers the bottom of the screen; lift the scene above it
  camera.setViewOffset(w, h, 0, h * (portrait ? 0.17 : 0.12), w, h);
  camera.updateProjectionMatrix();
  controls.update();
}
addEventListener("resize", resize);
// the phone layout parks the build order just above the hand panel, whose height varies
new ResizeObserver(([e]) => document.documentElement.style.setProperty("--bottom-h", `${e.target.offsetHeight}px`)).observe($("#bottom"));
resize();

let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    const t = Math.min(1, (now - tw.start) / tw.dur);
    tw.step(t);
    if (t >= 1) { tweens.splice(i, 1); tw.done?.(); }
  }
  let alive = 0;
  for (const d of puffData) {
    d.life += dt;
    d.v.y -= 1.6 * dt;
    d.p.addScaledVector(d.v, dt);
    if (d.life < d.max) {
      const s = 1 - d.life / d.max;
      dummy.position.copy(d.p);
      dummy.scale.setScalar(0.4 + s);
      dummy.updateMatrix();
      puffs.setMatrixAt(alive++, dummy.matrix);
    }
  }
  for (let i = puffData.length - 1; i >= 0; i--) if (puffData[i].life >= puffData[i].max) puffData.splice(i, 1);
  puffs.count = alive;
  puffs.instanceMatrix.needsUpdate = true;
  for (const site of sites.values()) {
    if (site.glow.visible) site.glow.material.emissiveIntensity = 0.35 + Math.sin(now / 280) * 0.25;
  }
  controls.update();
  renderer.render(scene, camera);
});

// ── game state → screen ─────────────────────────────────────────────────────

let view = null;
let status = "waiting";
let lastSeq = -1;
let selected = [];
let stormPick = false;
let autoSat = false;
let replay = null; // {bots, sent}: computers to bring back after "play again"
let turnDeadline = null; // performance.now() when the current turn runs out
let lastTick = null;

function nameOf(id) {
  const p = view?.players.find((x) => x.id === id);
  return p?.name || "Тоглогч";
}

function orderPlayers(players) {
  // you first (centre site), others keep table order
  const mine = players.filter((p) => p.id === ME);
  return [...mine, ...players.filter((p) => p.id !== ME)];
}

function syncSites(animate) {
  const players = view && view.phase !== "lobby" ? orderPlayers(view.players) : orderPlayers(view?.players ?? []);
  const ids = new Set(players.map((p) => p.id));
  for (const [id, site] of sites) {
    if (!ids.has(id)) { disposeSite(site); sites.delete(id); }
  }
  players.forEach((p, i) => {
    let site = sites.get(p.id);
    if (site && site.index !== i) { disposeSite(site); sites.delete(p.id); site = null; }
    if (!site) { site = makeSite(i); sites.set(p.id, site); site.shown = 0; }
    const color = COLORS[view.players.findIndex((x) => x.id === p.id) % COLORS.length];
    const active = view.turn === p.id && view.phase === "playing";
    const text = `${p.name || "..."}${p.id === ME ? " (та)" : ""}`;
    const key = `${text}|${color}|${active}`;
    if (key !== site.labelKey) { site.label.draw(text, color, active); site.labelKey = key; }
    site.glow.visible = active;
    setBuilt(site, p.built.length, animate);
  });
}

function onState(msg) {
  const prevSeq = lastSeq;
  status = msg.status;
  view = msg.view;
  if (!view) return;
  const isNew = view.seq !== prevSeq;
  lastSeq = view.seq;
  turnDeadline = msg.turnEndsIn == null ? null : performance.now() + msg.turnEndsIn;
  tickTimer();

  // re-seat automatically after a reset, using the saved name
  const savedName = localStorage.getItem(NAME_KEY);
  const meIn = view.players.find((p) => p.id === ME);
  if (view.phase === "lobby" && savedName && (!meIn || !meIn.name) && !autoSat && msg.seats.includes(ME)) {
    autoSat = true;
    send({ type: "action", action: { type: "sit", name: savedName } });
  }
  if (view.phase !== "lobby") autoSat = false;

  // "play again" with computers: re-add them one per update, then start the round
  if (replay && view.phase === "lobby" && meIn?.name && replay.sent !== view.seq) {
    replay.sent = view.seq;
    const bots = view.players.filter((p) => p.bot).length;
    if (bots < replay.bots && view.players.length < 4) act({ type: "addBot" });
    else { replay = null; act({ type: "start" }); }
  }
  if (replay && view.phase === "playing") replay = null;

  // events → toast + sound
  if (isNew && prevSeq !== -1 && view.last) {
    const e = view.last;
    const who = e.by === ME ? "Та" : nameOf(e.by);
    if (e.kind === "place") { sfx.place(); toast(`${who} ${PART[e.part].name.toLowerCase()} тавилаа`); }
    else if (e.kind === "storm") { sfx.storm(); toast(`🌪 ${who} шуурга илгээв! ${e.target === ME ? "Таны" : nameOf(e.target) + "-ийн"} ${PART[e.part].name.toLowerCase()} хийслээ`); }
    else if (e.kind === "swap") { sfx.swap(); toast(`${who} ${e.count} карт солив`); }
    else if (e.kind === "start") toast("Тоглолт эхэллээ! Хаалгаа босгоорой");
    if (view.yourTurn && e.by !== ME && (e.kind === "storm" || e.kind === "swap" || e.kind === "end" || e.kind === "timeout")) sfx.turn();
    // a timeout can be followed by a computer's move in the same update, so it has its own slot
    const t = view.lastTimeout;
    if (t && t.seq > prevSeq) { sfx.swap(); toast(`⏱ ${t.by === ME ? "Таны" : nameOf(t.by) + "-ийн"} хугацаа дууслаа${t.count ? `, ${t.count} карт солигдлоо` : ""}`); }
  }
  if (isNew) { selected = []; stormPick = false; }

  syncSites(prevSeq !== -1);
  renderHud(msg);
}

function renderHud(msg) {
  const phase = view.phase;
  const me = view.players.find((p) => p.id === ME);
  const inGame = phase !== "lobby" && Boolean(me) && me.handCount + me.built.length > 0;

  $("#round-label").textContent = phase === "lobby" ? "Лобби" : `Тоглолт ${view.round}`;
  $("#lobby").hidden = phase !== "lobby";
  $("#gameover").hidden = phase !== "done";
  $("#ladder").hidden = !inGame;
  $("#players").hidden = phase === "lobby";
  $("#bottom").hidden = !inGame || phase === "done";
  $("#spectator").hidden = phase === "lobby" || inGame;

  if (phase === "lobby") renderLobby(msg);
  if (phase === "done") {
    const won = view.winner === ME;
    $("#over-title").textContent = won ? "Та яллаа!" : `${nameOf(view.winner)} яллаа`;
    $("#over-text").textContent = won ? "Таны гэр хамгийн түрүүнд бүрэн баригдлаа. Сайхан нүүдэллээрэй!" : "Энэ удаад өрсөлдөгч тань түрүүлж гэрээ барилаа. Дахин нэг үзэх үү?";
    if (lastWinSeq !== view.seq) { lastWinSeq = view.seq; sfx.win(); }
  }
  if (phase !== "lobby") renderPlayers();
  if (inGame) { renderLadder(me); renderHand(me); }
}
let lastWinSeq = -1;

function renderLobby(msg) {
  const me = view.players.find((p) => p.id === ME);
  const list = $("#seated-list");
  list.replaceChildren();
  view.players.forEach((p, i) => {
    const li = el("li");
    const dot = el("span", "pl-dot");
    dot.style.background = COLORS[i % COLORS.length];
    li.append(dot, document.createTextNode(p.name || "Нэр оруулаагүй"));
    if (p.id === ME) li.append(el("em", null, "(та)"));
    if (p.bot) {
      const rm = el("button", "bot-remove", "✕");
      rm.type = "button";
      rm.setAttribute("aria-label", `${p.name} хасах`);
      rm.addEventListener("click", () => act({ type: "removeBot", id: p.id }));
      li.append(rm);
    }
    list.append(li);
  });
  const input = $("#name-input");
  if (!input.value && (me?.name || localStorage.getItem(NAME_KEY))) input.value = me?.name || localStorage.getItem(NAME_KEY);
  $("#name-submit").textContent = me?.name ? "Нэр солих" : "Суух";
  const named = view.players.filter((p) => p.name).length;
  const canStart = me?.name && view.players.length >= 2 && named === view.players.length;
  $("#start").disabled = !canStart;
  $("#add-bot").disabled = !me?.name || view.players.length >= 4;
  const seatedInRoom = msg.seats.includes(ME);
  $("#lobby-note").textContent = !seatedInRoom
    ? "Өрөө дүүрсэн байна (4 тоглогч). Та үзэгчээр орлоо."
    : view.players.length < 2
      ? "Дор хаяж 2 тоглогч хэрэгтэй. Линкээ найздаа илгээх эсвэл компьютертэй тоглоорой."
      : named < view.players.length
        ? "Бүх тоглогч нэрээ оруулахыг хүлээж байна."
        : "Бэлэн! Хэн ч тоглолтыг эхлүүлж болно.";
}

function renderPlayers() {
  const ul = $("#player-list");
  ul.replaceChildren();
  view.players.forEach((p, i) => {
    const li = el("li", view.turn === p.id && view.phase === "playing" ? "turn" : "");
    const head = el("div", "pl-head");
    const dot = el("span", "pl-dot");
    dot.style.background = COLORS[i % COLORS.length];
    head.append(dot, el("span", null, `${p.name || "Тоглогч"}${p.id === ME ? " (та)" : ""}`), el("em", null, `${p.built.length}/11 · ${p.handCount} карт`));
    const bar = el("div", "bar");
    const fill = el("i");
    fill.style.width = `${(p.built.length / 11) * 100}%`;
    bar.append(fill);
    li.append(head, bar);
    ul.append(li);
  });
  $("#deck-info").textContent = `Багцад ${view.deckCount} карт үлдсэн`;
}

function renderLadder(me) {
  const ol = $("#ladder-list");
  ol.replaceChildren();
  view.steps.forEach((part, i) => {
    const li = el("li", i < me.built.length ? "done" : i === me.built.length ? "next" : "");
    const img = el("img");
    img.src = cardSrc(part);
    img.alt = "";
    li.append(img, el("span", null, STEP_LABEL[i]));
    ol.append(li);
  });
  const need = view.steps[me.built.length];
  $("#ladder-tip").textContent = need ? `${PART[need].name}: ${PART[need].text}` : "Гэр бүрэн баригдлаа!";
}

function renderHand(me) {
  const need = view.steps[me.built.length];
  const hand = $("#hand");
  hand.replaceChildren();
  view.yourHand.forEach((c, i) => {
    const b = el("button", "card");
    b.type = "button";
    if (c === "storm") b.classList.add("storm");
    if (view.yourTurn && c === need) b.classList.add("fits");
    if (selected.includes(i)) b.classList.add("selected");
    b.setAttribute("aria-pressed", String(selected.includes(i)));
    b.title = PART[c].text;
    const img = el("img");
    img.src = cardSrc(c);
    img.alt = "";
    b.append(img, el("b", null, PART[c].name));
    b.disabled = !view.yourTurn;
    b.addEventListener("click", () => toggleCard(i));
    b.addEventListener("dblclick", () => { if (c === need) act({ type: "place", card: i }); });
    hand.append(b);
  });

  const line = $("#turn-line");
  line.classList.toggle("mine", view.yourTurn);
  line.textContent = view.yourTurn
    ? view.placedThisTurn
      ? `Таны ээлж: ${view.placedThisTurn} хэсэг тавилаа. Үргэлжлүүлэх эсвэл ээлжээ дуусгана уу`
      : `Таны ээлж! Дараагийнх: ${PART[need]?.name ?? "-"}`
    : `${nameOf(view.turn)}-ийн ээлж...`;

  renderActions(me, need);
}

/** The turn clock under the hand: a draining bar and the seconds left, red for the last five. */
function tickTimer() {
  const box = $("#timer");
  const on = turnDeadline != null && view?.phase === "playing";
  box.hidden = !on;
  if (!on) return;
  const left = Math.max(0, turnDeadline - performance.now());
  const sec = Math.ceil(left / 1000);
  box.querySelector("i").style.transform = `scaleX(${left / 15000})`;
  $("#timer-sec").textContent = `${sec}с`;
  box.classList.toggle("low", sec <= 5);
  if (view.yourTurn && sec <= 5 && sec > 0 && sec !== lastTick) tone(660, 0.06, "sine", 0.05);
  lastTick = sec;
}
setInterval(tickTimer, 100);

function toggleCard(i) {
  const at = selected.indexOf(i);
  if (at >= 0) selected.splice(at, 1);
  else {
    selected.push(i);
    if (selected.length > 3) selected.shift();
  }
  stormPick = false;
  renderHand(view.players.find((p) => p.id === ME));
}

function act(action) {
  send({ type: "action", action });
}

function renderActions(me, need) {
  const box = $("#actions");
  box.replaceChildren();
  const hint = $("#hint");
  hint.textContent = "";
  if (!view.yourTurn) return;

  const one = selected.length === 1 ? view.yourHand[selected[0]] : null;
  const place = el("button", "btn btn-place", "🏗 Тавих");
  place.type = "button";
  place.disabled = one !== need;
  place.addEventListener("click", () => act({ type: "place", card: selected[0] }));
  box.append(place);

  if (one === "storm") {
    const targets = view.players.filter((p) => p.id !== ME && ["esgii", "gadar", "bus"].includes(p.built[p.built.length - 1]));
    if (targets.length) {
      for (const t of targets) {
        const b = el("button", "btn btn-storm", `🌪 ${t.name}: ${PART[t.built[t.built.length - 1]].name}`);
        b.type = "button";
        b.addEventListener("click", () => act({ type: "storm", card: selected[0], target: t.id }));
        box.append(b);
      }
    } else {
      hint.textContent = "Одоогоор хэнд ч хийсгэх бүрээс алга. Шуургаа хадгалаарай.";
    }
  }

  const swap = el("button", "btn btn-swap", selected.length ? `🔄 ${selected.length} карт солих` : "🔄 Солих");
  swap.type = "button";
  swap.disabled = selected.length === 0;
  swap.addEventListener("click", () => act({ type: "swap", cards: [...selected] }));
  box.append(swap);

  if (view.placedThisTurn) {
    const end = el("button", "btn btn-end", "Ээлж дуусгах ➜");
    end.type = "button";
    end.addEventListener("click", () => act({ type: "end" }));
    box.append(end);
  }

  if (!hint.textContent) {
    if (!selected.length) {
      hint.textContent = view.yourHand.includes(need)
        ? `Гэрэлтсэн ${PART[need].name.toLowerCase()} картыг сонгоод тавина уу (давхар дарж ч болно).`
        : `${PART[need].name} алга. Хэрэггүй 1-3 картаа сонгоод солих уу, эсвэл шуурга илгээх үү.`;
    } else if (one && one !== need && one !== "storm") {
      hint.textContent = `Одоо ${PART[need].name.toLowerCase()} хэрэгтэй. ${PART[one].name} дараа хэрэг болно, эсвэл соль.`;
    }
  }
}

// lobby controls
$("#name-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("#name-input").value.trim();
  if (!name) return;
  localStorage.setItem(NAME_KEY, name);
  ctx(); // unlock audio on a user gesture
  act({ type: "sit", name });
});
$("#start").addEventListener("click", () => { ctx(); act({ type: "start" }); });
$("#add-bot").addEventListener("click", () => { ctx(); act({ type: "addBot" }); });
$("#again").addEventListener("click", () => {
  // a reset empties the table, so remember the computers and bring them back in the lobby
  const bots = view?.players.filter((p) => p.bot).length ?? 0;
  if (bots) replay = { bots, sent: -1 };
  send({ type: "reset" });
});

// how-to-play dialog: opens from the top bar or the lobby, and once by itself on a first visit
const help = $("#help");
let helpReturn = null;
function openHelp() {
  helpReturn = document.activeElement;
  help.hidden = false;
  $("#help-close").focus();
}
function closeHelp() {
  help.hidden = true;
  localStorage.setItem("hf:ger:helpSeen", "1");
  helpReturn?.focus?.();
}
$("#help-open").addEventListener("click", openHelp);
$("#help-from-lobby").addEventListener("click", openHelp);
$("#help-close").addEventListener("click", closeHelp);
$("#help-ok").addEventListener("click", closeHelp);
help.addEventListener("click", (e) => { if (e.target === help) closeHelp(); });
addEventListener("keydown", (e) => { if (e.key === "Escape" && !help.hidden) closeHelp(); });
if (!localStorage.getItem("hf:ger:helpSeen")) openHelp();

// keyboard: 1-5 select, Enter place, S swap, E end
addEventListener("keydown", (e) => {
  if (!view?.yourTurn || e.target instanceof HTMLInputElement || !help.hidden) return;
  const n = Number(e.key);
  if (n >= 1 && n <= view.yourHand.length) { toggleCard(n - 1); return; }
  const me = view.players.find((p) => p.id === ME);
  const need = view.steps[me.built.length];
  if (e.code === "Enter" && selected.length === 1 && view.yourHand[selected[0]] === need) act({ type: "place", card: selected[0] });
  if (e.code === "KeyS" && selected.length) act({ type: "swap", cards: [...selected] });
  if (e.code === "KeyE" && view.placedThisTurn) act({ type: "end" });
});

connect();
