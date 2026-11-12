const $ = (id) => document.getElementById(id);
const C = { text: '#ecebe4', muted: '#9b998f', faint: '#6a6862', grid: '#22221f', accent: '#ff5b1f', ok: '#8fd18a', warn: '#ffc857', blue: '#8ab4ff' };
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pct = (x, d = 1) => (x * 100).toFixed(d) + '%';
const money = (x) => '$' + (x >= 100 ? Math.round(x).toLocaleString() : x.toFixed(2));

function fit(cv) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2), w = cv.clientWidth, h = cv.clientHeight;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.font = '11px "JetBrains Mono", monospace';
  return { ctx, w, h };
}

const modeBtns = [...document.querySelectorAll('[data-mode]')];
function setMode(m) {
  modeBtns.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === m)));
  document.querySelectorAll('[data-pane]').forEach((p) => (p.hidden = p.dataset.pane !== m));
  try { history.replaceState(null, '', '#' + m); } catch {}
  if (m === 'kelly') drawKelly();
  if (m === 'bayes') drawCalib();
}
modeBtns.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

const K = {};
const KELLY_SETUPS = [
  { p: 0.6, b: 1 }, { p: 0.55, b: 1 }, { p: 0.65, b: 1 }, { p: 0.4, b: 2 }, { p: 0.45, b: 2 }, { p: 0.35, b: 3 },
];
const ROUNDS = 100, START = 1000;
function newKelly() {
  const s = pick(KELLY_SETUPS);
  const q = 1 - s.p, fStar = (s.b * s.p - q) / s.b;
  Object.assign(K, {
    ...s, q, fStar, flip: 0, outcomes: Array.from({ length: ROUNDS }, () => Math.random() < s.p),
    players: [
      { name: 'You', color: C.accent, w: [START], f: null, width: 2.2 },
      { name: `Kelly (${pct(fStar, 0)})`, color: C.ok, w: [START], f: fStar },
      { name: `Half Kelly (${pct(fStar / 2, 1)})`, color: C.blue, w: [START], f: fStar / 2 },
      { name: `2× Kelly (${pct(Math.min(0.99, fStar * 2), 0)})`, color: C.warn, w: [START], f: Math.min(0.99, fStar * 2) },
    ],
    yourFracs: [], done: false,
  });
  $('kSetup').innerHTML = `This coin lands <b>heads ${pct(s.p, 0)}</b> of the time. A winning bet pays <b>${s.b}:1</b>; a losing bet loses your stake. You always bet on heads. You start with ${money(START)} and get ${ROUNDS} flips. <b>How much of your bankroll should you risk each time?</b>`;
  $('kResult').hidden = true;
  $('kFlip').disabled = false; $('kAuto').disabled = false;
  updateKelly(); drawKelly();
}
function kellyStep() {
  if (K.done) return;
  const you = K.players[0];
  const frac = Number($('kFrac').value) / 100;
  const win = K.outcomes[K.flip];
  K.players.forEach((pl) => {
    const w = pl.w[pl.w.length - 1];
    const f = pl.f === null ? frac : pl.f;
    const stake = w * f;
    pl.w.push(Math.max(0, win ? w + stake * K.b : w - stake));
  });
  K.yourFracs.push(frac);
  K.flip++;
  const coin = $('kCoin');
  coin.style.transform = `rotateY(${K.flip * 1080 + (win ? 0 : 180)}deg)`;
  $('kLast').textContent = win ? 'Heads · win' : 'Tails · loss';
  $('kLast').className = win ? 'up' : 'down';
  if (K.flip >= ROUNDS || you.w[you.w.length - 1] < 0.01) finishKelly();
  updateKelly(); drawKelly();
}
function updateKelly() {
  const you = K.players[0], w = you.w[you.w.length - 1];
  $('kRound').textContent = `Flip ${K.flip} / ${ROUNDS}`;
  $('kBank').textContent = money(w);
  $('kBank').className = w > START ? 'up' : w < START ? 'down' : '';
  $('kFracLbl').textContent = $('kFrac').value + '%';
  $('kBet').textContent = money(w * Number($('kFrac').value) / 100);
}
function finishKelly() {
  K.done = true;
  $('kFlip').disabled = true; $('kAuto').disabled = true;
  $('kResult').hidden = false;
  const avg = K.yourFracs.reduce((a, b) => a + b, 0) / Math.max(1, K.yourFracs.length);
  const g = (f) => K.p * Math.log(1 + K.b * f) + K.q * Math.log(1 - f);
  const final = K.players.map((p) => p.w[p.w.length - 1]);
  const rank = [...final].sort((a, b) => b - a).indexOf(final[0]) + 1;
  const over = avg > K.fStar * 1.5, under = avg < K.fStar * 0.5;
  $('kLesson').innerHTML =
    `Kelly fraction here is <b>f* = (bp − q) / b = (${K.b}×${K.p} − ${K.q.toFixed(2)}) / ${K.b} = ${pct(K.fStar, 1)}</b>. ` +
    `You averaged <b>${pct(avg, 1)}</b> per flip and finished <b>${money(final[0])}</b> (rank ${rank} of 4). ` +
    (final[0] < 0.01 ? 'You went bust: once you lose everything, the edge is worthless. ' :
      over ? 'Betting well above Kelly adds volatility and lowers long-run growth; at roughly twice Kelly, expected growth falls to about zero. ' :
        under ? 'Betting well below Kelly is safe but leaves growth on the table. ' : 'That is close to Kelly: near the top of the growth curve. ') +
    'Over one short game luck dominates, but across many games the Kelly bettor’s wealth grows fastest.';
  requestAnimationFrame(() => drawCurve(g, avg));
}
function drawKelly() {
  const cv = $('kChart'); if (!cv.clientWidth || !K.players) return;
  const { ctx, w, h } = fit(cv);
  ctx.clearRect(0, 0, w, h);
  const all = K.players.flatMap((p) => p.w).filter((v) => v > 0);
  const lo = Math.min(START / 4, ...all) * 0.8, hi = Math.max(START * 2, ...all) * 1.25;
  const pad = 48, X = (i) => 8 + (i / ROUNDS) * (w - pad - 8), Y = (v) => 10 + (1 - (Math.log(Math.max(v, lo)) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * (h - 30);
  for (let e = Math.ceil(Math.log10(lo)); e <= Math.log10(hi); e++) for (const m of [1, 3]) {
    const v = m * 10 ** e; if (v < lo || v > hi) continue;
    ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.moveTo(8, Y(v)); ctx.lineTo(w - pad, Y(v)); ctx.stroke();
    ctx.fillStyle = C.faint; ctx.textBaseline = 'middle'; ctx.fillText(v >= 1000 ? (v / 1000) + 'k' : String(v), w - pad + 6, Y(v));
  }
  ctx.strokeStyle = 'rgba(236,235,228,.3)'; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(8, Y(START)); ctx.lineTo(w - pad, Y(START)); ctx.stroke(); ctx.setLineDash([]);
  [...K.players].reverse().forEach((p) => {
    ctx.strokeStyle = p.color; ctx.lineWidth = p.width || 1.4; ctx.beginPath();
    p.w.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
    ctx.stroke();
  });
  ctx.fillStyle = C.faint; ctx.textBaseline = 'top'; ctx.fillText(`flip ${K.flip}`, X(K.flip) - 20, h - 16);
  $('kLegend').innerHTML = K.players.map((p) => `<span><i style="background:${p.color}"></i>${p.name}: ${money(p.w[p.w.length - 1])}</span>`).join('');
}
function drawCurve(g, avg) {
  const { ctx, w, h } = fit($('kCurve'));
  ctx.clearRect(0, 0, w, h);
  const fMax = Math.min(0.99, K.fStar * 3), N = 120;
  const pts = []; for (let i = 0; i <= N; i++) { const f = (i / N) * fMax; pts.push([f, g(f)]); }
  const gs = pts.map((p) => p[1]), lo = Math.min(...gs, -0.01), hi = Math.max(...gs) * 1.2;
  const X = (f) => 30 + (f / fMax) * (w - 40), Y = (v) => 10 + (1 - (v - lo) / (hi - lo)) * (h - 34);
  ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.moveTo(30, Y(0)); ctx.lineTo(w - 10, Y(0)); ctx.stroke();
  ctx.strokeStyle = C.text; ctx.lineWidth = 1.6; ctx.beginPath(); pts.forEach(([f, v], i) => (i ? ctx.lineTo(X(f), Y(v)) : ctx.moveTo(X(f), Y(v)))); ctx.stroke();
  const mark = (f, color, label, row) => {
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(X(f), Y(g(f))); ctx.lineTo(X(f), h - 24); ctx.stroke();
    ctx.fillStyle = color; ctx.textBaseline = 'top'; ctx.fillText(label, Math.min(w - 90, X(f) + 4), 4 + row * 13);
  };
  mark(K.fStar, C.ok, 'Kelly ' + pct(K.fStar, 0), 0);
  mark(Math.min(fMax, avg), C.accent, 'you ' + pct(avg, 0), 1);
  ctx.fillStyle = C.faint; ctx.textBaseline = 'top';
  [0, 0.25, 0.5, 0.75, 1].forEach((t) => ctx.fillText(pct(t * fMax, 0), X(t * fMax) - 10, h - 16));
  ctx.save(); ctx.translate(10, h / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('growth / flip', -34, -4); ctx.restore();
}
$('kFrac').addEventListener('input', updateKelly);
$('kFlip').addEventListener('click', kellyStep);
$('kAuto').addEventListener('click', () => { for (let i = 0; i < 10 && !K.done; i++) kellyStep(); });
$('kNew').addEventListener('click', newKelly);

const binom = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; };
const CASES = {
  urns() {
    const prior = pick([0.5, 0.3, 0.7]), pa = pick([0.7, 0.8, 0.6]), pb = 1 - pa;
    const isA = Math.random() < prior, n = ri(4, 6);
    const draws = Array.from({ length: n }, () => (Math.random() < (isA ? pa : pb) ? 'r' : 'b'));
    const r = draws.filter((d) => d === 'r').length, bl = n - r;
    const la = pa ** r * (1 - pa) ** bl, lb = pb ** r * (1 - pb) ** bl;
    const truth = (prior * la) / (prior * la + (1 - prior) * lb);
    return {
      title: 'Two urns',
      html: `Urn A holds <b>${pct(pa, 0)} red</b> balls; urn B holds <b>${pct(pb, 0)} red</b>. One urn was picked (urn A with probability ${pct(prior, 0)}). You draw ${n} balls with replacement:
        <span class="tokens">${draws.map((d) => `<i class="tok-${d}">${d === 'r' ? 'R' : 'B'}</i>`).join('')}</span><span class="q">What is the probability the urn is A?</span>`,
      truth,
      explain: `Likelihoods: A = ${pa}<sup>${r}</sup>×${pb.toFixed(1)}<sup>${bl}</sup> = <code>${la.toExponential(2)}</code>, B = ${pb.toFixed(1)}<sup>${r}</sup>×${pa}<sup>${bl}</sup> = <code>${lb.toExponential(2)}</code>.
        Posterior = ${prior}×A ÷ (${prior}×A + ${(1 - prior).toFixed(1)}×B).`,
    };
  },
  medical() {
    const prev = pick([0.005, 0.01, 0.02, 0.05]), sens = pick([0.9, 0.95, 0.99]), spec = pick([0.9, 0.95, 0.98]);
    const truth = (sens * prev) / (sens * prev + (1 - spec) * (1 - prev));
    return {
      title: 'Positive test',
      html: `A condition affects <b>${pct(prev, 1)}</b> of people. A test catches <b>${pct(sens, 0)}</b> of real cases (sensitivity) and correctly clears <b>${pct(spec, 0)}</b> of healthy people (specificity). Someone tests positive.<span class="q">What is the probability they actually have it?</span>`,
      truth,
      explain: `P(D|+) = sens×prev ÷ (sens×prev + (1−spec)×(1−prev)) = <code>${(sens * prev).toFixed(4)}</code> ÷ (<code>${(sens * prev).toFixed(4)}</code> + <code>${((1 - spec) * (1 - prev)).toFixed(4)}</code>). Low base rates make most positives false: this is base-rate neglect.`,
    };
  },
  coin() {
    const prior = pick([0.1, 0.2, 0.5]), ph = 0.8, n = ri(5, 8);
    const biased = Math.random() < prior;
    const flips = Array.from({ length: n }, () => (Math.random() < (biased ? ph : 0.5) ? 'h' : 't'));
    const h = flips.filter((f) => f === 'h').length, t = n - h;
    const lb = ph ** h * (1 - ph) ** t, lf = 0.5 ** n;
    const truth = (prior * lb) / (prior * lb + (1 - prior) * lf);
    return {
      title: 'Loaded coin',
      html: `A bag has coins where <b>${pct(prior, 0)}</b> are loaded to land heads 80% of the time; the rest are fair. You pull one out and flip it ${n} times:
        <span class="tokens">${flips.map((f) => `<i class="tok-${f}">${f.toUpperCase()}</i>`).join('')}</span><span class="q">What is the probability this coin is loaded?</span>`,
      truth,
      explain: `Loaded likelihood 0.8<sup>${h}</sup>×0.2<sup>${t}</sup> = <code>${lb.toExponential(2)}</code>; fair 0.5<sup>${n}</sup> = <code>${lf.toExponential(2)}</code>. Posterior = ${prior}×L ÷ (${prior}×L + ${(1 - prior).toFixed(1)}×F).`,
    };
  },
  dice() {
    if (Math.random() < 0.5) {
      const k = ri(8, 11); let c = 0; for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) if (a + b >= k) c++;
      return { title: 'Two dice', html: `You roll two fair six-sided dice.<span class="q">What is the probability the total is ${k} or more?</span>`, truth: c / 36, explain: `Count the outcomes: ${c} of 36 combinations sum to ${k}+, so ${c}/36.` };
    }
    const n = pick([2, 3, 4, 6]);
    return { title: 'At least one six', html: `You roll a fair die ${n} times.<span class="q">What is the probability you see at least one six?</span>`, truth: 1 - (5 / 6) ** n, explain: `Use the complement: 1 − (5/6)<sup>${n}</sup> = <code>${(1 - (5 / 6) ** n).toFixed(4)}</code>.` };
  },
  birthday() {
    const n = pick([10, 15, 23, 30, 40]); let p = 1; for (let i = 0; i < n; i++) p *= (365 - i) / 365;
    return { title: 'Shared birthday', html: `There are ${n} people in a room (365 equally likely birthdays, no leap years).<span class="q">What is the probability at least two share a birthday?</span>`, truth: 1 - p, explain: `1 − (365/365 × 364/365 × … × ${366 - n}/365) = <code>${(1 - p).toFixed(4)}</code>. The number of pairs, ${n * (n - 1) / 2}, grows much faster than the number of people.` };
  },
  cards() {
    if (Math.random() < 0.5) return { title: 'Two aces', html: 'You draw two cards from a shuffled 52-card deck without replacement.<span class="q">What is the probability both are aces?</span>', truth: (4 / 52) * (3 / 51), explain: '4/52 × 3/51 = 12/2652 ≈ <code>0.0045</code>.' };
    return { title: 'At least one heart', html: 'You draw two cards from a shuffled 52-card deck without replacement.<span class="q">What is the probability at least one is a heart?</span>', truth: 1 - (39 / 52) * (38 / 51), explain: 'Complement: 1 − (39/52 × 38/51) ≈ <code>0.4412</code>.' };
  },
  binomial() {
    const n = pick([5, 6, 8, 10]), k = ri(Math.ceil(n / 2), n - 1), p = 0.5;
    let s = 0; for (let j = k; j <= n; j++) s += binom(n, j) * p ** n;
    return { title: 'Coin streaks', html: `A fair coin is flipped ${n} times.<span class="q">What is the probability of at least ${k} heads?</span>`, truth: s, explain: `Sum of C(${n}, j)/2<sup>${n}</sup> for j = ${k}…${n} = <code>${s.toFixed(4)}</code>.` };
  },
  monty() {
    const doors = pick([3, 4]);
    const truth = doors === 3 ? 2 / 3 : 3 / 8;
    return { title: 'Game show', html: `There are ${doors} doors with a car behind one. You pick a door. The host, who knows where the car is, opens a different door that has no car. You switch to ${doors === 3 ? 'the other closed door' : 'one of the two other closed doors, chosen at random'}.<span class="q">What is the probability you win the car?</span>`, truth, explain: doors === 3 ? 'Your first pick is right 1/3 of the time, so switching wins 2/3.' : 'Your first pick is wrong 3/4 of the time; then the car is behind one of 2 remaining doors: 3/4 × 1/2 = 3/8.' };
  },
};
const B = { cases: [], i: 0, score: 0, results: [], cur: null, locked: false };
function newBayes() {
  const keys = Object.keys(CASES), order = [];
  while (order.length < 10) { const k = pick(keys); if (order[order.length - 1] !== k) order.push(k); }
  Object.assign(B, { order, i: 0, score: 0, results: [], locked: false });
  $('bFinal').hidden = true;
  nextCase();
}
function nextCase() {
  if (B.i >= 10) return finishBayes();
  B.cur = CASES[B.order[B.i]]();
  B.locked = false;
  $('bTitle').textContent = `Case ${B.i + 1} · ${B.cur.title}`;
  $('bScenario').innerHTML = B.cur.html;
  $('bEst').value = 50; $('bEstLbl').textContent = '50%';
  $('bAnswer').hidden = true; $('bNext').hidden = true; $('bSubmit').hidden = false; $('bEst').disabled = false;
  $('bCount').textContent = `${B.i} / 10 cases`;
}
function submitCase() {
  if (B.locked) return;
  B.locked = true;
  const est = Number($('bEst').value) / 100, t = B.cur.truth, err = est - t;
  const pts = Math.round(100 * Math.max(0, 1 - (err / 0.3) ** 2));
  B.score += pts; B.results.push({ est, t, pts });
  $('bScore').textContent = `Score ${B.score}`;
  $('bAnswer').innerHTML = `<div class="big">${pct(t, 1)}</div>You said ${pct(est, 0)} · <b style="color:${pts > 80 ? C.ok : pts > 40 ? C.warn : C.accent}">+${pts} points</b><br>${B.cur.explain}`;
  $('bAnswer').hidden = false; $('bSubmit').hidden = true; $('bNext').hidden = false; $('bEst').disabled = true;
  $('bNext').textContent = B.i === 9 ? 'See results →' : 'Next case →';
  B.i++; $('bCount').textContent = `${B.i} / 10 cases`;
  drawCalib();
  $('bNext').focus();
}
function finishBayes() {
  const best = store.get('qg-bayes-best', 0);
  if (B.score > best) store.set('qg-bayes-best', B.score);
  const mae = B.results.reduce((s, r) => s + Math.abs(r.est - r.t), 0) / B.results.length;
  const overconf = B.results.filter((r) => (r.est - 0.5) * (r.t - 0.5) >= 0 && Math.abs(r.est - 0.5) > Math.abs(r.t - 0.5) + 0.1).length;
  $('bFinal').innerHTML = `<p class="read"><b>${B.score} / 1000</b> (best ${Math.max(best, B.score)}). Average error ${pct(mae, 1)}. ${overconf >= 4 ? 'You tended to be <b>overconfident</b>, pushing estimates further from 50% than the evidence supported.' : mae < 0.08 ? 'Well calibrated.' : 'Watch for base rates: they matter more than intuition suggests.'}</p><button class="btn btn-solid" id="bAgain">Ten new cases</button>`;
  $('bFinal').hidden = false;
  $('bAgain').addEventListener('click', newBayes);
  $('bNext').hidden = true;
  $('bTitle').textContent = 'Case file closed';
  $('bScenario').innerHTML = 'All ten cases scored. Start a new set from the panel on the right.';
}
function drawCalib() {
  const cv = $('bChart'); if (!cv.clientWidth) return;
  const { ctx, w, h } = fit(cv);
  ctx.clearRect(0, 0, w, h);
  const s = Math.min(w, h) - 40, ox = (w - s) / 2 + 10, oy = 10;
  const X = (v) => ox + v * s, Y = (v) => oy + (1 - v) * s;
  ctx.strokeStyle = C.grid;
  for (let i = 0; i <= 4; i++) { const v = i / 4; ctx.beginPath(); ctx.moveTo(X(v), Y(0)); ctx.lineTo(X(v), Y(1)); ctx.stroke(); ctx.beginPath(); ctx.moveTo(X(0), Y(v)); ctx.lineTo(X(1), Y(v)); ctx.stroke(); }
  ctx.fillStyle = 'rgba(143,209,138,.06)'; ctx.beginPath(); ctx.moveTo(X(0), Y(0.15)); ctx.lineTo(X(0.85), Y(1)); ctx.lineTo(X(1), Y(1)); ctx.lineTo(X(1), Y(0.85)); ctx.lineTo(X(0.15), Y(0)); ctx.lineTo(X(0), Y(0)); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = C.muted; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(1), Y(1)); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = C.faint; ctx.textBaseline = 'top';
  ctx.fillText('true probability →', X(0.55), Y(0) + 6);
  ctx.save(); ctx.translate(X(0) - 14, Y(0.25)); ctx.rotate(-Math.PI / 2); ctx.fillText('your estimate →', 0, 0); ctx.restore();
  B.results.forEach((r, i) => {
    ctx.fillStyle = r.pts > 80 ? C.ok : r.pts > 40 ? C.warn : C.accent;
    ctx.beginPath(); ctx.arc(X(r.t), Y(r.est), 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#111'; ctx.textBaseline = 'middle'; ctx.fillText(String(i + 1), X(r.t) - (i >= 9 ? 6 : 3), Y(r.est));
  });
}
$('bEst').addEventListener('input', () => ($('bEstLbl').textContent = $('bEst').value + '%'));
$('bSubmit').addEventListener('click', submitCase);
$('bNext').addEventListener('click', nextCase);

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const GEN = [
  () => { const a = ri(12, 99), b = ri(3, 19); return { tag: 'Multiply', q: `${a} × ${b}`, a: a * b }; },
  () => { const a = ri(11, 49), b = ri(11, 39); return { tag: 'Multiply', q: `${a} × ${b}`, a: a * b }; },
  () => { const x = pick([5, 12.5, 15, 20, 25, 35, 40, 60, 75, 120]), y = pick([40, 64, 80, 120, 240, 360, 480, 800]); return { tag: 'Percent', q: `${x}% of ${y}`, a: (x * y) / 100 }; },
  () => { const d = pick([8, 16, 3, 6, 7, 9, 11, 12]); let n = ri(1, d - 1); while (gcd(n, d) !== 1) n = ri(1, d - 1); return { tag: 'Fraction → decimal (2 dp)', q: `${n} / ${d}`, a: n / d, tol: 0.006 }; },
  () => { const n = ri(13, 35); return { tag: 'Square', q: `${n}²`, a: n * n }; },
  () => { const n = pick([4, 6, 8, 10, 12, 20]); return { tag: 'Expected value', q: `Expected value of one roll of a fair ${n}-sided die`, a: (n + 1) / 2 }; },
  () => { const k = pick([2, 3]); return { tag: 'Expected value', q: `Expected sum of ${k} fair six-sided dice`, a: 3.5 * k }; },
  () => { const n = ri(5, 10), k = ri(2, Math.min(4, n - 1)); return { tag: 'Combinatorics', q: `${n} choose ${k}`, a: binom(n, k) }; },
  () => { const b = ri(3, 17), a = b * ri(6, 40); return { tag: 'Divide', q: `${a} ÷ ${b}`, a: a / b }; },
  () => { const a = ri(1001, 9999), b = ri(101, 999); return { tag: 'Subtract', q: `${a} − ${b}`, a: a - b }; },
  () => { const s = ri(2, 9), d = ri(3, 12), seq = [0, 1, 2, 3].map((i) => s + i * d); return { tag: 'Next term', q: `${seq.join(', ')}, …`, a: s + 4 * d }; },
  () => { const s = ri(1, 4), r = pick([2, 3]), seq = [0, 1, 2, 3].map((i) => s * r ** i); return { tag: 'Next term', q: `${seq.join(', ')}, …`, a: s * r ** 4 }; },
  () => { const n = pick([2, 3, 4]); return { tag: 'Probability (2 dp)', q: `P(all heads) in ${n} fair coin flips`, a: 0.5 ** n, tol: 0.006 }; },
  () => { const k = pick([1, 2, 3, 4]); return { tag: 'Probability (2 dp)', q: `P(roll ≤ ${k}) on a fair die`, a: k / 6, tol: 0.006 }; },
  () => { const p = pick([0.2, 0.25, 0.4, 0.5]), win = pick([10, 20, 50, 100]), cost = pick([2, 5, 10]); return { tag: 'Expected value', q: `A bet costs $${cost} and pays $${win} with probability ${p}. Expected profit in $?`, a: p * win - cost }; },
];
const S = { running: false, t: 60, score: 0, streak: 0, cur: null, timer: 0, best: store.get('qg-sprint-best', 0) };
$('sBest').textContent = S.best;
function parseAns(s) {
  s = s.trim().replace(/,/g, '').replace(/%$/, '').replace(/^\$/, '');
  if (/^-?\d+(\.\d+)?\s*\/\s*\d+(\.\d+)?$/.test(s)) { const [a, b] = s.split('/').map(Number); return a / b; }
  return s === '' ? NaN : Number(s);
}
function nextQ() {
  let q; do q = pick(GEN)(); while (S.cur && q.q === S.cur.q);
  S.cur = q;
  $('sQ').innerHTML = `<small>${q.tag}</small>${q.q}`;
  $('sInput').value = ''; $('sInput').focus();
}
function startSprint() {
  Object.assign(S, { running: true, t: 60, score: 0, streak: 0, cur: null });
  $('sInput').disabled = false; $('sSkip').disabled = false; $('sGo').textContent = 'Submit';
  $('sHist').innerHTML = ''; $('sFeed').textContent = '';
  updSprint(); nextQ();
  clearInterval(S.timer);
  S.timer = setInterval(() => { S.t -= 1; updSprint(); if (S.t <= 0) endSprint(); }, 1000);
}
function endSprint() {
  clearInterval(S.timer); S.running = false;
  $('sInput').disabled = true; $('sSkip').disabled = true; $('sGo').textContent = 'Again';
  const nb = S.score > S.best; if (nb) { S.best = S.score; store.set('qg-sprint-best', S.best); $('sBest').textContent = S.best; }
  $('sQ').innerHTML = `<small>Time</small>${S.score} correct${nb ? ' · new best' : ''}`;
  $('sFeed').textContent = S.score >= 20 ? 'Trading-desk ready.' : S.score >= 12 ? 'Solid. Practice the fractions and squares.' : 'Warm-up done. Run it again.';
  $('sFeed').style.color = C.muted;
}
function updSprint() { $('sTime').textContent = S.t; $('sScore').textContent = S.score; $('sStreak').textContent = S.streak; $('sTime').className = S.t <= 10 ? 'down' : ''; }
function hist(q, given, ok) {
  const li = document.createElement('li');
  li.innerHTML = `<span>${q.q}</span><span class="${ok ? 'up' : 'down'}">${ok ? '✓' : given} ${ok ? '' : '→ ' + (+q.a.toFixed(4))}</span>`;
  $('sHist').prepend(li);
}
$('sForm').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!S.running) return startSprint();
  const v = parseAns($('sInput').value); if (isNaN(v)) return;
  const ok = Math.abs(v - S.cur.a) <= (S.cur.tol || 1e-6);
  if (ok) { S.score += 1; S.streak += 1; $('sFeed').textContent = S.streak >= 5 ? `Streak ${S.streak}` : 'Correct'; $('sFeed').style.color = C.ok; hist(S.cur, v, true); nextQ(); }
  else { S.streak = 0; $('sFeed').textContent = 'Not quite. Try again or skip.'; $('sFeed').style.color = C.accent; $('sInput').select(); }
  updSprint();
});
$('sSkip').addEventListener('click', () => { if (!S.running) return; S.streak = 0; hist(S.cur, 'skip', false); nextQ(); updSprint(); });

window.addEventListener('keydown', (e) => {
  const pane = document.querySelector('[data-pane]:not([hidden])')?.dataset.pane;
  if (pane === 'kelly' && e.key === ' ' && document.activeElement?.tagName !== 'BUTTON') { e.preventDefault(); kellyStep(); }
  if (pane === 'bayes' && e.key === 'Enter' && document.activeElement?.tagName !== 'BUTTON') { e.preventDefault(); B.locked ? nextCase() : submitCase(); }
});
window.addEventListener('resize', () => { drawKelly(); drawCalib(); });

$('totalChip').textContent = `Sprint best ${S.best}`;
newKelly(); newBayes();
setMode(['kelly', 'bayes', 'sprint'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'kelly');
