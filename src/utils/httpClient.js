import axios from 'axios';
import dns from 'dns';
import http from 'http';
import https from 'https';
import { Readable } from 'stream';
import config from '../config/config.js';

// ==================== Unified DNS & proxy config ====================

// Custom DNS lookup: prefer IPv4, fall back to IPv6
function customLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, family: 4 }, (err4, address4, family4) => {
    if (!err4 && address4) {
      return callback(null, address4, family4);
    }
    dns.lookup(hostname, { ...options, family: 6 }, (err6, address6, family6) => {
      if (!err6 && address6) {
        return callback(null, address6, family6);
      }
      callback(err4 || err6);
    });
  });
}

// Agent using custom DNS lookup (prefer IPv4, fall back to IPv6)
const httpAgent = new http.Agent({
  lookup: customLookup,
  keepAlive: true
});

const httpsAgent = new https.Agent({
  lookup: customLookup,
  keepAlive: true
});

// Build proxy configuration
function buildProxyConfig() {
  if (!config.proxy) return false;
  try {
    const proxyUrl = new URL(config.proxy);
    return {
      protocol: proxyUrl.protocol.replace(':', ''),
      host: proxyUrl.hostname,
      port: parseInt(proxyUrl.port, 10)
    };
  } catch {
    return false;
  }
}

// Convert data to a stream to enable chunked encoding
function createChunkedStream(data) {
  const jsonStr = typeof data === 'string' ? data : JSON.stringify(data);
  return Readable.from([jsonStr]);
}

// Build shared axios request config
export function buildAxiosRequestConfig({
  method = 'POST',
  url,
  headers,
  data = null,
  timeout = config.timeout,
  responseType,
  useChunked = false
}) {
  const axiosConfig = {
    method,
    url,
    headers: { ...headers },
    timeout,
    httpAgent,
    httpsAgent,
    proxy: buildProxyConfig(),
    // Disable Content-Length so axios uses Transfer-Encoding: chunked
    maxContentLength: Infinity,
    maxBodyLength: Infinity
  };

  if (responseType) axiosConfig.responseType = responseType;
  
  if (data !== null) {
    if (useChunked) {
      // Use streaming data to enable chunked encoding
      axiosConfig.data = createChunkedStream(data);
      // Remove Content-Length header to force chunked
      delete axiosConfig.headers['Content-Length'];
    } else {
      axiosConfig.data = data;
    }
  }
  return axiosConfig;
}

// Simple axios wrapper for future extensions (retries, metrics, etc.)
export async function httpRequest(configOverrides) {
  // Enable chunked encoding by default to match official clients
  const axiosConfig = buildAxiosRequestConfig({ ...configOverrides, useChunked: true });
  return axios(axiosConfig);
}

// Streaming request wrapper
export async function httpStreamRequest(configOverrides) {
  // Enable chunked encoding by default to match official clients
  const axiosConfig = buildAxiosRequestConfig({ ...configOverrides, useChunked: true });
  axiosConfig.responseType = 'stream';
  return axios(axiosConfig);
}
