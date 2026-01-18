import http from 'http';
import { URL } from 'url';
import path from 'path';
import { fileURLToPath } from 'url';
import log from '../src/utils/logger.js';
import tokenManager from '../src/auth/token_manager.js';
import oauthManager from '../src/auth/oauth_manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ACCOUNTS_FILE = path.join(__dirname, '..', 'data', 'accounts.json');

let isClosing = false;

const server = http.createServer((req, res) => {
  // Ignore new requests if the server is shutting down
  const addr = server.address();
  if (!addr || isClosing) {
    res.writeHead(503);
    res.end('Server is shutting down');
    return;
  }
  
  const port = addr.port;
  const url = new URL(req.url, `http://localhost:${port}`);
  
  if (url.pathname === '/oauth-callback') {
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    
    if (code) {
      log.info('Authorization code received. Exchanging token...');
      oauthManager.authenticate(code, port).then(account => {
        const result = tokenManager.addToken(account);
        if (result.success) {
          log.info(`Token saved to ${ACCOUNTS_FILE}`);
          if (!account.hasQuota) {
            log.warn('This account is not eligible; a random ProjectId was assigned.');
          }
        } else {
          log.error('Failed to save token:', result.message);
        }
        
        const statusMsg = account.hasQuota ? '' : '<p style="color: orange;">⚠️ This account is not eligible; a random ProjectId was assigned.</p>';
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<h1>Authorization successful!</h1><p>Token saved. You can close this page.</p>${statusMsg}`);
        isClosing = true;
        setTimeout(() => server.close(), 1000);
      }).catch(err => {
        log.error('Authentication failed:', err.message);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>Authentication failed</h1><p>Check the console for details.</p>');
        isClosing = true;
        setTimeout(() => server.close(), 1000);
      });
    } else {
      log.error('Authorization failed:', error || 'No authorization code received');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>Authorization failed</h1>');
      isClosing = true;
      setTimeout(() => server.close(), 1000);
    }
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(0, () => {
  const port = server.address().port;
  const authUrl = oauthManager.generateAuthUrl(port);
  log.info(`Server running at http://localhost:${port}`);
  log.info('Open the following link in your browser to sign in:');
  console.log(`\n${authUrl}\n`);
  log.info('Waiting for authorization callback...');
});
