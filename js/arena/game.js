import * as THREE from 'three';
import { MAPS } from './maps.js';
import { WEAPONS, PRIMARIES, falloff } from './weapons.js';
import { Net, roomCode } from './net.js';
import { buildWorld } from './world.js';
import { makeSoldier, setSoldierWeapon, animateSoldier } from './avatar.js';
import { createGyro, mountGyroSettings } from '../gyro.js';
import { createAim, mountAimSettings, fromTouch, firePad } from '../aim.js';
import { createSens, mountSensSettings } from '../sens.js';
import { createControls, createLayout, mountControlsPanel } from '../controls.js';
import { createNotify, mountNotifySettings } from '../notify.js';
import { createAssist, mountAssistSettings } from '../assist.js';
import * as ST from '../stance.js';

const $ = (id) => document.getElementById(id);
const isTouch = window.matchMedia('(pointer: coarse)').matches;
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const now = () => performance.now() / 1000;
const r2 = (v) => Math.round(v * 100) / 100;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const COLORS = [0xff5b1f, 0x5b8def, 0x8fd18a, 0xffc857, 0xb98cff, 0x6fe3e3, 0xff7ab6, 0xd9d6cf];
const BOT_NAMES = ['Ada', 'Turing', 'Hopper', 'Lovelace', 'Shannon', 'Knuth', 'Dijkstra', 'Noether'];
const EYE = 1.6, RADIUS = 0.4, SPEED = 6, GRAV = 22, JUMP = 7.2, REGEN_DELAY = 5, REGEN_RATE = 20, RESPAWN = 3, TICK = 1 / 20, MAX_PLAYERS = 8;
const hexCss = (c) => '#' + new THREE.Color(c).getHexString();

const canvas = $('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouch, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouch ? 1.5 : 2));
renderer.shadowMap.enabled = !isTouch; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
const BASE_FOV = isTouch ? 80 : 75;
const camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.05, 400); camera.rotation.order = 'YXZ'; scene.add(camera);

const vm = new THREE.Group(); camera.add(vm);
const gm = new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.45, metalness: 0.6 }), gm2 = new THREE.MeshStandardMaterial({ color: 0x4b463f, roughness: 0.7 });
const bx = (w, h, d, m, x, y, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); return o; };
const VIEW = {
  pistol: () => [bx(0.07, 0.09, 0.3, gm, 0, 0, -0.05), bx(0.06, 0.14, 0.08, gm2, 0, -0.1, 0.05)],
  smg: () => [bx(0.08, 0.1, 0.42, gm, 0, 0, -0.08), bx(0.05, 0.16, 0.06, gm2, 0, -0.12, -0.06), bx(0.06, 0.12, 0.1, gm2, 0, -0.08, 0.12)],
  ar: () => [bx(0.08, 0.11, 0.72, gm, 0, 0, -0.2), bx(0.05, 0.17, 0.07, gm2, 0, -0.13, -0.12), bx(0.07, 0.13, 0.24, gm2, 0, -0.03, 0.2), bx(0.04, 0.05, 0.14, gm, 0, 0.09, -0.12)],
  shotgun: () => [bx(0.09, 0.09, 0.66, gm, 0, 0, -0.18), bx(0.07, 0.07, 0.42, gm2, 0, -0.08, -0.22), bx(0.07, 0.14, 0.22, gm2, 0, -0.06, 0.2)],
  sniper: () => [bx(0.08, 0.1, 0.95, gm, 0, 0, -0.3), (() => { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.3, 12), gm); s.rotation.x = Math.PI / 2; s.position.set(0, 0.09, -0.12); return s; })(), bx(0.07, 0.15, 0.26, gm2, 0, -0.05, 0.25)],
};
const viewModels = {};
Object.keys(WEAPONS).forEach((w) => { const g = new THREE.Group(); VIEW[w]().forEach((m) => g.add(m)); g.visible = false; vm.add(g); viewModels[w] = g; });
const muzzle = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
vm.add(muzzle);
const MUZZLE_Z = { pistol: -0.24, smg: -0.32, ar: -0.6, shotgun: -0.54, sniper: -0.8 };

const tracers = [];
for (let i = 0; i < 60; i++) {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffd6a0, transparent: true, opacity: 0 })); l.frustumCulled = false; scene.add(l); tracers.push({ l, life: 0 });
}
let trI = 0;
function tracer(a, b) { const t = tracers[trI]; trI = (trI + 1) % tracers.length; const p = t.l.geometry.attributes.position.array; p.set([a[0], a[1], a[2], b[0], b[1], b[2]]); t.l.geometry.attributes.position.needsUpdate = true; t.life = 0.07; }
let actx = null, nbuf = null;
function sfx(kind, vol = 1) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (!nbuf) { nbuf = actx.createBuffer(1, actx.sampleRate * 0.6, actx.sampleRate); const d = nbuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    const t = actx.currentTime, g = actx.createGain(); g.connect(actx.destination);
    const noise = (dur, v, f) => { const s = actx.createBufferSource(); s.buffer = nbuf; const fl = actx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = f; s.connect(fl).connect(g); g.gain.setValueAtTime(v * vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); s.start(t); s.stop(t + dur); };
    const tone = (f0, f1, dur, v, type = 'square') => { const o = actx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur); o.connect(g); g.gain.setValueAtTime(v * vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.start(t); o.stop(t + dur); };
    ({ pistol: () => noise(0.12, 0.22, 2600), smg: () => noise(0.07, 0.15, 3200), ar: () => noise(0.12, 0.22, 2200), shotgun: () => noise(0.32, 0.4, 1400), sniper: () => noise(0.5, 0.45, 1100),
      hit: () => tone(1000, 700, 0.05, 0.05), head: () => tone(1500, 1000, 0.08, 0.07), hurt: () => tone(170, 80, 0.2, 0.1, 'sawtooth'), pick: () => tone(700, 1200, 0.12, 0.06, 'triangle'),
      reload: () => tone(300, 520, 0.1, 0.04, 'triangle'), empty: () => tone(200, 180, 0.05, 0.05), kill: () => tone(600, 1300, 0.25, 0.08, 'triangle') })[kind]?.();
  } catch {}
}

const G = { mode: 'menu', role: null, net: null, mapId: 'foundry', world: null, limit: store.get('fo-limit', 10), bots: store.get('fo-bots', 1), botSkill: store.get('fo-botskill', 1), phase: 'lobby', code: null, quick: false, meId: null,
  players: new Map(), items: [], itemMeshes: new Map(), feed: [], acc: 0, nextItemId: 1, lonelyT: 0, autoStartAt: 0, pingT: 0, excludeSlots: new Set(), offline: false };
const L = { pos: new THREE.Vector3(), vy: 0, yaw: 0, pitch: 0, onGround: true, alive: false, hp: 100, cur: 'pistol', primary: null, pistol: { mag: 12, res: 36 },
  st: ST.createStance(), jumpReq: false, adsT: 0, adsHeld: false, adsToggle: false, reloading: 0, fireCd: 0, trigger: false, edge: false, recoil: 0, moving: 0, lastHurt: -99, killer: null, respawnAt: 0, bob: 0, pickCd: new Map() };
const sens = createSens('fo');
const aim = createAim('fo', isTouch);
const notify = createNotify('fo', document.getElementById('toast'));
const assist = createAssist('fo', isTouch);
let myName = store.get('fo-name', '') || 'Player' + Math.floor(Math.random() * 90 + 10);

function loadMap(id) {
  if (G.world) scene.remove(G.world.group);
  G.mapId = MAPS[id] ? id : 'foundry';
  G.world = buildWorld(scene, MAPS[G.mapId], { shadows: !isTouch });
}
function clearPlayers() { for (const p of G.players.values()) removeVisual(p); G.players.clear(); }
function addPlayer(id, name, bot = false, color) {
  const used = new Set([...G.players.values()].map((p) => p.color));
  const c = color ?? COLORS.find((x) => !used.has(x)) ?? COLORS[G.players.size % COLORS.length];
  const p = { id, name, color: c, bot, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, w: 'pistol', ads: 0, hp: 100, alive: false, k: 0, d: 0, pw: null, lastDmg: -99, respawnAt: 0, buf: [], ping: 0, mesh: null, label: null };
  G.players.set(id, p);
  return p;
}
function ensureVisual(p) {
  if (p.id === G.meId || p.mesh) return;
  p.mesh = makeSoldier(p.color); p.mesh.visible = false; scene.add(p.mesh); setSoldierWeapon(p.mesh, p.w); p.mesh.userData.w = p.w;
  p.label = document.createElement('div'); p.label.className = 'label3d'; p.label.innerHTML = `${esc(p.name)}<i><u></u></i>`; document.body.appendChild(p.label);
}
function removeVisual(p) { if (p.mesh) scene.remove(p.mesh); p.label?.remove(); p.mesh = null; p.label = null; }
function pushBuf(p) { p.buf.push({ t: now(), x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch }); if (p.buf.length > 30) p.buf.shift(); }
const _rp = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
function renderState(p) {
  if (G.role === 'host' && p.bot) return p;
  const b = p.buf, t = now() - 0.11;
  if (!b.length) return p;
  if (t <= b[0].t) return b[0];
  for (let i = b.length - 1; i > 0; i--) if (b[i - 1].t <= t) {
    const a = b[i - 1], c = b[i], f = clamp((t - a.t) / Math.max(1e-3, c.t - a.t), 0, 1);
    let dy = c.yaw - a.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
    _rp.x = a.x + (c.x - a.x) * f; _rp.y = a.y + (c.y - a.y) * f; _rp.z = a.z + (c.z - a.z) * f; _rp.yaw = a.yaw + dy * f; _rp.pitch = a.pitch + (c.pitch - a.pitch) * f;
    return _rp;
  }
  return b[b.length - 1];
}

const itemGeo = { ammo: new THREE.BoxGeometry(0.6, 0.4, 0.4), ring: new THREE.RingGeometry(0.55, 0.7, 32) };
const WEAPON_COLOR = { smg: 0x5b8def, ar: 0xffc857, shotgun: 0xff7a3a, sniper: 0x8fd18a, pistol: 0xd9d6cf };
function syncItemMeshes() {
  const live = new Set(G.items.filter((i) => i.active).map((i) => i.id));
  for (const [id, m] of G.itemMeshes) if (!live.has(id)) { scene.remove(m); G.itemMeshes.delete(id); }
  for (const it of G.items) {
    if (!it.active || G.itemMeshes.has(it.id)) continue;
    const g = new THREE.Group(); g.position.set(it.x, it.y, it.z);
    if (it.kind === 'ammo') {
      const crate = new THREE.Mesh(itemGeo.ammo, new THREE.MeshStandardMaterial({ color: 0x3f5a2e, emissive: 0x1a2a12 })); crate.position.y = 0.3; g.add(crate);
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.08, 0.42), new THREE.MeshBasicMaterial({ color: 0xffc857 })); band.position.y = 0.36; g.add(band);
    } else {
      const gun = new THREE.Group(); VIEW[it.w]().forEach((m) => gun.add(m)); gun.scale.setScalar(1.6); gun.rotation.y = Math.PI / 2; gun.position.y = 0.8; g.add(gun); g.userData.spin = gun;
      const ring = new THREE.Mesh(itemGeo.ring, new THREE.MeshBasicMaterial({ color: WEAPON_COLOR[it.w], transparent: true, opacity: 0.7, side: THREE.DoubleSide })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; g.add(ring);
    }
    scene.add(g); G.itemMeshes.set(it.id, g);
  }
}

const isBot = (id) => G.players.get(id)?.bot;
function toHost(msg) { if (G.role === 'host') hostOn(G.meId, msg); else G.net?.send(msg); }
function hostSend(id, msg) { if (id === G.meId) clientOn(msg); else if (!isBot(id)) G.net?.sendTo(id, msg); }
function hostBroadcast(msg) { G.net?.broadcast(msg); clientOn(msg); }
const roster = () => [...G.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, bot: p.bot }));
function broadcastRoster() { hostBroadcast({ t: 'roster', players: roster(), limit: G.limit, phase: G.phase }); }
const itemList = () => G.items.filter((i) => i.active).map((i) => ({ id: i.id, kind: i.kind, w: i.w, x: i.x, y: i.y, z: i.z }));
function broadcastItems() { hostBroadcast({ t: 'items', items: itemList() }); }

function hostOn(from, m) {
  const p = G.players.get(from);
  switch (m.t) {
    case 'hello': {
      if (G.players.size >= MAX_PLAYERS && !p) { const bot = [...G.players.values()].find((x) => x.bot); if (bot) removeBot(bot.id); else return G.net?.sendTo(from, { t: 'full' }); }
      const np = p || addPlayer(from, String(m.name || 'Player').slice(0, 14));
      ensureVisual(np);
      hostSend(from, { t: 'welcome', you: from, map: G.mapId, limit: G.limit, phase: G.phase, players: roster(), items: itemList(), quick: G.quick, code: G.code });
      broadcastRoster();
      if (G.phase === 'live') spawnPlayer(from);
      break;
    }
    case 'st':
      if (!p) return;
      Object.assign(p, { x: m.x, y: m.y, z: m.z, yaw: m.yaw, pitch: m.pitch, w: m.w, ads: m.ads, s: m.s || 0, pw: m.pw ?? null });
      if (from !== G.meId) pushBuf(p);
      break;
    case 'fx': G.net?.broadcast({ ...m, from }); if (from !== G.meId) clientOn({ ...m, from }); break;
    case 'hit': applyHit(from, m); break;
    case 'pick': handlePick(from, m.item); break;
    case 'pong': if (p) p.ping = Math.round((now() - m.ts) * 1000); break;
  }
}
function spawnPlayer(id) {
  const p = G.players.get(id); if (!p) return;
  const others = [...G.players.values()].filter((o) => o.alive && o.id !== id);
  const sp = MAPS[G.mapId].spawns.map(([x, z]) => ({ x, z, d: others.length ? Math.min(...others.map((o) => Math.hypot(o.x - x, o.z - z))) : rand(0, 100) }))
    .sort((a, b) => b.d - a.d).slice(0, 3)[Math.floor(Math.random() * 3)] || { x: 0, z: 0 };
  const yaw = Math.atan2(sp.x, sp.z);
  Object.assign(p, { x: sp.x, y: 0, z: sp.z, yaw, pitch: 0, alive: true, hp: 100, pw: null, w: 'pistol', lastDmg: -99 });
  p.buf = []; pushBuf(p);
  if (p.bot) Object.assign(p.brain, { mag: 12, reloadT: 0, target: null, react: 0, aimErr: skill().err0, repath: 0, burst: 0 });
  hostBroadcast({ t: 'spawn', id, x: sp.x, y: 0, z: sp.z, yaw });
}
function applyHit(from, m) {
  if (G.phase !== 'live') return;
  const s = G.players.get(from), v = G.players.get(m.target), W = WEAPONS[m.w];
  if (!s || !v || !W || !s.alive || !v.alive || from === m.target) return;
  const dmg = clamp(Number(m.dmg) || 0, 0, W.dmg * W.head * W.pellets + 1);
  v.hp -= dmg; v.lastDmg = now();
  hostBroadcast({ t: 'dmg', to: v.id, from, hp: Math.max(0, Math.round(v.hp)), fx: r2(s.x), fz: r2(s.z), head: !!m.head });
  if (v.hp > 0) return;
  v.hp = 0; v.alive = false; v.d++; s.k++; v.respawnAt = now() + RESPAWN;
  if (v.pw) { G.items.push({ id: G.nextItemId++, kind: 'weapon', w: v.pw, x: r2(v.x), y: r2(v.y), z: r2(v.z), active: true, dropped: true, expire: now() + 30 }); v.pw = null; broadcastItems(); }
  hostBroadcast({ t: 'kill', killer: from, victim: v.id, w: m.w, head: !!m.head });
  if (s.k >= G.limit) endMatch(from);
}
function handlePick(from, itemId) {
  const p = G.players.get(from), it = G.items.find((i) => i.id === itemId);
  if (!p || !it || !it.active || !p.alive || G.phase !== 'live') return;
  if (Math.hypot(p.x - it.x, p.z - it.z) > 2.8 || Math.abs(p.y - it.y) > 2) return;
  it.active = false;
  if (it.dropped) G.items = G.items.filter((i) => i !== it); else it.respawnAt = now() + (it.kind === 'ammo' ? 15 : 20);
  if (it.kind === 'weapon') {
    if (p.pw) G.items.push({ id: G.nextItemId++, kind: 'weapon', w: p.pw, x: r2(p.x), y: r2(p.y), z: r2(p.z), active: true, dropped: true, expire: now() + 30 });
    p.pw = it.w; p.w = it.w;
    const W = WEAPONS[it.w];
    hostSend(from, { t: 'got', kind: 'weapon', w: it.w, mag: W.mag, res: it.dropped ? Math.round(W.reserve / 2) : W.reserve });
  } else hostSend(from, { t: 'got', kind: 'ammo' });
  broadcastItems();
}
function initItems() {
  const map = MAPS[G.mapId]; G.items = []; G.nextItemId = 1;
  map.weapons.forEach(([w, x, z, y = 0]) => G.items.push({ id: G.nextItemId++, kind: 'weapon', w, x, y, z, active: true }));
  map.ammo.forEach(([x, z, y = 0]) => G.items.push({ id: G.nextItemId++, kind: 'ammo', x, y, z, active: true }));
}
function startMatch() {
  G.phase = 'live';
  for (const p of G.players.values()) { p.k = 0; p.d = 0; p.alive = false; }
  initItems();
  hostBroadcast({ t: 'phase', phase: 'live', limit: G.limit });
  broadcastItems();
  for (const id of G.players.keys()) spawnPlayer(id);
}
function endMatch(winner) {
  G.phase = 'over';
  const board = [...G.players.values()].map((p) => ({ id: p.id, name: p.name, k: p.k, d: p.d, color: p.color })).sort((a, b) => b.k - a.k || a.d - b.d);
  hostBroadcast({ t: 'end', winner, board });
}
function addBot() {
  if (G.players.size >= MAX_PLAYERS) return;
  const used = new Set([...G.players.values()].map((p) => p.name));
  const name = 'Bot ' + (BOT_NAMES.find((n) => !used.has('Bot ' + n)) || G.players.size);
  const id = 'B' + Math.random().toString(36).slice(2, 7);
  const p = addPlayer(id, name, true);
  p.brain = { field: G.world.newField(), repath: 0, goal: null, target: null, losT: 0, react: 0, aimErr: 0.08, fireCd: 0, mag: 12, reloadT: 0, strafe: 1, strafeT: 0, vy: 0 };
  ensureVisual(p);
  broadcastRoster();
  if (G.phase === 'live') spawnPlayer(id);
}
function removeBot(id) { const p = G.players.get(id); if (!p?.bot) return; removeVisual(p); G.players.delete(id); broadcastRoster(); }

function hostTick(dt) {
  const t = now();
  { const me = G.players.get(G.meId); if (me) L.hp = me.hp; }
  if (G.phase === 'live') {
    for (const p of G.players.values()) {
      if (p.alive && p.hp < 100 && t - p.lastDmg > REGEN_DELAY) p.hp = Math.min(100, p.hp + REGEN_RATE * dt);
      if (!p.alive && p.respawnAt && t >= p.respawnAt) { p.respawnAt = 0; spawnPlayer(p.id); }
    }
    let changed = false;
    for (const it of G.items) if (!it.active && !it.dropped && it.respawnAt && t >= it.respawnAt) { it.active = true; it.respawnAt = 0; changed = true; }
    const before = G.items.length; G.items = G.items.filter((i) => !(i.dropped && i.expire < t)); if (G.items.length !== before) changed = true;
    if (changed) broadcastItems();
  }
  if (G.net) {
    const rows = [...G.players.values()].map((p) => [p.id, r2(p.x), r2(p.y), r2(p.z), r2(p.yaw), r2(p.pitch), p.w, p.ads, Math.round(p.hp), p.alive ? 1 : 0, p.k, p.d, p.ping, p.s || 0]);
    G.net.broadcast({ t: 'snap', p: rows });
    G.pingT -= dt; if (G.pingT <= 0) { G.pingT = 2; G.net.broadcast({ t: 'ping', ts: t }); }
  }
  const humans = [...G.players.values()].filter((p) => !p.bot).length;
  if (G.quick && G.phase === 'lobby') {
    if (humans >= 2 && !G.autoStartAt) G.autoStartAt = t + 4;
    if (humans < 2) G.autoStartAt = 0;
    if (G.autoStartAt && t >= G.autoStartAt) { G.autoStartAt = 0; startMatch(); }
    if (humans === 1 && G.net && G.net.slot > 0) {
      G.lonelyT += dt;
      if (G.lonelyT > 4 && !G.probing) {
        G.lonelyT = 0; G.probing = true;
        G.net.probeLower().then((slot) => { G.probing = false; if (slot !== null && G.phase === 'lobby' && humans === 1) becomeClientOfMerge(); }).catch(() => (G.probing = false));
      }
    }
  }
  if (G.mode === 'lobby') renderLobby();
}

const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3();
const PREF_RANGE = { pistol: 12, smg: 10, ar: 22, shotgun: 5, sniper: 38 };
const BOT_SKILL = [
  { react: [0.9, 1.5], err0: 0.2, errMin: 0.06, errDecay: 0.03, turn: 3, strafe: 0.15, strafeT: [1.8, 3.2], strafeOdds: 0.4, head: 0.05, semi: [0.3, 0.6], burst: [2, 4], rest: [0.6, 1.1], cone: 0.15, speed: 0.8 },
  { react: [0.6, 1.0], err0: 0.14, errMin: 0.035, errDecay: 0.035, turn: 4.5, strafe: 0.35, strafeT: [1.2, 2.6], strafeOdds: 0.6, head: 0.1, semi: [0.15, 0.4], burst: [3, 6], rest: [0.4, 0.8], cone: 0.2, speed: 0.9 },
  { react: [0.35, 0.7], err0: 0.08, errMin: 0.012, errDecay: 0.05, turn: 8, strafe: 0.8, strafeT: [0.6, 1.6], strafeOdds: 1, head: 0.18, semi: [0.05, 0.25], burst: null, rest: [0, 0], cone: 0.25, speed: 1 },
];
const skill = () => BOT_SKILL[G.botSkill] || BOT_SKILL[1];
function updateBots(dt) {
  if (G.phase !== 'live') return;
  const W0 = G.world;
  for (const b of G.players.values()) {
    if (!b.bot || !b.alive) continue;
    const B = b.brain, W = WEAPONS[b.pw || 'pistol'], K = skill(); b.w = b.pw || 'pistol';
    B.losT -= dt;
    if (B.losT <= 0) {
      B.losT = 0.25; let best = null, bd = 70;
      _a.set(b.x, b.y + EYE, b.z);
      for (const o of G.players.values()) {
        if (o === b || !o.alive) continue;
        const d = Math.hypot(o.x - b.x, o.z - b.z); if (d >= bd) continue;
        _b.set(o.x, o.y + 1.3, o.z); if (W0.los(_a, _b)) { bd = d; best = o; }
      }
      if (best !== B.target) { B.target = best; B.react = rand(...K.react); B.aimErr = K.err0; B.burst = 0; }
    }
    const T = B.target;
    let goal = null;
    if (!b.pw) { let bd = 1e9; for (const it of G.items) if (it.active && it.kind === 'weapon') { const d = Math.hypot(it.x - b.x, it.z - b.z); if (d < bd) { bd = d; goal = it; } } if (goal && bd < 1.6) handlePick(b.id, goal.id); }
    if (!goal) { let bd = 1e9; for (const o of G.players.values()) if (o !== b && o.alive) { const d = Math.hypot(o.x - b.x, o.z - b.z); if (d < bd) { bd = d; goal = o; } } }
    let mx = 0, mz = 0;
    if (T) {
      const dx = T.x - b.x, dz = T.z - b.z, d = Math.hypot(dx, dz), pref = PREF_RANGE[b.w];
      B.strafeT -= dt; if (B.strafeT <= 0) { B.strafe = Math.random() < K.strafeOdds ? (Math.random() < 0.5 ? -1 : 1) : 0; B.strafeT = rand(...K.strafeT); }
      const fw = d > pref * 1.3 ? 1 : d < pref * 0.6 ? -0.7 : 0;
      mx = (dx / d) * fw + (-dz / d) * B.strafe * K.strafe; mz = (dz / d) * fw + (dx / d) * B.strafe * K.strafe;
    } else if (goal) {
      B.repath -= dt;
      if (B.repath <= 0) { W0.field(goal.x, goal.z, B.field); B.repath = 0.6; }
      W0.stepDir(B.field, b.x, b.z, _v); mx = _v.x; mz = _v.z;
    }
    const ml = Math.hypot(mx, mz);
    if (ml > 0.01) { const sp = (T && WEAPONS[b.w].scope ? 2.5 : 5) * K.speed * dt; b.x += (mx / ml) * sp; b.z += (mz / ml) * sp; }
    _v.set(b.x, b.y, b.z); W0.collide(_v, RADIUS, b.y); b.x = _v.x; b.z = _v.z;
    const fl = W0.floorAt(_v, RADIUS, b.y);
    if (b.y > fl + 0.01) { B.vy -= GRAV * dt; b.y = Math.max(fl, b.y + B.vy * dt); } else { b.y = fl; B.vy = 0; }
    if (T) {
      const dx = T.x - b.x, dz = T.z - b.z, dy = T.y + 1.3 - (b.y + EYE), d = Math.hypot(dx, dz);
      const wantYaw = Math.atan2(-dx, -dz), wantPitch = Math.atan2(dy, d);
      let dyaw = wantYaw - b.yaw; while (dyaw > Math.PI) dyaw -= 2 * Math.PI; while (dyaw < -Math.PI) dyaw += 2 * Math.PI;
      b.yaw += dyaw * Math.min(1, dt * K.turn); b.pitch += (wantPitch - b.pitch) * Math.min(1, dt * K.turn);
      B.aimErr = Math.max(K.errMin, B.aimErr - dt * K.errDecay);
      B.react -= dt; B.fireCd -= dt;
      if (B.reloadT > 0) { B.reloadT -= dt; if (B.reloadT <= 0) B.mag = W.mag; }
      else if (B.react <= 0 && B.fireCd <= 0 && Math.abs(dyaw) < K.cone && (d < W.range[1] * 1.2 || W.scope)) {
        B.fireCd = 1 / W.rate + (W.auto ? 0 : rand(...K.semi)); B.mag--; if (B.mag <= 0) B.reloadT = W.reload;
        if (W.auto && K.burst) { if (!B.burst) B.burst = Math.round(rand(...K.burst)); if (--B.burst <= 0) { B.burst = 0; B.fireCd += rand(...K.rest); } }
        botShoot(b, T, W, d, K);
      }
      b.ads = d > 12 && !W.auto ? 1 : 0; b.s = d > 16 && b.ads ? 1 : 0;
    } else { b.ads = 0; b.s = 0; const ml2 = Math.hypot(mx, mz); if (ml2 > 0.01) b.yaw = Math.atan2(-mx, -mz); b.pitch *= 0.9; }
  }
}
function botShoot(b, T, W, dist, K = skill()) {
  const spread = (b.ads ? W.ads : W.hip) * (W.scope && !b.ads ? 1 : 1) + b.brain.aimErr;
  const o = [b.x, b.y + EYE - 0.1, b.z], ends = []; let total = 0, head = false;
  _a.set(...o);
  for (let k = 0; k < W.pellets; k++) {
    const aimY = T.y + (Math.random() < K.head ? 1.62 : 1.2);
    _d.set(T.x - b.x, aimY - o[1], T.z - b.z).normalize();
    perturb(_d, spread);
    const tw = G.world.ray(_a, _d, 300);
    const hit = hitTest(_a, _d, tw, [T]);
    const tEnd = hit ? hit.t : tw; ends.push([r2(o[0] + _d.x * tEnd), r2(o[1] + _d.y * tEnd), r2(o[2] + _d.z * tEnd)]);
    if (hit) { total += W.dmg * falloff(W, hit.t) * hit.mult(W); head = head || hit.part === 'head'; }
  }
  hostOn(b.id, { t: 'fx', w: b.w, o: o.map(r2), e: ends });
  if (total > 0) applyHit(b.id, { target: T.id, dmg: Math.round(total), head, w: b.w });
}

const PARTS = [
  [['head', 1.62, 0.2, 0], ['chest', 1.25, 0.3, 0], ['belly', 0.95, 0.28, 0], ['legs', 0.5, 0.26, 0]],
  [['head', 1.1, 0.2, 0.05], ['chest', 0.82, 0.3, 0.05], ['belly', 0.6, 0.28, 0], ['legs', 0.3, 0.28, 0]],
  [['head', 0.3, 0.2, 0.85], ['chest', 0.28, 0.28, 0.45], ['belly', 0.25, 0.27, 0], ['legs', 0.2, 0.25, -0.6]],
];
const _c = new THREE.Vector3();
function hitTest(o, d, tMax, candidates) {
  let best = null;
  for (const p of candidates) {
    if (!p.alive || p.id === G.meId && candidates.length > 1) continue;
    const rs = p.mesh && G.role !== 'host' || (p.mesh && !p.bot) ? p.mesh.position : p;
    const yaw = p.mesh ? p.mesh.rotation.y - Math.PI : p.yaw, fxv = -Math.sin(yaw), fzv = -Math.cos(yaw);
    for (const [part, hy, r, fo] of PARTS[p.s || 0]) {
      _c.set(rs.x + fxv * fo, rs.y + hy, rs.z + fzv * fo);
      const ox = o.x - _c.x, oy = o.y - _c.y, oz = o.z - _c.z, bb = ox * d.x + oy * d.y + oz * d.z, cc = ox * ox + oy * oy + oz * oz - r * r, h = bb * bb - cc;
      if (h < 0) continue; const t = -bb - Math.sqrt(h);
      if (t > 0 && t < tMax && (!best || t < best.t)) best = { t, p, part, mult: (W) => (part === 'head' ? W.head : part === 'legs' ? 0.85 : 1) };
    }
  }
  return best;
}
function perturb(d, s) {
  if (s <= 0) return d;
  const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * s;
  _b.set(0, 1, 0); if (Math.abs(d.y) > 0.9) _b.set(1, 0, 0);
  const u = _b.clone().cross(d).normalize(), v = d.clone().cross(u).normalize();
  d.addScaledVector(u, Math.cos(a) * r).addScaledVector(v, Math.sin(a) * r).normalize();
  return d;
}

function clientOn(m) {
  switch (m.t) {
    case 'welcome':
      G.meId = m.you; G.limit = m.limit; G.phase = m.phase; G.quick = m.quick; G.code = m.code;
      if (!G.world || G.mapId !== m.map) loadMap(m.map);
      syncRoster(m.players);
      G.items = m.items.map((i) => ({ ...i, active: true })); syncItemMeshes();
      if (m.phase === 'live') enterGame(); else showLobby();
      break;
    case 'full': setStatus('That lobby is full.', true); if (G.quick) { G.excludeSlots.add(G.net.slot); leaveMatch(true); quickMatch(); } break;
    case 'roster': if (G.role !== 'host') { syncRoster(m.players); G.limit = m.limit; } if (G.mode === 'lobby') renderLobby(); break;
    case 'phase': G.phase = m.phase; G.limit = m.limit; if (m.phase === 'live') { $('end').hidden = true; enterGame(); } break;
    case 'snap':
      if (G.role === 'host') break;
      for (const [id, x, y, z, yaw, pitch, w, ads, hp, alive, k, d, ping, st] of m.p) {
        const p = G.players.get(id); if (!p) continue;
        Object.assign(p, { hp, alive: !!alive, k, d, ping });
        if (id === G.meId) { L.hp = hp; continue; }
        Object.assign(p, { x, y, z, yaw, pitch, w, ads, s: st || 0 }); pushBuf(p);
      }
      break;
    case 'spawn': {
      const p = G.players.get(m.id); if (!p) break;
      Object.assign(p, { x: m.x, y: m.y, z: m.z, yaw: m.yaw, alive: true, hp: 100, s: 0 }); p.buf = []; pushBuf(p);
      if (m.id === G.meId) {
        L.pos.set(m.x, m.y, m.z); L.yaw = m.yaw; L.pitch = 0; L.vy = 0; L.alive = true; L.st = ST.createStance(); L.hp = 100; L.primary = null; L.cur = 'pistol';
        L.pistol = { mag: WEAPONS.pistol.mag, res: WEAPONS.pistol.reserve }; L.reloading = 0; L.adsT = 0; aim.reset(); L.killer = null;
        $('respawn').hidden = true; equipVisual();
      }
      break;
    }
    case 'fx':
      if (m.from === G.meId) break;
      m.e.forEach((e) => tracer(m.o, e));
      { const dd = Math.hypot(m.o[0] - L.pos.x, m.o[2] - L.pos.z); sfx(m.w, clamp(1 - dd / 90, 0.08, 0.9)); }
      break;
    case 'dmg':
      if (m.to === G.meId) {
        L.hp = m.hp; L.lastHurt = now(); sfx('hurt');
        flash('vignette');
        const ax = m.fx - L.pos.x, az = m.fz - L.pos.z;
        const fwd = -ax * Math.sin(L.yaw) - az * Math.cos(L.yaw), right = ax * Math.cos(L.yaw) - az * Math.sin(L.yaw);
        $('dmgdir').style.transform = `rotate(${Math.atan2(right, fwd)}rad)`; flash('dmgdir');
      }
      break;
    case 'kill': {
      const k = G.players.get(m.killer), v = G.players.get(m.victim);
      G.feed.unshift({ k: k?.name || '?', v: v?.name || '?', w: WEAPONS[m.w]?.name || m.w, head: m.head, me: m.killer === G.meId || m.victim === G.meId, t: now() });
      G.feed = G.feed.slice(0, 6);
      if (v) { v.alive = false; v.diedAt = now(); }
      if (m.victim === G.meId) { L.alive = false; L.primary = null; L.cur = 'pistol'; L.killer = m.killer; L.respawnAt = now() + RESPAWN; fireClear(); showRespawn(k?.name, m.w, m.head); }
      if (m.killer === G.meId && m.victim !== G.meId) { sfx('kill'); toast(m.head ? 'Headshot kill' : 'Kill', false); }
      break;
    }
    case 'items': if (G.role !== 'host') G.items = m.items.map((i) => ({ ...i, active: true })); syncItemMeshes(); break;
    case 'got':
      if (m.kind === 'weapon') { L.primary = { w: m.w, mag: m.mag, res: m.res }; L.cur = 'primary'; L.reloading = 0; L.adsT = 0; equipVisual(); toast(`Picked up ${WEAPONS[m.w].name}`); }
      else {
        L.pistol.res = Math.min(WEAPONS.pistol.reserve + 12, L.pistol.res + 24);
        if (L.primary) { const W = WEAPONS[L.primary.w]; L.primary.res = Math.min(W.reserve + W.mag, L.primary.res + Math.ceil(W.mag * 1.5)); }
        toast('Ammo');
      }
      sfx('pick');
      break;
    case 'end': showEnd(m); break;
    case 'ping': G.net?.send({ t: 'pong', ts: m.ts }); break;
  }
}
function syncRoster(list) {
  const ids = new Set(list.map((p) => p.id));
  for (const [id, p] of G.players) if (!ids.has(id)) { removeVisual(p); G.players.delete(id); }
  for (const r of list) { const p = G.players.get(r.id) || addPlayer(r.id, r.name, r.bot, r.color); Object.assign(p, { name: r.name, color: r.color, bot: r.bot }); ensureVisual(p); }
}

const touch = { mx: 0, mz: 0, stick: null, look: null, lx: 0, ly: 0 };
let locked = false;
const curW = () => (L.cur === 'primary' && L.primary ? L.primary.w : 'pistol');
const curAmmo = () => (L.cur === 'primary' && L.primary ? L.primary : L.pistol);
function equipVisual() { const w = curW(); Object.entries(viewModels).forEach(([k, g]) => (g.visible = k === w)); vm.position.y = -0.5; }
function swapWeapon() { if (!L.primary) return; L.cur = L.cur === 'primary' ? 'pistol' : 'primary'; L.reloading = 0; L.adsT = 0; L.fireCd = 0.25; equipVisual(); }
function startReload() { const W = WEAPONS[curW()], a = curAmmo(); if (L.reloading > 0 || a.mag >= W.mag || a.res <= 0) return; L.reloading = W.reload; sfx('reload'); }

const _o = new THREE.Vector3(), _dir = new THREE.Vector3(), _mz = new THREE.Vector3();
function fire() {
  const w = curW(), W = WEAPONS[w], a = curAmmo();
  if (L.reloading > 0 || L.fireCd > 0) return;
  L.edge = false;
  if (a.mag <= 0) { sfx('empty'); if (a.res > 0) startReload(); else toast('Out of ammo. Find an ammo crate.', true); L.fireCd = 0.3; return; }
  a.mag--; L.fireCd += 1 / W.rate; L.recoil = Math.min(0.35, L.recoil + W.kick);
  sfx(w); muzzle.material.opacity = 1; muzzle.position.set(0, 0.01, MUZZLE_Z[w]);
  camera.getWorldPosition(_o); vm.getWorldPosition(_mz); _mz.add(new THREE.Vector3(0, 0.02, MUZZLE_Z[w]).applyQuaternion(camera.quaternion));
  const spread = (W.hip + (W.ads - W.hip) * L.adsT) * (L.moving > 0.2 ? W.move : 1) * (L.onGround ? 1 : 1.8) * ST.SPREAD[L.st.s] * (L.st.slideT > 0 ? 1.4 : 1);
  const targets = [...G.players.values()].filter((p) => p.id !== G.meId && p.alive && p.mesh);
  const per = new Map(), ends = [];
  for (let k = 0; k < W.pellets; k++) {
    _dir.set(0, 0, -1).applyQuaternion(camera.quaternion); perturb(_dir, spread);
    const tw = G.world.ray(_o, _dir, 400), hit = hitTest(_o, _dir, tw, targets);
    const tEnd = hit ? hit.t : Math.min(tw, 400);
    ends.push([r2(_o.x + _dir.x * tEnd), r2(_o.y + _dir.y * tEnd), r2(_o.z + _dir.z * tEnd)]);
    tracer([_mz.x, _mz.y, _mz.z], ends[ends.length - 1]);
    if (hit) { const e = per.get(hit.p.id) || { dmg: 0, head: false }; e.dmg += W.dmg * falloff(W, hit.t) * hit.mult(W); e.head = e.head || hit.part === 'head'; per.set(hit.p.id, e); }
  }
  toHost({ t: 'fx', w, o: [r2(_mz.x), r2(_mz.y), r2(_mz.z)], e: ends });
  let anyHead = false;
  for (const [target, e] of per) { toHost({ t: 'hit', target, dmg: Math.round(e.dmg), head: e.head, w }); anyHead = anyHead || e.head; }
  if (per.size) { const h = $('hitmark'); h.className = 'hitmark on' + (anyHead ? ' head' : ''); setTimeout(() => (h.className = 'hitmark'), 90); sfx(anyHead ? 'head' : 'hit'); }
  if (a.mag === 0 && a.res > 0) setTimeout(startReload, 150);
}

const _ae = new THREE.Vector3(), _at = new THREE.Vector3();
function updateLocal(dt) {
  const W = WEAPONS[curW()];
  const adsWanted = L.alive && aim.active() && L.reloading <= 0;
  L.adsT = clamp(L.adsT + (adsWanted ? 1 : -1.6) * dt / W.adsTime, 0, 1);
  if (L.alive) {
    const mv = moveInput(); const fx = mv.fx, fz = mv.fz; L.moving = mv.l;
    L.sprinting = mv.sprint && L.st.s === ST.STAND && L.adsT < 0.2;
    const sp = SPEED * (L.sprinting ? 1.35 : 1) * ST.SPEED[L.st.s] * (1 - 0.45 * L.adsT) * (W.scope ? 0.9 : 1);
    const c = Math.cos(L.yaw), s = Math.sin(L.yaw);
    const slide = ST.stanceUpdate(L.st, dt);
    if (slide) { L.pos.x += slide.x; L.pos.z += slide.z; L.moving = 1; }
    else { L.pos.x += (fx * c + fz * s) * sp * dt; L.pos.z += (-fx * s + fz * c) * sp * dt; }
    G.world.collide(L.pos, RADIUS, L.pos.y);
    const floor = G.world.floorAt(L.pos, RADIUS, L.pos.y);
    if (L.jumpReq) { L.jumpReq = false; if (L.onGround) { L.vy = JUMP; L.onGround = false; } }
    L.vy -= GRAV * dt; L.pos.y += L.vy * dt;
    if (L.pos.y <= floor) { L.pos.y = floor; L.vy = 0; L.onGround = true; } else L.onGround = L.pos.y - floor < 0.03;
    L.fireCd = Math.max(-0.04, L.fireCd - dt);
    if (L.reloading > 0) { L.reloading -= dt; if (L.reloading <= 0) { const a = curAmmo(), take = Math.min(W.mag - a.mag, a.res); a.mag += take; a.res -= take; } }
    for (let n = 0; L.trigger && L.fireCd <= 0 && n < 4; n++) { const before = L.fireCd; fire(); if (L.fireCd === before) break; }
    checkPickups();
  }
  if (L.alive && G.mode === 'game') {
    _ae.set(L.pos.x, L.pos.y + L.st.eye, L.pos.z);
    const tg = [];
    for (const p of G.players.values()) {
      if (p.id === G.meId || !p.alive) continue;
      const rs = (p.mesh && G.role !== 'host') || (p.mesh && !p.bot) ? p.mesh.position : p;
      tg.push({ x: rs.x, y: rs.y + PARTS[p.s || 0][1][1], z: rs.z });
    }
    assist.find(_ae, L.yaw, L.pitch, tg, (t) => G.world.los(_ae, _at.set(t.x, t.y, t.z)), L.adsT);
    assist.apply(L, dt, { adsT: L.adsT, firing: L.trigger });
    L.pitch = clamp(L.pitch, -1.45, 1.45);
  } else assist.mul = 1;
  L.recoil = Math.max(0, L.recoil - dt * 1.2); L.bob += dt * L.moving * 9 * (L.onGround ? 1 : 0);
  if (!L.alive) ST.stanceUpdate(L.st, dt);
  const eye = L.alive ? L.st.eye : 0.6;
  camera.position.set(L.pos.x, L.pos.y + eye + Math.sin(L.bob) * 0.03 * L.moving * (1 - L.adsT), L.pos.z);
  if (!L.alive && L.killer) { const k = G.players.get(L.killer); if (k?.mesh) { const dx = k.mesh.position.x - L.pos.x, dz = k.mesh.position.z - L.pos.z; L.yaw += (Math.atan2(-dx, -dz) - L.yaw) * Math.min(1, dt * 2); } }
  camera.rotation.set(L.pitch + L.recoil * 0.35, L.yaw, 0);
  camera.fov = BASE_FOV / (1 + (W.zoom - 1) * L.adsT); camera.updateProjectionMatrix();
  const scoped = !!W.scope && L.adsT > 0.92;
  $('scope').classList.toggle('on', scoped); vm.visible = L.alive && !scoped;
  $('crosshair').classList.toggle('hide', scoped);
  $('crosshair').classList.toggle('ads', !scoped && L.adsT > 0.6);
  vm.position.x = 0.24 * (1 - L.adsT); vm.position.y += (-0.22 + 0.06 * L.adsT - vm.position.y) * Math.min(1, dt * 14) - (L.reloading > 0 ? 0.004 : 0);
  vm.position.z = -0.45 + L.recoil * 0.3 + 0.08 * L.adsT; vm.rotation.x = L.recoil * 0.7 + (L.reloading > 0 ? -0.5 : 0);
  muzzle.material.opacity = Math.max(0, muzzle.material.opacity - dt * 25);
  const spread = (W.hip + (W.ads - W.hip) * L.adsT) * (L.moving > 0.2 ? W.move : 1) * ST.SPREAD[L.st.s];
  $('crosshair').style.setProperty('--g', 4 + spread * 420 + L.recoil * 40 + 'px');
}
let nearItem = null;
function checkPickups() {
  nearItem = null; let bd = 2.4;
  for (const it of G.items) {
    if (!it.active) continue;
    const d = Math.hypot(it.x - L.pos.x, it.z - L.pos.z); if (Math.abs(it.y - L.pos.y) > 1.8) continue;
    if (it.kind === 'ammo') {
      if (d < 1.4) { const full = L.pistol.res >= WEAPONS.pistol.reserve && (!L.primary || L.primary.res >= WEAPONS[L.primary.w].reserve); if (!full) tryPick(it); }
    } else if (d < bd && (!L.primary || L.primary.w !== it.w || L.primary.res < WEAPONS[it.w].reserve / 2)) { bd = d; nearItem = it; }
  }
  if (nearItem && !L.primary) tryPick(nearItem);
  const pr = $('prompt');
  if (nearItem && L.primary) { pr.hidden = false; pr.innerHTML = `${isTouch ? '' : '<kbd>E</kbd> '}Swap ${WEAPONS[L.primary.w].name} for <b>${WEAPONS[nearItem.w].name}</b>`; $('tPick').hidden = !isTouch; }
  else { pr.hidden = true; $('tPick').hidden = true; }
}
function tryPick(it) { const t = now(); if ((L.pickCd.get(it.id) || 0) > t) return; L.pickCd.set(it.id, t + 0.6); toHost({ t: 'pick', item: it.id }); }

function lock() { try { const r = canvas.requestPointerLock?.(); if (r && r.catch) r.catch(() => {}); } catch {} }
const controls = createControls('fo', [
  ['use', 'Pick up weapon', ['KeyE']], ['scores', 'Scoreboard (hold)', ['Tab']], ['pistol', 'Pistol', ['Digit1']], ['primary', 'Primary weapon', ['Digit2']],
], () => G.mode === 'game' && $('pause').hidden);
const touchHeld = new Set();
const held = (a) => controls.isDown(a) || touchHeld.has(a);
function moveInput() {
  let fx = 0, fz = 0;
  if (held('forward')) fz -= 1; if (held('back')) fz += 1; if (held('left')) fx -= 1; if (held('right')) fx += 1;
  fx += touch.mx; fz += touch.mz;
  const l = Math.hypot(fx, fz); if (l > 1) { fx /= l; fz /= l; }
  const sprint = (held('sprint') && fz < 0) || (Math.hypot(touch.mx, touch.mz) > 0.95 && touch.mz < -0.7);
  return { fx, fz, l: Math.min(1, l), sprint };
}
function stanceAction(a) {
  const mv = moveInput(), c = Math.cos(L.yaw), s = Math.sin(L.yaw);
  let dx = mv.fx * c + mv.fz * s, dz = -mv.fx * s + mv.fz * c; const dl = Math.hypot(dx, dz) || 1;
  if (a === 'jump') { if (L.st.s !== ST.STAND) ST.stancePress(L.st, 'jump', {}); else L.jumpReq = true; return; }
  ST.stancePress(L.st, a, { sprinting: mv.sprint && L.st.s === ST.STAND, onGround: L.onGround, moving: mv.l, dx: dx / dl, dz: dz / dl, speed: SPEED * 1.35 });
  if (L.st.slideT > 0) sfx('reload');
}
const fireSrc = new Set();
function fireDown(src, mode) {
  if (mode === 'aim') aim.force(src, true); else if (mode === 'hip') aim.hipHold(src, true);
  fireSrc.add(src); L.trigger = true; L.edge = true;
}
function fireUp(src) {
  if (aim.forced.has(src)) aim.force(src, false); if (aim.hip.has(src)) aim.hipHold(src, false);
  fireSrc.delete(src); L.trigger = fireSrc.size > 0;
}
function fireClear() { fireSrc.clear(); L.trigger = false; aim.releaseAll(); }
controls.onPress((a, e) => {
  if (!L.alive && a !== 'scores') return;
  switch (a) {
    case 'scores': $('board').hidden = false; renderBoard(); break;
    case 'reload': startReload(); break;
    case 'pistol': if (L.cur !== 'pistol') swapWeapon(); break;
    case 'primary': if (L.cur !== 'primary') swapWeapon(); break;
    case 'swap': swapWeapon(); break;
    case 'use': if (nearItem) tryPick(nearItem); break;
    case 'aim': aim.press(e?.timeStamp); break;
    case 'fire': fireDown('kFire'); break;
    case 'hipfire': fireDown('kHip', 'hip'); break;
    case 'aimfire': fireDown('kAimFire', 'aim'); break;
    case 'jump': case 'crouch': case 'prone': stanceAction(a); break;
  }
});
controls.onRelease((a, e) => {
  if (a === 'scores') $('board').hidden = true;
  if (a === 'aim') aim.release(e?.timeStamp);
  if (a === 'fire') fireUp('kFire');
  if (a === 'hipfire') fireUp('kHip');
  if (a === 'aimfire') fireUp('kAimFire');
});
window.addEventListener('blur', () => { touchHeld.clear(); fireClear(); });
canvas.addEventListener('mousedown', (e) => {
  if (G.mode !== 'game' || fromTouch() || !$('pause').hidden) return;
  if (!locked) lock();
  if (e.button === 0) fireDown('m0');
  if (e.button === 1) { e.preventDefault(); fireDown('m1', 'aim'); }
  if (e.button === 2) aim.press(e.timeStamp);
});
window.addEventListener('mouseup', (e) => { if (fromTouch()) return; if (e.button === 0) fireUp('m0'); if (e.button === 1) fireUp('m1'); if (e.button === 2) aim.release(e.timeStamp); });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  $('lockHint').hidden = locked || G.mode !== 'game' || isTouch || !$('pause').hidden;
  if (!locked && G.mode === 'game' && !fromTouch()) openPause();
});
const zoomNow = () => 1 + (WEAPONS[curW()].zoom - 1) * L.adsT;
document.addEventListener('mousemove', (e) => {
  if (!locked && !(G.mode === 'game' && e.target === canvas && $('pause').hidden && !fromTouch())) return;
  const k = 0.0022 * sens.factor('mouse', L.adsT, zoomNow()) * assist.mul;
  L.yaw -= e.movementX * k; L.pitch = clamp(L.pitch - e.movementY * k, -1.45, 1.45);
});
canvas.addEventListener('wheel', () => { if (G.mode === 'game') swapWeapon(); }, { passive: true });

const gyro = createGyro({ prefix: 'arena', adsT: () => L.adsT, isActive: () => G.mode === 'game' && L.alive && $('pause').hidden, onLook: (dy, dp) => { const z = zoomNow() / assist.mul; L.yaw += dy / z; L.pitch = clamp(L.pitch + dp / z, -1.4, 1.4); }, notify: (m) => toast(m, true) });
if (isTouch) {
  document.body.classList.add('touch-ui');
  $('touch').hidden = false; $('mobileOpts').hidden = false; $('pauseGyro').hidden = false;
  mountGyroSettings(gyro);
  gyro.onChange((g) => { $('tGyro').setAttribute('aria-pressed', String(g.on)); $('tGyro').textContent = g.on ? 'Gyro on' : 'Gyro off'; });
  const stick = $('stick'), knob = $('knob');
  stick.addEventListener('pointerdown', (e) => { touch.stick = e.pointerId; stick.setPointerCapture(e.pointerId); });
  stick.addEventListener('pointermove', (e) => {
    if (e.pointerId !== touch.stick) return;
    const r = stick.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2), l = Math.min(1, Math.hypot(dx, dy) / 50), a = Math.atan2(dy, dx);
    touch.mx = Math.cos(a) * l; touch.mz = Math.sin(a) * l; knob.style.transform = `translate(${touch.mx * 36}px, ${touch.mz * 36}px)`;
  });
  const endStick = (e) => { if (e.pointerId === touch.stick) { touch.stick = null; touch.mx = touch.mz = 0; knob.style.transform = ''; } };
  stick.addEventListener('pointerup', endStick); stick.addEventListener('pointercancel', endStick);
  canvas.addEventListener('pointerdown', (e) => { if (touch.look === null) { touch.look = e.pointerId; touch.lx = e.clientX; touch.ly = e.clientY; } });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== touch.look) return;
    const k = 0.005 * sens.factor('touch', L.adsT, zoomNow()) * assist.mul;
    L.yaw -= (e.clientX - touch.lx) * k; L.pitch = clamp(L.pitch - (e.clientY - touch.ly) * k, -1.4, 1.4); touch.lx = e.clientX; touch.ly = e.clientY;
  });
  const endLook = (e) => { if (e.pointerId === touch.look) touch.look = null; };
  canvas.addEventListener('pointerup', endLook); canvas.addEventListener('pointercancel', endLook);
  const hold = (id, on, off) => { const b = $(id); b.addEventListener('pointerdown', (e) => { e.preventDefault(); on(); }); if (off) ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => b.addEventListener(ev, off)); };
  const padLook = (dx, dy) => { const k = 0.005 * sens.factor('touch', L.adsT, zoomNow()) * assist.mul; L.yaw -= dx * k; L.pitch = clamp(L.pitch - dy * k, -1.4, 1.4); };
  firePad($('tFire'), { down: () => fireDown('tFire', 'hip'), up: () => fireUp('tFire'), look: padLook });
  firePad($('tAimFire'), { down: () => fireDown('tAimFire', 'aim'), up: () => fireUp('tAimFire'), look: padLook });
  hold('tAds', () => aim.press(), () => aim.release());
  aim.onChange((a) => { $('tAds').setAttribute('aria-pressed', String(a.on)); $('tAimFire').setAttribute('aria-pressed', String(a.forced.has('tAimFire'))); });
  hold('tJump', () => stanceAction('jump'));
  hold('tCrouch', () => stanceAction('crouch'));
  hold('tProne', () => stanceAction('prone'));
  hold('tReload', startReload); hold('tSwap', swapWeapon);
  hold('tPick', () => nearItem && tryPick(nearItem));
  hold('tScores', () => { $('board').hidden = false; renderBoard(); }, () => ($('board').hidden = true));
  hold('tGyro', () => gyro.set(!gyro.on));
}
let rotateDismissed = false;
function checkOrientation() { $('rotateHint').hidden = !(isTouch && innerHeight > innerWidth && !rotateDismissed); }
$('rotateDismiss').addEventListener('click', () => { rotateDismissed = true; checkOrientation(); });
window.addEventListener('resize', checkOrientation); checkOrientation();

function toast(msg, bad) { notify.show(msg, bad ? 'warn' : 'info'); }
function flash(id) { const el = $(id); el.classList.add('on'); requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('on'))); }
function setStatus(msg, err) { for (const id of ['status', 'lobbyStatus']) { $(id).textContent = msg || ''; $(id).classList.toggle('err', !!err); } }
function showRespawn(killer, w, head) { const r = $('respawn'); r.hidden = false; r.dataset.msg = `Eliminated by ${esc(killer || '?')} · ${esc(WEAPONS[w]?.name || w)}${head ? ' · headshot' : ''}`; }
function renderHud() {
  const W = WEAPONS[curW()], a = curAmmo();
  $('hpBar').style.width = clamp(L.hp, 0, 100) + '%'; $('hpBar').style.background = L.hp < 35 ? 'var(--accent)' : 'var(--ok)'; $('hpN').textContent = Math.ceil(L.hp);
  $('regen').textContent = L.alive && L.hp < 100 ? (now() - L.lastHurt > REGEN_DELAY ? 'Regenerating…' : `Regen in ${Math.ceil(REGEN_DELAY - (now() - L.lastHurt))}s`) : '';
  $('wName').textContent = W.name + (L.reloading > 0 ? ' · reloading' : '') + (L.st.s ? ' · ' + (L.st.slideT > 0 ? 'Sliding' : ST.NAMES[L.st.s]) : '');
  $('mag').textContent = a.mag; $('res').textContent = '/ ' + a.res;
  $('ammoBox').classList.toggle('low', a.mag + a.res <= W.mag);
  $('slot1').className = L.cur === 'pistol' ? 'cur' : ''; $('slot2').className = L.cur === 'primary' ? 'cur' : '';
  $('slot2').textContent = '2 ' + (L.primary ? WEAPONS[L.primary.w].name : '—');
  const me = G.players.get(G.meId), leader = [...G.players.values()].sort((x, y) => y.k - x.k)[0];
  $('score').innerHTML = `You <b>${me?.k ?? 0}</b> · Leader <b>${esc(leader?.name ?? '-')} ${leader?.k ?? 0}</b> · First to <b>${G.limit}</b>`;
  const t = now(); $('feed').innerHTML = G.feed.filter((f) => t - f.t < 7).map((f) => `<li class="${f.me ? 'me' : ''}">${esc(f.k)}<em>${esc(f.w)}${f.head ? ' ◎' : ''}</em>${esc(f.v)}</li>`).join('');
  if (!L.alive && !$('respawn').hidden) $('respawn').innerHTML = `Respawning in ${Math.max(0, Math.ceil(L.respawnAt - t))}<small>${$('respawn').dataset.msg || ''}</small>`;
}
function renderBoard() {
  const rows = [...G.players.values()].sort((a, b) => b.k - a.k || a.d - b.d);
  $('boardBody').innerHTML = rows.map((p) => `<tr class="${p.id === G.meId ? 'me' : ''}"><td><span style="color:${hexCss(p.color)}">●</span> ${esc(p.name)}${p.bot ? ' <small>(bot)</small>' : ''}${p.id === 'H' ? ' <small>(host)</small>' : ''}</td><td>${p.k}</td><td>${p.d}</td><td>${p.bot || p.id === G.meId && G.role === 'host' ? '—' : (p.ping || '…') + ' ms'}</td></tr>`).join('');
}
function updateLabels() {
  for (const p of G.players.values()) {
    if (!p.label) continue;
    if (!p.mesh?.visible || !p.alive || G.mode !== 'game') { p.label.style.display = 'none'; continue; }
    _v.set(p.mesh.position.x, p.mesh.position.y + 2.05, p.mesh.position.z);
    const d = _v.distanceTo(camera.position); _v.project(camera);
    if (_v.z > 1 || d > 45 || Math.abs(_v.x) > 1.1 || Math.abs(_v.y) > 1.1) { p.label.style.display = 'none'; continue; }
    p.label.style.display = ''; p.label.style.left = ((_v.x + 1) / 2) * innerWidth + 'px'; p.label.style.top = ((1 - _v.y) / 2) * innerHeight + 'px';
    p.label.querySelector('u').style.width = clamp(p.hp, 0, 100) + '%';
  }
}

$('nameIn').value = myName;
$('nameIn').addEventListener('input', (e) => { myName = e.target.value.trim().slice(0, 14) || 'Player'; store.set('fo-name', myName); });
$('mapSel').innerHTML = Object.entries(MAPS).map(([id, m]) => `<option value="${id}">${esc(m.name)}</option>`).join('');
$('mapSel').addEventListener('change', (e) => (G.mapId = e.target.value));
$('weaponList').innerHTML = ['sniper', 'ar', 'smg', 'shotgun', 'pistol'].map((w) => `<li><b>${WEAPONS[w].name}</b><span>${WEAPONS[w].blurb}</span></li>`).join('');
function segInit(id, key, val, save) {
  const seg = $(id);
  const set = (v) => { seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.v) === v))); G[key] = v; store.set(save, v); };
  seg.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) set(Number(b.dataset.v)); });
  set(val);
}
segInit('limitSeg', 'limit', G.limit, 'fo-limit'); segInit('botSeg', 'bots', G.bots, 'fo-bots'); segInit('skillSeg', 'botSkill', G.botSkill, 'fo-botskill');
const qp = new URLSearchParams(location.search).get('room'); if (qp) { $('codeIn').value = qp.toUpperCase(); setStatus(`Invited to room ${qp.toUpperCase()}. Press Join.`); }
mountAimSettings(aim);
mountAssistSettings(assist);
const layout = isTouch ? createLayout('fo', ['stick', 'tFire', 'tAimFire', 'tAds', 'tJump', 'tReload', 'tSwap', 'tCrouch', 'tProne', 'tPick', 'tScores', 'tGyro']) : null;
mountControlsPanel({ controls, layout, touch: isTouch, hud: $('hud'), touchBox: $('touch'), extraHtml: '<h3 class="ctl-h">Messages</h3><div class="notify-settings"></div>', onRender: (ov) => mountNotifySettings(notify, ov) });
mountSensSettings(sens, isTouch);
mountNotifySettings(notify);

function netHandlers() {
  return {
    onMessage: (from, m) => (G.role === 'host' ? hostOn(from, m) : clientOn(m)),
    onJoin: () => {},
    onLeave: (id) => { const p = G.players.get(id); if (p) { removeVisual(p); G.players.delete(id); broadcastRoster(); } },
    onHostLost: () => { leaveMatch(true); setStatus('The host left the match.', true); },
    onError: (e) => setStatus(e.message || String(e), true),
  };
}
function beginHost({ quick = false, code = null, offline = false }) {
  G.role = 'host'; G.meId = 'H'; G.quick = quick; G.code = code; G.offline = offline; G.phase = 'lobby'; G.autoStartAt = 0; G.lonelyT = 0;
  loadMap($('mapSel').value || 'foundry');
  clearPlayers(); addPlayer('H', myName);
  for (let i = 0; i < (offline ? (G.bots || 3) : G.bots); i++) addBot();
  initItems(); syncItemMeshes();
}
async function quickMatch() {
  setBusy(true); setStatus('');
  try {
    G.net = new Net(netHandlers());
    const res = await G.net.quickMatch(G.excludeSlots, (s) => setStatus(s));
    if (res.role === 'host') { beginHost({ quick: true }); showLobby(); }
    else { G.role = 'client'; G.quick = true; G.net.send({ t: 'hello', name: myName }); setStatus('Joining lobby…'); }
  } catch (e) { setStatus(netError(e), true); G.net?.close(); G.net = null; }
  setBusy(false);
}
function becomeClientOfMerge() {
  for (const p of [...G.players.values()]) removeVisual(p);
  G.players.clear(); G.role = 'client'; G.net.send({ t: 'hello', name: myName }); setStatus('Found another player. Joining their lobby…');
}
async function createRoom() {
  setBusy(true); setStatus('Creating room…');
  G.net = new Net(netHandlers());
  for (let i = 0; i < 4; i++) {
    const code = roomCode();
    try { await G.net.host('room-' + code); beginHost({ code }); showLobby(); setStatus(''); setBusy(false); return; }
    catch (e) { if (e.type !== 'unavailable-id') { setStatus(netError(e), true); break; } }
  }
  G.net?.close(); G.net = null; setBusy(false);
}
async function joinRoom() {
  const code = $('codeIn').value.trim().toUpperCase(); if (code.length < 4) return setStatus('Enter the 5-letter room code.', true);
  setBusy(true); setStatus('Connecting to room ' + code + '…');
  try { G.net = new Net(netHandlers()); await G.net.join('room-' + code); G.role = 'client'; G.quick = false; G.net.send({ t: 'hello', name: myName }); }
  catch (e) { setStatus(netError(e), true); G.net?.close(); G.net = null; }
  setBusy(false);
}
function practice() { G.net = null; beginHost({ offline: true }); startMatch(); }
function netError(e) {
  const t = e?.type;
  if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'timeout') return 'Could not reach the matchmaking server. Check your connection, or play practice mode.';
  if (t === 'browser-incompatible') return 'This browser does not support WebRTC multiplayer.';
  return e?.message || 'Connection failed.';
}
function setBusy(b) { ['quickBtn', 'createBtn', 'joinBtn', 'practiceBtn'].forEach((id) => ($(id).disabled = b)); }
const gesture = () => { if (isTouch) gyro.start(); };
$('quickBtn').addEventListener('click', () => { gesture(); G.excludeSlots = new Set(); quickMatch(); });
$('createBtn').addEventListener('click', () => { gesture(); createRoom(); });
$('joinBtn').addEventListener('click', () => { gesture(); joinRoom(); });
$('codeIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
$('practiceBtn').addEventListener('click', () => { gesture(); practice(); });

function showLobby() {
  G.mode = 'lobby';
  $('menu').hidden = true; $('end').hidden = true; $('lobby').hidden = false; $('hud').hidden = true; $('menuBtn').hidden = true;
  renderLobby();
}
function renderLobby() {
  const host = G.role === 'host', humans = [...G.players.values()].filter((p) => !p.bot).length;
  $('lobbyKicker').textContent = G.quick ? 'Public lobby' : G.code ? 'Private room' : 'Room';
  $('lobbyTitle').textContent = G.quick ? (humans >= 2 ? 'Match starting…' : 'Waiting for another player') : 'Waiting for players';
  $('codeBox').hidden = !G.code; $('codeTxt').textContent = G.code || '';
  $('roster').innerHTML = [...G.players.values()].map((p) => `<li><i style="background:${hexCss(p.color)}"></i>${esc(p.name)}${p.id === G.meId ? ' (you)' : ''}<small>${p.bot ? 'bot' : p.id === 'H' ? 'host' : 'player'}</small>${host && p.bot ? `<button data-rm="${p.id}">remove</button>` : ''}</li>`).join('');
  $('startBtn').hidden = !host; $('addBotBtn').hidden = !host;
  $('startBtn').disabled = G.players.size < 2;
  $('lobbyStatus').textContent = host
    ? (G.players.size < 2 ? (G.code ? `Share code ${G.code}. Friends on the same wifi can join instantly. Or add a bot.` : 'Searching for players… add a bot to start now.') : `${G.players.size} players · first to ${G.limit} kills.`) + (G.autoStartAt ? ` Starting in ${Math.max(0, Math.ceil(G.autoStartAt - now()))}…` : '')
    : `Waiting for the host to start · first to ${G.limit} kills.`;
}
$('roster').addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (b) removeBot(b.dataset.rm); });
$('startBtn').addEventListener('click', () => { if (G.role === 'host' && G.players.size >= 2) startMatch(); });
$('addBotBtn').addEventListener('click', () => { if (!G.world) return; addBot(); renderLobby(); });
$('copyBtn').addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}?room=${G.code}`;
  try { await navigator.clipboard.writeText(url); $('copyBtn').textContent = 'Copied'; } catch { prompt('Share this link', url); }
  setTimeout(() => ($('copyBtn').textContent = 'Copy invite link'), 1500);
});
$('leaveBtn').addEventListener('click', () => leaveMatch());

function enterGame() {
  G.mode = 'game';
  setTimeout(() => toast(isTouch ? 'Hip fire · Aim · Aim + fire: hold and drag to steer · stick fully forward to sprint' : `Click: fire · Right-click: aim · Middle-click or ${controls.keysFor('aimfire')}: aim + fire · ${controls.keysFor('hipfire')}: hip fire`), 600);
  $('menu').hidden = true; $('lobby').hidden = true; $('hud').hidden = false; $('menuBtn').hidden = false;
  for (const p of G.players.values()) ensureVisual(p);
  equipVisual();
  if (!isTouch) { lock(); $('lockHint').hidden = locked; } else { try { document.documentElement.requestFullscreen?.().catch(() => {}); screen.orientation?.lock?.('landscape').catch(() => {}); } catch {} }
}
function openPause() { $('pause').hidden = false; controls.clear(); touchHeld.clear(); fireClear(); }
$('resumeBtn').addEventListener('click', () => { $('pause').hidden = true; if (!isTouch) lock(); });
$('menuBtn').addEventListener('click', () => { if (document.pointerLockElement) document.exitPointerLock(); openPause(); });
$('leave2Btn').addEventListener('click', () => leaveMatch());
function showEnd(m) {
  G.phase = 'over';
  if (document.pointerLockElement) document.exitPointerLock();
  $('pause').hidden = true;
  const w = m.board[0];
  $('endTitle').innerHTML = m.winner === G.meId ? 'You <em>win.</em>' : `${esc(w?.name || '?')} <em>wins.</em>`;
  $('endBody').innerHTML = m.board.map((p, i) => `<tr class="${p.id === G.meId ? 'me' : ''}"><td>${i + 1}</td><td><span style="color:${hexCss(p.color)}">●</span> ${esc(p.name)}</td><td>${p.k}</td><td>${p.d}</td></tr>`).join('');
  $('rematchBtn').hidden = G.role !== 'host';
  $('endStatus').textContent = G.role === 'host' ? '' : 'Waiting for the host to start a rematch…';
  $('end').hidden = false;
}
$('rematchBtn').addEventListener('click', () => { if (G.role === 'host') { $('end').hidden = true; startMatch(); } });
$('endLeaveBtn').addEventListener('click', () => leaveMatch());

async function leaveMatch(silent) {
  const net = G.net; G.net = null;
  if (net) await net.close();
  if (document.pointerLockElement) document.exitPointerLock();
  clearPlayers(); G.items = []; syncItemMeshes();
  G.role = null; G.mode = 'menu'; G.phase = 'lobby'; G.meId = null; G.code = null; L.alive = false; G.feed = [];
  ['lobby', 'end', 'pause', 'board'].forEach((id) => ($(id).hidden = true));
  $('hud').hidden = true; $('menuBtn').hidden = true; $('lockHint').hidden = true; $('menu').hidden = false;
  if (!silent) setStatus('');
}
window.addEventListener('aboutopen', () => { if (G.mode === 'game' && document.pointerLockElement) document.exitPointerLock(); });

let last = performance.now(), sendAcc = 0;
function frame(nowMs) {
  const dt = Math.min(0.05, (nowMs - last) / 1000); last = nowMs;
  if (G.world) {
    if (G.mode === 'game') {
      updateLocal(dt);
      sendAcc += dt;
      if (sendAcc >= TICK) {
        sendAcc = 0;
        toHost({ t: 'st', x: r2(L.pos.x), y: r2(L.pos.y), z: r2(L.pos.z), yaw: r2(L.yaw), pitch: r2(L.pitch), w: curW(), ads: L.adsT > 0.5 ? 1 : 0, s: L.st.s, pw: L.primary?.w ?? null });
      }
      renderHud();
    } else if (G.mode !== 'menu') {
      const t = nowMs / 1000; camera.position.set(Math.sin(t * 0.07) * 40, 22, Math.cos(t * 0.07) * 30); camera.lookAt(0, 0, 0); camera.fov = BASE_FOV; camera.updateProjectionMatrix(); vm.visible = false;
    }
    if (G.role === 'host') { updateBots(dt); G.acc += dt; while (G.acc >= TICK) { G.acc -= TICK; hostTick(TICK); } }
    for (const p of G.players.values()) {
      if (p.id === G.meId || !p.mesh) continue;
      const s = renderState(p);
      const prev = p.mesh.position.clone();
      p.mesh.position.set(s.x, s.y, s.z); p.mesh.rotation.y = s.yaw + Math.PI;
      p.mesh.visible = p.alive || (p.diedAt && now() - p.diedAt < 1.4);
      if (p.mesh.userData.w !== p.w) { setSoldierWeapon(p.mesh, p.w); p.mesh.userData.w = p.w; }
      animateSoldier(p.mesh, prev.distanceTo(p.mesh.position) / Math.max(dt, 1e-3), dt, s.pitch, p.alive, p.s || 0);
    }
    for (const m of G.itemMeshes.values()) if (m.userData.spin) m.userData.spin.rotation.y += dt * 1.5;
    updateLabels();
  } else { camera.position.set(0, 10, 20); camera.lookAt(0, 0, 0); }
  tracers.forEach((t) => { if (t.life > 0) { t.life -= dt; t.l.material.opacity = Math.max(0, t.life / 0.07) * 0.9; } else t.l.material.opacity = 0; });
  notify.tick(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
window.addEventListener('resize', resize); resize();
loadMap('foundry');
requestAnimationFrame(frame);
window.__fo = { G, L, aim, notify, assist, hostOn, clientOn, startMatch, addBot, updateBots, hostTick, get players() { return G.players; } };
