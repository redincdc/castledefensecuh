/**
 * Lilypad Tower
 * Wooden raft placed on water, enemies can walk over it.
 */
class LilypadTower extends BuildableEntity {
    constructor(x, y, col, row, startLevel = 0) {
        super();
        this.x = x;
        this.y = y;
        this.col = col;
        this.row = row;
        this.type = 'lilypad';
        this.size = GameConfig.Grid.tileSize * 0.85;
        const visuals = window.textureManager.getBuildable('lilypad');
        this.padColor = visuals.padColor;
        this.padHighlight = visuals.padHighlight;
        this.padDark = visuals.padDark;
        this.flowerColor = visuals.flowerColor;
        this.flowerCenter = visuals.flowerCenter;
        this.cost = GameConfig.Lilypad.cost;
        this.isLilypad = true;
        this.upgradeLevel = Math.min(5, startLevel);
        this.maxUpgrades = 5;
        this.isUpgrading = false;
        this.upgradeProgress = 0;
        this.baseUpgradeTime = this.cost * 100;
        this.totalInvested = this.cost;
        this.bobPhase = Math.random() * Math.PI * 2;
        this.placementLevel = this.upgradeLevel;
        this.baseBuildTime = this.cost * 200 * Math.pow(0.7, this.upgradeLevel);
        this.baseDestroyTime = Math.max(300, this.cost * 150);
        this.lastDamageTime = {}; // Plain object for ES5 compatibility
    }

    getUpgradeCost() { return this.cost * POW_2[Math.min(this.upgradeLevel, 6)]; }
    getUpgradeTime() { return this.baseUpgradeTime * POW_2[Math.min(this.upgradeLevel, 6)]; }

    cancelUpgrade() {
        if (!this.isUpgrading) return false;
        this.isUpgrading = false;
        this.upgradeProgress = 0;
        if (window.gameScene) window.gameScene.showTowerPopup(this);
        return true;
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
    }

    update(deltaTime, castle, enemies = [], gameTime = 0) {
        const speedMult = 1;
        if (this.isUpgrading) {
            this.upgradeProgress += deltaTime * 1000 / this.getUpgradeTime() * getHealthRatio(castle) * speedMult;
            if (this.upgradeProgress >= 1) this.completeUpgrade();
            return;
        }
        const destroyed = this.updateBuildDestroy(deltaTime, castle);
        if (this.isBuilt && !this.isDestroying) {
            const halfTile = this.size * 0.5, halfTileSq = halfTile * halfTile;
            const damage = GameConfig.Lilypad.damage[Math.min(this.upgradeLevel, 5)] || 0;
            const interval = GameConfig.Lilypad.damageInterval;
            for (const enemy of enemies) {
                if (enemy.isDead || enemy.type === 'flyer') continue;
                const dSq = distSq(this.x, this.y, enemy.x, enemy.y);
                if (dSq <= halfTileSq) {
                    if (this.upgradeLevel >= 3) enemy.applySlow(GameConfig.Lilypad.slowMult, GameConfig.Lilypad.slowDuration, gameTime);
                    if (damage > 0) {
                        const lastTick = this.lastDamageTime[enemy.id] || 0;
                        if (gameTime - lastTick >= interval) {
                            enemy.takeDamage(damage, this);
                            this.lastDamageTime[enemy.id] = gameTime;

                            // Sound effect for damage
                            if (window.gameScene && window.gameScene.soundManager) {
                                window.gameScene.soundManager._startTone(350, 0.1, { type: 'sine', volume: 0.04, glide: 0.9 });
                            }
                        }
                    }
                } else {
                    delete this.lastDamageTime[enemy.id];
                }
            }

        }
        return destroyed;
    }

    render(ctx, time) {
        const bob = Math.sin(time * 2 + this.bobPhase) * 2, tilt = Math.sin(time * 1.5 + this.bobPhase) * 0.04;
        const lvl = this.upgradeLevel;

        const img = window.textureManager.getImage('buildables', 'lilypad');
        if (img) {
            ctx.save(); ctx.translate(this.x, this.y + bob); ctx.rotate(tilt);
            ctx.drawImage(img, -this.size / 2, -this.size / 2, this.size, this.size);
            ctx.restore(); return;
        }

        ctx.save(); ctx.translate(this.x, this.y + bob); ctx.rotate(tilt);
        const progress = this.getBuildProgress(); if (progress <= 0) { ctx.restore(); return; }
        ctx.globalAlpha = progress;

        const s = this.size, r = s * 0.45;

        // --- 1. Wooden Raft Base (Lvl 1+) ---
        // Provides the "structure" for enemies to walk on
        if (lvl >= 1) {
            ctx.fillStyle = '#6B4226'; // Dark wood
            const rw = s * 0.8, rh = s * 0.8;
            ctx.fillRect(-rw/2, -rh/2, rw, rh);

            // Plank lines
            ctx.strokeStyle = '#3D2B1F';
            ctx.lineWidth = 1;
            for(let i=-1; i<=1; i++) {
                ctx.beginPath();
                ctx.moveTo(i * (rw/3), -rh/2);
                ctx.lineTo(i * (rw/3), rh/2);
                ctx.stroke();
            }
        } else {
            // Shadow for L0 (floating pad)
            ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
            ctx.beginPath();
            ctx.ellipse(0, s * 0.05, r * 1.05, r * 0.95, 0, 0, Math.PI * 2);
            ctx.fill();
        }

        // --- 2. The Lilypad (Main Visual) ---
        ctx.fillStyle = this.padColor;
        ctx.beginPath();
        const notchAngle = 0.35;
        ctx.arc(0, 0, r, notchAngle, Math.PI * 2 - notchAngle);
        ctx.lineTo(0, 0);
        ctx.closePath();
        ctx.fill();

        // Detail veins
        ctx.strokeStyle = this.padDark;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Highlight
        ctx.strokeStyle = this.padHighlight;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.85, 0.5, Math.PI * 0.8);
        ctx.stroke();

        // --- 3. Defensive Spikes (Lvl 1+) ---
        if (lvl >= 1) {
            ctx.fillStyle = '#555';
            const numSpikes = 6 + (lvl >= 3 ? 4 : 0);
            const spikeLen = s * (lvl >= 5 ? 0.22 : 0.15);
            for (let i = 0; i < numSpikes; i++) {
                const a = (i / numSpikes) * Math.PI * 2 + (time * 0.5);
                const ox = Math.cos(a) * r, oy = Math.sin(a) * r;
                const tx = Math.cos(a) * (r + spikeLen), ty = Math.sin(a) * (r + spikeLen);

                ctx.beginPath();
                ctx.moveTo(tx, ty);
                ctx.lineTo(ox + Math.cos(a + 0.3) * 4, oy + Math.sin(a + 0.3) * 4);
                ctx.lineTo(ox - Math.cos(a - 0.3) * 4, oy - Math.sin(a - 0.3) * 4);
                ctx.closePath();
                ctx.fill();
            }
        }

        // --- 4. The Flower ---
        ctx.fillStyle = this.flowerColor;
        const numPetals = 6, petalR = r * 0.25;
        for (let i = 0; i < numPetals; i++) {
            const a = i * Math.PI * 2 / numPetals;
            ctx.beginPath();
            ctx.ellipse(Math.cos(a) * petalR * 0.8, Math.sin(a) * petalR * 0.8, petalR, petalR * 0.5, a, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.fillStyle = this.flowerCenter;
        ctx.beginPath();
        ctx.arc(0, 0, petalR * 0.6, 0, Math.PI * 2);
        ctx.fill();

        // --- 5. Status Effects (Lvl 2+) ---
        if (lvl >= 2) {
            // Slowing mist/energy (Light Blue)
            const pulse = 0.4 + Math.sin(time * 3) * 0.2;
            const grad = ctx.createRadialGradient(0, 0, r * 0.5, 0, 0, r * 1.2);
            grad.addColorStop(0, 'rgba(0, 255, 255, 0)');
            grad.addColorStop(1, `rgba(100, 240, 255, ${0.3 * pulse})`);
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(0, 0, r * 1.2, 0, Math.PI * 2);
            ctx.fill();
        }

        // --- 6. Fortification (Lvl 5) ---
        if (lvl >= 5) {
            // Heavy wooden barrier around the edge (to block Crocs)
            ctx.strokeStyle = '#3D2B1F';
            ctx.lineWidth = 4;
            ctx.setLineDash([8, 4]);
            ctx.beginPath();
            ctx.arc(0, 0, r + 2, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);

            // Central glow core
            const cp = 0.5 + Math.sin(time * 5) * 0.5;
            ctx.fillStyle = `rgba(255, 255, 255, ${0.3 * cp})`;
            ctx.beginPath();
            ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    }
}
