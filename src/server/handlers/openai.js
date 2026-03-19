/**
 * OpenAI format handler
 * Handles /v1/chat/completions with streaming and non-streaming responses
 */

import { generateAssistantResponse, generateAssistantResponseNoStream, getModelsWithQuotas } from '../../api/client.js';
import { generateRequestBody, prepareImageRequest } from '../../utils/utils.js';
import { buildOpenAIErrorPayload } from '../../utils/errors.js';
import logger from '../../utils/logger.js';
import config from '../../config/config.js';
import tokenManager from '../../auth/token_manager.js';
import quotaManager from '../../auth/quota_manager.js';
import {
  createOpenAIStreamChunk as createStreamChunk,
  createOpenAIChatCompletionResponse
} from '../formatters/openai.js';
import { validateIncomingChatRequest } from '../validators/chat.js';
import { getSafeRetries } from './common/retry.js';
import {
  createResponseMeta,
  setStreamHeaders,
  createHeartbeat,
  writeStreamData,
  endStream,
  with429Retry
} from '../stream.js';

/**
 * Handle OpenAI chat requests
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 */
export const handleOpenAIRequest = async (req, res) => {
  const body = req.body || {};
  const { messages, model, stream = false, tools, ...params } = body;

  try {
    const validation = validateIncomingChatRequest('openai', body);
    if (!validation.ok) {
      return res.status(validation.status).json({ error: validation.message });
    }
    if (typeof model !== 'string' || !model) {
      return res.status(400).json({ error: 'model is required' });
    }

    const token = await tokenManager.getToken(model);
    if (!token) {
      throw new Error('No available token. Run npm run login to add one.');
    }

    // Get tokenId for cooldown state management (must await for salt initialization)
    const tokenId = await tokenManager.getTokenId(token);

    // 创建刷新额度的回调函数
    const refreshQuota = async () => {
      if (!tokenId) return;
      const quotas = await getModelsWithQuotas(token);
      quotaManager.updateQuota(tokenId, quotas);
    };

    // 创建 with429Retry 选项
    const createRetryOptions = (prefix) => ({
      loggerPrefix: prefix,
      onAttempt: () => tokenManager.recordRequest(token, model),
      tokenId,
      modelId: model,
      refreshQuota
    });

    const isImageModel = model.includes('-image');
    const requestBody = generateRequestBody(messages, model, params, tools, token);

    if (isImageModel) {
      prepareImageRequest(requestBody);
    }
    //console.log(JSON.stringify(requestBody,null,2));
    const { id, created } = createResponseMeta();
    const safeRetries = getSafeRetries(config.retryTimes);

    if (stream) {
      setStreamHeaders(res);

      // Start heartbeat to avoid Cloudflare timeout disconnects
      const heartbeatTimer = createHeartbeat(res);

      try {
        if (isImageModel) {
          const { content, usage, reasoningSignature } = await with429Retry(
            () => generateAssistantResponseNoStream(requestBody, token),
            safeRetries,
            createRetryOptions('chat.stream.image ')
          );
          const delta = { content };
          if (reasoningSignature && config.passSignatureToClient) {
            delta.thoughtSignature = reasoningSignature;
          }
          writeStreamData(res, createStreamChunk(id, created, model, delta));
          writeStreamData(res, { ...createStreamChunk(id, created, model, {}, 'stop'), usage });
        } else {
          let hasToolCall = false;
          let usageData = null;

          await with429Retry(
            () => generateAssistantResponse(requestBody, token, (data) => {
              if (data.type === 'usage') {
                usageData = data.usage;
              } else if (data.type === 'reasoning') {
                const delta = { reasoning_content: data.reasoning_content };
                if (data.thoughtSignature && config.passSignatureToClient) {
                  delta.thoughtSignature = data.thoughtSignature;
                }
                writeStreamData(res, createStreamChunk(id, created, model, delta));
              } else if (data.type === 'tool_calls') {
                hasToolCall = true;
                // Decide whether to pass through tool-call signatures
                const toolCallsWithIndex = data.tool_calls.map((toolCall, index) => {
                  if (config.passSignatureToClient) {
                    return { index, ...toolCall };
                  } else {
                    const { thoughtSignature, ...rest } = toolCall;
                    return { index, ...rest };
                  }
                });
                const delta = { tool_calls: toolCallsWithIndex };
                writeStreamData(res, createStreamChunk(id, created, model, delta));
              } else {
                const delta = { content: data.content };
                writeStreamData(res, createStreamChunk(id, created, model, delta));
              }
            }),
            safeRetries,
            createRetryOptions('chat.stream ')
          );

          writeStreamData(res, { ...createStreamChunk(id, created, model, {}, hasToolCall ? 'tool_calls' : 'stop'), usage: usageData });
        }

        clearInterval(heartbeatTimer);
        endStream(res);
      } catch (error) {
        clearInterval(heartbeatTimer);
        if (!res.writableEnded) {
          const statusCode = error.statusCode || error.status || 500;
          writeStreamData(res, buildOpenAIErrorPayload(error, statusCode));
          endStream(res);
        }
        logger.error('Failed to generate response:', error.message);
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
          createRetryOptions('chat.fake_no_stream ')
        );

        // Build non-stream response
        const message = { role: 'assistant' };
        if (reasoningContent) message.reasoning_content = reasoningContent;
        if (reasoningSignature && config.passSignatureToClient) message.thoughtSignature = reasoningSignature;
        message.content = content;

        if (toolCalls.length > 0) {
          if (config.passSignatureToClient) {
            message.tool_calls = toolCalls;
          } else {
            message.tool_calls = toolCalls.map(({ thoughtSignature, ...rest }) => rest);
          }
        }

        res.json(createOpenAIChatCompletionResponse({
          id,
          created,
          model,
          content,
          reasoningContent,
          reasoningSignature,
          toolCalls,
          usage: usageData,
          passSignatureToClient: config.passSignatureToClient,
          stripToolCallSignature: !config.passSignatureToClient
        }));
      } catch (error) {
        logger.error('Pseudo-non-stream response generation failed:', error.message);
        if (res.headersSent) return;
        const statusCode = error.statusCode || error.status || 500;
        return res.status(statusCode).json(buildOpenAIErrorPayload(error, statusCode));
      }
    } else {
      // Non-stream request: disable timeouts for large model responses
      req.setTimeout(0); // Disable request timeout
      res.setTimeout(0); // Disable response timeout

      const { content, reasoningContent, reasoningSignature, toolCalls, usage } = await with429Retry(
        () => generateAssistantResponseNoStream(requestBody, token),
        safeRetries,
        createRetryOptions('chat.no_stream ')
      );

      // DeepSeek format: reasoning_content precedes content
      const message = { role: 'assistant' };
      if (reasoningContent) message.reasoning_content = reasoningContent;
      if (reasoningSignature && config.passSignatureToClient) message.thoughtSignature = reasoningSignature;
      message.content = content;

      if (toolCalls.length > 0) {
        // Decide whether to pass through tool-call signatures
        if (config.passSignatureToClient) {
          message.tool_calls = toolCalls;
        } else {
          message.tool_calls = toolCalls.map(({ thoughtSignature, ...rest }) => rest);
        }
      }

      // Use prebuilt response object to reduce allocations
      res.json(createOpenAIChatCompletionResponse({
        id,
        created,
        model,
        content,
        reasoningContent,
        reasoningSignature,
        toolCalls,
        usage,
        passSignatureToClient: config.passSignatureToClient,
        stripToolCallSignature: !config.passSignatureToClient
      }));
    }
  } catch (error) {
    logger.error('Failed to generate response:', error.message);
    if (res.headersSent) return;
    const statusCode = error.statusCode || error.status || 500;
    return res.status(statusCode).json(buildOpenAIErrorPayload(error, statusCode));
  }
};
