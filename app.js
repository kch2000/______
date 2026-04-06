(() => {
'use strict';
const APP_VERSION='v55';
const BUILD='2026-04-08 23:59';
const $=id=>document.getElementById(id);
const STATE_KEY=`eliptica_state_${APP_VERSION}`; const LAST_SESSION_KEY='lastCompletedSession'; const state={phase:'idle',plan:null,startTs:null,pausedAccumMs:0,pauseTs:null,elapsedSec:0,lastSec:-1,realOffset:0,history:[],logs:[],installPrompt:null,bannerIndex:0,bannerHoldMs:5000,bannerLastChange:0,bpmSamples:[],swReg:null,lastActionTs:0,lastRenderTick:0,voice:{supported:('speechSynthesis' in window),unlocked:false,enabled:true,voices:[],selectedURI:'',queue:[],speaking:false,lastByKey:{},volume:1,rate:1,browserNotify:false,beepEnabled:true},audio:{ctx:null,unlocked:false},alerts:{lastKey:{},lastSecChecked:-1,lastNotifTs:0},ble:{device:null,server:null,hrChar:null,connected:false,lastPacketTs:0,deviceName:'',autoAttempted:false}};
const els={};
const ids=['timelineBar','timelineMarkers','playhead','tickerNow','tickerMsg','tickerEta','sessionBadge','planTitle','timeBig','timeRealLabel','kPlanBig','kRealBig','bpmBig','bpmTargetLabel','avgPlanLabel','avgRealLabel','deviationTotalLabel','deviationSegmentLabel','realRateLabel','planRateLabel','waterCountLabel','upcomingBody','upcomingVisibleLabel','waterNextLabel','waterProgressBar','chipBle','chipPulse','chipSession','chipSaved','chipWater','chipAlerts','chipApp','chipTest','bleStatusLabel','bleBpmBig','ble5s','ble10s','ble30s','bleLastPkt','bleDeviceName','planInput','importOutput','versionLabel','pwaStateLabel','logBox','voiceSelect','voiceStatus','voiceVolumeRange','voiceVolumeVal','voiceRateRange','voiceRateVal','browserNotifyChk','voiceAlertsChk','beepAlertsChk'];
function cacheEls(){ids.forEach(id=>els[id]=$(id)); if(els.versionLabel) els.versionLabel.textContent=`${APP_VERSION} · ${BUILD}`;}
function addLog(msg){const t=new Date().toTimeString().slice(0,8); state.logs.push(`[${t}] ${msg}`); if(state.logs.length>800) state.logs.shift(); if(els.logBox){els.logBox.textContent=state.logs.join('\n'); els.logBox.scrollTop=els.logBox.scrollHeight;}}

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
  refreshVoices();
  const utter = new SpeechSynthesisUtterance(msg);
  const v = state.voice.voices.find(x=>x.voiceURI===state.voice.selectedURI) || selectBestVoice();
  if(v) utter.voice = v;
  utter.lang = utter.voice?.lang || 'es-ES';
  utter.volume = Number(state.voice.volume||1);
  utter.rate = Number(state.voice.rate||1);
  utter.pitch = 1.0;
  utter.onstart = ()=>{ state.voice.speaking = true; addLog(`[VOICE] Hablando: ${msg}`); };
  utter.onend = ()=>{ state.voice.speaking = false; addLog('[VOICE] Fin'); if(state.voice.queue.length) setTimeout(processVoiceQueue,120); };
  utter.onerror = e=>{ state.voice.speaking = false; addLog('[VOICE] ERROR: '+(e.error||e.message||e)); if(state.voice.queue.length) setTimeout(processVoiceQueue,120); };
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
  if(target && bpm!=null && !isSeek && sec>0 && sec%60===0){
    if(bpm < target.min - 2) pushAlert(`bpm_low_${sec}`, `PULSO POR DEBAJO DEL OBJETIVO. OBJETIVO ${target.min} A ${target.max}.`, {cooldownMs:20000, notifyTitle:'Pulso bajo', notifyBody:`Objetivo ${target.min}-${target.max}`, cls:'bad', doNotify:true, beepKind:'info', priority:3, category:'pulse', replaceCategory:true});
    if(bpm > target.max + 2) pushAlert(`bpm_high_${sec}`, `PULSO POR ENCIMA DEL OBJETIVO. OBJETIVO ${target.min} A ${target.max}.`, {cooldownMs:20000, notifyTitle:'Pulso alto', notifyBody:`Objetivo ${target.min}-${target.max}`, cls:'bad', doNotify:true, beepKind:'info', priority:3, category:'pulse', replaceCategory:true});
  }
}
function evaluateAlertsRangefunction evaluateAlertsRange(prevSec, sec, cause='tick'){
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
      const ae=document.activeElement;
      if(ae && typeof ae.blur==='function' && (ae.tagName==='TEXTAREA' || ae.tagName==='INPUT')) ae.blur();
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
    const wrapped=ev=>{ if(ev){ ev.preventDefault?.(); ev.stopPropagation?.(); } handler(ev); };
    el.addEventListener('click', wrapped, {passive:false});
    el.addEventListener('touchend', wrapped, {passive:false});
    el.addEventListener('keydown', ev=>{ if(ev.key==='Enter' || ev.key===' '){ wrapped(ev); } });
  };
  B('applyPlanBtn','applyPlan',applyPlan);
  B('copyPlanBtn','copyPlan',copyPlanText);
  B('previewPlanBtn','previewPlan',previewPlan);
  B('normalizePlanBtn','normalizePlan',normalizePlan);
  B('clearPlanBtn','clearPlan',()=>{els.planInput.value=''; els.importOutput.textContent='';});
  B('startBtn','toggleRun',toggleRun);
  B('resetBtn','reset',resetSession);
  B('bleConnectBtn','bleConnect',bleConnect);
  B('bleReconnectBtn','bleReconnect',bleReconnect);
  B('bleDisconnectBtn','bleDisconnect',bleDisconnect);
  B('bleDiagBtn','bleDiag',bleDiag);
  B('installAppBtn','installApp',installApp);
  B('updateAppBtn','updateApp',updateApp);
  B('notifPermissionBtn','notifPermission',requestNotificationPermission);
  B('testNotifyBtn','testNotify',testNotify);
  B('refreshVoicesBtn','refreshVoices',()=>{ refreshVoices(); if(els.importOutput) els.importOutput.textContent = (state.voice.voices||[]).map(v=>`${v.name} · ${v.lang}`).join('\n') || 'Sin voces detectadas'; });
  B('testVoiceBtn','testVoice',testVoice);
  B('copyLogBtn','copyLog',async()=>{
    const txt = state.logs.join('\n');
    try{ await copyText(txt); addLog('[LOG] Copiado'); }
    catch(e){ download(`log_${APP_VERSION}.txt`, txt); addLog('[LOG] Descargado como TXT'); }
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
  [['seekPlus60',60],['seekPlus30',30],['seekPlus10',10],['seekPlus5',5],['seekPlus1',1],['seekMinus1',-1],['seekMinus5',-5],['seekMinus10',-10],['seekMinus30',-30],['seekMinus60',-60]].forEach(([id,d])=>B(id,id,()=>seek(d)));
  [['kPlus1',1],['kPlus05',0.5],['kPlus01',0.1],['kMinus01',-0.1],['kMinus05',-0.5],['kMinus1',-1]].forEach(([id,d])=>B(id,id,()=>adjustReal(d)));
  if(els.voiceSelect) els.voiceSelect.addEventListener('change',ev=>{ state.voice.selectedURI = ev.target.value||''; const v=state.voice.voices.find(v=>v.voiceURI===state.voice.selectedURI); if(v) addLog(`[VOICE] Voz seleccionada manual: ${v.name} · ${v.lang}`); populateVoiceSelect(); });
  if(els.voiceVolumeRange) els.voiceVolumeRange.addEventListener('input',ev=>{ state.voice.volume = Number(ev.target.value||1); syncVoiceUi(); addLog(`[VOICE] Volumen: ${state.voice.volume.toFixed(1)}`); });
  if(els.voiceRateRange) els.voiceRateRange.addEventListener('input',ev=>{ state.voice.rate = Number(ev.target.value||1); syncVoiceUi(); addLog(`[VOICE] Velocidad: ${state.voice.rate.toFixed(2)}`); });
  if(els.browserNotifyChk) els.browserNotifyChk.addEventListener('change',ev=>{ state.voice.browserNotify = !!ev.target.checked; syncVoiceUi(); addLog(`[NOTIF] Toggle navegador/reloj: ${state.voice.browserNotify?'ON':'OFF'}`); });
  if(els.voiceAlertsChk) els.voiceAlertsChk.addEventListener('change',ev=>{ state.voice.enabled = !!ev.target.checked; syncVoiceUi(); addLog(`[VOICE] Avisos hablados: ${state.voice.enabled?'ON':'OFF'}`); });
  if(els.beepAlertsChk) els.beepAlertsChk.addEventListener('change',ev=>{ state.voice.beepEnabled = !!ev.target.checked; syncVoiceUi(); addLog(`[AUDIO] Pitidos: ${state.voice.beepEnabled?'ON':'OFF'}`); });
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault(); state.installPrompt=e; addLog('[PWA] beforeinstallprompt capturado');});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden') persist();});
}
function round1(n){return Math.round(n*10)/10} function round2(n){return Math.round(n*100)/100} function fmt(sec){sec=Math.max(0,Math.round(sec)); const m=String(Math.floor(sec/60)).padStart(2,'0'); const s=String(sec%60).padStart(2,'0'); return `${m}:${s}`}
function hm(d){return d?d.toTimeString().slice(0,5):'--:--'}
function planDuration(){return state.plan?.segments?.reduce((a,s)=>a+s.durationSec,0)||0}
function currentElapsed(){if(state.phase==='running'&&state.startTs) return Math.max(0,Math.floor((Date.now()-state.startTs-state.pausedAccumMs)/1000)); return state.elapsedSec||0}
function currentSegInfo(sec=currentElapsed()){if(!state.plan) return null; let c=0; for(let i=0;i<state.plan.segments.length;i++){const seg=state.plan.segments[i]; if(sec < c+seg.durationSec) return {index:i,seg,startSec:c,endSec:c+seg.durationSec}; c+=seg.durationSec;} const last=state.plan.segments.at(-1); return last?{index:state.plan.segments.length-1,seg:last,startSec:c-last.durationSec,endSec:c}:null}
function currentPlanKcal(){if(!state.plan) return 0; let rem=currentElapsed(), total=0; for(const seg of state.plan.segments){if(rem<=0) break; const used=Math.min(seg.durationSec, rem); total += seg.kcalTarget*(used/seg.durationSec); rem-=used;} return round1(total)}
function currentRealKcal(){return Math.max(0, round1(currentPlanKcal()+state.realOffset))}
function bpmDisplay(){const arr=state.bpmSamples; if(!arr.length) return null; const recent=arr.slice(-3).map(x=>x.bpm); return recent.reduce((a,b)=>a+b,0)/recent.length}
function avgBpmWindow(secWindow){const now=Date.now(); const items=state.bpmSamples.filter(x=>now-x.ts<=secWindow*1000); if(!items.length) return null; return items.reduce((a,b)=>a+b.bpm,0)/items.length}
function parsePlan(text){const lines=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean); const segments=[], water=[], bpmApp={}, bpmDay={}; let totalTime=null,totalKcal=null, mode=''; for(let i=0;i<lines.length;i++){const line=lines[i]; if(/^BPM OPERATIVO/i.test(line)){mode='bpmApp'; continue} if(/^BPM DEL DÍA/i.test(line)){mode='bpmDay'; continue} if(/^AGUA EN ELÍPTICA/i.test(line)){mode='water'; continue} if(/^TOTAL PREVISTO/i.test(line)){mode='total'; continue}
const segLine=line.match(/^([A-Z])\)\s+(\d{2}:\d{2})\s*[·-].*?(TEST\s+)?NIVEL\s+(\d+)/i); if(segLine){const id=segLine[1]; const [mm,ss]=segLine[2].split(':').map(Number); const isTest=!!segLine[3]; const level=Number(segLine[4]); let kcalTarget=0; const next=lines[i+1]||''; const km=next.match(/objetivo\s*~?(\d+(?:[.,]\d+)?)(?:[–-](\d+(?:[.,]\d+)?))?/i); if(km) kcalTarget=Number(String(km[2]||km[1]).replace(',','.')); segments.push({id,durationSec:mm*60+ss,level,isTest,kcalTarget}); continue}
const seg2=line.match(/^([A-Z])\)\s+\d{2}:\d{2}[–-]\d{2}:\d{2}\s*(?:→|->)\s*(TEST\s+)?NIVEL\s+(\d+)\s*(?:→|->)\s*~?(\d+(?:[.,]\d+)?)(?:[–-](\d+(?:[.,]\d+)?))?/i); if(seg2){segments.push({id:seg2[1],durationSec:0,level:Number(seg2[3]),isTest:!!seg2[2],kcalTarget:Number(String(seg2[4]||seg2[5]).replace(',','.'))}); continue}
if(mode==='water'){const w=line.match(/(?:Minuto|min)\s*(\d{2}:\d{2})/i); if(w) water.push(w[1])}
if(mode==='total'){const tm=line.match(/Tiempo:\s*(\d{2}:\d{2})/i); if(tm) totalTime=tm[1]; const km=line.match(/Kcal.*?~?(\d+(?:[.,]\d+)?)(?:[–-](\d+(?:[.,]\d+)?))?/i); if(km) totalKcal=Number(String(km[2]||km[1]).replace(',','.'))}
if(mode==='bpmApp'){const bm=line.match(/Nivel\s+(\d+)\s*:\s*(\d+)[–-](\d+)/i); if(bm) bpmApp[Number(bm[1])]={min:Number(bm[2]),max:Number(bm[3])}}
if(mode==='bpmDay'){const bm=line.match(/Nivel\s+(\d+).+?(\d+)[–-](\d+)/i); if(bm) bpmDay[Number(bm[1])]={min:Number(bm[2]),max:Number(bm[3])}}
}
if(!segments.length) throw new Error('No se detectaron tramos'); const duration=segments.reduce((a,s)=>a+s.durationSec,0); return {title:`ELÍPTICA ${APP_VERSION.toUpperCase()} · ${totalTime||fmt(duration)} · ~${Math.round(totalKcal||segments.reduce((a,s)=>a+s.kcalTarget,0))} kcal`,segments,water,bpmApp,bpmDay,totalTime,totalKcal,normalizedText:text}}
function normalizeText(plan=state.plan){if(!plan) return ''; const rows=[]; rows.push(plan.title.replace(` ${APP_VERSION.toUpperCase()}`,'')); rows.push(''); plan.segments.forEach(seg=>{rows.push(`${seg.id}) ${fmt(seg.durationSec)} · ${seg.isTest?'TEST ':''}NIVEL ${seg.level}`); rows.push(`→ objetivo ~${seg.kcalTarget} kcal`); rows.push('');}); rows.push('AGUA EN ELÍPTICA'); plan.water.forEach(w=>rows.push(`Minuto ${w}`)); rows.push(''); rows.push('TOTAL PREVISTO'); rows.push(`- Tiempo: ${plan.totalTime||fmt(planDuration())}`); rows.push(`- Kcal máquina: ~${Math.round(plan.totalKcal||plan.segments.reduce((a,s)=>a+s.kcalTarget,0))} kcal`); return rows.join('\n')}
function applyPlan(){const text=els.planInput.value.trim(); if(!text) throw new Error('No hay texto de plan'); state.plan=parsePlan(text); state.phase='idle'; state.elapsedSec=0; state.realOffset=0; state.history=[]; els.importOutput.textContent=normalizeText(); els.planTitle.textContent=(state.plan.title||'').replace(/^ELÍPTICA\s+/i,`ELÍPTICA ${APP_VERSION} · `); renderTimeline(); persist(); addLog(`[PLAN] Cargado · ${state.plan.segments.length} tramos · agua ${state.plan.water.length}`)}
function previewPlan(){const text=els.planInput.value.trim(); const p=parsePlan(text); els.importOutput.textContent=`TRAMOS: ${p.segments.length}\nDURACIÓN: ${p.totalTime||fmt(p.segments.reduce((a,s)=>a+s.durationSec,0))}\nKCAL: ~${Math.round(p.totalKcal||p.segments.reduce((a,s)=>a+s.kcalTarget,0))}\nAGUA: ${p.water.join(', ')||'ninguna'}\nTESTS: ${p.segments.filter(s=>s.isTest).map(s=>s.id).join(', ')||'ninguno'}`}
function normalizePlan(){const text=els.planInput.value.trim(); const p=parsePlan(text); els.planInput.value=normalizeText(p)}
async function copyText(txt){if(!txt) throw new Error('No hay texto'); try{if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(txt); return true}}catch(e){} const ta=document.createElement('textarea'); ta.value=txt; ta.setAttribute('readonly',''); ta.style.position='fixed'; ta.style.left='-9999px'; ta.style.opacity='0'; document.body.appendChild(ta); ta.focus(); ta.select(); ta.setSelectionRange(0, ta.value.length); let ok=false; try{ok=document.execCommand('copy')}catch(e){} ta.remove(); if(ok) return true; download(`copiado_${APP_VERSION}.txt`,txt,'text/plain;charset=utf-8'); addLog('[COPY] Portapapeles no disponible; descargado como TXT'); return false}
function copyPlanText(){return copyText(els.planInput.value||'')}
function toggleRun(){
  if(!state.plan) throw new Error('Carga un plan primero');
  if(state.phase==='running'){
    state.elapsedSec=currentElapsed();
    state.phase='paused';
    state.pauseTs=Date.now();
    addLog('[SESSION] Pausada');
  } else {
    if(state.startTs==null){
      state.startTs=Date.now()-(state.elapsedSec*1000)-state.pausedAccumMs;
    }
    if(state.phase==='paused' && state.pauseTs){
      state.pausedAccumMs += Date.now()-state.pauseTs;
      state.pauseTs = null;
      state.startTs = Date.now()-(state.elapsedSec*1000)-state.pausedAccumMs;
    }
    state.phase='running';
    addLog('[SESSION] Iniciada/reanudada'); state.alerts.lastSecChecked = currentElapsed()-1;
  }
  persist();
  capturePoint(true);
  renderAll();
}
function resetSession(){state.phase='idle'; state.startTs=null; state.pauseTs=null; state.pausedAccumMs=0; state.elapsedSec=0; state.realOffset=0; state.history=[]; state.lastSec=-1; persist(); renderAll(); addLog('[SESSION] Reseteada')}
function capturePoint(force=false){if(!state.plan) return; const sec=currentElapsed(); const prevSec = state.lastSec; if(!force&&sec===state.lastSec) return; const info=currentSegInfo(sec); const point={sec,clock:fmt(sec),level:info?.seg?.level??null,segment:info?.seg?.id??null,kPlan:currentPlanKcal(),kReal:currentRealKcal(),bpm:bpmDisplay(),ts:Date.now()}; const h=state.history; if(h.length&&h[h.length-1].sec===sec) h[h.length-1]=point; else h.push(point); if(h.length>10000) h.shift(); state.lastSec=sec; if(prevSec>=0) evaluateAlertsRange(prevSec, sec, force?'force':'tick'); }
function seek(delta){ if(!state.plan) throw new Error('Carga un plan primero'); const dur=planDuration(); const prev=currentElapsed(); const next=Math.max(0,Math.min(dur,prev+delta)); state.elapsedSec=next; if(state.phase==='running'){ state.startTs=Date.now()-(next*1000)-state.pausedAccumMs; } else { state.startTs=null; } state.lastSec=prev; capturePoint(true); persist(); addLog(`[SEEK] ${delta>0?'+':''}${delta}s → ${fmt(next)}`); if(state.phase==='running') evaluateAlertsRange(prev, next, 'seek'); renderAll(); }
function adjustReal(delta){ if(!state.plan) throw new Error('Carga un plan primero'); capturePoint(true); let cur=currentRealKcal(); cur=round1(cur+delta); state.realOffset=round1(cur-currentPlanKcal()); addLog(`[KCAL] ajuste ${delta>0?'+':''}${delta.toFixed(1)} → real ${cur.toFixed(1)}`); renderAll(); persist(); }
function buildMinuteRows(){const rows=[]; for(let m=0;m<=Math.floor((state.history.at(-1)?.sec||0)/60);m++){const items=state.history.filter(x=>Math.floor(x.sec/60)===m); if(!items.length) continue; const first=items[0], last=items.at(-1); const bpmItems=items.filter(x=>x.bpm!=null); rows.push({minute:m,clock:fmt(m*60),level:last.level,segment:last.segment,kcalStart:first.kReal,kcalEnd:last.kReal,kcalMinute:round2(last.kReal-first.kReal),kcalPerMin:round2((last.kReal-first.kReal)/Math.max(1,(items.length/60))),bpmAvg:bpmItems.length?round1(bpmItems.reduce((a,b)=>a+b.bpm,0)/bpmItems.length):null})} return rows}
function buildSegmentSummary(){const out=[]; if(!state.plan) return out; let cursor=0; for(const seg of state.plan.segments){const items=state.history.filter(x=>x.sec>=cursor&&x.sec<=cursor+seg.durationSec); const startPlan=items[0]?.kPlan??0, endPlan=items.at(-1)?.kPlan??startPlan, startReal=items[0]?.kReal??0, endReal=items.at(-1)?.kReal??startReal; const bpmItems=items.filter(x=>x.bpm!=null); out.push({segment:seg.id,level:seg.level,duration:fmt(seg.durationSec),kcalPlan:round1(endPlan-startPlan),kcalReal:round1(endReal-startReal),deviation:round1((endReal-startReal)-(endPlan-startPlan)),bpmAvg:bpmItems.length?round1(bpmItems.reduce((a,b)=>a+b.bpm,0)/bpmItems.length):null}); cursor+=seg.durationSec} return out}
function renderTimeline(){const bar=els.timelineBar,mks=els.timelineMarkers; bar.querySelectorAll('.seg').forEach(n=>n.remove()); mks.innerHTML=''; if(!state.plan) return; const total=planDuration(); state.plan.segments.forEach(seg=>{const el=document.createElement('div'); el.className='seg'+(seg.isTest?' test':''); el.dataset.level=String(seg.level); el.style.setProperty('--flex',seg.durationSec); el.textContent=`${seg.id} · ${seg.level}`; bar.appendChild(el)}); let c=0; const add=(left,label,water=false)=>{const d=document.createElement('div'); d.className='mkr'; d.style.left=left+'%'; d.innerHTML=`<div class="stick" style="background:${water?'#60a5fa':'#fff'}"></div><div class="label">${label}</div>`; mks.appendChild(d)}; state.plan.segments.forEach(seg=>{add((c/total)*100,`${fmt(c)} ${seg.id}`); c+=seg.durationSec}); add(100,`${fmt(total)} Fin`); state.plan.water.forEach(w=>{const [mm,ss]=w.split(':').map(Number); const sec=mm*60+ss; add((sec/total)*100,`${w} 💧`,true)})}
function nextChangeInfo(){if(!state.plan) return null; const now=currentElapsed(); let c=0; for(const seg of state.plan.segments){if(c>now) return {inSec:c-now,seg}; c+=seg.durationSec} return null}
function nextWaterInfo(){if(!state.plan||!state.plan.water.length) return null; const now=currentElapsed(); for(const w of state.plan.water){const [mm,ss]=w.split(':').map(Number); const sec=mm*60+ss; if(sec>now) return {inSec:sec-now,at:w}} return null}
function segmentDeviation(){const info=currentSegInfo(); if(!info) return 0; const items=state.history.filter(x=>x.sec>=info.startSec&&x.sec<=currentElapsed()); if(!items.length) return 0; const first=items[0], last=items.at(-1); return round1((last.kReal-first.kReal)-(last.kPlan-first.kPlan))}
function totalDeviation(){return round1(currentRealKcal()-currentPlanKcal())}
function realRate(){const sec=Math.max(1,currentElapsed()); return round2(currentRealKcal()/(sec/60))}
function planRateNeeded(){const remainSec=Math.max(1,planDuration()-currentElapsed()); const remainK=Math.max(0,(state.plan?.totalKcal||0)-currentRealKcal()); return round2(remainK/(remainSec/60))}
function renderUpcoming(){const body=els.upcomingBody; body.innerHTML=''; if(!state.plan) return; const now=currentElapsed(), total=planDuration(), info=currentSegInfo(now), rows=[]; if(info) rows.push({en:'AHORA',hora:fmt(now),nivel:info.seg.level,tramo:info.seg.id,current:true}); let c=0; for(const seg of state.plan.segments){if(c>now&&rows.length<4) rows.push({en:fmt(c-now),hora:fmt(c),nivel:seg.level,tramo:seg.id}); c+=seg.durationSec} state.plan.water.forEach(w=>{const [m,s]=w.split(':').map(Number); const sec=m*60+s; if(sec>now&&rows.length<5) rows.push({en:fmt(sec-now),hora:w,nivel:'Agua',tramo:'💧'})}); rows.push({en:fmt(Math.max(0,total-now)),hora:fmt(total),nivel:'Fin',tramo:'Fin'}); rows.slice(0,5).forEach(r=>{const tr=document.createElement('tr'); if(r.current) tr.className='current'; tr.innerHTML=`<td>${r.en}</td><td>${r.hora}</td><td>${r.nivel}</td><td>${r.tramo}</td>`; body.appendChild(tr)}); els.upcomingVisibleLabel.textContent=`Cambios visibles: ${Math.max(0,rows.length-1)}`}

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
  if(info){msgs.push({t:`▶ ESTADO ACTUAL · TRAMO ${info.seg.id} · NIVEL ${info.seg.level} · DESVÍO TRAMO ${segDev>=0?'+':''}${segDev.toFixed(1)} KCAL · RITMO ${real.toFixed(2)} KCAL/MIN`,c:Math.abs(segDev)>=3?'warn':'good'});}
  if(next){msgs.push({t:`⏭ PRÓXIMO CAMBIO EN ${fmt(next.inSec)} · TRAMO ${next.seg.id} · NIVEL ${next.seg.level}`,c:'warn'});}
  if(water){msgs.push({t:`💧 PRÓXIMA TOMA DE AGUA EN ${fmt(water.inSec)} · HORA ${water.at}`,c:'warn'});}
  msgs.push({t:`📈 DESVÍO TOTAL ${totalDev>=0?'+':''}${totalDev.toFixed(1)} KCAL · PLAN ${currentPlanKcal().toFixed(1)} · REALES ${currentRealKcal().toFixed(1)}`,c:Math.abs(totalDev)>=6?'bad':'good'});
  if(state.ble.connected){msgs.push({t:`📶 BLE CONECTADO · ${state.ble.deviceName||'PULSÓMETRO'} · BPM ${bpmDisplay()?.toFixed(1)??'--.-'} · 5S ${avgBpmWindow(5)?.toFixed(1)??'--.-'}`,c:'good'});} else {msgs.push({t:'📶 BLE DESCONECTADO · PULSA CONECTAR PULSÓMETRO',c:'bad'});}
  if(state.phase==='running'){msgs.push({t:`⏱ SESIÓN CORRIENDO · RESTAN ${fmt(Math.max(0,planDuration()-currentElapsed()))} · FIN ${hm(eta)}`,c:''});}
  if(!msgs.length) msgs.push({t:'APP LISTA PARA EMPEZAR',c:''});
  const now=Date.now();
  if(!state.bannerLastChange||now-state.bannerLastChange>state.bannerHoldMs){state.bannerIndex=(state.bannerIndex+1)%msgs.length; state.bannerLastChange=now;}
  const msg=msgs[state.bannerIndex]||msgs[0];
  els.tickerMsg.textContent=msg.t.toUpperCase();
  els.tickerMsg.className='ticker-msg'+(msg.c?' '+msg.c:'');
}
function renderWater(){ const next=nextWaterInfo(); const total=(state.plan?.water||[]).length; const done=(state.plan?.water||[]).filter(w=>{const [m,s]=w.split(':').map(Number); return (m*60+s)<=currentElapsed();}).length; els.waterCountLabel.textContent=`${done} / ${total}`; if(!next){ els.waterNextLabel.textContent = total? 'TOMAS COMPLETADAS' : 'SIN TOMA PENDIENTE'; els.waterProgressBar.style.width='100%'; return; } const [m,s]=next.at.split(':').map(Number); const atSec=m*60+s; const prev=(state.plan?.water||[]).map(w=>{const [mm,ss]=w.split(':').map(Number); return mm*60+ss}).filter(v=>v<atSec).sort((a,b)=>a-b).at(-1) ?? 0; const span=Math.max(1,atSec-prev); const pct=Math.min(100,Math.max(0,((currentElapsed()-prev)/span)*100)); els.waterNextLabel.textContent=`PRÓXIMA EN ${fmt(next.inSec)} · ${next.at}`; els.waterProgressBar.style.width=pct+'%'; }
function setChip(el, text, kind){ if(!el) return; el.textContent=text; el.classList.remove('ok','warn','bad'); if(kind) el.classList.add(kind); } function renderStatus(){ const bpm=bpmDisplay(); setChip(els.chipBle,state.ble.connected?'📶 BLE OK':'📶 BLE OFF',state.ble.connected?'ok':'bad'); setChip(els.chipPulse,bpm!=null?'❤️ PULSO OK':'❤️ SIN PULSO',bpm!=null?'ok':'warn'); setChip(els.chipSession,state.phase==='running'?'⏱️ CORRIENDO':state.phase==='paused'?'⏱️ PAUSADA':'⏱️ LISTA',state.phase==='running'?'ok':state.phase==='paused'?'warn':''); setChip(els.chipSaved,'💾 GUARDADO',state.history.length?'ok':''); setChip(els.chipWater,nextWaterInfo()?'💧 AGUA':'💧 SIN AGUA',nextWaterInfo()?'ok':'warn'); setChip(els.chipAlerts,Math.abs(totalDeviation())>5?'⚠️ DESVÍO':'⚠️ ALERTAS',Math.abs(totalDeviation())>5?'warn':''); setChip(els.chipApp,'📲 '+APP_VERSION,'ok'); const tests=state.plan?.segments?.filter(s=>s.isTest).map(s=>s.id).join(', '); setChip(els.chipTest,tests?`🧪 ${tests}`:'🧪 --',tests?'warn':''); els.bleStatusLabel.textContent=state.ble.connected?`Conectado a ${state.ble.deviceName||'pulsómetro'}`:'BLE listo. Usa “Conectar pulsómetro”.'; }
function renderMetrics(){const sec=currentElapsed(), info=currentSegInfo(sec), bpm=bpmDisplay(); $('startBtn').textContent = state.phase==='running' ? '⏸ Pausa' : (state.phase==='paused' ? '▶ Reanudar' : '▶ Empezar'); els.timeBig.textContent=fmt(sec); els.timeRealLabel.textContent=`REAL ${fmt(sec)}`; els.kPlanBig.textContent=currentPlanKcal().toFixed(1); els.kRealBig.textContent=currentRealKcal().toFixed(1); els.bpmBig.textContent=bpm==null?'--.-':round1(bpm).toFixed(1); els.bleBpmBig.textContent=els.bpmBig.textContent; els.ble5s.textContent=avgBpmWindow(5)?.toFixed(1)??'--.-'; els.ble10s.textContent=avgBpmWindow(10)?.toFixed(1)??'--.-'; els.ble30s.textContent=avgBpmWindow(30)?.toFixed(1)??'--.-'; els.bleLastPkt.textContent=state.ble.lastPacketTs?`${Math.floor((Date.now()-state.ble.lastPacketTs)/1000)}s`:'--'; els.bleDeviceName.textContent=state.ble.deviceName||'--'; let target='--'; if(info){const d=state.plan?.bpmDay?.[info.seg.level]||state.plan?.bpmApp?.[info.seg.level]; if(d) target=`${d.min}-${d.max}`;} els.bpmTargetLabel.textContent=target; els.avgPlanLabel.textContent=`${round2(currentPlanKcal()/Math.max(1,sec/60)).toFixed(2)} kcal/min · ${round2(currentPlanKcal()/Math.max(1,sec/30)).toFixed(2)}/30s`; els.avgRealLabel.textContent=`${realRate().toFixed(2)} kcal/min · ${round2(currentRealKcal()/Math.max(1,sec/30)).toFixed(2)}/30s`; els.deviationTotalLabel.textContent=`${totalDeviation()>=0?'+':'-'}${Math.abs(totalDeviation()).toFixed(1)} kcal`; els.deviationSegmentLabel.textContent=`${segmentDeviation()>=0?'+':'-'}${Math.abs(segmentDeviation()).toFixed(1)} kcal`; els.realRateLabel.textContent=`${realRate().toFixed(2)} kcal/min`; els.planRateLabel.textContent=`${planRateNeeded().toFixed(2)} kcal/min`; const totalWater=state.plan?.water?.length||0; const doneWater=(state.plan?.water||[]).filter(w=>{const [m,s]=w.split(':').map(Number); return m*60+s<=sec}).length; els.waterCountLabel.textContent=`${doneWater} / ${totalWater}`; els.sessionBadge.textContent=state.phase==='running'?'Corriendo':state.phase==='paused'?'Pausada':'Lista'; const startBtn=$('startBtn'); if(startBtn) startBtn.textContent=state.phase==='running'?'⏸ Pausa':state.phase==='paused'?'▶ Reanudar':'▶ Empezar'; if(state.plan) els.planTitle.textContent=state.plan.title.replace(/^ELÍPTICA\s+/i,`ELÍPTICA ${APP_VERSION} · `)}
function renderPlayhead(){const pct=planDuration()?Math.min(100,(currentElapsed()/planDuration())*100):0; els.playhead.style.left=pct+'%'}
function renderAll(){renderMetrics(); renderPlayhead(); renderUpcoming(); renderWater(); renderStatus(); renderTicker()}
function persist(){try{localStorage.setItem(STATE_KEY,JSON.stringify({plan:state.plan,phase:state.phase,startTs:state.startTs,pausedAccumMs:state.pausedAccumMs,pauseTs:state.pauseTs,elapsedSec:currentElapsed(),realOffset:state.realOffset,history:state.history.slice(-5000)}))}catch(e){addLog('[SAVE] ERROR: '+(e.message||e))}}
function loadPersisted(){try{const raw=localStorage.getItem(STATE_KEY); if(!raw) return; const d=JSON.parse(raw); Object.assign(state,{plan:d.plan||null,phase:d.phase||'idle',startTs:d.startTs||null,pausedAccumMs:d.pausedAccumMs||0,pauseTs:d.pauseTs||null,elapsedSec:d.elapsedSec||0,realOffset:d.realOffset||0,history:d.history||[]}); if(state.plan){els.importOutput.textContent=normalizeText(); els.planTitle.textContent=(state.plan.title||'').replace(/^ELÍPTICA\s+/i,`ELÍPTICA ${APP_VERSION} · `); renderTimeline()} addLog('[LOAD] Sesión recuperada desde guardado local')}catch(e){addLog('[LOAD] ERROR: '+(e.message||e))}}
function resumeSavedSession(){loadPersisted(); renderAll(); if(state.plan) addLog('[LOAD] Reanudada desde guardado local'); else throw new Error('No hay sesión guardada')}
function summaryText(){const segs=buildSegmentSummary(); const lines=[`ELÍPTICA ${APP_VERSION.toUpperCase()}`,`Tiempo: ${fmt(currentElapsed())}`,`Kcal plan: ${currentPlanKcal().toFixed(1)}`,`Kcal real: ${currentRealKcal().toFixed(1)}`,`Desvío total: ${totalDeviation().toFixed(1)} kcal`,`Ritmo real: ${realRate().toFixed(2)} kcal/min`,`Pulso: ${bpmDisplay()?.toFixed(1)??'--.-'}`,'']; segs.forEach(s=>lines.push(`${s.segment} · N${s.level} · plan ${s.kcalPlan} · real ${s.kcalReal} · desvío ${s.deviation}`)); return lines.join('\n')}
function showFinalSummary(){const txt=summaryText(); els.importOutput.textContent=txt; localStorage.setItem(LAST_SESSION_KEY,JSON.stringify({elapsedSec:currentElapsed(),kReal:currentRealKcal(),summary:txt,when:Date.now()})); addLog('[SUMMARY] Resumen final generado')}
function download(name, content, mime='text/plain;charset=utf-8'){const blob=new Blob([content],{type:mime}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),500)}
function exportJson(){download(`eliptica_${APP_VERSION}.json`,JSON.stringify({version:APP_VERSION,build:BUILD,plan:state.plan,current:{elapsedSec:currentElapsed(),kPlan:currentPlanKcal(),kReal:currentRealKcal(),bpm:bpmDisplay()},history:state.history,segmentSummary:buildSegmentSummary(),logs:state.logs},null,2),'application/json'); addLog('[EXPORT] JSON exportado'); if(els.importOutput) els.importOutput.textContent='JSON exportado'}
function exportSessionCsv(){if(!state.history.length) throw new Error('No hay datos segundo a segundo'); const rows=['seg;clock;level;segment;kcal_plan;kcal_real;bpm']; state.history.forEach(h=>rows.push([h.sec,h.clock,h.level,h.segment,h.kPlan,h.kReal,h.bpm??''].join(';'))); download(`sesion_${APP_VERSION}.csv`,'\ufeff'+rows.join('\r\n'),'text/csv;charset=utf-8'); addLog('[EXPORT] Sesión CSV exportada')}
function exportMinuteCsv(){const rowsData=buildMinuteRows(); if(!rowsData.length) throw new Error('No hay datos minuto a minuto todavía'); const rows=['minute;clock;level;segment;kcal_start;kcal_end;kcal_minute;kcal_per_min;bpm_avg']; rowsData.forEach(r=>rows.push([r.minute,r.clock,r.level,r.segment,r.kcalStart,r.kcalEnd,r.kcalMinute,r.kcalPerMin,r.bpmAvg??''].join(';'))); download(`minuto_${APP_VERSION}.csv`,'\ufeff'+rows.join('\r\n'),'text/csv;charset=utf-8'); addLog('[EXPORT] Minuto a minuto exportado')}
function exportTramoCsv(){const segs=buildSegmentSummary(); if(!segs.length) throw new Error('No hay datos por tramo'); const rows=['segment;level;duration;kcal_plan;kcal_real;deviation;bpm_avg']; segs.forEach(s=>rows.push([s.segment,s.level,s.duration,s.kcalPlan,s.kcalReal,s.deviation,s.bpmAvg??''].join(';'))); download(`tramos_${APP_VERSION}.csv`,'\ufeff'+rows.join('\r\n'),'text/csv;charset=utf-8'); addLog('[EXPORT] CSV por tramos exportado')}
function exportPlan(){const txt=state.plan?normalizeText():els.planInput.value; if(!txt) throw new Error('No hay plan para exportar'); download(`plan_${APP_VERSION}.txt`,txt,'text/plain;charset=utf-8'); addLog('[EXPORT] Plan exportado')}
function compareLast(){const raw=localStorage.getItem('lastCompletedSession'); if(!raw) throw new Error('No hay sesión anterior guardada'); const prev=JSON.parse(raw); els.importOutput.textContent=`COMPARAR CON ÚLTIMA\nAnterior kcal: ${prev.kReal??'--'}\nActual kcal: ${currentRealKcal().toFixed(1)}\nDiff kcal: ${((currentRealKcal()||0)-(prev.kReal||0)).toFixed(1)}`}
async function clearAppData(){localStorage.clear(); sessionStorage.clear(); if('caches' in window){const keys=await caches.keys(); await Promise.all(keys.map(k=>caches.delete(k)))} if('serviceWorker' in navigator){const regs=await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(r=>r.unregister()))} addLog('[CLEAR] Datos locales y caché borrados'); if(els.importOutput) els.importOutput.textContent='Datos locales y caché borrados'; setTimeout(()=>location.reload(),300)}
async function installApp(){if(state.installPrompt) await state.installPrompt.prompt(); else addLog('[PWA] No hay prompt disponible')}
async function registerSW(){if(!('serviceWorker' in navigator)) return; try{state.swReg=await navigator.serviceWorker.register('./sw.js'); addLog('[SW] registrado')}catch(e){addLog('[SW] ERROR: '+(e.message||e))}}
async function updateApp(){if(!state.swReg) throw new Error('No hay service worker'); await state.swReg.update(); addLog('[PWA] Update solicitado'); if(state.swReg.waiting){state.swReg.waiting.postMessage({type:'SKIP_WAITING'}); location.reload()} else location.reload()}
function verifyAll(){const checks=[]; const push=(name,ok,detail='')=>{checks.push({name,ok,detail}); addLog(`[CHECK] ${name}: ${ok?'ok':'fail'}${detail?' · '+detail:''}`)}; push('DOM timeline',!!els.timelineBar); push('DOM ticker',!!els.tickerMsg); push('DOM BLE',!!$('bleConnectBtn')); push('Clipboard',!!navigator.clipboard||!!document.execCommand); push('Notifications','Notification' in window, ('Notification' in window ? Notification.permission : 'n/a')); push('Notify toggle', true, state.voice.browserNotify?'ON':'OFF'); push('Voice select', !!els.voiceSelect, state.voice.selectedURI||'sin seleccionar'); push('Web Bluetooth','bluetooth' in navigator);
  push('SpeechSynthesis', state.voice.supported, `${state.voice.voices?.length||0} voces`); push('Service Worker','serviceWorker' in navigator); push('Parser',typeof parsePlan==='function'); push('Summary',typeof summaryText==='function'); push('Export CSV',typeof exportSessionCsv==='function'); push('Resume saved',typeof resumeSavedSession==='function'); push('Final summary',typeof showFinalSummary==='function'); push('Export JSON',typeof exportJson==='function'); push('Compare last',typeof compareLast==='function'); push('CSV tramos',typeof exportTramoCsv==='function'); push('Copy summary',typeof copyText==='function'); push('Export plan',typeof exportPlan==='function'); push('Clear app data',typeof clearAppData==='function'); push('Build',true,`${APP_VERSION} · ${BUILD}`); els.importOutput.textContent=checks.map(c=>`${c.ok?'OK':'FAIL'} · ${c.name}${c.detail?' · '+c.detail:''}`).join('\n')}
async function bleConnect(){if(!navigator.bluetooth) throw new Error('Web Bluetooth no disponible'); const device=await navigator.bluetooth.requestDevice({filters:[{services:['heart_rate']}],optionalServices:['battery_service','device_information']}); await connectDevice(device)}
async function bleReconnect(){if(state.ble.device) return connectDevice(state.ble.device); if(navigator.bluetooth.getDevices){const devices=await navigator.bluetooth.getDevices(); if(devices[0]) return connectDevice(devices[0])} throw new Error('No hay dispositivo previo')}
async function bleDisconnect(){try{if(state.ble.hrChar&&state._hrHandler) state.ble.hrChar.removeEventListener('characteristicvaluechanged',state._hrHandler)}catch{} try{state.ble.server&&state.ble.server.disconnect()}catch{} state.ble.connected=false; addLog('[BLE] desconectado'); renderAll()}
function bleDiag(){els.importOutput.textContent=`BLE connected: ${state.ble.connected}\nDevice: ${state.ble.deviceName||'--'}\nLast packet: ${state.ble.lastPacketTs?((Date.now()-state.ble.lastPacketTs)/1000).toFixed(1)+'s':'--'}`}
async function tryAutoBLE(){if(!navigator.bluetooth||!navigator.bluetooth.getDevices||state.ble.autoAttempted) return; state.ble.autoAttempted=true; try{const devices=await navigator.bluetooth.getDevices(); if(devices.length){addLog('[BLE] Intento de autoconexión'); await connectDevice(devices[0])}}catch(e){addLog('[BLE] Auto ERROR: '+(e.message||e))}}
async function connectDevice(device){state.ble.device=device; state.ble.deviceName=device.name||'Sin nombre'; device.addEventListener('gattserverdisconnected',()=>{state.ble.connected=false; addLog('[BLE] GATT desconectado'); renderAll()},{once:true}); const server=await device.gatt.connect(); const service=await server.getPrimaryService('heart_rate'); const chr=await service.getCharacteristic('heart_rate_measurement'); state._hrHandler=ev=>handleHeartRate(ev); await chr.startNotifications(); chr.addEventListener('characteristicvaluechanged',state._hrHandler); state.ble.server=server; state.ble.hrChar=chr; state.ble.connected=true; state.ble.lastPacketTs=Date.now(); addLog(`[BLE] conectado a ${state.ble.deviceName}`); renderAll()}
function handleHeartRate(ev){const dv=ev.target.value; let idx=1; const flags=dv.getUint8(0); const is16=flags&0x1; const bpm=is16?dv.getUint16(idx,true):dv.getUint8(idx); state.bpmSamples.push({ts:Date.now(),bpm:Number(bpm)}); if(state.bpmSamples.length>600) state.bpmSamples.shift(); state.ble.lastPacketTs=Date.now(); renderAll()}
function startLoops(){ setInterval(()=>{ if(state.phase==='running') capturePoint(); renderAll(); },200); setInterval(()=>persist(),1000); setInterval(()=>{ if(state.ble.connected && state.ble.lastPacketTs && Date.now()-state.ble.lastPacketTs>10000){ addLog('[BLE] Sin paquetes en 10s'); setChip(els.chipBle,'📶 BLE LENTO','warn'); pushAlert('ble_slow','PULSÓMETRO SIN PAQUETES RECIENTES. REVISAR CONEXIÓN.',{cooldownMs:30000,notifyTitle:'BLE lento',notifyBody:'Sin paquetes recientes',cls:'bad',doNotify:true,beepKind:'info'}); } },3000); }
function init(){
  cacheEls(); bind(); registerSW(); loadPersisted();
  state.voice.browserNotify = ('Notification' in window && Notification.permission==='granted');
  addLog(`[STARTUP] ${APP_VERSION} · ${BUILD}`);
  addLog('[STARTUP] UI enlazada y bucles iniciados');
  if(state.voice.supported){
    if(typeof window.speechSynthesis.onvoiceschanged !== 'undefined'){
      window.speechSynthesis.onvoiceschanged = ()=>refreshVoices();
    }
    setTimeout(refreshVoices, 50);
    setTimeout(refreshVoices, 500);
  } else {
    addLog('[VOICE] SpeechSynthesis no soportado');
  }
  verifyAll(); renderAll(); startLoops(); tryAutoBLE()
}
window.addEventListener('DOMContentLoaded', init);
})();
