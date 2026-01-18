// Shared tool conversion module
import { sanitizeToolName, cleanParameters } from './utils.js';
import { setToolNameMapping } from './toolNameCache.js';

/**
 * Convert a single tool definition to an Antigravity functionDeclaration.
 * @param {string} name - Tool name
 * @param {string} description - Tool description
 * @param {Object} parameters - Tool parameter schema
 * @param {string} sessionId - Session ID
 * @param {string} actualModelName - Actual model name
 * @returns {Object} functionDeclaration object
 */
function convertSingleTool(name, description, parameters, sessionId, actualModelName) {
  const originalName = name;
  const safeName = sanitizeToolName(originalName);
  
  if (actualModelName && safeName !== originalName) {
    setToolNameMapping(actualModelName, safeName, originalName);
  }
  
  const rawParams = parameters || {};
  const cleanedParams = cleanParameters(rawParams) || {};
  // Use uppercase OBJECT to match the official API format
  if (cleanedParams.type === undefined) cleanedParams.type = 'OBJECT';
  else if (cleanedParams.type === 'object') cleanedParams.type = 'OBJECT';
  if ((cleanedParams.type === 'OBJECT' || cleanedParams.type === 'object') && cleanedParams.properties === undefined) cleanedParams.properties = {};
  //console.log(JSON.stringify(tool,null,2),100)
  return {
    name: safeName,
    description: description || '',
    parameters: cleanedParams
  };
}

/**
 * Convert OpenAI tools to Antigravity format.
 * OpenAI format: [{ type: 'function', function: { name, description, parameters } }]
 * @param {Array} openaiTools - OpenAI tool list
 * @param {string} sessionId - Session ID
 * @param {string} actualModelName - Actual model name
 * @returns {Array} Antigravity tool list (all tools in a functionDeclarations array)
 */
export function convertOpenAIToolsToAntigravity(openaiTools, sessionId, actualModelName) {
  if (!openaiTools || openaiTools.length === 0) return [];
  
  const declarations = openaiTools.map((tool) => {
    const func = tool.function || {};
    return convertSingleTool(
      func.name,
      func.description,
      func.parameters,
      sessionId,
      actualModelName
    );
  });
  
  return [{
    functionDeclarations: declarations
  }];
}

/**
 * Convert Claude tools to Antigravity format.
 * Claude format: [{ name, description, input_schema }]
 * @param {Array} claudeTools - Claude tool list
 * @param {string} sessionId - Session ID
 * @param {string} actualModelName - Actual model name
 * @returns {Array} Antigravity tool list (all tools in a functionDeclarations array)
 */
export function convertClaudeToolsToAntigravity(claudeTools, sessionId, actualModelName) {
  if (!claudeTools || claudeTools.length === 0) return [];
  
  const declarations = claudeTools.map((tool) => {
    return convertSingleTool(
      tool.name,
      tool.description,
      tool.input_schema,
      sessionId,
      actualModelName
    );
  });
  
  return [{
    functionDeclarations: declarations
  }];
}

/**
 * Convert Gemini tools to Antigravity format.
 * Gemini format can be:
 * 1. [{ functionDeclarations: [{ name, description, parameters }] }]
 * 2. [{ name, description, parameters }]
 * @param {Array} geminiTools - Gemini tool list
 * @param {string} sessionId - Session ID
 * @param {string} actualModelName - Actual model name
 * @returns {Array} Antigravity tool list (all tools in a functionDeclarations array)
 */
export function convertGeminiToolsToAntigravity(geminiTools, sessionId, actualModelName) {
  if (!geminiTools || geminiTools.length === 0) return [];
  
  const allDeclarations = [];
  for (const tool of geminiTools) {
    // Format 1: already functionDeclarations (supports camelCase and snake_case)
    const declarations = tool.functionDeclarations || tool.function_declarations;
    if (declarations) {
      // Collect all declarations
      for (const fd of declarations) {
        allDeclarations.push(
          convertSingleTool(fd.name, fd.description, fd.parameters, sessionId, actualModelName)
        );
      }
    }
    // Format 2: single tool definition
    else if (tool.name) {
      allDeclarations.push(
        convertSingleTool(
          tool.name,
          tool.description,
          tool.parameters || tool.input_schema,
          sessionId,
          actualModelName
        )
      );
    }
    // Format 3: not handled
  }
  
  return allDeclarations.length > 0 ? [{
    functionDeclarations: allDeclarations
  }] : [];
}
