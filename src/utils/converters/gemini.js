// Gemini format converter
import config from '../../config/config.js';
import { generateRequestId } from '../idGenerator.js';
import { convertGeminiToolsToAntigravity } from '../toolConverter.js';
import { getSignatureContext, createThoughtPart, modelMapping, isEnableThinking, buildSystemInstruction } from './common.js';
import { normalizeGeminiParameters, toGenerationConfig } from '../parameterNormalizer.js';

/**
 * Generate a unique ID for functionCall.
 */
function generateFunctionCallId() {
  return `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Match IDs between functionCall and functionResponse.
 */
function processFunctionCallIds(contents) {
  const functionCallIds = [];

  // Collect all functionCall IDs
  contents.forEach(content => {
    if (content.role === 'model' && content.parts && Array.isArray(content.parts)) {
      content.parts.forEach(part => {
        if (part.functionCall) {
          if (!part.functionCall.id) {
            part.functionCall.id = generateFunctionCallId();
          }
          functionCallIds.push(part.functionCall.id);
        }
      });
    }
  });

  // Assign matching IDs to functionResponse
  let responseIndex = 0;
  contents.forEach(content => {
    if (content.role === 'user' && content.parts && Array.isArray(content.parts)) {
      content.parts.forEach(part => {
        if (part.functionResponse) {
          if (!part.functionResponse.id && responseIndex < functionCallIds.length) {
            part.functionResponse.id = functionCallIds[responseIndex];
            responseIndex++;
          }
        }
      });
    }
  });
}

/**
 * Handle thought and signature parts in model messages.
 */
function processModelThoughts(content, reasoningSignature, reasoningContent, toolSignature, toolContent, enableThinking) {
  const parts = content.parts;
  const fallbackSig = reasoningSignature || toolSignature;
  const fallbackContent = (fallbackSig === reasoningSignature) ? (reasoningContent || ' ') : (toolContent || ' ');

  // Non-thinking models: only auto-sign inlineData to avoid missing signatures on replay.
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

  // Find the positions of thought and standalone thoughtSignature parts
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
    // Only add a thought part when a signature exists to avoid API errors.
    // Use cached content bound to the signature.
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

      // functionCall prefers toolSignature; inlineData prefers reasoningSignature
      const partFallback = part.functionCall ? (toolSignature || reasoningSignature) : (reasoningSignature || toolSignature);
      if (partFallback) part.thoughtSignature = partFallback;
    }
  }

  // Remove standalone signature parts that have been used
  for (let i = standaloneSignatures.length - 1; i >= 0; i--) {
    if (i < sigIndex) {
      parts.splice(standaloneSignatures[i].index, 1);
    }
  }
}

export function generateGeminiRequestBody(geminiBody, modelName, token) {
  const enableThinking = isEnableThinking(modelName);
  const actualModelName = modelMapping(modelName);
  const request = JSON.parse(JSON.stringify(geminiBody));

  if (request.contents && Array.isArray(request.contents)) {
    processFunctionCallIds(request.contents);

    // Convert tool definitions before reading signatures so hasTools is accurate.
    if (request.tools && Array.isArray(request.tools)) {
      request.tools = convertGeminiToolsToAntigravity(request.tools, token.sessionId, actualModelName);
    }

    const hasTools = request.tools && request.tools.length > 0;
    const { reasoningSignature, reasoningContent, toolSignature, toolContent } = getSignatureContext(token.sessionId, actualModelName, hasTools);

    request.contents.forEach(content => {
      if (content.role === 'model' && content.parts && Array.isArray(content.parts)) {
        processModelThoughts(content, reasoningSignature, reasoningContent, toolSignature, toolContent, enableThinking);
      }
    });
  }

  // Normalize Gemini parameters using the shared module
  const normalizedParams = normalizeGeminiParameters(request.generationConfig || {});

  // Convert to generationConfig format
  request.generationConfig = toGenerationConfig(normalizedParams, enableThinking, actualModelName);
  request.sessionId = token.sessionId;
  delete request.safetySettings;

  // Add tool configuration
  if (request.tools && request.tools.length > 0 && !request.toolConfig) {
    request.toolConfig = { functionCallingConfig: { mode: 'VALIDATED' } };
  }

  // Use the new system prompt builder (supports multi-part structure and positioning).
  const existingSystemInstruction = request.systemInstruction;
  const systemInstructionObj = buildSystemInstruction(existingSystemInstruction);
  if (systemInstructionObj) {
    request.systemInstruction = systemInstructionObj;
  } else {
    delete request.systemInstruction;
  }

  //console.log(JSON.stringify(request, null, 2))

  const requestBody = {
    project: token.projectId,
    requestId: generateRequestId(),
    request: request,
    model: actualModelName,
    userAgent: 'antigravity',
    requestType: 'agent'
  };

  return requestBody;
}
