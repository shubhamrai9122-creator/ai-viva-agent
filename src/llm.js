// Thin wrapper over the Anthropic SDK: JSON-schema structured output, retries with
// backoff on throttling/overload, and a hard timeout so a live viva never hangs.
import Anthropic from '@anthropic-ai/sdk';
import { env } from './config.js';

let client = null;
function getClient() {
  if (!client) client = new Anthropic({ apiKey: env.apiKey, maxRetries: 0 });
  return client;
}

// Claude Opus 5.5 / Sonnet 5.5 / Haiku 5.5 reject non-default sampling params.
// Older models (e.g. claude-sonnet-4-6) honour temperature 0, so we send it when allowed.
const SUPPORTS_TEMPERATURE = /claude-(sonnet|opus)-4-6|claude-haiku-4-5/;
const SUPPORTS_FALLBACKS = /claude-(opus-5-5|opus-5|sonnet-5-5|fable-5-1)$/;

export const stats = { calls: 0, errors: 0, retries: 0, rateLimited: 0 };

/**
 * Call Claude and return parsed JSON matching `schema`.
 * opts: { model, system, user, schema, maxTokens, effort, timeoutMs, attempts, temperature0 }
 */
export async function callJSON(opts) {
  const { model, system, user, schema, maxTokens = 2000, effort, timeoutMs = 20000, attempts = 3, temperature0 = false } = opts;
  const body = {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
    output_config: { format: { type: 'json_schema', schema }, ...(effort ? { effort } : {}) },
  };
  if (/haiku-5-5/.test(model) && effort && effort !== 'xhigh' && effort !== 'max') body.thinking = { type: 'disabled' };
  if (temperature0 && SUPPORTS_TEMPERATURE.test(model)) body.temperature = 0;

  let lastErr;
  for (let i = 0; i < attempts; i++) {
    stats.calls++;
    try {
      let res;
      if (SUPPORTS_FALLBACKS.test(model)) {
        res = await getClient().beta.messages.create(
          { ...body, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' },
          { timeout: timeoutMs });
      } else {
        res = await getClient().messages.create(body, { timeout: timeoutMs });
      }
      if (res.stop_reason === 'refusal') throw new Error('model_refusal');
      const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
      return { data: JSON.parse(text), model: res.model, usage: res.usage };
    } catch (err) {
      lastErr = err;
      const status = err?.status;
      if (status === 429) stats.rateLimited++;
      const retryable = status === 429 || status === 529 || (status >= 500) || err instanceof Anthropic.APIConnectionError || err instanceof Anthropic.APIConnectionTimeoutError;
      if (!retryable || i === attempts - 1) break;
      stats.retries++;
      const retryAfter = Number(err?.headers?.get?.('retry-after')) || 0;
      await new Promise(r => setTimeout(r, Math.max(retryAfter * 1000, 400 * 2 ** i) + Math.random() * 200));
    }
  }
  stats.errors++;
  throw lastErr;
}
