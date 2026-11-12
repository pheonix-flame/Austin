const PREFIX = 'aofaceoff1-';
export const QUICK_SLOTS = 6;

function peerOptions() {
  const q = new URLSearchParams(location.search).get('signal');
  if (!q) return { debug: 0 };
  const [host, port, path = '/'] = q.split(':');
  return { host, port: Number(port) || 443, path, secure: location.protocol === 'https:' && host !== 'localhost', debug: 0 };
}
export function roomCode() { const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; return Array.from({ length: 5 }, () => A[Math.floor(Math.random() * A.length)]).join(''); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makePeer(id) {
  return new Promise((resolve, reject) => {
    if (!window.Peer) return reject(new Error('Networking library failed to load'));
    let p;
    try { p = new window.Peer(id, peerOptions()); } catch (e) { return reject(e); }
    const t = setTimeout(() => { p.off('error', onErr); reject(Object.assign(new Error('Could not reach the matchmaking server'), { type: 'timeout' })); try { p.destroy(); } catch {} }, 10000);
    const onErr = (e) => { clearTimeout(t); p.off('error', onErr); reject(e); try { p.destroy(); } catch {} };
    p.on('error', onErr);
    p.once('open', () => { clearTimeout(t); p.off('error', onErr); resolve(p); });
  });
}

export class Net {
  constructor(h) { this.h = h; this.peer = null; this.conns = new Map(); this.hostConn = null; this.isHost = false; this.slot = null; this.closed = false; }

  async host(name) { const p = await makePeer(PREFIX + name); this._serve(p); return name; }
  _serve(p) {
    this.peer = p; this.isHost = true;
    p.on('connection', (conn) => {
      conn.on('open', () => { this.conns.set(conn.peer, conn); this.h.onJoin?.(conn.peer); });
      conn.on('data', (m) => this.h.onMessage?.(conn.peer, m));
      conn.on('close', () => { if (this.conns.delete(conn.peer)) this.h.onLeave?.(conn.peer); });
      conn.on('error', () => {});
    });
    p.on('error', (e) => { if (e.type !== 'peer-unavailable') this.h.onError?.(e); });
    p.on('disconnected', () => { if (!this.closed) try { p.reconnect(); } catch {} });
  }

  async _client() { if (!this.peer || this.peer.destroyed) { this.peer = await makePeer(undefined); this.peer.on('error', () => {}); } return this.peer; }
  _connect(p, target, timeout) {
    return new Promise((resolve, reject) => {
      const conn = p.connect(PREFIX + target, { reliable: true, serialization: 'json' });
      const t = setTimeout(() => { reject(new Error('not found')); try { conn.close(); } catch {} }, timeout);
      conn.on('open', () => { clearTimeout(t); resolve(conn); });
      conn.on('error', () => { clearTimeout(t); reject(new Error('failed')); });
    });
  }
  _adopt(conn) {
    this.hostConn = conn; this.isHost = false;
    conn.on('data', (m) => this.h.onMessage?.('host', m));
    conn.on('close', () => { if (this.hostConn === conn && !this.closed) this.h.onHostLost?.(); });
  }
  async join(name, timeout = 9000) {
    const p = await this._client();
    try { this._adopt(await this._connect(p, name, timeout)); }
    catch { throw new Error('Room not found. Check the code, and that the host still has the game open.'); }
  }

  async quickMatch(exclude = new Set(), onStatus = () => {}) {
    onStatus('Looking for an open lobby…');
    const p = await this._client();
    const slots = [...Array(QUICK_SLOTS).keys()].filter((s) => !exclude.has(s));
    const attempts = slots.map((s) => this._connect(p, 'pub-' + s, 4000).then((conn) => ({ conn, s })));
    const found = await Promise.any(attempts).catch(() => null);
    attempts.forEach((a) => a.then(({ conn }) => { if (!found || conn !== found.conn) conn.close(); }).catch(() => {}));
    if (found) { this.slot = found.s; this._adopt(found.conn); return { role: 'client', slot: found.s }; }
    onStatus('No open lobby yet: opening one and waiting for players…');
    try { this.peer.destroy(); } catch {}
    this.peer = null;
    for (const s of [...Array(QUICK_SLOTS).keys()]) {
      try { await this.host('pub-' + s); this.slot = s; return { role: 'host', slot: s }; }
      catch (e) { if (e.type !== 'unavailable-id') throw e; }
    }
    throw new Error('All public lobbies are busy right now. Try again in a moment, or create a private room.');
  }
  async probeLower() {
    if (!this.slot) return null;
    let tmp;
    try { tmp = await makePeer(undefined); tmp.on('error', () => {}); } catch { return null; }
    const attempts = [...Array(this.slot).keys()].map((s) => this._connect(tmp, 'pub-' + s, 3500).then((conn) => ({ conn, s })));
    const found = await Promise.any(attempts).catch(() => null);
    if (!found) { try { tmp.destroy(); } catch {} return null; }
    try { this.peer.destroy(); } catch {}
    this.conns.clear(); this.peer = tmp; this.slot = found.s; this._adopt(found.conn);
    return found.s;
  }

  send(msg) { if (this.hostConn && this.hostConn.open) this.hostConn.send(msg); }
  sendTo(id, msg) { const c = this.conns.get(id); if (c && c.open) c.send(msg); }
  broadcast(msg) { for (const c of this.conns.values()) if (c.open) c.send(msg); }
  get peerCount() { return this.conns.size; }
  async close() { this.closed = true; try { this.hostConn?.close(); } catch {} for (const c of this.conns.values()) try { c.close(); } catch {} await sleep(50); try { this.peer?.destroy(); } catch {} }
}
