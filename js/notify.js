const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const DEFAULTS = { level: 'all', pos: 'top', size: 1, dur: 1.6 };
const REPEAT_S = 3;

export function createNotify(prefix, el) {
  const n = { ...DEFAULTS, ...store.get(prefix + '-notify', {}), t: 0, last: '', lastAt: -1e9, listeners: new Set() };
  const save = () => store.set(prefix + '-notify', { level: n.level, pos: n.pos, size: n.size, dur: n.dur });
  n.applyStyle = () => {
    el.dataset.pos = n.pos;
    el.style.setProperty('--toast-scale', n.size);
  };
  n.show = (msg, kind = 'info') => {
    if (n.level === 'off' || (n.level === 'important' && kind !== 'warn')) return;
    const now = performance.now() / 1000;
    if (msg === n.last && now - n.lastAt < REPEAT_S) return;
    n.last = msg; n.lastAt = now;
    el.textContent = msg;
    el.classList.toggle('bad', kind === 'warn');
    el.classList.add('on');
    n.t = n.dur;
  };
  n.tick = (dt) => { if (n.t > 0) { n.t -= dt; if (n.t <= 0) el.classList.remove('on'); } };
  n.set = (k, v) => { n[k] = v; save(); n.applyStyle(); n.listeners.forEach((f) => f(n)); };
  n.preview = () => { n.last = ''; n.show('Messages appear here', 'warn'); };
  n.applyStyle();
  return n;
}

export function mountNotifySettings(n, root = document) {
  const sync = n._sync || (n._sync = () => {
    document.querySelectorAll('[data-nk]').forEach((b) => b.setAttribute('aria-pressed', String(n[b.dataset.nk] === b.dataset.nv)));
    document.querySelectorAll('[data-nr]').forEach((i) => { if (document.activeElement !== i) i.value = n[i.dataset.nr]; });
    document.querySelectorAll('[data-nout="size"]').forEach((o) => (o.textContent = Math.round(n.size * 100) + '%'));
    document.querySelectorAll('[data-nout="dur"]').forEach((o) => (o.textContent = n.dur.toFixed(1) + ' s'));
  });
  n.listeners.add(sync);
  const seg = (key, label, opts) => `<div class="ns-row"><span>${label}</span><div class="seg" role="radiogroup" aria-label="${label}">${opts.map(([v, t]) => `<button type="button" data-nk="${key}" data-nv="${v}">${t}</button>`).join('')}</div></div>`;
  root.querySelectorAll('.notify-settings').forEach((box) => {
    if (box.dataset.mounted) return; box.dataset.mounted = '1';
    box.innerHTML = `<div class="ns-title">On-screen messages</div>
      ${seg('level', 'Show', [['all', 'All'], ['important', 'Important'], ['off', 'Off']])}
      ${seg('pos', 'Position', [['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']])}
      <label class="sens"><span>Text size</span><b data-nout="size"></b><input type="range" min="0.7" max="1.5" step="0.05" data-nr="size"></label>
      <label class="sens"><span>Stays on screen</span><b data-nout="dur"></b><input type="range" min="0.6" max="4" step="0.2" data-nr="dur"></label>`;
    box.addEventListener('click', (e) => { const b = e.target.closest('[data-nk]'); if (b) { n.set(b.dataset.nk, b.dataset.nv); if (n.level !== 'off') n.preview(); } });
    box.addEventListener('input', (e) => { const k = e.target.dataset.nr; if (k) n.set(k, Number(e.target.value)); });
    box.addEventListener('change', (e) => { if (e.target.dataset.nr && n.level !== 'off') n.preview(); });
  });
  sync();
}
