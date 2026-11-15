// Core Utilities and Loggers
class GameLogger {
    static info(msg) {
        console.log(`[INFO] ${msg}`);
        if (window.logManager) window.logManager.log(msg, "INFO");
        GameLogger._toVisual('info', msg);
    }
    static warn(msg) {
        console.warn(`[WARN] ${msg}`);
        if (window.logManager) window.logManager.log(msg, "WARN");
        GameLogger._toVisual('warn', msg);
    }
    static error(msg) {
        console.error(`[ERROR] ${msg}`);
        if (window.logManager) {
            window.logManager.log(msg, "ERROR");
        }
        if (typeof Android !== 'undefined' && Android.showToast) {
            Android.showToast("CRASH: " + String(msg).substring(0, 100));
        }
    }

    static native(msg) {
        console.log(`[NATIVE] ${msg}`);
    }

    static enableConsole() {
        // Console UI removed
    }

    static _toVisual(type, msg) {
        // Visual logging removed
    }
}

// --- Global Uncaught Exception & Promise Rejection Interceptors ---
window.onerror = function (msg, url, lineNo, columnNo, error) {
    var fileName = url ? url.substring(url.lastIndexOf('/') + 1) : 'script';
    var errorDetails = "UNCAUGHT ERROR: " + msg + " (" + fileName + ":" + lineNo + ":" + columnNo + ")";
    if (error && error.stack) {
        errorDetails += "\nStack: " + error.stack;
    }
    GameLogger.error(errorDetails);
    return false; // Allow standard console logging as well
};

window.onunhandledrejection = function (event) {
    var reason = event.reason;
    var errorDetails = "UNHANDLED REJECTION: " + (reason && reason.stack ? reason.stack : String(reason));
    GameLogger.error(errorDetails);
};

/**
 * Robust helper to draw rounded rectangles, handling older WebView versions.
 */
function fillSafeRoundRect(ctx, x, y, width, height, radius) {
    if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(x, y, width, height, radius);
        ctx.fill();
    } else {
        // Fallback for older WebViews: draw a regular rectangle
        ctx.fillRect(x, y, width, height);
    }
}

function strokeSafeRoundRect(ctx, x, y, width, height, radius) {
    if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(x, y, width, height, radius);
        ctx.stroke();
    } else {
        ctx.strokeRect(x, y, width, height);
    }
}

// Math Utilities
function dist(x1, y1, x2, y2) { return Math.hypot(x2 - x1, y2 - y1); }
function distSq(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return dx * dx + dy * dy;
}

// Shared Game Constants
const TOWER_CONFIG_KEYS = { machinegun: 'MachineGun', cannon: 'Cannon', sniper: 'Sniper', aa: 'AA', mortar: 'Mortar', tesla: 'Tesla', upgrader: 'Upgrader', frost: 'Frost', laser: 'Laser', flame: 'Flame' };
const POW_2 = [1, 2, 4, 8, 16, 32, 64];
const POW_3 = [1, 3, 9, 27, 81, 243, 729];
const TOWER_DISPLAY_NAMES = {
    machinegun: 'MG', cannon: 'Cannon', sniper: 'Sniper', aa: 'AA',
    mortar: 'Mortar', tesla: 'Tesla', upgrader: 'Upgrader', frost: 'Frost Tower',
    laser: 'Laser Tower', flame: 'Flame Thrower', wall: 'Wall', mirror: 'Mirror',
    spike: 'Spike Trap', lilypad: 'Lilypad'
};
const ENEMY_TYPE_NAMES = { normy: 'Normies', groupie: 'Groupies', speedy: 'Speedies', tank: 'Tanks', crocodile: 'Crocodiles', flyer: 'Flyers', splitter: 'Splitters', breaker: 'Breakers' };
const ENEMY_CONFIG_KEYS = { normy: 'Normy', groupie: 'Groupie', speedy: 'Speedy', tank: 'Tank', crocodile: 'Crocodile', flyer: 'Flyer', splitter: 'Splitter', breaker: 'Breaker' };

const LOG_ID = {
    // Enemies
    normy: 'NMY', groupie: 'GRP', speedy: 'SPD', tank: 'TNK', crocodile: 'CRC', flyer: 'FLY', splitter: 'SPL', breaker: 'BKR',
    // Towers
    machinegun: 'MG', cannon: 'CAN', sniper: 'SNI', aa: 'AA', mortar: 'MOR', tesla: 'TES', upgrader: 'BUF', frost: 'FRS', laser: 'LAS', flame: 'FLM', wall: 'WAL', mirror: 'MIR', spike: 'SPK', lilypad: 'LLY', castle: 'CST'
};

function getLogId(id) {
    if (!id) return '???';
    const clean = String(id).toLowerCase();
    return LOG_ID[clean] || clean.substring(0, 3).toUpperCase();
}

const PROJECTILE_VISUALS = {
    machinegun:  { color: '#333', size: 4 },
    cannon:    { color: '#444', size: 8 },
    sniper:     { color: '#222', size: 3 },
    aa:         { color: '#FFD700', size: 12 },  // larger for rocket visual
    mortar:     { color: '#555', size: 10 },
    frost:      { color: '#87CEEB', size: 6 }
};
const DEFAULT_PROJECTILE = { color: '#333', size: 4 };

// Game Logic Helpers
function getHealthRatio(castle) {
    if (!castle || !castle.maxHealth) return 1;
    return Math.max(0, Math.min(1, castle.health / castle.maxHealth));
}

function getUpgradedFireRate(baseRate, minimumRate, level, maxLevel) {
    if (!minimumRate || minimumRate >= baseRate) return baseRate;
    const progress = Math.min(1, Math.max(0, level / maxLevel));
    return Math.round(baseRate + (minimumRate - baseRate) * progress);
}
