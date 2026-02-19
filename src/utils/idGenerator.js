import { randomUUID, createHash, randomBytes } from 'crypto';

function generateRequestId() {
  const timestamp = Date.now();
  const uuid = randomUUID();
  const number = Math.floor(Math.random() * 10);
  return `agent/${timestamp}/${uuid}/${number}`;
}

function generateSessionId() {
  return String(-Math.floor(Math.random() * 9e18));
}

function generateProjectId() {
  const adjectives = ['useful', 'bright', 'swift', 'calm', 'bold'];
  const nouns = ['fuze', 'wave', 'spark', 'flow', 'core'];
  const randomAdj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];
  const randomNum = Math.random().toString(36).substring(2, 7);
  return `${randomAdj}-${randomNoun}-${randomNum}`;
}

function generateToolCallId() {
  return `call_${randomUUID().replace(/-/g, '')}`;
}

function generateInstanceId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const lowerChars = 'abcdefghijklmnopqrstuvwxyz';
  const randomStr = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  const username = Array.from({ length: 4 }, () => lowerChars[Math.floor(Math.random() * lowerChars.length)]).join('');
  return `LAPTOP-${randomStr}\\${username}-LAPTOP-${randomStr}`;
}

/**
 * Generate a random salt.
 * @returns {string} 32-byte hex salt value
 */
function generateSalt() {
  return randomBytes(32).toString('hex');
}

/**
 * Generate a secure token ID from a refresh token and salt.
 * Uses SHA256 and keeps the first 16 hex characters as the identifier.
 * @param {string} refreshToken - Original refresh_token
 * @param {string} salt - Salt value
 * @returns {string} Secure token ID
 */
function generateTokenId(refreshToken, salt) {
  if (!refreshToken || !salt) return null;
  return createHash('sha256').update(refreshToken + salt).digest('hex').substring(0, 16);
}

export {
    generateProjectId,
    generateSessionId,
    generateRequestId,
    generateToolCallId,
    generateInstanceId,
    generateTokenId,
    generateSalt
}
