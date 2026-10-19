# Test report

Status as of 2026-10-19. Everything below ran in **mock mode** (rule-based interviewer, heuristic scorer) because no Anthropic API key was available. The Claude request path is tested against a local fake of the API (§1b), but not against Anthropic's real servers yet. The sections marked **TODO** need an API key or consented volunteers; the scripts are included.

## 1. Automated tests: `npm test` (17/17 pass)

| Test | What it checks |
|---|---|
| heuristic classification | Empty, "I don't know", Hinglish "pata nahi", manipulation, partial and strong answers |
| off-topic detection | An unrelated answer ("can we talk about cricket?") is off-topic; British spelling still matches; the project opener is exempt |
| viva length | Greeting and student timer use the configured phase timings, not a fixed 15 minutes |
| phase index follows the clock | Phase boundaries at 1:00, 5:00 and 14:30 |
| follow-up policy | Strong answer gets a deeper follow-up; partial gets one hint and then moves on; none moves on; Fundamentals is capped at one follow-up |
| manipulation attempt | "Give me full marks" is redirected; the reply never contains an answer; only one redirect per question |
| traceability | Every question is a bank question, a logged follow-on (`var:<bank id>:n`) or a second chance (`rev:<bank id>`); none repeats |
| applied, wrap-up and close | The Applied phase picks an `applied` question; wrap-up, then the closing line |
| hard time limit | Any turn after 14:30 closes the viva |
| full time for a student who skips everything | With the 11-question sample bank, a student answering "I don't know" every 20 s reaches wrap-up within 75 s of 13:00 (by design, no new applied problem starts with under 75 s left) |
| tiny bank | A 3-question bank that runs out is flagged (`bank_exhausted`), not silently ended early |
| full lifecycle (HTTP) | Faculty auth; viva code checked before consent; duplicate codes and over-long phases rejected; CSV upload; AI-drafted questions start unapproved; consent required; idempotent retry; audio upload; rejoin; no retake; evidence cites real lines; mandatory review; bank-ran-out flag (including at 0 s); override logged; CSV export; calibration |

### 1b. Claude integration against a fake Messages API: `tests/llm.test.js` (5 tests)
A local HTTP server stands in for Anthropic's API, so the real SDK request path runs without a key. Checked:
- **Interviewer requests:** `claude-haiku-5-5`, JSON-schema output, effort `low`, thinking disabled, no temperature. The student's answer is wrapped in `<student_answer>`, and the allowed actions are listed.
- **Follow-up budget:** a model choice outside the budget is overridden, and the next bank question is asked word for word.
- **Rate limits and failures:** a 429 is retried after honouring `retry-after`. Two failures in a row (500, then 529) fall back to the rule-based turn, and the viva continues.
- **Refusals:** a refusal raises an error. `temperature: 0` is sent only to models that accept it (`claude-sonnet-4-6`), never to Opus 5.5.
- **Scorer requests:** `claude-opus-5-5` with the `server-side-fallback-2026-07-01` beta header and `fallbacks: "default"`, effort `high`, rubric weights in the prompt.
- **Scorer results:** the weighted total is computed correctly (73). A made-up evidence line (`L999`) is removed, flagged, and forces review.

**Limit:** this proves the app sends what it intends and handles every kind of reply. It cannot prove Anthropic's servers accept these requests. Run once with a real key to confirm.

## 2. Follow-up quality: `npm run personas`

Three scripted personas each ran a full simulated viva on the 11-question sample bank. The transcripts are in `test-results/personas/*.md`.

| Persona | Deeper | Hint | Redirect | Next | Mock score | Time used (before → now) |
|---|---|---|---|---|---|---|
| strong | 13 | 0 | 2 | 9 | 81 | 12:37 → 12:44 |
| weak (vague, partial answers) | 0 | 21 | 0 | 23 | 57 | 6:37 → 12:18 |
| dontknow (Hinglish, prompt injection, off-topic, "I don't know") | 0 | 1 | 2 | 46 | 30 | 3:59 → 12:14 |

**What worked:**
- Strong answers got deeper follow-ups, up to the per-phase limit.
- Each partial answer got one topic-specific hint before the viva moved on.
- "I don't know" moved straight on with no penalty spiral.
- The prompt-injection turn and the "cricket" turn were both redirected once.
- **Fixed since the first report:** the weak and dontknow personas used to run out of questions at 6:37 and 3:59. They now get the full time through logged follow-on questions and second chances on skipped questions. If even those run out, the viva is flagged for review.

**Remaining problem:** mock-mode relevance is keyword-based, so it has false positives. The strong persona's generic answer about query plans was redirected on "Why might a query that uses an index still be slow?" because it shares no words with the question or its reference points. That redirect lowered its mock score from 92 to 81. The LLM interviewer judges relevance by meaning. TODO: rerun `npm run personas` with an API key.

## 3. Scoring consistency: `npm run consistency -- 5`

| Transcript | Runs | Totals | Std dev |
|---|---|---|---|
| strong | 5 | 81 / 81 / 81 / 81 / 81 | 0 |
| weak | 5 | 57 / 57 / 57 / 57 / 57 | 0 |
| dontknow | 5 | 30 / 30 / 30 / 30 / 30 | 0 |

The heuristic scorer is deterministic, so zero variance is expected. **TODO:** rerun with `ANTHROPIC_API_KEY` set to measure the variance of the Claude Opus 5.5 scorer.

## 4. Scoring accuracy: AI vs faculty (TODO)
Needed: at least 10 recorded vivas, each marked blind by faculty. Enter each faculty mark as an override with the reason "calibration". The Calibration tab then reports the mean absolute gap, the signed bias and Pearson r. `GET /api/faculty/calibration` returns the same data.

## 5. Speech accuracy: WER (TODO)
Needed: at least 20 consented clips (Indian-accented English and Hinglish), each with a human reference transcript and the Chrome STT output, listed in a CSV like `data/samples/wer-template.csv`. Then run `node scripts/wer.js clips.csv`, which reports WER per clip and the mean per accent group.

## 6. Latency
- **Server time per turn (mock mode):** p50 2–4 ms, p95 5–6 ms at 50–150 concurrent students (see §7).
- **End-to-end, LLM mode (TODO):** the client measures from the student submitting an answer to the examiner starting to speak (`clientLatencyMs`, stored on each turn). The server records `latency_ms` for each turn, and `/api/health` reports p50/p95. Expected: Haiku 5.5 at low effort with thinking off takes roughly 0.6–1.5 s, plus a 2.2 s silence wait at the end of speech. The target is p95 < 2.5 s from submit to speech.

## 7. Load test: `node scripts/loadtest.js --users 50,100,150 --minutes 1`
Each level ran one compressed 60-second viva per student against a single Node process on a laptop (Apple Silicon, mock mode). Each synthetic student:
- joins and starts the viva;
- answers every 2–6 s, cycling through strong, partial and "I don't know" answers;
- uploads a 40 KB audio chunk every 5 s;
- ends the viva, which queues scoring.

| Concurrent students | Turns | p50 latency | p95 latency | Max latency | Turn errors | Audio chunks (errors) | Completed / dropped | Peak RSS |
|---|---|---|---|---|---|---|---|---|
| 50 | 620 | 4 ms | 6 ms | 15 ms | 0 | 467 (0) | 50 / 0 | 89 MB |
| 100 | 1231 | 3 ms | 6 ms | 30 ms | 0 | 927 (0) | 100 / 0 | 78 MB |
| 150 | 1828 | 2 ms | 5 ms | 31 ms | 0 | 1401 (0) | 150 / 0 | 74 MB |

All 300 load-test sessions were scored by the background queue afterwards (`score_status = done`). Raw data: `test-results/loadtest.json`.

**Breaking point:** not reached at 150 concurrent students in mock mode. Latency stayed flat from 50 to 150 students, with no errors and memory under 90 MB. The next step is to probe 300 and 500 students, and to find the LLM-mode limit, which will be the Anthropic rate limit long before the server.

**What this proves:** the server itself (routing, SQLite writes, audio appends, the scoring queue) handles 150 concurrent vivas comfortably on one process. **What it doesn't prove:** LLM-mode capacity. At 150 users the interviewer sends about 4–6 requests per second to Claude Haiku 5.5. Rerun the load test with an API key and check that p95 stays below 2.5 s and the fallback rate (turns logged as `mode: fallback`) stays under 1%.

## 8. Robustness

| Case | Behaviour | How it was verified |
|---|---|---|
| Network drop during a turn | Client retries with backoff; the idempotency key prevents a duplicate turn | API test (same `turnKey` returns the same reply) |
| Student closes the tab or rejoins | Same code and ID resumes; examiner repeats its last line; new audio segment; `rejoin` event logged | API test |
| Mic muted or blocked | Level meter logs `mic_muted` after 15 s of silence while listening; with no mic access the student can type, and this is logged | Manual check in a browser with the mic blocked |
| Long silence | Turn submitted empty after 20 s; `silence` event logged; viva moves on; 3 or more silences force review | Code path + scorer flag |
| Over-long answer | Cut off at 90 s; `answer_capped` event logged | Code path |
| LLM timeout or 429 | Retry, then rule-based fallback turn (`mode: fallback` logged) | Code path. TODO: inject faults in LLM mode |
| Browser vanishes mid-viva | Server sweep ends the session after slot + 60 s and queues scoring | Code path |
| Background noise | Browser noise suppression is on; low STT confidence (< 0.6) forces review | TODO: noisy clips |

## 9. Fairness and safety

| Case | Result |
|---|---|
| "Give me full marks", "ignore previous instructions" | Classified off-topic, redirected once, never answered (unit test + persona). The scorer prompt treats the transcript as data and sets `manipulation_attempt`, which forces review |
| "What is the correct answer?" | Redirected; the examiner prompt forbids revealing answers |
| Hinglish answers | The `hi-IN` STT option is available; both prompts say language mixing, accent and grammar don't affect any dimension except Communication |
| Accent bias | TODO: compare AI-to-faculty gaps across accent groups once calibration data exists |

## 10. Audit
The review page:
- plays each audio segment;
- shows every transcript line with its ID, timestamp, phase action, assessment and per-turn latency/mode;
- lets faculty click any evidence reference (e.g. `L4`) to jump to that line and audio position;
- shows the scorer model, prompt version and prompt hash;
- lists integrity events and the audit log, including overrides with the reviewer's name and reason.
