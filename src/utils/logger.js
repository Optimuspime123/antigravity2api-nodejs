/**
 * Logging utility module
 * Supports console output, WebSocket live push, and file persistence
 */
import logWsServer from './logWsServer.js';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  blue: '\x1b[34m'
};

/**
 * Format log arguments as strings
 */
function formatArgs(args) {
  return args.map(arg => {
    if (typeof arg === 'object') {
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    }
    return String(arg);
  }).join(' ');
}

function logMessage(level, ...args) {
  const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const color = { info: colors.green, warn: colors.yellow, error: colors.red, debug: colors.blue }[level];
  const message = formatArgs(args);

  // Output to console
  console.log(`${colors.gray}${timestamp}${colors.reset} ${color}[${level}]${colors.reset}`, ...args);

  // Store logs and push to WebSocket
  logWsServer.storeLog(level, message);
}

function logRequest(method, path, status, duration) {
  const statusColor = status >= 500 ? colors.red : status >= 400 ? colors.yellow : colors.green;
  const message = `[${method}] - ${path} ${status} ${duration}ms`;

  // Output to console
  console.log(`${colors.cyan}[${method}]${colors.reset} - ${path} ${statusColor}${status}${colors.reset} ${colors.gray}${duration}ms${colors.reset}`);

  // Store logs (level determined by status code)
  const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'request';
  logWsServer.storeLog(level, message);
}

export const log = {
  info: (...args) => logMessage('info', ...args),
  warn: (...args) => logMessage('warn', ...args),
  error: (...args) => logMessage('error', ...args),
  debug: (...args) => logMessage('debug', ...args),
  request: logRequest,
  // API methods (delegated to logWsServer)
  getLogs: (options) => logWsServer.getLogs(options),
  clearLogs: () => logWsServer.clearLogs(),
  getLogStats: () => logWsServer.getLogStats()
};

export default log;
