const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

export const SENS_MIN = 0.2, SENS_MAX = 5;

export function createGyro({ prefix, onLook, isActive, notify = () => {}, adsT = () => 0 }) {
  const g = {
    on: store.get(prefix + '-gyro', true),
    sens: store.get(prefix + '-gyro-sens', 1.2),
    sensAds: store.get(prefix + '-gyro-sensads', 0.9),
    invX: store.get(prefix + '-gyro-invx', false),
    invY: store.get(prefix + '-gyro-invy', false),
    listening: false, last: 0, seen: false, listeners: new Set(),
  };
  const supported = typeof window.DeviceMotionEvent !== 'undefined';

  function angle() {
    const a = screen.orientation && typeof screen.orientation.angle === 'number' ? screen.orientation.angle : (window.orientation || 0);
    return ((a % 360) + 360) % 360;
  }
  function onMotion(e) {
    const now = performance.now(), dt = Math.min(0.1, (now - (g.last || now)) / 1000); g.last = now;
    const r = e.rotationRate; if (!r || r.beta === null || r.beta === undefined) return;
    g.seen = true;
    if (!g.on || !isActive()) return;
    const a = angle();
    let yaw, pitch;
    if (a === 90) { yaw = r.beta; pitch = -r.gamma; }
    else if (a === 270) { yaw = -r.beta; pitch = r.gamma; }
    else if (a === 180) { yaw = -r.gamma; pitch = -r.beta; }
    else { yaw = r.gamma; pitch = r.beta; }
    const dz = (v) => (Math.abs(v) < 1.2 ? 0 : v);
    const t = adsT(), k = (Math.PI / 180) * dt * (g.sens + (g.sensAds - g.sens) * t);
    onLook(dz(yaw) * k * (g.invX ? -1 : 1), dz(pitch) * k * (g.invY ? -1 : 1));
  }
  async function enable() {
    if (!supported) { notify('Gyro is not available on this device'); return false; }
    try {
      if (typeof DeviceMotionEvent.requestPermission === 'function') {
        const res = await DeviceMotionEvent.requestPermission();
        if (res !== 'granted') { notify('Motion access was declined. Drag to look instead.'); return false; }
      }
    } catch { return false; }
    if (!g.listening) { window.addEventListener('devicemotion', onMotion); g.listening = true; }
    setTimeout(() => { if (g.on && !g.seen && isActive()) notify('No gyro data yet. Your browser may block motion sensors.'); }, 2500);
    return true;
  }
  const changed = () => g.listeners.forEach((f) => f(g));
  g.set = async (on) => {
    if (on && !(await enable())) on = false;
    g.on = on; store.set(prefix + '-gyro', on); changed();
  };
  g.setSens = (v) => { g.sens = Math.max(SENS_MIN, Math.min(SENS_MAX, v)); store.set(prefix + '-gyro-sens', g.sens); changed(); };
  g.setSensAds = (v) => { g.sensAds = Math.max(SENS_MIN, Math.min(SENS_MAX, v)); store.set(prefix + '-gyro-sensads', g.sensAds); changed(); };
  g.setInvert = (axis, v) => { g[axis === 'x' ? 'invX' : 'invY'] = v; store.set(prefix + '-gyro-inv' + axis, v); changed(); };
  g.onChange = (f) => { g.listeners.add(f); f(g); };
  g.start = () => (g.on ? g.set(true) : Promise.resolve());
  return g;
}

export function mountGyroSettings(g, root = document) {
  root.querySelectorAll('.gyro-settings').forEach((box) => {
    box.innerHTML = `
      <label class="switch"><input type="checkbox" data-gyro="on"><span></span>Gyro aiming (tilt and turn your phone to aim)</label>
      <label class="sens">Gyro: not aiming <b data-gyro="sensval"></b>
        <input type="range" data-gyro="sens" min="${SENS_MIN}" max="${SENS_MAX}" step="0.1" aria-label="Gyro sensitivity when not aiming"></label>
      <label class="sens">Gyro: aiming (zoomed) <b data-gyro="sensadsval"></b>
        <input type="range" data-gyro="sensads" min="${SENS_MIN}" max="${SENS_MAX}" step="0.1" aria-label="Gyro sensitivity when aiming"></label>
      <div class="inv">
        <label class="switch"><input type="checkbox" data-gyro="invx"><span></span>Invert left/right</label>
        <label class="switch"><input type="checkbox" data-gyro="invy"><span></span>Invert up/down</label>
      </div>`;
    box.querySelector('[data-gyro="on"]').addEventListener('change', (e) => g.set(e.target.checked));
    box.querySelector('[data-gyro="sens"]').addEventListener('input', (e) => g.setSens(Number(e.target.value)));
    box.querySelector('[data-gyro="sensads"]').addEventListener('input', (e) => g.setSensAds(Number(e.target.value)));
    box.querySelector('[data-gyro="invx"]').addEventListener('change', (e) => g.setInvert('x', e.target.checked));
    box.querySelector('[data-gyro="invy"]').addEventListener('change', (e) => g.setInvert('y', e.target.checked));
  });
  g.onChange(() => {
    root.querySelectorAll('[data-gyro="on"]').forEach((el) => (el.checked = g.on));
    root.querySelectorAll('[data-gyro="sens"]').forEach((el) => (el.value = g.sens));
    root.querySelectorAll('[data-gyro="sensval"]').forEach((el) => (el.textContent = g.sens.toFixed(1) + '×'));
    root.querySelectorAll('[data-gyro="sensads"]').forEach((el) => (el.value = g.sensAds));
    root.querySelectorAll('[data-gyro="sensadsval"]').forEach((el) => (el.textContent = g.sensAds.toFixed(1) + '×'));
    root.querySelectorAll('[data-gyro="invx"]').forEach((el) => (el.checked = g.invX));
    root.querySelectorAll('[data-gyro="invy"]').forEach((el) => (el.checked = g.invY));
  });
}
