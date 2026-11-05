import * as THREE from 'three';
import { createGyro, mountGyroSettings } from './gyro.js';
import { createAim, mountAimSettings, fromTouch, firePad } from './aim.js';
import { createSens, mountSensSettings } from './sens.js';
import { createControls, createLayout, mountControlsPanel } from './controls.js';
import { createNotify, mountNotifySettings } from './notify.js';
import * as ST from './stance.js';

/* ==========================================================================
   Xeno Siege — first-person alien survival on a town block
   ========================================================================== */

const $ = (id) => document.getElementById(id);
const isTouch = window.matchMedia('(pointer: coarse)').matches;
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------- renderer ---------- */
const canvas = $('stage');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouch, powerPreference: 'high-performance' }); }
catch {
  document.querySelector('#startScreen .panel p').textContent = 'This game needs WebGL, which is not available in this browser.';
  $('startBtn').disabled = true;
  throw new Error('WebGL unavailable');
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouch ? 1.5 : 2));
renderer.shadowMap.enabled = !isTouch;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const BASE_FOV = isTouch ? 80 : 74;
const camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.05, 300);
const aim = createAim('siege', isTouch);
const sens = createSens('siege');
const notify = createNotify('siege', document.getElementById('toast'));
camera.rotation.order = 'YXZ';
scene.add(camera);

/* ---------- sky + light: dusk over the block ---------- */
{
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const g = c.getContext('2d'), grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#120f1a'); grd.addColorStop(0.45, '#3a2433'); grd.addColorStop(0.62, '#a4523a'); grd.addColorStop(0.75, '#2b1f22'); grd.addColorStop(1, '#151314');
  g.fillStyle = grd; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  scene.background = t;
}
scene.fog = new THREE.Fog(0x2b1f24, 28, 105);
scene.add(new THREE.HemisphereLight(0xffd2b0, 0x1c1c28, 0.75));
const sun = new THREE.DirectionalLight(0xffb27a, 1.5);
sun.position.set(-40, 45, -25);
sun.castShadow = true;
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 160 });
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0005;
scene.add(sun);
const lampLights = [];
const flashLight = new THREE.PointLight(0xffaa66, 0, 14, 2); scene.add(flashLight);
const boomLight = new THREE.PointLight(0xff7a3a, 0, 22, 2); scene.add(boomLight);

/* ---------- procedural textures ---------- */
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  return t;
}
const groundTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#2d2b2b'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2600; i++) { const v = 35 + Math.random() * 25; g.fillStyle = `rgb(${v},${v - 2},${v - 3})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 2; g.strokeRect(0, 0, w, h);
}, [48, 48]);
const facadeVariants = ['#4a3f3a', '#3b3f45', '#57493d', '#3e3a44'].map((base) => () => canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`; g.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
    const lit = Math.random() < 0.35;
    g.fillStyle = lit ? (Math.random() < 0.5 ? '#ffcf7a' : '#ffe2a8') : '#1b1d22';
    g.fillRect(14 + x * 64, 16 + y * 64, 36, 40);
    g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(14 + x * 64, 54 + y * 64, 36, 4);
  }
}));

/* ==========================================================================
   World: buildings and cover (axis-aligned boxes double as colliders)
   ========================================================================== */
const HALF = 48;
const boxes = [];
const world = new THREE.Group(); scene.add(world);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2 + 40, HALF * 2 + 40), new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; world.add(ground);

// road markings
{
  const mat = new THREE.MeshBasicMaterial({ color: 0x8a7a5a, transparent: true, opacity: 0.35 });
  for (let i = -HALF + 2; i < HALF; i += 5) {
    [[i, 0, 2.4, 0.18], [0, i, 0.18, 2.4]].forEach(([x, z, w, d]) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.01, z); world.add(m);
    });
  }
}

function addBox(x, z, w, d, h, mat, opts = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, h / 2, z); m.castShadow = opts.shadow !== false; m.receiveShadow = true;
  world.add(m);
  const b = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, h, mesh: m, kind: opts.kind || 'cover' };
  boxes.push(b);
  return b;
}

function building(x, z, w, d, h) {
  const make = facadeVariants[Math.floor(Math.random() * facadeVariants.length)];
  const side = (len) => { const t = make(); t.repeat.set(Math.max(1, Math.round(len / 4)), Math.max(1, Math.round(h / 4))); return new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 }); };
  const roof = new THREE.MeshStandardMaterial({ color: 0x252226, roughness: 1 });
  const mats = [side(d), side(d), roof, roof, side(w), side(w)];
  addBox(x, z, w, d, h, mats, { kind: 'building' });
  // roof trim
  const trim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.4, d + 0.4), new THREE.MeshStandardMaterial({ color: 0x1a181b }));
  trim.position.set(x, h + 0.2, z); world.add(trim);
}

const M = {
  container: [0x7a3b2a, 0x2f5d6b, 0x6b6a2f, 0x3d4d3a].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, metalness: 0.3 })),
  car: [0x8b2f2f, 0x2d3e57, 0x9a9a92, 0x2b2b2e].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.4, metalness: 0.5 })),
  concrete: new THREE.MeshStandardMaterial({ color: 0x8c877d, roughness: 0.95 }),
  crate: new THREE.MeshStandardMaterial({ color: 0x8a6a42, roughness: 0.9 }),
  sand: new THREE.MeshStandardMaterial({ color: 0x9c8a63, roughness: 1 }),
  wall: new THREE.MeshStandardMaterial({ color: 0x2a2729, roughness: 1 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x14181e, roughness: 0.2, metalness: 0.6 }),
};

function car(x, z, alongX) {
  const w = alongX ? 4.4 : 1.9, d = alongX ? 1.9 : 4.4;
  const mat = M.car[Math.floor(Math.random() * M.car.length)];
  addBox(x, z, w, d, 1.15, mat, { kind: 'car' });
  const cab = new THREE.Mesh(new THREE.BoxGeometry(alongX ? 2.2 : 1.6, 0.6, alongX ? 1.6 : 2.2), M.glass);
  cab.position.set(x, 1.45, z); cab.castShadow = true; world.add(cab);
}

function buildWorld() {
  // perimeter walls
  addBox(0, -HALF - 1, HALF * 2 + 4, 2, 4, M.wall, { kind: 'wall' });
  addBox(0, HALF + 1, HALF * 2 + 4, 2, 4, M.wall, { kind: 'wall' });
  addBox(-HALF - 1, 0, 2, HALF * 2 + 4, 4, M.wall, { kind: 'wall' });
  addBox(HALF + 1, 0, 2, HALF * 2 + 4, 4, M.wall, { kind: 'wall' });
  // blocks of buildings with streets between them
  [[-34, -34, 18, 14, 16], [-12, -36, 12, 10, 10], [10, -34, 14, 14, 20], [34, -34, 14, 12, 12],
   [-36, -12, 12, 12, 11], [36, -10, 10, 14, 14], [-36, 14, 12, 12, 13], [36, 14, 12, 10, 9],
   [-32, 36, 16, 12, 12], [-8, 36, 12, 10, 17], [14, 36, 12, 12, 11], [36, 36, 12, 12, 15],
   [-16, -14, 6, 6, 7], [16, 14, 6, 8, 8]].forEach((b) => building(...b));
  // street furniture & cover
  [[-6, -6, 6.1, 2.5], [8, 4, 2.5, 6.1], [-10, 10, 6.1, 2.5], [22, -14, 2.5, 6.1], [-22, 24, 6.1, 2.5], [24, 24, 2.5, 6.1]].forEach(([x, z, w, d], i) =>
    addBox(x, z, w, d, 2.6, M.container[i % M.container.length], { kind: 'container' }));
  [[0, -18, true], [-24, 0, false], [24, 0, false], [4, 22, true], [-4, -26, true], [26, -24, false], [-26, -24, false]].forEach(([x, z, a]) => car(x, z, a));
  [[0, 8, 3, 0.6], [-14, 2, 0.6, 3], [14, -4, 0.6, 3], [6, -10, 3, 0.6], [-4, 18, 3, 0.6], [18, 8, 3, 0.6], [-18, -8, 3, 0.6]].forEach(([x, z, w, d]) =>
    addBox(x, z, w, d, 1.0, M.concrete, { kind: 'barrier' }));
  [[3, -3], [3.9, -3], [-12, -20], [-12.6, -19.1], [12, 20], [20, -20], [-20, 18], [28, 6]].forEach(([x, z]) => addBox(x, z, 1.1, 1.1, 1.1, M.crate, { kind: 'crate' }));
  [[-2, 2], [10, -16], [-16, 12]].forEach(([x, z]) => addBox(x, z, 2.6, 0.9, 0.9, M.sand, { kind: 'sandbag' }));

  // street lamps (glow only; cheap)
  const pole = new THREE.MeshStandardMaterial({ color: 0x1c1c1e });
  const bulb = new THREE.MeshBasicMaterial({ color: 0xffd28a });
  [[-24, -22], [24, -22], [-24, 24], [24, 24], [0, -44], [0, 44], [-44, 0], [44, 0]].forEach(([x, z]) => {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 6), pole); p.position.set(x, 3, z); world.add(p);
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8), bulb); b.position.set(x, 6.1, z); world.add(b);
  });
  [[-24, -22], [24, 24], [-24, 24], [24, -22]].forEach(([x, z]) => { const l = new THREE.PointLight(0xffc27a, 18, 22, 2); l.position.set(x, 5.6, z); scene.add(l); lampLights.push(l); });
}
buildWorld();

/* ---------- geometry helpers ---------- */
function rayBox(o, d, b, tMax) {
  let t0 = 0, t1 = tMax;
  const mins = [b.minX, 0, b.minZ], maxs = [b.maxX, b.h, b.maxZ], os = [o.x, o.y, o.z], ds = [d.x, d.y, d.z];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(ds[a]) < 1e-9) { if (os[a] < mins[a] || os[a] > maxs[a]) return Infinity; continue; }
    let ta = (mins[a] - os[a]) / ds[a], tb = (maxs[a] - os[a]) / ds[a];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return Infinity;
  }
  return t0;
}
function worldRay(o, d, tMax) {
  let t = tMax;
  if (d.y < -1e-6) t = Math.min(t, -o.y / d.y);
  for (const b of boxes) { const tb = rayBox(o, d, b, t); if (tb < t) t = tb; }
  return t;
}
const _d = new THREE.Vector3();
function lineOfSight(a, b) {
  _d.subVectors(b, a); const len = _d.length(); _d.divideScalar(len);
  for (const bx of boxes) if (rayBox(a, _d, bx, len) < len - 0.05) return false;
  return true;
}
function raySphere(o, d, c, r) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z, cc = ox * ox + oy * oy + oz * oz - r * r;
  const h = b * b - cc; if (h < 0) return Infinity;
  const t = -b - Math.sqrt(h); return t >= 0 ? t : Infinity;
}
// push a circle at pos (feet y) out of boxes it is beside; returns true if it hit something
function collide(pos, r, feetY) {
  let hit = false;
  for (const b of boxes) {
    if (feetY >= b.h - 0.05) continue;
    const cx = clamp(pos.x, b.minX, b.maxX), cz = clamp(pos.z, b.minZ, b.maxZ);
    let dx = pos.x - cx, dz = pos.z - cz, d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    hit = true;
    if (d2 < 1e-8) { // centre inside: push out the shortest way
      const opts = [[b.minX - r - pos.x, 0], [b.maxX + r - pos.x, 0], [0, b.minZ - r - pos.z], [0, b.maxZ + r - pos.z]];
      opts.sort((p, q) => Math.abs(p[0] + p[1]) - Math.abs(q[0] + q[1]));
      pos.x += opts[0][0]; pos.z += opts[0][1];
    } else {
      const d = Math.sqrt(d2), push = r - d; pos.x += (dx / d) * push; pos.z += (dz / d) * push;
    }
  }
  pos.x = clamp(pos.x, -HALF + r, HALF - r); pos.z = clamp(pos.z, -HALF + r, HALF - r);
  return hit;
}
function floorAt(pos, r, feetY) {
  let f = 0;
  for (const b of boxes) {
    if (b.h > feetY + 0.06) continue;
    if (pos.x > b.minX - r * 0.4 && pos.x < b.maxX + r * 0.4 && pos.z > b.minZ - r * 0.4 && pos.z < b.maxZ + r * 0.4) f = Math.max(f, b.h);
  }
  return f;
}

/* ==========================================================================
   Navigation: flow field over a 1m grid, so aliens route around buildings
   ========================================================================== */
const NAV = HALF * 2, cellOf = (v) => clamp(Math.floor(v + HALF), 0, NAV - 1);
const blocked = new Uint8Array(NAV * NAV);
const flow = new Int32Array(NAV * NAV);
function rebuildNav() {
  blocked.fill(0);
  for (let j = 0; j < NAV; j++) for (let i = 0; i < NAV; i++) {
    const x = i - HALF + 0.5, z = j - HALF + 0.5;
    for (const b of boxes) if (x > b.minX - 0.6 && x < b.maxX + 0.6 && z > b.minZ - 0.6 && z < b.maxZ + 0.6) { blocked[j * NAV + i] = 1; break; }
  }
}
rebuildNav();
const queue = new Int32Array(NAV * NAV);
function computeFlow(px, pz) {
  flow.fill(-1);
  let start = cellOf(pz) * NAV + cellOf(px);
  if (blocked[start]) { // nearest free cell
    let best = -1, bd = 1e9;
    for (let k = 0; k < NAV * NAV; k++) if (!blocked[k]) { const d = Math.abs((k % NAV) - (start % NAV)) + Math.abs(Math.floor(k / NAV) - Math.floor(start / NAV)); if (d < bd) { bd = d; best = k; } }
    start = best;
  }
  let head = 0, tail = 0; queue[tail++] = start; flow[start] = 0;
  while (head < tail) {
    const k = queue[head++], i = k % NAV, j = (k / NAV) | 0, d = flow[k] + 1;
    if (i > 0 && !blocked[k - 1] && flow[k - 1] < 0) { flow[k - 1] = d; queue[tail++] = k - 1; }
    if (i < NAV - 1 && !blocked[k + 1] && flow[k + 1] < 0) { flow[k + 1] = d; queue[tail++] = k + 1; }
    if (j > 0 && !blocked[k - NAV] && flow[k - NAV] < 0) { flow[k - NAV] = d; queue[tail++] = k - NAV; }
    if (j < NAV - 1 && !blocked[k + NAV] && flow[k + NAV] < 0) { flow[k + NAV] = d; queue[tail++] = k + NAV; }
  }
}
function flowDir(x, z, out) {
  const i = cellOf(x), j = cellOf(z), k = j * NAV + i;
  let best = flow[k] < 0 ? 1e9 : flow[k], bi = i, bj = j;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    if (!di && !dj) continue;
    const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= NAV || nj >= NAV) continue;
    const nk = nj * NAV + ni; if (flow[nk] < 0) continue;
    if (di && dj && (blocked[j * NAV + ni] || blocked[nj * NAV + i])) continue; // no corner cutting
    const v = flow[nk] + (di && dj ? 0.4 : 0);
    if (v < best) { best = v; bi = ni; bj = nj; }
  }
  out.set(bi - HALF + 0.5 - x, 0, bj - HALF + 0.5 - z);
  const l = out.length(); if (l > 1e-6) out.divideScalar(l);
  return out;
}

/* ==========================================================================
   Effects: particles, tracers, sound
   ========================================================================== */
const PART_N = 900;
const pGeo = new THREE.BufferGeometry();
const pPos = new Float32Array(PART_N * 3), pCol = new Float32Array(PART_N * 3), pVel = new Float32Array(PART_N * 3), pLife = new Float32Array(PART_N);
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3)); pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
const parts = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.14, vertexColors: true, transparent: true, depthWrite: false }));
parts.frustumCulled = false; scene.add(parts);
let pNext = 0; const _c = new THREE.Color();
function burst(p, color, n, speed, up = 2, grav = 1) {
  _c.set(color);
  for (let i = 0; i < n; i++) {
    const k = pNext; pNext = (pNext + 1) % PART_N;
    pPos[k * 3] = p.x; pPos[k * 3 + 1] = p.y; pPos[k * 3 + 2] = p.z;
    pVel[k * 3] = rand(-1, 1) * speed; pVel[k * 3 + 1] = rand(0, 1) * speed * 0.6 + up; pVel[k * 3 + 2] = rand(-1, 1) * speed;
    pLife[k] = rand(0.35, 0.8) * grav;
    const s = rand(0.7, 1.1); pCol[k * 3] = _c.r * s; pCol[k * 3 + 1] = _c.g * s; pCol[k * 3 + 2] = _c.b * s;
  }
}
function updateParticles(dt) {
  for (let k = 0; k < PART_N; k++) {
    if (pLife[k] <= 0) { pPos[k * 3 + 1] = -99; continue; }
    pLife[k] -= dt;
    pVel[k * 3 + 1] -= 14 * dt;
    pPos[k * 3] += pVel[k * 3] * dt; pPos[k * 3 + 1] += pVel[k * 3 + 1] * dt; pPos[k * 3 + 2] += pVel[k * 3 + 2] * dt;
    if (pPos[k * 3 + 1] < 0.02) { pPos[k * 3 + 1] = 0.02; pVel[k * 3] *= 0.5; pVel[k * 3 + 2] *= 0.5; pVel[k * 3 + 1] = 0; }
  }
  pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
}

const tracers = [];
for (let i = 0; i < 40; i++) {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffd6a0, transparent: true, opacity: 0 }));
  l.frustumCulled = false; scene.add(l); tracers.push({ l, life: 0 });
}
let trNext = 0;
function tracer(a, b, color = 0xffd6a0) {
  const t = tracers[trNext]; trNext = (trNext + 1) % tracers.length;
  const p = t.l.geometry.attributes.position.array;
  p[0] = a.x; p[1] = a.y; p[2] = a.z; p[3] = b.x; p[4] = b.y; p[5] = b.z;
  t.l.geometry.attributes.position.needsUpdate = true;
  t.l.material.color.setHex(color); t.life = 0.07;
}

let actx = null, noiseBuf = null;
function audio() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (!noiseBuf) { noiseBuf = actx.createBuffer(1, actx.sampleRate * 0.5, actx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    return actx;
  } catch { return null; }
}
function sfx(kind) {
  const a = audio(); if (!a) return;
  const t = a.currentTime, g = a.createGain(); g.connect(a.destination);
  const noise = (dur, vol, freq, q = 1) => {
    const s = a.createBufferSource(); s.buffer = noiseBuf; const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq; f.Q.value = q;
    s.connect(f).connect(g); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); s.start(t); s.stop(t + dur);
  };
  const tone = (f0, f1, dur, vol, type = 'square') => {
    const o = a.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    o.connect(g); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.start(t); o.stop(t + dur);
  };
  switch (kind) {
    case 'pistol': noise(0.12, 0.25, 2600); break;
    case 'smg': noise(0.07, 0.16, 3200); break;
    case 'shotgun': noise(0.3, 0.4, 1500); break;
    case 'rifle': noise(0.14, 0.3, 2000); break;
    case 'plasma': tone(600, 120, 0.3, 0.12, 'sawtooth'); break;
    case 'boom': noise(0.8, 0.6, 500); break;
    case 'hit': tone(900, 600, 0.05, 0.04); break;
    case 'crit': tone(1400, 900, 0.07, 0.06); break;
    case 'hurt': tone(160, 70, 0.25, 0.12, 'sawtooth'); break;
    case 'reload': tone(300, 500, 0.1, 0.04, 'triangle'); break;
    case 'pickup': tone(700, 1200, 0.12, 0.06, 'triangle'); break;
    case 'level': tone(500, 1000, 0.35, 0.08, 'triangle'); break;
    case 'empty': tone(200, 180, 0.05, 0.05); break;
    case 'spit': noise(0.2, 0.08, 900, 6); break;
    case 'die': tone(260, 60, 0.3, 0.07, 'sawtooth'); break;
  }
}

/* ==========================================================================
   Weapons
   ========================================================================== */
const WEAPONS = [
  { id: 'pistol', zoom: 1.2, adsSpread: 0.4, key: '1', name: 'Pistol', dmg: 26, rate: 4.5, auto: false, mag: 12, reserve: Infinity, reload: 1.1, spread: 0.006, pellets: 1, price: 0, kick: 0.04, desc: 'Reliable sidearm. Infinite reserve ammo.' },
  { id: 'smg', zoom: 1.2, adsSpread: 0.55, key: '2', name: 'SMG', dmg: 15, rate: 11, auto: true, mag: 32, reserve: 192, reload: 1.6, spread: 0.028, pellets: 1, price: 450, kick: 0.02, desc: 'High fire rate. Shreds crawlers.' },
  { id: 'shotgun', zoom: 1.1, adsSpread: 0.75, key: '3', name: 'Shotgun', dmg: 14, rate: 1.25, auto: false, mag: 6, reserve: 42, reload: 2.1, spread: 0.07, pellets: 9, price: 700, kick: 0.12, desc: 'Nine pellets. Devastating up close.' },
  { id: 'rifle', zoom: 1.8, adsSpread: 0.2, key: '4', name: 'Battle Rifle', dmg: 50, rate: 5.5, auto: true, mag: 24, reserve: 144, reload: 1.9, spread: 0.01, pellets: 1, price: 1150, kick: 0.05, desc: 'Accurate and heavy. Great for headshots.' },
  { id: 'plasma', zoom: 1.3, adsSpread: 0.5, key: '5', name: 'Plasma Launcher', dmg: 150, rate: 1.3, auto: false, mag: 4, reserve: 20, reload: 2.4, spread: 0, pellets: 1, price: 1800, kick: 0.14, projectile: true, splash: 4.5, desc: 'Explosive plasma bolts. Watch your distance.' },
];
const WMAP = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));

// first-person viewmodels made from primitives
const vmRoot = new THREE.Group(); camera.add(vmRoot);
vmRoot.position.set(0.26, -0.24, -0.5);
const gunMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.45, metalness: 0.6 });
const gunMat2 = new THREE.MeshStandardMaterial({ color: 0x4b463f, roughness: 0.7 });
const glowMat = new THREE.MeshBasicMaterial({ color: 0x6fe3ff });
function bx(w, h, d, m, x, y, z) { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); return o; }
const VIEW = {
  pistol: () => [bx(0.07, 0.09, 0.3, gunMat, 0, 0, -0.05), bx(0.06, 0.14, 0.08, gunMat2, 0, -0.1, 0.05)],
  smg: () => [bx(0.08, 0.1, 0.42, gunMat, 0, 0, -0.08), bx(0.05, 0.16, 0.06, gunMat2, 0, -0.12, -0.06), bx(0.06, 0.12, 0.08, gunMat2, 0, -0.1, 0.1), bx(0.03, 0.03, 0.12, gunMat, 0, 0.01, -0.34)],
  shotgun: () => [bx(0.09, 0.09, 0.62, gunMat, 0, 0, -0.16), bx(0.07, 0.07, 0.4, gunMat2, 0, -0.08, -0.2), bx(0.07, 0.14, 0.2, gunMat2, 0, -0.06, 0.18)],
  rifle: () => [bx(0.08, 0.11, 0.7, gunMat, 0, 0, -0.2), bx(0.05, 0.17, 0.07, gunMat2, 0, -0.13, -0.12), bx(0.07, 0.13, 0.22, gunMat2, 0, -0.03, 0.2), bx(0.04, 0.05, 0.16, gunMat, 0, 0.09, -0.1)],
  plasma: () => [bx(0.14, 0.14, 0.62, gunMat, 0, 0, -0.14), bx(0.1, 0.05, 0.4, glowMat, 0, 0.08, -0.14), bx(0.07, 0.15, 0.08, gunMat2, 0, -0.13, 0.04)],
};
const viewModels = {};
WEAPONS.forEach((w) => { const g = new THREE.Group(); VIEW[w.id]().forEach((m) => g.add(m)); g.visible = false; vmRoot.add(g); viewModels[w.id] = g; });
const muzzle = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
vmRoot.add(muzzle);
const MUZZLE_Z = { pistol: -0.24, smg: -0.42, shotgun: -0.5, rifle: -0.58, plasma: -0.48 };

/* ==========================================================================
   Aliens: five kinds plus a boss
   ========================================================================== */
const TYPES = {
  crawler: { name: 'Crawler', color: 0x7fbf6a, hp: 40, speed: 6.6, r: 0.55, h: 0.75, head: [0.55, 0.62, 0.26], dmg: 8, reach: 1.5, cd: 0.8, credits: 10, xp: 10, desc: 'An insect-hound. Fast and low, and arrives in swarms.' },
  spitter: { name: 'Spitter', color: 0x9a6fd0, hp: 75, speed: 3.6, r: 0.6, h: 2.0, head: [1.72, 0.5, 0.32], dmg: 6, reach: 1.6, cd: 1, credits: 16, xp: 16, desc: 'A toad with an acid sac. Hangs back and spits, so break its line of sight.' },
  leaper: { name: 'Leaper', color: 0x4fb8b0, hp: 65, speed: 5, r: 0.5, h: 1.9, head: [1.68, 0.55, 0.26], dmg: 14, reach: 1.5, cd: 0.9, credits: 18, xp: 18, desc: 'A raptor. Jumps over cover and lands on you.' },
  brute: { name: 'Brute', color: 0xa8492f, hp: 340, speed: 2.5, r: 1.05, h: 2.9, head: [2.15, 0.85, 0.4], dmg: 24, reach: 2.2, cd: 1.3, credits: 45, xp: 45, desc: 'An armoured ape-rhino. Charges when it sees you.' },
  phantom: { name: 'Phantom', color: 0xb9c8ff, hp: 90, speed: 5.4, r: 0.55, h: 1.95, head: [1.55, 0, 0.45], dmg: 12, reach: 1.5, cd: 0.8, credits: 28, xp: 28, desc: 'A drifting jellyfish wraith. Fades out and blinks away when shot.' },
  queen: { name: 'Hive Queen', color: 0xc2552d, hp: 2600, speed: 2.1, r: 1.9, h: 4.4, head: [3.75, 1.35, 0.7], dmg: 30, reach: 3, cd: 1.4, credits: 400, xp: 300, boss: true, desc: 'Every fifth wave.' },
};
const geo = {
  sphere: new THREE.SphereGeometry(1, 18, 14), box: new THREE.BoxGeometry(1, 1, 1), cyl: new THREE.CylinderGeometry(1, 1, 1, 10), cone: new THREE.ConeGeometry(1, 1, 12),
  cap: new THREE.CapsuleGeometry(0.5, 1, 4, 10), eye: new THREE.SphereGeometry(1, 12, 10),
};
const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffe14d });
const pupilMat = new THREE.MeshBasicMaterial({ color: 0x0a0a0a });
const toothMat = new THREE.MeshStandardMaterial({ color: 0xe8e0c8, roughness: 0.4 });
function part(g, mat, sx, sy, sz, x, y, z) { const m = new THREE.Mesh(g, mat); m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.castShadow = true; return m; }

// mottled skin texture per species (spots, stripes, lighter belly)
const skinTex = {};
function skin(kind, color) {
  if (skinTex[kind]) return skinTex[kind];
  const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d');
  const base = new THREE.Color(color), dark = base.clone().multiplyScalar(0.45), light = base.clone().lerp(new THREE.Color(0xf2e8d0), 0.45);
  const grd = g.createLinearGradient(0, 0, 0, 128); grd.addColorStop(0, '#' + dark.getHexString()); grd.addColorStop(0.45, '#' + base.getHexString()); grd.addColorStop(1, '#' + light.getHexString());
  g.fillStyle = grd; g.fillRect(0, 0, 256, 128);
  g.fillStyle = 'rgba(0,0,0,.28)';
  if (kind === 'crawler' || kind === 'queen') for (let x = 0; x < 256; x += 22) g.fillRect(x, 0, 8, 128);
  else for (let i = 0; i < 70; i++) { g.beginPath(); g.arc(Math.random() * 256, Math.random() * 80, 2 + Math.random() * 7, 0, Math.PI * 2); g.fill(); }
  for (let i = 0; i < 1600; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${Math.random() * 0.06})`; g.fillRect(Math.random() * 256, Math.random() * 128, 2, 2); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return (skinTex[kind] = t);
}

/* jointed limb: root (stride) > splay (fixed pose) > upper segment > knee > lower segment > claw */
function limb(parent, mat, o) {
  const root = new THREE.Group(); root.position.set(...o.pos); parent.add(root);
  const splay = new THREE.Group(); splay.rotation.set(...(o.splay || [0, 0, 0])); root.add(splay);
  const r = o.r || 0.06;
  const up = new THREE.Mesh(geo.cap, mat); up.scale.set(r * 2, o.l1 / 2, r * 2); up.position.y = -o.l1 / 2; up.castShadow = true; splay.add(up);
  const knee = new THREE.Group(); knee.position.y = -o.l1; knee.rotation.set(...(o.knee || [0, 0, 0])); splay.add(knee);
  const lo = new THREE.Mesh(geo.cap, mat); lo.scale.set(r * 1.6, o.l2 / 2, r * 1.6); lo.position.y = -o.l2 / 2; lo.castShadow = true; knee.add(lo);
  if (o.claw) { const c = new THREE.Mesh(geo.cone, o.clawMat || toothMat); const ch = Math.min(r * 4, 0.22); c.scale.set(Math.min(r * 1.6, 0.08), ch, Math.min(r * 1.6, 0.08)); c.position.y = -o.l2 - ch * 0.3; c.rotation.x = Math.PI; knee.add(c); }
  if (o.fist) { const f = new THREE.Mesh(geo.sphere, mat); f.scale.setScalar(r * 1.9); f.position.y = -o.l2; knee.add(f); }
  return { root, knee, kneeBase: knee.rotation[o.kneeAxis || 'x'], axis: o.axis || 'x', kneeAxis: o.kneeAxis || 'x', phase: o.phase || 0, amp: o.amp ?? 0.5, kneeAmp: o.kneeAmp ?? 0.5, kneeSign: o.kneeSign || 1 };
}
function eyes(g, y, z, spread, s, n = 2) {
  for (let i = 0; i < n; i++) {
    const sx = n === 2 ? (i ? 1 : -1) : (i % 2 ? 1 : -1) * (i < 2 ? 1 : 0.55), yy = y + (n > 2 && i >= 2 ? s * 1.6 : 0);
    const e = part(geo.eye, eyeMat, s, s, s, sx * spread, yy, z); e.castShadow = false; g.add(e);
    const p = part(geo.eye, pupilMat, s * 0.45, s * 0.8, s * 0.45, sx * spread, yy, z + s * 0.75); p.castShadow = false; g.add(p);
  }
}
function chain(parent, mat, n, start, seg, r0, dir = [0, 0, -1]) {
  const segs = []; let p = parent;
  for (let i = 0; i < n; i++) {
    const g = new THREE.Group(); g.position.set(...(i ? dir.map((d) => d * seg) : start)); p.add(g);
    const r = r0 * (1 - i / (n + 1));
    const L = seg * 0.7, sc = dir.map((d) => r + Math.min(1, Math.abs(d)) * (L - r));
    const m = part(geo.sphere, mat, sc[0], sc[1], sc[2], dir[0] * seg / 2, dir[1] * seg / 2, dir[2] * seg / 2); g.add(m);
    segs.push(g); p = g;
  }
  return segs;
}

function buildAlien(kind) {
  const T = TYPES[kind];
  const mat = new THREE.MeshStandardMaterial({ map: skin(kind, T.color), roughness: 0.55, metalness: 0.05, emissive: 0x000000 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(T.color).multiplyScalar(0.4), roughness: 0.7 });
  const g = new THREE.Group(); const body = new THREE.Group(); g.add(body);
  const U = { mat, legs: [], tail: [], tentacles: [], body, jaw: null, sac: null };
  if (kind === 'crawler') {
    body.add(part(geo.sphere, mat, 0.36, 0.28, 0.42, 0, 0.5, 0.12));
    const abd = part(geo.sphere, mat, 0.44, 0.34, 0.62, 0, 0.58, -0.55); abd.rotation.x = 0.25; body.add(abd);
    const head = new THREE.Group(); head.position.set(0, 0.56, 0.58); body.add(head);
    head.add(part(geo.sphere, mat, 0.25, 0.2, 0.28, 0, 0, 0)); eyes(head, 0.08, 0.2, 0.09, 0.045, 4);
    const jaw = new THREE.Group(); jaw.position.set(0, -0.06, 0.2); head.add(jaw);
    [-1, 1].forEach((s) => { const m = part(geo.cone, toothMat, 0.05, 0.3, 0.05, s * 0.09, 0, 0.12); m.rotation.set(Math.PI / 2, 0, -s * 0.5); jaw.add(m); });
    U.jaw = jaw; U.jawAxis = 'y';
    [-1, 1].forEach((s) => { const a = part(geo.cyl, dark, 0.012, 0.5, 0.012, s * 0.1, 0.3, 0.12); a.rotation.set(0.9, 0, -s * 0.4); head.add(a); });
    [0.38, 0.12, -0.14].forEach((z, i) => [-1, 1].forEach((s) => U.legs.push(limb(body, dark, {
      pos: [s * 0.3, 0.5, z], splay: [0, 0, s * 2.0], l1: 0.5, l2: 0.8, r: 0.045, knee: [0, 0, -s * 1.75], kneeAxis: 'z', kneeSign: -s, axis: 'y', claw: true,
      phase: ((i + (s > 0 ? 1 : 0)) % 2) * Math.PI, amp: 0.45, kneeAmp: 0.35 }))));
  } else if (kind === 'spitter') {
    body.add(part(geo.sphere, mat, 0.62, 0.5, 0.78, 0, 0.95, -0.05));
    const sac = part(geo.sphere, new THREE.MeshStandardMaterial({ color: 0xd6ff5a, emissive: 0x6b8a10, roughness: 0.25, transparent: true, opacity: 0.9 }), 0.4, 0.42, 0.4, 0, 1.38, -0.42); body.add(sac);
    const neck = part(geo.cap, mat, 0.36, 0.6, 0.36, 0, 1.35, 0.42); neck.rotation.x = 0.7; body.add(neck);
    const head = new THREE.Group(); head.position.set(0, 1.68, 0.55); body.add(head);
    head.add(part(geo.sphere, mat, 0.36, 0.2, 0.36, 0, 0, 0));
    [-1, 1].forEach((s) => { head.add(part(geo.sphere, mat, 0.12, 0.12, 0.12, s * 0.2, 0.14, 0.05)); });
    eyes(head, 0.17, 0.12, 0.2, 0.075);
    const jaw = new THREE.Group(); jaw.position.set(0, -0.08, 0.05); head.add(jaw);
    jaw.add(part(geo.sphere, mat, 0.32, 0.08, 0.3, 0, -0.03, 0.05));
    const throat = part(geo.sphere, new THREE.MeshStandardMaterial({ color: 0xc8f04a, emissive: 0x4a6a08, roughness: 0.3 }), 0.22, 0.18, 0.2, 0, -0.18, -0.02); head.add(throat);
    U.jaw = jaw; U.jawAxis = 'x'; U.sac = throat;
    [[0.5, 0.35], [-0.5, -0.45]].forEach(([z, kb], f) => [-1, 1].forEach((s) => U.legs.push(limb(body, dark, {
      pos: [s * 0.45, 0.85, z], splay: [f ? 0.6 : -0.2, 0, s * 0.35], l1: f ? 0.55 : 0.45, l2: f ? 0.7 : 0.6, r: f ? 0.09 : 0.07, knee: [f ? -1.6 : 0.5, 0, 0],
      kneeSign: f ? -1 : 1, claw: true, phase: (f + (s > 0 ? 1 : 0)) % 2 * Math.PI, amp: 0.35, kneeAmp: 0.3 }))));
    U.tail = chain(body, mat, 3, [0, 0.8, -0.8], 0.28, 0.16, [0, -0.25, -1]);
  } else if (kind === 'leaper') {
    const torso = part(geo.cap, mat, 0.5, 0.75, 0.42, 0, 1.25, 0.05); torso.rotation.x = 1.05; body.add(torso);
    const neck = part(geo.cap, mat, 0.22, 0.4, 0.22, 0, 1.52, 0.38); neck.rotation.x = 0.5; body.add(neck);
    const head = new THREE.Group(); head.position.set(0, 1.68, 0.55); body.add(head);
    head.add(part(geo.sphere, mat, 0.17, 0.17, 0.36, 0, 0, 0.08)); eyes(head, 0.08, 0.12, 0.11, 0.045);
    const jaw = new THREE.Group(); jaw.position.set(0, -0.08, 0.02); head.add(jaw);
    jaw.add(part(geo.sphere, dark, 0.13, 0.06, 0.32, 0, 0, 0.12));
    for (let i = 0; i < 4; i++) jaw.add(part(geo.cone, toothMat, 0.02, 0.06, 0.02, (i % 2 ? 1 : -1) * 0.06, 0.06, 0.15 + i * 0.05));
    U.jaw = jaw; U.jawAxis = 'x';
    [-1, 1].forEach((s) => {
      U.legs.push(limb(body, dark, { pos: [s * 0.2, 1.05, -0.1], splay: [-0.7, 0, s * 0.06], l1: 0.62, l2: 0.72, r: 0.08, knee: [1.45, 0, 0], kneeSign: 1, claw: true, phase: s > 0 ? 0 : Math.PI, amp: 0.55, kneeAmp: 0.4 }));
      const arm = limb(body, dark, { pos: [s * 0.22, 1.38, 0.32], splay: [-0.9, 0, s * 0.2], l1: 0.25, l2: 0.25, r: 0.035, knee: [-1.1, 0, 0], claw: true, amp: 0.15, kneeAmp: 0.1 });
      U.legs.push(arm);
    });
    U.tail = chain(body, mat, 5, [0, 1.12, -0.4], 0.32, 0.17, [0, 0.12, -1]);
  } else if (kind === 'brute') {
    body.add(part(geo.sphere, mat, 0.95, 0.85, 0.75, 0, 1.95, 0.1));
    body.add(part(geo.sphere, dark, 0.7, 0.55, 0.6, 0, 2.45, -0.2));
    body.add(part(geo.sphere, mat, 0.7, 0.6, 0.55, 0, 1.25, -0.25));
    for (let i = 0; i < 4; i++) { const pl = part(geo.cone, toothMat, 0.14, 0.4, 0.14, 0, 2.75 - i * 0.05, -0.5 + i * 0.28); pl.rotation.x = -0.5; body.add(pl); }
    const head = new THREE.Group(); head.position.set(0, 2.15, 0.85); body.add(head);
    head.add(part(geo.sphere, mat, 0.36, 0.3, 0.38, 0, 0, 0)); eyes(head, 0.1, 0.3, 0.15, 0.05);
    const horn = part(geo.cone, toothMat, 0.12, 0.45, 0.12, 0, 0.2, 0.32); horn.rotation.x = 0.7; head.add(horn);
    const jaw = new THREE.Group(); jaw.position.set(0, -0.15, 0.05); head.add(jaw);
    jaw.add(part(geo.sphere, dark, 0.3, 0.12, 0.3, 0, -0.04, 0.08));
    [-1, 1].forEach((s) => { const t = part(geo.cone, toothMat, 0.05, 0.22, 0.05, s * 0.2, 0.08, 0.25); t.rotation.x = -0.3; jaw.add(t); });
    U.jaw = jaw; U.jawAxis = 'x';
    [-1, 1].forEach((s) => {
      U.legs.push(limb(body, mat, { pos: [s * 0.95, 2.3, 0.3], splay: [-0.35, 0, s * 0.28], l1: 1.0, l2: 1.05, r: 0.2, knee: [-0.35, 0, 0], kneeSign: -1, fist: true, phase: s > 0 ? Math.PI : 0, amp: 0.5, kneeAmp: 0.25 }));
      U.legs.push(limb(body, dark, { pos: [s * 0.45, 1.1, -0.3], splay: [0.1, 0, 0], l1: 0.55, l2: 0.55, r: 0.2, knee: [0.15, 0, 0], claw: true, phase: s > 0 ? 0 : Math.PI, amp: 0.4, kneeAmp: 0.3 }));
    });
  } else if (kind === 'phantom') {
    mat.transparent = true; mat.opacity = 0.6; mat.emissive.setHex(0x22305a); mat.depthWrite = false;
    const bell = part(new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), mat, 0.6, 0.55, 0.6, 0, 1.45, 0); body.add(bell);
    const core = part(geo.sphere, new THREE.MeshBasicMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.8 }), 0.2, 0.2, 0.2, 0, 1.55, 0); body.add(core);
    eyes(body, 1.6, 0.48, 0.16, 0.06);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2, x = Math.cos(a) * 0.4, z = Math.sin(a) * 0.4;
      const seg = chain(body, mat, 4, [x, 1.4, z], 0.28, 0.06, [0, -1, 0]);
      U.tentacles.push({ seg, a });
    }
    U.core = core;
  } else {
    // Hive Queen: mantis-scorpion
    const abd = chain(body, mat, 4, [0, 1.5, -0.5], 0.9, 1.0, [0, 0.05, -1]); U.tail = abd;
    const thorax = part(geo.cap, mat, 0.9, 1.6, 0.8, 0, 2.6, 0.6); thorax.rotation.x = 0.55; body.add(thorax);
    const head = new THREE.Group(); head.position.set(0, 3.75, 1.35); body.add(head);
    head.add(part(geo.sphere, mat, 0.6, 0.45, 0.6, 0, 0, 0)); eyes(head, 0.15, 0.45, 0.3, 0.1, 4);
    const crest = part(geo.cone, dark, 0.25, 0.9, 0.25, 0, 0.6, -0.2); crest.rotation.x = -0.6; head.add(crest);
    const jaw = new THREE.Group(); jaw.position.set(0, -0.2, 0.45); head.add(jaw);
    [-1, 1].forEach((s) => { const m = part(geo.cone, toothMat, 0.12, 0.7, 0.12, s * 0.25, 0, 0.25); m.rotation.set(Math.PI / 2, 0, -s * 0.5); jaw.add(m); });
    U.jaw = jaw; U.jawAxis = 'y';
    [-1, 1].forEach((s) => U.legs.push(limb(body, dark, { pos: [s * 0.55, 3.1, 1.1], splay: [-1.2, 0, s * 0.3], l1: 1.2, l2: 1.3, r: 0.12, knee: [-2.2, 0, 0], claw: true, amp: 0.35, kneeAmp: 0.6, phase: s > 0 ? 0 : Math.PI })));
    [0.4, -0.3, -1.0].forEach((z, i) => [-1, 1].forEach((s) => U.legs.push(limb(body, dark, {
      pos: [s * 0.6, 1.7, z], splay: [0, 0, s * 1.9], l1: 1.4, l2: 2.2, r: 0.1, knee: [0, 0, -s * 1.6], kneeAxis: 'z', kneeSign: -s, axis: 'y', claw: true,
      phase: ((i + (s > 0 ? 1 : 0)) % 2) * Math.PI, amp: 0.3, kneeAmp: 0.25 }))));
    const sting = part(geo.cone, toothMat, 0.25, 0.9, 0.25, 0, 0.3, -0.6); sting.rotation.x = -2.2; abd[abd.length - 1].add(sting);
  }
  g.traverse((o) => { if (o.isMesh && o.material !== eyeMat && o.material !== pupilMat) o.castShadow = true; });
  g.userData = U;
  return g;
}

function animateAlien(a, dt, moving) {
  const U = a.mesh.userData, t = a.t, sp = a.T.speed * a.speedMul;
  const freq = (a.chargeT > 0 ? 3 : 1) * (1.2 + sp * 0.9);
  const gait = t * freq, m = moving ? 1 : 0.15;
  for (const L of U.legs) {
    const ph = gait + L.phase;
    L.root.rotation[L.axis] = Math.sin(ph) * L.amp * m;
    L.knee.rotation[L.kneeAxis] = L.kneeBase + Math.max(0, Math.cos(ph)) * L.kneeAmp * L.kneeSign * m;
  }
  U.tail.forEach((s, i) => { s.rotation.y = Math.sin(t * 2.2 - i * 0.7) * (a.kind === 'queen' ? 0.08 : 0.28); s.rotation.x = a.kind === 'queen' && i > 0 ? -0.35 + Math.sin(t * 1.5) * 0.05 : 0; });
  U.tentacles.forEach((tn, k) => tn.seg.forEach((s, i) => { s.rotation.x = Math.sin(t * 3 + k + i * 0.8) * 0.35; s.rotation.z = Math.cos(t * 2.4 + k * 1.3 + i) * 0.3; }));
  if (U.jaw) {
    const near = Math.hypot(P.pos.x - a.pos.x, P.pos.z - a.pos.z) < a.T.reach + 2.5;
    const open = (near ? 0.35 + 0.25 * Math.max(0, Math.sin(t * 9)) : 0.06 + 0.05 * Math.sin(t * 2));
    if (U.jawAxis === 'y') U.jaw.children.forEach((c, i) => (c.rotation.y = (i % 2 ? -1 : 1) * open)); else U.jaw.rotation.x = open;
  }
  if (U.sac) U.sac.scale.setScalar(0.2 * (1 + (a.spitCd < 0.6 ? (0.6 - a.spitCd) * 0.9 : 0.05 * Math.sin(t * 3))));
  const breathe = 1 + Math.sin(t * 2.4) * 0.025;
  U.body.scale.set(1, breathe, 1);
  if (a.kind === 'phantom') { U.body.position.y = 0.25 + Math.sin(t * 1.6) * 0.18; U.core.material.opacity = 0.5 + 0.4 * Math.abs(Math.sin(t * 4)); }
  else if (a.kind === 'brute' && a.chargeT > 0) U.body.rotation.x = 0.25;
  else U.body.rotation.x *= 0.9;
  if (a.kind === 'crawler' || a.kind === 'leaper') U.body.position.y = Math.abs(Math.sin(gait)) * 0.05 * m;
}

const aliens = [];
const spits = [];
const bolts = []; // player plasma + grenades
const pickups = [];
const turrets = [];
const barricades = [];

/* ==========================================================================
   Player & progression
   ========================================================================== */
const P = {};
const stats = {};
function resetPlayer() {
  Object.assign(P, {
    pos: new THREE.Vector3(0, 0, 12), vy: 0, yaw: Math.PI, pitch: 0, onGround: true,
    hp: 100, armor: 0, lastHurt: 0, credits: 0, xp: 0, level: 1, kills: 0, shots: 0, hits: 0, score: 0,
    owned: new Set(['pistol']), ammo: { pistol: { mag: 12, res: Infinity } }, cur: 'pistol', prev: 'pistol',
    reloading: 0, fireCd: 0, trigger: false, triggerEdge: false, adsT: 0, st: ST.createStance(), jumpReq: false, tier: { pistol: 2 }, boosts: {}, grenades: 2, barricadesInv: 1, turretsInv: 0,
    bob: 0, recoil: 0, shake: 0,
  });
  Object.assign(stats, { maxHp: 100, dmg: 1, rate: 1, reload: 1, speed: 1, drop: 1, credit: 1, regen: 0, mag: 1, head: 2, perks: [] });
}
const xpNeed = (l) => Math.round(70 * Math.pow(l, 1.35));

const PERKS = [
  { id: 'dmg', name: 'Hollow points', text: '+15% weapon damage.', apply: () => (stats.dmg *= 1.15) },
  { id: 'rate', name: 'Trigger discipline', text: '+12% fire rate.', apply: () => (stats.rate *= 1.12) },
  { id: 'reload', name: 'Quick hands', text: 'Reload 25% faster.', apply: () => (stats.reload *= 0.75) },
  { id: 'hp', name: 'Thick skin', text: '+25 max HP and heal 25.', apply: () => { stats.maxHp += 25; P.hp = Math.min(stats.maxHp, P.hp + 25); } },
  { id: 'speed', name: 'Fleet foot', text: '+10% movement speed.', apply: () => (stats.speed *= 1.1) },
  { id: 'drop', name: 'Scavenger', text: 'Aliens drop supplies 40% more often.', apply: () => (stats.drop *= 1.4) },
  { id: 'credit', name: 'Bounty hunter', text: '+25% credits per kill.', apply: () => (stats.credit *= 1.25) },
  { id: 'regen', name: 'Field medic', text: 'Regenerate 2 HP/s after 4s without damage.', apply: () => (stats.regen += 2) },
  { id: 'mag', name: 'Deep pockets', text: '+30% magazine size.', apply: () => { stats.mag *= 1.3; } },
  { id: 'head', name: 'Marksman', text: 'Headshots deal +50% more.', apply: () => (stats.head += 0.5) },
  { id: 'nade', name: 'Demolitions', text: '+2 grenades and +25% explosion damage.', apply: () => { P.grenades += 2; stats.boom = (stats.boom || 1) * 1.25; } },
];

const SHOP_ITEMS = [
  { id: 'med', name: 'Medkit', price: 100, desc: '+50 HP.', can: () => P.hp < stats.maxHp, buy: () => (P.hp = Math.min(stats.maxHp, P.hp + 50)) },
  { id: 'armor', name: 'Armour plate', price: 160, desc: '+50 armour (max 100). Absorbs 60% of damage.', can: () => P.armor < 100, buy: () => (P.armor = Math.min(100, P.armor + 50)) },
  { id: 'ammo', name: 'Ammo crate', price: 90, desc: 'Refill reserve ammo for every weapon you own.', can: () => [...P.owned].some((w) => P.ammo[w].res < WMAP[w].reserve), buy: () => P.owned.forEach((w) => (P.ammo[w].res = WMAP[w].reserve)) },
  { id: 'nade', name: 'Grenades ×2', price: 120, desc: 'Press G to throw. 5m blast radius.', can: () => true, buy: () => (P.grenades += 2) },
  { id: 'barricade', name: 'Barricade', price: 180, desc: 'Press E to place portable cover in front of you.', can: () => true, buy: () => (P.barricadesInv += 1) },
  { id: 'turret', name: 'Sentry turret', price: 650, desc: 'Press T to deploy. Fires at aliens in sight for 75s.', can: () => true, buy: () => (P.turretsInv += 1) },
];

/* ==========================================================================
   Game state, waves
   ========================================================================== */
const G = { mode: 'menu', wave: 0, phase: 'intermission', timer: 0, toSpawn: [], spawnCd: 0, surgeT: 0, flowT: 0, modal: null, best: store.get('siege-best', 0), time: 0 };
const SPAWNS = [[-46, 0], [46, 0], [0, -46], [0, 46], [-46, -24], [46, 24], [-24, 46], [24, -46], [-46, 30], [46, -28]];

function waveComposition(n) {
  const total = Math.round(6 + n * 4 + Math.pow(n, 1.3));
  const pool = [['crawler', 1]];
  if (n >= 2) pool.push(['spitter', 0.55]);
  if (n >= 3) pool.push(['leaper', 0.5]);
  if (n >= 4) pool.push(['brute', 0.2 + n * 0.015]);
  if (n >= 5) pool.push(['phantom', 0.45]);
  const sum = pool.reduce((s, p) => s + p[1], 0), list = [];
  for (let i = 0; i < total; i++) { let r = Math.random() * sum; for (const [k, w] of pool) { r -= w; if (r <= 0) { list.push(k); break; } } }
  if (n % 5 === 0) for (let i = 0; i < n / 5; i++) list.splice(Math.floor(list.length / 2), 0, 'queen');
  return list;
}
const scale = () => ({ hp: 1 + 0.14 * (G.wave - 1), spd: 1 + Math.min(0.3, 0.018 * (G.wave - 1)), dmg: 1 + 0.06 * (G.wave - 1) });

function startIntermission(first) {
  G.phase = 'intermission'; G.timer = first ? 12 : 16;
  if (!first) {
    const bonus = 60 + G.wave * 15; P.credits += bonus; P.score += G.wave * 250;
    banner(`Wave ${G.wave} cleared`, `+${bonus} credits · press B for the shop`);
    // supply drops around the map
    for (let i = 0; i < 3; i++) { const p = randomFreeSpot(); spawnPickup(p, ['health', 'ammo', 'credits', 'grenade'][i % 4]); }
  } else banner('Hold the block', 'First wave in 12 seconds · B opens the shop');
}
function startWave() {
  G.wave += 1; G.phase = 'combat'; G.toSpawn = waveComposition(G.wave); G.spawnCd = 0.5; directorReset();
  banner(`Wave ${G.wave}`, G.wave % 5 === 0 ? 'The Hive Queen is coming' : `${G.toSpawn.length} hostiles inbound`);
  if (G.modal === 'shop') closeShop();
}
function randomFreeSpot() {
  for (let k = 0; k < 200; k++) {
    const x = rand(-40, 40), z = rand(-40, 40);
    if (!blocked[cellOf(z) * NAV + cellOf(x)]) return new THREE.Vector3(x, 0, z);
  }
  return new THREE.Vector3(0, 0, 0);
}

function spawnAlien(kind) {
  const T = TYPES[kind], sc = scale();
  let sp, tries = 0;
  do { const s = SPAWNS[Math.floor(Math.random() * SPAWNS.length)]; sp = new THREE.Vector3(s[0] + rand(-2, 2), 0, s[1] + rand(-2, 2)); tries++; }
  while ((sp.distanceTo(P.pos) < 18 || blocked[cellOf(sp.z) * NAV + cellOf(sp.x)]) && tries < 30);
  const mesh = buildAlien(kind); mesh.position.copy(sp); scene.add(mesh);
  const hp = T.hp * sc.hp * (T.boss ? 1 + 0.25 * (G.wave / 5 - 1) : 1);
  aliens.push({ kind, T, mesh, pos: mesh.position, vy: 0, hp, maxHp: hp, cd: rand(0, 1), t: rand(0, 10), los: false, losT: rand(0, 0.3),
    airborne: false, vel: new THREE.Vector3(), chargeT: 0, chargeCd: rand(2, 4), spitCd: rand(1, 2.5), leapCd: rand(1, 3), spawnCd: 4, blinkCd: 0,
    flash: 0, dead: false, deathT: 0, speedMul: sc.spd, dmgMul: sc.dmg, yaw: 0, role: T.boss ? 'engage' : 'wait', retreatT: 0, ringOff: rand(0, 6), orbit: Math.random() < 0.5 ? -1 : 1 });
}

/* ---------- player damage / rewards ---------- */
function hurtPlayer(n) {
  if (G.mode !== 'play') return;
  if (P.armor > 0) { const a = Math.min(P.armor, n * 0.6); P.armor -= a; n -= a; }
  P.hp -= n; P.lastHurt = G.time; D.pressure += n / 45; P.shake = Math.min(0.5, P.shake + n * 0.015);
  const v = $('vignette'); v.classList.add('on'); requestAnimationFrame(() => requestAnimationFrame(() => v.classList.remove('on')));
  sfx('hurt');
  if (P.hp <= 0) { P.hp = 0; gameOver(); }
}
function gainXp(n) {
  P.xp += n; P.score += n;
  while (P.xp >= xpNeed(P.level)) { P.xp -= xpNeed(P.level); P.level += 1; G.pendingPerks = (G.pendingPerks || 0) + 1; }
  if (G.pendingPerks && !G.modal) openPerks();
}

/* ---------- damaging aliens ---------- */
function damageAlien(a, dmg, point, crit) {
  if (a.dead) return;
  a.hp -= dmg; a.flash = 0.08;
  burst(point, a.T.color, crit ? 14 : 6, 3, 1.5);
  if (a.kind === 'phantom' && a.hp > 0 && a.blinkCd <= 0 && Math.random() < 0.45) blink(a);
  if (a.hp <= 0) killAlien(a);
}
function blink(a) {
  const ang = Math.random() * Math.PI * 2;
  for (let i = 0; i < 8; i++) {
    const nx = a.pos.x + Math.cos(ang + i) * rand(4, 7), nz = a.pos.z + Math.sin(ang + i) * rand(4, 7);
    if (Math.abs(nx) < HALF - 1 && Math.abs(nz) < HALF - 1 && !blocked[cellOf(nz) * NAV + cellOf(nx)]) {
      burst(a.pos.clone().setY(1), 0xcfd8ff, 18, 3); a.pos.set(nx, 0, nz); a.blinkCd = 1.5; return;
    }
  }
}
function killAlien(a) {
  a.dead = true; a.deathT = 0.6;
  P.kills += 1;
  const cr = Math.round(a.T.credits * stats.credit * (boostOn('double') ? 2 : 1)); P.credits += cr;
  gainXp(a.T.xp);
  burst(a.pos.clone().setY(a.T.h * 0.5), a.T.color, a.T.boss ? 120 : 30, a.T.boss ? 8 : 4, 2);
  sfx('die');
  const r = Math.random();
  const ch = 0.18 * stats.drop * (a.T.boss ? 5 : 1);
  if (r < ch) spawnPickup(a.pos.clone(), ['health', 'ammo', 'ammo', 'credits', 'grenade'][Math.floor(Math.random() * 5)]);
  if (a.T.boss) { for (let i = 0; i < 4; i++) spawnPickup(a.pos.clone().add(new THREE.Vector3(rand(-2, 2), 0, rand(-2, 2))), ['health', 'ammo', 'credits', 'credits'][i]); banner('Hive Queen down', `+${cr} credits`); }
}

function explode(p, radius, dmg) {
  sfx('boom');
  boomLight.position.copy(p).setY(1.5); boomLight.intensity = 60;
  burst(p.clone().setY(0.6), 0xff7a3a, 70, 9, 4); burst(p.clone().setY(0.6), 0xffd28a, 30, 5, 3);
  dmg *= stats.boom || 1;
  for (const a of aliens) {
    if (a.dead) continue;
    const d = a.pos.distanceTo(p) - a.T.r;
    if (d < radius) damageAlien(a, dmg * (1 - Math.max(0, d) / radius) ** 0.6, a.pos.clone().setY(1), false);
  }
  const dp = P.pos.distanceTo(p);
  if (dp < radius) hurtPlayer(dmg * 0.25 * (1 - dp / radius));
  P.shake = Math.min(0.6, P.shake + Math.max(0, 0.5 - dp * 0.03));
}

/* ---------- pickups ---------- */
const PICK = {
  health: { color: 0x8fd18a, geo: new THREE.BoxGeometry(0.45, 0.45, 0.45) },
  ammo: { color: 0xffc857, geo: new THREE.BoxGeometry(0.55, 0.35, 0.35) },
  credits: { color: 0xffe14d, geo: new THREE.OctahedronGeometry(0.3) },
  grenade: { color: 0xff7a3a, geo: new THREE.SphereGeometry(0.22, 10, 8) },
};
function spawnPickup(p, kind) {
  const d = PICK[kind];
  const m = new THREE.Mesh(d.geo, new THREE.MeshStandardMaterial({ color: d.color, emissive: d.color, emissiveIntensity: 0.5 }));
  m.position.copy(p).setY(0.6); scene.add(m);
  pickups.push({ kind, mesh: m, life: 30 });
}
function collectPickup(k) {
  if (k.kind === 'weapon') {
    const W = WMAP[k.w];
    if (!P.owned.has(k.w)) { P.owned.add(k.w); P.tier[k.w] = 1; P.ammo[k.w] = { mag: magSize(W), res: Math.round(W.reserve * 0.4) }; equip(k.w); toast(`Field ${W.name}: buy the Mk II in the shop for full power`); }
    else { P.ammo[k.w].res = Math.max(P.ammo[k.w].res, Math.round(W.reserve * 0.6)); toast(`${W.name} ammo`); }
    sfx('pickup'); return;
  }
  if (k.kind === 'bonus') { P.boosts[k.b] = G.time + BONUS[k.b].dur; toast(`${BONUS[k.b].name} for ${BONUS[k.b].dur}s`); sfx('level'); return; }
  const msg = { health: '+30 HP', ammo: 'Ammo', credits: '+40 credits', grenade: '+1 grenade' }[k.kind];
  if (k.kind === 'health') P.hp = Math.min(stats.maxHp, P.hp + 30);
  if (k.kind === 'ammo') P.owned.forEach((w) => { const W = WMAP[w]; if (isFinite(W.reserve)) P.ammo[w].res = Math.min(W.reserve, P.ammo[w].res + Math.ceil(W.reserve * 0.35)); });
  if (k.kind === 'credits') P.credits += 40;
  if (k.kind === 'grenade') P.grenades += 1;
  toast(msg); sfx('pickup');
}

/* ---------- deployables ---------- */
const barricadeMat = new THREE.MeshStandardMaterial({ color: 0x6b6f75, roughness: 0.6, metalness: 0.5 });
function placeBarricade() {
  if (P.barricadesInv <= 0) return toast('No barricades. Buy them in the shop.', true);
  const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
  const alongX = Math.abs(fz) > Math.abs(fx);
  const x = P.pos.x + fx * 2.4, z = P.pos.z + fz * 2.4;
  if (Math.abs(x) > HALF - 2 || Math.abs(z) > HALF - 2) return;
  const b = addBox(x, z, alongX ? 2.8 : 0.5, alongX ? 0.5 : 2.8, 1.35, barricadeMat, { kind: 'barricade' });
  barricades.push(b); P.barricadesInv -= 1;
  rebuildNav(); computeFlow(P.pos.x, P.pos.z);
  toast('Barricade placed'); sfx('reload');
}
function placeTurret() {
  if (P.turretsInv <= 0) return toast('No turrets. Buy one in the shop.', true);
  const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
  const g = new THREE.Group();
  g.add(part(geo.cyl, gunMat2, 0.35, 0.8, 0.35, 0, 0.4, 0));
  const head = new THREE.Group(); head.position.y = 0.95;
  head.add(part(geo.box, gunMat, 0.5, 0.35, 0.6, 0, 0, 0)); head.add(part(geo.box, gunMat, 0.08, 0.08, 0.8, 0, 0.02, -0.6));
  head.add(part(geo.sphere, new THREE.MeshBasicMaterial({ color: 0xff5b1f }), 0.06, 0.06, 0.06, 0, 0.2, 0.1));
  g.add(head); g.position.set(P.pos.x + fx * 1.6, floorAt(P.pos, 0.3, P.pos.y), P.pos.z + fz * 1.6); scene.add(g);
  turrets.push({ g, head, life: 75, cd: 0 }); P.turretsInv -= 1;
  toast('Turret deployed'); sfx('reload');
}
function throwGrenade() {
  if (P.grenades <= 0) return toast('No grenades', true);
  P.grenades -= 1;
  const dir = new THREE.Vector3(0, 0, -1).applyEuler(camera.rotation);
  const m = new THREE.Mesh(geo.sphere, new THREE.MeshStandardMaterial({ color: 0x3a3f2a }));
  m.scale.setScalar(0.12); m.position.copy(camera.position).addScaledVector(dir, 0.6); scene.add(m);
  bolts.push({ kind: 'grenade', mesh: m, vel: dir.multiplyScalar(15).add(new THREE.Vector3(0, 4, 0)), fuse: 1.7 });
}

/* ==========================================================================
   Shooting
   ========================================================================== */
const _o = new THREE.Vector3(), _dir = new THREE.Vector3(), _hit = new THREE.Vector3(), _mz = new THREE.Vector3(), _c1 = new THREE.Vector3(), _c2 = new THREE.Vector3();
function weapon() { return WMAP[P.cur]; }
function zoomNow() { return 1 + ((weapon()?.zoom || 1) - 1) * (P.adsT || 0); }
const tierOf = (id) => P.tier?.[id] ?? 2;
function magSize(w) { return Math.round(w.mag * stats.mag * (tierOf(w.id) === 1 ? 0.8 : 1)); }
const boostOn = (k) => (P.boosts[k] || 0) > G.time;
const dmgMul = (id) => stats.dmg * (tierOf(id) === 1 ? 0.85 : 1) * (boostOn('dmg') ? 1.5 : 1);

function tryFire() {
  const W = weapon(), am = P.ammo[W.id];
  if (P.reloading > 0 || P.fireCd > 0) return;
  P.triggerEdge = false;
  if (am.mag <= 0) { sfx('empty'); startReload(); P.fireCd = 0.25; return; }
  am.mag -= 1; P.fireCd += 1 / (W.rate * stats.rate * (boostOn('rapid') ? 1.4 : 1)); P.shots += 1;
  P.recoil = Math.min(0.3, P.recoil + W.kick);
  sfx(W.id);
  muzzle.material.opacity = 1; muzzle.position.set(0, 0.01, MUZZLE_Z[W.id]); muzzle.rotation.z = Math.random() * 3;
  flashLight.intensity = 6; flashLight.position.copy(camera.position);
  vmRoot.getWorldPosition(_mz); _mz.add(new THREE.Vector3(0, 0.02, MUZZLE_Z[W.id]).applyQuaternion(camera.quaternion));

  camera.getWorldPosition(_o);
  if (W.projectile) {
    _dir.set(0, 0, -1).applyQuaternion(camera.quaternion);
    const m = new THREE.Mesh(geo.sphere, new THREE.MeshBasicMaterial({ color: 0x6fe3ff })); m.scale.setScalar(0.18);
    m.position.copy(_mz); scene.add(m);
    bolts.push({ kind: 'plasma', mesh: m, vel: _dir.clone().multiplyScalar(42), life: 3, dmg: W.dmg * dmgMul(W.id), splash: W.splash });
    return;
  }
  let anyHit = false, anyCrit = false;
  const moving = P.moveAmt > 0.1 ? 1.6 : 1;
  for (let k = 0; k < W.pellets; k++) {
    const s = W.spread * (1 + (W.adsSpread - 1) * P.adsT) * moving * (P.onGround ? 1 : 2) * ST.SPREAD[P.st.s] * (P.st.slideT > 0 ? 1.4 : 1);
    _dir.set(rand(-s, s), rand(-s, s), -1).normalize().applyQuaternion(camera.quaternion);
    const tWall = worldRay(_o, _dir, 140);
    let best = tWall, target = null, crit = false;
    for (const a of aliens) {
      if (a.dead) continue;
      const T = a.T, fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
      _c1.set(a.pos.x + fx * T.head[1], a.pos.y + T.head[0], a.pos.z + fz * T.head[1]);
      const th = raySphere(_o, _dir, _c1, T.head[2] * 1.15);
      if (th < best) { best = th; target = a; crit = true; }
      for (const f of [0.3, 0.62]) {
        _c2.set(a.pos.x, a.pos.y + T.h * f, a.pos.z);
        const tb = raySphere(_o, _dir, _c2, T.r * (T.h < 1 ? 0.85 : 0.95));
        if (tb < best) { best = tb; target = a; crit = false; }
      }
    }
    _hit.copy(_o).addScaledVector(_dir, Math.min(best, 140));
    tracer(_mz, _hit);
    if (target) {
      const d = W.dmg * dmgMul(W.id) * (crit ? stats.head : 1) * (W.id === 'shotgun' ? clamp(1.4 - best / 25, 0.35, 1.2) : 1);
      damageAlien(target, d, _hit, crit); anyHit = true; anyCrit = anyCrit || crit;
    } else if (best < 140) burst(_hit, 0xb8b0a0, 4, 2, 1);
  }
  if (anyHit) { P.hits += 1; hitmark(anyCrit); sfx(anyCrit ? 'crit' : 'hit'); }
}
function startReload() {
  const W = weapon(), am = P.ammo[W.id];
  if (P.reloading > 0 || am.mag >= magSize(W) || am.res <= 0) return;
  P.reloading = W.reload * stats.reload; sfx('reload');
}
function finishReload() {
  const W = weapon(), am = P.ammo[W.id], need = magSize(W) - am.mag;
  const take = Math.min(need, am.res); am.mag += take; if (isFinite(am.res)) am.res -= take;
}
function equip(id) {
  P.adsT = 0;
  if (!P.owned.has(id) || id === P.cur) return;
  P.prev = P.cur; P.cur = id; P.reloading = 0; P.fireCd = 0.3;
  WEAPONS.forEach((w) => (viewModels[w.id].visible = w.id === id));
  vmRoot.position.y = -0.5;
}

/* ==========================================================================
   Input
   ========================================================================== */
let locked = false;
function lock() { try { const r = canvas.requestPointerLock?.(); if (r && r.catch) r.catch(() => {}); } catch {} }
const controls = createControls('siege', [
  ['grenade', 'Throw grenade', ['KeyG']], ['barricade', 'Place barricade', ['KeyE']], ['turret', 'Deploy turret', ['KeyT']],
  ['shop', 'Shop (between waves)', ['KeyB']], ['pause', 'Pause', ['KeyP']],
  ...WEAPONS.map((w, i) => ['w' + (i + 1), w.name, ['Digit' + (i + 1)]]),
], () => G.mode === 'play' && !G.modal);
const touchHeld = new Set();
const held = (a) => controls.isDown(a) || touchHeld.has(a);
function moveInput() {
  let fx = 0, fz = 0;
  if (held('forward')) fz -= 1; if (held('back')) fz += 1; if (held('left')) fx -= 1; if (held('right')) fx += 1;
  fx += touch.mx; fz += touch.mz;
  const l = Math.hypot(fx, fz); if (l > 1) { fx /= l; fz /= l; }
  const sprint = (held('sprint') && fz < 0) || (Math.hypot(touch.mx, touch.mz) > 0.95 && touch.mz < -0.7); // phones: stick fully forward
  return { fx, fz, l: Math.min(1, l), sprint };
}
function stanceAction(act) {
  if (act === 'jump') { if (P.st.s !== ST.STAND) ST.stancePress(P.st, 'jump', {}); else P.jumpReq = true; return; }
  const mv = moveInput(), c = Math.cos(P.yaw), s2 = Math.sin(P.yaw);
  const dx = mv.fx * c + mv.fz * s2, dz = -mv.fx * s2 + mv.fz * c, dl = Math.hypot(dx, dz) || 1;
  ST.stancePress(P.st, act, { sprinting: mv.sprint && P.st.s === ST.STAND, onGround: P.onGround, moving: mv.l, dx: dx / dl, dz: dz / dl, speed: 6.2 * stats.speed * 1.5 });
}
/* Three ways to shoot: Fire (aimed if you are aiming, else from the hip), Hip fire (never aims)
   and Aim + fire (aims while held). Several inputs can hold the trigger at once. */
const fireSrc = new Set();
function fireDown(src, mode) {
  if (mode === 'aim') aim.force(src, true); else if (mode === 'hip') aim.hipHold(src, true);
  fireSrc.add(src); P.trigger = true; P.triggerEdge = true;
}
function fireUp(src) {
  if (aim.forced.has(src)) aim.force(src, false); if (aim.hip.has(src)) aim.hipHold(src, false);
  fireSrc.delete(src); P.trigger = fireSrc.size > 0;
}
function fireClear() { fireSrc.clear(); P.trigger = false; aim.releaseAll(); }
controls.onPress((act, e) => {
  switch (act) {
    case 'reload': startReload(); break;
    case 'swap': equip(P.prev); break;
    case 'grenade': throwGrenade(); break;
    case 'barricade': placeBarricade(); break;
    case 'turret': placeTurret(); break;
    case 'aim': aim.press(e?.timeStamp); break;
    case 'fire': fireDown('kFire'); break;
    case 'hipfire': fireDown('kHip', 'hip'); break;
    case 'aimfire': fireDown('kAimFire', 'aim'); break;
    case 'shop': openShop(); break;
    case 'pause': pause(); break;
    case 'jump': case 'crouch': case 'prone': stanceAction(act); break;
    default: if (/^w\d$/.test(act)) { const w = WEAPONS[Number(act.slice(1)) - 1]; if (w) equip(w.id); }
  }
});
controls.onRelease((act, e) => {
  if (act === 'aim') aim.release(e?.timeStamp);
  if (act === 'fire') fireUp('kFire'); if (act === 'hipfire') fireUp('kHip'); if (act === 'aimfire') fireUp('kAimFire');
});
// keys that work outside normal play
window.addEventListener('keydown', (e) => {
  if (G.mode !== 'play' && e.key === 'Enter' && !G.modal) startGame();
  if (G.modal === 'shop' && controls.matches(e, 'shop')) closeShop();
});
window.addEventListener('blur', () => { touchHeld.clear(); fireClear(); });

canvas.addEventListener('mousedown', (e) => {
  if (G.mode !== 'play' || G.modal || fromTouch()) return;
  if (!locked) lock(); // capture the mouse if allowed, but the click still fires/aims
  if (e.button === 0) fireDown('m0');
  if (e.button === 1) { e.preventDefault(); fireDown('m1', 'aim'); } // middle click: aim and fire
  if (e.button === 2) aim.press(e.timeStamp);
});
window.addEventListener('mouseup', (e) => { if (fromTouch()) return; if (e.button === 0) fireUp('m0'); if (e.button === 1) fireUp('m1'); if (e.button === 2) aim.release(e.timeStamp); });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  $('lockHint').hidden = locked || G.mode !== 'play' || !!G.modal || isTouch;
  if (!locked && G.mode === 'play' && !G.modal && !fromTouch()) pause();
});
document.addEventListener('mousemove', (e) => {
  if (G.modal || (!locked && !(G.mode === 'play' && e.target === canvas && !fromTouch()))) return;
  const k = 0.0022 * sens.factor('mouse', P.adsT || 0, zoomNow());
  P.yaw -= e.movementX * k; P.pitch = clamp(P.pitch - e.movementY * k, -1.45, 1.45);
});
canvas.addEventListener('wheel', (e) => {
  if (G.mode !== 'play' || G.modal) return;
  const own = WEAPONS.filter((w) => P.owned.has(w.id)), i = own.findIndex((w) => w.id === P.cur);
  equip(own[(i + (e.deltaY > 0 ? 1 : -1) + own.length) % own.length].id);
}, { passive: true });

/* touch controls */
const touch = { mx: 0, mz: 0, stickId: null, lookId: null, lx: 0, ly: 0 };
if (isTouch) {
  document.body.classList.add('touch-ui');
  $('touch').hidden = false;
  const stick = $('stick'), knob = $('stickKnob');
  stick.addEventListener('pointerdown', (e) => { touch.stickId = e.pointerId; stick.setPointerCapture(e.pointerId); });
  stick.addEventListener('pointermove', (e) => {
    if (e.pointerId !== touch.stickId) return;
    const r = stick.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const l = Math.min(1, Math.hypot(dx, dy) / 50), a = Math.atan2(dy, dx);
    touch.mx = Math.cos(a) * l; touch.mz = Math.sin(a) * l;
    knob.style.transform = `translate(${touch.mx * 36}px, ${touch.mz * 36}px)`;
  });
  const endStick = (e) => { if (e.pointerId !== touch.stickId) return; touch.stickId = null; touch.mx = touch.mz = 0; knob.style.transform = ''; };
  stick.addEventListener('pointerup', endStick); stick.addEventListener('pointercancel', endStick);
  canvas.addEventListener('pointerdown', (e) => { if (touch.lookId === null) { touch.lookId = e.pointerId; touch.lx = e.clientX; touch.ly = e.clientY; } });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== touch.lookId || G.modal) return;
    const k = 0.005 * sens.factor('touch', P.adsT || 0, zoomNow());
    P.yaw -= (e.clientX - touch.lx) * k; P.pitch = clamp(P.pitch - (e.clientY - touch.ly) * k, -1.4, 1.4);
    touch.lx = e.clientX; touch.ly = e.clientY;
  });
  const endLook = (e) => { if (e.pointerId === touch.lookId) touch.lookId = null; };
  canvas.addEventListener('pointerup', endLook); canvas.addEventListener('pointercancel', endLook);
  const hold = (id, on, off) => { const b = $(id); b.addEventListener('pointerdown', (e) => { e.preventDefault(); on(); }); if (off) { b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('pointerleave', off); } };
  const padLook = (dx, dy) => { const k = 0.005 * sens.factor('touch', P.adsT || 0, zoomNow()); P.yaw -= dx * k; P.pitch = clamp(P.pitch - dy * k, -1.4, 1.4); };
  firePad($('tFire'), { down: () => fireDown('tFire', 'hip'), up: () => fireUp('tFire'), look: padLook });
  firePad($('tAimFire'), { down: () => fireDown('tAimFire', 'aim'), up: () => fireUp('tAimFire'), look: padLook });
  hold('tAds', () => aim.press(), () => aim.release());
  aim.onChange((a) => { $('tAds').setAttribute('aria-pressed', String(a.on)); $('tAimFire').setAttribute('aria-pressed', String(a.forced.has('tAimFire'))); });
  hold('tJump', () => stanceAction('jump'));
  hold('tCrouch', () => stanceAction('crouch'));
  hold('tProne', () => stanceAction('prone'));
  hold('tReload', startReload);
  hold('tSwap', () => { const own = WEAPONS.filter((w) => P.owned.has(w.id)), i = own.findIndex((w) => w.id === P.cur); equip(own[(i + 1) % own.length].id); });
  hold('tGren', throwGrenade);
  hold('tShop', () => (G.modal === 'shop' ? closeShop() : openShop()));
}

/* ---------- gyro aiming (mobile): shared module with invert + sensitivity ---------- */
const gyro = createGyro({
  prefix: 'siege',
  adsT: () => P.adsT || 0,
  isActive: () => G.mode === 'play' && !G.modal,
  onLook: (dyaw, dpitch) => { const z = zoomNow(); P.yaw += dyaw / z; P.pitch = clamp(P.pitch + dpitch / z, -1.4, 1.4); },
  notify: (m) => toast(m, true),
});
const setGyro = (on) => gyro.set(on);
mountAimSettings(aim);
mountSensSettings(sens, isTouch);
const layout = isTouch ? createLayout('siege', ['stick', 'tFire', 'tAimFire', 'tAds', 'tJump', 'tCrouch', 'tProne', 'tReload', 'tSwap', 'tGren', 'tShop', 'tGyro']) : null;
mountControlsPanel({ controls, layout, touch: isTouch, hud: $('hud'), touchBox: $('touch'), extraHtml: '<h3 class="ctl-h">Messages</h3><div class="notify-settings"></div>', onRender: (ov) => mountNotifySettings(notify, ov) });
mountNotifySettings(notify);
if (isTouch) {
  $('mobileOpts').hidden = false; $('pauseMobile').hidden = false;
  mountGyroSettings(gyro);
  gyro.onChange((g) => { $('tGyro').setAttribute('aria-pressed', String(g.on)); $('tGyro').textContent = g.on ? 'Gyro on' : 'Gyro off'; });
  $('tGyro').addEventListener('pointerdown', (e) => { e.preventDefault(); setGyro(!gyro.on); });
} else $('tGyro').hidden = true;

/* ---------- rotate-to-landscape prompt ---------- */
let rotateDismissed = false;
function checkOrientation() {
  const portrait = window.innerHeight > window.innerWidth;
  $('rotateHint').hidden = !(isTouch && portrait && !rotateDismissed);
}
$('rotateDismiss').addEventListener('click', () => { rotateDismissed = true; checkOrientation(); });
window.addEventListener('resize', checkOrientation);
window.addEventListener('orientationchange', () => setTimeout(checkOrientation, 200));
checkOrientation();
async function goLandscape() {
  // Android browsers allow locking orientation in fullscreen; iOS ignores this and keeps the prompt.
  try { if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch {}
  try { await screen.orientation?.lock?.('landscape'); } catch {}
}

/* ==========================================================================
   UI: banner, toast, HUD, shop, perks, pause, game over
   ========================================================================== */
let bannerT = 0, hitT = 0;
function banner(title, sub) { const b = $('banner'); b.innerHTML = `${title}<small>${sub || ''}</small>`; b.classList.add('on'); bannerT = 3; }
function toast(msg, bad) { notify.show(msg, bad ? 'warn' : 'info'); }
function hitmark(crit) { const h = $('hitmark'); h.className = 'hitmark on' + (crit ? ' crit' : ''); hitT = 0.12; }

const radar = document.createElement('canvas'); radar.width = 240; radar.height = 240;
radar.style.cssText = 'position:absolute;left:50%;bottom:16px;width:120px;height:120px;transform:translateX(-50%);opacity:.9';
$('hud').appendChild(radar);
const bossBar = document.createElement('div');
bossBar.style.cssText = 'position:absolute;top:70px;left:50%;transform:translateX(-50%);width:min(420px,60vw);display:none;text-align:center;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#ffb08a';
bossBar.innerHTML = 'Hive Queen<div style="height:6px;background:rgba(255,255,255,.1);margin-top:6px;border-radius:2px;overflow:hidden"><i style="display:block;height:100%;background:#ff5b1f;width:100%"></i></div>';
$('hud').appendChild(bossBar);

function drawRadar() {
  const g = radar.getContext('2d'), R = 120;
  g.clearRect(0, 0, 240, 240);
  g.fillStyle = 'rgba(13,13,12,.6)'; g.beginPath(); g.arc(R, R, R - 2, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.15)'; g.lineWidth = 2; g.stroke();
  g.beginPath(); g.arc(R, R, R / 2, 0, Math.PI * 2); g.stroke();
  const range = 40, cy = Math.cos(P.yaw), sy = Math.sin(P.yaw);
  for (const a of aliens) {
    if (a.dead) continue;
    const dx = a.pos.x - P.pos.x, dz = a.pos.z - P.pos.z;
    const rx = dx * cy - dz * sy, rz = dx * sy + dz * cy; // rotate into view space
    let x = rx / range, y = rz / range; const l = Math.hypot(x, y); if (l > 0.95) { x *= 0.95 / l; y *= 0.95 / l; }
    g.fillStyle = '#' + new THREE.Color(a.T.color).getHexString();
    g.beginPath(); g.arc(R + x * R, R + y * R, a.T.boss ? 9 : 5, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = '#ecebe4'; g.beginPath(); g.moveTo(R, R - 10); g.lineTo(R + 7, R + 8); g.lineTo(R - 7, R + 8); g.closePath(); g.fill();
}

function updateHud() {
  const W = weapon(), am = P.ammo[W.id];
  $('hWave').textContent = Math.max(1, G.wave);
  const alive = aliens.filter((a) => !a.dead).length;
  const boosts = Object.keys(BONUS).filter(boostOn).map((k) => `${BONUS[k].name} ${Math.ceil(P.boosts[k] - G.time)}s`);
  $('hWaveSub').textContent = (G.phase === 'intermission' ? `Next wave in ${Math.ceil(G.timer)}s · ${controls.keysFor('shop')} shop` : `${alive + G.toSpawn.length} remaining${D.phase === 'relax' ? ' · lull' : D.phase === 'peak' ? ' · push' : ''}`) + (boosts.length ? ' · ' + boosts.join(' · ') : '');
  $('hCred').textContent = P.credits.toLocaleString();
  $('hKills').textContent = `${P.kills} kills`;
  $('hHp').style.width = (P.hp / stats.maxHp) * 100 + '%'; $('hHpN').textContent = Math.ceil(P.hp);
  document.querySelector('.bar.hp').classList.toggle('low', P.hp < stats.maxHp * 0.3);
  $('hAr').style.width = P.armor + '%'; $('hArN').textContent = Math.ceil(P.armor);
  $('hLvl').textContent = P.level; $('hXp').style.width = (P.xp / xpNeed(P.level)) * 100 + '%';
  $('hWeapon').textContent = (tierOf(W.id) === 1 ? 'Field ' : '') + W.name + (P.reloading > 0 ? ' · reloading' : '') + (P.st.s ? ' · ' + (P.st.slideT > 0 ? 'Sliding' : ST.NAMES[P.st.s]) : '');
  $('hMag').textContent = am.mag; $('hRes').textContent = '/ ' + (isFinite(am.res) ? am.res : '∞');
  document.querySelector('.ammo').classList.toggle('empty', am.mag === 0);
  $('hSlots').innerHTML = WEAPONS.map((w) => `<i class="${w.id === P.cur ? 'cur' : P.owned.has(w.id) ? 'own' : ''}">${w.key}</i>`).join('');
  $('hGren').textContent = `${P.grenades}`;
  const boss = aliens.find((a) => a.T.boss && !a.dead);
  bossBar.style.display = boss ? 'block' : 'none';
  if (boss) bossBar.querySelector('i').style.width = (boss.hp / boss.maxHp) * 100 + '%';
  $('crosshair').style.setProperty('--g', (6 + P.recoil * 60 + (P.moveAmt > 0.1 ? 4 : 0)) * (1 - 0.6 * P.adsT) + 'px');
  $('crosshair').classList.toggle('ads', P.adsT > 0.6);
  drawRadar();
}

function openModal(name) {
  G.modal = name; controls.clear(); touchHeld.clear(); fireClear();
  if (document.pointerLockElement) document.exitPointerLock();
  $('lockHint').hidden = true;
}
function closeModal() {
  G.modal = null; last = performance.now();
  if (!isTouch && G.mode === 'play') lock();
}

function openShop() {
  if (G.phase !== 'intermission') return toast('The shop opens between waves', true);
  openModal('shop'); renderShop(); $('shopScreen').hidden = false;
}
function closeShop() { $('shopScreen').hidden = true; closeModal(); }
function renderShop() {
  $('sCred').textContent = P.credits.toLocaleString();
  $('shopWeapons').innerHTML = WEAPONS.filter((w) => w.price).map((w) => {
    const own = P.owned.has(w.id), field = own && tierOf(w.id) === 1, cost = field ? Math.round(w.price * 0.6) : w.price;
    const label = own && !field ? 'Mk II owned' : field ? `Upgrade ${cost}` : cost;
    return `<button class="item ${own && !field ? 'owned' : ''}" data-w="${w.id}" ${(own && !field) || P.credits < cost ? 'disabled' : ''}>
      <span class="top"><b>${w.name} Mk II</b><span class="price">${label}</span></span>
      <span class="desc">${w.desc} ${w.pellets > 1 ? w.pellets + '×' : ''}${w.dmg} dmg · ${w.rate}/s · ${w.mag} mag. ${field ? 'Your Field version does 85% damage with a smaller magazine.' : 'Floor drops are Field versions: weaker.'}</span></button>`;
  }).join('');
  $('shopItems').innerHTML = SHOP_ITEMS.map((it) => `<button class="item" data-i="${it.id}" ${P.credits < it.price || !it.can() ? 'disabled' : ''}>
    <span class="top"><b>${it.name}</b><span class="price">${it.price}</span></span><span class="desc">${it.desc}${it.id === 'barricade' ? ` (have ${P.barricadesInv})` : it.id === 'turret' ? ` (have ${P.turretsInv})` : ''}</span></button>`).join('');
}
$('shopWeapons').addEventListener('click', (e) => {
  const b = e.target.closest('[data-w]'); if (!b || b.disabled) return;
  const W = WMAP[b.dataset.w], field = P.owned.has(W.id) && tierOf(W.id) === 1, cost = field ? Math.round(W.price * 0.6) : W.price;
  if (P.credits < cost) return;
  P.credits -= cost; P.owned.add(W.id); P.tier[W.id] = 2; P.ammo[W.id] = { mag: magSize(W), res: W.reserve }; equip(W.id); sfx('pickup'); renderShop();
});
$('shopItems').addEventListener('click', (e) => {
  const b = e.target.closest('[data-i]'); if (!b || b.disabled) return;
  const it = SHOP_ITEMS.find((x) => x.id === b.dataset.i); if (P.credits < it.price || !it.can()) return;
  P.credits -= it.price; it.buy(); sfx('pickup'); renderShop();
});
$('shopClose').addEventListener('click', closeShop);

function openPerks() {
  openModal('perk');
  const pool = [...PERKS].sort(() => Math.random() - 0.5).slice(0, 3);
  $('perkLvl').textContent = P.level - (G.pendingPerks - 1);
  $('perks').innerHTML = pool.map((p, i) => `<button class="perk" data-p="${p.id}"><kbd>${i + 1}</kbd><b>${p.name}</b><span>${p.text}</span></button>`).join('');
  $('perkScreen').hidden = false;
  sfx('level');
  const onKey = (e) => { const i = Number(e.key) - 1; if (i >= 0 && i < 3) { window.removeEventListener('keydown', onKey); choose(pool[i].id); } };
  window.addEventListener('keydown', onKey);
  $('perks').onclick = (e) => { const b = e.target.closest('[data-p]'); if (b) { window.removeEventListener('keydown', onKey); choose(b.dataset.p); } };
  function choose(id) {
    const p = PERKS.find((x) => x.id === id); p.apply(); stats.perks.push(p.name);
    $('perkScreen').hidden = true; G.pendingPerks -= 1;
    if (G.pendingPerks > 0) { G.modal = null; openPerks(); } else closeModal();
  }
}

function pause() {
  if (G.mode !== 'play' || G.modal) return;
  openModal('pause');
  $('pauseStats').textContent = `Wave ${G.wave} · ${P.kills} kills · level ${P.level}${stats.perks.length ? ' · perks: ' + stats.perks.join(', ') : ''}`;
  $('pauseScreen').hidden = false; $('resumeBtn').focus({ preventScroll: true });
}
$('resumeBtn').addEventListener('click', () => { $('pauseScreen').hidden = true; closeModal(); });
$('pauseBtn').addEventListener('click', () => (G.modal === 'pause' ? $('resumeBtn').click() : pause()));
$('restartBtn').addEventListener('click', startGame);
$('restartBtn2').addEventListener('click', () => { $('pauseScreen').hidden = true; G.modal = null; startGame(); });
$('startBtn').addEventListener('click', startGame);

$('bestiary').innerHTML = ['crawler', 'spitter', 'leaper', 'brute', 'phantom'].map((k) => {
  const T = TYPES[k]; return `<div><b><i style="background:#${new THREE.Color(T.color).getHexString()}"></i>${T.name}</b><span>${T.desc}</span></div>`;
}).join('');

function clearWorld() {
  [...aliens, ...pickups].forEach((a) => scene.remove(a.mesh)); aliens.length = 0; pickups.length = 0;
  [...spits, ...bolts].forEach((s) => scene.remove(s.mesh)); spits.length = 0; bolts.length = 0;
  turrets.forEach((t) => scene.remove(t.g)); turrets.length = 0;
  barricades.forEach((b) => { world.remove(b.mesh); boxes.splice(boxes.indexOf(b), 1); }); barricades.length = 0;
  rebuildNav();
}

function startGame() {
  clearWorld(); resetPlayer();
  Object.assign(G, { mode: 'play', wave: 0, toSpawn: [], modal: null, pendingPerks: 0, time: 0, nextDrop: 500 }); directorReset();
  ['startScreen', 'overScreen', 'pauseScreen', 'shopScreen', 'perkScreen'].forEach((id) => ($(id).hidden = true));
  $('hud').hidden = false;
  WEAPONS.forEach((w) => (viewModels[w.id].visible = w.id === 'pistol'));
  computeFlow(P.pos.x, P.pos.z);
  startIntermission(true);
  setTimeout(() => toast(isTouch ? 'Hip fire · Aim · Aim + fire: hold and drag to steer · stick fully forward to sprint' : `Click: fire · Right-click: aim · Middle-click or ${controls.keysFor('aimfire')}: aim + fire · ${controls.keysFor('hipfire')}: hip fire`), 3200);
  audio();
  if (!isTouch) { lock(); $('lockHint').hidden = false; }
  else { goLandscape(); if (gyro.on) setGyro(true); }
  last = performance.now();
}

function gameOver() {
  G.mode = 'over'; G.modal = null;
  if (document.pointerLockElement) document.exitPointerLock();
  const newBest = G.wave > G.best; if (newBest) { G.best = G.wave; store.set('siege-best', G.best); }
  $('overTitle').innerHTML = newBest ? 'New <em>best wave.</em>' : `Overrun on wave ${G.wave}.`;
  $('fWave').textContent = G.wave; $('fKills').textContent = P.kills; $('fLvl').textContent = P.level;
  $('fScore').textContent = (P.score + P.kills * 10).toLocaleString();
  $('fAcc').textContent = P.shots ? Math.round((P.hits / P.shots) * 100) + '%' : '—';
  $('fBest').textContent = G.best;
  setTimeout(() => { $('overScreen').hidden = false; $('lockHint').hidden = true; $('restartBtn').focus(); }, 700);
}

/* ==========================================================================
   Simulation
   ========================================================================== */
const _mv = new THREE.Vector3(), _to = new THREE.Vector3(), _eye = new THREE.Vector3(), _ac = new THREE.Vector3();

function updatePlayer(dt) {
  const mv = moveInput(), fx = mv.fx, fz = mv.fz;
  P.moveAmt = mv.l;
  const sprint = mv.sprint && P.st.s === ST.STAND ? 1.5 : 1;
  const W0 = weapon();
  P.adsT = clamp(P.adsT + (aim.active() && P.reloading <= 0 ? 1 : -1.6) * dt / 0.18, 0, 1);
  const sp = 6.2 * stats.speed * (P.adsT > 0.3 ? 1 : sprint) * (1 - 0.4 * P.adsT) * ST.SPEED[P.st.s];
  const cy = Math.cos(P.yaw), sy = Math.sin(P.yaw);
  const slide = ST.stanceUpdate(P.st, dt);
  if (slide) { P.pos.x += slide.x; P.pos.z += slide.z; P.moveAmt = 1; }
  else { P.pos.x += (fx * cy + fz * sy) * sp * dt; P.pos.z += (-fx * sy + fz * cy) * sp * dt; }
  collide(P.pos, 0.4, P.pos.y);
  // gravity & floors (can stand on crates, cars, barriers)
  const floor = floorAt(P.pos, 0.4, P.pos.y);
  if (P.jumpReq) { P.jumpReq = false; if (P.onGround) { P.vy = 7.6; P.onGround = false; } }
  P.vy -= 22 * dt; P.pos.y += P.vy * dt;
  if (P.pos.y <= floor) { P.pos.y = floor; P.vy = 0; P.onGround = true; } else P.onGround = P.pos.y - floor < 0.02;

  if (stats.regen && G.time - P.lastHurt > 4) P.hp = Math.min(stats.maxHp, P.hp + stats.regen * dt);

  // weapon timers
  P.fireCd = Math.max(-0.04, P.fireCd - dt);
  if (P.reloading > 0) { P.reloading -= dt; if (P.reloading <= 0) finishReload(); }
  for (let n = 0; P.trigger && P.fireCd <= 0 && n < 4; n++) { const before = P.fireCd; tryFire(); if (P.fireCd === before) break; }
  if (P.ammo[P.cur].mag === 0 && P.ammo[P.cur].res > 0 && P.reloading <= 0) startReload();

  // camera
  P.bob += dt * (P.onGround ? P.moveAmt * sp * 1.5 : 0);
  P.recoil = Math.max(0, P.recoil - dt * 0.9);
  P.shake = Math.max(0, P.shake - dt);
  camera.position.set(P.pos.x, P.pos.y + P.st.eye + Math.sin(P.bob) * 0.04 * P.moveAmt, P.pos.z);
  camera.rotation.set(P.pitch + P.recoil * 0.25 + rand(-1, 1) * P.shake * 0.05, P.yaw + rand(-1, 1) * P.shake * 0.05, 0);
  camera.fov = BASE_FOV / (1 + (W0.zoom - 1) * P.adsT); camera.updateProjectionMatrix();
  vmRoot.position.x = 0.26 * (1 - P.adsT) + Math.cos(P.bob * 0.5) * 0.012 * P.moveAmt * (1 - P.adsT);
  vmRoot.position.y += (-0.24 + 0.08 * P.adsT + Math.sin(P.bob) * 0.012 * P.moveAmt * (1 - P.adsT) - vmRoot.position.y) * Math.min(1, dt * 12) - (P.reloading > 0 ? 0.004 : 0);
  vmRoot.position.z = -0.5 + P.recoil * 0.35 + 0.1 * P.adsT;
  vmRoot.rotation.x = P.recoil * 0.8 + (P.reloading > 0 ? -0.5 : 0);
  muzzle.material.opacity = Math.max(0, muzzle.material.opacity - dt * 25);
  flashLight.intensity = Math.max(0, flashLight.intensity - dt * 120);
}

function updateAliens(dt) {
  const sep = _ac;
  _eye.set(P.pos.x, P.pos.y + Math.max(0.35, P.st.eye - 0.2), P.pos.z);
  for (const a of aliens) {
    const T = a.T;
    if (a.dead) {
      a.deathT -= dt; a.mesh.scale.setScalar(Math.max(0.01, a.deathT / 0.6)); a.mesh.position.y -= dt * 0.8;
      continue;
    }
    a.t += dt; a.cd -= dt; a.chargeCd -= dt; a.spitCd -= dt; a.leapCd -= dt; a.blinkCd -= dt; a.spawnCd -= dt;
    a.losT -= dt;
    if (a.losT <= 0) { _to.set(a.pos.x, a.pos.y + T.h * 0.8, a.pos.z); a.los = lineOfSight(_to, _eye); a.losT = 0.2; }
    const dx = P.pos.x - a.pos.x, dz = P.pos.z - a.pos.z, dist = Math.hypot(dx, dz);
    const sp = T.speed * a.speedMul;

    // choose a movement direction
    if (a.los && dist < 30) _mv.set(dx / dist, 0, dz / dist); else flowDir(a.pos.x, a.pos.z, _mv);
    let speed = sp;
    a.retreatT -= dt;
    const engaged = a.role === 'engage' || a.T.boss;
    if (!engaged) {
      // waiting aliens hold a ring around the player instead of all rushing in
      const R = (D.phase === 'relax' ? 22 : 14) + a.ringOff;
      if (dist > R + 2) speed = sp * 0.8;
      else if (dist < R - 2) { _mv.set(-dx / dist, 0, -dz / dist); speed = sp * 0.6; }
      else { _mv.set(-dz / dist * a.orbit, 0, dx / dist * a.orbit); speed = sp * 0.3; }
      if (a.kind === 'phantom') a.mesh.userData.mat.opacity = 0.25 + 0.6 * Math.abs(Math.sin(a.t * 2.3));
    } else

    if (a.kind === 'spitter') {
      if (a.los && dist < 20) {
        speed = dist < 8 ? -sp * 0.8 : dist < 14 ? 0 : sp * 0.5;
        if (a.spitCd <= 0) { spit(a, 1); a.spitCd = rand(1.8, 2.6); a.spits = (a.spits || 0) + 1; if (a.spits >= 3) { a.spits = 0; release(a); } }
      }
    } else if (a.kind === 'brute') {
      if (a.chargeT > 0) { a.chargeT -= dt; speed = sp * 3.6; }
      else if (a.los && dist < 14 && dist > 3 && a.chargeCd <= 0) { a.chargeT = 1.2; a.chargeCd = rand(5, 7); }
    } else if (a.kind === 'leaper' && !a.airborne && dist > 4 && dist < 15 && a.leapCd <= 0) {
      a.airborne = true; a.vy = 10.5; a.leapCd = rand(3, 5); // ~1.05s flight with g = 20
      a.vel.set(dx / 1.05, 0, dz / 1.05);
    } else if (a.kind === 'phantom') {
      a.mesh.userData.mat.opacity = 0.25 + 0.6 * Math.abs(Math.sin(a.t * 2.3));
      _mv.x += Math.cos(a.t * 3) * 0.4; _mv.z += Math.sin(a.t * 3) * 0.4; _mv.normalize();
    } else if (a.kind === 'queen') {
      if (a.los && a.spitCd <= 0 && dist < 30) { spit(a, 5); a.spitCd = rand(2.2, 3); }
      if (a.spawnCd <= 0) { a.spawnCd = rand(6, 9); for (let i = 0; i < 3; i++) { spawnAlien('crawler'); const c = aliens[aliens.length - 1]; c.pos.set(a.pos.x + rand(-2, 2), 0, a.pos.z + rand(-2, 2)); collide(c.pos, c.T.r, 0); } }
    }

    if (a.airborne) {
      a.pos.x += a.vel.x * dt; a.pos.z += a.vel.z * dt;
      a.vy -= 20 * dt; a.pos.y += a.vy * dt;
      if (a.pos.y <= 0) {
        a.pos.y = 0; a.airborne = false;
        if (Math.hypot(P.pos.x - a.pos.x, P.pos.z - a.pos.z) < 2.4 && P.pos.y < 1.5) { hurtPlayer(18 * a.dmgMul); release(a); }
        burst(a.pos.clone().setY(0.2), 0x6fe3e3, 10, 3, 1);
      }
      if (a.pos.y < 2.8) collide(a.pos, T.r, a.pos.y);
    } else {
      // separation from other aliens
      sep.set(0, 0, 0);
      for (const b of aliens) {
        if (b === a || b.dead) continue;
        const ox = a.pos.x - b.pos.x, oz = a.pos.z - b.pos.z, d2 = ox * ox + oz * oz, rr = T.r + b.T.r;
        if (d2 < rr * rr && d2 > 1e-6) { const d = Math.sqrt(d2); sep.x += (ox / d) * (rr - d); sep.z += (oz / d) * (rr - d); }
      }
      const reach = T.reach + 0.4;
      if (dist > reach || speed < 0) { a.pos.x += _mv.x * speed * dt; a.pos.z += _mv.z * speed * dt; }
      a.pos.x += sep.x * 0.5; a.pos.z += sep.z * 0.5;
      collide(a.pos, T.r, 0);
      // melee
      if (dist <= reach + (a.chargeT > 0 ? 0.6 : 0) && a.cd <= 0 && Math.abs(P.pos.y - a.pos.y) < 2) {
        hurtPlayer(T.dmg * a.dmgMul * (a.chargeT > 0 ? 1.5 : 1)); a.cd = T.cd; a.chargeT = 0;
        if (!T.boss) release(a); // hit and back off: frees the slot for another alien
      }
    }

    // face the player and animate
    a.yaw = Math.atan2(dx, dz);
    a.mesh.rotation.y = a.yaw;
    animateAlien(a, dt, a.airborne || speed !== 0 && dist > a.T.reach + 0.4);
    const mat = a.mesh.userData.mat;
    if (a.flash > 0) { a.flash -= dt; mat.emissive.setHex(0xffffff); mat.emissiveIntensity = 0.6; }
    else { mat.emissive.setHex(a.kind === 'phantom' ? 0x22305a : a.chargeT > 0 ? 0x661100 : 0x000000); mat.emissiveIntensity = 1; }
  }
  for (let i = aliens.length - 1; i >= 0; i--) if (aliens[i].dead && aliens[i].deathT <= 0) { scene.remove(aliens[i].mesh); aliens.splice(i, 1); }
}

const spitMat = new THREE.MeshBasicMaterial({ color: 0xd6ff5a });
function spit(a, n) {
  sfx('spit');
  const from = a.pos.clone().setY(a.T.h * (a.T.boss ? 0.9 : 0.8));
  for (let i = 0; i < n; i++) {
    const target = P.pos.clone().setY(P.pos.y + Math.max(0.3, P.st.eye * 0.75));
    const flight = from.distanceTo(target) / 18;
    const v = target.sub(from).divideScalar(flight); v.y += 0.5 * 9 * flight;
    if (n > 1) { v.x += rand(-3, 3); v.z += rand(-3, 3); }
    const m = new THREE.Mesh(geo.sphere, spitMat); m.scale.setScalar(a.T.boss ? 0.3 : 0.18); m.position.copy(from); scene.add(m);
    spits.push({ mesh: m, vel: v, dmg: (a.T.boss ? 16 : 12) * a.dmgMul, life: 4 });
  }
}

function insideBox(p) { for (const b of boxes) if (p.y < b.h && p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ) return b; return null; }

function updateProjectiles(dt) {
  for (let i = spits.length - 1; i >= 0; i--) {
    const s = spits[i]; s.life -= dt;
    s.vel.y -= 9 * dt; s.mesh.position.addScaledVector(s.vel, dt);
    const p = s.mesh.position;
    let gone = s.life <= 0 || p.y < 0 || insideBox(p);
    if (!gone && Math.hypot(p.x - P.pos.x, p.z - P.pos.z) < 0.6 && p.y > P.pos.y && p.y < P.pos.y + 1.9) { hurtPlayer(s.dmg); gone = true; }
    if (gone) { burst(p.clone().setY(Math.max(0.1, p.y)), 0xd6ff5a, 10, 2, 1); scene.remove(s.mesh); spits.splice(i, 1); }
  }
  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i], p = b.mesh.position;
    if (b.kind === 'plasma') {
      b.life -= dt; p.addScaledVector(b.vel, dt);
      let hit = b.life <= 0 || p.y < 0.05 || insideBox(p);
      if (!hit) for (const a of aliens) { if (!a.dead && Math.hypot(a.pos.x - p.x, a.pos.z - p.z) < a.T.r + 0.3 && p.y < a.pos.y + a.T.h) { hit = true; break; } }
      if (hit) { explode(p.clone(), b.splash, b.dmg); scene.remove(b.mesh); bolts.splice(i, 1); }
    } else {
      b.fuse -= dt; b.vel.y -= 20 * dt;
      const prev = p.clone(); p.addScaledVector(b.vel, dt);
      if (insideBox(p)) { p.copy(prev); b.vel.x *= -0.4; b.vel.z *= -0.4; }
      if (p.y < 0.12) { p.y = 0.12; b.vel.y *= -0.35; b.vel.x *= 0.7; b.vel.z *= 0.7; }
      if (b.fuse <= 0) { explode(p.clone(), 5.5, 170); scene.remove(b.mesh); bolts.splice(i, 1); }
    }
  }
}

function updatePickups(dt) {
  for (let i = pickups.length - 1; i >= 0; i--) {
    const k = pickups[i]; k.life -= dt;
    k.mesh.rotation.y += dt * 2; k.mesh.position.y = 0.6 + Math.sin(G.time * 3 + i) * 0.12;
    const dx = P.pos.x - k.mesh.position.x, dz = P.pos.z - k.mesh.position.z, d = Math.hypot(dx, dz);
    if (d < 3) { k.mesh.position.x += (dx / d) * dt * 8; k.mesh.position.z += (dz / d) * dt * 8; }
    if (d < 1 || k.life <= 0) { if (d < 1) collectPickup(k); scene.remove(k.mesh); pickups.splice(i, 1); }
    else if (k.life < 5) k.mesh.visible = Math.floor(k.life * 6) % 2 === 0;
  }
}

function updateTurrets(dt) {
  for (let i = turrets.length - 1; i >= 0; i--) {
    const t = turrets[i]; t.life -= dt; t.cd -= dt;
    if (t.life <= 0) { burst(t.g.position.clone().setY(1), 0x9b998f, 20, 3); scene.remove(t.g); turrets.splice(i, 1); continue; }
    const head = _to.copy(t.g.position).setY(t.g.position.y + 1);
    let best = null, bd = 28;
    for (const a of aliens) { if (a.dead) continue; const d = a.pos.distanceTo(t.g.position); if (d < bd) { _c1.copy(a.pos).setY(a.T.h * 0.5); if (lineOfSight(head, _c1)) { bd = d; best = a; } } }
    if (best) {
      t.head.rotation.y = Math.atan2(best.pos.x - t.g.position.x, best.pos.z - t.g.position.z) + Math.PI;
      if (t.cd <= 0) { t.cd = 0.2; _c1.copy(best.pos).setY(best.T.h * 0.5); tracer(head, _c1, 0xff9a6a); damageAlien(best, 16, _c1, false); }
    }
  }
}

/* ---------- director ----------
   Only a few aliens may attack at once; the rest hold a ring around you.
   Pressure builds and peaks, then a lull gives you room to reload, loot and heal. */
const D = { phase: 'build', t: 0, len: 22, pressure: 0, assignT: 0, squadCd: 2 };
function directorReset() { Object.assign(D, { phase: 'build', t: 0, len: rand(18, 26), pressure: 0, assignT: 0, squadCd: 1.5 }); }
function setPhase(ph) {
  D.phase = ph; D.t = 0;
  D.len = ph === 'build' ? rand(18, 26) : ph === 'peak' ? rand(9, 13) : Math.min(12, 7 + G.wave * 0.4);
  if (ph === 'relax') toast('Lull: they are regrouping. Reload, loot, heal.');
  if (ph === 'peak') toast('They are pushing!', true);
}
const maxEngaged = () => { const base = Math.min(5, 2 + Math.floor(G.wave / 3)); return D.phase === 'relax' ? 1 : D.phase === 'peak' ? Math.min(7, base + 2) : base; };
function release(a) { a.role = 'wait'; a.retreatT = rand(1.6, 2.8); a.chargeT = 0; }
function updateDirector(dt) {
  D.t += dt; D.pressure = Math.max(0, D.pressure - dt * 0.12);
  if (D.phase === 'build' && (D.t > D.len)) setPhase('peak');
  else if (D.phase === 'peak' && (D.t > D.len || D.pressure > 1.4)) setPhase('relax');
  else if (D.phase === 'relax' && D.t > D.len) setPhase('build');
  D.assignT -= dt; if (D.assignT > 0) return; D.assignT = 0.25;
  const live = aliens.filter((a) => !a.dead && !a.T.boss);
  const eng = live.filter((a) => a.role === 'engage'), max = maxEngaged();
  const d2 = (a) => (a.pos.x - P.pos.x) ** 2 + (a.pos.z - P.pos.z) ** 2;
  eng.sort((a, b) => d2(b) - d2(a));
  while (eng.length > max) release(eng.shift());
  const ranged = eng.filter((a) => a.kind === 'spitter').length;
  const waiting = live.filter((a) => a.role !== 'engage' && a.retreatT <= 0).sort((a, b) => d2(a) - d2(b));
  let free = max - eng.length, r = ranged;
  for (const a of waiting) { if (free <= 0) break; if (a.kind === 'spitter' && r >= 2) continue; a.role = 'engage'; free--; if (a.kind === 'spitter') r++; }
}
function updateWaves(dt) {
  if (G.phase === 'intermission') {
    G.timer -= G.modal === 'shop' ? 0 : dt;
    if (G.timer <= 0) startWave();
    return;
  }
  updateDirector(dt);
  const alive = aliens.filter((a) => !a.dead).length;
  const cap = isTouch ? Math.min(8 + G.wave * 2, 18) : Math.min(10 + G.wave * 2, 26);
  // squads instead of a constant stream; nothing new arrives during a lull
  if (D.phase !== 'relax') D.squadCd -= dt * (D.phase === 'peak' ? 1.6 : 1);
  if (G.toSpawn.length && D.squadCd <= 0 && alive < cap) {
    const n = Math.min(G.toSpawn.length, 2 + Math.floor(G.wave / 2), 6, cap - alive);
    for (let i = 0; i < n; i++) spawnAlien(G.toSpawn.shift());
    D.squadCd = Math.max(3.5, 8 - G.wave * 0.3) * rand(0.8, 1.2);
  }
  // loot on the floor as you score
  if (P.score >= G.nextDrop) { G.nextDrop += 600 + G.wave * 120; spawnFloorLoot(); }
  if (!G.toSpawn.length && alive === 0) startIntermission(false);
}

/* ---------- floor loot: Field weapons and timed bonuses ---------- */
const BONUS = {
  dmg: { name: 'Damage ×1.5', dur: 20, color: 0xff5b1f },
  rapid: { name: 'Rapid fire', dur: 15, color: 0xffc857 },
  double: { name: 'Double credits', dur: 30, color: 0x8fd18a },
};
function nearSpot(min, max) {
  for (let k = 0; k < 60; k++) {
    const ang = Math.random() * Math.PI * 2, d = rand(min, max), x = P.pos.x + Math.cos(ang) * d, z = P.pos.z + Math.sin(ang) * d;
    if (Math.abs(x) < HALF - 2 && Math.abs(z) < HALF - 2 && !blocked[cellOf(z) * NAV + cellOf(x)]) return new THREE.Vector3(x, 0, z);
  }
  return randomFreeSpot();
}
function spawnFloorLoot() {
  const pool = WEAPONS.filter((w) => w.price && !P.owned.has(w.id) && (w.id !== 'plasma' || G.wave >= 4));
  if (pool.length) {
    const w = pool.sort((a, b) => a.price - b.price)[Math.min(pool.length - 1, Math.floor(Math.random() * 2))];
    spawnWeaponPickup(nearSpot(6, 14), w.id); toast(`A Field ${w.name} dropped nearby`);
  } else spawnPickup(nearSpot(5, 12), 'ammo');
  if (Math.random() < 0.6) { const k = Object.keys(BONUS)[Math.floor(Math.random() * 3)]; spawnBonusPickup(nearSpot(5, 12), k); }
}
function spawnWeaponPickup(p, id) {
  const g = new THREE.Group(); const gun = new THREE.Group(); VIEW[id]().forEach((m) => gun.add(m)); gun.scale.setScalar(1.8); gun.rotation.y = Math.PI / 2; gun.position.y = 0.4; g.add(gun);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.75, 32), new THREE.MeshBasicMaterial({ color: 0x6fe3ff, transparent: true, opacity: 0.8, side: THREE.DoubleSide })); ring.rotation.x = -Math.PI / 2; ring.position.y = -0.55; g.add(ring);
  g.position.copy(p).setY(0.6); scene.add(g);
  pickups.push({ kind: 'weapon', w: id, mesh: g, life: 45 });
}
function spawnBonusPickup(p, k) {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35), new THREE.MeshStandardMaterial({ color: BONUS[k].color, emissive: BONUS[k].color, emissiveIntensity: 0.8 }));
  m.position.copy(p).setY(0.7); scene.add(m);
  pickups.push({ kind: 'bonus', b: k, mesh: m, life: 25 });
}

/* ==========================================================================
   Loop
   ========================================================================== */
/* adaptive quality: weaker devices drop shadows, lamp lights and resolution */
let quality = new URLSearchParams(location.search).has('lowfx') ? 0 : 2, slowFrames = 0;
function setQuality(q) {
  quality = q;
  sun.castShadow = q >= 2;
  lampLights.forEach((l) => (l.visible = q >= 1));
  renderer.setPixelRatio(q >= 2 ? Math.min(window.devicePixelRatio, isTouch ? 1.5 : 2) : q === 1 ? 1 : 0.75);
  resize();
}
function watchPerf(rawDt) {
  if (quality === 0 || G.mode !== 'play' || G.modal) return;
  slowFrames = rawDt > 1 / 28 ? slowFrames + 1 : Math.max(0, slowFrames - 2);
  if (slowFrames > 90) { slowFrames = 0; setQuality(quality - 1); }
}

let last = performance.now();
function frame(now) {
  const raw = (now - last) / 1000;
  const dt = Math.min(0.05, raw); last = now;
  watchPerf(raw);
  const running = G.mode === 'play' && !G.modal;
  if (running) {
    G.time += dt;
    updatePlayer(dt);
    G.flowT -= dt; if (G.flowT <= 0) { computeFlow(P.pos.x, P.pos.z); G.flowT = 0.25; }
    updateAliens(dt); updateProjectiles(dt); updatePickups(dt); updateTurrets(dt); updateWaves(dt);
    updateHud();
  } else if (G.mode === 'menu') {
    const t = now / 1000;
    camera.position.set(Math.sin(t * 0.08) * 30, 14, Math.cos(t * 0.08) * 30);
    camera.lookAt(0, 2, 0);
  } else if (G.mode === 'over') updateAliens(dt);
  updateParticles(running || G.mode !== 'play' ? dt : 0);
  tracers.forEach((t) => { if (t.life > 0) { t.life -= dt; t.l.material.opacity = Math.max(0, t.life / 0.07) * 0.9; } else t.l.material.opacity = 0; });
  boomLight.intensity = Math.max(0, boomLight.intensity - dt * 200);
  if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) $('banner').classList.remove('on'); }
  notify.tick(dt);
  if (hitT > 0) { hitT -= dt; if (hitT <= 0) $('hitmark').className = 'hitmark fade'; }
  vmRoot.visible = G.mode === 'play';
  if (G.mode !== 'play' && camera.fov !== BASE_FOV) { camera.fov = BASE_FOV; camera.updateProjectionMatrix(); }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();
if (quality === 0) setQuality(0);
resetPlayer();
requestAnimationFrame(frame);

// tiny hook for automated smoke tests
window.addEventListener('aboutopen', () => { if (G.mode === 'play' && !G.modal) pause(); });
window.__siege = { D, step: (dt) => { G.time += dt; updateAliens(dt); updateProjectiles(dt); updatePickups(dt); updateWaves(dt); }, G, P, aliens, renderer, scene, camera, buildAlien, animateAlien, TYPES, gyro, aim, notify };
