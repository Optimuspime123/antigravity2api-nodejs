import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { log } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class QuotaManager {
  constructor(filePath = path.join(__dirname, '..', '..', 'data', 'quotas.json')) {
    this.filePath = filePath;
    this.cache = new Map();
    this.CACHE_TTL = 5 * 60 * 1000; // 5-minute cache
    this.CLEANUP_INTERVAL = 60 * 60 * 1000; // Clean every hour
    this.ensureFileExists();
    this.loadFromFile();
    this.startCleanupTimer();
  }

  ensureFileExists() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, JSON.stringify({ meta: { lastCleanup: Date.now(), ttl: this.CLEANUP_INTERVAL }, quotas: {} }, null, 2), 'utf8');
    }
  }

  loadFromFile() {
    try {
      const data = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(data);
      Object.entries(parsed.quotas || {}).forEach(([key, value]) => {
        this.cache.set(key, value);
      });
    } catch (error) {
      log.error('Failed to load quota file:', error.message);
    }
  }

  saveToFile() {
    try {
      const quotas = {};
      this.cache.forEach((value, key) => {
        quotas[key] = value;
      });
      const data = {
        meta: { lastCleanup: Date.now(), ttl: this.CLEANUP_INTERVAL },
        quotas
      };
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
      log.error('Failed to save quota file:', error.message);
    }
  }

  updateQuota(refreshToken, quotas) {
    this.cache.set(refreshToken, {
      lastUpdated: Date.now(),
      models: quotas
    });
    this.saveToFile();
  }

  getQuota(refreshToken) {
    const data = this.cache.get(refreshToken);
    if (!data) return null;
    
    // Check whether the cache entry expired
    if (Date.now() - data.lastUpdated > this.CACHE_TTL) {
      return null;
    }
    
    return data;
  }

  cleanup() {
    const now = Date.now();
    let cleaned = 0;
    
    this.cache.forEach((value, key) => {
      if (now - value.lastUpdated > this.CLEANUP_INTERVAL) {
        this.cache.delete(key);
        cleaned++;
      }
    });
    
    if (cleaned > 0) {
      log.info(`Cleaned ${cleaned} expired quota record(s)`);
      this.saveToFile();
    }
  }

  startCleanupTimer() {
    setInterval(() => this.cleanup(), this.CLEANUP_INTERVAL);
  }

  convertToBeijingTime(utcTimeStr) {
    if (!utcTimeStr) return 'N/A';
    try {
      const utcDate = new Date(utcTimeStr);
      return utcDate.toLocaleString('en-US', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Shanghai'
      });
    } catch (error) {
      return 'N/A';
    }
  }
}

const quotaManager = new QuotaManager();
export default quotaManager;
