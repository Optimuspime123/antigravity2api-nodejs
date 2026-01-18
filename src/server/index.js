/**
 * Server entry point
 * Express app setup, middleware, routing, startup, and shutdown
 */

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { closeRequester } from '../api/client.js';
import logger from '../utils/logger.js';
import logWsServer from '../utils/logWsServer.js';
import config from '../config/config.js';
import memoryManager from '../utils/memoryManager.js';
import { getPublicDir, getRelativePath } from '../utils/paths.js';
import { errorHandler } from '../utils/errors.js';
import { getChunkPoolSize, clearChunkPool } from './stream.js';
import ipBlockManager from '../utils/ipBlockManager.js';

// Route modules
import adminRouter from '../routes/admin.js';
import sdRouter from '../routes/sd.js';
import openaiRouter from '../routes/openai.js';
import geminiRouter from '../routes/gemini.js';
import claudeRouter from '../routes/claude.js';
import cliRouter from '../routes/cli.js';

const publicDir = getPublicDir();

const app = express();

// Trust reverse proxy so req.secure and client IP are accurate
app.set('trust proxy', true);

// Initialize IP block manager
ipBlockManager.init();

// Global IP block check middleware
app.use((req, res, next) => {
  const ip = req.ip;
  const status = ipBlockManager.check(ip);
  if (status.blocked) {
    if (status.reason === 'permanent') {
      return res.status(403).json({ error: 'Access Denied: Your IP has been permanently blocked.' });
    }
    const remainingMinutes = Math.ceil((status.expiresAt - Date.now()) / 60000);
    return res.status(429).json({ error: `Access Denied: Temporarily blocked for ${remainingMinutes} minutes.` });
  }
  next();
});

// ==================== Memory management ====================
memoryManager.start(config.server.memoryCleanupInterval);

// ==================== Base middleware ====================
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(cookieParser());
app.use(express.json({ limit: config.security.maxRequestSize }));

// Static file serving
app.use('/images', express.static(path.join(publicDir, 'images')));
app.use(express.static(publicDir));

// Admin routes
app.use('/admin', adminRouter);

// Use shared error handling middleware
app.use(errorHandler);

// ==================== Request logging middleware ====================
app.use((req, res, next) => {
  const ignorePaths = [
    '/images', '/favicon.ico', '/.well-known',
    '/sdapi/v1/options', '/sdapi/v1/samplers', '/sdapi/v1/schedulers',
    '/sdapi/v1/upscalers', '/sdapi/v1/latent-upscale-modes',
    '/sdapi/v1/sd-vae', '/sdapi/v1/sd-modules'
  ];
  // Capture full path early; req.path may be rewritten to relative after routing
  const fullPath = req.originalUrl.split('?')[0];
  if (!ignorePaths.some(p => fullPath.startsWith(p))) {
    const start = Date.now();
    res.on('finish', () => {
      logger.request(req.method, fullPath, res.statusCode, Date.now() - start);
    });
  }
  next();
});

// SD API routes
app.use('/sdapi/v1', sdRouter);

// ==================== API key validation middleware ====================
app.use((req, res, next) => {
  if (req.path.startsWith('/v1/') || req.path.startsWith('/cli/v1/')) {
    const apiKey = config.security?.apiKey;
    if (apiKey) {
      const authHeader = req.headers.authorization || req.headers['x-api-key'];
      const providedKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
      if (providedKey !== apiKey) {
        ipBlockManager.recordViolation(req.ip, 'auth_fail');
        logger.warn(`API key validation failed: ${req.method} ${req.path} (provided key: ${providedKey ? providedKey.substring(0, 10) + '...' : 'none'})`);
        return res.status(401).json({ error: 'Invalid API Key' });
      }
    }
  } else if (req.path.startsWith('/v1beta/')) {
    const apiKey = config.security?.apiKey;
    if (apiKey) {
      const providedKey = req.query.key || req.headers['x-goog-api-key'];
      if (providedKey !== apiKey) {
        ipBlockManager.recordViolation(req.ip, 'auth_fail');
        logger.warn(`API key validation failed: ${req.method} ${req.path} (provided key: ${providedKey ? providedKey.substring(0, 10) + '...' : 'none'})`);
        return res.status(401).json({ error: 'Invalid API Key' });
      }
    }
  }
  next();
});

// ==================== API routes ====================

// OpenAI-compatible API
app.use('/v1', openaiRouter);

// Gemini-compatible API
app.use('/v1beta', geminiRouter);

// Claude-compatible API (/v1/messages handled by claudeRouter)
app.use('/v1', claudeRouter);

// Gemini CLI-compatible API
app.use('/cli', cliRouter);

// ==================== System endpoints ====================

// Memory monitoring endpoint
app.get('/v1/memory', (req, res) => {
  const usage = process.memoryUsage();
  res.json({
    heapUsed: usage.heapUsed,
    heapTotal: usage.heapTotal,
    rss: usage.rss,
    external: usage.external,
    arrayBuffers: usage.arrayBuffers,
    poolSizes: memoryManager.getPoolSizes(),
    chunkPoolSize: getChunkPoolSize()
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// 404 handler (no matching route)
app.use((req, res, next) => {
  // Whitelist paths: 404s here do not trigger IP blocking
  // Includes endpoints clients (e.g. Claude Code) may call but we don't implement
  const whitelistPaths = [
    '/favicon.ico',
    '/robots.txt',
    '/.well-known',
    // Admin UI and logs
    '/ws/logs',
    // Claude API endpoints
    '/api/event_logging',
    '/v1/complete',
    '/v1/models',
    // OpenAI API endpoints
    '/v1/files',
    '/v1/fine-tunes',
    '/v1/fine_tuning',
    '/v1/assistants',
    '/v1/threads',
    '/v1/batches',
    '/v1/uploads',
    '/v1/organization',
    '/v1/usage',
    // Gemini API endpoints
    '/v1beta/models'
  ];

  const path = req.path;
  const isWhitelisted = whitelistPaths.some(p => path === p || path.startsWith(p + '/'));

  if (isWhitelisted) {
    return res.status(404).json({ error: 'Not Found' });
  }

  ipBlockManager.recordViolation(req.ip, '404');
  res.status(404).json({ error: 'Not Found' });
});

// ==================== Server startup ====================
const server = app.listen(config.server.port, config.server.host, () => {
  logger.info(`Server started: ${config.server.host}:${config.server.port}`);

  // Initialize WebSocket log service
  logWsServer.initialize(server);
  logWsServer.updateConfig({
    logMaxSizeMB: config.log?.maxSizeMB,
    logMaxFiles: config.log?.maxFiles,
    logMaxMemory: config.log?.maxMemory
  });
  logger.info('WebSocket log service started: /ws/logs');
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    logger.error(`Port ${config.server.port} is already in use`);
    process.exit(1);
  } else if (error.code === 'EACCES') {
    logger.error(`No permission to access port ${config.server.port}`);
    process.exit(1);
  } else {
    logger.error('Server startup failed:', error.message);
    process.exit(1);
  }
});

// ==================== Graceful shutdown ====================
const shutdown = () => {
  logger.info('Shutting down server...');

  // Stop memory manager
  memoryManager.stop();
  logger.info('Memory manager stopped');

  // Stop child request process
  closeRequester();
  logger.info('Child request process stopped');

  // Clear object pools
  clearChunkPool();
  logger.info('Object pools cleared');

  // Stop WebSocket log service
  logWsServer.close();
  logger.info('WebSocket log service stopped');

  server.close(() => {
    logger.info('Server shut down');
    process.exit(0);
  });

  // Force exit after 5 seconds
  setTimeout(() => {
    logger.warn('Server shutdown timed out; forcing exit');
    process.exit(0);
  }, 5000);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ==================== Error handling ====================
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error.message);
  // Do not exit immediately; allow current requests to finish
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled promise rejection:', reason);
});
