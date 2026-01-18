import geminicliTokenManager from '../auth/geminicli_token_manager.js';
import config from '../config/config.js';
import logger from '../utils/logger.js';
import { createApiError } from '../utils/errors.js';
import {
  convertToToolCall
} from './stream_parser.js';
import { saveBase64Image } from '../utils/imageStorage.js';
import {
  isDebugDumpEnabled,
  createDumpId,
  createStreamCollector,
  collectStreamChunk,
  dumpFinalRequest,
  dumpStreamResponse,
  dumpFinalRawResponse
} from './debugDump.js';
import { getUpstreamStatus, readUpstreamErrorBody, isCallerDoesNotHavePermission } from './upstreamError.js';
import { createStreamLineProcessor } from './streamLineProcessor.js';
import { runAxiosSseStream, postJsonAndParse } from './geminiTransport.js';
import { parseGeminiCandidateParts, toOpenAIUsage } from './geminiResponseParser.js';

// ==================== Debug: reuse client.js debug logging ====================

/**
 * Gemini CLI API client
 * Simplified implementation based on client.js, dedicated to Gemini CLI proxying
 * Key differences:
 * 1. Uses the cloudcode-pa.googleapis.com endpoint
 * 2. Uses the GeminiCLI User-Agent
 * 3. Uses the v1internal endpoint, with the model name in the request body
 * 4. No sessionId required
 */

// ==================== Helper functions ====================

/**
 * Build Gemini CLI headers
 * @param {Object} token - token object
 * @returns {Object} headers
 */
function buildHeaders(token) {
  const geminicliConfig = config.geminicli?.api || {};
  return {
    'Host': geminicliConfig.host || 'cloudcode-pa.googleapis.com',
    'User-Agent': geminicliConfig.userAgent || 'GeminiCLI/0.1.5 (Windows; AMD64)',
    'Authorization': `Bearer ${token.access_token}`,
    'Content-Type': 'application/json',
    'Accept-Encoding': 'gzip'
  };
}

/**
 * Build Gemini CLI API URL
 * @param {boolean} stream - whether to stream
 * @returns {string} API URL
 */
function buildApiUrl(stream = true) {
  const geminicliConfig = config.geminicli?.api || {};
  // Use the v1internal endpoint; model name is in the request body
  return stream
    ? (geminicliConfig.url || 'https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse')
    : (geminicliConfig.noStreamUrl || 'https://cloudcode-pa.googleapis.com/v1internal:generateContent');
}

/**
 * Build Gemini CLI request body
 * @param {Object} requestBody - original request (already contains contents, generationConfig, etc.)
 * @param {string} model - model name
 * @param {string} projectId - project ID (required)
 * @returns {Object} full request body
 */
function buildRequestBody(requestBody, model, projectId) {
  // Gemini CLI uses v1internal; request format is similar to Antigravity.
  // Must include model, project, and request fields.
  // Note: project is required or it returns 500 Internal Error.
  return {
    model: model,
    project: projectId,
    request: requestBody
  };
}

/**
 * Unified error handling
 * @param {Error} error - error object
 * @param {Object} token - token object
 */
async function handleApiError(error, token) {
  const status = getUpstreamStatus(error);
  const errorBody = await readUpstreamErrorBody(error);
  
  if (status === 403) {
    if (isCallerDoesNotHavePermission(errorBody)) {
      throw createApiError(`Exceeded the model max context. Details: ${errorBody}`, status, errorBody);
    }
    geminicliTokenManager.disableCurrentToken(token);
    throw createApiError(`This account has no access and was disabled. Details: ${errorBody}`, status, errorBody);
  }
  
  if (status === 429) {
    throw createApiError(`Too many requests. Please retry later. Details: ${errorBody}`, status, errorBody);
  }
  
  throw createApiError(`API request failed (${status}): ${errorBody}`, status, errorBody);
}

// ==================== Exported functions ====================

/**
 * Generate streamed response
 * @param {Object} requestBody - Gemini API request body
 * @param {Object} token - token object (must include projectId)
 * @param {string} model - model name
 * @param {Function} callback - callback function
 */
export async function generateStreamResponse(requestBody, token, model, callback) {
  if (!token.projectId) {
    throw createApiError('Token is missing projectId. Fetch it in the admin page.', 400);
  }
  
  const headers = buildHeaders(token);
  const url = buildApiUrl(true);
  const fullRequestBody = buildRequestBody(requestBody, model, token.projectId);
  
  // Debug logging
  const dumpId = isDebugDumpEnabled() ? createDumpId('cli_stream') : null;
  const streamCollector = dumpId ? createStreamCollector() : null;
  if (dumpId) {
    await dumpFinalRequest(dumpId, fullRequestBody);
  }
  
  // State object for streaming parsing
  const state = {
    toolCalls: [],
    reasoningSignature: null,
    sessionId: null, // Gemini CLI does not use sessionId
    model: model
  };
  const processor = createStreamLineProcessor({
    state,
    onEvent: callback,
    onRawChunk: (chunk) => collectStreamChunk(streamCollector, chunk)
  });
  
  try {
    await runAxiosSseStream({
      url,
      headers,
      data: fullRequestBody,
      timeout: config.timeout,
      processor
    });
    
    // Write logs after stream finishes
    if (dumpId) {
      await dumpStreamResponse(dumpId, streamCollector);
    }
  } catch (error) {
    try { processor.close(); } catch { }
    await handleApiError(error, token);
  }
}

/**
 * Generate non-streamed response
 * @param {Object} requestBody - Gemini API request body
 * @param {Object} token - token object (must include projectId)
 * @param {string} model - model name
 * @returns {Promise<Object>} response
 */
export async function generateNoStreamResponse(requestBody, token, model) {
  if (!token.projectId) {
    throw createApiError('Token is missing projectId. Fetch it in the admin page.', 400);
  }
  
  const headers = buildHeaders(token);
  const url = buildApiUrl(false);
  const fullRequestBody = buildRequestBody(requestBody, model, token.projectId);
  
  // Debug logging
  const dumpId = isDebugDumpEnabled() ? createDumpId('cli_no_stream') : null;
  if (dumpId) {
    await dumpFinalRequest(dumpId, fullRequestBody);
  }
  
  let data;
  try {
    data = await postJsonAndParse({
      useAxios: true,
      url,
      headers,
      body: fullRequestBody,
      timeout: config.timeout,
      dumpId,
      dumpFinalRawResponse
    });
  } catch (error) {
    await handleApiError(error, token);
  }
  
  // Handle GeminiCLI response wrapper format
  // GeminiCLI API returns: { "response": { "candidates": [...] } }
  if (data.response) {
    data = data.response;
  }
  
  // Parse response content
  const parts = (data.candidates?.[0]?.content?.parts) || [];
  const parsed = parseGeminiCandidateParts({
    parts,
    sessionId: null,
    model,
    convertToToolCall,
    saveBase64Image
  });

  const usageData = toOpenAIUsage(data.usageMetadata);

  if (parsed.imageUrls.length > 0) {
    let markdown = parsed.content ? parsed.content + '\n\n' : '';
    markdown += parsed.imageUrls.map(url => `![image](${url})`).join('\n\n');
    return {
      content: markdown,
      reasoningContent: parsed.reasoningContent,
      reasoningSignature: parsed.reasoningSignature,
      toolCalls: parsed.toolCalls,
      usage: usageData
    };
  }

  return {
    content: parsed.content,
    reasoningContent: parsed.reasoningContent,
    reasoningSignature: parsed.reasoningSignature,
    toolCalls: parsed.toolCalls,
    usage: usageData
  };
}

/**
 * Get an available token
 * @returns {Promise<Object|null>} token
 */
export async function getToken() {
  return geminicliTokenManager.getToken();
}

/**
 * Disable current token
 * @param {Object} token - token object
 */
export function disableCurrentToken(token) {
  geminicliTokenManager.disableCurrentToken(token);
}

/**
 * Record request (used by rotation strategy)
 * @param {Object} token - token object
 */
export function recordRequest(token) {
  if (token && token.refresh_token) {
    geminicliTokenManager.incrementRequestCount(token.refresh_token);
  }
}
