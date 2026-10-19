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
  for (const el of $$('.tline')) el.classList.toggle('hl', el.dataset.line === line);
  const el = $(`.tline[data-line="${line}"]`);
  if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); seek(Number(el.dataset.t)); }
}
const chips = ev => (ev || []).map(e => { const l = typeof e === 'string' ? e : e.line; return `<span class="chip link" data-ev="${l}">${l}</span>`; }).join('');
const EVENT_LABEL = { tab_hidden: 'Left the tab', tab_visible: 'Came back', silence: 'Long silence', paste: 'Pasted text', mic_muted: 'Mic silent or blocked',
  answer_capped: 'Answer cut at time limit', rejoin: 'Rejoined', bank_exhausted: 'Question bank ran out', network_restored: 'Back online', stt_unavailable: 'No speech-to-text', ended: 'Ended' };

async function load() {
  data = await api(`/api/faculty/sessions/${id}`);
  const s = data.session, sc = s.score;
  $('#title').textContent = s.student_name || s.student_id;
  $('#sub').textContent = [s.student_id, s.student_email, `${data.viva.code} · ${data.viva.subject}`, s.started_at && new Date(s.started_at).toLocaleString()].filter(Boolean).join('  ·  ');
  $('#final').textContent = s.final_total ?? '-';
  $('#ai').textContent = s.ai_total != null ? (s.override ? `AI mark ${s.ai_total} · overridden` : `AI mark ${s.ai_total}`) : (s.score_status === 'done' ? '' : 'Marking...');
  $('#reasons').innerHTML = (s.needs_review ? '<span class="chip warn">Needs review</span>' : '') + (s.review_reasons || []).map(r => `<span class="chip plain">${esc(r)}</span>`).join('') +
    (s.override ? `<div class="note">Overridden by <b>${esc(s.override.reviewer)}</b> on ${new Date(s.override.at).toLocaleString()}: ${esc(s.override.reason)}</div>` : '');

  players = data.audio.map(a => ({ startT: a.startT, url: `${a.url}?key=${encodeURIComponent(key)}` }));
  $('#audio').innerHTML = players.length ? players.map((p, i) => `<div class="small muted" style="margin-top:${i ? 10 : 0}px">Part ${i + 1} (from ${fmt(p.startT)})</div><audio controls preload="metadata" src="${p.url}" style="width:100%"></audio>`).join('') : '<p class="muted">No audio was recorded (the student had no microphone access or typed their answers).</p>';
  $$('#audio audio').forEach((el, i) => players[i].el = el);
  $('#audio-hint').classList.toggle('hidden', !players.length);

  $('#transcript').innerHTML = data.transcript.map(l => {
    const ai = l.role === 'EXAMINER';
    const tags = [];
    if (ai && l.action && l.action !== 'next') tags.push(`<span class="chip plain">${esc(l.action)}</span>`);
    if (ai && l.action === 'next' && l.questionId?.startsWith('q_')) tags.push(`<span class="chip plain" title="${esc(l.question)}">bank question</span>`);
    if (ai && l.variantOf && l.action === 'next') tags.push(`<span class="chip warn" title="Asked after the approved bank ran out">${l.questionId.startsWith('rev:') ? 'second chance' : 'follow-on'} of ${esc(l.variantOf)}</span>`);
    if (!ai && l.assessment) tags.push(`<span class="chip ${l.assessment === 'strong' ? 'ok' : l.assessment === 'offtopic' ? 'warn' : 'plain'}">${esc(l.assessment)}</span>`);
    if (l.latencyMs != null) tags.push(`<span class="chip plain">${l.latencyMs} ms${l.meta?.mode ? ' · ' + esc(l.meta.mode) : ''}</span>`);
    return `<div class="tline ${ai ? 'ai' : 'st'}" data-line="${l.line}" data-t="${l.t}">
      <span class="small muted">${l.line}</span><span class="small muted">${l.ts}</span>
      <div><span class="who">${ai ? 'EXAMINER' : 'STUDENT'}</span> ${tags.join('')}<div style="margin-top:3px">${esc(l.text)}</div></div></div>`;
  }).join('');
  for (const el of $$('.tline')) el.onclick = () => highlight(el.dataset.line);

  if (sc) {
    $('#scores').innerHTML = sc.dimensions.map(d => `<div style="padding:12px 0;border-bottom:1px solid var(--line)">
      <div style="display:flex;justify-content:space-between;gap:10px"><b>${esc(d.label)} <span class="small muted" style="font-weight:400">${d.weight}%</span></b><b>${d.score}/5</b></div>
      <div class="bar" style="margin:8px 0"><i style="width:${d.score * 20}%"></i></div><div class="small">${esc(d.reason)}</div><div style="margin-top:4px">${chips(d.evidence)}</div></div>`).join('') +
      `<div style="display:flex;justify-content:space-between;padding-top:12px"><b>Weighted total</b><b>${sc.total} / 100</b></div>`;
    $('#feedback').innerHTML = sc.feedback.map(f => `<p style="margin:8px 0">${esc(f.text)} ${chips(f.evidence)}</p>`).join('');
    $('#meta').innerHTML = `Model: ${esc(sc.model)} (${esc(sc.mode)}${sc.effort ? ', effort ' + esc(sc.effort) : ''})<br>Prompt: ${esc(sc.prompt_version)} #${esc(sc.prompt_hash)}<br>Confidence: ${esc(sc.confidence)}<br>Marked: ${new Date(sc.scored_at).toLocaleString()}${sc.flags?.length ? '<br>Flags: ' + sc.flags.map(esc).join(', ') : ''}`;
  } else $('#scores').innerHTML = `<p class="muted">${s.status === 'ended' ? 'Marking in progress...' : 'The viva is still in progress.'}</p>`;
  for (const c of $$('[data-ev]')) c.onclick = () => highlight(c.dataset.ev);

  const evs = data.events.filter(e => e.type !== 'audio_segment');
  $('#events').innerHTML = evs.length ? `<table><tbody>${evs.map(e => `<tr><td class="small muted" style="width:56px">${fmt(e.t)}</td><td><span class="chip ${['tab_hidden', 'paste', 'mic_muted', 'silence', 'bank_exhausted'].includes(e.type) ? 'warn' : 'plain'}">${esc(EVENT_LABEL[e.type] || e.type)}</span></td><td class="small muted">${esc(Object.values(e.detail || {}).join(', '))}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Nothing unusual.</p>';
  $('#audit').innerHTML = data.audit.map(a => `<div style="padding:6px 0;border-bottom:1px solid var(--line)">${new Date(a.at).toLocaleString()} · <b>${esc(a.actor)}</b> ${esc(a.action.replace(/_/g, ' '))}</div>`).join('') || '<p class="muted">No entries.</p>';
}

$('#o-save').onclick = async () => {
  const el = $('#o-msg');
  try {
    await api(`/api/faculty/sessions/${id}/override`, { method: 'POST', body: JSON.stringify({ reviewer: $('#o-name').value.trim(), total: $('#o-total').value, reason: $('#o-reason').value.trim() }) });
    el.textContent = 'Saved.'; el.classList.add('ok'); load();
  } catch (e) { el.textContent = e.message; el.classList.remove('ok'); }
};
$('#rescore').onclick = async () => { await api(`/api/faculty/sessions/${id}/rescore`, { method: 'POST' }); setTimeout(load, 1500); };
load().catch(e => { $('main').innerHTML = `<div class="card"><p class="msg">${esc(e.message)}</p></div>`; });
setInterval(() => { if (data && ['queued', 'running'].includes(data.session.score_status)) load(); }, 5000);
