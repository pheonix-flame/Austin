import { BUILDS } from './builds.js';

const id = document.body.dataset.game;
const b = BUILDS[id];
if (b) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const btn = document.createElement('button');
  btn.className = 'about-btn'; btn.type = 'button';
  btn.innerHTML = '<span class="full">How it’s built</span><span class="short" aria-hidden="true">i</span>';
  btn.setAttribute('aria-label', 'How it’s built');
  const bar = document.querySelector('.topbar');
  bar.insertBefore(btn, bar.children[1] || null);

  const ov = document.createElement('div');
  ov.className = 'overlay about'; ov.hidden = true;
  ov.innerHTML = `<div class="panel panel-wide" role="dialog" aria-label="How it's built">
    <div class="about-head"><div><p class="kicker">How it’s built</p><h2>${esc(b.title)}</h2></div><button class="close-x" type="button" aria-label="Close">Close</button></div>
    <p>${esc(b.summary)}</p>
    <dl class="about-list">${b.points.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    <ul class="about-chips">${b.tech.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
    <p class="about-foot">Plain JavaScript modules, no frameworks and no build step. Designed and built by Austin Okezie.</p>
  </div>`;
  document.body.appendChild(ov);
  const open = () => { ov.hidden = false; window.dispatchEvent(new Event('aboutopen')); ov.querySelector('.close-x').focus(); };
  const close = () => { ov.hidden = true; window.dispatchEvent(new Event('aboutclose')); };
  btn.addEventListener('click', open);
  ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('.close-x')) close(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !ov.hidden) close(); });
}
