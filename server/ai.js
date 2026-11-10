'use strict';
// Thin client for an OpenAI-compatible chat completions API.
// Configured with AI_API_KEY (required), AI_BASE_URL and AI_MODEL (optional).
// Without AI_API_KEY every call fails with code AI_NOT_CONFIGURED, and the UI
// tells the user to add the key instead of pretending an answer exists.

const BASE_URL = String(process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const MODEL = process.env.AI_MODEL || 'gpt-4o-mini';
const KEY = String(process.env.AI_API_KEY || '').trim();

function isConfigured() {
  return Boolean(KEY);
}

async function chat(messages, opts = {}) {
  if (!KEY) {
    const err = new Error('AI_NOT_CONFIGURED');
    err.code = 'AI_NOT_CONFIGURED';
    throw err;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || 30000);
  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model: MODEL,
        temperature: opts.temperature === undefined ? 0.4 : opts.temperature,
        max_tokens: opts.maxTokens || 700,
        messages,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 300);
      const err = new Error(`AI provider ${res.status}: ${text}`);
      err.code = 'AI_PROVIDER';
      throw err;
    }
    const data = await res.json();
    const choice = data && Array.isArray(data.choices) ? data.choices[0] : null;
    return String((choice && choice.message && choice.message.content) || '').trim();
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { isConfigured, chat, MODEL };
