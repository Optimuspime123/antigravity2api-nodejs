import express from 'express';
import { generateToken, authMiddleware, verifyToken } from '../auth/jwt.js';
import tokenManager from '../auth/token_manager.js';
import geminicliTokenManager from '../auth/geminicli_token_manager.js';
import quotaManager from '../auth/quota_manager.js';
import oauthManager from '../auth/oauth_manager.js';
import config, { getConfigJson, saveConfigJson } from '../config/config.js';
import logger from '../utils/logger.js';
import memoryManager from '../utils/memoryManager.js';
import { parseEnvFile, updateEnvFile } from '../utils/envParser.js';
import { reloadConfig } from '../utils/configReloader.js';
import { deepMerge } from '../utils/deepMerge.js';
import { getModelsWithQuotas } from '../api/client.js';
import { getEnvPath } from '../utils/paths.js';
import dotenv from 'dotenv';

const envPath = getEnvPath();

const router = express.Router();

// Disable cache middleware to keep admin data real-time
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// Cookie configuration
const COOKIE_OPTIONS = {
  httpOnly: true,
  // secure: process.env.NODE_ENV === 'production', // Removed static config; use dynamic check
  sameSite: 'strict',
  maxAge: 24 * 60 * 60 * 1000 // 24 hours
};

// Middleware to get JWT token from cookie or header
const cookieAuthMiddleware = (req, res, next) => {
  // Prefer cookie
  let token = req.cookies?.authToken;

  // If missing in cookie, try header (legacy compatibility)
  if (!token) {
    const authHeader = req.headers.authorization;
    token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  }

  if (!token) {
    return res.status(401).json({ error: 'Token required' });
  }

  try {
    const decoded = verifyToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    // Clear invalid cookie
    res.clearCookie('authToken', {
      ...COOKIE_OPTIONS,
      secure: req.secure || process.env.NODE_ENV === 'production'
    });
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// Login rate limiting - prevent brute force
const loginAttempts = new Map(); // IP -> { count, lastAttempt, blockedUntil }
const MAX_LOGIN_ATTEMPTS = 5;
const BLOCK_DURATION = 5 * 60 * 1000; // 5 minutes
const ATTEMPT_WINDOW = 15 * 60 * 1000; // 15-minute window
const LOGIN_CLEANUP_INTERVAL = 10 * 60 * 1000; // cleanup every 10 minutes

// Periodically clean expired login attempts (avoid memory leaks)
const loginCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [ip, attempt] of loginAttempts.entries()) {
    // Remove record if last attempt is outside window and not blocked (or block expired)
    if (now - attempt.lastAttempt > ATTEMPT_WINDOW &&
      (!attempt.blockedUntil || now > attempt.blockedUntil)) {
      loginAttempts.delete(ip);
    }
  }
}, LOGIN_CLEANUP_INTERVAL);
loginCleanupTimer.unref(); // Do not block process exit

function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.connection?.remoteAddress ||
    req.ip ||
    'unknown';
}

function checkLoginRateLimit(ip) {
  const now = Date.now();
  const attempt = loginAttempts.get(ip);

  if (!attempt) return { allowed: true };

  // Check if blocked
  if (attempt.blockedUntil && now < attempt.blockedUntil) {
    const remainingSeconds = Math.ceil((attempt.blockedUntil - now) / 1000);
    return {
      allowed: false,
      message: `Too many login attempts. Try again in ${remainingSeconds} seconds.`,
      remainingSeconds
    };
  }

  // Clean expired attempt record
  if (now - attempt.lastAttempt > ATTEMPT_WINDOW) {
    loginAttempts.delete(ip);
    return { allowed: true };
  }

  return { allowed: true };
}

function recordLoginAttempt(ip, success) {
  const now = Date.now();

  if (success) {
    // Login success: clear record
    loginAttempts.delete(ip);
    return;
  }

  // Login failed: record attempt
  const attempt = loginAttempts.get(ip) || { count: 0, lastAttempt: now };
  attempt.count++;
  attempt.lastAttempt = now;

  // Block after max attempts
  if (attempt.count >= MAX_LOGIN_ATTEMPTS) {
    attempt.blockedUntil = now + BLOCK_DURATION;
    logger.warn(`IP ${ip} temporarily blocked due to repeated login failures`);
  }

  loginAttempts.set(ip, attempt);
}

// Login endpoint
router.post('/login', (req, res) => {
  const clientIP = getClientIP(req);

  // Check rate limit
  const rateCheck = checkLoginRateLimit(clientIP);
  if (!rateCheck.allowed) {
    return res.status(429).json({
      success: false,
      message: rateCheck.message,
      retryAfter: rateCheck.remainingSeconds
    });
  }

  const { username, password } = req.body;

  // Validate input
  if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ success: false, message: 'Username and password are required' });
  }

  // Limit input length to prevent DoS
  if (username.length > 100 || password.length > 100) {
    return res.status(400).json({ success: false, message: 'Input too long' });
  }

  if (username === config.admin.username && password === config.admin.password) {
    recordLoginAttempt(clientIP, true);
    const token = generateToken({ username, role: 'admin' });

    // Set HttpOnly cookie
    // Set secure dynamically: enable if HTTPS (req.secure) or in production
    res.cookie('authToken', token, {
      ...COOKIE_OPTIONS,
      secure: req.secure || process.env.NODE_ENV === 'production'
    });

    // Return token as well (legacy frontend compatibility)
    logger.info(`Admin login succeeded IP: ${clientIP}`);
    res.json({ success: true, token });
  } else {
    recordLoginAttempt(clientIP, false);
    logger.warn(`Admin login failed IP: ${clientIP}`);
    res.status(401).json({ success: false, message: 'Invalid username or password' });
  }
});

// Logout endpoint
router.post('/logout', (req, res) => {
  res.clearCookie('authToken', {
    ...COOKIE_OPTIONS,
    secure: req.secure || process.env.NODE_ENV === 'production'
  });
  res.json({ success: true, message: 'Logged out' });
});

// Verify password (for sensitive operations)
function verifyPassword(password) {
  return password === config.admin.password;
}

// Token management API - requires JWT auth (prefer cookie)
router.get('/tokens', cookieAuthMiddleware, async (req, res) => {
  try {
    const tokens = await tokenManager.getTokenList();
    res.json({ success: true, data: tokens });
  } catch (error) {
    logger.error('Failed to fetch token list:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/tokens', cookieAuthMiddleware, async (req, res) => {
  const { access_token, refresh_token, expires_in, timestamp, enable, projectId, email } = req.body;
  if (!access_token || !refresh_token) {
    return res.status(400).json({ success: false, message: 'access_token and refresh_token are required' });
  }
  const tokenData = { access_token, refresh_token, expires_in };
  if (timestamp) tokenData.timestamp = timestamp;
  if (enable !== undefined) tokenData.enable = enable;
  if (projectId) tokenData.projectId = projectId;
  if (email) tokenData.email = email;

  try {
    const result = await tokenManager.addToken(tokenData);
    logger.info(`Adding new token: ${access_token.substring(0, 8)}...`);
    res.json(result);
  } catch (error) {
    logger.error('Failed to add token:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Use tokenId instead of refreshToken
router.put('/tokens/:tokenId', cookieAuthMiddleware, async (req, res) => {
  const { tokenId } = req.params;
  const updates = req.body;

  // Do not allow sensitive fields to be updated via API
  delete updates.access_token;
  delete updates.refresh_token;

  try {
    const result = await tokenManager.updateTokenById(tokenId, updates);
    logger.info(`Updating token: ${tokenId}`);
    res.json(result);
  } catch (error) {
    logger.error('Failed to update token:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.delete('/tokens/:tokenId', cookieAuthMiddleware, async (req, res) => {
  const { tokenId } = req.params;
  try {
    const result = await tokenManager.deleteTokenById(tokenId);
    logger.info(`Deleting token: ${tokenId}`);
    res.json(result);
  } catch (error) {
    logger.error('Failed to delete token:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/tokens/reload', cookieAuthMiddleware, async (req, res) => {
  try {
    await tokenManager.reload();
    logger.info('Manually triggered token hot reload');
    res.json({ success: true, message: 'Tokens hot reloaded' });
  } catch (error) {
    logger.error('Hot reload failed:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Refresh access_token for a specific token (using tokenId)
router.post('/tokens/:tokenId/refresh', cookieAuthMiddleware, async (req, res) => {
  const { tokenId } = req.params;
  try {
    const result = await tokenManager.refreshTokenById(tokenId);
    logger.info(`Manually refreshing token: ${tokenId}`);
    res.json({ success: true, message: 'Token refreshed successfully', data: result });
  } catch (error) {
    logger.error('Failed to refresh token:', error.message);
    const status = error.statusCode || 500;
    res.status(status).json({ success: false, message: error.message });
  }
});

// Manually fetch Project ID for a token (using tokenId)
router.post('/tokens/:tokenId/fetch-project-id', cookieAuthMiddleware, async (req, res) => {
  const { tokenId } = req.params;
  try {
    const result = await tokenManager.fetchProjectIdForToken(tokenId);
    logger.info(`Manually fetching ProjectId: ${tokenId} -> ${result.projectId}`);
    res.json({ success: true, message: 'Project ID fetched successfully', projectId: result.projectId });
  } catch (error) {
    logger.error('Failed to fetch ProjectId:', error.message);
    const status = error.statusCode || 500;
    res.status(status).json({ success: false, message: error.message });
  }
});

// Export all tokens (password required)
router.post('/tokens/export', cookieAuthMiddleware, async (req, res) => {
  const { password } = req.body;

  if (!password || !verifyPassword(password)) {
    return res.status(403).json({ success: false, message: 'Password verification failed' });
  }

  try {
    const allTokens = await tokenManager.store.readAll();

    // Export format: includes full token data
    logger.info('Exporting all token data');
    const exportData = {
      version: 1,
      exportTime: new Date().toISOString(),
      tokens: allTokens.map(token => ({
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_in: token.expires_in,
        timestamp: token.timestamp,
        enable: token.enable,
        projectId: token.projectId,
        email: token.email,
        hasQuota: token.hasQuota
      }))
    };

    res.json({ success: true, data: exportData });
  } catch (error) {
    logger.error('Failed to export tokens:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Smart field lookup (case-insensitive, substring match)
function findFieldByKeyword(obj, keyword) {
  if (!obj || typeof obj !== 'object') return undefined;
  const lowerKeyword = keyword.toLowerCase();
  for (const key of Object.keys(obj)) {
    if (key.toLowerCase().includes(lowerKeyword)) {
      return obj[key];
    }
  }
  return undefined;
}

// Smart parse a single token object
function smartParseToken(rawToken) {
  if (!rawToken || typeof rawToken !== 'object') return null;

  // Required fields: refresh => refresh_token, project => projectId
  const refresh_token = findFieldByKeyword(rawToken, 'refresh');
  const projectId = findFieldByKeyword(rawToken, 'project');

  // Must include both fields
  if (!refresh_token || !projectId) return null;

  // Build a normalized token object
  const token = { refresh_token, projectId };

  // Optional fields are auto-populated
  const access_token = findFieldByKeyword(rawToken, 'access');
  const email = findFieldByKeyword(rawToken, 'email') || findFieldByKeyword(rawToken, 'mail');
  const expires_in = findFieldByKeyword(rawToken, 'expire');
  const enable = findFieldByKeyword(rawToken, 'enable');
  const timestamp = findFieldByKeyword(rawToken, 'time') || findFieldByKeyword(rawToken, 'stamp');
  const hasQuota = findFieldByKeyword(rawToken, 'quota');

  if (access_token) token.access_token = access_token;
  if (email) token.email = email;
  if (expires_in !== undefined) token.expires_in = parseInt(expires_in) || 3599;
  if (enable !== undefined) token.enable = enable === true || enable === 'true' || enable === 1;
  if (timestamp) token.timestamp = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime();
  if (hasQuota !== undefined) token.hasQuota = hasQuota === true || hasQuota === 'true' || hasQuota === 1;

  return token;
}

// ==================== Gemini CLI token import parsing helpers ====================

function extractGeminiCliImportList(data) {
  // Support multiple gcli export formats:
  // - { tokens: [...] }
  // - { accounts: [...] }
  // - { data: { tokens/accounts: [...] } }
  // - direct array [...]
  // - single credential object { token/refresh_token/project_id/expiry/... }
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return null;

  const list = data.tokens || data.accounts || data.data?.tokens || data.data?.accounts;
  if (Array.isArray(list)) return list;

  const hasRefresh = !!(data.refresh_token || data.refreshToken);
  const hasAccess = !!(data.access_token || data.accessToken || data.token);
  if (hasRefresh || hasAccess) return [data];
  return null;
}

function normalizeTruthyBoolean(value) {
  return value === true || value === 'true' || value === 1;
}

function parseGeminiCliEnable(rawToken) {
  // enable/enabled/disabled compatibility
  let enable = findFieldByKeyword(rawToken, 'enable');
  if (enable === undefined) enable = findFieldByKeyword(rawToken, 'enabled');
  let disabled = findFieldByKeyword(rawToken, 'disable');
  if (disabled === undefined) disabled = findFieldByKeyword(rawToken, 'disabled');
  if (enable === undefined && disabled !== undefined) {
    enable = !normalizeTruthyBoolean(disabled);
  }
  if (enable === undefined) enable = true;
  return normalizeTruthyBoolean(enable);
}

function deriveExpiresInAndTimestamp({ expires_in, expiry, timestamp }) {
  // expires_in / expiry compatibility:
  // - if expires_in (seconds) exists -> use directly
  // - if only expiry (ISO8601) -> compute remaining seconds and set timestamp to now
  const nowMs = Date.now();

  let finalExpiresIn = null;
  if (expires_in !== undefined && expires_in !== null && String(expires_in).trim() !== '') {
    const n = parseInt(expires_in, 10);
    if (Number.isFinite(n) && n > 0) finalExpiresIn = n;
  }

  let finalTimestamp = undefined;
  if (finalExpiresIn === null && typeof expiry === 'string' && expiry.trim()) {
    const expiryMs = Date.parse(expiry);
    if (Number.isFinite(expiryMs)) {
      finalExpiresIn = Math.max(1, Math.floor((expiryMs - nowMs) / 1000));
      // When using expiry, let timestamp represent "time token was obtained"
      finalTimestamp = nowMs;
    }
  }

  if (finalTimestamp === undefined) {
    if (timestamp) {
      finalTimestamp = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime();
    } else {
      finalTimestamp = nowMs;
    }
  }

  return {
    expires_in: finalExpiresIn ?? 3599,
    timestamp: finalTimestamp
  };
}

function smartParseGeminiCliToken(rawToken) {
  if (!rawToken || typeof rawToken !== 'object') return null;

  const refresh_token = findFieldByKeyword(rawToken, 'refresh');
  if (!refresh_token) return null;

  const token = { refresh_token };

  // Common gcli field: token (= access_token)
  const access_token = findFieldByKeyword(rawToken, 'access') || rawToken.token;
  const email = findFieldByKeyword(rawToken, 'email') || findFieldByKeyword(rawToken, 'mail');
  const expires_in = findFieldByKeyword(rawToken, 'expires') || findFieldByKeyword(rawToken, 'expire');
  const timestamp = findFieldByKeyword(rawToken, 'time') || findFieldByKeyword(rawToken, 'stamp') || findFieldByKeyword(rawToken, 'created');
  const expiry = findFieldByKeyword(rawToken, 'expiry') || findFieldByKeyword(rawToken, 'expiresat');
  const projectId = findFieldByKeyword(rawToken, 'project');

  if (access_token) token.access_token = access_token;
  if (email) token.email = email;
  if (projectId) token.projectId = projectId;

  const derived = deriveExpiresInAndTimestamp({ expires_in, expiry, timestamp });
  token.expires_in = derived.expires_in;
  token.timestamp = derived.timestamp;
  token.enable = parseGeminiCliEnable(rawToken);

  return token;
}

// Import tokens (password required, supports smart field mapping)
router.post('/tokens/import', cookieAuthMiddleware, async (req, res) => {
  const { password, data, mode = 'merge' } = req.body;

  if (!password || !verifyPassword(password)) {
    return res.status(403).json({ success: false, message: 'Password verification failed' });
  }

  if (!data || !data.tokens || !Array.isArray(data.tokens)) {
    return res.status(400).json({ success: false, message: 'Invalid import data format' });
  }

  try {
    const importTokens = data.tokens;
    let addedCount = 0;
    let skippedCount = 0;
    let updatedCount = 0;

    // Smart parse all tokens
    const parsedTokens = [];
    for (const rawToken of importTokens) {
      const parsed = smartParseToken(rawToken);
      if (parsed) {
        parsedTokens.push(parsed);
      } else {
        skippedCount++;
      }
    }

    if (mode === 'replace') {
      // Replace mode: clear existing data, import new data
      await tokenManager.store.writeAll(parsedTokens);
      addedCount = parsedTokens.length;
    } else {
      // Merge mode: dedupe by refresh_token
      const existingTokens = await tokenManager.store.readAll();
      const existingRefreshTokens = new Set(existingTokens.map(t => t.refresh_token));

      for (const token of parsedTokens) {
        if (existingRefreshTokens.has(token.refresh_token)) {
          // Update existing token
          const index = existingTokens.findIndex(t => t.refresh_token === token.refresh_token);
          if (index !== -1) {
            existingTokens[index] = { ...existingTokens[index], ...token };
            updatedCount++;
          }
        } else {
          // Add new token
          existingTokens.push(token);
          addedCount++;
        }
      }

      await tokenManager.store.writeAll(existingTokens);
    }

    await tokenManager.reload();

    logger.info(`Imported tokens: added ${addedCount}, updated ${updatedCount}, skipped ${skippedCount}`);
    res.json({
      success: true,
      message: `Import completed: added ${addedCount}, updated ${updatedCount}, skipped ${skippedCount}`,
      data: { added: addedCount, updated: updatedCount, skipped: skippedCount }
    });
  } catch (error) {
    logger.error('Failed to import tokens:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/oauth/exchange', cookieAuthMiddleware, async (req, res) => {
  const { code, port, mode = 'antigravity' } = req.body;
  if (!code || !port) {
    return res.status(400).json({ success: false, message: 'code and port are required' });
  }

  try {
    const account = await oauthManager.authenticate(code, port, mode);
    
    if (mode === 'geminicli') {
      // Gemini CLI mode
      res.json({ success: true, data: account, message: 'Gemini CLI token added successfully' });
    } else {
      // Antigravity mode
      const message = account.hasQuota
        ? 'Token added successfully'
        : 'Token added successfully (account ineligible; random ProjectId assigned)';
      res.json({ success: true, data: account, message, fallbackMode: !account.hasQuota });
    }
  } catch (error) {
    logger.error(`[${mode}] Authentication failed:`, error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get configuration
router.get('/config', cookieAuthMiddleware, (req, res) => {
  try {
    const envData = parseEnvFile(envPath);
    const jsonData = getConfigJson();

    res.json({ success: true, data: { env: envData, json: jsonData } });
  } catch (error) {
    logger.error('Failed to read configuration:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update configuration
router.put('/config', cookieAuthMiddleware, (req, res) => {
  try {
    const { env: envUpdates, json: jsonUpdates, password } = req.body;

    // Security check: if updating official system prompt, verify password
    if (envUpdates && envUpdates.OFFICIAL_SYSTEM_PROMPT !== undefined) {
      const currentEnv = parseEnvFile(envPath);
      // Normalize newlines before comparing to avoid \r\n vs \n mismatch
      const normalizeNewlines = (str) => (str || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
      const newValue = normalizeNewlines(envUpdates.OFFICIAL_SYSTEM_PROMPT);
      const oldValue = normalizeNewlines(currentEnv.OFFICIAL_SYSTEM_PROMPT);

      // Only check when the value actually changes
      if (newValue !== oldValue) {
        if (!password || !verifyPassword(password)) {
          logger.warn(`Attempted to change official system prompt but password validation failed IP: ${getClientIP(req)}`);
          return res.status(403).json({
            success: false,
            message: 'Updating the official system prompt requires admin password verification'
          });
        }
      }
    }

    if (envUpdates) updateEnvFile(envPath, envUpdates);
    if (jsonUpdates) saveConfigJson(deepMerge(getConfigJson(), jsonUpdates));

    dotenv.config({ override: true });
    reloadConfig();

    // Apply runtime config that can be hot-reloaded
    memoryManager.setCleanupInterval(config.server.memoryCleanupInterval);

    logger.info('System configuration updated and hot reloaded');
    res.json({ success: true, message: 'Configuration saved and applied (port/HOST changes require restart)' });
  } catch (error) {
    logger.error('Failed to update configuration:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get rotation strategy config
router.get('/rotation', cookieAuthMiddleware, (req, res) => {
  try {
    const rotationConfig = tokenManager.getRotationConfig();
    res.json({ success: true, data: rotationConfig });
  } catch (error) {
    logger.error('Failed to fetch rotation config:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update rotation strategy config
router.put('/rotation', cookieAuthMiddleware, (req, res) => {
  try {
    const { strategy, requestCount } = req.body;

    // Validate strategy value
    const validStrategies = ['round_robin', 'quota_exhausted', 'request_count'];
    if (strategy && !validStrategies.includes(strategy)) {
      return res.status(400).json({
        success: false,
        message: `Invalid strategy. Valid values: ${validStrategies.join(', ')}`
      });
    }

    // Update in-memory config
    tokenManager.updateRotationConfig(strategy, requestCount);

    // Save to config.json
    const currentConfig = getConfigJson();
    if (!currentConfig.rotation) currentConfig.rotation = {};
    if (strategy) currentConfig.rotation.strategy = strategy;
    if (requestCount) currentConfig.rotation.requestCount = requestCount;
    saveConfigJson(currentConfig);

    // Reload config into memory
    reloadConfig();

    logger.info(`Rotation strategy updated: ${strategy || 'unchanged'}, request count: ${requestCount || 'unchanged'}`);
    res.json({ success: true, message: 'Rotation strategy updated', data: tokenManager.getRotationConfig() });
  } catch (error) {
    logger.error('Failed to update rotation config:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==================== Log management API ====================

// Get log list
router.get('/logs', cookieAuthMiddleware, (req, res) => {
  try {
    const { level, search, limit, offset } = req.query;
    const options = {
      level: level || 'all',
      search: search || '',
      limit: parseInt(limit) || 100,
      offset: parseInt(offset) || 0
    };

    const result = logger.getLogs(options);
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('Failed to fetch logs:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get log stats
router.get('/logs/stats', cookieAuthMiddleware, (req, res) => {
  try {
    const stats = logger.getLogStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    logger.error('Failed to fetch log stats:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Clear logs
router.delete('/logs', cookieAuthMiddleware, (req, res) => {
  try {
    logger.clearLogs();
    logger.info('Logs cleared');
    res.json({ success: true, message: 'Logs cleared' });
  } catch (error) {
    logger.error('Failed to clear logs:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==================== Token quota API ====================

// ==================== Gemini CLI token management API ====================

// Get Gemini CLI token list
router.get('/geminicli/tokens', cookieAuthMiddleware, async (req, res) => {
  try {
    const tokens = await geminicliTokenManager.getTokenList();
    res.json({ success: true, data: tokens });
  } catch (error) {
    logger.error('[GeminiCLI] Failed to fetch token list:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Add Gemini CLI token
router.post('/geminicli/tokens', cookieAuthMiddleware, async (req, res) => {
  const { access_token, refresh_token, expires_in, timestamp, enable, email } = req.body;
  if (!access_token || !refresh_token) {
    return res.status(400).json({ success: false, message: 'access_token and refresh_token are required' });
  }
  const tokenData = { access_token, refresh_token, expires_in };
  if (timestamp) tokenData.timestamp = timestamp;
  if (enable !== undefined) tokenData.enable = enable;
  if (email) tokenData.email = email;

  try {
    const result = await geminicliTokenManager.addToken(tokenData);
    logger.info(`[GeminiCLI] Adding new token: ${access_token.substring(0, 8)}...`);
    res.json(result);
  } catch (error) {
    logger.error('[GeminiCLI] Failed to add token:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update Gemini CLI token
router.put('/geminicli/tokens/:tokenId', cookieAuthMiddleware, async (req, res) => {
  const { tokenId } = req.params;
  const updates = req.body;

  // Do not allow sensitive fields via API
  delete updates.access_token;
  delete updates.refresh_token;

  try {
    const result = await geminicliTokenManager.updateTokenById(tokenId, updates);
    logger.info(`[GeminiCLI] Updating token: ${tokenId}`);
    res.json(result);
  } catch (error) {
    logger.error('[GeminiCLI] Failed to update token:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Delete Gemini CLI token
router.delete('/geminicli/tokens/:tokenId', cookieAuthMiddleware, async (req, res) => {
  const { tokenId } = req.params;
  try {
    const result = await geminicliTokenManager.deleteTokenById(tokenId);
    logger.info(`[GeminiCLI] Deleting token: ${tokenId}`);
    res.json(result);
  } catch (error) {
    logger.error('[GeminiCLI] Failed to delete token:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Hot reload Gemini CLI tokens
router.post('/geminicli/tokens/reload', cookieAuthMiddleware, async (req, res) => {
  try {
    await geminicliTokenManager.reload();
    logger.info('[GeminiCLI] Manually triggered token hot reload');
    res.json({ success: true, message: 'Gemini CLI tokens hot reloaded' });
  } catch (error) {
    logger.error('[GeminiCLI] Hot reload failed:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Refresh a specific Gemini CLI token
router.post('/geminicli/tokens/:tokenId/refresh', cookieAuthMiddleware, async (req, res) => {
  const { tokenId } = req.params;
  try {
    const result = await geminicliTokenManager.refreshTokenById(tokenId);
    logger.info(`[GeminiCLI] Manually refreshing token: ${tokenId}`);
    res.json({ success: true, message: 'Token refreshed successfully', data: result });
  } catch (error) {
    logger.error('[GeminiCLI] Failed to refresh token:', error.message);
    const status = error.statusCode || 500;
    res.status(status).json({ success: false, message: error.message });
  }
});

// Manually fetch Project ID for a Gemini CLI token
router.post('/geminicli/tokens/:tokenId/fetch-project-id', cookieAuthMiddleware, async (req, res) => {
  const { tokenId } = req.params;
  try {
    const result = await geminicliTokenManager.fetchProjectIdForToken(tokenId);
    logger.info(`[GeminiCLI] Manually fetching ProjectId: ${tokenId} -> ${result.projectId}`);
    res.json({ success: true, message: 'Project ID fetched successfully', projectId: result.projectId });
  } catch (error) {
    logger.error('[GeminiCLI] Failed to fetch ProjectId:', error.message);
    const status = error.statusCode || 500;
    res.status(status).json({ success: false, message: error.message });
  }
});

// Export Gemini CLI tokens (password required)
router.post('/geminicli/tokens/export', cookieAuthMiddleware, async (req, res) => {
  const { password } = req.body;

  if (!password || !verifyPassword(password)) {
    return res.status(403).json({ success: false, message: 'Password verification failed' });
  }

  try {
    const allTokens = await geminicliTokenManager.store.readAll();

    logger.info('[GeminiCLI] Exporting all token data');
    const exportData = {
      version: 1,
      exportTime: new Date().toISOString(),
      tokens: allTokens.map(token => ({
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_in: token.expires_in,
        timestamp: token.timestamp,
        enable: token.enable,
        email: token.email,
        projectId: token.projectId
      }))
    };

    res.json({ success: true, data: exportData });
  } catch (error) {
    logger.error('[GeminiCLI] Failed to export tokens:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Import Gemini CLI tokens (password required)
router.post('/geminicli/tokens/import', cookieAuthMiddleware, async (req, res) => {
  const { password, data, mode = 'merge' } = req.body;

  if (!password || !verifyPassword(password)) {
    return res.status(403).json({ success: false, message: 'Password verification failed' });
  }

  const importList = extractGeminiCliImportList(data);

  if (!Array.isArray(importList)) {
    return res.status(400).json({ success: false, message: 'Invalid import data format' });
  }

  try {
    const importTokens = importList;
    let addedCount = 0;
    let skippedCount = 0;
    let updatedCount = 0;

    const parsedTokens = [];
    for (const rawToken of importTokens) {
      const parsed = smartParseGeminiCliToken(rawToken);
      if (parsed) parsedTokens.push(parsed);
      else skippedCount++;
    }

    if (mode === 'replace') {
      await geminicliTokenManager.store.writeAll(parsedTokens);
      addedCount = parsedTokens.length;
    } else {
      const existingTokens = await geminicliTokenManager.store.readAll();
      const existingRefreshTokens = new Set(existingTokens.map(t => t.refresh_token));

      for (const token of parsedTokens) {
        if (existingRefreshTokens.has(token.refresh_token)) {
          const index = existingTokens.findIndex(t => t.refresh_token === token.refresh_token);
          if (index !== -1) {
            existingTokens[index] = { ...existingTokens[index], ...token };
            updatedCount++;
          }
        } else {
          existingTokens.push(token);
          addedCount++;
        }
      }

      await geminicliTokenManager.store.writeAll(existingTokens);
    }

    await geminicliTokenManager.reload();

    logger.info(`[GeminiCLI] Imported tokens: added ${addedCount}, updated ${updatedCount}, skipped ${skippedCount}`);
    res.json({
      success: true,
      message: `Import completed: added ${addedCount}, updated ${updatedCount}, skipped ${skippedCount}`,
      data: { added: addedCount, updated: updatedCount, skipped: skippedCount }
    });
  } catch (error) {
    logger.error('[GeminiCLI] Failed to import tokens:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==================== Token quota API ====================

// Get model quota for a token (using tokenId)
router.get('/tokens/:tokenId/quotas', cookieAuthMiddleware, async (req, res) => {
  try {
    const { tokenId } = req.params;
    const forceRefresh = req.query.refresh === 'true';

    // Find full token data via tokenId
    let tokenData = await tokenManager.findTokenById(tokenId);

    if (!tokenData) {
      return res.status(404).json({ success: false, message: 'Token not found' });
    }

    // Check if token is disabled
    const isDisabled = tokenData.enable === false;

    // Use tokenId as cache key and prefer cached data
    let quotaData = quotaManager.getQuota(tokenId);

    // Disabled tokens only return cached data; no refresh or new fetch
    if (isDisabled) {
      if (!quotaData) {
        // No cached data; return empty
        quotaData = { lastUpdated: null, models: {} };
      }
    } else {
      // Active tokens: normal flow
      // Refresh if token expired
      if (tokenManager.isExpired(tokenData)) {
        try {
          tokenData = await tokenManager.refreshToken(tokenData);
        } catch (error) {
          logger.error('Token refresh failed:', error.message);
          // Use 400 instead of 401 to avoid implying JWT auth expired
          return res.status(400).json({ success: false, message: 'Google token expired and refresh failed. Please re-login.' });
        }
      }

      // Clear cache on forced refresh
      if (forceRefresh) {
        quotaData = null;
      }

      if (!quotaData) {
        // Cache miss or forced refresh; fetch from API
        const quotas = await getModelsWithQuotas(tokenData);
        quotaManager.updateQuota(tokenId, quotas);
        quotaData = { lastUpdated: Date.now(), models: quotas };
      }
    }

    // Convert time to Beijing time
    const modelsWithBeijingTime = {};
    Object.entries(quotaData.models).forEach(([modelId, quota]) => {
      modelsWithBeijingTime[modelId] = {
        remaining: quota.r,
        resetTime: quotaManager.convertToBeijingTime(quota.t),
        resetTimeRaw: quota.t
      };
    });

    // Get request counts
    const requestCounts = quotaData.requestCounts || {};

    res.json({
      success: true,
      data: {
        lastUpdated: quotaData.lastUpdated,
        models: modelsWithBeijingTime,
        requestCounts // return request counts for client estimation
      }
    });
  } catch (error) {
    logger.error('Failed to fetch quota:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
