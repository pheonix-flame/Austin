/* Builds a Faceoff map from data: meshes, 3D colliders (with steps), ray casts and a nav grid for bots. */
import * as THREE from 'three';

export const STEP = 0.65, PLAYER_H = 1.75;

function tex(w, h, draw, rep = [1, 1]) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; t.repeat.set(...rep);
  return t;
}
const noise = (g, w, h, n, a) => { for (let i = 0; i < n; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${Math.random() * a})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); } };

function materials() {
  const ribbed = (base) => tex(128, 128, (g, w, h) => { g.fillStyle = base; g.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 10) { g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x, 0, 3, h); g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(x + 4, 0, 2, h); } noise(g, w, h, 600, 0.1); });
  const brick = tex(128, 128, (g, w, h) => { g.fillStyle = '#6b3d2e'; g.fillRect(0, 0, w, h); g.fillStyle = '#4a2a20'; for (let y = 0; y < h; y += 16) { g.fillRect(0, y, w, 2); for (let x = (y / 16) % 2 ? 0 : 16; x < w; x += 32) g.fillRect(x, y, 2, 16); } noise(g, w, h, 900, 0.12); });
  const crate = tex(64, 64, (g, w, h) => { g.fillStyle = '#8a6a42'; g.fillRect(0, 0, w, h); g.strokeStyle = '#5a4128'; g.lineWidth = 4; g.strokeRect(2, 2, w - 4, h - 4); g.beginPath(); g.moveTo(4, 4); g.lineTo(w - 4, h - 4); g.stroke(); noise(g, w, h, 300, 0.12); });
  const concrete = tex(64, 64, (g, w, h) => { g.fillStyle = '#8c877d'; g.fillRect(0, 0, w, h); noise(g, w, h, 900, 0.12); });
  const steel = tex(64, 64, (g, w, h) => { g.fillStyle = '#4c5258'; g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(0,0,0,.35)'; for (let y = 0; y < h; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); } noise(g, w, h, 500, 0.1); });
  const M = (o) => new THREE.MeshStandardMaterial({ roughness: 0.85, ...o });
  return {
    wall: M({ color: 0x3a3d44 }), brick: M({ map: brick }), crate: M({ map: crate }), concrete: M({ map: concrete }), steel: M({ map: steel, metalness: 0.4, roughness: 0.6 }),
    sand: M({ color: 0x9c8a63 }), car: M({ color: 0x7a2f2f, metalness: 0.5, roughness: 0.4 }),
    c1: M({ map: ribbed('#7a3b2a'), metalness: 0.3 }), c2: M({ map: ribbed('#2f5d6b'), metalness: 0.3 }), c3: M({ map: ribbed('#6b6a2f'), metalness: 0.3 }), c4: M({ map: ribbed('#3d4d3a'), metalness: 0.3 }),
  };
}

export function buildWorld(scene, map, { shadows }) {
  const group = new THREE.Group(); scene.add(group);
  const [W, D] = map.size;
  // sky + fog
  const c = document.createElement('canvas'); c.width = 4; c.height = 256; const g = c.getContext('2d'), grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, map.sky[0]); grd.addColorStop(0.45, map.sky[1]); grd.addColorStop(0.6, map.sky[2]); grd.addColorStop(0.75, map.sky[3]); grd.addColorStop(1, map.sky[3]);
  g.fillStyle = grd; g.fillRect(0, 0, 4, 256);
  const st = new THREE.CanvasTexture(c); st.colorSpace = THREE.SRGBColorSpace; scene.background = st;
  scene.fog = new THREE.Fog(...map.fog);
  // lights
  group.add(new THREE.HemisphereLight(0xcfd8ff, 0x2a2420, 0.8));
  const sun = new THREE.DirectionalLight(0xffd2a8, 1.5); sun.position.set(-30, 50, 20); sun.castShadow = shadows;
  Object.assign(sun.shadow.camera, { left: -55, right: 55, top: 40, bottom: -40, near: 1, far: 140 }); sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0006;
  group.add(sun);
  // ground
  const gt = tex(256, 256, (g2, w, h) => { g2.fillStyle = '#3b3a37'; g2.fillRect(0, 0, w, h); noise(g2, w, h, 4000, 0.12); g2.strokeStyle = 'rgba(0,0,0,.3)'; g2.lineWidth = 2; g2.strokeRect(0, 0, w, h); }, [W / 4, D / 4]);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(W + 60, D + 60), new THREE.MeshStandardMaterial({ map: gt, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; group.add(ground);

  const mats = materials(), boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const boxes = [];
  for (const [x, z, w, d, h, m, y0 = 0] of map.boxes) {
    const mesh = new THREE.Mesh(boxGeo, mats[m] || mats.wall);
    mesh.scale.set(w, h, d); mesh.position.set(x, y0 + h / 2, z); mesh.castShadow = shadows; mesh.receiveShadow = true; group.add(mesh);
    boxes.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, y0, y1: y0 + h });
  }

  /* ---------- physics helpers ---------- */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function collide(p, r, feet) {
    for (const b of boxes) {
      if (b.y0 >= feet + PLAYER_H || b.y1 <= feet + STEP) continue; // above head, or a step we can climb
      const cx = clamp(p.x, b.minX, b.maxX), cz = clamp(p.z, b.minZ, b.maxZ), dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 < 1e-9) { const o = [[b.minX - r - p.x, 0], [b.maxX + r - p.x, 0], [0, b.minZ - r - p.z], [0, b.maxZ + r - p.z]].sort((a, q) => Math.abs(a[0] + a[1]) - Math.abs(q[0] + q[1]))[0]; p.x += o[0]; p.z += o[1]; }
      else { const dd = Math.sqrt(d2); p.x += (dx / dd) * (r - dd); p.z += (dz / dd) * (r - dd); }
    }
    p.x = clamp(p.x, -W / 2 + r, W / 2 - r); p.z = clamp(p.z, -D / 2 + r, D / 2 - r);
  }
  function floorAt(p, r, feet) {
    let f = 0; const s = r * 0.6;
    for (const b of boxes) if (b.y1 <= feet + STEP && p.x > b.minX - s && p.x < b.maxX + s && p.z > b.minZ - s && p.z < b.maxZ + s) f = Math.max(f, b.y1);
    return f;
  }
  function rayBox(o, d, b, tMax) {
    let t0 = 0, t1 = tMax; const mn = [b.minX, b.y0, b.minZ], mx = [b.maxX, b.y1, b.maxZ], os = [o.x, o.y, o.z], ds = [d.x, d.y, d.z];
    for (let a = 0; a < 3; a++) {
      if (Math.abs(ds[a]) < 1e-9) { if (os[a] < mn[a] || os[a] > mx[a]) return Infinity; continue; }
      let ta = (mn[a] - os[a]) / ds[a], tb = (mx[a] - os[a]) / ds[a]; if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) return Infinity;
    }
    return t0;
  }
  function ray(o, d, tMax = 400) {
    let t = tMax; if (d.y < -1e-6) t = Math.min(t, -o.y / d.y);
    for (const b of boxes) { const tb = rayBox(o, d, b, t); if (tb < t) t = tb; }
    return t;
  }
  const _d = new THREE.Vector3();
  function los(a, b) { _d.subVectors(b, a); const L = _d.length(); _d.divideScalar(L); return ray(a, _d, L) >= L - 0.05; }

  /* ---------- nav grid (1 m) for bots ---------- */
  // height = top of the block under the cell centre (stacked blocks included);
  // blocked = something within 0.45 m rises more than a step above that height, below head height.
  const NW = Math.ceil(W), ND = Math.ceil(D), blocked = new Uint8Array(NW * ND), heightAt = new Float32Array(NW * ND);
  for (let j = 0; j < ND; j++) for (let i = 0; i < NW; i++) {
    const x = i - W / 2 + 0.5, z = j - D / 2 + 0.5; let top = 0;
    for (let pass = 0; pass < 2; pass++) for (const b of boxes) if (b.y0 <= top + 0.1 && x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) top = Math.max(top, b.y1);
    let block = false;
    for (const b of boxes) if (x > b.minX - 0.45 && x < b.maxX + 0.45 && z > b.minZ - 0.45 && z < b.maxZ + 0.45 && b.y1 > top + STEP && b.y0 < top + PLAYER_H) { block = true; break; }
    blocked[j * NW + i] = block ? 1 : 0; heightAt[j * NW + i] = top;
  }
  const cell = (x, z) => clamp(Math.floor(x + W / 2), 0, NW - 1) + clamp(Math.floor(z + D / 2), 0, ND - 1) * NW;
  const q = new Int32Array(NW * ND);
  function field(tx, tz, out) {
    out.fill(-1); const s = cell(tx, tz); let h = 0, t = 0; q[t++] = s; out[s] = 0;
    while (h < t) {
      const k = q[h++], i = k % NW, j = (k / NW) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= NW || nj >= ND) continue;
        const nk = nj * NW + ni; if (out[nk] >= 0 || blocked[nk] === 1) continue;
        if (Math.abs(heightAt[nk] - heightAt[k]) > STEP) continue;
        out[nk] = out[k] + 1; q[t++] = nk;
      }
    }
    return out;
  }
  function stepDir(f, x, z, v) {
    const k = cell(x, z), i = k % NW, j = (k / NW) | 0; let best = f[k] < 0 ? 1e9 : f[k], bi = i, bj = j;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ni = i + di, nj = j + dj; if ((!di && !dj) || ni < 0 || nj < 0 || ni >= NW || nj >= ND) continue;
      const nk = nj * NW + ni; if (f[nk] < 0) continue;
      if (di && dj && (f[j * NW + ni] < 0 || f[nj * NW + i] < 0)) continue;
      const val = f[nk] + (di && dj ? 0.4 : 0); if (val < best) { best = val; bi = ni; bj = nj; }
    }
    v.set(bi - W / 2 + 0.5 - x, 0, bj - D / 2 + 0.5 - z); const L = v.length(); if (L > 1e-6) v.divideScalar(L);
    return f[k];
  }
  const newField = () => new Int32Array(NW * ND);

  return { group, boxes, collide, floorAt, ray, los, field, stepDir, newField, size: [W, D] };
}
