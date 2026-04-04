
(() => {
  const $ = id => document.getElementById(id);
  window.addEventListener('error', (e) => {
    try {
      const box = document.getElementById('logBox');
      if (box) {
        const div = document.createElement('div');
        div.className = 'logLine err';
        div.textContent = '[ERROR] ' + (e.message || 'Error JS');
        box.prepend(div);
      }
    } catch {}
  });
  window.addEventListener('unhandledrejection', (e) => {
    try {
      const box = document.getElementById('logBox');
      if (box) {
        const div = document.createElement('div');
        div.className = 'logLine err';
        div.textContent = '[PROMISE] ' + ((e.reason && e.reason.message) || e.reason || 'Promise rechazada');
        box.prepend(div);
      }
    } catch {}
  });

  const APP_VERSION = 'v45';
  const BUILD_HASH = 'build-v45';
  const BUILD_STAMP = '2026-04-04 12:45';
  const STORAGE_KEYS = {
    live:'eliptica_live_session_v2',
    plan:'eliptica_last_plan_v2',
    summary:'eliptica_last_summary_v2',
    tramo:'eliptica_last_tramo_summary_v1',
    compare:'eliptica_last_compare_v1',
    previous:'eliptica_previous_session_v1',
    settings:'eliptica_settings_v2'
  };

  const state = {
    plan: {
      rows: [], waters: [], waterTaken: [], testSegments: [], duration: 0, goal: 0,
      running: false, baseMachineSec: 0, t0: 0, timer: null, rafId: null,
      wakeLastTapMachine: 0, continueMode: { active:false, refMinute:0, refKcal:0 }, realKcalOffset: 0,
      sessionLog: [], minuteLog: [], sessionStartedAt: null,
      lastRecordedSecond: -1, lastRecordedMinute: -1, markers: [],
      bpmAppTargets: {}, bpmDayTargets: {}
    },
    ble: {
      connectionState: 'desconectado', device: null, server: null, hrChar: null,
      current: { bpm:null, contactSupported:null, contactDetected:null, rrCount:0, rrAverageMs:null, rrAverageBpmEstimado:null, rmssd:null, sdnn:null, batteryLevel:null, zone:null, signal:'--', receivedAt:null },
      samples: [], _hrListener:null, reconnectTimer:null, reconnectBackoffMs:2000, chooserPending:false, autoConnectAttempted:false, lastError:'', displayBpm:null
    },
    pwa: { deferredInstallPrompt: null, wakeLockSentinel: null },
    app: { boundButtons: {}, startupChecks: [], lastTapTsByKey: {} },
    settings: { browserNotify:false, voiceAlerts:true, beepAlerts:true, voiceName:'', voiceVolume:1, voiceRate:1, bannerDwellSec:5, blePreferredId:'', blePreferredName:'', alertKinds:{segmentPre:true, segmentNow:true, waterPre:true, waterNow:true, segRemain:true, allRemain:true, hr:true, kcal:true} },
    alerts: { fired:{}, queue:[], busy:false, audioCtx:null, lastHrWarnAt:0, lastKcalWarnAt:0, bannerMessages:[], bannerIdx:-1, bannerShownAt:0, bannerText:'SIN ALERTAS CRÍTICAS.' }
  };

  function log(msg, kind=''){
    const box = $('logBox');
    const div = document.createElement('div');
    div.className = 'logLine ' + kind;
    div.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
    box.prepend(div);
    while (box.children.length > 120) box.removeChild(box.lastChild);
  }


  function getDisplayPlanTitle(title){
    const raw = String(title || '').trim();
    if (!raw) return 'ELÍPTICA ' + APP_VERSION;
    if (/^ELÍPTICA\s+v\d+/i.test(raw)) return raw;
    if (/^ELÍPTICA/i.test(raw)) return raw.replace(/^ELÍPTICA/i, 'ELÍPTICA ' + APP_VERSION);
    return 'ELÍPTICA ' + APP_VERSION + ' · ' + raw;
  }
  async function copyAllLogs(){
    const lines = Array.from(document.querySelectorAll('#logBox .logLine')).map(el => el.textContent || '').reverse();
    if (!lines.length) throw new Error('No hay logs para copiar');
    const text = '[LOG COMPLETO ' + APP_VERSION + ' · ' + BUILD_STAMP + ']\n' + lines.join('\n');
    $('finalSummaryBox').value = text;
    try{ await copyTextSafe(text); log('Log completo copiado', 'ok'); $('pwaBanner').textContent='Log completo copiado.'; }
    catch(err){ downloadBlob(text, 'log_' + APP_VERSION + '.txt', 'text/plain;charset=utf-8'); log('Clipboard falló; log descargado como TXT', 'warn'); $('pwaBanner').textContent='Clipboard falló; log descargado.'; }
    return text;
  }
  function rerunDiagnostics(){
    log('[BTN rerunDiagnostics] Reejecutando comprobación total', 'ok');
    $('finalSummaryBox').value = 'VERIFICACIÓN TOTAL EN CURSO...';
    runStartupDiagnostics();
    const last = state.app.startupChecks[state.app.startupChecks.length-1];
    if (last) $('finalSummaryBox').value = 'VERIFICACIÓN TOTAL\n\nVERSIÓN: ' + APP_VERSION + '\nBUILD: ' + BUILD_STAMP + '\nOK: ' + last.ok + '\nFAIL: ' + last.fail + '\nBOTONES OK: ' + (last.boundOk||0) + '\nBOTONES FAIL: ' + (last.boundFail||0) + '\n\nREVISA EL LOG COMPLETO PARA DETALLES.';
  }

  function runDeepFunctionAudit(){
    const names = ['toggleRun','resetSession','parsePlanText','applyPlanText','previewImport','normalizeCurrentImport','connectBle','reconnectBle','disconnectBle','drawCompareChart','renderUI','saveLiveSession','loadLiveSession','runStartupDiagnostics','copyAllLogs'];
    let ok=0, fail=0;
    names.forEach(n=>{ const good = typeof window[n] === 'function' || typeof eval(n) === 'function'; log('[AUDIT] función ' + n + ': ' + (good?'ok':'fail'), good?'ok':'err'); if(good) ok++; else fail++; });
    log('[AUDIT] resumen funciones · ok=' + ok + ' · fail=' + fail, fail ? 'warn' : 'ok');
  }

  function parseBpmProfiles(src){
    const out = { appTargets:{}, dayTargets:{} };
    const text = String(src || '');
    const appRe = new RegExp('BPM\\s+OPERATIVO\\s+PARA\\s+LA\\s+APP([\\s\\S]*?)(?:\\n\\s*BPM\\s+DEL\\s+D[IÍ]A|\\n\\s*PRIORIDAD\\s+REAL|$)', 'i');
    const dayRe = new RegExp('BPM\\s+DEL\\s+D[IÍ]A[\\s\\S]*?REFERENCIA\\s+PR[ÁA]CTICA([\\s\\S]*?)(?:\\n\\s*PRIORIDAD\\s+REAL|$)', 'i');
    const appLineRe = new RegExp('Nivel\\s*(\\d{1,2})\\s*:\\s*(\\d{2,3})\\s*[–-]\\s*(\\d{2,3})\\s*bpm', 'gi');
    const dayLineRe = new RegExp('Nivel\\s*(\\d{1,2})[^\\n]*?:\\s*(\\d{2,3})\\s*[–-]\\s*(\\d{2,3})\\s*bpm', 'gi');
    const appBlock = appRe.exec(text);
    if (appBlock){
      for (const m of appBlock[1].matchAll(appLineRe)){
        out.appTargets[Number(m[1])] = { min:Number(m[2]), max:Number(m[3]) };
      }
    }
    const dayBlock = dayRe.exec(text);
    if (dayBlock){
      for (const m of dayBlock[1].matchAll(dayLineRe)){
        out.dayTargets[Number(m[1])] = { min:Number(m[2]), max:Number(m[3]) };
      }
    }
    return out;
  }

  function ensureSettingsDefaults(){
    const defs = {segmentPre:true, segmentNow:true, waterPre:true, waterNow:true, segRemain:true, allRemain:true, hr:true, kcal:true};
    if (!state.settings.alertKinds || typeof state.settings.alertKinds !== 'object') state.settings.alertKinds = {};
    Object.keys(defs).forEach(k => { if (typeof state.settings.alertKinds[k] !== 'boolean') state.settings.alertKinds[k] = defs[k]; });
    if (!Number.isFinite(Number(state.settings.bannerDwellSec))) state.settings.bannerDwellSec = 5;
    if (!('blePreferredId' in state.settings)) state.settings.blePreferredId = '';
    if (!('blePreferredName' in state.settings)) state.settings.blePreferredName = '';
  }
  function alertKindEnabled(name){ ensureSettingsDefaults(); return state.settings.alertKinds[name] !== false; }
  function setAlertKind(name, value){ ensureSettingsDefaults(); state.settings.alertKinds[name] = !!value; saveSettings(); }
  function saveSettings(){
    try{ localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(state.settings)); }catch{}
    renderSettingsUI();
  }
  function loadSettings(){
    try{
      const raw = localStorage.getItem(STORAGE_KEYS.settings);
      if (raw){
        const parsed = JSON.parse(raw);
        Object.assign(state.settings, parsed || {});
      }
    }catch{}
  }
  function renderSettingsUI(){
    ensureSettingsDefaults();
    if ($('browserNotifyChk')) $('browserNotifyChk').checked = !!state.settings.browserNotify;
    if ($('voiceAlertsChk')) $('voiceAlertsChk').checked = !!state.settings.voiceAlerts;
    if ($('beepAlertsChk')) $('beepAlertsChk').checked = !!state.settings.beepAlerts;
    if ($('voiceVolumeRange')) $('voiceVolumeRange').value = String(state.settings.voiceVolume ?? 1);
    if ($('voiceRateRange')) $('voiceRateRange').value = String(state.settings.voiceRate ?? 1);
    if ($('voiceVolumeVal')) $('voiceVolumeVal').textContent = Number(state.settings.voiceVolume ?? 1).toFixed(1);
    if ($('voiceRateVal')) $('voiceRateVal').textContent = Number(state.settings.voiceRate ?? 1).toFixed(2);
    if ($('bannerSpeedRange')) $('bannerSpeedRange').value = String(Math.max(2, Math.min(10, Number(state.settings.bannerDwellSec ?? 5))));
    if ($('bannerSpeedVal')) $('bannerSpeedVal').textContent = Math.max(2, Math.min(10, Number(state.settings.bannerDwellSec ?? 5))).toFixed(0) + ' s';
    const sel = $('voiceSelect');
    const voices = (window.speechSynthesis && speechSynthesis.getVoices ? speechSynthesis.getVoices() : []) || [];
    if (sel){
      sel.innerHTML = '<option value="">Voz del sistema</option>' + voices.map(v => '<option value="' + String(v.name).replace(/"/g,'&quot;') + '">' + v.name + ' · ' + (v.lang || '--') + '</option>').join('');
      sel.value = state.settings.voiceName || '';
    }
    if ($('voiceStatus')) $('voiceStatus').textContent = voices.length ? ('Voces detectadas: ' + voices.length + (state.settings.voiceName ? ' · seleccionada: ' + state.settings.voiceName : ' · voz del sistema')) : 'No se detectaron voces todavía. Pulsa Recargar voces.';
    const map = {toggleSegmentPreChk:'segmentPre', toggleSegmentNowChk:'segmentNow', toggleWaterPreChk:'waterPre', toggleWaterNowChk:'waterNow', toggleSegRemainChk:'segRemain', toggleAllRemainChk:'allRemain', toggleHrChk:'hr', toggleKcalChk:'kcal'};
    Object.entries(map).forEach(([id,key]) => { const el=$(id); if (el) el.checked = !!state.settings.alertKinds[key]; });
  }
  async function requestBrowserNotifications(){
    if (!('Notification' in window)) throw new Error('Este navegador no soporta notificaciones web');
    const perm = await Notification.requestPermission();
    log('Permiso de notificaciones: ' + perm, perm === 'granted' ? 'ok' : 'warn');
    if (perm === 'granted') state.settings.browserNotify = true;
    saveSettings();
    return perm;
  }
  async function sendBrowserNotification(title, body, tag){
    if (!state.settings.browserNotify) return false;
    if (!('Notification' in window) || Notification.permission !== 'granted') return false;
    try{ new Notification(title, { body, tag, renotify:false, silent:false }); return true; }catch(err){ log('No se pudo lanzar notificación: ' + ((err&&err.message)||err), 'warn'); return false; }
  }

  async function refreshVoicesAction(){
    renderSettingsUI();
    const voices = (window.speechSynthesis && speechSynthesis.getVoices ? speechSynthesis.getVoices() : []) || [];
    log('Voces detectadas: ' + voices.length, voices.length ? 'ok' : 'warn'); renderSettingsUI();
  }
  async function listVoicesAction(){
    const voices = (window.speechSynthesis && speechSynthesis.getVoices ? speechSynthesis.getVoices() : []) || [];
    if (!voices.length){ log('No hay voces detectadas todavía', 'warn'); return; }
    voices.forEach((v,i) => log('Voz ' + (i+1) + ': ' + v.name + ' · ' + (v.lang || '--') + (v.default ? ' · default' : '') + (v.localService ? ' · local' : ''), 'ok'));
  }
  async function listNotifAction(){
    [
      'Notificación: Cambio de tramo',
      'Notificación: Toma de agua',
      'Notificación: Pulso fuera de objetivo',
      'Notificación: Kcal fuera de plan',
      'Notificación: Prueba manual'
    ].forEach(t => log(t, 'ok'));
  }
  async function testVoiceAction(){
    renderSettingsUI();
    enqueueCue({ key:'manual-voice-test-' + Date.now(), type:'speech', text:'Prueba de voz lista. Próximo aviso útil: subida a nivel 11 en 30 segundos. Agua en 1 minuto. Quedan 5 minutos de elíptica.' });
    log('Prueba de voz encolada', 'ok');
  }
  async function testNotifyAction(){
    const ok = await sendBrowserNotification('Eliptica PWA ' + APP_VERSION, 'Notificación de prueba. Si Android y Mi Fitness la replican, debería llegar al reloj.', 'test-notify');
    log(ok ? 'Notificación de prueba lanzada' : 'No se pudo lanzar la notificación de prueba', ok ? 'ok' : 'warn');
  }
  function closeTestModal(){ const m=$('testModal'); if (m) m.classList.add('hidden'); }
  async function saveTestCaptureAndContinue(){
    const payload = {
      avgHr: $('testAvgHr')?.value || '', lastMinuteHr: $('testLastMinuteHr')?.value || '', maxHr: $('testMaxHr')?.value || '',
      dominantZone: $('testDominantZone')?.value || '', kcalPlan: $('testPlanKcal')?.value || '', kcalReal: $('testRealKcal')?.value || '',
      rpe: $('testRpe')?.value || '', chain: $('testChainPain')?.value || '', tibial: $('testTibialPain')?.value || '', notes: $('testNotes')?.value || ''
    };
    state.plan.lastTestCapture = payload;
    addMarker('test guardado');
    closeTestModal();
    log('Test guardado y continuado', 'ok');
    if (!state.plan.running && state.plan.rows.length){ toggleRun(); }
  }
  function ensureAudioCtx(){
    if (!state.alerts.audioCtx){
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) state.alerts.audioCtx = new Ctx();
    }
    return state.alerts.audioCtx;
  }
  function beepSequence(count){
    return new Promise(resolve => {
      try{
        const ctx = ensureAudioCtx();
        if (!ctx){ resolve(); return; }
        if (ctx.state === 'suspended') ctx.resume().catch(()=>{});
        const start = ctx.currentTime + 0.02;
        for (let i=0;i<count;i++){
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine'; osc.frequency.value = 880;
          gain.gain.value = 0.0001;
          osc.connect(gain); gain.connect(ctx.destination);
          const t0 = start + i*0.22;
          gain.gain.setValueAtTime(0.0001, t0);
          gain.gain.exponentialRampToValueAtTime(0.12, t0 + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
          osc.start(t0); osc.stop(t0 + 0.14);
        }
        setTimeout(resolve, count * 220 + 150);
      }catch(err){ resolve(); }
    });
  }
  function enqueueCue(cue){
    if (!cue || !cue.key) return;
    if (state.alerts.fired[cue.key]) return;
    state.alerts.fired[cue.key] = Date.now();
    state.alerts.queue.push(cue);
    runCueQueue();
  }
  async function runCueQueue(){
    if (state.alerts.busy || !state.alerts.queue.length) return;
    state.alerts.busy = true;
    const cue = state.alerts.queue.shift();
    try{
      if (cue.notifyTitle) await sendBrowserNotification(cue.notifyTitle, cue.notifyBody || cue.text || '', cue.key);
      if (cue.type === 'speech'){
        if (state.settings.voiceAlerts && window.speechSynthesis){
          const utter = new SpeechSynthesisUtterance(cue.text || '');
          utter.lang = 'es-ES';
          utter.volume = Number(state.settings.voiceVolume ?? 1);
          utter.rate = Number(state.settings.voiceRate ?? 1);
          const voices = speechSynthesis.getVoices ? speechSynthesis.getVoices() : [];
          const chosen = voices.find(v => v.name === state.settings.voiceName);
          if (chosen) utter.voice = chosen;
          await new Promise(resolve => { utter.onend = resolve; utter.onerror = resolve; speechSynthesis.speak(utter); });
        }
      } else if (cue.type === 'beep'){
        if (state.settings.beepAlerts) await beepSequence(cue.count || 1);
      }
    }catch(err){ log('Error en cola de avisos: ' + ((err&&err.message)||err), 'warn'); }
    finally{ state.alerts.busy = false; if (state.alerts.queue.length) setTimeout(runCueQueue, 10); }
  }
  function nextWindowAfterCurrent(){
    const t = machineElapsed();
    const windows = buildSegmentWindows();
    const idx = windows.findIndex(w => t >= w.start && t < w.end - 1e-9);
    return idx >= 0 ? (windows[idx+1] || null) : null;
  }

function queueSegmentCues(){
  if (!state.plan.running || !state.plan.rows.length) return;
  const t = machineElapsed();
  const prevT = Math.max(0, t - 1);
  const windows = buildSegmentWindows();
  const current = windows.find(w => t >= w.start && t < w.end - 1e-9);
  const prev = windows.find(w => prevT >= w.start && prevT < w.end - 1e-9) || null;
  if (!current) return;
  const next = windows.find(w => w.start > t + 1e-9) || null;
  const remainSeg = Math.max(0, Math.ceil(current.end - t));
  const prevRemainSeg = Math.max(0, Math.ceil(current.end - prevT));
  const remainAll = Math.max(0, Math.ceil((state.plan.duration || 0) - t));
  const prevRemainAll = Math.max(0, Math.ceil((state.plan.duration || 0) - prevT));
  const changeKind = next ? (next.level > current.level ? 'subida' : (next.level < current.level ? 'bajada' : 'cambio')) : 'fin';
  const nextLabel = next ? ('nivel ' + next.level) : 'fin';
  const speechThresholds = [180,60,30,10];
  speechThresholds.forEach(th => {
    if (alertKindEnabled('segmentPre') && prevRemainSeg > th && remainSeg <= th){
      const leftSeg = fmtSpeechDuration(remainSeg);
      const leftAll = fmtSpeechDuration(remainAll);
      const text = th >= 60
        ? ('Quedan ' + fmtSpeechDuration(th) + ' para terminar el tramo ' + current.seg + '. Después ' + (next && next.isTest ? 'test, ' : '') + changeKind + ' a ' + nextLabel + '. Quedan ' + leftAll + ' de elíptica.')
        : ('En ' + fmtSpeechDuration(th) + ' termina el tramo ' + current.seg + '. Después ' + (next && next.isTest ? 'test, ' : '') + changeKind + ' a ' + nextLabel + '.');
      enqueueCue({ key:'seg-' + current.seg + '-' + th, type:'speech', text, notifyTitle:'Cambio de tramo', notifyBody:text });
    }
  });
  if (alertKindEnabled('segmentNow') && prev && prev.seg !== current.seg && current.start > 0){
    const text = (current.isTest ? 'Test ahora. ' : 'Cambio ahora. ') + (current.level > prev.level ? 'Subida a ' : (current.level < prev.level ? 'Bajada a ' : 'Cambio a ')) + 'nivel ' + current.level + '. Tramo ' + current.seg + '. Quedan ' + fmtSpeechDuration(Math.ceil(current.end - t)) + ' de este tramo.';
    enqueueCue({ key:'seg-now-' + current.seg + '-' + Math.floor(current.start), type:'speech', text, notifyTitle:'Cambio ahora', notifyBody:text });
  }
  [3,2,1].forEach(th => { if (alertKindEnabled('segmentNow') && prevRemainSeg > th && remainSeg <= th) enqueueCue({ key:'segbeep-' + current.seg + '-' + th, type:'beep', count:1 }); });
  const futureWaters = state.plan.waters.filter((w,i)=>!state.plan.waterTaken[i]);
  const nextWater = futureWaters.find(w => w > t + 1e-9);
  if (Number.isFinite(nextWater)){
    const remainWater = Math.max(0, Math.ceil(nextWater - t));
    const prevRemainWater = Math.max(0, Math.ceil(nextWater - prevT));
    [180,60,30,10].forEach(th => {
      if (alertKindEnabled('waterPre') && prevRemainWater > th && remainWater <= th){
        const text = th >= 60 ? ('Quedan ' + fmtSpeechDuration(th) + ' para la siguiente toma de agua. Quedan ' + fmtSpeechDuration(remainAll) + ' para terminar la elíptica.') : ('Agua en ' + fmtSpeechDuration(th) + '. Prepárate para dos o tres sorbos.');
        enqueueCue({ key:'water-' + nextWater + '-' + th, type:'speech', text, notifyTitle:'Toma de agua', notifyBody:text });
      }
    });
    [3,2,1].forEach(th => { if (alertKindEnabled('waterPre') && prevRemainWater > th && remainWater <= th) enqueueCue({ key:'waterbeep-' + nextWater + '-' + th, type:'beep', count:1 }); });
  }
  if (alertKindEnabled('waterNow')){
    state.plan.waters.forEach((w, idx) => {
      if (!state.plan.waterTaken[idx] && prevT < w && t >= w){
        const text = 'Agua ahora. Dos o tres sorbos y vuelve rápido a la cadencia. Quedan ' + fmtSpeechDuration(remainAll) + ' de elíptica.';
        enqueueCue({ key:'water-now-' + idx + '-' + Math.floor(w), type:'speech', text, notifyTitle:'Agua ahora', notifyBody:text });
      }
    });
  }
  if (alertKindEnabled('segRemain') && Math.floor(t) > 0 && prevRemainSeg !== remainSeg && remainSeg > 0 && remainSeg % 120 === 0){
    enqueueCue({ key:'segremain-' + current.seg + '-' + remainSeg, type:'speech', text:'Tramo ' + current.seg + ', nivel ' + current.level + '. Quedan ' + fmtSpeechDuration(remainSeg) + ' de este tramo.' });
  }
  if (alertKindEnabled('allRemain') && Math.floor(t) > 0 && prevRemainAll !== remainAll && remainAll > 0 && remainAll % 300 === 0){
    enqueueCue({ key:'allremain-' + remainAll, type:'speech', text:'Quedan ' + fmtSpeechDuration(remainAll) + ' para terminar la elíptica.' });
  }
}

function maybeQueueRealtimeAlerts(){
  if (!state.plan.running || !state.plan.rows.length) return;
  const t = machineElapsed();
  const ps = getPlanState();
  const bpm = Number(state.ble.current.bpm);
  const now = Date.now();
  if (alertKindEnabled('hr') && Number.isFinite(bpm) && ps && ps.bpmTarget){
    const lo = ps.bpmTarget.min, hi = ps.bpmTarget.max;
    if ((bpm < lo || bpm > hi) && now - (state.alerts.lastHrWarnAt || 0) >= 60000){
      const diff = Math.round(bpm < lo ? (lo - bpm) : (bpm - hi));
      const text = bpm < lo ? ('Pulso por debajo del objetivo en ' + diff + ' pulsaciones. Objetivo ' + lo + ' a ' + hi + '. Prioridad técnica y cadencia.') : ('Pulso por encima del objetivo en ' + diff + ' pulsaciones. Objetivo ' + lo + ' a ' + hi + '. Afloja un poco y estabiliza.');
      enqueueCue({ key:'hr-' + Math.floor(now/60000), type:'speech', text, notifyTitle:'Pulso fuera de objetivo', notifyBody:text });
      if (state.settings.beepAlerts && diff >= 8) enqueueCue({ key:'hrbeep-' + Math.floor(now/60000), type:'beep', count:1 });
      state.alerts.lastHrWarnAt = now;
    }
  }
  const live = calcLiveDerivedMetrics();
  const delta = live.totalDelta;
  if (alertKindEnabled('kcal') && Math.abs(delta) >= 4 && now - (state.alerts.lastKcalWarnAt || 0) >= 120000){
    const text = 'Desvío total de kcal ' + (delta > 0 ? 'por encima' : 'por debajo') + ' del plan en ' + Math.abs(delta).toFixed(1) + ' kcal. En este tramo vas ' + (live.segmentDelta > 0 ? '+' : '') + live.segmentDelta.toFixed(1) + ' kcal.';
    enqueueCue({ key:'kcal-' + Math.floor(now/120000), type:'speech', text, notifyTitle:'Kcal fuera de plan', notifyBody:text });
    if (state.settings.beepAlerts) enqueueCue({ key:'kcalbeep-' + Math.floor(now/120000), type:'beep', count:1 });
    state.alerts.lastKcalWarnAt = now;
  }
}

function fmtTime(sec){ sec = Math.max(0, Math.floor(sec)); return String(Math.floor(sec/60)).padStart(2,'0') + ':' + String(sec%60).padStart(2,'0'); }
  function fmtMs(ms){ return (ms == null || !isFinite(ms)) ? '--' : fmtTime(ms/1000); }
  function num(v, d=1){ return (v == null || !isFinite(v)) ? '--' : Number(v).toFixed(d); }
  function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
  function parseTime(str){ const m = /^\s*(\d{1,3}):(\d{2})\s*$/.exec(String(str||'')); return m ? parseInt(m[1],10)*60 + parseInt(m[2],10) : null; }
  function realToMachine(realSec){ return realSec * 0.989307671745; }
  function machineToReal(machineSec){ return machineSec / 0.989307671745; }

  function parseImportText(text){
    const src = String(text || '').replace(/\u00A0/g, ' ');
    const lines = src.split(/\r?\n/);
    const cleanLines = lines.map(s => s.trim()).filter(Boolean);

    const waters = [...src.matchAll(/(?:^|\n)\s*Min(?:uto)?\s+(\d{1,3}:\d{2})\s*$/gim)]
      .map(m => parseTime(m[1]))
      .filter(v => v != null)
      .sort((a,b) => a - b);

    const title = cleanLines.find(s => /EL[IÍ]PTICA|TEST/i.test(s))
      || cleanLines.find(s => !/^(?:A\)|B\)|C\)|D\)|E\)|F\)|G\)|H\)|I\)|J\)|Minuto|tiempo\b|kcal\b|nivel\b|tramo\b)/i.test(s))
      || 'Plan cargado';

    const parsedTableRows = [];
    for (const rawLine of lines){
      const line = rawLine.trim();
      if (!line) continue;
      let m = /^(\d{1,3}:\d{2})\s*[\t ]+([\d.,]+)\s*[\t ]+([\d.,]+)\s*[\t ]+(\d{1,2})\s*[\t ]+([A-Z])\s*$/i.exec(line);
      if (!m) m = /^(\d{1,3}:\d{2})\s+([\d.,]+)\s+([\d.,]+)\s+(\d{1,2})\s+([A-Z])\s*$/i.exec(line);
      if (!m) continue;
      const t = parseTime(m[1]);
      const kcalTotal = parseFloat(String(m[2]).replace(',', '.'));
      const kcalStep = parseFloat(String(m[3]).replace(',', '.'));
      const level = parseInt(m[4], 10);
      const seg = String(m[5]).trim().toUpperCase();
      if (t != null && isFinite(kcalTotal) && isFinite(kcalStep) && isFinite(level)) parsedTableRows.push({ t, kcalTotal, kcalStep, level, seg });
    }
    if (parsedTableRows.length){
      parsedTableRows.sort((a,b) => a.t - b.t);
      const bpmProfiles = parseBpmProfiles(src);
      return { title, rows: parsedTableRows, waters, testSegments: [], bpmAppTargets:bpmProfiles.appTargets, bpmDayTargets:bpmProfiles.dayTargets };
    }

    const totalInfoMatch = src.match(/EL[IÍ]PTICA[^\n]*?\b(\d{1,3}:\d{2})\b[^\n]*?~?\s*([\d.,]+)\s*kcal/mi);
    const totalDurationHint = totalInfoMatch ? parseTime(totalInfoMatch[1]) : null;
    const totalGoalHint = totalInfoMatch ? parseFloat(String(totalInfoMatch[2]).replace(',', '.')) : null;

    const segDefs = [];
    for (let i = 0; i < lines.length; i++){
      const line = lines[i].trim();
      const m = /^([A-Z])\)\s*(\d{1,3}:\d{2})\s*(?:[·•\-–—]|->|→)?\s*(TEST\s+)?NIVEL\s*(\d{1,2})(?:\s*(?:[·•\-–—]|->|→)?\s*~?\s*([\d.,]+)\s*kcal)?/i.exec(line);
      if (!m) continue;
      const seg = m[1].toUpperCase();
      const durationSec = parseTime(m[2]);
      const isTestSeg = !!m[3] || /\bTEST\b/i.test(line);
      const level = parseInt(m[4], 10);
      let kcalStep = m[5] ? parseFloat(String(m[5]).replace(',', '.')) : null;
      if (!isFinite(kcalStep)) kcalStep = null;
      for (let j = i + 1; kcalStep == null && j <= i + 2 && j < lines.length; j++){
        const probe = lines[j].trim();
        const km = /(?:objetivo\s*)?~?\s*([\d.,]+)\s*kcal/i.exec(probe);
        if (km){
          const v = parseFloat(String(km[1]).replace(',', '.'));
          if (isFinite(v)) kcalStep = v;
        }
      }
      if (durationSec != null && isFinite(level)) segDefs.push({ seg, durationSec, level, kcalStep, isTest:isTestSeg });
    }

    if (!segDefs.length){ const bpmProfiles = parseBpmProfiles(src); return { title, rows: [], waters, testSegments: [], bpmAppTargets:bpmProfiles.appTargets, bpmDayTargets:bpmProfiles.dayTargets }; }

    const knownRatesByLevel = new Map();
    const knownAll = [];
    for (const seg of segDefs){
      if (seg.kcalStep != null && seg.durationSec > 0){
        const rate = seg.kcalStep / seg.durationSec;
        knownAll.push(rate);
        if (!knownRatesByLevel.has(seg.level)) knownRatesByLevel.set(seg.level, []);
        knownRatesByLevel.get(seg.level).push(rate);
      }
    }
    const avg = arr => arr.length ? arr.reduce((a,b)=>a+b,0) / arr.length : null;
    const globalRate = avg(knownAll)
      || (isFinite(totalGoalHint) && isFinite(totalDurationHint) && totalDurationHint > 0 ? totalGoalHint / totalDurationHint : null)
      || 0;

    let missingDuration = 0, knownKcal = 0;
    for (const seg of segDefs){
      if (seg.kcalStep == null) missingDuration += seg.durationSec;
      else knownKcal += seg.kcalStep;
    }
    for (const seg of segDefs){
      if (seg.kcalStep != null) continue;
      const rate = avg(knownRatesByLevel.get(seg.level) || [])
        || ((isFinite(totalGoalHint) && totalGoalHint > knownKcal && missingDuration > 0) ? (totalGoalHint - knownKcal) / missingDuration : globalRate)
        || 0;
      seg.kcalStep = Number((rate * seg.durationSec).toFixed(1));
    }

    let t = 0, kcalTotal = 0;
    const rows = [];
    for (const seg of segDefs){
      rows.push({ t, kcalTotal: Number(kcalTotal.toFixed(1)), kcalStep: Number((seg.kcalStep || 0).toFixed(1)), level: seg.level, seg: seg.seg });
      t += seg.durationSec;
      kcalTotal += seg.kcalStep || 0;
    }
    const lastSeg = segDefs[segDefs.length - 1];
    rows.push({ t, kcalTotal: Number(kcalTotal.toFixed(1)), kcalStep: Number((lastSeg?.kcalStep || 0).toFixed(1)), level: lastSeg?.level || null, seg: lastSeg?.seg || '' });
    if (isFinite(totalDurationHint) && Math.abs(rows[rows.length - 1].t - totalDurationHint) <= 2) rows[rows.length - 1].t = totalDurationHint;
    if (isFinite(totalGoalHint) && Math.abs(rows[rows.length - 1].kcalTotal - totalGoalHint) <= 2) rows[rows.length - 1].kcalTotal = Number(totalGoalHint.toFixed(1));
    const bpmProfiles = parseBpmProfiles(src);
    return { title, rows, waters, testSegments: segDefs.filter(seg => seg.isTest).map(seg => seg.seg), bpmAppTargets:bpmProfiles.appTargets, bpmDayTargets:bpmProfiles.dayTargets };
  }


  function buildImportIssues(parsed){
    if (!parsed || !parsed.rows || !parsed.rows.length) return ['No se encontraron filas válidas para importar.'];
    const issues = [];
    const rows = parsed.rows;
    const last = rows[rows.length - 1] || null;
    const totalDuration = last ? Number(last.t || 0) : 0;
    const totalGoal = last ? Number(last.kcalTotal || 0) : 0;
    if (rows.length < 2) issues.push('Hay muy pocas filas para una sesión útil.');
    for (let i = 1; i < rows.length; i++){
      if (!(rows[i].t > rows[i-1].t)) issues.push('La tabla tiene tiempos repetidos o desordenados cerca de ' + fmtTime(rows[i].t || 0) + '.');
    }
    const wins = [];
    for (let i = 1; i < rows.length; i++){
      const a = rows[i-1], b = rows[i];
      const seg = String(b.seg || a.seg || '').toUpperCase();
      const level = Number.isFinite(b.level) ? b.level : a.level;
      const duration = Math.max(0, (b.t || 0) - (a.t || 0));
      const kcal = Number((b.kcalTotal || 0) - (a.kcalTotal || 0));
      wins.push({ seg, level, duration, kcal });
      if (duration <= 0) issues.push('El tramo ' + seg + ' no tiene duración positiva.');
      if (kcal < 0) issues.push('El tramo ' + seg + ' tiene kcal decrecientes.');
    }
    const sumDur = wins.reduce((a,b)=>a+b.duration,0);
    const sumKcal = wins.reduce((a,b)=>a+b.kcal,0);
    if (Math.abs(sumDur - totalDuration) > 1) issues.push('La suma de tramos (' + fmtTime(sumDur) + ') no coincide con el total (' + fmtTime(totalDuration) + ').');
    if (Math.abs(sumKcal - totalGoal) > 0.6) issues.push('La suma de kcal por tramo (' + num(sumKcal,1) + ') no coincide con el total (' + num(totalGoal,1) + ').');
    const waters = (parsed.waters || []).filter(v => Number.isFinite(v));
    waters.forEach(w => { if (w < 0 || w > totalDuration) issues.push('Hay una toma de agua fuera del rango total: ' + fmtTime(w)); });
    if (!issues.length) issues.push('Sin incidencias detectadas.');
    return issues;
  }

  function renderImportPreview(parsed){
    const box = $('importPreviewBox');
    const issueBox = $('importIssuesBox');
    if (!box || !issueBox) return;
    if (!parsed || !parsed.rows || !parsed.rows.length){
      box.innerHTML = '<strong>Vista previa</strong>Sin analizar todavía.';
      issueBox.innerHTML = '<strong>Chequeo</strong>Sin incidencias.';
      return;
    }
    const rows = parsed.rows;
    const end = rows[rows.length - 1] || { t:0, kcalTotal:0 };
    const wins = [];
    for (let i = 1; i < rows.length; i++){
      const a = rows[i-1], b = rows[i];
      wins.push({
        seg: String(b.seg || a.seg || '').toUpperCase(),
        level: Number.isFinite(b.level) ? b.level : a.level,
        duration: Math.max(0, (b.t || 0) - (a.t || 0)),
        kcal: Number(((b.kcalTotal || 0) - (a.kcalTotal || 0)).toFixed(1))
      });
    }
    const lines = [
      '<strong>Vista previa</strong>' + (parsed.title || 'Plan cargado'),
      'Duración total: ' + fmtTime(end.t || 0),
      'Objetivo total: ' + num(end.kcalTotal || 0, 1) + ' kcal',
      'Tramos: ' + wins.length,
      'Agua: ' + ((parsed.waters || []).length ? (parsed.waters || []).map(fmtTime).join(' · ') : 'sin marcas')
    ];
    if (wins.length){
      lines.push('');
      wins.slice(0, 8).forEach(w => lines.push(w.seg + ') ' + fmtTime(w.duration) + ' · Nivel ' + w.level + ' · ~' + num(w.kcal,1) + ' kcal'));
      if (wins.length > 8) lines.push('… +' + (wins.length - 8) + ' tramos');
    }
    box.innerHTML = lines.join('<br>');
    const issues = buildImportIssues(parsed);
    issueBox.innerHTML = '<strong>Chequeo</strong>' + issues.map(s => String(s)).join('<br>');
  }

  function previewImport(){
    const parsed = parseImportText($('importBox')?.value || '');
    renderImportPreview(parsed);
    return parsed;
  }

  function normalizeCurrentImport(){
    const parsed = parseImportText($('importBox')?.value || '');
    renderImportPreview(parsed);
    if (!parsed || !parsed.rows || !parsed.rows.length){
      log('No hay nada válido que normalizar', 'warn');
      return;
    }
    const rows = parsed.rows;
    const last = rows[rows.length - 1] || { t:0, kcalTotal:0 };
    const out = [];
    out.push((parsed.title || 'ELÍPTICA') + ' · ' + fmtTime(last.t || 0) + ' · ~' + num(last.kcalTotal || 0, 1) + ' kcal');
    out.push('');
    for (let i = 1; i < rows.length; i++){
      const a = rows[i-1], b = rows[i];
      const seg = String(b.seg || a.seg || '').toUpperCase();
      const level = Number.isFinite(b.level) ? b.level : a.level;
      const duration = Math.max(0, (b.t || 0) - (a.t || 0));
      const kcal = Number(((b.kcalTotal || 0) - (a.kcalTotal || 0)).toFixed(1));
      out.push(seg + ') ' + fmtTime(duration) + ' · NIVEL ' + level);
      out.push('→ objetivo ~' + num(kcal,1) + ' kcal');
    }
    if ((parsed.waters || []).length){
      out.push('');
      parsed.waters.forEach(w => out.push('Minuto ' + fmtTime(w)));
    }
    out.push('');
    out.push('tiempo	kcal_total	kcal_tramo	nivel	tramo');
    rows.forEach(r => out.push(fmtTime(r.t || 0) + '	' + num(r.kcalTotal || 0,1) + '	' + num(r.kcalStep || 0,1) + '	' + (r.level ?? '') + '	' + (r.seg || '')));
    $('importBox').value = out.join('\n');
    renderImportPreview(parseImportText($('importBox').value));
    log('Plan normalizado', 'ok');
  }


  function drawCompareChart(){
    const cv = $('compareCanvas');
    const legend = $('chartLegend');
    if (!cv || !cv.getContext) return;
    const cssW = Math.max(320, Math.round(cv.clientWidth || 320));
    const cssH = Math.max(190, Math.round(cv.clientHeight || 240));
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    if (cv.width !== Math.round(cssW * dpr) || cv.height !== Math.round(cssH * dpr)){
      cv.width = Math.round(cssW * dpr);
      cv.height = Math.round(cssH * dpr);
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const pad = { l: 54, r: 22, t: 16, b: 30 };
    const plotW = Math.max(10, cssW - pad.l - pad.r);
    const plotH = Math.max(10, cssH - pad.t - pad.b);
    const nowT = Math.max(0, machineElapsed());
    const totalT = Math.max(1, state.plan.duration || 1);
    const windowSec = Math.min(totalT, Math.max(120, Math.ceil(plotW / 4)));
    const endT = clamp(nowT, 0, totalT);
    const startT = Math.max(0, endT - windowSec);

    let hist = (state.plan.sessionLog || [])
      .filter(r => Number.isFinite(r.second) && r.second >= Math.floor(startT) && r.second <= Math.ceil(endT))
      .map(r => ({ t:Number(r.second), plan:Number(r.kcalPlan || 0), real:Number((r.kcalReal ?? r.kcalPlan) || 0) }));

    if (!hist.length && state.plan.rows.length){
      for (let s = Math.floor(startT); s <= Math.floor(endT); s++){
        hist.push({ t:s, plan:Number(shownKcalAtTime(s).toFixed(1)), real:Number(shownRealKcalAtTime(s).toFixed(1)) });
      }
    }

    const nowPoint = { t:endT, plan:Number(shownKcalAtTime(endT).toFixed(1)), real:Number(shownRealKcalAtTime(endT).toFixed(1)) };
    if (!hist.length || Math.abs(hist[hist.length-1].t - nowPoint.t) > 0.001 || Math.abs(hist[hist.length-1].real - nowPoint.real) > 0.001 || Math.abs(hist[hist.length-1].plan - nowPoint.plan) > 0.001){
      hist.push(nowPoint);
    }

    if (!hist.length) hist = [{ t:0, plan:0, real:0 }];
    hist.sort((a,b) => a.t - b.t);

    const vals = hist.flatMap(p => [p.plan, p.real]).filter(v => Number.isFinite(v));
    let yMin = Math.min(...vals), yMax = Math.max(...vals);
    const spread = Math.max(0.6, yMax - yMin);
    const padY = Math.max(0.4, spread * 0.30);
    yMin -= padY;
    yMax += padY;
    if (Math.abs(yMax - yMin) < 2){ yMin -= 1; yMax += 1; }

    const xFor = t => pad.l + ((t - startT) / Math.max(1e-9, endT - startT || 1)) * plotW;
    const yFor = v => pad.t + (1 - ((v - yMin) / Math.max(1e-9, yMax - yMin))) * plotH;

    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.fillRect(pad.l, pad.t, plotW, plotH);
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 4; i++){
      const y = pad.t + (i / 4) * plotH;
      ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + plotW, y);
    }
    for (let i = 0; i <= 4; i++){
      const x = pad.l + (i / 4) * plotW;
      ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + plotH);
    }
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.font = '12px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++){
      const frac = i / 4;
      const v = yMax - frac * (yMax - yMin);
      const y = pad.t + frac * plotH;
      ctx.fillText(num(v,1), pad.l - 6, y);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let i = 0; i <= 4; i++){
      const frac = i / 4;
      const t = startT + frac * (endT - startT);
      const x = pad.l + frac * plotW;
      ctx.fillText(fmtTime(t), x, pad.t + plotH + 6);
    }

    const drawLine = (key, color, width) => {
      ctx.beginPath();
      hist.forEach((p, idx) => {
        const x = xFor(p.t), y = yFor(p[key]);
        if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    };
    drawLine('plan', '#d6d6d6', 2.2);
    drawLine('real', '#4ea8ff', 2.8);

    const nowX = xFor(nowPoint.t), yPlan = yFor(nowPoint.plan), yReal = yFor(nowPoint.real);
    ctx.strokeStyle = 'rgba(255,92,92,0.95)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(nowX, pad.t); ctx.lineTo(nowX, pad.t + plotH); ctx.stroke();

    ctx.fillStyle = '#d6d6d6';
    ctx.beginPath(); ctx.arc(nowX, yPlan, 3.8, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#4ea8ff';
    ctx.beginPath(); ctx.arc(nowX, yReal, 4.4, 0, Math.PI*2); ctx.fill();

    if (legend){
      legend.textContent = 'Plan ' + num(nowPoint.plan,1) + ' · Real ' + num(nowPoint.real,1) + ' · Histórico fijo ' + fmtTime(startT) + '–' + fmtTime(endT);
    }
  }

  function machineElapsed(){
    const p = state.plan;
    if (!p.running) return p.baseMachineSec;
    return clamp(p.baseMachineSec + realToMachine((performance.now() - p.t0) / 1000), 0, p.duration);
  }
  function shownMachineElapsed(){ const t = machineElapsed(); return state.plan.continueMode.active ? Math.max(0, t - state.plan.continueMode.refMinute) : t; }

  function idxByTime(t){
    const rows = state.plan.rows; if (!rows.length) return 0;
    let idx = 0; for (let i=0;i<rows.length;i++) if (rows[i].t <= t + 1e-9) idx = i; return idx;
  }

  function kcalAtTime(t){
    const rows = state.plan.rows;
    if (!rows.length) return 0;
    t = clamp(t, 0, state.plan.duration);
    if (t <= rows[0].t) return rows[0].t ? rows[0].kcalTotal * (t / rows[0].t) : 0;
    for (let i=1;i<rows.length;i++){
      const a = rows[i-1], b = rows[i];
      if (t <= b.t){
        const frac = (t - a.t) / Math.max(1e-9, b.t - a.t);
        return a.kcalTotal + (b.kcalTotal - a.kcalTotal) * frac;
      }
    }
    return rows[rows.length-1].kcalTotal;
  }
  function shownKcalAtTime(t){ const raw = kcalAtTime(t); return state.plan.continueMode.active ? Math.max(0, raw - state.plan.continueMode.refKcal) : raw; }
  function shownRealKcalAtTime(t){ return Math.max(0, shownKcalAtTime(t) + Number(state.plan.realKcalOffset || 0)); }
  function shownKcalDeltaAtTime(t){ return shownRealKcalAtTime(t) - shownKcalAtTime(t); }

  function machineTimeFromKcal(kcal){
    const rows = state.plan.rows; if (!rows.length) return null; if (kcal <= 0) return 0;
    for (let i=1;i<rows.length;i++){
      const a = rows[i-1], b = rows[i];
      if (kcal <= b.kcalTotal){
        const frac = (kcal - a.kcalTotal) / Math.max(1e-9, b.kcalTotal - a.kcalTotal);
        return a.t + (b.t - a.t) * frac;
      }
    }
    return state.plan.duration;
  }

  function getTestMainWindow(){
    const wins = buildSegmentWindows();
    return wins.find(w => !!w.isTest) || null;
  }

  function fmtShortDuration(sec){
    sec = Math.max(0, Math.round(Number(sec||0)));
    const m = Math.floor(sec / 60);
    const s2 = sec % 60;
    return s2 ? (m + ' min ' + s2 + ' s') : (m + ' min');
  }

  function safeSetText(id, value){ const el=$(id); if (el) el.textContent = value; return !!el; }
  function safeSetStyleColor(id, value){ const el=$(id); if (el) el.style.color = value; return !!el; }
  function getLoggedPointAtOrBefore(sec){
    const rows = state.plan.sessionLog || [];
    for (let i = rows.length - 1; i >= 0; i--){
      const r = rows[i];
      if (Number.isFinite(r.second) && r.second <= sec){
        return { second:r.second, kcalPlan:Number(r.kcalPlan || 0), kcalReal:Number((r.kcalReal ?? r.kcalPlan) || 0) };
      }
    }
    return null;
  }

  function calcLiveDerivedMetrics(){
    const tMachine = machineElapsed();
    const tReal = machineToReal(shownMachineElapsed());
    const kPlan = shownKcalAtTime(tMachine);
    const kReal = shownRealKcalAtTime(tMachine);
    const totalDelta = Number((kReal - kPlan).toFixed(1));
    const remainingRealSec = Math.max(0, machineToReal(state.plan.duration) - tReal);
    const remainingPlan = Math.max(0, state.plan.goal - kReal);
    const paceReal = tReal > 0 ? (kReal / (tReal / 60)) : 0;
    const paceNeed = remainingRealSec > 0 ? (remainingPlan / (remainingRealSec / 60)) : 0;
    const win = buildSegmentWindows().find(w => tMachine >= w.start && tMachine < w.end - 1e-9) || null;
    let segmentDelta = 0;
    let segmentPlanNow = 0;
    let segmentRealNow = 0;
    if (win){
      const startPoint = getLoggedPointAtOrBefore(Math.max(0, Math.floor(win.start))) || { kcalPlan:shownKcalAtTime(win.start), kcalReal:shownRealKcalAtTime(win.start) };
      segmentPlanNow = Number((kPlan - Number(startPoint.kcalPlan || 0)).toFixed(1));
      segmentRealNow = Number((kReal - Number(startPoint.kcalReal || 0)).toFixed(1));
      segmentDelta = Number((segmentRealNow - segmentPlanNow).toFixed(1));
    }
    const waterTotal = Array.isArray(state.plan.waters) ? state.plan.waters.length : 0;
    const waterTaken = Array.isArray(state.plan.waterTaken) ? state.plan.waterTaken.filter(Boolean).length : 0;
    return { tMachine, tReal, kPlan, kReal, totalDelta, paceReal, paceNeed, segmentDelta, segmentPlanNow, segmentRealNow, waterTaken, waterTotal, remainingPlan, remainingRealSec };
  }

  function fmtSpeechDuration(sec){
    sec = Math.max(0, Math.round(Number(sec||0)));
    const m = Math.floor(sec / 60);
    const s2 = sec % 60;
    if (m > 0 && s2 > 0) return m + ' minuto' + (m===1?'':'s') + ' y ' + s2 + ' segundo' + (s2===1?'':'s');
    if (m > 0) return m + ' minuto' + (m===1?'':'s');
    return s2 + ' segundo' + (s2===1?'':'s');
  }

  function fmtClockTime(ts){
    const d = ts instanceof Date ? ts : new Date(ts || Date.now());
    const hh = String(d.getHours()).padStart(2,'0');
    const mm = String(d.getMinutes()).padStart(2,'0');
    return hh + ':' + mm;
  }
  function currentClockText(){ return fmtClockTime(Date.now()); }
  function endEtaText(){
    try{
      const m = calcLiveDerivedMetrics();
      return 'FIN ' + fmtClockTime(Date.now() + Math.max(0, Number(m.remainingRealSec || 0)) * 1000);
    }catch{ return 'FIN --:--'; }
  }
  function displayBpmValue(){
    const avg5 = avgRecent(5000);
    const avg10 = avgRecent(10000);
    const cur = Number(state.ble.current.bpm);
    let base = Number.isFinite(avg5) ? avg5 : (Number.isFinite(avg10) ? avg10 : (Number.isFinite(cur) ? cur : null));
    if (!Number.isFinite(base)) return null;
    if (!Number.isFinite(state.ble.displayBpm)) state.ble.displayBpm = base;
    const target = Number.isFinite(cur) ? (0.65 * base + 0.35 * cur) : base;
    state.ble.displayBpm = state.ble.displayBpm + (target - state.ble.displayBpm) * 0.35;
    return state.ble.displayBpm;
  }
  function clearBleReconnectTimer(){
    try{ if (state.ble.reconnectTimer) clearTimeout(state.ble.reconnectTimer); }catch{}
    state.ble.reconnectTimer = null;
  }
  function rememberBleDevice(device){
    state.settings.blePreferredId = device?.id || '';
    state.settings.blePreferredName = device?.name || '';
    saveSettings();
    updateAppStatus();
  }
  function armBleChooserOnNextGesture(reason){
    if (state.ble.chooserPending) return;
    state.ble.chooserPending = true;
    const msg = 'EMPAREJA EL PULSÓMETRO EN EL SIGUIENTE TOQUE · ' + String(reason || 'SIN DISPOSITIVO PREVIO');
    $('bleBanner').textContent = msg;
    log(msg, 'warn');
    const handler = async () => {
      window.removeEventListener('pointerdown', handler, true);
      window.removeEventListener('keydown', handler, true);
      if (!state.ble.chooserPending) return;
      state.ble.chooserPending = false;
      try{ await connectBle(true, null, 'chooser-armado'); }catch(err){ log('Chooser BLE falló: ' + bleErrText(err), 'err'); }
    };
    window.addEventListener('pointerdown', handler, { once:true, capture:true });
    window.addEventListener('keydown', handler, { once:true, capture:true });
  }
  async function getRememberedBleDevices(){
    if (!navigator.bluetooth || !navigator.bluetooth.getDevices) return [];
    try{ return await navigator.bluetooth.getDevices(); }catch(err){ log('No se pudieron recuperar dispositivos BLE recordados: ' + bleErrText(err), 'warn'); return []; }
  }
  function preferredBleDevice(devices){
    const id = state.settings.blePreferredId || '';
    const name = (state.settings.blePreferredName || '').trim();
    return devices.find(d => id && d.id === id) || devices.find(d => name && d.name === name) || devices[0] || null;
  }
  function scheduleBleReconnect(reason, immediate=false){
    clearBleReconnectTimer();
    if (state.ble.manualDisconnect) return;
    const delay = immediate ? 600 : Math.max(1200, Math.min(15000, Number(state.ble.reconnectBackoffMs || 2000)));
    state.ble.reconnectTimer = setTimeout(async () => {
      try{
        log('Reintentando reconexión BLE: ' + reason, 'warn');
        await reconnectBle();
        state.ble.reconnectBackoffMs = 2000;
      }catch(err){
        state.ble.reconnectBackoffMs = Math.min(15000, Math.round((state.ble.reconnectBackoffMs || 2000) * 1.8));
        log('Reconexión BLE fallida: ' + bleErrText(err), 'err');
        armBleChooserOnNextGesture('NO SE RECUPERÓ EL PULSÓMETRO');
      }
    }, delay);
  }
  async function autoConnectBleOnLaunch(){
    if (state.ble.autoConnectAttempted) return;
    state.ble.autoConnectAttempted = true;
    if (!isSecureContext || !navigator.bluetooth){ log('Auto-BLE no disponible en este contexto', 'warn'); return; }
    const devices = await getRememberedBleDevices();
    if (!devices.length){ armBleChooserOnNextGesture('SIN PULSÓMETRO RECORDADO'); return; }
    const device = preferredBleDevice(devices);
    if (!device){ armBleChooserOnNextGesture('SIN COINCIDENCIA DE PULSÓMETRO'); return; }
    try{
      log('Auto-conectando al último pulsómetro: ' + (device.name || 'dispositivo'), 'ok');
      await connectBle(false, device, 'autostart');
    }catch(err){
      log('Auto-conexión BLE fallida: ' + bleErrText(err), 'err');
      armBleChooserOnNextGesture('AUTO-CONEXIÓN FALLIDA');
    }
  }
  function checkBleHealth(){
    if (state.ble.connectionState !== 'conectado') return;
    const last = state.ble.current.receivedAt ? (Date.now() - state.ble.current.receivedAt) : Infinity;
    if (last > 8000){
      log('Sin paquetes BLE recientes · intentando reconectar', 'warn');
      state.ble.connectionState = 'reconectando';
      refreshBle();
      scheduleBleReconnect('SIN PAQUETES', true);
    }
  }

  function buildSegmentWindows(){
    const rows = state.plan.rows, out = [];
    if (!rows.length) return out;
    let cur = null;
    for (let i=0;i<rows.length;i++){
      const r = rows[i];
      if (!cur || cur.seg !== r.seg || cur.level !== r.level){
        if (cur) cur.end = r.t;
        cur = { seg:String(r.seg).toUpperCase(), level:r.level, start:r.t, end:state.plan.duration, isTest:(state.plan.testSegments||[]).includes(String(r.seg).toUpperCase()) };
        out.push(cur);
      }
    }
    return out;
  }

  function getPlanStateAt(t){
    const machineT = clamp(Number(t || 0), 0, state.plan.duration || 0);
    if (!state.plan.rows.length) return { machineT, seg:null, level:null, bpmTarget:null };
    const row = state.plan.rows[idxByTime(machineT)] || state.plan.rows[0];
    const defaults = {
      10:{min:117,max:132},
      11:{min:131,max:146},
      12:{min:142,max:154},
      13:{min:148,max:160}
    };
    const merged = Object.assign({}, defaults, state.plan.bpmAppTargets || {});
    const target = (state.plan.bpmDayTargets && state.plan.bpmDayTargets[row.level]) || merged[row.level] || null;
    return { machineT, seg:String(row.seg || '').toUpperCase(), level:row.level, bpmTarget:target };
  }
  function getPlanState(){
    return getPlanStateAt(machineElapsed());
  }
  function hrZone(bpm){
    if (!bpm || !isFinite(bpm)) return null;
    const zones = [
      {name:'Z0 - Muy suave / Calentamiento', min:-Infinity, max:116},
      {name:'Z1 - Recuperación', min:116, max:130},
      {name:'Z2 - Suave / Base baja', min:131, max:138},
      {name:'Z3 - Media / Base útil', min:139, max:145},
      {name:'Z4 - Intensa / Umbral', min:146, max:154},
      {name:'Z5 - Máxima / Toque corto', min:155, max:165}
    ];
    if (bpm < 116) return { index:0, ...zones[0] };
    for (let i=1;i<zones.length;i++){ const z = zones[i]; if (bpm >= z.min && bpm <= z.max) return { index:i, ...z }; }
    return { index:5, ...zones[5] };
  }
  function zoneColorStyle(zone){
    if (!zone) return { bg:'#999', fg:'#111' };
    const map = {0:{bg:'var(--z0)',fg:'#111'},1:{bg:'var(--z1)',fg:'#111'},2:{bg:'var(--z2)',fg:'#111'},3:{bg:'var(--z3)',fg:'#111'},4:{bg:'var(--z4)',fg:'#111'},5:{bg:'var(--z5)',fg:'#fff'}};
    return map[zone.index] || { bg:'#999', fg:'#111' };
  }

  function refreshTimeline(){
    const box = $('timelineMarks');
    box.innerHTML = '';
    const end = state.plan.duration;
    const progressPct = (end ? (machineElapsed() / end * 100) : 0);
    $('timelineFill').style.width = progressPct + '%';
    $('timelineCursor').style.left = `calc(${progressPct}% - 2px)`;
    if (!end || !state.plan.rows.length) return;

    const wins = buildSegmentWindows();
    wins.forEach(w => {
      const d = document.createElement('div');
      d.className = 'segBlock l' + w.level + (machineElapsed() >= w.end - 1e-9 ? ' done' : '');
      d.style.left = (w.start / end * 100) + '%';
      d.style.width = Math.max(2, ((w.end - w.start) / end * 100)) + '%';
      d.textContent = w.seg + ' · ' + w.level;
      box.appendChild(d);
    });

    const events = [];
    wins.forEach(w => events.push({ t:w.start, label:w.seg, kind:'seg' }));
    state.plan.waters.forEach(w => events.push({ t:w, label:'💧', kind:'water' }));
    events.push({ t:end, label:'Fin', kind:'end' });
    events.sort((a,b) => a.t - b.t);

    const rowLast = [-999,-999,-999];
    events.forEach(ev => {
      const leftPct = ev.t / end * 100;
      let row = 0;
      for (let r=0;r<rowLast.length;r++){ if (leftPct - rowLast[r] >= 8){ row = r; break; } }
      rowLast[row] = leftPct;
      const m = document.createElement('div');
      m.className = 'mark r' + (row+1) + (machineElapsed() >= ev.t - 1e-9 ? ' done' : '');
      m.style.left = leftPct + '%';
      const lineColor = ev.kind === 'water' ? '#4ea8ff' : (ev.kind === 'end' ? '#ffffff' : '#d9d9d9');
      const lineShadow = ev.kind === 'water' ? '0 0 6px rgba(78,168,255,.8)' : (ev.kind === 'end' ? '0 0 6px rgba(255,255,255,.6)' : '0 0 0 1px rgba(0,0,0,.55)');
      m.innerHTML = '<div class="line" style="background:' + lineColor + ';box-shadow:' + lineShadow + ';"></div><div class="time">' + fmtTime(ev.t) + ' ' + ev.label + '</div>';
      box.appendChild(m);
    });
  }

  function isTestPlan(){ return !!((state.plan.testSegments||[]).length); }

  function refreshTop(){
    const m = calcLiveDerivedMetrics();
    const machineT = m.tMachine;
    const shownT = shownMachineElapsed();
    const kPlan = m.kPlan;
    const kReal = m.kReal;
    const kDelta = kReal - kPlan;
    const realT = m.tReal;
    safeSetText('clock', fmtTime(shownT));
    safeSetText('subClock', 'REAL ' + fmtTime(realT));
    safeSetText('kPlanBig', kPlan.toFixed(1));
    safeSetText('kRealBig', kReal.toFixed(1));
    const deltaPrefix = kDelta > 0 ? '+' : (kDelta < 0 ? '' : '±');
    const kDeltaEl = $('kDelta');
    if (kDeltaEl){ kDeltaEl.textContent = ''; kDeltaEl.className = 'kcalDelta neu hidden'; }
    safeSetText('kDeltaStat', deltaPrefix + kDelta.toFixed(1) + ' kcal');
    safeSetStyleColor('kDeltaStat', kDelta > 0 ? 'var(--ok)' : (kDelta < 0 ? 'var(--bad)' : 'var(--text)'));
    safeSetStyleColor('kDeltaStat', kDelta > 0 ? 'var(--ok)' : (kDelta < 0 ? 'var(--bad)' : 'var(--text)'));
    const avgPlan = realT <= 0 ? 0 : (kPlan / (realT / 60));
    const avgReal = realT <= 0 ? 0 : (kReal / (realT / 60));
    const avgPlan30 = realT <= 0 ? 0 : (kPlan / (realT / 30));
    const avgReal30 = realT <= 0 ? 0 : (kReal / (realT / 30));
    safeSetText('avgPlan', realT <= 0 ? '0.00 kcal/min · 0.00/30s' : (avgPlan.toFixed(2) + ' kcal/min · ' + avgPlan30.toFixed(2) + '/30s'));
    safeSetText('avgReal', realT <= 0 ? '0.00 kcal/min · 0.00/30s' : (avgReal.toFixed(2) + ' kcal/min · ' + avgReal30.toFixed(2) + '/30s'));
    safeSetText('segmentDeltaVal', (m.segmentDelta > 0 ? '+' : (m.segmentDelta < 0 ? '' : '±')) + num(m.segmentDelta,1) + ' kcal');
    safeSetStyleColor('segmentDeltaVal', m.segmentDelta > 0 ? 'var(--ok)' : (m.segmentDelta < 0 ? 'var(--bad)' : 'var(--text)'));
    safeSetText('paceRealVal', num(m.paceReal,2) + ' kcal/min');
    safeSetText('paceNeedVal', num(m.paceNeed,2) + ' kcal/min');
    safeSetStyleColor('paceNeedVal', m.paceNeed <= Math.max(0.01, m.paceReal) ? 'var(--ok)' : (m.remainingPlan > 4 ? 'var(--warn)' : 'var(--text)'));
    safeSetText('waterCountVal', m.waterTaken + ' / ' + m.waterTotal);
    const ps = getPlanState();
    const bpm = displayBpmValue();
    safeSetText('hrBig', bpm == null ? '--' : Number(bpm).toFixed(1));
    const hrBig = $('hrBig');
    if (ps.bpmTarget){
      safeSetText('hrTarget', ps.bpmTarget.min + '–' + ps.bpmTarget.max);
      if (hrBig) hrBig.className = 'metricBig ' + (bpm == null ? 'hrNeutral' : (bpm >= ps.bpmTarget.min && bpm <= ps.bpmTarget.max ? 'hrGood' : 'hrBad'));
    } else {
      safeSetText('hrTarget', '—');
      if (hrBig) hrBig.className = 'metricBig hrNeutral';
    }
    const test = isTestPlan(), psSeg = ps.seg;
    const clock = $('clock');
    if (clock) clock.classList.toggle('test', !!test);
    const testBadge = $('testBadge'), testPhaseBadge = $('testPhaseBadge');
    if (testBadge) testBadge.classList.toggle('hidden', !test);
    if (testPhaseBadge) testPhaseBadge.classList.toggle('hidden', !test);
    if (test){
      const testWin = getTestMainWindow();
      const testDur = testWin ? fmtShortDuration(testWin.end - testWin.start) : 'duración variable';
      const testSeg = testWin ? String(testWin.seg||'').toUpperCase() : '?';
      if (testBadge) testBadge.textContent = 'TEST · ' + testSeg + ' · ' + testDur.replace(' min', 'MIN').replace(' s','S');
      if (testWin && psSeg === testSeg) testPhaseBadge && (testPhaseBadge.textContent = 'ACTIVO · ' + testSeg + ' · ' + testDur.replace(' min', 'MIN').replace(' s','S'));
      else if (testWin && ps && ps.t >= testWin.end) testPhaseBadge && (testPhaseBadge.textContent = 'FIN TEST · ' + testSeg + ' · ' + testDur.replace(' min', 'MIN').replace(' s','S'));
      else testPhaseBadge && (testPhaseBadge.textContent = 'TEST · ' + testSeg + ' · ' + testDur.replace(' min', 'MIN').replace(' s','S'));
    }
  }

  function refreshWater(){
    const t = machineElapsed();
    let overdue = state.plan.waters.findIndex((w,i) => !state.plan.waterTaken[i] && w <= t + 1e-9);
    let next = state.plan.waters.findIndex((w,i) => !state.plan.waterTaken[i] && w > t + 1e-9);

    const waterCard = $('waterCard');
    if (overdue !== -1){
      $('waterRemain').textContent = '00:00';
      $('waterBar').style.width = '100%';
      waterCard.classList.add('due');
      waterCard.classList.remove('warn');
    } else if (next !== -1){
      const prevMark = next > 0 ? state.plan.waters[next-1] : 0;
      const span = Math.max(1, state.plan.waters[next] - prevMark);
      const progress = clamp((t - prevMark) / span, 0, 1);
      $('waterRemain').textContent = fmtTime(Math.max(0, state.plan.waters[next] - t));
      $('waterBar').style.width = (progress * 100).toFixed(1) + '%';
      waterCard.classList.toggle('warn', progress >= .75);
      waterCard.classList.remove('due');
    } else {
      $('waterRemain').textContent = '--';
      $('waterBar').style.width = '0%';
      waterCard.classList.remove('warn','due');
    }
  }

  function refreshNextTable(){
    const body = $('nextBody'); body.innerHTML = '';
    const t = machineElapsed(); if (!state.plan.rows.length) return;
    const current = state.plan.rows[idxByTime(t)];
    const items = [{ sortTime:t-0.001, cls:'current', en:'AHORA', hour:fmtTime(t), level:current.level, seg:current.seg }];
    const horizon = t + 20*60;
    buildSegmentWindows().forEach(w => {
      if (w.start > t + 1e-9 && w.start <= horizon) items.push({ sortTime:w.start, cls:'next', en:fmtTime(w.start-t), hour:fmtTime(w.start), level:w.level, seg:w.seg });
    });
    state.plan.waters.forEach((w,i) => {
      if (state.plan.waterTaken[i]) return;
      if (w <= horizon){
        let cls='water'; if (w <= t + 1e-9) cls='waterDue'; else if (w-t <= 30) cls='waterSoon';
        items.push({ sortTime:w, cls, en:w<=t?'YA':fmtTime(Math.max(0,w-t)), hour:fmtTime(w), level:'Agua', seg:'💧' });
      }
    });
    items.sort((a,b)=>a.sortTime-b.sortTime);
    items.forEach(r => {
      const tr = document.createElement('tr');
      tr.className = r.cls;
      tr.innerHTML = '<td>'+r.en+'</td><td>'+r.hour+'</td><td>'+r.level+'</td><td>'+r.seg+'</td>';
      body.appendChild(tr);
    });
    const rem = document.createElement('tr'); rem.className='remaining'; rem.innerHTML='<td colspan="4">Cambios visibles: '+Math.max(0, items.length-1)+'</td>'; body.appendChild(rem);
    const fin = document.createElement('tr'); fin.className='final'; fin.innerHTML='<td>'+fmtTime(Math.max(0,state.plan.duration-t))+'</td><td>'+fmtTime(state.plan.duration)+'</td><td>Fin</td><td>Fin</td>'; body.appendChild(fin);
  }

  function avgRecent(msWindow){
    const cutoff = Date.now() - msWindow;
    const arr = state.ble.samples.filter(s => s.timestampMs >= cutoff).map(s => s.bpm).filter(v => Number.isFinite(v));
    return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null;
  }

  function computeRr(rr){
    if (!rr.length) return { avg:null, bpm:null, rmssd:null, sdnn:null };
    const avg = rr.reduce((a,b)=>a+b,0)/rr.length;
    let rmssd = null;
    if (rr.length >= 2){
      const diffs = [];
      for (let i=1;i<rr.length;i++) diffs.push(rr[i]-rr[i-1]);
      rmssd = Math.sqrt(diffs.reduce((a,b)=>a+b*b,0)/diffs.length);
    }
    const sdnn = Math.sqrt(rr.reduce((a,b)=>a+Math.pow(b-avg,2),0)/rr.length);
    return { avg, bpm:avg ? 60000/avg : null, rmssd, sdnn };
  }

  function parseHrMeasurement(dv){
    if (!dv || dv.byteLength < 2) throw new Error('Paquete corto');
    let off = 0;
    const flags = dv.getUint8(off++);
    const is16 = !!(flags & 0x01);
    const contactDetected = !!(flags & 0x02);
    const contactSupported = !!(flags & 0x04);
    const rrPresent = !!(flags & 0x10);
    const bpm = is16 ? dv.getUint16(off, true) : dv.getUint8(off);
    off += is16 ? 2 : 1;
    const rr = [];
    while (rrPresent && off + 1 < dv.byteLength){
      rr.push(dv.getUint16(off, true) / 1024 * 1000);
      off += 2;
    }
    const rrMeta = computeRr(rr);
    return { bpm, contactDetected, contactSupported, rrCount:rr.length, rrAverageMs:rrMeta.avg, rrAverageBpmEstimado:rrMeta.bpm, rmssd:rrMeta.rmssd, sdnn:rrMeta.sdnn };
  }

  function bleErrText(err){
    const name = err?.name || ''; const msg = err?.message || String(err || '');
    if (!isSecureContext) return 'Web Bluetooth requiere https o localhost.';
    if (name === 'NotFoundError') return 'No se seleccionó dispositivo.';
    if (name === 'NotAllowedError') return 'Permiso denegado o gesto no válido.';
    if (name === 'SecurityError') return 'Bloqueado por seguridad del navegador.';
    if (name === 'NetworkError') return 'No se pudo conectar por GATT.';
    return (name ? name + ': ' : '') + msg;
  }

  async function connectBle(showChooser=true, providedDevice=null, source='manual'){
    try{
      if (!isSecureContext){ $('bleBanner').textContent = 'BLE no disponible aquí: abre en https o localhost.'; log('BLE bloqueado por contexto no seguro', 'err'); return; }
      if (!navigator.bluetooth){ $('bleBanner').textContent = 'Web Bluetooth no soportado.'; log('Web Bluetooth no soportado', 'err'); return; }
      clearBleReconnectTimer();
      state.ble.manualDisconnect = false;
      state.ble.connectionState = providedDevice ? 'conectando' : (showChooser ? 'buscando' : 'conectando');
      $('bleBanner').textContent = providedDevice ? ('Conectando con ' + (providedDevice.name || 'dispositivo') + '…') : (showChooser ? 'Abriendo selector BLE…' : 'Buscando pulsómetro recordado…');
      refreshBle();
      let device = providedDevice;
      if (!device){
        if (!showChooser){
          const devices = await getRememberedBleDevices();
          device = preferredBleDevice(devices);
          if (!device){ armBleChooserOnNextGesture('NO HAY PULSÓMETRO RECORDADO'); return; }
        } else {
          device = await navigator.bluetooth.requestDevice({ acceptAllDevices:true, optionalServices:['heart_rate','battery_service','device_information','generic_access'] });
        }
      }
      if (!device){ $('bleBanner').textContent = 'Sin dispositivo seleccionado.'; return; }

      try{ if (state.ble.hrChar && state.ble._hrListener) state.ble.hrChar.removeEventListener('characteristicvaluechanged', state.ble._hrListener); }catch{}
      try{ if (state.ble.device && state.ble._disconnectListener) state.ble.device.removeEventListener('gattserverdisconnected', state.ble._disconnectListener); }catch{}
      state.ble.device = device;
      state.ble.connectionState = 'conectando';
      $('bleBanner').textContent = 'Conectando con ' + (device.name || 'dispositivo') + '…';
      refreshBle();
      state.ble._disconnectListener = () => {
        state.ble.connectionState = 'desconectado';
        state.ble.lastError = 'Desconexión GATT';
        $('bleBanner').textContent = 'Pulsómetro desconectado. Intentando reconectar…';
        refreshBle();
        log('Pulsómetro desconectado', 'warn');
        scheduleBleReconnect('DESCONEXIÓN GATT');
      };
      device.addEventListener('gattserverdisconnected', state.ble._disconnectListener);

      const server = await device.gatt.connect();
      state.ble.server = server;
      let hrService;
      try{ hrService = await server.getPrimaryService('heart_rate'); }
      catch(err){ throw new Error('El dispositivo seleccionado no expone el servicio Heart Rate. Selecciona el pulsómetro correcto.'); }
      const hrChar = await hrService.getCharacteristic('heart_rate_measurement');
      state.ble.hrChar = hrChar;
      state.ble._hrListener = ev => {
        try{
          const parsed = parseHrMeasurement(ev.target.value);
          const now = Date.now();
          const z = hrZone(parsed.bpm);
          state.ble.current = { ...state.ble.current, ...parsed, zone:z, signal:'buena', receivedAt:now };
          const firstTs = state.ble.samples.length ? state.ble.samples[0].timestampMs : now;
          const elapsedMs = now - firstTs;
          const machineSec = realToMachine(elapsedMs / 1000);
          state.ble.samples.push({ timestampMs:now, elapsedMs, machineSec, bpm:parsed.bpm, rrCount:parsed.rrCount, rmssd:parsed.rmssd, sdnn:parsed.sdnn, zoneIndex:z?.index ?? null });
          if (state.ble.samples.length > 5000) state.ble.samples.shift();
          state.ble.reconnectBackoffMs = 2000;
          refreshBle();
        }catch(err){ log('Paquete BLE inválido: ' + bleErrText(err), 'warn'); }
      };
      hrChar.addEventListener('characteristicvaluechanged', state.ble._hrListener);
      await hrChar.startNotifications();

      try{
        const battService = await server.getPrimaryService('battery_service');
        const battChar = await battService.getCharacteristic('battery_level');
        const dv = await battChar.readValue();
        if (dv.byteLength) state.ble.current.batteryLevel = dv.getUint8(0);
        battChar.addEventListener('characteristicvaluechanged', ev => { try{ state.ble.current.batteryLevel = ev.target.value.getUint8(0); refreshBle(); }catch{}; });
        await battChar.startNotifications().catch(()=>{});
      }catch{}
      rememberBleDevice(device);
      state.ble.connectionState = 'conectado';
      $('bleBanner').textContent = 'Conectado a ' + (device.name || 'dispositivo') + '.';
      log('BLE conectado (' + source + '): ' + (device.name || 'dispositivo'), 'ok');
      refreshBle();
    }catch(err){
      state.ble.connectionState = 'error';
      state.ble.lastError = bleErrText(err);
      $('bleBanner').textContent = 'Error BLE: ' + state.ble.lastError;
      refreshBle();
      log('Error BLE: ' + state.ble.lastError, 'err');
      if (!providedDevice && showChooser) throw err;
      armBleChooserOnNextGesture('NO SE PUDO CONECTAR EL PULSÓMETRO');
    }
  }
  async function reconnectBle(){
    const preferred = state.ble.device || preferredBleDevice(await getRememberedBleDevices());
    if (preferred) return connectBle(false, preferred, 'reconnect');
    armBleChooserOnNextGesture('RECONEXIÓN SIN DISPOSITIVO');
  }
  function disconnectBle(){
    state.ble.manualDisconnect = true;
    clearBleReconnectTimer();
    try{ if (state.ble.hrChar && state.ble._hrListener) state.ble.hrChar.removeEventListener('characteristicvaluechanged', state.ble._hrListener); }catch{}
    try{ if (state.ble.device && state.ble._disconnectListener) state.ble.device.removeEventListener('gattserverdisconnected', state.ble._disconnectListener); }catch{}
    try{ if (state.ble.device?.gatt?.connected) state.ble.device.gatt.disconnect(); }catch{}
    state.ble.connectionState = 'desconectado'; $('bleBanner').textContent = 'Desconectado.'; refreshBle();
    log('Desconexión BLE manual', 'warn');
  }

  function refreshBle(){
    const c = state.ble.current;
    $('bleStateVal').textContent = state.ble.connectionState || 'desconectado';
    $('bleDeviceVal').textContent = state.ble.device?.name || '--';
    const displayBpm = displayBpmValue();
    $('bleBpmBig').textContent = displayBpm == null ? '--' : Number(displayBpm).toFixed(1);
    $('bleZoneLine').textContent = c.zone ? (c.zone.index === 0 ? c.zone.name : `${c.zone.name} · ${Math.round(c.zone.min)}–${Math.round(c.zone.max)}`) : 'Zona --';
    const pill = $('bleZonePill');
    if (c.zone){
      const style = zoneColorStyle(c.zone);
      pill.style.display = '';
      pill.style.background = style.bg;
      pill.style.color = style.fg;
      pill.textContent = c.zone.name;
    } else pill.style.display = 'none';
    $('bleSignalVal').textContent = c.receivedAt ? (Date.now() - c.receivedAt > 6000 ? 'débil' : 'buena') : '--';
    $('bleContactVal').textContent = c.contactSupported ? (c.contactDetected ? 'detectado' : 'no detectado') : 'no disponible';
    $('bleBatteryVal').textContent = c.batteryLevel == null ? '--' : (c.batteryLevel + '%');
    $('bleRrStatusVal').textContent = c.rrCount ? `sí · ${c.rrCount}` : 'no disponible';
    $('bleAvg5Val').textContent = num(avgRecent(5000));
    $('bleAvg10Val').textContent = num(avgRecent(10000));
    $('bleAvg30Val').textContent = num(avgRecent(30000));
    const bpmVals = state.ble.samples.map(s => s.bpm).filter(v => Number.isFinite(v));
    $('bleMinMaxAvgVal').textContent = bpmVals.length ? `${num(Math.min(...bpmVals),1)} / ${num(Math.max(...bpmVals),1)} / ${num(bpmVals.reduce((a,b)=>a+b,0)/bpmVals.length,1)}` : '--';
    $('bleRrAvgVal').textContent = c.rrAverageMs ? `${num(c.rrAverageMs)} ms · ${num(c.rrAverageBpmEstimado)} bpm` : 'no disponible';
    $('bleHrvVal').textContent = `${num(c.rmssd)} / ${num(c.sdnn)}`;
    $('bleLastPacketVal').textContent = c.receivedAt ? fmtMs(Date.now() - c.receivedAt) : '--';
  }

  async function registerPWA(){
    const banner = $('pwaBanner');
    try{
      if (!('serviceWorker' in navigator)){
        if (banner) banner.textContent = 'Este navegador no soporta service worker.';
        return;
      }
      let controllerChanged = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (controllerChanged) return;
        controllerChanged = true;
        log('Nueva versión activada. Recargando app…', 'ok');
        location.reload();
      });
      const reg = await navigator.serviceWorker.register('sw.js?v=' + APP_VERSION, { updateViaCache:'none' });
      state.pwa.registration = reg;
      const handleWaiting = () => {
        if (reg.waiting){
          if (banner) banner.textContent = 'Actualización disponible. Pulsa “Actualizar app”.';
          log('Hay una actualización esperando activación', 'warn');
        }
      };
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed') handleWaiting();
        });
      });
      try{ await reg.update(); }catch{}
      handleWaiting();
      if (banner && !reg.waiting) banner.textContent = 'Service worker activo. App lista.';
      if (!state.pwa.updateInterval) state.pwa.updateInterval = setInterval(() => { reg.update().catch(()=>{}); }, 60000);
      log('Service worker registrado', 'ok');
    }catch(err){
      if (banner) banner.textContent = 'Error al registrar PWA: ' + (err.message || err);
      log('Error service worker: ' + (err.message || err), 'err');
    }
  }
  async function promptInstall(){
    const banner = $('pwaBanner');
    if (!state.pwa.deferredInstallPrompt){ if (banner) banner.textContent = 'No hay aviso de instalación. Usa Chrome Android y entra por GitHub Pages.'; return; }
    try{
      await state.pwa.deferredInstallPrompt.prompt();
      const choice = await state.pwa.deferredInstallPrompt.userChoice;
      if (banner) banner.textContent = choice.outcome === 'accepted' ? 'Instalación aceptada.' : 'Instalación cancelada.';
      state.pwa.deferredInstallPrompt = null;
    }catch(err){ if (banner) banner.textContent = 'Error al instalar: ' + (err.message || err); }
  }
  async function updateAppNow(){
    const banner = $('pwaBanner');
    try{
      if (!('serviceWorker' in navigator)) return;
      const reg = state.pwa.registration || await navigator.serviceWorker.getRegistration();
      if (!reg){ if (banner) banner.textContent = 'Sin registro de service worker.'; return; }
      await reg.update();
      if (reg.waiting){
        reg.waiting.postMessage({ type:'SKIP_WAITING' });
        if (banner) banner.textContent = 'Activando actualización…';
      } else if (reg.installing){
        if (banner) banner.textContent = 'Descargando actualización…';
      } else {
        if (banner) banner.textContent = 'La app ya está actualizada.';
      }
      log('Solicitud de actualización enviada', 'ok');
    }catch(err){ if (banner) banner.textContent = 'Error al actualizar la app: ' + (err.message || err); log('Error actualización app: ' + (err.message || err), 'err'); }
  }

  async function enableInternalWakeLock(){
    try{
      if (!('wakeLock' in navigator)) return false;
      if (state.pwa.wakeLockSentinel) return true;
      state.pwa.wakeLockSentinel = await navigator.wakeLock.request('screen');
      state.pwa.wakeLockSentinel.addEventListener('release', () => {
        state.pwa.wakeLockSentinel = null;
        try{ if (state.plan.running) log('Wake lock liberado por el sistema', 'warn'); }catch{}
      });
      return true;
    }catch(err){
      log('Wake lock no disponible: ' + (err.message || err), 'warn');
      return false;
    }
  }
  async function disableInternalWakeLock(){
    try{
      if (state.pwa.wakeLockSentinel){
        await state.pwa.wakeLockSentinel.release();
        state.pwa.wakeLockSentinel = null;
      }
    }catch{}
  }
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && state.plan.running){
      try{ await enableInternalWakeLock(); }catch{}
    }
  });

  function saveLiveSession(){
    try{
      const payload = {
        version: 3,
        plan: {
          rows: state.plan.rows,
          waters: state.plan.waters,
          waterTaken: state.plan.waterTaken,
          duration: state.plan.duration,
          goal: state.plan.goal,
          baseMachineSec: Number((state.plan.baseMachineSec || 0).toFixed(3)),
          continueMode: state.plan.continueMode,
          realKcalOffset: Number(state.plan.realKcalOffset || 0),
          wakeLastTapMachine: state.plan.wakeLastTapMachine,
          sessionLog: state.plan.sessionLog,
          minuteLog: state.plan.minuteLog,
          sessionStartedAt: state.plan.sessionStartedAt,
          lastRecordedSecond: state.plan.lastRecordedSecond,
          lastRecordedMinute: state.plan.lastRecordedMinute,
          markers: state.plan.markers,
          title: $('planTitle')?.textContent || 'Plan cargado',
          importText: $('importBox')?.value || ''
        },
        ble: {
          current: state.ble.current,
          samples: (state.ble.samples || []).slice(-300)
        },
        savedAt: new Date().toISOString()
      };
      localStorage.setItem(STORAGE_KEYS.live, JSON.stringify(payload)); state.plan._lastPersistAt = Date.now();
      localStorage.setItem(STORAGE_KEYS.plan, $('importBox')?.value || '');
      updateSavedSessionInfo();
    }catch(err){
      log('No se pudo guardar sesión local: ' + (err.message || err), 'warn');
    }
  }
  function maybePersistLiveSession(force=false){
    const now = Date.now();
    if (!force && now - (state.plan._lastPersistAt || 0) < 10000) return;
    state.plan._lastPersistAt = now;
    saveLiveSession();
  }
  function loadLiveSession(){
    try{
      const raw = localStorage.getItem(STORAGE_KEYS.live); if (!raw) return false;
      const payload = JSON.parse(raw); if (!payload?.plan) return false;
      stopRunLoop();
      state.plan.rows = payload.plan.rows || [];
      state.plan.waters = payload.plan.waters || [];
      state.plan.waterTaken = payload.plan.waterTaken || new Array(state.plan.waters.length).fill(false);
      state.plan.duration = payload.plan.duration || 0;
      state.plan.goal = payload.plan.goal || 0;
      state.plan.baseMachineSec = payload.plan.baseMachineSec || 0;
      state.plan.continueMode = payload.plan.continueMode || { active:false, refMinute:0, refKcal:0 };
      state.plan.realKcalOffset = Number(payload.plan.realKcalOffset || 0);
      state.plan.wakeLastTapMachine = payload.plan.wakeLastTapMachine || 0;
      state.plan.sessionLog = payload.plan.sessionLog || [];
      state.plan.minuteLog = payload.plan.minuteLog || [];
      state.plan.sessionStartedAt = payload.plan.sessionStartedAt || null;
      state.plan.lastRecordedSecond = payload.plan.lastRecordedSecond ?? (state.plan.sessionLog.length ? state.plan.sessionLog[state.plan.sessionLog.length - 1].second : -1);
      state.plan.lastRecordedMinute = payload.plan.lastRecordedMinute ?? (state.plan.minuteLog.length ? state.plan.minuteLog[state.plan.minuteLog.length - 1].minute - 1 : -1);
      state.plan.markers = payload.plan.markers || [];
      state.plan.running = false;
      state.plan.t0 = performance.now();
      state.plan._finishedOnce = false;
      state.ble.current = { ...state.ble.current, ...(payload.ble?.current || {}) };
      state.ble.samples = payload.ble?.samples || [];
      if ($('planTitle')) $('planTitle').textContent = getDisplayPlanTitle(payload.plan.title || 'Plan recuperado');
      if ($('importBox')) $('importBox').value = payload.plan.importText || localStorage.getItem(STORAGE_KEYS.plan) || '';
      savePlanMetaUI($('planTitle')?.textContent || payload.plan.title || 'Plan recuperado');
      if (state.plan.continueMode?.active){
        $('continueBadge').classList.remove('hidden');
        $('continueBadge').textContent = 'Continuando desde ' + fmtTime(state.plan.continueMode.refMinute || 0) + ' · kcal visibles desde 0.0';
        $('continueLine').textContent = 'Modo continuar activo · referencia ' + fmtTime(state.plan.continueMode.refMinute || 0) + ' · visual kcal = 0.0';
      } else {
        clearContinue();
      }
      $('statusLine').textContent = 'Sesión recuperada';
      $('startBtn').textContent = '▶ Reanudar';
      $('startBtnTop').textContent = '▶ Reanudar';
      refreshAll(); refreshBle(); updateSavedSessionInfo();
      log('Sesión recuperada desde guardado local', 'ok');
      return true;
    }catch(err){
      log('No se pudo cargar sesión guardada: ' + (err.message || err), 'err');
      return false;
    }
  }
  function clearLiveSession(){ try{ localStorage.removeItem(STORAGE_KEYS.live); state.plan._lastPersistAt = Date.now(); }catch{} updateSavedSessionInfo(); }
  function updateSavedSessionInfo(){
    try{
      const raw = localStorage.getItem(STORAGE_KEYS.live);
      const saved = raw ? JSON.parse(raw) : null;
      if ($('savedSessionVal')) $('savedSessionVal').textContent = saved?.savedAt ? new Date(saved.savedAt).toLocaleTimeString() : '0';
      const summary = localStorage.getItem(STORAGE_KEYS.summary);
      if ($('lastSummaryVal')) $('lastSummaryVal').textContent = summary ? 'sí' : '--';
      if ($('finalSummaryBox') && summary && !$('finalSummaryBox').value) $('finalSummaryBox').value = summary;
    }catch{}
  }

  function maybeRecordSessionSecond(){
    const endSec = Math.floor(machineElapsed());
    if (endSec < 0) return;
    const startSec = Math.max(0, (state.plan.lastRecordedSecond ?? -1) + 1);
    if (startSec > endSec) return;
    const nowMs = Date.now();
    for (let s = startSec; s <= endSec; s++){
      const ps = getPlanStateAt(s);
      const zone = state.ble.current.zone;
      const lagRealMs = machineToReal(Math.max(0, endSec - s)) * 1000;
      const kcalPlan = Number(shownKcalAtTime(s).toFixed(1));
      const kcalReal = Number(shownRealKcalAtTime(s).toFixed(1));
      state.plan.sessionLog.push({
        second: s,
        shownSecond: Math.floor(state.plan.continueMode.active ? Math.max(0, s - (state.plan.continueMode.refMinute || 0)) : s),
        clock: fmtTime(state.plan.continueMode.active ? Math.max(0, s - (state.plan.continueMode.refMinute || 0)) : s),
        machineClock: fmtTime(s),
        kcalPlan,
        kcalReal,
        kcalDelta: Number((kcalReal - kcalPlan).toFixed(1)),
        level: ps.level,
        seg: ps.seg,
        bpm: state.ble.current.bpm == null ? null : Math.round(state.ble.current.bpm),
        zone: zone ? zone.name : null,
        waterDue: state.plan.waters.some((w,i) => !state.plan.waterTaken[i] && w <= s + 1e-9),
        timestampIso: new Date(nowMs - lagRealMs).toISOString()
      });
    }
    state.plan.lastRecordedSecond = endSec;
  }

  function buildMinuteRow(minuteIndex){
    const rows = state.plan.sessionLog || [];
    const start = minuteIndex * 60, end = start + 59;
    const slice = rows.filter(r => r.second >= start && r.second <= end);
    if (!slice.length) return null;

    const bpmVals = slice.map(r => r.bpm).filter(v => Number.isFinite(v));
    const bpmAvg = bpmVals.length ? bpmVals.reduce((a,b)=>a+b,0)/bpmVals.length : null;
    const bpmMax = bpmVals.length ? Math.max(...bpmVals) : null;
    const bpmMin = bpmVals.length ? Math.min(...bpmVals) : null;
    const levelCounts = {}, segCounts = {}, zoneCounts = {};
    slice.forEach(r => {
      levelCounts[r.level] = (levelCounts[r.level] || 0) + 1;
      segCounts[r.seg] = (segCounts[r.seg] || 0) + 1;
      const z = r.zone || 'Sin zona';
      zoneCounts[z] = (zoneCounts[z] || 0) + 1;
    });
    const levelDom = Object.entries(levelCounts).sort((a,b)=>b[1]-a[1])[0]?.[0] || '';
    const segDom = Object.entries(segCounts).sort((a,b)=>b[1]-a[1])[0]?.[0] || '';
    const zoneDom = Object.entries(zoneCounts).sort((a,b)=>b[1]-a[1])[0]?.[0] || '';

    const zSecs = {'Z0 - Muy suave / Calentamiento':0,'Z1 - Recuperación':0,'Z2 - Suave / Base baja':0,'Z3 - Media / Base útil':0,'Z4 - Intensa / Umbral':0,'Z5 - Máxima / Toque corto':0,'Sin zona':0};
    slice.forEach(r => { zSecs[r.zone || 'Sin zona'] = (zSecs[r.zone || 'Sin zona'] || 0) + 1; });

    const kcalStartPlan = Number(slice[0].kcalPlan || 0);
    const kcalEndPlan = Number(slice[slice.length-1].kcalPlan || 0);
    const kcalMinutePlan = Math.max(0, kcalEndPlan - kcalStartPlan);
    const kcalStartReal = Number((slice[0].kcalReal ?? slice[0].kcalPlan ?? 0));
    const kcalEndReal = Number((slice[slice.length-1].kcalReal ?? slice[slice.length-1].kcalPlan ?? 0));
    const kcalMinuteReal = Math.max(0, kcalEndReal - kcalStartReal);
    const markers = (state.plan.markers || []).filter(m => Math.floor((m.second||0)/60) === minuteIndex).map(m => m.type).join('|');
    const water = slice.some(r => r.waterDue) ? 'sí' : 'no';

    return {
      minute: minuteIndex + 1,
      clock: slice[slice.length-1].clock,
      machineClock: slice[slice.length-1].machineClock,
      seg: segDom,
      level: levelDom,
      kcalStart: Number(kcalStartPlan.toFixed(1)),
      kcalEnd: Number(kcalEndPlan.toFixed(1)),
      kcalMinute: Number(kcalMinutePlan.toFixed(1)),
      kcalPerMin: Number(kcalMinutePlan.toFixed(2)),
      kcalStartPlan: Number(kcalStartPlan.toFixed(1)),
      kcalEndPlan: Number(kcalEndPlan.toFixed(1)),
      kcalMinutePlan: Number(kcalMinutePlan.toFixed(1)),
      kcalPerMinPlan: Number(kcalMinutePlan.toFixed(2)),
      kcalStartReal: Number(kcalStartReal.toFixed(1)),
      kcalEndReal: Number(kcalEndReal.toFixed(1)),
      kcalMinuteReal: Number(kcalMinuteReal.toFixed(1)),
      kcalPerMinReal: Number(kcalMinuteReal.toFixed(2)),
      kcalDeltaEnd: Number((kcalEndReal - kcalEndPlan).toFixed(1)),
      bpmAvg: bpmAvg == null ? null : Number(bpmAvg.toFixed(1)),
      bpmMax,
      bpmMin,
      zoneDominant: zoneDom,
      z0:zSecs['Z0 - Muy suave / Calentamiento'] || 0,
      z1:zSecs['Z1 - Recuperación'] || 0,
      z2:zSecs['Z2 - Suave / Base baja'] || 0,
      z3:zSecs['Z3 - Media / Base útil'] || 0,
      z4:zSecs['Z4 - Intensa / Umbral'] || 0,
      z5:zSecs['Z5 - Máxima / Toque corto'] || 0,
      water,
      markers
    };
  }

  function maybeRecordMinuteSummary(){
    const currentClosedMinute = Math.floor(machineElapsed() / 60) - 1;
    if (currentClosedMinute < 0) return;
    let nextMinute = (state.plan.lastRecordedMinute ?? -1) + 1;
    while (nextMinute <= currentClosedMinute){
      const row = buildMinuteRow(nextMinute);
      if (row){
        const idx = state.plan.minuteLog.findIndex(r => r.minute === row.minute);
        if (idx >= 0) state.plan.minuteLog[idx] = row;
        else state.plan.minuteLog.push(row);
      }
      state.plan.lastRecordedMinute = nextMinute;
      nextMinute += 1;
    }
    state.plan.minuteLog.sort((a,b) => a.minute - b.minute);
  }
  function finalizeMinuteLogs(){
    state.plan.minuteLog = buildMinuteRowsFresh();
    state.plan.lastRecordedMinute = state.plan.minuteLog.length ? state.plan.minuteLog[state.plan.minuteLog.length - 1].minute - 1 : -1;
  }

  function csvEscape(v){
    if (v == null) return '';
    const s = String(v).normalize('NFC');
    return /[";\r\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
  }
  function rowsToCsv(rows, header){
    return '\uFEFF' + [header.join(';')].concat(rows.map(r => header.map(k => csvEscape(r[k])).join(';'))).join('\r\n');
  }

  function exportSessionLog(){
    const rows = state.plan.sessionLog || [];
    if (!rows.length){ log('No hay sesión grabada todavía', 'warn'); return; }
    const header = ['second','shownSecond','clock','machineClock','kcalPlan','kcalReal','kcalDelta','level','seg','bpm','zone','waterDue','timestampIso'];
    const csv = rowsToCsv(rows, header);
    const name = downloadBlob(csv, 'sesion_eliptica_segundo_a_segundo.csv', 'text/csv;charset=utf-8');
    $('pwaBanner').textContent='Sesión exportada: ' + name;
    log('Sesión exportada', 'ok');
  }

  function buildMinuteRowsFresh(){
    const rows = state.plan.sessionLog || [];
    if (!rows.length) return [];
    const maxMinuteIndex = Math.floor((rows[rows.length - 1].second || 0) / 60);
    const out = [];
    for (let i = 0; i <= maxMinuteIndex; i++){
      const row = buildMinuteRow(i);
      if (row) out.push(row);
    }
    out.sort((a,b) => a.minute - b.minute);
    return out;
  }

  function exportMinuteLog(){
    const rows = buildMinuteRowsFresh();
    if (!rows.length){ log('No hay datos minuto a minuto todavía', 'warn'); return; }
    const header = ['minute','clock','machineClock','seg','level','kcalStartPlan','kcalEndPlan','kcalMinutePlan','kcalPerMinPlan','kcalStartReal','kcalEndReal','kcalMinuteReal','kcalPerMinReal','kcalDeltaEnd','bpmAvg','bpmMax','bpmMin','zoneDominant','z0','z1','z2','z3','z4','z5','water','markers'];
    const csv = rowsToCsv(rows, header);
    const name = downloadBlob(csv, 'sesion_eliptica_minuto_a_minuto.csv', 'text/csv;charset=utf-8');
    $('pwaBanner').textContent='CSV minuto a minuto exportado: ' + name;
    log('Exportado minuto a minuto', 'ok');
  }
  function exportSessionJson(){
    const payload = {
      meta:{
        startedAt: state.plan.sessionStartedAt,
        durationVisible: fmtTime(shownMachineElapsed()),
        durationMachine: fmtTime(machineElapsed()),
        goalKcal: state.plan.goal,
        kcalPlanFinal: Number(shownKcalAtTime(machineElapsed()).toFixed(1)),
        kcalRealFinal: Number(shownRealKcalAtTime(machineElapsed()).toFixed(1)),
        realKcalOffset: Number((state.plan.realKcalOffset || 0).toFixed(1))
      },
      plan:{ rows: state.plan.rows, waters: state.plan.waters },
      sessionLog: state.plan.sessionLog,
      minuteLog: buildMinuteRowsFresh(),
      markers: state.plan.markers,
      ble:{ current: state.ble.current, samples: state.ble.samples.slice(-300) }
    };
    const name = downloadBlob(JSON.stringify(payload, null, 2), 'sesion_eliptica.json', 'application/json;charset=utf-8');
    $('pwaBanner').textContent='Sesión JSON exportada: ' + name;
    log('Sesión JSON exportada', 'ok');
  }

  function downloadBlob(content, filename, mime){
    let normalized = content;
    if (typeof normalized === 'string') normalized = normalized.normalize('NFC');
    const needsBom = /^text\/(csv|plain)|application\/json/.test(String(mime || ''));
    const blob = needsBom ? new Blob(['﻿', normalized], {type:mime}) : new Blob([normalized], {type:mime});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try{ document.body.removeChild(a); }catch{}
      try{ URL.revokeObjectURL(url); }catch{}
    }, 800);
    return filename;
  }

  async function copyTextSafe(text){
    const value = String(text || '');
    if (!value.trim()) throw new Error('No hay texto para copiar');
    try{
      if (navigator.clipboard && window.isSecureContext){
        await navigator.clipboard.writeText(value);
        return true;
      }
    }catch(err){
      log('Clipboard API falló, uso fallback: ' + ((err && err.message) || err), 'warn');
    }
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly','');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (!ok) throw new Error('No se pudo copiar al portapapeles');
    return true;
  }

  function buildComparisonText(){
    return compareWithPrevious();
  }

  function buildChatgptSummaryText(){
    const final = buildFinalSummary();
    const tramo = buildTramoSummary();
    const compare = buildComparisonText();
    return [
      'RESUMEN PARA CHATGPT',
      '',
      final,
      '',
      tramo,
      '',
      'COMPARACIÓN CON ÚLTIMA',
      compare
    ].join('\n');
  }

  async function copySummary(){
    const txt = [buildFinalSummary(), '', buildTramoSummary(), '', buildComparisonText()].join('\n');
    $('finalSummaryBox').value = txt;
    try{ await copyTextSafe(txt); log('Resumen copiado al portapapeles', 'ok'); $('pwaBanner').textContent='Resumen copiado al portapapeles.'; } catch(err){ downloadBlob(txt, 'resumen_' + APP_VERSION + '.txt', 'text/plain;charset=utf-8'); log('Clipboard falló en resumen; descarga TXT creada', 'warn'); $('pwaBanner').textContent='Clipboard falló; resumen descargado.'; }
    return txt;
  }

  async function copyChatgptSummary(){
    const txt = buildChatgptSummaryText();
    $('finalSummaryBox').value = txt;
    try{ await copyTextSafe(txt); log('Texto para ChatGPT copiado', 'ok'); $('pwaBanner').textContent='Texto para ChatGPT copiado.'; } catch(err){ downloadBlob(txt, 'chatgpt_' + APP_VERSION + '.txt', 'text/plain;charset=utf-8'); log('Clipboard falló en ChatGPT; descarga TXT creada', 'warn'); $('pwaBanner').textContent='Clipboard falló; texto para ChatGPT descargado.'; }
    return txt;
  }

  function exportPlanTxt(){
    const txt = String(($('importBox') && $('importBox').value) || '').trim();
    if (!txt) throw new Error('No hay plan cargado para exportar');
    const name = 'plan_eliptica_' + new Date().toISOString().replace(/[:.]/g,'-') + '.txt';
    downloadBlob(txt, name, 'text/plain;charset=utf-8');
    $('pwaBanner').textContent='Plan exportado: ' + name;
    log('Plan exportado: ' + name, 'ok');
    return name;
  }

  async function clearAppData(){
    const ok = confirm('Se borrarán caché, datos locales y sesión guardada. ¿Continuar?');
    if (!ok){ log('Limpieza cancelada por el usuario', 'warn'); return false; }
    try{ localStorage.clear(); }catch{}
    try{ sessionStorage.clear(); }catch{}
    if ('caches' in window){
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    if ('serviceWorker' in navigator){
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    log('Caché y datos locales eliminados', 'ok');
    setTimeout(() => location.reload(), 700);
    return true;
  }

  function finalSummaryAction(){
    const final = buildFinalSummary();
    const tramo = buildTramoSummary();
    const compare = buildComparisonText();
    $('finalSummaryBox').value = [final, '', tramo, '', 'COMPARACIÓN CON ÚLTIMA', compare].join('\n');
    log('Resumen final generado', 'ok');
    return $('finalSummaryBox').value;
  }

  function compareLastAction(){
    const txt = buildComparisonText();
    $('finalSummaryBox').value = ['COMPARACIÓN CON ÚLTIMA', '', txt].join('\n');
    log('Comparación con última generada', 'ok');
    return txt;
  }


  function aggregateByLevelFromRows(rows){
    const byLevel = {};
    let prevPlan = 0;
    let prevReal = 0;
    for (const r of (rows || [])){
      const level = Number(r.level || 0);
      if (!level) {
        prevPlan = Number(r.kcalPlan || prevPlan || 0);
        prevReal = Number((r.kcalReal ?? r.kcalPlan ?? prevReal) || 0);
        continue;
      }
      const curPlan = Number(r.kcalPlan || 0);
      const curReal = Number((r.kcalReal ?? r.kcalPlan) || 0);
      const dPlan = Math.max(0, curPlan - prevPlan);
      const dReal = Math.max(0, curReal - prevReal);
      const bucket = byLevel[level] || { secs:0, kcalPlan:0, kcalReal:0, bpm:[] };
      bucket.secs += 1;
      bucket.kcalPlan += dPlan;
      bucket.kcalReal += dReal;
      if (Number.isFinite(r.bpm)) bucket.bpm.push(Number(r.bpm));
      byLevel[level] = bucket;
      prevPlan = curPlan;
      prevReal = curReal;
    }
    return byLevel;
  }
  function buildFinalSummary(){
    const rows = state.plan.sessionLog || [];
    if (!rows.length){ const txt='No hay sesión grabada.'; $('finalSummaryBox').value = txt; return txt; }
    const kcalPlanMax = Math.max(...rows.map(r => Number(r.kcalPlan || 0)));
    const kcalRealMax = Math.max(...rows.map(r => Number((r.kcalReal ?? r.kcalPlan) || 0)));
    const bpmVals = rows.map(r => r.bpm).filter(v => Number.isFinite(v));
    const bpmAvg = bpmVals.length ? bpmVals.reduce((a,b)=>a+b,0)/bpmVals.length : null;
    const bpmMax = bpmVals.length ? Math.max(...bpmVals) : null;
    const zoneCounts = {};
    rows.forEach(r => { const z = r.zone || 'Sin zona'; zoneCounts[z] = (zoneCounts[z] || 0) + 1; });
    const zoneLines = Object.entries(zoneCounts).sort((a,b)=>b[1]-a[1]).map(([z,s]) => `- ${z}: ${fmtTime(s)}`).join('\n');
    const byLevel = aggregateByLevelFromRows(rows);
    const effLines = Object.keys(byLevel).sort((a,b)=>Number(a)-Number(b)).map(level => {
      const d = byLevel[level];
      const mins = Math.max(1e-9, d.secs / 60);
      const kcalPlan = Math.max(0, d.kcalPlan);
      const kcalReal = Math.max(0, d.kcalReal);
      const bpm = d.bpm.length ? d.bpm.reduce((a,b)=>a+b,0)/d.bpm.length : null;
      const effPlan = bpm ? (kcalPlan / mins) / bpm : null;
      const effReal = bpm ? (kcalReal / mins) / bpm : null;
      return `- nivel ${level}: plan ${num(kcalPlan,1)} kcal | real ${num(kcalReal,1)} kcal | tiempo ${fmtTime(d.secs)} | plan ${num(kcalPlan/mins,2)} kcal/min | real ${num(kcalReal/mins,2)} kcal/min | bpm medio ${num(bpm,1)} | relación plan ${num(effPlan,4)} | relación real ${num(effReal,4)}`;
    }).join('\n');
    const summary = [
      'RESUMEN FINAL DE SESIÓN',
      '',
      'Inicio: ' + (state.plan.sessionStartedAt || '--'),
      'Duración visible final: ' + fmtTime(shownMachineElapsed()),
      'Duración máquina final: ' + fmtTime(machineElapsed()),
      'Kcal finales planificadas: ' + num(kcalPlanMax,1),
      'Kcal finales reales: ' + num(kcalRealMax,1),
      'Diferencia final real vs plan: ' + num(kcalRealMax - kcalPlanMax,1),
      'FC media: ' + (bpmAvg == null ? '--' : `${num(bpmAvg,1)} bpm`),
      'FC máxima: ' + (bpmMax == null ? '--' : `${num(bpmMax,0)} bpm`),
      '',
      'Tiempo por zonas:',
      zoneLines || '- sin datos',
      '',
      'Eficiencia por nivel:',
      effLines || '- sin datos',
      '',
      'Filas registradas segundo a segundo: ' + rows.length,
      'Minutos resumidos: ' + (buildMinuteRowsFresh().length)
    ].join('\n');
    $('finalSummaryBox').value = summary;
    try{ localStorage.setItem(STORAGE_KEYS.summary, summary); }catch{}
    updateSavedSessionInfo();
    return summary;
  }

  function buildTramoSummary(){
    const rows = state.plan.sessionLog || [];
    if (!rows.length){ $('tramoSummaryBox').value = 'No hay datos por tramo.'; return 'No hay datos por tramo.'; }
    const bySeg = {};
    rows.forEach(r => {
      const key = r.seg || 'Sin tramo';
      bySeg[key] = bySeg[key] || { secs:0, kcalPlanStart:null, kcalPlanEnd:0, kcalRealStart:null, kcalRealEnd:0, bpm:[], zones:{}, level:r.level };
      bySeg[key].secs += 1;
      if (bySeg[key].kcalPlanStart == null) bySeg[key].kcalPlanStart = Number(r.kcalPlan || 0);
      bySeg[key].kcalPlanEnd = Number(r.kcalPlan || 0);
      const realVal = Number((r.kcalReal ?? r.kcalPlan) || 0);
      if (bySeg[key].kcalRealStart == null) bySeg[key].kcalRealStart = realVal;
      bySeg[key].kcalRealEnd = realVal;
      if (Number.isFinite(r.bpm)) bySeg[key].bpm.push(r.bpm);
      const z = r.zone || 'Sin zona';
      bySeg[key].zones[z] = (bySeg[key].zones[z] || 0) + 1;
    });
    const lines = ['RESUMEN POR TRAMO',''];
    Object.keys(bySeg).sort().forEach(seg => {
      const d = bySeg[seg];
      const mins = Math.max(1e-9, d.secs / 60);
      const kcalPlan = Math.max(0, d.kcalPlanEnd - (d.kcalPlanStart || 0));
      const kcalReal = Math.max(0, d.kcalRealEnd - (d.kcalRealStart || 0));
      const bpmAvg = d.bpm.length ? d.bpm.reduce((a,b)=>a+b,0)/d.bpm.length : null;
      const domZone = Object.entries(d.zones).sort((a,b)=>b[1]-a[1])[0]?.[0] || '--';
      lines.push(`Tramo ${seg} · nivel ${d.level}`);
      lines.push(`- duración: ${fmtTime(d.secs)}`);
      lines.push(`- kcal planificadas: ${num(kcalPlan,1)}`);
      lines.push(`- kcal reales: ${num(kcalReal,1)}`);
      lines.push(`- diferencia real vs plan: ${num(kcalReal - kcalPlan,1)}`);
      lines.push(`- kcal/min planificadas: ${num(kcalPlan/mins,2)}`);
      lines.push(`- kcal/min reales: ${num(kcalReal/mins,2)}`);
      lines.push(`- bpm medio: ${num(bpmAvg,1)}`);
      lines.push(`- zona dominante: ${domZone}`);
      lines.push('');
    });
    const out = lines.join('\n');
    $('tramoSummaryBox').value = out;
    try{ localStorage.setItem(STORAGE_KEYS.tramo, out); }catch{}
    return out;
  }

  function addMarker(type){
    const ps = getPlanState();
    const kcalPlan = Number(shownKcalAtTime(machineElapsed()).toFixed(1));
    const kcalReal = Number(shownRealKcalAtTime(machineElapsed()).toFixed(1));
    state.plan.markers.push({ type, second: Math.floor(machineElapsed()), shownSecond: Math.floor(shownMachineElapsed()), clock: fmtTime(shownMachineElapsed()), machineClock: fmtTime(machineElapsed()), kcalPlan, kcalReal, kcalDelta: Number((kcalReal - kcalPlan).toFixed(1)), bpm: state.ble.current.bpm == null ? null : Math.round(state.ble.current.bpm), seg: ps.seg, level: ps.level, timestampIso: new Date().toISOString() });
    saveLiveSession(); log('Marcador: ' + type, 'ok');
  }
  function savePreviousSession(){ try{ localStorage.setItem(STORAGE_KEYS.previous, JSON.stringify({ savedAt:new Date().toISOString(), sessionLog: state.plan.sessionLog, minuteLog: state.plan.minuteLog, markers: state.plan.markers })); }catch{} }

  function compareWithPrevious(){
    try{
      const prevRaw = localStorage.getItem(STORAGE_KEYS.previous);
      if (!prevRaw){
        $('lastCompareVal').textContent = 'sin previa';
        const txt = 'No hay sesión anterior guardada para comparar';
        try{ localStorage.setItem(STORAGE_KEYS.compare, txt); }catch{}
        return txt;
      }
      const prev = JSON.parse(prevRaw), currRows = state.plan.sessionLog || [], prevRows = prev.sessionLog || [];
      const currKPlan = currRows.length ? Math.max(...currRows.map(r => Number(r.kcalPlan || 0))) : 0;
      const prevKPlan = prevRows.length ? Math.max(...prevRows.map(r => Number(r.kcalPlan || 0))) : 0;
      const currKReal = currRows.length ? Math.max(...currRows.map(r => Number((r.kcalReal ?? r.kcalPlan) || 0))) : 0;
      const prevKReal = prevRows.length ? Math.max(...prevRows.map(r => Number((r.kcalReal ?? r.kcalPlan) || 0))) : 0;
      const currB = currRows.map(r => r.bpm).filter(v => Number.isFinite(v)), prevB = prevRows.map(r => r.bpm).filter(v => Number.isFinite(v));
      const currAvg = currB.length ? currB.reduce((a,b)=>a+b,0)/currB.length : null, prevAvg = prevB.length ? prevB.reduce((a,b)=>a+b,0)/prevB.length : null;
      const currDur = currRows.length ? currRows[currRows.length-1].second + 1 : 0;
      const prevDur = prevRows.length ? prevRows[prevRows.length-1].second + 1 : 0;
      const txt = [
        'Duración actual: ' + fmtTime(currDur),
        'Duración previa: ' + fmtTime(prevDur),
        'Kcal plan actual: ' + num(currKPlan,1),
        'Kcal plan previa: ' + num(prevKPlan,1),
        'Kcal real actual: ' + num(currKReal,1),
        'Kcal real previa: ' + num(prevKReal,1),
        'Diferencia real actual vs previa: ' + num(currKReal - prevKReal,1),
        'FC media actual: ' + num(currAvg,1),
        'FC media previa: ' + num(prevAvg,1),
        'Diferencia FC media: ' + num((currAvg ?? 0) - (prevAvg ?? 0),1)
      ].join('\n');
      $('lastCompareVal').textContent = 'sí';
      try{ localStorage.setItem(STORAGE_KEYS.compare, txt); }catch{}
      return txt;
    }catch(err){
      return 'Error en comparación: ' + ((err && err.message) || err);
    }
  }

  function updateExtraSavedInfo(){
    try{
      const cmp = localStorage.getItem(STORAGE_KEYS.compare); $('lastCompareVal').textContent = cmp ? 'sí' : '--';
      const tramo = localStorage.getItem(STORAGE_KEYS.tramo); if (tramo) $('tramoSummaryBox').value = tramo;
    }catch{}
  }

  function savePlanMetaUI(title){
    $('planTitle').textContent = getDisplayPlanTitle(title);
    $('rowsVal').textContent = String(state.plan.rows.length);
    $('durVal').textContent = fmtTime(state.plan.duration);
    $('goalVal').textContent = state.plan.goal.toFixed(1);
  }

  function applyImport(){
    const parsed = parseImportText($('importBox').value);
    if (!parsed.rows.length){ log('No hay filas válidas para importar', 'err'); return; }
    stopRunLoop();
    disableInternalWakeLock().catch(()=>{});
    state.plan.rows = parsed.rows;
    state.plan.waters = parsed.waters;
    state.plan.testSegments = Array.isArray(parsed.testSegments) ? parsed.testSegments.map(x => String(x).toUpperCase()) : [];
    state.plan.bpmAppTargets = parsed.bpmAppTargets || {};
    state.plan.bpmDayTargets = parsed.bpmDayTargets || {};
    state.plan.waterTaken = new Array(parsed.waters.length).fill(false);
    state.plan.duration = parsed.rows[parsed.rows.length - 1].t;
    state.plan.goal = Number(parsed.rows[parsed.rows.length - 1].kcalTotal || 0);
    state.plan.baseMachineSec = 0;
    state.plan.realKcalOffset = 0;
    state.plan.running = false;
    state.plan.wakeLastTapMachine = 0;
    state.plan.sessionLog = [];
    state.plan.minuteLog = [];
    
    state.plan.sessionStartedAt = null;
    state.plan.lastRecordedSecond = -1;
    state.plan.lastRecordedMinute = -1;
    state.plan.markers = [];
    state.plan._finishedOnce = false;
    savePlanMetaUI(parsed.title);
    clearContinue();
    $('statusLine').textContent = 'Lista';
    $('startBtn').textContent = '▶ Empezar';
    $('startBtnTop').textContent = '▶ Empezar';
    refreshAll();
    saveLiveSession();
    log('Plan cargado', 'ok');
    if (Object.keys(state.plan.bpmAppTargets||{}).length) log('BPM operativo importado: ' + JSON.stringify(state.plan.bpmAppTargets), 'ok');
    if (Object.keys(state.plan.bpmDayTargets||{}).length) log('BPM del día importado: ' + JSON.stringify(state.plan.bpmDayTargets), 'ok');
  }

  function applyContinue(){
    const minuteRaw = $('continueMinuteInput').value.trim(), kcalRaw = $('continueKcalInput').value.trim();
    let minute = minuteRaw ? parseTime(minuteRaw) : null, kcal = kcalRaw ? parseFloat(kcalRaw.replace(',', '.')) : null;
    if (minute == null && kcal == null){ log('Continuar: indica minuto, kcal o ambos', 'warn'); return; }
    if (minute != null && kcal == null) kcal = kcalAtTime(minute);
    if (minute == null && kcal != null) minute = machineTimeFromKcal(kcal);
    minute = clamp(minute || 0, 0, state.plan.duration);
    const refK = kcalAtTime(minute);
    state.plan.continueMode = { active:true, refMinute:minute, refKcal:refK };
    state.plan.baseMachineSec = minute;
    if (state.plan.running) state.plan.t0 = performance.now();
    $('continueBadge').classList.remove('hidden');
    $('continueBadge').textContent = 'Continuando desde ' + fmtTime(minute) + ' · kcal visibles desde 0.0';
    $('continueLine').textContent = 'Modo continuar activo · referencia ' + fmtTime(minute) + ' · visual kcal = 0.0';
    refreshAll(); saveLiveSession();
  }
  function clearContinue(){
    state.plan.continueMode = { active:false, refMinute:0, refKcal:0 };
    $('continueBadge').classList.add('hidden');
    $('continueLine').textContent = 'Sin modo continuar activo. Puedes dar minuto, kcal o ambos.';
    refreshAll();
  }
  function adjustRealKcal(delta){
    if (!state.plan.rows.length){ log('Carga primero un plan', 'warn'); return; }
    maybeRecordSessionSecond(); maybeRecordMinuteSummary();
    const machineT = machineElapsed(); const kPlanNow = shownKcalAtTime(machineT); const kRealNow = shownRealKcalAtTime(machineT);
    let snappedReal; if (Math.abs(delta) >= 1 && Math.abs(delta % 1) < 1e-9) snappedReal = Math.round(kRealNow + delta); else snappedReal = Math.round((kRealNow + delta) * 10) / 10;
    state.plan.realKcalOffset = Number((snappedReal - kPlanNow).toFixed(1)); refreshAll(); maybePersistLiveSession(true);
    log('Ajuste kcal reales: ' + (delta > 0 ? '+' : '') + delta + ' · kcal real actual ' + snappedReal.toFixed(1) + ' · offset total ' + num(state.plan.realKcalOffset,1), 'ok');
  }

  function buildSessionAlertMessages(){
    const msgs = [];
    const t = machineElapsed();
    const ps = getPlanState();
    const m = calcLiveDerivedMetrics();
    const delta = m.totalDelta;
    const segDelta = m.segmentDelta;
    const nextWaterIdx = state.plan.waters.findIndex((w,i)=>!state.plan.waterTaken[i] && w > t + 1e-9);
    const overdueWaterIdx = state.plan.waters.findIndex((w,i)=>!state.plan.waterTaken[i] && w <= t + 1e-9);
    const wins = buildSegmentWindows();
    const segmentWindow = wins.find(w => t >= w.start && t < w.end - 1e-9);
    const nextSeg = wins.find(w => w.start > t + 1e-9);
    const secsToSegmentEnd = segmentWindow ? Math.max(0, segmentWindow.end - t) : null;
    const hrAgeMs = state.ble.current.receivedAt ? (Date.now() - state.ble.current.receivedAt) : Infinity;
    if (!state.plan.rows.length){ msgs.push('CARGA UN PLAN PARA EMPEZAR'); }
    else {
      msgs.push('AHORA · TRAMO ' + (ps.seg || '--') + ' · NIVEL ' + (ps.level ?? '--') + ' · DESVÍO TRAMO ' + (segDelta>0?'+':'') + num(segDelta,1) + ' KCAL');
      msgs.push('TOTAL ' + (delta>0?'+':'') + num(delta,1) + ' KCAL · RITMO REAL ' + num(m.paceReal,2) + ' KCAL/MIN · FIN ' + endEtaText().replace(/^FIN\s+/,''));
      if (nextSeg && secsToSegmentEnd != null) msgs.push('PRÓXIMO CAMBIO EN ' + fmtSpeechDuration(secsToSegmentEnd) + ' · PASAS A ' + nextSeg.seg + ' NIVEL ' + nextSeg.level);
      if (m.paceNeed > 0) msgs.push('PARA CERRAR EL OBJETIVO NECESITAS ' + num(m.paceNeed,2) + ' KCAL/MIN DESDE AHORA');
      msgs.push('AGUA ' + m.waterTaken + '/' + m.waterTotal + ' · QUEDAN ' + fmtSpeechDuration(Math.max(0, Math.ceil(m.remainingRealSec || 0))));
    }
    if (overdueWaterIdx !== -1) msgs.push('AGUA PENDIENTE AHORA · TOCA BEBER Y MARCAR LA TOMA');
    else if (nextWaterIdx !== -1){ const dt = state.plan.waters[nextWaterIdx] - t; msgs.push('PRÓXIMA AGUA EN ' + fmtSpeechDuration(dt) + ' · MINUTO ' + fmtTime(state.plan.waters[nextWaterIdx])); }
    if (state.ble.connectionState === 'conectado' && hrAgeMs < 5000 && Number.isFinite(displayBpmValue())) msgs.push('PULSO ' + num(displayBpmValue(),1) + ' BPM · OBJETIVO ' + (ps.bpmTarget ? (ps.bpmTarget.min + '–' + ps.bpmTarget.max) : '--'));
    if (state.ble.connectionState === 'conectado' && hrAgeMs >= 5000) msgs.push('PULSÓMETRO CONECTADO PERO SIN PAQUETES RECIENTES');
    else if (state.ble.connectionState === 'reconectando') msgs.push('RECONEXIÓN AUTOMÁTICA DEL PULSÓMETRO EN CURSO');
    else if (state.ble.connectionState !== 'conectado') msgs.push('PULSÓMETRO ' + String(state.ble.connectionState || 'DESCONECTADO').toUpperCase());
    return Array.from(new Set(msgs.filter(Boolean).map(x => String(x).toUpperCase())));
  }

  function setAlertBannerMessage(box, msg){
    let inner = $('sessionAlertText');
    if (!inner) return;
    inner.textContent = String(msg || 'SIN ALERTAS CRÍTICAS.').toUpperCase();
    state.alerts.bannerText = inner.textContent;
  }

  function refreshSessionAlert(){
    const box = $('sessionAlert');
    if (!box) return;
    document.body.classList.remove('alert-change','alert-water','alert-test');
    const messages = buildSessionAlertMessages();
    const fallback = ['SIN ALERTAS CRÍTICAS.'];
    const joined = (messages.length ? messages : fallback).join(' || ');
    if (state.alerts._bannerKey !== joined){
      state.alerts._bannerKey = joined;
      state.alerts.bannerMessages = messages.length ? messages : fallback;
      state.alerts.bannerIdx = -1;
      state.alerts.bannerShownAt = 0;
    }
    const dwell = Math.max(1500, Math.min(12000, Number(state.settings.bannerDwellSec || 5) * 1000));
    const now = Date.now();
    if (!state.alerts.bannerShownAt || now - state.alerts.bannerShownAt >= dwell){
      state.alerts.bannerShownAt = now;
      state.alerts.bannerIdx = (state.alerts.bannerIdx + 1) % state.alerts.bannerMessages.length;
    }
    const currentMsg = state.alerts.bannerMessages[state.alerts.bannerIdx] || state.alerts.bannerMessages[0] || 'SIN ALERTAS CRÍTICAS.';
    let cls = 'info';
    if (/PROBLEMA|ERROR|DESCONECTADO|RECONEXIÓN|PENDIENTE|AHORA/.test(currentMsg)) cls = 'err';
    else if (/AGUA EN|CAMBIO DE TRAMO|TEST EN CURSO/.test(currentMsg)) cls = 'warn';
    else if (/DESVÍO TOTAL|TRAMO /.test(currentMsg)) cls = 'ok';
    box.className = 'alertBanner ' + cls;
    setAlertBannerMessage(box, currentMsg);
    if ($('bannerNow')) $('bannerNow').textContent = currentClockText();
    if ($('bannerEta')) $('bannerEta').textContent = endEtaText();
    box.title = currentMsg;
  }

  function nextLevelAfter(t){
    const windows = buildSegmentWindows();
    const nxt = windows.find(w => w.start > t + 1e-9);
    return nxt ? nxt.level : 'Fin';
  }

  function refreshStatusStrip(){
    const setChip = (id, tone, text, title) => {
      const el = $(id); if (!el) return;
      el.className = 'statusChip ' + tone;
      const spans = el.querySelectorAll('span');
      if (spans[1]) spans[1].textContent = text;
      el.title = title || text;
    };
    const hrAgeMs = state.ble.current.receivedAt ? (Date.now() - state.ble.current.receivedAt) : Infinity;
    setChip('chipBle', state.ble.connectionState === 'conectado' ? 'ok' : (state.ble.connectionState === 'conectando' || state.ble.connectionState === 'buscando' ? 'warn' : 'bad'), 'BLE', 'BLE: ' + state.ble.connectionState);
    setChip('chipHr', Number.isFinite(state.ble.current.bpm) && hrAgeMs < 5000 ? 'ok' : 'bad', 'Pulso', Number.isFinite(state.ble.current.bpm) ? ('Pulso: ' + Number(state.ble.current.bpm).toFixed(1) + ' bpm') : 'Sin señal de pulso');
    setChip('chipRun', state.plan.running ? 'ok' : ((state.plan.sessionLog || []).length ? 'warn' : 'neu'), 'Sesión', state.plan.running ? 'Sesión corriendo' : ((state.plan.sessionLog || []).length ? 'Sesión pausada' : 'Sesión lista'));
    const lastSaveAgo = state.plan._lastPersistAt ? (Date.now() - state.plan._lastPersistAt) : Infinity;
    setChip('chipSave', lastSaveAgo < 15000 ? 'ok' : 'warn', 'Guardado', lastSaveAgo < Infinity ? ('Último guardado hace ' + Math.round(lastSaveAgo/1000) + ' s') : 'Sin guardado reciente');
    const t = machineElapsed();
    const overdueWater = state.plan.waters.findIndex((w,i)=>!state.plan.waterTaken[i] && w <= t + 1e-9) !== -1;
    const nearWater = state.plan.waters.findIndex((w,i)=>!state.plan.waterTaken[i] && w > t + 1e-9 && w - t <= 30) !== -1;
    setChip('chipWater', overdueWater ? 'bad' : (nearWater ? 'warn' : 'ok'), 'Agua', overdueWater ? 'Toma de agua pendiente ahora' : (nearWater ? 'Agua próxima' : 'Agua controlada'));
    const delta = shownRealKcalAtTime(t) - shownKcalAtTime(t);
    setChip('chipAlert', Math.abs(delta) >= 10 ? 'bad' : (Math.abs(delta) >= 5 ? 'warn' : 'ok'), 'Alertas', 'Desvío actual: ' + (delta > 0 ? '+' : '') + num(delta,1) + ' kcal');
    const standalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
    setChip('chipPwa', standalone ? 'ok' : 'warn', 'App', standalone ? 'Abierta como app instalada' : 'Abierta en navegador');
    const test = isTestPlan();
    const seg = getPlanState().seg;
    const testWin = getTestMainWindow(); const testSeg = testWin ? String(testWin.seg||'').toUpperCase() : '';
    setChip('chipTest', test ? (seg === testSeg ? 'warn' : 'ok') : 'neu', 'Test', test ? ('Modo test activo' + (seg === testSeg ? (' · tramo ' + testSeg) : (testSeg ? (' · tramo ' + testSeg) : ''))) : 'Plan normal');
  }

  function exportTramoCsv(){
    const rows = state.plan.sessionLog || [];
    if (!rows.length){ log('No hay datos por tramo todavía', 'warn'); return; }
    const bySeg = {};
    rows.forEach(r => {
      const key = r.seg || 'Sin tramo';
      const realVal = Number((r.kcalReal ?? r.kcalPlan) || 0);
      bySeg[key] = bySeg[key] || { tramo:key, level:r.level, secs:0, kcalPlanStart:null, kcalPlanEnd:0, kcalRealStart:null, kcalRealEnd:0, bpm:[], zones:{} };
      const d = bySeg[key];
      d.secs += 1;
      if (d.kcalPlanStart == null) d.kcalPlanStart = Number(r.kcalPlan || 0);
      d.kcalPlanEnd = Number(r.kcalPlan || 0);
      if (d.kcalRealStart == null) d.kcalRealStart = realVal;
      d.kcalRealEnd = realVal;
      if (Number.isFinite(r.bpm)) d.bpm.push(r.bpm);
      const z = r.zone || 'Sin zona';
      d.zones[z] = (d.zones[z] || 0) + 1;
    });
    const out = Object.keys(bySeg).sort().map(seg => {
      const d = bySeg[seg];
      const mins = Math.max(1e-9, d.secs / 60);
      const kcalPlan = Math.max(0, d.kcalPlanEnd - (d.kcalPlanStart || 0));
      const kcalReal = Math.max(0, d.kcalRealEnd - (d.kcalRealStart || 0));
      const bpmAvg = d.bpm.length ? d.bpm.reduce((a,b)=>a+b,0)/d.bpm.length : null;
      const domZone = Object.entries(d.zones).sort((a,b)=>b[1]-a[1])[0]?.[0] || '--';
      return {
        tramo: seg,
        level: d.level,
        durationSec: d.secs,
        duration: fmtTime(d.secs),
        kcalPlan: Number(kcalPlan.toFixed(1)),
        kcalReal: Number(kcalReal.toFixed(1)),
        kcalDelta: Number((kcalReal - kcalPlan).toFixed(1)),
        kcalPerMinPlan: Number((kcalPlan / mins).toFixed(2)),
        kcalPerMinReal: Number((kcalReal / mins).toFixed(2)),
        bpmAvg: bpmAvg == null ? '' : Number(bpmAvg.toFixed(1)),
        zoneDominant: domZone
      };
    });
    const header = ['tramo','level','durationSec','duration','kcalPlan','kcalReal','kcalDelta','kcalPerMinPlan','kcalPerMinReal','bpmAvg','zoneDominant'];
    const csv = rowsToCsv(out, header);
    const name = downloadBlob(csv, 'sesion_eliptica_tramos.csv', 'text/csv;charset=utf-8');
    $('pwaBanner').textContent='CSV por tramos exportado: ' + name;
    log('CSV por tramos exportado', 'ok');
  }

  function renderHistory(){
    const box = $('historyList');
    if (!box) return;
    box.innerHTML = '';
    let items = [];
    try{
      const raw = localStorage.getItem(STORAGE_KEYS.previous);
      if (raw) {
        const prev = JSON.parse(raw);
        const sessionLog = Array.isArray(prev.sessionLog) ? prev.sessionLog : [];
        const minuteLog = Array.isArray(prev.minuteLog) ? prev.minuteLog : [];
        const last = sessionLog[sessionLog.length - 1] || {};
        const isTest = /test/i.test(($('planTitle')?.textContent)||'');
        items.push({ savedAt: prev.savedAt || '', isTest, duration: last.machineClock || '--', kcalReal: last.kcalReal ?? '--', kcalPlan: last.kcalPlan ?? '--', rows: sessionLog.length, minutes: minuteLog.length });
      }
    }catch(err){ log('Histórico no disponible: ' + ((err && err.message) || err), 'warn'); }
    const filter = $('historyFilter')?.value || 'all';
    if (filter === 'test') items = items.filter(x => x.isTest);
    if (filter === 'normal') items = items.filter(x => !x.isTest);
    if (!items.length){ box.innerHTML = '<div class="historyItem"><div class="historyMeta">Sin sesiones históricas guardadas todavía.</div></div>'; return; }
    items.forEach((it, idx) => {
      const div = document.createElement('div');
      div.className = 'historyItem';
      div.innerHTML = '<div class="historyTop"><strong>Sesión previa ' + (idx+1) + '</strong><span class="historyMeta">' + (it.savedAt || '--') + '</span></div>' +
        '<div class="historyMeta">Duración: ' + it.duration + ' · kcal plan: ' + it.kcalPlan + ' · kcal real: ' + it.kcalReal + ' · filas: ' + it.rows + ' · minutos: ' + it.minutes + '</div>';
      box.appendChild(div);
    });
  }

  function updateAppStatus(){
    if ($('appVersionVal')) $('appVersionVal').textContent = APP_VERSION + ' · ' + BUILD_STAMP;
    const standalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
    if ($('displayModeVal')) $('displayModeVal').textContent = standalone ? 'standalone' : 'browser';
    if ($('cacheStatusVal')) $('cacheStatusVal').textContent = ('serviceWorker' in navigator) ? 'SW disponible' : 'sin SW';
    if ($('lastBleVal')) $('lastBleVal').textContent = state.ble.device?.name || state.settings.blePreferredName || '--';
  }

  function refreshAll(){
    const steps = [
      ['refreshTimeline', refreshTimeline],
      ['refreshTop', refreshTop],
      ['refreshWater', refreshWater],
      ['refreshNextTable', refreshNextTable],
      ['drawCompareChart', drawCompareChart],
      ['refreshSessionAlert', refreshSessionAlert],
      ['refreshStatusStrip', refreshStatusStrip]
    ];
    let failed = 0;
    for (const [name, fn] of steps){
      try { fn(); }
      catch(err){ failed += 1; log('[REFRESH ' + name + '] ' + (((err && err.message) || err)), 'err'); }
    }
    if (failed === 0) state.app.lastRefreshOkAt = Date.now();
  }
  function stopRunLoop(){
    try{
      if (state.plan.timer) clearInterval(state.plan.timer);
      state.plan.timer = null;
      if (state.plan.rafId) cancelAnimationFrame(state.plan.rafId);
      state.plan.rafId = null;
    }catch{}
  }
  function runLoop(){ /* reservado por compatibilidad */ }

  function finishSessionOnce(){
    if (state.plan._finishedOnce) return;
    state.plan._finishedOnce = true;
    state.plan.baseMachineSec = state.plan.duration;
    state.plan.running = false;
    stopRunLoop();
    $('startBtn').textContent = '▶ Empezar';
    $('startBtnTop').textContent = '▶ Empezar';
    $('statusLine').textContent = 'Finalizada';
    finalizeMinuteLogs();
    buildFinalSummary();
    buildTramoSummary();
    compareWithPrevious();
    savePreviousSession();
    clearLiveSession();
    disableInternalWakeLock().catch(()=>{});
    refreshAll();
    log('Sesión finalizada', 'ok');
  }

  function toggleRun(){
    if (!state.plan.rows.length){ log('Carga primero un plan', 'warn'); return; }
    if (state.plan.running){
      maybeRecordSessionSecond();
      maybeRecordMinuteSummary();
      state.plan.baseMachineSec = machineElapsed();
      state.plan.running = false;
      stopRunLoop();
      $('startBtn').textContent = '▶ Reanudar';
      $('startBtnTop').textContent = '▶ Reanudar';
      $('statusLine').textContent = 'Pausada';
      refreshAll();
      maybePersistLiveSession(true);
      disableInternalWakeLock().catch(()=>{});
      log('Sesión pausada', 'warn');
      return;
    }
    if (!state.plan.sessionStartedAt) state.plan.sessionStartedAt = new Date().toISOString();
    state.plan.running = true;
    state.plan._finishedOnce = false;
    state.plan.t0 = performance.now();
    $('startBtn').textContent = '⏸ Pausa';
    $('startBtnTop').textContent = '⏸ Pausa';
    $('statusLine').textContent = 'Corriendo';
    stopRunLoop();
    enableInternalWakeLock().catch(()=>{});
    state.plan.timer = window.setInterval(() => tick(), 250);
    log(state.plan.baseMachineSec > 0 ? 'Sesión reanudada' : 'Sesión iniciada', 'ok');
    tick();
  }

  function seek(delta){
    state.plan.baseMachineSec = clamp(machineElapsed() + delta, 0, state.plan.duration);
    if (state.plan.running) state.plan.t0 = performance.now();
    if ((state.plan.lastRecordedSecond ?? -1) > Math.floor(state.plan.baseMachineSec)){
      state.plan.sessionLog = state.plan.sessionLog.filter(r => r.second <= Math.floor(state.plan.baseMachineSec));
      state.plan.minuteLog = buildMinuteRowsFresh().filter(r => r.minute <= Math.floor(state.plan.baseMachineSec / 60));
      state.plan.lastRecordedSecond = state.plan.sessionLog.length ? state.plan.sessionLog[state.plan.sessionLog.length - 1].second : -1;
      state.plan.lastRecordedMinute = state.plan.minuteLog.length ? state.plan.minuteLog[state.plan.minuteLog.length - 1].minute - 1 : -1;
    }
    refreshAll(); maybePersistLiveSession(true);
  }

  function tick(){
    try{
      const t = machineElapsed();
      maybeRecordSessionSecond();
      maybeRecordMinuteSummary();
      queueSegmentCues();
      maybeQueueRealtimeAlerts();
      checkBleHealth();
      refreshAll();
      if (t >= state.plan.duration - 1e-6){
        finishSessionOnce();
        return;
      }
      maybePersistLiveSession(false);
    }catch(err){
      stopRunLoop();
      state.plan.running = false;
      $('startBtn').textContent = '▶ Empezar';
      $('startBtnTop').textContent = '▶ Empezar';
      $('statusLine').textContent = 'Error';
      log('Error en tick: ' + (err.message || err), 'err');
      console.error(err);
    }
  }

  function resetPlan(){
    state.plan.running = false;
    stopRunLoop();
    state.plan.baseMachineSec = 0;
    state.plan.realKcalOffset = 0;
    state.plan.waterTaken = new Array(state.plan.waters.length).fill(false);
    state.plan.wakeLastTapMachine = 0;
    if (state.plan.sessionLog.length){
      buildFinalSummary();
      buildTramoSummary();
      compareWithPrevious();
      savePreviousSession();
    }
    clearLiveSession();
    disableInternalWakeLock().catch(()=>{});
    state.plan.sessionLog = [];
    state.plan.minuteLog = [];
    state.plan.sessionStartedAt = null;
    state.plan.lastRecordedSecond = -1;
    state.plan.lastRecordedMinute = -1;
    state.plan.markers = [];
    state.plan._finishedOnce = false;
    $('startBtn').textContent = '▶ Empezar';
    $('startBtnTop').textContent = '▶ Empezar';
    $('statusLine').textContent = 'Lista';
    refreshAll();
  }


  function withTapGuard(key, fn, ms=300){
    return async function(ev){
      if (ev){
        if (typeof ev.preventDefault === 'function') ev.preventDefault();
        if (typeof ev.stopPropagation === 'function') ev.stopPropagation();
      }
      const now = Date.now();
      const last = state.app.lastTapTsByKey[key] || 0;
      if (now - last < ms) { log('[CHECK] Toque duplicado ignorado en ' + key, 'warn'); return; }
      state.app.lastTapTsByKey[key] = now;
      return await fn(ev);
    };
  }

  function bindAction(id, key, fn, ms=300){
    const el = $(id);
    if (!el){
      log('[CHECK] Falta control #' + id, 'err');
      state.app.boundButtons[id] = false;
      return false;
    }
    try{
      if (el._boundClickHandler) el.removeEventListener('click', el._boundClickHandler);
      const handler = withTapGuard(key, async (ev) => {
        log('[BTN ' + key + '] #' + id + ' pulsado', 'ok');
        try{ const result = await fn(ev); log('[BTN ' + key + '] OK', 'ok'); return result; }
        catch(err){ log('Error en botón #' + id + ': ' + ((err && err.message) || err), 'err'); return false; }
      }, ms);
      el._boundClickHandler = handler;
      el.addEventListener('click', handler, { passive:false });
      el.dataset.bound='ok';
      state.app.boundButtons[id]=true;
      log('[CHECK] Botón #' + id + ' enlazado', 'ok');
      return true;
    }catch(err){
      state.app.boundButtons[id]=false;
      log('[CHECK] Botón #' + id + ' falló al enlazar: ' + ((err && err.message) || err), 'err');
      return false;
    }
  }
  function bindSeekButtons(){ const list = Array.from(document.querySelectorAll('.seekBtn')); if (!list.length){ log('[CHECK] No hay botones seek visibles', 'warn'); return 0; } list.forEach(btn => { btn.onclick = null; const code='seek'+btn.dataset.seek; btn.addEventListener('click', withTapGuard(code, () => { log('[BTN ' + code + '] .seekBtn pulsado', 'ok'); return seek(Number(btn.dataset.seek || 0)); }, 120)); btn.dataset.bound='ok'; }); log('[CHECK] Seek enlazados: ' + list.length, 'ok'); return list.length; }
  function runStartupDiagnostics(){
    log('[STARTUP] Inicio comprobación ' + APP_VERSION, 'ok');
    log('[STARTUP] orientación=' + ((screen.orientation&&screen.orientation.type)||'desconocida') + ' · viewport=' + window.innerWidth + 'x' + window.innerHeight + ' · scrollY=' + window.scrollY, 'ok');
    const requiredIds=['startBtn','resetBtn','startBtnTop','resetBtnTop','applyPlanBtn','previewPlanBtn','normalizePlanBtn','kRealPlusBtn','kRealPlusHalfBtn','kRealPlusTenthBtn','kRealMinusTenthBtn','kRealMinusHalfBtn','kRealMinusBtn','segmentDeltaVal','kDeltaStat','paceRealVal','paceNeedVal','waterCountVal','sessionAlert','sessionAlertText','bannerNow','bannerEta','bannerSpeedRange','waterCard','compareCanvas','nextBody','chipBle','chipHr','chipRun','chipSave','chipWater','chipAlert','chipPwa','chipTest','notifPermissionBtn','browserNotifyChk','voiceAlertsChk','beepAlertsChk','voiceSelect'];
    let ok=0, fail=0;
    requiredIds.forEach(id => { if ($(id)){ log('[CHECK] DOM #' + id + ' ok', 'ok'); ok++; } else { log('[CHECK] DOM #' + id + ' falta', 'warn'); fail++; } });
    const fnMap = {withTapGuard, bindAction, bindSeekButtons, drawCompareChart, refreshAll, refreshTop, refreshWater, refreshNextTable, refreshBle, refreshStatusStrip, refreshSessionAlert, updateAppStatus, renderHistory, toggleRun, resetPlan, applyImport, previewImport, normalizeCurrentImport, saveLiveSession, loadLiveSession, exportSessionLog, exportMinuteLog, exportSessionJson, exportTramoCsv, buildFinalSummary, buildTramoSummary, compareWithPrevious, copySummary, copyChatgptSummary, exportPlanTxt, clearAppData, copyAllLogs, rerunDiagnostics, compareLastAction, finalSummaryAction, requestBrowserNotifications, sendBrowserNotification, saveSettings, loadSettings, renderSettingsUI, queueSegmentCues, maybeQueueRealtimeAlerts, refreshVoicesAction, listVoicesAction, listNotifAction, testVoiceAction, testNotifyAction, saveTestCaptureAndContinue, closeTestModal, calcLiveDerivedMetrics, connectBle, reconnectBle, disconnectBle, bleDiag, registerPWA, updateSavedSessionInfo, updateExtraSavedInfo, autoConnectBleOnLaunch, updateAppNow, buildSessionAlertMessages, displayBpmValue};
    Object.entries(fnMap).forEach(([k,v]) => { if (typeof v === 'function'){ log('[CHECK] Función ' + k + ' ok', 'ok'); ok++; } else { log('[CHECK] Función ' + k + ' falta', 'err'); fail++; } });
    try{
      const m = calcLiveDerivedMetrics();
      log('[CHECK] Métricas vivas ok · tramo=' + num(m.segmentDelta,1) + ' · total=' + num(m.totalDelta,1) + ' · ritmoReal=' + num(m.paceReal,2) + ' · ritmoPlan=' + num(m.paceNeed,2) + ' · agua=' + m.waterTaken + '/' + m.waterTotal, 'ok');
      safeSetText('segmentDeltaVal', (m.segmentDelta > 0 ? '+' : (m.segmentDelta < 0 ? '' : '±')) + num(m.segmentDelta,1) + ' kcal');
      safeSetText('paceRealVal', num(m.paceReal,2) + ' kcal/min');
      safeSetText('paceNeedVal', num(m.paceNeed,2) + ' kcal/min');
      safeSetText('waterCountVal', m.waterTaken + ' / ' + m.waterTotal);
      ok++;
    }catch(err){ log('[CHECK] Métricas vivas error: ' + (((err && err.message) || err)), 'err'); fail++; }
    try{ const voices = (window.speechSynthesis && speechSynthesis.getVoices ? speechSynthesis.getVoices() : []) || []; log('[CHECK] Voces detectadas al arranque: ' + voices.length, voices.length ? 'ok' : 'warn'); ok++; }catch(err){ log('[CHECK] Voces error: ' + (((err && err.message) || err)), 'err'); fail++; }
    try{ log('[CHECK] Notificaciones API: ' + ('Notification' in window ? 'sí' : 'no'), 'ok'); ok++; }catch(err){ fail++; }
    try{ log('[CHECK] Clipboard API: ' + (navigator.clipboard ? 'sí' : 'no'), navigator.clipboard ? 'ok' : 'warn'); ok++; }catch(err){ fail++; }
    try{ log('[CHECK] Web Bluetooth API: ' + (navigator.bluetooth ? 'sí' : 'no'), navigator.bluetooth ? 'ok' : 'warn'); ok++; }catch(err){ fail++; }
    try{ log('[CHECK] ServiceWorker API: ' + ('serviceWorker' in navigator ? 'sí' : 'no'), ('serviceWorker' in navigator) ? 'ok' : 'warn'); ok++; }catch(err){ fail++; }
    const boundOk = Object.values(state.app.boundButtons).filter(Boolean).length;
    const boundFail = Object.values(state.app.boundButtons).filter(v => v===false).length;
    log('[CHECK] Botones enlazados: ' + boundOk + ' · fallos de enlace: ' + boundFail, boundFail ? 'warn' : 'ok');
    state.app.startupChecks.push({ ts: Date.now(), ok, fail, version: APP_VERSION, build: BUILD_STAMP, boundOk, boundFail });
    log('[STARTUP] Resumen checks · ok=' + ok + ' · fail=' + fail, fail ? 'warn' : 'ok');
  }
  function bind(){
    bindAction('applyPlanBtn','applyPlan',applyImport); bindAction('previewPlanBtn','previewPlan',()=>{ previewImport(); log('Vista previa del plan actualizada','ok'); }); bindAction('normalizePlanBtn','normalizePlan',normalizeCurrentImport); bindAction('clearPlanBtn','clearPlan',()=>{ $('importBox').value=''; renderImportPreview(null); }); bindAction('copyPlanBtn','copyPlan',async()=>{ const txt=$('importBox').value; if(!txt) throw new Error('No hay texto para copiar'); await copyTextSafe(txt); log('Texto del plan copiado','ok'); });
    bindAction('startBtn','toggleRun1',toggleRun); bindAction('startBtnTop','toggleRun2',toggleRun); bindAction('resetBtn','reset1',resetPlan); bindAction('resetBtnTop','reset2',resetPlan); bindSeekButtons();
    bindAction('continueApplyBtn','continueApply',applyContinue); bindAction('continueClearBtn','continueClear',clearContinue);
    bindAction('kRealPlusBtn','kplus',()=>adjustRealKcal(1),120); bindAction('kRealPlusHalfBtn','kplushalf',()=>adjustRealKcal(0.5),120); bindAction('kRealPlusTenthBtn','kplustenth',()=>adjustRealKcal(0.1),120); bindAction('kRealMinusTenthBtn','kminustenth',()=>adjustRealKcal(-0.1),120); bindAction('kRealMinusHalfBtn','kminushalf',()=>adjustRealKcal(-0.5),120); bindAction('kRealMinusBtn','kminus',()=>adjustRealKcal(-1),120);
    bindAction('waterCard','watercard',()=>{ const t=machineElapsed(); for(let i=0;i<state.plan.waters.length;i++){ if(!state.plan.waterTaken[i] && Math.abs(state.plan.waters[i]-t)<=120){ state.plan.waterTaken[i]=true; break; } } refreshAll(); saveLiveSession(); });
    document.addEventListener('pointerdown', ev => { const target=ev.target; if (target.closest('button') || target.closest('textarea') || target.closest('input') || target.closest('select')) return; const t=machineElapsed(); state.plan.wakeLastTapMachine=t; for(let i=0;i<state.plan.waters.length;i++){ if(!state.plan.waterTaken[i] && state.plan.waters[i] <= t + 1e-9){ state.plan.waterTaken[i]=true; break; } } refreshAll(); saveLiveSession(); }, {passive:true}); log('[CHECK] Listener táctil general: ok','ok');
    bindAction('bleConnectBtn','bleConnect',connectBle,500); bindAction('bleReconnectBtn','bleReconnect',reconnectBle,500); bindAction('bleDisconnectBtn','bleDisconnect',disconnectBle,300); bindAction('bleDiagBtn','bleDiag',bleDiag,300);
    bindAction('notifPermissionBtn','notifPermission',requestBrowserNotifications,300); bindAction('testNotifyBtn','testNotify',testNotifyAction,300); bindAction('refreshVoicesBtn','refreshVoices',refreshVoicesAction,300); bindAction('listVoicesBtn','listVoices',listVoicesAction,300); bindAction('listNotifBtn','listNotif',listNotifAction,300); bindAction('testVoiceBtn','testVoice',testVoiceAction,300);
    bindAction('installBtn','install',promptInstall); bindAction('refreshAppBtn','refreshApp',updateAppNow); bindAction('copyLogsBtn','copyLogs',copyAllLogs,300); bindAction('runChecksBtn','runChecks',rerunDiagnostics,300); bindAction('exportSessionBtn','exportSession',exportSessionLog); bindAction('exportMinuteBtn','exportMinute',exportMinuteLog); bindAction('resumeSessionBtn','resumeSession',loadLiveSession); bindAction('finalSummaryBtn','finalSummary',()=>{ buildFinalSummary(); buildTramoSummary(); compareWithPrevious(); }); bindAction('exportSessionJsonBtn','exportJson',exportSessionJson); bindAction('compareLastBtn','compareLast',()=>{ $('finalSummaryBox').value += '\n\n' + compareWithPrevious(); }); bindAction('exportTramoCsvBtn','exportTramo',exportTramoCsv); bindAction('copySummaryBtn','copySummary',copySummary); bindAction('copyChatgptBtn','copyChatgpt',copyChatgptSummary); bindAction('exportPlanTxtBtn','exportPlan',exportPlanTxt); bindAction('clearAppDataBtn','clearAppData',clearAppData,500);
    bindAction('markWaterBtn','markWater',()=>addMarker('agua')); bindAction('markIncidentBtn','markIncident',()=>addMarker('incidencia')); bindAction('markStrongBtn','markStrong',()=>addMarker('bloque fuerte')); bindAction('markPainRightBtn','markPainRight',()=>addMarker('dolor cadena derecha')); bindAction('markPainTibialBtn','markPainTibial',()=>addMarker('dolor tibial'));
    bindAction('testSaveContinueBtn','testSave',saveTestCaptureAndContinue); bindAction('testCloseBtn','testClose',closeTestModal);
    const historyFilter = $('historyFilter'); if (historyFilter){ historyFilter.onchange = () => { log('[BTN historyFilter] #historyFilter cambiado', 'ok'); renderHistory(); }; log('[CHECK] Filtro histórico: ok','ok'); } else log('[CHECK] Filtro histórico: falta','warn');
    const browserNotifyChk = $('browserNotifyChk'); if (browserNotifyChk){ browserNotifyChk.onchange = () => { state.settings.browserNotify = !!browserNotifyChk.checked; saveSettings(); log('[BTN browserNotify] cambio a ' + state.settings.browserNotify, 'ok'); }; }
    const voiceAlertsChk = $('voiceAlertsChk'); if (voiceAlertsChk){ voiceAlertsChk.onchange = () => { state.settings.voiceAlerts = !!voiceAlertsChk.checked; saveSettings(); log('[BTN voiceAlerts] cambio a ' + state.settings.voiceAlerts, 'ok'); }; }
    const beepAlertsChk = $('beepAlertsChk'); if (beepAlertsChk){ beepAlertsChk.onchange = () => { state.settings.beepAlerts = !!beepAlertsChk.checked; saveSettings(); log('[BTN beepAlerts] cambio a ' + state.settings.beepAlerts, 'ok'); }; }
    const voiceSelect = $('voiceSelect'); if (voiceSelect){ voiceSelect.onchange = () => { state.settings.voiceName = voiceSelect.value || ''; saveSettings(); log('[BTN voiceSelect] voz ' + (state.settings.voiceName || 'sistema'), 'ok'); }; }
    const voiceVolumeRange = $('voiceVolumeRange'); if (voiceVolumeRange){ voiceVolumeRange.oninput = () => { state.settings.voiceVolume = Number(voiceVolumeRange.value || 1); if ($('voiceVolumeVal')) $('voiceVolumeVal').textContent = state.settings.voiceVolume.toFixed(1); saveSettings(); log('[BTN voiceVolume] ' + state.settings.voiceVolume.toFixed(1), 'ok'); }; }
    const voiceRateRange = $('voiceRateRange'); if (voiceRateRange){ voiceRateRange.oninput = () => { state.settings.voiceRate = Number(voiceRateRange.value || 1); if ($('voiceRateVal')) $('voiceRateVal').textContent = state.settings.voiceRate.toFixed(2); saveSettings(); log('[BTN voiceRate] ' + state.settings.voiceRate.toFixed(2), 'ok'); }; }
    const bannerSpeedRange = $('bannerSpeedRange'); if (bannerSpeedRange){ bannerSpeedRange.oninput = () => { state.settings.bannerDwellSec = Number(bannerSpeedRange.value || 5); if ($('bannerSpeedVal')) $('bannerSpeedVal').textContent = state.settings.bannerDwellSec.toFixed(0) + ' s'; saveSettings(); state.alerts.bannerShownAt = 0; log('[BTN bannerSpeed] ' + state.settings.bannerDwellSec.toFixed(0) + ' s', 'ok'); refreshSessionAlert(); }; }
    const alertToggleMap = {toggleSegmentPreChk:'segmentPre', toggleSegmentNowChk:'segmentNow', toggleWaterPreChk:'waterPre', toggleWaterNowChk:'waterNow', toggleSegRemainChk:'segRemain', toggleAllRemainChk:'allRemain', toggleHrChk:'hr', toggleKcalChk:'kcal'};
    Object.entries(alertToggleMap).forEach(([id,key]) => { const el = $(id); if (el){ el.onchange = () => { setAlertKind(key, !!el.checked); log('[BTN ' + id + '] cambio a ' + (!!el.checked), 'ok'); }; } });
  }
  loadSettings(); bind(); runStartupDiagnostics(); registerPWA(); updateSavedSessionInfo(); updateExtraSavedInfo(); renderHistory(); updateAppStatus(); renderSettingsUI(); autoConnectBleOnLaunch();
  if (window.speechSynthesis && speechSynthesis.onvoiceschanged !== undefined) speechSynthesis.onvoiceschanged = () => renderSettingsUI();
  try{ const lastPlan = localStorage.getItem(STORAGE_KEYS.plan); if (lastPlan && $('importBox')) $('importBox').value = lastPlan; }catch{}
  try{ if (localStorage.getItem(STORAGE_KEYS.live)) loadLiveSession(); }catch{}
  renderImportPreview(parseImportText($('importBox').value || '')); refreshAll(); refreshBle(); if ($('appVersionVal')) $('appVersionVal').textContent = APP_VERSION + ' · ' + BUILD_STAMP; log('UI lista · ' + APP_VERSION + ' · build ' + BUILD_STAMP + ' · métricas y alertas robustas activas', 'ok');
})();