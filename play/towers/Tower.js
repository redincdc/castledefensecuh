/**
 * Tower Base Class
 */
class Tower extends BuildableEntity {
    constructor(type, x, y, startLevel = 0) {
        super();
        this.type = type;
        this.x = x;
        this.y = y;
        this.lastShotTime = 0;
        this.currentTarget = null;
        this.rotation = 0;
        this.killCount = 0;
        this.isTower = true;

        const config = GameConfig.Tower[TOWER_CONFIG_KEYS[type] || 'MachineGun'];
        this.baseDamage = config.damage;
        this.baseRange = config.range;
        this.baseShockDamage = config.shockDamage || 0;
        this.baseFireRate = config.fireRate;
        this.minFireRate = config.minFireRate || 0;
        this.damage = config.damage;
        this.fireRate = config.fireRate;
        this.range = config.range;
        this.projectileSpeed = config.projectileSpeed;
        this.size = config.size;

        const visuals = window.textureManager.getTower(type);
        this.color = visuals.color;
        this.topColor = visuals.topColor;

        this.cost = config.cost;
        this.targets = config.targets;
        this.isMortar = config.isMortar || false;
        this.isAA = config.isAA || false;
        this.minRange = config.minRange || 0;
        this.isTesla = config.isTesla || false;
        this.isUpgrader = config.isUpgrader || false;
        this.isFrost = config.isFrost || false;
        this.isLaser = config.isLaser || false;
        this.isFlame = config.isFlame || false;
        this.rotationSpeed = config.rotationSpeed || 0;
        this.damageMultVsTank = config.damageMultVsTank || 1;
        this.flyerHitChance = config.flyerHitChance || 0;

        this.laserDirection = 0;
        this.flameDirection = 0;
        this.laserPath = [{ x: 0, y: 0 }];
        this.lastRealShotTime = 0;

        this.slowMult = config.slowMult || 0;
        this.slowDuration = config.slowDuration || 0;
        this.slowRadius = config.slowRadius || 0;
        this.baseSlowRadius = config.slowRadius || 0;

        this.upgradeInterval = config.upgradeInterval || 0;
        this.lastUpgradeTime = 0;
        this.splashRadius = config.splashRadius || 0;
        this.baseSplashRadius = config.splashRadius || 0;
        this.shockDamage = config.shockDamage || 0;
        this.shockInterval = config.shockInterval || 0;
        this.lastShockTime = 0;
        this.lastZapTime = -10000;
        this.zappedEnemies = [];
        this.flameArc = config.flameArc || 0;
        this.isFiringFlame = false;

        this.upgradeLevel = 0;
        this.maxUpgrades = 5;
        this.totalInvested = config.cost;
        this.isUpgrading = false;
        this.upgradeProgress = 0;
        this.baseUpgradeTime = this.type === 'aa' ? this.cost * 75 : this.cost * 150;

        this.baseBuildTime = 3000;
        this.baseDestroyTime = Math.max(300, this.cost * 200);

        this.size = this.size || GameConfig.Grid.tileSize || 56;
        this.recalcStats();

        if (startLevel > 0) {
            for (let lvl = 0; lvl < startLevel; lvl++) {
                this.totalInvested += this.isLaser ? Math.round(this.cost * POW_2[Math.min(lvl, 6)] * 0.7) : this.cost * POW_2[Math.min(lvl, 6)];
            }
            this.upgradeLevel = startLevel;
            this.recalcStats();
        }
    }

    get laserAngle() {
        const num = GameConfig.Tower.Laser.numDirections || 4;
        return (this.laserDirection / num) * Math.PI * 2;
    }

    get flameAngle() {
        const num = GameConfig.Tower.Flame.numDirections || 8;
        return (this.flameDirection / num) * Math.PI * 2;
    }

    getUpgradeCost() {
        const c = this.cost * POW_2[Math.min(this.upgradeLevel, 6)];
        return this.isLaser ? Math.round(c * 0.7) : c; // v5.23: laser upgrades 30% cheaper
    }
    getUpgradeTime() {
        const t = this.baseUpgradeTime * POW_2[Math.min(this.upgradeLevel, 6)];
        return this.isLaser ? t * 0.7 : t; // v5.23: laser upgrades 30% faster
    }

    getDps() {
        if (this.isTesla) return (this.shockDamage / (this.shockInterval / 1000)).toFixed(1);
        return (this.damage / (this.fireRate / 1000)).toFixed(1);
    }

    cancelUpgrade() {
        if (!this.isUpgrading) return false;
        this.isUpgrading = false;
        this.upgradeProgress = 0;
        if (window.gameScene) window.gameScene.showTowerPopup(this);
        return true;
    }

    getBoostMultiplier() {
        if (!this.isUpgrader) return 1.0;
        const mults = GameConfig.Tower.Upgrader.multipliers;
        return mults[Math.min(this.upgradeLevel, mults.length - 1)] || 1.1;
    }

    startUpgrade() {
        if (this.upgradeLevel >= this.maxUpgrades || this.isUpgrading || this.isDestroying || !this.isBuilt) return false;
        this.isUpgrading = true;
        this.upgradeProgress = 0;
        this.currentTarget = null;
        return true;
    }

    recalcStats() {
        const ts = GameConfig.Grid.tileSize;
        // Optimization: Cache my own tile coordinates once here
        this.col = Math.floor(this.x / ts);
        this.row = Math.floor(this.y / ts);

        let enhanceMult = 1.0;
        let enhanceCount = 0;
        if (this.enhancedBy) {
            this.enhancedBy.forEach(upgrader => {
                if (upgrader.isBuilt && !upgrader.isDestroying) {
                    enhanceMult *= upgrader.getBoostMultiplier();
                    enhanceCount++;
                }
            });
        }

        const upgradeMult = 1 + 0.5 * this.upgradeLevel;
        this.damage = Math.floor(this.baseDamage * upgradeMult * enhanceMult);

        // --- Strategic Scaling: Non-linear upgrade benefits ---
        if (this.type === 'cannon') {
            // Cannon reload speed (fireRate) boosts at Lvl 3+
            // L3: -15%, L4: -20%, L5: -25% reload time (capped)
            if (this.upgradeLevel >= 3) {
                const speedBoost = 0.15 + (this.upgradeLevel - 3) * 0.05;
                this.fireRate = Math.floor(this.baseFireRate * (1 - speedBoost));
            } else {
                this.fireRate = this.baseFireRate;
            }
        }

        if (this.type === 'machinegun') {
            // MG Anti-Air hit chance scaling: +7% per upgrade level (15% -> 50% max)
            this.flyerHitChance = (GameConfig.Tower.MachineGun.flyerHitChance || 0.15) + (this.upgradeLevel * 0.07);
        }

        // Every tower becomes 20% more durable with each upgrade level
        const oldMax = this.maxHealth || 60;
        this.baseMaxHealth = this.baseMaxHealth || 60;
        const newMaxHealth = Math.floor(this.baseMaxHealth * (1 + 0.20 * this.upgradeLevel));
        const hpDiff = newMaxHealth - oldMax;
        if (hpDiff > 0 && this.health > 0) {
            this.health = Math.min(newMaxHealth, this.health + hpDiff);
        }
        this.maxHealth = newMaxHealth;

        const sixTowers = ['machinegun', 'cannon', 'aa', 'tesla', 'frost', 'flame'];
        if (sixTowers.includes(this.type)) {
            // GDD: 1.5 tiles base + 0.5 tiles per level (snapped to tiles)
            this.range = (1.5 + 0.5 * this.upgradeLevel) * ts;
            this.minRange = 0;
        } else if (this.type === 'sniper') {
            this.range = this.baseRange;
            this.minRange = 128 * (ts / 64); // Fixed dead zone scaled
        } else if (this.type === 'mortar') {
            // GDD: Mortar range is exactly 2.5 tiles. Dead zone is exactly 1.5 tiles.
            this.range = 2.5 * ts;
            this.minRange = 1.5 * ts;
        } else if (this.isLaser) {
            this.range = Infinity;
            this.minRange = 0;
        } else {
            // Fallback for non-combat utility/structures
            this.range = Math.floor(this.baseRange * (1 + 0.15 * this.upgradeLevel));
            this.minRange = 0;
        }

        // Apply Upgrader stack bonus (Tile-based flat addition)
        if (this.range !== Infinity && this.enhancedBy) {
            let flatBonus = 0;
            this.enhancedBy.forEach(upgrader => {
                if (upgrader.isBuilt && !upgrader.isDestroying) {
                    // Bonus starts at +1 tile and increases by 1 per upgrader Range Level.
                    // L0 Upgrader: +1 tile range bonus
                    // L1 Upgrader: +2 tiles, L2: +3 tiles, etc.
                    flatBonus += ((upgrader.rangeLevel || 0) + 1) * ts;
                }
            });
            this.range += flatBonus;
        }

        if (this.isMortar) this.splashRadius = this.baseSplashRadius;
        if (this.isTesla) this.shockDamage = Math.floor(this.baseShockDamage * upgradeMult * enhanceMult);
        if (this.isFrost) {
            this.slowRadius = this.baseSlowRadius;
            this.fireRate = getUpgradedFireRate(this.baseFireRate, this.minFireRate, this.upgradeLevel, this.maxUpgrades);
        }
    }

    completeUpgrade() {
        const spentCost = this.getUpgradeCost();
        this.upgradeLevel++;
        if (window.gameScene) window.gameScene._entitiesDirty = true;
        this.recalcStats();
        this.totalInvested += spentCost;
        this.isUpgrading = false;
        this.upgradeProgress = 0;
        window.gameScene?.updateLaserPaths?.();
        if (this.isLaser) {
            window.gameScene?.soundManager?.playUpgradeComplete(); // v5.19: lightsaber plays once on build only
        } else {
            window.gameScene?.soundManager?.playUpgradeComplete();
        }
    }

    startDestroy() {
        if (!super.startDestroy()) return false;
        this.currentTarget = null;
        window.gameScene?.soundManager?.stopMachineGunSound(this);
        window.gameScene?.soundManager?.stopTeslaZap(this);
        return true;
    }

    stopFiringSound(scene) {
        if (this.type === 'machinegun') scene?.soundManager?.stopMachineGunSound(this);
        if (this.isTesla) scene?.soundManager?.stopTeslaZap(this);
    }

    updateDestroy(deltaTime, castle) {
        if (!this.isDestroying) return false;
        this.destroyProgress += deltaTime * 1000 / this.baseDestroyTime * getHealthRatio(castle);
        return this.destroyProgress >= 1;
    }

    update(enemies, currentTime, scene, castle) {
        if (this.isDestroying) {
            this.stopFiringSound(scene);
            return this.updateBuildDestroy(scene.lastDeltaTime || 0, castle);
        }
        if (this.isUpgrading) {
            this.upgradeProgress += (scene.lastDeltaTime || 0) * 1000 / this.getUpgradeTime() * getHealthRatio(castle);
            if (this.upgradeProgress >= 1) { this.completeUpgrade(); this.lastShotTime = currentTime; }
            else { this.stopFiringSound(scene); return; }
        }
        if (!this.isBuilt) {
            this.buildProgress += (scene.lastDeltaTime || 0) * 1000 / this.baseBuildTime * getHealthRatio(castle);
            if (this.buildProgress >= 1) {
                this.isBuilt = true;
                this.lastShotTime = currentTime;
                if (window.gameScene) window.gameScene._entitiesDirty = true;
                window.gameScene?.soundManager?.playUpgradeComplete();
                if (this.isLaser) this._laserPathDirty = true;
            }
            else { this.stopFiringSound(scene); return; }
        }

        if (this.isTesla) { this.updateTesla(currentTime, enemies, scene); return; }
        if (this.isLaser) { this.updateLaser(currentTime, enemies, scene); return; }
        if (this.isFlame) { this.updateFlame(currentTime, enemies, scene); return; }
        if (this.isUpgrader) { this.updateUpgrader(currentTime, scene); return; }

        this.findTarget(enemies, scene);
        if (this.currentTarget) {
            const dx = this.currentTarget.x - this.x, dy = this.currentTarget.y - this.y, targetAngle = Math.atan2(dy, dx);
            let aimed = true;
            if (this.rotationSpeed > 0) {
                let diff = targetAngle - this.rotation;
                while (diff > Math.PI) diff -= Math.PI * 2;
                while (diff < -Math.PI) diff += Math.PI * 2;
                const maxStep = this.rotationSpeed * (scene.lastDeltaTime || 0);
                if (Math.abs(diff) <= maxStep) {
                    this.rotation = targetAngle;
                    aimed = true;
                } else {
                    this.rotation += Math.sign(diff) * maxStep;
                    // Aim tolerance: allow firing if turret is within ~25 degrees (0.45 rad) of target angle
                    aimed = Math.abs(diff) <= 0.45;
                }
            } else this.rotation = targetAngle;
            const interval = (this.fireRate / this.getPerformanceFactor());
            while (aimed && currentTime - this.lastShotTime >= interval) {
                this.shoot(scene);
                this.lastShotTime += interval;
            }
            if (!aimed) this.stopFiringSound(scene);
        } else this.stopFiringSound(scene);
        return false;
    }

    updateTesla(currentTime, enemies, scene) {
        if (Date.now() - this.lastZapTime >= 120) this.zappedEnemies = [];

        const interval = this.shockInterval;
        while (currentTime - this.lastShockTime >= interval) {
            this.lastShockTime += interval;
            const candidates = scene._getNearbyEnemies ? scene._getNearbyEnemies(this.x, this.y, this.range) : enemies;
            this.zappedEnemies = [];
            const rangeSq = this.range * this.range;
            for (const enemy of candidates) {
                if (!enemy.isDead && distSq(this.x, this.y, enemy.x, enemy.y) <= rangeSq) {
                    enemy.takeDamage(this.shockDamage, this);
                    this.zappedEnemies.push({ x: enemy.x, y: enemy.y });
                }
            }
            if (this.zappedEnemies.length > 0) {
                this.lastZapTime = Date.now();
                if (scene && scene.soundManager) scene.soundManager.playWeaponSound('tesla', this);
            } else scene?.soundManager?.stopTeslaZap(this);
        }
    }

    updateLaser(currentTime, enemies, scene) {
        if (this._laserPathDirty || !this.laserPath) { this._computeLaserPath(scene); this._laserPathDirty = false; }
        if (!this._burstActive(currentTime)) { this.lastShotTime = currentTime; return; } // v5.22 cooldown

        let ticks = 0;
        while (currentTime - this.lastShotTime >= this.fireRate) {
            this.lastShotTime += this.fireRate;
            ticks++;
            if (ticks > 10) { this.lastShotTime = currentTime; break; } // Safety cap for extreme lag
        }
        if (ticks === 0) return;

        const enemyRadius = GameConfig.Grid.tileSize * 0.3;
        let cumulativeDamageMult = 1;
        for (let s = 0; s < this.laserPath.length - 1; s++) {
            if (s > 0 && this.laserPath[s].mirror) cumulativeDamageMult *= (1 - this.laserPath[s].mirror.damageReduction);
            if (cumulativeDamageMult < 0.01) break;
            const p1 = this.laserPath[s], p2 = this.laserPath[s + 1], segDx = p2.x - p1.x, segDy = p2.y - p1.y, segLen = Math.hypot(segDx, segDy);
            if (segLen < 1) continue;
            const ux = segDx / segLen, uy = segDy / segLen, segDamage = this.damage * cumulativeDamageMult * ticks, midX = (p1.x + p2.x) / 2, midY = (p1.y + p2.y) / 2, segHalfLen = segLen / 2 + enemyRadius;
            const candidates = scene._getNearbyEnemies ? scene._getNearbyEnemies(midX, midY, segHalfLen) : enemies;
            for (const enemy of candidates) {
                if (enemy.isDead || enemy.type === 'flyer') continue;
                const ex = enemy.x - p1.x, ey = enemy.y - p1.y, proj = ex * ux + ey * uy;
                if (proj < 0 || proj > segLen) continue;
                if (Math.abs(ex * uy - ey * ux) <= enemy.size / 2 + enemyRadius) enemy.takeDamage(segDamage, this);
            }
        }
        if (scene && scene.soundManager) scene.soundManager.playWeaponSound('laser', this);
    }

    updateFlame(currentTime, enemies, scene) {
        // v5.22: fires in bursts (was always on): ~2.2s of fire, ~1.3s cooldown
        this.isFiringFlame = this._burstActive(currentTime);
        if (!this.isFiringFlame) { this.lastShotTime = currentTime; return; }

        let ticks = 0;
        while (currentTime - this.lastShotTime >= this.fireRate) {
            this.lastShotTime += this.fireRate;
            ticks++;
            if (ticks > 10) { this.lastShotTime = currentTime; break; }
        }
        if (ticks === 0) return;

        const candidates = scene._getNearbyEnemies ? scene._getNearbyEnemies(this.x, this.y, this.range) : enemies;
        const rangeSq = this.range * this.range, arc = this.flameArc;

        for (const enemy of candidates) {
            if (enemy.isDead || enemy.type === 'flyer') continue;
            const dx = enemy.x - this.x, dy = enemy.y - this.y, dSq = dx * dx + dy * dy;
            if (dSq <= rangeSq) {
                const angleToEnemy = Math.atan2(dy, dx);
                let angleDiff = angleToEnemy - this.flameAngle;
                while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
                if (Math.abs(angleDiff) <= arc / 2) {
                    enemy.takeDamage(this.damage * ticks, this);
                }
            }
        }
        if (scene && scene.soundManager) scene.soundManager.playWeaponSound('flame', this);
    }

    // v5.22: always-on weapons (flamethrower, laser) fire in bursts with a short cooldown.
    // Upgrades shorten the cooldown a little (-6% per level). Cycle is game-time based (deterministic).
    // v5.23: laser on-time grows +10% per upgrade level, capped at +50% (3.6s at L5).
    getBurstOnTime() {
        const B = Tower.BURST[this.type];
        if (!B) return 0;
        if (this.isLaser) return B.on * Math.min(1.5, 1 + 0.1 * (this.upgradeLevel || 0));
        return B.on;
    }
    _burstActive(now) {
        const B = Tower.BURST[this.type];
        if (!B) { this.burstCooling = false; return true; }
        if (this._burstT0 === undefined || now < this._burstT0) this._burstT0 = now;
        const on = this.getBurstOnTime();
        const off = B.off * Math.max(0.6, 1 - 0.06 * (this.upgradeLevel || 0)), cyc = on + off, ph = (now - this._burstT0) % cyc;
        this.burstCooling = ph >= on;
        this.burstCharge = this.burstCooling ? (ph - on) / off : 1;
        return !this.burstCooling;
    }

    _computeLaserPath(scene) {
        const ts = GameConfig.Grid.tileSize, step = ts * 0.05, maxLen = 5000, maxBounces = 50;
        const mirrorMap = {}; scene.mirrors.forEach(m => mirrorMap[m.row * 10000 + m.col] = m);

        // Build map of blocking entities (Towers, Walls, Castle, and Upgrading Mirrors)
        const blockingMap = {};
        [...scene.towers, ...scene.walls, ...scene.mirrors].forEach(t => {
            if (t === this) return;
            if (t.isDestroying) return;

            // Block if it's not a mirror, OR if it's a mirror that isn't fully ready (building or upgrading)
            if (!t.isMirror || !t.isBuilt || t.isUpgrading) {
                const tile = scene.gridSystem.getTileAtPosition(t.x, t.y);
                if (tile) blockingMap[tile.row * 10000 + tile.col] = t;
            }
        });
        if (scene.castle) {
            const ts = GameConfig.Grid.tileSize;
            const cRow = scene.gridSystem ? scene.gridSystem.castleRow : undefined;
            const cCol = scene.gridSystem ? scene.gridSystem.castleCol : undefined;

            if (cRow !== undefined && cCol !== undefined && cRow >= 0 && cCol >= 0) {
                // Register all 4 tiles of the 2x2 Castle structure
                for (let r = 0; r < 2; r++) {
                    for (let c = 0; c < 2; c++) {
                        blockingMap[(cRow + r) * 10000 + (cCol + c)] = scene.castle;
                    }
                }
            } else {
                // Fallback: calculate all tile coordinates spanned by 2x2 Castle bounds
                const minCol = Math.floor((scene.castle.x - scene.castle.size / 2) / ts);
                const maxCol = Math.floor((scene.castle.x + scene.castle.size / 2 - 1) / ts);
                const minRow = Math.floor((scene.castle.y - scene.castle.size / 2) / ts);
                const maxRow = Math.floor((scene.castle.y + scene.castle.size / 2 - 1) / ts);

                for (let r = minRow; r <= maxRow; r++) {
                    for (let c = minCol; c <= maxCol; c++) {
                        if (r >= 0 && c >= 0) {
                            blockingMap[r * 10000 + c] = scene.castle;
                        }
                    }
                }
            }
        }

        this.laserPath = [{ x: this.x, y: this.y, mirror: null }];
        let curX = this.x, curY = this.y, curDx = Math.cos(this.laserAngle), curDy = Math.sin(this.laserAngle), lastMirror = null;

        for (let bounce = 0; bounce <= maxBounces; bounce++) {
            let hitMirror = null, hitX = curX, hitY = curY, foundObstacle = false;
            // Scan for objects in the current direction
            for (let d = ts * 0.4; d < maxLen; d += step) {
                const px = curX + curDx * d, py = curY + curDy * d;
                const col = Math.floor(px / ts), row = Math.floor(py / ts);
                if (col < 0 || col >= GameConfig.Grid.columns || row < 0 || row >= GameConfig.Grid.rows) {
                    hitX = px; hitY = py; foundObstacle = true; break;
                }

                const key = row * 10000 + col;
                const mirror = mirrorMap[key];
                // GDD: Active mirrors reflect. Mirrors currently being UPGRADED or BUILT act as solid blocks.
                if (mirror && mirror !== lastMirror && mirror.isBuilt && !mirror.isDestroying && !mirror.isUpgrading) {
                    hitMirror = mirror;
                    hitX = mirror.x; hitY = mirror.y;
                    break;
                }

                if (blockingMap[key]) {
                    const block = blockingMap[key];
                    // Snap to tile EDGE for blocking objects (prevent ghosting)
                    const edge = this._getRayTileIntersection(curX, curY, curDx, curDy, col, row, ts);
                    hitX = edge.x; hitY = edge.y;
                    foundObstacle = true; break;
                }
            }
            if (hitMirror) {
                this.laserPath.push({ x: hitX, y: hitY, mirror: hitMirror });
                const nx = Math.cos(hitMirror.angle + Math.PI / 2), ny = Math.sin(hitMirror.angle + Math.PI / 2);
                const dot = curDx * nx + curDy * ny;
                curDx = curDx - 2 * dot * nx; curDy = curDy - 2 * dot * ny;
                lastMirror = hitMirror; curX = hitMirror.x; curY = hitMirror.y; continue;
            }
            this.laserPath.push({ x: foundObstacle ? hitX : curX + curDx * maxLen, y: foundObstacle ? hitY : curY + curDy * maxLen, mirror: null });
            break;
        }
    }

    _getRayTileIntersection(ox, oy, dx, dy, col, row, ts) {
        const xMin = col * ts, xMax = (col + 1) * ts;
        const yMin = row * ts, yMax = (row + 1) * ts;
        let tMin = -Infinity, tMax = Infinity;
        if (dx !== 0) {
            const t1 = (xMin - ox) / dx, t2 = (xMax - ox) / dx;
            tMin = Math.max(tMin, Math.min(t1, t2)); tMax = Math.min(tMax, Math.max(t1, t2));
        }
        if (dy !== 0) {
            const t1 = (yMin - oy) / dy, t2 = (yMax - oy) / dy;
            tMin = Math.max(tMin, Math.min(t1, t2)); tMax = Math.min(tMax, Math.max(t1, t2));
        }
        // Safety: If ray is exactly on edge, tMin might be NaN or Infinity
        const t = (tMin > 0 && isFinite(tMin)) ? tMin : 0;
        return { x: ox + dx * t, y: oy + dy * t };
    }

    rotate() {
        if (this.isLaser) this.rotateLaser();
        else if (this.isFlame) this.rotateFlame();
        else {
            // General rotation for other towers
            this.rotation = (this.rotation + Math.PI / 4) % (Math.PI * 2);
        }
        GameLogger.info(`${this.type} rotated to angle: ${this.isFlame ? this.flameAngle : (this.isLaser ? this.laserAngle : this.rotation)}`);
    }

    rotateLaser() {
        const num = GameConfig.Tower.Laser.numDirections || 4;
        this.laserDirection = (this.laserDirection + 1) % num;
        this._laserPathDirty = true;
    }

    rotateFlame() {
        const num = GameConfig.Tower.Flame.numDirections || 8;
        this.flameDirection = (this.flameDirection + (this.upgradeLevel >= 5 ? 1 : 2)) % num;
    }

    updateUpgrader(currentTime, scene) {
        if (currentTime - this.lastUpgradeTime < this.upgradeInterval) return;

        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        dirs.forEach(([dr, dc]) => {
            const r = this.row + dr, c = this.col + dc;
            if (r >= 0 && r < GameConfig.Grid.rows && c >= 0 && c < GameConfig.Grid.columns) {
                scene.towers.forEach(t => {
                    if (t !== this && !t.isUpgrader && t.isBuilt && !t.isDestroying && t.row === r && t.col === c) {
                        if (!t.enhancedBy) t.enhancedBy = new Set();
                        if (!t.enhancedBy.has(this)) { t.enhancedBy.add(this); t.recalcStats(); }
                    }
                });
            }
        });
        this.lastUpgradeTime = currentTime;
    }

    findTarget(enemies, scene) {
        let closest = null, minDist = Infinity, rangeSq = this.range * this.range;
        enemies.forEach(e => {
            if (e.isDead || (this.targets === 'fly' && e.type !== 'flyer') || (this.targets === 'ground' && e.type === 'flyer')) return;
            const dSq = distSq(this.x, this.y, e.x, e.y);
            if (dSq >= (this.minRange * this.minRange) && dSq <= rangeSq && dSq < minDist) { minDist = dSq; closest = e; }
        });
        this.currentTarget = closest;
    }

    shoot(scene) {
        if (!this.currentTarget || this.currentTarget.isDead) { this.currentTarget = null; return; }

        // Calculate exact angle to the target at the moment of firing
        const dx = this.currentTarget.x - this.x;
        const dy = this.currentTarget.y - this.y;
        const fireAngle = Math.atan2(dy, dx);

        const proj = new Projectile(this.type, this.x, this.y, this.currentTarget, this.damage, this.projectileSpeed, fireAngle, this.isMortar ? this.splashRadius : undefined, this);
        if (this.isFrost) { proj.isFrost = true; proj.slowMult = this.slowMult; proj.slowDuration = this.slowDuration; proj.slowRadius = this.slowRadius; }
        if (this.isAA) proj.isRocket = true;
        proj.damageMultVsTank = this.damageMultVsTank; proj.flyerHitChance = this.flyerHitChance;
        scene.addProjectile(proj); this.lastRealShotTime = Date.now();
        if (scene.soundManager) scene.soundManager.playWeaponSound(this.type, this, proj);
    }

    render(ctx, time) {
        this.renderBase(ctx);
        this.renderTop(ctx, time);
    }

    renderBase(ctx) {
        const size = this.size || GameConfig.Grid.tileSize || 40;
        const baseImg = (this.type === 'cannon') ? null : window.textureManager.getImage('towers', this.type + '_base');
        ctx.save(); ctx.translate(this.x, this.y);
        if (baseImg) { ctx.drawImage(baseImg, -size / 2, -size / 2, size, size); ctx.restore(); return; }

        const enhanceCount = this.enhancedBy ? this.enhancedBy.size : 0;
        if (enhanceCount > 0) {
            const pulse = 0.4 + Math.sin(Date.now() / 250) * 0.15, glowR = size * 0.7;
            const grad = ctx.createRadialGradient(0, 0, size * 0.3, 0, 0, glowR);
            grad.addColorStop(0, `rgba(255, 215, 0, ${0.4 * pulse * enhanceCount})`); grad.addColorStop(0.6, `rgba(255, 180, 0, ${0.15 * pulse * enhanceCount})`); grad.addColorStop(1, 'rgba(255, 180, 0, 0)');
            ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(0, 0, glowR, 0, Math.PI * 2); ctx.fill();
        }
        if (this.upgradeLevel > 0 && this.isBuilt) {
            const t = Date.now() / 1000, lvl = this.upgradeLevel;
            const auraColors = [{ r: 0, g: 220, b: 255 }, { r: 255, g: 80, b: 220 }, { r: 255, g: 200, b: 60 }, { r: 220, g: 20, b: 60 }, { r: 255, g: 245, b: 200 }];
            const c = auraColors[Math.min(lvl - 1, 4)], pulse = 0.5 + Math.sin(t * 3) * 0.2, auraR = size * (0.65 + lvl * 0.08);
            const grad = ctx.createRadialGradient(0, 0, size * 0.35, 0, 0, auraR);
            grad.addColorStop(0, `rgba(${c.r}, ${c.g}, ${c.b}, ${0.35 * pulse})`); grad.addColorStop(1, `rgba(${c.r}, ${c.g}, ${c.b}, 0)`);
            ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(0, 0, auraR, 0, Math.PI * 2); ctx.fill();
        }

        if (this.type === 'machinegun' || this.type === 'cannon' || this.type === 'mortar' || this.type === 'tesla' || this.type === 'aa' || this.type === 'sniper' || this.type === 'frost' || this.type === 'flame' || this.type === 'upgrader' || this.type === 'laser') {
            const s = size;
            const lvl = this.upgradeLevel;

            // Base shadow
            ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
            ctx.fillRect(-s/2 + 3, -s/2 + 3, s, s);

            // Main body
            ctx.fillStyle = this.color;
            ctx.fillRect(-s/2, -s/2, s, s);

            // Level-based detail: Plates and Grooves
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
            ctx.lineWidth = 1;
            if (lvl >= 1) {
                ctx.strokeRect(-s/2 + 4, -s/2 + 4, s - 8, s - 8);
            }
            if (lvl >= 2) {
                // Bolts in 4 corners (Mathematically Symmetric)
                ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
                const boltS = Math.max(3, Math.round(s * 0.08));
                const margin = 6;
                const left = -s / 2 + margin;
                const right = s / 2 - margin - boltS;
                const top = -s / 2 + margin;
                const bottom = s / 2 - margin - boltS;

                ctx.fillRect(left, top, boltS, boltS);       // Top-Left
                ctx.fillRect(right, top, boltS, boltS);      // Top-Right
                ctx.fillRect(left, bottom, boltS, boltS);    // Bottom-Left
                ctx.fillRect(right, bottom, boltS, boltS);   // Bottom-Right
            }
            if (lvl >= 3) {
                // Side vents or grilles (Symmetrical 4 vents)
                ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
                const ventS = 4;
                const yPositions = [-12, -4, 4, 12];
                for (let i = 0; i < yPositions.length; i++) {
                    const vy = yPositions[i];
                    ctx.fillRect(-s / 2 + 3, vy - ventS / 2, ventS, ventS);
                    ctx.fillRect(s / 2 - 3 - ventS, vy - ventS / 2, ventS, ventS);
                }
            }
            if (lvl >= 4) {
                // Cross-bracing or structural supports
                ctx.beginPath();
                ctx.moveTo(-s/2 + 8, 0); ctx.lineTo(s/2 - 8, 0);
                ctx.moveTo(0, -s/2 + 8); ctx.lineTo(0, s/2 - 8);
                ctx.stroke();
            }
            if (lvl >= 5) {
                // Glowing core
                const pulse = 0.5 + Math.sin(Date.now() / 300) * 0.3;
                let coreRgba = 'rgba(0, 255, 255,'; // Cyan (MG)
                if (this.type === 'cannon') coreRgba = 'rgba(255, 100, 0,'; // Orange (Cannon)
                if (this.type === 'mortar') coreRgba = 'rgba(200, 255, 50,'; // Lime (Mortar)
                if (this.type === 'tesla') coreRgba = 'rgba(180, 100, 255,'; // Purple (Tesla)
                if (this.type === 'aa') coreRgba = 'rgba(255, 215, 0,'; // Yellow (AA)
                if (this.type === 'sniper') coreRgba = 'rgba(100, 255, 100,'; // Bright Green (Sniper)
                if (this.type === 'frost') coreRgba = 'rgba(150, 220, 255,'; // Ice Blue (Frost)
                if (this.type === 'flame') coreRgba = 'rgba(255, 80, 0,'; // Red-Orange (Flame)
                if (this.type === 'upgrader') coreRgba = 'rgba(255, 215, 0,'; // Gold (Upgrader)
                if (this.type === 'laser') {
                    // Core matches laser color
                    if (lvl <= 1) coreRgba = 'rgba(255, 0, 0,';
                    else if (lvl <= 3) coreRgba = 'rgba(0, 255, 0,';
                    else coreRgba = 'rgba(0, 0, 255,';
                }

                ctx.fillStyle = `${coreRgba} ${0.4 * pulse})`;
                ctx.beginPath();
                ctx.arc(0, 0, s * 0.15, 0, Math.PI * 2);
                ctx.fill();
            }

            // Bevel highlights
            ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
            ctx.fillRect(-s/2, -s/2, s, s * 0.15);
            ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
            ctx.fillRect(-s/2, s/2 - s * 0.15, s, s * 0.15);
        } else {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.2)'; ctx.fillRect(-size / 2 + 3, -size / 2 + 3, size, size);
            ctx.fillStyle = this.color || '#888'; ctx.fillRect(-size / 2, -size / 2, size, size);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.15)'; ctx.fillRect(-size / 2, -size / 2, size, size * 0.15);
            ctx.fillStyle = 'rgba(0, 0, 0, 0.15)'; ctx.fillRect(-size / 2, size * 0.35, size, size * 0.15);
        }

        ctx.restore();
    }

    renderTop(ctx, time) {
        const size = this.size || GameConfig.Grid.tileSize || 40;
        const topImg = (this.type === 'cannon') ? null : window.textureManager.getImage('towers', this.type + '_top');
        ctx.save(); ctx.translate(this.x, this.y);

        // GDD: Flame and Laser have manual directions
        const finalRotation = this.isFlame ? this.flameAngle : (this.isLaser ? this.laserAngle : this.rotation);
        ctx.rotate(finalRotation);

        if (topImg) { ctx.drawImage(topImg, -size / 2, -size / 2, size, size); ctx.restore(); return; }

        ctx.fillStyle = this.topColor || '#666';
        const numBarrels = Math.min(this.upgradeLevel + 1, 4);
        if (this.type === 'sniper') {
            const lvl = this.upgradeLevel;
            const topSize = size * 0.35;

            // Precision Turret Housing
            ctx.fillStyle = this.topColor;
            ctx.fillRect(-topSize / 2, -topSize / 2, topSize, topSize);

            // Housing details
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
            ctx.lineWidth = 1;
            ctx.strokeRect(-topSize / 2 + 2, -topSize / 2 + 2, topSize - 4, topSize - 4);

            if (lvl >= 2) {
                // Stabilization pads on corners
                ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
                const ps = topSize * 0.12;
                ctx.fillRect(-topSize/2, -topSize/2, ps, ps);
                ctx.fillRect(topSize/2 - ps, -topSize/2, ps, ps);
                ctx.fillRect(-topSize/2, topSize/2 - ps, ps, ps);
                ctx.fillRect(topSize/2 - ps, topSize/2 - ps, ps, ps);
            }

            if (lvl >= 3) {
                // Large optical scope on top
                ctx.fillStyle = '#222';
                ctx.fillRect(-topSize / 4, -topSize / 2 - 4, topSize / 2, 6);
                ctx.fillStyle = '#0066ff'; // Blue lens reflect
                ctx.fillRect(topSize / 8, -topSize / 2 - 2, 2, 2);
            }

            if (lvl >= 5) {
                // Advanced rangefinder/laser housing
                ctx.fillStyle = '#111';
                ctx.fillRect(-topSize / 2 - 4, -2, 6, 4);
                ctx.fillStyle = '#FF0000'; // Active laser sight diode
                ctx.beginPath();
                ctx.arc(-topSize / 2 - 2, 0, 1.5, 0, Math.PI * 2);
                ctx.fill();
            }

            // Barrels
            ctx.fillStyle = '#111';
            const barrelLen = size * 0.7;
            const barrelW = size * 0.10;
            const spacing = barrelW * 1.4;

            for (let i = 0; i < numBarrels; i++) {
                const offset = (i - (numBarrels - 1) / 2) * spacing;

                // Barrel shaft
                ctx.fillRect(0, offset - barrelW / 2, barrelLen, barrelW);

                // Barrel details (ribbing/cooling)
                if (lvl >= 1) {
                    ctx.fillStyle = 'rgba(255,255,255,0.08)';
                    for(let j=0; j<3; j++) {
                        ctx.fillRect(barrelLen * (0.2 + j * 0.2), offset - barrelW/2, 2, barrelW);
                    }
                    ctx.fillStyle = '#111';
                }

                // Precision muzzle brake
                ctx.fillStyle = '#333';
                ctx.fillRect(barrelLen - 6, offset - barrelW / 2 - 2, 8, barrelW + 4);

                // Muzzle brake holes
                ctx.fillStyle = '#000';
                ctx.fillRect(barrelLen - 4, offset - barrelW / 2 - 1, 2, 1);
                ctx.fillRect(barrelLen - 4, offset + barrelW / 2, 2, 1);
                ctx.fillStyle = '#111';
            }

            // High-intensity laser pointer (Red dot at tip)
            const flash = 0.6 + Math.sin(Date.now() / 150) * 0.4;
            ctx.fillStyle = `rgba(255, 0, 0, ${flash})`;
            ctx.shadowColor = '#FF0000';
            ctx.shadowBlur = 6;
            ctx.beginPath();
            ctx.arc(barrelLen + 2, 0, 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
        } else if (this.type === 'aa') {
            const lvl = this.upgradeLevel;
            const topSize = size * 0.42;

            // SAM Pod Housing
            ctx.fillStyle = this.topColor;
            ctx.fillRect(-topSize / 2, -topSize / 2, topSize, topSize);

            // Pod detail
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
            ctx.lineWidth = 1;
            ctx.strokeRect(-topSize / 2 + 2, -topSize / 2 + 2, topSize - 4, topSize - 4);

            if (lvl >= 2) {
                // Tracking radar dish (static part)
                ctx.fillStyle = '#444';
                ctx.fillRect(-topSize / 2 - 4, -topSize / 4, 6, topSize / 2);
            }

            if (lvl >= 4) {
                // Secondary targeting optics
                ctx.fillStyle = '#111';
                ctx.fillRect(topSize / 2 - 2, -topSize / 4, 5, topSize / 2);
                ctx.fillStyle = '#FF0000';
                ctx.beginPath();
                ctx.arc(topSize / 2 + 1, -topSize / 8, 2, 0, Math.PI * 2);
                ctx.fill();
            }

            if (lvl >= 5) {
                // Active scanning radar dish (animated)
                const rot = (Date.now() / 500) % (Math.PI * 2);
                ctx.save();
                ctx.translate(0, -topSize / 2 - 2);
                ctx.rotate(rot);
                ctx.fillStyle = '#222';
                ctx.fillRect(-4, -1, 8, 2);
                ctx.fillRect(-1, -4, 2, 8);
                ctx.restore();
            }

            // Launch Tubes / Missile Tips
            ctx.fillStyle = '#111';
            const bLen = size * 0.40;
            const bW = size * 0.08;

            if (lvl < 2) {
                // Traditional Flak Barrels
                const aaNum = 2 + lvl;
                const spacing = bW * 1.4;
                for (let i = 0; i < aaNum; i++) {
                    const offset = (i - (aaNum - 1) / 2) * spacing;
                    ctx.fillRect(0, offset - bW / 2, bLen, bW);

                    // Muzzle detail
                    ctx.fillStyle = 'rgba(255,255,255,0.1)';
                    ctx.fillRect(bLen - 2, offset - bW / 2, 2, bW);
                    ctx.fillStyle = '#111';
                }
            } else {
                // Missile Pod Configuration
                const missileNum = Math.min(3 + lvl, 6);
                const col = 2;
                const row = Math.ceil(missileNum / col);
                const mw = bW * 1.2;
                const mSpace = mw * 1.2;

                ctx.save();
                ctx.translate(2, 0); // Recess missiles into pod
                for (let i = 0; i < missileNum; i++) {
                    const r = Math.floor(i / col);
                    const c = i % col;
                    const mx = c * mSpace;
                    const my = (r - (row - 1) / 2) * mSpace;

                    // Launch tube opening
                    ctx.fillStyle = '#000';
                    ctx.beginPath();
                    ctx.arc(mx, my, mw/2, 0, Math.PI * 2);
                    ctx.fill();

                    // Missile tip (Glowing yellow/gold)
                    const pulse = 0.7 + Math.sin(Date.now() / 200 + i) * 0.3;
                    ctx.fillStyle = `rgba(255, 215, 0, ${pulse})`;
                    ctx.beginPath();
                    ctx.arc(mx, my, mw/3, 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.restore();
            }

            // Central pivot cap
            ctx.fillStyle = this.topColor || '#666';
            ctx.beginPath();
            ctx.arc(0, 0, size * 0.15, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.2)';
            ctx.lineWidth = 1;
            ctx.stroke();
        } else if (this.type === 'mortar') {
            const lvl = this.upgradeLevel;
            const topSize = size * 0.45;

            // Mortar Housing
            ctx.fillStyle = this.topColor;
            ctx.fillRect(-topSize / 2, -topSize / 2, topSize, topSize);

            // Housing detail
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
            ctx.lineWidth = 1;
            ctx.strokeRect(-topSize / 2 + 2, -topSize / 2 + 2, topSize - 4, topSize - 4);

            if (lvl >= 2) {
                // Reinforcement pillars at corners
                ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
                const ps = topSize * 0.15;
                ctx.fillRect(-topSize/2, -topSize/2, ps, ps);
                ctx.fillRect(topSize/2 - ps, -topSize/2, ps, ps);
                ctx.fillRect(-topSize/2, topSize/2 - ps, ps, ps);
                ctx.fillRect(topSize/2 - ps, topSize/2 - ps, ps, ps);
            }

            if (lvl >= 3) {
                // Side pistons/hydraulics (Symmetric)
                ctx.fillStyle = '#444';
                ctx.fillRect(-topSize/2 - 3, -topSize/4, 6, topSize/2);
                ctx.fillRect(topSize/2 - 3, -topSize/4, 6, topSize/2);
            }

            if (lvl >= 5) {
                // Target acquisition sensor on top (Centered)
                ctx.fillStyle = '#222';
                const sensorW = topSize * 0.3;
                ctx.fillRect(-sensorW / 2, -topSize/2 - 3, sensorW, 5);
                ctx.fillStyle = '#FFFF00'; // Yellow caution light
                ctx.fillRect(-sensorW / 4, -topSize/2 - 1, sensorW / 2, 2);
            }

            // Launch Tube
            ctx.fillStyle = '#111';
            if (lvl < 2) {
                // Directional barrel (low level)
                const barrelLen = size * 0.35;
                const barrelW = size * (lvl === 0 ? 0.22 : 0.32);
                ctx.fillRect(0, -barrelW / 2, barrelLen, barrelW);

                // Muzzle detail
                ctx.strokeStyle = 'rgba(255,255,255,0.1)';
                ctx.strokeRect(barrelLen - 4, -barrelW / 2, 4, barrelW);

                ctx.beginPath();
                ctx.arc(barrelLen, 0, barrelW * 0.5, 0, Math.PI * 2);
                ctx.fill();
            } else {
                // Vertical Heavy Pit (high level)
                const holeR = size * (0.16 + (lvl - 2) * 0.04);

                // Inner launch glow if recently fired
                const timeSinceShot = Date.now() - (this.lastRealShotTime || 0);
                if (timeSinceShot < 300) {
                    const alpha = 1 - timeSinceShot / 300;
                    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, holeR);
                    grad.addColorStop(0, `rgba(255, 100, 0, ${alpha * 0.8})`);
                    grad.addColorStop(1, 'rgba(255, 100, 0, 0)');
                    ctx.fillStyle = grad;
                    ctx.beginPath(); ctx.arc(0, 0, holeR, 0, Math.PI * 2); ctx.fill();
                    ctx.fillStyle = '#111'; // Reset
                }

                ctx.beginPath();
                ctx.arc(0, 0, holeR, 0, Math.PI * 2);
                ctx.fill();

                // Reinforcement ring around the hole
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(0, 0, holeR + 2, 0, Math.PI * 2);
                ctx.stroke();
            }
        } else if (this.type === 'tesla') {
            const lvl = this.upgradeLevel;
            const topSize = size * 0.40;

            // Tesla Housing
            ctx.fillStyle = this.topColor;
            ctx.fillRect(-topSize / 2, -topSize / 2, topSize, topSize);

            // Technical detail
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
            ctx.lineWidth = 1;
            ctx.strokeRect(-topSize / 2 + 2, -topSize / 2 + 2, topSize - 4, topSize - 4);

            if (lvl >= 2) {
                // Insulator discs at the base
                ctx.fillStyle = '#222';
                ctx.fillRect(-topSize / 2 - 2, topSize / 2 - 4, topSize + 4, 3);
                ctx.fillRect(-topSize / 2 - 1, topSize / 2 - 8, topSize + 2, 2);
            }

            if (lvl >= 3) {
                // Power banks / Capacitors on sides (Symmetric)
                ctx.fillStyle = '#333';
                ctx.fillRect(-topSize / 2 - 3, -topSize / 4, 6, topSize / 2);
                ctx.fillRect(topSize / 2 - 3, -topSize / 4, 6, topSize / 2);
                ctx.fillStyle = this.topColor; // Charging indicator
                ctx.fillRect(-topSize / 2 - 2, -topSize / 6, 2, topSize / 3);
            }

            if (lvl >= 5) {
                // Antenna array / Satellite link on top
                ctx.fillStyle = '#111';
                ctx.fillRect(-2, -topSize / 2 - 8, 4, 8);
                ctx.fillStyle = '#00FFFF';
                ctx.beginPath();
                ctx.arc(0, -topSize / 2 - 8, 2.5, 0, Math.PI * 2);
                ctx.fill();
            }

            // Magnetic Induction Rings
            ctx.strokeStyle = this.topColor || '#666';
            const numRings = 3 + lvl;
            for (let i = 0; i < numRings; i++) {
                const r = size * (0.12 + i * 0.055);
                const pulse = 0.5 + Math.sin(Date.now() / 150 + i) * 0.3;
                ctx.lineWidth = (lvl >= 4 ? 2.5 : 1.5);
                ctx.globalAlpha = 0.4 + pulse * 0.6;
                ctx.beginPath();
                ctx.arc(0, 0, r, 0, Math.PI * 2);
                ctx.stroke();
            }
            ctx.globalAlpha = 1;

            // Central Electrode / Core
            const corePulse = 0.5 + Math.sin(Date.now() / 100) * 0.5;
            const coreR = size * 0.08;
            const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, coreR);
            grad.addColorStop(0, '#FFFFFF');
            grad.addColorStop(1, this.topColor);

            ctx.fillStyle = grad;
            ctx.shadowColor = this.topColor;
            ctx.shadowBlur = (this.zappedEnemies && this.zappedEnemies.length > 0) ? 15 : 5 * corePulse;
            ctx.beginPath();
            ctx.arc(0, 0, coreR, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
        } else if (this.type === 'upgrader') {
            const lvl = this.upgradeLevel;
            const topSize = size * 0.45;

            // Technical Hub Housing
            ctx.fillStyle = this.topColor;
            ctx.fillRect(-topSize / 2, -topSize / 2, topSize, topSize);

            // Detail lines
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
            ctx.lineWidth = 1;
            ctx.strokeRect(-topSize / 2 + 2, -topSize / 2 + 2, topSize - 4, topSize - 4);

            if (lvl >= 3) {
                // Transmission dishes / Antennas at corners (Symmetric)
                ctx.fillStyle = '#444';
                const dishS = topSize * 0.15;
                const halfD = dishS / 2;
                ctx.fillRect(-topSize/2 - halfD, -topSize/2 - halfD, dishS, dishS);
                ctx.fillRect(topSize/2 - halfD, -topSize/2 - halfD, dishS, dishS);
                ctx.fillRect(-topSize/2 - halfD, topSize/2 - halfD, dishS, dishS);
                ctx.fillRect(topSize/2 - halfD, topSize/2 - halfD, dishS, dishS);
            }

            if (lvl >= 5) {
                // Satellite Array on top
                ctx.fillStyle = '#222';
                ctx.fillRect(-topSize/2, -topSize/2 - 4, topSize, 4);
                ctx.fillStyle = '#FFD700'; // Signal active light
                ctx.beginPath();
                ctx.arc(0, -topSize/2 - 4, 3, 0, Math.PI * 2);
                ctx.fill();
            }

            // --- Buff Energy Sphere (Central) ---
            const pulse = 0.5 + Math.sin(Date.now() / 250) * 0.3;
            const sphereR = size * 0.22;
            const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, sphereR);
            grad.addColorStop(0, '#FFF5CC');
            grad.addColorStop(0.7, '#FFD700');
            grad.addColorStop(1, 'rgba(255, 215, 0, 0)');

            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(0, 0, sphereR, 0, Math.PI * 2);
            ctx.fill();

            // --- The PLUS Symbol ---
            ctx.save();
            ctx.rotate(-finalRotation); // Keep symbols upright even if base rotates
            ctx.fillStyle = '#FFFFFF';
            const pw = size * 0.25;
            const pt = size * 0.07;
            ctx.fillRect(-pw/2, -pt/2, pw, pt);
            ctx.fillRect(-pt/2, -pw/2, pt, pw);
            ctx.restore();

            // --- The UP CURVING ARROW ---
            ctx.save();
            ctx.rotate(-finalRotation); // Keep upright
            ctx.strokeStyle = '#FF8C00';
            ctx.lineWidth = 3;
            ctx.lineCap = 'round';
            ctx.beginPath();
            // Start at bottom right, curve up to top center
            ctx.moveTo(size * 0.15, size * 0.2);
            ctx.quadraticCurveTo(size * 0.25, 0, 0, -size * 0.25);
            ctx.stroke();

            // Arrow Head
            ctx.fillStyle = '#FF8C00';
            ctx.beginPath();
            ctx.moveTo(0, -size * 0.25);
            ctx.lineTo(-size * 0.08, -size * 0.15);
            ctx.lineTo(size * 0.08, -size * 0.15);
            ctx.closePath();
            ctx.fill();
            ctx.restore();

            // Level-based energy waves (Lvl 2+)
            if (lvl >= 2) {
                const waveT = (Date.now() / 800) % 1;
                ctx.strokeStyle = `rgba(255, 215, 0, ${1 - waveT})`;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(0, 0, sphereR + waveT * (size * 0.15), 0, Math.PI * 2);
                ctx.stroke();
            }
        } else if (this.type === 'frost') {
            const lvl = this.upgradeLevel;
            const topSize = size * 0.42;

            // Cryo Housing
            ctx.fillStyle = this.topColor;
            ctx.fillRect(-topSize / 2, -topSize / 2, topSize, topSize);

            // Technical detail
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
            ctx.lineWidth = 1;
            ctx.strokeRect(-topSize / 2 + 2, -topSize / 2 + 2, topSize - 4, topSize - 4);

            if (lvl >= 3) {
                // Coolant tanks on sides (Symmetric)
                ctx.fillStyle = '#2E86C1';
                ctx.fillRect(-topSize/2 - 3, -topSize/3, 6, topSize/1.5);
                ctx.fillRect(topSize/2 - 3, -topSize/3, 6, topSize/1.5);
                // Frost on tanks
                ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
                ctx.fillRect(-topSize/2 - 2, -topSize/3, 2, topSize/1.5);
            }

            if (lvl >= 5) {
                // Atmospheric moisture condenser on top
                ctx.fillStyle = '#5D6D7E';
                ctx.fillRect(-topSize/4, -topSize/2 - 3, topSize/2, 6);
                ctx.fillStyle = '#00FFFF'; // Blue LED
                ctx.fillRect(0, -topSize/2 - 1, 2, 2);
            }

            // Central Crystal Emitter
            const cs = size * 0.22;
            const crystalPulse = 0.7 + Math.sin(Date.now() / 400) * 0.3;

            ctx.save();
            // Outer Crystal
            ctx.fillStyle = '#D6EAF8';
            ctx.strokeStyle = '#AED6F1';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(0, -cs);
            ctx.lineTo(cs * 0.6, 0);
            ctx.lineTo(0, cs);
            ctx.lineTo(-cs * 0.6, 0);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            // Inner Pulsing Core
            if (lvl >= 1) {
                const innerCs = cs * (0.4 + lvl * 0.1);
                ctx.fillStyle = `rgba(255, 255, 255, ${0.5 * crystalPulse})`;
                ctx.beginPath();
                ctx.moveTo(0, -innerCs);
                ctx.lineTo(innerCs * 0.6, 0);
                ctx.lineTo(0, innerCs);
                ctx.lineTo(-innerCs * 0.6, 0);
                ctx.closePath();
                ctx.fill();
            }

            // Glow
            ctx.shadowColor = '#00FFFF';
            ctx.shadowBlur = 10 * crystalPulse;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.stroke();
            ctx.restore();

            // Floating ice particles (Lvl 4+)
            if (lvl >= 4) {
                const t = Date.now() / 1000;
                ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
                for (let i = 0; i < 4; i++) {
                    const angle = t + (i * Math.PI / 2);
                    const r = cs * 1.3;
                    ctx.fillRect(Math.cos(angle) * r - 1.5, Math.sin(angle) * r - 1.5, 3, 3);
                }
            }
        } else if (this.type === 'laser') {
            const lvl = this.upgradeLevel;
            const topSize = size * 0.40;
            const laserColors = ['#FF1744', '#00FF00', '#0000FF'];
            const curColor = laserColors[Math.floor(lvl / 2)];

            // Optical Housing
            ctx.fillStyle = this.topColor;
            ctx.fillRect(-topSize / 2, -topSize / 2, topSize, topSize);

            // Technical detail lines
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
            ctx.lineWidth = 1;
            ctx.strokeRect(-topSize / 2 + 2, -topSize / 2 + 2, topSize - 4, topSize - 4);

            if (lvl >= 2) {
                // Focus stabilizers on sides
                ctx.fillStyle = '#444';
                ctx.fillRect(-topSize/2 - 2, -topSize/4, 4, topSize/2);
                ctx.fillRect(topSize/2 - 2, -topSize/4, 4, topSize/2);
            }

            if (lvl >= 3) {
                // Power conduits running to lens
                ctx.strokeStyle = '#222';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(-topSize/2, -topSize/4);
                ctx.lineTo(topSize/4, -topSize/4);
                ctx.moveTo(-topSize/2, topSize/4);
                ctx.lineTo(topSize/4, topSize/4);
                ctx.stroke();
            }

            if (lvl >= 5) {
                // Thermal cooling fins on rear
                ctx.fillStyle = '#111';
                for(let i=0; i<3; i++) {
                    ctx.fillRect(-topSize/2 - 4, -topSize/2 + 4 + i * 8, 4, 4);
                }
                // Top mounted optic sensor
                ctx.fillStyle = '#222';
                ctx.fillRect(-2, -topSize/2 - 4, 4, 6);
                ctx.fillStyle = curColor; // Sensor matches laser color
                ctx.fillRect(-1, -topSize/2 - 3, 2, 2);
            }

            // --- Multi-Layer Lens Assembly ---
            const lensR = size * 0.12;
            const lensD = size * 0.22;
            const lensPulse = 0.7 + Math.sin(Date.now() / 200) * 0.3;

            // Outer lens housing
            ctx.fillStyle = '#333';
            ctx.beginPath();
            ctx.arc(lensD, 0, lensR + 2, 0, Math.PI * 2);
            ctx.fill();

            // The pulsing lens
            const grad = ctx.createRadialGradient(lensD, 0, 0, lensD, 0, lensR);
            grad.addColorStop(0, '#FFFFFF');
            grad.addColorStop(0.5, curColor);
            grad.addColorStop(1, 'rgba(0,0,0,0.5)');

            ctx.fillStyle = grad;
            ctx.shadowColor = curColor;
            ctx.shadowBlur = 8 * lensPulse;
            ctx.beginPath();
            ctx.arc(lensD, 0, lensR, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;

            // Inner core reflect (white dot)
            ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.beginPath();
            ctx.arc(lensD + 2, -2, 2, 0, Math.PI * 2);
            ctx.fill();
        } else if (this.isFlame) {
            const lvl = this.upgradeLevel;
            const topSize = size * 0.45;

            // Igniter Housing
            ctx.fillStyle = this.topColor;
            ctx.fillRect(-topSize / 2, -topSize / 2, topSize, topSize);

            // Housing detail
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
            ctx.lineWidth = 1;
            ctx.strokeRect(-topSize / 2 + 2, -topSize / 2 + 2, topSize - 4, topSize - 4);

            if (lvl >= 2) {
                // Side mounted fuel tanks (Symmetric)
                ctx.fillStyle = '#444';
                ctx.fillRect(-topSize / 2 - 3, -topSize / 4, 6, topSize / 2);
                ctx.fillRect(topSize / 2 - 3, -topSize / 4, 6, topSize / 2);
                // Caution stripes on tanks
                ctx.fillStyle = '#FFD700';
                for (let i = 0; i < 3; i++) {
                    ctx.fillRect(-topSize/2 - 2, -topSize/4 + 2 + i * 5, 4, 2);
                    ctx.fillRect(topSize/2 - 2, -topSize/4 + 2 + i * 5, 4, 2);
                }
            }

            if (lvl >= 3) {
                // Rear exhaust/cooling vent
                ctx.fillStyle = '#111';
                ctx.fillRect(-topSize / 2 - 2, -4, 4, 8);
            }

            if (lvl >= 5) {
                // High-pressure pump unit on top
                ctx.fillStyle = '#222';
                ctx.fillRect(-topSize / 4, -topSize / 2 - 4, topSize / 2, 6);
                ctx.fillStyle = '#FF4500'; // Heat indicator
                ctx.fillRect(0, -topSize / 2 - 2, 4, 2);
            }

            // Nozzle Assembly
            const nLen = size * 0.35, nW = size * 0.25;
            ctx.fillStyle = '#333';
            ctx.beginPath();
            ctx.moveTo(0, -nW / 2);
            ctx.lineTo(nLen, -nW / 1.5);
            ctx.lineTo(nLen, nW / 1.5);
            ctx.lineTo(0, nW / 2);
            ctx.closePath();
            ctx.fill();

            // Internal pilot light / heat glow
            const pulse = 0.6 + Math.sin(Date.now() / 150) * 0.4;
            const glowR = nW * 0.4;
            const grad = ctx.createRadialGradient(nLen * 0.2, 0, 0, nLen * 0.2, 0, glowR);
            grad.addColorStop(0, `rgba(255, 200, 0, ${pulse})`);
            grad.addColorStop(1, 'rgba(255, 100, 0, 0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(nLen * 0.2, 0, glowR, 0, Math.PI * 2);
            ctx.fill();

            // Exterior nozzle ribbing
            if (lvl >= 1) {
                ctx.strokeStyle = 'rgba(255,255,255,0.1)';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(nLen * 0.4, -nW * 0.45);
                ctx.lineTo(nLen * 0.4, nW * 0.45);
                ctx.stroke();
                if (lvl >= 4) {
                    ctx.beginPath();
                    ctx.moveTo(nLen * 0.7, -nW * 0.55);
                    ctx.lineTo(nLen * 0.7, nW * 0.55);
                    ctx.stroke();
                }
            }
        } else if (this.type === 'machinegun' || this.type === 'cannon') {
            const s = size;
            const lvl = this.upgradeLevel;
            const isCannon = this.type === 'cannon';
            const topSize = s * 0.45;

            // Turret Housing
            ctx.fillStyle = this.topColor;
            ctx.fillRect(-topSize / 2, -topSize / 2, topSize, topSize);

            // Turret Detail
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
            ctx.lineWidth = 1;
            ctx.strokeRect(-topSize / 2 + 2, -topSize / 2 + 2, topSize - 4, topSize - 4);

            if (lvl >= 3) {
                // Side-mounted ammo boxes (Symmetric on left and right)
                ctx.fillStyle = isCannon ? '#300' : '#222';
                const boxW = 5;
                const boxH = topSize - 4;
                ctx.fillRect(-topSize / 2 - boxW, -boxH / 2, boxW, boxH);
                ctx.fillRect(topSize / 2, -boxH / 2, boxW, boxH);
            }

            if (lvl >= 5) {
                // Top-mounted sensor/radar box (Centered)
                ctx.fillStyle = '#333';
                ctx.fillRect(-4, -topSize / 2 - 4, 8, 5);
                ctx.fillStyle = isCannon ? '#FF0000' : '#00FF00';
                ctx.fillRect(-2, -topSize / 2 - 2, 4, 2);
            }

            // Barrels
            ctx.fillStyle = '#111';
            const bLen = s * 0.45;
            const barrelWidthFactor = isCannon ? 0.28 : 0.10;
            const bW = s * barrelWidthFactor;

            if (lvl === 0) {
                // Single barrel
                ctx.fillRect(0, -bW / 2, bLen, bW);
                // Muzzle brake
                ctx.fillStyle = '#333';
                ctx.fillRect(bLen - 4, -bW / 2 - 2, 6, bW + 4);
            } else if (lvl <= 2) {
                // Twin barrels
                const bwReal = bW / (isCannon ? 1.4 : 1.0);
                ctx.fillStyle = '#111';
                ctx.fillRect(0, -bwReal - 2, bLen, bwReal);
                ctx.fillRect(0, 2, bLen, bwReal);
                // Muzzle brake on both
                ctx.fillStyle = '#333';
                ctx.fillRect(bLen - 4, -bwReal - 4, 6, bwReal + 4);
                ctx.fillRect(bLen - 4, 0, 6, bwReal + 4);
            } else {
                // Gatling style cluster (4 barrels)
                var scale = GameConfig.scale || 1.0;
                const bwReal = bW / (isCannon ? 1.8 : 1.0);
                const offset = bwReal * 0.7;
                ctx.fillStyle = '#111';
                ctx.fillRect(0, -offset - bwReal, bLen, bwReal);
                ctx.fillRect(0, offset, bLen, bwReal);
                ctx.fillRect(0, -bwReal / 2, bLen + 4 * scale, bwReal); // Center extended

                // Heat shroud / Cooling fins
                if (lvl >= 4) {
                    ctx.fillStyle = isCannon ? 'rgba(80, 0, 0, 0.6)' : 'rgba(0, 0, 0, 0.6)';
                    for (let i = 0; i < 4; i++) {
                        ctx.fillRect((10 + i * 6) * scale, -offset - bwReal - 2 * scale, 2 * scale, (offset + bwReal) * 2 + 4 * scale);
                    }
                }
            }
        } else {
            const isSpeedy = this.type === 'machinegun';
            const isCannon = this.type === 'cannon';
            // Both MG (speedy) and Cannon (cannon) use the smaller top size (0.43)
            const topSize = size * (isSpeedy || isCannon ? 0.43 : 0.57);
            ctx.fillRect(-topSize / 2, -topSize / 2, topSize, topSize);
            ctx.fillStyle = '#333';

            // Cannon (cannon) has a much thicker barrel (0.28 vs 0.11)
            const barrelWidthFactor = isCannon ? 0.28 : (isSpeedy ? 0.11 : 0.18);
            const bLen = size * (isSpeedy ? 0.36 : 0.50), bW = size * barrelWidthFactor / Math.sqrt(numBarrels), sp = bW * 1.3;
            for (let i = 0; i < numBarrels; i++) { ctx.fillRect(0, (i - (numBarrels - 1) / 2) * sp - bW / 2, bLen, bW); }
        }
        ctx.restore();
    }

    renderWeaponEffects(ctx) {
        if (!this.isBuilt || this.isDestroying || this.isUpgrading) return;
        if (this.isTesla && this.zappedEnemies && this.zappedEnemies.length > 0) {
            ctx.save(); ctx.strokeStyle = '#00FFFF'; ctx.lineWidth = 2; ctx.shadowColor = '#00FFFF'; ctx.shadowBlur = 10;
            for (const target of this.zappedEnemies) {
                ctx.beginPath(); ctx.moveTo(this.x, this.y); const segments = 5;
                for (let s = 1; s <= segments; s++) { const t = s / segments, lx = this.x + (target.x - this.x) * t + (Math.random() - 0.5) * 12, ly = this.y + (target.y - this.y) * t + (Math.random() - 0.5) * 12; ctx.lineTo(lx, ly); }
                ctx.stroke();
            }
            ctx.shadowBlur = 0; ctx.restore();
        }
        if (this.isFlame && this.isBuilt && !this.isUpgrading && this.burstCooling) {
            // v5.22 cooldown: thin recharge ring + cooling nozzle glow
            const r = this.size * 0.58, a0 = -Math.PI / 2, ch = Math.max(0, Math.min(1, this.burstCharge || 0));
            ctx.save(); ctx.lineCap = 'round';
            ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 4.5; ctx.beginPath(); ctx.arc(this.x, this.y, r, 0, Math.PI * 2); ctx.stroke();
            ctx.strokeStyle = 'rgba(255,183,77,1)'; ctx.lineWidth = 2.5;
            ctx.beginPath(); ctx.arc(this.x, this.y, r, a0, a0 + ch * Math.PI * 2); ctx.stroke();
            ctx.restore();
        }
        if (this.isLaser && this.isBuilt && !this.isUpgrading && this.burstCooling) {
            // v5.23: two cartoon steam jets vent from the sides while the laser cools (replaces the recharge ring)
            const t = Date.now() / 1000, sz = this.size, ang = this.laserAngle;
            ctx.save(); ctx.translate(this.x, this.y);
            for (const side of [-1, 1]) {
                const a = ang + side * (Math.PI / 2);
                const ox = Math.cos(a) * sz * 0.28, oy = Math.sin(a) * sz * 0.28;
                for (let i = 0; i < 4; i++) {
                    const u = ((t * 1.7 + i * 0.25 + side * 0.12) % 1);
                    const px = ox + Math.cos(a) * u * sz * 0.4;
                    const py = oy + Math.sin(a) * u * sz * 0.4 - u * sz * 0.22;
                    const rad = (3 + u * 8) * (sz / 56);
                    const alpha = (1 - u) * 0.7;
                    ctx.fillStyle = 'rgba(200, 222, 235,' + alpha + ')';
                    ctx.beginPath(); ctx.arc(px, py, rad, 0, Math.PI * 2); ctx.fill();
                    ctx.fillStyle = 'rgba(255, 255, 255,' + (alpha * 0.7) + ')';
                    ctx.beginPath(); ctx.arc(px - rad * 0.22, py - rad * 0.22, rad * 0.5, 0, Math.PI * 2); ctx.fill();
                }
            }
            ctx.restore();
        }
        if (this.isLaser && !this.burstCooling && this.laserPath && this.laserPath.length >= 2) {
            const lvl = Math.min(this.upgradeLevel, 5), colors = ['#FF0000', '#00FF00', '#0000FF'], thickness = (lvl % 2 === 0) ? 1.0 : 2.5, laserColor = colors[Math.floor(lvl / 2)];
            const lx = this.x + Math.cos(this.laserAngle) * (this.size * 0.22), ly = this.y + Math.sin(this.laserAngle) * (this.size * 0.22);
            const layers = [{ color: laserColor, width: thickness * 7, alpha: 0.35, blur: 12 }, { color: laserColor, width: thickness * 3, alpha: 0.8, blur: 0 }, { color: '#FFFFFF', width: thickness, alpha: 1.0, blur: 0 }];
            let cumulativeBrightness = 1;
            for (let s = 0; s < this.laserPath.length - 1; s++) {
                if (s > 0 && this.laserPath[s].mirror) cumulativeBrightness *= (1 - this.laserPath[s].mirror.damageReduction);
                if (cumulativeBrightness < 0.01) break;
                const p1 = s === 0 ? { x: lx, y: ly } : this.laserPath[s], p2 = this.laserPath[s + 1];
                ctx.save();
                for (const layer of layers) {
                    ctx.globalAlpha = cumulativeBrightness * layer.alpha; ctx.strokeStyle = layer.color; ctx.lineWidth = layer.width;
                    if (layer.blur > 0) { ctx.shadowColor = laserColor; ctx.shadowBlur = layer.blur; }
                    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
                }
                ctx.restore();
            }
        }
        if (this.isFlame && this.isFiringFlame) {
            const t = Date.now() / 1000, nozzleLen = this.size * 0.35, isBlue = this.upgradeLevel >= 5;
            const baseColor = isBlue ? 'rgba(0, 100, 255,' : 'rgba(255, 100, 0,', midColor = isBlue ? 'rgba(100, 200, 255,' : 'rgba(255, 200, 0,', coreColor = isBlue ? 'rgba(200, 255, 255,' : 'rgba(255, 255, 200,';
            ctx.save(); ctx.translate(this.x, this.y); ctx.rotate(this.flameAngle);
            for (let i = 0; i < 15; i++) {
                const pDist = ((t * 5 + i * 0.3) % 1) * this.range, pAlpha = 1 - (pDist / this.range), pSpread = (pDist / this.range) * (this.range * 0.4), py = (Math.sin(t * 10 + i) * pSpread), px = nozzleLen + pDist, pSize = (0.2 + pAlpha * 0.8) * 12;
                ctx.fillStyle = i % 3 === 0 ? `${coreColor}${pAlpha * 0.8})` : i % 2 === 0 ? `${midColor}${pAlpha * 0.6})` : `${baseColor}${pAlpha * 0.4})`;
                ctx.shadowColor = isBlue ? '#0064FF' : '#FF4500'; ctx.shadowBlur = 10 * pAlpha; ctx.beginPath(); ctx.arc(px, py, pSize, 0, Math.PI * 2); ctx.fill();
            }
            ctx.restore();
        }
        const timeSinceShot = Date.now() - (this.lastRealShotTime || 0);
        if (this.currentTarget && !this.isTesla && !this.isUpgrader && !this.isLaser && !this.isFlame && timeSinceShot < 80 && timeSinceShot >= 0) {
            var scale = GameConfig.scale || 1.0;
            const flashAlpha = 1 - timeSinceShot / 80, barrelLen = this.size * 0.5, fx = this.x + Math.cos(this.rotation) * barrelLen, fy = this.y + Math.sin(this.rotation) * barrelLen;
            ctx.save(); ctx.fillStyle = `rgba(255, 220, 100, ${flashAlpha * 0.7})`; ctx.shadowColor = '#FFD700'; ctx.shadowBlur = 8 * scale; ctx.beginPath(); ctx.arc(fx, fy, (4 * flashAlpha + 2) * scale, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        }
    }
}

// v5.22: burst/cooldown timings (ms) for always-on weapons
Tower.BURST = { flame: { on: 2200, off: 1300 }, laser: { on: 2400, off: 1600 } };
