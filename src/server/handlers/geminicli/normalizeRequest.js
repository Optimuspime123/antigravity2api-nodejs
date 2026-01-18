import { detectRequestFormat } from '../../../utils/converters/geminicli.js';
import { validateIncomingChatRequest } from '../../validators/chat.js';

/**
 * Normalize GeminiCLI entry requests:
 * - Detect format (OpenAI/Gemini/Claude)
 * - Determine stream (Gemini uses _isStream flag set by routes)
 * - Validate required fields
 * - Remove internal markers
 *
 * @param {any} requestBody
 * @param {('openai'|'gemini'|'claude'|null)} forceFormat
 * @returns {{ok: true, format: 'openai'|'gemini'|'claude', stream: boolean, cleanedBody: any} | {ok:false, status:number, message:string}}
 */
export function normalizeGeminiCliRequest(requestBody, forceFormat = null) {
  const format = forceFormat || detectRequestFormat(requestBody);

  let stream = false;
  if (format === 'openai' || format === 'claude') {
    stream = requestBody?.stream || false;
  } else if (format === 'gemini') {
    stream = requestBody?._isStream || false;
  }

  const validation = validateIncomingChatRequest(format, requestBody);
  if (!validation.ok) {
    return { ok: false, status: validation.status, message: validation.message };
  }

  const cleanedBody = { ...requestBody };
  delete cleanedBody._isStream;

  return { ok: true, format, stream, cleanedBody };
}
