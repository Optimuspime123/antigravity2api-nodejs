/**
 * Gemini format handler
 * Handles /v1beta/models/* requests with streaming and non-streaming responses
 */

import { generateAssistantResponse, generateAssistantResponseNoStream, getAvailableModels, getModelsWithQuotas } from '../../api/client.js';
import { generateGeminiRequestBody, prepareImageRequest } from '../../utils/utils.js';
import { buildGeminiErrorPayload } from '../../utils/errors.js';
import logger from '../../utils/logger.js';
import config from '../../config/config.js';
import tokenManager from '../../auth/token_manager.js';
import quotaManager from '../../auth/quota_manager.js';
import { createGeminiResponse } from '../formatters/gemini.js';
import { validateIncomingChatRequest } from '../validators/chat.js';
import { getSafeRetries } from './common/retry.js';
import {
  setStreamHeaders,
  createHeartbeat,
  writeStreamData,
  endStream,
  with429Retry
} from '../stream.js';

/**
 * Convert OpenAI model list to Gemini format
 * @param {Object} openaiModels - OpenAI format model list
 * @returns {Object}
 */
export const convertToGeminiModelList = (openaiModels) => {
  const models = openaiModels.data.map(model => ({
    name: `models/${model.id}`,
    version: "001",
    displayName: model.id,
    description: "Imported model",
    inputTokenLimit: 32768, // default value
    outputTokenLimit: 8192, // default value
    supportedGenerationMethods: ["generateContent", "countTokens"],
    temperature: 0.9,
    topP: 1.0,
    topK: 40
  }));
  return { models };
};

/**
 * Get Gemini model list
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 */
export const handleGeminiModelsList = async (req, res) => {
  try {
    const openaiModels = await getAvailableModels();
    const geminiModels = convertToGeminiModelList(openaiModels);
    res.json(geminiModels);
  } catch (error) {
    logger.error('Failed to fetch model list:', error.message);
    res.status(500).json({ error: { code: 500, message: error.message, status: "INTERNAL" } });
  }
};

/**
 * Get single model detail (Gemini format)
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 */
export const handleGeminiModelDetail = async (req, res) => {
  try {
    const modelId = req.params.model.replace(/^models\//, '');
    const openaiModels = await getAvailableModels();
    const model = openaiModels.data.find(m => m.id === modelId);

    if (model) {
      const geminiModel = {
        name: `models/${model.id}`,
        version: "001",
        displayName: model.id,
        description: "Imported model",
        inputTokenLimit: 32768,
        outputTokenLimit: 8192,
        supportedGenerationMethods: ["generateContent", "countTokens"],
        temperature: 0.9,
        topP: 1.0,
        topK: 40
      };
      res.json(geminiModel);
    } else {
      res.status(404).json({ error: { code: 404, message: `Model ${modelId} not found`, status: "NOT_FOUND" } });
    }
  } catch (error) {
    logger.error('Failed to fetch model detail:', error.message);
    res.status(500).json({ error: { code: 500, message: error.message, status: "INTERNAL" } });
  }
};

/**
 * Handle Gemini chat requests
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 * @param {string} modelName - model name
 * @param {boolean} isStream - streaming response
 */
export const handleGeminiRequest = async (req, res, modelName, isStream) => {
  const safeRetries = getSafeRetries(config.retryTimes);

  try {
    const body = req.body || {};
    const validation = validateIncomingChatRequest('gemini', body);
    if (!validation.ok) {
      return res.status(validation.status).json(buildGeminiErrorPayload({ message: validation.message }, validation.status));
    }

    const token = await tokenManager.getToken(modelName);
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
      onAttempt: () => tokenManager.recordRequest(token, modelName),
      tokenId,
      modelId: modelName,
      refreshQuota
    });

    const isImageModel = modelName.includes('-image');
    const requestBody = generateGeminiRequestBody(body, modelName, token);

    if (isImageModel) {
      prepareImageRequest(requestBody);
    }

    if (isStream) {
      setStreamHeaders(res);
      const heartbeatTimer = createHeartbeat(res);

      try {
        if (isImageModel) {
          // Image models: use non-streaming and return once
          const { content, usage, reasoningSignature } = await with429Retry(
            () => generateAssistantResponseNoStream(requestBody, token),
            safeRetries,
            createRetryOptions('gemini.stream.image ')
          );
          const chunk = createGeminiResponse(content, null, reasoningSignature, null, 'STOP', usage, { passSignatureToClient: config.passSignatureToClient });
          writeStreamData(res, chunk);
          clearInterval(heartbeatTimer);
          endStream(res, false);
          return;
        }

        let usageData = null;
        let hasToolCall = false;

        await with429Retry(
          () => generateAssistantResponse(requestBody, token, (data) => {
            if (data.type === 'usage') {
              usageData = data.usage;
            } else if (data.type === 'reasoning') {
              // Gemini reasoning content
              const chunk = createGeminiResponse(null, data.reasoning_content, data.thoughtSignature, null, null, null, { passSignatureToClient: config.passSignatureToClient });
              writeStreamData(res, chunk);
            } else if (data.type === 'tool_calls') {
              hasToolCall = true;
              // Gemini tool call
              const chunk = createGeminiResponse(null, null, null, data.tool_calls, null, null, { passSignatureToClient: config.passSignatureToClient });
              writeStreamData(res, chunk);
            } else {
              // Plain text
              const chunk = createGeminiResponse(data.content, null, null, null, null, null, { passSignatureToClient: config.passSignatureToClient });
              writeStreamData(res, chunk);
            }
          }),
          safeRetries,
          createRetryOptions('gemini.stream ')
        );

        // Send final chunk and usage
        const finishReason = hasToolCall ? "STOP" : "STOP"; // Gemini tool calls also use STOP
        const finalChunk = createGeminiResponse(null, null, null, null, finishReason, usageData, { passSignatureToClient: config.passSignatureToClient });
        writeStreamData(res, finalChunk);

        clearInterval(heartbeatTimer);
        endStream(res, false);
      } catch (error) {
        clearInterval(heartbeatTimer);
        if (!res.writableEnded) {
          const statusCode = error.statusCode || error.status || 500;
          writeStreamData(res, buildGeminiErrorPayload(error, statusCode));
          endStream(res, false);
        }
        logger.error('Gemini streaming request failed:', error.message);
        return;
      }
    } else if (config.fakeNonStream && !isImageModel) {
      // Pseudo-non-stream: use streaming API and assemble a non-stream response
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
          createRetryOptions('gemini.fake_no_stream ')
        );

        const finishReason = "STOP";
        const response = createGeminiResponse(content, reasoningContent || null, reasoningSignature, toolCalls, finishReason, usageData, { passSignatureToClient: config.passSignatureToClient });
        res.json(response);
      } catch (error) {
        logger.error('Gemini pseudo-non-stream request failed:', error.message);
        if (res.headersSent) return;
        const statusCode = error.statusCode || error.status || 500;
        res.status(statusCode).json(buildGeminiErrorPayload(error, statusCode));
      }
    } else {
      // Non-stream
      req.setTimeout(0);
      res.setTimeout(0);

      const { content, reasoningContent, reasoningSignature, toolCalls, usage } = await with429Retry(
        () => generateAssistantResponseNoStream(requestBody, token),
        safeRetries,
        createRetryOptions('gemini.no_stream ')
      );

      const finishReason = toolCalls.length > 0 ? "STOP" : "STOP";
      const response = createGeminiResponse(content, reasoningContent, reasoningSignature, toolCalls, finishReason, usage, { passSignatureToClient: config.passSignatureToClient });
      res.json(response);
    }
  } catch (error) {
    logger.error('Gemini request failed:', error.message);
    if (res.headersSent) return;
    const statusCode = error.statusCode || error.status || 500;
    res.status(statusCode).json(buildGeminiErrorPayload(error, statusCode));
  }
};
