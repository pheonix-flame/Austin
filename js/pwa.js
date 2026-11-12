const root = new URL('../', import.meta.url);
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  window.addEventListener('load', () => navigator.serviceWorker.register(new URL('sw.js', root), { scope: root.pathname }).catch(() => {}));
}

const bar = document.querySelector('.topbar');
const isGame = !!bar && !!document.querySelector('link[rel="manifest"]');
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let deferred = null, btn = null, tip = null;

if (isGame && !standalone) {
  btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'about-btn install-btn'; btn.hidden = true;
  btn.innerHTML = '<span class="full">Install app</span><span class="short" aria-hidden="true">⤓</span>';
  btn.setAttribute('aria-label', 'Install this game as an app');
  bar.insertBefore(btn, bar.children[1] || null);
  tip = document.createElement('div');
  tip.className = 'install-tip'; tip.hidden = true;
  tip.innerHTML = 'Tap <b>Share</b> <span aria-hidden="true">⬆</span>, then <b>Add to Home Screen</b>. The game opens full screen from your home screen and works offline.';
  document.body.appendChild(tip);
  if (ios) btn.hidden = false;
  btn.addEventListener('click', async () => {
    if (deferred) { deferred.prompt(); await deferred.userChoice.catch(() => {}); deferred = null; btn.hidden = true; return; }
    if (ios) tip.hidden = !tip.hidden;
  });
  document.addEventListener('pointerdown', (e) => { if (!tip.hidden && !e.target.closest('.install-tip, .install-btn')) tip.hidden = true; });
}
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  if (!btn) return;
  deferred = e; btn.hidden = false;
});
window.addEventListener('appinstalled', () => { deferred = null; if (btn) btn.hidden = true; });
