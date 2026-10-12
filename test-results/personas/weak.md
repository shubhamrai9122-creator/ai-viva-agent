# Persona: weak

Mode: mock (rule-based interviewer, heuristic scorer)  
Simulated duration: 397 s  
Session: s_fb5bed4dc49dd444

## Transcript

- L1 [00:00] **EXAMINER** _(greeting, opener)_: Hello persona-weak-1791836116281. Welcome to your Database Management Systems viva. I'm the AI examiner. Please confirm your student ID is persona-weak-1791836116281. The viva lasts fifteen minutes in five short parts. I can't tell you answers or marks, and it's fine to say you don't know. Hindi or English is fine. To start: tell me about a project you built, what it did, and your part in it.
- L2 [00:26] **STUDENT** _(partial)_: I made a website for college fest. It had a database.
- L3 [00:33] **EXAMINER** _(hint, opener)_: Think about the underlying mechanism rather than the definition. Would you like to try again?
- L4 [00:40] **STUDENT** _(partial)_: I made a website for college fest. It had a database.
- L5 [00:46] **EXAMINER** _(next, q_fa31a184811bab19)_: Alright. Let's start with some core concepts. What is normalization in databases, and why do we normalize tables?
- L6 [00:54] **STUDENT** _(partial)_: I think it is something about organising tables to reduce, I am not fully sure.
- L7 [01:02] **EXAMINER** _(hint, q_fa31a184811bab19)_: Think about the underlying mechanism rather than the definition. Would you like to try again?
- L8 [01:09] **STUDENT** _(partial)_: I think it is something about organising tables to reduce, I am not fully sure.
- L9 [01:17] **EXAMINER** _(next, q_c85f68074c77e93d)_: Okay, noted. Explain the difference between a clustered and a non-clustered index.
- L10 [01:22] **STUDENT** _(partial)_: I think it is something about clustered defines physical row, I am not fully sure.
- L11 [01:30] **EXAMINER** _(hint, q_c85f68074c77e93d)_: Think about the underlying mechanism rather than the definition. Would you like to try again?
- L12 [01:37] **STUDENT** _(partial)_: I think it is something about clustered defines physical row, I am not fully sure.
- L13 [01:45] **EXAMINER** _(next, q_da4b6b26d3385ea9)_: Thank you. What do the ACID properties of a transaction mean?
- L14 [01:50] **STUDENT** _(partial)_: I think it is something about atomicity, I am not fully sure.
- L15 [01:57] **EXAMINER** _(hint, q_da4b6b26d3385ea9)_: Think about the underlying mechanism rather than the definition. Would you like to try again?
- L16 [02:04] **STUDENT** _(partial)_: I think it is something about atomicity, I am not fully sure.
- L17 [02:11] **EXAMINER** _(next, q_f3f95d9960f0e4ef)_: Alright. Now I'd like to go deeper into normalization. When would you deliberately denormalize a schema, and what do you give up?
- L18 [02:20] **STUDENT** _(partial)_: I think it is something about read-heavy workloads, I am not fully sure.
- L19 [02:27] **EXAMINER** _(hint, q_f3f95d9960f0e4ef)_: Think about the underlying mechanism rather than the definition. Would you like to try again?
- L20 [02:34] **STUDENT** _(partial)_: I think it is something about read-heavy workloads, I am not fully sure.
- L21 [02:41] **EXAMINER** _(next, q_cf36781cdb689777)_: Okay, noted. Why can adding too many indexes slow a database down?
- L22 [02:47] **STUDENT** _(partial)_: I think it is something about every write updates each, I am not fully sure.
- L23 [02:55] **EXAMINER** _(hint, q_cf36781cdb689777)_: Think about the underlying mechanism rather than the definition. Would you like to try again?
- L24 [03:02] **STUDENT** _(partial)_: I think it is something about every write updates each, I am not fully sure.
- L25 [03:10] **EXAMINER** _(next, q_874e5ab3f957346e)_: Thank you. Why might a query that uses an index still be slow?
- L26 [03:16] **STUDENT** _(partial)_: I think it is something about low selectivity, I am not fully sure.
- L27 [03:23] **EXAMINER** _(hint, q_874e5ab3f957346e)_: Think about the underlying mechanism rather than the definition. Would you like to try again?
- L28 [03:30] **STUDENT** _(partial)_: I think it is something about low selectivity, I am not fully sure.
- L29 [03:37] **EXAMINER** _(next, q_91ac71cfe21d6013)_: Alright. Explain the isolation levels, and what anomaly each one prevents.
- L30 [03:42] **STUDENT** _(partial)_: I think it is something about read uncommitted, I am not fully sure.
- L31 [03:49] **EXAMINER** _(hint, q_91ac71cfe21d6013)_: Think about the underlying mechanism rather than the definition. Would you like to try again?
- L32 [03:56] **STUDENT** _(partial)_: I think it is something about read uncommitted, I am not fully sure.
- L33 [04:03] **EXAMINER** _(next, q_302bbfe90a8a524d)_: Okay, noted. How does a database recover after a crash in the middle of a transaction?
- L34 [04:10] **STUDENT** _(partial)_: I think it is something about write-ahead log, I am not fully sure.
- L35 [04:17] **EXAMINER** _(hint, q_302bbfe90a8a524d)_: Think about the underlying mechanism rather than the definition. Would you like to try again?
- L36 [04:24] **STUDENT** _(partial)_: I think it is something about write-ahead log, I am not fully sure.
- L37 [04:31] **EXAMINER** _(next, q_afc1ad83ab8c2ce7)_: Thank you. What is the difference between an inner join and a left outer join?
- L38 [04:38] **STUDENT** _(partial)_: I think it is something about inner returns matching rows, I am not fully sure.
- L39 [04:46] **EXAMINER** _(hint, q_afc1ad83ab8c2ce7)_: Think about the underlying mechanism rather than the definition. Would you like to try again?
- L40 [04:53] **STUDENT** _(partial)_: I think it is something about inner returns matching rows, I am not fully sure.
- L41 [05:01] **EXAMINER** _(next, q_7eb22f53b24cc30e)_: Alright. Next, a short applied problem. Please think aloud as you reason through it. An e-commerce site's order page takes eight seconds to load, and the slow query joins orders, customers and products. Walk me through how you would find and fix the problem.
- L42 [05:19] **STUDENT** _(partial)_: I think it is something about explain plan, I am not fully sure.
- L43 [05:26] **EXAMINER** _(hint, q_7eb22f53b24cc30e)_: Think about the underlying mechanism rather than the definition. Would you like to try again?
- L44 [05:33] **STUDENT** _(partial)_: I think it is something about explain plan, I am not fully sure.
- L45 [05:40] **EXAMINER** _(next, q_e4e76a9bea5cc8d4)_: Okay, noted. Two users book the last seat on a flight at the same moment and both get a confirmation. What went wrong, and how would you prevent it?
- L46 [05:52] **STUDENT** _(partial)_: I think it is something about race condition / lost, I am not fully sure.
- L47 [06:00] **EXAMINER** _(hint, q_e4e76a9bea5cc8d4)_: Think about the underlying mechanism rather than the definition. Would you like to try again?
- L48 [06:07] **STUDENT** _(partial)_: I think it is something about race condition / lost, I am not fully sure.
- L49 [06:15] **EXAMINER** _(next, wrapup)_: Thank you. We're almost out of time. Is there anything you'd like to add about anything we discussed?
- L50 [06:23] **STUDENT** _(partial)_: No, nothing.
- L51 [06:26] **EXAMINER** _(close)_: Thank you for sharing that. Thank you, that's the end of your viva. Your answers and recording are saved and will be reviewed by faculty. All the best!

## Score: 57/100

- **Conceptual understanding**: 3/5 - Heuristic from 6 answer(s) in this phase. (evidence: L6, L8, L10, L12, L14, L16)
- **Depth and reasoning**: 3/5 - Heuristic from 12 answer(s) in this phase. (evidence: L18, L20, L22, L24, L26, L28, L30, L32, L34, L36, L38, L40)
- **Problem solving**: 3/5 - Heuristic from 4 answer(s) in this phase. (evidence: L42, L44, L46, L48)
- **Practical / project knowledge**: 2/5 - Project description was 22 words. (evidence: L2, L4)
- **Communication**: 3/5 - Average answer length 13 words. (evidence: L2, L4, L6)

Feedback:
- Strongest area: conceptual understanding. (L6, L8)
- Needs most work: practical / project knowledge. (L2, L4)
- Heuristic scoring only: a faculty member must review this viva. ()

Needs review: true Scorer reported low confidence; Scored by heuristic fallback, not the LLM
