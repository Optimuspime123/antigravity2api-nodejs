import fs from 'fs';
import path from 'path';
import { log } from '../utils/logger.js';
import { getDataDir } from '../utils/paths.js';
import { QUOTA_CACHE_TTL, QUOTA_CLEANUP_INTERVAL } from '../constants/index.js';

// Quota percentage consumed per request
const REQUEST_COST_PERCENT = 0.6667;

class QuotaManager {
  /**
   * @param {string} filePath - quota data file path
   */
  constructor(filePath = path.join(getDataDir(), 'quotas.json')) {
    this.filePath = filePath;
    /** @type {Map<string, {lastUpdated: number, models: Object, requestCounts: Object, resetTimes: Object}>} */
    this.cache = new Map();
    this.CACHE_TTL = QUOTA_CACHE_TTL;
    this.CLEANUP_INTERVAL = QUOTA_CLEANUP_INTERVAL;
    this.cleanupTimer = null;
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
        // Ensure requestCounts and resetTimes fields exist
        if (!value.requestCounts) value.requestCounts = {};
        if (!value.resetTimes) value.resetTimes = {};
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

  /**
   * Update quota data
   * @param {string} refreshToken - Token ID
   * @param {Object} quotas - quota data
   */
  updateQuota(refreshToken, quotas) {
    const existing = this.cache.get(refreshToken) || {};
    const existingModels = existing.models || {};
    const existingRequestCounts = existing.requestCounts || {};
    const existingResetTimes = existing.resetTimes || {};

    // Check reset times and quota changes per model group
    const newResetTimes = {};
    const newRequestCounts = { ...existingRequestCounts };

    // Track groups that need reset (silent)
    const silentResetGroups = new Set();
    // Track groups with real quota increase (log needed)
    const quotaIncreasedGroups = new Set();

    // Track minimum quota per group to detect increases
    const groupMinRemaining = {};
    const existingGroupMinRemaining = {};

    // Compute minimum quota per group in new data
    Object.entries(quotas || {}).forEach(([modelId, quotaData]) => {
      const groupKey = this._getGroupKey(modelId);
      const remaining = quotaData.r || 0;

      if (groupMinRemaining[groupKey] === undefined || remaining < groupMinRemaining[groupKey]) {
        groupMinRemaining[groupKey] = remaining;
      }

      const resetTimeRaw = quotaData.t;
      if (resetTimeRaw) {
        const newResetMs = Date.parse(resetTimeRaw);
        const oldResetMs = existingResetTimes[groupKey] ? Date.parse(existingResetTimes[groupKey]) : null;

        // Update reset time (earliest wins)
        if (!newResetTimes[groupKey] || newResetMs < Date.parse(newResetTimes[groupKey])) {
          newResetTimes[groupKey] = resetTimeRaw;
        }

        // If reset time changes (new cycle), reset counts silently
        if (oldResetMs && newResetMs > oldResetMs && !silentResetGroups.has(groupKey)) {
          newRequestCounts[groupKey] = 0;
          silentResetGroups.add(groupKey);
        }

        // If current time exceeds reset time, reset counts silently
        if (newResetMs && Date.now() > newResetMs && existingRequestCounts[groupKey] > 0) {
          newRequestCounts[groupKey] = 0;
          silentResetGroups.add(groupKey);
        }
      }
    });

    // Compute minimum quota per group in old data
    Object.entries(existingModels).forEach(([modelId, quotaData]) => {
      const groupKey = this._getGroupKey(modelId);
      const remaining = quotaData.r || 0;

      if (existingGroupMinRemaining[groupKey] === undefined || remaining < existingGroupMinRemaining[groupKey]) {
        existingGroupMinRemaining[groupKey] = remaining;
      }
    });

    // Detect quota increase: if new min > old min, quota reset happened
    for (const groupKey of Object.keys(groupMinRemaining)) {
      const newMin = groupMinRemaining[groupKey];
      const oldMin = existingGroupMinRemaining[groupKey];

      // Only mark increase when old data exists and new quota is clearly higher
      if (oldMin !== undefined && newMin > oldMin + 0.05) {
        newRequestCounts[groupKey] = 0;
        quotaIncreasedGroups.add(groupKey);
      }
    }

    // Log only when quota truly increases
    if (quotaIncreasedGroups.size > 0) {
      log.info(`[QuotaManager] Quota reset; cleared request counts: ${Array.from(quotaIncreasedGroups).join(', ')}`);
    }

    this.cache.set(refreshToken, {
      lastUpdated: Date.now(),
      models: quotas,
      requestCounts: newRequestCounts,
      resetTimes: newResetTimes
    });
    this.saveToFile();
  }

  /**
   * Get group key for a model
   * @param {string} modelId - model ID
   * @returns {string} group key
   */
  _getGroupKey(modelId) {
    const lower = modelId.toLowerCase();
    if (lower.includes('claude')) return 'claude';
    if (lower.includes('gemini-3-pro-image')) return 'banana';
    if (lower.includes('gemini') || lower.includes('publishers/google/')) return 'gemini';
    return 'other';
  }

  /**
   * Record a request
   * @param {string} refreshToken - Token ID
   * @param {string} modelId - model ID used
   */
  recordRequest(refreshToken, modelId) {
    let data = this.cache.get(refreshToken);

    // Create a new cache entry if missing
    if (!data) {
      data = {
        lastUpdated: Date.now(),
        models: {},
        requestCounts: {},
        resetTimes: {}
      };
      this.cache.set(refreshToken, data);
    }

    const groupKey = this._getGroupKey(modelId);
    if (!data.requestCounts) data.requestCounts = {};

    // Check if reset time has passed
    const resetTimeRaw = data.resetTimes?.[groupKey];
    if (resetTimeRaw) {
      const resetMs = Date.parse(resetTimeRaw);
      if (Date.now() > resetMs) {
        // Reset time passed; reset count
        data.requestCounts[groupKey] = 0;
      }
    }

    data.requestCounts[groupKey] = (data.requestCounts[groupKey] || 0) + 1;
    this.saveToFile();
  }

  /**
   * Get quota data (includes request counts and estimates)
   * @param {string} refreshToken - Token ID
   * @returns {Object|null} quota data
   */
  getQuota(refreshToken) {
    const data = this.cache.get(refreshToken);
    if (!data) return null;

    // Check whether cache expired
    if (Date.now() - data.lastUpdated > this.CACHE_TTL) {
      return null;
    }

return data;
  }

  /**
   * Get request counts for a token
   * @param {string} refreshToken - Token ID
   * @returns {Object} request counts { claude: number, gemini: number, banana: number, other: number }
   */
  getRequestCounts(refreshToken) {
    const data = this.cache.get(refreshToken);
    return data?.requestCounts || {};
  }

  /**
   * Check whether token has quota for a model group
   * @param {string} tokenId - Token ID
   * @param {string} modelId - model ID
   * @returns {boolean} true if quota exists or unknown; false if zero
   */
  hasQuotaForModel(tokenId, modelId) {
    const data = this.cache.get(tokenId);
    if (!data || !data.models) {
      // No quota data; assume available
      return true;
    }

    const groupKey = this._getGroupKey(modelId);

    // Find any model's quota within the group
    for (const [id, quotaData] of Object.entries(data.models)) {
      const idGroupKey = this._getGroupKey(id);
      if (idGroupKey === groupKey) {
        const remaining = quotaData.r || 0;
        // If quota is 0, return false
        if (remaining <= 0) {
          return false;
        }
      }
    }

    // No model found in group, or all have quota
    return true;
  }

  /**
   * Get minimum quota for a model group
   * @param {string} tokenId - Token ID
   * @param {string} modelId - model ID
   * @returns {number} minimum quota for group (0-1), 1 if no data
   */
  getModelGroupQuota(tokenId, modelId) {
    const data = this.cache.get(tokenId);
    if (!data || !data.models) {
      return 1; // No data; assume full quota
    }

    const groupKey = this._getGroupKey(modelId);
    let minRemaining = 1;
    let found = false;

    for (const [id, quotaData] of Object.entries(data.models)) {
      const idGroupKey = this._getGroupKey(id);
      if (idGroupKey === groupKey) {
        found = true;
        const remaining = quotaData.r || 0;
        if (remaining < minRemaining) {
          minRemaining = remaining;
        }
      }
    }

    return found ? minRemaining : 1;
  }

  /**
   * Calculate estimated remaining requests
   * @param {number} remainingFraction - remaining quota ratio (0-1)
   * @param {number} requestCount - requests used
   * @returns {number} estimated remaining requests
   */
  calculateEstimatedRequests(remainingFraction, requestCount = 0) {
    // Estimate total available requests from current threshold
    const percentageValue = remainingFraction * 100;
    const totalFromThreshold = Math.floor(percentageValue / REQUEST_COST_PERCENT);
    // Subtract recorded request count
    return Math.max(0, totalFromThreshold - requestCount);
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
      log.info(`Cleaned ${cleaned} expired quota records`);
      this.saveToFile();
    }
  }

  startCleanupTimer() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.cleanupTimer = setInterval(() => this.cleanup(), this.CLEANUP_INTERVAL);
    // Use unref to avoid blocking process exit
    this.cleanupTimer.unref?.();
  }

  stopCleanupTimer() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  convertToBeijingTime(utcTimeStr) {
    if (!utcTimeStr) return 'N/A';
    try {
      const utcDate = new Date(utcTimeStr);
      return utcDate.toLocaleString('zh-CN', {
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
