/**
 * Claude format handler
 * Handles /v1/messages with streaming and non-streaming responses
 */

import { generateAssistantResponse, generateAssistantResponseNoStream } from '../../api/client.js';
import { generateClaudeRequestBody, prepareImageRequest } from '../../utils/utils.js';
import { normalizeClaudeParameters } from '../../utils/parameterNormalizer.js';
import { buildClaudeErrorPayload } from '../../utils/errors.js';
import logger from '../../utils/logger.js';
import config from '../../config/config.js';
import tokenManager from '../../auth/token_manager.js';
import { createClaudeResponse } from '../formatters/claude.js';
import { validateIncomingChatRequest } from '../validators/chat.js';
import { getSafeRetries } from './common/retry.js';
import {
  setStreamHeaders,
  createHeartbeat,
  with429Retry
} from '../stream.js';

/**
 * Create Claude streaming event
 * @param {string} eventType - event type
 * @param {Object} data - event payload
 * @returns {string}
 */
export const createClaudeStreamEvent = (eventType, data) => {
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
};

/**
 * Create Claude non-stream response
 * @param {string} id - message ID
 * @param {string} model - model name
 * @param {string|null} content - text content
 * @param {string|null} reasoning - chain-of-thought content
 * @param {string|null} reasoningSignature - chain-of-thought signature
 * @param {Array|null} toolCalls - tool calls
 * @param {string} stopReason - stop reason
 * @param {Object|null} usage - usage stats
 * @returns {Object}
 */

/**
 * Handle Claude chat requests
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 * @param {boolean} isStream - streaming response
 */
export const handleClaudeRequest = async (req, res, isStream) => {
  const body = req.body || {};
  const { messages, model, system, tools, ...rawParams } = body;

  try {
    const validation = validateIncomingChatRequest('claude', body);
    if (!validation.ok) {
      return res.status(validation.status).json(buildClaudeErrorPayload({ message: validation.message }, validation.status));
    }
    if (typeof model !== 'string' || !model) {
      return res.status(400).json(buildClaudeErrorPayload({ message: 'model is required' }, 400));
    }

    const token = await tokenManager.getToken(model);
    if (!token) {
      throw new Error('No available token. Run npm run login to add one.');
    }

    // Normalize Claude format parameters via shared module
    const parameters = normalizeClaudeParameters(rawParams);

    const isImageModel = model.includes('-image');
    const requestBody = generateClaudeRequestBody(messages, model, parameters, tools, system, token);

    if (isImageModel) {
      prepareImageRequest(requestBody);
    }

    const msgId = `msg_${Date.now()}`;
    const safeRetries = getSafeRetries(config.retryTimes);

    if (isStream) {
      setStreamHeaders(res);
      const heartbeatTimer = createHeartbeat(res);

      try {
        let contentIndex = 0;
        let usageData = null;
        let hasToolCall = false;
        let currentBlockType = null;
        let reasoningSent = false;

        // Send message_start
        res.write(createClaudeStreamEvent('message_start', {
          type: "message_start",
          message: {
            id: msgId,
            type: "message",
            role: "assistant",
            content: [],
            model: model,
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 }
          }
        }));

        if (isImageModel) {
          // Image models: use non-stream fetch and return as streaming
          const { content, usage } = await with429Retry(
            () => generateAssistantResponseNoStream(requestBody, token),
            safeRetries,
            'claude.stream.image ',
            () => tokenManager.recordRequest(token, model)
          );

          // Send text block
          res.write(createClaudeStreamEvent('content_block_start', {
            type: "content_block_start",
            index: 0,
            content_block: { type: "text", text: "" }
          }));
          res.write(createClaudeStreamEvent('content_block_delta', {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: content || '' }
          }));
          res.write(createClaudeStreamEvent('content_block_stop', {
            type: "content_block_stop",
            index: 0
          }));

          // Send message_delta and message_stop
          res.write(createClaudeStreamEvent('message_delta', {
            type: "message_delta",
            delta: { stop_reason: 'end_turn', stop_sequence: null },
            usage: usage ? { output_tokens: usage.completion_tokens || 0 } : { output_tokens: 0 }
          }));
          res.write(createClaudeStreamEvent('message_stop', {
            type: "message_stop"
          }));

          clearInterval(heartbeatTimer);
          res.end();
          return;
        }

        await with429Retry(
          () => generateAssistantResponse(requestBody, token, (data) => {
            if (data.type === 'usage') {
              usageData = data.usage;
            } else if (data.type === 'reasoning') {
              // Chain-of-thought content - use thinking type
              if (!reasoningSent) {
                // If a text block was sent, close it first
                if (currentBlockType === 'text') {
                  res.write(createClaudeStreamEvent('content_block_stop', {
                    type: "content_block_stop",
                    index: contentIndex
                  }));
                  contentIndex++;
                  currentBlockType = null;
                }
                // Start thinking block
                const contentBlock = { type: "thinking", thinking: "" };
                if (data.thoughtSignature && config.passSignatureToClient) {
                  contentBlock.signature = data.thoughtSignature;
                }
                res.write(createClaudeStreamEvent('content_block_start', {
                  type: "content_block_start",
                  index: contentIndex,
                  content_block: contentBlock
                }));
                currentBlockType = 'thinking';
                reasoningSent = true;
              }
              // Send thinking delta
              const delta = { type: "thinking_delta", thinking: data.reasoning_content || '' };
              if (data.thoughtSignature && config.passSignatureToClient) {
                delta.signature = data.thoughtSignature;
              }
              res.write(createClaudeStreamEvent('content_block_delta', {
                type: "content_block_delta",
                index: contentIndex,
                delta: delta
              }));
            } else if (data.type === 'tool_calls') {
              hasToolCall = true;
              // End previous block (if any)
              if (currentBlockType) {
                res.write(createClaudeStreamEvent('content_block_stop', {
                  type: "content_block_stop",
                  index: contentIndex
                }));
                contentIndex++;
              }
              // Tool call
              for (const tc of data.tool_calls) {
                try {
                  const inputObj = JSON.parse(tc.function.arguments);
                  const toolContentBlock = { type: "tool_use", id: tc.id, name: tc.function.name, input: {} };
                  if (tc.thoughtSignature && config.passSignatureToClient) {
                    toolContentBlock.signature = tc.thoughtSignature;
                  }
                  res.write(createClaudeStreamEvent('content_block_start', {
                    type: "content_block_start",
                    index: contentIndex,
                    content_block: toolContentBlock
                  }));
                  // Send input delta
                  res.write(createClaudeStreamEvent('content_block_delta', {
                    type: "content_block_delta",
                    index: contentIndex,
                    delta: { type: "input_json_delta", partial_json: JSON.stringify(inputObj) }
                  }));
                  res.write(createClaudeStreamEvent('content_block_stop', {
                    type: "content_block_stop",
                    index: contentIndex
                  }));
                  contentIndex++;
                } catch (e) {
                  // Parse failed, skip
                }
              }
              currentBlockType = null;
            } else {
              // Plain text content
              const textContent = data.content || '';

              // If thinking not sent and content empty, skip (avoid empty text block before thinking)
              if (!reasoningSent && !textContent) {
                return;
              }

              if (currentBlockType === 'thinking') {
                // End thinking block
                res.write(createClaudeStreamEvent('content_block_stop', {
                  type: "content_block_stop",
                  index: contentIndex
                }));
                contentIndex++;
                currentBlockType = null;
              }
              if (currentBlockType !== 'text') {
                // Start text block
                res.write(createClaudeStreamEvent('content_block_start', {
                  type: "content_block_start",
                  index: contentIndex,
                  content_block: { type: "text", text: "" }
                }));
                currentBlockType = 'text';
              }
              // Send text delta
              res.write(createClaudeStreamEvent('content_block_delta', {
                type: "content_block_delta",
                index: contentIndex,
                delta: { type: "text_delta", text: textContent }
              }));
            }
          }),
          safeRetries,
          'claude.stream ',
          () => tokenManager.recordRequest(token, model)
        );

        // End last content block
        if (currentBlockType) {
          res.write(createClaudeStreamEvent('content_block_stop', {
            type: "content_block_stop",
            index: contentIndex
          }));
        }

        // Send message_delta
        const stopReason = hasToolCall ? 'tool_use' : 'end_turn';
        res.write(createClaudeStreamEvent('message_delta', {
          type: "message_delta",
          delta: { stop_reason: stopReason, stop_sequence: null },
          usage: usageData ? { output_tokens: usageData.completion_tokens || 0 } : { output_tokens: 0 }
        }));

        // Send message_stop
        res.write(createClaudeStreamEvent('message_stop', {
          type: "message_stop"
        }));

        clearInterval(heartbeatTimer);
        res.end();
      } catch (error) {
        clearInterval(heartbeatTimer);
        if (!res.writableEnded) {
          const statusCode = error.statusCode || error.status || 500;
          res.write(createClaudeStreamEvent('error', buildClaudeErrorPayload(error, statusCode)));
          res.end();
        }
        logger.error('Claude streaming request failed:', error.message);
        return;
      }
    } else if (config.fakeNonStream && !isImageModel) {
      // Pseudo-non-stream: use streaming API and assemble non-stream response
      req.setTimeout(0);
      res.setTimeout(0);

      let content = '';
      let reasoningContent = '';
      let reasoningSignature = null;
      const toolCalls = [];
      let usageData = null;

      try {
        await with429Retry(
          () => generateAssistantResponse(requestBody, token, (data) => {
            if (data.type === 'usage') {
              usageData = data.usage;
            } else if (data.type === 'reasoning') {
              reasoningContent += data.reasoning_content || '';
              if (data.thoughtSignature) {
                reasoningSignature = data.thoughtSignature;
              }
            } else if (data.type === 'tool_calls') {
              toolCalls.push(...data.tool_calls);
            } else if (data.type === 'text') {
              content += data.content || '';
            }
          }),
          safeRetries,
          'claude.fake_no_stream ',
          () => tokenManager.recordRequest(token, model)
        );

        const stopReason = toolCalls.length > 0 ? 'tool_use' : 'end_turn';
        const response = createClaudeResponse(
          msgId,
          model,
          content,
          reasoningContent || null,
          reasoningSignature,
          toolCalls,
          stopReason,
          usageData,
          { passSignatureToClient: config.passSignatureToClient }
        );

        res.json(response);
      } catch (error) {
        logger.error('Claude pseudo-non-stream request failed:', error.message);
        if (res.headersSent) return;
        const statusCode = error.statusCode || error.status || 500;
        res.status(statusCode).json(buildClaudeErrorPayload(error, statusCode));
      }
    } else {
      // Non-stream request
      req.setTimeout(0);
      res.setTimeout(0);

      const { content, reasoningContent, reasoningSignature, toolCalls, usage } = await with429Retry(
        () => generateAssistantResponseNoStream(requestBody, token),
        safeRetries,
        'claude.no_stream ',
        () => tokenManager.recordRequest(token, model)
      );

      const stopReason = toolCalls.length > 0 ? 'tool_use' : 'end_turn';
      const response = createClaudeResponse(
        msgId,
        model,
        content,
        reasoningContent,
        reasoningSignature,
        toolCalls,
        stopReason,
        usage,
        { passSignatureToClient: config.passSignatureToClient }
      );

      res.json(response);
    }
  } catch (error) {
    logger.error('Claude request failed:', error.message);
    if (res.headersSent) return;
    const statusCode = error.statusCode || error.status || 500;
    res.status(statusCode).json(buildClaudeErrorPayload(error, statusCode));
  }
};
