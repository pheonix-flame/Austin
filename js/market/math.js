/* ==========================================================================
   Indicators, statistics, strategies and backtesting
   ========================================================================== */
import { mulberry32 } from './data.js';

/* ---------- indicators (all return arrays aligned to input, NaN until warm) ---------- */
export function sma(x, n) {
  const out = new Array(x.length).fill(NaN); let s = 0;
  for (let i = 0; i < x.length; i++) {
    s += x[i]; if (i >= n) s -= x[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}
export function ema(x, n) {
  const out = new Array(x.length).fill(NaN); const k = 2 / (n + 1); let e = NaN;
  for (let i = 0; i < x.length; i++) {
    if (i === n - 1) { let s = 0; for (let j = 0; j < n; j++) s += x[j]; e = s / n; }
    else if (i >= n) e = x[i] * k + e * (1 - k);
    out[i] = i >= n - 1 ? e : NaN;
  }
  return out;
}
export function stdev(x, n) {
  const out = new Array(x.length).fill(NaN);
  for (let i = n - 1; i < x.length; i++) {
    let s = 0, s2 = 0; for (let j = i - n + 1; j <= i; j++) { s += x[j]; s2 += x[j] * x[j]; }
    const m = s / n; out[i] = Math.sqrt(Math.max(0, s2 / n - m * m));
  }
  return out;
}
export function bollinger(x, n = 20, k = 2) {
  const m = sma(x, n), sd = stdev(x, n);
  return { mid: m, upper: m.map((v, i) => v + k * sd[i]), lower: m.map((v, i) => v - k * sd[i]) };
}
export function rsi(x, n = 14) {
  const out = new Array(x.length).fill(NaN); let g = 0, l = 0;
  for (let i = 1; i < x.length; i++) {
    const d = x[i] - x[i - 1], up = Math.max(0, d), dn = Math.max(0, -d);
    if (i <= n) { g += up / n; l += dn / n; if (i === n) out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
    else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
  }
  return out;
}
export function atr(c, n = 14) {
  const tr = c.map((b, i) => (i ? Math.max(b.high - b.low, Math.abs(b.high - c[i - 1].close), Math.abs(b.low - c[i - 1].close)) : b.high - b.low));
  return ema(tr, n);
}
export function donchian(c, n) {
  const hi = new Array(c.length).fill(NaN), lo = new Array(c.length).fill(NaN);
  for (let i = n; i < c.length; i++) {
    let h = -Infinity, l = Infinity;
    for (let j = i - n; j < i; j++) { h = Math.max(h, c[j].high); l = Math.min(l, c[j].low); }
    hi[i] = h; lo[i] = l;
  }
  return { hi, lo };
}

/* ---------- descriptive statistics ---------- */
export function logReturns(closes) {
  const r = []; for (let i = 1; i < closes.length; i++) r.push(Math.log(closes[i] / closes[i - 1])); return r;
}
export function describe(r) {
  const n = r.length; if (n < 3) return null;
  const mean = r.reduce((a, b) => a + b, 0) / n;
  let m2 = 0, m3 = 0, m4 = 0, ac = 0;
  for (let i = 0; i < n; i++) { const d = r[i] - mean; m2 += d * d; m3 += d ** 3; m4 += d ** 4; if (i) ac += d * (r[i - 1] - mean); }
  m2 /= n; m3 /= n; m4 /= n;
  const sd = Math.sqrt(m2);
  const sorted = [...r].sort((a, b) => a - b);
  return {
    n, mean, sd,
    skew: sd ? m3 / sd ** 3 : 0,
    kurt: sd ? m4 / sd ** 4 - 3 : 0,
    acf1: m2 ? ac / n / m2 : 0,
    var95: -sorted[Math.floor(0.05 * n)],
    cvar95: -sorted.slice(0, Math.max(1, Math.floor(0.05 * n))).reduce((a, b) => a + b, 0) / Math.max(1, Math.floor(0.05 * n)),
  };
}
/* Hurst exponent via rescaled range: ~0.5 random walk, >0.5 trending, <0.5 mean-reverting */
export function hurst(r) {
  const n = r.length; if (n < 64) return NaN;
  const xs = [], ys = [];
  for (let size = 8; size <= n / 2; size = Math.floor(size * 1.6)) {
    let rsSum = 0, cnt = 0;
    for (let s = 0; s + size <= n; s += size) {
      const seg = r.slice(s, s + size);
      const m = seg.reduce((a, b) => a + b, 0) / size;
      let cum = 0, mx = -Infinity, mn = Infinity, v = 0;
      for (const x of seg) { cum += x - m; mx = Math.max(mx, cum); mn = Math.min(mn, cum); v += (x - m) ** 2; }
      const sd = Math.sqrt(v / size);
      if (sd > 0) { rsSum += (mx - mn) / sd; cnt++; }
    }
    if (cnt) { xs.push(Math.log(size)); ys.push(Math.log(rsSum / cnt)); }
  }
  if (xs.length < 3) return NaN;
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0, den = 0; xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
  return num / den;
}
export function maxDrawdown(series) {
  let peak = -Infinity, mdd = 0;
  for (const v of series) { peak = Math.max(peak, v); mdd = Math.max(mdd, 1 - v / peak); }
  return mdd;
}

/* ---------- strategies: return position array pos[t] held from close t to close t+1 ---------- */
export const STRATEGIES = {
  sma: {
    name: 'Moving-average crossover',
    blurb: 'Long when the fast SMA is above the slow SMA, short when below. A classic trend follower.',
    params: [{ key: 'fast', label: 'Fast SMA', value: 10, min: 2, max: 100 }, { key: 'slow', label: 'Slow SMA', value: 40, min: 5, max: 300 }],
    sweep: { x: { key: 'fast', from: 5, to: 40, step: 5 }, y: { key: 'slow', from: 20, to: 200, step: 20 } },
    run(c, p) {
      const x = c.map((b) => b.close), f = sma(x, p.fast), s = sma(x, p.slow);
      return x.map((_, i) => (isNaN(s[i]) || isNaN(f[i]) ? 0 : f[i] > s[i] ? 1 : -1));
    },
  },
  rsi: {
    name: 'RSI mean reversion',
    blurb: 'Buy when RSI is oversold, sell when overbought, exit when RSI returns to 50. Works when prices mean-revert.',
    params: [{ key: 'period', label: 'RSI period', value: 14, min: 2, max: 60 }, { key: 'lower', label: 'Oversold below', value: 30, min: 5, max: 49 }],
    sweep: { x: { key: 'period', from: 4, to: 28, step: 4 }, y: { key: 'lower', from: 15, to: 40, step: 5 } },
    run(c, p) {
      const r = rsi(c.map((b) => b.close), p.period), upper = 100 - p.lower;
      let pos = 0;
      return r.map((v) => {
        if (isNaN(v)) return 0;
        if (v < p.lower) pos = 1; else if (v > upper) pos = -1;
        else if ((pos === 1 && v >= 50) || (pos === -1 && v <= 50)) pos = 0;
        return pos;
      });
    },
  },
  boll: {
    name: 'Bollinger band reversion',
    blurb: 'Fade moves outside the bands: long below the lower band, short above the upper band, exit at the mean.',
    params: [{ key: 'period', label: 'Band period', value: 20, min: 5, max: 200 }, { key: 'k', label: 'Std devs (k)', value: 2, min: 0.5, max: 4, step: 0.5 }],
    sweep: { x: { key: 'period', from: 10, to: 60, step: 10 }, y: { key: 'k', from: 1, to: 3, step: 0.5 } },
    run(c, p) {
      const x = c.map((b) => b.close), bb = bollinger(x, p.period, p.k);
      let pos = 0;
      return x.map((v, i) => {
        if (isNaN(bb.mid[i])) return 0;
        if (v < bb.lower[i]) pos = 1; else if (v > bb.upper[i]) pos = -1;
        else if ((pos === 1 && v >= bb.mid[i]) || (pos === -1 && v <= bb.mid[i])) pos = 0;
        return pos;
      });
    },
  },
  donchian: {
    name: 'Donchian breakout',
    blurb: 'Go long on a new N-bar high, short on a new N-bar low, and hold until the opposite breakout.',
    params: [{ key: 'period', label: 'Channel length', value: 20, min: 5, max: 200 }],
    sweep: { x: { key: 'period', from: 10, to: 120, step: 10 } },
    run(c, p) {
      const d = donchian(c, p.period);
      let pos = 0;
      return c.map((b, i) => {
        if (isNaN(d.hi[i])) return 0;
        if (b.close > d.hi[i]) pos = 1; else if (b.close < d.lo[i]) pos = -1;
        return pos;
      });
    },
  },
};

/* ---------- backtest engine ---------- */
export function backtest(closes, pos, costBps, bpy) {
  const n = closes.length;
  const rets = new Float64Array(n - 1);
  let prev = 0, trades = 0, exposure = 0, gp = 0, gl = 0;
  for (let t = 0; t < n - 1; t++) {
    const p = pos[t], d = Math.abs(p - prev);
    if (d) trades++;
    if (p) exposure++;
    const r = closes[t + 1] / closes[t] - 1;
    const x = p * r - (costBps / 10000) * d;
    rets[t] = x;
    if (x > 0) gp += x; else gl -= x;
    prev = p;
  }
  const m = metrics(rets, bpy);
  return { rets, trades, exposure: exposure / (n - 1), profitFactor: gl ? gp / gl : Infinity, ...m };
}

export function metrics(rets, bpy) {
  let eq = 1, peak = 1, mdd = 0, s = 0, s2 = 0, dn = 0, wins = 0, active = 0;
  const curve = [1];
  for (const x of rets) {
    eq *= 1 + x; curve.push(eq);
    peak = Math.max(peak, eq); mdd = Math.max(mdd, 1 - eq / peak);
    s += x; s2 += x * x; if (x < 0) dn += x * x;
    if (x !== 0) { active++; if (x > 0) wins++; }
  }
  const n = rets.length || 1, mean = s / n, sd = Math.sqrt(Math.max(0, s2 / n - mean * mean)), dsd = Math.sqrt(dn / n);
  return {
    curve, total: eq - 1, mdd,
    vol: sd * Math.sqrt(bpy),
    sharpe: sd > 1e-12 ? (mean / sd) * Math.sqrt(bpy) : 0,
    sortino: dsd > 1e-12 ? (mean / dsd) * Math.sqrt(bpy) : 0,
    hit: active ? wins / active : 0,
  };
}

/* Random traders with the same number of position changes on the same prices.
   Returns sorted Sharpe ratios, the strategy's percentile and a one-sided p-value. */
export function randomEntryTest(closes, trades, sharpe, costBps, bpy, n = 1000, seed = 7) {
  const rnd = mulberry32(seed);
  const len = closes.length;
  const changes = Math.max(2, Math.min(trades, len - 1));
  const pos = new Int8Array(len);
  const out = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const cuts = new Set();
    while (cuts.size < changes) cuts.add(Math.floor(rnd() * (len - 1)));
    let p = 0;
    for (let t = 0; t < len; t++) {
      if (cuts.has(t)) { const o = [-1, 0, 1].filter((v) => v !== p); p = o[Math.floor(rnd() * 2)]; }
      pos[t] = p;
    }
    out[k] = backtest(closes, pos, costBps, bpy).sharpe;
  }
  const sorted = Array.from(out).sort((a, b) => a - b);
  const below = sorted.filter((s) => s < sharpe).length;
  return {
    sorted,
    pct: below / n,
    pval: (sorted.filter((s) => s >= sharpe).length + 1) / (n + 1),
    median: sorted[Math.floor(n / 2)],
  };
}

export function sweep(strategy, candles, params, costBps, bpy) {
  const sp = strategy.sweep, closes = candles.map((c) => c.close);
  const xs = range(sp.x), ys = sp.y ? range(sp.y) : [null];
  const grid = ys.map((y) => xs.map((x) => {
    const p = { ...params, [sp.x.key]: x };
    if (sp.y) p[sp.y.key] = y;
    if (p.fast !== undefined && p.slow !== undefined && p.fast >= p.slow) return NaN;
    return backtest(closes, strategy.run(candles, p), costBps, bpy).sharpe;
  }));
  return { xs, ys, grid, xKey: sp.x.key, yKey: sp.y?.key };
}
const range = ({ from, to, step }) => { const a = []; for (let v = from; v <= to + 1e-9; v += step) a.push(+v.toFixed(4)); return a; };

/* ==========================================================================
   Risk & options toolkit
   ========================================================================== */

/* Range-based volatility estimators (per bar, as standard deviations of log returns) */
export function volEstimators(c) {
  const n = c.length; if (n < 10) return null;
  let cc = 0, park = 0, gk = 0, m = 0;
  const r = []; for (let i = 1; i < n; i++) r.push(Math.log(c[i].close / c[i - 1].close));
  m = r.reduce((a, b) => a + b, 0) / r.length;
  cc = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1));
  for (const b of c) {
    const hl = Math.log(b.high / b.low), co = Math.log(b.close / b.open);
    park += hl * hl; gk += 0.5 * hl * hl - (2 * Math.LN2 - 1) * co * co;
  }
  return { closeToClose: cc, parkinson: Math.sqrt(park / (4 * Math.LN2 * n)), garmanKlass: Math.sqrt(Math.max(0, gk / n)) };
}

/* GARCH(1,1) by maximum likelihood with variance targeting (ω = σ²(1 − α − β)), coarse-to-fine grid search */
export function garchFit(r) {
  const n = r.length; if (n < 100) return null;
  const mean = r.reduce((a, b) => a + b, 0) / n;
  const e = r.map((x) => x - mean);
  const v = e.reduce((a, b) => a + b * b, 0) / n;
  const ll = (al, be) => {
    if (al < 0 || be < 0 || al + be >= 0.999) return -Infinity;
    const om = v * (1 - al - be);
    let h = v, L = 0;
    for (let t = 0; t < n; t++) { L += -0.5 * (Math.log(h) + (e[t] * e[t]) / h); h = om + al * e[t] * e[t] + be * h; }
    return L;
  };
  let best = { al: 0.05, be: 0.9, L: ll(0.05, 0.9) };
  for (let al = 0.01; al <= 0.3; al += 0.02) for (let be = 0.5; be <= 0.98; be += 0.02) { const L = ll(al, be); if (L > best.L) best = { al, be, L }; }
  for (let step = 0.01; step >= 0.0025; step /= 2) {
    let improved = true;
    while (improved) {
      improved = false;
      for (const [da, db] of [[step, 0], [-step, 0], [0, step], [0, -step], [step, -step], [-step, step]]) {
        const L = ll(best.al + da, best.be + db); if (L > best.L) { best = { al: best.al + da, be: best.be + db, L }; improved = true; }
      }
    }
  }
  const om = v * (1 - best.al - best.be);
  let h = v; for (let t = 0; t < n; t++) h = om + best.al * e[t] * e[t] + best.be * h; // one-step-ahead variance
  // compare with constant-variance likelihood
  const L0 = -0.5 * n * (Math.log(v) + 1);
  return { omega: om, alpha: best.al, beta: best.be, persistence: best.al + best.be, longRun: Math.sqrt(v), next: Math.sqrt(h), mean, logLik: best.L, lrStat: 2 * (best.L - L0), halfLife: Math.log(0.5) / Math.log(best.al + best.be) };
}
export function garchTerm(g, H) {
  // expected variance k steps ahead: σ² + (α+β)^(k−1) (h₁ − σ²)
  const v = g.longRun ** 2, h1 = g.next ** 2, p = g.persistence, out = [];
  for (let k = 1; k <= H; k++) out.push(v + Math.pow(p, k - 1) * (h1 - v));
  return out;
}

/* Monte Carlo paths with GARCH(1,1) innovations (Student-t, ν = 5, for fat tails) */
export function mcPaths(S0, g, H, nPaths, seed = 3) {
  const rnd = mulberry32(seed), nu = 5, tScale = Math.sqrt((nu - 2) / nu);
  const g1 = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
  const tdraw = () => { let chi = 0; for (let i = 0; i < nu; i++) { const z = g1(); chi += z * z; } return (g1() / Math.sqrt(chi / nu)) * tScale; };
  const terminal = new Float64Array(nPaths), fan = Array.from({ length: H }, () => new Float64Array(nPaths));
  const v = g.longRun ** 2;
  for (let p = 0; p < nPaths; p++) {
    let s = S0, h = g.next ** 2;
    for (let k = 0; k < H; k++) {
      const eps = Math.sqrt(h) * tdraw();
      s *= Math.exp(-0.5 * h + eps);
      fan[k][p] = s;
      h = g.omega + g.alpha * eps * eps + g.beta * h;
      if (!isFinite(h) || h <= 0) h = v;
    }
    terminal[p] = s;
  }
  const qs = [0.05, 0.25, 0.5, 0.75, 0.95];
  const bands = qs.map(() => new Array(H));
  fan.forEach((arr, k) => { const sorted = Array.from(arr).sort((a, b) => a - b); qs.forEach((q, j) => (bands[j][k] = sorted[Math.floor(q * (nPaths - 1))])); });
  return { terminal: Array.from(terminal).sort((a, b) => a - b), bands, qs };
}
export function varES(sortedTerminal, S0, notional, level) {
  const rets = sortedTerminal.map((s) => (s / S0 - 1) * notional);
  const k = Math.floor((1 - level) * rets.length);
  const VaR = -rets[k];
  const ES = -rets.slice(0, Math.max(1, k)).reduce((a, b) => a + b, 0) / Math.max(1, k);
  return { VaR, ES };
}

/* Black–Scholes (zero rates by default) */
const ncdf = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
const npdf = (x) => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
export function blackScholes(S, K, T, sigma, r = 0) {
  if (T <= 0 || sigma <= 0) return null;
  const sq = sigma * Math.sqrt(T), d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / sq, d2 = d1 - sq, df = Math.exp(-r * T);
  return {
    call: S * ncdf(d1) - K * df * ncdf(d2), put: K * df * ncdf(-d2) - S * ncdf(-d1),
    deltaC: ncdf(d1), deltaP: ncdf(d1) - 1, gamma: npdf(d1) / (S * sq), vega: S * npdf(d1) * Math.sqrt(T) / 100,
    thetaC: (-S * npdf(d1) * sigma / (2 * Math.sqrt(T)) - r * K * df * ncdf(d2)) / 365,
    thetaP: (-S * npdf(d1) * sigma / (2 * Math.sqrt(T)) + r * K * df * ncdf(-d2)) / 365, d1, d2,
  };
}
