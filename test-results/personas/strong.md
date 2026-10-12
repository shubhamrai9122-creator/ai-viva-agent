# Persona: strong

Mode: mock (rule-based interviewer, heuristic scorer)  
Simulated duration: 757 s  
Session: s_7c8374b81980cf5d

## Transcript

- L1 [00:00] **EXAMINER** _(greeting, opener)_: Hello persona-strong-1791836116273. Welcome to your Database Management Systems viva. I'm the AI examiner. Please confirm your student ID is persona-strong-1791836116273. The viva lasts fifteen minutes in five short parts. I can't tell you answers or marks, and it's fine to say you don't know. Hindi or English is fine. To start: tell me about a project you built, what it did, and your part in it.
- L2 [00:26] **STUDENT** _(strong)_: I built a library management system with a team of three. I designed the PostgreSQL schema, normalised it to third normal form, added indexes on book ID and member ID for the issue table, and wrote the REST API in Node. We used transactions so issuing a book and updating stock happen atomically.
- L3 [00:49] **EXAMINER** _(next, q_fa31a184811bab19)_: Okay, noted. Let's start with some core concepts. What is normalization in databases, and why do we normalize tables?
- L4 [00:57] **STUDENT** _(strong)_: The main trade-off is between read performance and write cost. For example, at scale I would measure with EXPLAIN and load tests first, because adding structure helps reads but every insert and update has to maintain it, and under high concurrency that becomes the bottleneck. An edge case is when the data is skewed so the optimizer picks a bad plan.
- L5 [01:23] **EXAMINER** _(deeper, q_fa31a184811bab19)_: Why does it work that way? What would happen if that assumption failed?
- L6 [01:29] **STUDENT** _(strong)_: Organising tables to reduce redundancy and update/insert/delete anomalies; normal forms 1NF-3NF/BCNF; functional dependencies. To explain it in my own words, this matters because it keeps the data correct and the queries efficient, and in my project I saw this directly when we tuned the issue table.
- L7 [01:49] **EXAMINER** _(next, q_c85f68074c77e93d)_: Thank you. Explain the difference between a clustered and a non-clustered index.
- L8 [01:54] **STUDENT** _(strong)_: The main trade-off is between read performance and write cost. For example, at scale I would measure with EXPLAIN and load tests first, because adding structure helps reads but every insert and update has to maintain it, and under high concurrency that becomes the bottleneck. An edge case is when the data is skewed so the optimizer picks a bad plan.
- L9 [02:20] **EXAMINER** _(deeper, q_c85f68074c77e93d)_: Okay. How would that hold up at scale, and what would you change?
- L10 [02:26] **STUDENT** _(strong)_: Clustered defines physical row order, one per table; non-clustered is a separate structure pointing to rows; B+ tree. To explain it in my own words, this matters because it keeps the data correct and the queries efficient, and in my project I saw this directly when we tuned the issue table.
- L11 [02:48] **EXAMINER** _(next, q_da4b6b26d3385ea9)_: Alright. What do the ACID properties of a transaction mean?
- L12 [02:53] **STUDENT** _(strong)_: The main trade-off is between read performance and write cost. For example, at scale I would measure with EXPLAIN and load tests first, because adding structure helps reads but every insert and update has to maintain it, and under high concurrency that becomes the bottleneck. An edge case is when the data is skewed so the optimizer picks a bad plan.
- L13 [03:18] **EXAMINER** _(deeper, q_da4b6b26d3385ea9)_: Good. What trade-offs or edge cases come up with that approach?
- L14 [03:24] **STUDENT** _(strong)_: Atomicity, Consistency, Isolation, Durability, each with a one-line meaning; logs/WAL for durability. To explain it in my own words, this matters because it keeps the data correct and the queries efficient, and in my project I saw this directly when we tuned the issue table.
- L15 [03:43] **EXAMINER** _(next, q_f3f95d9960f0e4ef)_: Okay, noted. Now I'd like to go deeper into normalization. When would you deliberately denormalize a schema, and what do you give up?
- L16 [03:53] **STUDENT** _(strong)_: The main trade-off is between read performance and write cost. For example, at scale I would measure with EXPLAIN and load tests first, because adding structure helps reads but every insert and update has to maintain it, and under high concurrency that becomes the bottleneck. An edge case is when the data is skewed so the optimizer picks a bad plan.
- L17 [04:19] **EXAMINER** _(deeper, q_f3f95d9960f0e4ef)_: Why does it work that way? What would happen if that assumption failed?
- L18 [04:25] **STUDENT** _(strong)_: Read-heavy workloads, avoiding joins, reporting; costs: redundancy, update anomalies, consistency maintenance. To explain it in my own words, this matters because it keeps the data correct and the queries efficient, and in my project I saw this directly when we tuned the issue table.
- L19 [04:44] **EXAMINER** _(deeper, q_f3f95d9960f0e4ef)_: Okay. How would that hold up at scale, and what would you change?
- L20 [04:50] **STUDENT** _(strong)_: The main trade-off is between read performance and write cost. For example, at scale I would measure with EXPLAIN and load tests first, because adding structure helps reads but every insert and update has to maintain it, and under high concurrency that becomes the bottleneck. An edge case is when the data is skewed so the optimizer picks a bad plan.
- L21 [05:15] **EXAMINER** _(deeper, q_f3f95d9960f0e4ef)_: Good. What trade-offs or edge cases come up with that approach?
- L22 [05:21] **STUDENT** _(strong)_: Read-heavy workloads, avoiding joins, reporting; costs: redundancy, update anomalies, consistency maintenance. To explain it in my own words, this matters because it keeps the data correct and the queries efficient, and in my project I saw this directly when we tuned the issue table.
- L23 [05:40] **EXAMINER** _(next, q_cf36781cdb689777)_: Alright. Why can adding too many indexes slow a database down?
- L24 [05:45] **STUDENT** _(strong)_: The main trade-off is between read performance and write cost. For example, at scale I would measure with EXPLAIN and load tests first, because adding structure helps reads but every insert and update has to maintain it, and under high concurrency that becomes the bottleneck. An edge case is when the data is skewed so the optimizer picks a bad plan.
- L25 [06:11] **EXAMINER** _(deeper, q_cf36781cdb689777)_: Good. What trade-offs or edge cases come up with that approach?
- L26 [06:16] **STUDENT** _(strong)_: Every write updates each index; storage; optimizer choices; maintenance; trade-off read vs write. To explain it in my own words, this matters because it keeps the data correct and the queries efficient, and in my project I saw this directly when we tuned the issue table.
- L27 [06:36] **EXAMINER** _(deeper, q_cf36781cdb689777)_: Why does it work that way? What would happen if that assumption failed?
- L28 [06:42] **STUDENT** _(strong)_: The main trade-off is between read performance and write cost. For example, at scale I would measure with EXPLAIN and load tests first, because adding structure helps reads but every insert and update has to maintain it, and under high concurrency that becomes the bottleneck. An edge case is when the data is skewed so the optimizer picks a bad plan.
- L29 [07:07] **EXAMINER** _(deeper, q_cf36781cdb689777)_: Okay. How would that hold up at scale, and what would you change?
- L30 [07:13] **STUDENT** _(strong)_: Every write updates each index; storage; optimizer choices; maintenance; trade-off read vs write. To explain it in my own words, this matters because it keeps the data correct and the queries efficient, and in my project I saw this directly when we tuned the issue table.
- L31 [07:33] **EXAMINER** _(next, q_874e5ab3f957346e)_: Thank you. Why might a query that uses an index still be slow?
- L32 [07:39] **STUDENT** _(strong)_: The main trade-off is between read performance and write cost. For example, at scale I would measure with EXPLAIN and load tests first, because adding structure helps reads but every insert and update has to maintain it, and under high concurrency that becomes the bottleneck. An edge case is when the data is skewed so the optimizer picks a bad plan.
- L33 [08:05] **EXAMINER** _(deeper, q_874e5ab3f957346e)_: Okay. How would that hold up at scale, and what would you change?
- L34 [08:11] **STUDENT** _(strong)_: Low selectivity, functions on indexed column, wrong column order in composite index, stale statistics, random I/O. To explain it in my own words, this matters because it keeps the data correct and the queries efficient, and in my project I saw this directly when we tuned the issue table.
- L35 [08:32] **EXAMINER** _(deeper, q_874e5ab3f957346e)_: Good. What trade-offs or edge cases come up with that approach?
- L36 [08:37] **STUDENT** _(strong)_: The main trade-off is between read performance and write cost. For example, at scale I would measure with EXPLAIN and load tests first, because adding structure helps reads but every insert and update has to maintain it, and under high concurrency that becomes the bottleneck. An edge case is when the data is skewed so the optimizer picks a bad plan.
- L37 [09:03] **EXAMINER** _(deeper, q_874e5ab3f957346e)_: Why does it work that way? What would happen if that assumption failed?
- L38 [09:09] **STUDENT** _(strong)_: Low selectivity, functions on indexed column, wrong column order in composite index, stale statistics, random I/O. To explain it in my own words, this matters because it keeps the data correct and the queries efficient, and in my project I saw this directly when we tuned the issue table.
- L39 [09:30] **EXAMINER** _(next, q_91ac71cfe21d6013)_: Okay, noted. Explain the isolation levels, and what anomaly each one prevents.
- L40 [09:36] **STUDENT** _(strong)_: The main trade-off is between read performance and write cost. For example, at scale I would measure with EXPLAIN and load tests first, because adding structure helps reads but every insert and update has to maintain it, and under high concurrency that becomes the bottleneck. An edge case is when the data is skewed so the optimizer picks a bad plan.
- L41 [10:01] **EXAMINER** _(next, q_7eb22f53b24cc30e)_: Alright. Next, a short applied problem. Please think aloud as you reason through it. An e-commerce site's order page takes eight seconds to load, and the slow query joins orders, customers and products. Walk me through how you would find and fix the problem.
- L42 [10:19] **STUDENT** _(strong)_: EXPLAIN plan, identify full scans, add/compose indexes on join keys, check N+1, limit columns, cache, measure again. To explain it in my own words, this matters because it keeps the data correct and the queries efficient, and in my project I saw this directly when we tuned the issue table.
- L43 [10:41] **EXAMINER** _(deeper, q_7eb22f53b24cc30e)_: Good. What trade-offs or edge cases come up with that approach?
- L44 [10:46] **STUDENT** _(strong)_: The main trade-off is between read performance and write cost. For example, at scale I would measure with EXPLAIN and load tests first, because adding structure helps reads but every insert and update has to maintain it, and under high concurrency that becomes the bottleneck. An edge case is when the data is skewed so the optimizer picks a bad plan.
- L45 [11:12] **EXAMINER** _(deeper, q_7eb22f53b24cc30e)_: Why does it work that way? What would happen if that assumption failed?
- L46 [11:18] **STUDENT** _(strong)_: EXPLAIN plan, identify full scans, add/compose indexes on join keys, check N+1, limit columns, cache, measure again. To explain it in my own words, this matters because it keeps the data correct and the queries efficient, and in my project I saw this directly when we tuned the issue table.
- L47 [11:39] **EXAMINER** _(deeper, q_7eb22f53b24cc30e)_: Okay. How would that hold up at scale, and what would you change?
- L48 [11:45] **STUDENT** _(strong)_: The main trade-off is between read performance and write cost. For example, at scale I would measure with EXPLAIN and load tests first, because adding structure helps reads but every insert and update has to maintain it, and under high concurrency that becomes the bottleneck. An edge case is when the data is skewed so the optimizer picks a bad plan.
- L49 [12:11] **EXAMINER** _(next, wrapup)_: Thank you. We're almost out of time. Is there anything you'd like to add about anything we discussed?
- L50 [12:19] **STUDENT** _(partial)_: Just that I enjoyed the transactions question; I would like to learn more about MVCC.
- L51 [12:27] **EXAMINER** _(close)_: Thank you for sharing that. Thank you, that's the end of your viva. Your answers and recording are saved and will be reviewed by faculty. All the best!

## Score: 92/100

- **Conceptual understanding**: 5/5 - Heuristic from 6 answer(s) in this phase. (evidence: L4, L6, L8, L10, L12, L14)
- **Depth and reasoning**: 5/5 - Heuristic from 13 answer(s) in this phase. (evidence: L16, L18, L20, L22, L24, L26, L28, L30, L32, L34, L36, L38, L40)
- **Problem solving**: 5/5 - Heuristic from 4 answer(s) in this phase. (evidence: L42, L44, L46, L48)
- **Practical / project knowledge**: 3/5 - Project description was 53 words. (evidence: L2)
- **Communication**: 4/5 - Average answer length 53 words. (evidence: L2, L4, L6)

Feedback:
- Strongest area: conceptual understanding. (L4, L6)
- Needs most work: practical / project knowledge. (L2)
- Heuristic scoring only: a faculty member must review this viva. ()

Needs review: true Scorer reported low confidence; Scored by heuristic fallback, not the LLM
