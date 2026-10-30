const CHAT_MODEL = 'gpt-6-luna';

/**
 * Keep Luna's short chat/tool calls non-reasoning and preserve output budgets.
 * Chat Completions tool calling requires reasoning_effort: 'none' on Luna.
 * Explicit overrides retain their own model parameters.
 */
function buildChatRequest(parameters = {}) {
  const request = { model: CHAT_MODEL, ...parameters };
  if (request.model === 'gpt-6-luna') {
    request.reasoning_effort = 'none';
    if (request.max_tokens !== undefined) {
      request.max_completion_tokens ??= request.max_tokens;
      delete request.max_tokens;
    }
  }
  return request;
}

module.exports = { CHAT_MODEL, buildChatRequest };
