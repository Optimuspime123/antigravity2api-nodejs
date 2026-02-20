import axios from 'axios';
import crypto from 'crypto';
import log from '../utils/logger.js';
import config from '../config/config.js';
import { generateProjectId } from '../utils/idGenerator.js'; // TODO: removable; no longer used
import tokenManager from './token_manager.js';
import geminicliTokenManager from './geminicli_token_manager.js';
import { OAUTH_CONFIG, OAUTH_SCOPES, GEMINICLI_OAUTH_CONFIG, GEMINICLI_OAUTH_SCOPES } from '../constants/oauth.js';
import { buildAxiosRequestConfig } from '../utils/httpClient.js';

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

    const response = await axios(buildAxiosRequestConfig({
      method: 'POST',
      url: oauthConfig.TOKEN_URL,
      headers: {
        'Host': 'oauth2.googleapis.com',
        'User-Agent': 'Go-http-client/1.1',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept-Encoding': 'gzip'
      },
      data: postData.toString(),
      timeout: config.timeout
    }));

    return response.data;
  }

  /**
   * Fetch user email
   */
  async fetchUserEmail(accessToken) {
    try {
      const response = await axios(buildAxiosRequestConfig({
        method: 'GET',
        url: 'https://www.googleapis.com/oauth2/v2/userinfo',
        headers: {
          'Host': 'www.googleapis.com',
          'User-Agent': 'Go-http-client/1.1',
          'Authorization': `Bearer ${accessToken}`,
          'Accept-Encoding': 'gzip'
        },
        timeout: config.timeout
      }));
      return response.data?.email;
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
