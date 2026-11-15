/**
 * Mirror Tower
 * Reflects laser beams at 45° or 135° angle, doesn't block enemies.
 */
class MirrorTower extends BuildableEntity {
    constructor(x, y, col, row, startLevel = 0) {
        super();
        this.x = x;
        this.y = y;
        this.col = col;
        this.row = row;
        this.type = 'mirror';
        this.size = GameConfig.Mirror.size;
        const visuals = window.textureManager.getBuildable('mirror');
        this.color = visuals.color;
        this.surfaceColor = visuals.surfaceColor;
        this.cost = GameConfig.Mirror.cost;
        this.isMirror = true;
        this.angleIndex = 0; // 0 = 45° (\), 1 = 135° (/)
        this.placementLevel = startLevel;
        this.upgradeLevel = startLevel;
        this.maxUpgrades = 5;
        this.baseBuildTime = 800; // Fast for utility
        this.baseDestroyTime = Math.max(300, this.cost * 150);
        this.baseUpgradeTime = this.cost * 100;
        this.isUpgrading = false;
        this.upgradeProgress = 0;
        this.totalInvested = this.cost;
    }

    get angle() { return GameConfig.Mirror.angles[this.angleIndex]; }

    get damageReduction() { return 0.10 - (this.upgradeLevel / 5) * 0.09; }
    get dimnessReduction() { return 0.11 - (this.upgradeLevel / 5) * 0.099; }

    getUpgradeCost() { return this.cost * POW_2[Math.min(this.upgradeLevel, 6)]; }
    getUpgradeTime() { return this.baseUpgradeTime * POW_2[Math.min(this.upgradeLevel, 6)]; }

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
        window.gameScene?.updateLaserPaths?.();
        window.gameScene?.soundManager?.playUpgradeComplete();
    }

    update(deltaTime, castle) {
        const speedMult = 1;
        if (this.isUpgrading) {
            this.upgradeProgress += deltaTime * 1000 / this.getUpgradeTime() * getHealthRatio(castle) * speedMult;
            if (this.upgradeProgress >= 1) this.completeUpgrade();
            return;
        }
        return this.updateBuildDestroy(deltaTime, castle);
    }

    rotate() {
        this.angleIndex = (this.angleIndex + 1) % GameConfig.Mirror.angles.length;
    }

    render(ctx) {
        const s = this.size || GameConfig.Grid.tileSize;
        const half = s * 0.5;
        const lvl = this.upgradeLevel;

        const img = window.textureManager.getImage('buildables', 'mirror');
        if (img) {
            ctx.save(); ctx.translate(this.x, this.y); ctx.rotate(this.angle);
            ctx.drawImage(img, -s / 2, -s / 2, s, s);
            ctx.restore(); return;
        }

        ctx.save(); ctx.translate(this.x, this.y);
        if (!this.isBuilt || this.isDestroying) ctx.globalAlpha = 0.5;

        // --- 1. Base Housing (Evolves with Level) ---
        ctx.fillStyle = this.color;
        ctx.fillRect(-half, -half, half * 2, half * 2);

        // Level-based detail: Plates and Grooves
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.lineWidth = 1;
        if (lvl >= 1) {
            ctx.strokeRect(-half + 4, -half + 4, half * 2 - 8, half * 2 - 8);
        }
        if (lvl >= 2) {
            // Corner bolts
            ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
            const boltS = s * 0.06;
            ctx.fillRect(-half + 5, -half + 5, boltS, boltS);
            ctx.fillRect(half - 5 - boltS, -half + 5, boltS, boltS);
            ctx.fillRect(-half + 5, half - 5 - boltS, boltS, boltS);
            ctx.fillRect(half - 5 - boltS, half - 5 - boltS, boltS, boltS);
        }
        if (lvl >= 3) {
            // Cooling vents on sides
            ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
            for (let i = 0; i < 2; i++) {
                ctx.fillRect(-half + 2, -half + 12 + i * 12, 4, 4);
                ctx.fillRect(half - 6, -half + 12 + i * 12, 4, 4);
            }
        }
        if (lvl >= 5) {
            // Glowing focus core
            const pulse = 0.5 + Math.sin(Date.now() / 300) * 0.3;
            ctx.fillStyle = `rgba(173, 216, 230, ${0.4 * pulse})`;
            ctx.beginPath();
            ctx.arc(0, 0, s * 0.12, 0, Math.PI * 2);
            ctx.fill();
        }

        // --- 2. Mirror Assembly (Evolves with Level) ---
        ctx.rotate(this.angle);
        const surfaceLen = s * (lvl >= 4 ? 0.9 : 0.8), surfaceW = lvl >= 3 ? 7 : 5;

        // Shadow/Backing
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(-surfaceLen / 2 + 2, -surfaceW / 2 + 2, surfaceLen, surfaceW);

        // Reflective Surface
        ctx.fillStyle = this.surfaceColor;
        ctx.fillRect(-surfaceLen / 2, -surfaceW / 2, surfaceLen, surfaceW);

        // Surface shine
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.fillRect(-surfaceLen / 2, -surfaceW / 2, surfaceLen, 1.5);

        // Framing brackets
        ctx.fillStyle = '#444';
        const bracketW = lvl >= 2 ? 4 : 3;
        ctx.fillRect(-surfaceLen / 2 - bracketW + 1, -surfaceW / 2 - 1, bracketW, surfaceW + 2);
        ctx.fillRect(surfaceLen / 2 - 1, -surfaceW / 2 - 1, bracketW, surfaceW + 2);

        if (lvl >= 5) {
            // Glowing red focus points on the frame (laser-aligned)
            ctx.fillStyle = '#FF0000';
            ctx.fillRect(-surfaceLen / 2 - 1, -1.5, 3, 3);
            ctx.fillRect(surfaceLen / 2 - 2, -1.5, 3, 3);

            // Optical energy pulse on surface
            const pulse = 0.2 + Math.sin(Date.now() / 200) * 0.1;
            ctx.fillStyle = `rgba(255, 255, 255, ${pulse})`;
            ctx.fillRect(-surfaceLen / 2, -surfaceW / 2, surfaceLen, surfaceW);
        }

        ctx.restore();
    }
}
