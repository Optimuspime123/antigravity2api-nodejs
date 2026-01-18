/**
 * Gemini CLI API routes
 * Handles endpoints for multiple formats:
 * - /cli/v1/chat/completions (OpenAI format)
 * - /cli/v1beta/models/:model:generateContent (Gemini format)
 * - /cli/v1beta/models/:model:streamGenerateContent (Gemini streaming format)
 * - /cli/v1/messages (Claude format)
 *
 * Entry point for the Gemini CLI proxy, supporting OpenAI/Gemini/Claude-compatible formats.
 */

import { Router } from 'express';
import { handleGeminiCliRequest } from '../server/handlers/geminicli.js';
import logger from '../utils/logger.js';
import config from '../config/config.js';

const router = Router();

/**
 * Middleware: check whether Gemini CLI is enabled
 */
const checkGeminiCliEnabled = (req, res, next) => {
  if (config.geminicli?.enabled === false) {
    return res.status(503).json({
      error: {
        message: 'Gemini CLI is not enabled',
        type: 'service_unavailable',
        code: 'geminicli_disabled'
      }
    });
  }
  next();
};

// Apply middleware to all routes
router.use(checkGeminiCliEnabled);

/**
 * Generate Gemini CLI model list
 * Keep consistent with the gcli2api project
 */
function getGeminiCliModels() {
  const baseModels = [
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-3-pro-preview',
    'gemini-3-flash-preview'
  ];
  
  const models = [];
  const featurePrefixes = ['', 'pseudo-stream/', 'stream-anti-truncate/'];
  const thinkingSuffixes = ['', '-maxthinking', '-nothinking'];
  const searchSuffix = '-search';
  
  for (const baseModel of baseModels) {
    for (const prefix of featurePrefixes) {
      // Base model
      models.push(`${prefix}${baseModel}`);
      
      // With thinking suffix
      for (const thinkingSuffix of thinkingSuffixes) {
        if (thinkingSuffix) {
          models.push(`${prefix}${baseModel}${thinkingSuffix}`);
        }
      }
      
      // With search suffix
      models.push(`${prefix}${baseModel}${searchSuffix}`);
      
      // With thinking + search suffix
      for (const thinkingSuffix of thinkingSuffixes) {
        if (thinkingSuffix) {
          models.push(`${prefix}${baseModel}${thinkingSuffix}${searchSuffix}`);
        }
      }
    }
  }
  
  return models;
}

/**
 * Shared handler for model list responses
 */
function handleModelsRequest(req, res) {
  try {
    const created = Math.floor(Date.now() / 1000);
    const models = getGeminiCliModels();
    
    const modelList = {
      object: 'list',
      data: models.map(id => ({
        id,
        object: 'model',
        created,
        owned_by: 'google'
      }))
    };
    
    res.json(modelList);
  } catch (error) {
    logger.error('[GeminiCLI] Failed to fetch model list:', error.message);
    res.status(500).json({ error: error.message });
  }
}

/**
 * GET /cli/v1/models
 * Get available model list (OpenAI format)
 */
router.get('/v1/models', handleModelsRequest);

/**
 * GET /cli/v1beta/models
 * Get available model list (Gemini format)
 */
router.get('/v1beta/models', handleModelsRequest);

/**
 * POST /cli/v1/chat/completions
 * Handle OpenAI chat completion requests
 */
router.post('/v1/chat/completions', (req, res) => handleGeminiCliRequest(req, res, 'openai'));

// ==================== Gemini format endpoints ====================

/**
 * POST /cli/v1beta/models/:model:generateContent
 * Handle Gemini non-stream requests
 */
router.post('/v1beta/models/:model\\:generateContent', (req, res) => {
  // Add model name to request body
  req.body.model = req.params.model;
  handleGeminiCliRequest(req, res, 'gemini');
});

/**
 * POST /cli/v1beta/models/:model:streamGenerateContent
 * Handle Gemini streaming requests
 */
router.post('/v1beta/models/:model\\:streamGenerateContent', (req, res) => {
  // Add model name to request body and mark as streaming
  req.body.model = req.params.model;
  req.body._isStream = true; // Internal flag
  handleGeminiCliRequest(req, res, 'gemini');
});

// ==================== Claude format endpoints ====================

/**
 * POST /cli/v1/messages
 * Handle Claude message requests
 */
router.post('/v1/messages', (req, res) => handleGeminiCliRequest(req, res, 'claude'));

// ==================== Health check ====================

/**
 * GET /cli/health
 * Health check endpoint
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'geminicli',
    enabled: config.geminicli?.enabled !== false,
    supportedFormats: ['openai', 'gemini', 'claude']
  });
});

export default router;
