/**
 * Application constants
 * @module constants
 */

// ==================== Cache constants ====================

/**
 * File cache TTL (ms)
 * @type {number}
 */
export const FILE_CACHE_TTL = 5000;

/**
 * File save delay (ms) - used for debounce
 * @type {number}
 */
export const FILE_SAVE_DELAY = 1000;

/**
 * Quota cache TTL (ms) - 5 minutes
 * @type {number}
 */
export const QUOTA_CACHE_TTL = 5 * 60 * 1000;

/**
 * Quota cleanup interval (ms) - 1 hour
 * @type {number}
 */
export const QUOTA_CLEANUP_INTERVAL = 60 * 60 * 1000;

/**
 * Model list cache default TTL (ms) - 1 hour
 * @type {number}
 */
export const MODEL_LIST_CACHE_TTL = 60 * 60 * 1000;

// ==================== Memory management constants ====================

/**
 * Default memory cleanup interval (ms)
 * Within this interval, cleanup callbacks won't be triggered repeatedly even at MEDIUM/HIGH,
 * avoiding performance loss from frequent scans and releases.
 * @type {number}
 */
export const MEMORY_CLEANUP_INTERVAL = 30 * 60 * 1000;

// ==================== Server constants ====================

/**
 * Default heartbeat interval (ms)
 * @type {number}
 */
export const DEFAULT_HEARTBEAT_INTERVAL = 15000;

/**
 * Default server port
 * @type {number}
 */
export const DEFAULT_SERVER_PORT = 8045;

/**
 * Default server host
 * @type {string}
 */
export const DEFAULT_SERVER_HOST = '0.0.0.0';

/**
 * Default request timeout (ms)
 * @type {number}
 */
export const DEFAULT_TIMEOUT = 300000;

/**
 * Default retry attempts
 * @type {number}
 */
export const DEFAULT_RETRY_TIMES = 3;

/**
 * Default max request body size
 * @type {string}
 */
export const DEFAULT_MAX_REQUEST_SIZE = '50mb';

// ==================== Token rotation constants ====================

/**
 * Default requests per token before rotating
 * @type {number}
 */
export const DEFAULT_REQUEST_COUNT_PER_TOKEN = 50;

/**
 * Token refresh buffer before expiry (ms) - 5 minutes
 * @type {number}
 */
export const TOKEN_REFRESH_BUFFER = 300000;

// ==================== Generation defaults ====================

/**
 * Default generation parameters
 */
export const DEFAULT_GENERATION_PARAMS = {
  temperature: 1,
  top_p: 0.85,
  top_k: 50,
  max_tokens: 32000,
  thinking_budget: 1024
};

/**
 * Map reasoning_effort to thinkingBudget
 */
export const REASONING_EFFORT_MAP = {
  low: 1024,
  medium: 16000,
  high: 32000
};

// ==================== Image constants ====================

/**
 * Default max image retention
 * @type {number}
 */
export const DEFAULT_MAX_IMAGES = 10;

/**
 * MIME type to file extension map
 */
export const MIME_TO_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp'
};

// ==================== Stop sequences ====================

/**
 * Default stop sequences
 * @type {string[]}
 */
export const DEFAULT_STOP_SEQUENCES = [
  '<|user|>',
  '<|bot|>',
  '<|context_request|>',
  '<|endoftext|>',
  '<|end_of_turn|>'
];

// ==================== Admin defaults ====================

// Note: admin credentials (username, password, JWT secret) are now generated
// randomly by config.js. If not configured, the generated credentials will be
// printed at startup. Hard-coded defaults are no longer used for security.
