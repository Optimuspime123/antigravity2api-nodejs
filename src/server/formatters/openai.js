/**
 * OpenAI response formatter
 * Reuse object pool to reduce GC pressure
 */

import { getChunkObject } from '../stream.js';

/**
 * Create OpenAI streaming chunk
 * @param {string} id
 * @param {number} created
 * @param {string} model
 * @param {Object} delta
 * @param {string|null} finish_reason
 * @returns {Object}
 */
export const createOpenAIStreamChunk = (id, created, model, delta, finish_reason = null) => {
  const chunk = getChunkObject();
  chunk.id = id;
  chunk.object = 'chat.completion.chunk';
  chunk.created = created;
  chunk.model = model;
  chunk.choices[0].delta = delta;
  chunk.choices[0].finish_reason = finish_reason;
  return chunk;
};

/**
 * Create OpenAI non-stream chat.completion response
 * @param {{
 *   id: string,
 *   created: number,
 *   model: string,
 *   content: string|null,
 *   reasoningContent?: string|null,
 *   reasoningSignature?: string|null,
 *   toolCalls?: Array|null,
 *   usage?: Object|null,
 *   passSignatureToClient?: boolean,
 *   stripToolCallSignature?: boolean
 * }} args
 * @returns {Object}
 */
export const createOpenAIChatCompletionResponse = (args) => {
  const {
    id,
    created,
    model,
    content,
    reasoningContent = null,
    reasoningSignature = null,
    toolCalls = null,
    usage = null,
    passSignatureToClient = false,
    stripToolCallSignature = true
  } = args;

  const message = { role: 'assistant' };

  if (reasoningContent) message.reasoning_content = reasoningContent;
  if (reasoningSignature && passSignatureToClient) message.thoughtSignature = reasoningSignature;
  message.content = content;

  if (toolCalls && toolCalls.length > 0) {
    if (stripToolCallSignature) {
      message.tool_calls = toolCalls.map(({ thoughtSignature, ...rest }) => rest);
    } else {
      message.tool_calls = toolCalls;
    }
  }

  return {
    id,
    object: 'chat.completion',
    created,
    model,
    choices: [{
      index: 0,
      message,
      finish_reason: (toolCalls && toolCalls.length > 0) ? 'tool_calls' : 'stop'
    }],
    usage
  };
};
