/* ==========================================================================
   Market Lab — monitor live markets, backtest strategies, take the challenge
   ========================================================================== */
import { INSTRUMENTS, TIMEFRAMES, Simulator, DerivClient, barsPerYear } from './data.js';
import * as M from './math.js';

const $ = (id) => document.getElementById(id);
const C = {
  bg: '#141413', grid: '#22221f', text: '#ecebe4', muted: '#9b998f', faint: '#6a6862',
  accent: '#ff5b1f', ok: '#8fd18a', warn: '#ffc857', blue: '#8ab4ff',
  bull: 'rgba(143,209,138,.08)', bear: 'rgba(255,91,31,.08)',
};
const NOTIONAL = 10000;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------- state ---------- */
const q = new URLSearchParams(location.search);
const S = {
  inst: INSTRUMENTS.find((i) => i.id === (q.get('i') || '').toUpperCase()) || INSTRUMENTS[0],
  tf: TIMEFRAMES.find((t) => t.id === q.get('tf')) || TIMEFRAMES[0],
  src: q.get('src') === 'sim' ? 'sim' : 'live',
  tab: ['monitor', 'backtest', 'risk', 'challenge'].includes(q.get('tab')) ? q.get('tab') : 'monitor',
  candles: [], actualSrc: 'sim', streaming: false, sim: null, simTimer: 0, loadId: 0,
  view: { span: 120, offset: 0 }, hover: -1,
  ov: { sma20: true, ema50: true, bb: false, rsi: true },
  ind: null, stats: null,
  bt: null, ch: null,
  pt: { pos: 0, entry: 0, realized: 0, log: [] },
};
const deriv = new DerivClient();
const bpy = () => barsPerYear(S.inst, S.tf.sec);

/* ---------- formatting ---------- */
const fmtP = (v, dp = S.inst.dp) => (isFinite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }) : '—');
const axisDp = (v) => (v >= 10000 ? 0 : v >= 1000 ? 1 : Math.min(S.inst.dp, 5));
const pct = (x, d = 2, sign = true) => (isFinite(x) ? (sign && x > 0 ? '+' : '') + (x * 100).toFixed(d) + '%' : '—');
const money = (x) => (x < 0 ? '−$' : '$') + Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ord = (p) => p + (p % 10 === 1 && p !== 11 ? 'st' : p % 10 === 2 && p !== 12 ? 'nd' : p % 10 === 3 && p !== 13 ? 'rd' : 'th');
function fmtTime(epoch, withDate) {
  const d = new Date(epoch * 1000);
  const mon = d.toLocaleString('en-US', { month: 'short' });
  if (S.tf.sec >= 86400) return `${d.getDate()} ${mon}${withDate ? ' ' + d.getFullYear() : ''}`;
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return withDate ? `${d.getDate()} ${mon} ${hm}` : hm;
}

/* ==========================================================================
   UI scaffolding
   ========================================================================== */
function buildPicker() {
  const groups = [...new Set(INSTRUMENTS.map((i) => i.group))];
  $('instPicker').innerHTML = groups.map((g) => `
    <div class="inst-group"><span>${g}</span><div>
      ${INSTRUMENTS.filter((i) => i.group === g).map((i) => `<button class="chip" role="radio" data-inst="${i.id}" title="${i.name}">${i.id === 'STEP' ? 'Step Index' : i.id}</button>`).join('')}
    </div></div>`).join('');
  $('instPicker').addEventListener('click', (e) => {
    const b = e.target.closest('[data-inst]'); if (!b) return;
    S.inst = INSTRUMENTS.find((i) => i.id === b.dataset.inst);
    resetPaper(); syncControls(); load();
  });
  $('tfSeg').innerHTML = TIMEFRAMES.map((t) => `<button role="radio" data-tf="${t.id}">${t.label}</button>`).join('');
  $('tfSeg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tf]'); if (!b) return;
    S.tf = TIMEFRAMES.find((t) => t.id === b.dataset.tf); syncControls(); load();
  });
  $('srcSeg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-src]'); if (!b) return;
    S.src = b.dataset.src; resetPaper(); syncControls(); load();
  });
  document.querySelector('.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]'); if (!b) return;
    setTab(b.dataset.tab);
  });
}

function syncControls() {
  document.querySelectorAll('[data-inst]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.inst === S.inst.id)));
  document.querySelectorAll('[data-tf]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.tf === S.tf.id)));
  document.querySelectorAll('[data-src]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.src === S.src)));
  document.querySelectorAll('.tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === S.tab)));
  document.querySelectorAll('[data-pane]').forEach((p) => (p.hidden = p.dataset.pane !== S.tab));
  $('instName').textContent = S.inst.id === 'STEP' ? 'Step Index' : S.inst.id;
  $('instFull').textContent = S.inst.name;
  $('costBps').value = S.inst.spreadBps;
  try { history.replaceState(null, '', `?i=${S.inst.id}&tf=${S.tf.id}&src=${S.src}&tab=${S.tab}`); } catch {}
}

function setTab(tab) {
  if (S.ch?.running && tab !== 'challenge') pauseChallenge(true);
  S.tab = tab;
  syncControls();
  if (tab === 'backtest' && !S.bt) runBacktest();
  if (tab === 'challenge') updateChallengeIntro();
  if (tab === 'risk' && !S.risk) runRisk();
  render();
}

function setChip(kind) {
  const chip = $('srcChip');
  chip.className = 'src-chip ' + kind;
  chip.querySelector('span').textContent = {
    loading: 'Connecting…', live: 'Live · Deriv', closed: 'Market closed · last data', sim: 'Simulated',
  }[kind];
}
function notice(msg) { const n = $('notice'); n.hidden = !msg; n.textContent = msg || ''; }

/* ==========================================================================
   Data loading
   ========================================================================== */
function stopFeeds() {
  clearInterval(S.simTimer);
  if (deriv.ws && deriv.ws.readyState === 1) deriv.forgetAll();
}

async function load() {
  const id = ++S.loadId;
  stopFeeds();
  abortChallenge(); $('chResults').hidden = true;
  S.bt = null; S.risk = null; $('btResults').hidden = true; $('sweepBox').hidden = true;
  setChip('loading'); notice('');
  let candles = null;

  if (S.src === 'live') {
    try {
      const r = await deriv.candles(S.inst.deriv, S.tf.sec, 1000, (bar) => { if (id === S.loadId) onLiveBar(bar); });
      if (id !== S.loadId) return;
      if (!r.candles.length) throw new Error('no data returned');
      candles = r.candles; S.streaming = r.streaming; S.actualSrc = 'live';
      setChip(r.streaming ? 'live' : 'closed');
      if (r.note) notice(`Live stream paused: ${r.note} Showing the most recent data.`);
    } catch (e) {
      if (id !== S.loadId) return;
      notice(`Live data unavailable (${e.message}). Showing a simulated ${S.inst.id} market instead.`);
    }
  }
  if (!candles) {
    S.sim = new Simulator(S.inst, S.tf.sec);
    candles = S.sim.history(1000);
    S.actualSrc = 'sim'; S.streaming = true;
    setChip('sim');
    S.simTimer = setInterval(() => {
      if (S.sim.tick(S.candles) && S.candles.length > 1500) S.candles.shift();
      onUpdate();
    }, 1000);
  }
  S.candles = candles;
  S.view.offset = 0;
  S.view.span = Math.min(120, candles.length);
  recompute();
  render();
  if (S.tab === 'backtest') runBacktest();
  if (S.tab === 'risk') runRisk();
  if (S.tab === 'challenge') updateChallengeIntro();
}

function onLiveBar(bar) {
  const c = S.candles, last = c[c.length - 1];
  if (!last) return;
  if (bar.epoch === last.epoch) Object.assign(last, bar);
  else if (bar.epoch > last.epoch) { c.push(bar); if (c.length > 1500) c.shift(); }
  onUpdate();
}

let rafPending = false;
function onUpdate() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => { rafPending = false; recompute(); render(); updatePaper(); });
}

function recompute() {
  const x = S.candles.map((c) => c.close);
  S.ind = { sma20: M.sma(x, 20), ema50: M.ema(x, 50), bb: M.bollinger(x, 20, 2), rsi: M.rsi(x, 14), atr: M.atr(S.candles, 14) };
  const r = M.logReturns(x);
  S.stats = { d: M.describe(r), h: M.hurst(r), r };
}

/* ==========================================================================
   Chart renderer
   ========================================================================== */
const chart = $('chart');
function fit(cv) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2), w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

let geom = null; // last layout, used for hover/pan
function drawChart(cfg) {
  const { ctx, w, h } = fit(chart);
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, h);
  const { candles, from, to } = cfg;
  const xFrom = cfg.xFrom ?? from, xTo = cfg.xTo ?? to;
  if (!candles.length || to <= from) return;
  const padL = 8, padR = 74, axisH = 22;
  const lowerH = cfg.lower ? Math.max(70, h * 0.24) : 0;
  const pTop = 8, pH = h - axisH - lowerH - (cfg.lower ? 14 : 4) - pTop;
  const bw = (w - padL - padR) / (xTo - xFrom);
  const X = (i) => padL + (i - xFrom + 0.5) * bw;
  geom = { from, to, xFrom, xTo, bw, padL, padR, w };

  // y range
  let lo = Infinity, hi = -Infinity;
  for (let i = from; i < to; i++) { lo = Math.min(lo, candles[i].low); hi = Math.max(hi, candles[i].high); }
  (cfg.overlays || []).forEach((o) => { for (let i = from; i < to; i++) { const v = o.vals[i]; if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } } });
  if (cfg.fan) cfg.fan.bands.forEach((b) => b.forEach((v) => { lo = Math.min(lo, v); hi = Math.max(hi, v); }));
  const pad = (hi - lo) * 0.08 || hi * 0.001 || 1;
  lo -= pad; hi += pad;
  const Y = (v) => pTop + (1 - (v - lo) / (hi - lo)) * pH;

  // regimes
  if (cfg.regimes) {
    let s = from;
    for (let i = from + 1; i <= to; i++) {
      if (i < to && candles[i].regime === candles[s].regime) continue;
      ctx.fillStyle = candles[s].regime === 1 ? C.bull : C.bear;
      ctx.fillRect(X(s) - bw / 2, pTop, (i - s) * bw, pH);
      s = i;
    }
  }

  // grid + labels
  ctx.font = '11px "JetBrains Mono", monospace'; ctx.textBaseline = 'middle';
  for (let k = 0; k <= 5; k++) {
    const v = lo + ((hi - lo) * k) / 5, y = Y(v);
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, Math.round(y) + 0.5); ctx.lineTo(w - padR, Math.round(y) + 0.5); ctx.stroke();
    ctx.fillStyle = C.faint; ctx.fillText(fmtP(v, axisDp(v)), w - padR + 8, y);
  }
  // time axis
  const nT = Math.max(2, Math.floor((w - padL - padR) / 110));
  const stepT = Math.max(1, Math.ceil((xTo - xFrom) / nT));
  ctx.textBaseline = 'top'; ctx.fillStyle = C.faint;
  for (let i = Math.ceil(xFrom / stepT) * stepT; i < Math.min(to, xTo); i += stepT) {
    if (!candles[i]) continue;
    ctx.fillText(fmtTime(candles[i].epoch), X(i) - 18, h - axisH + 6);
  }

  // band
  if (cfg.band) {
    ctx.fillStyle = 'rgba(138,180,255,.07)'; ctx.beginPath();
    let started = false;
    for (let i = from; i < to; i++) { const v = cfg.band.upper[i]; if (!isFinite(v)) continue; started ? ctx.lineTo(X(i), Y(v)) : (ctx.moveTo(X(i), Y(v)), (started = true)); }
    for (let i = to - 1; i >= from; i--) { const v = cfg.band.lower[i]; if (isFinite(v)) ctx.lineTo(X(i), Y(v)); }
    ctx.closePath(); ctx.fill();
    [cfg.band.upper, cfg.band.lower].forEach((arr) => line(ctx, arr, from, to, X, Y, 'rgba(138,180,255,.5)', 1));
  }

  // candles or line
  if (bw >= 3.2) {
    const bodyW = Math.max(1, Math.min(14, bw * 0.62));
    for (let i = from; i < to; i++) {
      const c = candles[i], up = c.close >= c.open, col = up ? C.ok : C.accent;
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
      const x = Math.round(X(i)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, Y(c.high)); ctx.lineTo(x, Y(c.low)); ctx.stroke();
      const y1 = Y(Math.max(c.open, c.close)), y2 = Y(Math.min(c.open, c.close));
      ctx.fillRect(x - bodyW / 2, y1, bodyW, Math.max(1, y2 - y1));
    }
  } else {
    line(ctx, candles.map((c) => c.close), from, to, X, Y, C.text, 1.4);
  }

  (cfg.overlays || []).forEach((o) => line(ctx, o.vals, from, to, X, Y, o.color, o.width || 1.3, o.dash));

  // Monte Carlo fan into the future
  if (cfg.fan) {
    const st = cfg.fan.start, B = cfg.fan.bands, Xf = (k) => X(st + 1 + k);
    const area = (lo2, hi2, color) => { ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(X(st), Y(candles[st].close)); hi2.forEach((v, k) => ctx.lineTo(Xf(k), Y(v))); for (let k = lo2.length - 1; k >= 0; k--) ctx.lineTo(Xf(k), Y(lo2[k])); ctx.closePath(); ctx.fill(); };
    area(B[0], B[4], 'rgba(255,200,87,.10)'); area(B[1], B[3], 'rgba(255,200,87,.18)');
    ctx.strokeStyle = C.warn; ctx.lineWidth = 1.4; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(X(st), Y(candles[st].close)); B[2].forEach((v, k) => ctx.lineTo(Xf(k), Y(v))); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = C.faint; ctx.font = '11px "JetBrains Mono", monospace'; ctx.textBaseline = 'middle';
    [[B[4], '95%'], [B[0], '5%']].forEach(([b, l]) => ctx.fillText(l, Xf(b.length - 1) + 4, Y(b[b.length - 1])));
  }

  // position strip
  if (cfg.strip) {
    const sy = pTop + pH + 3;
    for (let i = from; i < to; i++) {
      const p = cfg.strip[i]; if (!p) continue;
      ctx.fillStyle = p > 0 ? 'rgba(143,209,138,.85)' : 'rgba(255,91,31,.75)';
      ctx.fillRect(X(i) - bw / 2, sy, bw + 0.5, 5);
    }
  }

  // marker line (e.g. challenge start)
  if (cfg.marker != null && cfg.marker >= xFrom && cfg.marker <= xTo) {
    ctx.strokeStyle = C.faint; ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(X(cfg.marker) - bw / 2, pTop); ctx.lineTo(X(cfg.marker) - bw / 2, h - axisH); ctx.stroke(); ctx.setLineDash([]);
  }

  // last price tag
  const last = candles[to - 1];
  const ly = Y(last.close);
  ctx.strokeStyle = 'rgba(236,235,228,.25)'; ctx.setLineDash([2, 3]);
  ctx.beginPath(); ctx.moveTo(padL, ly); ctx.lineTo(w - padR, ly); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = cfg.tagColor || (last.close >= last.open ? C.ok : C.accent);
  ctx.fillRect(w - padR + 2, ly - 10, padR - 4, 20);
  ctx.fillStyle = '#111'; ctx.textBaseline = 'middle';
  ctx.fillText(fmtP(last.close, axisDp(last.close)), w - padR + 7, ly);

  // lower panel
  if (cfg.lower) {
    const top = pTop + pH + 14, bottom = h - axisH;
    const LH = bottom - top;
    ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.moveTo(padL, top - 6.5); ctx.lineTo(w - padR, top - 6.5); ctx.stroke();
    ctx.fillStyle = C.faint; ctx.textBaseline = 'top';
    if (cfg.lower.type === 'rsi') {
      const RY = (v) => top + (1 - v / 100) * LH;
      ctx.fillText('RSI 14', padL + 4, top);
      [30, 50, 70].forEach((v) => {
        ctx.strokeStyle = v === 50 ? C.grid : 'rgba(255,200,87,.25)'; ctx.setLineDash(v === 50 ? [] : [3, 3]);
        ctx.beginPath(); ctx.moveTo(padL, RY(v)); ctx.lineTo(w - padR, RY(v)); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = C.faint; ctx.textBaseline = 'middle'; ctx.fillText(String(v), w - padR + 8, RY(v));
      });
      line(ctx, cfg.lower.vals, from, to, X, RY, C.warn, 1.2);
    } else {
      let elo = Infinity, ehi = -Infinity;
      cfg.lower.series.forEach((s) => { for (let i = from; i < to; i++) { const v = s.vals[i]; if (isFinite(v)) { elo = Math.min(elo, v); ehi = Math.max(ehi, v); } } });
      if (!isFinite(elo)) { elo = 0.9; ehi = 1.1; }
      const ep = (ehi - elo) * 0.12 || 0.01; elo -= ep; ehi += ep;
      const EY = (v) => top + (1 - (v - elo) / (ehi - elo)) * LH;
      ctx.fillText(cfg.lower.label || 'EQUITY', padL + 4, top);
      if (cfg.lower.base != null) {
        ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.moveTo(padL, EY(cfg.lower.base)); ctx.lineTo(w - padR, EY(cfg.lower.base)); ctx.stroke();
        ctx.fillStyle = C.faint; ctx.textBaseline = 'middle'; ctx.fillText(cfg.lower.baseLabel || '', w - padR + 8, EY(cfg.lower.base));
      }
      cfg.lower.series.forEach((s) => line(ctx, s.vals, from, to, X, EY, s.color, s.width || 1.5, s.dash));
    }
  }

  // crosshair
  const hv = S.hover;
  if (hv >= from && hv < to && candles[hv]) {
    ctx.strokeStyle = 'rgba(236,235,228,.3)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(Math.round(X(hv)) + 0.5, pTop); ctx.lineTo(Math.round(X(hv)) + 0.5, h - axisH); ctx.stroke();
  }
}

function line(ctx, vals, from, to, X, Y, color, width, dash) {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash || []); ctx.lineJoin = 'round';
  ctx.beginPath(); let pen = false;
  for (let i = from; i < to; i++) {
    const v = vals[i];
    if (!isFinite(v)) { pen = false; continue; }
    pen ? ctx.lineTo(X(i), Y(v)) : (ctx.moveTo(X(i), Y(v)), (pen = true));
  }
  ctx.stroke(); ctx.setLineDash([]);
}

function legend(items) {
  $('legend').innerHTML = items.map(([label, color, dash]) =>
    `<span><i style="background:${dash ? `repeating-linear-gradient(90deg,${color} 0 4px,transparent 4px 7px)` : color}"></i>${label}</span>`).join('');
}

/* chart interaction */
let drag = null;
chart.addEventListener('pointermove', (e) => {
  if (!geom) return;
  const r = chart.getBoundingClientRect(), x = e.clientX - r.left;
  if (drag && canPan()) {
    const bars = Math.round((x - drag.x) / geom.bw);
    S.view.offset = Math.max(0, Math.min(S.candles.length - S.view.span, drag.offset + bars));
  }
  const idx = Math.floor((x - geom.padL) / geom.bw + geom.xFrom);
  S.hover = idx >= geom.from && idx < geom.to ? idx : -1;
  render();
});
chart.addEventListener('pointerleave', () => { S.hover = -1; drag = null; render(); });
chart.addEventListener('pointerdown', (e) => { if (canPan()) drag = { x: e.clientX - chart.getBoundingClientRect().left, offset: S.view.offset }; });
window.addEventListener('pointerup', () => (drag = null));
chart.addEventListener('wheel', (e) => {
  if (!canPan()) return;
  e.preventDefault();
  const n = S.candles.length;
  S.view.span = Math.round(Math.max(20, Math.min(n, S.view.span * (e.deltaY > 0 ? 1.15 : 1 / 1.15))));
  S.view.offset = Math.max(0, Math.min(n - S.view.span, S.view.offset));
  render();
}, { passive: false });
const canPan = () => S.tab !== 'challenge' || !S.ch;

/* ==========================================================================
   Rendering per tab
   ========================================================================== */
function render() {
  if (S.tab === 'challenge' && S.ch) return renderChallenge();
  const c = S.candles; if (!c.length) return;
  const n = c.length;
  const to = n - S.view.offset, from = Math.max(0, to - S.view.span);
  renderQuote();
  renderOhlc(c);
  if (S.tab === 'risk' && S.risk) {
    const H = S.risk.H, rfrom = Math.max(0, n - 160);
    drawChart({ candles: c, from: rfrom, to: n, xFrom: rfrom, xTo: n + H, fan: { start: n - 1, bands: S.risk.mc.bands } });
    legend([['Median path', C.warn, true], ['50% band', 'rgba(255,200,87,.45)'], ['90% band', 'rgba(255,200,87,.2)']]);
    $('chartHint').hidden = true;
    return;
  }
  if (S.tab === 'backtest' && S.bt) {
    const b = S.bt;
    drawChart({
      candles: c, from, to, overlays: b.overlays, band: b.band, strip: b.pos,
      lower: { type: 'equity', label: 'EQUITY (×)', base: 1, baseLabel: '1.00', series: [
        { vals: b.bhCurve, color: C.muted, dash: [4, 3], width: 1 }, { vals: b.curve, color: C.accent, width: 2 }] },
    });
    legend([...b.legend, ['Strategy equity', C.accent], ['Buy & hold', C.muted, true]]);
  } else {
    const ov = [];
    const lg = [];
    if (S.ov.sma20) { ov.push({ vals: S.ind.sma20, color: C.warn }); lg.push(['SMA 20', C.warn]); }
    if (S.ov.ema50) { ov.push({ vals: S.ind.ema50, color: C.blue }); lg.push(['EMA 50', C.blue]); }
    if (S.ov.bb) lg.push(['Bollinger', 'rgba(138,180,255,.6)']);
    drawChart({ candles: c, from, to, overlays: ov, band: S.ov.bb ? S.ind.bb : null, lower: S.ov.rsi ? { type: 'rsi', vals: S.ind.rsi } : null });
    legend(lg);
    if (S.tab === 'monitor') renderStats();
  }
  $('chartHint').hidden = false;
}

function renderQuote() {
  const c = S.candles, last = c[c.length - 1];
  const back = Math.min(c.length - 1, Math.max(1, Math.round(86400 / S.tf.sec)));
  const ref = c[c.length - 1 - back].close;
  const ch = last.close / ref - 1;
  $('lastPrice').textContent = fmtP(last.close);
  const el = $('lastChange');
  el.textContent = `${pct(ch)} · ${S.tf.sec >= 86400 ? '1D' : '24h'}`;
  el.className = ch >= 0 ? 'up' : 'down';
}

function renderOhlc(c) {
  const b = c[S.hover >= 0 ? S.hover : c.length - 1];
  if (!b) return;
  $('ohlc').textContent = `${fmtTime(b.epoch, true)}   O ${fmtP(b.open)}  H ${fmtP(b.high)}  L ${fmtP(b.low)}  C ${fmtP(b.close)}  ${pct(b.close / b.open - 1)}`;
}

function renderStats() {
  const { d, h, r } = S.stats; if (!d) return;
  const c = S.candles, n = c.length, last = c[n - 1];
  const f = bpy();
  const sd20 = M.stdev(c.map((b) => b.close), 20)[n - 1];
  const z = (last.close - S.ind.sma20[n - 1]) / sd20;
  const atrv = S.ind.atr[n - 1];
  const mdd = M.maxDrawdown(c.map((b) => b.close));
  const rows = [
    ['Ann. volatility', pct(d.sd * Math.sqrt(f), 1, false), 'Standard deviation of log returns, scaled to a year of bars'],
    ['Return / bar', pct(d.mean, 3), 'Average log return per bar over the loaded history'],
    ['Skew', d.skew.toFixed(2), 'Asymmetry of returns: negative means bigger down moves'],
    ['Excess kurtosis', d.kurt.toFixed(2), 'Tail fatness vs a normal distribution (0 = normal)'],
    ['Autocorr (lag 1)', d.acf1.toFixed(3), 'Correlation of each return with the previous one'],
    ['Hurst exponent', isFinite(h) ? h.toFixed(2) : '—', '≈0.5 random walk, >0.5 trending, <0.5 mean-reverting (R/S method)'],
    ['VaR 95% (1 bar)', pct(d.var95, 3, false), 'Historical: 5% of bars lost more than this'],
    ['CVaR 95%', pct(d.cvar95, 3, false), 'Average loss in the worst 5% of bars'],
    ['ATR 14', fmtP(atrv), 'Average true range: typical bar size in price units'],
    ['Z vs SMA 20', isFinite(z) ? z.toFixed(2) : '—', 'How many standard deviations price sits from its 20-bar mean'],
    ['RSI 14', S.ind.rsi[n - 1]?.toFixed(1) ?? '—', 'Relative strength: >70 overbought, <30 oversold'],
    ['Max drawdown', pct(-mdd, 1), 'Largest peak-to-trough fall in the loaded history'],
  ];
  $('stats').innerHTML = rows.map(([k, v, t]) => `<div><dt title="${t}">${k}</dt><dd>${v}</dd></div>`).join('');
  $('statN').textContent = `${d.n} bars · ${S.tf.label}`;

  const reads = [];
  if (isFinite(h)) reads.push(h > 0.55 ? `Hurst of <b>${h.toFixed(2)}</b> suggests <b>trending</b> behaviour; trend-following rules have a chance here.` :
    h < 0.45 ? `Hurst of <b>${h.toFixed(2)}</b> suggests <b>mean reversion</b>; fading extremes may work better than chasing them.` :
      `Hurst of <b>${h.toFixed(2)}</b> is close to 0.5, so this looks like a <b>random walk</b> at this timeframe.`);
  if (d.kurt > 1) reads.push(`Excess kurtosis of <b>${d.kurt.toFixed(1)}</b> means fat tails: extreme bars happen more often than a normal model predicts.`);
  if (Math.abs(z) > 2) reads.push(`Price is <b>${z.toFixed(1)}σ</b> from its 20-bar mean, which is stretched.`);
  if (S.inst.model === 'gbm' && S.actualSrc === 'live') reads.push('Volatility indices are generated as constant-volatility random walks, so no strategy should have a lasting edge.');
  $('statRead').innerHTML = reads.join(' ');

  drawDist(r);
}

function drawDist(r) {
  const cv = $('dist'); const { ctx, w, h } = fit(cv);
  ctx.clearRect(0, 0, w, h);
  if (r.length < 20) return;
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  const sd = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / r.length) || 1;
  const bins = 41, lo = -5, hi = 5, bwid = (hi - lo) / bins;
  const counts = new Array(bins).fill(0);
  r.forEach((x) => { const z = (x - m) / sd; const k = Math.floor((Math.max(lo, Math.min(hi - 1e-9, z)) - lo) / bwid); counts[k]++; });
  const dens = counts.map((c) => c / r.length / bwid);
  const pdf = (z) => Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);
  const maxD = Math.max(...dens, pdf(0));
  const base = h - 14, X = (z) => ((z - lo) / (hi - lo)) * w, Yd = (v) => base - (v / maxD) * (base - 6);
  dens.forEach((v, i) => {
    const z = lo + (i + 0.5) * bwid;
    ctx.fillStyle = Math.abs(z) > 3 ? C.accent : '#3a3a36';
    ctx.fillRect(X(lo + i * bwid) + 1, Yd(v), w / bins - 2, base - Yd(v));
  });
  ctx.strokeStyle = C.warn; ctx.lineWidth = 1.5; ctx.beginPath();
  for (let z = lo; z <= hi; z += 0.05) (z === lo ? ctx.moveTo(X(z), Yd(pdf(z))) : ctx.lineTo(X(z), Yd(pdf(z))));
  ctx.stroke();
  ctx.fillStyle = C.faint; ctx.font = '10px "JetBrains Mono", monospace'; ctx.textBaseline = 'top';
  [-4, -2, 0, 2, 4].forEach((z) => ctx.fillText(`${z}σ`, X(z) - 6, base + 3));
}

/* ==========================================================================
   Paper trading
   ========================================================================== */
function resetPaper() { S.pt = { pos: 0, entry: 0, realized: 0, log: [] }; updatePaper(); }
function paperTrade(target) {
  const c = S.candles; if (!c.length) return;
  const px = c[c.length - 1].close, pt = S.pt;
  if (pt.pos === target) return;
  if (pt.pos !== 0) {
    const pnl = pt.pos * (px / pt.entry - 1) * NOTIONAL;
    pt.realized += pnl;
    pt.log.unshift([`Close ${pt.pos > 0 ? 'long' : 'short'} @ ${fmtP(px)}`, money(pnl), pnl]);
  }
  pt.pos = target;
  if (target !== 0) { pt.entry = px; pt.log.unshift([`${target > 0 ? 'Buy' : 'Sell'} @ ${fmtP(px)}`, '', 0]); }
  pt.log = pt.log.slice(0, 20);
  updatePaper();
}
function updatePaper() {
  const pt = S.pt, c = S.candles;
  const px = c.length ? c[c.length - 1].close : 0;
  const open = pt.pos ? pt.pos * (px / pt.entry - 1) * NOTIONAL : 0;
  $('ptPos').textContent = pt.pos > 0 ? 'Long' : pt.pos < 0 ? 'Short' : 'Flat';
  $('ptPos').className = pt.pos > 0 ? 'up' : pt.pos < 0 ? 'down' : '';
  $('ptEntry').textContent = pt.pos ? fmtP(pt.entry) : '—';
  $('ptOpen').textContent = money(open); $('ptOpen').className = open > 0 ? 'up' : open < 0 ? 'down' : '';
  $('ptReal').textContent = money(pt.realized); $('ptReal').className = pt.realized > 0 ? 'up' : pt.realized < 0 ? 'down' : '';
  $('ptLog').innerHTML = pt.log.map(([a, b, v]) => `<li><span>${a}</span><span class="${v > 0 ? 'up' : v < 0 ? 'down' : ''}">${b}</span></li>`).join('');
}
document.querySelectorAll('[data-pos]').forEach((b) => b.addEventListener('click', () => paperTrade(Number(b.dataset.pos))));
document.querySelectorAll('[data-ov]').forEach((cb) => cb.addEventListener('change', () => { S.ov[cb.dataset.ov] = cb.checked; render(); }));

/* ==========================================================================
   Backtest
   ========================================================================== */
const stratSel = $('stratSel');
stratSel.innerHTML = Object.entries(M.STRATEGIES).map(([k, s]) => `<option value="${k}">${s.name}</option>`).join('');
function renderParams() {
  const s = M.STRATEGIES[stratSel.value];
  $('stratBlurb').textContent = s.blurb;
  $('params').innerHTML = s.params.map((p) => `<label class="param"><span>${p.label}</span><input class="input" type="number" data-param="${p.key}" value="${p.value}" min="${p.min}" max="${p.max}" step="${p.step || 1}"></label>`).join('');
}
stratSel.addEventListener('change', () => { renderParams(); runBacktest(); });
renderParams();
$('runBt').addEventListener('click', () => runBacktest());
$('sweepBt').addEventListener('click', runSweep);

function readParams() {
  const s = M.STRATEGIES[stratSel.value], p = {};
  s.params.forEach((d) => {
    const el = document.querySelector(`[data-param="${d.key}"]`);
    let v = Number(el.value); if (!isFinite(v)) v = d.value;
    v = Math.max(d.min, Math.min(d.max, v)); el.value = v; p[d.key] = v;
  });
  return p;
}

function runBacktest() {
  const c = S.candles; if (c.length < 60) return;
  const key = stratSel.value, s = M.STRATEGIES[key], p = readParams();
  const cost = Math.max(0, Number($('costBps').value) || 0);
  const closes = c.map((b) => b.close);
  const pos = s.run(c, p);
  const res = M.backtest(closes, pos, cost, bpy());
  const bh = M.backtest(closes, closes.map(() => 1), 0, bpy());
  const mc = M.randomEntryTest(closes, res.trades, res.sharpe, cost, bpy(), 500, 11);
  const overlays = [], lg = [];
  let band = null;
  if (key === 'sma') { overlays.push({ vals: M.sma(closes, p.fast), color: C.warn }, { vals: M.sma(closes, p.slow), color: C.blue }); lg.push([`SMA ${p.fast}`, C.warn], [`SMA ${p.slow}`, C.blue]); }
  if (key === 'boll') { const bb = M.bollinger(closes, p.period, p.k); band = bb; overlays.push({ vals: bb.mid, color: C.blue, dash: [3, 3] }); lg.push([`Bands ${p.period}, ${p.k}`, C.blue]); }
  if (key === 'donchian') { const d = M.donchian(c, p.period); overlays.push({ vals: d.hi, color: C.ok, width: 1 }, { vals: d.lo, color: C.accent, width: 1 }); lg.push([`${p.period}-bar channel`, C.muted]); }
  S.bt = { pos, overlays, band, legend: lg, curve: res.curve, bhCurve: bh.curve };
  S.view.span = c.length; S.view.offset = 0;

  const rows = [
    ['Total return', pct(res.total, 1), pct(bh.total, 1), res.total > bh.total],
    ['Sharpe (ann.)', res.sharpe.toFixed(2), bh.sharpe.toFixed(2), res.sharpe > bh.sharpe],
    ['Sortino (ann.)', res.sortino.toFixed(2), bh.sortino.toFixed(2), res.sortino > bh.sortino],
    ['Max drawdown', pct(-res.mdd, 1), pct(-bh.mdd, 1), res.mdd < bh.mdd],
    ['Volatility (ann.)', pct(res.vol, 1, false), pct(bh.vol, 1, false), null],
    ['Hit rate', pct(res.hit, 0, false), pct(bh.hit, 0, false), null],
    ['Position changes', res.trades, bh.trades, null],
    ['Time in market', pct(res.exposure, 0, false), '100%', null],
    ['Profit factor', isFinite(res.profitFactor) ? res.profitFactor.toFixed(2) : '∞', isFinite(bh.profitFactor) ? bh.profitFactor.toFixed(2) : '∞', null],
  ];
  $('btTable').innerHTML = rows.map(([k, a, b, better]) => `<tr><td>${k}</td><td class="${better === true ? 'best' : ''}">${a}</td><td class="${better === false ? 'best' : ''}">${b}</td></tr>`).join('');
  $('btBars').textContent = `${c.length} bars · ${cost} bps cost`;
  $('btResults').hidden = false;
  const p100 = Math.round(mc.pct * 100);
  $('btVerdict').innerHTML = (mc.pval < 0.05
    ? `Sharpe <b>${res.sharpe.toFixed(2)}</b> beats <b>${p100}%</b> of 500 random strategies with the same trade count (p = ${mc.pval.toFixed(3)}). That's unlikely to be pure luck on this sample, but test it on a different timeframe or instrument before trusting it.`
    : `Sharpe <b>${res.sharpe.toFixed(2)}</b> ranks in the <b>${ord(p100)} percentile</b> of 500 random strategies (p = ${mc.pval.toFixed(2)}). That's not distinguishable from luck on this sample.`) +
    (S.inst.model !== 'regime' && S.actualSrc === 'live' ? ' On a synthetic index built as a random walk, this is exactly what you should expect.' : '');
  requestAnimationFrame(() => drawHist($('btHist'), mc.sorted, [[res.sharpe, C.accent, 'strategy ' + res.sharpe.toFixed(2)], [bh.sharpe, C.muted, 'buy & hold']]));
  render();
}

function drawHist(cv, sorted, markers) {
  const { ctx, w, h } = fit(cv);
  ctx.clearRect(0, 0, w, h);
  const vals = markers.map((m) => m[0]);
  const lo = Math.min(sorted[0], ...vals) - 0.3, hi = Math.max(sorted[sorted.length - 1], ...vals) + 0.3;
  const bins = 36, counts = new Array(bins).fill(0);
  sorted.forEach((s) => counts[Math.min(bins - 1, Math.floor(((s - lo) / (hi - lo)) * bins))]++);
  const maxC = Math.max(...counts), base = h - 18, X = (v) => ((v - lo) / (hi - lo)) * w;
  counts.forEach((c, i) => { const bh = (c / maxC) * (base - 30); ctx.fillStyle = '#2f2f2b'; ctx.fillRect((i * w) / bins + 1, base - bh, w / bins - 2, bh); });
  ctx.font = '10px "JetBrains Mono", monospace'; ctx.fillStyle = C.faint; ctx.textBaseline = 'top';
  const lstep = Math.max(1, Math.ceil((hi - lo) / 8));
  for (let v = Math.ceil(lo / lstep) * lstep; v <= hi; v += lstep) ctx.fillText(String(v), X(v) - 3, base + 4);
  markers.forEach(([v, color, label], k) => {
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(X(v), 14 + k * 12); ctx.lineTo(X(v), base); ctx.stroke();
    ctx.fillStyle = color; const tw = ctx.measureText(label).width;
    ctx.fillText(label, Math.min(w - tw - 2, Math.max(2, X(v) - tw / 2)), k * 12);
  });
}

let heatState = null;
function runSweep() {
  const c = S.candles; if (c.length < 60) return;
  const s = M.STRATEGIES[stratSel.value], p = readParams(), cost = Math.max(0, Number($('costBps').value) || 0);
  heatState = M.sweep(s, c, p, cost, bpy());
  $('sweepBox').hidden = false;
  drawHeat();
  $('sweepBox').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function drawHeat() {
  const hs = heatState; if (!hs) return;
  const cv = $('heat'); const { ctx, w, h } = fit(cv);
  ctx.clearRect(0, 0, w, h);
  const padL = 40, padB = 26, padT = 6, cols = hs.xs.length, rows = hs.ys.length;
  const cw = (w - padL) / cols, rh = (h - padB - padT) / rows;
  const all = hs.grid.flat().filter(isFinite), m = Math.max(0.5, ...all.map(Math.abs));
  ctx.font = '10px "JetBrains Mono", monospace';
  hs.grid.forEach((row, j) => row.forEach((v, i) => {
    const x = padL + i * cw, y = padT + (rows - 1 - j) * rh;
    if (!isFinite(v)) { ctx.fillStyle = '#0d0d0c'; ctx.fillRect(x + 1, y + 1, cw - 2, rh - 2); return; }
    const t = Math.min(1, Math.abs(v) / m);
    ctx.fillStyle = v >= 0 ? `rgba(143,209,138,${0.12 + t * 0.8})` : `rgba(255,91,31,${0.12 + t * 0.8})`;
    ctx.fillRect(x + 1, y + 1, cw - 2, rh - 2);
    if (cw > 30 && rh > 16) { ctx.fillStyle = t > 0.55 ? '#111' : C.text; ctx.textBaseline = 'middle'; ctx.fillText(v.toFixed(1), x + cw / 2 - 9, y + rh / 2); }
  }));
  ctx.fillStyle = C.faint; ctx.textBaseline = 'top';
  hs.xs.forEach((x, i) => { if (cols <= 12 || i % 2 === 0) ctx.fillText(String(x), padL + i * cw + cw / 2 - 6, h - padB + 6); });
  ctx.textBaseline = 'middle';
  if (hs.yKey) hs.ys.forEach((y, j) => ctx.fillText(String(y), 4, padT + (rows - 1 - j) * rh + rh / 2));
  ctx.fillText(hs.xKey + ' →', w - 60, h - 6);
}
$('heat').addEventListener('click', (e) => {
  const hs = heatState; if (!hs) return;
  const cv = $('heat'), r = cv.getBoundingClientRect();
  const padL = 40, padB = 26, padT = 6, cols = hs.xs.length, rows = hs.ys.length;
  const i = Math.floor((e.clientX - r.left - padL) / ((r.width - padL) / cols));
  const j = rows - 1 - Math.floor((e.clientY - r.top - padT) / ((r.height - padB - padT) / rows));
  if (i < 0 || i >= cols || j < 0 || j >= rows || !isFinite(hs.grid[j][i])) return;
  document.querySelector(`[data-param="${hs.xKey}"]`).value = hs.xs[i];
  if (hs.yKey) document.querySelector(`[data-param="${hs.yKey}"]`).value = hs.ys[j];
  runBacktest();
});

/* ==========================================================================
   Risk & options: GARCH volatility, Monte Carlo VaR/ES, Black–Scholes
   ========================================================================== */
function runRisk(keepInputs) {
  const c = S.candles.slice(0, -1); // completed bars only
  if (c.length < 120) return;
  const closes = c.map((b) => b.close), r = M.logReturns(closes), f = bpy();
  const g = M.garchFit(r); if (!g) return;
  const ve = M.volEstimators(c);
  const H = clamp(Math.round(Number($('rkH').value) || 48), 5, 200); $('rkH').value = H;
  const notional = Math.max(100, Number($('rkPos').value) || 10000);
  const S0 = S.candles[S.candles.length - 1].close;
  const mc = M.mcPaths(S0, g, H, 2000, Math.floor(Math.random() * 1e6));
  const v95 = M.varES(mc.terminal, S0, notional, 0.95), v99 = M.varES(mc.terminal, S0, notional, 0.99);
  const term = M.garchTerm(g, H), avgVar = term.reduce((a, b) => a + b, 0) / H;
  const sigmaAnn = Math.sqrt(avgVar * f);
  if (!keepInputs || !$('rkK').value) $('rkK').value = +S0.toPrecision(6);
  if (!keepInputs || !$('rkSig').value) $('rkSig').value = (sigmaAnn * 100).toFixed(1);
  S.risk = { g, ve, H, mc, v95, v99, notional, S0, sigmaAnn, f };
  renderRisk();
  render();
}
function renderRisk() {
  const { g, ve, H, mc, v95, v99, notional, S0, sigmaAnn, f } = S.risk;
  const ann = (x) => pct(x * Math.sqrt(f), 1, false);
  $('rkN').textContent = `${S.candles.length - 1} bars · ${S.tf.label}`;
  $('rkVol').innerHTML = [
    ['GARCH α', g.alpha.toFixed(3), 'Reaction of variance to the latest shock'],
    ['GARCH β', g.beta.toFixed(3), 'Persistence of past variance'],
    ['α + β', g.persistence.toFixed(3), 'Close to 1 means volatility shocks fade slowly'],
    ['Shock half-life', isFinite(g.halfLife) ? g.halfLife.toFixed(1) + ' bars' : '—', 'Bars for a volatility shock to decay by half'],
    ['Vol now (ann.)', ann(g.next), 'GARCH one-step-ahead conditional volatility'],
    ['Long-run vol', ann(g.longRun), 'Unconditional volatility the model mean-reverts to'],
    ['Close-to-close', ann(ve.closeToClose), 'Classic estimator from closing prices'],
    ['Parkinson', ann(ve.parkinson), 'Uses the high–low range; more efficient'],
    ['Garman–Klass', ann(ve.garmanKlass), 'Uses open, high, low and close'],
    ['LR vs constant vol', g.lrStat.toFixed(1), 'Likelihood-ratio statistic; above ~6 means GARCH fits clearly better (2 d.f., 5%)'],
  ].map(([k, v, t]) => `<div><dt title="${t}">${k}</dt><dd>${v}</dd></div>`).join('');
  const cluster = g.lrStat > 6;
  $('rkVolRead').innerHTML = cluster
    ? `Volatility <b>clusters</b> here: GARCH beats a constant-volatility model (LR ${g.lrStat.toFixed(1)}). Right now vol is <b>${g.next > g.longRun ? 'above' : 'below'}</b> its long-run level and should drift ${g.next > g.longRun ? 'down' : 'up'} towards it (half-life ${Math.max(1, Math.round(g.halfLife))} bar${Math.round(g.halfLife) > 1 ? 's' : ''}).`
    : `Little evidence of volatility clustering (LR ${g.lrStat.toFixed(1)}). ${S.inst.model === 'gbm' || S.inst.model === 'step' ? 'That is expected: this synthetic index is generated with constant volatility.' : 'A constant-volatility model is a reasonable approximation at this timeframe.'}`;
  const pUp = mc.terminal.filter((s) => s > S0).length / mc.terminal.length;
  $('rkVar').innerHTML = [
    ['VaR 95%', money(-v95.VaR), `5% chance of losing more than this over ${H} bars`],
    ['ES 95%', money(-v95.ES), 'Average loss in the worst 5% of paths (expected shortfall)'],
    ['VaR 99%', money(-v99.VaR), '1% tail'], ['ES 99%', money(-v99.ES), 'Average loss in the worst 1%'],
    ['P(price up)', pct(pUp, 0, false), 'Share of simulated paths ending above today'],
    ['Median price', fmtP(mc.terminal[Math.floor(mc.terminal.length / 2)]), 'Median simulated price at the horizon'],
  ].map(([k, v, t]) => `<div><dt title="${t}">${k}</dt><dd>${v}</dd></div>`).join('');
  drawPnlHist(mc.terminal.map((s) => (s / S0 - 1) * notional), -v95.VaR, -v99.VaR);
  renderBS();
}
function renderBS() {
  if (!S.risk) return;
  const { S0, H, f, mc } = S.risk;
  const K = Number($('rkK').value) || S0, sig = (Number($('rkSig').value) || S.risk.sigmaAnn * 100) / 100;
  const T = H / f, bs = M.blackScholes(S0, K, T, sig);
  if (!bs) return;
  const mcCall = mc.terminal.reduce((a, s) => a + Math.max(0, s - K), 0) / mc.terminal.length;
  const mcPut = mc.terminal.reduce((a, s) => a + Math.max(0, K - s), 0) / mc.terminal.length;
  const fmt = (x) => fmtP(x);
  $('rkBS').innerHTML = [
    ['Price (Black–Scholes)', fmt(bs.call), fmt(bs.put)],
    ['Price (Monte Carlo, GARCH-t)', fmt(mcCall), fmt(mcPut)],
    ['Delta', bs.deltaC.toFixed(3), bs.deltaP.toFixed(3)],
    ['Gamma', +bs.gamma.toPrecision(3) + '', +bs.gamma.toPrecision(3) + ''],
    ['Vega (per 1 vol pt)', fmt(bs.vega), fmt(bs.vega)],
    ['Theta (per day)', fmt(bs.thetaC), fmt(bs.thetaP)],
  ].map(([k, a, b]) => `<tr><td>${k}</td><td>${a}</td><td>${b}</td></tr>`).join('');
  const diff = (mcCall - bs.call) / Math.max(1e-9, bs.call);
  $('rkBSRead').innerHTML = `Expiry ${H} bars ≈ <b>${(T * 365).toFixed(T * 365 < 2 ? 2 : 1)} days</b>, zero rates. ${Math.abs(diff) > 0.05 ? `Monte Carlo differs from Black–Scholes by <b>${pct(diff, 0)}</b>: GARCH's vol term structure and fat tails are not captured by a single flat volatility.` : 'Monte Carlo and Black–Scholes agree closely at this strike.'} Delta-hedging this option means holding <b>${bs.deltaC.toFixed(2)}</b> units of the underlying per call.`;
}
function drawPnlHist(pnl, var95, var99) {
  const { ctx, w, h } = fit($('rkHist'));
  ctx.clearRect(0, 0, w, h);
  const lo = pnl[0], hi = pnl[pnl.length - 1], bins = 40, counts = new Array(bins).fill(0);
  pnl.forEach((x) => counts[Math.min(bins - 1, Math.floor(((x - lo) / (hi - lo || 1)) * bins))]++);
  const mx = Math.max(...counts), base = h - 16, X = (v) => ((v - lo) / (hi - lo || 1)) * w;
  counts.forEach((c, i) => { const v = lo + ((i + 0.5) / bins) * (hi - lo); ctx.fillStyle = v < var99 ? C.accent : v < var95 ? 'rgba(255,91,31,.55)' : '#3a3a36'; const bh = (c / mx) * (base - 6); ctx.fillRect((i * w) / bins + 1, base - bh, w / bins - 2, bh); });
  ctx.font = '10px "JetBrains Mono", monospace'; ctx.fillStyle = C.faint; ctx.textBaseline = 'top';
  ctx.fillText(money(lo), 2, base + 3); const t = money(hi); ctx.fillText(t, w - ctx.measureText(t).width - 2, base + 3);
  ctx.strokeStyle = C.text; ctx.beginPath(); ctx.moveTo(X(0), 4); ctx.lineTo(X(0), base); ctx.stroke();
}
$('rkRun').addEventListener('click', () => runRisk(true));
['rkK', 'rkSig'].forEach((id) => $(id).addEventListener('input', renderBS));
$('rkExplain').addEventListener('click', () => alertBox());
function alertBox() {
  const n = $('notice'); n.hidden = false;
  n.textContent = 'GARCH(1,1) is fitted by maximum likelihood to the loaded bars. 2,000 price paths are simulated with Student-t shocks whose variance follows the fitted GARCH. VaR is the loss exceeded in 5% (or 1%) of paths; expected shortfall is the average loss beyond it. Options are priced with Black–Scholes at the forecast volatility and cross-checked with the simulated paths.';
}

/* ==========================================================================
   Challenge: trade bar by bar, then face the Monte Carlo
   ========================================================================== */
const WARM = 60, CH_BARS = 312;

function updateChallengeIntro() {
  $('chSourceNote').innerHTML = S.actualSrc === 'live'
    ? `Using <b>real ${S.inst.id} ${S.tf.label} bars</b> from the recent past. The dates stay hidden until the end.`
    : `Using a <b>simulated ${S.inst.id} ${S.tf.label} market</b> with hidden trend regimes you can reveal at the end.`;
  $('chIntro').hidden = !!S.ch?.running;
  $('chLive').hidden = !S.ch?.running;
}

function startChallenge() {
  let candles, seed = Math.floor(Math.random() * 1e6);
  if (S.actualSrc === 'live' && S.candles.length > CH_BARS + 1) candles = S.candles.slice(-CH_BARS - 1, -1).map((c) => ({ ...c }));
  else candles = new Simulator(S.inst, S.tf.sec, seed).history(CH_BARS);
  const n = candles.length;
  S.ch = {
    candles, n, src: S.actualSrc, seed, day: 0, pos: 0, positions: new Int8Array(n),
    eq: new Array(n).fill(NaN), bh: new Array(n).fill(NaN), equity: NOTIONAL, running: true, paused: false, speed: 1, reveal: false,
    cost: S.inst.spreadBps,
  };
  S.ch.eq[WARM] = NOTIONAL; S.ch.bh[WARM] = NOTIONAL;
  S.hover = -1;
  setChPos(0);
  $('chPause').textContent = 'Pause';
  updateChallengeIntro();
  scheduleCh();
  renderChallenge();
}
function scheduleCh() { clearInterval(S.ch.timer); S.ch.timer = setInterval(stepCh, S.ch.speed === 2 ? 70 : 140); }
function setChPos(p) {
  if (!S.ch) return;
  S.ch.pos = p;
  document.querySelectorAll('[data-ch]').forEach((b) => b.classList.toggle('active', Number(b.dataset.ch) === p));
}
function pauseChallenge(force) {
  const ch = S.ch; if (!ch?.running) return;
  ch.paused = force ? true : !ch.paused;
  $('chPause').textContent = ch.paused ? 'Resume' : 'Pause';
}
function abortChallenge() { if (S.ch) clearInterval(S.ch.timer); S.ch = null; updateChallengeIntro(); }

function stepCh() {
  const ch = S.ch; if (!ch || !ch.running || ch.paused) return;
  const t = WARM + ch.day;
  if (t >= ch.n - 1) return finishCh();
  const prev = t === WARM ? 0 : ch.positions[t - 1];
  ch.positions[t] = ch.pos;
  const r = ch.candles[t + 1].close / ch.candles[t].close - 1;
  ch.equity *= 1 + ch.pos * r - (ch.cost / 10000) * Math.abs(ch.pos - prev);
  ch.eq[t + 1] = ch.equity;
  ch.bh[t + 1] = ch.bh[t] * (1 + r);
  ch.day++;
  renderChallenge();
  if (WARM + ch.day >= ch.n - 1) finishCh();
}

function renderChallenge() {
  const ch = S.ch;
  const to = ch.running ? WARM + ch.day + 1 : ch.n;
  drawChart({
    candles: ch.candles, from: 0, to, xFrom: 0, xTo: ch.n, strip: ch.positions, marker: WARM, regimes: ch.reveal,
    tagColor: ch.pos > 0 ? C.ok : ch.pos < 0 ? C.accent : C.text,
    lower: { type: 'equity', label: 'EQUITY', base: NOTIONAL, baseLabel: '10k', series: [
      { vals: ch.bh, color: C.muted, dash: [4, 3], width: 1 }, { vals: ch.eq, color: C.accent, width: 2 }] },
  });
  legend([['Your equity', C.accent], ['Buy & hold', C.muted, true], ['Long', C.ok], ['Short', C.accent]]);
  $('chartHint').hidden = true;
  const last = ch.candles[to - 1];
  $('lastPrice').textContent = fmtP(last.close);
  $('lastChange').textContent = ch.running ? 'challenge' : ch.src === 'live' ? 'real data' : 'simulated';
  $('lastChange').className = '';
  $('ohlc').textContent = ch.running ? `Bar ${ch.day} of ${ch.n - WARM - 1} · dates hidden` : `${fmtTime(ch.candles[0].epoch, true)} → ${fmtTime(ch.candles[ch.n - 1].epoch, true)}`;
  $('chDay').textContent = `${ch.day} / ${ch.n - WARM - 1}`;
  $('chEq').textContent = '$' + Math.round(ch.equity).toLocaleString();
  const ret = ch.equity / NOTIONAL - 1;
  $('chRet').textContent = pct(ret); $('chRet').className = ret > 0 ? 'up' : ret < 0 ? 'down' : '';
  const dd = M.maxDrawdown(ch.eq.filter(isFinite));
  $('chDD').textContent = pct(-dd);
}

function finishCh() {
  const ch = S.ch; if (!ch.running) return;
  ch.running = false; clearInterval(ch.timer);
  const closes = ch.candles.slice(WARM).map((c) => c.close);
  const posYou = Array.from(ch.positions.slice(WARM));
  const all = ch.candles.map((c) => c.close), s20 = M.sma(all, 20);
  const posMom = closes.map((_, i) => (all[WARM + i] > s20[WARM + i] ? 1 : -1));
  const f = bpy();
  const you = M.backtest(closes, posYou, ch.cost, f);
  const bh = M.backtest(closes, closes.map(() => 1), 0, f);
  const mom = M.backtest(closes, posMom, ch.cost, f);
  const mc = M.randomEntryTest(closes, you.trades, you.sharpe, ch.cost, f, 1000, ch.seed + 3);

  const rows = [
    ['Total return', (m) => pct(m.total, 1), (m) => m.total, 'max'],
    ['Sharpe (ann.)', (m) => m.sharpe.toFixed(2), (m) => m.sharpe, 'max'],
    ['Max drawdown', (m) => pct(-m.mdd, 1), (m) => m.mdd, 'min'],
    ['Volatility (ann.)', (m) => pct(m.vol, 1, false), null],
    ['Position changes', (m) => m.trades, null],
  ];
  const sets = [you, bh, mom];
  $('chTable').innerHTML = rows.map(([k, f2, key, better]) => {
    const vals = key ? sets.map(key) : [];
    const bi = better ? vals.indexOf(better === 'max' ? Math.max(...vals) : Math.min(...vals)) : -1;
    return `<tr><td>${k}</td>${sets.map((m, i) => `<td class="${i === 0 ? 'you' : ''} ${i === bi ? 'best' : ''}">${f2(m)}</td>`).join('')}</tr>`;
  }).join('');
  const p = Math.round(mc.pct * 100);
  $('chPct').textContent = ord(p);
  $('chP').textContent = mc.pval < 0.001 ? '< 0.001' : mc.pval.toFixed(3);
  $('chMed').textContent = mc.median.toFixed(2);

  let title, text;
  if (you.trades === 0) { title = 'You sat it <em>out.</em>'; text = `Flat the whole way: no risk, no return. Buy-and-hold made ${pct(bh.total, 1)}.`; }
  else if (mc.pval < 0.05) { title = 'Hard to call that <em>luck.</em>'; text = `Your Sharpe of ${you.sharpe.toFixed(2)} beat ${p}% of random traders who traded just as often (p = ${mc.pval.toFixed(3)}).`; }
  else if (mc.pct >= 0.75) { title = 'Good, but not <em>conclusive.</em>'; text = `You beat ${p}% of random traders, but with p = ${mc.pval.toFixed(2)} luck can't be ruled out. One sample is small.`; }
  else if (mc.pct >= 0.25) { title = 'Statistically, a <em>coin flip.</em>'; text = `Your Sharpe of ${you.sharpe.toFixed(2)} sits in the middle of the random pack. That's the honest result for most discretionary trading.`; }
  else { title = 'The market won <em>this one.</em>'; text = `You finished below ${100 - p}% of random traders. The SMA-20 rule scored ${mom.sharpe.toFixed(2)} on the same bars.`; }
  if (ch.src === 'live' && S.inst.model !== 'regime') text += ' This was a synthetic random-walk index, so nobody has a real edge here.';
  $('chVerdict').innerHTML = title;
  $('chVerdictText').textContent = text;
  $('chKicker').textContent = ch.src === 'live'
    ? `Real ${S.inst.id} ${S.tf.label} data · ${fmtTime(ch.candles[WARM].epoch, true)} to ${fmtTime(ch.candles[ch.n - 1].epoch, true)}`
    : `Simulated ${S.inst.id} ${S.tf.label} market`;
  $('chReveal').hidden = ch.src === 'live';
  $('chResults').hidden = false;
  renderChallenge();
  requestAnimationFrame(() => drawHist($('chHist'), mc.sorted, [[you.sharpe, C.accent, 'you ' + you.sharpe.toFixed(2)], [mom.sharpe, C.muted, 'SMA-20']]));
  $('chAgain').focus();
}

$('chStart').addEventListener('click', startChallenge);
$('chSpeed').addEventListener('click', () => { if (!S.ch) return; S.ch.speed = S.ch.speed === 1 ? 2 : 1; $('chSpeed').textContent = `Speed ${S.ch.speed}×`; scheduleCh(); });
$('chPause').addEventListener('click', () => pauseChallenge());
document.querySelectorAll('[data-ch]').forEach((b) => b.addEventListener('click', () => setChPos(Number(b.dataset.ch))));
$('chAgain').addEventListener('click', () => { $('chResults').hidden = true; startChallenge(); });
$('chClose').addEventListener('click', () => { $('chResults').hidden = true; abortChallenge(); render(); });
$('chReveal').addEventListener('click', () => {
  $('chResults').hidden = true; S.ch.reveal = true; renderChallenge();
  const back = document.createElement('button');
  back.className = 'btn btn-solid'; back.textContent = 'Back to results';
  back.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:25';
  back.addEventListener('click', () => { back.remove(); $('chResults').hidden = false; });
  document.body.appendChild(back);
});

window.addEventListener('keydown', (e) => {
  if (!S.ch?.running || S.tab !== 'challenge') return;
  const k = e.key.toLowerCase();
  if (k === 'arrowup' || k === 'l') { e.preventDefault(); setChPos(1); }
  else if (k === 'arrowdown' || k === 's') { e.preventDefault(); setChPos(-1); }
  else if (k === ' ' || k === 'f') { e.preventDefault(); setChPos(0); }
  else if (k === 'p') pauseChallenge();
});
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseChallenge(true); });
window.addEventListener('resize', () => { render(); if (heatState && !$('sweepBox').hidden) drawHeat(); });

/* ---------- boot ---------- */
buildPicker();
syncControls();
load();
