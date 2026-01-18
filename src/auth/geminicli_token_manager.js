import axios from 'axios';
import path from 'path';
import { log } from '../utils/logger.js';
import { generateTokenId } from '../utils/idGenerator.js';
import config, { getConfigJson } from '../config/config.js';
import { GEMINICLI_OAUTH_CONFIG } from '../constants/oauth.js';
import { buildAxiosRequestConfig, httpRequest } from '../utils/httpClient.js';
import {
  DEFAULT_REQUEST_COUNT_PER_TOKEN,
  TOKEN_REFRESH_BUFFER
} from '../constants/index.js';
import TokenStore from './token_store.js';
import { TokenError } from '../utils/errors.js';
import { getDataDir } from '../utils/paths.js';

// Gemini CLI API configuration
const GEMINICLI_API_CONFIG = {
  HOST: 'cloudcode-pa.googleapis.com',
  USER_AGENT: 'GeminiCLI/0.1.5 (Windows; AMD64)',
  BASE_URL: 'https://cloudcode-pa.googleapis.com'
};

// Rotation strategy enum (reuse token_manager.js definition)
const RotationStrategy = {
  ROUND_ROBIN: 'round_robin',           // Balanced load: rotate each request
  QUOTA_EXHAUSTED: 'quota_exhausted',   // Rotate only when quota is exhausted
  REQUEST_COUNT: 'request_count'        // Rotate after a custom request count
};

/**
 * Gemini CLI token manager
 * Simplified TokenManager for Gemini CLI proxying
 * Key differences:
 * 1. Uses geminicli_accounts.json storage
 * 2. Refreshes tokens with GEMINICLI_OAUTH_CONFIG
 * 3. No projectId or sessionId required
 */
class GeminiCliTokenManager {
  /**
   * @param {string} filePath - token data file path
   */
  constructor(filePath = path.join(getDataDir(), 'geminicli_accounts.json')) {
    this.store = new TokenStore(filePath);
    /** @type {Array<Object>} */
    this.tokens = [];
    /** @type {number} */
    this.currentIndex = 0;

    // Rotation strategy state
    /** @type {string} */
    this.rotationStrategy = RotationStrategy.ROUND_ROBIN;
    /** @type {number} */
    this.requestCountPerToken = DEFAULT_REQUEST_COUNT_PER_TOKEN;
    /** @type {Map<string, number>} */
    this.tokenRequestCounts = new Map();

    /** @type {Promise<void>|null} */
    this._initPromise = null;
  }

  async _initialize() {
    try {
      log.info('[GeminiCLI] Initializing token manager...');
      const tokenArray = await this.store.readAll();

      // Gemini CLI does not require sessionId
      this.tokens = tokenArray.filter(token => token.enable !== false).map(token => ({
        ...token
      }));

      this.currentIndex = 0;
      this.tokenRequestCounts.clear();

      // Load rotation strategy config
      this.loadRotationConfig();

      if (this.tokens.length === 0) {
        log.warn('[GeminiCLI] ⚠ No available accounts. Add one using:');
        log.warn('[GeminiCLI]   Option 1: add via the admin UI');
        log.warn('[GeminiCLI]   Option 2: edit geminicli_accounts.json manually');
      } else {
        log.info(`[GeminiCLI] Loaded ${this.tokens.length} available tokens`);
        if (this.rotationStrategy === RotationStrategy.REQUEST_COUNT) {
          log.info(`[GeminiCLI] Rotation strategy: ${this.rotationStrategy}, rotate every ${this.requestCountPerToken} requests`);
        } else {
          log.info(`[GeminiCLI] Rotation strategy: ${this.rotationStrategy}`);
        }

        // Refresh all expired tokens concurrently
        await this._refreshExpiredTokensConcurrently();
      }
    } catch (error) {
      log.error('[GeminiCLI] Failed to initialize tokens:', error.message);
      this.tokens = [];
    }
  }

  /**
   * Refresh all expired tokens concurrently
   * @private
   */
  async _refreshExpiredTokensConcurrently() {
    const expiredTokens = this.tokens.filter(token => this.isExpired(token));
    if (expiredTokens.length === 0) {
      return;
    }

    const salt = await this.store.getSalt();
    const tokenIds = expiredTokens.map(token => generateTokenId(token.refresh_token, salt));

    log.info(`[GeminiCLI] Refreshing ${tokenIds.length} tokens: ${tokenIds.join(', ')}`);
    const startTime = Date.now();

    const results = await Promise.allSettled(
      expiredTokens.map(token => this._refreshTokenSafe(token))
    );

    let successCount = 0;
    let failCount = 0;
    const tokensToDisable = [];
    const failedTokenIds = [];

    results.forEach((result, index) => {
      const token = expiredTokens[index];
      const tokenId = tokenIds[index];
      if (result.status === 'fulfilled') {
        if (result.value === 'success') {
          successCount++;
        } else if (result.value === 'disable') {
          tokensToDisable.push(token);
          failCount++;
          failedTokenIds.push(tokenId);
        }
      } else {
        failCount++;
        failedTokenIds.push(tokenId);
      }
    });

    // Disable invalid tokens in batch
    for (const token of tokensToDisable) {
      this.disableToken(token);
    }

    const elapsed = Date.now() - startTime;
    if (failCount > 0) {
      log.warn(`[GeminiCLI] Refresh complete: ${successCount} succeeded, ${failCount} failed (${failedTokenIds.join(', ')}), elapsed ${elapsed}ms`);
    } else {
      log.info(`[GeminiCLI] Refresh complete: ${successCount} succeeded, elapsed ${elapsed}ms`);
    }
  }

  /**
   * Safely refresh a single token (no throw)
   * @param {Object} token - token object
   * @returns {Promise<'success'|'disable'|'skip'>} refresh result
   * @private
   */
  async _refreshTokenSafe(token) {
    try {
      await this.refreshToken(token, true);
      return 'success';
    } catch (error) {
      if (error.statusCode === 403 || error.statusCode === 400) {
        return 'disable';
      }
      throw error;
    }
  }

  async _ensureInitialized() {
    if (!this._initPromise) {
      this._initPromise = this._initialize();
    }
    return this._initPromise;
  }

  // Load rotation strategy config
  loadRotationConfig() {
    try {
      const jsonConfig = getConfigJson();
      // Prefer geminicli config; fallback to global config
      const rotationConfig = jsonConfig.geminicli?.rotation || jsonConfig.rotation;
      if (rotationConfig) {
        this.rotationStrategy = rotationConfig.strategy || RotationStrategy.ROUND_ROBIN;
        this.requestCountPerToken = rotationConfig.requestCount || 10;
      }
    } catch (error) {
      log.warn('[GeminiCLI] Failed to load rotation config; using defaults:', error.message);
    }
  }

  // Update rotation strategy (hot reload)
  updateRotationConfig(strategy, requestCount) {
    if (strategy && Object.values(RotationStrategy).includes(strategy)) {
      this.rotationStrategy = strategy;
    }
    if (requestCount && requestCount > 0) {
      this.requestCountPerToken = requestCount;
    }
    this.tokenRequestCounts.clear();
    if (this.rotationStrategy === RotationStrategy.REQUEST_COUNT) {
      log.info(`[GeminiCLI] Rotation strategy updated: ${this.rotationStrategy}, rotate every ${this.requestCountPerToken} requests`);
    } else {
      log.info(`[GeminiCLI] Rotation strategy updated: ${this.rotationStrategy}`);
    }
  }

  /**
   * Check if token is expired
   * @param {Object} token - token object
   * @returns {boolean} true if expired
   */
  isExpired(token) {
    if (!token.timestamp || !token.expires_in) return true;
    const expiresAt = token.timestamp + (token.expires_in * 1000);
    return Date.now() >= expiresAt - TOKEN_REFRESH_BUFFER;
  }

  /**
   * Refresh token
   * Uses GEMINICLI_OAUTH_CONFIG instead of OAUTH_CONFIG
   */
  async refreshToken(token, silent = false) {
    const salt = await this.store.getSalt();
    const tokenId = generateTokenId(token.refresh_token, salt);
    if (!silent) {
      log.info(`[GeminiCLI] Refreshing token: ${tokenId}`);
    }

    const body = new URLSearchParams({
      client_id: GEMINICLI_OAUTH_CONFIG.CLIENT_ID,
      client_secret: GEMINICLI_OAUTH_CONFIG.CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: token.refresh_token
    });

    try {
      const response = await axios(buildAxiosRequestConfig({
        method: 'POST',
        url: GEMINICLI_OAUTH_CONFIG.TOKEN_URL,
        headers: {
          'Host': 'oauth2.googleapis.com',
          'User-Agent': 'google-oauth-playground',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept-Encoding': 'gzip'
        },
        data: body.toString()
      }));

      token.access_token = response.data.access_token;
      token.expires_in = response.data.expires_in;
      token.timestamp = Date.now();
      this.saveToFile(token);
      return token;
    } catch (error) {
      const statusCode = error.response?.status;
      const rawBody = error.response?.data;
      const message = typeof rawBody === 'string' ? rawBody : (rawBody?.error?.message || error.message || 'Token refresh failed');
      throw new TokenError(message, tokenId, statusCode || 500);
    }
  }

  saveToFile(tokenToUpdate = null) {
    this.store.mergeActiveTokens(this.tokens, tokenToUpdate).catch((error) => {
      log.error('[GeminiCLI] Failed to save accounts config file:', error.message);
    });
  }

  disableToken(token) {
    log.warn(`[GeminiCLI] Disabling token ...${token.access_token.slice(-8)}`);
    token.enable = false;
    this.saveToFile();
    this.tokenRequestCounts.delete(token.refresh_token);
    this.tokens = this.tokens.filter(t => t.refresh_token !== token.refresh_token);
    this.currentIndex = this.currentIndex % Math.max(this.tokens.length, 1);
  }

  // Atomic operation: increment request count
  incrementRequestCount(tokenKey) {
    const current = this.tokenRequestCounts.get(tokenKey) || 0;
    const newCount = current + 1;
    this.tokenRequestCounts.set(tokenKey, newCount);
    return newCount;
  }

  // Atomic operation: reset request count
  resetRequestCount(tokenKey) {
    this.tokenRequestCounts.set(tokenKey, 0);
  }

  /**
   * Fetch projectId via loadCodeAssist API
   * @param {Object} token - token object
   * @returns {Promise<string|null>} projectId or null
   */
  async fetchProjectId(token) {
    const salt = await this.store.getSalt();
    const tokenId = generateTokenId(token.refresh_token, salt);
    log.info(`[GeminiCLI] Fetching projectId: ${tokenId}`);

    const geminicliConfig = config.geminicli?.api || {};
    const baseUrl = geminicliConfig.baseUrl || GEMINICLI_API_CONFIG.BASE_URL;
    const url = `${baseUrl}/v1internal:loadCodeAssist`;

    const headers = {
      'Host': geminicliConfig.host || GEMINICLI_API_CONFIG.HOST,
      'User-Agent': geminicliConfig.userAgent || GEMINICLI_API_CONFIG.USER_AGENT,
      'Authorization': `Bearer ${token.access_token}`,
      'Content-Type': 'application/json',
      'Accept-Encoding': 'gzip'
    };

    const requestBody = {
      metadata: {
        ideType: 'ANTIGRAVITY',
        platform: 'PLATFORM_UNSPECIFIED',
        pluginType: 'GEMINI'
      }
    };

    try {
      const response = await httpRequest({
        method: 'POST',
        url,
        headers,
        data: requestBody,
        timeout: 30000
      });

      const data = response.data;
      
      // Check for currentTier (user activated)
      if (data.currentTier) {
        const projectId = data.cloudaicompanionProject;
        if (projectId) {
          log.info(`[GeminiCLI] Retrieved projectId: ${projectId}`);
          return projectId;
        }
        log.warn('[GeminiCLI] loadCodeAssist response missing projectId');
        return null;
      }

      // User not activated, try onboardUser
      log.info('[GeminiCLI] User not activated; trying onboardUser...');
      return await this._tryOnboardUser(token, data);
    } catch (error) {
      const status = error.response?.status || error.status || 500;
      log.error(`[GeminiCLI] Failed to fetch projectId (${status}):`, error.message);
      
      if (status === 403 || status === 401) {
        throw new TokenError('Token has no permission to fetch projectId', tokenId, status);
      }
      throw new TokenError(`Failed to fetch projectId: ${error.message}`, tokenId, status);
    }
  }

  /**
   * Try to fetch projectId via onboardUser (long-running operation)
   * @param {Object} token - token object
   * @param {Object} loadCodeAssistData - loadCodeAssist response data
   * @returns {Promise<string|null>} projectId or null
   * @private
   */
  async _tryOnboardUser(token, loadCodeAssistData) {
    const geminicliConfig = config.geminicli?.api || {};
    const baseUrl = geminicliConfig.baseUrl || GEMINICLI_API_CONFIG.BASE_URL;
    const url = `${baseUrl}/v1internal:onboardUser`;

    const headers = {
      'Host': geminicliConfig.host || GEMINICLI_API_CONFIG.HOST,
      'User-Agent': geminicliConfig.userAgent || GEMINICLI_API_CONFIG.USER_AGENT,
      'Authorization': `Bearer ${token.access_token}`,
      'Content-Type': 'application/json',
      'Accept-Encoding': 'gzip'
    };

    // Get default tier from loadCodeAssist response
    let tierId = 'LEGACY';
    const allowedTiers = loadCodeAssistData?.allowedTiers || [];
    for (const tier of allowedTiers) {
      if (tier.isDefault) {
        tierId = tier.id;
        break;
      }
    }

    const requestBody = {
      tierId,
      metadata: {
        ideType: 'ANTIGRAVITY',
        platform: 'PLATFORM_UNSPECIFIED',
        pluginType: 'GEMINI'
      }
    };

    // onboardUser is long-running; requires polling
    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      log.debug(`[GeminiCLI] onboardUser poll ${attempt}/${maxAttempts}`);

      try {
        const response = await httpRequest({
          method: 'POST',
          url,
          headers,
          data: requestBody,
          timeout: 30000
        });

        const data = response.data;

        if (data.done) {
          const responseData = data.response || {};
          const projectObj = responseData.cloudaicompanionProject;

          let projectId = null;
          if (typeof projectObj === 'object' && projectObj !== null) {
            projectId = projectObj.id;
          } else if (typeof projectObj === 'string') {
            projectId = projectObj;
          }

          if (projectId) {
            log.info(`[GeminiCLI] onboardUser retrieved projectId: ${projectId}`);
            return projectId;
          }
          log.warn('[GeminiCLI] onboardUser completed but response missing projectId');
          return null;
        }

        // Operation not complete; wait and retry
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        log.error(`[GeminiCLI] onboardUser failed:`, error.message);
        throw error;
      }
    }

    log.error('[GeminiCLI] onboardUser timed out');
    return null;
  }

  /**
   * Prepare a single token (refresh + projectId)
   * @param {Object} token - token object
   * @returns {Promise<'ready'|'disable'>} result
   * @private
   */
  async _prepareToken(token) {
    // Refresh expired token
    if (this.isExpired(token)) {
      await this.refreshToken(token);
    }

    // Fetch projectId (if missing)
    if (!token.projectId) {
      const projectId = await this.fetchProjectId(token);
      if (!projectId) {
        log.warn('[GeminiCLI] Unable to fetch projectId; disabling account');
        return 'disable';
      }
      token.projectId = projectId;
      this.saveToFile(token);
    }

    return 'ready';
  }

  /**
   * Handle errors during token preparation
   * @param {Error} error - error object
   * @param {Object} token - token object
   * @returns {'disable'|'skip'} result
   * @private
   */
  _handleTokenError(error, token) {
    const suffix = token.access_token?.slice(-8) || 'unknown';
    if (error.statusCode === 403 || error.statusCode === 400) {
      log.warn(`[GeminiCLI] ...${suffix}: token invalid or errored; account disabled`);
      return 'disable';
    }
    log.error(`[GeminiCLI] ...${suffix} operation failed:`, error.message);
    return 'skip';
  }

  /**
   * Get an available token
   * @returns {Promise<Object|null>} token object
   */
  async getToken() {
    await this._ensureInitialized();
    if (this.tokens.length === 0) return null;

    const totalTokens = this.tokens.length;
    const startIndex = this.currentIndex;

    for (let i = 0; i < totalTokens; i++) {
      const index = (startIndex + i) % totalTokens;
      const token = this.tokens[index];

      try {
        const result = await this._prepareToken(token);
        if (result === 'disable') {
          this.disableToken(token);
          if (this.tokens.length === 0) return null;
          continue;
        }

        // Update current index
        this.currentIndex = index;

        // Rotate based on strategy
        if (this.rotationStrategy === RotationStrategy.ROUND_ROBIN) {
          this.currentIndex = (this.currentIndex + 1) % this.tokens.length;
        } else if (this.rotationStrategy === RotationStrategy.REQUEST_COUNT) {
          const tokenKey = token.refresh_token;
          const count = this.tokenRequestCounts.get(tokenKey) || 0;
          if (count >= this.requestCountPerToken) {
            this.resetRequestCount(tokenKey);
            this.currentIndex = (this.currentIndex + 1) % this.tokens.length;
          }
        }

        return token;
      } catch (error) {
        const action = this._handleTokenError(error, token);
        if (action === 'disable') {
          this.disableToken(token);
          if (this.tokens.length === 0) return null;
        }
        // skip: continue with next token
      }
    }

    return null;
  }

  disableCurrentToken(token) {
    const found = this.tokens.find(t => t.access_token === token.access_token);
    if (found) {
      this.disableToken(found);
    }
  }

  // API management methods
  async reload() {
    this._initPromise = this._initialize();
    await this._initPromise;
    log.info('[GeminiCLI] Tokens hot reloaded');
  }

  async addToken(tokenData) {
    try {
      const allTokens = await this.store.readAll();

      const newToken = {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_in: tokenData.expires_in || 3599,
        timestamp: tokenData.timestamp || Date.now(),
        enable: tokenData.enable !== undefined ? tokenData.enable : true
      };

      if (tokenData.email) {
        newToken.email = tokenData.email;
      }

      if (tokenData.projectId) {
        newToken.projectId = tokenData.projectId;
      }

      allTokens.push(newToken);
      await this.store.writeAll(allTokens);

      await this.reload();
      return { success: true, message: 'Token added successfully' };
    } catch (error) {
      log.error('[GeminiCLI] Failed to add token:', error.message);
      return { success: false, message: error.message };
    }
  }

  async updateToken(refreshToken, updates) {
    try {
      const allTokens = await this.store.readAll();

      const index = allTokens.findIndex(t => t.refresh_token === refreshToken);
      if (index === -1) {
        return { success: false, message: 'Token not found' };
      }

      allTokens[index] = { ...allTokens[index], ...updates };
      await this.store.writeAll(allTokens);

      await this.reload();
      return { success: true, message: 'Token updated successfully' };
    } catch (error) {
      log.error('[GeminiCLI] Failed to update token:', error.message);
      return { success: false, message: error.message };
    }
  }

  async deleteToken(refreshToken) {
    try {
      const allTokens = await this.store.readAll();

      const filteredTokens = allTokens.filter(t => t.refresh_token !== refreshToken);
      if (filteredTokens.length === allTokens.length) {
        return { success: false, message: 'Token not found' };
      }

      await this.store.writeAll(filteredTokens);

      await this.reload();
      return { success: true, message: 'Token deleted successfully' };
    } catch (error) {
      log.error('[GeminiCLI] Failed to delete token:', error.message);
      return { success: false, message: error.message };
    }
  }

  async getTokenList() {
    try {
      const allTokens = await this.store.readAll();
      const salt = await this.store.getSalt();

      return allTokens.map(token => ({
        id: generateTokenId(token.refresh_token, salt),
        expires_in: token.expires_in,
        timestamp: token.timestamp,
        enable: token.enable !== false,
        email: token.email || null,
        projectId: token.projectId || null
      }));
    } catch (error) {
      log.error('[GeminiCLI] Failed to fetch token list:', error.message);
      return [];
    }
  }

  /**
   * Fetch and update projectId by tokenId
   * @param {string} tokenId - secure token ID
   * @returns {Promise<Object>} result containing projectId
   */
  async fetchProjectIdForToken(tokenId) {
    const tokenData = await this.findTokenById(tokenId);
    if (!tokenData) {
      throw new TokenError('Token not found', null, 404);
    }

    // Ensure token is not expired
    if (this.isExpired(tokenData)) {
      await this.refreshToken(tokenData);
    }

    const projectId = await this.fetchProjectId(tokenData);
    if (!projectId) {
      throw new TokenError('Unable to fetch projectId; account may be ineligible', null, 400);
    }

    // Update and save
    tokenData.projectId = projectId;
    
    // Update file
    const allTokens = await this.store.readAll();
    const salt = await this.store.getSalt();
    const index = allTokens.findIndex(t =>
      generateTokenId(t.refresh_token, salt) === tokenId
    );
    if (index !== -1) {
      allTokens[index].projectId = projectId;
      await this.store.writeAll(allTokens);
    }

    // Update in-memory token
    const memoryToken = this.tokens.find(t => t.refresh_token === tokenData.refresh_token);
    if (memoryToken) {
      memoryToken.projectId = projectId;
    }

    return { projectId };
  }

  /**
   * Find full token object by tokenId
   * @param {string} tokenId - secure token ID
   * @returns {Promise<Object|null>} token object or null
   */
  async findTokenById(tokenId) {
    try {
      const allTokens = await this.store.readAll();
      const salt = await this.store.getSalt();

      return allTokens.find(token =>
        generateTokenId(token.refresh_token, salt) === tokenId
      ) || null;
    } catch (error) {
      log.error('[GeminiCLI] Failed to find token:', error.message);
      return null;
    }
  }

  /**
   * Update token by tokenId
   * @param {string} tokenId - secure token ID
   * @param {Object} updates - updates
   * @returns {Promise<Object>} result
   */
  async updateTokenById(tokenId, updates) {
    try {
      const allTokens = await this.store.readAll();
      const salt = await this.store.getSalt();

      const index = allTokens.findIndex(token =>
        generateTokenId(token.refresh_token, salt) === tokenId
      );

      if (index === -1) {
        return { success: false, message: 'Token not found' };
      }

      allTokens[index] = { ...allTokens[index], ...updates };
      await this.store.writeAll(allTokens);

      await this.reload();
      return { success: true, message: 'Token updated successfully' };
    } catch (error) {
      log.error('[GeminiCLI] Failed to update token:', error.message);
      return { success: false, message: error.message };
    }
  }

  /**
   * Delete token by tokenId
   * @param {string} tokenId - secure token ID
   * @returns {Promise<Object>} result
   */
  async deleteTokenById(tokenId) {
    try {
      const allTokens = await this.store.readAll();
      const salt = await this.store.getSalt();

      const filteredTokens = allTokens.filter(token =>
        generateTokenId(token.refresh_token, salt) !== tokenId
      );

      if (filteredTokens.length === allTokens.length) {
        return { success: false, message: 'Token not found' };
      }

      await this.store.writeAll(filteredTokens);

      await this.reload();
      return { success: true, message: 'Token deleted successfully' };
    } catch (error) {
      log.error('[GeminiCLI] Failed to delete token:', error.message);
      return { success: false, message: error.message };
    }
  }

  /**
   * Refresh token by tokenId
   * @param {string} tokenId - secure token ID
   * @returns {Promise<Object>} refreshed token info (no sensitive data)
   */
  async refreshTokenById(tokenId) {
    const tokenData = await this.findTokenById(tokenId);
    if (!tokenData) {
      throw new TokenError('Token not found', null, 404);
    }

    const refreshedToken = await this.refreshToken(tokenData);
    return {
      expires_in: refreshedToken.expires_in,
      timestamp: refreshedToken.timestamp
    };
  }

  /**
   * Get salt
   * @returns {Promise<string>} salt
   */
  async getSalt() {
    return this.store.getSalt();
  }

  // Get current rotation config
  getRotationConfig() {
    return {
      strategy: this.rotationStrategy,
      requestCount: this.requestCountPerToken,
      currentIndex: this.currentIndex,
      tokenCounts: Object.fromEntries(this.tokenRequestCounts)
    };
  }
}

// Export strategy enum
export { RotationStrategy };

const geminicliTokenManager = new GeminiCliTokenManager();
export default geminicliTokenManager;
