import express from 'express';
import { generateToken, authMiddleware } from '../auth/jwt.js';
import tokenManager from '../auth/token_manager.js';
import quotaManager from '../auth/quota_manager.js';
import config, { getConfigJson, saveConfigJson } from '../config/config.js';
import logger from '../utils/logger.js';
import { generateProjectId } from '../utils/idGenerator.js';
import { parseEnvFile, updateEnvFile } from '../utils/envParser.js';
import { reloadConfig } from '../utils/configReloader.js';
import { OAUTH_CONFIG } from '../constants/oauth.js';
import { deepMerge } from '../utils/deepMerge.js';
import { getModelsWithQuotas } from '../api/client.js';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '../../.env');

const router = express.Router();

// Login endpoint
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  
  if (username === config.admin.username && password === config.admin.password) {
    const token = generateToken({ username, role: 'admin' });
    res.json({ success: true, token });
  } else {
    res.status(401).json({ success: false, message: 'Invalid username or password' });
  }
});

// Token management APIs - require JWT authentication
router.get('/tokens', authMiddleware, (req, res) => {
  const tokens = tokenManager.getTokenList();
  res.json({ success: true, data: tokens });
});

router.post('/tokens', authMiddleware, (req, res) => {
  const { access_token, refresh_token, expires_in, timestamp, enable, projectId, email } = req.body;
  if (!access_token || !refresh_token) {
    return res.status(400).json({ success: false, message: 'access_token and refresh_token are required' });
  }
  const tokenData = { access_token, refresh_token, expires_in };
  if (timestamp) tokenData.timestamp = timestamp;
  if (enable !== undefined) tokenData.enable = enable;
  if (projectId) tokenData.projectId = projectId;
  if (email) tokenData.email = email;
  
  const result = tokenManager.addToken(tokenData);
  res.json(result);
});

router.put('/tokens/:refreshToken', authMiddleware, (req, res) => {
  const { refreshToken } = req.params;
  const updates = req.body;
  const result = tokenManager.updateToken(refreshToken, updates);
  res.json(result);
});

router.delete('/tokens/:refreshToken', authMiddleware, (req, res) => {
  const { refreshToken } = req.params;
  const result = tokenManager.deleteToken(refreshToken);
  res.json(result);
});

router.post('/tokens/reload', authMiddleware, async (req, res) => {
  try {
    await tokenManager.reload();
    res.json({ success: true, message: 'Tokens hot reloaded' });
  } catch (error) {
    logger.error('Hot reload failed:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/oauth/exchange', authMiddleware, async (req, res) => {
  const { code, port } = req.body;
  if (!code || !port) {
    return res.status(400).json({ success: false, message: 'code and port are required' });
  }
  
  try {
    const postData = new URLSearchParams({
      code,
      client_id: OAUTH_CONFIG.CLIENT_ID,
      client_secret: OAUTH_CONFIG.CLIENT_SECRET,
      redirect_uri: `http://localhost:${port}/oauth-callback`,
      grant_type: 'authorization_code'
    });
    
    const response = await fetch(OAUTH_CONFIG.TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: postData.toString()
    });
    
  const tokenData = await response.json();

  if (!tokenData.access_token) {
    return res.status(400).json({ success: false, message: 'Token exchange failed' });
  }
    
    const account = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_in: tokenData.expires_in,
      timestamp: Date.now(),
      enable: true
    };
    
    try {
      const emailResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: {
          'Host': 'www.googleapis.com',
          'User-Agent': 'Go-http-client/1.1',
          'Authorization': `Bearer ${account.access_token}`,
          'Accept-Encoding': 'gzip'
        }
      });
      const userInfo = await emailResponse.json();
      if (userInfo.email) {
        account.email = userInfo.email;
        logger.info('Retrieved user email: ' + userInfo.email);
      }
    } catch (err) {
      logger.warn('Failed to fetch user email:', err.message);
    }
    
  if (config.skipProjectIdFetch) {
    account.projectId = generateProjectId();
    logger.info('Using randomly generated projectId: ' + account.projectId);
  } else {
    try {
      const projectId = await tokenManager.fetchProjectId(account);
      if (projectId === undefined) {
        return res.status(400).json({ success: false, message: 'This account is not eligible (projectId unavailable)' });
      }
      account.projectId = projectId;
      logger.info('Account verified, projectId: ' + projectId);
    } catch (error) {
      logger.error('Account validation failed:', error.message);
      return res.status(500).json({ success: false, message: 'Account validation failed: ' + error.message });
    }
  }
    
    res.json({ success: true, data: account });
  } catch (error) {
    logger.error('Token exchange failed:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get configuration
router.get('/config', authMiddleware, (req, res) => {
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
router.put('/config', authMiddleware, (req, res) => {
  try {
    const { env: envUpdates, json: jsonUpdates } = req.body;
    
    if (envUpdates) {
      updateEnvFile(envPath, envUpdates);
    }
    
    if (jsonUpdates) {
      const currentConfig = getConfigJson();
      const mergedConfig = deepMerge(currentConfig, jsonUpdates);
      saveConfigJson(mergedConfig);
    }
    
    dotenv.config({ override: true });
    reloadConfig();

    logger.info('Configuration updated and hot reloaded');
    res.json({ success: true, message: 'Configuration saved and applied (port/HOST changes require restart)' });
  } catch (error) {
    logger.error('Failed to update configuration:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get quota information for a specific token
router.get('/tokens/:refreshToken/quotas', authMiddleware, async (req, res) => {
  try {
    const { refreshToken } = req.params;
    const forceRefresh = req.query.refresh === 'true';
    const tokens = tokenManager.getTokenList();
    let tokenData = tokens.find(t => t.refresh_token === refreshToken);

    if (!tokenData) {
      return res.status(404).json({ success: false, message: 'Token not found' });
    }

    // Check if the token is expired and refresh if needed
    if (tokenManager.isExpired(tokenData)) {
      try {
        tokenData = await tokenManager.refreshToken(tokenData);
      } catch (error) {
        logger.error('Failed to refresh token:', error.message);
        return res.status(401).json({ success: false, message: 'Token expired and refresh failed' });
      }
    }

    // Pull from cache unless a force refresh is requested
    let quotaData = forceRefresh ? null : quotaManager.getQuota(refreshToken);

    if (!quotaData) {
      // Cache miss or forced refresh; fetch from the API
      const token = { access_token: tokenData.access_token, refresh_token: refreshToken };
      const quotas = await getModelsWithQuotas(token);
      quotaManager.updateQuota(refreshToken, quotas);
      quotaData = { lastUpdated: Date.now(), models: quotas };
    }

    // Convert times to Beijing time
    const modelsWithBeijingTime = {};
    Object.entries(quotaData.models).forEach(([modelId, quota]) => {
      modelsWithBeijingTime[modelId] = {
        remaining: quota.r,
        resetTime: quotaManager.convertToBeijingTime(quota.t),
        resetTimeRaw: quota.t
      };
    });
    
    res.json({ 
      success: true, 
      data: { 
        lastUpdated: quotaData.lastUpdated,
        models: modelsWithBeijingTime 
      }
    });
  } catch (error) {
    logger.error('Failed to get quota:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;