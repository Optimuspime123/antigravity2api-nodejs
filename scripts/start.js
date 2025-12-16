import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CLOUDflared_ARGS = ['tunnel', '--url', 'http://localhost:8045'];
const MAX_OUTPUT_LINES = 20;

function startServer() {
  const serverPath = path.join(__dirname, '..', 'src', 'server', 'index.js');
  const serverProcess = spawn(process.execPath, [serverPath], {
    stdio: 'inherit',
  });
  return serverProcess;
}

function startCloudflared() {
  const lines = [];
  let urlFound = false;

  let cloudflared;
  try {
    cloudflared = spawn('cloudflared', CLOUDflared_ARGS);
  } catch (err) {
    console.warn(`Unable to start cloudflared: ${err.message}`);
    return null;
  }

  const capture = (data) => {
    const text = data.toString();
    text.split(/\r?\n/).forEach((line) => {
      if (!line) return;
      if (lines.length < MAX_OUTPUT_LINES) lines.push(line);
      if (!urlFound) {
        const match = line.match(/https?:\/\/[^\s]+trycloudflare\.com\S*/i);
        if (match) {
          urlFound = true;
          console.log(`Cloudflare Tunnel URL: ${match[0]}`);
        }
      }
    });
  };

  cloudflared.stdout.on('data', capture);
  cloudflared.stderr.on('data', capture);

  cloudflared.on('error', (err) => {
    if (err.code === 'ENOENT') {
      console.warn('cloudflared not found; skipping tunnel startup.');
    } else {
      console.warn(`Failed to launch cloudflared: ${err.message}`);
    }
  });

  cloudflared.on('exit', (code) => {
    if (!urlFound && lines.length > 0) {
      console.log('cloudflared output (first 20 lines):');
      lines.forEach((line) => console.log(line));
    }
    if (code && code !== 0) {
      console.warn(`cloudflared exited with code ${code}`);
    }
  });

  return cloudflared;
}

const serverProcess = startServer();
const cloudflaredProcess = startCloudflared();

const shutdown = () => {
  if (cloudflaredProcess && !cloudflaredProcess.killed) {
    cloudflaredProcess.kill();
  }
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
  }
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

serverProcess.on('exit', (code) => {
  if (cloudflaredProcess && !cloudflaredProcess.killed) {
    cloudflaredProcess.kill();
  }
  process.exit(code ?? 0);
});
