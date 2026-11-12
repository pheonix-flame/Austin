export const STAND = 0, CROUCH = 1, PRONE = 2;
export const EYE = [1.6, 1.08, 0.42];
export const SPEED = [1, 0.55, 0.28];
export const SPREAD = [1, 0.75, 0.55];
export const NAMES = ['Standing', 'Crouched', 'Prone'];

export function createStance() { return { s: STAND, eye: EYE[0], slideT: 0, slideV: 0, dx: 0, dz: 0 }; }

export function stancePress(st, action, ctx) {
  if (action === 'crouch') {
    if (st.s === PRONE) st.s = CROUCH;
    else if (st.s === STAND && ctx.sprinting && ctx.onGround && ctx.moving > 0.5) {
      st.s = CROUCH; st.slideT = 0.8; st.slideV = ctx.speed * 1.75; st.dx = ctx.dx; st.dz = ctx.dz;
    } else st.s = st.s === CROUCH ? STAND : CROUCH;
  } else if (action === 'prone') { st.s = st.s === PRONE ? STAND : PRONE; st.slideT = 0; }
  else if (action === 'jump' && st.s !== STAND) { st.s = st.s === PRONE ? CROUCH : STAND; st.slideT = 0; return true; }
  return false;
}

export function stanceUpdate(st, dt) {
  st.eye += (EYE[st.s] - st.eye) * Math.min(1, dt * 10);
  if (st.slideT > 0) {
    st.slideT -= dt;
    const v = st.slideV; st.slideV *= Math.max(0, 1 - dt * 1.8);
    return { x: st.dx * v * dt, z: st.dz * v * dt };
  }
  return null;
}
