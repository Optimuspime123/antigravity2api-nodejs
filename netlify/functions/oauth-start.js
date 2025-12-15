import crypto from 'crypto';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';

const SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/cclog',
  'https://www.googleapis.com/auth/experimentsandconfigs'
];

const buildOrigin = (event) => {
  if (process.env.GOOGLE_REDIRECT_ORIGIN) return process.env.GOOGLE_REDIRECT_ORIGIN;
  if (process.env.SITE_URL) return process.env.SITE_URL;
  if (process.env.URL) return process.env.URL;

  const proto = event.headers['x-forwarded-proto'] || 'https';
  const host = event.headers.host;
  return `${proto}://${host}`;
};

const getRedirectUri = (event) => `${buildOrigin(event).replace(/\/$/, '')}/.netlify/functions/oauth-callback`;

export async function handler(event) {
  const state = crypto.randomUUID();
  const redirectUri = getRedirectUri(event);
  const params = new URLSearchParams({
    access_type: 'offline',
    client_id: CLIENT_ID,
    prompt: 'consent',
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    state
  });

  return {
    statusCode: 302,
    headers: {
      Location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      'Set-Cookie': `oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`
    },
    body: ''
  };
}
