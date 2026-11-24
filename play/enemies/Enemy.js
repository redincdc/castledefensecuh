// v5.27: crowd-mode sprite cache (render only; no gameplay effect)
const CDC_CROWD_LIMIT = 60;
const _cdcSpriteCache = new Map();
function cdcCrowdSprite(enemy, bodyColor) {
    const scale = Math.max(1, Math.min(3, Math.round((window.devicePixelRatio || 1) * 2) / 2));
    const key = enemy.type + '|' + bodyColor + '|' + Math.round(enemy.size) + '|' + (enemy.splitLevel || 0) + '|' + scale;
    let spr = _cdcSpriteCache.get(key);
    if (spr) return spr;
    if (_cdcSpriteCache.size >= 300) _cdcSpriteCache.clear();
    const side = Math.ceil(enemy.size * 4 * scale);
    if (!(side > 0)) return null;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = side;
    const cctx = canvas.getContext('2d'); if (!cctx) return null;
    cctx.scale(scale, scale); cctx.translate(side / (2 * scale), side / (2 * scale));
    const proxy = Object.create(enemy); proxy.facingAngle = 0; proxy.walkPhase = 0;
    try { enemy.renderBody.call(proxy, cctx, bodyColor); } catch (e) { return null; }
    spr = { canvas, half: side / 2 / scale };
    _cdcSpriteCache.set(key, spr);
    return spr;
}

/**
 * Enemy Base Class
 * Handles shared movement, HP, and status effects for all enemies.
 */
class Enemy {
    constructor(type, path, scene = null) {
        this.id = 'ent_' + Math.random().toString(36).substr(2, 9) + Date.now();
        this.type = type;
        this.path = path;
        this._scene = scene; // Reference to GameScene
        this.isEnemy = true;
        this.pathIndex = 0;
        this.x = (path && path.length > 0) ? path[0].x : 0;
        this.y = (path && path.length > 0) ? path[0].y : 0;
        this.isDead = false;
        this.isAttacking = false;
        this.lastAttackTime = 0;
        this.distanceTraveled = 0;  // total pixels moved (for infinite HP scaling)
        // Compute total path length (for progress ratio)
        this.totalPathLength = 0;
        if (path && path.length > 0) {
            for (let i = 1; i < path.length; i++) {
                this.totalPathLength += dist(path[i-1].x, path[i-1].y, path[i].x, path[i].y);
            }
        }
        this.needsPathUpdate = false;
        this.isBlocked = false; // true when physically unable to move (urgent repath)
        this.facingAngle = Math.PI / 2; // default facing down

        const config = GameConfig.Enemy[ENEMY_CONFIG_KEYS[type] || 'Speedy'];
        this.health = config.health;
        this.maxHealth = config.health;
        this.speed = config.speed;
        this.size = config.size;
        this.color = window.textureManager.getEnemy(type).color;
        this.damage = config.damage;
        this.attackSpeed = config.attackSpeed;
        this.special = config.special;
        this.reward = config.reward || 5;
        this.hitFlashTime = 0;
        this.wingFlap = 0; // animation phase for flyer
        this.walkPhase = 0; // animation phase for walking bob
        this.isDrowning = false;
        this._drowningTileKey = undefined;
        // Slow effect (from frost tower / purple spikes)
        this.slowMult = 1;        // 1 = no slow; 0.5 = 50% speed
        this.slowEndTime = 0;     // gameTime when slow expires

        // Crocodile growth system
        this.isGrowerCroc = false;
        this.isGrowingCroc = false;
        this.crocGrowTimer = 0;
        this.isGiantCroc = false;

        // Splitter enemy
        this.splitLevel = 0;

        // Smooth split-drift animation
        this.splitDriftTime = 0;
        this.splitDriftDuration = 0;
        this.splitDriftStartX = 0;
        this.splitDriftStartY = 0;
        this.splitDriftTargetX = 0;
        this.splitDriftTargetY = 0;

        // Speedy momentum
        this.momentum = this.type === 'speedy' ? 5 : 1;
        this.isBouncing = false;
        this.bounceTimer = 0;
        this.bounceVx = 0;
        this.bounceVy = 0;

        // Stuck Detection (GDD §7)
        this.stuckTimer = 0;
        this.lastX = this.x;
        this.lastY = this.y;

        this.isBoss = false; // GDD §9: Support for mini-bosses in every round
    }

    _repath(gridSystem, raw = false) {
        if (!gridSystem) return;
        // v5.21: raw repath = walk tile center to tile center from the tile we stand on (no corner cutting).
        // Big (scaled-up) enemies used to clip wall corners on the smoothed path, get blocked, repath onto the
        // very same smoothed path and loop forever ("stuck on the wall").
        if (raw) {
            const rp = gridSystem.findPathFrom(this.x, this.y, this._scene.towers, this.special, this._scene.walls, true, true);
            if (rp && rp.length) {
                rp.unshift({ x: this.x, y: this.y });
                this.isBlocked = false; this.needsPathUpdate = false;
                this.path = rp; this.pathIndex = -1; this._rawPathUntil = (this._gtMs || 0) + 4000; // gameTime is in ms
                this.totalPathLength = 0;
                for (let j = 1; j < rp.length; j++) this.totalPathLength += dist(rp[j - 1].x, rp[j - 1].y, rp[j].x, rp[j].y);
                if (window.logManager) window.logManager.log(`${this.type} unstuck (tile path)`, "AI");
                return;
            }
            // no way out from the tile we stand on: walled in. Don't fall back to a pivot path through the wall.
            if (this.special !== 'fly') {
                this.isBlocked = false; this.needsPathUpdate = false;
                if (!this._trapped) { this._trapped = true; this._trapCheckT = -1e9; }
                return;
            }
        }

        // GDD §7: Pivot-Point Selection
        // Only use a future node as a pivot if it's walkable AND has clear line-of-sight.
        // This prevents enemies from "committing" to a path that cuts through a newly placed tower.
        let pivotNode = null;
        if (this.path && this.pathIndex < this.path.length - 1) {
            const nextNode = this.path[this.pathIndex + 1];
            const currentTile = gridSystem.getTileAtPosition(this.x, this.y);
            const nextTile = gridSystem.getTileAtPosition(nextNode.x, nextNode.y);

            if (currentTile && nextTile && gridSystem.isTileWalkable(nextTile, this.special)) {
                pivotNode = nextNode;
            }
        }

        const ts = GameConfig.Grid.tileSize;
        const gridW = GameConfig.Grid.columns * ts;
        const gridH = GameConfig.Grid.rows * ts;

        const startX = Math.max(0, Math.min(gridW, pivotNode ? pivotNode.x : this.x));
        const startY = Math.max(0, Math.min(gridH, pivotNode ? pivotNode.y : this.y));

        const newPath = gridSystem.findPathFrom(startX, startY, this._scene.towers, this.special, this._scene.walls);
        if (newPath) {
            if (window.logManager) window.logManager.log(`${this.type} repathed via pivot [${Math.round(startX)},${Math.round(startY)}]`, "AI");
            // Steering directly from current pixel:
            // We unshift the current position as the first node to ensure a smooth transition
            newPath.unshift({ x: this.x, y: this.y });
            this.updatePath(newPath);
            this._trapped = false; this._trapTarget = null;
        } else {
            if (window.logManager) window.logManager.log(`${this.type} failed to find path from [${Math.round(startX)},${Math.round(startY)}]`, "AI");
            this.needsPathUpdate = false;
            // v5.21: walled in (e.g. a fence finished around/in front of us): break out instead of freezing on the wall
            if (this.special !== 'fly') { this._trapped = true; this._trapCheckT = -1e9; }
        }
    }

    // v5.22: spikes and lilypads mark their tile reserved but enemies walk over them (only castle/portal tiles are off-limits)
    _walkOverTile(gridSystem, tile) {
        const ent = gridSystem.getStructureAtTile(tile);
        return !!(ent && (ent.isSpike || ent.isLilypad || ent.type === 'spike' || ent.type === 'lilypad'));
    }

    // v5.21: first player structure between us and the castle, ignoring structures (water still blocks walkers).
    // Sets this.path to the free tiles up to it and returns the structure to chew through.
    _findTrapTarget(gridSystem) {
        const ts = GameConfig.Grid.tileSize, rows = GameConfig.Grid.rows, cols = GameConfig.Grid.columns;
        const occ = {};
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            const t = gridSystem.tiles[r][c];
            if (t && t.water && this.special !== 'swim' && !gridSystem.isLilypadTile(t)) occ[gridSystem.pathFinder.keyOf(t)] = true;
        }
        const ct = gridSystem.tiles[gridSystem.castleRow] && gridSystem.tiles[gridSystem.castleRow][gridSystem.castleCol];
        if (!ct) return null;
        const endPos = { x: ct.x + ts, y: ct.y + ts };
        gridSystem.pathFinder._raw = true;
        let tiles = null;
        try { tiles = gridSystem.pathFinder.findLowTurnPath({ x: this.x, y: this.y }, endPos, occ, this.special); } finally { gridSystem.pathFinder._raw = false; }
        if (!tiles) return null;
        for (let i = 1; i < tiles.length; i++) {
            if (!tiles[i].occupied) continue;
            const ent = gridSystem.getStructureAtTile(tiles[i]);
            if (!ent || ent.isDestroying) return null;
            const p = [{ x: this.x, y: this.y }].concat(gridSystem.tilesToCoords(tiles.slice(0, i)));
            this.path = p; this.pathIndex = -1; this.totalPathLength = 0;
            for (let j = 1; j < p.length; j++) this.totalPathLength += dist(p[j - 1].x, p[j - 1].y, p[j].x, p[j].y);
            if (window.logManager) window.logManager.log(`${this.type} walled in -> attacking ${ent.type}`, "AI");
            return ent;
        }
        return null;
    }

    // v5.21: returns true while busy chewing (skip normal movement this frame)
    _updateTrapped(deltaTime, gridSystem, gameTime) {
        const tg = this._trapTarget;
        if (!tg || tg.isDestroying || tg.health <= 0 || gameTime - this._trapCheckT >= 1000) {
            this._trapCheckT = gameTime;
            const rp = gridSystem.findPathFrom(this.x, this.y, this._scene.towers, this.special, this._scene.walls, true, true);
            if (rp && rp.length) { // a way out opened up (wall destroyed / sold): go
                this._trapped = false; this._trapTarget = null;
                rp.unshift({ x: this.x, y: this.y });
                this.path = rp; this.pathIndex = -1; this.totalPathLength = 0;
                for (let j = 1; j < rp.length; j++) this.totalPathLength += dist(rp[j - 1].x, rp[j - 1].y, rp[j].x, rp[j].y);
                return false;
            }
            if (!tg || tg.isDestroying || tg.health <= 0) this._trapTarget = this._findTrapTarget(gridSystem);
            if (!this._trapTarget) { this._trapped = false; return false; }
        }
        if (this.pathIndex < this.path.length - 1) return false; // still walking to the wall
        const t = this._trapTarget;
        this.facingAngle = Math.atan2(t.y - this.y, t.x - this.x);
        if (gameTime - (this.lastAttackTime || 0) >= this.attackSpeed) {
            this.lastAttackTime = gameTime;
            if (t.takeDamage) t.takeDamage(this.damage, this);
        }
        return true;
    }

    teleportToPath(gridSystem) {
        if (!gridSystem || !this.path || this.path.length === 0) return;

        let closestNode = null;
        let minDist = Infinity;
        let bestIdx = -1;
        const startIndex = Math.max(0, this.pathIndex);

        // Find nearest path node starting from current index
        for (let i = startIndex; i < this.path.length; i++) {
            const node = this.path[i];
            if (!node || node.x === undefined || node.y === undefined) continue;
            const d = dist(this.x, this.y, node.x, node.y);
            if (d < minDist) {
                minDist = d;
                closestNode = node;
                bestIdx = i;
            }
        }

        if (closestNode) {
            const now = Date.now();
            if (!this._lastStuckWarnTime || (now - this._lastStuckWarnTime) > 5000) {
                GameLogger.warn(`${this.type} got stuck! Searching for safe teleport target.`);
                this._lastStuckWarnTime = now;
            }

            // 1. Search forward from the nearest node for the first walkable node.
            // This prevents teleporting into a newly placed tower that is sitting on the old path.
            // We also skip "reserved" tiles (Castle/Portal) and "occupied" tiles (Structures)
            // to ensure an enemy never teleports INSIDE a building.
            let teleportIdx = bestIdx;
            let foundSafe = false;
            while (teleportIdx < this.path.length) {
                const node = this.path[teleportIdx];
                const tile = gridSystem.getTileAtPosition(node.x, node.y);
                if (tile && gridSystem.isTileWalkable(tile, this.special) && !tile.occupied && !(tile.reserved && !this._walkOverTile(gridSystem, tile))) { // v5.22: spike/lilypad tiles are safe
                    foundSafe = true;
                    break;
                }
                teleportIdx++;
            }

            // 2. If no safe node found forward, try to repath from the portal (desperation fallback)
            if (!foundSafe) {
                const portal = this._scene?.portal;
                if (portal) {
                    this.x = portal.x;
                    this.y = portal.y;
                    this.pathIndex = -1;
                    this._repath(gridSystem);
                    return;
                }
            }

            let targetX = this.path[teleportIdx].x;
            let targetY = this.path[teleportIdx].y;

            // Castle-Safety Guard: Prevent teleporting inside the castle's physical bounds
            const castle = this._scene?.castle;
            if (castle) {
                // Perimeter is radius + large margin (at least 1.5 tiles from center)
                const minDistance = (castle.size / 2) + (this.size / 2) + 40;
                const dToCastle = dist(targetX, targetY, castle.x, castle.y);

                if (dToCastle < minDistance) {
                    // Too close! Push the teleport target back to the edge of the castle's perimeter
                    let angleFromCastle;
                    const dx = targetX - castle.x;
                    const dy = targetY - castle.y;

                    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
                        // If target is exactly at center, push back towards where we came from
                        // If we are also at center, push towards the top of the map (portal direction)
                        const selfDx = this.x - castle.x;
                        const selfDy = this.y - castle.y;
                        if (Math.abs(selfDx) < 1 && Math.abs(selfDy) < 1) angleFromCastle = -Math.PI / 2;
                        else angleFromCastle = Math.atan2(selfDy, selfDx);
                    } else {
                        angleFromCastle = Math.atan2(dy, dx);
                    }
                    targetX = castle.x + Math.cos(angleFromCastle) * minDistance;
                    targetY = castle.y + Math.sin(angleFromCastle) * minDistance;
                }
            }

            this.x = targetX;
            this.y = targetY;
            this.pathIndex = Math.max(0, teleportIdx);
            this._repath(gridSystem);
        } else {
            // Last resort: teleport to spawn
            const spawn = this.path[0];
            if (spawn) {
                this.x = spawn.x;
                this.y = spawn.y;
                this.pathIndex = -1;
                this._repath(gridSystem);
            }
        }
    }

    onSpawn() {
        // Hook for subclasses
    }

    static getAdaptiveMult(baseMult) {
        return baseMult;
    }

    applySlow(mult, duration, gameTime) {
        const endTime = gameTime + duration;
        if (this.slowEndTime <= gameTime || mult < this.slowMult || endTime > this.slowEndTime) {
            this.slowMult = Math.min(this.slowMult, mult);
            this.slowEndTime = Math.max(this.slowEndTime, endTime);
            if (this.slowEndTime <= gameTime) {
                this.slowMult = mult;
                this.slowEndTime = endTime;
            }
        }
    }

    updatePath(newPath) {
        this.isBlocked = false;
        if (!newPath || newPath.length === 0) {
            this.needsPathUpdate = false;
            return;
        }

        // GDD §7: Aggressive Forward-Pruning
        // Discard nodes that are "behind" the unit based on current heading.
        const headingX = Math.cos(this.facingAngle);
        const headingY = Math.sin(this.facingAngle);

        while (newPath.length > 1) {
            const node = newPath[0];
            const dx = node.x - this.x;
            const dy = node.y - this.y;
            const dot = dx * headingX + dy * headingY;
            const distSq = dx * dx + dy * dy;

            // Skip if the node is behind us OR if we are already effectively there (< 8px)
            if (dot < 0 || distSq < 64) {
                newPath.shift();
            } else {
                break;
            }
        }

        this.path = newPath;
        this.pathIndex = -1; // Reset to start fresh on the new path
        this.needsPathUpdate = false;

        // Recalculate path length for progress ratio
        this.totalPathLength = 0;
        for (let j = 1; j < this.path.length; j++) {
            this.totalPathLength += dist(this.path[j - 1].x, this.path[j - 1].y, this.path[j].x, this.path[j].y);
        }
    }

    getTimeToCastle(gridSystem) {
        if (!this.path || this.path.length === 0 || this.speed <= 0) return Infinity;
        if (this.isAttacking) return 0;
        const now = Date.now();
        if (this._lastTimeCheck && now - this._lastTimeCheck < 250 && this._cachedTimeToCastle !== undefined) return this._cachedTimeToCastle;

        let seconds = 0, from = { x: this.x, y: this.y };
        for (let i = this.pathIndex + 1; i < this.path.length; i++) {
            const to = this.path[i];
            let spd = this.speed * (this.slowMult || 1.0);
            if (this.special === 'swim' && gridSystem) {
                const tile = gridSystem.getTileAtPosition((from.x + to.x) / 2, (from.y + to.y) / 2);
                spd *= tile?.water ? 1.8 : 0.6;
            }
            if (spd <= 0) spd = 1;
            seconds += dist(from.x, from.y, to.x, to.y) / spd;
            from = to;
        }
        this._cachedTimeToCastle = seconds * 1000;
        this._lastTimeCheck = now;
        return this._cachedTimeToCastle;
    }

    update(deltaTime, castle, gridSystem, gameTime) {
        if (this.isDead) return;
        this._gtMs = gameTime;

        // GDD §7: Stuck Detection & Teleportation Failsafe
        const prevX = this.x;
        const prevY = this.y;
        const isPaused = this._scene?.gameStateManager?.isPaused;

        // Emergency repath or Grid Update request
        if ((this.isBlocked || this.needsPathUpdate) && gridSystem) {
            this._repath(gridSystem, (this._rawPathUntil || 0) > gameTime);
        }

        if (this.slowEndTime > 0 && gameTime >= this.slowEndTime) {
            this.slowMult = 1; this.slowEndTime = 0;
        }

        const MAX_DROWNING_PER_TILE = 10;
        if (gridSystem && this.special !== 'swim' && this.special !== 'fly') {
            const tile = gridSystem.getTileAtPosition(this.x, this.y);
            const inWater = tile && tile.water && !gridSystem.isLilypadTile(tile);

            if (this.isDrowning) {
                if (!inWater) {
                    this.isDrowning = false;
                    if (this._drowningTileKey !== undefined) {
                        const c = gridSystem.drowningCounts[this._drowningTileKey] || 0;
                        if (c > 0) gridSystem.drowningCounts[this._drowningTileKey] = c - 1;
                        this._drowningTileKey = undefined;
                    }
                } else {
                    this.health -= this.maxHealth * 0.15 * deltaTime;
                    if (this.health <= 0) { this.health = 0; this.isDead = true; }
                    return;
                }
            } else if (inWater) {
                const key = gridSystem.pathFinder.keyOf(tile);
                const count = gridSystem.drowningCounts[key] || 0;
                if (count < MAX_DROWNING_PER_TILE) {
                    this.isDrowning = true; this._drowningTileKey = key;
                    gridSystem.drowningCounts[key] = count + 1;
                    this.health -= this.maxHealth * 0.15 * deltaTime;
                    if (this.health <= 0) { this.health = 0; this.isDead = true; }
                    return;
                }
            }
        }

        let effectiveSpeed = this.speed;
        if (gridSystem && this.special === 'swim') {
            const tile = gridSystem.getTileAtPosition(this.x, this.y);
            let speedMult = (tile && tile.water) ? 1.8 : 0.6;

            // Check for Lilypad interaction
            const Lilypads = gridSystem.Lilypads || [];
            for (let i = 0; i < Lilypads.length; i++) {
                const lp = Lilypads[i];
                if (lp.isBuilt && !lp.isDestroying && gridSystem.getTileAtPosition(lp.x, lp.y) === tile) {
                    // RULE: Level 5 pads allow walking over at normal speed (1.0)
                    // Lower level pads mean swimming under at swim speed (1.8)
                    speedMult = (lp.upgradeLevel >= 5) ? 1.0 : 1.8;
                    break;
                }
            }
            effectiveSpeed = this.speed * speedMult;
        }

        effectiveSpeed *= this.slowMult;

        if (this.isAttacking) {
            if (gameTime - this.lastAttackTime >= this.attackSpeed) {
                castle.takeDamage(this.damage); this.lastAttackTime = gameTime;
            }
            return;
        }

        if (castle) {
            const castleRadiusSq = Math.pow((castle.size || GameConfig.Grid.tileSize) / 2 + this.size / 2 + 4, 2);
            if (distSq(this.x, this.y, castle.x, castle.y) <= castleRadiusSq) {
                this.isAttacking = true;
                this.lastAttackTime = gameTime; // Give initial delay
                this.facingAngle = Math.atan2(castle.y - this.y, castle.x - this.x);

                if (!this._breachRecorded) {
                    if (window.logManager) {
                        window.logManager.log(`➜ BREACH: ${getLogId(this.type)}`, "ENEMY");
                    }
                    if (window.balanceAnalytics) {
                        window.balanceAnalytics.onEnemyBreach(this, castle, gameTime);
                    }
                    this._breachRecorded = true;
                }
                return;
            }
        }

        if (this._trapped && gridSystem && this.special !== 'fly' && this._updateTrapped(deltaTime, gridSystem, gameTime)) {
            this.lastX = this.x; this.lastY = this.y; this.stuckTimer = 0; this._wdT = gameTime; this._wdX = this.x; this._wdY = this.y;
            return;
        }

        // GDD §7: Standard "Target-Following" Movement (Continuous traversal)
        let remainingMove = effectiveSpeed * deltaTime;
        while (remainingMove > 0 && this.pathIndex < this.path.length - 1) {
            const target = this.path[this.pathIndex + 1];
            const dx = target.x - this.x, dy = target.y - this.y;
            const distToNode = Math.sqrt(dx * dx + dy * dy);

            // Update rotation and momentum (No hard snapping)
            if (distToNode > 0.1) {
                const newAngle = Math.atan2(dy, dx);
                if (this.type === 'speedy') {
                    const angleDelta = Math.abs(Math.atan2(Math.sin(newAngle - this.facingAngle), Math.cos(newAngle - this.facingAngle)));
                    if (angleDelta < 0.3) this.momentum = Math.min(5, this.momentum + this.momentum * 1.2 * deltaTime);
                    else this.momentum = Math.max(1, this.momentum * 0.4);
                }
                this.facingAngle = newAngle;
            }

            if (remainingMove >= distToNode) {
                // Reach the node this frame - consume distance and proceed to next
                this.x = target.x;
                this.y = target.y;
                remainingMove -= distToNode;
                this.distanceTraveled += distToNode;
                this.walkPhase += distToNode * 0.15;
                this.pathIndex++;
                this._blockHits = 0;
            } else {
                // Move partially towards the next node
                const ratio = distToNode > 0 ? (remainingMove / distToNode) : 0;
                const nextX = this.x + dx * ratio;
                const nextY = this.y + dy * ratio;

                // GDD §12: Enhanced Blocker Guard (Radius-Aware & Sliding)
                if (gridSystem && this.special !== 'fly' && !window._headless) {
                    // v5.21: cap the collision body below half a tile; enemies grow with HP (up to 2x) and a body
                    // wider than a tile could never fit between walls or past a corner
                    const radius = Math.min((this.size / 2) * 0.65, GameConfig.Grid.tileSize * 0.42);

                    const checkCollision = (cx, cy) => {
                        const pts = [
                            { x: cx, y: cy },
                            { x: cx - radius, y: cy - radius }, { x: cx + radius, y: cy - radius },
                            { x: cx - radius, y: cy + radius }, { x: cx + radius, y: cy + radius }
                        ];
                        for (let i = 0; i < pts.length; i++) {
                            const tile = gridSystem.getTileAtPosition(pts[i].x, pts[i].y);
                            if (tile && !gridSystem.isTileWalkable(tile, this.special)) return true;
                        }
                        return false;
                    };

                    if (checkCollision(nextX, nextY)) {
                        // --- SLIDING NAVIGATION ---
                        // If blocked diagonally, try moving only X or only Y to "slide" around the corner.
                        const canMoveX = !checkCollision(nextX, this.y);
                        const canMoveY = !checkCollision(this.x, nextY);

                        if (canMoveX && !canMoveY) {
                            this.x = nextX;
                            remainingMove = 0;
                            break;
                        } else if (canMoveY && !canMoveX) {
                            this.y = nextY;
                            remainingMove = 0;
                            break;
                        }

                        // Fully blocked: nudge towards the center of the current tile to find an opening
                        const currentTile = gridSystem.getTileAtPosition(this.x, this.y);
                        if (currentTile) {
                            const centerX = currentTile.x + GameConfig.Grid.tileSize / 2;
                            const centerY = currentTile.y + GameConfig.Grid.tileSize / 2;
                            this.x += (centerX - this.x) * 0.1;
                            this.y += (centerY - this.y) * 0.1;
                        }

                        // v5.21: repeated blocks -> switch to the tile-center path instead of the same smoothed one
                        this._blockHits = (this._blockHits || 0) + 1;
                        this._repath(gridSystem, this._blockHits >= 3 || (this._rawPathUntil || 0) > gameTime);
                        if (this._blockHits >= 3) this._blockHits = 0;
                        remainingMove = 0;
                        break;
                    }
                }

                this.x = nextX;
                this.y = nextY;

                // --- HARD MAP PERIMETER RADIUS GUARD ---
                // Account for the enemy's physical body radius (r = size / 2) so half their body NEVER sticks out
                const ts = GameConfig.Grid.tileSize;
                // v5.21: never clamp more than half a tile, or a grown enemy can't reach an edge tile's center and freezes
                const r = Math.min((this.size || 20) / 2, ts / 2 - 1);
                const originX = (gridSystem && gridSystem._origin) ? gridSystem._origin.x : 0;
                const originY = (gridSystem && gridSystem._origin) ? gridSystem._origin.y : 0;

                const minX = originX + r;
                const maxX = originX + (GameConfig.Grid.columns * ts) - r;
                const minY = originY + r;
                const maxY = originY + (GameConfig.Grid.rows * ts) - r;

                this.x = Math.max(minX, Math.min(maxX, this.x));
                this.y = Math.max(minY, Math.min(maxY, this.y));

                this.distanceTraveled += remainingMove;
                this.walkPhase += remainingMove * 0.15;
                remainingMove = 0;
            }
        }

        // GDD §7: Stuck Detection & Teleportation Failsafe
        // Calculate distance moved during this specific update step
        const dMoved = dist(this.x, this.y, prevX, prevY);
        const currentTile = gridSystem?.getTileAtPosition(this.x, this.y);
        const isInsideBlocker = currentTile && !gridSystem.isTileWalkable(currentTile, this.special) && this.special !== 'fly';

        if (!isPaused && !this.isAttacking && !this.isBreaking) {
            // Threshold is very low to account for small movements
            if (dMoved < 0.1 * deltaTime || isInsideBlocker) {
                // If inside a tower, stuck timer increases 3x faster
                this.stuckTimer += isInsideBlocker ? deltaTime * 3 : deltaTime;
                if (this.stuckTimer > 2.0) { // Increased to 2s for simulation stability
                    this.teleportToPath(gridSystem);
                    this.stuckTimer = 0;
                }
            } else {
                this.stuckTimer = 0;
            }
            // v5.21: progress watchdog. Catches oscillation (nudge / repath loops) that the per-frame check misses:
            // if the body hasn't really moved in 2.5 s (game time, ms), take the tile-center path from where it stands.
            const gt = gameTime || 0;
            if (this._wdT === undefined || gt < this._wdT) { this._wdT = gt; this._wdX = this.x; this._wdY = this.y; }
            else if (gt - this._wdT >= 2500) { // ms
                const moved = dist(this.x, this.y, this._wdX, this._wdY);
                if (moved < GameConfig.Grid.tileSize * 0.25 && !this.isDrowning && (this.slowMult === undefined || this.slowMult > 0.05) && gridSystem && this.special !== 'fly') {
                    this._wdStrikes = (this._wdStrikes || 0) + 1;
                    const t = gridSystem.getTileAtPosition(this.x, this.y);
                    if (this._wdStrikes >= 2 && t) { // still stuck: step to our own tile's center (or nearest open neighbour)
                        const ts2 = GameConfig.Grid.tileSize; let best = gridSystem.isTileWalkable(t, this.special) ? t : null;
                        for (let dr = -1; dr <= 1 && !best; dr++) for (let dc = -1; dc <= 1 && !best; dc++) {
                            const nt = gridSystem.tiles[t.row + dr] && gridSystem.tiles[t.row + dr][t.col + dc];
                            if (nt && gridSystem.isTileWalkable(nt, this.special) && !(nt.reserved && !this._walkOverTile(gridSystem, nt))) best = nt;
                        }
                        if (best) { this.x = best.x + ts2 / 2; this.y = best.y + ts2 / 2; }
                        this._wdStrikes = 0;
                    }
                    this._repath(gridSystem, true);
                } else this._wdStrikes = 0;
                this._wdT = gt; this._wdX = this.x; this._wdY = this.y;
            }
        }

        if (this.pathIndex >= this.path.length - 1 && !this.isDead && !this._trapped) {
            this.isAttacking = true;
        }

        this.lastX = this.x;
        this.lastY = this.y;
    }

    takeDamage(damage, source) {
        if (this.isDead) return;

        const towerType = source ? (source.type || (source.owner ? source.owner.type : null)) : 'unknown';
        if (window.balanceAnalytics) {
            window.balanceAnalytics.onEnemyHit(this, towerType, damage, this._scene ? this._scene.gameTime * 1000 : Date.now());
        }

        if (window.logManager && damage > 0.5) {
            window.logManager.log(`${getLogId(this.type)} -${Math.round(damage)} (${getLogId(towerType)})`, "DAMAGE");
        }

        this.health -= damage;
        this.hitFlashTime = Date.now();
        if (this.health <= 0) {
            this.isDead = true;
            const killer = source ? (source.owner || source) : null;
            if (killer && killer.killCount !== undefined) killer.killCount++;

            if (this._scene && (towerType === 'flame' || towerType === 'tesla' || towerType === 'laser')) {
                if (this._scene.addAshEffect) this._scene.addAshEffect(this);
            }

            if (window.logManager) {
                window.logManager.log(`† ${getLogId(this.type)} (${getLogId(towerType)})`, "ENEMY");
            }

            if (window.balanceAnalytics) {
                window.balanceAnalytics.onEnemyDeath(this, damage, towerType, this._scene ? this._scene.gameTime * 1000 : Date.now());
            }
        }
        if (damage > 0 && this._scene?.addDamageNumber) {
            this._scene.addDamageNumber(this.x, this.y - this.size * 0.5, Math.round(damage));
        }
    }

    isUnderLilypad() {
        if (this.type !== 'crocodile') return false;
        const scene = this._scene;
        if (!scene || !scene.Lilypads) return false;
        const tile = scene.gridSystem.getTileAtPosition(this.x, this.y);
        if (!tile) return false;

        for (let i = 0; i < scene.Lilypads.length; i++) {
            const lp = scene.Lilypads[i];
            if (lp.isBuilt && !lp.isDestroying && scene.gridSystem.getTileAtPosition(lp.x, lp.y) === tile) {
                // RULE: If Lilypad is Level 5, Croc walks OVER it (not under)
                if (lp.upgradeLevel >= 5) return false;
                return true;
            }
        }
        return false;
    }

    canSplit() { return this.type === 'splitter' && this.splitLevel < 2; }

    split(scene) {
        if (!this.canSplit()) return;
        const nextLevel = this.splitLevel + 1;
        // GDD §9: Splitter HP Balancing (Reduced from 0.55/0.4 to 0.4/0.3 for fairer scaling)
        const hpMult = nextLevel === 1 ? 0.40 : 0.30;
        const sizeMult = nextLevel === 1 ? 0.75 : 0.55;
        const gridSystem = scene.gridSystem, ts = GameConfig.Grid.tileSize || 64;
        const numChildren = this.isBoss ? 4 : 2;

        for (let i = 0; i < numChildren; i++) {
            const child = Enemy.create(this.type, this.path, scene);
            child.x = this.x;
            child.y = this.y;
            child.splitLevel = nextLevel;
            child.facingAngle = this.facingAngle;
            child.maxHealth = Math.max(1, Math.floor(this.maxHealth * hpMult));
            child.health = child.maxHealth;
            child.size = Math.max(8, Math.floor(this.size * sizeMult));
            child.speed = this.speed * 1.25; // Children are 25% faster than parent (down from 50%)
            child.damage = Math.max(1, Math.floor(this.damage * 0.75));
            child.reward = Math.max(1, Math.floor(this.reward * 0.5));
            child.slowMult = this.slowMult;
            child.slowEndTime = this.slowEndTime;
            child.distanceTraveled = this.distanceTraveled;

            // Strict Horizontal Split: Child 0 goes Left (180°), Child 1 goes Right (0°)
            let angle = (i === 0) ? Math.PI : 0;
            if (numChildren === 4) {
                // 4-way spread for Splitter Boss (Left, Right, Top-Left, Top-Right)
                const bossAngles = [Math.PI, 0, -Math.PI * 0.75, -Math.PI * 0.25];
                angle = bossAngles[i];
            }

            // Raycast outward from parent (x, y) to find max drift point without entering impassable tiles
            // 2.5 tiles separation distance for a wide horizontal pop
            const desiredDist = ts * 2.5;
            const step = ts * 0.05;
            let finalDist = desiredDist;

            if (gridSystem) {
                for (let d = step; d <= desiredDist; d += step) {
                    const px = this.x + Math.cos(angle) * d;
                    const py = this.y + Math.sin(angle) * d;
                    const tile = gridSystem.getTileAtPosition(px, py);

                    if (tile && !gridSystem.isTileWalkable(tile, 'normal')) {
                        finalDist = Math.max(step, d - step);
                        break;
                    }
                }
            }

            child.splitDriftDuration = 0.60; // 600ms smooth ease-out drift across 2.5 tiles
            child.splitDriftTime = 0;
            child.splitDriftTime = 0;
            child.splitDriftStartX = this.x;
            child.splitDriftStartY = this.y;
            child.splitDriftTargetX = this.x + Math.cos(angle) * finalDist;
            child.splitDriftTargetY = this.y + Math.sin(angle) * finalDist;

            // Copy path state
            child.path = this.path;
            child.pathIndex = this.pathIndex;
            child.totalPathLength = this.totalPathLength;

            scene.enemies.push(child);
        }
    }

    render(ctx) {
        this.renderBase(ctx);
        this.renderTop(ctx);
    }

    renderBase(ctx) {
        const isHit = Date.now() - this.hitFlashTime < 100, isSlowed = this.slowMult < 1 && this.slowEndTime > 0, isFlying = this.type === 'flyer';
        const bobAmount = (!isFlying && !this.isAttacking && !this.isDrowning) ? Math.abs(Math.sin(this.walkPhase)) * (this.size * 0.08) : 0, bobY = -bobAmount;

        const img = window.textureManager.getImage('enemies', this.type);
        if (img) {
            ctx.save(); ctx.translate(this.x, this.y + bobY);
            if (['speedy', 'crocodile', 'flyer', 'splitter'].includes(this.type)) ctx.rotate(this.facingAngle);
            if (!isFlying) {
                ctx.save(); ctx.translate(0, bobAmount); ctx.fillStyle = 'rgba(0, 0, 0, 0.18)'; ctx.beginPath();
                ctx.ellipse(0, this.size * 0.45, this.size * 0.4, this.size * 0.12, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
            }
            if (isHit) { ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = 'rgba(255, 0, 0, 0.5)'; ctx.fillRect(-this.size/2, -this.size/2, this.size, this.size); ctx.globalCompositeOperation = 'source-over'; }
            ctx.drawImage(img, -this.size / 2, -this.size / 2, this.size, this.size);
            ctx.restore(); this._renderHealthBarAndAuras(ctx); return;
        }

        // v5.27: crowd mode - with many enemies on screen draw a cached sprite instead of the full vector body
        const sc = window.gameScene;
        if (sc && sc.enemies && sc.enemies.length > CDC_CROWD_LIMIT && !this.isBoss && !this.isDrowning && this.type !== 'crocodile' && this.type !== 'breaker') {
            const col = isHit ? '#ff0000' : this.color;
            let spr = this._spr;
            if (!spr || this._sprC !== col || this._sprS !== this.size || this._sprL !== this.splitLevel) { spr = this._spr = cdcCrowdSprite(this, col); this._sprC = col; this._sprS = this.size; this._sprL = this.splitLevel; }
            if (spr) {
                if (!isFlying) { ctx.fillStyle = 'rgba(0, 0, 0, 0.18)'; ctx.beginPath(); ctx.ellipse(this.x, this.y + this.size * 0.45, this.size * 0.4, this.size * 0.12, 0, 0, Math.PI * 2); ctx.fill(); }
                if (isSlowed) { ctx.fillStyle = 'rgba(140, 215, 255, 0.38)'; ctx.beginPath(); ctx.arc(this.x, this.y + bobY, this.size * 0.8, 0, Math.PI * 2); ctx.fill(); }
                ctx.save(); ctx.translate(this.x, this.y + bobY);
                if (this.type === 'speedy' || isFlying) ctx.rotate(this.facingAngle || 0);
                ctx.drawImage(spr.canvas, -spr.half, -spr.half, spr.half * 2, spr.half * 2);
                ctx.restore(); this._renderHealthBarAndAuras(ctx); return;
            }
        }

        ctx.save(); ctx.translate(this.x, this.y + bobY);
        if (!isFlying) { ctx.fillStyle = 'rgba(0, 0, 0, 0.18)'; ctx.beginPath(); ctx.ellipse(0, this.size * 0.45 - bobY * 0.3, this.size * 0.4, this.size * 0.12, 0, 0, Math.PI * 2); ctx.fill(); }

        if (isSlowed) {
            ctx.fillStyle = 'rgba(140, 215, 255, 0.38)'; ctx.beginPath(); ctx.arc(0, 0, this.size * 0.8, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = 'rgba(220, 248, 255, 0.9)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, this.size * 0.68, 0, Math.PI * 2); ctx.stroke();
            ctx.strokeStyle = 'rgba(220, 248, 255, 0.85)'; ctx.lineWidth = 1; const t = Date.now() / 200;
            for (let i = 0; i < 4; i++) { const a = t + i * Math.PI / 2, r = this.size * 0.6; ctx.beginPath(); ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r); ctx.lineTo(Math.cos(a) * (r + 3), Math.sin(a) * (r + 3)); ctx.stroke(); }
        }

        if (this.isDrowning) {
            ctx.fillStyle = 'rgba(50, 100, 200, 0.3)'; ctx.beginPath(); ctx.arc(0, 0, this.size * 0.7, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = 'rgba(150, 200, 255, 0.6)'; ctx.lineWidth = 1; const t = Date.now() / 300;
            for (let i = 0; i < 3; i++) { const bx = Math.sin(t + i * 2) * this.size * 0.2, by = -((t * 10 + i * 15) % (this.size * 0.5)); ctx.beginPath(); ctx.arc(bx, by, 2 + i, 0, Math.PI * 2); ctx.stroke(); }
        }

        if (this.isBoss) {
            const auraR = this.size * 0.9, pulse = 0.5 + Math.sin(Date.now() / 200) * 0.2;
            const grad = ctx.createRadialGradient(0, 0, this.size * 0.3, 0, 0, auraR);
            grad.addColorStop(0, `rgba(255, 50, 50, ${0.4 * pulse})`); grad.addColorStop(0.5, `rgba(255, 0, 0, ${0.2 * pulse})`); grad.addColorStop(1, 'rgba(255, 0, 0, 0)');
            ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(0, 0, auraR, 0, Math.PI * 2); ctx.fill();
        }

        const bodyColor = isHit ? '#ff0000' : this.color;
        this.renderBody(ctx, bodyColor);

        ctx.restore(); this._renderHealthBarAndAuras(ctx);
    }

    renderBody(ctx, bodyColor) {
        // To be overridden by subclasses
    }

    _renderHealthBarAndAuras(ctx) {
        var scale = GameConfig.scale || 1.0;
        const healthPercent = this.health / this.maxHealth, barW = this.size, barH = (this.isBoss ? 6 : 4) * scale, barY = this.y - this.size / 2 - (this.isBoss ? 12 : 8) * scale;
        if (this.isBoss) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'; ctx.fillRect(this.x - barW / 2 - 1, barY - 1, barW + 2, barH + 2);
            ctx.fillStyle = '#ff0000'; ctx.fillRect(this.x - barW / 2, barY, barW, barH);
            ctx.fillStyle = '#00ff00'; ctx.fillRect(this.x - barW / 2, barY, barW * healthPercent, barH);
            ctx.fillStyle = '#FF4444'; ctx.font = 'bold ' + Math.round(10 * scale) + 'px Arial'; ctx.textAlign = 'center'; ctx.fillText('BOSS', this.x, barY - 4 * scale);
        } else {
            ctx.fillStyle = '#ff0000'; ctx.fillRect(this.x - barW / 2, barY, barW, barH);
            ctx.fillStyle = '#00ff00'; ctx.fillRect(this.x - barW / 2, barY, barW * healthPercent, barH);
        }
        if (this.isGrowingCroc) {
            const growBarW = this.size, growBarH = 3, growBarY = barY - 6, growPercent = Math.min(1, this.crocGrowTimer / 6.0);
            ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'; ctx.fillRect(this.x - growBarW / 2 - 1, growBarY - 1, growBarW + 2, growBarH + 2);
            ctx.fillStyle = '#FF6600'; ctx.fillRect(this.x - growBarW / 2, growBarY, growBarW * growPercent, growBarH);
        }
    }

    static create(type, path, scene) {
        let enemy;
        switch (type) {
            case 'normy': enemy = new Normy(path, scene); break;
            case 'groupie': enemy = new Groupie(path, scene); break;
            case 'speedy': enemy = new Speedy(path, scene); break;
            case 'tank': enemy = new Tank(path, scene); break;
            case 'crocodile': enemy = new Crocodile(path, scene); break;
            case 'flyer': enemy = new Flyer(path, scene); break;
            case 'splitter': enemy = new Splitter(path, scene); break;
            case 'breaker': enemy = new Breaker(path, scene); break;
            default: enemy = new Enemy(type, path, scene); break;
        }
        enemy.onSpawn();
        return enemy;
    }

    renderTop(ctx) {}
}
