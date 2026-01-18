/**
 * Claude API routes
 * Handles /v1/messages endpoint
 */

import { Router } from 'express';
import { handleClaudeRequest } from '../server/handlers/claude.js';

const router = Router();

/**
 * POST /v1/messages
 * Handle Claude message requests
 */
router.post('/messages', (req, res) => {
  const isStream = req.body.stream === true;
  handleClaudeRequest(req, res, isStream);
});

/**
 * POST /v1/messages/count_tokens
 * Estimate token usage for the request
 * Claude Code frequently calls this endpoint at /init
 */
router.post('/messages/count_tokens', (req, res) => {
  try {
    const { messages, system } = req.body;

    // Simple token estimate: ~4 characters per token
    let totalChars = 0;

    // Count system prompt tokens
    if (system) {
      if (typeof system === 'string') {
        totalChars += system.length;
      } else if (Array.isArray(system)) {
        for (const item of system) {
          if (item.text) totalChars += item.text.length;
        }
      }
    }

    // Count message content tokens
    if (messages && Array.isArray(messages)) {
      for (const msg of messages) {
        if (typeof msg.content === 'string') {
          totalChars += msg.content.length;
        } else if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (part.type === 'text' && part.text) {
              totalChars += part.text.length;
            }
          }
        }
      }
    }

    // Estimate tokens (CN ~2 chars/token, EN ~4 chars/token, avg 3)
    const estimatedTokens = Math.ceil(totalChars / 3);

    res.json({
      input_tokens: estimatedTokens
    });
  } catch (error) {
    res.status(400).json({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: error.message || 'Failed to count tokens'
      }
    });
  }
});

export default router;
