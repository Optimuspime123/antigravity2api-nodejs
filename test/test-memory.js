/**
 * Memory optimization test script.
 * Validates whether memory usage stays within the target range (~20MB).
 */

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

// Configuration
const PORT = process.env.PORT || 9876;
const BASE_URL = `http://localhost:${PORT}`;
const TEST_DURATION_MS = 60000; // Test duration: 60s
const SAMPLE_INTERVAL_MS = 2000; // Sample interval: 2s
const REQUEST_INTERVAL_MS = 1000; // Request interval: 1s

// Memory samples
const memorySamples = [];
let serverProcess = null;
let testStartTime = null;

/**
 * Format memory size
 */
function formatMemory(bytes) {
  const mb = bytes / 1024 / 1024;
  return `${mb.toFixed(2)} MB`;
}

/**
 * Send HTTP request
 */
function sendRequest(urlPath, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 5000
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

/**
 * Get server memory usage (via /v1/memory endpoint)
 */
async function getServerMemory() {
  try {
    const response = await sendRequest('/v1/memory');
    if (response.status === 200) {
      const data = JSON.parse(response.data);
      return data;
    }
  } catch (e) {
    // If the endpoint doesn't exist, return null
  }
  return null;
}

/**
 * Simulate API requests
 */
async function simulateLoad() {
  const requests = [
    { path: '/v1/models', method: 'GET' },
    { path: '/health', method: 'GET' },
    { path: '/v1/chat/completions', method: 'POST', body: {
      model: 'test-model',
      messages: [{ role: 'user', content: 'Hello, this is a test message for memory optimization.' }],
      stream: false
    }},
  ];

  const randomRequest = requests[Math.floor(Math.random() * requests.length)];
  try {
    await sendRequest(randomRequest.path, randomRequest.method, randomRequest.body);
  } catch (e) {
    // Ignore request errors; focus is memory testing
  }
}

/**
 * Start server process
 */
function startServer() {
  return new Promise((resolve, reject) => {
    console.log('🚀 Starting server...');
    
    const serverPath = path.join(__dirname, '..', 'src', 'server', 'index.js');
    serverProcess = spawn('node', ['--expose-gc', serverPath], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: PORT.toString() },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let started = false;
    
    serverProcess.stdout.on('data', (data) => {
      const output = data.toString();
      if (!started && (output.includes('listening') || output.includes('Server started') || output.includes('server'))) {
        started = true;
        setTimeout(resolve, 1000); // Wait for server to fully start
      }
    });

    serverProcess.stderr.on('data', (data) => {
      console.error('Server stderr:', data.toString());
    });

    serverProcess.on('error', reject);

    // Timeout handling
    setTimeout(() => {
      if (!started) {
        started = true;
        resolve(); // Continue even if no startup message detected
      }
    }, 5000);
  });
}

/**
 * Stop server process
 */
function stopServer() {
  if (serverProcess) {
    console.log('\n🛑 Stopping server...');
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
}

/**
 * Collect memory sample
 */
async function collectMemorySample() {
  const memoryInfo = await getServerMemory();
  const elapsed = Date.now() - testStartTime;
  
  if (memoryInfo) {
    memorySamples.push({
      time: elapsed,
      heapUsed: memoryInfo.heapUsed,
      heapTotal: memoryInfo.heapTotal,
      rss: memoryInfo.rss,
      external: memoryInfo.external
    });
    
    console.log(`📊 [${(elapsed/1000).toFixed(1)}s] Heap: ${formatMemory(memoryInfo.heapUsed)} / ${formatMemory(memoryInfo.heapTotal)}, RSS: ${formatMemory(memoryInfo.rss)}`);
  } else {
    // If no memory endpoint, use process memory estimate
    const usage = process.memoryUsage();
    console.log(`📊 [${(elapsed/1000).toFixed(1)}s] Process memory - Heap: ${formatMemory(usage.heapUsed)}, RSS: ${formatMemory(usage.rss)}`);
  }
}

/**
 * Analyze memory data
 */
function analyzeResults() {
  if (memorySamples.length === 0) {
    console.log('\n⚠️ No memory data collected (server may not have /v1/memory)');
    console.log('Please check server logs for memory usage.');
    return;
  }

  const heapValues = memorySamples.map(s => s.heapUsed);
  const rssValues = memorySamples.map(s => s.rss);

  const heapMin = Math.min(...heapValues);
  const heapMax = Math.max(...heapValues);
  const heapAvg = heapValues.reduce((a, b) => a + b, 0) / heapValues.length;

  const rssMin = Math.min(...rssValues);
  const rssMax = Math.max(...rssValues);
  const rssAvg = rssValues.reduce((a, b) => a + b, 0) / rssValues.length;

  console.log('\n📈 Memory analysis');
  console.log('═'.repeat(50));
  console.log(`Samples: ${memorySamples.length}`);
  console.log(`Duration: ${((memorySamples[memorySamples.length-1]?.time || 0) / 1000).toFixed(1)} s`);
  console.log('');
  console.log('Heap usage:');
  console.log(`  Min: ${formatMemory(heapMin)}`);
  console.log(`  Max: ${formatMemory(heapMax)}`);
  console.log(`  Avg: ${formatMemory(heapAvg)}`);
  console.log('');
  console.log('RSS (resident memory):');
  console.log(`  Min: ${formatMemory(rssMin)}`);
  console.log(`  Max: ${formatMemory(rssMax)}`);
  console.log(`  Avg: ${formatMemory(rssAvg)}`);
  console.log('');

  // Evaluate target criteria
  const TARGET_HEAP = 20 * 1024 * 1024; // 20MB
  const TARGET_RSS = 50 * 1024 * 1024;  // 50MB (RSS is usually larger than heap)

  if (heapAvg <= TARGET_HEAP) {
    console.log('✅ Heap usage meets target! Average is below 20MB.');
  } else {
    console.log(`⚠️ Heap usage above target. Average ${formatMemory(heapAvg)} (target 20MB).`);
  }

  if (heapMax - heapMin < 10 * 1024 * 1024) {
    console.log('✅ Memory fluctuation is stable (< 10MB).');
  } else {
    console.log(`⚠️ Memory fluctuation is large. Range: ${formatMemory(heapMax - heapMin)}`);
  }
}

/**
 * Main test flow
 */
async function runTest() {
  console.log('🧪 Antigravity service memory optimization test');
  console.log('═'.repeat(50));
  console.log(`Target: keep heap around ~20MB`);
  console.log(`Duration: ${TEST_DURATION_MS / 1000} s`);
  console.log(`Sample interval: ${SAMPLE_INTERVAL_MS / 1000} s`);
  console.log('═'.repeat(50));
  console.log('');

  try {
    await startServer();
    console.log('✅ Server started\n');
    
    testStartTime = Date.now();
    
    // Sampling timer
    const sampleInterval = setInterval(collectMemorySample, SAMPLE_INTERVAL_MS);
    
    // Load simulation timer
    const loadInterval = setInterval(simulateLoad, REQUEST_INTERVAL_MS);
    
    // Wait for test completion
    await new Promise(resolve => setTimeout(resolve, TEST_DURATION_MS));
    
    // Cleanup timers
    clearInterval(sampleInterval);
    clearInterval(loadInterval);
    
    // Final sample
    await collectMemorySample();
    
    // Analyze results
    analyzeResults();
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    stopServer();
    process.exit(0);
  }
}

// Handle process exit
process.on('SIGINT', () => {
  console.log('\nReceived interrupt signal...');
  stopServer();
  process.exit(0);
});

process.on('SIGTERM', () => {
  stopServer();
  process.exit(0);
});

// Run test
runTest();
