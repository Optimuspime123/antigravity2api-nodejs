import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const DEFAULT_PORT = 8045;
const DEFAULT_HOST = '127.0.0.1';

function readConfigValue() {
  const candidates = ['config.json', 'config.json.example'];
  for (const file of candidates) {
    const fullPath = path.resolve(process.cwd(), file);
    if (!fs.existsSync(fullPath)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      return {
        port: data?.server?.port ?? DEFAULT_PORT,
        host: data?.server?.host ?? DEFAULT_HOST
      };
    } catch {
      // ignore parse errors
    }
  }
  return { port: DEFAULT_PORT, host: DEFAULT_HOST };
}

function findCloudflaredBinary() {
  const candidates = ['cloudflared', 'cloudfared'];
  for (const name of candidates) {
    const result = spawnSync(name, ['--version'], { stdio: 'ignore' });
    if (!result.error && result.status === 0) {
      return name;
    }
  }
  return null;
}

const { port, host } = readConfigValue();
const targetHost = host === '0.0.0.0' ? '127.0.0.1' : host;
const serverUrl = `http://${targetHost}:${port}`;

const tunnelInfoPath = path.join(process.cwd(), 'data', 'cloudflared-url.json');

const ensureTunnelDir = () => {
  fs.mkdirSync(path.dirname(tunnelInfoPath), { recursive: true });
};

const writeTunnelInfo = (url) => {
  ensureTunnelDir();
  fs.writeFileSync(tunnelInfoPath, JSON.stringify({ url, updatedAt: Date.now() }, null, 2), 'utf8');
};

const clearTunnelInfo = () => {
  if (fs.existsSync(tunnelInfoPath)) {
    fs.unlinkSync(tunnelInfoPath);
  }
};

clearTunnelInfo();

const serverProcess = spawn(process.execPath, ['--expose-gc', 'src/server/index.js'], {
  stdio: 'inherit'
});

const cloudflaredBinary = findCloudflaredBinary();
let tunnelProcess = null;
let tunnelUrl = null;

if (cloudflaredBinary) {
  console.log(`[cloudflared] Detected ${cloudflaredBinary}. Starting tunnel for ${serverUrl}`);
  tunnelProcess = spawn(cloudflaredBinary, ['tunnel', '--url', serverUrl], { stdio: ['ignore', 'pipe', 'pipe'] });

  const handleTunnelOutput = (chunk) => {
    const text = chunk.toString();
    process.stdout.write(text);
    const match = text.match(/https?:\/\/[^\s]+\.trycloudflare\.com/);
    if (match && match[0] !== tunnelUrl) {
      tunnelUrl = match[0];
      writeTunnelInfo(tunnelUrl);
      console.log(`[cloudflared] Tunnel available at ${tunnelUrl}`);
    }
  };

  tunnelProcess.stdout.on('data', handleTunnelOutput);
  tunnelProcess.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    process.stderr.write(text);
    const match = text.match(/https?:\/\/[^\s]+\.trycloudflare\.com/);
    if (match && match[0] !== tunnelUrl) {
      tunnelUrl = match[0];
      writeTunnelInfo(tunnelUrl);
      console.log(`[cloudflared] Tunnel available at ${tunnelUrl}`);
    }
  });
}

const shutdown = (signal) => {
  if (tunnelProcess) {
    tunnelProcess.kill('SIGTERM');
  }
  clearTunnelInfo();
  if (serverProcess) {
    serverProcess.kill(signal);
  }
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

serverProcess.on('exit', (code) => {
  if (tunnelProcess) {
    tunnelProcess.kill('SIGTERM');
  }
  clearTunnelInfo();
  process.exit(code ?? 0);
});
