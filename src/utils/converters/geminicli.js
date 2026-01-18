
/**
 * Gemini CLI format converter.
 * Converts OpenAI/Gemini/Claude formats to native Gemini API format.
 *
 * Differences from the Antigravity converter:
 * 1. No project/requestId/sessionId fields (added in geminicli_client.js)
 * 2. Uses standard Gemini API format
 * 3. Reuses thoughtSignature handling logic
 */

import config from '../../config/config.js';
import { convertClaudeToolsToAntigravity, convertGeminiToolsToAntigravity } from '../toolConverter.js';
import { sanitizeToolName, cleanParameters, modelMapping, isEnableThinking } from '../utils.js';
import { normalizeOpenAIParameters, normalizeClaudeParameters, normalizeGeminiParameters, toGenerationConfig } from '../parameterNormalizer.js';
import {
  getSignatureContext,
  createThoughtPart,
  createFunctionCallPart,
  processToolName
} from './common.js';
import { getThoughtSignatureForModel, getToolSignatureForModel } from '../utils.js';

// ==================== Gemini CLI model name handling ====================

/**
 * Feature prefixes list.
 */
const FEATURE_PREFIXES = ['pseudo-stream/', 'stream-anti-truncate/'];

/**
 * Check whether the model is pseudo-streaming.
 * @param {string} modelName - Model name
 * @returns {boolean}
 */
export function isFakeStreamingModel(modelName) {
  return modelName.startsWith('pseudo-stream/');
}

/**
 * Check whether the model is stream-anti-truncation.
 * @param {string} modelName - Model name
 * @returns {boolean}
 */
export function isAntiTruncationModel(modelName) {
  return modelName.startsWith('stream-anti-truncate/');
}

/**
 * Extract base model name from a feature model name.
 * @param {string} modelName - Model name (may include prefixes/suffixes)
 * @returns {string} Base model name
 */
export function getBaseModelName(modelName) {
  let baseName = modelName;
  
  // Remove feature prefixes
  for (const prefix of FEATURE_PREFIXES) {
    if (baseName.startsWith(prefix)) {
      baseName = baseName.slice(prefix.length);
      break;
    }
  }
  
  return baseName;
}

/**
 * Check if the model enables max thinking mode.
 * @param {string} modelName - Model name
 * @returns {boolean}
 */
export function isMaxThinkingModel(modelName) {
  return modelName.includes('-maxthinking');
}

/**
 * Check if the model disables thinking mode.
 * @param {string} modelName - Model name
 * @returns {boolean}
 */
export function isNoThinkingModel(modelName) {
  return modelName.includes('-nothinking');
}

/**
 * Check if the model enables search.
 * @param {string} modelName - Model name
 * @returns {boolean}
 */
export function isSearchModel(modelName) {
  return modelName.includes('-search');
}

/**
 * Get the actual API model name (remove all feature prefixes/suffixes).
 * @param {string} modelName - Model name
 * @returns {string} Actual API model name
 */
export function getActualApiModelName(modelName) {
  let actualName = getBaseModelName(modelName);
  
  // Remove feature suffixes
  actualName = actualName
    .replace(/-maxthinking/g, '')
    .replace(/-nothinking/g, '')
    .replace(/-search/g, '');
  
  return actualName;
}

/**
 * Extract message content (text and images).
 * @param {Object|string|Array} content - Message content
 * @returns {Object} { text, images }
 */
function extractContent(content) {
  if (typeof content === 'string') {
    return { text: content, images: [] };
  }
  
  if (Array.isArray(content)) {
    let text = '';
    const images = [];
    
    for (const part of content) {
      if (part.type === 'text') {
        text += part.text || '';
      } else if (part.type === 'image_url') {
        const imageUrl = part.image_url?.url || '';
        if (imageUrl.startsWith('data:')) {
          // Base64 image
          const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            images.push({
              inlineData: {
                mimeType: match[1],
                data: match[2]
              }
            });
          }
        } else {
          // URL image - Gemini API may not support directly; convert to fileData
          images.push({
            fileData: {
              mimeType: 'image/jpeg',
              fileUri: imageUrl
            }
          });
        }
      }
    }
    
    return { text, images };
  }
  
  return { text: '', images: [] };
}

// Officially recommended virtual signature used to skip signature validation (final fallback).
// Reference: gcli2api/src/converter/gemini_fix.py
const SKIP_THOUGHT_SIGNATURE_VALIDATOR = 'skip_thought_signature_validator';

/**
 * Get Gemini CLI signature context (always ensure a signature).
 * Priority: cached signature > hardcoded signature > virtual signature.
 * @param {string} actualModelName - Actual model name
 * @param {boolean} hasTools - Whether tools are present
 * @returns {Object} Signature context
 */
function getGeminiCliSignatureContext(actualModelName, hasTools) {
  // 1. Try cache first (real signature)
  const cached = getSignatureContext(null, actualModelName, hasTools);
  
  // If cached signature exists, return it
  if (cached.reasoningSignature || cached.toolSignature) {
    return cached;
  }
  
  // 2. Try hardcoded signatures (possibly previously cached valid signatures)
  const reasoningSignature = getThoughtSignatureForModel(actualModelName);
  const toolSignature = hasTools ? getToolSignatureForModel(actualModelName) : reasoningSignature;
  
  // If hardcoded signatures exist, use them
  if (reasoningSignature || toolSignature) {
    return {
      reasoningSignature: reasoningSignature || toolSignature,
      reasoningContent: ' ',
      toolSignature: toolSignature || reasoningSignature,
      toolContent: ' '
    };
  }
  
  // 3. Final fallback: use the official virtual signature to skip validation.
  // This mirrors gcli2api behavior (gemini_fix.py line 286).
  return {
    reasoningSignature: SKIP_THOUGHT_SIGNATURE_VALIDATOR,
    reasoningContent: ' ',
    toolSignature: SKIP_THOUGHT_SIGNATURE_VALIDATOR,
    toolContent: ' '
  };
}

/**
 * Convert OpenAI messages to Gemini format (supports thoughtSignature).
 * @param {Array} messages - OpenAI messages array
 * @param {boolean} enableThinking - Whether thinking is enabled
 * @param {string} actualModelName - Actual model name
 * @param {boolean} hasTools - Whether tools are present
 * @returns {Object} { contents, systemInstruction }
 */
function convertMessages(messages, enableThinking = false, actualModelName = '', hasTools = false) {
  const contents = [];
  let systemInstruction = null;
  
  // Get signature context.
  // Note: GeminiCLI tool calls always require signatures, even if thinking is disabled.
  const needSignature = enableThinking || hasTools;
  const signatureContext = needSignature ? getGeminiCliSignatureContext(actualModelName, hasTools) : {};
  const { reasoningSignature, reasoningContent, toolSignature, toolContent } = signatureContext;
  
  for (const msg of messages) {
    const role = msg.role;
    
    if (role === 'system') {
      // System message
      const extracted = extractContent(msg.content);
      if (!systemInstruction) {
        systemInstruction = { role: 'user', parts: [] };
      }
      if (extracted.text) {
        systemInstruction.parts.push({ text: extracted.text });
      }
      systemInstruction.parts.push(...extracted.images);
    } else if (role === 'user') {
      // User message
      const extracted = extractContent(msg.content);
      const parts = [];
      if (extracted.text) {
        parts.push({ text: extracted.text });
      }
      parts.push(...extracted.images);
      contents.push({ role: 'user', parts });
    } else if (role === 'assistant') {
      // Assistant message
      const parts = [];
      
      // Handle reasoning_content (DeepSeek-style thinking content)
      if (enableThinking && msg.reasoning_content) {
        const signature = reasoningSignature || toolSignature;
        if (signature) {
          parts.push(createThoughtPart(msg.reasoning_content, signature));
        }
      } else if (enableThinking) {
        // No thinking content but thinking enabled: add cached signature
        const signature = reasoningSignature || toolSignature;
        const content = signature === reasoningSignature ? reasoningContent : toolContent;
        if (signature) {
          parts.push(createThoughtPart(content || ' ', signature));
        }
      }
      
      // Handle text content
      if (msg.content) {
        const extracted = extractContent(msg.content);
        if (extracted.text) {
          parts.push({ text: extracted.text });
        }
        parts.push(...extracted.images);
      }
      
      // Handle tool calls
      if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
        for (const toolCall of msg.tool_calls) {
          if (toolCall.type === 'function') {
            const func = toolCall.function;
            let args = {};
            try {
              args = typeof func.arguments === 'string'
                ? JSON.parse(func.arguments)
                : func.arguments;
            } catch {
              args = { query: func.arguments };
            }
            
            const safeName = processToolName(func.name, null, actualModelName);
            // Tool calls always require a signature (regardless of thinking mode)
            const signature = toolSignature || reasoningSignature || SKIP_THOUGHT_SIGNATURE_VALIDATOR;
            parts.push(createFunctionCallPart(toolCall.id, safeName, args, signature));
          }
        }
      }
      
      if (parts.length > 0) {
        contents.push({ role: 'model', parts });
      }
    } else if (role === 'tool') {
      // Tool response
      const toolCallId = msg.tool_call_id;
      let functionName = msg.name || '';
      
      // If function name is missing, try to find it in previous messages
      if (!functionName && toolCallId) {
        for (let i = contents.length - 1; i >= 0; i--) {
          const content = contents[i];
          if (content.role === 'model') {
            for (const part of content.parts) {
              if (part.functionCall && part.functionCall.id === toolCallId) {
                functionName = part.functionCall.name;
                break;
              }
            }
          }
          if (functionName) break;
        }
      }
      
      const functionResponse = {
        functionResponse: {
          id: toolCallId,
          name: sanitizeToolName(functionName),
          response: { output: msg.content || '' }
        }
      };
      
      // Merge into the last user message if it already has functionResponse parts
      const lastContent = contents[contents.length - 1];
      if (lastContent?.role === 'user' && lastContent.parts.some(p => p.functionResponse)) {
        lastContent.parts.push(functionResponse);
      } else {
        contents.push({ role: 'user', parts: [functionResponse] });
      }
    }
  }
  
  return { contents, systemInstruction };
}

/**
 * Convert OpenAI tools to Gemini format.
 * @param {Array} tools - OpenAI tool array
 * @returns {Array} Gemini tool array
 */
function convertTools(tools) {
  if (!tools || tools.length === 0) return [];
  
  const declarations = tools.map(tool => {
    const func = tool.function || {};
    const rawParams = func.parameters || {};
    const cleanedParams = cleanParameters(rawParams) || {};
    
    if (cleanedParams.type === undefined) cleanedParams.type = 'OBJECT';
    else if (cleanedParams.type === 'object') cleanedParams.type = 'OBJECT';
    if ((cleanedParams.type === 'OBJECT' || cleanedParams.type === 'object') && cleanedParams.properties === undefined) {
      cleanedParams.properties = {};
    }
    
    return {
      name: sanitizeToolName(func.name),
      description: func.description || '',
      parameters: cleanedParams
    };
  });
  
  return [{
    functionDeclarations: declarations
  }];
}

/**
 * Build Gemini CLI system instruction.
 * Note: GeminiCLI does not add official system prompts, only user-supplied ones.
 * @param {Object|string} systemInstruction - System instruction extracted from messages
 * @returns {Object|null} System instruction object
 */
function buildGeminiCliSystemInstruction(systemInstruction) {
  // Extract user system prompt text
  let userSystemPrompt = null;
  if (systemInstruction && systemInstruction.parts) {
    userSystemPrompt = systemInstruction.parts
      .map(p => p.text || '')
      .filter(t => t.trim())
      .join('\n\n');
  } else if (typeof systemInstruction === 'string') {
    userSystemPrompt = systemInstruction;
  }
  
  // GeminiCLI uses only user-provided system prompts
  if (!userSystemPrompt || !userSystemPrompt.trim()) {
    return null;
  }
  
  return {
    role: 'user',
    parts: [{ text: userSystemPrompt.trim() }]
  };
}

/**
 * Convert an OpenAI request to Gemini CLI API format.
 * @param {Object} openaiRequest - OpenAI request payload
 * @returns {Object} { geminiRequest, model, features }
 */
export function convertOpenAIToGeminiCli(openaiRequest) {
  const {
    model,
    messages,
    tools,
    temperature,
    top_p,
    max_tokens,
    stream,
    ...rest
  } = openaiRequest;
  
  // Extract feature flags
  const features = {
    fakeStreaming: isFakeStreamingModel(model),
    antiTruncation: isAntiTruncationModel(model),
    maxThinking: isMaxThinkingModel(model),
    noThinking: isNoThinkingModel(model),
    search: isSearchModel(model)
  };
  
  // Get actual API model name
  const actualModelName = getActualApiModelName(model);
  
  // Determine thinking mode
  let enableThinking;
  if (features.noThinking) {
    enableThinking = false;
  } else if (features.maxThinking) {
    enableThinking = true;
  } else {
    enableThinking = isEnableThinking(actualModelName);
  }
  
  // Convert tools before messages so hasTools is accurate
  const geminiTools = convertTools(tools);
  const hasTools = geminiTools.length > 0;
  
  // Convert messages (pass signature parameters)
  const { contents, systemInstruction } = convertMessages(
    messages || [], 
    enableThinking, 
    actualModelName, 
    hasTools
  );
  
  // Normalize parameters
  const normalizedParams = normalizeOpenAIParameters({
    temperature,
    top_p,
    max_tokens,
    ...rest
  });
  
  // Build generationConfig
  const generationConfig = toGenerationConfig(normalizedParams, enableThinking, actualModelName);
  
  // Build Gemini CLI request
  const geminiRequest = {
    contents,
    generationConfig
  };
  
  // Add system instruction
  const finalSystemInstruction = buildGeminiCliSystemInstruction(systemInstruction);
  if (finalSystemInstruction) {
    geminiRequest.systemInstruction = finalSystemInstruction;
  }
  
  // Add tools
  if (hasTools) {
    geminiRequest.tools = geminiTools;
    geminiRequest.toolConfig = {
      functionCallingConfig: {
        mode: 'AUTO'
      }
    };
  }
  
  // If search is enabled, add Google Search tool
  if (features.search) {
    if (!geminiRequest.tools) {
      geminiRequest.tools = [];
    }
    geminiRequest.tools.push({
      googleSearch: {}
    });
  }
  
  return {
    geminiRequest,
    model: actualModelName,
    features
  };
}

/**
 * Handle thought and signature parts in Gemini model messages.
 * @param {Object} content - Model message content
 * @param {string} reasoningSignature - Reasoning signature
 * @param {string} reasoningContent - Reasoning content
 * @param {string} toolSignature - Tool signature
 * @param {string} toolContent - Tool content
 * @param {boolean} enableThinking - Whether thinking is enabled
 */
function processGeminiModelThoughts(content, reasoningSignature, reasoningContent, toolSignature, toolContent, enableThinking) {
  const parts = content.parts;
  const fallbackSig = reasoningSignature || toolSignature;
  const fallbackContent = (fallbackSig === reasoningSignature) ? (reasoningContent || ' ') : (toolContent || ' ');

  // Non-thinking models: only auto-sign inlineData
  if (!enableThinking) {
    if (!fallbackSig) return;
    for (const part of parts) {
      if (part.inlineData && !part.thoughtSignature) {
        part.thoughtSignature = fallbackSig;
      }
    }
    return;
  }

  const isStandaloneSignaturePart = (part) =>
    part &&
    part.thoughtSignature &&
    !part.thought &&
    !part.functionCall &&
    !part.functionResponse &&
    !part.text &&
    !part.inlineData;

  // Find thought and standalone thoughtSignature positions
  let thoughtIndex = -1;
  let signatureIndex = -1;
  let signatureValue = null;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.thought === true && !part.thoughtSignature) {
      thoughtIndex = i;
    }
    if (isStandaloneSignaturePart(part)) {
      signatureIndex = i;
      signatureValue = part.thoughtSignature;
    }
  }

  // Merge or add thought and signature
  if (thoughtIndex !== -1 && signatureIndex !== -1) {
    parts[thoughtIndex].thoughtSignature = signatureValue;
    parts.splice(signatureIndex, 1);
  } else if (thoughtIndex !== -1 && signatureIndex === -1) {
    if (fallbackSig) parts[thoughtIndex].thoughtSignature = fallbackSig;
  } else if (thoughtIndex === -1 && fallbackSig) {
    // Only add a thought part when a signature exists
    parts.unshift(createThoughtPart(fallbackContent, fallbackSig));
  }

  // Collect standalone signature parts (for functionCall)
  const standaloneSignatures = [];
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (isStandaloneSignaturePart(part)) {
      standaloneSignatures.unshift({ index: i, signature: part.thoughtSignature });
    }
  }

  // Assign signatures for functionCall / inlineData
  let sigIndex = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if ((!part.thoughtSignature) && (part.functionCall || part.inlineData)) {
      if (sigIndex < standaloneSignatures.length) {
        part.thoughtSignature = standaloneSignatures[sigIndex].signature;
        sigIndex++;
        continue;
      }

      const partFallback = part.functionCall ? (toolSignature || reasoningSignature) : (reasoningSignature || toolSignature);
      if (partFallback) part.thoughtSignature = partFallback;
    }
  }

  // Remove standalone signature parts that were used
  for (let i = standaloneSignatures.length - 1; i >= 0; i--) {
    if (i < sigIndex) {
      parts.splice(standaloneSignatures[i].index, 1);
    }
  }
}

/**
 * Convert a Gemini request directly to Gemini CLI API format.
 * @param {Object} geminiRequest - Gemini request payload
 * @param {string} modelName - Model name
 * @returns {Object} { geminiRequest, model, features }
 */
export function convertGeminiToGeminiCli(geminiRequest, modelName) {
  // Extract feature flags
  const features = {
    fakeStreaming: isFakeStreamingModel(modelName),
    antiTruncation: isAntiTruncationModel(modelName),
    maxThinking: isMaxThinkingModel(modelName),
    noThinking: isNoThinkingModel(modelName),
    search: isSearchModel(modelName)
  };
  
  const actualModelName = getActualApiModelName(modelName);
  
  // Determine thinking mode
  let enableThinking;
  if (features.noThinking) {
    enableThinking = false;
  } else if (features.maxThinking) {
    enableThinking = true;
  } else {
    enableThinking = isEnableThinking(actualModelName);
  }
  // Deep copy the request
  const request = JSON.parse(JSON.stringify(geminiRequest));
  
  // Handle tools
  const hasTools = request.tools && request.tools.length > 0;
  if (hasTools) {
    // Convert tool format if needed
    request.tools = convertGeminiToolsToAntigravity(request.tools, null, actualModelName);
  }
  
  // Get signature context and handle model thoughts (GeminiCLI must ensure signatures).
  if (enableThinking && request.contents && Array.isArray(request.contents)) {
    const { reasoningSignature, reasoningContent, toolSignature, toolContent } =
      getGeminiCliSignatureContext(actualModelName, hasTools);
    
    for (const content of request.contents) {
      if (content.role === 'model' && content.parts && Array.isArray(content.parts)) {
        processGeminiModelThoughts(content, reasoningSignature, reasoningContent, toolSignature, toolContent, enableThinking);
      }
    }
  }
  // Normalize generationConfig
  if (request.generationConfig) {
    const normalizedParams = normalizeGeminiParameters(request.generationConfig);
    request.generationConfig = toGenerationConfig(normalizedParams, enableThinking, actualModelName);
  } else {
    request.generationConfig = toGenerationConfig({}, enableThinking, actualModelName);
  }
  // Remove unneeded fields
  delete request.safetySettings;
  
  // Add tool configuration
  if (hasTools && !request.toolConfig) {
    request.toolConfig = {
      functionCallingConfig: {
        mode: 'AUTO'
      }
    };
  }
  
  // Handle system instruction
  if (request.systemInstruction) {
    request.systemInstruction = buildGeminiCliSystemInstruction(request.systemInstruction);
  }
  
  // If search is enabled, add Google Search tool
  if (features.search) {
    if (!request.tools) {
      request.tools = [];
    }
    request.tools.push({
      googleSearch: {}
    });
  }
  
  // Remove model from request (model should be top-level).
  // Following gcli2api: request contains only contents, generationConfig, tools, etc.
  delete request.model;
  
  return {
    geminiRequest: request,
    model: actualModelName,
    features
  };
}

/**
 * Extract text and images from Claude content.
 * @param {string|Array} content - Claude message content
 * @returns {Object} { text, images }
 */
function extractClaudeContent(content) {
  const result = { text: '', images: [] };
  if (typeof content === 'string') {
    result.text = content;
    return result;
  }
  if (Array.isArray(content)) {
    for (const item of content) {
      if (item.type === 'text') {
        result.text += item.text || '';
      } else if (item.type === 'image') {
        const source = item.source;
        if (source && source.type === 'base64' && source.data) {
          result.images.push({
            inlineData: {
              mimeType: source.media_type || 'image/png',
              data: source.data
            }
          });
        }
      }
    }
  }
  return result;
}

/**
 * Convert Claude tools to Gemini format.
 * @param {Array} tools - Claude tool array
 * @returns {Array} Gemini tool array
 */
function convertClaudeTools(tools) {
  if (!tools || tools.length === 0) return [];
  
  const declarations = tools.map(tool => {
    const rawParams = tool.input_schema || {};
    const cleanedParams = cleanParameters(rawParams) || {};
    
    if (cleanedParams.type === undefined) cleanedParams.type = 'OBJECT';
    else if (cleanedParams.type === 'object') cleanedParams.type = 'OBJECT';
    if ((cleanedParams.type === 'OBJECT' || cleanedParams.type === 'object') && cleanedParams.properties === undefined) {
      cleanedParams.properties = {};
    }
    
    return {
      name: sanitizeToolName(tool.name),
      description: tool.description || '',
      parameters: cleanedParams
    };
  });
  
  return [{
    functionDeclarations: declarations
  }];
}

/**
 * Convert Claude messages to Gemini format.
 * @param {Array} messages - Claude message array
 * @param {boolean} enableThinking - Whether thinking is enabled
 * @param {string} actualModelName - Actual model name
 * @param {boolean} hasTools - Whether tools are present
 * @returns {Array} Gemini contents array
 */
function convertClaudeMessages(messages, enableThinking = false, actualModelName = '', hasTools = false) {
  const contents = [];
  
  // Get signature context.
  // Note: GeminiCLI tool calls always require signatures, even if thinking is disabled.
  const needSignature = enableThinking || hasTools;
  const signatureContext = needSignature ? getGeminiCliSignatureContext(actualModelName, hasTools) : {};
  const { reasoningSignature, reasoningContent, toolSignature, toolContent } = signatureContext;
  
  for (const msg of messages) {
    const role = msg.role;
    
    if (role === 'user') {
      const content = msg.content;
      
      // Check for tool_result
      if (Array.isArray(content) && content.some(item => item.type === 'tool_result')) {
        // Handle tool results
        for (const item of content) {
          if (item.type !== 'tool_result') continue;
          
          const toolUseId = item.tool_use_id;
          let functionName = '';
          
          // Find function name from previous messages
          for (let i = contents.length - 1; i >= 0; i--) {
            if (contents[i].role === 'model') {
              for (const part of contents[i].parts) {
                if (part.functionCall && part.functionCall.id === toolUseId) {
                  functionName = part.functionCall.name;
                  break;
                }
              }
            }
            if (functionName) break;
          }
          
          let resultContent = '';
          if (typeof item.content === 'string') {
            resultContent = item.content;
          } else if (Array.isArray(item.content)) {
            resultContent = item.content.filter(c => c.type === 'text').map(c => c.text).join('');
          }
          
          const functionResponse = {
            functionResponse: {
              id: toolUseId,
              name: functionName,
              response: { output: resultContent }
            }
          };
          
          const lastContent = contents[contents.length - 1];
          if (lastContent?.role === 'user' && lastContent.parts.some(p => p.functionResponse)) {
            lastContent.parts.push(functionResponse);
          } else {
            contents.push({ role: 'user', parts: [functionResponse] });
          }
        }
      } else {
        // Standard user message
        const extracted = extractClaudeContent(content);
        const parts = [];
        if (extracted.text) {
          parts.push({ text: extracted.text });
        }
        parts.push(...extracted.images);
        contents.push({ role: 'user', parts });
      }
    } else if (role === 'assistant') {
      const parts = [];
      let thinkingContent = '';
      let messageSignature = null;
      const toolCalls = [];
      let textContent = '';
      
      if (typeof msg.content === 'string') {
        textContent = msg.content;
      } else if (Array.isArray(msg.content)) {
        for (const item of msg.content) {
          if (item.type === 'text') {
            textContent += item.text || '';
          } else if (item.type === 'thinking') {
            // Claude thinking block
            if (item.thinking) thinkingContent += item.thinking;
            if (!messageSignature && item.signature) messageSignature = item.signature;
          } else if (item.type === 'tool_use') {
            const safeName = processToolName(item.name, null, actualModelName);
            // Tool calls always require signatures (regardless of thinking mode)
            const signature = item.signature || toolSignature || reasoningSignature || SKIP_THOUGHT_SIGNATURE_VALIDATOR;
            toolCalls.push(createFunctionCallPart(item.id, safeName, item.input || {}, signature));
          }
        }
      }
      
      // Add thinking content
      if (enableThinking) {
        const signature = messageSignature || reasoningSignature || toolSignature;
        if (signature) {
          let reasoningText = ' ';
          if (thinkingContent.length > 0) {
            reasoningText = thinkingContent;
          } else if (signature === reasoningSignature) {
            reasoningText = reasoningContent || ' ';
          } else if (signature === toolSignature) {
            reasoningText = toolContent || ' ';
          }
          parts.push(createThoughtPart(reasoningText, signature));
        }
      }
      
      // Add text content
      if (textContent && textContent.trim()) {
        parts.push({ text: textContent.trimEnd() });
      }
      
      // Add tool calls
      parts.push(...toolCalls);
      
      if (parts.length > 0) {
        contents.push({ role: 'model', parts });
      }
    }
  }
  
  return contents;
}

/**
 * Convert a Claude request to Gemini CLI API format.
 * @param {Object} claudeRequest - Claude request payload
 * @returns {Object} { geminiRequest, model, features }
 */
export function convertClaudeToGeminiCli(claudeRequest) {
  const {
    model,
    messages,
    tools,
    system,
    max_tokens,
    temperature,
    top_p,
    top_k,
    ...rest
  } = claudeRequest;
  
  // Extract feature flags
  const features = {
    fakeStreaming: isFakeStreamingModel(model),
    antiTruncation: isAntiTruncationModel(model),
    maxThinking: isMaxThinkingModel(model),
    noThinking: isNoThinkingModel(model),
    search: isSearchModel(model)
  };
  
  const actualModelName = getActualApiModelName(model);
  
  // Determine thinking mode
  let enableThinking;
  if (features.noThinking) {
    enableThinking = false;
  } else if (features.maxThinking) {
    enableThinking = true;
  } else {
    enableThinking = isEnableThinking(actualModelName);
  }
  
  // Convert tools
  const geminiTools = convertClaudeTools(tools);
  const hasTools = geminiTools.length > 0;
  
  // Convert messages
  const contents = convertClaudeMessages(messages || [], enableThinking, actualModelName, hasTools);
  
  // Normalize parameters
  const normalizedParams = normalizeClaudeParameters({
    max_tokens,
    temperature,
    top_p,
    top_k,
    ...rest
  });
  
  // Build generationConfig
  const generationConfig = toGenerationConfig(normalizedParams, enableThinking, actualModelName);
  
  // Build Gemini CLI request
  const geminiRequest = {
    contents,
    generationConfig
  };
  
  // Add system instruction
  const finalSystemInstruction = buildGeminiCliSystemInstruction(system);
  if (finalSystemInstruction) {
    geminiRequest.systemInstruction = finalSystemInstruction;
  }
  
  // Add tools
  if (hasTools) {
    geminiRequest.tools = geminiTools;
    geminiRequest.toolConfig = {
      functionCallingConfig: {
        mode: 'AUTO'
      }
    };
  }
  
  // If search is enabled, add Google Search tool
  if (features.search) {
    if (!geminiRequest.tools) {
      geminiRequest.tools = [];
    }
    geminiRequest.tools.push({
      googleSearch: {}
    });
  }
  
  return {
    geminiRequest,
    model: actualModelName,
    features
  };
}

/**
 * Detect request format type.
 * @param {Object} request - Request payload
 * @returns {string} 'openai' | 'gemini' | 'claude'
 */
export function detectRequestFormat(request) {
  // Claude format: has messages array and tools use input_schema
  if (request.messages && Array.isArray(request.messages)) {
    // Check for Claude-specific fields
    if (request.system !== undefined ||
        (request.tools && request.tools[0]?.input_schema)) {
      return 'claude';
    }
    // OpenAI format
    return 'openai';
  }
  
  // Gemini format: has contents array
  if (request.contents && Array.isArray(request.contents)) {
    return 'gemini';
  }
  
  // Default to OpenAI format
  return 'openai';
}

/**
 * Unified entry point: detect format and convert to Gemini CLI format.
 * @param {Object} request - Request payload (OpenAI/Gemini/Claude format)
 * @param {string} modelName - Model name (optional, for Gemini format)
 * @returns {Object} { geminiRequest, model, features, sourceFormat }
 */
export function convertToGeminiCli(request, modelName = null) {
  const format = detectRequestFormat(request);
  
  let result;
  switch (format) {
    case 'claude':
      result = convertClaudeToGeminiCli(request);
      break;
    case 'gemini':
      result = convertGeminiToGeminiCli(request, modelName || request.model || 'gemini-2.5-pro');
      break;
    case 'openai':
    default:
      result = convertOpenAIToGeminiCli(request);
      break;
  }
  
  return {
    ...result,
    sourceFormat: format
  };
}
