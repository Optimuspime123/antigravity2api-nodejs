import config, { getConfigJson } from '../config/config.js';

/**
 * Mapping table: config object paths -> config.json paths / environment variables.
 */
const CONFIG_MAPPING = [
  { target: 'server.port', source: 'server.port', default: 8045 },
  { target: 'server.host', source: 'server.host', default: '0.0.0.0' },
  { target: 'defaults.temperature', source: 'defaults.temperature', default: 1 },
  { target: 'defaults.top_p', source: 'defaults.topP', default: 0.85 },
  { target: 'defaults.top_k', source: 'defaults.topK', default: 50 },
  { target: 'defaults.max_tokens', source: 'defaults.maxTokens', default: 8096 },
  { target: 'timeout', source: 'other.timeout', default: 180000 },
  { target: 'skipProjectIdFetch', source: 'other.skipProjectIdFetch', default: false, transform: v => v === true },
  { target: 'maxImages', source: 'other.maxImages', default: 10 },
  { target: 'useNativeAxios', source: 'other.useNativeAxios', default: true, transform: v => v !== false },
  { target: 'api.url', source: 'api.url', default: 'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:streamGenerateContent?alt=sse' },
  { target: 'api.modelsUrl', source: 'api.modelsUrl', default: 'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:fetchAvailableModels' },
  { target: 'api.noStreamUrl', source: 'api.noStreamUrl', default: 'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:generateContent' },
  { target: 'api.host', source: 'api.host', default: 'daily-cloudcode-pa.sandbox.googleapis.com' },
  { target: 'api.userAgent', source: 'api.userAgent', default: 'antigravity/1.11.3 windows/amd64' }
];

const ENV_MAPPING = [
  { target: 'security.apiKey', env: 'API_KEY', default: null },
  { target: 'proxy', env: 'PROXY', default: null },
  { target: 'systemInstruction', env: 'SYSTEM_INSTRUCTION', default: '' }
];

/**
 * Get a value from a nested path.
 */
function getNestedValue(obj, path) {
  return path.split('.').reduce((acc, key) => acc?.[key], obj);
}

/**
 * Set a value at a nested path.
 */
function setNestedValue(obj, path, value) {
  const keys = path.split('.');
  const lastKey = keys.pop();
  const target = keys.reduce((acc, key) => acc[key], obj);
  target[lastKey] = value;
}

/**
 * Reload configuration into the config object.
 */
export function reloadConfig() {
  const jsonConfig = getConfigJson();
  
  // Update JSON configuration
  CONFIG_MAPPING.forEach(({ target, source, default: defaultValue, transform }) => {
    let value = getNestedValue(jsonConfig, source) ?? defaultValue;
    if (transform) value = transform(value);
    setNestedValue(config, target, value);
  });
  
  // Update environment variable configuration
  ENV_MAPPING.forEach(({ target, env, default: defaultValue }) => {
    const value = process.env[env] || defaultValue;
    setNestedValue(config, target, value);
  });
}
