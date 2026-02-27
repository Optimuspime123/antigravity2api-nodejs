import axios from 'axios';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import log from '../utils/logger.js';
import config from '../config/config.js';
import { generateProjectId } from '../utils/idGenerator.js'; // TODO: removable; no longer used
import tokenManager from './token_manager.js';
import geminicliTokenManager from './geminicli_token_manager.js';
import { OAUTH_CONFIG, OAUTH_SCOPES, GEMINICLI_OAUTH_CONFIG, GEMINICLI_OAUTH_SCOPES } from '../constants/oauth.js';
import { buildAxiosRequestConfig } from '../utils/httpClient.js';
import fingerprintRequester from '../requester.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 请求客户端：优先使用 FingerprintRequester，失败则自动降级到 axios
let requester = null;
let useAxios = false;

if (config.useNativeAxios === true) {
  useAxios = true;
} else {
  try {
    const isPkg = typeof process.pkg !== 'undefined';
    const configPath = isPkg
      ? path.join(path.dirname(process.execPath), 'bin', 'tls_config.json')
      : path.join(__dirname, '..', 'bin', 'tls_config.json');
    requester = fingerprintRequester.create({
      configPath,
      timeout: config.timeout ? Math.ceil(config.timeout / 1000) : 30,
      proxy: config.proxy || null,
    });
  } catch (error) {
    log.warn('[OAuthManager] FingerprintRequester 初始化失败，自动降级使用 axios:', error.message);
    useAxios = true;
  }
}

function buildRequesterConfig(headers, body = null, method = 'POST') {
  const reqConfig = {
    method,
    headers,
    timeout_ms: config.timeout,
    proxy: config.proxy
  };
  if (body !== null) {
    reqConfig.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  return reqConfig;
}

class OAuthManager {
  constructor() {
    this.state = crypto.randomUUID();
  }

  /**
   * Generate authorization URL
   * @param {number} port - callback port
   * @param {string} mode - mode: 'antigravity' or 'geminicli'
   */
  generateAuthUrl(port, mode = 'antigravity') {
    const oauthConfig = mode === 'geminicli' ? GEMINICLI_OAUTH_CONFIG : OAUTH_CONFIG;
    const scopes = mode === 'geminicli' ? GEMINICLI_OAUTH_SCOPES : OAUTH_SCOPES;

    const params = new URLSearchParams({
      access_type: 'offline',
      client_id: oauthConfig.CLIENT_ID,
      prompt: 'consent',
      redirect_uri: `http://localhost:${port}/oauth-callback`,
      response_type: 'code',
      scope: scopes.join(' '),
      state: `${this.state}_${mode}` // include mode in state
    });
    return `${oauthConfig.AUTH_URL}?${params.toString()}`;
  }

  /**
   * Exchange auth code for token
   * @param {string} code - auth code
   * @param {number} port - callback port
   * @param {string} mode - mode: 'antigravity' or 'geminicli'
   */
  async exchangeCodeForToken(code, port, mode = 'antigravity') {
    const oauthConfig = mode === 'geminicli' ? GEMINICLI_OAUTH_CONFIG : OAUTH_CONFIG;

    const postData = new URLSearchParams({
      code,
      client_id: oauthConfig.CLIENT_ID,
      client_secret: oauthConfig.CLIENT_SECRET,
      redirect_uri: `http://localhost:${port}/oauth-callback`,
      grant_type: 'authorization_code'
    });

    const headers = {
      'Host': 'oauth2.googleapis.com',
      'User-Agent': 'Go-http-client/1.1',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept-Encoding': 'gzip'
    };

    if (useAxios) {
      const response = await axios(buildAxiosRequestConfig({
        method: 'POST',
        url: oauthConfig.TOKEN_URL,
        headers,
        data: postData.toString(),
        timeout: config.timeout
      }));
      return response.data;
    }

    const response = await requester.antigravity_fetch(oauthConfig.TOKEN_URL, buildRequesterConfig(headers, postData.toString()));
    if (response.status !== 200) {
      const errorBody = await response.text();
      throw new Error(`Token exchange failed (${response.status}): ${errorBody}`);
    }
    return await response.json();
  }

  /**
   * Fetch user email
   */
  async fetchUserEmail(accessToken) {
    const headers = {
      'Host': 'www.googleapis.com',
      'User-Agent': 'Go-http-client/1.1',
      'Authorization': `Bearer ${accessToken}`,
      'Accept-Encoding': 'gzip'
    };

    try {
      if (useAxios) {
        const response = await axios(buildAxiosRequestConfig({
          method: 'GET',
          url: 'https://www.googleapis.com/oauth2/v2/userinfo',
          headers,
          timeout: config.timeout
        }));
        return response.data?.email;
      }

      const response = await requester.antigravity_fetch('https://www.googleapis.com/oauth2/v2/userinfo', buildRequesterConfig(headers, null, 'GET'));
      if (response.status !== 200) {
        const errorBody = await response.text();
        throw new Error(`Failed to fetch user info (${response.status}): ${errorBody}`);
      }
      const data = await response.json();
      return data?.email;
    } catch (err) {
      log.warn('Failed to fetch user email:', err.message);
      return null;
    }
  }

  /**
   * Eligibility check: try to fetch projectId
   */
  async validateAndGetProjectId(accessToken) {
    try {
      log.info('Validating account eligibility...');
      const projectId = await tokenManager.fetchProjectId({ access_token: accessToken });

      if (projectId === undefined || projectId === null) {
        log.warn('Unable to fetch projectId; account may be ineligible or needs a retry later');
        return { projectId: null, hasQuota: false };
      }

      log.info('Account validated. projectId: ' + projectId);
      return { projectId, hasQuota: true };
    } catch (err) {
      log.error('Account eligibility validation failed: ' + err.message);
      return { projectId: null, hasQuota: false };
    }
  }

  /**
   * Full OAuth flow: exchange token -> fetch email -> eligibility check
   * @param {string} code - auth code
   * @param {number} port - callback port
   * @param {string} mode - mode: 'antigravity' or 'geminicli'
   */
  async authenticate(code, port, mode = 'antigravity') {
    // 1. Exchange auth code for token
    const tokenData = await this.exchangeCodeForToken(code, port, mode);

    if (!tokenData.access_token) {
      throw new Error('Token exchange failed: access_token missing');
    }

    const account = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_in: tokenData.expires_in,
      timestamp: Date.now()
    };

    // 2. Fetch user email
    const email = await this.fetchUserEmail(account.access_token);
    if (email) {
      account.email = email;
      log.info(`[${mode}] User email: ${email}`);
    }

    // 3. Eligibility check (projectId only needed for antigravity mode)
    if (mode === 'antigravity') {
      const { projectId, hasQuota } = await this.validateAndGetProjectId(account.access_token);
      account.projectId = projectId;
      account.hasQuota = hasQuota;
    }

    account.enable = true;

    return account;
  }

  /**
   * Gemini CLI auth flow (simplified, no projectId)
   * @param {string} code - auth code
   * @param {number} port - callback port
   */
  async authenticateGeminiCli(code, port) {
    return this.authenticate(code, port, 'GeminiCLI');
  }
}

export default new OAuthManager();
