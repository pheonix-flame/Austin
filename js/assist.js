const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
export const ASSIST_LEVELS = ['Off', 'Low', 'Standard', 'Strong'];
const STRENGTH = [0, 0.5, 1, 1.5];
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

export function createAssist(prefix, touch) {
  const A = { level: store.get(prefix + '-assist', touch ? 2 : 1), mul: 1, target: null, listeners: new Set() };
  A.strength = () => STRENGTH[A.level] || 0;
  A.setLevel = (l) => { A.level = l; store.set(prefix + '-assist', l); A.listeners.forEach((f) => f(A)); };
  A.find = (eye, yaw, pitch, targets, visible, adsT = 0) => {
    const s = A.strength(); A.target = null; if (!s) return null;
    let best = null;
    for (const t of targets) {
      const dx = t.x - eye.x, dy = t.y - eye.y, dz = t.z - eye.z, flat = Math.hypot(dx, dz), dist = Math.hypot(flat, dy);
      if (dist < 0.5 || dist > 80) continue;
      const dyaw = wrap(Math.atan2(-dx, -dz) - yaw), dpitch = Math.atan2(dy, flat) - pitch;
      const ang = Math.hypot(dyaw, dpitch);
      const cone = Math.min(0.32, s * (0.05 + 0.9 / Math.max(dist, 2)) * (1 + 0.3 * adsT));
      if (ang > cone || (best && ang / cone >= best.close0)) continue;
      if (!visible(t)) continue;
      best = { t, dyaw, dpitch, ang, cone, dist, close0: ang / cone };
    }
    if (best) best.close = 1 - best.close0;
    A.target = best;
    return best;
  };
  A.apply = (view, dt, { adsT = 0, firing = false } = {}) => {
    const b = A.target, s = A.strength();
    if (!b || !s) { A.mul = 1; return; }
    A.mul = 1 - Math.min(0.6, 0.4 * s * b.close);
    if (adsT > 0.25 || firing) {
      const k = Math.min(1, dt * s * (1.2 + 3 * adsT) * (0.4 + 0.6 * b.close));
      view.yaw += b.dyaw * k; view.pitch += b.dpitch * k * 0.7;
    }
  };
  return A;
}

export function mountAssistSettings(A, root = document) {
  root.querySelectorAll('.assist-settings').forEach((box) => {
    if (box.dataset.mounted) return; box.dataset.mounted = '1';
    box.innerHTML = `<span>Aim assist</span><div class="seg" role="radiogroup" aria-label="Aim assist">${ASSIST_LEVELS.map((n, i) => `<button type="button" data-assist="${i}">${n}</button>`).join('')}</div>`;
    box.addEventListener('click', (e) => { const b = e.target.closest('[data-assist]'); if (b) A.setLevel(Number(b.dataset.assist)); });
  });
  const sync = A._sync || (A._sync = () => document.querySelectorAll('[data-assist]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.assist) === A.level))));
  A.listeners.add(sync); sync();
}
