const APP_VERSION = 'v31';
const STORAGE_KEY = 'eliptica_pwa_v31_state';
const APP_NAME = `Eliptica PWA ${APP_VERSION}`;
const NOTIF_CATALOG = [
  'Prueba',
  'Cambio de tramo: 3min/1min/30s/10s/ahora',
  'Agua: 3min/1min/30s/10s/ahora',
  'Pulso fuera de objetivo',
  'Kcal fuera del plan',
  'Aviso fin prevista en voz/notificación de eventos importantes'
];

const state = {
  plan: null,
  previewPlan: null,
  session: {
    phase: 'idle',
    elapsedBeforeSec: 0,
    runStartedPerfMs: 0,
    runStartedWallMs: 0,
    pauseStartedMs: 0,
    startedWallClockMs: 0,
    elapsedSec: 0,
    realKcalOffset: 0,
    segmentOffsetStart: 0,
    currentSegmentIndex: -1,
    waterMarked: 0,
    lastPersistMs: 0,
    lastSecond: -1,
    autoRecovered: false,
  },
  ble: {
    device: null,
    server: null,
    hrChar: null,
    battChar: null,
    connected: false,
    lastPacketMs: 0,
    rawBpm: null,
    displayBpm: null,
    rrMs: null,
    battery: null,
    samples: [],
    packetCount: 0,
  },
  ui: {
    voiceEnabled: true,
    beepEnabled: true,
    notifEnabled: true,
    hrAlerts: true,
    kcalAlerts: true,
    timeAlerts: true,
    selectedVoice: '',
    voices: [],
    audioUnlocked: false,
    tickerSpeedSec: 22,
    tickerSignature: '',
    tickerPause: false,
    lastStatusRefreshSec: -1,
    reminderFired: new Set(),
    hrAlertLastAt: 0,
    kcalAlertLastAt: 0,
    speechQueue: [],
    speaking: false,
    lastSpoken: '',
    lastSpokenAt: 0,
    nextNotificationId: 1,
  },
  chartlessHistory: {
    secondRows: [],
    minuteRows: [],
  },
  checks: { ok: 0, fail: 0 },
  buttons: {},
};

const el = {};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  bindEls();
  setText(el.appVersion, APP_VERSION);
  initSettingsFromUI();
  initButtons();
  attachGlobalUnlock();
  await registerServiceWorker();
  refreshVoices();
  restoreState();
  startupChecks();
  renderAll(true);
  requestAnimationFrame(loop);
}

function bindEls() {
  [
    'appVersion','appStatus','timelineRow','timelineMarkers','progressLine','sessionPhaseText','planHeadline','testBadges',
    'sessionClock','realClock','planKcal','realKcal','pulseNow','pulseObj','avgPlan','avgReal','devTotal','devTramo',
    'realRate','planNeedRate','waterCount','tickerNow','tickerEta','tickerTrack','changesBody','nextWaterText','waterRuleText',
    'bpm5','bpm10','bpm30','planText','previewBox','voicesCount','voiceSelect','tickerSpeedRange','tickerSpeedValue',
    'logBox','chipBle','chipHr','chipSession','chipSave','chipWater','chipAlerts','chipVoice','chipTest'
  ].forEach(id => el[id] = document.getElementById(id));
}

function initSettingsFromUI() {
  state.ui.tickerSpeedSec = Number(el.tickerSpeedRange.value || 22);
  applyTickerSpeed();
}

function initButtons() {
  bindButton('applyPlanBtn','applyPlan',applyPlan);
  bindButton('copyPlanBtn','copyPlan',copyPlanText);
  bindButton('previewPlanBtn','previewPlan',previewPlan);
  bindButton('normalizePlanBtn','normalizePlan',normalizePlan);
  bindButton('clearPlanBtn','clearPlan',clearPlan);
  bindButton('startBtn','toggleRun',toggleRun);
  bindButton('resetBtn','reset',resetSession);
  bindButton('refreshVoicesBtn','refreshVoices',() => { refreshVoices(true); });
  bindButton('testVoiceBtn','testVoice',testVoice);
  bindButton('bleConnectBtn','bleConnect',connectBle);
  bindButton('bleDisconnectBtn','bleDisconnect',disconnectBle);
  bindButton('notifPermissionBtn','notifPermission',requestNotifPermission);
  bindButton('testNotifyBtn','testNotify',testNotification);
  bindButton('listNotifsBtn','listNotifs',listNotifications);
  bindButton('exportSessionBtn','exportSession',exportSecondCsv);
  bindButton('exportMinuteBtn','exportMinute',exportMinuteCsv);
  bindButton('exportJsonBtn','exportJson',exportJson);
  bindButton('exportPlanTxtBtn','exportPlanTxt',exportPlanTxt);
  bindButton('clearLogBtn','clearLog',() => { el.logBox.textContent=''; addLog('Log limpiado'); });

  ['voiceToggle','beepToggle','notifToggle','hrAlertsToggle','kcalAlertsToggle','timeAlertsToggle'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => {
      state.ui.voiceEnabled = document.getElementById('voiceToggle').checked;
      state.ui.beepEnabled = document.getElementById('beepToggle').checked;
      state.ui.notifEnabled = document.getElementById('notifToggle').checked;
      state.ui.hrAlerts = document.getElementById('hrAlertsToggle').checked;
      state.ui.kcalAlerts = document.getElementById('kcalAlertsToggle').checked;
      state.ui.timeAlerts = document.getElementById('timeAlertsToggle').checked;
      persistState();
      renderStatusChips();
    });
  });

  el.voiceSelect?.addEventListener('change', () => {
    state.ui.selectedVoice = el.voiceSelect.value;
    addLog(`Voz seleccionada: ${state.ui.selectedVoice || 'automática'}`);
    persistState();
  });

  el.tickerSpeedRange?.addEventListener('input', () => {
    state.ui.tickerSpeedSec = Number(el.tickerSpeedRange.value);
    applyTickerSpeed();
    persistState();
  });

  document.querySelectorAll('#seekButtons button').forEach(btn => {
    btn.addEventListener('click', safeAction(`seek${btn.dataset.seek}`, async () => seekBy(Number(btn.dataset.seek))));
  });
  document.querySelectorAll('#kcalButtons button').forEach(btn => {
    btn.addEventListener('click', safeAction(`kcal${btn.dataset.kadj}`, async () => adjustRealKcal(Number(btn.dataset.kadj))));
  });

  window.addEventListener('beforeunload', persistState);
  document.addEventListener('visibilitychange', () => { persistState(); });
}

function attachGlobalUnlock() {
  const unlock = async () => {
    if (!state.ui.audioUnlocked) {
      try { await unlockAudio(); } catch {}
      state.ui.audioUnlocked = true;
      addLog('Audio desbloqueado');
    }
  };
  document.addEventListener('pointerdown', unlock, { once: true });
}

function bindButton(id, code, fn) {
  const btn = document.getElementById(id);
  if (!btn) return;
  state.buttons[id] = code;
  btn.addEventListener('click', safeAction(code, fn));
}

function safeAction(code, fn) {
  return async (ev) => {
    addLog(`[BTN ${code}] #${ev?.currentTarget?.id || '?'} pulsado`);
    try {
      await fn(ev);
      addLog(`[BTN ${code}] OK`);
    } catch (err) {
      console.error(err);
      addLog(`[BTN ${code}] ERROR: ${err?.message || err}`);
    }
  };
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('./sw.js');
    addLog('Service worker registrado');
  } catch (e) {
    addLog(`Service worker ERROR: ${e.message}`);
  }
}

function startupChecks() {
  addLog(`[STARTUP] Inicio comprobación ${APP_VERSION}`);
  check(!!el.planText, 'Textarea plan');
  check(!!el.tickerNow && !!el.tickerEta && !!el.tickerTrack, 'Ticker');
  check(!!el.pulseNow && !!el.bpm5 && !!el.bpm10 && !!el.bpm30, 'Pulso UI');
  check(typeof parsePlan === 'function', 'Parser');
  check(typeof handleAlerts === 'function', 'Alertas');
  check(typeof connectBle === 'function', 'BLE connect');
  check('Notification' in window, 'Notification API');
  check('speechSynthesis' in window, 'Speech API');
  Object.keys(state.buttons).forEach(id => check(!!document.getElementById(id), `Botón #${id} enlazado`));
  check(document.querySelectorAll('#seekButtons button').length === 10, 'Seek enlazados: 10');
  addLog(`[STARTUP] Resumen checks · ok=${state.checks.ok} · fail=${state.checks.fail}`);
}

function check(condition, label) {
  if (condition) { state.checks.ok++; addLog(`[CHECK] ${label}`); }
  else { state.checks.fail++; addLog(`[FAIL] ${label}`); }
}

function addLog(msg) {
  const ts = new Date();
  const hh = String(ts.getHours()).padStart(2,'0');
  const mm = String(ts.getMinutes()).padStart(2,'0');
  const ss = String(ts.getSeconds()).padStart(2,'0');
  const line = `[${hh}:${mm}:${ss}] ${msg}`;
  if (el.logBox) {
    el.logBox.textContent += (el.logBox.textContent ? '\n' : '') + line;
    el.logBox.scrollTop = el.logBox.scrollHeight;
  }
}

function setText(node, text) { if (node) node.textContent = text; }
function fmtClock(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
function fmtHM(date) { return `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`; }
function round1(v) { return Math.round((Number(v) || 0) * 10) / 10; }
function round2(v) { return Math.round((Number(v) || 0) * 100) / 100; }
function numberFromText(s) { return Number(String(s).replace(',', '.')); }

function parsePlan(text) {
  const raw = (text || '').trim();
  if (!raw) throw new Error('No hay texto para importar');
  const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const segments = [];
  const waterSecs = [];
  let title = lines[0] || 'ELÍPTICA';
  let totalDurationSec = 0;
  let totalKcal = null;
  let logic = '';
  let testGoal = [];
  let priorities = [];
  let bpmHints = {};

  for (const line of lines) {
    if (/^LÓGICA/i.test(line)) logic = line;
    if (/^OBJETIVO DEL TEST/i.test(line) || /^-\s*(victoria|récord|record)/i.test(line)) testGoal.push(line);
    if (/^PRIORIDAD REAL/i.test(line) || /^\d+\./.test(line)) priorities.push(line);
    const waterMatch = line.match(/(?:^Minuto|^-\s*min)\s*(\d{1,2}:\d{2})/i);
    if (waterMatch) waterSecs.push(parseMMSS(waterMatch[1]));
    const totalTimeMatch = line.match(/Tiempo:\s*(\d{1,2}:\d{2}(?::\d{2})?)/i);
    if (totalTimeMatch) totalDurationSec = parseMMSS(totalTimeMatch[1]);
    const totalKcalMatch = line.match(/Kcal[^\d]*~\s*(\d+(?:[.,]\d+)?)(?:\s*[–-]\s*(\d+(?:[.,]\d+)?))?/i);
    if (/TOTAL PREVISTO/i.test(line)) continue;
    if (totalKcalMatch && /Kcal máquina/i.test(line)) {
      totalKcal = totalKcalMatch[2] ? (numberFromText(totalKcalMatch[1]) + numberFromText(totalKcalMatch[2])) / 2 : numberFromText(totalKcalMatch[1]);
    }

    const bpmMatch = line.match(/Nivel\s*(\d+)\s*:\s*(\d+)\s*[–-]\s*(\d+)/i);
    if (bpmMatch) bpmHints[Number(bpmMatch[1])] = [Number(bpmMatch[2]), Number(bpmMatch[3])];

    let m = line.match(/^([A-Z])\)\s*(?:(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})|(\d{1,2}:\d{2}))\s*(?:→|·)?\s*(TEST\s+NIVEL|NIVEL)\s*(\d+)(?:\s*→\s*~\s*(\d+(?:[.,]\d+)?)(?:\s*[–-]\s*(\d+(?:[.,]\d+)?))?\s*kcal|.*?~\s*(\d+(?:[.,]\d+)?)(?:\s*[–-]\s*(\d+(?:[.,]\d+)?))?\s*kcal)?/i);
    if (m) {
      const label = m[1];
      const startHHMM = m[2];
      const endHHMM = m[3];
      const durMMSS = m[4];
      const isTest = /TEST/i.test(m[5]);
      const level = Number(m[6]);
      const k1 = numberFromText(m[7] || m[9] || 0);
      const k2 = numberFromText(m[8] || m[10] || 0);
      let durationSec = 0;
      if (durMMSS) durationSec = parseMMSS(durMMSS);
      else durationSec = diffHHMM(startHHMM, endHHMM);
      const kcalTarget = k2 ? round1((k1 + k2) / 2) : round1(k1);
      segments.push({ label, durationSec, level, kcalTarget, isTest, sourceLine: line });
      continue;
    }
    m = line.match(/^([A-Z])\)\s*(\d{1,2}:\d{2})\s*·\s*(TEST\s+NIVEL|NIVEL)\s*(\d+)/i);
    if (m) {
      segments.push({ label: m[1], durationSec: parseMMSS(m[2]), isTest: /TEST/i.test(m[3]), level: Number(m[4]), kcalTarget: 0, sourceLine: line });
    }
  }
  if (!segments.length) throw new Error('No se detectaron tramos');
  let cursor = 0;
  segments.forEach(seg => { seg.startSec = cursor; seg.endSec = cursor + seg.durationSec; cursor = seg.endSec; });
  if (!totalDurationSec) totalDurationSec = cursor;
  if (totalKcal == null) totalKcal = round1(segments.reduce((a, s) => a + (s.kcalTarget || 0), 0));
  if (!title || !/ELÍPTICA/i.test(title)) title = `ELÍPTICA · ${fmtClock(totalDurationSec)} · ~${round1(totalKcal)} kcal`;
  const plan = { title, logic, totalDurationSec, totalKcalTarget: round1(totalKcal), segments, waterSecs: waterSecs.sort((a,b)=>a-b), bpmHints, testGoals: testGoal, priorities, sourceText: raw };
  plan.testSegmentIndex = segments.findIndex(s => s.isTest);
  plan.testSegment = plan.testSegmentIndex >= 0 ? segments[plan.testSegmentIndex] : null;
  return plan;
}

function parseMMSS(text) {
  const p = text.split(':').map(Number);
  if (p.length === 2) return p[0] * 60 + p[1];
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  return 0;
}
function diffHHMM(a,b) {
  const [h1,m1] = a.split(':').map(Number), [h2,m2] = b.split(':').map(Number);
  let start = h1*60 + m1, end = h2*60 + m2;
  if (end < start) end += 24*60;
  return (end - start) * 60;
}

function buildNormalizedText(plan) {
  const out = [];
  out.push(`ELÍPTICA${plan.testSegment ? ' · TEST FORMAL NIVEL ' + plan.testSegment.level : ''} · ${fmtClock(plan.totalDurationSec)} · ~${round1(plan.totalKcalTarget)} kcal`);
  out.push('');
  plan.segments.forEach(seg => {
    out.push(`${seg.label}) ${fmtClock(seg.durationSec)} · ${seg.isTest ? 'TEST NIVEL' : 'NIVEL'} ${seg.level}`);
    out.push(`→ objetivo ~${round1(seg.kcalTarget)} kcal`);
  });
  if (plan.waterSecs.length) {
    out.push('');
    plan.waterSecs.forEach(s => out.push(`Minuto ${fmtClock(s)}`));
  }
  out.push('');
  out.push('tiempo\tkcal_total\tkcal_tramo\tnivel\ttramo');
  out.push('00:00\t0\t0\t' + plan.segments[0].level + '\t' + plan.segments[0].label);
  let total = 0;
  plan.segments.forEach((seg, i) => {
    total += seg.kcalTarget;
    const nextLevel = plan.segments[i+1]?.level ?? seg.level;
    const nextLabel = plan.segments[i+1]?.label ?? seg.label;
    out.push(`${fmtClock(seg.endSec)}\t${round1(total)}\t${round1(seg.kcalTarget)}\t${nextLevel}\t${nextLabel}`);
  });
  return out.join('\n');
}

async function applyPlan() {
  const plan = parsePlan(el.planText.value);
  state.plan = plan;
  state.previewPlan = plan;
  state.session.phase = 'idle';
  state.session.elapsedBeforeSec = 0;
  state.session.elapsedSec = 0;
  state.session.realKcalOffset = 0;
  state.session.segmentOffsetStart = 0;
  state.session.currentSegmentIndex = 0;
  state.chartlessHistory.secondRows = [];
  state.chartlessHistory.minuteRows = [];
  setText(el.previewBox, buildNormalizedText(plan));
  addLog('Plan cargado');
  persistState();
  renderAll(true);
}
function previewPlan() {
  const plan = parsePlan(el.planText.value);
  state.previewPlan = plan;
  setText(el.previewBox, buildNormalizedText(plan));
  addLog('Vista previa generada');
}
function normalizePlan() {
  const plan = parsePlan(el.planText.value);
  el.planText.value = buildNormalizedText(plan);
  state.previewPlan = plan;
  setText(el.previewBox, el.planText.value);
  addLog('Plan normalizado');
}
function clearPlan() {
  el.planText.value = '';
  el.previewBox.textContent = '';
  addLog('Texto del plan limpiado');
}
async function copyPlanText() { await copyTextSafe(el.planText.value || ''); addLog('Texto del plan copiado'); }

function toggleRun() {
  if (!state.plan) throw new Error('Carga un plan primero');
  unlockAudio();
  if (state.session.phase === 'running') {
    state.session.phase = 'paused';
    state.session.elapsedBeforeSec = getElapsedSec();
    state.session.pauseStartedMs = Date.now();
    addLog('Sesión pausada');
  } else {
    if (!state.session.startedWallClockMs) state.session.startedWallClockMs = Date.now();
    state.session.phase = 'running';
    state.session.runStartedPerfMs = performance.now();
    state.session.runStartedWallMs = Date.now();
    if (!state.session.currentSegmentIndex && state.session.currentSegmentIndex !== 0) state.session.currentSegmentIndex = 0;
    addLog(state.session.elapsedBeforeSec ? 'Sesión reanudada' : 'Sesión iniciada');
  }
  persistState();
  renderAll();
}
function resetSession() {
  state.session = {
    phase:'idle', elapsedBeforeSec:0, runStartedPerfMs:0, runStartedWallMs:0, pauseStartedMs:0, startedWallClockMs:0,
    elapsedSec:0, realKcalOffset:0, segmentOffsetStart:0, currentSegmentIndex:-1, waterMarked:0, lastPersistMs:0, lastSecond:-1, autoRecovered:false
  };
  state.chartlessHistory.secondRows = [];
  state.chartlessHistory.minuteRows = [];
  state.ui.reminderFired.clear();
  addLog('Sesión reseteada');
  persistState();
  renderAll(true);
}
function seekBy(deltaSec) {
  const max = state.plan?.totalDurationSec || 0;
  const next = Math.min(max, Math.max(0, getElapsedSec() + deltaSec));
  if (state.session.phase === 'running') {
    state.session.elapsedBeforeSec = next;
    state.session.runStartedPerfMs = performance.now();
  } else {
    state.session.elapsedBeforeSec = next;
  }
  state.session.elapsedSec = next;
  addLog(`Seek ${deltaSec > 0 ? '+' : ''}${deltaSec}s -> ${fmtClock(next)}`);
  persistState();
  renderAll();
}
function adjustRealKcal(delta) {
  state.session.realKcalOffset = round1(state.session.realKcalOffset + delta);
  addLog(`Ajuste kcal reales: ${delta > 0 ? '+' : ''}${delta.toFixed(1)} · offset total ${state.session.realKcalOffset.toFixed(1)}`);
  persistState();
  renderAll();
}

function getElapsedSec() {
  if (state.session.phase === 'running') {
    return Math.min(state.plan?.totalDurationSec || 0, Math.max(0, Math.floor(state.session.elapsedBeforeSec + (performance.now() - state.session.runStartedPerfMs) / 1000)));
  }
  return Math.max(0, Math.floor(state.session.elapsedBeforeSec || 0));
}

function getSegmentIndexAt(sec) {
  if (!state.plan) return -1;
  return state.plan.segments.findIndex((s, i) => sec >= s.startSec && (sec < s.endSec || i === state.plan.segments.length - 1 && sec <= s.endSec));
}
function getSegmentAt(sec) { const idx = getSegmentIndexAt(sec); return idx >= 0 ? state.plan.segments[idx] : null; }

function getPlanKcal(sec) {
  if (!state.plan) return 0;
  let total = 0;
  for (const seg of state.plan.segments) {
    if (sec >= seg.endSec) total += seg.kcalTarget;
    else if (sec > seg.startSec) {
      const frac = (sec - seg.startSec) / seg.durationSec;
      total += seg.kcalTarget * frac;
      break;
    } else break;
  }
  return round1(total);
}
function getRealKcal(sec) { return round1(getPlanKcal(sec) + state.session.realKcalOffset); }

function updateSessionDerived(sec) {
  if (!state.plan) return;
  state.session.elapsedSec = sec;
  const idx = getSegmentIndexAt(sec);
  if (idx !== state.session.currentSegmentIndex) {
    state.session.currentSegmentIndex = idx;
    state.session.segmentOffsetStart = state.session.realKcalOffset;
    if (idx >= 0) addLog(`Cambio a tramo ${state.plan.segments[idx].label} · nivel ${state.plan.segments[idx].level}`);
  }
}

function loop() {
  try {
    const sec = getElapsedSec();
    updateSessionDerived(sec);
    if (sec !== state.session.lastSecond) {
      onSecondTick(sec, state.session.lastSecond);
      state.session.lastSecond = sec;
    }
    renderAll();
  } catch (e) {
    console.error(e);
    addLog(`Error en tick: ${e.message}`);
  }
  requestAnimationFrame(loop);
}

function onSecondTick(sec, prevSec) {
  if (!state.plan) return;
  recordSecond(sec);
  recordMinute(sec);
  updateBleDerived();
  handleAlerts(sec, prevSec);
  if (sec >= state.plan.totalDurationSec && state.session.phase === 'running') {
    state.session.phase = 'paused';
    state.session.elapsedBeforeSec = state.plan.totalDurationSec;
    addLog('Ejercicio finalizado');
    enqueueSpeech('Ejercicio finalizado. Buen trabajo.');
    sendAppNotification('Elíptica finalizada', 'Sesión completada');
  }
  if (Date.now() - state.session.lastPersistMs > 1000) persistState();
}

function recordSecond(sec) {
  const seg = getSegmentAt(sec) || state.plan.segments[0];
  const planKcal = getPlanKcal(sec), realKcal = getRealKcal(sec);
  const bpm = getDisplayBpm();
  state.chartlessHistory.secondRows.push({
    sec, clock: fmtClock(sec), level: seg?.level ?? '', tramo: seg?.label ?? '', kcalPlan: planKcal, kcalReal: realKcal,
    bpm: bpm == null ? '' : bpm.toFixed(1), ts: new Date().toISOString()
  });
  if (state.chartlessHistory.secondRows.length > 7200) state.chartlessHistory.secondRows.shift();
}
function recordMinute(sec) {
  if (sec <= 0 || sec % 60 !== 0) return;
  const rowSec = Math.max(0, sec - 1);
  const seg = getSegmentAt(rowSec) || state.plan.segments[0];
  const endPlan = getPlanKcal(sec), endReal = getRealKcal(sec);
  state.chartlessHistory.minuteRows.push({ minute: sec / 60, clock: fmtClock(sec), level: seg.level, tramo: seg.label, kcalPlan: endPlan, kcalReal: endReal, bpmAvg: avgBpm(10) ?? '' });
}

function renderAll(forceTicker = false) {
  renderSummary();
  renderTimeline();
  renderChanges();
  renderStatusChips();
  renderTicker(forceTicker);
}

function renderSummary() {
  const sec = state.session.elapsedSec || getElapsedSec();
  const plan = state.plan;
  setText(el.sessionPhaseText, phaseLabel());
  setText(el.appStatus, phaseLabel());
  setText(el.planHeadline, plan ? plan.title : 'Sin plan cargado');
  setText(el.sessionClock, fmtClock(sec));
  setText(el.realClock, `REAL ${fmtClock(sec)}`);
  const planKcal = plan ? getPlanKcal(sec) : 0;
  const realKcal = plan ? getRealKcal(sec) : 0;
  setText(el.planKcal, planKcal.toFixed(1));
  setText(el.realKcal, realKcal.toFixed(1));
  const disp = getDisplayBpm();
  setText(el.pulseNow, disp == null ? '--.-' : disp.toFixed(1));
  const obj = getBpmObjective(getSegmentAt(sec)?.level);
  setText(el.pulseObj, obj ? `BPM objetivo ${obj[0]}-${obj[1]}` : 'BPM objetivo --');
  setText(el.avgPlan, `${rate(planKcal, sec).toFixed(2)} kcal/min · ${(rate(planKcal, sec)/2).toFixed(2)}/30s`);
  setText(el.avgReal, `${rate(realKcal, sec).toFixed(2)} kcal/min · ${(rate(realKcal, sec)/2).toFixed(2)}/30s`);
  const devTotal = round1(realKcal - planKcal);
  setText(el.devTotal, `${devTotal >= 0 ? '+' : ''}${devTotal.toFixed(1)} kcal`);
  const devTramo = getSegmentDeviation(sec);
  setText(el.devTramo, `${devTramo >= 0 ? '+' : ''}${devTramo.toFixed(1)} kcal`);
  setText(el.realRate, `${rate(realKcal - getRealKcal(getSegmentAt(sec)?.startSec || 0), Math.max(1, sec - (getSegmentAt(sec)?.startSec || 0))).toFixed(2)} kcal/min`);
  setText(el.planNeedRate, `${neededRate(plan).toFixed(2)} kcal/min`);
  const due = plan ? plan.waterSecs.filter(s => s <= sec).length : 0;
  const totalWater = plan ? plan.waterSecs.length : 0;
  setText(el.waterCount, `${Math.max(state.session.waterMarked, due)} / ${totalWater}`);
  setText(el.bpm5, avgBpm(5)?.toFixed(1) || '--');
  setText(el.bpm10, avgBpm(10)?.toFixed(1) || '--');
  setText(el.bpm30, avgBpm(30)?.toFixed(1) || '--');
  renderTestBadges();
}

function renderTestBadges() {
  if (!el.testBadges) return;
  el.testBadges.innerHTML = '';
  if (!state.plan?.testSegment) return;
  const seg = state.plan.testSegment;
  const sec = state.session.elapsedSec;
  const short = `TEST · ${seg.label} · ${Math.round(seg.durationSec/60)}min`;
  const active = sec >= seg.startSec && sec < seg.endSec;
  const finished = sec >= seg.endSec;
  const badge1 = document.createElement('div');
  badge1.className = 'testBadge';
  badge1.textContent = active ? `ACTIVO · ${seg.label} · ${Math.round(seg.durationSec/60)}min` : finished ? `FIN TEST · ${seg.label} · ${Math.round(seg.durationSec/60)}min` : short;
  el.testBadges.appendChild(badge1);
}

function renderTimeline() {
  const row = el.timelineRow, marks = el.timelineMarkers;
  if (!row || !marks) return;
  row.innerHTML = ''; marks.innerHTML = '';
  if (!state.plan) return;
  const total = state.plan.totalDurationSec;
  state.plan.segments.forEach(seg => {
    const d = document.createElement('div');
    d.className = 'seg';
    d.style.width = `${(seg.durationSec / total) * 100}%`;
    d.textContent = `${seg.label} · ${seg.level}`;
    row.appendChild(d);
    addMarker(seg.startSec, `${fmtClock(seg.startSec)} ${seg.label}`);
  });
  addMarker(total, `${fmtClock(total)} Fin`);
  state.plan.waterSecs.forEach(s => addMarker(s, `${fmtClock(s)} 💧`, true));
  const x = total ? (state.session.elapsedSec / total) * (el.timelineTrack?.clientWidth || 1) : 0;
  if (el.progressLine) el.progressLine.style.transform = `translateX(${Math.max(0, x)}px)`;

  function addMarker(sec, label, water = false) {
    const m = document.createElement('div');
    m.className = `marker${water ? ' water' : ''}`;
    m.style.left = `${10 + (sec / total) * ((el.timelineTrack?.clientWidth || 1) - 10)}px`;
    m.innerHTML = `<div class="line"></div><div class="tag">${label}</div>`;
    marks.appendChild(m);
  }
}

function renderChanges() {
  const body = el.changesBody;
  if (!body) return;
  body.innerHTML = '';
  if (!state.plan) return;
  const sec = state.session.elapsedSec;
  const rows = [];
  const currentSeg = getSegmentAt(sec);
  if (currentSeg) rows.push({ en:'AHORA', hora:fmtClock(sec), nivel:currentSeg.level, tramo:currentSeg.label, cls:'now' });
  for (const seg of state.plan.segments) {
    if (seg.startSec > sec) rows.push({ en:fmtClock(seg.startSec-sec), hora:fmtClock(seg.startSec), nivel:seg.level, tramo:seg.label });
  }
  for (const w of state.plan.waterSecs) {
    if (w > sec) rows.push({ en:fmtClock(w-sec), hora:fmtClock(w), nivel:'Agua', tramo:'💧' });
  }
  rows.sort((a,b)=>parseMaybe(a.hora)-parseMaybe(b.hora));
  rows.slice(0,5).forEach(r => {
    const tr = document.createElement('tr');
    if (r.cls) tr.className = r.cls;
    tr.innerHTML = `<td>${r.en}</td><td>${r.hora}</td><td>${r.nivel}</td><td>${r.tramo}</td>`;
    body.appendChild(tr);
  });
  const nextWater = state.plan.waterSecs.find(w => w > sec);
  setText(el.nextWaterText, nextWater == null ? '--' : fmtClock(nextWater));
}
function parseMaybe(mmss){const p=String(mmss).split(':').map(Number);return p.length===2?p[0]*60+p[1]:0}

function renderStatusChips() {
  const sincePacket = Date.now() - (state.ble.lastPacketMs || 0);
  chip(el.chipBle, state.ble.connected ? 'ok' : 'bad', state.ble.connected ? '📶 BLE OK' : '📶 BLE OFF');
  chip(el.chipHr, state.ble.connected && sincePacket < 5000 ? 'ok' : state.ble.connected ? 'warn' : 'bad', state.ble.connected ? (sincePacket < 5000 ? '🫀 Pulso OK' : '🫀 Sin señal') : '🫀 Sin pulso');
  chip(el.chipSession, state.session.phase === 'running' ? 'ok' : state.session.phase === 'paused' ? 'warn' : 'bad', `⏱ ${phaseLabel()}`);
  chip(el.chipSave, 'ok', `💾 ${state.session.lastPersistMs ? 'Guardado' : 'Listo'}`);
  chip(el.chipWater, state.plan?.waterSecs?.length ? 'ok' : 'warn', `💧 ${state.plan?.waterSecs?.length || 0} agua`);
  chip(el.chipAlerts, hasActiveAlert() ? 'warn' : 'ok', hasActiveAlert() ? '⚠ Alertas' : '⚠ Sin críticas');
  chip(el.chipVoice, state.ui.voiceEnabled ? 'ok' : 'warn', state.ui.voiceEnabled ? '🔊 Voz on' : '🔇 Voz off');
  chip(el.chipTest, state.plan?.testSegment ? 'warn' : 'ok', state.plan?.testSegment ? `🧪 Test ${state.plan.testSegment.label}` : '🧪 Sin test');
}
function chip(node, cls, text) { if (!node) return; node.className = `chip ${cls}`; node.textContent = text; }

function renderTicker(force = false) {
  const now = new Date();
  setText(el.tickerNow, fmtHM(now));
  setText(el.tickerEta, `Fin ${getFinishEtaText()}`);
  if (!state.plan) {
    setTickerItems([{ cls:'note', text:'Carga un plan para ver avisos' }], force);
    return;
  }
  const items = buildTickerItems();
  const signature = JSON.stringify(items.map(x => x.text));
  if (!force && signature === state.ui.tickerSignature) return;
  state.ui.tickerSignature = signature;
  setTickerItems(items, true);
}

function buildTickerItems() {
  const sec = state.session.elapsedSec;
  const seg = getSegmentAt(sec);
  const items = [];
  if (seg) items.push({ cls:'info', text:`Tramo ${seg.label} · nivel ${seg.level}` });
  items.push({ cls: getSegmentDeviation(sec) >= 0 ? 'ok':'warn', text:`Δtramo ${signed(getSegmentDeviation(sec))} kcal` });
  items.push({ cls: (getRealKcal(sec)-getPlanKcal(sec)) >= 0 ? 'ok':'warn', text:`Δtotal ${signed(getRealKcal(sec)-getPlanKcal(sec))} kcal` });
  const nextSeg = state.plan.segments.find(s => s.startSec > sec);
  if (nextSeg) items.push({ cls:'note', text:`Siguiente ${nextSeg.label} en ${fmtClock(nextSeg.startSec-sec)}` });
  const nextWater = state.plan.waterSecs.find(w => w > sec);
  if (nextWater != null) items.push({ cls:'note', text:`Agua en ${fmtClock(nextWater-sec)}` });
  if (!state.ble.connected) items.push({ cls:'bad', text:'BLE desconectado' });
  else if (Date.now() - state.ble.lastPacketMs > 5000) items.push({ cls:'warn', text:'Sin señal de pulso' });
  const hrState = getHrAlertState(); if (hrState) items.push(hrState);
  const kcalState = getKcalAlertState(); if (kcalState) items.push(kcalState);
  items.push({ cls:'info', text:`Fin ${getFinishEtaText()}` });
  return items.length ? items : [{ cls:'note', text:'Sin alertas críticas' }];
}
function setTickerItems(items) {
  if (!el.tickerTrack) return;
  const html = items.map(i => `<span class="tkItem ${i.cls}">${escapeHtml(i.text)}</span><span class="tkSep">│</span>`).join('');
  el.tickerTrack.innerHTML = `${html}${html}${html}`;
  el.tickerTrack.classList.remove('paused');
}

function getFinishEtaText() {
  if (!state.plan) return '--:--';
  const remain = Math.max(0, state.plan.totalDurationSec - state.session.elapsedSec);
  const d = new Date(Date.now() + remain * 1000);
  return fmtHM(d);
}

function phaseLabel() {
  return state.session.phase === 'running' ? 'Corriendo' : state.session.phase === 'paused' ? 'Pausada' : 'Lista';
}
function rate(kcal, sec) { return sec > 0 ? (kcal / sec) * 60 : 0; }
function neededRate(plan) {
  if (!plan) return 0;
  const remainSec = Math.max(0, plan.totalDurationSec - state.session.elapsedSec);
  const remainKcal = Math.max(0, plan.totalKcalTarget - getRealKcal(state.session.elapsedSec));
  return remainSec > 0 ? (remainKcal / remainSec) * 60 : 0;
}
function signed(v){v=round1(v);return `${v>=0?'+':''}${v.toFixed(1)}`}
function getSegmentDeviation(sec) {
  const seg = getSegmentAt(sec);
  if (!seg) return 0;
  return round1(state.session.realKcalOffset - state.session.segmentOffsetStart);
}

function getBpmObjective(level) {
  if (!level) return null;
  if (state.plan?.bpmHints?.[level]) return state.plan.bpmHints[level];
  const defaults = {10:[117,132],11:[131,146],12:[146,154]};
  return defaults[level] || null;
}

async function unlockAudio() {
  if (state.ui.audioUnlocked) return;
  if (!window.AudioContext && !window.webkitAudioContext) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    window.__audioCtx = window.__audioCtx || new Ctx();
    if (window.__audioCtx.state === 'suspended') await window.__audioCtx.resume();
    state.ui.audioUnlocked = true;
  } catch (e) {
    addLog(`Audio unlock ERROR: ${e.message}`);
  }
}
function beep(freq = 880, dur = 0.08) {
  if (!state.ui.beepEnabled) return;
  const ctx = window.__audioCtx; if (!ctx) return;
  const osc = ctx.createOscillator(); const gain = ctx.createGain();
  osc.frequency.value = freq; gain.gain.value = 0.06;
  osc.connect(gain).connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + dur);
}

function refreshVoices(logIt = false) {
  const voices = speechSynthesis.getVoices ? speechSynthesis.getVoices() : [];
  state.ui.voices = voices;
  if (el.voiceSelect) {
    el.voiceSelect.innerHTML = '<option value="">Automática</option>' + voices.map((v, i) => `<option value="${escapeHtml(v.name)}">${escapeHtml(v.name)} · ${escapeHtml(v.lang)}</option>`).join('');
    if (state.ui.selectedVoice) el.voiceSelect.value = state.ui.selectedVoice;
  }
  setText(el.voicesCount, `Voces: ${voices.length}`);
  if (logIt) {
    addLog(`Voces detectadas: ${voices.length}`);
    voices.forEach(v => addLog(`- ${v.name} · ${v.lang}`));
  }
}
if ('speechSynthesis' in window) {
  speechSynthesis.onvoiceschanged = () => refreshVoices(true);
}

function enqueueSpeech(text) {
  if (!state.ui.voiceEnabled || !text) return;
  const now = Date.now();
  if (state.ui.lastSpoken === text && now - state.ui.lastSpokenAt < 2500) return;
  state.ui.speechQueue.push(text);
  processSpeechQueue();
}
function processSpeechQueue() {
  if (state.ui.speaking || !state.ui.speechQueue.length || !('speechSynthesis' in window)) return;
  const text = state.ui.speechQueue.shift();
  const u = new SpeechSynthesisUtterance(text);
  const voice = state.ui.voices.find(v => v.name === state.ui.selectedVoice) || state.ui.voices.find(v => /^es/i.test(v.lang)) || state.ui.voices[0];
  if (voice) u.voice = voice;
  u.lang = voice?.lang || 'es-ES';
  u.rate = 1; u.pitch = 1; u.volume = 1;
  state.ui.speaking = true;
  state.ui.lastSpoken = text;
  state.ui.lastSpokenAt = Date.now();
  u.onend = () => { state.ui.speaking = false; processSpeechQueue(); };
  u.onerror = () => { state.ui.speaking = false; processSpeechQueue(); };
  speechSynthesis.speak(u);
}
async function testVoice() {
  refreshVoices();
  enqueueSpeech('Prueba de voz lista. Próximo aviso: nivel once, subida en treinta segundos.');
  addLog('Prueba de voz reproducida');
}
async function requestNotifPermission() {
  if (!('Notification' in window)) throw new Error('Notification API no disponible');
  const p = await Notification.requestPermission();
  addLog(`Permiso de notificaciones: ${p}`);
}
async function sendAppNotification(title, body) {
  if (!state.ui.notifEnabled) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  addLog(`Notificación móvil: ${title} · ${body}`);
  if (navigator.serviceWorker?.ready) {
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, { body, tag: `e${state.ui.nextNotificationId++}`, badge: './icon-192.png', icon: './icon-192.png' });
      return;
    } catch {}
  }
  try { new Notification(title, { body }); } catch {}
}
async function testNotification() { await sendAppNotification(APP_NAME, 'Notificación de prueba lanzada'); addLog('Notificación de prueba lanzada'); }
function listNotifications() { NOTIF_CATALOG.forEach((n, i) => addLog(`Notif ${i+1}: ${n}`)); }

function getDisplayBpm() { return state.ble.displayBpm; }
function updateBleDerived() {
  state.ble.displayBpm = avgBpm(5) ?? (state.ble.rawBpm == null ? null : Number(state.ble.rawBpm));
}
function avgBpm(windowSec) {
  const now = Date.now();
  const list = state.ble.samples.filter(s => now - s.ts <= windowSec * 1000);
  if (!list.length) return null;
  let values = list.map(s => s.rr ? 60000 / s.rr : s.bpm);
  const avg = values.reduce((a,b)=>a+b,0) / values.length;
  return round1(avg);
}
async function connectBle() {
  if (!navigator.bluetooth) throw new Error('Web Bluetooth no disponible');
  const device = await navigator.bluetooth.requestDevice({ filters: [{ services: ['heart_rate'] }], optionalServices: ['battery_service'] });
  device.addEventListener('gattserverdisconnected', onBleDisconnected);
  state.ble.device = device;
  const server = await device.gatt.connect();
  state.ble.server = server;
  const service = await server.getPrimaryService('heart_rate');
  const hrChar = await service.getCharacteristic('heart_rate_measurement');
  state.ble.hrChar = hrChar;
  await hrChar.startNotifications();
  hrChar.addEventListener('characteristicvaluechanged', onHeartRate);
  try {
    const battSvc = await server.getPrimaryService('battery_service');
    const battChar = await battSvc.getCharacteristic('battery_level');
    state.ble.battChar = battChar;
    state.ble.battery = (await battChar.readValue()).getUint8(0);
  } catch {}
  state.ble.connected = true;
  addLog(`BLE conectado: ${device.name || 'pulsómetro'}`);
  renderStatusChips();
}

async function disconnectBle() {
  try {
    state.ble.hrChar?.removeEventListener('characteristicvaluechanged', onHeartRate);
    state.ble.device?.gatt?.disconnect?.();
  } catch {}
  state.ble.connected = false;
  addLog('BLE desconectado manualmente');
  renderStatusChips();
}

function onBleDisconnected() { state.ble.connected = false; addLog('BLE desconectado'); renderStatusChips(); }
function onHeartRate(ev) {
  const v = ev.target.value;
  const flags = v.getUint8(0);
  const hr16 = flags & 0x1;
  let idx = 1;
  const bpm = hr16 ? v.getUint16(idx, true) : v.getUint8(idx); idx += hr16 ? 2 : 1;
  if (flags & 0x8) idx += 2; // energy expended
  let rr = null;
  if (flags & 0x10 && v.byteLength >= idx + 2) rr = Math.round(v.getUint16(idx, true) / 1024 * 1000);
  state.ble.rawBpm = bpm;
  state.ble.rrMs = rr;
  state.ble.lastPacketMs = Date.now();
  state.ble.packetCount += 1;
  state.ble.samples.push({ ts: Date.now(), bpm, rr });
  state.ble.samples = state.ble.samples.filter(s => Date.now() - s.ts <= 30000);
}

function getHrAlertState() {
  const bpm = getDisplayBpm();
  const obj = getBpmObjective(getSegmentAt(state.session.elapsedSec)?.level);
  if (!bpm || !obj) return null;
  if (bpm < obj[0]) return { cls:'warn', text:`Pulso bajo ${round1(obj[0]-bpm).toFixed(1)} ppm` };
  if (bpm > obj[1]) return { cls:'bad', text:`Pulso alto ${round1(bpm-obj[1]).toFixed(1)} ppm` };
  return { cls:'ok', text:`Pulso en objetivo ${obj[0]}-${obj[1]}` };
}
function getKcalAlertState() {
  const dev = getRealKcal(state.session.elapsedSec) - getPlanKcal(state.session.elapsedSec);
  if (Math.abs(dev) < 1) return { cls:'ok', text:'Kcal en plan' };
  return { cls: dev > 0 ? 'ok' : 'warn', text:`Kcal ${dev > 0 ? 'por encima' : 'por debajo'} ${Math.abs(round1(dev)).toFixed(1)}` };
}
function hasActiveAlert() {
  const hr = getHrAlertState();
  const kcal = getKcalAlertState();
  return !!(hr && hr.cls !== 'ok' || kcal && kcal.cls !== 'ok' || !state.ble.connected);
}

function handleAlerts(sec, prevSec) {
  if (!state.plan || prevSec < 0) return;
  const prev = prevSec, now = sec;
  const nextSeg = state.plan.segments.find(s => s.startSec > now);
  const currentSeg = getSegmentAt(now);
  if (state.ui.timeAlerts && nextSeg) {
    const remPrev = nextSeg.startSec - prev, remNow = nextSeg.startSec - now;
    [180,60,30,10].forEach(t => {
      if (crossed(remPrev, remNow, t)) {
        const action = nextSeg.level > (currentSeg?.level || nextSeg.level) ? 'subida' : nextSeg.level < (currentSeg?.level || nextSeg.level) ? 'bajada' : 'cambio';
        const unit = t >= 60 ? `${Math.round(t/60)} minuto${t===60?'':'s'}` : `${t} segundos`;
        const text = `Quedan ${unit} de tramo. Próximo ${nextSeg.isTest ? 'test ' : ''}${action} a nivel ${nextSeg.level}. Fin ${getFinishEtaText()}.`;
        enqueueSpeech(text);
        sendAppNotification('Cambio de tramo', text);
      }
    });
    [3,2,1].forEach(t => { if (crossed(remPrev, remNow, t)) beep(800 + t*80, .05); });
    if (crossed(remPrev, remNow, 0)) {
      const action = nextSeg.level > (currentSeg?.level || nextSeg.level) ? 'Subida' : nextSeg.level < (currentSeg?.level || nextSeg.level) ? 'Bajada' : 'Cambio';
      const text = `${nextSeg.isTest ? 'Test' : 'Cambio'} ahora. ${action} a nivel ${nextSeg.level}.`;
      enqueueSpeech(text); sendAppNotification('Cambio ahora', text);
    }
  }
  const nextWater = state.plan.waterSecs.find(w => w > now);
  if (state.ui.timeAlerts && nextWater != null) {
    const remPrev = nextWater - prev, remNow = nextWater - now;
    [180,60,30,10].forEach(t => {
      if (crossed(remPrev, remNow, t)) {
        const unit = t >= 60 ? `${Math.round(t/60)} minuto${t===60?'':'s'}` : `${t} segundos`;
        const text = t >= 30 ? `Quedan ${unit} para agua. Fin ${getFinishEtaText()}.` : `Agua en ${unit}.`;
        enqueueSpeech(text); sendAppNotification('Toma de agua', text);
      }
    });
    [3,2,1].forEach(t => { if (crossed(remPrev, remNow, t)) beep(660 + t*90, .05); });
    if (crossed(remPrev, remNow, 0)) { enqueueSpeech('Agua ahora.'); sendAppNotification('Agua ahora', 'Toca agua ahora'); }
  }
  if (state.ui.timeAlerts && now > 0 && now % 120 === 0) {
    const remainSeg = Math.max(0, (currentSeg?.endSec || now) - now);
    enqueueSpeech(`Quedan ${fmtSpeechTime(remainSeg)} de este tramo.`);
  }
  if (state.ui.timeAlerts && now > 0 && now % 300 === 0) {
    const remainTot = Math.max(0, state.plan.totalDurationSec - now);
    enqueueSpeech(`Quedan ${fmtSpeechTime(remainTot)} para terminar la elíptica. Fin ${getFinishEtaText()}.`);
  }
  if (state.ui.hrAlerts) {
    const bpm = getDisplayBpm();
    const obj = getBpmObjective(currentSeg?.level);
    if (bpm && obj && Date.now() - state.ui.hrAlertLastAt > 60000) {
      if (bpm < obj[0]) {
        state.ui.hrAlertLastAt = Date.now();
        const text = `Pulso por debajo del objetivo en ${round1(obj[0]-bpm).toFixed(1)} ppm. Objetivo ${obj[0]} a ${obj[1]}.`;
        enqueueSpeech(text); sendAppNotification('Pulso bajo', text); if (obj[0]-bpm >= 8) beep(520,.08);
      } else if (bpm > obj[1]) {
        state.ui.hrAlertLastAt = Date.now();
        const text = `Pulso por encima del objetivo en ${round1(bpm-obj[1]).toFixed(1)} ppm. Objetivo ${obj[0]} a ${obj[1]}.`;
        enqueueSpeech(text); sendAppNotification('Pulso alto', text); if (bpm-obj[1] >= 8) beep(980,.08);
      }
    }
  }
  if (state.ui.kcalAlerts) {
    const dev = getRealKcal(now) - getPlanKcal(now);
    if (Math.abs(dev) >= 4 && Date.now() - state.ui.kcalAlertLastAt > 120000) {
      state.ui.kcalAlertLastAt = Date.now();
      const text = `Kcal reales ${dev > 0 ? 'por encima' : 'por debajo'} del plan en ${Math.abs(round1(dev)).toFixed(1)} kcal. Tramo ${signed(getSegmentDeviation(now))}.`;
      enqueueSpeech(text); sendAppNotification('Kcal fuera del plan', text); beep(740,.08);
    }
  }
}
function crossed(prevRemain, nowRemain, t) { return prevRemain > t && nowRemain <= t; }
function fmtSpeechTime(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  if (m > 0 && s > 0) return `${m} minuto${m===1?'':'s'} y ${s} segundos`;
  if (m > 0) return `${m} minuto${m===1?'':'s'}`;
  return `${s} segundos`;
}

function persistState() {
  try {
    const payload = {
      plan: state.plan,
      session: state.session,
      chartlessHistory: state.chartlessHistory,
      ui: {
        voiceEnabled: state.ui.voiceEnabled, beepEnabled: state.ui.beepEnabled, notifEnabled: state.ui.notifEnabled,
        hrAlerts: state.ui.hrAlerts, kcalAlerts: state.ui.kcalAlerts, timeAlerts: state.ui.timeAlerts,
        selectedVoice: state.ui.selectedVoice, tickerSpeedSec: state.ui.tickerSpeedSec
      },
      savedAt: Date.now(),
      planText: el.planText?.value || ''
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    state.session.lastPersistMs = Date.now();
  } catch (e) { addLog(`Persist ERROR: ${e.message}`); }
}
function restoreState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.planText && el.planText) el.planText.value = data.planText;
    if (data.plan) state.plan = data.plan;
    if (data.session) Object.assign(state.session, data.session);
    if (data.chartlessHistory) state.chartlessHistory = data.chartlessHistory;
    if (data.ui) Object.assign(state.ui, data.ui);
    if (el.voiceSelect && state.ui.selectedVoice) el.voiceSelect.value = state.ui.selectedVoice;
    if (el.tickerSpeedRange && state.ui.tickerSpeedSec) { el.tickerSpeedRange.value = state.ui.tickerSpeedSec; applyTickerSpeed(); }
    document.getElementById('voiceToggle').checked = state.ui.voiceEnabled;
    document.getElementById('beepToggle').checked = state.ui.beepEnabled;
    document.getElementById('notifToggle').checked = state.ui.notifEnabled;
    document.getElementById('hrAlertsToggle').checked = state.ui.hrAlerts;
    document.getElementById('kcalAlertsToggle').checked = state.ui.kcalAlerts;
    document.getElementById('timeAlertsToggle').checked = state.ui.timeAlerts;
    if (data.savedAt && state.session.phase === 'running' && state.plan) {
      const delta = Math.floor((Date.now() - data.savedAt)/1000);
      state.session.elapsedBeforeSec = Math.min(state.plan.totalDurationSec, state.session.elapsedBeforeSec + delta);
      state.session.phase = 'paused';
      state.session.autoRecovered = true;
      addLog('Sesión recuperada desde guardado local');
    }
    if (state.plan) setText(el.previewBox, buildNormalizedText(state.plan));
  } catch (e) { addLog(`Restore ERROR: ${e.message}`); }
}

function applyTickerSpeed() {
  document.documentElement.style.setProperty('--tickerSpeed', `${state.ui.tickerSpeedSec}s`);
  setText(el.tickerSpeedValue, `${state.ui.tickerSpeedSec}s`);
}

async function copyTextSafe(text) {
  if (!text?.trim()) throw new Error('No hay texto para copiar');
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch {}
  const ta = document.createElement('textarea'); ta.value = text; ta.style.position='fixed'; ta.style.left='-9999px'; document.body.appendChild(ta); ta.select();
  const ok = document.execCommand('copy'); document.body.removeChild(ta);
  if (!ok) throw new Error('No se pudo copiar');
  return true;
}
function downloadText(filename, content, mime='text/plain;charset=utf-8') {
  const blob = new Blob(['\uFEFF' + content], { type: mime });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),500);
}
function exportSecondCsv() {
  if (!state.chartlessHistory.secondRows.length) throw new Error('No hay datos segundo a segundo');
  const rows = ['seg;clock;level;tramo;kcalPlan;kcalReal;bpm;timestamp'];
  state.chartlessHistory.secondRows.forEach(r => rows.push(`${r.sec};${r.clock};${r.level};${r.tramo};${r.kcalPlan};${r.kcalReal};${r.bpm};${r.ts}`));
  downloadText(`sesion_${APP_VERSION}.csv`, rows.join('\r\n'), 'text/csv;charset=utf-8');
  addLog('Sesión exportada');
}
function exportMinuteCsv() {
  if (!state.chartlessHistory.minuteRows.length) throw new Error('No hay datos minuto a minuto todavía');
  const rows = ['minute;clock;level;tramo;kcalPlan;kcalReal;bpmAvg'];
  state.chartlessHistory.minuteRows.forEach(r => rows.push(`${r.minute};${r.clock};${r.level};${r.tramo};${r.kcalPlan};${r.kcalReal};${r.bpmAvg}`));
  downloadText(`minutos_${APP_VERSION}.csv`, rows.join('\r\n'), 'text/csv;charset=utf-8');
  addLog('Exportado minuto a minuto');
}
function exportJson() {
  downloadText(`sesion_${APP_VERSION}.json`, JSON.stringify({ plan: state.plan, session: state.session, secondRows: state.chartlessHistory.secondRows, minuteRows: state.chartlessHistory.minuteRows }, null, 2), 'application/json;charset=utf-8');
  addLog('Sesión JSON exportada');
}
function exportPlanTxt() {
  const txt = el.planText.value || state.plan?.sourceText || '';
  if (!txt.trim()) throw new Error('No hay plan');
  downloadText(`plan_${APP_VERSION}.txt`, txt);
  addLog('Plan exportado');
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
