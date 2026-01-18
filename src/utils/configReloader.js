import config, { getConfigJson, buildConfig } from '../config/config.js';

/**
 * Reload config into the config object
 */
export function reloadConfig() {
  const newConfig = buildConfig(getConfigJson());
  Object.assign(config, newConfig);
}
