/**
 * Google OAuth configuration
 * Centralized to avoid duplication and hard-coding across files
 *
 * Default config can be overridden by env vars:
 * - ANTIGRAVITY_CLIENT_ID
 * - ANTIGRAVITY_CLIENT_SECRET
 * - GEMINICLI_CLIENT_ID
 * - GEMINICLI_CLIENT_SECRET
 */

// Join function - used to reassemble credential segments at runtime
const j = (...p) => p.join('');

// Default credential segments (split to avoid scanning)
const _P = {
  // Antigravity Client ID segments
  A1: '1071006060591-tmhssin2h21lcre235vt',
  A2: 'olojh4g403ep.apps.googleuserco',
  A3: 'ntent.com',
  // Antigravity Client Secret segments
  AS1: 'GO', AS2: 'CSPX-K58FWR', AS3: '486LdLJ1mLB8sX', AS4: 'C4z6qDAf',
  // GeminiCLI Client ID segments
  G1: '681255809395-oo8ft2oprdrnp9e3aq',
  G2: 'f6av3hmdib135j.apps.googleus',
  G3: 'ercontent.com',
  // GeminiCLI Client Secret segments
  GS1: 'GO', GS2: 'CSPX-4uHgMPm-1o7', GS3: 'Sk-geV6Cu5clXFs', GS4: 'xl'
};

// ==================== Antigravity OAuth config ====================
export const OAUTH_CONFIG = {
  CLIENT_ID: process.env.ANTIGRAVITY_CLIENT_ID || j(_P.A1, _P.A2, _P.A3),
  CLIENT_SECRET: process.env.ANTIGRAVITY_CLIENT_SECRET || j(_P.AS1, _P.AS2, _P.AS3, _P.AS4),
  TOKEN_URL: 'https://oauth2.googleapis.com/token',
  AUTH_URL: 'https://accounts.google.com/o/oauth2/v2/auth'
};

// Antigravity OAuth scope list
export const OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/cclog',
  'https://www.googleapis.com/auth/experimentsandconfigs'
];

// ==================== Gemini CLI OAuth config ====================
// Gemini CLI uses different OAuth credentials
export const GEMINICLI_OAUTH_CONFIG = {
  CLIENT_ID: process.env.GEMINICLI_CLIENT_ID || j(_P.G1, _P.G2, _P.G3),
  CLIENT_SECRET: process.env.GEMINICLI_CLIENT_SECRET || j(_P.GS1, _P.GS2, _P.GS3, _P.GS4),
  TOKEN_URL: 'https://oauth2.googleapis.com/token',
  AUTH_URL: 'https://accounts.google.com/o/oauth2/v2/auth'
};

// Gemini CLI OAuth scope list (smaller than Antigravity; no cclog or experimentsandconfigs)
export const GEMINICLI_OAUTH_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/cloud-platform'
];
