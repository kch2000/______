(() => {
'use strict';
const APP_VERSION='v69';
const BUILD='2026-04-18 18:10';
const $=id=>document.getElementById(id);
const STATE_KEY='eliptica_state_current'; const VERSIONED_STATE_KEY=`eliptica_state_${APP_VERSION}`; const LAST_SESSION_KEY='lastCompletedSession'; const state={phase:'idle',countdown:{active:false},plan:null,startTs:null,pausedAccumMs:0,pauseTs:null,elapsedSec:0,machineOffsetSec:0,lastSec:-1,realOffset:0,history:[],logs:[],installPrompt:null,bannerIndex:0,bannerHoldMs:5000,bannerLastChange:0,bpmSamples:[],swReg:null,lastActionTs:0,lastRenderTick:0,wakeLock:null,timeCal:{enabled:false,appRefSec:0,realRefSec:0,factorOverall:1,factorAfterMinute:1},voice:{supported:('speechSynthesis' in window),unlocked:false,enabled:true,voices:[],selectedURI:'',queue:[],speaking:false,lastByKey:{},volume:1,rate:1,browserNotify:false,beepEnabled:true},audio:{ctx:null,unlocked:false},alerts:{lastKey:{},lastSecChecked:-1,lastNotifTs:0,finished:false,pulseSide:'ok',pulseSinceTs:0,pulseLastAlertTs:0},ble:{device:null,server:null,hrChar:null,connected:false,lastPacketTs:0,deviceName:'',autoAttempted:false,status:'EMparejar requerido',detail:'',reconnectAttempts:0,reconnectTimer:null,battery:null,lastRR:null}};
const els={};
const MACHINE_TIME_FACTOR=1; // base sin calibración automática; la calibración previa se aplica por estado.timeCal
const ids=['timelineBar','timelineMarkers','playhead','tickerNow','tickerMsg','tickerEta','sessionBadge','planTitle','timeBig','timeRealLabel','kPlanBig','kRealBig','bpmBig','bpmTargetLabel','avgPlanLabel','avgRealLabel','deviationTotalLabel','deviationSegmentLabel','realRateLabel','planRateLabel','waterCountLabel','upcomingBody','upcomingVisibleLabel','waterNextLabel','waterProgressBar','chipBle','chipPulse','chipSession','chipSaved','chipWater','chipAlerts','chipApp','chipTest','bleStatusLabel','bleBpmBig','ble5s','ble10s','ble30s','bleLastPkt','bleDeviceName','planInput','importOutput','versionLabel','pwaStateLabel','logBox','voiceSelect','voiceStatus','voiceVolumeRange','voiceVolumeVal','voiceRateRange','voiceRateVal','browserNotifyChk','voiceAlertsChk','beepAlertsChk','bleState','bleBattery','bleRR','wakeLockLabel','countdownOverlay','countdownRing','countdownNumber','countdownSub','calAppRefInput','calRealRefInput','calFactorLabel'];
function cacheEls(){ids.forEach(id=>els[id]=$(id)); if(els.versionLabel) els.versionLabel.textContent=`${APP_VERSION} · ${BUILD}`;}
function addLog(msg){const t=new Date().toTimeString().slice(0,8); state.logs.push(`[${t}] ${msg}`); if(state.logs.length>800) state.logs.shift(); if(els.logBox){els.logBox.textContent=state.logs.join('\n'); els.logBox.scrollTop=els.logBox.scrollHeight;}}
function setPwaState(msg){ if(els.pwaStateLabel) els.pwaStateLabel.textContent = msg; }
function appUrl(path='index.html'){ return `./${path}?v=${APP_VERSION}&t=${Date.now()}`; }

function setBleStatus(status, detail=''){
  state.ble.status = status;
  state.ble.detail = detail || '';
}

function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }
function showCountdownUi(value, sub='EL EJERCICIO COMIENZA EN…', go=false){
  if(!els.countdownOverlay) return;
  els.countdownOverlay.classList.add('show');
  els.countdownOverlay.setAttribute('aria-hidden','false');
  if(els.countdownNumber) els.countdownNumber.textContent = String(value);
  if(els.countdownSub) els.countdownSub.textContent = sub;
  if(els.countdownOverlay) els.countdownOverlay.classList.toggle('countdown-go', !!go);
}
function hideCountdownUi(){
  if(!els.countdownOverlay) return;
  els.countdownOverlay.classList.remove('show','countdown-go');
  els.countdownOverlay.setAttribute('aria-hidden','true');
}
function startSessionNow(origin='start'){
  state.startTs = Date.now() - (state.elapsedSec*1000);
  state.pauseTs = null;
  state.phase='running';
  state.lastSec = Math.max(-1, state.elapsedSec-1);
  state.alerts.finished=false;
  requestWakeLock();
  addLog(`[SESSION] ${origin==='resume'?'Reanudada':'Iniciada'}`);
  persist();
  capturePoint(true);
  renderAll();
}
async function runInitialCountdown(){
  if(state.countdown.active) return;
  state.countdown.active = true;
  renderAll();
  clearVoiceQueue('COUNTDOWN');
  showCountdownUi(10);
  for(let n=10; n>=1; n--){
    showCountdownUi(n);
    if(state.voice.beepEnabled) beep(n<=3?'critical':'info');
    if(n<=3 && state.voice.enabled && state.voice.supported && state.voice.unlocked){
      enqueueVoiceAdvanced(String(n),{priority:5,category:'countdown',key:`count_${n}_${Date.now()}`,cooldownMs:0,replaceCategory:true});
    }
    await sleep(1000);
  }
  showCountdownUi('COMIENZA', 'YA PUEDES EMPEZAR A DARLE', true);
  if(state.voice.beepEnabled) beep('critical');
  if(state.voice.enabled && state.voice.supported && state.voice.unlocked){
    enqueueVoiceAdvanced('COMIENZA.',{priority:6,category:'countdown',key:`count_go_${Date.now()}`,cooldownMs:0,replaceCategory:true});
  }
  await sleep(700);
  hideCountdownUi();
  state.countdown.active = false;
  startSessionNow('start');
}
function previewVoiceSettings(){
  if(!state.voice.supported || !state.voice.unlocked) return;
  clearVoiceQueue('PREVIEW VOZ');
  enqueueVoiceAdvanced('PRUEBA RÁPIDA DE VOZ.',{priority:6,category:'preview',key:`preview_${Date.now()}`,cooldownMs:0,replaceCategory:true});
}
function updateTickerOverflow(){
  const el=els.tickerMsg;
  const box=el?.parentElement;
  if(!el || !box) return;
  el.classList.remove('scroll');
  el.style.removeProperty('--ticker-travel');
  el.style.removeProperty('--ticker-duration');
  requestAnimationFrame(()=>{
    const overflow = Math.ceil(el.scrollWidth - box.clientWidth);
    if(overflow>12){
      const travel = overflow + box.clientWidth + 36;
      el.style.setProperty('--ticker-travel', `${travel}px`);
      el.style.setProperty('--ticker-duration', `${Math.max(10, Math.round(travel/55))}s`);
      el.classList.add('scroll');
    }
  });
}
function updateButtonDisabledStates(){
  const needPlan=['startBtn','resetBtn','seekPlus60','seekPlus10','seekPlus5','seekPlus1','seekMinus1','seekMinus5','seekMinus10','seekMinus60','kPlus1','kPlus05','kPlus01','kMinus01','kMinus05','kMinus1','eqSegmentBtn'];
  needPlan.forEach(id=>{ const el=$(id); if(el) el.disabled = !state.plan; });
  const calLocked = state.phase==='running' || state.phase==='paused' || currentRealElapsed()>0;
  ['applyCalBtn','clearCalBtn','calAppRefInput','calRealRefInput'].forEach(id=>{ const el=$(id); if(el) el.disabled = calLocked; });
  const minuteBtn=$('exportMinuteBtn'); if(minuteBtn) minuteBtn.disabled = !buildMinuteRows().length;
  const sessionBtn=$('exportSessionBtn'); if(sessionBtn) sessionBtn.disabled = !state.history.length;
  const tramoBtn=$('exportTramoCsvBtn'); if(tramoBtn) tramoBtn.disabled = !buildSegmentSummary().length;
}
async function requestWakeLock(){
  try{
    if(!('wakeLock' in navigator)) return false;
    if(state.wakeLock) return true;
    state.wakeLock = await navigator.wakeLock.request('screen');
    state.wakeLock.addEventListener('release', ()=>{ addLog('[WAKE] liberado'); state.wakeLock=null; renderAll(); });
    addLog('[WAKE] activo');
    renderAll();
    return true;
  }catch(e){ addLog('[WAKE] ERROR: '+(e.message||e)); return false; }
}
async function releaseWakeLock(){
  try{
    if(state.wakeLock){ await state.wakeLock.release(); state.wakeLock=null; addLog('[WAKE] release solicitado'); renderAll(); }
  }catch(e){ addLog('[WAKE] release ERROR: '+(e.message||e)); }
}
function saveCompletedSession(reason='manual'){
  const payload = {elapsedSec:currentElapsed(),realElapsedSec:currentRealElapsed(),machineOffsetSec:state.machineOffsetSec||0,kReal:currentRealKcal(),kPlan:currentPlanKcal(),summary:summaryText(),when:Date.now(),reason,version:APP_VERSION};
  try{ localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(payload)); addLog('[SAVE] Sesión final guardada'); }catch(e){ addLog('[SAVE] ERROR final: '+(e.message||e)); }
}

function unlockAudio(){
  try{
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if(!Ctx) return false;
    if(!state.audio.ctx) state.audio.ctx = new Ctx();
    if(state.audio.ctx.state === 'suspended') state.audio.ctx.resume();
    state.audio.unlocked = true;
    return true;
  }catch(e){ addLog('[AUDIO] Unlock ERROR: '+(e.message||e)); return false; }
}
function beep(kind='info'){
  if(!state.voice.beepEnabled) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if(!Ctx) return;
  try{
    if(!state.audio.ctx) state.audio.ctx = new Ctx();
    const ctx = state.audio.ctx;
    if(ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = kind==='critical' ? 1760 : 1320;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now+0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now+0.16);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(now); osc.stop(now+0.18);
    addLog('[AUDIO] Beep '+kind);
  }catch(e){ addLog('[AUDIO] Beep ERROR: '+(e.message||e)); }
}
function alertKeyOk(key,cooldownMs){
  const now = Date.now();
  const prev = state.alerts.lastKey[key] || 0;
  if(now - prev < cooldownMs) return false;
  state.alerts.lastKey[key] = now;
  return true;
}
function pushAlert(key, text, opts={}){
  const {cooldownMs=30000, notifyTitle='Eliptica PWA', notifyBody=text, cls='good', beepKind='', doVoice=true, doNotify=false, priority=1, category='generic', replaceCategory=false} = opts;
  if(!alertKeyOk(key,cooldownMs)) { addLog('[ALERT] SKIP DUPLICADO: '+key); return false; }
  addLog('[ALERT] '+text);
  if(doVoice) enqueueVoiceAdvanced(text,{priority, category, key:'alert_'+key, cooldownMs:0, replaceCategory});
  if(doNotify) notifyMaybe(notifyTitle, notifyBody, 'alert-'+key);
  if(beepKind) beep(beepKind);
  return true;
}

function syncVoiceUi(){
  if(els.voiceVolumeRange) els.voiceVolumeRange.value=String(state.voice.volume);
  if(els.voiceVolumeVal) els.voiceVolumeVal.textContent=Number(state.voice.volume).toFixed(1);
  if(els.voiceRateRange) els.voiceRateRange.value=String(state.voice.rate);
  if(els.voiceRateVal) els.voiceRateVal.textContent=Number(state.voice.rate).toFixed(2);
  if(els.browserNotifyChk) els.browserNotifyChk.checked=!!state.voice.browserNotify;
  if(els.voiceAlertsChk) els.voiceAlertsChk.checked=!!state.voice.enabled;
  if(els.beepAlertsChk) els.beepAlertsChk.checked=!!state.voice.beepEnabled;
}
function populateVoiceSelect(){
  if(!els.voiceSelect) return;
  els.voiceSelect.innerHTML='';
  const voices=state.voice.voices||[];
  if(!voices.length){ const o=document.createElement('option'); o.value=''; o.textContent='Sin voces detectadas'; els.voiceSelect.appendChild(o); if(els.voiceStatus) els.voiceStatus.textContent='Sin voces detectadas'; return; }
  voices.forEach(v=>{ const o=document.createElement('option'); o.value=v.voiceURI; o.textContent=`${v.name} · ${v.lang}`; if(v.voiceURI===state.voice.selectedURI) o.selected=true; els.voiceSelect.appendChild(o); });
  const v=voices.find(v=>v.voiceURI===state.voice.selectedURI) || voices[0];
  if(v && els.voiceStatus) els.voiceStatus.textContent=`Voz actual: ${v.name} · ${v.lang}`;
}
async function requestNotificationPermission(){
  if(!('Notification' in window)) throw new Error('Notifications no disponible');
  const res=await Notification.requestPermission();
  addLog(`[NOTIF] Permiso: ${res}`);
  state.voice.browserNotify = (res==='granted'); addLog('[NOTIF] Toggle navegador/reloj: '+(state.voice.browserNotify?'ON':'OFF'));
  syncVoiceUi();
  return res;
}
async function testNotify(){
  if(!('Notification' in window)) throw new Error('Notifications no disponible');
  const perm = Notification.permission==='granted' ? 'granted' : await Notification.requestPermission();
  if(perm!=='granted') throw new Error('Permiso no concedido');
  const title=`Eliptica PWA ${APP_VERSION}`;
  const body='Notificación de prueba lanzada';
  if(state.swReg && state.swReg.showNotification){ await state.swReg.showNotification(title,{body,tag:'test-notify',renotify:true}); }
  else new Notification(title,{body,tag:'test-notify'});
  addLog('[NOTIF] Prueba enviada');
}
function notifyMaybe(title,body,tag='elliptica-info'){
  if(!state.voice.browserNotify){ addLog('[NOTIF] SKIP browserNotify OFF'); return; }
  if(!('Notification' in window) || Notification.permission!=='granted'){ addLog('[NOTIF] SKIP permiso no granted'); return; }
  try{ if(state.swReg && state.swReg.showNotification) state.swReg.showNotification(title,{body,tag,renotify:false,silent:false,vibrate:[120,80,120]}); else new Notification(title,{body,tag,silent:false,vibrate:[120,80,120]}); addLog(`[NOTIF] ${title}: ${body}`); }catch(e){ addLog('[NOTIF] ERROR: '+(e.message||e)); }
}

function selectBestVoice(){
  const voices = state.voice.voices;
  if(!voices.length) return null;
  let v = voices.find(v=>/es-ES/i.test(v.lang)) || voices.find(v=>/^es/i.test(v.lang)) || voices.find(v=>/Google español/i.test(v.name)) || voices[0];
  state.voice.selectedURI = v.voiceURI;
  addLog(`[VOICE] Voz seleccionada: ${v.name} · ${v.lang}`);
  populateVoiceSelect();
  return v;
}
function refreshVoices(){
  if(!state.voice.supported){ addLog('[VOICE] SpeechSynthesis no disponible'); if(els.voiceStatus) els.voiceStatus.textContent='SpeechSynthesis no disponible'; return []; }
  state.voice.voices = window.speechSynthesis.getVoices() || [];
  addLog(`[VOICE] Voces detectadas: ${state.voice.voices.length}`);
  if(state.voice.voices.length && !state.voice.selectedURI) selectBestVoice();
  populateVoiceSelect();
  syncVoiceUi();
  return state.voice.voices;
}
function unlockVoice(){
  if(!state.voice.supported || state.voice.unlocked) return;
  try{
    window.speechSynthesis.cancel();
    window.speechSynthesis.resume();
    unlockAudio();
    state.voice.unlocked = true;
    refreshVoices();
    addLog('[VOICE] Desbloqueo OK');
  }catch(e){
    addLog('[VOICE] Desbloqueo ERROR: '+(e.message||e));
  }
}
function shouldSpeak(key,cooldownMs){
  const now = Date.now();
  const prev = state.voice.lastByKey[key] || 0;
  if(now-prev < cooldownMs) return false;
  state.voice.lastByKey[key] = now;
  return true;
}
function enqueueVoice(text, cls='good', key='generic', cooldownMs=0){
  enqueueVoiceAdvanced(text,{priority:1, category:key, key, cooldownMs, replaceCategory:false});
}
function processVoiceQueue(){
  if(!state.voice.supported || !state.voice.enabled || state.voice.speaking) return;
  const item = state.voice.queue.shift();
  if(!item) return;
  const msg = item.msg || item;
  if(!state.voice.unlocked){ addLog('[VOICE] Pendiente de desbloqueo'); return; }
  if(!state.voice.voices?.length) refreshVoices();
  const utter = new SpeechSynthesisUtterance(msg);
  const v = state.voice.voices.find(x=>x.voiceURI===state.voice.selectedURI) || selectBestVoice();
  if(v) utter.voice = v;
  utter.lang = utter.voice?.lang || 'es-ES';
  utter.volume = Number(state.voice.volume||1);
  utter.rate = Number(state.voice.rate||1);
  utter.pitch = 1.0;
  utter.onstart = ()=>{ state.voice.speaking = true; addLog(`[VOICE] Hablando: ${msg}`); };
  utter.onend = ()=>{ state.voice.speaking = false; addLog('[VOICE] Fin'); if(state.voice.queue.length) setTimeout(processVoiceQueue,120); };
  utter.onerror = e=>{
    state.voice.speaking = false;
    const err=(e.error||e.message||e);
    addLog('[VOICE] ERROR: '+err);
    if((item.retries||0)<1){
      state.voice.queue.unshift({...item,retries:(item.retries||0)+1,ts:Date.now()});
      setTimeout(processVoiceQueue,250);
      return;
    }
    if(state.voice.queue.length) setTimeout(processVoiceQueue,120);
  };
  try{ window.speechSynthesis.resume(); }catch(e){}
  window.speechSynthesis.speak(utter);
}
function testVoice(){ unlockVoice(); enqueueVoiceAdvanced('PRUEBA DE VOZ. PRÓXIMO CAMBIO EN TREINTA SEGUNDOS. FIN PREVISTA A LAS VEINTIUNA HORAS.',{priority:3,category:'test',key:'testVoice',cooldownMs:0,replaceCategory:true}); }
function fmtSpeechMinutes(sec){
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec/60), s = sec%60;
  const minLabel = m===1 ? 'MINUTO' : 'MINUTOS';
  const secLabel = s===1 ? 'SEGUNDO' : 'SEGUNDOS';
  if(m>0 && s>0) return `${m} ${minLabel} Y ${s} ${secLabel}`;
  if(m>0) return `${m} ${minLabel}`;
  return `${s} ${secLabel}`;
}
function fmtSpeechClock(hhmm){
  const [hRaw,mRaw]=String(hhmm||'--:--').split(':');
  const h=Number(hRaw), m=Number(mRaw);
  if(!Number.isFinite(h)||!Number.isFinite(m)) return String(hhmm||'--:--');
  if(m===0) return `${h} HORAS`;
  return `${h} HORAS Y ${m} ${m===1?'MINUTO':'MINUTOS'}`;
}
function clearVoiceQueue(reason=''){
  const pending = state.voice.queue.length;
  state.voice.queue = [];
  try{ if(window.speechSynthesis){ window.speechSynthesis.cancel(); } }catch(e){}
  state.voice.speaking = false;
  addLog(`[VOICE] Cola reiniciada${reason?': '+reason:''} · ${pending} pendientes eliminados`);
}
function enqueueVoiceAdvanced(text, opts={}){
  const {priority=1, category='generic', key='generic', cooldownMs=0, replaceCategory=false} = opts;
  if(!state.voice.supported || !state.voice.enabled) return;
  if(cooldownMs && !shouldSpeak(key,cooldownMs)) return;
  const msg = String(text||'').trim();
  if(!msg) return;
  if(replaceCategory){
    state.voice.queue = state.voice.queue.filter(item=>item.category!==category);
  }
  state.voice.queue.push({msg, priority, category, ts: Date.now()});
  state.voice.queue.sort((a,b)=>b.priority-a.priority || a.ts-b.ts);
  addLog(`[VOICE] Encolado: ${msg}`);
  processVoiceQueue();
}
function getCurrentBpmTarget(){
  const info = currentSegInfo();
  const level = info?.seg?.level;
  if(!level) return null;
  return state.plan?.bpmDay?.[level] || state.plan?.bpmApp?.[level] || null;
}

function crossedThreshold(prevRemain, curRemain, threshold){
  return prevRemain > threshold && curRemain <= threshold;
}
function pickSeekThreshold(prevRemain, curRemain, thresholds){
  const crossed = thresholds.filter(t => crossedThreshold(prevRemain, curRemain, t));
  if(!crossed.length) return null;
  crossed.sort((a,b)=>a-b);
  if(crossed.includes(0)) return 0;
  if(crossed.includes(10)) return 10;
  if(crossed.includes(30)) return 30;
  if(crossed.includes(60)) return 60;
  if(crossed.includes(180)) return 180;
  return crossed[0];
}

function evaluateVoiceAlerts(prevSec, sec, mode='tick'){
  if(state.phase!=='running' || !state.plan) return;
  if(sec<0) return;
  const infoPrev = currentSegInfo(prevSec);
  const info = currentSegInfo(sec);
  if(!info) return;
  const remainSeg = Math.max(0, info.endSec - sec);
  const remainTotal = Math.max(0, planDuration() - sec);
  const next = state.plan.segments[info.index+1] || null;
  const isSeek = mode==='seek';

  const segThresholds = [180,60,30,10,0];
  const waterThresholds = [180,60,30,10,0];

  if(next){
    const prevRemainSeg = infoPrev ? Math.max(0, infoPrev.endSec - prevSec) : remainSeg + Math.max(0,sec-prevSec);
    if(!isSeek){
      for(const t of segThresholds){
        if(remainSeg===t){
          const dir = next.level>info.seg.level ? 'SUBIDA' : next.level<info.seg.level ? 'BAJADA' : 'CAMBIO';
          const kind = next.isTest ? 'TEST ' : '';
          if(t===0){
            pushAlert(`seg_now_${info.index}`, `CAMBIO AHORA. ${kind}${dir} A NIVEL ${next.level}.`, {cooldownMs:60000, notifyTitle:'Cambio ahora', notifyBody:`${kind}${dir} a nivel ${next.level}`, cls:'warn', doNotify:true, beepKind:'critical', priority:5, category:'segment', replaceCategory:false});
          } else {
            pushAlert(`seg_${info.index}_${t}`, `QUEDAN ${fmtSpeechMinutes(t)} DE TRAMO. PRÓXIMO ${kind}${dir} A NIVEL ${next.level}.`, {cooldownMs:60000, notifyTitle:'Cambio de tramo', notifyBody:`En ${fmtSpeechMinutes(t)}: ${kind}${dir} a nivel ${next.level}`, cls:'warn', doNotify:true, beepKind: t<=10 ? 'critical' : '', priority:t<=30?4:3, category:'segment', replaceCategory:false});
          }
        }
      }
    } else {
      const t = pickSeekThreshold(prevRemainSeg, remainSeg, segThresholds);
      if(t!==null){
        const dir = next.level>info.seg.level ? 'SUBIDA' : next.level<info.seg.level ? 'BAJADA' : 'CAMBIO';
        const kind = next.isTest ? 'TEST ' : '';
        if(t===0){
          pushAlert(`seg_now_seek_${info.index}_${sec}`, `CAMBIO AHORA. ${kind}${dir} A NIVEL ${next.level}.`, {cooldownMs:2000, notifyTitle:'Cambio ahora', notifyBody:`${kind}${dir} a nivel ${next.level}`, cls:'warn', doNotify:true, beepKind:'critical', priority:5, category:'segment', replaceCategory:true});
        } else {
          pushAlert(`seg_seek_${info.index}_${t}_${sec}`, `QUEDAN ${fmtSpeechMinutes(t)} DE TRAMO. PRÓXIMO ${kind}${dir} A NIVEL ${next.level}.`, {cooldownMs:2000, notifyTitle:'Cambio de tramo', notifyBody:`En ${fmtSpeechMinutes(t)}: ${kind}${dir} a nivel ${next.level}`, cls:'warn', doNotify:true, beepKind: t<=10 ? 'critical' : '', priority:t<=30?4:3, category:'segment', replaceCategory:true});
        }
      }
    }
  }

  for(const w of (state.plan.water||[])){
    const [mm,ss] = String(w).split(':').map(Number);
    const ws = mm*60+ss;
    const prevRemainWater = ws-prevSec;
    const remainWater = ws-sec;
    if(!isSeek){
      for(const t of waterThresholds){
        if(remainWater===t){
          if(t===0){
            pushAlert(`water_now_${ws}`, 'AGUA AHORA. DOS O TRES SORBOS Y VUELVES A CADENCIA.', {cooldownMs:60000, notifyTitle:'Agua ahora', notifyBody:'Dos o tres sorbos y vuelves a cadencia', cls:'good', doNotify:true, beepKind:'critical', priority:5, category:'water', replaceCategory:false});
          } else {
            pushAlert(`water_${ws}_${t}`, `AGUA EN ${fmtSpeechMinutes(t)}.`, {cooldownMs:60000, notifyTitle:'Toma de agua', notifyBody:`Agua en ${fmtSpeechMinutes(t)}`, cls:'good', doNotify:true, beepKind: t<=10 ? 'critical' : '', priority:t<=30?4:3, category:'water', replaceCategory:false});
          }
        }
      }
    } else {
      const t = pickSeekThreshold(prevRemainWater, remainWater, waterThresholds);
      if(t!==null){
        if(t===0){
          pushAlert(`water_now_seek_${ws}_${sec}`, 'AGUA AHORA. DOS O TRES SORBOS Y VUELVES A CADENCIA.', {cooldownMs:2000, notifyTitle:'Agua ahora', notifyBody:'Dos o tres sorbos y vuelves a cadencia', cls:'good', doNotify:true, beepKind:'critical', priority:5, category:'water', replaceCategory:true});
        } else {
          pushAlert(`water_seek_${ws}_${t}_${sec}`, `AGUA EN ${fmtSpeechMinutes(t)}.`, {cooldownMs:2000, notifyTitle:'Toma de agua', notifyBody:`Agua en ${fmtSpeechMinutes(t)}`, cls:'good', doNotify:true, beepKind: t<=10 ? 'critical' : '', priority:t<=30?4:3, category:'water', replaceCategory:true});
        }
      }
    }
  }

  if(!isSeek && sec>0 && sec%120===0){
    pushAlert(`rem_tramo_${sec}`, `QUEDAN ${fmtSpeechMinutes(remainSeg)} DE ESTE TRAMO.`, {cooldownMs:5000, notifyTitle:'Tiempo de tramo', notifyBody:`Quedan ${fmtSpeechMinutes(remainSeg)} de tramo`, cls:'good', doNotify:false, priority:1, category:'reminder'});
  }
  if(!isSeek && sec>0 && sec%300===0){
    const eta = hm(new Date(Date.now()+remainTotal*1000));
    pushAlert(`rem_total_${sec}`, `QUEDAN ${fmtSpeechMinutes(remainTotal)} PARA TERMINAR LA ELÍPTICA. FIN PREVISTA A LAS ${fmtSpeechClock(eta)}.`, {cooldownMs:5000, notifyTitle:'Tiempo restante', notifyBody:`Quedan ${fmtSpeechMinutes(remainTotal)}. Fin ${eta}`, cls:'good', doNotify:true, priority:2, category:'total', replaceCategory:false});
  } else if(isSeek){
    const prevRemainTotal = Math.max(0, planDuration()-prevSec)
    const t = pickSeekThreshold(prevRemainTotal, remainTotal, [1800,1200,600,300]);
    if(t!==null){
      const eta = hm(new Date(Date.now()+remainTotal*1000));
      pushAlert(`rem_total_seek_${t}_${sec}`, `QUEDAN ${fmtSpeechMinutes(remainTotal)} PARA TERMINAR LA ELÍPTICA. FIN PREVISTA A LAS ${fmtSpeechClock(eta)}.`, {cooldownMs:2000, notifyTitle:'Tiempo restante', notifyBody:`Quedan ${fmtSpeechMinutes(remainTotal)}. Fin ${eta}`, cls:'good', doNotify:true, priority:2, category:'total', replaceCategory:true});
    }
  }
  const target = getCurrentBpmTarget();
  const bpm = bpmDisplay();
  if(!isSeek && target && bpm!=null && hasFreshPulse(6)){
    const side = bpm < target.min ? 'low' : (bpm > target.max ? 'high' : 'ok');
    const nowTs = Date.now();
    if(side !== state.alerts.pulseSide){
      state.alerts.pulseSide = side;
      state.alerts.pulseSinceTs = nowTs;
    }
    const sustainedMs = nowTs - (state.alerts.pulseSinceTs||nowTs);
    if(side !== 'ok' && sustainedMs >= 18000 && nowTs - (state.alerts.pulseLastAlertTs||0) >= 20000){
      state.alerts.pulseLastAlertTs = nowTs;
      if(side==='low') pushAlert(`bpm_low_${sec}`, `PULSO POR DEBAJO DEL OBJETIVO. OBJETIVO ${target.min} A ${target.max}.`, {cooldownMs:15000, notifyTitle:'Pulso bajo', notifyBody:`Objetivo ${target.min}-${target.max}`, cls:'bad', doNotify:true, beepKind:'info', priority:3, category:'pulse', replaceCategory:true});
      if(side==='high') pushAlert(`bpm_high_${sec}`, `PULSO POR ENCIMA DEL OBJETIVO. OBJETIVO ${target.min} A ${target.max}.`, {cooldownMs:15000, notifyTitle:'Pulso alto', notifyBody:`Objetivo ${target.min}-${target.max}`, cls:'bad', doNotify:true, beepKind:'info', priority:3, category:'pulse', replaceCategory:true});
    }
  } else if(!hasFreshPulse(6)){
    state.alerts.pulseSide = 'ok';
    state.alerts.pulseSinceTs = 0;
  }
}
function evaluateAlertsRange(prevSec, sec, cause='tick'){
  if(!state.plan || state.phase!=='running') return;
  const a = Math.max(0, Math.min(prevSec, sec));
  const b = Math.max(0, Math.max(prevSec, sec));
  const isSeek = cause==='seek';
  if(isSeek){
    clearVoiceQueue('SEEK');
    addLog(`[ALERT] SEEK RECALC: ${a}→${b}`);
    evaluateVoiceAlerts(a, b, 'seek');
    return;
  }
  if(b-a>600){
    addLog(`[ALERT] Rango grande ${cause}: ${a}→${b}; se evalúa solo destino`);
    evaluateVoiceAlerts(b-1, b, cause);
    return;
  }
  for(let s=a+1; s<=b; s++){
    evaluateVoiceAlerts(s-1, s, cause);
  }
}

function safe(name,fn){
  return async ev=>{
    const target=ev?.currentTarget || ev?.target;
    const now=Date.now();
    if(target){
      const prev=Number(target.dataset.lastActionTs||0);
      if(now-prev<250){ return; }
      target.dataset.lastActionTs=String(now);
    }
    addLog(`[BTN ${name}] ${target?.id||''} pulsado`);
    try{
      unlockVoice();
      await fn(ev);
      addLog(`[BTN ${name}] OK`);
    }catch(err){
      console.error(err);
      addLog(`[BTN ${name}] ERROR: ${err?.message||err}`);
      if(els.importOutput) els.importOutput.textContent=`ERROR EN ${name.toUpperCase()}
${err?.message||err}`;
    }
  }
}

function bind(){
  const B=(id,name,fn)=>{
    const el=$(id); if(!el) return;
    const handler=safe(name,fn);
    el.addEventListener('click', ev=>{ ev.preventDefault?.(); ev.stopPropagation?.(); handler(ev); });
    el.addEventListener('keydown', ev=>{ if(ev.key==='Enter' || ev.key===' '){ ev.preventDefault?.(); ev.stopPropagation?.(); handler(ev); } });
  };
  B('applyPlanBtn','applyPlan',applyPlan);
  B('copyPlanBtn','copyPlan',async()=>{ await copyPlanText(); if(els.importOutput) els.importOutput.textContent='PLAN COPIADO'; });
  B('previewPlanBtn','previewPlan',previewPlan);
  B('normalizePlanBtn','normalizePlan',normalizePlan);
  B('clearPlanBtn','clearPlan',()=>{els.planInput.value=''; els.importOutput.textContent=''; state.plan=null; renderAll();});
  B('startBtn','toggleRun',toggleRun);
  B('resetBtn','reset',resetSession);
  B('bleConnectBtn','bleConnect',bleConnect);
  B('bleReconnectBtn','bleReconnect',bleReconnect);
  B('bleDisconnectBtn','bleDisconnect',bleDisconnect);
  B('bleDiagBtn','bleDiag',bleDiag);
  B('installAppBtn','installApp',installApp);
  B('updateAppBtn','updateApp',updateApp);
  B('forceReloadBtn','forceReload',forceReloadApp);
  B('notifPermissionBtn','notifPermission',requestNotificationPermission);
  B('testNotifyBtn','testNotify',testNotify);
  B('refreshVoicesBtn','refreshVoices',()=>{ refreshVoices(); if(els.importOutput) els.importOutput.textContent = (state.voice.voices||[]).map(v=>`${v.name} · ${v.lang}`).join('\n') || 'Sin voces detectadas'; });
  B('testVoiceBtn','testVoice',testVoice);
  B('copyLogBtn','copyLog',async()=>{
    const txt = state.logs.join('\n');
    try{ await copyText(txt); addLog('[LOG] Copiado'); if(els.importOutput) els.importOutput.textContent='LOG COPIADO'; }
    catch(e){ download(`log_${APP_VERSION}.txt`, txt); addLog('[LOG] Descargado como TXT'); if(els.importOutput) els.importOutput.textContent='LOG DESCARGADO'; }
  });
  B('verifyAllBtn','verifyAll',verifyAll);
  B('exportSessionBtn','exportSession',exportSessionCsv);
  B('exportMinuteBtn','exportMinute',exportMinuteCsv);
  B('resumeSessionBtn','resumeSession',resumeSavedSession);
  B('finalSummaryBtn','finalSummary',showFinalSummary);
  B('exportJsonBtn','exportJson',exportJson);
  B('compareLastBtn','compareLast',compareLast);
  B('exportTramoCsvBtn','exportTramoCsv',exportTramoCsv);
  B('copySummaryBtn','copySummary',()=>copyText(summaryText()));
  B('copyChatgptBtn','copyChatgpt',()=>copyText(`PUNTO DE CONTROL\n\n${summaryText()}\n\nLOGS\n${state.logs.slice(-20).join('\n')}`));
  B('exportPlanBtn','exportPlan',exportPlan);
  B('clearAppDataBtn','clearAppData',clearAppData);
  [['seekPlus60',60],['seekPlus10',10],['seekPlus5',5],['seekPlus1',1],['seekMinus1',-1],['seekMinus5',-5],['seekMinus10',-10],['seekMinus60',-60]].forEach(([id,d])=>B(id,id,()=>seek(d)));
  B('eqSegmentBtn','eqSegment',equalizeSegmentKcal);
  [['kPlus1',1],['kPlus05',0.5],['kPlus01',0.1],['kMinus01',-0.1],['kMinus05',-0.5],['kMinus1',-1]].forEach(([id,d])=>B(id,id,()=>adjustReal(d)));
  if(els.voiceSelect) els.voiceSelect.addEventListener('change',ev=>{ state.voice.selectedURI = ev.target.value||''; const v=state.voice.voices.find(v=>v.voiceURI===state.voice.selectedURI); if(v) addLog(`[VOICE] Voz seleccionada manual: ${v.name} · ${v.lang}`); populateVoiceSelect(); });
  if(els.voiceVolumeRange) { els.voiceVolumeRange.addEventListener('input',ev=>{ state.voice.volume = Number(ev.target.value||1); syncVoiceUi(); addLog(`[VOICE] Volumen: ${state.voice.volume.toFixed(1)}`); }); els.voiceVolumeRange.addEventListener('change',()=>previewVoiceSettings()); }
  if(els.voiceRateRange) { els.voiceRateRange.addEventListener('input',ev=>{ state.voice.rate = Number(ev.target.value||1); syncVoiceUi(); addLog(`[VOICE] Velocidad: ${state.voice.rate.toFixed(2)}`); }); els.voiceRateRange.addEventListener('change',()=>previewVoiceSettings()); }
  if(els.browserNotifyChk) els.browserNotifyChk.addEventListener('change',ev=>{ state.voice.browserNotify = !!ev.target.checked; syncVoiceUi(); addLog(`[NOTIF] Toggle navegador/reloj: ${state.voice.browserNotify?'ON':'OFF'}`); });
  if(els.voiceAlertsChk) els.voiceAlertsChk.addEventListener('change',ev=>{ state.voice.enabled = !!ev.target.checked; syncVoiceUi(); addLog(`[VOICE] Avisos hablados: ${state.voice.enabled?'ON':'OFF'}`); });
  if(els.beepAlertsChk) els.beepAlertsChk.addEventListener('change',ev=>{ state.voice.beepEnabled = !!ev.target.checked; syncVoiceUi(); addLog(`[AUDIO] Pitidos: ${state.voice.beepEnabled?'ON':'OFF'}`); });
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault(); state.installPrompt=e; addLog('[PWA] beforeinstallprompt capturado');});
  document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='hidden'){ persist(); releaseWakeLock(); } else if(state.phase==='running'){ requestWakeLock(); } });
}
function round1(n){return Math.round(n*10)/10} function round2(n){return Math.round(n*100)/100} function fmt(sec){sec=Math.max(0,Math.round(sec)); const m=String(Math.floor(sec/60)).padStart(2,'0'); const s=String(sec%60).padStart(2,'0'); return `${m}:${s}`}
function hm(d){return d?d.toTimeString().slice(0,5):'--:--'}
function parseMmSsInput(v){ const m=String(v||'').trim().match(/^(\d{1,2}):(\d{2})$/); return m ? Number(m[1])*60+Number(m[2]) : null; }
function fmtFactor10(n){ return Number.isFinite(n)?Number(n).toFixed(10):'--'; }
function recomputeTimeCalibration(){
  const a=Math.max(0, Number(state.timeCal.appRefSec||0));
  const r=Math.max(0, Number(state.timeCal.realRefSec||0));
  state.timeCal.factorOverall = (a>0 && r>0) ? (r/a) : 1;
  if(a>60 && r>60){
    state.timeCal.factorAfterMinute = (r-60)/(a-60);
  } else {
    state.timeCal.factorAfterMinute = state.timeCal.factorOverall || 1;
  }
  if(!Number.isFinite(state.timeCal.factorAfterMinute) || state.timeCal.factorAfterMinute<=0) state.timeCal.factorAfterMinute=1;
  if(!Number.isFinite(state.timeCal.factorOverall) || state.timeCal.factorOverall<=0) state.timeCal.factorOverall=1;
}
function syncCalibrationUi(){
  if(els.calAppRefInput && document.activeElement!==els.calAppRefInput) els.calAppRefInput.value = state.timeCal.appRefSec?fmt(state.timeCal.appRefSec):'';
  if(els.calRealRefInput && document.activeElement!==els.calRealRefInput) els.calRealRefInput.value = state.timeCal.realRefSec?fmt(state.timeCal.realRefSec):'';
  if(els.calFactorLabel){
    const t = state.timeCal.enabled
      ? `ACTIVA · APP ${fmt(state.timeCal.appRefSec)} → MÁQUINA REAL ${fmt(state.timeCal.realRefSec)} · FACTOR GENERAL ${fmtFactor10(state.timeCal.factorOverall)} · FACTOR DESDE 01:00 ${fmtFactor10(state.timeCal.factorAfterMinute)}`
      : 'SIN CALIBRACIÓN PREVIA · REAL Y MÁQUINA A LA PAR';
    els.calFactorLabel.textContent=t;
  }
}
function applyTimeCalibration(){
  if(state.phase==='running' || state.phase==='paused' || currentRealElapsed()>0) throw new Error('Aplica la calibración antes de iniciar');
  const appSec = parseMmSsInput(els.calAppRefInput?.value);
  const realSec = parseMmSsInput(els.calRealRefInput?.value);
  if(appSec==null || realSec==null) throw new Error('Usa formato mm:ss en ambos tiempos');
  if(appSec<=0 || realSec<=0) throw new Error('Los tiempos deben ser mayores que 00:00');
  state.timeCal.enabled=true;
  state.timeCal.appRefSec=appSec;
  state.timeCal.realRefSec=realSec;
  state.machineOffsetSec=0;
  recomputeTimeCalibration();
  syncCalibrationUi();
  persist();
  const msg=`CALIBRACIÓN TIEMPO OK\nAPP ${fmt(appSec)} → MÁQUINA REAL ${fmt(realSec)}\nFACTOR GENERAL ${fmtFactor10(state.timeCal.factorOverall)}\nFACTOR DESDE 01:00 ${fmtFactor10(state.timeCal.factorAfterMinute)}\nEl primer minuto irá 1:1 y después se repartirá la corrección segundo a segundo.`;
  if(els.importOutput) els.importOutput.textContent=msg;
  addLog(`[TIME] Calibración previa aplicada · app ${fmt(appSec)} · real ${fmt(realSec)} · f=${fmtFactor10(state.timeCal.factorAfterMinute)}`);
  renderAll();
}
function clearTimeCalibration(){
  if(state.phase==='running' || state.phase==='paused') throw new Error('Borra la calibración con la sesión parada');
  state.timeCal={enabled:false,appRefSec:0,realRefSec:0,factorOverall:1,factorAfterMinute:1};
  state.machineOffsetSec=0;
  syncCalibrationUi();
  persist();
  if(els.importOutput) els.importOutput.textContent='Calibración previa borrada';
  addLog('[TIME] Calibración previa borrada');
  renderAll();
}
function planDuration(){return state.plan?.segments?.reduce((a,s)=>a+s.durationSec,0)||0}
function clampPlanSec(sec){
  const max = state.plan ? planDuration() : Infinity;
  return Math.max(0, Math.min(max, Math.round(Number(sec||0))));
}
function currentRealElapsedFloat(){
  if(state.phase==='running'&&state.startTs!=null) return Math.max(0,(Date.now()-state.startTs)/1000);
  return Math.max(0, Number(state.elapsedSec||0));
}
function currentRealElapsed(){
  return Math.max(0, Math.floor(currentRealElapsedFloat()));
}
function currentMachineElapsedBaseFloat(){
  const real = Math.max(0, currentRealElapsedFloat());
  if(!state.timeCal.enabled) return real * MACHINE_TIME_FACTOR;
  if(real <= 60) return real;
  return 60 + ((real - 60) * Number(state.timeCal.factorAfterMinute||1));
}
function currentMachineElapsedRawFloat(){
  return Math.max(0, currentMachineElapsedBaseFloat() + Number(state.machineOffsetSec||0));
}
function currentMachineElapsedRaw(){
  return Math.max(0, Math.floor(currentMachineElapsedRawFloat()));
}
function currentElapsed(){
  return clampPlanSec(currentMachineElapsedRaw());
}
function currentSegInfo(sec=currentElapsed()){if(!state.plan) return null; let c=0; for(let i=0;i<state.plan.segments.length;i++){const seg=state.plan.segments[i]; if(sec < c+seg.durationSec) return {index:i,seg,startSec:c,endSec:c+seg.durationSec}; c+=seg.durationSec;} const last=state.plan.segments.at(-1); return last?{index:state.plan.segments.length-1,seg:last,startSec:c-last.durationSec,endSec:c}:null}
function currentPlanKcal(){if(!state.plan) return 0; let rem=currentElapsed(), total=0; for(const seg of state.plan.segments){if(rem<=0) break; const used=Math.min(seg.durationSec, rem); total += seg.kcalTarget*(used/seg.durationSec); rem-=used;} return round1(total)}
function currentRealKcal(){return Math.max(0, round1(currentPlanKcal()+state.realOffset))}
function hasFreshPulse(maxAgeSec=6){ return !!(state.ble.connected && state.ble.lastPacketTs && (Date.now()-state.ble.lastPacketTs)<=maxAgeSec*1000); }
function pruneBpmSamples(){ const now=Date.now(); state.bpmSamples = state.bpmSamples.filter(x=>now-x.ts<=30000); }
function bpmDisplay(){ pruneBpmSamples(); const arr=state.bpmSamples.filter(x=>Date.now()-x.ts<=6000); if(!hasFreshPulse(6) || !arr.length) return null; const recent=arr.slice(-3).map(x=>x.bpm); return recent.reduce((a,b)=>a+b,0)/recent.length }
function avgBpmWindow(secWindow){ pruneBpmSamples(); const now=Date.now(); if(!hasFreshPulse(Math.max(6,secWindow))) return null; const items=state.bpmSamples.filter(x=>now-x.ts<=secWindow*1000); if(!items.length) return null; return items.reduce((a,b)=>a+b.bpm,0)/items.length }

function parsePlan(text){
  const lines=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const segments=[], water=[], bpmApp={}, bpmDay={};
  let totalTime=null,totalKcal=null, mode='';
  const parseDuration = (str)=>{
    const m = String(str||'').match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if(!m) return null;
    const a=Number(m[1]), b=Number(m[2]), c=Number(m[3]||0);
    return m[3] ? a*3600+b*60+c : a*60+b;
  };
  const parseClock = (str)=>{
    const m = String(str||'').match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if(!m) return null;
    return Number(m[1])*3600 + Number(m[2])*60 + Number(m[3]||0);
  };
  const extractMinuteMax = (line)=>{
    const m = String(line||'').match(/(?:Minuto|minuto|min)\s*(\d{1,2}:\d{2})(?:\s*[–-]\s*(\d{1,2}:\d{2}))?/i);
    return m ? (m[2] || m[1]) : null;
  };
  const findForward=(start,maxLook,regex)=>{
    for(let j=start+1;j<=Math.min(lines.length-1,start+maxLook);j++){
      const mm = lines[j].match(regex);
      if(mm) return {match:mm,line:lines[j],index:j};
    }
    return null;
  };
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    if(/^BPM OPERATIVO/i.test(line)){ mode='bpmApp'; continue; }
    if(/^BPM DEL D[IÍ]A/i.test(line)){ mode='bpmDay'; continue; }
    if(/^AGUA EN EL[ÍI]PTICA/i.test(line)){ mode='water'; continue; }
    if(/^AGUA\b/i.test(line)){ mode='waterBlock'; continue; }
    if(/^(?:TOTAL PREVISTO|OBJETIVO TOTAL|OBJETIVO:)\b/i.test(line)){ mode='total'; }
    if(/^(?:REGLAS|LECTURA|SEÑALES|TRAMOS|RESUMEN R[ÁA]PIDO|BPM Y KCAL POR NIVEL)\b/i.test(line) && mode==='total'){ mode=''; }

    if(mode==='water' || mode==='waterBlock'){
      const wm = extractMinuteMax(line);
      if(wm && !water.includes(wm)) water.push(wm);
    }
    if(mode==='total'){
      const tm=line.match(/Tiempo(?:\s+real)?\s*:\s*(\d{2}:\d{2})/i);
      if(tm) totalTime=tm[1];
      const km=line.match(/Kcal[^\d]*(\d+(?:[.,]\d+)?)(?:\s*[–-]\s*(\d+(?:[.,]\d+)?))?/i);
      if(km) totalKcal=Number(String(km[2]||km[1]).replace(',','.'));
    }
    if(mode==='bpmApp'){
      const bm=line.match(/Nivel\s+(\d+)\s*:\s*(\d+)\s*[–-]\s*(\d+)/i);
      if(bm) bpmApp[Number(bm[1])]={min:Number(bm[2]),max:Number(bm[3])};
    }
    if(mode==='bpmDay'){
      const bm=line.match(/Nivel\s+(\d+).*?(\d+)\s*[–-]\s*(\d+)/i);
      if(bm) bpmDay[Number(bm[1])]={min:Number(bm[2]),max:Number(bm[3])};
    }

    let m = line.match(/^([A-Z])\)\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*[–-]\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:→|->)\s*(TEST\s+)?NIVEL\s+(\d+)\s*(?:→|->)\s*~?(\d+(?:[.,]\d+)?)(?:\s*[–-]\s*(\d+(?:[.,]\d+)?))?/i);
    if(m){
      let durationSec = parseClock(m[3]) - parseClock(m[2]);
      if(durationSec<=0) durationSec += 24*3600;
      segments.push({id:m[1],durationSec,level:Number(m[5]),isTest:!!m[4],kcalTarget:Number(String(m[7]||m[6]).replace(',','.'))});
      mode='';
      continue;
    }

    m = line.match(/^([A-Z])\)\s+(\d{2}:\d{2})\s*[·-].*?(TEST\s+)?NIVEL\s+(\d+)/i);
    if(m){
      const look = findForward(i,3,/objetivo\s*~?(\d+(?:[.,]\d+)?)(?:\s*[–-]\s*(\d+(?:[.,]\d+)?))?/i);
      const kcalTarget = look ? Number(String(look.match[2]||look.match[1]).replace(',','.')) : 0;
      segments.push({id:m[1],durationSec:parseDuration(m[2]),level:Number(m[4]),isTest:!!m[3],kcalTarget});
      mode='';
      continue;
    }

    m = line.match(/^([A-Z])\)\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*[–-]\s*(\d{1,2}:\d{2}(?::\d{2})?)/i);
    if(m){
      const lv = findForward(i,4,/Nivel\s+(\d+)/i);
      const tm = findForward(i,4,/Tiempo:\s*(\d{2}:\d{2})/i);
      const km = findForward(i,6,/Objetivo\s+kcal\s+m[aá]quina:\s*~?(\d+(?:[.,]\d+)?)(?:\s*[–-]\s*(\d+(?:[.,]\d+)?))?/i) || findForward(i,6,/objetivo\s*~?(\d+(?:[.,]\d+)?)(?:\s*[–-]\s*(\d+(?:[.,]\d+)?))?/i);
      let durationSec = tm ? parseDuration(tm.match[1]) : (parseClock(m[2])!=null && parseClock(m[3])!=null ? parseClock(m[3]) - parseClock(m[2]) : 0);
      if(durationSec<=0) durationSec += 24*3600;
      segments.push({id:m[1],durationSec,level:lv?Number(lv.match[1]):10,isTest:false,kcalTarget:km?Number(String(km.match[2]||km.match[1]).replace(',','.')):0});
      mode='';
      continue;
    }
  }
  if(!segments.length) throw new Error('No se detectaron tramos');
  const duration=segments.reduce((a,s)=>a+s.durationSec,0);
  if(!totalTime) totalTime = fmt(duration);
  if(totalKcal==null) totalKcal = segments.reduce((a,s)=>a+s.kcalTarget,0);
  return {title:`ELÍPTICA ${APP_VERSION} · ${totalTime} · ~${Math.round(totalKcal)} kcal`,segments,water:[...new Set(water)],bpmApp,bpmDay,totalTime,totalKcal,normalizedText:text};
}
function normalizeText(plan=state.plan){
  if(!plan) return '';
  const rows=[];
  rows.push(plan.title.replace(` ${APP_VERSION}`,''));
  rows.push('');
  if(Object.keys(plan.bpmApp||{}).length){
    rows.push('BPM OPERATIVO PARA LA APP');
    Object.keys(plan.bpmApp).sort((a,b)=>Number(a)-Number(b)).forEach(k=>rows.push(`Nivel ${k}: ${plan.bpmApp[k].min}-${plan.bpmApp[k].max}`));
    rows.push('');
  }
  if(Object.keys(plan.bpmDay||{}).length){
    rows.push('BPM DEL DÍA · REFERENCIA PRÁCTICA');
    Object.keys(plan.bpmDay).sort((a,b)=>Number(a)-Number(b)).forEach(k=>rows.push(`Nivel ${k}: ${plan.bpmDay[k].min}-${plan.bpmDay[k].max}`));
    rows.push('');
  }
  plan.segments.forEach(seg=>{ rows.push(`${seg.id}) ${fmt(seg.durationSec)} · ${seg.isTest?'TEST ':''}NIVEL ${seg.level}`); rows.push(`→ objetivo ~${seg.kcalTarget} kcal`); rows.push(''); });
  rows.push('AGUA EN ELÍPTICA');
  (plan.water||[]).forEach(w=>rows.push(`Minuto ${w}`));
  rows.push('');
  rows.push('TOTAL PREVISTO');
  rows.push(`- Tiempo: ${plan.totalTime||fmt(planDuration())}`);
  rows.push(`- Kcal máquina: ~${Math.round(plan.totalKcal||plan.segments.reduce((a,s)=>a+s.kcalTarget,0))} kcal`);
  return rows.join('\n');
}
function applyPlan(){
  const text=els.planInput.value.trim();
  if(!text) throw new Error('No hay texto de plan');
  state.plan=parsePlan(text);
  state.phase='idle';
  state.elapsedSec=0;
  state.startTs=null;
  state.pauseTs=null;
  state.pausedAccumMs=0;
  state.lastSec=-1;
  state.machineOffsetSec=0;
  state.realOffset=0;
  state.history=[];
  state.alerts.lastSecChecked=-1;
  state.alerts.lastKey={};
  state.alerts.finished=false;
  state.alerts.pulseSide='ok';
  state.alerts.pulseSinceTs=0;
  state.alerts.pulseLastAlertTs=0;
  state.bpmSamples=[];
  clearVoiceQueue('NUEVO PLAN');
  releaseWakeLock();
  els.importOutput.textContent=normalizeText();
  els.planTitle.textContent=state.plan.title;
  renderTimeline();
  persist();
  renderAll();
  addLog(`[PLAN] Cargado · ${state.plan.segments.length} tramos · agua ${state.plan.water.length}`);
}
function previewPlan(){const text=els.planInput.value.trim(); const p=parsePlan(text); els.importOutput.textContent=`TRAMOS: ${p.segments.length}\nDURACIÓN: ${p.totalTime||fmt(p.segments.reduce((a,s)=>a+s.durationSec,0))}\nKCAL: ~${Math.round(p.totalKcal||p.segments.reduce((a,s)=>a+s.kcalTarget,0))}\nAGUA: ${p.water.join(', ')||'ninguna'}\nTESTS: ${p.segments.filter(s=>s.isTest).map(s=>s.id).join(', ')||'ninguno'}`;}
function normalizePlan(){const text=els.planInput.value.trim(); const p=parsePlan(text); els.planInput.value=normalizeText(p);}
async function copyText(txt){if(!txt) throw new Error('No hay texto'); try{if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(txt); return true}}catch(e){} const ta=document.createElement('textarea'); ta.value=txt; ta.setAttribute('readonly',''); ta.style.position='fixed'; ta.style.left='-9999px'; ta.style.opacity='0'; document.body.appendChild(ta); ta.focus(); ta.select(); ta.setSelectionRange(0, ta.value.length); let ok=false; try{ok=document.execCommand('copy')}catch(e){} ta.remove(); if(ok) return true; download(`copiado_${APP_VERSION}.txt`,txt,'text/plain;charset=utf-8'); addLog('[COPY] Portapapeles no disponible; descargado como TXT'); return false}
function copyPlanText(){ const txt=(els.planInput?.value||'').trim() || (state.plan?normalizeText(): ''); return copyText(txt) }

async function toggleRun(){
  if(!state.plan) throw new Error('Carga un plan primero');
  if(state.countdown.active) return;
  if(state.phase==='running'){
    state.elapsedSec=currentRealElapsed();
    state.phase='paused';
    state.pauseTs=Date.now();
    state.startTs=null;
    releaseWakeLock();
    addLog('[SESSION] Pausada');
    persist();
    renderAll();
    return;
  }
  if(state.phase==='paused'){
    startSessionNow('resume');
    return;
  }
  if(currentElapsed()===0){
    await runInitialCountdown();
    return;
  }
  startSessionNow('start');
}


function resetSession(){
  state.phase='idle';
  state.startTs=null;
  state.pauseTs=null;
  state.pausedAccumMs=0;
  state.elapsedSec=0;
  state.machineOffsetSec=0;
  state.realOffset=0;
  state.history=[];
  state.lastSec=-1;
  state.alerts.finished=false;
  state.alerts.pulseSide='ok';
  state.alerts.pulseSinceTs=0;
  state.alerts.pulseLastAlertTs=0;
  state.bpmSamples=[];
  clearVoiceQueue('RESET');
  releaseWakeLock();
  persist();
  renderAll();
  addLog('[SESSION] Reseteada');
}

function capturePoint(force=false){if(!state.plan) return; const sec=currentElapsed(); const prevSec = state.lastSec; if(!force&&sec===state.lastSec) return; const info=currentSegInfo(sec); const realSec=currentRealElapsed(); const machineRawSec=currentMachineElapsedRaw(); const point={sec,realSec,machineRawSec,clock:fmt(sec),realClock:fmt(realSec),machineRawClock:fmt(machineRawSec),level:info?.seg?.level??null,segment:info?.seg?.id??null,kPlan:currentPlanKcal(),kReal:currentRealKcal(),bpm:bpmDisplay(),ts:Date.now()}; const h=state.history; if(h.length&&h[h.length-1].sec===sec) h[h.length-1]=point; else h.push(point); if(h.length>10000) h.shift(); state.lastSec=sec; if(prevSec>=0) evaluateAlertsRange(prevSec, sec, force?'force':'tick'); }

function seek(delta){
  if(!state.plan) throw new Error('Carga un plan primero');
  const dur=planDuration();
  const prevPlan=currentElapsed();
  const prevRealFloat=currentRealElapsedFloat();
  const prevReal=currentRealElapsed();
  const prevMachineFloat=currentMachineElapsedRawFloat();
  const prevMachine=currentMachineElapsedRaw();
  const earlyWindow = prevRealFloat < 60;
  if(earlyWindow){
    const nextReal=Math.max(0,Math.min(dur,prevRealFloat+delta));
    state.elapsedSec=nextReal;
    state.machineOffsetSec = (prevMachineFloat + delta) - (nextReal * MACHINE_TIME_FACTOR);
    if(state.phase==='running'){
      state.startTs=Date.now()-(nextReal*1000);
    } else {
      state.startTs=null;
    }
  } else {
    const nextMachine=Math.max(0,prevMachineFloat+delta);
    state.machineOffsetSec = nextMachine - (prevRealFloat * MACHINE_TIME_FACTOR);
  }
  const nextPlan=currentElapsed();
  const nextMachine=currentMachineElapsedRaw();
  state.lastSec=prevPlan;
  capturePoint(true);
  persist();
  addLog(`[SEEK] ${delta>0?'+':''}${delta}s → MÁQ ${fmt(nextMachine)} · PLAN ${fmt(nextPlan)} · REAL ${fmt(currentRealElapsed())} · ${earlyWindow?'AMBOS':'SOLO MÁQ'}`);
  if(state.phase==='running') evaluateAlertsRange(prevPlan, nextPlan, 'seek');
  renderAll();
}


function adjustReal(delta){
  if(!state.plan) throw new Error('Carga un plan primero');
  capturePoint(true);
  let cur=currentRealKcal();
  if(Math.abs(delta)===1){
    cur=Math.round(cur+delta);
  } else {
    cur=round1(cur+delta);
  }
  state.realOffset=round1(cur-currentPlanKcal());
  addLog(`[KCAL] ajuste ${delta>0?'+':''}${delta.toFixed(1)} → real ${cur.toFixed(1)}`);
  renderAll();
  persist();
}

function equalizeSegmentKcal(){
  if(!state.plan) throw new Error('Carga un plan primero');
  capturePoint(true);
  const info=currentSegInfo();
  if(!info) throw new Error('No hay tramo actual');
  const items=state.history.filter(x=>x.sec>=info.startSec && x.sec<=currentElapsed());
  const first=items[0] || {kPlan: info.startSec?state.history.filter(x=>x.sec<=info.startSec).at(-1)?.kPlan||0:0, kReal: info.startSec?state.history.filter(x=>x.sec<=info.startSec).at(-1)?.kReal||0:0};
  const desiredReal = round1((first.kReal||0) + (currentPlanKcal() - (first.kPlan||0)));
  state.realOffset = round1(desiredReal - currentPlanKcal());
  addLog(`[KCAL] tramo igualado → real ${desiredReal.toFixed(1)} · desvío tramo 0.0`);
  renderAll();
  persist();
}

function buildMinuteRows(){const rows=[]; for(let m=0;m<=Math.floor((state.history.at(-1)?.sec||0)/60);m++){const items=state.history.filter(x=>Math.floor(x.sec/60)===m); if(!items.length) continue; const first=items[0], last=items.at(-1); const bpmItems=items.filter(x=>x.bpm!=null); rows.push({minute:m,clock:fmt(m*60),level:last.level,segment:last.segment,kcalStart:first.kReal,kcalEnd:last.kReal,kcalMinute:round2(last.kReal-first.kReal),kcalPerMin:round2((last.kReal-first.kReal)/Math.max(1,(items.length/60))),bpmAvg:bpmItems.length?round1(bpmItems.reduce((a,b)=>a+b.bpm,0)/bpmItems.length):null})} return rows}
function buildSegmentSummary(){const out=[]; if(!state.plan) return out; let cursor=0; for(const seg of state.plan.segments){const items=state.history.filter(x=>x.sec>=cursor&&x.sec<=cursor+seg.durationSec); const startPlan=items[0]?.kPlan??0, endPlan=items.at(-1)?.kPlan??startPlan, startReal=items[0]?.kReal??0, endReal=items.at(-1)?.kReal??startReal; const bpmItems=items.filter(x=>x.bpm!=null); out.push({segment:seg.id,level:seg.level,duration:fmt(seg.durationSec),kcalPlan:round1(endPlan-startPlan),kcalReal:round1(endReal-startReal),deviation:round1((endReal-startReal)-(endPlan-startPlan)),bpmAvg:bpmItems.length?round1(bpmItems.reduce((a,b)=>a+b.bpm,0)/bpmItems.length):null}); cursor+=seg.durationSec} return out}
function renderTimeline(){const bar=els.timelineBar,mks=els.timelineMarkers; bar.querySelectorAll('.seg').forEach(n=>n.remove()); mks.innerHTML=''; if(!state.plan) return; const total=planDuration(); state.plan.segments.forEach(seg=>{const el=document.createElement('div'); el.className='seg'+(seg.isTest?' test':''); el.dataset.level=String(seg.level); el.style.setProperty('--flex',seg.durationSec); el.textContent=`${seg.id} · ${seg.level}`; bar.appendChild(el)}); let c=0; const add=(left,label,water=false)=>{const d=document.createElement('div'); d.className='mkr'; d.style.left=left+'%'; d.innerHTML=`<div class="stick" style="background:${water?'#60a5fa':'#fff'}"></div><div class="label">${label}</div>`; mks.appendChild(d)}; state.plan.segments.forEach(seg=>{add((c/total)*100,`${fmt(c)} ${seg.id}`); c+=seg.durationSec}); add(100,`${fmt(total)} Fin`); state.plan.water.forEach(w=>{const [mm,ss]=w.split(':').map(Number); const sec=mm*60+ss; add((sec/total)*100,`${w} 💧`,true)})}
function nextChangeInfo(){if(!state.plan) return null; const now=currentElapsed(); let c=0; for(const seg of state.plan.segments){if(c>now) return {inSec:c-now,seg}; c+=seg.durationSec} return null}
function nextWaterInfo(){if(!state.plan||!state.plan.water.length) return null; const now=currentElapsed(); for(const w of state.plan.water){const [mm,ss]=w.split(':').map(Number); const sec=mm*60+ss; if(sec>now) return {inSec:sec-now,at:w}} return null}
function segmentDeviation(){const info=currentSegInfo(); if(!info) return 0; const items=state.history.filter(x=>x.sec>=info.startSec&&x.sec<=currentElapsed()); if(!items.length) return 0; const first=items[0], last=items.at(-1); return round1((last.kReal-first.kReal)-(last.kPlan-first.kPlan))}
function totalDeviation(){return round1(currentRealKcal()-currentPlanKcal())}
function realRate(){const sec=Math.max(1,currentElapsed()); return round2(currentRealKcal()/(sec/60))}
function planRateNeeded(){const remainSec=Math.max(1,planDuration()-currentElapsed()); const remainK=Math.max(0,(state.plan?.totalKcal||0)-currentRealKcal()); return round2(remainK/(remainSec/60))}
function renderUpcoming(){const body=els.upcomingBody; body.innerHTML=''; if(!state.plan) return; const now=currentElapsed(), total=planDuration(), info=currentSegInfo(now), rows=[]; if(info) rows.push({en:'AHORA',hora:fmt(now),nivel:info.seg.level,tramo:info.seg.id,current:true,atSec:now}); let c=0; const future=[]; for(const seg of state.plan.segments){ if(c>now) future.push({atSec:c,en:fmt(c-now),hora:fmt(c),nivel:seg.level,tramo:seg.id,type:'segment'}); c+=seg.durationSec; } state.plan.water.forEach(w=>{ const [m,s]=w.split(':').map(Number); const sec=m*60+s; if(sec>now) future.push({atSec:sec,en:fmt(sec-now),hora:w,nivel:'Agua',tramo:'💧',type:'water'}); }); future.push({atSec:total,en:fmt(Math.max(0,total-now)),hora:fmt(total),nivel:'Fin',tramo:'Fin',type:'end'}); future.sort((a,b)=>a.atSec-b.atSec || (a.type==='water'?1:-1)); rows.push(...future.slice(0,4)); rows.slice(0,5).forEach(r=>{const tr=document.createElement('tr'); if(r.current) tr.className='current'; tr.innerHTML=`<td>${r.en}</td><td>${r.hora}</td><td>${r.nivel}</td><td>${r.tramo}</td>`; body.appendChild(tr)}); els.upcomingVisibleLabel.textContent=`Cambios visibles: ${Math.max(0,rows.length-1)}`}

function renderTicker(){
  els.tickerNow.textContent=hm(new Date());
  const eta=state.plan?new Date(Date.now()+Math.max(0,planDuration()-currentElapsed())*1000):null;
  els.tickerEta.textContent='FIN '+hm(eta);
  const msgs=[];
  const info=currentSegInfo();
  const totalDev=totalDeviation();
  const segDev=segmentDeviation();
  const real=realRate();
  const next=nextChangeInfo();
  const water=nextWaterInfo();
  if(info){msgs.push({t:`TRAMO ${info.seg.id} · NIVEL ${info.seg.level} · DESVÍO ${segDev>=0?'+':''}${segDev.toFixed(1)} KCAL · RITMO ${real.toFixed(2)} KCAL/MIN`,c:Math.abs(segDev)>=3?'warn':'good'});}
  if(next){msgs.push({t:`PRÓXIMO CAMBIO EN ${fmt(next.inSec)} · TRAMO ${next.seg.id} · NIVEL ${next.seg.level}`,c:'warn'});}
  if(water){msgs.push({t:`AGUA EN ${fmt(water.inSec)} · HORA ${water.at}`,c:'warn'});}
  msgs.push({t:`DESVÍO TOTAL ${totalDev>=0?'+':''}${totalDev.toFixed(1)} KCAL · PLAN ${currentPlanKcal().toFixed(1)} · REAL ${currentRealKcal().toFixed(1)}`,c:Math.abs(totalDev)>=6?'bad':'good'});
  if(state.ble.connected){msgs.push({t:`BLE OK · ${state.ble.deviceName||'PULSÓMETRO'} · BPM ${bpmDisplay()?.toFixed(1)??'--.-'} · 5S ${avgBpmWindow(5)?.toFixed(1)??'--.-'}`,c:'good'});} else {msgs.push({t:'BLE DESCONECTADO · PULSA CONECTAR PULSÓMETRO',c:'bad'});}
  if(state.phase==='running'){msgs.push({t:`SESIÓN CORRIENDO · RESTAN ${fmt(Math.max(0,planDuration()-currentElapsed()))} · FIN ${hm(eta)}`,c:''});}
  if(state.countdown.active){msgs.push({t:'CUENTA ATRÁS DE INICIO EN MARCHA',c:'warn'});}
  if(!msgs.length) msgs.push({t:'APP LISTA PARA EMPEZAR',c:''});
  const now=Date.now();
  if(!state.bannerLastChange||now-state.bannerLastChange>state.bannerHoldMs){state.bannerIndex=(state.bannerIndex+1)%msgs.length; state.bannerLastChange=now;}
  const msg=msgs[state.bannerIndex]||msgs[0];
  els.tickerMsg.textContent=msg.t.toUpperCase();
  els.tickerMsg.className='ticker-msg'+(msg.c?' '+msg.c:'');
  updateTickerOverflow();
}
function renderWater(){ const next=nextWaterInfo(); const total=(state.plan?.water||[]).length; const done=(state.plan?.water||[]).filter(w=>{const [m,s]=w.split(':').map(Number); return (m*60+s)<=currentElapsed();}).length; els.waterCountLabel.textContent=`${done} / ${total}`; if(!next){ els.waterNextLabel.textContent = total? 'TOMAS COMPLETADAS' : 'SIN TOMA PENDIENTE'; els.waterProgressBar.style.width='100%'; return; } const [m,s]=next.at.split(':').map(Number); const atSec=m*60+s; const prev=(state.plan?.water||[]).map(w=>{const [mm,ss]=w.split(':').map(Number); return mm*60+ss}).filter(v=>v<atSec).sort((a,b)=>a-b).at(-1) ?? 0; const span=Math.max(1,atSec-prev); const pct=Math.min(100,Math.max(0,((currentElapsed()-prev)/span)*100)); els.waterNextLabel.textContent=`PRÓXIMA EN ${fmt(next.inSec)} · ${next.at}`; els.waterProgressBar.style.width=pct+'%'; }
function setChip(el, text, kind){ if(!el) return; el.textContent=text; el.classList.remove('ok','warn','bad'); if(kind) el.classList.add(kind); } 
function renderStatus(){
  const bpm=bpmDisplay();
  const target=getCurrentBpmTarget();
  const freshPulse = hasFreshPulse(6);
  let pulseKind='warn', pulseText=freshPulse?'❤️ SIN PULSO':'❤️ SIN PULSO';
  if(freshPulse && bpm!=null && target){
    pulseText=`❤️ ${round1(bpm).toFixed(1)} BPM`;
    if(bpm>=target.min && bpm<=target.max) pulseKind='ok';
    else if(bpm>=target.min-5 && bpm<=target.max+5) pulseKind='warn';
    else pulseKind='bad';
  } else if(freshPulse && bpm!=null){
    pulseText=`❤️ ${round1(bpm).toFixed(1)} BPM`;
    pulseKind='ok';
  }
  const bleStatus=(state.ble.status||'').toLowerCase();
  let bleText='📶 BLE OFF', bleKind='bad';
  if(bleStatus.includes('conect')){ bleText='📶 BLE OK'; bleKind='ok'; }
  else if(bleStatus.includes('reconect')){ bleText='📶 RECON'; bleKind='warn'; }
  else if(bleStatus.includes('sin señal')){ bleText='📶 SIN SEÑAL'; bleKind='warn'; }
  else if(bleStatus.includes('emparejar')){ bleText='📶 EMPAREJAR'; bleKind='warn'; }
  setChip(els.chipBle,bleText,bleKind);
  setChip(els.chipPulse,pulseText,pulseKind);
  setChip(els.chipSession,state.phase==='running'?'⏱️ CORRIENDO':state.phase==='paused'?'⏱️ PAUSADA':'⏱️ LISTA',state.phase==='running'?'ok':state.phase==='paused'?'warn':'');
  setChip(els.chipSaved,'💾 GUARDADO',state.history.length?'ok':'');
  setChip(els.chipWater,nextWaterInfo()?'💧 AGUA':'💧 SIN AGUA',nextWaterInfo()?'ok':'warn');
  setChip(els.chipAlerts,Math.abs(totalDeviation())>5?'⚠️ DESVÍO':'⚠️ ALERTAS',Math.abs(totalDeviation())>5?'warn':'');
  setChip(els.chipApp,'📲 '+APP_VERSION,'ok');
  const tests=state.plan?.segments?.filter(s=>s.isTest).map(s=>s.id).join(', ');
  setChip(els.chipTest,tests?`🧪 ${tests}`:'🧪 --',tests?'warn':'');
  if(els.bleStatusLabel) els.bleStatusLabel.textContent = state.ble.connected ? (hasFreshPulse(6)? (state.ble.detail || `Conectado a ${state.ble.deviceName||'pulsómetro'}`) : `Conectado a ${state.ble.deviceName||'pulsómetro'} · sin pulso reciente`) : 'BLE listo. Usa “Conectar pulsómetro”.';
  if(els.bleState) els.bleState.textContent = state.ble.status || '--';
  if(els.bleBattery) els.bleBattery.textContent = state.ble.battery!=null ? `${state.ble.battery}%` : '--';
  if(els.bleRR) els.bleRR.textContent = state.ble.lastRR!=null ? `${state.ble.lastRR} ms` : '--';
  if(els.wakeLockLabel) els.wakeLockLabel.textContent = state.wakeLock ? 'Pantalla activa' : 'Pantalla normal';
}


function renderMetrics(){
  const sec=currentElapsed(), realSec=currentRealElapsed(), machineRawSec=currentMachineElapsedRaw(), info=currentSegInfo(sec), bpm=bpmDisplay(), freshPulse=hasFreshPulse(6);
  const startBtnNode=$('startBtn');
  if(startBtnNode) startBtnNode.textContent = state.phase==='running' ? '⏸ Pausa' : (state.phase==='paused' ? '▶ Reanudar' : '▶ Empezar');
  if(els.timeBig) els.timeBig.textContent=fmt(machineRawSec);
  els.timeRealLabel.textContent=`REAL ${fmt(realSec)} · PLAN ${fmt(sec)} · AJ ${state.machineOffsetSec>=0?'+':'-'}${fmt(Math.abs(state.machineOffsetSec||0))}`;
  syncCalibrationUi();
  els.kPlanBig.textContent=currentPlanKcal().toFixed(1);
  els.kRealBig.textContent=currentRealKcal().toFixed(1);
  els.bpmBig.textContent=(!freshPulse || bpm==null)?'--.-':round1(bpm).toFixed(1);
  els.bleBpmBig.textContent=els.bpmBig.textContent;
  els.ble5s.textContent=avgBpmWindow(5)?.toFixed(1)??'--.-';
  els.ble10s.textContent=avgBpmWindow(10)?.toFixed(1)??'--.-';
  els.ble30s.textContent=avgBpmWindow(30)?.toFixed(1)??'--.-';
  els.bleLastPkt.textContent=state.ble.lastPacketTs?`${Math.floor((Date.now()-state.ble.lastPacketTs)/1000)}s`:'--';
  els.bleDeviceName.textContent=state.ble.deviceName||'--';
  let target='--', pulseKind='bad';
  if(info){
    const d=state.plan?.bpmDay?.[info.seg.level]||state.plan?.bpmApp?.[info.seg.level];
    if(d){
      target=`${d.min}-${d.max}`;
      if(bpm!=null){
        if(bpm>=d.min && bpm<=d.max) pulseKind='ok';
        else if(bpm>=d.min-5 && bpm<=d.max+5) pulseKind='warn';
        else pulseKind='bad';
      } else pulseKind='warn';
    }
  }
  els.bpmTargetLabel.textContent=target;
  if(els.bpmBig){
    els.bpmBig.style.background = pulseKind==='ok' ? '#166534' : pulseKind==='warn' ? '#92400e' : '#7f1d1d';
  }
  els.avgPlanLabel.textContent=`${round2(currentPlanKcal()/Math.max(1,sec/60)).toFixed(2)} kcal/min · ${round2(currentPlanKcal()/Math.max(1,sec/30)).toFixed(2)}/30s`;
  els.avgRealLabel.textContent=`${realRate().toFixed(2)} kcal/min · ${round2(currentRealKcal()/Math.max(1,sec/30)).toFixed(2)}/30s`;
  els.deviationTotalLabel.textContent=`${totalDeviation()>=0?'+':'-'}${Math.abs(totalDeviation()).toFixed(1)} kcal`;
  els.deviationSegmentLabel.textContent=`${segmentDeviation()>=0?'+':'-'}${Math.abs(segmentDeviation()).toFixed(1)} kcal`;
  els.realRateLabel.textContent=`${realRate().toFixed(2)} kcal/min`;
  els.planRateLabel.textContent=`${planRateNeeded().toFixed(2)} kcal/min`;
  const totalWater=state.plan?.water?.length||0;
  const doneWater=(state.plan?.water||[]).filter(w=>{const [m,s]=w.split(':').map(Number); return m*60+s<=sec}).length;
  els.waterCountLabel.textContent=`${doneWater} / ${totalWater}`;
  els.sessionBadge.textContent=state.phase==='running'?'Corriendo':state.phase==='paused'?'Pausada':'Lista';
  const startBtn=$('startBtn');
  if(startBtn) startBtn.textContent=state.countdown.active?'⏳ Cuenta atrás':state.phase==='running'?'⏸ Pausa':state.phase==='paused'?'▶ Reanudar':'▶ Empezar';
  if(state.plan) els.planTitle.textContent=state.plan.title;
}

function renderPlayhead(){const pct=planDuration()?Math.min(100,(currentElapsed()/planDuration())*100):0; els.playhead.style.left=pct+'%'}
function renderAll(){try{renderMetrics(); renderPlayhead(); renderUpcoming(); renderWater(); renderStatus(); renderTicker(); updateButtonDisabledStates()}catch(e){addLog('[RENDER] ERROR: '+(e?.message||e)); console.error(e);}}

function persist(){
  try{
    const payload={version:APP_VERSION,plan:state.plan,phase:state.phase,startTs:state.startTs,pausedAccumMs:state.pausedAccumMs,pauseTs:state.pauseTs,elapsedSec:currentRealElapsed(),machineElapsedSec:currentElapsed(),machineRawElapsedSec:currentMachineElapsedRaw(),machineOffsetSec:state.machineOffsetSec||0,timeCal:state.timeCal,realOffset:state.realOffset,history:state.history.slice(-5000)};
    localStorage.setItem(STATE_KEY,JSON.stringify(payload));
    localStorage.setItem(VERSIONED_STATE_KEY,JSON.stringify(payload));
  }catch(e){addLog('[SAVE] ERROR: '+(e.message||e))}
}
function loadPersisted(){
  try{
    const raw=localStorage.getItem(STATE_KEY)||localStorage.getItem(VERSIONED_STATE_KEY);
    if(!raw) return;
    const d=JSON.parse(raw);
    const sameTimeModel = d.version === APP_VERSION;
    Object.assign(state,{plan:d.plan||null,phase:d.phase||'idle',startTs:d.startTs??null,pausedAccumMs:d.pausedAccumMs||0,pauseTs:d.pauseTs||null,elapsedSec:d.elapsedSec||0,machineOffsetSec:(sameTimeModel ? Number(d.machineOffsetSec||0) : 0),realOffset:d.realOffset||0,history:d.history||[]});
    state.timeCal = (sameTimeModel && d.timeCal) ? Object.assign({enabled:false,appRefSec:0,realRefSec:0,factorOverall:1,factorAfterMinute:1}, d.timeCal) : {enabled:false,appRefSec:0,realRefSec:0,factorOverall:1,factorAfterMinute:1};
    recomputeTimeCalibration();
    if(state.phase==='running' && state.startTs==null && state.elapsedSec>0){
      state.phase='paused';
    }
    if(state.plan){
      els.importOutput.textContent=normalizeText();
      els.planTitle.textContent=state.plan.title;
      renderTimeline();
    }
    if((d.version||'') && d.version !== APP_VERSION) addLog('[LOAD] Estado anterior detectado · ajuste máquina reiniciado para evitar desfases heredados');
    syncCalibrationUi();
    addLog('[LOAD] Sesión recuperada desde guardado local');
  }catch(e){addLog('[LOAD] ERROR: '+(e.message||e))}
}
function resumeSavedSession(){loadPersisted(); renderAll(); if(state.plan) addLog('[LOAD] Reanudada desde guardado local'); else throw new Error('No hay sesión guardada')}
function summaryText(){const segs=buildSegmentSummary(); const lines=[`ELÍPTICA ${APP_VERSION}`,`Tiempo máquina: ${fmt(currentMachineElapsedRaw())}`,`Tiempo plan: ${fmt(currentElapsed())}`,`Tiempo real: ${fmt(currentRealElapsed())}`,`Ajuste máquina: ${state.machineOffsetSec>=0?'+':'-'}${fmt(Math.abs(state.machineOffsetSec||0))}`,`Calibración activa: ${state.timeCal.enabled?'SÍ':'NO'}`,`Factor general: ${fmtFactor10(state.timeCal.factorOverall||1)}`,`Factor desde 01:00: ${fmtFactor10(state.timeCal.factorAfterMinute||1)}`,`Kcal plan: ${currentPlanKcal().toFixed(1)}`,`Kcal real: ${currentRealKcal().toFixed(1)}`,`Desvío total: ${totalDeviation().toFixed(1)} kcal`,`Ritmo real: ${realRate().toFixed(2)} kcal/min`,`Pulso: ${bpmDisplay()?.toFixed(1)??'--.-'}`,'']; segs.forEach(s=>lines.push(`${s.segment} · N${s.level} · plan ${s.kcalPlan} · real ${s.kcalReal} · desvío ${s.deviation}`)); return lines.join('\n')}

function showFinalSummary(){
  const txt=summaryText();
  els.importOutput.textContent=txt;
  saveCompletedSession('manual');
  addLog('[SUMMARY] Resumen final generado');
}

function download(name, content, mime='text/plain;charset=utf-8'){const blob=new Blob([content],{type:mime}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),500)}
function exportJson(){download(`eliptica_${APP_VERSION}.json`,JSON.stringify({version:APP_VERSION,build:BUILD,plan:state.plan,timeCal:state.timeCal,current:{elapsedSec:currentElapsed(),machineRawElapsedSec:currentMachineElapsedRaw(),realElapsedSec:currentRealElapsed(),machineOffsetSec:state.machineOffsetSec||0,kPlan:currentPlanKcal(),kReal:currentRealKcal(),bpm:bpmDisplay()},history:state.history,segmentSummary:buildSegmentSummary(),logs:state.logs},null,2),'application/json'); addLog('[EXPORT] JSON exportado'); if(els.importOutput) els.importOutput.textContent='JSON exportado'}
function exportSessionCsv(){if(!state.history.length) throw new Error('No hay datos segundo a segundo'); const rows=['seg_plan;clock_plan;seg_machine_raw;clock_machine_raw;seg_real;clock_real;level;segment;kcal_plan;kcal_real;bpm']; state.history.forEach(h=>rows.push([h.sec,h.clock,h.machineRawSec??'',h.machineRawClock??'',h.realSec??'',h.realClock??'',h.level,h.segment,h.kPlan,h.kReal,h.bpm??''].join(';'))); download(`sesion_${APP_VERSION}.csv`,'\ufeff'+rows.join('\r\n'),'text/csv;charset=utf-8'); addLog('[EXPORT] Sesión CSV exportada')}
function exportMinuteCsv(){const rowsData=buildMinuteRows(); if(!rowsData.length) throw new Error('No hay datos minuto a minuto todavía'); const rows=['minute;clock;level;segment;kcal_start;kcal_end;kcal_minute;kcal_per_min;bpm_avg']; rowsData.forEach(r=>rows.push([r.minute,r.clock,r.level,r.segment,r.kcalStart,r.kcalEnd,r.kcalMinute,r.kcalPerMin,r.bpmAvg??''].join(';'))); download(`minuto_${APP_VERSION}.csv`,'\ufeff'+rows.join('\r\n'),'text/csv;charset=utf-8'); addLog('[EXPORT] Minuto a minuto exportado')}
function exportTramoCsv(){const segs=buildSegmentSummary(); if(!segs.length) throw new Error('No hay datos por tramo'); const rows=['segment;level;duration;kcal_plan;kcal_real;deviation;bpm_avg']; segs.forEach(s=>rows.push([s.segment,s.level,s.duration,s.kcalPlan,s.kcalReal,s.deviation,s.bpmAvg??''].join(';'))); download(`tramos_${APP_VERSION}.csv`,'\ufeff'+rows.join('\r\n'),'text/csv;charset=utf-8'); addLog('[EXPORT] CSV por tramos exportado')}
function exportPlan(){const txt=state.plan?normalizeText():els.planInput.value; if(!txt) throw new Error('No hay plan para exportar'); download(`plan_${APP_VERSION}.txt`,txt,'text/plain;charset=utf-8'); addLog('[EXPORT] Plan exportado')}

function compareLast(){
  const raw=localStorage.getItem(LAST_SESSION_KEY);
  if(!raw){
    const txt='No hay sesión final guardada todavía. Usa “Resumen final” al terminar una sesión.';
    els.importOutput.textContent=txt;
    addLog('[COMPARE] Sin sesión previa');
    return;
  }
  const prev=JSON.parse(raw);
  els.importOutput.textContent=`COMPARAR CON ÚLTIMA\nAnterior kcal: ${prev.kReal??'--'}\nActual kcal: ${currentRealKcal().toFixed(1)}\nDiff kcal: ${((currentRealKcal()||0)-(prev.kReal||0)).toFixed(1)}\nAnterior tiempo: ${fmt(prev.elapsedSec||0)}\nActual tiempo: ${fmt(currentMachineElapsedRaw())}\nVersión anterior: ${prev.version||'--'}`;
}

async function clearAppData(){
  localStorage.clear();
  sessionStorage.clear();
  if('caches' in window){
    const keys=await caches.keys();
    await Promise.all(keys.map(k=>caches.delete(k)));
  }
  if('serviceWorker' in navigator){
    const regs=await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map(r=>r.unregister()));
  }
  addLog('[CLEAR] Datos locales y caché borrados');
  if(els.importOutput) els.importOutput.textContent='Datos locales y caché borrados';
  setTimeout(()=>location.href=appUrl('index.html'),300);
}

async function installApp(){if(state.installPrompt) await state.installPrompt.prompt(); else addLog('[PWA] No hay prompt disponible')}
async function registerSW(){
  if(!('serviceWorker' in navigator)){ setPwaState('Service Worker no soportado en este navegador.'); return; }
  try{
    navigator.serviceWorker.addEventListener('controllerchange', ()=>{ addLog('[SW] controllerchange'); setPwaState(`Eliptica PWA ${APP_VERSION} activa. Recargando…`); setTimeout(()=>location.reload(), 120); });
    state.swReg = await navigator.serviceWorker.register(`./sw.js?v=${APP_VERSION}`, { updateViaCache:'none' });
    addLog('[SW] registrado');
    setPwaState(`Eliptica PWA ${APP_VERSION} lista. Puedes forzar actualización desde aquí.`);
    state.swReg.addEventListener('updatefound', ()=>{
      addLog('[SW] updatefound');
      setPwaState('Actualización detectada. Pulsa “Actualizar app” para activarla.');
      const nw = state.swReg.installing;
      if(nw){
        nw.addEventListener('statechange', ()=>{
          addLog(`[SW] nuevo worker: ${nw.state}`);
          if(nw.state==='installed' && navigator.serviceWorker.controller){
            setPwaState('Nueva versión descargada. Pulsa “Actualizar app”.');
          }
        });
      }
    });
  }catch(e){ addLog('[SW] ERROR: '+(e.message||e)); setPwaState('Error registrando Service Worker'); }
}
async function updateApp(){
  if(!state.swReg) throw new Error('No hay service worker');
  setPwaState('Buscando actualización…');
  await state.swReg.update();
  addLog('[PWA] Update solicitado');
  if(state.swReg.waiting){
    addLog('[PWA] waiting encontrado; skipWaiting enviado');
    setPwaState('Nueva versión lista. Activando…');
    state.swReg.waiting.postMessage({type:'SKIP_WAITING'});
    return;
  }
  setPwaState('Recarga solicitada para buscar recursos nuevos…');
  location.href = appUrl('index.html');
}
async function forceReloadApp(){
  setPwaState('Borrando caché local y recargando limpio…');
  addLog('[PWA] Forzar recarga limpia');
  if('caches' in window){
    const keys = await caches.keys();
    await Promise.all(keys.filter(k=>/^eliptica-/i.test(k)).map(k=>caches.delete(k)));
    addLog('[PWA] Cachés de la app borradas');
  }
  if(state.swReg){
    try{ await state.swReg.unregister(); addLog('[PWA] SW desregistrado temporalmente'); }catch(e){ addLog('[PWA] SW unregister ERROR: '+(e.message||e)); }
  }
  location.href = appUrl('index.html');
}

function verifyAll(){
  const checks=[]; const push=(name,ok,detail='')=>{checks.push({name,ok,detail}); addLog(`[CHECK] ${name}: ${ok?'ok':'fail'}${detail?' · '+detail:''}`)};
  push('DOM timeline',!!els.timelineBar);
  push('DOM ticker',!!els.tickerMsg);
  push('DOM BLE',!!$('bleConnectBtn'));
  push('Clipboard',!!navigator.clipboard||!!document.execCommand);
  push('Notifications','Notification' in window, ('Notification' in window ? Notification.permission : 'n/a'));
  push('Notify toggle', true, state.voice.browserNotify?'ON':'OFF');
  push('Voice select', !!els.voiceSelect, state.voice.selectedURI||'sin seleccionar');
  push('Web Bluetooth','bluetooth' in navigator);
  push('SpeechSynthesis', state.voice.supported, `${state.voice.voices?.length||0} voces`);
  push('Service Worker','serviceWorker' in navigator, state.swReg ? 'registrado' : 'pendiente');
  push('PWA label', !!els.pwaStateLabel, els.pwaStateLabel?.textContent || '');
  push('Wake Lock', 'wakeLock' in navigator);
  push('Parser',typeof parsePlan==='function');
  push('Summary',typeof summaryText==='function');
  push('Export CSV',typeof exportSessionCsv==='function');
  push('Resume saved',typeof resumeSavedSession==='function');
  push('Final summary',typeof showFinalSummary==='function');
  push('Export JSON',typeof exportJson==='function');
  push('Compare last',typeof compareLast==='function');
  push('CSV tramos',typeof exportTramoCsv==='function');
  push('Copy summary',typeof copyText==='function');
  push('Export plan',typeof exportPlan==='function');
  push('Clear app data',typeof clearAppData==='function');
  const btnIds=[...document.querySelectorAll('button[id]')].map(b=>b.id);
  push('Botones con id', btnIds.length>0, String(btnIds.length));
  push('Build',true,`${APP_VERSION} · ${BUILD}`);
  els.importOutput.textContent=checks.map(c=>`${c.ok?'OK':'FAIL'} · ${c.name}${c.detail?' · '+c.detail:''}`).join('\n');
}


async function bleConnect(){
  if(!navigator.bluetooth) throw new Error('Web Bluetooth no disponible');
  setBleStatus('Emparejando','Selecciona tu pulsómetro BLE');
  renderAll();
  const device=await navigator.bluetooth.requestDevice({filters:[{services:['heart_rate']}],optionalServices:['battery_service','device_information']});
  await connectDevice(device,false);
}
async function bleReconnect(){
  setBleStatus('Reconectando','Intentando reconexión BLE');
  renderAll();
  if(state.ble.device) return connectDevice(state.ble.device,true);
  if(navigator.bluetooth.getDevices){
    const devices=await navigator.bluetooth.getDevices();
    if(devices[0]) return connectDevice(devices[0],true);
  }
  setBleStatus('Emparejar requerido','No hay dispositivo previo recordado');
  renderAll();
  throw new Error('No hay dispositivo previo');
}
async function bleDisconnect(){
  try{ if(state.ble.reconnectTimer){ clearTimeout(state.ble.reconnectTimer); state.ble.reconnectTimer=null; } }catch{}
  try{ if(state.ble.hrChar&&state._hrHandler) state.ble.hrChar.removeEventListener('characteristicvaluechanged',state._hrHandler); }catch{}
  try{ state.ble.server&&state.ble.server.disconnect(); }catch{}
  state.ble.connected=false;
  state.bpmSamples=[];
  state.ble.lastPacketTs=0;
  setBleStatus('Desconectado','Desconectado por el usuario');
  addLog('[BLE] desconectado');
  renderAll();
}
function bleDiag(){
  els.importOutput.textContent=`BLE connected: ${state.ble.connected}\nEstado: ${state.ble.status||'--'}\nDetalle: ${state.ble.detail||'--'}\nDevice: ${state.ble.deviceName||'--'}\nBattery: ${state.ble.battery!=null?state.ble.battery+'%':'--'}\nRR: ${state.ble.lastRR!=null?state.ble.lastRR+' ms':'--'}\nLast packet: ${state.ble.lastPacketTs?((Date.now()-state.ble.lastPacketTs)/1000).toFixed(1)+'s':'--'}`;
}
async function tryAutoBLE(){
  if(!navigator.bluetooth||!navigator.bluetooth.getDevices||state.ble.autoAttempted) return;
  state.ble.autoAttempted=true;
  try{
    const devices=await navigator.bluetooth.getDevices();
    if(devices.length){
      addLog('[BLE] Intento de autoconexión');
      await connectDevice(devices[0],true);
    }else{
      setBleStatus('Emparejar requerido','No hay pulsómetro recordado por el navegador');
      renderAll();
    }
  }catch(e){ addLog('[BLE] Auto ERROR: '+(e.message||e)); }
}
function scheduleBleReconnect(){
  if(!state.ble.device || state.ble.connected) return;
  if(state.ble.reconnectTimer) clearTimeout(state.ble.reconnectTimer);
  state.ble.reconnectAttempts = (state.ble.reconnectAttempts||0) + 1;
  if(state.ble.reconnectAttempts>3){
    setBleStatus('Emparejar requerido','No se pudo reconectar automáticamente');
    renderAll();
    return;
  }
  setBleStatus('Reconectando',`Intento ${state.ble.reconnectAttempts}/3`);
  renderAll();
  state.ble.reconnectTimer = setTimeout(async()=>{
    try{
      await connectDevice(state.ble.device,true);
    }catch(e){
      addLog('[BLE] Reconnect ERROR: '+(e.message||e));
      scheduleBleReconnect();
    }
  }, 1200*state.ble.reconnectAttempts);
}
async function readBatteryFromServer(server){
  try{
    const svc = await server.getPrimaryService('battery_service');
    const chr = await svc.getCharacteristic('battery_level');
    const dv = await chr.readValue();
    state.ble.battery = dv.getUint8(0);
    addLog('[BLE] Batería '+state.ble.battery+'%');
  }catch(e){ state.ble.battery = null; addLog('[BLE] Batería no disponible'); }
}
async function connectDevice(device,isReconnect=false){
  state.ble.device=device;
  state.ble.deviceName=device.name||'Sin nombre';
  setBleStatus(isReconnect?'Reconectando':'Conectando', `${state.ble.deviceName}`);
  renderAll();
  try{
    device.removeEventListener?.('gattserverdisconnected', state._gattDisconnectHandler);
  }catch{}
  state._gattDisconnectHandler=()=>{
    state.ble.connected=false;
    state.ble.lastPacketTs=0;
    state.bpmSamples=[];
    setBleStatus('Sin señal', 'Se perdió la señal del pulsómetro');
    addLog('[BLE] GATT desconectado');
    renderAll();
    scheduleBleReconnect();
  };
  device.addEventListener('gattserverdisconnected', state._gattDisconnectHandler);
  const server=await device.gatt.connect();
  const service=await server.getPrimaryService('heart_rate');
  const chr=await service.getCharacteristic('heart_rate_measurement');
  state._hrHandler=ev=>handleHeartRate(ev);
  await chr.startNotifications();
  chr.addEventListener('characteristicvaluechanged',state._hrHandler);
  state.ble.server=server;
  state.ble.hrChar=chr;
  state.ble.connected=true;
  state.ble.reconnectAttempts=0;
  state.ble.lastPacketTs=Date.now();
  setBleStatus('Conectado', `Conectado a ${state.ble.deviceName}`);
  await readBatteryFromServer(server);
  addLog(`[BLE] conectado a ${state.ble.deviceName}`);
  renderAll();
}
function handleHeartRate(ev){
  const dv=ev.target.value;
  let idx=1;
  const flags=dv.getUint8(0);
  const is16=flags&0x1;
  const bpm=is16?dv.getUint16(idx,true):dv.getUint8(idx);
  idx += is16 ? 2 : 1;
  if(flags & 0x08) idx += 2; // energy expended
  if(flags & 0x10 && dv.byteLength>=idx+2){
    state.ble.lastRR = Math.round(dv.getUint16(idx,true) / 1024 * 1000);
  }
  state.bpmSamples.push({ts:Date.now(),bpm:Number(bpm)});
  if(state.bpmSamples.length>600) state.bpmSamples.shift();
  state.ble.lastPacketTs=Date.now();
  if(!state.ble.connected){ state.ble.connected=true; }
  setBleStatus('Conectado', `Conectado a ${state.ble.deviceName||'pulsómetro'}`);
  renderAll();
}

function startLoops(){
  setInterval(()=>{
    if(state.phase==='running'){
      const dur=planDuration();
      if(dur>0 && currentElapsed()>=dur){
        state.elapsedSec=dur;
        state.phase='paused';
        state.startTs=null;
        capturePoint(true);
        if(!state.alerts.finished){
          state.alerts.finished=true;
          pushAlert('session_finished','FIN DEL EJERCICIO. SESIÓN COMPLETADA.',{cooldownMs:60000,notifyTitle:'Fin de elíptica',notifyBody:'Sesión completada',cls:'good',doNotify:true,beepKind:'critical',priority:5,category:'finish',replaceCategory:true});
          saveCompletedSession('auto-finish');
          releaseWakeLock();
          addLog('[SESSION] Fin automático del plan');
        }
      } else {
        capturePoint();
      }
    }
    renderAll();
  },200);
  setInterval(()=>persist(),1000);
  setInterval(()=>{
    if(state.ble.connected && state.ble.lastPacketTs && Date.now()-state.ble.lastPacketTs>10000){
      addLog('[BLE] Sin paquetes en 10s');
      setBleStatus('Sin señal','Sin paquetes recientes del pulsómetro');
      setChip(els.chipBle,'📶 BLE LENTO','warn');
      pushAlert('ble_slow','PULSÓMETRO SIN PAQUETES RECIENTES. REVISAR CONEXIÓN.',{cooldownMs:30000,notifyTitle:'BLE lento',notifyBody:'Sin paquetes recientes',cls:'bad',doNotify:true,beepKind:'info'});
      renderAll();
    }
  },3000);
}


function init(){
  cacheEls(); bind(); registerSW(); loadPersisted();
  state.voice.browserNotify = ('Notification' in window && Notification.permission==='granted');
  addLog(`[STARTUP] ${APP_VERSION} · ${BUILD}`);
  addLog('[TIME] Tiempo máquina sincronizado con tiempo real por defecto. El desfase solo entra por ajuste manual.');
  addLog('[STARTUP] UI enlazada y bucles iniciados');
  setPwaState(`Eliptica PWA ${APP_VERSION} iniciada. Esperando estado de PWA…`);
  window.addEventListener('online', ()=>{ addLog('[NET] online'); setPwaState(`Conexión recuperada · ${APP_VERSION}`); });
  window.addEventListener('offline', ()=>{ addLog('[NET] offline'); setPwaState('Sin conexión. La app sigue con caché local.'); });
  if(state.voice.supported){
    if(typeof window.speechSynthesis.onvoiceschanged !== 'undefined'){
      window.speechSynthesis.onvoiceschanged = ()=>refreshVoices();
    }
    setTimeout(refreshVoices, 50);
    setTimeout(refreshVoices, 500);
  } else {
    addLog('[VOICE] SpeechSynthesis no soportado');
  }
  if(state.phase==='running'){ requestWakeLock(); }
  verifyAll(); renderAll(); startLoops(); tryAutoBLE();
}

window.addEventListener('error', e=>{ try{ addLog('[RUNTIME] ERROR: '+(e?.message||e)); }catch{} });
window.addEventListener('unhandledrejection', e=>{ try{ addLog('[RUNTIME] PROMISE: '+(e?.reason?.message||e?.reason||e)); }catch{} });
window.addEventListener('DOMContentLoaded', init);
})();
