/**
 * Path utilities
 * Handles path resolution for pkg bundles and development environments
 * @module utils/paths
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Detect whether running in a pkg bundle
 * @type {boolean}
 */
export const isPkg = typeof process.pkg !== 'undefined';

/**
 * Get project root directory
 * @returns {string} project root path
 */
export function getProjectRoot() {
  if (isPkg) {
    return path.dirname(process.execPath);
  }
  return path.join(__dirname, '../..');
}

/**
 * Get data directory path
 * In pkg, use executable directory or current working directory
 * @returns {string} data directory path
 */
export function getDataDir() {
  if (isPkg) {
    // pkg: prefer data directory next to the executable
    const exeDir = path.dirname(process.execPath);
    const exeDataDir = path.join(exeDir, 'data');
    // Check whether files can be created in this directory
    try {
      if (!fs.existsSync(exeDataDir)) {
        fs.mkdirSync(exeDataDir, { recursive: true });
      }
      return exeDataDir;
    } catch (e) {
      // If creation fails, try current working directory
      const cwdDataDir = path.join(process.cwd(), 'data');
      try {
        if (!fs.existsSync(cwdDataDir)) {
          fs.mkdirSync(cwdDataDir, { recursive: true });
        }
        return cwdDataDir;
      } catch (e2) {
        // Final fallback: user home directory
        const homeDataDir = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.antigravity', 'data');
        if (!fs.existsSync(homeDataDir)) {
          fs.mkdirSync(homeDataDir, { recursive: true });
        }
        return homeDataDir;
      }
    }
  }
  // Development environment
  return path.join(__dirname, '..', '..', 'data');
}

/**
 * Get public static directory
 * @returns {string} public directory path
 */
export function getPublicDir() {
  if (isPkg) {
    // pkg: prefer public directory next to the executable
    const exeDir = path.dirname(process.execPath);
    const exePublicDir = path.join(exeDir, 'public');
    if (fs.existsSync(exePublicDir)) {
      return exePublicDir;
    }
    // Fallback to public directory in current working directory
    const cwdPublicDir = path.join(process.cwd(), 'public');
    if (fs.existsSync(cwdPublicDir)) {
      return cwdPublicDir;
    }
    // Final fallback: public directory inside the bundle (via snapshot)
    return path.join(__dirname, '../../public');
  }
  // Development environment
  return path.join(__dirname, '../../public');
}

/**
 * Get image storage directory
 * @returns {string} image directory path
 */
export function getImageDir() {
  if (isPkg) {
    // pkg: prefer public/images next to the executable
    const exeDir = path.dirname(process.execPath);
    const exeImageDir = path.join(exeDir, 'public', 'images');
    try {
      if (!fs.existsSync(exeImageDir)) {
        fs.mkdirSync(exeImageDir, { recursive: true });
      }
      return exeImageDir;
    } catch (e) {
      // If creation fails, try current working directory
      const cwdImageDir = path.join(process.cwd(), 'public', 'images');
      try {
        if (!fs.existsSync(cwdImageDir)) {
          fs.mkdirSync(cwdImageDir, { recursive: true });
        }
        return cwdImageDir;
      } catch (e2) {
        // Final fallback: user home directory
        const homeImageDir = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.antigravity', 'images');
        if (!fs.existsSync(homeImageDir)) {
          fs.mkdirSync(homeImageDir, { recursive: true });
        }
        return homeImageDir;
      }
    }
  }
  // Development environment
  return path.join(__dirname, '../../public/images');
}

/**
 * Get .env file path
 * @returns {string} .env file path
 */
export function getEnvPath() {
  if (isPkg) {
    // pkg: prefer .env next to the executable
    const exeDir = path.dirname(process.execPath);
    const exeEnvPath = path.join(exeDir, '.env');
    if (fs.existsSync(exeEnvPath)) {
      return exeEnvPath;
    }
    // Fallback to .env in current working directory
    const cwdEnvPath = path.join(process.cwd(), '.env');
    if (fs.existsSync(cwdEnvPath)) {
      return cwdEnvPath;
    }
    // Return executable directory path (even if missing)
    return exeEnvPath;
  }
  // Development environment
  return path.join(__dirname, '../../.env');
}

/**
 * Get config file paths
 * @returns {{envPath: string, configJsonPath: string, configJsonExamplePath: string, examplePath: string}} config paths
 */
export function getConfigPaths() {
  if (isPkg) {
    // pkg: prefer config files next to the executable
    const exeDir = path.dirname(process.execPath);
    const cwdDir = process.cwd();
    
    // Find .env file
    let envPath = path.join(exeDir, '.env');
    if (!fs.existsSync(envPath)) {
      const cwdEnvPath = path.join(cwdDir, '.env');
      if (fs.existsSync(cwdEnvPath)) {
        envPath = cwdEnvPath;
      }
    }
    
    // Find config.json file
    let configJsonPath = path.join(exeDir, 'config.json');
    if (!fs.existsSync(configJsonPath)) {
      const cwdConfigPath = path.join(cwdDir, 'config.json');
      if (fs.existsSync(cwdConfigPath)) {
        configJsonPath = cwdConfigPath;
      }
    }
    
    // Find config.json.example file
    let configJsonExamplePath = path.join(exeDir, 'config.json.example');
    if (!fs.existsSync(configJsonExamplePath)) {
      const cwdExamplePath = path.join(cwdDir, 'config.json.example');
      if (fs.existsSync(cwdExamplePath)) {
        configJsonExamplePath = cwdExamplePath;
      }
    }
    
    // Find .env.example file
    let examplePath = path.join(exeDir, '.env.example');
    if (!fs.existsSync(examplePath)) {
      const cwdExamplePath = path.join(cwdDir, '.env.example');
      if (fs.existsSync(cwdExamplePath)) {
        examplePath = cwdExamplePath;
      }
    }
    
    return { envPath, configJsonPath, configJsonExamplePath, examplePath };
  }
  
  // Development environment
  return {
    envPath: path.join(__dirname, '../../.env'),
    configJsonPath: path.join(__dirname, '../../config.json'),
    configJsonExamplePath: path.join(__dirname, '../../config.json.example'),
    examplePath: path.join(__dirname, '../../.env.example')
  };
}

/**
 * Compute relative path for log display
 * @param {string} absolutePath - absolute path
 * @returns {string} relative or original path
 */
export function getRelativePath(absolutePath) {
  if (isPkg) {
    const exeDir = path.dirname(process.execPath);
    if (absolutePath.startsWith(exeDir)) {
      return '.' + absolutePath.slice(exeDir.length).replace(/\\/g, '/');
    }
    const cwdDir = process.cwd();
    if (absolutePath.startsWith(cwdDir)) {
      return '.' + absolutePath.slice(cwdDir.length).replace(/\\/g, '/');
    }
  }
  return absolutePath;
}
