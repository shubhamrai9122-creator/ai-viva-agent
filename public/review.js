const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = t => { const s = Math.max(0, Math.round(t || 0)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const id = new URLSearchParams(location.search).get('id');
const key = sessionStorage.getItem('fkey') || '';
if (!key) location.href = '/faculty.html';
const api = async (p, o = {}) => { const r = await fetch(p, { ...o, headers: { 'content-type': 'application/json', 'x-faculty-key': key } }); const j = await r.json(); if (!r.ok) throw new Error(j.error); return j; };
let data, players = [];

function seek(t) {
  // Pick the recording segment that covers time t (segments restart after a rejoin).
  const seg = [...players].reverse().find(p => p.startT <= t) || players[0];
  if (!seg) return;
  for (const p of players) if (p !== seg) p.el.pause();
  seg.el.currentTime = Math.max(0, t - seg.startT - 1); seg.el.play();
}
function highlight(line) {
  for (const el of document.querySelectorAll('.tline')) el.classList.toggle('hl', el.dataset.line === line);
  const el = document.querySelector(`.tline[data-line="${line}"]`);
  if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); seek(Number(el.dataset.t)); }
}
const chips = ev => (ev || []).map(e => { const l = typeof e === 'string' ? e : e.line; return `<span class="chip link" data-ev="${l}">${l}</span>`; }).join('');

async function load() {
  data = await api(`/api/faculty/sessions/${id}`);
  const s = data.session, sc = s.score;
  $('#title').textContent = `${s.student_id} ${s.student_name ? '- ' + s.student_name : ''}`;
  $('#sub').textContent = `${data.viva.code} - ${data.viva.subject} - ${s.status}, scoring ${s.score_status}${s.started_at ? ' - ' + new Date(s.started_at).toLocaleString() : ''}`;
  $('#final').textContent = s.final_total ?? '-';
  $('#ai').textContent = s.ai_total != null ? `AI mark ${s.ai_total}${s.override ? ` - overridden by ${s.override.reviewer}` : ''}` : '';
  $('#reasons').innerHTML = (s.needs_review ? '<span class="chip warn">Mandatory review</span>' : '') + (s.review_reasons || []).map(r => `<span class="chip warn">${esc(r)}</span>`).join('') +
    (s.override ? `<div class="small" style="margin-top:6px">Override by <b>${esc(s.override.reviewer)}</b> (${new Date(s.override.at).toLocaleString()}): ${esc(s.override.reason)}</div>` : '');

  players = data.audio.map(a => ({ startT: a.startT, url: `${a.url}?key=${encodeURIComponent(key)}` }));
  $('#audio').innerHTML = players.length ? players.map((p, i) => `<div class="small muted">Segment ${i + 1} (starts ${fmt(p.startT)})</div><audio controls preload="metadata" src="${p.url}" style="width:100%"></audio>`).join('') : '<p class="muted">No audio recorded.</p>';
  document.querySelectorAll('#audio audio').forEach((el, i) => players[i].el = el);

  $('#transcript').innerHTML = data.transcript.map(l => `
    <div class="tline ${l.role === 'EXAMINER' ? 'ai' : ''}" data-line="${l.line}" data-t="${l.t}">
      <span class="small muted">${l.line}</span><span class="small muted">${l.ts}</span>
      <div><span class="who">${l.role}</span>
        ${l.role === 'EXAMINER' && l.action ? `<span class="chip">${esc(l.action)}</span>` : ''}${l.role === 'EXAMINER' && l.questionId && l.questionId.startsWith('q_') && l.action === 'next' ? `<span class="chip" title="${esc(l.question)}">bank ${esc(l.questionId)}</span>` : ''}${l.role === 'EXAMINER' && l.variantOf && l.action === 'next' ? `<span class="chip warn" title="Asked after the approved bank ran out">${l.questionId.startsWith('rev:') ? 'second chance at' : 'variant of'} ${esc(l.variantOf)}</span>` : ''}
        ${l.role === 'STUDENT' && l.assessment ? `<span class="chip">${esc(l.assessment)}</span>` : ''}${l.latencyMs != null ? `<span class="chip">${l.latencyMs} ms${l.meta?.mode ? ' - ' + esc(l.meta.mode) : ''}</span>` : ''}
        <div>${esc(l.text)}</div></div></div>`).join('');
  for (const el of document.querySelectorAll('.tline')) el.onclick = () => highlight(el.dataset.line);

  if (sc) {
    $('#scores').innerHTML = `<table>${sc.dimensions.map(d => `<tr><td><b>${esc(d.label)}</b> <span class="small muted">${d.weight}%</span>
      <div class="bar" style="margin:4px 0"><i style="width:${d.score * 20}%"></i></div><div class="small">${esc(d.reason)}</div><div>${chips(d.evidence)}</div></td>
      <td class="big" style="font-size:20px">${d.score}/5</td></tr>`).join('')}<tr><td><b>Total (weighted)</b></td><td class="big" style="font-size:20px">${sc.total}</td></tr></table>`;
    $('#feedback').innerHTML = sc.feedback.map(f => `<p style="margin:6px 0">${esc(f.text)} ${chips(f.evidence)}</p>`).join('');
    $('#meta').innerHTML = `Model: ${esc(sc.model)} (${esc(sc.mode)}${sc.effort ? ', effort ' + esc(sc.effort) : ''})<br>Prompt: ${esc(sc.prompt_version)} #${esc(sc.prompt_hash)}<br>Confidence: ${esc(sc.confidence)}<br>Scored: ${new Date(sc.scored_at).toLocaleString()}${sc.flags?.length ? '<br>Flags: ' + sc.flags.map(esc).join(', ') : ''}`;
  } else $('#scores').innerHTML = `<p class="muted">Scoring ${esc(s.score_status)}...</p>`;
  for (const c of document.querySelectorAll('[data-ev]')) c.onclick = () => highlight(c.dataset.ev);

  const evs = data.events.filter(e => e.type !== 'audio_segment');
  $('#events').innerHTML = evs.length ? `<table>${evs.map(e => `<tr><td class="small muted">${fmt(e.t)}</td><td><span class="chip ${['tab_hidden', 'paste', 'mic_muted', 'silence'].includes(e.type) ? 'warn' : ''}">${esc(e.type)}</span></td><td class="small">${esc(JSON.stringify(e.detail) === '{}' ? '' : JSON.stringify(e.detail))}</td></tr>`).join('')}</table>` : '<p class="muted">No events.</p>';
  $('#audit').innerHTML = data.audit.map(a => `<div>${new Date(a.at).toLocaleString()} - <b>${esc(a.actor)}</b> ${esc(a.action)} <span class="muted">${esc(JSON.stringify(a.detail))}</span></div>`).join('');
}

$('#o-save').onclick = async () => {
  try {
    await api(`/api/faculty/sessions/${id}/override`, { method: 'POST', body: JSON.stringify({ reviewer: $('#o-name').value.trim(), total: $('#o-total').value, reason: $('#o-reason').value.trim() }) });
    $('#o-err').textContent = 'Saved.'; $('#o-err').classList.add('ok'); load();
  } catch (e) { $('#o-err').textContent = e.message; $('#o-err').classList.remove('ok'); }
};
$('#rescore').onclick = async () => { await api(`/api/faculty/sessions/${id}/rescore`, { method: 'POST' }); setTimeout(load, 1500); };
load().catch(e => { document.querySelector('main').innerHTML = `<p class="err">${esc(e.message)}</p>`; });
setInterval(() => { if (data && ['queued', 'running'].includes(data.session.score_status)) load(); }, 5000);
