const $ = s => document.querySelector(s);
const show = id => { for (const s of document.querySelectorAll('main > section')) s.classList.toggle('hidden', s.id !== id); };
const fmt = s => { s = Math.max(0, Math.ceil(s)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

const ENDPOINT_MS = 2200;      // silence after speech that ends an answer
const NO_SPEECH_MS = 20000;    // long silence with no answer at all
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

let sessionId, viva, stream, recorder, recog, analyser;
let clockOffset = 0;           // local ms timestamp when the server started this viva
let listening = false, busy = false, finished = false;
let buf = '', interim = '', confs = [], speechStart = 0, lastSpeech = 0, listenStart = 0;
let endTimer, pendingLatency = null, submitAt = 0, micSilentSince = 0, mutedReported = false;

async function api(path, body, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
      const j = await r.json();
      if (!r.ok) throw Object.assign(new Error(j.error || 'request failed'), { fatal: true });
      $('#viva-err').textContent = '';
      return j;
    } catch (e) {
      if (e.fatal || i === tries - 1) throw e;
      $('#viva-err').textContent = 'Connection problem, retrying...';
      await new Promise(r => setTimeout(r, 800 * 2 ** i));
    }
  }
}
const event = (type, detail) => sessionId && fetch(`/api/student/sessions/${sessionId}/event`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type, detail }) }).catch(() => {});

// ---- step 1: join details ----
$('#to-rules').onclick = () => {
  if (!$('#code').value.trim() || !$('#sid').value.trim()) { $('#join-err').textContent = 'Enter the viva code and your student ID.'; return; }
  $('#who').textContent = `${$('#sname').value} (${$('#sid').value})`;
  show('s-rules');
};

// ---- step 2: consent + mic ----
async function getMic() {
  if (stream) return stream;
  stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const ctx = new AudioContext();
  analyser = ctx.createAnalyser(); analyser.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const data = new Uint8Array(analyser.fftSize);
  setInterval(() => {
    analyser.getByteTimeDomainData(data);
    let sum = 0; for (const v of data) sum += (v - 128) ** 2;
    const lvl = Math.min(100, Math.sqrt(sum / data.length) * 4);
    for (const el of [$('#mic-level'), $('#level')]) el.style.width = lvl + '%';
    // Mic-muted / dead-mic detection while we expect the student to talk.
    if (listening && lvl < 1) { micSilentSince ||= Date.now(); if (!mutedReported && Date.now() - micSilentSince > 15000) { mutedReported = true; event('mic_muted', {}); } }
    else micSilentSince = 0;
  }, 100);
  return stream;
}
$('#mic-test').onclick = async () => {
  try { await getMic(); $('#mic-msg').textContent = SR ? 'Microphone OK. Speak and watch the bar move.' : 'Microphone OK, but this browser has no speech recognition. Use Chrome or Edge, or type your answers.'; $('#start').disabled = !$('#consent').checked; }
  catch { micFailed = true; $('#mic-msg').textContent = 'No microphone access. Allow it and test again, or start anyway and type your answers (this is logged for faculty).'; $('#start').disabled = !$('#consent').checked; }
};
let micFailed = false;
$('#consent').onchange = () => { $('#start').disabled = !($('#consent').checked && (stream || micFailed)); };

$('#start').onclick = async () => {
  $('#start').disabled = true;
  try {
    const j = await api('/api/student/join', { code: $('#code').value.trim(), studentId: $('#sid').value.trim(), name: $('#sname').value.trim(), language: $('#lang').value, consent: true }, 2);
    sessionId = j.sessionId; viva = j.viva;
    $('#phases').innerHTML = viva.phases.map(p => `<div data-k="${p.key}">${p.label}</div>`).join('');
    show('s-viva');
    if (!SR || !stream) { event(stream ? 'stt_unavailable' : 'mic_muted', { reason: stream ? 'no SpeechRecognition' : 'no microphone access' }); $('#type-box').classList.remove('hidden'); }
    const r = await api(`/api/student/sessions/${sessionId}/start`);
    sync(r); startRecorder(); speak(r.say, r.done);
    setInterval(tick, 250);
  } catch (e) { $('#rules-err').textContent = e.message; $('#start').disabled = false; }
};

// ---- clock ----
function sync(r) { clockOffset = Date.now() - r.elapsed * 1000; viva.interviewSeconds = r.interviewSeconds; setPhase(r.phase); }
function setPhase(k) {
  let past = true;
  for (const d of document.querySelectorAll('#phases div')) { const on = d.dataset.k === k; if (on) past = false; d.classList.toggle('on', on); d.classList.toggle('past', past && !on); }
}
function tick() {
  if (finished) return;
  const el = (Date.now() - clockOffset) / 1000;
  const left = viva.slotSeconds - el;
  $('#timer').textContent = fmt(left);
  $('#timer').classList.toggle('low', left < 120);
  if (listening && speechStart) $('#answer-clock').textContent = `${Math.floor((Date.now() - speechStart) / 1000)}s / ${viva.maxAnswerSeconds}s`;
  if (listening && speechStart && Date.now() - speechStart > viva.maxAnswerSeconds * 1000) submit({ capped: true });
  if (listening && !speechStart && !buf && Date.now() - listenStart > NO_SPEECH_MS) submit({ silence: true });
  if (el > viva.interviewSeconds + 2 && !busy) finish('time_limit');
}

// ---- recording: 5 s chunks appended server-side ----
function startRecorder() {
  if (!stream || !window.MediaRecorder) return;
  const seg = Date.now(), t = Math.max(0, (seg - clockOffset) / 1000).toFixed(1);
  recorder = new MediaRecorder(stream, MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? { mimeType: 'audio/webm;codecs=opus' } : {});
  recorder.ondataavailable = e => {
    if (!e.data.size) return;
    fetch(`/api/student/sessions/${sessionId}/audio?seg=${seg}&t=${t}`, { method: 'POST', body: e.data }).catch(() => {});
  };
  recorder.start(5000);
}

// ---- TTS ----
function voiceFor(lang) {
  const vs = speechSynthesis.getVoices();
  return vs.find(v => v.lang === lang) || vs.find(v => v.lang === 'en-IN') || vs.find(v => v.lang.startsWith('en')) || null;
}
function speak(text, done) {
  stopListening();
  $('#say').textContent = text;
  setStatus('speak', 'Examiner speaking...');
  const u = new SpeechSynthesisUtterance(text);
  const lang = $('#lang').value === 'hi-IN' ? 'en-IN' : $('#lang').value;
  u.lang = lang; const v = voiceFor(lang); if (v) u.voice = v; u.rate = 1.02;
  u.onstart = () => { if (submitAt) { pendingLatency = Date.now() - submitAt; submitAt = 0; } };
  let ended = false;
  const after = () => { if (ended) return; ended = true; done ? finish('completed') : startListening(); };
  u.onend = after; u.onerror = after;
  speechSynthesis.cancel(); speechSynthesis.speak(u);
  // Safety net: some browsers never fire onend.
  setTimeout(after, 2000 + text.split(/\s+/).length * 500);
}

// ---- STT ----
function startListening() {
  if (finished) return;
  buf = ''; interim = ''; confs = []; speechStart = 0; listenStart = Date.now();
  $('#heard').textContent = ''; $('#answer-clock').textContent = '';
  listening = true; $('#done-btn').disabled = false;
  setStatus('listen', 'Listening... answer now');
  if (!SR) return;
  recog = new SR(); recog.lang = $('#lang').value; recog.continuous = true; recog.interimResults = true;
  recog.onresult = e => {
    interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) { buf += r[0].transcript.trim() + ' '; if (r[0].confidence) confs.push(r[0].confidence); }
      else interim += r[0].transcript;
    }
    speechStart ||= Date.now(); lastSpeech = Date.now();
    $('#heard').textContent = buf + interim;
    clearTimeout(endTimer);
    endTimer = setTimeout(() => { if (listening && !interim) submit({}); }, ENDPOINT_MS);
  };
  recog.onend = () => { if (listening) try { recog.start(); } catch {} };   // Chrome stops on pauses; keep going
  recog.onerror = e => { if (e.error === 'not-allowed') $('#viva-err').textContent = 'Speech recognition blocked. Use "Type instead".'; };
  try { recog.start(); } catch {}
}
function stopListening() {
  listening = false; clearTimeout(endTimer); $('#done-btn').disabled = true;
  if (recog) { recog.onend = null; try { recog.stop(); } catch {} recog = null; }
}
function setStatus(kind, text) { $('#dot').className = 'dot ' + kind; $('#status').textContent = text; }

async function submit({ silence = false, capped = false, typed = null }) {
  if (busy || finished) return;
  const text = typed ?? ((buf + interim).trim() || $('#typed').value.trim());
  $('#typed').value = '';
  const spokenMs = speechStart ? (lastSpeech || Date.now()) - speechStart : 0;
  stopListening(); busy = true;
  setStatus('think', 'Thinking...');
  submitAt = Date.now();
  if (silence) event('silence', {});
  try {
    const r = await api(`/api/student/sessions/${sessionId}/turn`, {
      text, spokenMs, silence, capped, turnKey: crypto.randomUUID(),
      sttConfidence: confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null,
      clientLatencyMs: pendingLatency,
    });
    pendingLatency = null; busy = false;
    sync(r); speak(r.say, r.done);
  } catch (e) { busy = false; $('#viva-err').textContent = e.message; startListening(); }
}
$('#done-btn').onclick = () => submit({});
$('#type-btn').onclick = () => $('#type-box').classList.toggle('hidden');
$('#send-typed').onclick = () => { const t = $('#typed').value.trim(); if (!t) return; $('#typed').value = ''; submit({ typed: t }); };
$('#typed').addEventListener('paste', () => event('paste', {}));
$('#typed').addEventListener('input', () => { if (listening) { speechStart ||= Date.now(); lastSpeech = Date.now(); } });

async function finish(reason) {
  if (finished) return;
  finished = true; stopListening(); speechSynthesis.cancel();
  setStatus('', 'Finished');
  try { if (recorder && recorder.state !== 'inactive') { recorder.stop(); await new Promise(r => setTimeout(r, 800)); } } catch {}
  await api(`/api/student/sessions/${sessionId}/end`, { reason }).catch(() => {});
  if (stream) stream.getTracks().forEach(t => t.stop());
  show('s-done');
}

// ---- integrity signals ----
document.addEventListener('visibilitychange', () => event(document.hidden ? 'tab_hidden' : 'tab_visible', {}));
window.addEventListener('offline', () => { $('#viva-err').textContent = 'You are offline. Reconnect to continue; the clock keeps running.'; });
window.addEventListener('online', () => { $('#viva-err').textContent = ''; event('network_restored', {}); });
speechSynthesis.getVoices();
