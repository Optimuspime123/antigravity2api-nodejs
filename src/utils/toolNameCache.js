// Tool name mapping cache keyed by model + safeName.
// Tool names must be sanitized for upstream calls, then restored on return.

import memoryManager from './memoryManager.js';

// safeKey: `${model}::${safeName}` -> { originalName, ts }
const toolNameMap = new Map();

const MAX_ENTRIES = 16;
const ENTRY_TTL_MS = 30 * 60 * 1000;      // 30 minutes

function makeKey(model, safeName) {
  return `${model || ''}::${safeName || ''}`;
}

function pruneSize(targetSize) {
  if (toolNameMap.size <= targetSize) return;
  const removeCount = toolNameMap.size - targetSize;
  let removed = 0;
  for (const key of toolNameMap.keys()) {
    toolNameMap.delete(key);
    removed++;
    if (removed >= removeCount) break;
  }
}

function pruneExpired(now) {
  for (const [key, entry] of toolNameMap.entries()) {
    if (!entry || typeof entry.ts !== 'number') continue;
    if (now - entry.ts > ENTRY_TTL_MS) {
      toolNameMap.delete(key);
    }
  }
}

// Periodic cleanup is triggered centrally by memoryManager.
memoryManager.registerCleanup(() => {
  const now = Date.now();
  pruneExpired(now);
  pruneSize(MAX_ENTRIES);
});

export function setToolNameMapping(model, safeName, originalName) {
  if (!safeName || !originalName || safeName === originalName) return;
  const key = makeKey(model, safeName);
  toolNameMap.set(key, { originalName, ts: Date.now() });
  pruneSize(MAX_ENTRIES);
}

export function getOriginalToolName(model, safeName) {
  if (!safeName) return null;
  const key = makeKey(model, safeName);
  const entry = toolNameMap.get(key);
  if (!entry) return null;
  const now = Date.now();
  if (typeof entry.ts === 'number' && now - entry.ts > ENTRY_TTL_MS) {
    toolNameMap.delete(key);
    return null;
  }
  return entry.originalName || null;
}

export function clearToolNameMappings() {
  toolNameMap.clear();
}
