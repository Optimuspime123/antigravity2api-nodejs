import memoryManager, { registerMemoryPoolCleanup } from '../utils/memoryManager.js';
import { generateToolCallId } from '../utils/idGenerator.js';
import { setSignature, shouldCacheSignature, isImageModel } from '../utils/thoughtSignatureCache.js';
import { getOriginalToolName } from '../utils/toolNameCache.js';
import config from '../config/config.js';

// Precompiled constants (avoid recreating strings)
const DATA_PREFIX = 'data: ';
const DATA_PREFIX_LEN = DATA_PREFIX.length;

// Efficient line splitter (zero-copy, avoids split allocations)
// Reuse LineBuffer instances via an object pool
class LineBuffer {
  constructor() {
    this.buffer = '';
    this.lines = [];
  }
  
  // Append data and return complete lines
  append(chunk) {
    this.buffer += chunk;
    this.lines.length = 0; // Reuse array
    
    let start = 0;
    let end;
    while ((end = this.buffer.indexOf('\n', start)) !== -1) {
      this.lines.push(this.buffer.slice(start, end));
      start = end + 1;
    }
    
    // Preserve the incomplete remainder
    this.buffer = start < this.buffer.length ? this.buffer.slice(start) : '';
    return this.lines;
  }
  
  clear() {
    this.buffer = '';
    this.lines.length = 0;
  }
}

// LineBuffer object pool
const lineBufferPool = [];
const getLineBuffer = () => {
  const buffer = lineBufferPool.pop();
  if (buffer) {
    buffer.clear();
    return buffer;
  }
  return new LineBuffer();
};
const releaseLineBuffer = (buffer) => {
  const maxSize = memoryManager.getPoolSizes().lineBuffer;
  if (lineBufferPool.length < maxSize) {
    buffer.clear();
    lineBufferPool.push(buffer);
  }
};

// toolCall object pool
const toolCallPool = [];
const getToolCallObject = () => toolCallPool.pop() || { id: '', type: 'function', function: { name: '', arguments: '' } };
const releaseToolCallObject = (obj) => {
  const maxSize = memoryManager.getPoolSizes().toolCall;
  if (toolCallPool.length < maxSize) toolCallPool.push(obj);
};

// Register memory cleanup callbacks (invoked externally)
function registerStreamMemoryCleanup() {
  registerMemoryPoolCleanup(toolCallPool, () => memoryManager.getPoolSizes().toolCall);
  registerMemoryPoolCleanup(lineBufferPool, () => memoryManager.getPoolSizes().lineBuffer);
}

// Convert functionCall to OpenAI format (use object pool)
// Attempt to restore the original tool name from safe names
function convertToToolCall(functionCall, sessionId, model) {
  const toolCall = getToolCallObject();
  toolCall.id = functionCall.id || generateToolCallId();
  let name = functionCall.name;
  if (model) {
    const original = getOriginalToolName(model, functionCall.name);
    if (original) name = original;
  }
  toolCall.function.name = name;
  toolCall.function.arguments = JSON.stringify(functionCall.args);
  return toolCall;
}

// Parse and emit streamed response chunks (mutates state and triggers callback)
// Supports DeepSeek format: chain-of-thought via reasoning_content field
// Pass through thoughtSignature for client reuse
// Store signature bound to reasoning content once collected
function parseAndEmitStreamChunk(line, state, callback) {
  if (!line.startsWith(DATA_PREFIX)) return;
  
  try {
    const data = JSON.parse(line.slice(DATA_PREFIX_LEN));
    const parts = data.response?.candidates?.[0]?.content?.parts;
    
    if (parts) {
      for (const part of parts) {
        if (part.thoughtSignature) {
          // Models like Gemini may only include thoughtSignature on functionCall parts.
          // Treat it as the latest signature for fallback tool calls and caching.
          if (part.thoughtSignature !== state.reasoningSignature) {
            state.reasoningSignature = part.thoughtSignature;
            // Defer caching until reasoning content is fully collected
          }
        }

        if (part.thought === true) {
          // Accumulate reasoning content
          if (part.text) {
            state.reasoningContent = (state.reasoningContent || '') + part.text;
          }
          
          if (part.thoughtSignature) {
            state.reasoningSignature = part.thoughtSignature;
            // Defer caching until stream ends to ensure complete reasoning content
          }
          callback({
            type: 'reasoning',
            reasoning_content: part.text || '',
            thoughtSignature: part.thoughtSignature || state.reasoningSignature || null
          });
        } else if (part.text !== undefined) {
          callback({ type: 'text', content: part.text });
        } else if (part.functionCall) {
          const toolCall = convertToToolCall(part.functionCall, state.sessionId, state.model);
          const sig = part.thoughtSignature || state.reasoningSignature || null;
          if (sig) {
            toolCall.thoughtSignature = sig;
            // Mark that we have tool calls
            state.hasToolCalls = true;
          }
          state.toolCalls.push(toolCall);
        }
      }
    }
    
    if (data.response?.candidates?.[0]?.finishReason) {
      // When the stream ends, decide whether to cache the signature
      const hasTools = state.hasToolCalls || state.toolCalls.length > 0;
      const isImage = isImageModel(state.model);
      
      // Note: GeminiCLI does not use sessionId, but signature caching still works.
      // sessionId is no longer used in thoughtSignatureCache.js cache keys.
      if (state.model && state.reasoningSignature) {
        if (shouldCacheSignature({ hasTools, isImageModel: isImage })) {
          const content = state.reasoningContent || ' ';
          setSignature(state.sessionId, state.model, state.reasoningSignature, content, { hasTools, isImageModel: isImage });
        }
      }
      
      if (state.toolCalls.length > 0) {
        callback({ type: 'tool_calls', tool_calls: state.toolCalls });
        state.toolCalls = [];
      }
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
      // Clear accumulated reasoning content and state
      state.reasoningContent = '';
      state.hasToolCalls = false;
    }
  } catch {
    // Ignore JSON parse errors
  }
}

export {
  getLineBuffer,
  releaseLineBuffer,
  parseAndEmitStreamChunk,
  convertToToolCall,
  registerStreamMemoryCleanup,
  releaseToolCallObject
};
