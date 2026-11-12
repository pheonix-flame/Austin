const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
export const SENS_MIN = 0.1, SENS_MAX = 4;

export function createSens(prefix) {
  const s = {
    mouse: store.get(prefix + '-s-mouse', 1), mouseAds: store.get(prefix + '-s-mouseads', 0.8),
    touch: store.get(prefix + '-s-touch', 1), touchAds: store.get(prefix + '-s-touchads', 0.8),
  };
  s.set = (k, v) => { s[k] = Math.max(SENS_MIN, Math.min(SENS_MAX, v)); store.set(prefix + '-s-' + k.toLowerCase(), s[k]); };
  s.factor = (device, adsT, zoom) => (s[device] + (s[device + 'Ads'] - s[device]) * adsT) / zoom;
  return s;
}

export function mountSensSettings(s, touch, root = document) {
  const rows = touch
    ? [['touch', 'Touch look: not aiming'], ['touchAds', 'Touch look: aiming (zoomed)']]
    : [['mouse', 'Mouse: not aiming'], ['mouseAds', 'Mouse: aiming (zoomed)']];
  root.querySelectorAll('.sens-settings').forEach((box) => {
    box.innerHTML = rows.map(([k, label]) => `<label class="sens">${label} <b data-sv="${k}"></b>
      <input type="range" data-sk="${k}" min="${SENS_MIN}" max="${SENS_MAX}" step="0.05" aria-label="${label}"></label>`).join('');
    box.addEventListener('input', (e) => { const k = e.target.dataset.sk; if (k) { s.set(k, Number(e.target.value)); sync(); } });
  });
  const sync = () => {
    root.querySelectorAll('[data-sk]').forEach((el) => (el.value = s[el.dataset.sk]));
    root.querySelectorAll('[data-sv]').forEach((el) => (el.textContent = s[el.dataset.sv].toFixed(2) + '×'));
  };
  sync();
}
