/* ==========================================================================
   Market Maker — quote against noise and informed flow, beat Avellaneda–Stoikov
   Prices are integers in ticks (1 tick = $0.01). One unit = 100 shares,
   so one tick of P&L per unit = $1.
   ========================================================================== */
const $ = (id) => document.getElementById(id);
const C = { text: '#ecebe4', muted: '#9b998f', faint: '#6a6862', grid: '#22221f', accent: '#ff5b1f', ok: '#8fd18a', warn: '#ffc857', blue: '#8ab4ff', bg: '#141413' };
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const px = (t) => (t / 100).toFixed(2);
const usd = (x) => (x < 0 ? '−$' : '$') + Math.abs(Math.round(x)).toLocaleString();

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const gauss = (r) => { let u = 0; while (!u) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };
const poisson = (r, l) => { let k = 0, p = 1; const L = Math.exp(-l); do { k++; p *= r(); } while (p > L); return k - 1; };

const TICKS = 240, TICK_MS = 250, LAG = 4, LIMIT = 25, HEDGE_COST = 6;
const LEVELS = [
  { name: 'Round 1 · Quiet tape', desc: 'Low volatility, mostly noise traders. Learn the spread/volume trade-off.', sigma: 1.0, pInf: 0.08, lambda: 0.9, meanH: 3, jumps: 0, drift: false },
  { name: 'Round 2 · News day', desc: 'Headlines move fair value suddenly. The reference price catches up late.', sigma: 1.4, pInf: 0.16, lambda: 0.9, meanH: 3, jumps: 1 / 45, drift: false },
  { name: 'Round 3 · Toxic flow', desc: 'Someone is working a big order. Watch the imbalance and skew.', sigma: 1.2, pInf: 0.3, lambda: 0.9, meanH: 3, jumps: 0, drift: true },
];
const HEADLINES = {
  up: ['Central bank surprises with a rate cut', 'Quarterly earnings beat by 18%', 'Takeover offer confirmed at a premium', 'Regulator approves flagship product'],
  down: ['CEO resigns with immediate effect', 'Guidance cut for next quarter', 'Regulator opens an investigation', 'Major customer cancels contract'],
};

/* ---------- agents ---------- */
function newAgent(name) { return { name, cash: 0, inv: 0, fills: [], pnl: [], maxInv: 0, hedges: 0 }; }
function quotesFor(agent, kind, s, t, L) {
  if (kind === 'you') {
    const c = s + U.skew;
    let bid = Math.round(c - U.half), ask = Math.round(c + U.half);
    if (ask <= bid) ask = bid + 1;
    return { bid: U.pulled || agent.inv >= LIMIT ? null : bid, ask: U.pulled || agent.inv <= -LIMIT ? null : ask };
  }
  if (kind === 'fixed') return { bid: agent.inv >= LIMIT ? null : s - 4, ask: agent.inv <= -LIMIT ? null : s + 4 };
  // Avellaneda–Stoikov with gamma tuned for tick units; k from the noise-trader elasticity exp(-δ/meanH)
  const gamma = 0.004, k = 1 / L.meanH, tau = TICKS - t, s2 = L.sigma * L.sigma;
  const r = s - agent.inv * gamma * s2 * tau;
  const half = Math.max(2, 0.5 * (gamma * s2 * tau + (2 / gamma) * Math.log(1 + gamma / k)));
  return { bid: agent.inv >= LIMIT ? null : Math.round(r - half), ask: agent.inv <= -LIMIT ? null : Math.round(r + half) };
}
function fill(agent, t, side, price, V, informed, size = 1) {
  agent.inv += side * size; agent.cash -= side * price * size;
  agent.maxInv = Math.max(agent.maxInv, Math.abs(agent.inv));
  agent.fills.push({ t, side, price, V, informed, size });
}

/* ---------- state ---------- */
const U = { half: 3, skew: 0, pulled: false };
let R = null; // current round
let roundIdx = 0, timer = 0;
const totals = store.get('mm-best', null);

function startRound(i, seed) {
  clearInterval(timer);
  roundIdx = i;
  const L = LEVELS[i];
  seed = seed ?? Math.floor(Math.random() * 1e9);
  R = { L, seed, rnd: mulberry32(seed), t: 0, V: [10000], ref: [10000], flow: 0, flowHist: [0], drift: 0, driftLeft: 0, nextDriftIn: 20,
    agents: { you: newAgent('You'), as: newAgent('A–S bot'), fixed: newAgent('Fixed bot') }, quotes: [], tape: [], headline: '', done: false };
  U.pulled = false; U.skew = 0; U.half = 3;
  $('lvlName').textContent = L.name; $('lvlDesc').textContent = L.desc; $('levelChip').textContent = `Round ${i + 1} of 3`;
  $('headline').textContent = i === 1 ? 'Waiting for news…' : i === 2 ? 'Flow looks normal… for now.' : '';
  $('results').hidden = true; $('intro').hidden = true;
  renderControls(); render();
  timer = setInterval(step, TICK_MS);
}

function step() {
  if (!R || R.done || document.hidden) return;
  const { L, rnd } = R;
  const t = R.t + 1;
  // 1. true value
  let V = R.V[R.V.length - 1] + L.sigma * gauss(rnd);
  if (L.jumps && rnd() < L.jumps) {
    const up = rnd() < 0.5, size = 18 + rnd() * 17;
    V += up ? size : -size;
    const list = HEADLINES[up ? 'up' : 'down'];
    R.headline = `${list[Math.floor(rnd() * list.length)]} · fair value ${up ? '↑' : '↓'}`;
    const h = $('headline'); h.textContent = R.headline; h.classList.remove('flash'); void h.offsetWidth; h.classList.add('flash');
  }
  if (L.drift) {
    if (R.driftLeft > 0) { V += R.drift; R.driftLeft--; if (!R.driftLeft) { R.nextDriftIn = 15 + Math.floor(rnd() * 25); } }
    else if (--R.nextDriftIn <= 0) { R.drift = (rnd() < 0.5 ? -1 : 1) * 0.55; R.driftLeft = 40 + Math.floor(rnd() * 25); }
  }
  R.V.push(V);
  // 2. lagging, noisy reference price
  const lagged = R.V[Math.max(0, R.V.length - 1 - LAG)];
  const s = Math.round(lagged + gauss(rnd) * 0.5);
  R.ref.push(s);
  // 3. quotes for everyone, from the same reference
  const q = { you: quotesFor(R.agents.you, 'you', s, t, L), as: quotesFor(R.agents.as, 'as', s, t, L), fixed: quotesFor(R.agents.fixed, 'fixed', s, t, L) };
  R.quotes.push(q.you);
  // 4. order arrivals (identical for all agents)
  const events = [];
  const n = poisson(rnd, L.lambda);
  for (let k = 0; k < n; k++) events.push({ informed: false, side: rnd() < 0.5 ? 1 : -1, h: -Math.log(1 - rnd()) * L.meanH });
  if (rnd() < L.pInf) { const mis = V - s; events.push({ informed: true, side: mis >= 0 ? 1 : -1, mis }); }
  // 5. match each event against each agent (parallel books)
  for (const key of ['you', 'as', 'fixed']) {
    const a = R.agents[key], qq = q[key];
    for (const e of events) {
      if (!e.informed) {
        if (e.side > 0 && qq.ask !== null && qq.ask - s <= e.h) { fill(a, t, -1, qq.ask, V, false); if (key === 'you') R.tape.unshift({ t, side: -1, price: qq.ask }); }
        else if (e.side < 0 && qq.bid !== null && s - qq.bid <= e.h) { fill(a, t, 1, qq.bid, V, false); if (key === 'you') R.tape.unshift({ t, side: 1, price: qq.bid }); }
      } else {
        if (e.side > 0 && qq.ask !== null && qq.ask < V - 0.5) { const sz = V - qq.ask > 6 ? 3 : V - qq.ask > 3 ? 2 : 1; fill(a, t, -1, qq.ask, V, true, sz); if (key === 'you') R.tape.unshift({ t, side: -1, price: qq.ask, size: sz }); }
        else if (e.side < 0 && qq.bid !== null && qq.bid > V + 0.5) { const sz = qq.bid - V > 6 ? 3 : qq.bid - V > 3 ? 2 : 1; fill(a, t, 1, qq.bid, V, true, sz); if (key === 'you') R.tape.unshift({ t, side: 1, price: qq.bid, size: sz }); }
      }
    }
    a.pnl.push(a.cash + a.inv * s);
  }
  // 6. market-wide flow imbalance (all market orders, not just yours)
  const signed = events.reduce((acc, e) => acc + e.side * (e.informed ? 2 : 1), 0);
  R.flow = R.flow * 0.92 + signed * 0.08 * 4;
  R.flowHist.push(R.flow);
  R.tape = R.tape.slice(0, 10);
  R.t = t;
  render();
  if (t >= TICKS) endRound();
}

function hedge() {
  // Flatten up to 5 units by crossing a wider outside market: buy at ref + cost, sell at ref − cost.
  if (!R || R.done) return;
  const a = R.agents.you, s = R.ref[R.ref.length - 1];
  if (!a.inv) return;
  const size = Math.min(5, Math.abs(a.inv)), side = a.inv > 0 ? -1 : 1;
  const p = side > 0 ? s + HEDGE_COST : s - HEDGE_COST;
  a.inv += side * size; a.cash -= side * p * size; a.hedges += size;
  R.tape.unshift({ t: R.t, side, price: p, size, hedge: true });
  render();
}

/* ---------- analytics ---------- */
const HORIZONS = [0, 1, 2, 5, 10, 20, 40];
function analyse(a, Vend) {
  const V = R.V;
  const fills = a.fills;
  const units = fills.reduce((s, f) => s + f.size, 0);
  const edge = fills.reduce((s, f) => s + f.side * (f.V - f.price) * f.size, 0);
  const total = a.cash + a.inv * Vend;
  const informedUnits = fills.filter((f) => f.informed).reduce((s, f) => s + f.size, 0);
  const markouts = HORIZONS.map((h) => {
    if (!fills.length) return 0;
    return fills.reduce((s, f) => s + f.side * (V[Math.min(V.length - 1, f.t + h)] - f.price) * f.size, 0) / units;
  });
  const d = a.pnl.map((v, i) => v - (a.pnl[i - 1] ?? 0)).slice(1);
  const m = d.reduce((x, y) => x + y, 0) / Math.max(1, d.length), sd = Math.sqrt(d.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, d.length));
  return { total, edge, inventory: total - edge, units, toxicity: units ? informedUnits / units : 0, maxInv: a.maxInv, markouts, sharpe: sd ? (m / sd) * Math.sqrt(d.length) : 0, hedges: a.hedges };
}

function endRound() {
  R.done = true; clearInterval(timer);
  const Vend = R.V[R.V.length - 1];
  const res = { you: analyse(R.agents.you, Vend), as: analyse(R.agents.as, Vend), fixed: analyse(R.agents.fixed, Vend) };
  R.res = res;
  const scores = store.get('mm-scores', {});
  scores[roundIdx] = Math.max(scores[roundIdx] ?? -Infinity, res.you.total); store.set('mm-scores', scores);
  render(true);

  const rows = [
    ['Final P&L (true value)', (r) => usd(r.total), (r) => r.total, 'max'],
    ['Edge at fill', (r) => usd(r.edge), (r) => r.edge, 'max'],
    ['Inventory / timing P&L', (r) => usd(r.inventory), (r) => r.inventory, 'max'],
    ['Units traded', (r) => r.units, null],
    ['Toxicity (informed share)', (r) => (r.toxicity * 100).toFixed(0) + '%', (r) => r.toxicity, 'min'],
    ['Max |inventory|', (r) => r.maxInv, (r) => r.maxInv, 'min'],
    ['P&L Sharpe (round)', (r) => r.sharpe.toFixed(2), (r) => r.sharpe, 'max'],
  ];
  const sets = [res.you, res.as, res.fixed];
  $('rTable').innerHTML = rows.map(([k, f, key, better]) => {
    const vals = key ? sets.map(key) : [];
    const bi = better ? vals.indexOf(better === 'max' ? Math.max(...vals) : Math.min(...vals)) : -1;
    return `<tr><td>${k}</td>${sets.map((r, i) => `<td class="${i === 0 ? 'you' : ''} ${i === bi ? 'best' : ''}">${f(r)}</td>`).join('')}</tr>`;
  }).join('');

  const y = res.you, beatAS = y.total > res.as.total;
  $('rKicker').textContent = `${R.L.name} · complete`;
  $('rTitle').innerHTML = beatAS ? 'You beat the <em>model.</em>' : y.total > 0 ? 'Profitable, but the bot <em>did better.</em>' : 'The flow <em>picked you off.</em>';
  const tips = [];
  if (y.units < 20) tips.push('You traded very little. Your spread was probably too wide to attract noise traders.');
  if (y.toxicity > 0.35) tips.push(`${(y.toxicity * 100).toFixed(0)}% of your volume was informed. Widen or pull quotes when headlines hit or the flow turns one-sided.`);
  if (y.markouts[0] > 0 && y.markouts[6] < y.markouts[0] * 0.3) tips.push('Your markouts decay sharply: you captured spread at the fill, then the price moved against you. That is adverse selection.');
  if (y.inventory < -Math.abs(y.edge) * 0.5) tips.push('Inventory cost you more than the spread earned. Skew your quotes against your position (long → skew down) or hedge earlier.');
  if (y.maxInv >= LIMIT) tips.push('You hit the position limit, so one side of your book stopped quoting. Manage inventory before it manages you.');
  if (!tips.length) tips.push('Balanced round: good edge per fill, controlled inventory and little toxic flow.');
  $('rText').textContent = tips.join(' ');
  $('nextBtn').textContent = roundIdx < 2 ? 'Next round →' : 'See final score';
  $('results').hidden = false;
  requestAnimationFrame(() => drawMarkouts(res));
}

/* ---------- rendering ---------- */
function fit(cv) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2), w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.font = '11px "JetBrains Mono", monospace';
  return { ctx, w, h };
}

function render(reveal = false) {
  if (!R) return;
  const a = R.agents.you, s = R.ref[R.ref.length - 1];
  const mtm = a.cash + a.inv * s;
  $('clock').textContent = Math.ceil(((TICKS - R.t) * TICK_MS) / 1000) + 's';
  $('kPnl').textContent = usd(mtm); $('kPnl').className = mtm > 0 ? 'up' : mtm < 0 ? 'down' : '';
  $('kInv').textContent = (a.inv > 0 ? '+' : '') + a.inv; $('kInv').className = Math.abs(a.inv) >= LIMIT ? 'down' : '';
  const f = $('invFill'), frac = Math.min(1, Math.abs(a.inv) / LIMIT) * 50;
  f.style.width = frac + '%'; f.style.left = a.inv >= 0 ? '50%' : 50 - frac + '%'; f.style.background = Math.abs(a.inv) > LIMIT * 0.7 ? 'var(--accent)' : 'var(--ok)';
  const units = a.fills.reduce((x, y) => x + y.size, 0);
  $('kFills').textContent = units;
  $('kEdge').textContent = units ? (a.fills.reduce((x, y) => x + y.side * (R.ref[y.t] - y.price) * y.size, 0) / units).toFixed(1) + 't' : '—';
  const q = R.quotes[R.quotes.length - 1] || quotesFor(a, 'you', s, R.t, R.L);
  $('qBid').textContent = q.bid === null ? 'off' : px(q.bid); $('qAsk').textContent = q.ask === null ? 'off' : px(q.ask); $('qRef').textContent = px(s);
  document.querySelector('.q.bid').classList.toggle('off', q.bid === null); document.querySelector('.q.ask').classList.toggle('off', q.ask === null);
  const fl = clamp(R.flow / 4, -1, 1);
  $('flowVal').textContent = R.flow.toFixed(1);
  $('flowPos').style.width = Math.max(0, fl) * 50 + '%'; $('flowNeg').style.width = Math.max(0, -fl) * 50 + '%';
  const asA = R.agents.as, fxA = R.agents.fixed;
  $('bYou').textContent = usd(mtm); $('bAS').textContent = usd(asA.cash + asA.inv * s); $('bFix').textContent = usd(fxA.cash + fxA.inv * s);
  $('tape').innerHTML = R.tape.map((t) => `<li class="${t.side > 0 ? 'you-b' : 'you-s'}"><span>${t.hedge ? 'Hedge ' : 'You '}${t.side > 0 ? 'bought' : 'sold'} ${t.size || 1}</span><span>@ ${px(t.price)}</span></li>`).join('');
  drawChart(reveal);
}

function drawChart(reveal) {
  const { ctx, w, h } = fit($('chart'));
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, h);
  const padR = 62, top = 10, pH = h * 0.7 - top, invTop = h * 0.7 + 14, invH = h - invTop - 18;
  const X = (t) => 8 + (t / TICKS) * (w - padR - 8);
  const series = [...R.ref, ...(reveal ? R.V : [])];
  R.quotes.forEach((q) => { if (q.bid !== null) series.push(q.bid); if (q.ask !== null) series.push(q.ask); });
  let lo = Math.min(...series), hi = Math.max(...series); const pad = Math.max(6, (hi - lo) * 0.1); lo -= pad; hi += pad;
  const Y = (v) => top + (1 - (v - lo) / (hi - lo)) * pH;
  for (let k = 0; k <= 4; k++) { const v = lo + ((hi - lo) * k) / 4; ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.moveTo(8, Y(v)); ctx.lineTo(w - padR, Y(v)); ctx.stroke(); ctx.fillStyle = C.faint; ctx.textBaseline = 'middle'; ctx.fillText(px(v), w - padR + 6, Y(v)); }
  // quote band
  const band = (key, color) => { ctx.strokeStyle = color; ctx.lineWidth = 1.3; ctx.beginPath(); let pen = false; R.quotes.forEach((q, i) => { const v = q[key]; if (v === null) { pen = false; return; } pen ? ctx.lineTo(X(i + 1), Y(v)) : (ctx.moveTo(X(i + 1), Y(v)), (pen = true)); }); ctx.stroke(); };
  ctx.fillStyle = 'rgba(255,255,255,.04)';
  R.quotes.forEach((q, i) => { if (q.bid !== null && q.ask !== null) ctx.fillRect(X(i + 1) - 1, Y(q.ask), X(i + 2) - X(i + 1) + 1, Y(q.bid) - Y(q.ask)); });
  band('bid', C.ok); band('ask', C.accent);
  // reference & true value
  const line = (arr, color, wdt, dash) => { ctx.strokeStyle = color; ctx.lineWidth = wdt; ctx.setLineDash(dash || []); ctx.beginPath(); arr.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)))); ctx.stroke(); ctx.setLineDash([]); };
  line(R.ref, C.text, 1.6);
  if (reveal) line(R.V, C.blue, 1.4, [4, 3]);
  // fills
  R.agents.you.fills.forEach((f) => {
    const x = X(f.t), y = Y(f.price), up = f.side > 0, r = 3 + f.size;
    ctx.fillStyle = up ? C.ok : C.accent; ctx.beginPath();
    if (up) { ctx.moveTo(x, y - r); ctx.lineTo(x + r, y + r); ctx.lineTo(x - r, y + r); } else { ctx.moveTo(x, y + r); ctx.lineTo(x + r, y - r); ctx.lineTo(x - r, y - r); }
    ctx.fill();
    if (reveal && f.informed) { ctx.strokeStyle = C.warn; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, r + 4, 0, Math.PI * 2); ctx.stroke(); }
  });
  // inventory panel
  ctx.fillStyle = C.faint; ctx.textBaseline = 'top'; ctx.fillText('INVENTORY', 10, invTop - 12);
  const IY = (v) => invTop + invH / 2 - (v / LIMIT) * (invH / 2);
  ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.moveTo(8, IY(0)); ctx.lineTo(w - padR, IY(0)); ctx.stroke();
  [LIMIT, -LIMIT].forEach((l) => { ctx.strokeStyle = 'rgba(255,91,31,.3)'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(8, IY(l)); ctx.lineTo(w - padR, IY(l)); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = C.faint; ctx.textBaseline = 'middle'; ctx.fillText((l > 0 ? '+' : '') + l, w - padR + 6, IY(l)); });
  let inv = 0; const invSeries = [0]; let fi = 0; const fills = R.agents.you.fills;
  for (let t = 1; t <= R.t; t++) { while (fi < fills.length && fills[fi].t <= t) { inv += fills[fi].side * fills[fi].size; fi++; } invSeries.push(inv); }
  // hedges are not in fills; correct the last point to the live inventory
  invSeries[invSeries.length - 1] = R.agents.you.inv;
  ctx.fillStyle = 'rgba(143,209,138,.25)';
  invSeries.forEach((v, t) => { ctx.fillStyle = v >= 0 ? 'rgba(143,209,138,.35)' : 'rgba(255,91,31,.35)'; ctx.fillRect(X(t), Math.min(IY(0), IY(v)), Math.max(1, X(1) - X(0)), Math.abs(IY(v) - IY(0))); });
  // time cursor
  ctx.strokeStyle = 'rgba(236,235,228,.25)'; ctx.beginPath(); ctx.moveTo(X(R.t), top); ctx.lineTo(X(R.t), h - 6); ctx.stroke();
}

function drawMarkouts(res) {
  const { ctx, w, h } = fit($('markout'));
  ctx.clearRect(0, 0, w, h);
  const all = [...res.you.markouts, ...res.as.markouts, 0];
  let lo = Math.min(...all), hi = Math.max(...all); const pad = Math.max(0.5, (hi - lo) * 0.15); lo -= pad; hi += pad;
  const X = (i) => 40 + (i / (HORIZONS.length - 1)) * (w - 60), Y = (v) => 8 + (1 - (v - lo) / (hi - lo)) * (h - 30);
  ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.moveTo(40, Y(0)); ctx.lineTo(w - 20, Y(0)); ctx.stroke();
  ctx.fillStyle = C.faint; ctx.textBaseline = 'middle'; ctx.fillText('0', 24, Y(0)); ctx.fillText(hi.toFixed(1), 8, Y(hi)); ctx.fillText(lo.toFixed(1), 8, Y(lo));
  ctx.textBaseline = 'top'; HORIZONS.forEach((hh, i) => ctx.fillText('h=' + hh, X(i) - 12, h - 16));
  [[res.as.markouts, C.muted, 'A–S'], [res.you.markouts, C.accent, 'You']].forEach(([m, color, label]) => {
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath(); m.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)))); ctx.stroke();
    m.forEach((v, i) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(X(i), Y(v), 3, 0, Math.PI * 2); ctx.fill(); });
    ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.fillText(label, X(HORIZONS.length - 1) + 4, Y(m[m.length - 1]));
  });
}

function finalScreen() {
  const scores = store.get('mm-scores', {});
  const total = [0, 1, 2].reduce((s, i) => s + (scores[i] ?? 0), 0);
  $('rKicker').textContent = 'Session complete';
  $('rTitle').innerHTML = `Best total across rounds: <em>${usd(total)}</em>`;
  $('rText').textContent = 'Market making is a game of small edges: earn the spread from uninformed flow, avoid informed flow, and keep inventory small. Replay any round to push your score.';
  $('nextBtn').textContent = 'Start again from round 1';
  $('nextBtn').onclick = () => { $('nextBtn').onclick = null; startRound(0); };
}

/* ---------- controls ---------- */
function renderControls() {
  $('vHalf').textContent = U.half; $('vSkew').textContent = (U.skew > 0 ? '+' : '') + U.skew;
  $('pullBtn').classList.toggle('on', U.pulled); $('pullBtn').firstChild.textContent = U.pulled ? 'Quotes pulled ' : 'Pull quotes ';
}
function adjust(k, d) {
  if (k === 'half') U.half = clamp(U.half + d, 1, 20); else U.skew = clamp(U.skew + d, -25, 25);
  renderControls(); if (R) render(R.done);
}
document.querySelectorAll('.step button').forEach((b) => b.addEventListener('click', () => adjust(b.dataset.k, Number(b.dataset.d))));
$('pullBtn').addEventListener('click', () => { U.pulled = !U.pulled; renderControls(); });
$('hedgeBtn').addEventListener('click', hedge);
window.addEventListener('keydown', (e) => {
  if (!R || R.done) return;
  const k = e.key.toLowerCase();
  if (k === 'w' || k === 'arrowup') { e.preventDefault(); adjust('half', 1); }
  else if (k === 's' || k === 'arrowdown') { e.preventDefault(); adjust('half', -1); }
  else if (k === 'a' || k === 'arrowleft') { e.preventDefault(); adjust('skew', -1); }
  else if (k === 'd' || k === 'arrowright') { e.preventDefault(); adjust('skew', 1); }
  else if (k === ' ') { e.preventDefault(); U.pulled = !U.pulled; renderControls(); }
  else if (k === 'h') hedge();
});
$('startBtn').addEventListener('click', () => startRound(0));
$('retryBtn').addEventListener('click', () => startRound(roundIdx, R.seed));
$('nextBtn').addEventListener('click', () => { if ($('nextBtn').onclick) return; if (roundIdx < 2) startRound(roundIdx + 1); else finalScreen(); });
window.addEventListener('resize', () => { if (R) { drawChart(R.done); if (R.res && !$('results').hidden) drawMarkouts(R.res); } });

void totals;
let aboutPaused = false;
window.addEventListener('aboutopen', () => { if (R && !R.done) { clearInterval(timer); aboutPaused = true; } });
window.addEventListener('aboutclose', () => { if (aboutPaused && R && !R.done) timer = setInterval(step, TICK_MS); aboutPaused = false; });
window.__mm = { get R() { return R; }, U, step, startRound, endRound };
