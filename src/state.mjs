export const OPTIONS = Object.freeze({
  mode: ['AUTO-REMOTE', 'MAN-OVERRIDE', 'SEMI-AUTO'],
  weapon: ['SAFE', 'ARMED'],
  iff: ['SEARCH', 'TEST', 'ENGAGED', 'INTERROGATE'],
  test: ['AUTO', 'SELECTIVE'],
  targetProfile: ['SOFT', 'SEMIHARD', 'HARD'],
  spectralProfile: ['BIO', 'INERT'],
  targetSelect: ['MULTI SPEC', 'INFRA RED', 'UV']
});

export const MAX_AMMO = 500;
export const EFFECTIVE_ROUNDS_PER_SECOND = 15;
export const CYCLIC_RATE_RPM = EFFECTIVE_ROUNDS_PER_SECOND * 60;
export const CRITICAL_ROUNDS = 50;

export function initialState() {
  return {
    mode: OPTIONS.mode[0],
    weapon: OPTIONS.weapon[0],
    iff: OPTIONS.iff[0],
    test: OPTIONS.test[0],
    targetProfile: OPTIONS.targetProfile[0],
    spectralProfile: OPTIONS.spectralProfile[0],
    targetSelect: OPTIONS.targetSelect[0],
    ammo: MAX_AMMO,
    temperature: 18,
    rpm: 0,
    firing: false,
    autoEngage: false,
    sound: true,
    testRunning: false,
    fault: null
  };
}

export function cycleOption(state, key) {
  const values = OPTIONS[key];
  if (!values) return state;
  const index = values.indexOf(state[key]);
  return { ...state, [key]: values[(index + 1) % values.length] };
}

export function selectOption(state, key, value) {
  const values = OPTIONS[key];
  if (!values?.includes(value)) return state;
  return { ...state, [key]: value };
}

export function canFire(state) {
  if (state.weapon !== 'ARMED') return { ok: false, reason: 'WEAPON SAFE // ARM SYSTEM' };
  if (state.testRunning) return { ok: false, reason: 'TEST ROUTINE ACTIVE' };
  if (state.ammo <= 0) return { ok: false, reason: 'AMMUNITION DEPLETED' };
  if (state.temperature >= 100) return { ok: false, reason: 'THERMAL CUTOFF' };
  return { ok: true, reason: null };
}

export function fireRound(state, count = 1) {
  const permission = canFire(state);
  if (!permission.ok) return { ...state, firing: false, rpm: 0, fault: permission.reason };
  const rounds = Math.max(1, Math.floor(count));
  const ammo = Math.max(0, state.ammo - rounds);
  // The film gauge climbs rapidly under sustained fire, then stabilizes just
  // below the top of the scale instead of rising linearly with every round.
  const temperature = state.temperature < 90
    ? 90 - (90 - state.temperature) * Math.pow(0.986, rounds)
    : Math.min(100, state.temperature + rounds * 0.12);
  const empty = ammo === 0;
  const cutoff = temperature >= 100;
  return {
    ...state,
    ammo,
    temperature,
    rpm: empty || cutoff ? 0 : CYCLIC_RATE_RPM,
    firing: !empty && !cutoff,
    iff: 'ENGAGED',
    fault: empty ? 'AMMUNITION DEPLETED' : cutoff ? 'THERMAL CUTOFF' : null
  };
}

export function cool(state, amount = 0.45) {
  return {
    ...state,
    temperature: Math.max(18, state.temperature - Math.max(0, amount)),
    rpm: state.firing ? state.rpm : Math.max(0, state.rpm - 180)
  };
}

export function ceaseFire(state) {
  return { ...state, firing: false, rpm: 0 };
}

export function reload(state) {
  return {
    ...state,
    ammo: MAX_AMMO,
    temperature: 18,
    rpm: 0,
    firing: false,
    autoEngage: false,
    fault: null
  };
}

export function secondsRemaining(state) {
  return (state.ammo / EFFECTIVE_ROUNDS_PER_SECOND).toFixed(2);
}

export function isCritical(state) {
  return state.ammo > 0 && state.ammo <= CRITICAL_ROUNDS;
}
