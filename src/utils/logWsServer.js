/**
 * WebSocket log service module.
 * Provides real-time log streaming and log file management.
 */
import { WebSocketServer } from 'ws';
import fs from 'fs';
import path from 'path';
import { getDataDir } from './paths.js';

// Default configuration
const DEFAULT_LOG_MAX_SIZE_MB = 10;   // Max 10MB per log file
const DEFAULT_LOG_MAX_FILES = 5;      // Keep 5 history files
const DEFAULT_LOG_MAX_MEMORY = 500;   // Keep 500 log entries in memory

// Log directory
const dataDir = getDataDir();
const LOG_DIR = path.join(dataDir, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'app.log');

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

class LogWebSocketServer {
    constructor() {
        this.wss = null;
        this.clients = new Set();
        this.logStore = [];
        this.currentLogSize = 0;

        // Configuration (can be updated at runtime)
        this.maxSizeMB = DEFAULT_LOG_MAX_SIZE_MB;
        this.maxFiles = DEFAULT_LOG_MAX_FILES;
        this.maxMemory = DEFAULT_LOG_MAX_MEMORY;

        // Initialize log file size
        this._initLogFileSize();

        // Write buffer (avoid frequent disk writes)
        this.writeBuffer = [];
        this.flushTimer = null;
        this.FLUSH_INTERVAL = 1000; // Flush every 1 second
    }

    /**
     * Initialize by reading the current log file size.
     */
    _initLogFileSize() {
        try {
            if (fs.existsSync(LOG_FILE)) {
                const stats = fs.statSync(LOG_FILE);
                this.currentLogSize = stats.size;
            }
        } catch (error) {
            this.currentLogSize = 0;
        }
    }

    /**
     * Update configuration.
     */
    updateConfig(config) {
        if (config.logMaxSizeMB !== undefined) {
            this.maxSizeMB = config.logMaxSizeMB;
        }
        if (config.logMaxFiles !== undefined) {
            this.maxFiles = config.logMaxFiles;
        }
        if (config.logMaxMemory !== undefined) {
            this.maxMemory = config.logMaxMemory;
        }
    }

    /**
     * Initialize the WebSocket server.
     * @param {http.Server} server - HTTP server instance
     */
    initialize(server) {
        this.wss = new WebSocketServer({ server, path: '/ws/logs' });

        this.wss.on('connection', (ws, req) => {
            this.clients.add(ws);

            // Send recent log history
            const recentLogs = this.logStore.slice(-50);
            if (recentLogs.length > 0) {
                ws.send(JSON.stringify({
                    type: 'history',
                    logs: recentLogs
                }));
            }

            ws.on('close', () => {
                this.clients.delete(ws);
            });

            ws.on('error', () => {
                this.clients.delete(ws);
            });
        });
    }

    /**
     * Broadcast a log entry to all clients.
     */
    broadcast(entry) {
        const message = JSON.stringify({
            type: 'log',
            log: entry
        });

        for (const client of this.clients) {
            if (client.readyState === 1) { // OPEN
                try {
                    client.send(message);
                } catch (e) {
                    this.clients.delete(client);
                }
            }
        }
    }

    /**
     * Store a log entry.
     */
    storeLog(level, message) {
        const entry = {
            id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
            timestamp: new Date().toISOString(),
            level,
            message
        };

        // Store in memory
        this.logStore.push(entry);
        while (this.logStore.length > this.maxMemory) {
            this.logStore.shift();
        }

        // Broadcast to WebSocket clients
        this.broadcast(entry);

        // Add to write buffer
        this._bufferWrite(entry);

        return entry;
    }

    /**
     * Buffered write (reduce disk I/O).
     */
    _bufferWrite(entry) {
        const line = `${entry.timestamp} [${entry.level}] ${entry.message}\n`;
        this.writeBuffer.push(line);

        // Schedule flush
        if (!this.flushTimer) {
            this.flushTimer = setTimeout(() => {
                this._flushBuffer();
            }, this.FLUSH_INTERVAL);
        }
    }

    /**
     * Flush buffer to disk.
     */
    _flushBuffer() {
        if (this.writeBuffer.length === 0) {
            this.flushTimer = null;
            return;
        }

        const content = this.writeBuffer.join('');
        this.writeBuffer = [];
        this.flushTimer = null;

        const contentSize = Buffer.byteLength(content, 'utf8');

        // Check whether rotation is needed
        if (this.currentLogSize + contentSize > this.maxSizeMB * 1024 * 1024) {
            this._rotateLog();
        }

        // Append write
        try {
            fs.appendFileSync(LOG_FILE, content, 'utf8');
            this.currentLogSize += contentSize;
        } catch (error) {
            console.error('Failed to write log file:', error.message);
        }
    }

    /**
     * Rotate log files.
     */
    _rotateLog() {
        try {
            // Delete the oldest file
            for (let i = this.maxFiles - 1; i >= 1; i--) {
                const oldFile = `${LOG_FILE}.${i}`;
                const newFile = `${LOG_FILE}.${i + 1}`;
                if (fs.existsSync(oldFile)) {
                    if (i === this.maxFiles - 1) {
                        fs.unlinkSync(oldFile);
                    } else {
                        fs.renameSync(oldFile, newFile);
                    }
                }
            }

            // Rename current file
            if (fs.existsSync(LOG_FILE)) {
                fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
            }

            this.currentLogSize = 0;
        } catch (error) {
            console.error('Log rotation failed:', error.message);
        }
    }

    /**
     * Fetch logs (API query).
     */
    getLogs(options = {}) {
        const { level, search, limit = 100, offset = 0 } = options;

        let filtered = [...this.logStore];

        // Filter separators
        filtered = filtered.filter(log => !this._isSeparator(log.message));

        if (level && level !== 'all') {
            filtered = filtered.filter(log => log.level === level);
        }

        if (search) {
            const searchLower = search.toLowerCase();
            filtered = filtered.filter(log =>
                log.message.toLowerCase().includes(searchLower)
            );
        }

        filtered.reverse();

        return {
            logs: filtered.slice(offset, offset + limit),
            total: filtered.length
        };
    }

    /**
     * Determine whether a message is a separator.
     */
    _isSeparator(message) {
        if (!message || typeof message !== 'string') return false;
        const trimmed = message.trim();
        if (trimmed.length < 3) return false;
        return /^[═─=\-*_~]+$/.test(trimmed);
    }

    /**
     * Clear logs.
     */
    clearLogs() {
        this.logStore.length = 0;
        // Broadcast clear event
        for (const client of this.clients) {
            if (client.readyState === 1) {
                try {
                    client.send(JSON.stringify({ type: 'clear' }));
                } catch (e) { }
            }
        }
    }

    /**
     * Get stats.
     */
    getLogStats() {
        const stats = { total: 0, info: 0, warn: 0, error: 0, request: 0, debug: 0 };

        for (const log of this.logStore) {
            if (this._isSeparator(log.message)) continue;
            stats.total++;
            if (stats[log.level] !== undefined) {
                stats[log.level]++;
            }
        }

        return stats;
    }

    /**
     * Close the service.
     */
    close() {
        // Flush remaining buffer
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this._flushBuffer();
        }

        // Close WebSocket
        if (this.wss) {
            for (const client of this.clients) {
                client.close();
            }
            this.wss.close();
        }
    }
}

// Singleton
export const logWsServer = new LogWebSocketServer();
export default logWsServer;
