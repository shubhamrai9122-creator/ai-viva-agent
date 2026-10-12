# Cost sheet

These are estimates from token arithmetic, not measured bills. Measure the real usage in the first pilot run: the scorer stores `usage` with every result. Exchange rate assumed: ₹88 = $1. Prices are Anthropic list prices as of Oct 2026.

## Per viva: default stack (browser speech + Claude)

| Item | Assumption | Cost |
|---|---|---|
| Interviewer: Claude Haiku 5.5 ($0.10 / $0.50 per M tokens) | ~30 turns × ~1.2 k input + ~80 output tokens | ~$0.005 |
| Scorer: Claude Opus 5.5 ($4 / $20 per M tokens), effort high | ~5 k input; ~4 k output incl. thinking | ~$0.10 |
| STT / TTS | Browser Web Speech API | $0 |
| Audio storage | Opus ~3 MB per viva | ~$0.0001 |
| Server | 1 × 4 vCPU VM for the 1-hour slot window | ~$0.001 per viva |
| **Total** | | **≈ $0.11 ≈ ₹10 per student** |

**All 350 students:** about $38, or roughly ₹3,400.

## Alternatives

| Stack | Per viva | 350 students | Notes |
|---|---|---|---|
| Default: browser speech, Haiku interviewer, Opus scorer | ~₹10 | ~₹3,400 | Recommended |
| Cheaper scorer (`SCORER_MODEL=claude-sonnet-5-5`, $2 / $10) | ~₹5 | ~₹1,800 | Check calibration first |
| Hosted speech (Deepgram STT ~$0.0043/min, Azure neural TTS ~$16 per M chars) | ~₹24 | ~₹8,400 | Better accuracy, and audio doesn't go to Google |
| Self-hosted speech (faster-whisper + Piper on 1 × L4 GPU ≈ $0.8/h, 3 h) | ~₹11 | ~₹3,600 | Data stays on campus; needs ops effort |
| Mock mode (no LLM) | ₹0 | ₹0 | Rule-based; every viva needs faculty review |

All of these are far below the ₹500 per student that the brief calls not viable.
