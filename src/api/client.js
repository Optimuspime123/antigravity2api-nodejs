import tokenManager from '../auth/token_manager.js';
import config from '../config/config.js';
import AntigravityRequester from '../AntigravityRequester.js';
import { saveBase64Image } from '../utils/imageStorage.js';
import logger from '../utils/logger.js';
import memoryManager from '../utils/memoryManager.js';
import { httpRequest, httpStreamRequest } from '../utils/httpClient.js';
import { MODEL_LIST_CACHE_TTL } from '../constants/index.js';
import { createApiError } from '../utils/errors.js';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import {
  convertToToolCall,
  registerStreamMemoryCleanup
} from './stream_parser.js';
import { setSignature, shouldCacheSignature, isImageModel } from '../utils/thoughtSignatureCache.js';
import {
  DEBUG_DUMP_FILE,
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
import { runAxiosSseStream, runNativeSseStream, postJsonAndParse } from './geminiTransport.js';
import { parseGeminiCandidateParts, toOpenAIUsage } from './geminiResponseParser.js';

// Request client: prefer AntigravityRequester, fallback to axios on failure
let requester = null;
let useAxios = false;

// Initialize request client
if (config.useNativeAxios === true) {
  useAxios = true;
  logger.info('Using native axios requests');
} else {
  try {
    requester = new AntigravityRequester();
  } catch (error) {
    logger.warn('Failed to initialize AntigravityRequester; falling back to axios:', error.message);
    useAxios = true;
  }
}

// ==================== Debug: full request/raw response dump (single-file append) ====================

// ==================== Model list cache (smart management) ====================
const getModelCacheTTL = () => {
  return config.cache?.modelListTTL || MODEL_LIST_CACHE_TTL;
};

let modelListCache = null;
let modelListCacheTime = 0;

// Default model list (used when API requests fail)
// Use Object.freeze to prevent accidental mutation and help V8 optimize
const DEFAULT_MODELS = Object.freeze([
  'claude-opus-4-5',
  'claude-opus-4-5-thinking',
  'claude-sonnet-4-5-thinking',
  'claude-sonnet-4-5',
  'gemini-3-pro-high',
  'gemini-2.5-flash-lite',
  'gemini-3-pro-image',
  'gemini-3-pro-image-4K',
  'gemini-3-pro-image-2K',
  'gemini-2.5-flash-thinking',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-3-pro-low',
  'chat_20706',
  'rev19-uic3-1p',
  'gpt-oss-120b-medium',
  'chat_23310'
]);

// Build default model list response
function getDefaultModelList() {
  const created = Math.floor(Date.now() / 1000);
  return {
    object: 'list',
    data: DEFAULT_MODELS.map(id => ({
      id,
      object: 'model',
      created,
      owned_by: 'google'
    }))
  };
}


// Register memory cleanup callbacks for object pool and model cache
function registerMemoryCleanup() {
  // Stream parser manages its own object pool size
  registerStreamMemoryCleanup();

  // Memory cleaner triggers periodically: only remove expired model list cache
  memoryManager.registerCleanup(() => {
    const ttl = getModelCacheTTL();
    const now = Date.now();
    if (modelListCache && (now - modelListCacheTime) > ttl) {
      modelListCache = null;
      modelListCacheTime = 0;
    }
  });
}

// Register cleanup callback on init
registerMemoryCleanup();

// ==================== Helpers ====================

function buildHeaders(token) {
  return {
    'Host': config.api.host,
    'User-Agent': config.api.userAgent,
    'Authorization': `Bearer ${token.access_token}`,
    'Content-Type': 'application/json',
    'Accept-Encoding': 'gzip'
  };
}

function buildRequesterConfig(headers, body = null) {
  const reqConfig = {
    method: 'POST',
    headers,
    timeout_ms: config.timeout,
    proxy: config.proxy
  };
  if (body !== null) reqConfig.body = JSON.stringify(body);
  return reqConfig;
}


// Unified error handling
async function handleApiError(error, token, dumpId = null) {
  const status = getUpstreamStatus(error);
  const errorBody = await readUpstreamErrorBody(error);

  if (dumpId) {
    await dumpFinalRawResponse(dumpId, String(errorBody ?? ''));
  }
  
  if (status === 403) {
    if (isCallerDoesNotHavePermission(errorBody)) {
      throw createApiError(`Exceeded model max context. Details: ${errorBody}`, status, errorBody);
    }
    tokenManager.disableCurrentToken(token);
    throw createApiError(`Account lacks permission and was disabled. Details: ${errorBody}`, status, errorBody);
  }
  
  throw createApiError(`API request failed (${status}): ${errorBody}`, status, errorBody);
}


// ==================== Exported functions ====================

export async function generateAssistantResponse(requestBody, token, callback) {
  
  const headers = buildHeaders(token);
  const dumpId = isDebugDumpEnabled() ? createDumpId('stream') : null;
  const streamCollector = dumpId ? createStreamCollector() : null;
  if (dumpId) {
    await dumpFinalRequest(dumpId, requestBody);
  }

  // Temporarily cache reasoning signatures in state for streaming reuse, with session/model for global cache
  const state = {
    toolCalls: [],
    reasoningSignature: null,
    sessionId: requestBody.request?.sessionId,
    model: requestBody.model
  };
  const processor = createStreamLineProcessor({
    state,
    onEvent: callback,
    onRawChunk: (chunk) => collectStreamChunk(streamCollector, chunk)
  });
  
  try {
    if (useAxios) {
      await runAxiosSseStream({
        url: config.api.url,
        headers,
        data: requestBody,
        timeout: config.timeout,
        processor
      });
    } else {
      const streamResponse = requester.antigravity_fetchStream(config.api.url, buildRequesterConfig(headers, requestBody));
      await runNativeSseStream({
        streamResponse,
        processor,
        onErrorChunk: (chunk) => collectStreamChunk(streamCollector, chunk)
      });
    }

    // Write JSON log after streaming completes
    if (dumpId) {
      await dumpStreamResponse(dumpId, streamCollector);
    }
  } catch (error) {
    try { processor.close(); } catch { }
    await handleApiError(error, token, dumpId);
  }
}

// Internal: fetch full raw model data from upstream
async function fetchRawModels(headers, token) {
  try {
    if (useAxios) {
      const response = await httpRequest({
        method: 'POST',
        url: config.api.modelsUrl,
        headers,
        data: {}
      });
      return response.data;
    }
    const response = await requester.antigravity_fetch(config.api.modelsUrl, buildRequesterConfig(headers, {}));
    if (response.status !== 200) {
      const errorBody = await response.text();
      throw { status: response.status, message: errorBody };
    }
    return await response.json();
  } catch (error) {
    await handleApiError(error, token);
  }
}

export async function getAvailableModels() {
  // Check cache validity (dynamic TTL)
  const now = Date.now();
  const ttl = getModelCacheTTL();
  if (modelListCache && (now - modelListCacheTime) < ttl) {
    return modelListCache;
  }
  
  const token = await tokenManager.getToken();
  if (!token) {
    // Return default list if no token is available
    logger.warn('No available token; returning default model list');
    return getDefaultModelList();
  }
  
  const headers = buildHeaders(token);
  const data = await fetchRawModels(headers, token);
  if (!data) {
    // fetchRawModels already handles errors; fallback to default list here
    return getDefaultModelList();
  }

  const created = Math.floor(Date.now() / 1000);
  const modelList = Object.keys(data.models || {}).map(id => ({
    id,
    object: 'model',
    created,
    owned_by: 'google'
  }));
  
  // Add default model if missing in API list
  const existingIds = new Set(modelList.map(m => m.id));
  for (const defaultModel of DEFAULT_MODELS) {
    if (!existingIds.has(defaultModel)) {
      modelList.push({
        id: defaultModel,
        object: 'model',
        created,
        owned_by: 'google'
      });
    }
  }
  
  const result = {
    object: 'list',
    data: modelList
  };
  
  // Update cache
  modelListCache = result;
  modelListCacheTime = now;
  const currentTTL = getModelCacheTTL();
  logger.info(`Model list cached (TTL: ${currentTTL / 1000}s, count: ${modelList.length})`);
  
  return result;
}

// Clear model list cache (useful for manual refresh)
export function clearModelListCache() {
  modelListCache = null;
  modelListCacheTime = 0;
  logger.info('Model list cache cleared');
}

export async function getModelsWithQuotas(token) {
  const headers = buildHeaders(token);
  const data = await fetchRawModels(headers, token);
  if (!data) return {};

  const quotas = {};
  Object.entries(data.models || {}).forEach(([modelId, modelData]) => {
    if (modelData.quotaInfo) {
      quotas[modelId] = {
        r: modelData.quotaInfo.remainingFraction,
        t: modelData.quotaInfo.resetTime
      };
    }
  });
  
  return quotas;
}

export async function generateAssistantResponseNoStream(requestBody, token) {
  
  const headers = buildHeaders(token);
  const dumpId = isDebugDumpEnabled() ? createDumpId('no_stream') : null;
  if (dumpId) await dumpFinalRequest(dumpId, requestBody);
  let data;
  try {
    data = await postJsonAndParse({
      useAxios,
      requester,
      url: config.api.noStreamUrl,
      headers,
      body: requestBody,
      timeout: config.timeout,
      requesterConfig: buildRequesterConfig(headers, requestBody),
      dumpId,
      dumpFinalRawResponse,
      rawFormat: 'json'
    });
  } catch (error) {
    await handleApiError(error, token, dumpId);
  }
  //console.log(JSON.stringify(data));
  const parts = data.response?.candidates?.[0]?.content?.parts || [];
  const parsed = parseGeminiCandidateParts({
    parts,
    sessionId: requestBody.request?.sessionId,
    model: requestBody.model,
    convertToToolCall,
    saveBase64Image
  });

  const usageData = toOpenAIUsage(data.response?.usageMetadata);
  
  // Write new signatures and reasoning content to global cache (by model) for fallback use
  const sessionId = requestBody.request?.sessionId;
  const model = requestBody.model;
  const hasTools = parsed.toolCalls.length > 0;
  const isImage = isImageModel(model);
  
  // Determine whether to cache signature
  if (sessionId && model && shouldCacheSignature({ hasTools, isImageModel: isImage })) {
    // Get final signature (prefer tool signature, fallback to reasoning signature)
    let finalSignature = parsed.reasoningSignature;
    
    // Tool signature: use the last tool with thoughtSignature as cache source
    if (hasTools) {
      for (let i = parsed.toolCalls.length - 1; i >= 0; i--) {
        const sig = parsed.toolCalls[i]?.thoughtSignature;
        if (sig) {
          finalSignature = sig;
          break;
        }
      }
    }
    
    if (finalSignature) {
      const cachedContent = parsed.reasoningContent || ' ';
      setSignature(sessionId, model, finalSignature, cachedContent, { hasTools, isImageModel: isImage });
    }
  }

  // Image generation models: convert to markdown format
  if (parsed.imageUrls.length > 0) {
    let markdown = parsed.content ? parsed.content + '\n\n' : '';
    markdown += parsed.imageUrls.map(url => `![image](${url})`).join('\n\n');
    return { content: markdown, reasoningContent: parsed.reasoningContent, reasoningSignature: parsed.reasoningSignature, toolCalls: parsed.toolCalls, usage: usageData };
  }
  
  return { content: parsed.content, reasoningContent: parsed.reasoningContent, reasoningSignature: parsed.reasoningSignature, toolCalls: parsed.toolCalls, usage: usageData };
}

export async function generateImageForSD(requestBody, token) {
  const headers = buildHeaders(token);
  let data;
  //console.log(JSON.stringify(requestBody,null,2));
  
  try {
    if (useAxios) {
      data = (await httpRequest({
        method: 'POST',
        url: config.api.noStreamUrl,
        headers,
        data: requestBody
      })).data;
    } else {
      const response = await requester.antigravity_fetch(config.api.noStreamUrl, buildRequesterConfig(headers, requestBody));
      if (response.status !== 200) {
        const errorBody = await response.text();
        throw { status: response.status, message: errorBody };
      }
      data = await response.json();
    }
  } catch (error) {
    await handleApiError(error, token);
  }
  
  const parts = data.response?.candidates?.[0]?.content?.parts || [];
  const images = parts.filter(p => p.inlineData).map(p => p.inlineData.data);
  
  return images;
}

export function closeRequester() {
  if (requester) requester.close();
}

// Export memory cleanup registration (for external use)
export { registerMemoryCleanup };
