import axios from 'axios';
import tokenManager from '../auth/token_manager.js';
import config from '../config/config.js';
import { generateToolCallId } from '../utils/idGenerator.js';
import AntigravityRequester from '../AntigravityRequester.js';
import { saveBase64Image } from '../utils/imageStorage.js';

// Request client: prefer AntigravityRequester, fall back to axios on failure
let requester = null;
let useAxios = false;

if (config.useNativeAxios === true) {
  useAxios = true;
} else {
  try {
    requester = new AntigravityRequester();
  } catch (error) {
    console.warn('AntigravityRequester failed to initialize, falling back to axios:', error.message);
    useAxios = true;
  }
}

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

function buildAxiosConfig(url, headers, body = null) {
  const axiosConfig = {
    method: 'POST',
    url,
    headers,
    timeout: config.timeout,
    proxy: config.proxy ? (() => {
      const proxyUrl = new URL(config.proxy);
      return { protocol: proxyUrl.protocol.replace(':', ''), host: proxyUrl.hostname, port: parseInt(proxyUrl.port) };
    })() : false
  };
  if (body !== null) axiosConfig.data = body;
  return axiosConfig;
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
async function handleApiError(error, token) {
  const status = error.response?.status || error.status || 'Unknown';
  let errorBody = error.message;
  
  if (error.response?.data?.readable) {
    const chunks = [];
    for await (const chunk of error.response.data) {
      chunks.push(chunk);
    }
    errorBody = Buffer.concat(chunks).toString();
  } else if (typeof error.response?.data === 'object') {
    errorBody = JSON.stringify(error.response.data, null, 2);
  } else if (error.response?.data) {
    errorBody = error.response.data;
  }
  
  if (status === 403) {
    if (JSON.stringify(errorBody).includes("The caller does not")){
      throw new Error(`Exceeded the model context window. Details: ${errorBody}`);
    }
    tokenManager.disableCurrentToken(token);
    throw new Error(`This account lacks permission and has been disabled. Details: ${errorBody}`);
  }

  throw new Error(`API request failed (${status}): ${errorBody}`);
}

// Convert functionCall to OpenAI format
function convertToToolCall(functionCall) {
  return {
    id: functionCall.id || generateToolCallId(),
    type: 'function',
    function: {
      name: functionCall.name,
      arguments: JSON.stringify(functionCall.args)
    }
  };
}

// Parse and emit streaming response chunks (mutates state and triggers callback)
function parseAndEmitStreamChunk(line, state, callback) {
  if (!line.startsWith('data: ')) return;
  
  try {
    const data = JSON.parse(line.slice(6));
    //console.log(JSON.stringify(data));
    const parts = data.response?.candidates?.[0]?.content?.parts;
    
    if (parts) {
      for (const part of parts) {
        if (part.thought === true) {
          // Chain-of-thought content
          if (!state.thinkingStarted) {
            callback({ type: 'thinking', content: '<think>\n' });
            state.thinkingStarted = true;
          }
          callback({ type: 'thinking', content: part.text || '' });
        } else if (part.text !== undefined) {
          // Regular text content
          if (state.thinkingStarted) {
            callback({ type: 'thinking', content: '\n</think>\n' });
            state.thinkingStarted = false;
          }
          callback({ type: 'text', content: part.text });
        } else if (part.functionCall) {
          // Tool call
          state.toolCalls.push(convertToToolCall(part.functionCall));
        }
      }
    }

    // At end of response, emit tool calls and usage statistics
    if (data.response?.candidates?.[0]?.finishReason) {
      if (state.thinkingStarted) {
        callback({ type: 'thinking', content: '\n</think>\n' });
        state.thinkingStarted = false;
      }
      if (state.toolCalls.length > 0) {
        callback({ type: 'tool_calls', tool_calls: state.toolCalls });
        state.toolCalls = [];
      }
      // Extract token usage stats
      const usage = data.response?.usageMetadata;
      if (usage) {
        callback({
          type: 'usage', 
          usage: {
            prompt_tokens: usage.promptTokenCount || 0,
            completion_tokens: usage.candidatesTokenCount || 0,
            total_tokens: usage.totalTokenCount || 0
          }
        });
      }
    }
  } catch (e) {
    // Ignore JSON parse errors
  }
}

// ==================== Exported functions ====================

export async function generateAssistantResponse(requestBody, token, callback) {
  
  const headers = buildHeaders(token);
  const state = { thinkingStarted: false, toolCalls: [] };
  let buffer = ''; // Buffer to handle incomplete lines across chunks
  
  const processChunk = (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep the last (possibly incomplete) line
    lines.forEach(line => parseAndEmitStreamChunk(line, state, callback));
  };
  
  if (useAxios) {
    try {
      const axiosConfig = { ...buildAxiosConfig(config.api.url, headers, requestBody), responseType: 'stream' };
      const response = await axios(axiosConfig);
      
      response.data.on('data', chunk => processChunk(chunk.toString()));
      await new Promise((resolve, reject) => {
        response.data.on('end', resolve);
        response.data.on('error', reject);
      });
    } catch (error) {
      await handleApiError(error, token);
    }
  } else {
    try {
      const streamResponse = requester.antigravity_fetchStream(config.api.url, buildRequesterConfig(headers, requestBody));
      let errorBody = '';
      let statusCode = null;

      await new Promise((resolve, reject) => {
        streamResponse
          .onStart(({ status }) => { statusCode = status; })
          .onData((chunk) => statusCode !== 200 ? errorBody += chunk : processChunk(chunk))
          .onEnd(() => statusCode !== 200 ? reject({ status: statusCode, message: errorBody }) : resolve())
          .onError(reject);
      });
    } catch (error) {
      await handleApiError(error, token);
    }
  }
}

export async function getAvailableModels() {
  const token = await tokenManager.getToken();
  if (!token) throw new Error('No available token; please run npm run login to obtain one');
  
  const headers = buildHeaders(token);
  
  try {
    let data;
    if (useAxios) {
      data = (await axios(buildAxiosConfig(config.api.modelsUrl, headers, {}))).data;
    } else {
      const response = await requester.antigravity_fetch(config.api.modelsUrl, buildRequesterConfig(headers, {}));
      if (response.status !== 200) {
        const errorBody = await response.text();
        throw { status: response.status, message: errorBody };
      }
      data = await response.json();
    }
    //console.log(JSON.stringify(data,null,2));
    const modelList = Object.keys(data.models).map(id => ({
        id,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'google'
      }));
    modelList.push({
      id: "claude-opus-4-5",
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'google'
    })
    
    return {
      object: 'list',
      data: modelList
    };
  } catch (error) {
    await handleApiError(error, token);
  }
}

export async function getModelsWithQuotas(token) {
  const headers = buildHeaders(token);
  
  try {
    let data;
    if (useAxios) {
      data = (await axios(buildAxiosConfig(config.api.modelsUrl, headers, {}))).data;
    } else {
      const response = await requester.antigravity_fetch(config.api.modelsUrl, buildRequesterConfig(headers, {}));
      if (response.status !== 200) {
        const errorBody = await response.text();
        throw { status: response.status, message: errorBody };
      }
      data = await response.json();
    }
    
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
  } catch (error) {
    await handleApiError(error, token);
  }
}

export async function generateAssistantResponseNoStream(requestBody, token) {
  
  const headers = buildHeaders(token);
  let data;
  
  try {
    if (useAxios) {
      data = (await axios(buildAxiosConfig(config.api.noStreamUrl, headers, requestBody))).data;
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
  //console.log(JSON.stringify(data));
  // Parse response content
  const parts = data.response?.candidates?.[0]?.content?.parts || [];
  let content = '';
  let thinkingContent = '';
  const toolCalls = [];
  const imageUrls = [];
  
  for (const part of parts) {
    if (part.thought === true) {
      thinkingContent += part.text || '';
    } else if (part.text !== undefined) {
      content += part.text;
    } else if (part.functionCall) {
      toolCalls.push(convertToToolCall(part.functionCall));
    } else if (part.inlineData) {
      // Save image to disk and get the URL
      const imageUrl = saveBase64Image(part.inlineData.data, part.inlineData.mimeType);
      imageUrls.push(imageUrl);
    }
  }
  
  // Append chain-of-thought tags
  if (thinkingContent) {
    content = `<think>\n${thinkingContent}\n</think>\n${content}`;
  }
  
  // Extract token usage
  const usage = data.response?.usageMetadata;
  const usageData = usage ? {
    prompt_tokens: usage.promptTokenCount || 0,
    completion_tokens: usage.candidatesTokenCount || 0,
    total_tokens: usage.totalTokenCount || 0
  } : null;
  
  // Image generation models: convert to Markdown format
  if (imageUrls.length > 0) {
    let markdown = content ? content + '\n\n' : '';
    markdown += imageUrls.map(url => `![image](${url})`).join('\n\n');
    return { content: markdown, toolCalls, usage: usageData };
  }
  
  return { content, toolCalls, usage: usageData };
}

export async function generateImageForSD(requestBody, token) {
  const headers = buildHeaders(token);
  let data;
  //console.log(JSON.stringify(requestBody,null,2));
  
  try {
    if (useAxios) {
      data = (await axios(buildAxiosConfig(config.api.noStreamUrl, headers, requestBody))).data;
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
