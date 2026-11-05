/* ==========================================================================
   Shared controls for the shooters
   - Rebindable keyboard actions (two keys per action), saved per game
   - Phone button layout editor: drag buttons anywhere, resize, reset
   - A "Controls" button in the top bar opens both
   ========================================================================== */
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const COMMON_ACTIONS = [
  ['forward', 'Move forward', ['KeyW', 'ArrowUp']],
  ['back', 'Move back', ['KeyS', 'ArrowDown']],
  ['left', 'Move left', ['KeyA', 'ArrowLeft']],
  ['right', 'Move right', ['KeyD', 'ArrowRight']],
  ['jump', 'Jump / stand up', ['Space']],
  ['sprint', 'Sprint', ['ShiftLeft', 'ShiftRight']],
  ['crouch', 'Crouch (slide while sprinting)', ['KeyC']],
  ['prone', 'Go prone', ['KeyX']],
  ['fire', 'Fire (aimed while aiming)', ['KeyF']],
  ['hipfire', 'Hip fire (never aims)', ['KeyH']],
  ['aim', 'Aim down sights', ['KeyZ']],
  ['aimfire', 'Aim and fire', ['KeyV']],
  ['reload', 'Reload', ['KeyR']],
  ['swap', 'Switch weapon', ['KeyQ']],
];
const NO_DEFAULT_SCROLL = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export function keyLabel(code) {
  if (!code) return '—';
  const m = { Space: 'Space', ShiftLeft: 'L Shift', ShiftRight: 'R Shift', ControlLeft: 'L Ctrl', ControlRight: 'R Ctrl', AltLeft: 'L Alt', AltRight: 'R Alt', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Tab: 'Tab', Enter: 'Enter', Backquote: '`', CapsLock: 'Caps' };
  if (m[code]) return m[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}

export function createControls(prefix, extra = [], active = () => true) {
  const defs = [...COMMON_ACTIONS, ...extra];
  const defaults = Object.fromEntries(defs.map(([id, , k]) => [id, [...k]]));
  const saved = store.get(prefix + '-keys', {});
  const c = { defs, binds: Object.fromEntries(defs.map(([id]) => [id, Array.isArray(saved[id]) ? saved[id] : [...defaults[id]]])), down: new Set(), press: [], release: [], capturing: null, active };
  const actionsFor = (code) => defs.filter(([id]) => c.binds[id].includes(code)).map(([id]) => id);
  c.isDown = (a) => c.down.has(a);
  c.onPress = (f) => c.press.push(f);
  c.onRelease = (f) => c.release.push(f);
  c.clear = () => { for (const a of [...c.down]) { c.down.delete(a); c.release.forEach((f) => f(a, null)); } };
  c.keysFor = (a) => c.binds[a].map(keyLabel).join(' / ');
  c.matches = (e, a) => c.binds[a]?.includes(e.code);
  c.save = () => store.set(prefix + '-keys', c.binds);
  c.reset = () => { for (const [id] of defs) c.binds[id] = [...defaults[id]]; c.save(); };
  c.bind = (id, slot, code) => {
    if (code) for (const [other] of defs) c.binds[other] = c.binds[other].filter((k) => k !== code); // a key does one thing
    const list = [...c.binds[id]]; list[slot] = code; c.binds[id] = list.filter(Boolean); c.save();
  };
  window.addEventListener('keydown', (e) => {
    if (c.capturing) return; // the settings panel is listening for a new key
    const acts = actionsFor(e.code);
    if (!acts.length || !c.active()) return;
    if (NO_DEFAULT_SCROLL.has(e.code)) e.preventDefault();
    for (const a of acts) if (!c.down.has(a)) { c.down.add(a); c.press.forEach((f) => f(a, e)); }
  });
  window.addEventListener('keyup', (e) => { for (const a of actionsFor(e.code)) if (c.down.delete(a)) c.release.forEach((f) => f(a, e)); });
  window.addEventListener('blur', () => c.clear());
  return c;
}

/* ---------- phone button layout ---------- */
// Each button keeps its own position and size; "All" scales every button together on top of that.
export function createLayout(prefix, ids) {
  const L = { pos: store.get(prefix + '-layout', {}), size: store.get(prefix + '-btnsize', 1), sizes: store.get(prefix + '-btnsizes', {}), ids, editing: false, sel: null, onSelect: null };
  L.sizeOf = (id) => L.sizes[id] ?? 1;
  L.apply = () => {
    for (const id of ids) {
      const el = document.getElementById(id); if (!el) continue;
      const p = L.pos[id];
      el.style.scale = String(+(L.size * L.sizeOf(id)).toFixed(3));
      if (p) Object.assign(el.style, { left: p.x + '%', top: p.y + '%', right: 'auto', bottom: 'auto', translate: '-50% -50%', transform: 'none' });
      else Object.assign(el.style, { left: '', top: '', right: '', bottom: '', translate: '', transform: '' });
      el.classList.toggle('layout-sel', L.editing && L.sel === id);
    }
  };
  L.select = (id) => { L.sel = id; L.apply(); L.onSelect?.(id); };
  L.setSize = (v) => { if (L.sel) L.sizes[L.sel] = v; else L.size = v; L.apply(); };
  L.reset = () => { L.pos = {}; L.size = 1; L.sizes = {}; L.save(); L.apply(); L.onSelect?.(L.sel); };
  L.save = () => { store.set(prefix + '-layout', L.pos); store.set(prefix + '-btnsize', L.size); store.set(prefix + '-btnsizes', L.sizes); };
  let drag = null;
  const onDown = (e) => {
    if (!L.editing) return;
    const el = e.target.closest(ids.map((i) => '#' + i).join(','));
    if (!el || e.target.closest('.layout-bar')) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    drag = { el, id: el.id, pid: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    L.select(el.id);
  };
  const onMove = (e) => {
    if (!drag || e.pointerId !== drag.pid) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return; // a tap only selects
    drag.moved = true;
    const x = Math.max(3, Math.min(97, (e.clientX / innerWidth) * 100)), y = Math.max(5, Math.min(95, (e.clientY / innerHeight) * 100));
    L.pos[drag.id] = { x: +x.toFixed(1), y: +y.toFixed(1) }; L.apply();
  };
  const onUp = (e) => { if (drag && e.pointerId === drag.pid) { e.stopPropagation(); e.stopImmediatePropagation(); drag = null; } };
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('pointermove', onMove, true);
  document.addEventListener('pointerup', onUp, true);
  document.addEventListener('pointercancel', onUp, true);
  L.apply();
  return L;
}

/* ---------- Controls panel (top-bar button + overlay) ---------- */
export function mountControlsPanel({ controls, layout, touch, hud, touchBox, notes = '', extraHtml = '', onRender }) {
  const bar = document.querySelector('.topbar');
  const btn = document.createElement('button'); btn.className = 'about-btn controls-btn'; btn.type = 'button';
  btn.innerHTML = '<span class="full">Controls</span><span class="short" aria-hidden="true">⚙</span>'; btn.setAttribute('aria-label', 'Controls');
  bar.insertBefore(btn, bar.children[1] || null);
  const ov = document.createElement('div'); ov.className = 'overlay about controls-ov'; ov.hidden = true;
  document.body.appendChild(ov);
  const editBar = document.createElement('div'); editBar.className = 'layout-bar'; editBar.hidden = true;
  editBar.innerHTML = `<b>Drag to move · tap to pick one to resize</b><label><span data-selname>All buttons</span> <input type="range" min="0.5" max="1.8" step="0.05" data-size></label><button type="button" data-lall>All</button><button type="button" data-lreset>Reset</button><button type="button" class="done" data-ldone>Done</button>`;
  document.body.appendChild(editBar);

  const render = () => {
    const keysHtml = `<h3 class="ctl-h">Keyboard</h3><p class="ctl-note">Mouse: left click fires (aimed while you are aiming), right click aims (two-finger tap on a trackpad), middle click aims and fires. Click a key below, then press the new key. Backspace clears it, Esc cancels.</p>
      <table class="keytable"><tbody>${controls.defs.map(([id, label]) => `<tr><td>${esc(label)}</td>${[0, 1].map((s) => `<td><button type="button" class="keycap" data-bind="${id}" data-slot="${s}">${esc(controls.binds[id][s] ? keyLabel(controls.binds[id][s]) : '+')}</button></td>`).join('')}</tr>`).join('')}</tbody></table>
      <div class="actions"><button type="button" class="btn" data-kreset>Reset keys</button></div>`;
    const layoutHtml = `<h3 class="ctl-h">Phone buttons</h3><p class="ctl-note">Three ways to shoot: <b>Hip fire</b> (never aims), <b>Aim</b> (aims only) and <b>Aim + fire</b> (aims and shoots while held). Drag on either fire button to steer. Move any on-screen button, including the movement stick. Tap a button to resize just that one, or use All to resize every button. Your layout is saved on this device.</p>
      <div class="actions"><button type="button" class="btn btn-solid" data-ledit>Customise button layout</button><button type="button" class="btn" data-lreset2>Reset layout</button></div>`;
    ov.innerHTML = `<div class="panel panel-wide"><div class="about-head"><div><p class="kicker">Settings</p><h2>Controls</h2></div><button class="close-x" type="button" data-close>Close</button></div>
      ${notes ? `<p class="ctl-note">${notes}</p>` : ''}${touch ? layoutHtml : ''}${extraHtml}${keysHtml}</div>`;
    onRender?.(ov);
  };
  const open = () => { render(); ov.hidden = false; window.dispatchEvent(new Event('aboutopen')); };
  const close = () => { ov.hidden = true; controls.capturing = null; window.dispatchEvent(new Event('aboutclose')); };
  btn.addEventListener('click', open);
  ov.addEventListener('click', (e) => {
    const t = e.target;
    if (t === ov || t.closest('[data-close]')) return close();
    const kb = t.closest('[data-bind]');
    if (kb) {
      ov.querySelectorAll('.keycap.listening').forEach((x) => x.classList.remove('listening'));
      kb.classList.add('listening'); kb.textContent = 'Press a key…';
      controls.capturing = { id: kb.dataset.bind, slot: Number(kb.dataset.slot) };
      return;
    }
    if (t.closest('[data-kreset]')) { controls.reset(); render(); }
    if (t.closest('[data-ledit]')) startEdit();
    if (t.closest('[data-lreset2]')) layout?.reset();
  });
  window.addEventListener('keydown', (e) => {
    if (!controls.capturing) return;
    e.preventDefault(); e.stopPropagation();
    const { id, slot } = controls.capturing; controls.capturing = null;
    if (e.code === 'Escape') return render();
    controls.bind(id, slot, e.code === 'Backspace' ? null : e.code);
    render();
  }, true);

  // layout editing
  let restore = null;
  const startEdit = () => {
    if (!layout) return;
    ov.hidden = true;
    restore = { hud: hud?.hidden, touch: touchBox?.hidden };
    if (hud) hud.hidden = false; if (touchBox) touchBox.hidden = false;
    document.body.classList.add('layout-editing'); layout.editing = true;
    editBar.hidden = false; layout.onSelect = syncBar; layout.select(null);
    window.dispatchEvent(new Event('aboutopen'));
  };
  const endEdit = () => {
    layout.editing = false; layout.sel = null; layout.save(); layout.apply(); document.body.classList.remove('layout-editing'); editBar.hidden = true;
    if (hud && restore) hud.hidden = restore.hud; if (touchBox && restore) touchBox.hidden = restore.touch;
    window.dispatchEvent(new Event('aboutclose'));
  };
  const nameOf = (id) => { const el = document.getElementById(id); return id === 'stick' ? 'Move stick' : (el?.getAttribute('aria-label') || el?.textContent.trim() || id); };
  const syncBar = (id) => {
    editBar.querySelector('[data-selname]').textContent = id ? nameOf(id) : 'All buttons';
    editBar.querySelector('[data-size]').value = id ? layout.sizeOf(id) : layout.size;
    editBar.querySelector('[data-lall]').setAttribute('aria-pressed', String(!id));
  };
  editBar.addEventListener('input', (e) => { if (e.target.dataset.size !== undefined) layout.setSize(Number(e.target.value)); });
  editBar.addEventListener('click', (e) => {
    if (e.target.closest('[data-lall]')) layout.select(null);
    if (e.target.closest('[data-lreset]')) layout.reset();
    if (e.target.closest('[data-ldone]')) endEdit();
  });
  return { open, close };
}
