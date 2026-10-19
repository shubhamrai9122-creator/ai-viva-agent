let key = sessionStorage.getItem('fkey') || '';
let currentViva = null, currentCode = '';
const msg = (sel, text, ok = false) => { const el = $(sel); el.textContent = text || ''; el.classList.toggle('ok', ok); };

async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { 'content-type': 'application/json', 'x-faculty-key': key, ...(opts.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { lock(); throw new Error('Passcode required'); }
  if (!r.ok) throw new Error(j.error || 'Request failed');
  return j;
}
function lock() { sessionStorage.removeItem('fkey'); key = ''; $('#app').classList.add('hidden'); $('#logout').classList.add('hidden'); $('#gate').classList.remove('hidden'); $('#pass').focus(); }
$('#logout').onclick = lock;
async function unlock() {
  key = $('#pass').value;
  try { await api('/api/faculty/vivas'); sessionStorage.setItem('fkey', key); boot(); } catch { msg('#gate-msg', 'That passcode is not right.'); }
}
$('#unlock').onclick = unlock;
$('#pass').addEventListener('keydown', e => { if (e.key === 'Enter') unlock(); });
for (const b of $$('.tabs button')) b.onclick = () => {
  for (const x of $$('.tabs button')) x.classList.toggle('on', x === b);
  for (const p of $$('[data-p]')) p.classList.toggle('hidden', p.dataset.p !== b.dataset.t);
  if (b.dataset.t === 'calib') loadCalib();
  if (b.dataset.t === 'vivas') loadVivas();
};

let phaseDefaults = [];
async function boot() {
  $('#gate').classList.add('hidden'); $('#app').classList.remove('hidden'); $('#logout').classList.remove('hidden');
  fetch('/api/health').then(r => r.json()).then(h => $('#mode').classList.toggle('hidden', h.mode !== 'mock'));
  const d = await api('/api/faculty/defaults');
  phaseDefaults = d.phases;
  $('#v-phases').innerHTML = d.phases.map(p => `<div style="flex:1 1 110px"><label style="margin-top:0" class="small">${esc(p.label)}</label><input type="number" min="0" step="10" data-k="${p.key}" value="${p.seconds}"></div>`).join('');
  for (const i of $$('#v-phases input')) i.oninput = phaseTotal;
  phaseTotal();
  $('#export').href = `/api/faculty/export.csv?key=${encodeURIComponent(key)}`;
  loadResults(); setInterval(loadResults, 10000);
}
function phaseTotal() {
  const total = $$('#v-phases input').reduce((a, i) => a + (Number(i.value) || 0), 0);
  $('#v-total').innerHTML = `Interview length: <b>${fmt(total)}</b> of 14:30${total > 870 ? ' <span class="chip bad">too long</span>' : ''}`;
}

// ---------- results ----------
let rows = [];
async function loadResults() { rows = await api('/api/faculty/sessions'); renderResults(); }
function statusChip(r) {
  if (r.status === 'active' || r.status === 'joined') return '<span class="chip">In progress</span>';
  if (r.score_status === 'done') return '<span class="chip ok">Marked</span>';
  if (r.score_status === 'failed') return '<span class="chip bad">Marking failed</span>';
  return '<span class="chip plain">Marking...</span>';
}
function renderResults() {
  const done = rows.filter(r => r.final_total != null);
  const avg = done.length ? (done.reduce((a, r) => a + r.final_total, 0) / done.length).toFixed(1) : '-';
  $('#stats').innerHTML = `
    <div class="stat"><div class="k">Vivas taken</div><div class="v">${rows.length}</div></div>
    <div class="stat"><div class="k">Needs review</div><div class="v">${rows.filter(r => r.needs_review).length}</div></div>
    <div class="stat"><div class="k">Average final mark</div><div class="v">${avg}</div></div>
    <div class="stat"><div class="k">In progress</div><div class="v">${rows.filter(r => r.status === 'active').length}</div></div>`;
  const q = $('#search').value.toLowerCase();
  const list = rows.filter(r => (!$('#only-review').checked || r.needs_review) && (!q || `${r.student_id} ${r.student_name} ${r.student_email}`.toLowerCase().includes(q)));
  $('#results').innerHTML = list.length ? `<table><thead><tr><th>Student</th><th>Viva</th><th>Status</th><th>AI mark</th><th>Final mark</th><th>Flags</th><th></th></tr></thead><tbody>${list.map(r => `
    <tr><td><b>${esc(r.student_name || r.student_id)}</b><div class="small muted">${esc(r.student_id)}${r.student_email ? ' · ' + esc(r.student_email) : ''}</div></td>
    <td>${esc(r.code)}<div class="small muted">${esc(r.subject)}</div></td>
    <td>${statusChip(r)}</td><td>${r.ai_total ?? '-'}</td><td><b>${r.final_total ?? '-'}</b></td>
    <td>${r.needs_review ? '<span class="chip warn">Needs review</span>' : ''}${r.overridden ? '<span class="chip ok">Overridden</span>' : ''}</td>
    <td><a class="btn secondary" href="/review.html?id=${r.id}">Review</a></td></tr>`).join('')}</tbody></table>`
    : `<p class="muted">${rows.length ? 'No vivas match.' : 'No vivas taken yet. Create a viva and share its code with students.'}</p>`;
}
$('#only-review').onchange = renderResults; $('#search').oninput = renderResults;

// ---------- files ----------
const isBank = f => /\.(csv|json)$/i.test(f.name) || /csv|json/.test(f.type);
const readText = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(f); });
function setupDrop(dropSel, inputSel, onFile) {
  const drop = $(dropSel), input = $(inputSel);
  for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); });
  for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); });
  drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) { const dt = new DataTransfer(); dt.items.add(f); input.files = dt.files; onFile(f); } });
  input.addEventListener('change', () => input.files[0] && onFile(input.files[0]));
}
async function importFile(vivaId, f) {
  if (f.size > 15 * 1024 * 1024) throw new Error('That file is larger than 15 MB.');
  if (isBank(f)) {
    const r = await api(`/api/faculty/vivas/${vivaId}/questions`, { method: 'POST', body: JSON.stringify({ bankText: await readText(f), bankFormat: /json/i.test(f.name) ? 'json' : 'csv' }) });
    return `${r.added} questions added from ${f.name}.`;
  }
  const r = await api(`/api/faculty/vivas/${vivaId}/import`, { method: 'POST', headers: { 'content-type': f.type || 'application/octet-stream' }, body: f });
  const how = { 'pdf-text': 'read from the PDF', ocr: 'read from the image', syllabus: 'drafted from the syllabus' }[r.method] || 'read by Claude';
  return `${r.added} draft questions ${how}. Check them below and approve the ones you want.`;
}
setupDrop('#v-drop', '#v-file', f => { $('#v-file-name').textContent = f.name; });
setupDrop('#q-drop', '#q-file', async f => {
  msg('#q-msg', `Reading ${f.name}...`, true);
  try { msg('#q-msg', await importFile(currentViva, f), true); openQuestions(currentViva, currentCode); loadVivas(); }
  catch (e) { msg('#q-msg', e.message); }
  $('#q-file').value = '';
});

// ---------- vivas ----------
async function loadVivas() {
  const vs = await api('/api/faculty/vivas');
  $('#vivas').innerHTML = vs.length ? `<table><thead><tr><th>Code</th><th>Subject</th><th>Questions</th><th></th></tr></thead><tbody>${vs.map(v => `
    <tr><td><b>${esc(v.code)}</b><div class="small muted">${v.sessions} taken</div></td><td>${esc(v.subject)}<div class="small muted">${esc(v.topics.join(', '))}</div></td>
    <td>${v.approved_questions} approved${v.pending_questions ? `<div><span class="chip warn">${v.pending_questions} drafts</span></div>` : ''}${v.approved_questions < 20 ? '<div><span class="chip plain" title="With fewer than 20 approved questions, a student who skips many can run out before the time is up. The examiner then asks logged follow-on questions and second chances.">Aim for 20+</span></div>' : ''}</td>
    <td><button class="secondary" data-q="${v.id}" data-name="${esc(v.code)}">Questions</button></td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">No vivas yet. Create one on the left.</p>';
  for (const b of $$('[data-q]')) b.onclick = () => openQuestions(b.dataset.q, b.dataset.name);
}
$('#v-create').onclick = async () => {
  msg('#v-msg', '');
  const f = $('#v-file').files[0];
  try {
    const body = {
      subject: $('#v-subject').value.trim(), code: $('#v-code').value.trim() || undefined, difficulty: $('#v-diff').value,
      topics: $('#v-topics').value.split(',').map(s => s.trim()).filter(Boolean),
      phases: $$('#v-phases input').map(i => ({ key: i.dataset.k, seconds: Number(i.value) })),
    };
    if (!body.subject) return msg('#v-msg', 'Enter a subject.');
    const r = await api('/api/faculty/vivas', { method: 'POST', body: JSON.stringify(body) });
    let note = `Created ${r.code}.`;
    if (f) { msg('#v-msg', `Created ${r.code}. Reading ${f.name}...`, true); note += ' ' + await importFile(r.id, f); }
    msg('#v-msg', note, true);
    $('#v-file').value = ''; $('#v-file-name').textContent = '';
    await loadVivas(); openQuestions(r.id, r.code);
  } catch (e) { msg('#v-msg', e.message); }
};

async function openQuestions(id, code) {
  currentViva = id; currentCode = code;
  $('#qpanel').classList.remove('hidden'); $('#q-title').textContent = `Questions for ${code}`;
  const qs = (await api(`/api/faculty/vivas/${id}/questions`)).sort((a, b) => a.approved - b.approved);   // drafts first
  const drafts = qs.filter(q => !q.approved).length;
  $('#q-counts').textContent = `${qs.length - drafts} approved · ${drafts} drafts`;
  const src = s => ({ upload: 'uploaded', sample: 'sample', 'ai-generated': 'AI draft', 'pdf-import': 'from PDF', 'image-import': 'from image' }[s] || s);
  $('#qlist').innerHTML = qs.length ? `<table><thead><tr><th></th><th>Question</th><th>Topic</th><th>Type</th><th>Source</th><th>Status</th></tr></thead><tbody>${qs.map(q => `
    <tr><td>${q.approved ? '' : `<input type="checkbox" data-id="${q.id}" checked aria-label="Select draft">`}</td>
    <td>${esc(q.text)}${q.expected ? `<div class="small muted">${esc(q.expected)}</div>` : ''}</td>
    <td><span class="chip plain">${esc(q.topic)}</span></td><td>${esc(q.kind)}</td><td class="small">${esc(src(q.source))}</td>
    <td>${q.approved ? '<span class="chip ok">Approved</span>' : '<span class="chip warn">Draft</span>'}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">No questions yet. Upload a file or draft some from a syllabus.</p>';
  $('#qpanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
$('#q-close').onclick = () => $('#qpanel').classList.add('hidden');
$('#q-gen').onclick = async () => {
  msg('#q-msg', 'Drafting questions...', true);
  try { const r = await api(`/api/faculty/vivas/${currentViva}/generate`, { method: 'POST', body: JSON.stringify({ syllabus: $('#q-syllabus').value }) }); msg('#q-msg', `${r.added} draft questions added. Check them below and approve the ones you want.`, true); openQuestions(currentViva, currentCode); loadVivas(); }
  catch (e) { msg('#q-msg', e.message); }
};
$('#q-select').onclick = () => { for (const c of $$('#qlist input[data-id]')) c.checked = true; };
$('#q-approve').onclick = async () => {
  const ids = $$('#qlist input[data-id]:checked').map(i => i.dataset.id);
  if (!ids.length) return msg('#q-msg', 'Select at least one draft question.');
  await api('/api/faculty/questions/approve', { method: 'POST', body: JSON.stringify({ ids }) });
  msg('#q-msg', `${ids.length} question${ids.length === 1 ? '' : 's'} approved.`, true);
  openQuestions(currentViva, currentCode); loadVivas();
};

// ---------- calibration ----------
async function loadCalib() {
  const c = await api('/api/faculty/calibration');
  $('#calib').innerHTML = !c.n ? '<p class="muted" style="margin-top:12px">No overrides yet.</p>' : `
    <div class="stats" style="margin-top:14px"><div class="stat"><div class="k">Vivas compared</div><div class="v">${c.n}</div></div>
    <div class="stat"><div class="k">Average gap</div><div class="v">${c.meanAbsGap}</div></div>
    <div class="stat"><div class="k">AI minus faculty</div><div class="v">${c.meanSignedGap}</div></div>
    <div class="stat"><div class="k">Correlation (r)</div><div class="v">${c.pearson ?? '-'}</div></div></div>
    <div class="table-wrap"><table><thead><tr><th>AI mark</th><th>Faculty mark</th><th>Gap</th></tr></thead><tbody>${c.rows.map(r => `<tr><td>${r.ai}</td><td>${r.faculty}</td><td>${(r.ai - r.faculty).toFixed(1)}</td></tr>`).join('')}</tbody></table></div>`;
}

if (key) api('/api/faculty/vivas').then(boot).catch(lock); else lock();
