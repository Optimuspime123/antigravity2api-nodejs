import fs from 'fs/promises';
import path from 'path';
import { getDataDir } from './paths.js';
import logger from './logger.js';

const BLOCKLIST_FILE = 'ip-blocklist.json';
const TEMP_BLOCK_DURATION = 60 * 60 * 1000; // 1 hour
const MAX_VIOLATIONS_BEFORE_TEMP_BLOCK = 20; // 20 violations trigger a temp block (slightly lenient to avoid false positives)
const MAX_TEMP_BLOCKS_BEFORE_PERMANENT = 3; // 3 temp blocks trigger a permanent block
const VIOLATION_WINDOW = 60 * 1000; // violation window within 1 minute

// Local whitelist IPs
const WHITELISTED_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']);

class IpBlockManager {
  constructor() {
    this.filePath = null;
    this.data = {
      blocked_ips: {}
    };
    this.initialized = false;
    this.savePromise = Promise.resolve();
  }

  isWhitelisted(ip) {
    if (!ip) return false;
    return WHITELISTED_IPS.has(ip) || ip.startsWith('127.');
  }

  async init() {
    if (this.initialized) return;
    this.filePath = path.join(getDataDir(), BLOCKLIST_FILE);
    await this.load();
    this.initialized = true;
  }

  async load() {
    try {
      // Ensure directory exists
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      
      try {
        const content = await fs.readFile(this.filePath, 'utf8');
        this.data = JSON.parse(content);
      } catch (e) {
        if (e.code !== 'ENOENT') {
          logger.error('Failed to load block list:', e.message);
        }
        // Use defaults if file does not exist
        this.data = { blocked_ips: {} };
      }
    } catch (e) {
      logger.error('Failed to initialize block manager:', e.message);
    }
  }

  async save() {
    // Serialize writes to avoid conflicts
    this.savePromise = this.savePromise.then(async () => {
      try {
        await fs.writeFile(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
      } catch (e) {
        logger.error('Failed to save block list:', e.message);
      }
    });
    return this.savePromise;
  }

  check(ip) {
    if (!ip || this.isWhitelisted(ip)) return { blocked: false };
    
    const info = this.data.blocked_ips[ip];
    if (!info) return { blocked: false };

    if (info.permanent) {
      return { blocked: true, reason: 'permanent' };
    }
    
    if (info.expiresAt && Date.now() < info.expiresAt) {
      return { blocked: true, reason: 'temporary', expiresAt: info.expiresAt };
    }

    return { blocked: false };
  }

  async recordViolation(ip, type) {
    if (!ip || this.isWhitelisted(ip)) return;
    
    // Ensure initialized
    if (!this.initialized) await this.init();

    let info = this.data.blocked_ips[ip];
    const now = Date.now();

    if (!info) {
      info = { 
        permanent: false, 
        expiresAt: 0, 
        violations: 0, 
        tempBlockCount: 0, 
        lastViolation: 0 
      };
      this.data.blocked_ips[ip] = info;
    }

    // Skip if already blocked
    if (info.permanent || (info.expiresAt && now < info.expiresAt)) return;

    // Violation window: reset count if last violation is outside the window
    if (now - info.lastViolation > VIOLATION_WINDOW) {
      info.violations = 0;
    }

    info.violations++;
    info.lastViolation = now;

    if (info.violations >= MAX_VIOLATIONS_BEFORE_TEMP_BLOCK) {
      // Trigger block
      info.tempBlockCount++;
      info.violations = 0; // Reset violation count

      if (info.tempBlockCount >= MAX_TEMP_BLOCKS_BEFORE_PERMANENT) {
        info.permanent = true;
        info.expiresAt = 0;
        logger.warn(`IP ${ip} permanently blocked due to frequent violations (${type})`);
      } else {
        info.expiresAt = now + TEMP_BLOCK_DURATION;
        logger.warn(`IP ${ip} temporarily blocked for 1 hour due to frequent violations (${type}) (temp blocks: ${info.tempBlockCount})`);
      }
      
      await this.save();
    }
  }
}

export default new IpBlockManager();
