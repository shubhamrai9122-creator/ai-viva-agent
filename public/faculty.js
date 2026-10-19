const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let key = sessionStorage.getItem('fkey') || '';
let currentViva = null;
const msg = (sel, text, ok = false) => { const el = $(sel); el.textContent = text; el.classList.toggle('ok', ok); };

async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { 'content-type': 'application/json', 'x-faculty-key': key, ...(opts.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { lock(); throw new Error('Passcode required'); }
  if (!r.ok) throw new Error(j.error || 'Request failed');
  return j;
}
function lock() { sessionStorage.removeItem('fkey'); key = ''; $('#app').classList.add('hidden'); $('#gate').classList.remove('hidden'); }
$('#logout').onclick = e => { e.preventDefault(); lock(); };
$('#unlock').onclick = async () => {
  key = $('#pass').value;
  try { await api('/api/faculty/vivas'); sessionStorage.setItem('fkey', key); boot(); } catch { $('#gate-err').textContent = 'Wrong passcode'; }
};
for (const b of document.querySelectorAll('.tabs button')) b.onclick = () => {
  for (const x of document.querySelectorAll('.tabs button')) x.classList.toggle('on', x === b);
  for (const p of document.querySelectorAll('[data-p]')) p.classList.toggle('hidden', p.dataset.p !== b.dataset.t);
  if (b.dataset.t === 'calib') loadCalib();
  if (b.dataset.t === 'vivas') loadVivas();
};

async function boot() {
  $('#gate').classList.add('hidden'); $('#app').classList.remove('hidden');
  fetch('/api/health').then(r => r.json()).then(h => $('#mode').textContent = h.mode === 'mock' ? 'MOCK mode' : `LLM: ${h.interviewerModel} / ${h.scorerModel}`);
  const d = await api('/api/faculty/defaults');
  $('#v-phases').innerHTML = d.phases.map(p => `<div><label>${p.label}</label><input type="number" min="0" data-k="${p.key}" value="${p.seconds}"></div>`).join('');
  $('#export').href = `/api/faculty/export.csv?key=${encodeURIComponent(key)}`;
  loadResults(); setInterval(loadResults, 10000);
}

// ---- results ----
let rows = [];
async function loadResults() { rows = await api('/api/faculty/sessions'); renderResults(); }
function renderResults() {
  const q = $('#search').value.toLowerCase();
  const list = rows.filter(r => (!$('#only-review').checked || r.needs_review) && (!q || `${r.student_id} ${r.student_name}`.toLowerCase().includes(q)));
  $('#results').innerHTML = list.length ? `<table><tr><th>Student</th><th>Viva</th><th>Status</th><th>AI mark</th><th>Final mark</th><th>Flags</th><th></th></tr>${list.map(r => `
    <tr><td><b>${esc(r.student_id)}</b><div class="small muted">${esc(r.student_name)}</div></td><td>${esc(r.code)}<div class="small muted">${esc(r.subject)}</div></td>
    <td>${esc(r.status)}<div class="small muted">scoring: ${esc(r.score_status)}</div></td>
    <td>${r.ai_total ?? '-'}</td><td><b>${r.final_total ?? '-'}</b></td>
    <td>${r.needs_review ? '<span class="chip warn">needs review</span>' : ''}${r.overridden ? '<span class="chip ok">overridden</span>' : ''}</td>
    <td><a href="/review.html?id=${r.id}">Review</a></td></tr>`).join('')}</table>` : '<p class="muted">No vivas yet.</p>';
}
$('#only-review').onchange = renderResults; $('#search').oninput = renderResults;

// ---- vivas ----
async function loadVivas() {
  const vs = await api('/api/faculty/vivas');
  $('#vivas').innerHTML = vs.length ? `<table><tr><th>Code</th><th>Subject</th><th>Topics</th><th>Questions</th><th>Sessions</th><th></th></tr>${vs.map(v => `
    <tr><td><b>${esc(v.code)}</b></td><td>${esc(v.subject)}<div class="small muted">${esc(v.difficulty)}</div></td><td class="small">${esc(v.topics.join(', '))}</td>
    <td>${v.approved_questions} approved${v.pending_questions ? `<div class="chip warn">${v.pending_questions} pending</div>` : ''}${v.approved_questions < 20 ? '<div class="chip warn" title="With fewer than 20 approved questions, a student who skips many questions can run out before the time is up. The examiner then uses logged follow-on questions and second chances.">small bank: aim for 20+</div>' : ''}</td><td>${v.sessions}</td>
    <td><button class="ghost" data-q="${v.id}" data-name="${esc(v.code)}">Questions</button></td></tr>`).join('')}</table>` : '<p class="muted">No vivas yet.</p>';
  for (const b of document.querySelectorAll('[data-q]')) b.onclick = () => openQuestions(b.dataset.q, b.dataset.name);
}
const readFile = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(f); });
$('#v-create').onclick = async () => {
  msg('#v-err', '');
  try {
    const f = $('#v-file').files[0];
    const body = {
      subject: $('#v-subject').value.trim(), code: $('#v-code').value.trim() || undefined, difficulty: $('#v-diff').value,
      topics: $('#v-topics').value.split(',').map(s => s.trim()).filter(Boolean),
      phases: [...document.querySelectorAll('#v-phases input')].map(i => ({ key: i.dataset.k, seconds: Number(i.value) })),
      bankText: f ? await readFile(f) : undefined, bankFormat: f ? (f.name.endsWith('.json') ? 'json' : 'csv') : undefined,
    };
    const r = await api('/api/faculty/vivas', { method: 'POST', body: JSON.stringify(body) });
    msg('#v-err', `Created ${r.code} with ${r.added} questions.`, true);
    await loadVivas(); openQuestions(r.id, r.code);
  } catch (e) { msg('#v-err', e.message); }
};
async function openQuestions(id, code) {
  currentViva = id; $('#qpanel').classList.remove('hidden'); $('#q-title').textContent = `Question bank: ${code}`;
  const qs = await api(`/api/faculty/vivas/${id}/questions`);
  $('#qlist').innerHTML = `<table><tr><th></th><th>Question</th><th>Topic</th><th>Kind</th><th>Source</th><th>Status</th></tr>${qs.map(q => `
    <tr><td>${q.approved ? '' : `<input type="checkbox" data-id="${q.id}" style="width:auto" checked>`}</td><td>${esc(q.text)}<div class="small muted">${esc(q.expected)}</div></td>
    <td>${esc(q.topic)}</td><td>${esc(q.kind)}</td><td class="small">${esc(q.source)}</td><td>${q.approved ? '<span class="chip ok">approved</span>' : '<span class="chip warn">pending</span>'}</td></tr>`).join('')}</table>`;
  $('#qpanel').scrollIntoView({ behavior: 'smooth' });
}
$('#q-gen').onclick = async () => {
  msg('#q-err', 'Generating...', true);
  try { const r = await api(`/api/faculty/vivas/${currentViva}/generate`, { method: 'POST', body: JSON.stringify({ syllabus: $('#q-syllabus').value }) }); msg('#q-err', `${r.added} draft questions added. Review and approve them below.`, true); openQuestions(currentViva, $('#q-title').textContent.split(': ')[1]); loadVivas(); }
  catch (e) { msg('#q-err', e.message); }
};
$('#q-file').onchange = async () => {
  const f = $('#q-file').files[0]; if (!f) return;
  try { const r = await api(`/api/faculty/vivas/${currentViva}/questions`, { method: 'POST', body: JSON.stringify({ bankText: await readFile(f), bankFormat: f.name.endsWith('.json') ? 'json' : 'csv' }) }); msg('#q-err', `${r.added} questions added.`, true); openQuestions(currentViva, $('#q-title').textContent.split(': ')[1]); loadVivas(); }
  catch (e) { msg('#q-err', e.message); }
};
$('#q-approve').onclick = async () => {
  const ids = [...document.querySelectorAll('#qlist input[data-id]:checked')].map(i => i.dataset.id);
  if (!ids.length) return;
  await api('/api/faculty/questions/approve', { method: 'POST', body: JSON.stringify({ ids }) });
  openQuestions(currentViva, $('#q-title').textContent.split(': ')[1]); loadVivas();
};

// ---- calibration ----
async function loadCalib() {
  const c = await api('/api/faculty/calibration');
  $('#calib').innerHTML = !c.n ? '<p class="muted">No overrides yet.</p>' : `
    <div class="row"><div><div class="small muted">Vivas compared</div><div class="big">${c.n}</div></div>
    <div><div class="small muted">Mean absolute gap</div><div class="big">${c.meanAbsGap}</div></div>
    <div><div class="small muted">Mean AI minus faculty</div><div class="big">${c.meanSignedGap}</div></div>
    <div><div class="small muted">Pearson r</div><div class="big">${c.pearson ?? '-'}</div></div></div>
    <table style="margin-top:12px"><tr><th>AI</th><th>Faculty</th><th>Gap</th></tr>${c.rows.map(r => `<tr><td>${r.ai}</td><td>${r.faculty}</td><td>${(r.ai - r.faculty).toFixed(1)}</td></tr>`).join('')}</table>`;
}

if (key) api('/api/faculty/vivas').then(boot).catch(lock); else lock();
