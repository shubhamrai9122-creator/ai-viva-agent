# AI Viva Agent

A voice AI examiner that runs a short technical viva (by default 5 questions, one minute each; a full 15-minute format is also available). It adapts its questions to each answer, scores the student against a weighted rubric with every score linked to transcript evidence, and keeps the audio, transcript and scoring record so faculty can audit any mark.

Built for the MSOT *AI Viva Challenge* (Problem 1).

## Quick start

```bash
npm install
npm start                 # http://localhost:3000
```

Or with Docker:

```bash
docker compose up --build
```

With no `ANTHROPIC_API_KEY` set, the app runs in **mock mode**: a rule-based interviewer and a heuristic scorer, with no API cost. Every mock-mode score is flagged for faculty review. To use Claude, set the key first:

```bash
export ANTHROPIC_API_KEY=sk-ant-...   # or put it in .env (see .env.example); npm start reads .env
npm start
```

A demo viva with code **`DS-DEMO`** (Data Structures: 5 questions, 1 minute each, picked from a 16-question bank) is seeded on first start.

| Who | URL | Notes |
|---|---|---|
| Student | `/student.html` | Signs in with an email code. Use Chrome or Edge to speak answers; any browser can type them. |
| Faculty | `/faculty.html` | Passcode: `FACULTY_PASSCODE` (default `faculty123`) |

## What's implemented

**Required features**
1. **Viva setup.** Faculty enter the subject, topics, difficulty and per-phase timings, and add questions in any of these ways:
   - upload a ready-made question bank as CSV or JSON;
   - upload a question paper or syllabus as a **PDF, PNG or JPG**. With an API key, Claude reads the file directly; without one, the app reads the PDF's text, or reads an image with OCR (Tesseract), and picks out the questions. If the file has no questions, it drafts some from the syllabus;
   - paste a syllabus and let the AI draft questions.

   Questions from a file or the AI start as *drafts* until faculty approve them.
2. **Student sign-in and consent.** Students sign in with their email and a 6-digit one-time code (no passwords). Codes are sent by SMTP, or printed in the server log until email is set up (see `.env.example`). `ALLOWED_EMAIL_DOMAINS` can restrict sign-in to the institute's domain. Each viva is tied to the verified email: one attempt per email, and a student ID can't be reused by another email. With `VALIDATEEASY_API_KEY` set, each address is first checked with [ValidateEasy](https://validateeasy.com), so disposable, mistyped or dead-domain addresses are refused (if the service is down, sign-in still works). The sign-in email puts the code alone on its own line so it can be copied in one tap, and the sign-in page has a **Paste code** button. Students then enter the viva code and their ID, read the rules, choose the examiner's voice, optionally check their microphone and speech-to-text, and tick a recording-consent box. The server refuses to start a viva without consent.
3. **Voice interview.** The browser speaks each question (TTS) and transcribes the answer (STT) with the Web Speech API.
   - **Examiner voice:** a female voice by default (Samantha, Veena, Heera or similar, depending on the device), and students can pick another.
   - **Read-only mode:** students can turn the voice off to read questions instead, or stop it mid-sentence.
   - **Answering:** one answer box takes both speech and typing.

   The server picks the next turn using Claude Haiku 5.5 with a 6 s timeout, falling back to a rule-based turn if the call fails.
4. **Adaptive follow-ups.** A deterministic controller enforces this policy: a strong answer gets a follow-up that goes deeper; a partial answer gets one hint and then the viva moves on; "I don't know" moves on immediately; off-topic answers and prompt injection get one redirect. Follow-ups per question are capped (1 in Fundamentals, 3 in Depth and Applied). The examiner never reveals answers.
5. **Time limits.** Faculty choose the format per viva:
   - **Quick (default):** a set number of questions (default 5), each with its own answer time (default 60 s). The clock for each question starts after it has been read out and is shown large on screen. When it runs out, the answer is sent as it is. After a strong answer the next question is harder, after a weak one it is easier, and the last question is always an applied problem.
   - **Full:** the 15-minute structure with five phases and follow-up questions. Answers are capped at 90 s, and a wrap-up prompt and closing line run on time.

   The server also closes any viva that runs past its slot.
6. **Marks and feedback.** After the viva, Claude Opus 5.5 scores the full transcript. Each of the 5 rubric dimensions gets a 0–5 score, a one-line reason and the transcript lines that support it. The app computes the weighted total out of 100 and 3–5 feedback lines, each with line references.
7. **Persistence.** The app stores:
   - Audio, uploaded in 5 s chunks so a crash loses at most 5 s. Each reconnect starts a new segment.
   - The timestamped transcript.
   - The bank ID of every question asked.
   - The interviewer mode and latency for each turn.
   - The scorer's model, prompt version and prompt hash.
   - An audit log.
8. **Faculty dashboard.** Lists all vivas with a needs-review filter and search. The review page plays the audio, shows the transcript, and lets faculty click any evidence reference to jump to that line and audio moment. Faculty can override a mark (name and reason required, and the change is logged), re-run scoring, and export results to CSV.

**Stretch goals**
- **Integrity signals.** Logged and shown to reviewers: tab switches, long silences, pasted text, a muted or dead mic, answers cut off at the time cap, and rejoins.
- **Hindi/Hinglish.** Students can pick `hi-IN` speech recognition. The interviewer and scorer prompts say not to penalise language mixing, accent or grammar outside the Communication dimension.
- **Calibration mode.** Compares AI marks with faculty override marks: mean absolute gap, signed bias and Pearson r.
- **CSV export.**

**Mandatory review.** A viva is flagged for faculty review if any of these happen: the scorer reports low confidence, the heuristic fallback scored it, answers are very short (under 150 words in total), fewer than 5 answers, poor STT confidence, 3 or more silences, 2 or more tab switches, pasted text, a manipulation attempt, or the scorer cites a line that doesn't exist.

## Repository layout

```
server.js               HTTP API + static files
src/interviewer.js      phase/timing controller, follow-up policy, LLM turn
src/scorer.js           rubric scorer, evidence validation, review flags
src/queue.js            background scoring queue (persisted; resumes on restart)
src/llm.js              Claude client: structured JSON output, retry/backoff
src/questionbank.js     CSV/JSON import, AI generation from syllabus
src/db.js               SQLite schema (node:sqlite) and data access
public/                 student, faculty and review pages
scripts/                personas, scoring consistency, load test, WER
tests/                  node:test unit and end-to-end tests
data/samples/           sample question bank (CSV + JSON), WER template
docs/                   design, test report, cost sheet, privacy note
```

## Tests

```bash
npm test                                   # unit + end-to-end API tests
npm run personas                           # 3 scripted personas -> test-results/personas/*.md
npm run consistency -- 5                   # score each persona transcript 5x, report variance
node scripts/loadtest.js --users 50,100,150 --minutes 1 --url http://localhost:3000
node scripts/wer.js data/samples/wer-template.csv
```

See [docs/TEST_REPORT.md](docs/TEST_REPORT.md) for the results and for which tests still need real volunteers.

## Docs
- [docs/DESIGN.md](docs/DESIGN.md): architecture, design decisions, scaling and capacity plan
- [docs/TEST_REPORT.md](docs/TEST_REPORT.md): what was tested, how, and the results
- [docs/COST.md](docs/COST.md): cost per viva and for all 350 students
- [docs/PRIVACY.md](docs/PRIVACY.md): where data is stored, who can access it, and how long it's kept

## Credits
Express, Node.js `node:sqlite`, the Anthropic SDK (Claude Haiku 5.5 for interviewing, Claude Opus 5.5 for scoring), and the browser Web Speech API and MediaRecorder.
