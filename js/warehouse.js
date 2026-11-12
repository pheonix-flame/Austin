import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const isTouch = window.matchMedia('(pointer: coarse)').matches;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const money = (x) => (x < 0 ? '−$' : '$') + Math.abs(Math.round(x)).toLocaleString();

const ORDER = ['receiving', 'storage', 'picking', 'packing', 'shipping'];
const STATIONS = {
  receiving: { name: 'Receiving', rate: 6.5, pos: [-27, 0], zone: [-32, -22, -13, 13], color: 0x5b8def, blurb: 'Unloads inbound trucks and checks stock in.' },
  storage: { name: 'Storage', rate: 7, pos: [-11.5, 0], zone: [-19, -4, -15, 15], color: 0x9b7bd6, blurb: 'Put-away and replenishment across the racks.' },
  picking: { name: 'Picking', rate: 4.5, pos: [3, 0], zone: [-2, 8, -10, 10], color: 0xffc857, blurb: 'Walks the aisles to collect items for each order. Usually the slowest step.' },
  packing: { name: 'Packing', rate: 6, pos: [16, 0], zone: [11, 21, -10, 10], color: 0x8fd18a, blurb: 'Boxes, labels and checks every order.' },
  shipping: { name: 'Shipping', rate: 8, pos: [28, 0], zone: [23, 32, -13, 13], color: 0xff7a3a, blurb: 'Sorts parcels by carrier and loads outbound trucks.' },
};
const ROLES = {
  tech: { name: 'Maintenance technician', days: 3, cost: 1200, color: 0x5b8def },
  robot: { name: 'Robot operator', days: 3, cost: 1400, color: 0xff7a3a },
  analyst: { name: 'Data & systems analyst', days: 4, cost: 1500, color: 0xecebe4 },
};
const UPGRADES = [
  { id: 'scanners', name: 'Barcode scanners', cost: 3000, weight: 8, boost: { receiving: 0.15, picking: 0.15 }, errCut: 0.5, roles: {}, desc: 'Scan every move. Halves picking errors.' },
  { id: 'wms', name: 'Warehouse management system', cost: 8000, weight: 14, boost: { storage: 0.4, picking: 0.15 }, errCut: 0.3, roles: { analyst: 1 }, desc: 'Smart slotting and real-time stock. Big storage gains.' },
  { id: 'ptl', name: 'Pick-to-light', cost: 9000, weight: 9, boost: { picking: 0.3 }, errCut: 0.4, roles: {}, desc: 'Lights guide pickers to the right bin.' },
  { id: 'docks', name: 'Dock scheduling & dimensioner', cost: 6000, weight: 9, boost: { receiving: 0.4, shipping: 0.25 }, roles: {}, desc: 'Booked truck slots and automatic carton measuring.' },
  { id: 'conveyor', name: 'Conveyor line', cost: 15000, weight: 14, boost: { packing: 0.5, shipping: 0.3 }, roles: { tech: 1 }, desc: 'Moves totes from picking through packing to shipping.' },
  { id: 'amr', name: 'Autonomous mobile robots', cost: 22000, weight: 16, boost: { picking: 0.8 }, roles: { robot: 2 }, desc: 'Goods-to-person picking. Pickers stop walking the aisles.' },
  { id: 'ergo', name: 'Ergonomic lifts & exosuits', cost: 5000, weight: 6, boost: { packing: 0.15 }, roles: {}, morale: 6, safety: 0.5, desc: 'Fewer injuries, happier crew.' },
  { id: 'predictive', name: 'Predictive maintenance sensors', cost: 7000, weight: 10, boost: {}, roles: { analyst: 1 }, breakdown: 0.35, desc: 'IoT sensors flag failures before they happen.' },
  { id: 'solar', name: 'Solar roof, LEDs & battery', cost: 12000, weight: 8, boost: {}, roles: { tech: 1 }, energy: 0.5, morale: 3, desc: 'Halves energy costs and keeps the lights on in an outage.' },
  { id: 'cyber', name: 'Security hardening', cost: 4000, weight: 6, boost: {}, roles: { analyst: 1 }, desc: 'MFA, patching, backups and staff phishing drills for your systems.' },
];
const UMAP = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));
const WAGE = 18, PRICE = 28, ERROR_COST = 15, OVERHEAD = 250, ENERGY = 380, SHIFT_START = 8, SHIFT_HOURS = 10;

let S;
function newState() {
  S = {
    day: 1, hour: SHIFT_START, frac: 0, t: 0, speed: 1, running: false, over: false,
    cash: 25000, backlog: 120, csat: 72, morale: 64,
    assign: { receiving: 4, storage: 4, picking: 7, packing: 5, shipping: 4 }, idle: 0,
    roles: { tech: 0, robot: 0, analyst: 0 }, training: [], trainedTotal: 0, hires: 0, layoffs: 0,
    owned: [], mods: [], anomalies: [], nextAnomaly: rand(3, 6), shippedTotal: 0, errorsTotal: 0,
    lastThru: 0, today: { shipped: 0, revenue: 0, cost: 0 }, spike: 1, overtime: 0, flags: {},
  };
}
const headcount = () => ORDER.reduce((s, k) => s + S.assign[k], 0) + S.idle + S.roles.tech + S.roles.robot + S.roles.analyst + S.training.length;
const has = (id) => S.owned.includes(id);
const demandDay = () => Math.min(520, 230 * (1 + 0.02 * (S.day - 1))) * S.spike;

function staffing() {
  const left = { ...S.roles }, out = {};
  for (const id of S.owned) {
    const need = UMAP[id].roles; let ok = true;
    for (const r in need) if (left[r] < need[r]) ok = false;
    if (ok) for (const r in need) left[r] -= need[r];
    out[id] = ok;
  }
  return out;
}
function modMult(st) { return S.mods.filter((m) => m.station === st || m.station === 'all').reduce((p, m) => p * (m.mult ?? 1), 1); }
function capacity(st) {
  const staffed = staffing();
  let mult = 1;
  for (const id of S.owned) { const b = UMAP[id].boost[st]; if (b) mult *= 1 + b * (staffed[id] ? 1 : 0.4); }
  const moraleF = 0.7 + 0.3 * (S.morale / 100);
  const ot = S.overtime > 0 ? 1.3 : 1;
  return S.assign[st] * STATIONS[st].rate * mult * moraleF * modMult(st) * ot;
}
function bottleneck() { let b = ORDER[0]; ORDER.forEach((k) => { if (capacity(k) < capacity(b)) b = k; }); return b; }
function errorRate() {
  const staffed = staffing(); let e = 0.03;
  for (const id of S.owned) if (UMAP[id].errCut) e *= 1 - UMAP[id].errCut * (staffed[id] ? 1 : 0.4);
  e += S.mods.reduce((s, m) => s + (m.err || 0), 0);
  return clamp(e, 0.002, 0.2);
}
function modernisation() {
  const staffed = staffing();
  return S.owned.reduce((s, id) => s + UMAP[id].weight * (staffed[id] ? 1 : 0.5), 0);
}
function rolesNeeded() {
  const n = { tech: 0, robot: 0, analyst: 0 };
  S.owned.forEach((id) => { for (const r in UMAP[id].roles) n[r] += UMAP[id].roles[r]; });
  return n;
}

const addMod = (station, mult, hours, extra = {}) => S.mods.push({ station, mult, until: S.t + hours, ...extra });
const EVENTS = [
  { id: 'forklift', def: 1, title: 'Forklift breakdown', station: () => pick(['receiving', 'storage']), weight: () => (has('predictive') && staffing().predictive ? 0.35 : 1),
    text: (a) => `A reach truck in ${STATIONS[a.st].name.toLowerCase()} has seized. Pallets are stacking up.`,
    options: [
      { label: 'Emergency repair · $1,200', desc: 'Back to full speed now.', apply: () => { S.cash -= 1200; } },
      { label: 'Wait for the scheduled service', desc: 'Station runs at 50% for the rest of the shift.', apply: (a) => addMod(a.st, 0.5, 10) },
      { label: 'Send a maintenance technician', desc: 'Fixed in an hour. Needs a trained technician.', req: () => S.roles.tech > 0, apply: (a) => addMod(a.st, 0.6, 1) },
    ], timeout: 1 },
  { id: 'jam', def: 0, title: 'Conveyor jam', station: () => 'packing', cond: () => has('conveyor'), weight: () => (has('predictive') && staffing().predictive ? 0.4 : 1.2),
    text: () => 'Totes have jammed at the merge point. Packing is starved.',
    options: [
      { label: 'Stop the line and clear it by hand', desc: 'Packing at 20% for 2 hours.', apply: () => addMod('packing', 0.2, 2) },
      { label: 'Technician on site', desc: 'Cleared in 30 minutes. Needs a technician.', req: () => S.roles.tech > 0, apply: () => addMod('packing', 0.5, 1) },
      { label: 'Route around it manually', desc: 'Packing at 60% for the rest of the shift; staff get tired (−3 morale).', apply: () => { addMod('packing', 0.6, 10); S.morale -= 3; } },
    ], timeout: 1 },
  { id: 'mismatch', def: 1, title: 'Inventory mismatch', station: () => 'storage', weight: () => (has('wms') ? 0.4 : 1),
    text: () => 'System stock says 40 units; the bin is empty. Pickers are short-picking orders.',
    options: [
      { label: 'Overnight cycle count · $800', desc: 'Accuracy restored; no extra errors.', apply: () => { S.cash -= 800; } },
      { label: 'Ignore it for now', desc: 'Error rate +2% for 3 days.', apply: () => S.mods.push({ station: 'none', err: 0.02, until: S.t + 30 }) },
    ], timeout: 2 },
  { id: 'spike', def: 1, title: 'Flash-sale demand spike', station: () => 'shipping', weight: () => 0.9,
    text: () => 'A retail partner launched a surprise promotion. Orders are up 40% today and tomorrow.',
    options: [
      { label: 'Approve overtime', desc: '+30% capacity for 2 days at 1.5× wages; −6 morale.', apply: () => { S.spike = 1.4; S.flags.spikeEnd = S.day + 2; S.overtime = 20; S.morale -= 6; } },
      { label: 'Absorb it with the current crew', desc: 'Demand +40% for 2 days. Backlog will grow.', apply: () => { S.spike = 1.4; S.flags.spikeEnd = S.day + 2; } },
      { label: 'Negotiate delivery windows', desc: 'Demand +15% instead, but customer satisfaction −5.', apply: () => { S.spike = 1.15; S.flags.spikeEnd = S.day + 2; S.csat -= 5; } },
    ], timeout: 1 },
  { id: 'spill', def: 1, title: 'Spill in packing', station: () => 'packing', weight: () => (has('ergo') ? 0.5 : 1),
    text: () => 'A leaking carton has made the floor slippery near the pack benches.',
    options: [
      { label: 'Close the area and clean it', desc: 'Packing at 60% for 3 hours. Nobody gets hurt.', apply: () => addMod('packing', 0.6, 3) },
      { label: 'Put a sign up and keep going', desc: 'Risky: a 30% chance of an injury (−12 morale, $3,000).', apply: () => { if (Math.random() < 0.3 * (has('ergo') ? 0.5 : 1)) { S.morale -= 12; S.cash -= 3000; toast('Someone slipped. Injury reported.'); } } },
    ], timeout: 1 },
  { id: 'fear', def: 1, title: 'Crew worried about automation', station: () => 'picking', cond: () => S.owned.length >= 2 && S.trainedTotal + S.training.length < S.owned.length, weight: () => 1.4,
    text: () => 'Rumours say the new kit means job cuts. People are anxious and output is slipping.',
    options: [
      { label: 'Town hall + reskilling promise · $500', desc: 'Explain the plan: no one loses their job; everyone gets a path. +10 morale.', apply: () => { S.cash -= 500; S.morale += 10; } },
      { label: 'Say nothing', desc: '−10 morale.', apply: () => { S.morale -= 10; } },
      { label: 'Use it to “streamline” and cut 4 roles', desc: 'Ends the challenge: the brief was zero layoffs.', danger: true, apply: () => layoff(4) },
    ], timeout: 2 },
  { id: 'robot', def: 0, title: 'Robot fleet fault', station: () => 'picking', cond: () => has('amr'), weight: () => (has('predictive') && staffing().predictive ? 0.4 : 1),
    text: () => 'Two robots have lost localisation and blocked an aisle.',
    options: [
      { label: 'Reboot the whole fleet', desc: 'Picking at 50% for 2 hours.', apply: () => addMod('picking', 0.5, 2) },
      { label: 'Robot operator recovers them', desc: 'Back in 20 minutes. Needs a robot operator.', req: () => S.roles.robot > 0, apply: () => addMod('picking', 0.8, 1) },
    ], timeout: 1 },
  { id: 'ransom', def: 0, title: 'Ransomware on the WMS', station: () => 'storage', cond: () => has('wms'), weight: () => 0.7,
    text: () => (has('cyber') && staffing().cyber ? 'Security hardening caught a phishing email that tried to plant ransomware.' : 'Screens show a ransom note. The warehouse management system is encrypted.'),
    auto: () => has('cyber') && staffing().cyber,
    options: [
      { label: 'Restore from backups', desc: 'WMS offline for the shift: storage and picking at 50%.', apply: () => { addMod('storage', 0.5, 10); addMod('picking', 0.5, 10); } },
      { label: 'Pay the ransom · $6,000', desc: 'No guarantee, and it funds the next attack.', apply: () => { S.cash -= 6000; if (Math.random() < 0.4) { addMod('storage', 0.5, 10); toast('The decryptor failed. Restoring from backups anyway.'); } } },
    ], timeout: 1 },
  { id: 'supplier', def: 1, title: 'Supplier delay', station: () => 'receiving', weight: () => 0.8,
    text: () => 'A key inbound truck is 2 days late. Popular items will run out.',
    options: [
      { label: 'Expedite freight · $2,000', desc: 'Stock arrives tonight.', apply: () => { S.cash -= 2000; } },
      { label: 'Reallocate from other sites', desc: 'Receiving at 70% tomorrow; customer satisfaction −3.', apply: () => { addMod('receiving', 0.7, 20); S.csat -= 3; } },
      { label: 'Offer substitutes', desc: 'Error rate +3% for 2 days.', apply: () => S.mods.push({ station: 'none', err: 0.03, until: S.t + 20 }) },
    ], timeout: 2 },
  { id: 'power', def: 1, title: 'Power outage', station: () => 'shipping', weight: () => 0.6,
    text: () => (has('solar') && staffing().solar ? 'Grid power dropped, but the battery bank took over. No interruption.' : 'The grid is down across the industrial park.'),
    auto: () => has('solar') && staffing().solar,
    options: [
      { label: 'Run the diesel generator · $900', desc: 'Everything at 80% for 3 hours.', apply: () => { S.cash -= 900; addMod('all', 0.8, 3); } },
      { label: 'Pause operations', desc: 'Everything stops for 3 hours.', apply: () => addMod('all', 0.05, 3) },
    ], timeout: 1 },
  { id: 'hq', def: 0, title: 'HQ wants headcount cuts', station: () => 'office', cond: () => S.day >= 4 && !S.flags.hqDone, weight: () => (S.cash < 10000 ? 2 : 0.6),
    text: () => 'Regional finance asks you to cut 5 roles to hit this quarter’s budget.',
    options: [
      { label: 'Present the modernisation ROI plan', desc: 'Works if modernisation is at least 30%; otherwise morale −5 while you argue it out.', apply: () => { S.flags.hqDone = true; if (modernisation() < 30) { S.morale -= 5; toast('HQ isn’t convinced yet, but agrees to wait.'); } else toast('HQ backs the plan. No cuts.'); } },
      { label: 'Offer a voluntary 4-day week to volunteers', desc: 'Wages −10% for 5 days; −4 morale.', apply: () => { S.flags.hqDone = true; S.flags.reducedUntil = S.day + 5; S.morale -= 4; } },
      { label: 'Cut 5 roles', desc: 'Ends the challenge: the brief was zero layoffs.', danger: true, apply: () => layoff(5) },
    ], timeout: 3 },
];

function spawnAnomaly() {
  const pool = EVENTS.filter((e) => (!e.cond || e.cond()) && !S.anomalies.some((a) => a.ev.id === e.id));
  if (!pool.length || S.anomalies.length >= 2) return;
  const tot = pool.reduce((s, e) => s + e.weight(), 0); let r = Math.random() * tot, ev = pool[0];
  for (const e of pool) { r -= e.weight(); if (r <= 0) { ev = e; break; } }
  const st = ev.station();
  if (ev.auto && ev.auto()) { toast(`✓ ${ev.title}: ${ev.text({ st })}`); return; }
  const base = st === 'office' ? OFFICE_POS : STATIONS[st].pos;
  const a = { ev, st, deadline: S.t + ev.timeout * SHIFT_HOURS / 2 + 2, pos: new THREE.Vector3(base[0] + rand(-3, 3), 0, base[1] + rand(-5, 5)) };
  a.marker = makeBeacon(a.pos); S.anomalies.push(a);
  renderAlerts(); toast(`⚠ ${ev.title}`);
}
function resolveAnomaly(a, idx) {
  const opt = a.ev.options[idx];
  opt.apply(a);
  scene.remove(a.marker);
  S.anomalies = S.anomalies.filter((x) => x !== a);
  renderAlerts();
}

const canvas = $('stage');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouch }); }
catch { document.querySelector('#intro .panel p').textContent = 'This simulation needs WebGL, which is not available in this browser.'; $('startBtn').disabled = true; throw new Error('no webgl'); }
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouch ? 1.5 : 2));
renderer.shadowMap.enabled = !isTouch; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x15171a);
scene.fog = new THREE.Fog(0x15171a, 70, 140);
const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 400);
const hemi = new THREE.HemisphereLight(0xfff1dc, 0x2a2a30, 0.9); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.3); sun.position.set(-20, 40, 25); sun.castShadow = true;
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 35, bottom: -35, near: 1, far: 120 }); sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);

const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, ...o });
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
function box(w, h, d, m, x, y, z, parent = scene, shadow = true) {
  const o = new THREE.Mesh(boxGeo, m); o.scale.set(w, h, d); o.position.set(x, y, z); o.castShadow = shadow; o.receiveShadow = true; parent.add(o); return o;
}
const colliders = [];
const solid = (x, z, w, d) => colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });

const W = 68, D = 44;
{
  const c = document.createElement('canvas'); c.width = 1360; c.height = 880; const g = c.getContext('2d');
  g.fillStyle = '#3a3b3d'; g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 9000; i++) { const v = 52 + Math.random() * 14; g.fillStyle = `rgb(${v},${v},${v + 2})`; g.fillRect(Math.random() * c.width, Math.random() * c.height, 3, 3); }
  g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 2;
  for (let x = 0; x < c.width; x += 100) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, c.height); g.stroke(); }
  for (let y = 0; y < c.height; y += 100) { g.beginPath(); g.moveTo(0, y); g.lineTo(c.width, y); g.stroke(); }
  const toPx = (x, z) => [((x + W / 2) / W) * c.width, ((z + D / 2) / D) * c.height];
  ORDER.forEach((k) => {
    const s = STATIONS[k], [x0, z0] = toPx(s.zone[0], s.zone[2]), [x1, z1] = toPx(s.zone[1], s.zone[3]);
    const col = '#' + new THREE.Color(s.color).getHexString();
    g.fillStyle = col + '18'; g.fillRect(x0, z0, x1 - x0, z1 - z0);
    g.strokeStyle = col; g.lineWidth = 6; g.setLineDash([24, 14]); g.strokeRect(x0, z0, x1 - x0, z1 - z0); g.setLineDash([]);
  });
  g.fillStyle = 'rgba(255,200,87,.22)'; const [wx0, wz0] = toPx(-33, 13.6), [wx1, wz1] = toPx(33, 15.4); g.fillRect(wx0, wz0, wx1 - wx0, wz1 - wz0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ map: t, roughness: 0.85 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; floor.name = 'floor'; scene.add(floor);
  const yard = new THREE.Mesh(new THREE.PlaneGeometry(200, 140), mat(0x1e2022, { roughness: 1 }));
  yard.rotation.x = -Math.PI / 2; yard.position.y = -0.02; yard.name = 'floor'; scene.add(yard);
}
const wallM = mat(0x5b5e63), bumper = mat(0xffc857);
box(W, 1.6, 0.4, wallM, 0, 0.8, -D / 2); box(W, 1.6, 0.4, wallM, 0, 0.8, D / 2);
solid(0, -D / 2, W, 0.6); solid(0, D / 2, W, 0.6);
[-1, 1].forEach((side) => {
  const x = side * W / 2;
  const doors = [-8, 0, 8];
  let zPrev = -D / 2;
  [...doors.map((z) => z - 1.8), D / 2].forEach((zEnd, i) => {
    const len = zEnd - zPrev; if (len > 0.1) { box(0.4, 1.6, len, wallM, x, 0.8, zPrev + len / 2); solid(x, zPrev + len / 2, 0.6, len); }
    zPrev = doors[i] !== undefined ? doors[i] + 1.8 : zEnd;
  });
  doors.forEach((z) => { box(0.5, 0.5, 0.3, bumper, x, 0.6, z - 1.9); box(0.5, 0.5, 0.3, bumper, x, 0.6, z + 1.9); });
  doors.forEach((z, i) => {
    if (i === 1 && side < 0) return;
    const tx = x + side * 7.5;
    box(11, 3.6, 3, mat(side < 0 ? 0xd9d6cf : 0x8a2f2a), tx, 2.1, z);
    box(2.6, 2.6, 2.8, mat(0x2b2e33), tx + side * 6.8, 1.6, z);
  });
});
[[-34, -22], [34, -22], [-34, 22], [34, 22], [0, -22], [0, 22]].forEach(([x, z]) => box(0.8, 7, 0.8, mat(0x45484d), x, 3.5, z));

const rackUp = new THREE.InstancedMesh(boxGeo, mat(0x2f62b5, { metalness: 0.3 }), 400);
const rackBeam = new THREE.InstancedMesh(boxGeo, mat(0xff7a3a, { metalness: 0.3 }), 400);
const palletBox = new THREE.InstancedMesh(boxGeo, mat(0xb08a5a), 600);
[rackUp, rackBeam, palletBox].forEach((m) => { m.castShadow = true; m.receiveShadow = true; m.count = 0; scene.add(m); });
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
function inst(im, x, y, z, w, h, d) { _m4.compose(_p.set(x, y, z), _q.identity(), _s.set(w, h, d)); im.setMatrixAt(im.count++, _m4); }
[-17, -13.5, -9.5, -6].forEach((x) => {
  for (let z = -13; z <= 13; z += 2.6) {
    if (Math.abs(z) < 1.4) continue;
    [-0.55, 0.55].forEach((dx) => [-1.2, 1.2].forEach((dz) => inst(rackUp, x + dx, 2, z + dz, 0.12, 4, 0.12)));
    [0.9, 2.2, 3.5].forEach((y) => {
      inst(rackBeam, x, y, z - 1.2, 1.25, 0.1, 0.1); inst(rackBeam, x, y, z + 1.2, 1.25, 0.1, 0.1);
      if (Math.random() < 0.8) inst(palletBox, x, y + 0.45, z + rand(-0.5, 0.5), 1, 0.8, 1.6);
    });
  }
  solid(x, -7.3, 1.4, 12.4); solid(x, 7.3, 1.4, 12.4);
});
const benchM = mat(0x8c8f94, { metalness: 0.4 }), topM = mat(0xc9b28a);
for (let z = -8; z <= 8; z += 4) { box(3, 0.1, 1.2, topM, 16, 0.95, z); box(3, 0.9, 0.1, benchM, 16, 0.45, z - 0.5); box(0.4, 0.6, 0.4, mat(0xd9d6cf), 15, 1.3, z); solid(16, z, 3, 1.2); }
for (let z = -10; z <= 10; z += 5) { box(4, 0.8, 2, mat(0x6b6f75), 28, 0.4, z); solid(28, z, 4, 2); }
const OFFICE_POS = [-26, 18.5];
const glass = new THREE.MeshStandardMaterial({ color: 0x9fc3e0, transparent: true, opacity: 0.18, roughness: 0.1 });
box(12, 2.6, 0.15, glass, -26, 1.3, 15.6, scene, false); solid(-29, 15.6, 6, 0.4); solid(-21.5, 15.6, 3, 0.4);
box(0.15, 2.6, 6, glass, -20, 1.3, 18.7, scene, false); solid(-20, 18.7, 0.4, 6);
const officeScreen = box(3, 1.6, 0.1, new THREE.MeshBasicMaterial({ color: 0x1b1d22 }), -26, 1.8, 21.6, scene, false);
for (let i = 0; i < 3; i++) { box(1.6, 0.75, 0.8, mat(0xe8e4dc), -30 + i * 2.4, 0.38, 19.5); }
box(4, 1, 1.4, mat(0x4a5d72), 27, 0.5, 19.5); box(2, 2.2, 0.8, mat(0x2b2e33), 30.5, 1.1, 20.6);

const queueMesh = new THREE.InstancedMesh(boxGeo, mat(0xd9b27a), 80); queueMesh.castShadow = true; scene.add(queueMesh);
function updateQueue() {
  const n = Math.min(80, Math.round(S.backlog / 12)); queueMesh.count = n;
  for (let i = 0; i < n; i++) { const col = i % 8, row = Math.floor(i / 8) % 5, lay = Math.floor(i / 40); _m4.compose(_p.set(-1.2 + col * 0.95, 0.35 + lay * 0.7, 11.2 + row * 0.5), _q.identity(), _s.set(0.8, 0.6, 0.42)); queueMesh.setMatrixAt(i, _m4); }
  queueMesh.instanceMatrix.needsUpdate = true;
}

const upgradeGroups = {};
const conveyorBoxes = new THREE.InstancedMesh(boxGeo, mat(0xc79a5a), 40); conveyorBoxes.count = 0; scene.add(conveyorBoxes);
const amrs = [];
function showUpgrade(id) {
  const g = new THREE.Group(); scene.add(g); upgradeGroups[id] = g;
  if (id === 'scanners') [STATIONS.receiving.pos, STATIONS.picking.pos].forEach(([x, z]) => { for (let i = 0; i < 4; i++) box(0.3, 0.3, 0.3, new THREE.MeshBasicMaterial({ color: 0x6fe3ff }), x + rand(-3, 3), 1.4, z + rand(-6, 6), g, false); });
  if (id === 'wms') officeScreen.material.color.setHex(0x2a6bd6);
  if (id === 'ptl') for (let z = -9; z <= 9; z += 1.5) box(0.15, 0.15, 0.6, new THREE.MeshBasicMaterial({ color: 0x8fd18a }), 7.5, 1.2, z, g, false);
  if (id === 'docks') [-8, 0, 8].forEach((z) => [-1, 1].forEach((s) => box(0.3, 0.3, 0.3, new THREE.MeshBasicMaterial({ color: 0x8fd18a }), s * 33.3, 2.2, z, g, false)));
  if (id === 'conveyor') {
    box(30, 0.2, 1.1, mat(0x2b2e33, { metalness: 0.5 }), 17, 0.85, -12.2, g);
    for (let x = 3; x <= 31; x += 2.5) box(0.15, 0.8, 1, mat(0x8c8f94), x, 0.4, -12.2, g);
    conveyorBoxes.count = 24;
  }
  if (id === 'amr') for (let i = 0; i < 5; i++) {
    const r = new THREE.Group(); r.add(box(0.9, 0.35, 0.7, mat(0xff7a3a), 0, 0.25, 0, r)); r.add(box(0.12, 0.12, 0.12, new THREE.MeshBasicMaterial({ color: 0x6fe3ff }), 0, 0.5, 0.25, r, false));
    g.add(r); amrs.push({ r, path: [[-15.3, -12], [-15.3, 12], [-11.5, 12], [-11.5, -12], [-7.8, -12], [-7.8, 12], [2, 12], [2, -12]], i: i * 1.6, sp: 2.2 });
  }
  if (id === 'ergo') for (let z = -8; z <= 8; z += 4) box(0.8, 1.2, 0.8, mat(0x8fd18a), 18, 0.6, z + 0.4, g);
  if (id === 'predictive') for (let i = 0; i < 16; i++) box(0.12, 0.12, 0.12, new THREE.MeshBasicMaterial({ color: 0xffc857 }), pick([-17, -13.5, -9.5, -6]) + 0.6, 4.1, rand(-12, 12), g, false);
  if (id === 'solar') { for (let i = 0; i < 8; i++) { const p = box(4, 0.1, 2.4, mat(0x1d3557, { metalness: 0.6, roughness: 0.3 }), -30 + i * 4.4, 3.2, -27.5, g); p.rotation.x = 0.35; } hemi.intensity = 1.15; hemi.color.setHex(0xffffff); }
  if (id === 'cyber') box(0.6, 0.6, 0.12, new THREE.MeshBasicMaterial({ color: 0x8fd18a }), -24.2, 2.4, 21.5, g, false);
}

const capsule = new THREE.CapsuleGeometry(0.28, 0.9, 4, 8), headG = new THREE.SphereGeometry(0.22, 12, 10);
const skin = [0x8d5524, 0xc68642, 0x5c3a21, 0xe0ac69, 0x3b2219].map((c) => mat(c));
function person(color) {
  const g = new THREE.Group();
  const b = new THREE.Mesh(capsule, mat(color)); b.position.y = 0.75; b.castShadow = true; g.add(b);
  const h = new THREE.Mesh(headG, pick(skin)); h.position.y = 1.55; h.castShadow = true; g.add(h);
  const carry = box(0.45, 0.35, 0.35, mat(0xc79a5a), 0, 1.0, 0.35, g); carry.visible = false;
  g.userData.carry = carry; scene.add(g); return g;
}
const player = person(0xff5b1f);
const hat = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xffffff)); hat.position.y = 1.62; player.add(hat);
player.position.set(-24, 0, 14.5);
const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.65, 32), new THREE.MeshBasicMaterial({ color: 0xff5b1f, transparent: true, opacity: 0.8 })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; player.add(ring);

const npcs = [];
const VEST = 0xffd23a, TRAINEE = 0x9b998f;
function roleSpot(role) {
  if (role === 'analyst' || role === 'trainee') return [rand(-31, -21), rand(17, 21)];
  if (role === 'tech') return Math.random() < 0.5 ? [rand(24, 31), rand(17, 21)] : [rand(4, 30), rand(-11, -13)];
  if (role === 'robot') return [rand(-5, 6), rand(-11, 11)];
  if (role === 'idle') return [rand(-6, 6), rand(16, 20)];
  const z = STATIONS[role].zone; return [rand(z[0] + 0.6, z[1] - 0.6), rand(z[2] + 0.6, z[3] - 0.6)];
}
function desiredPeople() {
  const list = [];
  ORDER.forEach((k) => { for (let i = 0; i < S.assign[k]; i++) list.push(k); });
  for (let i = 0; i < S.idle; i++) list.push('idle');
  ['tech', 'robot', 'analyst'].forEach((r) => { for (let i = 0; i < S.roles[r]; i++) list.push(r); });
  S.training.forEach(() => list.push('trainee'));
  return list;
}
function syncPeople() {
  const want = desiredPeople();
  const counts = {}; want.forEach((r) => (counts[r] = (counts[r] || 0) + 1));
  const have = {}; npcs.forEach((n) => (have[n.role] = (have[n.role] || 0) + 1));
  for (let i = npcs.length - 1; i >= 0; i--) { const n = npcs[i]; if ((have[n.role] || 0) > (counts[n.role] || 0)) { have[n.role]--; scene.remove(n.g); npcs.splice(i, 1); } }
  for (const r in counts) {
    for (let k = have[r] || 0; k < counts[r]; k++) {
      const color = r === 'trainee' ? TRAINEE : ROLES[r] ? ROLES[r].color : r === 'idle' ? 0x6a6862 : VEST;
      const g = person(color); const [x, z] = roleSpot(r); g.position.set(x, 0, z);
      npcs.push({ g, role: r, target: new THREE.Vector3(...[x, 0, z]), wait: rand(0, 2) });
    }
  }
}
function updatePeople(dt) {
  const work = !!(S && S.running && S.speed > 0);
  for (const n of npcs) {
    n.wait -= dt;
    const d = n.target.clone().sub(n.g.position); d.y = 0; const l = d.length();
    if (l < 0.2) { if (n.wait <= 0) { const [x, z] = roleSpot(n.role); n.target.set(x, 0, z); n.wait = rand(0.5, 3); n.g.userData.carry.visible = work && ORDER.includes(n.role) && Math.random() < 0.6; } continue; }
    const sp = (work ? 1.7 : 0.6) * Math.min(2, (S && S.speed) || 1) * dt;
    n.g.position.addScaledVector(d.normalize(), Math.min(l, sp));
    n.g.rotation.y = Math.atan2(d.x, d.z);
    n.g.position.y = Math.abs(Math.sin(performance.now() / 160 + n.g.id)) * 0.05;
  }
}

function makeBeacon(p) {
  const g = new THREE.Group();
  const c = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.1, 4), new THREE.MeshBasicMaterial({ color: 0xff5b1f })); c.rotation.x = Math.PI; c.position.y = 3; g.add(c);
  const r = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.1, 32), new THREE.MeshBasicMaterial({ color: 0xff5b1f, transparent: true, opacity: 0.7, side: THREE.DoubleSide })); r.rotation.x = -Math.PI / 2; r.position.y = 0.04; g.add(r);
  const l = new THREE.PointLight(0xff5b1f, 6, 7, 2); l.position.y = 2; g.add(l);
  g.position.copy(p); scene.add(g); g.userData = { cone: c, ring: r };
  return g;
}

const labels = {};
function label(key, text, cls = '') { const el = document.createElement('div'); el.className = 'label3d ' + cls; el.textContent = text; document.body.appendChild(el); labels[key] = { el }; return el; }
ORDER.forEach((k) => label(k, STATIONS[k].name));
label('office', 'Office & training');
label('maint', 'Maintenance');
const labelPos = { office: OFFICE_POS, maint: [27, 18.5] };
const _v = new THREE.Vector3();
function updateLabels() {
  const neck = S && S.running ? bottleneck() : null;
  for (const k in labels) {
    const p = STATIONS[k] ? STATIONS[k].pos : labelPos[k];
    _v.set(p[0], STATIONS[k] ? 4.8 : 3, p[1]).project(camera);
    const el = labels[k].el;
    if (_v.z > 1 || !S || !S.running && !S.over) { el.style.display = 'none'; continue; }
    el.style.display = ''; el.style.left = ((_v.x + 1) / 2) * innerWidth + 'px'; el.style.top = ((1 - _v.y) / 2) * innerHeight + 'px';
    el.classList.toggle('neck', k === neck);
    el.textContent = STATIONS[k] ? STATIONS[k].name + (k === neck ? ' · bottleneck' : '') : labels[k].el.textContent;
  }
}

const GW = W, GD = D, grid = new Uint8Array(GW * GD), dist = new Int32Array(GW * GD), q = new Int32Array(GW * GD);
const gi = (x, z) => clamp(Math.floor(x + W / 2), 0, GW - 1) + clamp(Math.floor(z + D / 2), 0, GD - 1) * GW;
for (let j = 0; j < GD; j++) for (let i = 0; i < GW; i++) {
  const x = i - W / 2 + 0.5, z = j - D / 2 + 0.5;
  grid[j * GW + i] = colliders.some((c) => x > c.minX - 0.45 && x < c.maxX + 0.45 && z > c.minZ - 0.45 && z < c.maxZ + 0.45) ? 1 : 0;
}
let navTarget = null;
function navTo(x, z) {
  const t = gi(x, z); if (grid[t]) return false;
  dist.fill(-1); let h = 0, tl = 0; q[tl++] = t; dist[t] = 0;
  while (h < tl) { const k = q[h++], i = k % GW, j = (k / GW) | 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= GW || nj >= GD) continue; const nk = nj * GW + ni; if (grid[nk] || dist[nk] >= 0) continue; dist[nk] = dist[k] + 1; q[tl++] = nk; } }
  navTarget = new THREE.Vector3(x, 0, z); return true;
}
function navStep(pos, out) {
  const k = gi(pos.x, pos.z), i = k % GW, j = (k / GW) | 0;
  if (dist[k] <= 1) return out.set(navTarget.x - pos.x, 0, navTarget.z - pos.z);
  let best = dist[k] < 0 ? 1e9 : dist[k], bi = i, bj = j;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    const ni = i + di, nj = j + dj; if ((!di && !dj) || ni < 0 || nj < 0 || ni >= GW || nj >= GD) continue;
    const nk = nj * GW + ni; if (dist[nk] < 0 || (di && dj && (grid[j * GW + ni] || grid[nj * GW + i]))) continue;
    if (dist[nk] < best) { best = dist[nk]; bi = ni; bj = nj; }
  }
  return out.set(bi - W / 2 + 0.5 - pos.x, 0, bj - D / 2 + 0.5 - pos.z);
}
function collide(p, r) {
  for (const c of colliders) {
    const cx = clamp(p.x, c.minX, c.maxX), cz = clamp(p.z, c.minZ, c.maxZ), dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
    if (d2 < r * r && d2 > 1e-9) { const d = Math.sqrt(d2); p.x += (dx / d) * (r - d); p.z += (dz / d) * (r - d); }
  }
  p.x = clamp(p.x, -W / 2 + 0.5, W / 2 - 0.5); p.z = clamp(p.z, -D / 2 + 0.5, D / 2 - 0.5);
}

const keys = new Set();
const cam = { yaw: 0.35, dist: isTouch ? 30 : 26, drag: null };
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (!S || !S.running) return;
  if (modalOpen()) { if (k === 'escape') closeModal(); return; }
  keys.add(k);
  if (k === 'e') interact();
  if (k === 'o') openOffice();
  if (k === ' ') { e.preventDefault(); setSpeed(S.speed ? 0 : 1); }
  if (k === '1') setSpeed(1); if (k === '2') setSpeed(2); if (k === '3') setSpeed(4);
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let downAt = null;
canvas.addEventListener('pointerdown', (e) => { if (e.button === 2 || e.pointerType === 'touch' && e.isPrimary === false) cam.drag = { x: e.clientX, yaw: cam.yaw }; else downAt = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointermove', (e) => { if (cam.drag) cam.yaw = cam.drag.yaw - (e.clientX - cam.drag.x) * 0.006; });
window.addEventListener('pointerup', (e) => {
  cam.drag = null;
  if (!downAt || !S?.running || modalOpen()) { downAt = null; return; }
  if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 8) { downAt = null; return; }
  downAt = null;
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera);
  for (const a of S.anomalies) { if (ray.intersectObject(a.marker, true).length) { navTo(a.pos.x, a.pos.z); return; } }
  const hit = ray.intersectObjects(scene.children.filter((o) => o.name === 'floor'))[0];
  if (hit) { const p = hit.point; if (!navTo(clamp(p.x, -W / 2 + 1, W / 2 - 1), clamp(p.z, -D / 2 + 1, D / 2 - 1))) toast('Can’t walk there'); }
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => { cam.dist = clamp(cam.dist * (e.deltaY > 0 ? 1.1 : 0.9), 12, 60); }, { passive: true });

const _mv = new THREE.Vector3();
function updatePlayer(dt) {
  let fx = 0, fz = 0;
  if (keys.has('w') || keys.has('arrowup')) fz -= 1; if (keys.has('s') || keys.has('arrowdown')) fz += 1;
  if (keys.has('a') || keys.has('arrowleft')) fx -= 1; if (keys.has('d') || keys.has('arrowright')) fx += 1;
  const sp = 7.5 * dt;
  if (fx || fz) {
    navTarget = null;
    const c = Math.cos(cam.yaw), s = Math.sin(cam.yaw), l = Math.hypot(fx, fz);
    _mv.set((fx * c + fz * s) / l, 0, (-fx * s + fz * c) / l);
  } else if (navTarget) {
    navStep(player.position, _mv); const l = _mv.length();
    if (player.position.distanceTo(navTarget) < 0.3) { navTarget = null; _mv.set(0, 0, 0); } else if (l > 1e-6) _mv.divideScalar(l);
  } else _mv.set(0, 0, 0);
  if (_mv.lengthSq() > 0) {
    player.position.addScaledVector(_mv, sp); collide(player.position, 0.35);
    player.rotation.y = Math.atan2(_mv.x, _mv.z);
    player.position.y = Math.abs(Math.sin(performance.now() / 120)) * 0.06;
  }
  ring.material.opacity = 0.5 + Math.sin(performance.now() / 300) * 0.3;
  const cx = player.position.x + Math.sin(cam.yaw) * cam.dist * 0.62, cz = player.position.z + Math.cos(cam.yaw) * cam.dist * 0.62;
  camera.position.lerp(_v.set(cx, cam.dist * 0.78, cz), Math.min(1, dt * 5));
  camera.lookAt(player.position.x, 0.5, player.position.z);
  updatePrompt();
}

function nearest() {
  const p = player.position;
  for (const a of S.anomalies) if (p.distanceTo(a.pos) < 3.2) return { type: 'anomaly', a };
  for (const k of ORDER) { const z = STATIONS[k].zone; if (p.x > z[0] - 1 && p.x < z[1] + 1 && p.z > z[2] - 1 && p.z < z[3] + 1) return { type: 'station', k }; }
  if (p.x < -19 && p.z > 15) return { type: 'office' };
  return null;
}
let promptFor = null;
function updatePrompt() {
  const n = nearest(); promptFor = n; const el = $('prompt');
  if (!n || modalOpen()) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `<kbd>E</kbd>${n.type === 'anomaly' ? 'Handle: ' + n.a.ev.title : n.type === 'office' ? 'Open the office' : 'Manage ' + STATIONS[n.k].name}`;
}
$('prompt').addEventListener('click', interact);
function interact() {
  const n = promptFor; if (!n) return;
  if (n.type === 'anomaly') openDecision(n.a);
  else if (n.type === 'office') openOffice();
  else openStation(n.k);
}

function hourTick() {
  S.t += 1;
  S.mods = S.mods.filter((m) => m.until > S.t);
  if (S.overtime > 0) S.overtime -= 1;
  const dDay = demandDay();
  S.backlog += (dDay / SHIFT_HOURS) * rand(0.85, 1.15);
  const thr = Math.min(...ORDER.map(capacity));
  const shipped = Math.min(thr, S.backlog);
  S.backlog -= shipped; S.lastThru = thr;
  const err = errorRate();
  const revenue = shipped * PRICE, errCost = shipped * err * ERROR_COST;
  const wageMult = (S.overtime > 0 ? 1.5 : 1) * (S.flags.reducedUntil >= S.day ? 0.9 : 1);
  const wages = headcount() * WAGE * wageMult;
  S.cash += revenue - errCost - wages;
  S.today.shipped += shipped; S.today.revenue += revenue; S.today.cost += errCost + wages;
  S.shippedTotal += shipped; S.errorsTotal += shipped * err;
  const backlogDays = S.backlog / dDay;
  const target = clamp(100 - backlogDays * 45 - err * 400, 0, 100);
  S.csat = clamp(S.csat + (target - S.csat) * 0.07, 0, 100);
  S.morale = clamp(S.morale, 0, 100);
  for (const a of [...S.anomalies]) if (S.t >= a.deadline) { toast(`Missed: ${a.ev.title}. ${a.ev.options[a.ev.def].label} by default.`); resolveAnomaly(a, a.ev.def); }
  S.nextAnomaly -= 1;
  if (S.nextAnomaly <= 0) { spawnAnomaly(); S.nextAnomaly = rand(6, 14); }
  S.hour += 1;
  if (S.hour >= SHIFT_START + SHIFT_HOURS) endOfDay();
  updateQueue(); renderHud();
}
function endOfDay() {
  const energy = ENERGY * (has('solar') && staffing().solar ? 0.5 : 1);
  S.cash -= OVERHEAD + energy;
  S.training.forEach((t) => (t.days -= 1));
  S.training.filter((t) => t.days <= 0).forEach((t) => { S.roles[t.role] += 1; S.trainedTotal += 1; toast(`${ROLES[t.role].name} certified`); });
  S.training = S.training.filter((t) => t.days > 0);
  const fear = Math.max(0, modernisation() * 0.3 - (S.trainedTotal + S.training.length) * 4);
  const bonus = Math.min(15, S.trainedTotal * 2.5) + (has('ergo') ? 6 : 0) + (has('solar') ? 3 : 0) + (S.idle > 2 ? -3 : 0);
  const mTarget = clamp(60 + bonus - fear - (S.overtime > 0 ? 6 : 0), 5, 95);
  S.morale = clamp(S.morale + (mTarget - S.morale) * 0.3, 0, 100);
  if (S.flags.spikeEnd && S.day >= S.flags.spikeEnd) { S.spike = 1; S.flags.spikeEnd = 0; }
  const rep = `Day ${S.day}: shipped ${Math.round(S.today.shipped)} · net ${money(S.today.revenue - S.today.cost - OVERHEAD - energy)}`;
  S.today = { shipped: 0, revenue: 0, cost: 0 };
  S.day += 1; S.hour = SHIFT_START;
  syncPeople();
  toast(rep);
  checkEnd();
}
function checkEnd() {
  const m = modernisation();
  if (m >= 85 && S.csat >= 70 && S.cash >= 0 && S.layoffs === 0) return endGame('win');
  if (S.cash < -15000) return endGame('bankrupt');
  if (S.morale < 12) return endGame('strike');
  if (S.csat < 15) return endGame('client');
}
function layoff(n) { S.layoffs += n; endGame('layoff'); }

let toastT = 0;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); toastT = 3.2; }
function setSpeed(s) { S.speed = s; document.querySelectorAll('[data-speed]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === s))); }
document.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => S && setSpeed(Number(b.dataset.speed))));
$('collapse').addEventListener('click', () => { const h = $('hudLeft'); h.classList.toggle('collapsed'); $('collapse').setAttribute('aria-expanded', String(!h.classList.contains('collapsed'))); });

function renderHud() {
  $('tDay').textContent = `Day ${S.day}`;
  $('tHour').textContent = `${String(S.hour).padStart(2, '0')}:${String(Math.floor(S.frac * 60)).padStart(2, '0')}`;
  $('kCash').textContent = money(S.cash); $('kCash').style.color = S.cash < 0 ? 'var(--accent)' : '';
  $('kDemand').textContent = Math.round(demandDay()) + (S.spike > 1 ? ' ↑' : '');
  $('kThru').textContent = S.lastThru.toFixed(1);
  $('kBacklog').textContent = Math.round(S.backlog);
  $('kCsat').textContent = Math.round(S.csat); $('mCsat').style.width = S.csat + '%'; $('mCsat').style.background = S.csat < 40 ? 'var(--accent)' : S.csat < 70 ? 'var(--warn)' : 'var(--ok)';
  $('kMorale').textContent = Math.round(S.morale); $('mMorale').style.width = S.morale + '%'; $('mMorale').style.background = S.morale < 35 ? 'var(--accent)' : S.morale < 60 ? 'var(--warn)' : 'var(--ok)';
  $('kErr').textContent = (errorRate() * 100).toFixed(1) + '%';
  $('kHead').textContent = headcount();
  $('kLayoff').textContent = S.layoffs ? `${S.layoffs} laid off` : '0 layoffs'; $('kLayoff').className = 'badge ' + (S.layoffs ? 'bad' : 'ok');
  const m = modernisation(); $('kModern').textContent = Math.round(m) + '%'; $('mModern').style.width = m + '%';
  const neck = bottleneck(), caps = ORDER.map(capacity), mx = Math.max(...caps);
  $('stationList').innerHTML = ORDER.map((k, i) => `<li class="${k === neck ? 'neck' : ''}"><button data-st="${k}">
    <span class="nm">${STATIONS[k].name}${k === neck ? '<em>bottleneck</em>' : ''}</span><span class="cap">${S.assign[k]} staff · ${caps[i].toFixed(1)}/hr</span>
    <i class="meter"><i style="width:${(caps[i] / mx) * 100}%"></i></i></button></li>`).join('');
}
$('stationList').addEventListener('click', (e) => { const b = e.target.closest('[data-st]'); if (b) openStation(b.dataset.st); });
$('officeBtn').addEventListener('click', openOffice);

function renderAlerts() {
  $('alerts').innerHTML = S.anomalies.map((a, i) => `<div class="alert"><b>${a.ev.title}</b><span>${STATIONS[a.st] ? STATIONS[a.st].name : 'Office'}</span>
    <div class="row"><span>${Math.max(0, Math.ceil(a.deadline - S.t))}h to respond</span><button data-go="${i}">Go there</button></div></div>`).join('');
}
$('alerts').addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) { const a = S.anomalies[Number(b.dataset.go)]; if (a) { navTo(a.pos.x, a.pos.z); toast('Walking to ' + a.ev.title.toLowerCase()); } } });

let prevSpeed = 1;
const modalOpen = () => !$('modal').hidden;
function openModal(html) { if (!modalOpen()) { prevSpeed = S.speed; setSpeed(0); } $('modalBody').innerHTML = html; $('modal').hidden = false; keys.clear(); }
function closeModal() { $('modal').hidden = true; if (S.running) setSpeed(prevSpeed || 1); renderHud(); }
$('modal').addEventListener('click', (e) => { if (S?.over) return; if (e.target.id === 'modal' || e.target.closest('[data-close]')) closeModal(); });

function upgradeCard(u) {
  const owned = has(u.id), staffed = staffing()[u.id];
  const req = Object.entries(u.roles).map(([r, n]) => `${n} ${ROLES[r].name.toLowerCase()}${n > 1 ? 's' : ''}`).join(', ');
  const boosts = Object.entries(u.boost).map(([s, b]) => `${STATIONS[s].name} +${Math.round(b * 100)}%`).join(' · ');
  return `<div class="ucard ${owned ? 'owned' : ''}"><div class="top"><b>${u.name}</b><span class="price" ${owned && !staffed ? 'style="color:var(--accent-2)"' : ''}>${owned ? (staffed ? 'Running' : 'Needs staff') : money(u.cost)}</span></div>
    <span class="desc">${u.desc}${boosts ? '<br>' + boosts : ''}${u.errCut ? ` · errors −${Math.round(u.errCut * 100)}%` : ''}</span>
    <span class="req ${owned && !staffed ? 'miss' : ''}">${req ? 'Needs ' + req + (owned && !staffed ? ' (running at 40%)' : '') : 'No special staff needed'} · +${u.weight}% modernisation</span>
    ${owned ? '' : `<button data-buy="${u.id}" ${S.cash < u.cost - 15000 ? 'disabled' : ''}>Buy</button>`}</div>`;
}
function buy(id) {
  const u = UMAP[id]; if (has(id)) return;
  if (S.cash - u.cost < -15000) return toast('Not enough credit');
  S.cash -= u.cost; S.owned.push(id); showUpgrade(id);
  if (u.morale) S.morale = clamp(S.morale + u.morale, 0, 100);
  toast(`${u.name} installed`);
  renderHud();
}

function openStation(k) {
  const s = STATIONS[k], neck = bottleneck() === k;
  const ups = UPGRADES.filter((u) => u.boost[k]);
  openModal(`<div class="m-head"><div><p class="kicker">Station</p><h2>${s.name}${neck ? ' <em>· bottleneck</em>' : ''}</h2></div><button class="close" data-close>Close · Esc</button></div>
    <p>${s.blurb}</p>
    <div class="stepper"><button data-dec="${k}" aria-label="Remove a worker">−</button><b>${S.assign[k]}</b><button data-inc="${k}" aria-label="Add a worker">+</button>
      <span class="muted">workers · ${S.idle} unassigned</span></div>
    <div class="facts"><div><span>Capacity</span><b>${capacity(k).toFixed(1)}/hr</b></div><div><span>Per worker</span><b>${(capacity(k) / Math.max(1, S.assign[k])).toFixed(2)}/hr</b></div><div><span>Flow output</span><b>${Math.min(...ORDER.map(capacity)).toFixed(1)}/hr</b></div></div>
    <h3 class="m-sec">Upgrades for this station</h3><div class="cards">${ups.map(upgradeCard).join('') || '<p>No direct upgrades.</p>'}</div>`);
  bindModal(() => openStation(k));
}
function openOffice() {
  const need = rolesNeeded();
  openModal(`<div class="m-head"><div><p class="kicker">Office</p><h2>Plan the floor.</h2></div><button class="close" data-close>Close · Esc</button></div>
    <div class="facts"><div><span>Cash</span><b>${money(S.cash)}</b></div><div><span>Credit line</span><b>to −$15,000</b></div><div><span>Wages / day</span><b>${money(headcount() * WAGE * SHIFT_HOURS)}</b></div></div>
    <h3 class="m-sec">Reskill your people · uses 1 unassigned worker</h3>
    <div class="roles">${Object.entries(ROLES).map(([r, R]) => `<div class="ucard"><div class="top"><b>${R.name}</b><span class="price">${money(R.cost)}</span></div>
      <span class="desc">${R.days} days of training. Have ${S.roles[r]}, in training ${S.training.filter((t) => t.role === r).length}, needed by your kit ${need[r]}.</span>
      <button data-train="${r}" ${S.idle < 1 ? 'disabled' : ''}>Start training</button></div>`).join('')}</div>
    ${S.idle < 1 ? '<p class="cap" style="color:var(--accent-2);font-size:12px;margin-top:8px">No one is unassigned. Free someone up from a station that has spare capacity, or hire.</p>' : ''}
    <h3 class="m-sec">Upgrades</h3><div class="cards">${UPGRADES.map(upgradeCard).join('')}</div>
    <h3 class="m-sec">People</h3>
    <div class="options">
      <button class="opt" data-hire><b>Hire a new worker · $800</b><span>Adds an unassigned worker. Wages ${money(WAGE * SHIFT_HOURS)}/day.</span></button>
      <button class="opt danger" data-layoff><b>Reduce headcount by 4</b><span>Saves wages, but ends the challenge. The brief is zero layoffs.</span></button>
    </div>`);
  bindModal(openOffice);
}
function bindModal(refresh) {
  const body = $('modalBody');
  body.onclick = (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.inc && S.idle > 0) { S.assign[t.dataset.inc]++; S.idle--; syncPeople(); refresh(); }
    else if (t.dataset.inc) toast('No unassigned workers. Free one from another station or hire.');
    if (t.dataset.dec && S.assign[t.dataset.dec] > 0) { S.assign[t.dataset.dec]--; S.idle++; syncPeople(); refresh(); }
    if (t.dataset.buy) { buy(t.dataset.buy); refresh(); }
    if (t.dataset.train && S.idle > 0) { const R = ROLES[t.dataset.train]; if (S.cash - R.cost < -15000) return toast('Not enough credit'); S.cash -= R.cost; S.idle--; S.training.push({ role: t.dataset.train, days: R.days }); S.morale = clamp(S.morale + 3, 0, 100); syncPeople(); toast(`Training started: ${R.name}`); refresh(); }
    if (t.hasAttribute('data-hire')) { if (S.cash - 800 < -15000) return toast('Not enough credit'); S.cash -= 800; S.idle++; S.hires++; syncPeople(); toast('New hire joined'); refresh(); }
    if (t.hasAttribute('data-layoff')) { $('modal').hidden = true; layoff(4); }
    renderHud();
  };
}
function openDecision(a) {
  openModal(`<div class="m-head"><div><p class="kicker">${STATIONS[a.st] ? STATIONS[a.st].name : 'Office'} · ${Math.max(0, Math.ceil(a.deadline - S.t))}h to decide</p><h2>${a.ev.title}</h2></div><button class="close" data-close>Later</button></div>
    <p>${a.ev.text(a)}</p>
    <div class="options">${a.ev.options.map((o, i) => `<button class="opt ${o.danger ? 'danger' : ''}" data-opt="${i}" ${o.req && !o.req() ? 'disabled' : ''}><b>${o.label}</b><span>${o.desc}${o.req && !o.req() ? ' (you don’t have this role yet)' : ''}</span></button>`).join('')}</div>`);
  $('modalBody').onclick = (e) => {
    const b = e.target.closest('[data-opt]'); if (!b || b.disabled) return;
    const danger = a.ev.options[Number(b.dataset.opt)].danger;
    if (!danger) closeModal(); else $('modal').hidden = true;
    resolveAnomaly(a, Number(b.dataset.opt)); renderHud();
  };
}

function endGame(kind) {
  if (S.over) return;
  S.over = true; S.running = false; setSpeed(0);
  $('prompt').hidden = true;
  const titles = {
    win: ['Modernised, <em>and everyone kept their job.</em>', `You reached ${Math.round(modernisation())}% modernisation on day ${S.day} with zero layoffs. ${S.trainedTotal} people moved into new skilled roles.`],
    layoff: ['Brief <em>broken.</em>', 'You laid people off. Cutting staff can look efficient on a spreadsheet, but the challenge was to modernise with your people, through reskilling, rebalancing and better tools.'],
    bankrupt: ['Out of <em>cash.</em>', 'The credit line ran out. Balance upgrade spending with throughput: fix the bottleneck first, since that is where revenue comes from.'],
    strike: ['The crew <em>walked out.</em>', 'Morale collapsed. Automation without reskilling and communication breeds fear. Train people early and talk to them.'],
    client: ['Lost the <em>key client.</em>', 'Customer satisfaction fell too far. Watch the backlog and error rate, and fix the slowest station first.'],
  }[kind];
  openModal(`<p class="kicker">${kind === 'win' ? 'Challenge complete' : 'Game over'}</p><h2>${titles[0]}</h2><p>${titles[1]}</p>
    <div class="end-stats"><div><span>Days</span><b>${S.day}</b></div><div><span>Modernisation</span><b>${Math.round(modernisation())}%</b></div><div><span>Layoffs</span><b>${S.layoffs}</b></div>
    <div><span>Orders shipped</span><b>${Math.round(S.shippedTotal).toLocaleString()}</b></div><div><span>Reskilled</span><b>${S.trainedTotal}</b></div><div><span>Cash</span><b>${money(S.cash)}</b></div></div>
    <div class="actions"><button class="btn btn-solid" data-restart>Run it again</button><a class="btn" href="../index.html#play">Back to portfolio</a></div>`);
  $('modalBody').onclick = (e) => { if (e.target.closest('[data-restart]')) location.reload(); };
}

function start() {
  newState(); syncPeople(); updateQueue();
  S.running = true; setSpeed(1);
  $('intro').hidden = true; $('hudLeft').hidden = false; $('alerts').hidden = false;
  if (innerWidth < 900) $('hudLeft').classList.add('collapsed');
  renderHud(); renderAlerts();
  toast('Tip: the station marked “bottleneck” limits everything. Click it in the Flow list.');
}
$('startBtn').addEventListener('click', start);

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (S && S.running) {
    updatePlayer(dt);
    if (S.speed > 0 && !modalOpen()) {
      S.frac += (dt * S.speed) / 4;
      while (S.frac >= 1 && S.running) { S.frac -= 1; hourTick(); }
      if (Math.floor(now / 500) !== Math.floor((now - dt * 1000) / 500)) { renderHud(); renderAlerts(); }
    }
  } else {
    const t = now / 1000; camera.position.set(Math.sin(t * 0.06) * 48, 34, Math.cos(t * 0.06) * 40); camera.lookAt(0, 0, 0);
  }
  updatePeople(dt);
  if (conveyorBoxes.count) {
    const sp = (S?.speed || 0) * 2;
    for (let i = 0; i < conveyorBoxes.count; i++) { const x = 3 + ((i * 1.2 + (now / 1000) * sp) % 28); _m4.compose(_p.set(x, 1.15, -12.2), _q.identity(), _s.set(0.6, 0.4, 0.5)); conveyorBoxes.setMatrixAt(i, _m4); }
    conveyorBoxes.instanceMatrix.needsUpdate = true;
  }
  amrs.forEach((a) => {
    a.i += dt * a.sp * (S?.speed ? Math.min(2, S.speed) : 0.3) / 6;
    const n = a.path.length, k = Math.floor(a.i) % n, f = a.i % 1, p0 = a.path[k], p1 = a.path[(k + 1) % n];
    a.r.position.set(p0[0] + (p1[0] - p0[0]) * f, 0, p0[1] + (p1[1] - p0[1]) * f); a.r.rotation.y = Math.atan2(p1[0] - p0[0], p1[1] - p0[1]);
  });
  if (S) S.anomalies.forEach((a) => { a.marker.userData.cone.position.y = 3 + Math.sin(now / 200) * 0.3; a.marker.userData.ring.scale.setScalar(1 + (now / 800) % 1); a.marker.userData.ring.material.opacity = 1 - (now / 800) % 1; });
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').classList.remove('on'); }
  updateLabels();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
window.addEventListener('resize', resize); resize();
requestAnimationFrame(frame);
let speedBeforeAbout = null;
window.addEventListener('aboutopen', () => { if (S?.running && !modalOpen()) { speedBeforeAbout = S.speed; setSpeed(0); } });
window.addEventListener('aboutclose', () => { if (S?.running && speedBeforeAbout !== null && !modalOpen()) setSpeed(speedBeforeAbout || 1); speedBeforeAbout = null; });
window.__wh = { get S() { return S; }, hourTick, spawnAnomaly, openOffice, buy, endOfDay, capacity, bottleneck, modernisation };
