/**
 * Spike Trap
 * Damages enemies that walk over it, doesn't block path.
 * 4 tiers: wood -> silver -> gold -> purple (purple also slows)
 */
class SpikeTrap extends BuildableEntity {
    constructor(x, y, col, row, startLevel = 0) {
        super();
        this.x = x;
        this.y = y;
        this.col = col;
        this.row = row;
        this.type = 'spike';
        this.size = GameConfig.Spike.size;
        this.cost = GameConfig.Spike.cost;
        this.isSpike = true;
        this.upgradeLevel = startLevel;
        this.maxUpgrades = 5;
        this.baseBuildTime = 500; // Faster for traps
        this.baseDestroyTime = Math.max(300, this.cost * 150);
        this.lastDamageTime = {}; // Plain object for ES5 compatibility
        this.totalInvested = this.cost;
        this.baseUpgradeTime = this.cost * 100;

        // Animation State
        this.animProgress = 0; // 0 = hidden/idle, 1 = fully extended
        this.isStabbing = false;
        this.lastStabStartTime = 0;
    }

    getUpgradeCost() { return this.cost * POW_2[Math.min(this.upgradeLevel, 6)]; }
    getUpgradeTime() { return this.baseUpgradeTime * POW_2[Math.min(this.upgradeLevel, 6)]; }

    takeDamage(amount, source) {
        // Spike traps are completely immune to all damage (Breakers, attacks, etc.)
        return;
    }

    getRepairCost() {
        return 0; // Spikes never take damage
    }

    cancelUpgrade() {
        if (!this.isUpgrading) return false;
        this.isUpgrading = false;
        this.upgradeProgress = 0;
        if (window.gameScene) window.gameScene.showTowerPopup(this);
        return true;
    }

    getDamage() { return GameConfig.Spike.tierDamage[Math.min(this.upgradeLevel, 5)]; }
    getTierName() { return GameConfig.Spike.tierNames[Math.min(this.upgradeLevel, 5)]; }
    getTierColor() {
        const visuals = window.textureManager.getBuildable('spike');
        const tiers = visuals.tiers || GameConfig.Spike.tierColors;
        return tiers[Math.min(this.upgradeLevel, 5)];
    }

    startUpgrade() {
        if (this.upgradeLevel >= this.maxUpgrades || this.isUpgrading || this.isDestroying || !this.isBuilt) return false;
        this.isUpgrading = true;
        this.upgradeProgress = 0;
        return true;
    }

    completeUpgrade() {
        const spentCost = this.getUpgradeCost();
        this.upgradeLevel++;
        // 20% durability increase per upgrade level
        const oldMax = this.maxHealth || 60;
        this.baseMaxHealth = this.baseMaxHealth || 60;
        const newMaxHealth = Math.floor(this.baseMaxHealth * (1 + 0.20 * this.upgradeLevel));
        const hpDiff = newMaxHealth - oldMax;
        if (hpDiff > 0 && this.health > 0) this.health = Math.min(newMaxHealth, this.health + hpDiff);
        this.maxHealth = newMaxHealth;

        if (window.gameScene) window.gameScene._entitiesDirty = true;
        this.totalInvested += spentCost;
        this.isUpgrading = false;
        this.upgradeProgress = 0;
        window.gameScene?.soundManager?.playUpgradeComplete();
    }

    update(enemies, gameTime, scene) {
        const speedMult = 1;

        // Update Animation
        if (this.isStabbing) {
            const stabDuration = 100; // Fast up
            const retractDuration = 500; // Slow down
            const totalDuration = stabDuration + retractDuration;
            const elapsed = gameTime - this.lastStabStartTime;

            if (elapsed < stabDuration) {
                this.animProgress = elapsed / stabDuration;
            } else if (elapsed < totalDuration) {
                this.animProgress = 1 - (elapsed - stabDuration) / retractDuration;
            } else {
                this.animProgress = 0;
                this.isStabbing = false;
            }
        }

        if (!this.isBuilt) {
            this.buildProgress += (scene.lastDeltaTime || 0) * 1000 / this.baseBuildTime * getHealthRatio(scene.castle) * speedMult;
            if (this.buildProgress >= 1) {
                this.isBuilt = true;
                if (window.gameScene) window.gameScene._entitiesDirty = true;
                window.gameScene?.soundManager?.playUpgradeComplete();
            }
            return;
        }

        if (this.isUpgrading) {
            this.upgradeProgress += (scene.lastDeltaTime || 0) * 1000 / this.getUpgradeTime() * getHealthRatio(scene.castle) * speedMult;
            if (this.upgradeProgress >= 1) this.completeUpgrade();
            return;
        }

        if (this.isDestroying) return;

        const damage = this.getDamage();
        const interval = GameConfig.Spike.damageInterval;
        const ts = GameConfig.Grid.tileSize;
        const halfTile = ts / 2;
        const halfTileSq = halfTile * halfTile;

        const candidates = scene._getNearbyEnemies
            ? scene._getNearbyEnemies(this.x, this.y, halfTile)
            : enemies;

        for (const enemy of candidates) {
            if (enemy.isDead) continue;
            if (enemy.type === 'flyer') continue;
            const dSq = distSq(this.x, this.y, enemy.x, enemy.y);
            if (dSq > halfTileSq) {
                delete this.lastDamageTime[enemy.id];
                continue;
            }

            const lastTick = this.lastDamageTime[enemy.id] || 0;
            if (gameTime - lastTick >= interval) {
                enemy.takeDamage(damage, this);
                this.lastDamageTime[enemy.id] = gameTime;

                // Sound effect for damage
                if (scene && scene.soundManager) {
                    scene.soundManager.playSpikeStabSynth(0.35);
                }

                // Trigger stab animation
                if (!this.isStabbing) {
                    this.isStabbing = true;
                    this.lastStabStartTime = gameTime;
                }

                if (this.upgradeLevel >= 3) {
                    const slowMult = this.upgradeLevel >= 5 ? 0.3 : GameConfig.Spike.tierSlowMult;
                    enemy.applySlow(slowMult, GameConfig.Spike.tierSlowDuration, gameTime);
                }
            }
        }

        // Cleaning logic moved to game.js central loop for performance,
        // or handled via enemy death events. For traps, we can just clear on round end
        // or check existence here.
        for (const id in this.lastDamageTime) {
            // We don't have direct access to the enemy object from just the ID here
            // without a scene lookup, but we can just leave it; the memory impact is tiny.
        }
    }

    updateDestroy(deltaTime, castle) {
        if (!this.isDestroying) return false;
        const speedMult = 1;
        this.destroyProgress += deltaTime * 1000 / this.baseDestroyTime * getHealthRatio(castle) * speedMult;
        return this.destroyProgress >= 1;
    }

    render(ctx) {
        const colors = this.getTierColor();
        if (!colors) return;

        const s = this.size || GameConfig.Grid.tileSize;
        const half = s * 0.5;

        const img = window.textureManager.getImage('buildables', 'spike');
        if (img) {
            ctx.save(); ctx.translate(this.x, this.y);
            ctx.drawImage(img, -s / 2, -s / 2, s, s);
            ctx.restore(); return;
        }

        ctx.save(); ctx.translate(this.x, this.y);

        // 1. Render Base Plate (Static)
        ctx.fillStyle = colors.base;
        ctx.globalAlpha = 0.8;
        ctx.fillRect(-half, -half, half * 2, half * 2);

        // Base plate detail (bolts)
        if (this.upgradeLevel >= 1) {
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            const bs = s * 0.05;
            ctx.fillRect(-half + 4, -half + 4, bs, bs);
            ctx.fillRect(half - 4 - bs, -half + 4, bs, bs);
            ctx.fillRect(-half + 4, half - 4 - bs, bs, bs);
            ctx.fillRect(half - 4 - bs, half - 4 - bs, bs, bs);
        }
        ctx.globalAlpha = 1;

        // 2. Render Moving Spikes (Animated)
        const lvl = this.upgradeLevel;
        // Offset North (negative Y) based on animProgress
        const stabOffset = s * 0.15 * this.animProgress;
        ctx.translate(0, -stabOffset);

        if (lvl >= 5) {
            ctx.shadowColor = '#FF0000';
            ctx.shadowBlur = 10;
        }

        ctx.fillStyle = colors.spike;
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.lineWidth = 1;

        const numRows = lvl >= 3 ? 2 : 1;
        const spikesPerRow = 3;
        const spikeW = s * (lvl >= 4 ? 0.18 : 0.14);
        const spikeH = s * (lvl >= 2 ? 0.32 : 0.24);
        const spacingX = s * 0.28;
        const startX = -((spikesPerRow - 1) * spacingX) / 2;
        const startY = numRows > 1 ? -s * 0.18 : -s * 0.05;

        for (let r = 0; r < numRows; r++) {
            for (let i = 0; i < spikesPerRow; i++) {
                const px = startX + i * spacingX;
                const py = startY + r * (spikeH + s * 0.08);

                ctx.beginPath();
                ctx.moveTo(px, py - spikeH/2); // Tip (North)
                ctx.lineTo(px + spikeW/2, py + spikeH/2); // Bottom right
                ctx.lineTo(px - spikeW/2, py + spikeH/2); // Bottom left
                ctx.closePath();
                ctx.fill();
                ctx.stroke();

                // Highlight/Shine on the left half of each spike
                ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
                ctx.beginPath();
                ctx.moveTo(px, py - spikeH/2);
                ctx.lineTo(px, py + spikeH/2);
                ctx.lineTo(px - spikeW/2, py + spikeH/2);
                ctx.closePath();
                ctx.fill();

                if (lvl >= 5) {
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
                    ctx.fillRect(px - 1, py, 2, spikeH/2);
                }

                ctx.fillStyle = colors.spike;
            }
        }

        ctx.restore(); // Restore after spike translation
    }

    renderRangeOverlay(ctx) {
        // GDD: Spikes are ground traps, they don't have a traditional range circle
    }
}
