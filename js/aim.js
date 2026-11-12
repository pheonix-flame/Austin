const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const HOLD_MS = 300;

export function createAim(prefix, touch) {
  const a = { mode: store.get(prefix + '-aim2', touch ? 'toggle' : 'auto'), on: false, pressedAt: 0, listeners: new Set(), forced: new Set(), hip: new Set() };
  a.active = () => a.forced.size > 0 || (a.on && a.hip.size === 0);
  a.force = (src, on) => { a.forced[on ? 'add' : 'delete'](src); a.emit(); };
  a.hipHold = (src, on) => { a.hip[on ? 'add' : 'delete'](src); a.emit(); };
  a.press = (t = performance.now()) => {
    if (a.mode === 'hold') a.on = true;
    else if (a.mode === 'toggle') a.on = !a.on;
    else if (a.on) { a.on = false; a.pressedAt = 0; } else { a.on = true; a.pressedAt = t || performance.now(); }
    a.emit();
  };
  a.release = (t = performance.now()) => {
    if (a.mode === 'hold') a.on = false;
    else if (a.mode === 'auto' && a.pressedAt && (t || performance.now()) - a.pressedAt > HOLD_MS) a.on = false;
    a.pressedAt = 0; a.emit();
  };
  a.reset = () => { a.on = false; a.pressedAt = 0; a.forced.clear(); a.hip.clear(); a.emit(); };
  a.releaseAll = (t) => { a.forced.clear(); a.hip.clear(); a.release(t); };
  a.setMode = (m) => { a.mode = m; store.set(prefix + '-aim2', m); a.reset(); };
  a.emit = () => a.listeners.forEach((f) => f(a));
  a.onChange = (f) => { a.listeners.add(f); f(a); };
  return a;
}

export function mountAimSettings(a, root = document) {
  root.querySelectorAll('.aim-settings').forEach((box) => {
    box.innerHTML = `<span>Aim down sights</span><div class="seg" role="radiogroup" aria-label="Aim mode">
      <button type="button" data-aim="auto" title="Tap to toggle, hold to aim while held">Auto</button><button type="button" data-aim="hold">Hold</button><button type="button" data-aim="toggle">Toggle</button></div>`;
    box.addEventListener('click', (e) => { const b = e.target.closest('[data-aim]'); if (b) { a.setMode(b.dataset.aim); sync(); } });
  });
  const sync = () => root.querySelectorAll('[data-aim]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.aim === a.mode)));
  sync();
}

let lastTouch = 0;
window.addEventListener('touchstart', () => (lastTouch = performance.now()), { capture: true, passive: true });
export const fromTouch = () => performance.now() - lastTouch < 900;

export function firePad(el, { down, up, look }) {
  let id = null, lx = 0, ly = 0;
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); id = e.pointerId; lx = e.clientX; ly = e.clientY; try { el.setPointerCapture(id); } catch {} down(); });
  el.addEventListener('pointermove', (e) => { if (e.pointerId !== id) return; look(e.clientX - lx, e.clientY - ly); lx = e.clientX; ly = e.clientY; });
  const end = (e) => { if (e.pointerId !== id) return; id = null; up(); };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
}
