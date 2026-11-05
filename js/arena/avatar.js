/* Third-person soldier used for other players and bots. */
import * as THREE from 'three';

const cap = new THREE.CapsuleGeometry(0.5, 1, 4, 10), sph = new THREE.SphereGeometry(1, 16, 12), box = new THREE.BoxGeometry(1, 1, 1);
const skinTones = [0x8d5524, 0xc68642, 0x5c3a21, 0xe0ac69, 0x3b2219];
const GUN_LEN = { pistol: 0.25, smg: 0.45, ar: 0.7, shotgun: 0.75, sniper: 1.05 };

export function makeSoldier(color) {
  const g = new THREE.Group();
  const kit = new THREE.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.8 });
  const vest = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
  const skin = new THREE.MeshStandardMaterial({ color: skinTones[Math.floor(Math.random() * skinTones.length)], roughness: 0.7 });
  const gunMat = new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.5, metalness: 0.5 });
  const part = (geo, mat, s, p, parent = g) => { const m = new THREE.Mesh(geo, mat); m.scale.set(...s); m.position.set(...p); m.castShadow = true; parent.add(m); return m; };
  const legs = [-1, 1].map((sx) => { const hip = new THREE.Group(); hip.position.set(sx * 0.13, 0.9, 0); g.add(hip); part(cap, kit, [0.2, 0.45, 0.2], [0, -0.45, 0], hip); part(box, kit, [0.16, 0.1, 0.3], [0, -0.88, 0.06], hip); return hip; });
  const torso = new THREE.Group(); torso.position.y = 0.95; g.add(torso);
  part(box, vest, [0.5, 0.6, 0.3], [0, 0.3, 0], torso);
  part(box, kit, [0.52, 0.12, 0.32], [0, 0.02, 0], torso);
  const head = new THREE.Group(); head.position.y = 0.72; torso.add(head);
  part(sph, skin, [0.15, 0.17, 0.16], [0, 0, 0], head);
  part(new THREE.SphereGeometry(1, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), vest, [0.18, 0.15, 0.19], [0, 0.03, 0], head);
  part(box, new THREE.MeshStandardMaterial({ color: 0x0b0d10, roughness: 0.2, metalness: 0.6 }), [0.22, 0.06, 0.05], [0, 0.03, 0.14], head);
  const arms = new THREE.Group(); arms.position.set(0, 0.48, 0.05); torso.add(arms);
  part(cap, vest, [0.13, 0.32, 0.13], [-0.2, -0.05, 0.18], arms).rotation.x = -1.3;
  part(cap, vest, [0.13, 0.32, 0.13], [0.2, -0.05, 0.18], arms).rotation.x = -1.3;
  const gun = part(box, gunMat, [0.07, 0.1, 0.6], [0, -0.02, 0.45], arms);
  g.userData = { legs, torso, head, arms, gun, vest, phase: Math.random() * 6 };
  return g;
}

export function setSoldierWeapon(s, w) {
  const L = GUN_LEN[w] || 0.5, gun = s.userData.gun;
  gun.scale.z = L; gun.position.z = 0.2 + L / 2;
}

export function animateSoldier(s, speed, dt, pitch, alive, stance = 0) {
  const u = s.userData;
  if (!alive) { s.rotation.x = Math.min(Math.PI / 2, s.rotation.x + dt * 6); return; }
  // stance: 0 stand, 1 crouch (lower torso, bent legs), 2 prone (lying forward)
  u.pose = (u.pose ?? 0) + ((stance === 2 ? 1 : 0) - (u.pose ?? 0)) * Math.min(1, dt * 8);
  u.crouch = (u.crouch ?? 0) + ((stance === 1 ? 1 : 0) - (u.crouch ?? 0)) * Math.min(1, dt * 10);
  s.rotation.x = u.pose * Math.PI / 2;
  s.position.y += u.pose * 0.18;
  u.legs.forEach((l) => (l.scale.y = 1 - 0.35 * u.crouch));
  u.phase += dt * (2 + speed * 1.6);
  const sw = Math.sin(u.phase) * Math.min(1, speed / 4) * 0.6;
  u.legs[0].rotation.x = sw; u.legs[1].rotation.x = -sw;
  u.torso.position.y = 0.95 - 0.38 * u.crouch + Math.abs(Math.sin(u.phase)) * 0.03 * Math.min(1, speed / 3);
  u.legs.forEach((l) => (l.position.y = 0.9 - 0.3 * u.crouch));
  u.arms.rotation.x = -pitch * 0.8; u.head.rotation.x = -pitch * 0.5;
}
