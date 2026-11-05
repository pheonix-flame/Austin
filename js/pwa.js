/* Registers the service worker and shows an "Install app" button where the browser supports it. */
const root = new URL('../', import.meta.url);
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  window.addEventListener('load', () => navigator.serviceWorker.register(new URL('sw.js', root), { scope: root.pathname }).catch(() => {}));
}
let deferred = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); deferred = e;
  document.querySelectorAll('[data-install]').forEach((b) => (b.hidden = false));
});
window.addEventListener('appinstalled', () => { deferred = null; document.querySelectorAll('[data-install]').forEach((b) => (b.hidden = true)); });
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-install]'); if (!b || !deferred) return;
  deferred.prompt(); await deferred.userChoice.catch(() => {}); deferred = null; b.hidden = true;
});
