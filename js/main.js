import * as THREE from 'three';
import { projects, community } from './content.js';
import { BUILDS } from './builds.js';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------------
   Render projects from js/content.js
------------------------------------------------------------------ */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii'];

function renderProjects() {
  const cards = document.getElementById('project-cards');
  cards.innerHTML = projects.map((p) => {
    const chips = p.chips?.length ? `<ul class="chips">${p.chips.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : '';
    const note = p.note ? `<p class="aside">${p.note}</p>` : '';
    const link = p.link ? `<a class="card-link" href="${esc(p.link.url)}" target="_blank" rel="noopener">${esc(p.link.label || 'Visit')} <span aria-hidden="true">↗</span></a>` : '';
    const demo = p.featured ? `
      <div class="score" aria-hidden="true">
        <div class="score-ring"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" class="track"/><circle cx="60" cy="60" r="52" class="bar"/></svg><span>87</span></div>
        <ul class="findings">
          <li><b class="sev hi"></b><span><em class="owasp">A03</em> Dynamic SQL without bind variables</span></li>
          <li><b class="sev md"></b><span><em class="owasp">A03</em> Unescaped item in report column (XSS)</span></li>
          <li><b class="sev lo"></b><span><em class="owasp">A01</em> Page has no authorization scheme</span></li>
        </ul>
      </div>` : '';
    return `<article class="card tilt${p.featured ? ' card-feature' : ''}">
      <div class="card-top"><span class="tag">${esc(p.tag)}</span>${p.status ? `<span class="status">${esc(p.status)}</span>` : ''}</div>
      <h3>${esc(p.title)}</h3>
      <p>${p.summary}</p>${note}${demo}${link}${chips}
    </article>`;
  }).join('');

  document.getElementById('community-list').innerHTML = community.map((c, i) => {
    const inner = `
      <span class="c-num">${ROMAN[i] || i + 1}</span>
      <span class="c-body"><b>${esc(c.title)}</b><span>${esc(c.summary)}</span></span>
      ${c.url
        ? `<span class="c-link">${esc(c.url.replace(/^https?:\/\//, '').replace(/\/$/, ''))} <span aria-hidden="true">↗</span></span>`
        : '<span class="c-link muted">Internal tool</span>'}`;
    return c.url
      ? `<li><a href="${esc(c.url)}" target="_blank" rel="noopener">${inner}</a></li>`
      : `<li><div class="no-link">${inner}</div></li>`;
  }).join('');
}
renderProjects();

document.querySelectorAll('[data-build]').forEach((card) => {
  const b = BUILDS[card.dataset.build], slot = card.querySelector('.build');
  if (!b || !slot) return;
  slot.innerHTML = `<p><b>How it works:</b> ${esc(b.oneLine)}</p><ul class="chips">${b.tech.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
});

/* ------------------------------------------------------------------
   Nav: scrolled state, mobile toggle, active section
------------------------------------------------------------------ */
const nav = document.querySelector('.nav');
const toggle = document.querySelector('.nav-toggle');
const links = document.getElementById('nav-links');

const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 20);
onScroll();
window.addEventListener('scroll', onScroll, { passive: true });

toggle.addEventListener('click', () => {
  const open = links.classList.toggle('open');
  toggle.setAttribute('aria-expanded', String(open));
  toggle.textContent = open ? 'Close' : 'Menu';
});
links.addEventListener('click', (e) => {
  if (e.target.closest('a') && links.classList.contains('open')) toggle.click();
});

const navAnchors = [...links.querySelectorAll('a[href^="#"]')];
const sectionObs = new IntersectionObserver((entries) => {
  entries.forEach((en) => {
    if (!en.isIntersecting) return;
    navAnchors.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + en.target.id));
  });
}, { rootMargin: '-45% 0px -50% 0px' });
document.querySelectorAll('section[id]').forEach((s) => sectionObs.observe(s));

document.getElementById('year').textContent = new Date().getFullYear();

/* ------------------------------------------------------------------
   Reveal on scroll + count-up figures + score ring
------------------------------------------------------------------ */
const revealTargets = document.querySelectorAll(
  '.figure, .section-head, .about-body, .card, .community, .role, .stack-group, .cred-list li, .game, .contact h2, .contact-links'
);
revealTargets.forEach((el) => el.classList.add('reveal'));

const countUp = (el) => {
  const target = Number(el.dataset.count);
  const suffix = el.dataset.suffix || '';
  if (reduceMotion) { el.textContent = target + suffix; return; }
  const t0 = performance.now();
  const dur = 1200;
  const step = (t) => {
    const p = Math.min(1, (t - t0) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(target * eased) + suffix;
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
};

const revealObs = new IntersectionObserver((entries) => {
  entries.forEach((en) => {
    if (!en.isIntersecting) return;
    const el = en.target;
    // light stagger for siblings revealed together
    const idx = [...el.parentElement.children].indexOf(el);
    el.style.transitionDelay = Math.min(idx, 6) * 60 + 'ms';
    el.classList.add('in');
    el.querySelectorAll('[data-count]').forEach(countUp);
    el.querySelectorAll('.score').forEach((s) => s.classList.add('in'));
    revealObs.unobserve(el);
  });
}, { threshold: 0.12 });
revealTargets.forEach((el) => revealObs.observe(el));

/* ------------------------------------------------------------------
   3D tilt on cards (pointer devices only)
------------------------------------------------------------------ */
if (!reduceMotion && window.matchMedia('(hover: hover)').matches) {
  document.querySelectorAll('.tilt').forEach((el) => {
    const max = el.classList.contains('card-feature') ? 3 : 6;
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      el.style.setProperty('--mx', x * 100 + '%');
      el.style.setProperty('--my', y * 100 + '%');
      el.style.transition = 'transform .12s linear, border-color .3s';
      el.style.transform = `rotateX(${(0.5 - y) * max}deg) rotateY(${(x - 0.5) * max}deg) translateZ(0)`;
    });
    el.addEventListener('pointerleave', () => {
      el.style.transition = '';
      el.style.transform = '';
    });
  });
}

/* ------------------------------------------------------------------
   Hero: an instanced "data terrain" that ripples toward the cursor
------------------------------------------------------------------ */
function initHero() {
  const canvas = document.getElementById('hero-canvas');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch {
    return; // no WebGL — the page still reads fine without it
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0d0d0c, 18, 46);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);

  const isSmall = () => window.innerWidth < 700;
  const N = isSmall() ? 38 : 56;
  const SPACING = 0.62;
  const count = N * N;

  const geo = new THREE.BoxGeometry(0.46, 1, 0.46);
  geo.translate(0, 0.5, 0); // grow from the floor up
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.15 });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(mesh);

  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const key = new THREE.DirectionalLight(0xfff2e8, 1.6);
  key.position.set(-6, 12, 8);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xff5b1f, 1.1);
  rim.position.set(10, 4, -10);
  scene.add(rim);

  const offset = ((N - 1) * SPACING) / 2;
  const base = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) base.push([i * SPACING - offset, j * SPACING - offset]);

  const dummy = new THREE.Object3D();
  const cLow = new THREE.Color(0x2e2d29);
  const cMid = new THREE.Color(0x77746a);
  const cHot = new THREE.Color(0xff5b1f);
  const col = new THREE.Color();

  // pointer -> ground plane
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2(10, 10);
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3(999, 0, 999);
  const target = new THREE.Vector3(999, 0, 999);
  let pointerActive = 0;

  window.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    if (e.clientY > r.bottom) return;
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (ray.ray.intersectPlane(plane, hit)) { target.copy(hit); pointerActive = 1; }
  }, { passive: true });

  const look = new THREE.Vector3();
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // keep the field off to the right on desktop so the headline stays clean
    if (isSmall()) { camera.position.set(0, 13, 17); look.set(0, 0, -2); }
    else { camera.position.set(-4, 11, 16); look.set(-9, 0, -1); }
    camera.lookAt(look);
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  const focus = new THREE.Vector3(999, 0, 999);
  let energy = 0;
  let t = 0;
  let last = performance.now();

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;

    focus.lerp(target, 1 - Math.pow(0.001, dt));
    energy += ((pointerActive ? 1 : 0) - energy) * (1 - Math.pow(0.02, dt));
    pointerActive *= 0.995;

    for (let k = 0; k < count; k++) {
      const [x, z] = base[k];
      // layered waves: slow swell + cross ripple — reads like a live surface plot
      let h =
        0.55 +
        0.45 * Math.sin(x * 0.35 + t * 0.6) * Math.cos(z * 0.3 - t * 0.45) +
        0.25 * Math.sin((x + z) * 0.6 + t * 1.1);
      const dx = x - focus.x, dz = z - focus.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      const bump = energy * 2.4 * Math.exp(-d * d * 0.09) * (0.75 + 0.25 * Math.cos(d * 1.4 - t * 5));
      h = Math.max(0.06, h + bump);

      dummy.position.set(x, 0, z);
      dummy.scale.set(1, h, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(k, dummy.matrix);

      const heat = Math.min(1, bump / 1.6);
      col.copy(cLow).lerp(cMid, Math.min(1, h / 1.6) * 0.6).lerp(cHot, heat);
      mesh.setColorAt(k, col);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;

    mesh.rotation.y = Math.sin(t * 0.08) * 0.08;
    renderer.render(scene, camera);
  }

  if (reduceMotion) { frame(performance.now()); return; }

  let running = false, raf = 0;
  const loop = (now) => { frame(now); raf = requestAnimationFrame(loop); };
  new IntersectionObserver(([en]) => {
    if (en.isIntersecting && !running) { running = true; last = performance.now(); raf = requestAnimationFrame(loop); }
    else if (!en.isIntersecting && running) { running = false; cancelAnimationFrame(raf); }
  }).observe(canvas);
}
initHero();

/* ------------------------------------------------------------------
   Game previews (cheap 2D canvases, run only while visible)
------------------------------------------------------------------ */
function previewSiege(ctx, w, h, t) {
  // dusk street in one-point perspective
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#120f1a'); g.addColorStop(0.5, '#4a2a2c'); g.addColorStop(0.62, '#a4523a'); g.addColorStop(0.63, '#2a2626'); g.addColorStop(1, '#141313');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  const vx = w / 2, vy = h * 0.6;
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < 5; i++) {
      const near = 1 - i * 0.18, x0 = vx + side * w * 0.55 * near, x1 = vx + side * w * 0.55 * (near - 0.14);
      const top0 = vy - h * 0.9 * near * (0.6 + (i % 2) * 0.3), top1 = vy - h * 0.9 * (near - 0.14) * (0.6 + (i % 2) * 0.3);
      ctx.fillStyle = i % 2 ? '#2b2528' : '#352b2a';
      ctx.beginPath(); ctx.moveTo(x0, top0); ctx.lineTo(x1, top1); ctx.lineTo(x1, vy + (h - vy) * (near - 0.14)); ctx.lineTo(x0, vy + (h - vy) * near); ctx.fill();
      ctx.fillStyle = 'rgba(255,207,122,.55)';
      for (let k = 0; k < 3; k++) { const f = 0.25 + k * 0.25, x = x0 + (x1 - x0) * f; ctx.fillRect(x - 2, top0 + (vy - top0) * 0.3 + k * 3, 4 * near, 6 * near); }
    }
  }
  // aliens approaching
  const cols = ['#8fd18a', '#b98cff', '#6fe3e3', '#d4553a', '#cfd8ff'];
  for (let i = 0; i < 5; i++) {
    const z = ((i / 5) + t * 0.08) % 1, s = 4 + z * z * 46;
    const x = vx + Math.sin(i * 2.3 + t * 0.6) * w * 0.18 * z, y = vy + (h - vy) * z * 0.55;
    ctx.globalAlpha = i === 4 ? 0.4 + 0.4 * Math.abs(Math.sin(t * 2)) : 1;
    ctx.fillStyle = cols[i]; ctx.beginPath(); ctx.ellipse(x, y - s * 0.6, s * 0.35, s * 0.6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffe14d'; ctx.fillRect(x - s * 0.15, y - s * 0.95, s * 0.08, s * 0.06); ctx.fillRect(x + s * 0.07, y - s * 0.95, s * 0.08, s * 0.06);
    ctx.globalAlpha = 1;
  }
  // crosshair + gun
  ctx.strokeStyle = 'rgba(236,235,228,.9)'; ctx.lineWidth = 2;
  [[0, -14, 0, -6], [0, 6, 0, 14], [-14, 0, -6, 0], [6, 0, 14, 0]].forEach(([a, b2, c, d]) => { ctx.beginPath(); ctx.moveTo(w / 2 + a, h / 2 + b2); ctx.lineTo(w / 2 + c, h / 2 + d); ctx.stroke(); });
  const kick = Math.max(0, Math.sin(t * 9)) ** 8 * 8;
  ctx.fillStyle = '#2a2a2e'; ctx.beginPath(); ctx.moveTo(w * 0.62, h + 2); ctx.lineTo(w * 0.66, h * 0.72 + kick); ctx.lineTo(w * 0.72, h * 0.72 + kick); ctx.lineTo(w * 0.8, h + 2); ctx.fill();
  if (kick > 4) { ctx.fillStyle = 'rgba(255,192,112,.9)'; ctx.beginPath(); ctx.arc(w * 0.68, h * 0.7 + kick, 8, 0, Math.PI * 2); ctx.fill(); }
}

function previewWarehouse(ctx, w, h, t) {
  ctx.fillStyle = '#15171a'; ctx.fillRect(0, 0, w, h);
  const iso = (x, y, z = 0) => [w / 2 + (x - y - 3) * w * 0.027, h * 0.1 + (x + y) * h * 0.024 - z * h * 0.05];
  const quad = (pts, c) => { ctx.fillStyle = c; ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill(); };
  quad([iso(0, 0), iso(20, 0), iso(20, 14), iso(0, 14)], '#3a3b3d');
  const zones = [['#5b8def', 0, 3], ['#9b7bd6', 4, 8], ['#ffc857', 9, 12], ['#8fd18a', 13, 16], ['#ff7a3a', 17, 20]];
  const neck = Math.floor(t / 3) % 5;
  zones.forEach(([c, a, b], i) => { ctx.strokeStyle = i === neck ? '#ff5b1f' : c; ctx.lineWidth = i === neck ? 2.5 : 1; ctx.setLineDash([5, 4]); ctx.beginPath(); [iso(a, 1), iso(b, 1), iso(b, 13), iso(a, 13)].forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]); });
  for (const rx of [4.5, 6, 7.5]) for (let ry = 2; ry < 13; ry += 1.6) {
    const [x, y] = iso(rx, ry, 0), [, y2] = iso(rx, ry, 1.6);
    ctx.fillStyle = '#2f62b5'; ctx.fillRect(x - 3, y2, 2, y - y2);
    ctx.fillStyle = '#b08a5a'; ctx.fillRect(x - 6, y2 + 2, 10, 5); ctx.fillRect(x - 6, y2 + 10, 10, 5);
  }
  // people moving through the flow
  for (let i = 0; i < 14; i++) {
    const f = ((i * 0.137 + t * 0.05) % 1), x = f * 20, y = 2 + ((i * 7) % 11);
    const [px, py] = iso(x, y, 0);
    ctx.fillStyle = '#ffd23a'; ctx.fillRect(px - 2, py - 9, 4, 8); ctx.fillStyle = '#c68642'; ctx.fillRect(px - 2, py - 12, 4, 3);
  }
  // conveyor + robot
  const [c0x, c0y] = iso(9, 13.4, 0.4), [c1x, c1y] = iso(20, 13.4, 0.4);
  ctx.strokeStyle = '#2b2e33'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(c0x, c0y); ctx.lineTo(c1x, c1y); ctx.stroke();
  for (let i = 0; i < 6; i++) { const f = ((i / 6) + t * 0.15) % 1; ctx.fillStyle = '#c79a5a'; ctx.fillRect(c0x + (c1x - c0x) * f - 3, c0y + (c1y - c0y) * f - 5, 6, 4); }
  const rf = (t * 0.1) % 1, [rx, ry] = iso(5.2 + Math.sin(rf * Math.PI * 2) * 1.5, 2 + rf * 10, 0);
  ctx.fillStyle = '#ff7a3a'; ctx.fillRect(rx - 4, ry - 4, 8, 4);
  // beacon
  const [bx, by] = iso(14, 6, 2.2); ctx.fillStyle = '#ff5b1f'; ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t * 5);
  ctx.beginPath(); ctx.moveTo(bx - 6, by - 8); ctx.lineTo(bx + 6, by - 8); ctx.lineTo(bx, by + 4); ctx.fill(); ctx.globalAlpha = 1;
}

function previewArena(ctx, w, h, t) {
  // top-down tactical view of Foundry Yard with players, tracers and a kill feed
  ctx.fillStyle = '#0b0d10'; ctx.fillRect(0, 0, w, h);
  const s = Math.min(w / 100, h / 70), ox = w / 2, oy = h / 2;
  const P = (x, z) => [ox + x * s, oy + z * s];
  ctx.strokeStyle = 'rgba(255,255,255,.04)'; for (let x = -46; x <= 46; x += 4) { const [a] = P(x, 0); ctx.beginPath(); ctx.moveTo(a, oy - 32 * s); ctx.lineTo(a, oy + 32 * s); ctx.stroke(); }
  const rect = (x, z, ww, d, c) => { const [a, b] = P(x - ww / 2, z - d / 2); ctx.fillStyle = c; ctx.fillRect(a, b, ww * s, d * s); };
  rect(0, 0, 92, 64, '#15181d');
  [[-10.25, 0, 0.5, 16], [10.25, 0, 0.5, 16], [0, -8.25, 20, 0.5], [0, 8.25, 20, 0.5]].forEach((r) => rect(...r, '#6b3d2e'));
  [[-38, -22, 6, 2.4], [-30, -24, 2.4, 6], [-22, -20, 6, 2.4], [-38, -12, 2.4, 6], [-31, -10, 6, 2.4], [-23, -8, 2.4, 6], [-40, 0, 6, 2.4], [-32, 2, 2.4, 6], [-24, 3, 6, 2.4], [-38, 12, 2.4, 6], [-30, 12, 6, 2.4], [-22, 14, 2.4, 6], [-38, 23, 6, 2.4], [-28, 24, 2.4, 6], [-20, 25, 6, 2.4]]
    .forEach((r, i) => rect(...r, ['#7a3b2a', '#2f5d6b', '#6b6a2f', '#3d4d3a'][i % 4]));
  [[40, -25, 6, 6], [40, 25, 6, 6]].forEach((r) => rect(...r, '#4c5258'));
  const cols = ['#ff5b1f', '#5b8def', '#8fd18a', '#ffc857', '#b98cff'];
  const pos = cols.map((c, i) => { const a = t * (0.25 + i * 0.07) + i * 1.7; return [Math.cos(a) * (18 + i * 5) + Math.sin(a * 2.1) * 6, Math.sin(a * 1.3) * (14 + i * 2)]; });
  // tracers between nearby players
  for (let i = 0; i < pos.length; i++) for (let j = i + 1; j < pos.length; j++) {
    const d = Math.hypot(pos[i][0] - pos[j][0], pos[i][1] - pos[j][1]);
    if (d < 22 && Math.sin(t * 9 + i * 3 + j) > 0.6) { const [a, b] = P(...pos[i]), [c, e] = P(...pos[j]); ctx.strokeStyle = 'rgba(255,214,160,.8)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, e); ctx.stroke(); }
  }
  pos.forEach(([x, z], i) => {
    const [a, b] = P(x, z), ang = t * (0.25 + i * 0.07) + i;
    ctx.fillStyle = cols[i] + '33'; ctx.beginPath(); ctx.moveTo(a, b); ctx.arc(a, b, 26, ang - 0.4, ang + 0.4); ctx.fill();
    ctx.fillStyle = cols[i]; ctx.beginPath(); ctx.arc(a, b, 5, 0, Math.PI * 2); ctx.fill();
  });
  ctx.font = '11px "JetBrains Mono", monospace'; ctx.textBaseline = 'top';
  const names = ['Austin', 'Ada', 'Kemi', 'Tunde', 'Zara'], wpn = ['Sniper', 'AR', 'SMG', 'Shotgun'];
  for (let k = 0; k < 3; k++) {
    const i = Math.floor(t / 2.5 + k) % 5, j = (i + 2 + k) % 5, y = 12 + k * 20, txt = `${names[i]}  ${wpn[(i + k) % 4]}  ${names[j]}`, tw = ctx.measureText(txt).width;
    ctx.fillStyle = 'rgba(13,13,12,.75)'; ctx.fillRect(w - tw - 22, y - 3, tw + 12, 18); ctx.fillStyle = '#ecebe4'; ctx.fillText(txt, w - tw - 16, y);
  }
  ctx.fillStyle = '#ff5b1f'; ctx.fillText('● LIVE  ·  4 players  ·  first to 20', 14, h - 20);
}

function previewMM(ctx, w, h, t) {
  ctx.fillStyle = '#070707'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#1b1b19'; for (let i = 1; i < 6; i++) { ctx.beginPath(); ctx.moveTo(0, (h / 6) * i); ctx.lineTo(w, (h / 6) * i); ctx.stroke(); }
  const n = 120, off = Math.floor(t * 8);
  const val = (i) => { const k = i + off; return Math.sin(k * 0.05) * 0.25 + Math.sin(k * 0.13) * 0.08 + Math.sin(k * 0.31) * 0.03; };
  const X = (i) => 16 + (i / (n - 1)) * (w - 32), Y = (v) => h * 0.45 - v * h * 0.9;
  const spread = 0.045 + 0.02 * Math.sin(t * 0.7);
  ctx.fillStyle = 'rgba(255,255,255,.05)'; ctx.beginPath();
  for (let i = 0; i < n; i++) ctx.lineTo(X(i), Y(val(i) + spread));
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(X(i), Y(val(i) - spread));
  ctx.fill();
  [[spread, '#ff5b1f'], [-spread, '#8fd18a'], [0, '#ecebe4']].forEach(([d, c]) => { ctx.strokeStyle = c; ctx.lineWidth = d ? 1.2 : 1.6; ctx.beginPath(); for (let i = 0; i < n; i++) (i ? ctx.lineTo(X(i), Y(val(i) + d)) : ctx.moveTo(X(i), Y(val(i) + d))); ctx.stroke(); });
  for (let i = 3; i < n; i += 7) {
    const k = i + off, buy = Math.sin(k * 1.7) > 0, x = X(i), y = Y(val(i) + (buy ? -spread : spread));
    ctx.fillStyle = buy ? '#8fd18a' : '#ff5b1f'; ctx.beginPath();
    if (buy) { ctx.moveTo(x, y - 5); ctx.lineTo(x + 4, y + 3); ctx.lineTo(x - 4, y + 3); } else { ctx.moveTo(x, y + 5); ctx.lineTo(x + 4, y - 3); ctx.lineTo(x - 4, y - 3); }
    ctx.fill();
  }
  // inventory bars
  for (let i = 0; i < n; i++) { const v = Math.sin((i + off) * 0.07) * 0.5; ctx.fillStyle = v > 0 ? 'rgba(143,209,138,.4)' : 'rgba(255,91,31,.4)'; ctx.fillRect(X(i), h * 0.86, (w - 32) / n, -v * h * 0.12); }
  ctx.fillStyle = '#6a6862'; ctx.font = '10px "JetBrains Mono", monospace'; ctx.fillText('bid / ask · fills · inventory', 16, h - 8);
}

function previewGym(ctx, w, h, t) {
  ctx.fillStyle = '#070707'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#1b1b19'; for (let i = 1; i < 6; i++) { ctx.beginPath(); ctx.moveTo(0, (h / 6) * i); ctx.lineTo(w, (h / 6) * i); ctx.stroke(); }
  const fracs = [[0.2, '#8fd18a'], [0.1, '#8ab4ff'], [0.4, '#ffc857'], [0.27, '#ff5b1f']];
  const n = 120, upto = Math.floor(((t * 20) % (n + 40)));
  let s = 7;
  const flips = Array.from({ length: n }, () => (s = (s * 16807) % 2147483647) / 2147483647 < 0.6);
  fracs.forEach(([f, c], k) => {
    let wv = 0; ctx.strokeStyle = c; ctx.lineWidth = k === 3 ? 2.2 : 1.3; ctx.beginPath(); ctx.moveTo(16, h * 0.7);
    for (let i = 0; i < Math.min(n, upto); i++) { wv += Math.log(flips[i] ? 1 + f : 1 - f); ctx.lineTo(16 + (i / n) * (w - 32), h * 0.7 - wv * h * 0.05); }
    ctx.stroke();
  });
  // growth curve inset
  const ox = w * 0.62, oy = h * 0.12, ww = w * 0.32, hh = h * 0.26;
  ctx.fillStyle = 'rgba(20,20,19,.9)'; ctx.fillRect(ox, oy, ww, hh);
  ctx.strokeStyle = '#ecebe4'; ctx.lineWidth = 1.4; ctx.beginPath();
  for (let i = 0; i <= 40; i++) { const f = (i / 40) * 0.6, g = 0.6 * Math.log(1 + f) + 0.4 * Math.log(1 - f); const x = ox + 6 + (i / 40) * (ww - 12), y = oy + hh * 0.55 - g * hh * 3.2; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
  ctx.stroke();
  ctx.strokeStyle = '#8fd18a'; ctx.beginPath(); ctx.moveTo(ox + 6 + (0.2 / 0.6) * (ww - 12), oy + 4); ctx.lineTo(ox + 6 + (0.2 / 0.6) * (ww - 12), oy + hh - 4); ctx.stroke();
  ctx.fillStyle = '#6a6862'; ctx.font = '10px "JetBrains Mono", monospace'; ctx.fillText('growth vs bet size', ox + 8, oy + 12);
}

const quantSeries = (() => {
  // deterministic regime-switching walk for the preview
  let s = 1, p = 100, regime = 1; const out = [];
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 400; i++) {
    if (rnd() < 0.03) regime *= -1;
    const g = Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());
    p *= Math.exp(regime * 0.0025 + 0.012 * g);
    out.push(p);
  }
  return out;
})();

function previewQuant(ctx, w, h, t) {
  ctx.fillStyle = '#070707';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#1b1b19'; ctx.lineWidth = 1;
  for (let i = 1; i < 6; i++) { const y = (h / 6) * i; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  const n = 160;
  const start = Math.floor((t * 18) % (quantSeries.length - n));
  const win = quantSeries.slice(start, start + n);
  const lo = Math.min(...win), hi = Math.max(...win);
  const px = (i) => 16 + (i / (n - 1)) * (w - 32);
  const py = (v) => h * 0.12 + (1 - (v - lo) / (hi - lo || 1)) * h * 0.62;
  // fan of Monte Carlo continuations
  const last = win[n - 1];
  for (let k = 0; k < 18; k++) {
    let v = last, s = k * 7919 + start;
    ctx.strokeStyle = 'rgba(255,176,138,.10)';
    ctx.beginPath(); ctx.moveTo(px(n - 1), py(v));
    for (let i = 1; i < 30; i++) {
      s = (s * 16807) % 2147483647; const u = s / 2147483647 - 0.5;
      v *= 1 + u * 0.035;
      ctx.lineTo(px(n - 1) + i * 2, py(v));
    }
    ctx.stroke();
  }
  ctx.strokeStyle = '#ecebe4'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  win.forEach((v, i) => (i ? ctx.lineTo(px(i), py(v)) : ctx.moveTo(px(i), py(v))));
  ctx.stroke();
  ctx.fillStyle = '#ff5b1f';
  ctx.beginPath(); ctx.arc(px(n - 1), py(last), 3.5, 0, Math.PI * 2); ctx.fill();
  // histogram strip
  const bins = 28, bw = (w - 32) / bins;
  for (let b = 0; b < bins; b++) {
    const x = (b - bins / 2) / (bins / 5);
    const hh = Math.exp(-x * x / 2) * h * 0.16;
    ctx.fillStyle = b === Math.floor(bins * 0.78) ? '#ff5b1f' : '#2a2a27';
    ctx.fillRect(16 + b * bw, h * 0.96 - hh, bw - 2, hh);
  }
}

document.querySelectorAll('canvas[data-preview]').forEach((cv) => {
  const ctx = cv.getContext('2d');
  const draw = { arena: previewArena, mm: previewMM, siege: previewSiege, warehouse: previewWarehouse, quant: previewQuant, gym: previewGym }[cv.dataset.preview] || previewQuant;
  let visible = false, t0 = performance.now();
  const size = () => {
    const dpr = Math.min(window.devicePixelRatio, 2);
    cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  size();
  window.addEventListener('resize', size);
  const tick = (now) => {
    draw(ctx, cv.clientWidth, cv.clientHeight, (now - t0) / 1000);
    if (visible && !reduceMotion) requestAnimationFrame(tick);
  };
  new IntersectionObserver(([en]) => {
    const was = visible; visible = en.isIntersecting;
    if (visible && !was) requestAnimationFrame(tick);
  }).observe(cv);
  draw(ctx, cv.clientWidth, cv.clientHeight, 2);
});
