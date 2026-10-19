# Privacy note

## What is stored
- Student email addresses, verified by a one-time code, with first and last sign-in times. Codes are stored only as a keyed hash and deleted once used; they expire after 10 minutes and lock after 5 wrong tries.
- Student ID, name, consent timestamp and chosen language
- Audio recording of the student's microphone (WebM/Opus segments)
- Timestamped transcript, the question asked at each turn, the examiner's replies and per-turn metadata
- Rubric scores, reasons, feedback, scorer model and prompt version
- Integrity events (tab switches, silences, pasted text, mic issues, rejoins)
- Faculty overrides and the audit log (who changed what, when and why)

## Where it is stored
- Database: SQLite file at `DATA_DIR/viva.db` on the MSOT server, or the Docker volume `viva-data`
- Audio: `DATA_DIR/audio/*.webm` on the same server
- Third parties that process data in transit:
  - **Anthropic API.** Receives transcript text, both for live turns and for scoring. It does not receive audio. Data is handled under Anthropic's commercial terms and is not used for model training.
  - **Google, via Chrome.** Chrome's built-in speech recognition sends microphone audio to Google to transcribe it. If that isn't acceptable, switch STT to a self-hosted model (faster-whisper). See DESIGN.md §5.

Uploaded question papers and syllabi (PDF, PNG, JPG) are not kept. Only the questions taken from them are stored. With an API key, the file is sent to the Anthropic API to be read; without one, it is read on the server.

## Who can access it
- **Students:** only their own live session. They can't see scores or other students.
- **Faculty:** anyone with the faculty passcode can see all vivas, recordings, transcripts and scores. For the pilot, replace the shared passcode with SSO and per-reviewer accounts so access is attributable.
- The API key and faculty passcode are environment variables and are never committed (`.env` is git-ignored).

## Consent
Students must tick an explicit recording-consent checkbox before the viva can start, and the server rejects joins without it. Consent is timestamped. Test only with volunteers who have consented; the test personas in this repo are synthetic.

## Retention
**Proposed:** keep recordings and transcripts until the re-evaluation window closes (for example, one semester after results), then delete the audio and keep the scores and audit log. MSOT needs to confirm the retention period (this is an open question in the brief). Deletion means removing the session's rows and its `audio/<session>_*.webm` files.
