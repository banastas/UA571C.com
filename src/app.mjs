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

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let state = initialState();
let fireTimer = null;
let autoTimer = null;
let testTimers = [];
let bootTimers = [];
let audioContext = null;
let activeView = 'configuration';
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

function toggleView() {
  stopFiring();
  showView(activeView === 'configuration' ? 'telemetry' : 'configuration');
  announce(`${activeView.toUpperCase()} VIEW // LINK D-OK`);
  beep(620);
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

function choose(key, value) {
  stopFiring();
  setState(selectOption(state, key, value), `${key.replace(/([A-Z])/g, ' $1').toUpperCase()} // ${value}`);
  beep(720);
}

function cycle(key) {
  stopFiring();
  showView('configuration');
  const next = cycleOption(state, key);
  setState(next, `${key.replace(/([A-Z])/g, ' $1').toUpperCase()} // ${next[key]}`);
  beep(720);
}

function fireTick() {
  const next = fireRound(state, 1);
  const blocked = next.fault && !next.firing;
  if (blocked) {
    if (autoTimer) window.clearInterval(autoTimer);
    autoTimer = null;
    setState({ ...next, autoEngage: false }, next.fault, true);
    stopFiring();
    return;
  }
  setState(next, 'TARGET TRACK // AUTOMATIC FIRE');
  beep(78 + Math.random() * 12, 0.035, 'square', 0.028);
}

function startFiring(event) {
  event?.preventDefault();
  if (fireTimer || state.testRunning) return;
  if (state.weapon !== 'ARMED') state = selectOption(state, 'weapon', 'ARMED');
  showView('telemetry');
  fireTick();
  if (!state.fault) fireTimer = window.setInterval(fireTick, 1000 / EFFECTIVE_ROUNDS_PER_SECOND);
}

function stopFiring() {
  if (fireTimer) window.clearInterval(fireTimer);
  fireTimer = null;
  if (state.firing || state.rpm) {
    state = ceaseFire(state);
    announce(state.fault || 'TRACK HOLD // SYSTEM READY', Boolean(state.fault));
    render();
  }
}

function toggleAutoEngage() {
  if (state.autoEngage) {
    window.clearInterval(autoTimer);
    autoTimer = null;
    setState({ ...ceaseFire(state), autoEngage: false }, 'AUTOMATIC ENGAGEMENT CEASED');
    return;
  }
  if (state.weapon !== 'ARMED') state = selectOption(state, 'weapon', 'ARMED');
  showView('telemetry');
  setState({ ...state, autoEngage: true, iff: 'SEARCH' }, 'AUTO SEARCH // SECTOR 12');
  let scans = 0;
  autoTimer = window.setInterval(() => {
    scans += 1;
    if (scans % 4 !== 0) {
      setState({ ...state, iff: 'SEARCH' }, `SEARCHING // BEARING ${String((scans * 47) % 360).padStart(3, '0')}`);
      beep(350 + scans * 8, 0.025, 'sine', 0.012);
      return;
    }
    setState({ ...state, iff: 'ENGAGED' }, 'CONTACT // MULTIPLE TARGETS');
    startFiring();
    window.setTimeout(stopFiring, 520 + Math.random() * 480);
  }, 900);
}

function runTest() {
  if (state.testRunning) return;
  stopFiring();
  showView('configuration');
  if (state.autoEngage) toggleAutoEngage();
  state = { ...state, testRunning: true, iff: 'TEST', fault: null };
  render();
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
  }, steps.length * 480 + 180));
}

function resetSystem() {
  stopFiring();
  if (autoTimer) window.clearInterval(autoTimer);
  autoTimer = null;
  testTimers.forEach(window.clearTimeout);
  testTimers = [];
  setState({ ...reload(state), sound: state.sound, testRunning: false }, '500 ROUNDS LOADED // SYSTEM READY');
  beep(610, 0.12);
}

function toggleSound() {
  state = { ...state, sound: !state.sound };
  render();
  if (state.sound) beep(740, 0.09);
  announce(`TERMINAL SOUND // ${state.sound ? 'ON' : 'OFF'}`);
}

async function toggleFullscreen() {
  try {
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
    announce('FULLSCREEN UNAVAILABLE', true);
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
  if (!portrait) return;
  if (autoTimer) window.clearInterval(autoTimer);
  autoTimer = null;
  stopFiring();
  if (state.autoEngage) {
    state = { ...ceaseFire(state), autoEngage: false };
    render();
  }
  if (helpDialog.open) helpDialog.close();
}

function showHelp() {
  stopFiring();
  if (!helpDialog.open) helpDialog.showModal();
}

function finishBoot() {
  bootTimers.forEach(window.clearTimeout);
  bootTimers = [];
  boot.classList.add('complete');
  terminalUi.removeAttribute('aria-hidden');
  screen.dataset.state = 'ready';
  showView('configuration');
  window.setTimeout(() => boot.hidden = true, 360);
  announce('SYSTEM READY // SPACE FIRE // E AUTO');
  render();
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
  bootTimers.push(window.setTimeout(finishBoot, lines.length * 420 + 220));
}

Object.entries(sectionMap).forEach(([key, selector]) => {
  $$(selector + ' button').forEach((button) => {
    button.addEventListener('click', () => choose(key, button.dataset.value));
  });
});

$('#runTest').addEventListener('click', runTest);
$('#skipBoot').addEventListener('click', finishBoot);
boot.addEventListener('click', finishBoot);
$('#fireControl').addEventListener('pointerdown', startFiring);
$('#fireControl').addEventListener('pointerup', stopFiring);
$('#fireControl').addEventListener('pointercancel', stopFiring);
$('#fireControl').addEventListener('pointerleave', stopFiring);
$('#engageControl').addEventListener('click', toggleAutoEngage);
$('#outsideHelp').addEventListener('click', showHelp);

$$('[data-command]').forEach((button) => {
  button.addEventListener('click', () => {
    const actions = { view: toggleView, reload: resetSystem, sound: toggleSound, fullscreen: toggleFullscreen, help: showHelp };
    actions[button.dataset.command]?.();
  });
});

document.addEventListener('keydown', (event) => {
  if (event.code === 'Escape') {
    stopFiring();
    if (screen.dataset.state === 'booting') finishBoot();
    return;
  }
  if (helpDialog.open || screen.dataset.state === 'booting') return;
  if (numberMap[event.code] && !event.repeat) {
    event.preventDefault();
    cycle(numberMap[event.code]);
    return;
  }
  const tag = document.activeElement?.tagName;
  const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  if (isTyping) return;
  if (event.code === 'Space' && !event.repeat) {
    event.preventDefault();
    startFiring(event);
  } else if (event.key.toLowerCase() === 'e' && !event.repeat) toggleAutoEngage();
  else if (event.key.toLowerCase() === 't' && !event.repeat) runTest();
  else if (event.key.toLowerCase() === 'r' && !event.repeat) resetSystem();
  else if (event.key.toLowerCase() === 'm' && !event.repeat) toggleSound();
  else if (event.key.toLowerCase() === 'f' && !event.repeat) toggleFullscreen();
  else if (event.key.toLowerCase() === 'v' && !event.repeat) toggleView();
  else if ((event.key === '?' || event.key === '/') && !event.repeat) showHelp();
});

document.addEventListener('keyup', (event) => {
  if (event.code === 'Space') stopFiring();
});

window.addEventListener('blur', stopFiring);
document.addEventListener('visibilitychange', () => { if (document.hidden) stopFiring(); });
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

if (matchMedia('(prefers-reduced-motion: reduce)').matches) finishBoot();
else bootSequence();
