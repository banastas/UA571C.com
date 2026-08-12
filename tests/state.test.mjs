import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initialState,
  cycleOption,
  selectOption,
  canFire,
  fireRound,
  cool,
  ceaseFire,
  reload,
  secondsRemaining,
  isCritical,
  MAX_AMMO,
  CYCLIC_RATE_RPM,
  CRITICAL_ROUNDS
} from '../src/state.mjs';

test('initial state matches the reference terminal defaults', () => {
  const state = initialState();
  assert.equal(state.mode, 'AUTO-REMOTE');
  assert.equal(state.weapon, 'SAFE');
  assert.equal(state.iff, 'SEARCH');
  assert.equal(state.ammo, 500);
  assert.equal(secondsRemaining(state), '33.33');
});

test('selectors cycle and wrap', () => {
  let state = initialState();
  state = cycleOption(state, 'mode');
  assert.equal(state.mode, 'MAN-OVERRIDE');
  state = cycleOption(state, 'mode');
  state = cycleOption(state, 'mode');
  assert.equal(state.mode, 'AUTO-REMOTE');
});

test('invalid selections are ignored', () => {
  const state = initialState();
  assert.strictEqual(selectOption(state, 'weapon', 'BROKEN'), state);
  assert.strictEqual(cycleOption(state, 'missing'), state);
});

test('safe weapon cannot fire', () => {
  const state = initialState();
  assert.deepEqual(canFire(state), { ok: false, reason: 'WEAPON SAFE // ARM SYSTEM' });
  const next = fireRound(state);
  assert.equal(next.ammo, 500);
  assert.equal(next.firing, false);
});

test('armed weapon consumes ammunition and engages IFF', () => {
  const state = selectOption(initialState(), 'weapon', 'ARMED');
  const next = fireRound(state, 4);
  assert.equal(next.ammo, 496);
  assert.equal(next.rpm, CYCLIC_RATE_RPM);
  assert.equal(next.firing, true);
  assert.equal(next.iff, 'ENGAGED');
});

test('ammunition never drops below zero and empty state cuts fire', () => {
  const state = { ...initialState(), weapon: 'ARMED', ammo: 2 };
  const next = fireRound(state, 9);
  assert.equal(next.ammo, 0);
  assert.equal(next.firing, false);
  assert.equal(next.fault, 'AMMUNITION DEPLETED');
});

test('thermal cutoff prevents further firing', () => {
  const state = { ...initialState(), weapon: 'ARMED', temperature: 99.9 };
  const next = fireRound(state);
  assert.equal(next.temperature, 100);
  assert.equal(next.firing, false);
  assert.equal(next.fault, 'THERMAL CUTOFF');
});

test('cool, cease and reload restore stable state', () => {
  const hot = { ...initialState(), weapon: 'ARMED', ammo: 12, temperature: 80, firing: true, rpm: CYCLIC_RATE_RPM, fault: 'TEST' };
  assert.equal(cool(hot, 5).temperature, 75);
  assert.equal(ceaseFire(hot).rpm, 0);
  const fresh = reload(hot);
  assert.equal(fresh.ammo, MAX_AMMO);
  assert.equal(fresh.temperature, 18);
  assert.equal(fresh.fault, null);
});

test('film countdown and critical threshold match captured frames', () => {
  assert.equal(secondsRemaining({ ...initialState(), ammo: 65 }), '4.33');
  assert.equal(secondsRemaining({ ...initialState(), ammo: 46 }), '3.07');
  assert.equal(isCritical({ ...initialState(), ammo: CRITICAL_ROUNDS + 1 }), false);
  assert.equal(isCritical({ ...initialState(), ammo: CRITICAL_ROUNDS }), true);
  assert.equal(isCritical({ ...initialState(), ammo: 10 }), true);
  assert.equal(isCritical({ ...initialState(), ammo: 0 }), false);
});

test('a full drum can reach the film critical state without thermal cutoff', () => {
  const state = { ...initialState(), weapon: 'ARMED' };
  const next = fireRound(state, 450);
  assert.equal(next.ammo, 50);
  assert.ok(next.temperature > 89 && next.temperature < 90);
  assert.equal(next.firing, true);
  assert.equal(next.fault, null);
});
