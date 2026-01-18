// Signature cache (file-backed):
// - Cache the "latest N signatures" per model (ring buffer)
// - Store signature with reasoning content: { signature, content }
// - FIFO eviction when exceeding capacity
// - Stored under data/signature-cache/

import fs from 'fs';
import path from 'path';
import config from '../config/config.js';
import log from './logger.js';

// Cache directory path
const CACHE_DIR = path.join(process.cwd(), 'data', 'signature-cache');

// Limit: number of signatures per model
const MAX_SIGNATURES_PER_MODEL = 3;

/**
 * Ensure cache directory exists
 */
function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

/**
 * Build cache filename for model (sanitize special chars)
 * @param {string} model - model name
 * @returns {string} safe file name
 */
function makeModelKey(model) {
  if (!model) return null;
  const raw = String(model);
  // Image models may include resolution suffixes (e.g. `-4K` / `-2K`) which
  // are stripped in actual requests. Cache by the base model to avoid misses.
  const baseModel = raw.replace(/-(?:1k|2k|4k|8k)$/i, '');
  // Replace unsafe filename characters with underscores
  return baseModel.replace(/[<>:"/\\|?*]/g, '_');
}

/**
 * Get cache file path for a model
 * @param {string} modelKey - model key
 * @returns {string} file path
 */
function getCacheFilePath(modelKey) {
  return path.join(CACHE_DIR, `${modelKey}.json`);
}

/**
 * Read model signature cache from file
 * @param {string} modelKey - model key
 * @returns {Array} signatures array [{ signature, content }, ...]
 */
function readModelCache(modelKey) {
  if (!modelKey) return [];
  
  try {
    const filePath = getCacheFilePath(modelKey);
    if (!fs.existsSync(filePath)) return [];
    
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(data.signatures) ? data.signatures : [];
  } catch (e) {
    log.warn(`Failed to read signature cache (${modelKey}):`, e?.message || e);
    return [];
  }
}

/**
 * Write signature cache to file
 * @param {string} modelKey - model key
 * @param {Array} signatures - signatures array
 */
function writeModelCache(modelKey, signatures) {
  if (!modelKey) return;
  
  try {
    ensureCacheDir();
    const filePath = getCacheFilePath(modelKey);
    const data = {
      model: modelKey,
      signatures: signatures,
      lastModified: Date.now()
    };
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    log.warn(`Failed to write signature cache (${modelKey}):`, e?.message || e);
  }
}

/**
 * Get latest signature entry
 * @param {string} modelKey - model key
 * @returns {{ signature: string, content: string } | null}
 */
function getLatestEntry(modelKey) {
  if (!modelKey) return null;
  
  const signatures = readModelCache(modelKey);
  if (signatures.length === 0) return null;
  
  return signatures[signatures.length - 1] || null;
}

/**
 * Add a new signature entry (FIFO ring buffer)
 * @param {string} modelKey - model key
 * @param {Object} entry - signature entry { signature, content }
 */
function pushEntry(modelKey, entry) {
  if (!modelKey || !entry || !entry.signature) return;
  
  const signatures = readModelCache(modelKey);
  
  // De-dupe: avoid enqueuing the same signature twice
  if (signatures.length > 0 && signatures[signatures.length - 1]?.signature === entry.signature) {
    return;
  }
  
  // Add new entry
  signatures.push(entry);
  
  // Remove oldest entries when exceeding capacity
  while (signatures.length > MAX_SIGNATURES_PER_MODEL) {
    signatures.shift();
  }
  
  writeModelCache(modelKey, signatures);
}

/**
 * Determine whether to cache signature
 * @param {Object} options - options
 * @param {boolean} options.hasTools - whether tools were used
 * @param {boolean} options.isImageModel - whether image model
 * @returns {boolean}
 */
export function shouldCacheSignature({ hasTools = false, isImageModel = false } = {}) {
  // Cache everything when enabled
  if (config.cacheAllSignatures) return true;
  
  // Cache tool signatures when tools were used
  if (config.cacheToolSignatures && hasTools) return true;
  
  // Cache image signatures for image models
  if (config.cacheImageSignatures && isImageModel) return true;
  
  return false;
}

/**
 * Determine if the model is an image model
 * @param {string} model - model name
 * @returns {boolean}
 */
export function isImageModel(model) {
  if (!model) return false;
  const lowerModel = model.toLowerCase();
  // Image models usually include 'image'
  return lowerModel.includes('image');
}

/**
 * Process reasoning content (based on cacheThinking setting)
 * @param {string} content - raw reasoning content
 * @returns {string} processed content
 */
function processThinkingContent(content) {
  if (!config.cacheThinking) {
    return ' '; // Use space when not caching reasoning content
  }
  return content || ' ';
}

/**
 * Set signature and content (generic interface)
 * @param {string} sessionId - session ID (kept for compatibility, not used in cache key)
 * @param {string} model - model name
 * @param {string} signature - signature
 * @param {string} content - reasoning content (optional)
 * @param {Object} options - options
 * @param {boolean} options.hasTools - whether tools were used
 * @param {boolean} options.isImageModel - whether image model
 */
export function setSignature(sessionId, model, signature, content = ' ', options = {}) {
  if (!signature || !model) return;
  
  // Decide whether to cache
  const isImage = options.isImageModel ?? isImageModel(model);
  const hasTools = options.hasTools ?? false;
  
  if (!shouldCacheSignature({ hasTools, isImageModel: isImage })) {
    return; // Does not meet caching criteria
  }
  
  const processedContent = processThinkingContent(content);
  pushEntry(makeModelKey(model), { signature, content: processedContent });
}

/**
 * Get signature and content
 * @param {string} sessionId - session ID
 * @param {string} model - model name
 * @param {Object} options - options
 * @param {boolean} options.hasTools - whether tools were used
 * @returns {{ signature: string, content: string } | null}
 */
export function getSignature(sessionId, model, options = {}) {
  if (!model) return null;
  
  const entry = getLatestEntry(makeModelKey(model));
  if (!entry) return null;
  
  // Return content based on cacheThinking config
  return {
    signature: entry.signature,
    content: config.cacheThinking ? entry.content : ' '
  };
}

// ========== Backward-compatible API ==========

/**
 * Set reasoning signature and content (backward compatible)
 * @param {string} sessionId - session ID
 * @param {string} model - model name
 * @param {string} signature - signature
 * @param {string} content - reasoning content
 * @param {Object} options - options
 */
export function setReasoningSignature(sessionId, model, signature, content = ' ', options = {}) {
  setSignature(sessionId, model, signature, content, options);
}

/**
 * Get reasoning signature and content (backward compatible)
 * @param {string} sessionId - session ID
 * @param {string} model - model name
 * @param {Object} options - options
 * @returns {{ signature: string, content: string } | null}
 */
export function getReasoningSignature(sessionId, model, options = {}) {
  return getSignature(sessionId, model, options);
}

/**
 * Set tool signature and content (backward compatible; now unified storage)
 * @param {string} sessionId - session ID
 * @param {string} model - model name
 * @param {string} signature - signature
 * @param {string} content - reasoning content
 * @param {Object} options - options
 */
export function setToolSignature(sessionId, model, signature, content = ' ', options = {}) {
  // Tool signatures default to hasTools = true
  setSignature(sessionId, model, signature, content, { ...options, hasTools: true });
}

/**
 * Get tool signature and content (backward compatible)
 * @param {string} sessionId - session ID
 * @param {string} model - model name
 * @param {Object} options - options
 * @returns {{ signature: string, content: string } | null}
 */
export function getToolSignature(sessionId, model, options = {}) {
  return getSignature(sessionId, model, options);
}

/**
 * Clear all signature caches (delete all cache files)
 */
export function clearThoughtSignatureCaches() {
  try {
    if (fs.existsSync(CACHE_DIR)) {
      const files = fs.readdirSync(CACHE_DIR);
      for (const file of files) {
        if (file.endsWith('.json')) {
          fs.unlinkSync(path.join(CACHE_DIR, file));
        }
      }
    }
    log.info('Signature cache cleared');
  } catch (e) {
    log.warn('Failed to clear signature cache:', e?.message || e);
  }
}

// Ensure directory exists on init
ensureCacheDir();
