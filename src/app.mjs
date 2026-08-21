import {
  initialState,
  cycleOption,
  selectOption,
  fireRound,
  cool,
  ceaseFire,
  reload,
  secondsRemaining,
  isCritical,
  EFFECTIVE_ROUNDS_PER_SECOND
} from './state.mjs';
import { analytics } from './analytics.mjs';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let state = initialState();
let fireTimer = null;
let autoTimer = null;
let testTimers = [];
let bootTimers = [];
let audioContext = null;
let activeView = 'configuration';
let bootFinished = false;
let firingSession = null;
let fullscreenInputMethod = null;
let lastPortraitState = null;
const startedAt = performance.now();

const screen = $('.screen');
const terminalUi = $('#terminalUi');
const boot = $('#boot');
const helpDialog = $('#helpDialog');
const activityOutput = $('#activityOutput');
const faultFlash = $('#faultFlash');
const configurationView = $('#configurationView');
const telemetryView = $('#telemetryView');
const portraitGate = matchMedia('(orientation: portrait) and (pointer: coarse)');
const coarsePointerGate = matchMedia('(pointer: coarse)');

const sectionMap = {
  mode: '#modeOptions',
  weapon: '#weaponOptions',
  iff: '#iffOptions',
  test: '#testOptions',
  targetProfile: '#targetProfileOptions',
  spectralProfile: '#spectralProfileOptions',
  targetSelect: '#targetSelectOptions'
};

const numberMap = {
  Digit1: 'mode', Digit2: 'weapon', Digit3: 'iff', Digit4: 'test',
  Digit5: 'targetProfile', Digit6: 'spectralProfile', Digit7: 'targetSelect'
};

analytics.initialize({ pagePath: '/' });

function trackFault(message) {
  if (!message) return;
  analytics.trackEvent('terminal_fault', {
    fault_type: String(message).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  });
}

function beep(frequency = 480, duration = 0.045, type = 'square', volume = 0.018) {
  if (!state.sound) return;
  try {
    audioContext ||= new AudioContext();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
    gain.gain.setValueAtTime(volume, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + duration);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + duration);
  } catch {
    // Terminal remains fully functional if audio is unavailable.
  }
}

function announce(message, fault = false) {
  activityOutput.textContent = message;
  screen.classList.toggle('has-fault', fault);
  if (fault) {
    faultFlash.classList.remove('active');
    void faultFlash.offsetWidth;
    faultFlash.classList.add('active');
    beep(110, 0.16, 'sawtooth', 0.025);
  }
}

function updateOptions() {
  Object.entries(sectionMap).forEach(([key, selector]) => {
    $$('#' + selector.slice(1) + ' button').forEach((button) => {
      const selected = button.dataset.value === state[key];
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
  });
}

function showView(view) {
  activeView = view === 'telemetry' ? 'telemetry' : 'configuration';
  configurationView.hidden = activeView !== 'configuration';
  telemetryView.hidden = activeView !== 'telemetry';
  screen.dataset.view = activeView;
  const viewButton = $('[data-command="view"]');
  if (viewButton) viewButton.textContent = `V VIEW: ${activeView === 'configuration' ? 'CONFIG' : 'LIVE'}`;
}

function toggleView(inputMethod = 'pointer') {
  stopFiring('view_changed');
  const nextView = activeView === 'configuration' ? 'telemetry' : 'configuration';
  showView(nextView);
  announce(`${activeView.toUpperCase()} VIEW // LINK D-OK`);
  beep(620);
  analytics.trackEvent('terminal_view_changed', {
    view_name: nextView,
    input_method: inputMethod
  });
}

function render() {
  updateOptions();
  $('#ammoOutput').value = String(state.ammo).padStart(3, '0');
  const remaining = secondsRemaining(state);
  const [wholeSeconds, fractionalSeconds] = remaining.split('.');
  $('#timeWhole').textContent = wholeSeconds;
  $('#timeFraction').textContent = fractionalSeconds;
  $('#timeOutput').setAttribute('aria-label', `${remaining} seconds of ammunition remaining`);
  $('#tempGauge').style.height = `${Math.min(100, state.temperature)}%`;
  $('#rpmGauge').style.height = `${Math.min(100, state.rpm / 36)}%`;
  $('#criticalWarning').hidden = !isCritical(state);
  $('#activityDot').classList.toggle('active', state.firing || state.autoEngage || state.testRunning);
  $('#fireControl').classList.toggle('firing', state.firing);
  $('#engageControl').classList.toggle('selected', state.autoEngage);
  $('#engageControl').textContent = state.autoEngage ? '[ E ] CEASE AUTO' : '[ E ] AUTO ENGAGE';
  $('[data-command="sound"]').textContent = `M SOUND: ${state.sound ? 'ON' : 'OFF'}`;
  screen.classList.toggle('is-firing', state.firing);
  screen.classList.toggle('is-armed', state.weapon === 'ARMED');
  screen.classList.toggle('is-empty', state.ammo === 0);
}

function setState(next, message, isFault = false) {
  state = next;
  if (message) announce(message, isFault);
  render();
}

function choose(key, value, inputMethod = 'pointer') {
  stopFiring('configuration_changed');
  setState(selectOption(state, key, value), `${key.replace(/([A-Z])/g, ' $1').toUpperCase()} // ${value}`);
  beep(720);
  analytics.trackEvent('terminal_configuration_changed', {
    control_name: key,
    selected_value: value.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
    input_method: inputMethod
  });
}

function cycle(key, inputMethod = 'keyboard') {
  stopFiring('configuration_changed');
  showView('configuration');
  const next = cycleOption(state, key);
  setState(next, `${key.replace(/([A-Z])/g, ' $1').toUpperCase()} // ${next[key]}`);
  beep(720);
  analytics.trackEvent('terminal_configuration_changed', {
    control_name: key,
    selected_value: next[key].toLowerCase().replace(/[^a-z0-9]+/g, '_'),
    input_method: inputMethod
  });
}

function fireTick() {
  const next = fireRound(state, 1);
  const blocked = next.fault && !next.firing;
  if (blocked) {
    if (autoTimer) window.clearInterval(autoTimer);
    autoTimer = null;
    setState({ ...next, autoEngage: false }, next.fault, true);
    trackFault(next.fault);
    stopFiring('fault');
    return;
  }
  setState(next, 'TARGET TRACK // AUTOMATIC FIRE');
  beep(78 + Math.random() * 12, 0.035, 'square', 0.028);
}

function startFiring(event, inputMethod = 'pointer', engagementMode = 'manual') {
  event?.preventDefault();
  if (fireTimer || state.testRunning) return;
  const startAmmo = state.ammo;
  if (state.weapon !== 'ARMED') state = selectOption(state, 'weapon', 'ARMED');
  showView('telemetry');
  fireTick();
  if (!state.fault && state.firing) {
    firingSession = { engagementMode, inputMethod, startAmmo };
    analytics.trackEvent('terminal_firing_started', {
      engagement_mode: engagementMode,
      input_method: inputMethod
    });
    fireTimer = window.setInterval(fireTick, 1000 / EFFECTIVE_ROUNDS_PER_SECOND);
  }
}

function stopFiring(reason = 'released') {
  const session = firingSession;
  firingSession = null;
  if (fireTimer) window.clearInterval(fireTimer);
  fireTimer = null;
  if (state.firing || state.rpm) {
    state = ceaseFire(state);
    announce(state.fault || 'TRACK HOLD // SYSTEM READY', Boolean(state.fault));
    render();
  }
  if (session) {
    analytics.trackEvent('terminal_firing_ended', {
      engagement_mode: session.engagementMode,
      stop_reason: reason,
      rounds_fired: Math.max(0, session.startAmmo - state.ammo)
    });
  }
}

function toggleAutoEngage(inputMethod = 'pointer') {
  if (state.autoEngage) {
    window.clearInterval(autoTimer);
    autoTimer = null;
    stopFiring('automatic_disengaged');
    setState({ ...ceaseFire(state), autoEngage: false }, 'AUTOMATIC ENGAGEMENT CEASED');
    analytics.trackEvent('terminal_auto_engage_changed', { enabled: false, input_method: inputMethod });
    return;
  }
  if (state.weapon !== 'ARMED') state = selectOption(state, 'weapon', 'ARMED');
  showView('telemetry');
  setState({ ...state, autoEngage: true, iff: 'SEARCH' }, 'AUTO SEARCH // SECTOR 12');
  analytics.trackEvent('terminal_auto_engage_changed', { enabled: true, input_method: inputMethod });
  let scans = 0;
  autoTimer = window.setInterval(() => {
    scans += 1;
    if (scans % 4 !== 0) {
      setState({ ...state, iff: 'SEARCH' }, `SEARCHING // BEARING ${String((scans * 47) % 360).padStart(3, '0')}`);
      beep(350 + scans * 8, 0.025, 'sine', 0.012);
      return;
    }
    setState({ ...state, iff: 'ENGAGED' }, 'CONTACT // MULTIPLE TARGETS');
    startFiring(undefined, 'automatic', 'automatic');
    window.setTimeout(() => stopFiring('automatic_cycle'), 520 + Math.random() * 480);
  }, 900);
}

function runTest(inputMethod = 'pointer') {
  if (state.testRunning) return;
  stopFiring('test_started');
  showView('configuration');
  if (state.autoEngage) toggleAutoEngage(inputMethod);
  state = { ...state, testRunning: true, iff: 'TEST', fault: null };
  render();
  analytics.trackEvent('terminal_test_started', {
    test_routine: state.test.toLowerCase(),
    input_method: inputMethod
  });
  const steps = state.test === 'AUTO'
    ? ['OPTICAL ARRAY', 'IFF TRANSPONDER', 'TRAVERSE SERVO', 'FEED MECHANISM', 'REMOTE LINK']
    : ['IFF TRANSPONDER', 'REMOTE LINK'];
  steps.forEach((step, index) => {
    testTimers.push(window.setTimeout(() => {
      announce(`TEST ${index + 1}/${steps.length} // ${step}`);
      beep(520 + index * 90, 0.075, 'square', 0.02);
    }, index * 480));
  });
  testTimers.push(window.setTimeout(() => {
    setState({ ...state, testRunning: false, iff: 'SEARCH' }, 'TEST COMPLETE // ALL SYSTEMS D-OK');
    beep(880, 0.18, 'sine', 0.025);
    analytics.trackEvent('terminal_test_completed', { test_routine: state.test.toLowerCase() });
  }, steps.length * 480 + 180));
}

function resetSystem(inputMethod = 'pointer') {
  stopFiring('reloaded');
  if (autoTimer) window.clearInterval(autoTimer);
  autoTimer = null;
  testTimers.forEach(window.clearTimeout);
  testTimers = [];
  setState({ ...reload(state), sound: state.sound, testRunning: false }, '500 ROUNDS LOADED // SYSTEM READY');
  beep(610, 0.12);
  analytics.trackEvent('terminal_reloaded', { input_method: inputMethod });
}

function toggleSound(inputMethod = 'pointer') {
  state = { ...state, sound: !state.sound };
  render();
  if (state.sound) beep(740, 0.09);
  announce(`TERMINAL SOUND // ${state.sound ? 'ON' : 'OFF'}`);
  analytics.trackEvent('terminal_sound_changed', { enabled: state.sound, input_method: inputMethod });
}

async function toggleFullscreen(inputMethod = 'pointer') {
  try {
    fullscreenInputMethod = inputMethod;
    if (!document.fullscreenElement) {
      await $('.terminal-frame').requestFullscreen();
      try {
        await window.screen.orientation?.lock?.('landscape');
      } catch {
        // Most mobile browsers reserve orientation locking for installed apps.
      }
    }
    else await document.exitFullscreen();
  } catch {
    fullscreenInputMethod = null;
    announce('FULLSCREEN UNAVAILABLE', true);
    trackFault('FULLSCREEN UNAVAILABLE');
  }
}

function usesPortraitTouchLayout() {
  const viewport = window.visualViewport;
  const width = viewport?.width ?? window.innerWidth;
  const height = viewport?.height ?? window.innerHeight;
  return coarsePointerGate.matches && height > width;
}

function syncDisplayOrientation() {
  const portrait = usesPortraitTouchLayout();
  document.documentElement.dataset.displayOrientation = portrait ? 'portrait' : 'landscape';
  if (lastPortraitState === null) {
    if (portrait) analytics.trackEvent('orientation_interlock_shown', { orientation: 'portrait' });
  } else if (portrait !== lastPortraitState) {
    analytics.trackEvent(
      portrait ? 'orientation_interlock_shown' : 'orientation_interlock_cleared',
      { orientation: portrait ? 'portrait' : 'landscape' }
    );
  }
  lastPortraitState = portrait;
  if (!portrait) return;
  if (autoTimer) window.clearInterval(autoTimer);
  autoTimer = null;
  stopFiring('orientation_changed');
  if (state.autoEngage) {
    state = { ...ceaseFire(state), autoEngage: false };
    render();
    analytics.trackEvent('terminal_auto_engage_changed', { enabled: false, input_method: 'orientation' });
  }
  if (helpDialog.open) helpDialog.close();
}

function showHelp(inputMethod = 'pointer') {
  stopFiring('help_opened');
  if (!helpDialog.open) {
    helpDialog.showModal();
    analytics.trackEvent('terminal_help_opened', { input_method: inputMethod });
  }
}

function finishBoot(completionMethod = 'automatic') {
  if (bootFinished) return;
  bootFinished = true;
  bootTimers.forEach(window.clearTimeout);
  bootTimers = [];
  boot.classList.add('complete');
  terminalUi.removeAttribute('aria-hidden');
  screen.dataset.state = 'ready';
  showView('configuration');
  window.setTimeout(() => boot.hidden = true, 360);
  announce('SYSTEM READY // SPACE FIRE // E AUTO');
  render();
  analytics.trackEvent('terminal_boot_completed', {
    completion_method: completionMethod,
    elapsed_msec: Math.round(performance.now() - startedAt)
  });
}

function bootSequence() {
  const lines = [
    'INITIALIZING REMOTE LINK',
    'VERIFYING OPTICAL ARRAY',
    'LOADING IFF PROFILES',
    'UA 571-C // SYSTEM D-OK'
  ];
  lines.forEach((line, index) => {
    bootTimers.push(window.setTimeout(() => {
      $('#bootLine').textContent = line;
      $('#bootProgress').style.width = `${(index + 1) * 25}%`;
      beep(420 + index * 110, 0.06);
    }, index * 420));
  });
  bootTimers.push(window.setTimeout(() => finishBoot('automatic'), lines.length * 420 + 220));
}

Object.entries(sectionMap).forEach(([key, selector]) => {
  $$(selector + ' button').forEach((button) => {
    button.addEventListener('click', () => choose(key, button.dataset.value, 'pointer'));
  });
});

$('#runTest').addEventListener('click', () => runTest('pointer'));
$('#skipBoot').addEventListener('click', (event) => {
  event.stopPropagation();
  finishBoot('skip_button');
});
boot.addEventListener('click', () => finishBoot('boot_surface'));
$('#fireControl').addEventListener('pointerdown', (event) => startFiring(event, event.pointerType || 'pointer'));
$('#fireControl').addEventListener('pointerup', () => stopFiring('released'));
$('#fireControl').addEventListener('pointercancel', () => stopFiring('pointer_cancelled'));
$('#fireControl').addEventListener('pointerleave', () => stopFiring('pointer_left'));
$('#engageControl').addEventListener('click', () => toggleAutoEngage('pointer'));
$('#outsideHelp').addEventListener('click', () => showHelp('pointer'));

$$('[data-command]').forEach((button) => {
  button.addEventListener('click', () => {
    const actions = { view: toggleView, reload: resetSystem, sound: toggleSound, fullscreen: toggleFullscreen, help: showHelp };
    actions[button.dataset.command]?.('pointer');
  });
});

document.addEventListener('keydown', (event) => {
  if (event.code === 'Escape') {
    stopFiring('escape');
    if (screen.dataset.state === 'booting') finishBoot('keyboard_escape');
    return;
  }
  if (helpDialog.open || screen.dataset.state === 'booting') return;
  if (numberMap[event.code] && !event.repeat) {
    event.preventDefault();
    cycle(numberMap[event.code], 'keyboard');
    return;
  }
  const tag = document.activeElement?.tagName;
  const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  if (isTyping) return;
  if (event.code === 'Space' && !event.repeat) {
    event.preventDefault();
    startFiring(event, 'keyboard');
  } else if (event.key.toLowerCase() === 'e' && !event.repeat) toggleAutoEngage('keyboard');
  else if (event.key.toLowerCase() === 't' && !event.repeat) runTest('keyboard');
  else if (event.key.toLowerCase() === 'r' && !event.repeat) resetSystem('keyboard');
  else if (event.key.toLowerCase() === 'm' && !event.repeat) toggleSound('keyboard');
  else if (event.key.toLowerCase() === 'f' && !event.repeat) toggleFullscreen('keyboard');
  else if (event.key.toLowerCase() === 'v' && !event.repeat) toggleView('keyboard');
  else if ((event.key === '?' || event.key === '/') && !event.repeat) showHelp('keyboard');
});

document.addEventListener('keyup', (event) => {
  if (event.code === 'Space') stopFiring('released');
});

window.addEventListener('blur', () => stopFiring('window_blur'));
document.addEventListener('visibilitychange', () => { if (document.hidden) stopFiring('page_hidden'); });
document.addEventListener('fullscreenchange', () => {
  analytics.trackEvent('terminal_fullscreen_changed', {
    fullscreen_state: document.fullscreenElement ? 'entered' : 'exited',
    input_method: fullscreenInputMethod || 'browser'
  });
  fullscreenInputMethod = null;
});
if (portraitGate.addEventListener) portraitGate.addEventListener('change', syncDisplayOrientation);
else portraitGate.addListener?.(syncDisplayOrientation);
if (coarsePointerGate.addEventListener) coarsePointerGate.addEventListener('change', syncDisplayOrientation);
else coarsePointerGate.addListener?.(syncDisplayOrientation);
window.addEventListener('resize', syncDisplayOrientation);
window.visualViewport?.addEventListener('resize', syncDisplayOrientation);
window.screen.orientation?.addEventListener?.('change', syncDisplayOrientation);
window.addEventListener('orientationchange', () => {
  syncDisplayOrientation();
  window.requestAnimationFrame(syncDisplayOrientation);
  window.setTimeout(syncDisplayOrientation, 250);
});
syncDisplayOrientation();

window.setInterval(() => {
  if (!state.firing && state.temperature > 18) {
    state = cool(state);
    render();
  }
  const elapsed = Math.floor((performance.now() - startedAt) / 1000);
  const hours = String(Math.floor(elapsed / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
  const seconds = String(elapsed % 60).padStart(2, '0');
  $('#clock').textContent = `${hours}:${minutes}:${seconds}`;
}, 250);

if (matchMedia('(prefers-reduced-motion: reduce)').matches) finishBoot('reduced_motion');
else bootSequence();
