// Student flow: email sign-in -> viva details -> rules, voice and consent -> interview -> done.
const STEPS = ['s-signin', 's-details', 's-rules', 's-viva'];
function show(id) {
  for (const s of $$('main > section')) s.classList.toggle('hidden', s.id !== id);
  const idx = STEPS.indexOf(id);
  for (const li of $$('#stepper li')) {
    const i = STEPS.indexOf(li.dataset.step);
    li.classList.toggle('on', i === idx); li.classList.toggle('done', idx > -1 && i < idx);
  }
  $('#stepper').classList.toggle('hidden', id === 's-viva' || id === 's-done');
  $('#main').classList.toggle('narrow', id !== 's-viva');
  window.scrollTo(0, 0);
}
const msg = (sel, text, ok = false) => { const el = $(sel); el.textContent = text || ''; el.classList.toggle('ok', ok); };
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };

const ENDPOINT_MS = 2200;      // silence after speech that sends the answer
const NO_ANSWER_MS = 30000;    // no speech or typing at all -> logged as a long silence
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

let token = store.get('viva.token'), email = store.get('viva.email');
let sessionId, viva, stream, recorder, recog;
let clockOffset = 0;
let listening = false, busy = false, finished = false, micOn = true, typed = false, micFailed = false;
let voiceOn = store.get('viva.voiceOn') !== 'off';
let currentText = '', confs = [], speechStart = 0, lastSpeech = 0, listenStart = 0;
let endTimer, pendingLatency = null, submitAt = 0, micSilentSince = 0, mutedReported = false;

async function api(path, body, { tries = 4, method = 'POST' } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(path, { method, headers: { 'content-type': 'application/json', ...(token ? { 'x-student-token': token } : {}) }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 401 && token) { signOut('Your sign-in has expired. Please sign in again.'); throw Object.assign(new Error('Please sign in again'), { fatal: true }); }
      if (!r.ok) throw Object.assign(new Error(j.error || 'Something went wrong'), { fatal: true, status: r.status });
      if (sessionId) msg('#viva-msg', '');
      return j;
    } catch (e) {
      if (e.fatal || i === tries - 1) throw e;
      if (sessionId) msg('#viva-msg', 'Connection problem, retrying...');
      await new Promise(r => setTimeout(r, 800 * 2 ** i));
    }
  }
}
const event = (type, detail) => sessionId && fetch(`/api/student/sessions/${sessionId}/event`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-student-token': token }, body: JSON.stringify({ type, detail }) }).catch(() => {});

// ---------- 1. sign in ----------
function signedIn() {
  $('#who').textContent = email || '';
  $('#sign-out').classList.toggle('hidden', !token);
}
function signOut(reason) {
  token = email = null; store.set('viva.token', null); store.set('viva.email', null);
  signedIn(); show('s-signin'); $('#code-step').classList.add('hidden'); $('#email-step').classList.remove('hidden');
  msg('#signin-msg', reason || '');
}
$('#sign-out').onclick = () => { if (!sessionId || confirm('Sign out? Your viva progress is saved; sign in again to continue.')) { signOut(); location.reload(); } };

let cooldown;
function startCooldown(sec) {
  clearInterval(cooldown);
  const b = $('#resend'); let left = sec;
  const tick = () => { b.disabled = left > 0; b.textContent = left > 0 ? `Resend in ${left}s` : 'Resend code'; left--; if (left < -1) clearInterval(cooldown); };
  tick(); cooldown = setInterval(tick, 1000);
}
async function sendCode() {
  const value = $('#email').value.trim();
  if (!value) return msg('#signin-msg', 'Enter your email address.');
  $('#send-code').disabled = true; msg('#signin-msg', '');
  try {
    const r = await api('/api/auth/request-code', { email: value }, { tries: 2 });
    $('#sent-to').textContent = r.email;
    $('#console-note').classList.toggle('hidden', r.delivery !== 'console');
    $('#email-step').classList.add('hidden'); $('#code-step').classList.remove('hidden');
    $('#otp').value = ''; $('#otp').focus();
    startCooldown(30);
  } catch (e) { msg('#signin-msg', e.message); }
  $('#send-code').disabled = false;
}
$('#send-code').onclick = sendCode;
$('#email').addEventListener('keydown', e => { if (e.key === 'Enter') sendCode(); });
$('#resend').onclick = async () => { $('#email').value = $('#sent-to').textContent; await sendCode(); };
$('#change-email').onclick = () => { $('#code-step').classList.add('hidden'); $('#email-step').classList.remove('hidden'); msg('#signin-msg', ''); };
async function verify() {
  const code = $('#otp').value.replace(/\D/g, '');
  if (code.length !== 6) return msg('#signin-msg', 'Enter the 6-digit code.');
  $('#verify').disabled = true;
  try {
    const r = await api('/api/auth/verify', { email: $('#sent-to').textContent, code }, { tries: 2 });
    token = r.token; email = r.email; store.set('viva.token', token); store.set('viva.email', email);
    signedIn(); msg('#signin-msg', ''); show('s-details'); $('#code').focus();
  } catch (e) { msg('#signin-msg', e.message); }
  $('#verify').disabled = false;
}
$('#verify').onclick = verify;
$('#paste-code').onclick = async () => {
  try {
    const digits = ((await navigator.clipboard.readText()).match(/\d[\d\s-]{4,}\d/) || [''])[0].replace(/\D/g, '');
    if (digits.length !== 6) return msg('#signin-msg', "No 6-digit code found on your clipboard. Copy the code from the email first.");
    $('#otp').value = digits; verify();
  } catch { msg('#signin-msg', 'Your browser blocked reading the clipboard. Click the box and paste with Ctrl+V (or Cmd+V).'); $('#otp').focus(); }
};
$('#otp').removeAttribute('maxlength');   // allow pasting "837 823" or "837-823"
$('#otp').addEventListener('input', () => { $('#otp').value = $('#otp').value.replace(/\D/g, '').slice(0, 6); if ($('#otp').value.length === 6) verify(); });

// ---------- 2. viva details ----------
$('#to-rules').onclick = async () => {
  if (!$('#code').value.trim() || !$('#sid').value.trim()) return msg('#details-msg', 'Enter the viva code and your student ID.');
  try {
    const v = await api(`/api/student/vivas/${encodeURIComponent($('#code').value.trim())}`, null, { method: 'GET', tries: 2 });
    const mins = Math.ceil(v.interviewSeconds / 60);
    $('#viva-info').textContent = `${v.subject}${v.topics.length ? ': ' + v.topics.join(', ') : ''}`;
    $('#rule-length').innerHTML = v.format === 'timed'
      ? `There are <b>${v.questionCount} questions</b>. You get <b>${v.secondsPerQuestion === 60 ? '1 minute' : v.secondsPerQuestion + ' seconds'}</b> to answer each one. Each question's clock starts after it has been read out.`
      : `The viva lasts <b>${mins} minutes</b> in ${v.phases.length} parts: ${v.phases.map(p => esc(p.label.toLowerCase())).join(', ')}. The timer is always on screen.`;
    $('#rule-answer').textContent = v.format === 'timed'
      ? 'If you finish early, press Submit to go to the next question. When the time is up, your answer is sent as it is. It\'s fine to say "I don\'t know".'
      : 'Each answer can be up to about 90 seconds. It\'s fine to say "I don\'t know"; the examiner simply moves on.';
    msg('#details-msg', ''); show('s-rules');
  } catch (e) { msg('#details-msg', e.message); }
};

// ---------- 3. rules, voice, mic, consent ----------
const FEMALE = /(female|samantha|victoria|karen|moira|tessa|fiona|veena|lekha|heera|neerja|kalpana|swara|zira|susan|serena|kate|allison|ava\b|nicky|joanna|salli|kimberly|aditi|raveena|isha|ananya|aria|jenny|libby|sonia|natasha|clara|emma|olivia|flo\b|grandma|sandy|shelley|google us english|google हिन्दी|hindi)/i;
// Clear, natural-sounding voices to pick by default when available.
const PREFERRED = /(veena|neerja|heera|isha|samantha|google uk english female|google us english|zira|aria|jenny|sonia|libby|lekha|kalpana|swara)/i;
const MALE = /(\bmale\b|daniel|alex\b|fred|rishi|ravi|hemant|david|mark\b|george|guy\b|ryan|prabhat|madhur|thomas|aaron|arthur|oliver|reed|rocko|eddy|grandpa)/i;
const isFemale = v => FEMALE.test(v.name) && !/\bmale\b/i.test(v.name.replace(/female/ig, ''));
const NOVELTY = /^(albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|pipe organ|superstar|trinoids|whisper|wobble|zarvox|deranged|hysterical)\b/i;
function rankedVoices() {
  const sel = $('#lang').value;
  // English questions get an English voice (Indian English first); Hindi voices come first only for Hinglish.
  const langScore = v => {
    const l = v.lang.replace('_', '-');
    if (l === sel) return 0;
    if (l.startsWith('hi')) return sel === 'hi-IN' ? 0 : 4;
    if (l === 'en-IN') return 1;
    if (l.startsWith('en')) return 2;
    return 6;
  };
  const genderScore = v => isFemale(v) ? 0 : MALE.test(v.name) ? 2 : 1;
  const all = speechSynthesis.getVoices().filter(v => !NOVELTY.test(v.name));
  const usable = all.filter(v => /^(en|hi)/i.test(v.lang));   // the viva is in English or Hindi
  return (usable.length ? usable : all)
    .sort((a, b) => genderScore(a) - genderScore(b) || langScore(a) - langScore(b)
      || (PREFERRED.test(b.name) - PREFERRED.test(a.name)) || a.name.localeCompare(b.name));
}
function fillVoices() {
  const vs = rankedVoices();
  if (!vs.length) return;
  const saved = store.get('viva.voiceName');
  const female = vs.filter(isFemale), other = vs.filter(v => !isFemale(v));
  const opt = v => `<option value="${esc(v.name)}">${esc(v.name)} (${esc(v.lang)})</option>`;
  $('#voice').innerHTML = (female.length ? `<optgroup label="Female voices">${female.map(opt).join('')}</optgroup>` : '') +
    (other.length ? `<optgroup label="Other voices">${other.map(opt).join('')}</optgroup>` : '');
  $('#voice').value = saved && vs.some(v => v.name === saved) ? saved : vs[0].name;
}
const chosenVoice = () => speechSynthesis.getVoices().find(v => v.name === $('#voice').value) || rankedVoices()[0] || null;
if ('speechSynthesis' in window) { fillVoices(); speechSynthesis.onvoiceschanged = fillVoices; }
$('#lang').onchange = fillVoices;
$('#voice').onchange = () => store.set('viva.voiceName', $('#voice').value);
$('#voice-test').onclick = () => speakOnce("Hello, I'm your examiner today. Take your time, and answer in your own words.");
$('#voice-on').checked = voiceOn;
$('#voice-on').onchange = () => { voiceOn = $('#voice-on').checked; store.set('viva.voiceOn', voiceOn ? 'on' : 'off'); $('#voice-toggle').checked = voiceOn; };

async function getMic() {
  if (stream) return stream;
  stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser(); analyser.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const data = new Uint8Array(analyser.fftSize);
  setInterval(() => {
    analyser.getByteTimeDomainData(data);
    let sum = 0; for (const v of data) sum += (v - 128) ** 2;
    const lvl = Math.min(100, Math.sqrt(sum / data.length) * 4);
    for (const el of [$('#mic-level'), $('#level')]) el.style.width = lvl + '%';
    if (listening && micOn && !typed && lvl < 1) { micSilentSince ||= Date.now(); if (!mutedReported && Date.now() - micSilentSince > 15000) { mutedReported = true; event('mic_muted', {}); } }
    else micSilentSince = 0;
  }, 100);
  return stream;
}
// The mic check is optional: only consent is needed to start.
const canStart = () => { $('#start').disabled = !$('#consent').checked; };
const chip = (sel, cls, text) => { const el = $(sel); el.className = `chip ${cls}`; el.textContent = text; };
let heardSound = false;
$('#mic-test').onclick = async () => {
  $('#mic-test').disabled = true; heardSound = false;
  try { await getMic(); }
  catch {
    micFailed = true; chip('#chk-mic', 'bad', 'Microphone: blocked');
    $('#mic-msg').textContent = 'Your browser did not allow the microphone. You can still start the viva and type your answers.';
    $('#mic-test').disabled = false; return;
  }
  chip('#chk-mic', 'plain', 'Microphone: listening...');
  $('#mic-msg').innerHTML = 'Say: <b>"I am ready for my viva."</b>';
  const level = setInterval(() => { if (parseFloat($('#mic-level').style.width) > 8 && !heardSound) { heardSound = true; chip('#chk-mic', 'ok', 'Microphone: working'); } }, 100);
  let finish = () => {};
  const done = new Promise(r => { finish = r; });
  if (SR) {
    const rec = new SR(); rec.lang = $('#lang').value; rec.interimResults = true; rec.continuous = false;
    chip('#chk-stt', 'plain', 'Speech-to-text: listening...');
    rec.onresult = e => {
      const t = [...e.results].map(r => r[0].transcript).join(' ').trim();
      if (t) $('#mic-msg').innerHTML = `We heard: <b>"${esc(t)}"</b>`;
      if (e.results[e.results.length - 1].isFinal && t) { chip('#chk-stt', 'ok', 'Speech-to-text: working'); finish(); }
    };
    rec.onerror = e => { chip('#chk-stt', 'warn', e.error === 'not-allowed' ? 'Speech-to-text: blocked' : 'Speech-to-text: no speech heard'); finish(); };
    rec.onend = () => finish();
    try { rec.start(); } catch { finish(); }
    setTimeout(() => { try { rec.stop(); } catch {} finish(); }, 8000);
  } else {
    chip('#chk-stt', 'warn', 'Speech-to-text: not in this browser');
    setTimeout(finish, 4000);
  }
  await done; clearInterval(level);
  if (!heardSound) chip('#chk-mic', 'warn', 'Microphone: no sound heard');
  if (!$('#chk-stt').classList.contains('ok')) $('#mic-msg').textContent = SR
    ? "We couldn't hear any words. Check your microphone, or just type your answers."
    : 'This browser can\'t turn speech into text. Use Chrome or Edge to speak, or type your answers.';
  $('#mic-test').disabled = false; $('#mic-test').lastChild.textContent = 'Check again';
};
$('#consent').onchange = canStart;

$('#start').onclick = async () => {
  $('#start').disabled = true;
  try {
    const j = await api('/api/student/join', { code: $('#code').value.trim(), studentId: $('#sid').value.trim(), name: $('#sname').value.trim(), language: $('#lang').value, consent: true }, { tries: 2 });
    sessionId = j.sessionId; viva = j.viva;
    $('#viva-subject').textContent = viva.subject;
    $('#viva-student').textContent = `${$('#sname').value.trim() || email} · ${$('#sid').value.trim()}`;
    const steps = viva.format === 'timed' ? Array.from({ length: viva.questionCount }, (_, i) => ({ key: `q${i + 1}`, label: `Q${i + 1}` })) : viva.phases;
    $('#phases').innerHTML = steps.map(p => `<div data-k="${p.key}"><div class="bar"></div><div class="lbl">${esc(p.label)}</div></div>`).join('');
    if (viva.format === 'timed') { $('#timer-label').textContent = 'Time for this answer'; $('#answer-clock').classList.add('hidden'); }
    $('#voice-toggle').checked = voiceOn;
    if (!stream && !micFailed) { try { await getMic(); } catch { micFailed = true; } }   // the mic check was optional
    show('s-viva');
    if (!SR || !stream) { typeOnly(); event(stream ? 'stt_unavailable' : 'mic_muted', { reason: stream ? 'no speech recognition in this browser' : 'no microphone access' }); }
    const r = await api(`/api/student/sessions/${sessionId}/start`);
    sync(r); startRecorder(); present(r.say, r.done);
    setInterval(tick, 250);
  } catch (e) { msg('#rules-msg', e.message); $('#start').disabled = false; }
};

// ---------- 4. interview ----------
// No microphone or no speech recognition: answers are typed.
function typeOnly() {
  micOn = false; $('#mic').classList.add('hidden'); $('#level-meter').classList.add('hidden');
  $('#answer-help').textContent = 'Type your answer, then press Submit (or Ctrl + Enter).';
}
function sync(r) {
  clockOffset = Date.now() - r.elapsed * 1000; viva.interviewSeconds = r.interviewSeconds;
  if (viva.format === 'timed') { setPhase(`q${r.questionNumber}`); $('#q-of').textContent = `Question ${r.questionNumber} of ${r.questionCount}`; }
  else setPhase(r.phase);
}
function setPhase(k) {
  let past = true;
  for (const d of $$('#phases > div')) { const on = d.dataset.k === k; if (on) past = false; d.classList.toggle('on', on); d.classList.toggle('past', past && !on); }
}
function tick() {
  if (finished) return;
  const el = (Date.now() - clockOffset) / 1000;
  if (viva.format === 'timed') {
    // Each question has its own clock, started once the question has been read out.
    const left = listening ? viva.secondsPerQuestion - (Date.now() - listenStart) / 1000 : viva.secondsPerQuestion;
    $('#timer').textContent = fmt(left);
    $('#timer').classList.toggle('low', listening && left <= 10);
    if (listening && left <= 0) submit({ capped: !!$('#answer').value.trim(), silence: !$('#answer').value.trim() });
    if (el > viva.slotSeconds + 5 && !busy) finish('time_limit');
    return;
  }
  const left = viva.slotSeconds - el;
  $('#timer').textContent = fmt(left);
  $('#timer').classList.toggle('low', left < 120);
  if (listening && speechStart) $('#answer-clock').textContent = `${Math.floor((Date.now() - speechStart) / 1000)}s of ${viva.maxAnswerSeconds}s`;
  if (listening && speechStart && Date.now() - speechStart > viva.maxAnswerSeconds * 1000) submit({ capped: true });
  if (listening && !speechStart && !$('#answer').value.trim() && Date.now() - listenStart > NO_ANSWER_MS) submit({ silence: true });
  if (el > viva.interviewSeconds + 2 && !busy) finish('time_limit');
}

// Recording: 5 s chunks appended on the server, so a crash loses at most one chunk.
function startRecorder() {
  if (!stream || !window.MediaRecorder) return;
  const seg = Date.now(), t = Math.max(0, (seg - clockOffset) / 1000).toFixed(1);
  recorder = new MediaRecorder(stream, MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? { mimeType: 'audio/webm;codecs=opus' } : {});
  recorder.ondataavailable = e => {
    if (!e.data.size) return;
    fetch(`/api/student/sessions/${sessionId}/audio?seg=${seg}&t=${t}`, { method: 'POST', headers: { 'x-student-token': token }, body: e.data }).catch(() => {});
  };
  recorder.start(5000);
}

function setStatus(kind, text) {
  $('#dot').className = 'dot ' + kind; $('#status').textContent = text;
  $('#avatar').classList.toggle('speaking', kind === 'speak');
}
function utterance(text) {
  const u = new SpeechSynthesisUtterance(text);
  const v = chosenVoice();
  if (v) { u.voice = v; u.lang = v.lang; }
  u.rate = 1; u.pitch = v && isFemale(v) ? 1 : 1.15;   // nudge pitch up if no female voice exists
  return u;
}
function speakOnce(text) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel(); speechSynthesis.speak(utterance(text));
}

// Show the examiner's line; read it aloud unless the student chose read-only.
function present(text, done) {
  stopListening();
  currentText = text;
  $('#say').textContent = text;
  $('#answer').value = ''; $('#heard').textContent = ''; $('#answer-clock').textContent = '';
  const after = () => { done ? finish('completed') : startListening(); };
  if (!voiceOn || !('speechSynthesis' in window)) {
    if (submitAt) { pendingLatency = Date.now() - submitAt; submitAt = 0; }
    setTimeout(after, done ? 2500 : 0);
    return;
  }
  setStatus('speak', 'Speaking...');
  $('#stop-voice').disabled = false;
  const u = utterance(text);
  let ended = false;
  const end = () => { if (ended) return; ended = true; $('#stop-voice').disabled = true; after(); };
  u.onstart = () => { if (submitAt) { pendingLatency = Date.now() - submitAt; submitAt = 0; } };
  u.onend = end; u.onerror = end;
  speechSynthesis.cancel(); speechSynthesis.speak(u);
  setTimeout(end, 2000 + text.split(/\s+/).length * 500);   // some browsers never fire onend
}
$('#stop-voice').onclick = () => speechSynthesis.cancel();
$('#replay').onclick = () => { if (!currentText) return; speakOnce(currentText); };
$('#voice-toggle').onchange = () => {
  voiceOn = $('#voice-toggle').checked; store.set('viva.voiceOn', voiceOn ? 'on' : 'off'); $('#voice-on').checked = voiceOn;
  if (!voiceOn) speechSynthesis.cancel();
};
$('#stop-voice').disabled = true;

function startListening() {
  if (finished) return;
  confs = []; speechStart = 0; listenStart = Date.now(); typed = false;
  listening = true; $('#submit').disabled = false;
  setStatus('listen', micOn ? 'Listening, answer now' : 'Your turn: type your answer');
  startRecognition();
}
function startRecognition() {
  if (!SR || !micOn || !listening || recog) return;
  recog = new SR(); recog.lang = $('#lang').value; recog.continuous = true; recog.interimResults = true;
  recog.onresult = e => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) {
        const box = $('#answer');
        box.value = (box.value.trim() + ' ' + r[0].transcript.trim()).trim();
        if (r[0].confidence) confs.push(r[0].confidence);
      } else interim += r[0].transcript;
    }
    $('#heard').textContent = interim ? `Hearing: ${interim}` : '';
    speechStart ||= Date.now(); lastSpeech = Date.now();
    clearTimeout(endTimer);
    if (!typed) endTimer = setTimeout(() => { if (listening && !$('#heard').textContent) submit({}); }, viva?.format === 'timed' ? 4000 : ENDPOINT_MS);
  };
  recog.onend = () => { recog = null; if (listening && micOn) startRecognition(); };   // Chrome stops on pauses
  recog.onerror = e => { if (e.error === 'not-allowed') { typeOnly(); msg('#viva-msg', 'Speech recognition is blocked in this browser. Please type your answers.'); } };
  try { recog.start(); } catch { recog = null; }
}
function stopRecognition() { if (recog) { recog.onend = null; try { recog.stop(); } catch {} recog = null; } }
function stopListening() { listening = false; clearTimeout(endTimer); $('#submit').disabled = true; stopRecognition(); }

$('#mic').onclick = () => {
  micOn = !micOn;
  $('#mic').classList.toggle('on', micOn); $('#mic-label').textContent = micOn ? 'Mic on' : 'Mic off';
  if (micOn) startRecognition(); else { stopRecognition(); $('#heard').textContent = ''; }
  if (listening) setStatus('listen', micOn ? 'Listening, answer now' : 'Your turn: type your answer');
};
$('#mic').classList.add('on');
$('#answer').addEventListener('input', e => {
  if (!listening) return;
  typed = true; clearTimeout(endTimer);   // typing turns off auto-send; press Submit
  speechStart ||= Date.now(); lastSpeech = Date.now();
});
$('#answer').addEventListener('paste', () => event('paste', {}));
$('#answer').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit({}); });
$('#submit').onclick = () => submit({});

async function submit({ silence = false, capped = false }) {
  if (busy || finished || !listening) return;
  const text = $('#answer').value.trim();
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
    sync(r); present(r.say, r.done);
  } catch (e) { busy = false; msg('#viva-msg', e.message); startListening(); $('#answer').value = text; }
}

async function finish(reason) {
  if (finished) return;
  finished = true; stopListening(); if ('speechSynthesis' in window) speechSynthesis.cancel();
  setStatus('', 'Finished');
  try { if (recorder && recorder.state !== 'inactive') { recorder.stop(); await new Promise(r => setTimeout(r, 800)); } } catch {}
  await api(`/api/student/sessions/${sessionId}/end`, { reason }).catch(() => {});
  if (stream) stream.getTracks().forEach(t => t.stop());
  show('s-done');
}

// Integrity signals
document.addEventListener('visibilitychange', () => event(document.hidden ? 'tab_hidden' : 'tab_visible', {}));
window.addEventListener('offline', () => msg('#viva-msg', 'You are offline. Reconnect to continue; the clock keeps running.'));
window.addEventListener('online', () => { msg('#viva-msg', ''); event('network_restored', {}); });

// Start: resume a saved sign-in if it's still valid.
(async () => {
  signedIn();
  if (!token) return show('s-signin');
  try { const me = await api('/api/auth/me', null, { method: 'GET', tries: 2 }); email = me.email; signedIn(); show('s-details'); }
  catch { signOut(); }
})();
