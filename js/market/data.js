const DAY = 86400;
export const CAL_24_7 = 365 * DAY;
export const CAL_24_5 = 260 * DAY;

export const INSTRUMENTS = [
  { id: 'V75', spreadBps: 1, name: 'Volatility 75 Index', group: 'Synthetic indices', deriv: 'R_75', dp: 4, vol: 0.75, start: 420000, cal: CAL_24_7, model: 'gbm' },
  { id: 'V100', spreadBps: 1, name: 'Volatility 100 Index', group: 'Synthetic indices', deriv: 'R_100', dp: 2, vol: 1.0, start: 1200, cal: CAL_24_7, model: 'gbm' },
  { id: 'STEP', spreadBps: 1, name: 'Step Index', group: 'Synthetic indices', deriv: 'stpRNG', dp: 1, vol: 0, start: 8000, cal: CAL_24_7, model: 'step', stepSize: 0.1 },
  { id: 'EURUSD', spreadBps: 0.8, name: 'Euro / US Dollar', group: 'Forex', deriv: 'frxEURUSD', dp: 5, vol: 0.07, start: 1.085, cal: CAL_24_5, model: 'regime' },
  { id: 'GBPUSD', spreadBps: 1, name: 'British Pound / US Dollar', group: 'Forex', deriv: 'frxGBPUSD', dp: 5, vol: 0.08, start: 1.27, cal: CAL_24_5, model: 'regime' },
  { id: 'USDJPY', spreadBps: 1, name: 'US Dollar / Japanese Yen', group: 'Forex', deriv: 'frxUSDJPY', dp: 3, vol: 0.09, start: 150.0, cal: CAL_24_5, model: 'regime' },
  { id: 'AUDUSD', spreadBps: 1.2, name: 'Australian Dollar / US Dollar', group: 'Forex', deriv: 'frxAUDUSD', dp: 5, vol: 0.1, start: 0.66, cal: CAL_24_5, model: 'regime' },
  { id: 'XAUUSD', spreadBps: 1.5, name: 'Gold / US Dollar', group: 'Gold', deriv: 'frxXAUUSD', dp: 2, vol: 0.16, start: 2650, cal: CAL_24_5, model: 'regime' },
  { id: 'BTCUSD', spreadBps: 5, name: 'Bitcoin / US Dollar', group: 'Crypto', deriv: 'cryBTCUSD', dp: 2, vol: 0.55, start: 90000, cal: CAL_24_7, model: 'regime' },
  { id: 'ETHUSD', spreadBps: 6, name: 'Ethereum / US Dollar', group: 'Crypto', deriv: 'cryETHUSD', dp: 2, vol: 0.7, start: 3200, cal: CAL_24_7, model: 'regime' },
];

export const TIMEFRAMES = [
  { id: '1m', label: '1m', sec: 60 },
  { id: '5m', label: '5m', sec: 300 },
  { id: '1h', label: '1h', sec: 3600 },
  { id: '1d', label: '1D', sec: 86400 },
];

export const barsPerYear = (inst, tfSec) => inst.cal / tfSec;

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function gauss(rnd) {
  let u = 0; while (u === 0) u = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}

export class Simulator {
  constructor(inst, tfSec, seed = Math.floor(Math.random() * 1e9)) {
    this.inst = inst; this.tf = tfSec; this.rnd = mulberry32(seed); this.seed = seed;
    this.regime = this.rnd() < 0.55 ? 1 : -1;
    this.volMult = 1;
    this.price = inst.start;
  }

  sigmaPerSec() { return this.inst.vol / Math.sqrt(this.inst.cal); }

  advance(sec, steps = 12) {
    const { inst, rnd } = this;
    const path = [];
    const dt = sec / steps;
    for (let i = 0; i < steps; i++) {
      if (inst.model === 'step') {
        const n = Math.max(1, Math.round(dt));
        const moves = n > 30 ? Math.round(gauss(rnd) * Math.sqrt(n)) : [...Array(n)].reduce((s) => s + (rnd() < 0.5 ? -1 : 1), 0);
        this.price = Math.max(inst.stepSize, this.price + moves * inst.stepSize);
      } else if (inst.model === 'gbm') {
        const s = this.sigmaPerSec() * Math.sqrt(dt);
        this.price *= Math.exp(-0.5 * s * s + s * gauss(rnd));
      } else {
        const pFlip = 1 - Math.pow(1 - 0.025, dt / DAY);
        if (rnd() < pFlip) this.regime = -this.regime;
        this.volMult += (1 - this.volMult) * Math.min(1, dt / (5 * DAY)) + 0.15 * Math.sqrt(Math.min(1, dt / DAY)) * gauss(rnd) * 0.5;
        this.volMult = Math.min(2.5, Math.max(0.5, this.volMult));
        const sigma = this.sigmaPerSec() * (this.regime === 1 ? 0.85 : 1.25) * this.volMult;
        const drift = (this.regime === 1 ? 1 : -1) * inst.vol * 0.9 / inst.cal;
        const s = sigma * Math.sqrt(dt);
        let x = drift * dt + s * gauss(rnd);
        if (rnd() < 0.004 * Math.min(1, dt / 3600)) x += (rnd() < 0.5 ? -1 : 1) * s * 4;
        this.price *= Math.exp(x);
      }
      path.push(this.price);
    }
    return path;
  }

  candle(epoch) {
    const open = this.price;
    const path = this.advance(this.tf);
    return { epoch, open, high: Math.max(open, ...path), low: Math.min(open, ...path), close: this.price, regime: this.regime };
  }

  history(count) {
    const now = Math.floor(Date.now() / 1000);
    const lastOpen = now - (now % this.tf);
    const out = [];
    for (let i = count - 1; i >= 0; i--) out.push(this.candle(lastOpen - i * this.tf));
    return out;
  }

  tick(candles) {
    const now = Math.floor(Date.now() / 1000);
    const barOpen = now - (now % this.tf);
    const last = candles[candles.length - 1];
    this.advance(1, 1);
    const p = this.price;
    if (!last || barOpen > last.epoch) {
      candles.push({ epoch: barOpen, open: last ? last.close : p, high: p, low: p, close: p, regime: this.regime });
      return true;
    }
    last.close = p; last.high = Math.max(last.high, p); last.low = Math.min(last.low, p);
    return false;
  }
}

export const DERIV_APP_ID = 1089;

export class DerivClient {
  constructor() {
    const q = new URLSearchParams(location.search);
    const appId = q.get('app_id') || DERIV_APP_ID;
    this.url = q.get('ws') || `wss://ws.derivws.com/websockets/v3?app_id=${appId}`;
    this.ws = null; this.reqId = 1; this.pending = new Map(); this.streams = new Map();
    this.onStatus = () => {};
  }

  connect(timeoutMs = 7000) {
    if (this.ws && this.ws.readyState === 1) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let done = false;
      const fail = (why) => { if (!done) { done = true; reject(new Error(why)); } };
      let ws;
      try { ws = new WebSocket(this.url); } catch (e) { return fail('WebSocket blocked'); }
      this.ws = ws;
      const t = setTimeout(() => { fail('Timed out connecting to Deriv'); try { ws.close(); } catch {} }, timeoutMs);
      ws.onopen = () => { clearTimeout(t); done = true; resolve(); this.startPing(); };
      ws.onerror = () => { clearTimeout(t); fail('Could not reach Deriv'); };
      ws.onclose = () => { this.stopPing(); this.onStatus('closed'); };
      ws.onmessage = (ev) => this.handle(ev.data);
    });
  }

  startPing() { this.stopPing(); this.pingT = setInterval(() => this.raw({ ping: 1 }), 30000); }
  stopPing() { clearInterval(this.pingT); }
  raw(obj) { try { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); } catch {} }

  handle(data) {
    let msg; try { msg = JSON.parse(data); } catch { return; }
    const id = msg.req_id;
    if (id && this.pending.has(id)) {
      const { resolve, stream } = this.pending.get(id);
      this.pending.delete(id);
      if (stream && !msg.error) this.streams.set(id, stream);
      resolve(msg);
      return;
    }
    if (id && this.streams.has(id)) this.streams.get(id)(msg);
  }

  request(obj, stream, timeoutMs = 12000) {
    const req_id = this.reqId++;
    return new Promise((resolve, reject) => {
      this.pending.set(req_id, { resolve, stream });
      this.raw({ ...obj, req_id });
      setTimeout(() => { if (this.pending.has(req_id)) { this.pending.delete(req_id); reject(new Error('Deriv request timed out')); } }, timeoutMs);
    });
  }

  async forgetAll() {
    this.streams.clear();
    try { await this.request({ forget_all: ['candles', 'ticks'] }, null, 5000); } catch {}
  }

  async candles(symbol, granularity, count, onBar) {
    await this.connect();
    await this.forgetAll();
    const base = { ticks_history: symbol, style: 'candles', granularity, count, end: 'latest', adjust_start_time: 1 };
    let msg = onBar ? await this.request({ ...base, subscribe: 1 }, (m) => this.onOhlc(m, onBar)) : await this.request(base);
    let streaming = !!onBar && !msg.error;
    if (msg.error && onBar) {
      const closedReason = msg.error.message;
      msg = await this.request(base);
      if (msg.error) throw new Error(msg.error.message);
      return { candles: parseCandles(msg.candles), streaming: false, note: closedReason };
    }
    if (msg.error) throw new Error(msg.error.message);
    return { candles: parseCandles(msg.candles), streaming };
  }

  onOhlc(m, onBar) {
    if (m.error || !m.ohlc) return;
    const o = m.ohlc;
    onBar({ epoch: Number(o.open_time), open: +o.open, high: +o.high, low: +o.low, close: +o.close });
  }
}

function parseCandles(arr = []) {
  return arr.map((c) => ({ epoch: Number(c.epoch), open: +c.open, high: +c.high, low: +c.low, close: +c.close }));
}
