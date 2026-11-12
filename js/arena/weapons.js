export const WEAPONS = {
  pistol: { name: 'Pistol', dmg: 24, head: 1.8, pellets: 1, rate: 5, auto: false, mag: 12, reserve: 36, reload: 1.2, hip: 0.018, ads: 0.006, adsTime: 0.12, zoom: 1.15, range: [15, 40, 0.6], move: 1.5, kick: 0.035, color: 0x2a2a2e,
    blurb: 'Sidearm. Always with you.' },
  smg: { name: 'SMG', dmg: 19, head: 1.6, pellets: 1, rate: 12, auto: true, mag: 30, reserve: 90, reload: 1.7, hip: 0.03, ads: 0.018, adsTime: 0.13, zoom: 1.25, range: [10, 35, 0.4], move: 1.2, kick: 0.018, color: 0x3c4a5a,
    blurb: 'Very fast fire and quick to aim. Damage drops off hard at range.' },
  ar: { name: 'Assault rifle', dmg: 25, head: 1.8, pellets: 1, rate: 9, auto: true, mag: 30, reserve: 90, reload: 2.0, hip: 0.035, ads: 0.005, adsTime: 0.22, zoom: 1.6, range: [30, 80, 0.7], move: 1.6, kick: 0.028, color: 0x4b463f,
    blurb: 'Medium fire rate, stays accurate at long range when aimed.' },
  shotgun: { name: 'Shotgun', dmg: 15, head: 1.4, pellets: 8, rate: 1.1, auto: false, mag: 6, reserve: 18, reload: 2.4, hip: 0.075, ads: 0.055, adsTime: 0.18, zoom: 1.15, range: [5, 22, 0.1], move: 1.1, kick: 0.12, color: 0x5a3b2a,
    blurb: 'Eight pellets. Deletes people up close, useless at range.' },
  sniper: { name: 'Sniper rifle', dmg: 95, head: 2.2, pellets: 1, rate: 0.8, auto: false, mag: 5, reserve: 15, reload: 2.6, hip: 0.14, ads: 0, adsTime: 0.45, zoom: 4.5, range: [300, 400, 1], move: 3, kick: 0.15, color: 0x2f3b2c, scope: true,
    blurb: 'One-shot headshots at any range. Slow to aim; hip fire is wildly inaccurate.' },
};
export const PRIMARIES = ['smg', 'ar', 'shotgun', 'sniper'];

export function falloff(w, dist) {
  const [r0, r1, min] = w.range;
  if (dist <= r0) return 1;
  if (dist >= r1) return min;
  return 1 + (min - 1) * ((dist - r0) / (r1 - r0));
}
