/**
 * Upgrader Tower
 * Does not attack; instead, it enhances the damage and range of nearby towers.
 * Features separate upgrade paths for Damage Boost and Buff Range.
 */
class UpgraderTower extends Tower {
    constructor(x, y, startLevel = 0) {
        super('upgrader', x, y, startLevel);

        // Split upgrade paths
        this.dmgLevel = startLevel;
        this.rangeLevel = 0;
        this.maxUpgrades = 5;

        this.isUpgradingDmg = false;
        this.isUpgradingRange = false;

        this.buffRadius = 1; // Start with adjacent (1 tile)
    }

    getUpgradeCost(type = 'dmg') {
        const level = type === 'dmg' ? this.dmgLevel : this.rangeLevel;
        return Math.floor(this.cost * Math.pow(2, level));
    }

    getUpgradeTime(type = 'dmg') {
        const level = type === 'dmg' ? this.dmgLevel : this.rangeLevel;
        return this.baseUpgradeTime * Math.pow(2, level);
    }

    getBoostMultiplier() {
        const mults = GameConfig.Tower.Upgrader.multipliers;
        return mults[Math.min(this.dmgLevel, mults.length - 1)] || 1.1;
    }

    getRangeRadius() {
        // Radius starts at 1 tile (adjacent) and increases by 1 per Range Level.
        // Base (L0): 1 tile
        // L1: 2 tiles, L2: 3 tiles, etc...
        return this.rangeLevel + 1;
    }

    cancelUpgrade() {
        if (!super.cancelUpgrade()) return false;
        this.isUpgradingDmg = false;
        this.isUpgradingRange = false;
        return true;
    }

    startUpgrade(type = 'dmg') {
        if (this.isUpgrading || this.isDestroying || !this.isBuilt) return false;

        if (type === 'dmg') {
            if (this.dmgLevel >= this.maxUpgrades) return false;
            this.isUpgradingDmg = true;
        } else {
            if (this.rangeLevel >= this.maxUpgrades) return false;
            this.isUpgradingRange = true;
        }

        this.isUpgrading = true;
        this.upgradeProgress = 0;
        return true;
    }

    completeUpgrade() {
        if (this.isUpgradingDmg) {
            const spentCost = this.getUpgradeCost('dmg');
            this.dmgLevel++;
            this.totalInvested += spentCost;
        } else if (this.isUpgradingRange) {
            const spentCost = this.getUpgradeCost('range');
            this.rangeLevel++;
            this.totalInvested += spentCost;
            this.buffRadius = this.getRangeRadius();
        }

        this.isUpgrading = false;
        this.isUpgradingDmg = false;
        this.isUpgradingRange = false;
        this.upgradeProgress = 0;

        if (window.gameScene) {
            window.gameScene._entitiesDirty = true;
            // Force refresh neighbors' stats
            this.updateUpgrader(0, window.gameScene);
        }
        window.gameScene?.soundManager?.playUpgradeComplete();
    }

    update(enemies, currentTime, scene, castle) {
        if (this.isDestroying) {
            return this.updateBuildDestroy(scene.lastDeltaTime || 0, castle);
        }

        if (this.isUpgrading) {
            const type = this.isUpgradingDmg ? 'dmg' : 'range';
            this.upgradeProgress += (scene.lastDeltaTime || 0) * 1000 / this.getUpgradeTime(type) * getHealthRatio(castle);
            if (this.upgradeProgress >= 1) {
                this.completeUpgrade();
            }
            return;
        }

        if (!this.isBuilt) {
            this.buildProgress += (scene.lastDeltaTime || 0) * 1000 / this.baseBuildTime * getHealthRatio(castle);
            if (this.buildProgress >= 1) {
                this.isBuilt = true;
                window.gameScene?.soundManager?.playUpgradeComplete();
            }
            return;
        }

        this.updateUpgrader(currentTime, scene);
        return false;
    }

    recalcStats() {
        const ts = GameConfig.Grid.tileSize;
        this.col = Math.floor(this.x / ts);
        this.row = Math.floor(this.y / ts);
        this.buffRadius = this.getRangeRadius();
    }

    updateUpgrader(currentTime, scene) {
        if (currentTime - this.lastUpgradeTime < this.upgradeInterval && currentTime !== 0) return;

        // Define the 4 allowed directions: Left, Right, Up, Down
        // Restricted to distance 1 (direct contact only)
        const directions = [
            { dr: 0, dc: -1 }, // Left
            { dr: 0, dc: 1 },  // Right
            { dr: -1, dc: 0 }, // Up
            { dr: 1, dc: 0 }   // Down
        ];

        for (let d = 0; d < directions.length; d++) {
            const dir = directions[d];
            const row = this.row + dir.dr;
            const col = this.col + dir.dc;

            if (row >= 0 && row < GameConfig.Grid.rows && col >= 0 && col < GameConfig.Grid.columns) {
                scene.towers.forEach(t => {
                    if (t !== this && !t.isUpgrader && t.row === row && t.col === col) {
                        if (t.isBuilt && !t.isDestroying) {
                            if (!t.enhancedBy) t.enhancedBy = new Set();

                            const isNew = !t.enhancedBy.has(this);
                            if (isNew) {
                                t.enhancedBy.add(this);
                            }

                            if (isNew || currentTime === 0) {
                                t.recalcStats();
                            }
                        }
                    }
                });
            }
        }
        this.lastUpgradeTime = currentTime;
    }

    startDestroy() {
        if (!super.startDestroy()) return false;
        // Notify all neighbors to recalc without this upgrader
        if (window.gameScene) {
            this.updateUpgrader(0, window.gameScene);
        }
        return true;
    }

    // Override renderTop to show dual levels if needed, or just keep it simple.
    // For now, let's just make sure it doesn't crash.
}
