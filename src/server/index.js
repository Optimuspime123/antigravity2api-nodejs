import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateAssistantResponse, generateAssistantResponseNoStream, getAvailableModels, generateImageForSD, closeRequester } from '../api/client.js';
import { generateRequestBody } from '../utils/utils.js';
import logger from '../utils/logger.js';
import config from '../config/config.js';
import tokenManager from '../auth/token_manager.js';
import adminRouter from '../routes/admin.js';
import sdRouter from '../routes/sd.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Utility: create response metadata
const createResponseMeta = () => ({
  id: `chatcmpl-${Date.now()}`,
  created: Math.floor(Date.now() / 1000)
});

// Utility: set streaming response headers
const setStreamHeaders = (res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
};

// Utility: build a streaming chunk
const createStreamChunk = (id, created, model, delta, finish_reason = null) => ({
  id,
  object: 'chat.completion.chunk',
  created,
  model,
  choices: [{ index: 0, delta, finish_reason }]
});

// Utility: write streaming data
const writeStreamData = (res, data) => {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
};

// Utility: end streaming response
const endStream = (res) => {
  res.write('data: [DONE]\n\n');
  res.end();
};

app.use(cors());
app.use(express.json({ limit: config.security.maxRequestSize }));

// Static assets
app.use('/images', express.static(path.join(__dirname, '../../public/images')));
app.use(express.static(path.join(__dirname, '../../public')));

// Admin routes
app.use('/admin', adminRouter);

app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: `Request body too large, maximum supported is ${config.security.maxRequestSize}` });
  }
  next(err);
});

app.use((req, res, next) => {
  const ignorePaths = ['/images', '/favicon.ico', '/.well-known', '/sdapi/v1/options', '/sdapi/v1/samplers', '/sdapi/v1/schedulers', '/sdapi/v1/upscalers', '/sdapi/v1/latent-upscale-modes', '/sdapi/v1/sd-vae', '/sdapi/v1/sd-modules'];
  if (!ignorePaths.some(path => req.path.startsWith(path))) {
    const start = Date.now();
    res.on('finish', () => {
      logger.request(req.method, req.path, res.statusCode, Date.now() - start);
    });
  }
  next();
});
app.use('/sdapi/v1', sdRouter);

app.use((req, res, next) => {
  if (req.path.startsWith('/v1/')) {
    const apiKey = config.security?.apiKey;
    if (apiKey) {
      const authHeader = req.headers.authorization;
      const providedKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
      if (providedKey !== apiKey) {
        logger.warn(`API key verification failed: ${req.method} ${req.path}`);
        return res.status(401).json({ error: 'Invalid API Key' });
      }
    }
  }
  next();
});

app.get('/v1/models', async (req, res) => {
  try {
    const models = await getAvailableModels();
    res.json(models);
  } catch (error) {
    logger.error('Failed to fetch model list:', error.message);
    res.status(500).json({ error: error.message });
  }
});



app.post('/v1/chat/completions', async (req, res) => {
  const { messages, model, stream = false, tools, ...params} = req.body;
  try {
    if (!messages) {
      return res.status(400).json({ error: 'messages is required' });
    }
    const token = await tokenManager.getToken();
    if (!token) {
      throw new Error('No available token; please run npm run login to obtain one');
    }
    const isImageModel = model.includes('-image');
    const requestBody = generateRequestBody(messages, model, params, tools, token);
    if (isImageModel) {
      requestBody.request.generationConfig={
        candidateCount: 1,
        // imageConfig:{
        //   aspectRatio: "1:1"
        // }
      }
      requestBody.requestType="image_gen";
      //requestBody.request.systemInstruction.parts[0].text += "As an image model, focus on helping users generate pictures";
      delete requestBody.request.systemInstruction;
      delete requestBody.request.tools;
      delete requestBody.request.toolConfig;
    }
    //console.log(JSON.stringify(requestBody,null,2))
    
    const { id, created } = createResponseMeta();
    
    if (stream) {
      setStreamHeaders(res);
      
      if (isImageModel) {
        //console.log(JSON.stringify(requestBody,null,2));
        const { content, usage } = await generateAssistantResponseNoStream(requestBody, token);
        writeStreamData(res, createStreamChunk(id, created, model, { content }));
        writeStreamData(res, { ...createStreamChunk(id, created, model, {}, 'stop'), usage });
        endStream(res);
      } else {
        let hasToolCall = false;
        let usageData = null;
        await generateAssistantResponse(requestBody, token, (data) => {
          if (data.type === 'usage') {
            usageData = data.usage;
          } else {
            const delta = data.type === 'tool_calls' 
              ? { tool_calls: data.tool_calls } 
              : { content: data.content };
            if (data.type === 'tool_calls') hasToolCall = true;
            writeStreamData(res, createStreamChunk(id, created, model, delta));
          }
        });
        writeStreamData(res, { ...createStreamChunk(id, created, model, {}, hasToolCall ? 'tool_calls' : 'stop'), usage: usageData });
        endStream(res);
      }
    } else {
      const { content, toolCalls, usage } = await generateAssistantResponseNoStream(requestBody, token);
      const message = { role: 'assistant', content };
      if (toolCalls.length > 0) message.tool_calls = toolCalls;
      
      res.json({
        id,
        object: 'chat.completion',
        created,
        model,
        choices: [{
          index: 0,
          message,
          finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop'
        }],
        usage
      });
    }
  } catch (error) {
    logger.error('Failed to generate response:', error.message);
    if (!res.headersSent) {
      const { id, created } = createResponseMeta();
      const errorContent = `Error: ${error.message}`;
      
      if (stream) {
        setStreamHeaders(res);
        writeStreamData(res, createStreamChunk(id, created, model, { content: errorContent }));
        writeStreamData(res, createStreamChunk(id, created, model, {}, 'stop'));
        endStream(res);
      } else {
        res.json({
          id,
          object: 'chat.completion',
          created,
          model,
          choices: [{
            index: 0,
            message: { role: 'assistant', content: errorContent },
            finish_reason: 'stop'
          }]
        });
      }
    }
  }
});

const server = app.listen(config.server.port, config.server.host, () => {
  logger.info(`Server started: ${config.server.host}:${config.server.port}`);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    logger.error(`Port ${config.server.port} is already in use`);
    process.exit(1);
  } else if (error.code === 'EACCES') {
    logger.error(`Permission denied for port ${config.server.port}`);
    process.exit(1);
  } else {
    logger.error('Server failed to start:', error.message);
    process.exit(1);
  }
});

const shutdown = () => {
  logger.info('Shutting down server...');
  closeRequester();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
