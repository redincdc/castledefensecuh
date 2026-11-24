/**
 * LogManager.js - Manages session-based game activity logs.
 * Optimizations for high-entity counts and long sessions.
 */

class LogManager {
    constructor() {
        this.currentLogFile = null;
        this.logPrefix = "game_log_";
        this.isInitialized = false;
        this.db = null;
        this.inMemoryLogBuffer = []; // Use array for faster concatenation
        this._pendingLogs = [];
        this.maxLogLines = 15000; // Increased from 3000 to handle high-frequency damage logs
        this._lastLogContent = null;
        this._lastLogCategory = null;
        this._repeatCount = 1;

        if (typeof Android === 'undefined') {
            this._openBrowserDB();
        }
    }

    _openBrowserDB() {
        if (typeof indexedDB === 'undefined') return Promise.resolve(null);
        return new Promise((resolve) => {
            try {
                const request = indexedDB.open("CastleDefenseLogs", 1);
                request.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains("logs")) {
                        db.createObjectStore("logs", { keyPath: "fileName" });
                    }
                };
                request.onsuccess = (e) => {
                    this.db = e.target.result;
                    resolve(this.db);
                };
                request.onerror = () => resolve(null);
            } catch(e) { resolve(null); }
        });
    }

    reset() {
        if (this._batch) this._flushBatch();
        this.currentLogFile = null;
        this.isInitialized = false;
        // Keep buffer to persist across games until browser refresh
        this._pendingLogs = [];
    }

    async initSession() {
        if (this._batch) this._flushBatch();
        const now = new Date();
        const timestamp = now.toISOString().replace(/[:.]/g, "-");
        this.currentLogFile = `${this.logPrefix}${timestamp}.txt`;

        const header = `\n▶ SESSION START: ${now.toLocaleString()}\n\n`;

        if (this.inMemoryLogBuffer.length === 0) {
            this.inMemoryLogBuffer.push(`▶ LOG INIT: ${now.toLocaleString()}\n\n`);
        } else {
            this.inMemoryLogBuffer.push(header);
        }

        // Initialize baseline telemetry entries so STA and AVG filters are populated from game launch
        this.log("Session Telemetry Initialized", "STATS");
        this.log("Session Baseline Averages Initialized", "AVG");

        this.isInitialized = true;

        if (typeof Android !== 'undefined') {
            this._initAndroidSession();
        } else {
            await this._initBrowserSession();
        }

        this._flushPendingLogs();
    }

    _initAndroidSession() {
        try {
            const filesJson = Android.getFiles(this.logPrefix);
            const files = JSON.parse(filesJson);
            if (files.length >= 4) {
                const toDeleteCount = files.length - 3;
                for (let i = 0; i < toDeleteCount; i++) Android.deleteFile(files[i]);
            }
            Android.writeFile(this.currentLogFile, this.inMemoryLogBuffer.join(""), false);
        } catch (e) {}
    }

    async _initBrowserSession() {
        if (!this.db) await this._openBrowserDB();
        if (!this.db) return;

        return new Promise((resolve) => {
            const transaction = this.db.transaction(["logs"], "readwrite");
            const store = transaction.objectStore("logs");
            const getAllRequest = store.getAllKeys();

            getAllRequest.onsuccess = () => {
                const keys = getAllRequest.result.sort();
                if (keys.length >= 4) {
                    const toDeleteCount = keys.length - 3;
                    for (let i = 0; i < toDeleteCount; i++) store.delete(keys[i]);
                }
                store.put({ fileName: this.currentLogFile, content: this.inMemoryLogBuffer.join("") });
                resolve();
            };
            getAllRequest.onerror = () => resolve();
        });
    }

    log(msg, category = "INFO") {
        const rawMsg = (typeof msg === 'object') ? JSON.stringify(msg, null, 2) : String(msg);

        // --- LOG AGGREGATION (Anti-Spam) ---
        if (rawMsg.indexOf('\n') === -1 && rawMsg === this._lastLogContent && category === this._lastLogCategory && this.inMemoryLogBuffer.length > 0) {
            this._repeatCount++;
            const lastIdx = this.inMemoryLogBuffer.length - 1;
            // Robustly identify the content part to avoid corrupting timestamps
            const line = this.inMemoryLogBuffer[lastIdx];
            const timestampEnd = line.indexOf('] [') + 1;
            const categoryEnd = line.indexOf('] ', timestampEnd) + 2;
            const prefix = line.substring(0, categoryEnd);
            const content = line.substring(categoryEnd).replace(/ \d+x$/, "");

            this.inMemoryLogBuffer[lastIdx] = `${prefix}${content} ${this._repeatCount}x`;
            return;
        }

        // When a repeat sequence ends, notify the persistent log
        if (this._repeatCount > 1) {
            const summary = `  └─ ^ Repeated ${this._repeatCount}x total\n`;
            if (typeof Android !== 'undefined' && this.isInitialized) {
                Android.writeFile(this.currentLogFile, summary, true);
            }
        }

        this._lastLogContent = rawMsg;
        this._lastLogCategory = category;
        this._repeatCount = 1;

        const now = new Date();
        const h = String(now.getHours()).padStart(2, '0');
        const m = String(now.getMinutes()).padStart(2, '0');
        const s = String(now.getSeconds()).padStart(2, '0');
        const timestamp = `${h}:${m}:${s}`;

        const catMap = {
            "ERROR": "ERR", "ERRORS": "ERR",
            "STATS": "STA", "STAT": "STA",
            "CLICK": "CLK", "CLICKS": "CLK",
            "TOWERS": "TWR", "TOWER": "TWR",
            "ENEMY": "ENY", "ENEMIES": "ENY",
            "DAMAGE": "DMG",
            "AVG": "AVG", "AVERAGE": "AVG",
            "AI": "AI",
            "INFO": "INF",
            "WARN": "WRN"
        };
        const shortCat = catMap[category.toUpperCase()] || category.toUpperCase().substring(0, 3);
        const prefix = `[${timestamp}] [${shortCat.padEnd(3)}] `;

        let content = '';
        if (typeof msg === 'object') {
            // Flatten strategic logs (STA, AVG, INF) to single lines.
            // Keep ERRORS pretty-printed for diagnostics.
            if (shortCat === 'ERR') {
                content = JSON.stringify(msg, null, 2);
            } else {
                content = JSON.stringify(msg);
            }
        } else {
            content = String(msg);
        }

        const lines = content.split('\n').map(line => prefix + line);

        this.inMemoryLogBuffer.push(...lines);

        // Capping: discard oldest if too many
        // Optimization: purge in larger chunks (20% of max) to avoid constant array splicing
        if (this.inMemoryLogBuffer.length > this.maxLogLines) {
            const purgeAmount = Math.floor(this.maxLogLines * 0.2);
            this.inMemoryLogBuffer.splice(0, purgeAmount);
            this.inMemoryLogBuffer.push(`[SYSTEM] Log overflow: purged oldest ${purgeAmount} lines.\n`);
        }

        const text = lines.join('\n') + "\n";

        if (!this.isInitialized) {
            this._pendingLogs.push(text);
            return;
        }

        // v5.27: batch writes (was one native write / full IndexedDB rewrite per log line, very heavy in crowded waves)
        this._batch = (this._batch || '') + text;
        if (!this._batchTimer) {
            this._batchTimer = setTimeout(() => this._flushBatch(), 500);
            if (!this._batchHooked) {
                this._batchHooked = true;
                const f = () => this._flushBatch();
                try { window.addEventListener('pagehide', f); document.addEventListener('visibilitychange', f); } catch (e) {}
            }
        }
    }

    _flushBatch() {
        if (this._batchTimer) { clearTimeout(this._batchTimer); this._batchTimer = null; }
        const text = this._batch; this._batch = '';
        if (!text) return;
        if (typeof Android !== 'undefined') {
            Android.writeFile(this.currentLogFile, text, true);
        } else {
            this._saveToBrowserStorage();
        }
    }

    _flushPendingLogs() {
        if (this._pendingLogs.length === 0) return;
        const combined = this._pendingLogs.join("");
        this._pendingLogs = [];
        if (typeof Android !== 'undefined') Android.writeFile(this.currentLogFile, combined, true);
        else this._saveToBrowserStorage();
    }

    _saveToBrowserStorage() {
        if (!this.db || !this.currentLogFile) return;
        try {
            const transaction = this.db.transaction(["logs"], "readwrite");
            transaction.objectStore("logs").put({ fileName: this.currentLogFile, content: this.inMemoryLogBuffer.join("\n") });
        } catch (e) {}
    }

    async getLogContent(filter = 'all') {
        const rawLog = this.inMemoryLogBuffer.join("\n");
        if (!rawLog || rawLog.length < 10) return "Log not available yet.";

        if (filter === 'all') return rawLog;

        const catMap = {
            "ERROR": "ERR", "ERRORS": "ERR",
            "STATS": "STA", "STAT": "STA",
            "CLICK": "CLK", "CLICKS": "CLK",
            "TOWERS": "TWR", "TOWER": "TWR",
            "ENEMY": "ENY", "ENEMIES": "ENY",
            "DAMAGE": "DMG",
            "AVG": "AVG", "AVERAGE": "AVG",
            "AI": "AI",
            "INFO": "INF",
            "WARN": "WRN",
            "SYSTEM": ["INF", "WRN"]
        };
        const target = catMap[filter.toUpperCase()] || filter.toUpperCase().substring(0, 3);
        const shorts = Array.isArray(target) ? target : [target];
        const searchTerms = shorts.map(s => `[${s.padEnd(3)}]`);

        const lines = this.inMemoryLogBuffer.filter(line =>
            searchTerms.some(term => line.includes(term))
        );
        return lines.length > 0 ? lines.join('\n') : `No entries found for ${filter.toUpperCase()}`;
    }

    logWeaponStats(round, stats) {
        this.log(`Rnd ${round} Stats Block:`, "STATS");
        this.log(stats, "STATS");
    }
}

window.logManager = new LogManager();
