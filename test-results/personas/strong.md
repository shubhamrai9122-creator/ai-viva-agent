# Persona: strong

Mode: mock (rule-based interviewer, heuristic scorer)  
Simulated duration: 789 s  
Session: s_31c82e7dfae4038b

## Transcript

- L1 [00:00] **EXAMINER** _(greeting, opener)_: Hello persona-strong-1792504884478. Welcome to your Data Structures viva. I'm the AI examiner. Please confirm your student ID is persona-strong-1792504884478. The viva lasts 15 minutes in 5 short parts. I can't tell you answers or marks, and it's fine to say you don't know. Hindi or English is fine. To start: tell me about a project you built, what it did, and your part in it.
- L2 [00:26] **STUDENT** _(strong)_: I built a bus route planner for our college. I stored stops as a graph with an adjacency list, used breadth-first search with a queue to find the route with the fewest stops, and a hash map from stop names to ids so lookups are constant time on average.
- L3 [00:47] **EXAMINER** _(next, q_93103ee76bbd0e61)_: Okay, noted. Let's start with some core concepts. What is the difference between an array and a linked list?
- L4 [00:55] **STUDENT** _(strong)_: With arrays and linked lists, the main trade-off is time against memory. Array: contiguous memory, O(1) index access, costly insert/delete in the middle. At scale I would measure the complexity on real input sizes first, and an edge case is when the input is already sorted or very skewed, which can push it towards the worst case.
- L5 [01:19] **EXAMINER** _(deeper, q_93103ee76bbd0e61)_: Why does it work that way? What would happen if that assumption failed?
- L6 [01:25] **STUDENT** _(strong)_: Array: contiguous memory, O(1) index access, costly insert/delete in the middle. Linked list: nodes with pointers, O(n) access, O(1) insert/delete at a known node, grows dynamically, extra memory for pointers. To explain it in my own words, the choice matters because it decides the time and memory cost, and in my project I saw this directly with the route search.
- L7 [01:51] **EXAMINER** _(next, q_fb311fefb0667373)_: Thank you. What is a stack, and where is it used?
- L8 [01:56] **STUDENT** _(strong)_: With stacks, the main trade-off is time against memory. Last in, first out; push and pop in O(1); function call stack, undo, expression evaluation, bracket matching, depth-first search. At scale I would measure the complexity on real input sizes first, and an edge case is when the input is already sorted or very skewed, which can push it towards the worst case.
- L9 [02:22] **EXAMINER** _(deeper, q_fb311fefb0667373)_: Okay. How would that hold up at scale, and what would you change?
- L10 [02:28] **STUDENT** _(strong)_: Last in, first out; push and pop in O(1); function call stack, undo, expression evaluation, bracket matching, depth-first search. To explain it in my own words, the choice matters because it decides the time and memory cost, and in my project I saw this directly with the route search.
- L11 [02:49] **EXAMINER** _(next, q_7a4352883f1dc6dc)_: Alright. How is a queue different from a stack? Give one real use of a queue.
- L12 [02:56] **STUDENT** _(strong)_: With queues, the main trade-off is time against memory. First in, first out vs last in, first out; enqueue and dequeue; breadth-first search, CPU or printer scheduling, buffering requests. At scale I would measure the complexity on real input sizes first, and an edge case is when the input is already sorted or very skewed, which can push it towards the worst case.
- L13 [03:23] **EXAMINER** _(deeper, q_7a4352883f1dc6dc)_: Good. What trade-offs or edge cases come up with that approach?
- L14 [03:28] **STUDENT** _(strong)_: First in, first out vs last in, first out; enqueue and dequeue; breadth-first search, CPU or printer scheduling, buffering requests. To explain it in my own words, the choice matters because it decides the time and memory cost, and in my project I saw this directly with the route search.
- L15 [03:49] **EXAMINER** _(next, q_cfe25718710284a9)_: Okay, noted. Now I'd like to go deeper into arrays and linked lists. How does a dynamic array, like a Python list or Java ArrayList, grow? Why is appending still O(1) on average?
- L16 [04:03] **STUDENT** _(strong)_: With arrays and linked lists, the main trade-off is time against memory. When full it allocates a bigger array (often double) and copies; the occasional O(n) copy is spread over many appends, so amortised cost is O(1). At scale I would measure the complexity on real input sizes first, and an edge case is when the input is already sorted or very skewed, which can push it towards the worst case.
- L17 [04:33] **EXAMINER** _(deeper, q_cfe25718710284a9)_: Why does it work that way? What would happen if that assumption failed?
- L18 [04:39] **STUDENT** _(strong)_: When full it allocates a bigger array (often double) and copies; the occasional O(n) copy is spread over many appends, so amortised cost is O(1). To explain it in my own words, the choice matters because it decides the time and memory cost, and in my project I saw this directly with the route search.
- L19 [05:02] **EXAMINER** _(deeper, q_cfe25718710284a9)_: Okay. How would that hold up at scale, and what would you change?
- L20 [05:08] **STUDENT** _(strong)_: With arrays and linked lists, the main trade-off is time against memory. When full it allocates a bigger array (often double) and copies; the occasional O(n) copy is spread over many appends, so amortised cost is O(1). At scale I would measure the complexity on real input sizes first, and an edge case is when the input is already sorted or very skewed, which can push it towards the worst case.
- L21 [05:37] **EXAMINER** _(deeper, q_cfe25718710284a9)_: Good. What trade-offs or edge cases come up with that approach?
- L22 [05:43] **STUDENT** _(strong)_: When full it allocates a bigger array (often double) and copies; the occasional O(n) copy is spread over many appends, so amortised cost is O(1). To explain it in my own words, the choice matters because it decides the time and memory cost, and in my project I saw this directly with the route search.
- L23 [06:06] **EXAMINER** _(next, q_6d41e8e6fd11d2e1)_: Alright. Why can a hash table's lookup slow down from O(1) to O(n), and how do you prevent it?
- L24 [06:14] **STUDENT** _(strong)_: With hashing, the main trade-off is time against memory. Many collisions from a poor hash function or a high load factor; use a good hash function, resize and rehash around load factor 0. At scale I would measure the complexity on real input sizes first, and an edge case is when the input is already sorted or very skewed, which can push it towards the worst case.
- L25 [06:42] **EXAMINER** _(deeper, q_6d41e8e6fd11d2e1)_: Good. What trade-offs or edge cases come up with that approach?
- L26 [06:47] **STUDENT** _(strong)_: Many collisions from a poor hash function or a high load factor; use a good hash function, resize and rehash around load factor 0.75, or use balanced trees in buckets. To explain it in my own words, the choice matters because it decides the time and memory cost, and in my project I saw this directly with the route search.
- L27 [07:13] **EXAMINER** _(deeper, q_6d41e8e6fd11d2e1)_: Why does it work that way? What would happen if that assumption failed?
- L28 [07:19] **STUDENT** _(strong)_: With hashing, the main trade-off is time against memory. Many collisions from a poor hash function or a high load factor; use a good hash function, resize and rehash around load factor 0. At scale I would measure the complexity on real input sizes first, and an edge case is when the input is already sorted or very skewed, which can push it towards the worst case.
- L29 [07:47] **EXAMINER** _(deeper, q_6d41e8e6fd11d2e1)_: Okay. How would that hold up at scale, and what would you change?
- L30 [07:53] **STUDENT** _(strong)_: Many collisions from a poor hash function or a high load factor; use a good hash function, resize and rehash around load factor 0.75, or use balanced trees in buckets. To explain it in my own words, the choice matters because it decides the time and memory cost, and in my project I saw this directly with the route search.
- L31 [08:18] **EXAMINER** _(next, q_f570ed87c79b4e01)_: Thank you. What is a hash table, and what is a collision?
- L32 [08:24] **STUDENT** _(strong)_: With hashing, the main trade-off is time against memory. Maps keys to bucket indexes with a hash function; average O(1) lookup; a collision is two keys mapping to the same bucket; handled by chaining or open addressing. At scale I would measure the complexity on real input sizes first, and an edge case is when the input is already sorted or very skewed, which can push it towards the worst case.
- L33 [08:53] **EXAMINER** _(deeper, q_f570ed87c79b4e01)_: Okay. How would that hold up at scale, and what would you change?
- L34 [08:59] **STUDENT** _(strong)_: Maps keys to bucket indexes with a hash function; average O(1) lookup; a collision is two keys mapping to the same bucket; handled by chaining or open addressing. To explain it in my own words, the choice matters because it decides the time and memory cost, and in my project I saw this directly with the route search.
- L35 [09:24] **EXAMINER** _(deeper, q_f570ed87c79b4e01)_: Good. What trade-offs or edge cases come up with that approach?
- L36 [09:29] **STUDENT** _(strong)_: With hashing, the main trade-off is time against memory. Maps keys to bucket indexes with a hash function; average O(1) lookup; a collision is two keys mapping to the same bucket; handled by chaining or open addressing. At scale I would measure the complexity on real input sizes first, and an edge case is when the input is already sorted or very skewed, which can push it towards the worst case.
- L37 [09:58] **EXAMINER** _(next, q_3ea27171a29f48ce)_: Thank you. Why does an unbalanced binary search tree become slow, and how do AVL or red-black trees fix it?
- L38 [10:07] **STUDENT** _(strong)_: Inserting sorted data makes it a linked list with O(n) height; self-balancing trees use rotations to keep the height O(log n). To explain it in my own words, the choice matters because it decides the time and memory cost, and in my project I saw this directly with the route search.
- L39 [10:29] **EXAMINER** _(next, q_67ce4df1779fc752)_: Okay, noted. Next, a short applied problem. Please think aloud as you reason through it. How would you check whether the brackets in an expression like {[()]} are balanced?
- L40 [10:41] **STUDENT** _(strong)_: With stacks, the main trade-off is time against memory. Scan left to right; push opening brackets; on a closing bracket pop and check it matches; the stack must be empty at the end; O(n). At scale I would measure the complexity on real input sizes first, and an edge case is when the input is already sorted or very skewed, which can push it towards the worst case.
- L41 [11:09] **EXAMINER** _(deeper, q_67ce4df1779fc752)_: Why does it work that way? What would happen if that assumption failed?
- L42 [11:15] **STUDENT** _(strong)_: Scan left to right; push opening brackets; on a closing bracket pop and check it matches; the stack must be empty at the end; O(n). To explain it in my own words, the choice matters because it decides the time and memory cost, and in my project I saw this directly with the route search.
- L43 [11:39] **EXAMINER** _(deeper, q_67ce4df1779fc752)_: Okay. How would that hold up at scale, and what would you change?
- L44 [11:45] **STUDENT** _(strong)_: With stacks, the main trade-off is time against memory. Scan left to right; push opening brackets; on a closing bracket pop and check it matches; the stack must be empty at the end; O(n). At scale I would measure the complexity on real input sizes first, and an edge case is when the input is already sorted or very skewed, which can push it towards the worst case.
- L45 [12:13] **EXAMINER** _(deeper, q_67ce4df1779fc752)_: Good. What trade-offs or edge cases come up with that approach?
- L46 [12:18] **STUDENT** _(strong)_: Scan left to right; push opening brackets; on a closing bracket pop and check it matches; the stack must be empty at the end; O(n). To explain it in my own words, the choice matters because it decides the time and memory cost, and in my project I saw this directly with the route search.
- L47 [12:42] **EXAMINER** _(next, wrapup)_: Alright. We're almost out of time. Is there anything you'd like to add about anything we discussed?
- L48 [12:49] **STUDENT** _(partial)_: Just that I enjoyed the graph question; I would like to learn Dijkstra with a heap properly.
- L49 [12:58] **EXAMINER** _(close)_: Thank you for sharing that. Thank you, that's the end of your viva. Your answers and recording are saved and will be reviewed by faculty. All the best!

## Score: 92/100

- **Conceptual understanding**: 5/5 - Heuristic from 6 answer(s) in this phase. (evidence: L4, L6, L8, L10, L12, L14)
- **Depth and reasoning**: 5/5 - Heuristic from 12 answer(s) in this phase. (evidence: L16, L18, L20, L22, L24, L26, L28, L30, L32, L34, L36, L38)
- **Problem solving**: 5/5 - Heuristic from 4 answer(s) in this phase. (evidence: L40, L42, L44, L46)
- **Practical / project knowledge**: 3/5 - Project description was 49 words. (evidence: L2)
- **Communication**: 4/5 - Average answer length 59 words. (evidence: L2, L4, L6)

Feedback:
- Strongest area: conceptual understanding. (L4, L6)
- Needs most work: practical / project knowledge. (L2)
- Heuristic scoring only: a faculty member must review this viva. ()

Needs review: true Scorer reported low confidence; Scored by heuristic fallback, not the LLM
