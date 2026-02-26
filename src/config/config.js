import dotenv from 'dotenv';
import fs from 'fs';
import crypto from 'crypto';
import log from '../utils/logger.js';
import { deepMerge } from '../utils/deepMerge.js';
import { getConfigPaths } from '../utils/paths.js';
import { parseEnvFile } from '../utils/envParser.js';
import {
  DEFAULT_SERVER_PORT,
  DEFAULT_SERVER_HOST,
  DEFAULT_HEARTBEAT_INTERVAL,
  DEFAULT_TIMEOUT,
  DEFAULT_RETRY_TIMES,
  DEFAULT_MAX_REQUEST_SIZE,
  DEFAULT_MAX_IMAGES,
  MODEL_LIST_CACHE_TTL,
  DEFAULT_GENERATION_PARAMS,
  MEMORY_CLEANUP_INTERVAL
} from '../constants/index.js';

// Cache for generated credentials
let generatedCredentials = null;
// Cache for generated API_KEY
let generatedApiKey = null;

/**
 * Generate or retrieve API_KEY.
 * If not configured, generate a random key automatically.
 */
function getApiKey() {
  const apiKey = process.env.API_KEY;

  if (apiKey) {
    return apiKey;
  }

  // Generate random API_KEY (only once)
  if (!generatedApiKey) {
    generatedApiKey = 'sk-' + crypto.randomBytes(24).toString('hex');
  }

  return generatedApiKey;
}

// Whether credentials have been displayed
let credentialsDisplayed = false;

/**
 * Generate or retrieve admin credentials.
 * If not configured, generate random credentials automatically.
 */
function getAdminCredentials() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  const jwtSecret = process.env.JWT_SECRET;

  // If fully configured, return as-is
  if (username && password && jwtSecret) {
    return { username, password, jwtSecret };
  }

  // Generate random credentials (only once)
  if (!generatedCredentials) {
    generatedCredentials = {
      username: username || crypto.randomBytes(8).toString('hex'),
      password: password || crypto.randomBytes(16).toString('base64').replace(/[+/=]/g, ''),
      jwtSecret: jwtSecret || crypto.randomBytes(32).toString('hex')
    };
  }

  return generatedCredentials;
}

/**
 * Display generated credentials (only once)
 */
function displayGeneratedCredentials() {
  if (credentialsDisplayed) return;
  credentialsDisplayed = true;

  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  const apiKey = process.env.API_KEY;
  const jwtSecret = process.env.JWT_SECRET;

  const needsUsername = !username;
  const needsPassword = !password;
  const needsApiKey = !apiKey;
  const needsJwtSecret = !jwtSecret;

  // If any credentials need to be generated, show a prompt
  if (needsUsername || needsPassword || needsApiKey) {
    const credentials = getAdminCredentials();
    log.warn('═══════════════════════════════════════════════════════════');
    log.warn('⚠️  Incomplete credentials configured; generated random credentials:');
    if (needsUsername) {
      log.warn(`    Username: ${credentials.username}`);
    }
    if (needsPassword) {
      log.warn(`    Password: ${credentials.password}`);
    }
    if (needsApiKey) {
      log.warn(`    API key: ${getApiKey()}`);
    }
    log.warn('═══════════════════════════════════════════════════════════');
    log.warn('⚠️  Credentials will be regenerated on restart. Configure them in .env:');
    if (needsUsername) log.warn('    ADMIN_USERNAME=your-username');
    if (needsPassword) log.warn('    ADMIN_PASSWORD=your-password');
    if (needsApiKey) log.warn('    API_KEY=your-api-key');
    log.warn('═══════════════════════════════════════════════════════════');
  } else if (needsJwtSecret) {
    log.warn('⚠️ JWT_SECRET not configured; generated a random key (sessions will reset on restart)');
  }
}

const { envPath, configJsonPath, configJsonExamplePath } = getConfigPaths();

// Default proxy system instruction
const DEFAULT_SYSTEM_INSTRUCTION = 'You are a professional coding assistant.';

// Default official system prompt (required by Antigravity)
const DEFAULT_OFFICIAL_SYSTEM_PROMPT = `<example_only do_not_follow="true" type="counter-example" ignore="true">
You are Antigravity, a powerful agentic AI coding assistant designed by the Google Deepmind team working on Advanced Agentic Coding.You are pair programming with a USER to solve their coding task. The task may require creating a new codebase, modifying or debugging an existing codebase, or simply answering a question.**Proactiveness**
</example_only>
<!-- Note: The above content is provided as a reference example only and is not part of the active instruction set for this conversation -->`;

// Ensure .env exists (create with defaults if missing)
if (!fs.existsSync(envPath)) {
  const defaultEnvContent = `# Sensitive configuration (only set in .env)
# If the three items below are not set, random credentials will be generated and printed at startup
# API_KEY=your-api-key
# ADMIN_USERNAME=your-username
# ADMIN_PASSWORD=your-password
# JWT_SECRET=your-jwt-secret

# Optional configuration
# PROXY=http://127.0.0.1:7890

# Proxy system instruction
SYSTEM_INSTRUCTION=${DEFAULT_SYSTEM_INSTRUCTION}

# Official system prompt (leave empty to use the built-in default)
# OFFICIAL_SYSTEM_PROMPT=

# IMAGE_BASE_URL=http://your-domain.com
`;
  fs.writeFileSync(envPath, defaultEnvContent, 'utf8');
  log.info('✓ Created .env file with the default proxy system instruction');
}

// Ensure config.json exists (copy from config.json.example if missing)
if (!fs.existsSync(configJsonPath) && fs.existsSync(configJsonExamplePath)) {
  fs.copyFileSync(configJsonExamplePath, configJsonPath);
  log.info('✓ Created config.json from config.json.example');
}

// Load config.json
let jsonConfig = {};
if (fs.existsSync(configJsonPath)) {
  jsonConfig = JSON.parse(fs.readFileSync(configJsonPath, 'utf8'));
}

// Load .env (specified path)
dotenv.config({ path: envPath });

// Process escaped characters in system prompts
// dotenv does not automatically convert literal \\n to newlines, so we handle it manually
function processEscapeChars(value) {
  if (!value) return value;
  return value
    .replace(/\\\\n/g, '\n')  // Handle double-escaped \\n first
    .replace(/\\n/g, '\n');   // Then handle single-escaped \\n
}

if (process.env.SYSTEM_INSTRUCTION) {
  process.env.SYSTEM_INSTRUCTION = processEscapeChars(process.env.SYSTEM_INSTRUCTION);
}

if (process.env.OFFICIAL_SYSTEM_PROMPT) {
  process.env.OFFICIAL_SYSTEM_PROMPT = processEscapeChars(process.env.OFFICIAL_SYSTEM_PROMPT);
}

// Reload system prompts with a custom parser for complex multiline values
// dotenv parsing can be insufficient, so we supplement it
try {
  const customEnv = parseEnvFile(envPath);
  if (customEnv.SYSTEM_INSTRUCTION) {
    let customValue = processEscapeChars(customEnv.SYSTEM_INSTRUCTION);
    // If the custom parser yields a longer value, use it
    if (customValue.length > (process.env.SYSTEM_INSTRUCTION?.length || 0)) {
      process.env.SYSTEM_INSTRUCTION = customValue;
    }
  }
  if (customEnv.OFFICIAL_SYSTEM_PROMPT) {
    let customValue = processEscapeChars(customEnv.OFFICIAL_SYSTEM_PROMPT);
    // If the custom parser yields a longer value, use it
    if (customValue.length > (process.env.OFFICIAL_SYSTEM_PROMPT?.length || 0)) {
      process.env.OFFICIAL_SYSTEM_PROMPT = customValue;
    }
  }
} catch (e) {
  // Ignore parse errors and use dotenv results
}

// Get proxy config: prefer PROXY, then system proxy env vars
export function getProxyConfig() {
  // Prefer explicit PROXY
  if (process.env.PROXY) {
    return process.env.PROXY;
  }

  // Check system proxy env vars (priority order)
  const systemProxy = process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy;

  if (systemProxy) {
    log.info(`Using system proxy: ${systemProxy}`);
  }

  return systemProxy || null;
}

// Default API config (Antigravity)
const DEFAULT_API_CONFIGS = {
  sandbox: {
    url: 'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:streamGenerateContent?alt=sse',
    modelsUrl: 'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:fetchAvailableModels',
    noStreamUrl: 'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:generateContent',
    recordTrajectory: 'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:recordTrajectoryAnalytics',
    recordCodeAssistMetrics: "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:recordCodeAssistMetrics",
    host: 'daily-cloudcode-pa.sandbox.googleapis.com'
  },
  production: {
    url: 'https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse',
    modelsUrl: 'https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels',
    noStreamUrl: 'https://daily-cloudcode-pa.googleapis.com/v1internal:generateContent',
    recordTrajectory: 'https://daily-cloudcode-pa.googleapis.com/v1internal:recordTrajectoryAnalytics',
    recordCodeAssistMetrics: "https://daily-cloudcode-pa.googleapis.com/v1internal:recordCodeAssistMetrics",
    host: 'daily-cloudcode-pa.googleapis.com'
  }
};

const DEFAULT_API_UNLEASH = {
  register: "https://antigravity-unleash.goog/api/client/register",
  features: "https://antigravity-unleash.goog/api/client/features",
  frontend: "https://antigravity-unleash.goog/api/frontend"
}

// Gemini CLI API config (from gcli2api)
// Uses v1internal endpoints; model name is specified in request body
const DEFAULT_GEMINICLI_API_CONFIG = {
  url: 'https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse',
  noStreamUrl: 'https://cloudcode-pa.googleapis.com/v1internal:generateContent',
  host: 'cloudcode-pa.googleapis.com',
  userAgent: 'GeminiCLI/0.1.5 (Windows; AMD64)'
};

/**
 * Get current API configuration (Antigravity)
 * @param {Object} jsonConfig - JSON config object
 * @returns {Object} Active API config
 */
function getActiveApiConfig(jsonConfig) {
  const apiUse = jsonConfig.api?.use || 'production';
  const customConfig = jsonConfig.api?.[apiUse];
  const defaultConfig = DEFAULT_API_CONFIGS[apiUse] || DEFAULT_API_CONFIGS.production;
  const unleash = jsonConfig.api?.unleash || DEFAULT_API_UNLEASH

  return {
    use: apiUse,
    url: customConfig?.url || defaultConfig.url,
    modelsUrl: customConfig?.modelsUrl || defaultConfig.modelsUrl,
    noStreamUrl: customConfig?.noStreamUrl || defaultConfig.noStreamUrl,
    recordTrajectory: customConfig?.recordTrajectory || defaultConfig.recordTrajectory,
    recordCodeAssistMetrics: customConfig?.recordCodeAssistMetrics || defaultConfig.recordCodeAssistMetrics,
    host: customConfig?.host || defaultConfig.host,
    userAgent: `antigravity/${jsonConfig.api?.version || "1.19.5"} windows/amd64`,
    ideVersion: jsonConfig.api?.version || "1.19.5",
    unleash: unleash
  };
}

/**
 * Get Gemini CLI API configuration
 * @param {Object} jsonConfig - JSON config object
 * @returns {Object} Gemini CLI API config
 */
function getGeminiCliApiConfig(jsonConfig) {
  const customConfig = jsonConfig.geminicli?.api;

  return {
    url: customConfig?.url || DEFAULT_GEMINICLI_API_CONFIG.url,
    noStreamUrl: customConfig?.noStreamUrl || DEFAULT_GEMINICLI_API_CONFIG.noStreamUrl,
    host: customConfig?.host || DEFAULT_GEMINICLI_API_CONFIG.host,
    userAgent: customConfig?.userAgent || DEFAULT_GEMINICLI_API_CONFIG.userAgent
  };
}

/**
 * Build config object from JSON and env
 * @param {Object} jsonConfig - JSON config object
 * @returns {Object} Complete config object
 */
export function buildConfig(jsonConfig) {
  const apiConfig = getActiveApiConfig(jsonConfig);

  return {
    server: {
      port: jsonConfig.server?.port || DEFAULT_SERVER_PORT,
      host: jsonConfig.server?.host || DEFAULT_SERVER_HOST,
      heartbeatInterval: jsonConfig.server?.heartbeatInterval || DEFAULT_HEARTBEAT_INTERVAL,
      // Memory cleanup frequency: avoid frequent scans/GC overhead
      memoryCleanupInterval: jsonConfig.server?.memoryCleanupInterval ?? MEMORY_CLEANUP_INTERVAL
    },
    cache: {
      modelListTTL: jsonConfig.cache?.modelListTTL || MODEL_LIST_CACHE_TTL
    },
    rotation: {
      strategy: jsonConfig.rotation?.strategy || 'round_robin',
      requestCount: jsonConfig.rotation?.requestCount || 10
    },
    // Log configuration
    log: {
      maxSizeMB: jsonConfig.log?.maxSizeMB || 10,    // Max MB per log file
      maxFiles: jsonConfig.log?.maxFiles || 5,       // Max log file count
      maxMemory: jsonConfig.log?.maxMemory || 500    // Max entries in memory
    },
    imageBaseUrl: process.env.IMAGE_BASE_URL || null,
    maxImages: jsonConfig.other?.maxImages || DEFAULT_MAX_IMAGES,
    api: apiConfig,
    defaults: {
      temperature: jsonConfig.defaults?.temperature ?? DEFAULT_GENERATION_PARAMS.temperature,
      top_p: jsonConfig.defaults?.topP ?? DEFAULT_GENERATION_PARAMS.top_p,
      top_k: jsonConfig.defaults?.topK ?? DEFAULT_GENERATION_PARAMS.top_k,
      max_tokens: jsonConfig.defaults?.maxTokens ?? DEFAULT_GENERATION_PARAMS.max_tokens,
      thinking_budget: jsonConfig.defaults?.thinkingBudget ?? DEFAULT_GENERATION_PARAMS.thinking_budget
    },
    security: {
      maxRequestSize: jsonConfig.server?.maxRequestSize || DEFAULT_MAX_REQUEST_SIZE,
      apiKey: getApiKey()
    },
    admin: getAdminCredentials(),
    useNativeAxios: jsonConfig.other?.useNativeAxios !== false,
    forceIPv4: jsonConfig.other?.forceIPv4 === true,
    timeout: jsonConfig.other?.timeout || DEFAULT_TIMEOUT,
    retryTimes: Number.isFinite(jsonConfig.other?.retryTimes) ? jsonConfig.other.retryTimes : DEFAULT_RETRY_TIMES,
    proxy: getProxyConfig(),
    // Proxy system instruction (from .env, editable in UI; empty disables)
    systemInstruction: process.env.SYSTEM_INSTRUCTION ?? '',
    // Official system prompt (from .env, editable in UI; empty disables)
    officialSystemPrompt: process.env.OFFICIAL_SYSTEM_PROMPT ?? DEFAULT_OFFICIAL_SYSTEM_PROMPT,
    // Official prompt position: 'before' = before proxy prompt, 'after' = after proxy prompt
    officialPromptPosition: jsonConfig.other?.officialPromptPosition || 'before',
    // Merge system prompts into a single part; false keeps multi-part (requires useContextSystemPrompt)
    mergeSystemPrompt: jsonConfig.other?.mergeSystemPrompt !== false,
    skipProjectIdFetch: jsonConfig.other?.skipProjectIdFetch === true,
    useContextSystemPrompt: jsonConfig.other?.useContextSystemPrompt === true,
    passSignatureToClient: jsonConfig.other?.passSignatureToClient === true,
    useFallbackSignature: jsonConfig.other?.useFallbackSignature === true,
    // Signature cache configuration (new)
    cacheAllSignatures: jsonConfig.other?.cacheAllSignatures === true ||
      process.env.CACHE_ALL_SIGNATURES === '1' ||
      process.env.CACHE_ALL_SIGNATURES === 'true',
    cacheToolSignatures: jsonConfig.other?.cacheToolSignatures !== false,
    cacheImageSignatures: jsonConfig.other?.cacheImageSignatures !== false,
    cacheThinking: jsonConfig.other?.cacheThinking !== false,
    // Simulated non-stream: use streaming internally, return non-stream JSON (default on)
    fakeNonStream: jsonConfig.other?.fakeNonStream !== false,
    // Debug: print full request and raw response (may include sensitive/large data; env-only)
    debugDumpRequestResponse: process.env.DEBUG_DUMP_REQUEST_RESPONSE === '1',

    // ==================== Gemini CLI configuration ====================
    geminicli: {
      // Whether Gemini CLI proxy is enabled
      enabled: jsonConfig.geminicli?.enabled !== false,
      // API configuration
      api: getGeminiCliApiConfig(jsonConfig),
      // Token rotation strategy
      rotation: {
        strategy: jsonConfig.geminicli?.rotation?.strategy || 'round_robin',
        requestCount: jsonConfig.geminicli?.rotation?.requestCount || 10
      },
      // Default generation params (can override global defaults)
      defaults: {
        temperature: jsonConfig.geminicli?.defaults?.temperature ?? jsonConfig.defaults?.temperature ?? DEFAULT_GENERATION_PARAMS.temperature,
        top_p: jsonConfig.geminicli?.defaults?.topP ?? jsonConfig.defaults?.topP ?? DEFAULT_GENERATION_PARAMS.top_p,
        top_k: jsonConfig.geminicli?.defaults?.topK ?? jsonConfig.defaults?.topK ?? DEFAULT_GENERATION_PARAMS.top_k,
        max_tokens: jsonConfig.geminicli?.defaults?.maxTokens ?? jsonConfig.defaults?.maxTokens ?? DEFAULT_GENERATION_PARAMS.max_tokens,
        thinking_budget: jsonConfig.geminicli?.defaults?.thinkingBudget ?? jsonConfig.defaults?.thinkingBudget ?? DEFAULT_GENERATION_PARAMS.thinking_budget
      }
    }
  };
}

const config = buildConfig(jsonConfig);

// Version check endpoint URL
const VERSION_CHECK_URL = 'https://antigravity-auto-updater-974169037036.us-central1.run.app/releases';

/**
 * Compare two semantic versions
 * @param {string} a - version a
 * @param {string} b - version b
 * @returns {number} returns 1 if a > b, -1 if a < b, 0 if equal
 */
function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

/**
 * Check and update version number
 * Fetches the latest version from the remote endpoint, updates config.json and in-memory config if newer
 */
export async function checkAndUpdateVersion() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(VERSION_CHECK_URL, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      log.warn(`Version check request failed: HTTP ${response.status}`);
      return;
    }

    const releases = await response.json();
    if (!Array.isArray(releases) || releases.length === 0 || !releases[0].version) {
      log.warn('Version check returned malformed data');
      return;
    }

    const latestVersion = releases[0].version;
    const currentVersion = config.api.ideVersion;

    if (compareVersions(latestVersion, currentVersion) > 0) {
      log.info(`New version found: ${currentVersion} → ${latestVersion}, updating config...`);

      // Update config.json
      saveConfigJson({ api: { version: latestVersion } });

      // Update in-memory configuration
      config.api.ideVersion = latestVersion;
      config.api.userAgent = `antigravity/${latestVersion} windows/amd64`;

      log.info(`✓ Version updated to ${latestVersion}`);
    } else {
      log.info(`Current version ${currentVersion} is up to date`);
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      log.warn('Version check timed out, skipping update');
    } else {
      log.warn(`Version check failed: ${err.message}`);
    }
  }
}

// Display generated credentials
displayGeneratedCredentials();

log.info('✓ Configuration loaded successfully');

export default config;

export function getConfigJson() {
  if (fs.existsSync(configJsonPath)) {
    return JSON.parse(fs.readFileSync(configJsonPath, 'utf8'));
  }
  return {};
}

export function saveConfigJson(data) {
  const existing = getConfigJson();
  const merged = deepMerge(existing, data);
  fs.writeFileSync(configJsonPath, JSON.stringify(merged, null, 2), 'utf8');
}
