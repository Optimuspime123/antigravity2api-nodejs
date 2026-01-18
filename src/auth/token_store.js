import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { getDataDir } from '../utils/paths.js';
import { FILE_CACHE_TTL } from '../constants/index.js';
import { log } from '../utils/logger.js';
import { generateSalt } from '../utils/idGenerator.js';

/**
 * Account data file structure:
 * {
 *   "salt": "random salt for generating secure tokenId",
 *   "tokens": [...]
 * }
 */

/**
 * Handles token file read/write and simple caching.
 * Ignores business fields and only loads/saves JSON arrays.
 */
class TokenStore {
  constructor(filePath = path.join(getDataDir(), 'accounts.json')) {
    this.filePath = filePath;
    this._cache = null;
    this._cacheTime = 0;
    this._cacheTTL = FILE_CACHE_TTL;
    this._salt = null;
    this._lastReadOk = true;
    // Write lock: prevent concurrent writes from corrupting data
    this._writeQueue = Promise.resolve();
    this._pendingWrite = null;
  }

  async _ensureFileExists() {
    const dir = path.dirname(this.filePath);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (e) {
      // Ignore existing directory errors
    }

    try {
      await fs.access(this.filePath);
    } catch (e) {
      // Create an empty structure with salt if the file doesn't exist
      const initialData = {
        salt: generateSalt(),
        tokens: []
      };
      await fs.writeFile(this.filePath, JSON.stringify(initialData, null, 2), 'utf8');
      log.info('✓ Created accounts config file (with secure salt)');
    }
  }

  async _atomicWrite(content) {
    const dir = path.dirname(this.filePath);
    const base = path.basename(this.filePath);
    const tempPath = path.join(dir, `.${base}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`);
    let handle;

    try {
      handle = await fs.open(tempPath, 'w');
      await handle.writeFile(content, 'utf8');
      await handle.sync();
      await handle.close();
      try {
        await fs.rename(tempPath, this.filePath);
      } catch (renameError) {
        if (renameError.code === 'EEXIST' || renameError.code === 'EPERM') {
          try {
            await fs.unlink(this.filePath);
          } catch (unlinkError) {
            if (unlinkError.code !== 'ENOENT') {
              throw unlinkError;
            }
          }
          await fs.rename(tempPath, this.filePath);
        } else {
          throw renameError;
        }
      }
    } catch (error) {
      if (handle) {
        try {
          await handle.close();
        } catch (closeError) {
          // Ignore close errors after write failures.
        }
      }
      try {
        await fs.unlink(tempPath);
      } catch (cleanupError) {
        // Ignore cleanup errors for temp files.
      }
      throw error;
    }
  }

  /**
   * Get salt (used to generate secure tokenId)
   * @returns {Promise<string>} salt
   */
  async getSalt() {
    if (this._salt) return this._salt;
    
    await this._ensureFileExists();
    try {
      const data = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(data || '{}');
      
      // Legacy compatibility: if it's an array, migrate to new format
      if (Array.isArray(parsed)) {
        const newData = {
          salt: generateSalt(),
          tokens: parsed
        };
        await fs.writeFile(this.filePath, JSON.stringify(newData, null, 2), 'utf8');
        log.info('✓ Migrated accounts config file to new format (added secure salt)');
        this._salt = newData.salt;
        return this._salt;
      }
      
      // Generate a salt if missing
      if (!parsed.salt) {
        parsed.salt = generateSalt();
        parsed.tokens = parsed.tokens || [];
        await fs.writeFile(this.filePath, JSON.stringify(parsed, null, 2), 'utf8');
        log.info('✓ Added secure salt to accounts config file');
      }
      
      this._salt = parsed.salt;
      return this._salt;
    } catch (error) {
      log.error('Failed to read salt:', error.message);
      // Generate a temporary salt
      this._salt = generateSalt();
      return this._salt;
    }
  }

  _isCacheValid() {
    if (!this._cache) return false;
    const now = Date.now();
    return (now - this._cacheTime) < this._cacheTTL;
  }

  /**
   * Read all tokens (including disabled), with simple in-memory cache
   * @returns {Promise<Array<object>>}
   */
  async readAll() {
    if (this._isCacheValid()) {
      return this._cache;
    }

    await this._ensureFileExists();
    try {
      const data = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(data || '{}');
      
      // Legacy compatibility: use array directly
      if (Array.isArray(parsed)) {
        this._cache = parsed;
        this._lastReadOk = true;
      } else if (parsed.tokens && Array.isArray(parsed.tokens)) {
        this._cache = parsed.tokens;
        this._lastReadOk = true;
      } else {
        log.warn('Accounts config format is invalid; keeping cache and skipping this read');
        this._lastReadOk = false;
        if (this._cache) {
          this._cacheTime = Date.now();
          return this._cache;
        }
        return [];
      }
    } catch (error) {
      log.error('Failed to read accounts config file:', error.message);
      this._lastReadOk = false;
      if (this._cache) {
        this._cacheTime = Date.now();
        return this._cache;
      }
      return [];
    }
    this._cacheTime = Date.now();
    return this._cache;
  }

  /**
   * Overwrite all tokens and update cache
   * Use a write queue to ensure concurrency safety
   * @param {Array<object>} tokens
   */
  async writeAll(tokens) {
    const normalized = Array.isArray(tokens) ? tokens : [];
    
    // Use a queue to ensure write order, avoid concurrent corruption
    const writeOperation = async () => {
      await this._ensureFileExists();
      
      // Ensure salt is loaded
      const salt = await this.getSalt();
      
      try {
        const fileData = {
          salt: salt,
          tokens: normalized
        };
        await this._atomicWrite(JSON.stringify(fileData, null, 2));
        this._cache = normalized;
        this._cacheTime = Date.now();
        this._lastReadOk = true;
      } catch (error) {
        log.error('Failed to save accounts config file:', error.message);
        throw error;
      }
    };
    
    // Enqueue write operation
    this._writeQueue = this._writeQueue
      .then(writeOperation)
      .catch(error => {
        // Catch errors without breaking the queue
        log.error('Write queue operation failed:', error.message);
      });
    
    return this._writeQueue;
  }

  /**
   * Merge active tokens back into the file
   * - Match existing records by refresh_token and update only those
   * - Records not in activeTokens (e.g., disabled accounts) remain unchanged
   * Uses debounce to merge frequent writes
   * @param {Array<object>} activeTokens - active tokens in memory (may include sessionId)
   * @param {object|null} tokenToUpdate - optional single token update to reduce traversal
   */
  async mergeActiveTokens(activeTokens, tokenToUpdate = null) {
    // Use write queue to ensure concurrency safety
    const mergeOperation = async () => {
      const allTokens = [...await this.readAll()];
      const hasActiveTokens = Array.isArray(activeTokens) && activeTokens.length > 0;

      const applyUpdate = (targetToken) => {
        if (!targetToken) return;
        const index = allTokens.findIndex(t => t.refresh_token === targetToken.refresh_token);
        if (index !== -1) {
          const { sessionId, ...plain } = targetToken;
          allTokens[index] = { ...allTokens[index], ...plain };
        }
      };

      if (!this._lastReadOk && allTokens.length === 0) {
        log.warn('Accounts config read failed; skipping write to avoid overwrite');
        return null;
      }

      if (allTokens.length === 0 && hasActiveTokens) {
        return activeTokens.map(({ sessionId, ...plain }) => ({ ...plain }));
      }

      if (tokenToUpdate) {
        applyUpdate(tokenToUpdate);
      } else if (Array.isArray(activeTokens) && activeTokens.length > 0) {
        for (const memToken of activeTokens) {
          applyUpdate(memToken);
        }
      }

      return allTokens;
    };

    // Run merge and write in the queue
    this._writeQueue = this._writeQueue
      .then(async () => {
        const mergedTokens = await mergeOperation();
        if (!mergedTokens) return;
        await this._ensureFileExists();
        const salt = await this.getSalt();
        
        try {
          const fileData = {
            salt: salt,
            tokens: mergedTokens
          };
          await this._atomicWrite(JSON.stringify(fileData, null, 2));
          this._cache = mergedTokens;
          this._cacheTime = Date.now();
          this._lastReadOk = true;
        } catch (error) {
          log.error('Failed to save accounts config file:', error.message);
          // Do not throw to avoid breaking the queue
        }
      })
      .catch(error => {
        log.error('Merge write queue operation failed:', error.message);
      });

    return this._writeQueue;
  }
}

export default TokenStore;
