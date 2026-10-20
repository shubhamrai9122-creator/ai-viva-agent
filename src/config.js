// Viva structure and rubric defaults. Faculty can override phase timings per viva.
export const DEFAULT_PHASES = [
  { key: 'warmup', label: 'Warm-up', seconds: 60, goal: 'Greet, confirm identity, explain rules, one easy opener about a project they built.' },
  { key: 'fundamentals', label: 'Fundamentals', seconds: 240, goal: '2-3 core concept questions from the bank, at most one follow-up each.' },
  { key: 'depth', label: 'Depth', seconds: 300, goal: "Probe the student's strongest area with why / what-if follow-ups." },
  { key: 'applied', label: 'Applied problem', seconds: 180, goal: 'One short scenario or debugging question; the student reasons aloud.' },
  { key: 'wrapup', label: 'Wrap-up', seconds: 90, goal: 'Ask if the student wants to add anything; close politely.' },
];
// Interview phases sum to 14:30; the last 30 s of the 15-minute slot is the scoring hand-off.
export const SLOT_SECONDS = 900;

export const DEFAULT_RUBRIC = [
  { key: 'conceptual', label: 'Conceptual understanding', weight: 30, five: 'Explains core concepts correctly in their own words' },
  { key: 'depth', label: 'Depth and reasoning', weight: 25, five: 'Handles follow-ups, explains trade-offs and "why"' },
  { key: 'problem_solving', label: 'Problem solving', weight: 20, five: 'Breaks the applied problem into steps, reaches a sound approach' },
  { key: 'practical', label: 'Practical / project knowledge', weight: 15, five: 'Speaks concretely about what they built and how' },
  { key: 'communication', label: 'Communication', weight: 10, five: 'Clear, structured, concise answers' },
];

// Quick format (the default): a fixed number of questions, each with its own answer time.
export const QUICK_DEFAULTS = { questionCount: 5, secondsPerQuestion: 60 };
// No project-talk question in the quick format, so practical knowledge isn't scored there.
export const QUICK_RUBRIC = [
  { key: 'conceptual', label: 'Conceptual understanding', weight: 40, five: 'Explains core concepts correctly in their own words' },
  { key: 'depth', label: 'Depth and reasoning', weight: 25, five: 'Explains trade-offs, complexity and "why"' },
  { key: 'problem_solving', label: 'Problem solving', weight: 25, five: 'Breaks the applied problem into steps, reaches a sound approach' },
  { key: 'communication', label: 'Communication', weight: 10, five: 'Clear, structured, concise answers' },
];

export const MAX_ANSWER_SECONDS = 90;

// Follow-up budget per question, by phase.
export const FOLLOWUP_LIMIT = { warmup: 1, fundamentals: 1, depth: 3, applied: 3, wrapup: 0 };
export const FUNDAMENTALS_QUESTIONS = 3;

export const env = {
  apiKey: process.env.ANTHROPIC_API_KEY || '',
  interviewerModel: process.env.INTERVIEWER_MODEL || 'claude-haiku-5-5',
  scorerModel: process.env.SCORER_MODEL || 'claude-opus-5-5',
  scorerEffort: process.env.SCORER_EFFORT || 'high',
  facultyKey: process.env.FACULTY_PASSCODE || 'faculty123',
  scoringConcurrency: Number(process.env.SCORING_CONCURRENCY || 4),
  port: Number(process.env.PORT || 3000),
};
// Mock mode: no API key (or LLM_MODE=mock) -> deterministic rule-based interviewer and scorer.
export const MOCK = process.env.LLM_MODE === 'mock' || !env.apiKey;
