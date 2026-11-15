/**
 * HeadlessSimulator.js - Fast-Forward Automated Balance Tester
 * Runs 1,000x speed headless game simulations (no rendering) to evaluate level balance.
 */

function createMockCanvas(width = 480, height = 800) {
    const noop = () => {};
    const mockCtx = {
        save: noop, restore: noop, translate: noop, rotate: noop, scale: noop,
        beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arc: noop,
        ellipse: noop, fill: noop, stroke: noop, fillRect: noop, strokeRect: noop,
        clearRect: noop, drawImage: noop, fillText: noop, strokeText: noop,
        quadraticCurveTo: noop, bezierCurveTo: noop, setTransform: noop,
        measureText: () => ({ width: 50 }), setLineDash: noop, setProperty: noop,
        createLinearGradient: () => ({ addColorStop: noop }),
        createRadialGradient: () => ({ addColorStop: noop }),
        globalAlpha: 1.0, globalCompositeOperation: 'source-over',
        fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '10px sans-serif',
        textAlign: 'center', textBaseline: 'middle'
    };
    return {
        width,
        height,
        style: {},
        parentElement: {
            style: {},
            querySelector: () => ({ textContent: '', style: {} }),
            querySelectorAll: () => []
        },
        classList: { add: noop, remove: noop, toggle: noop },
        appendChild: noop,
        querySelector: () => ({ getContext: () => mockCtx, width: 64, height: 64, textContent: '', style: {}, classList: { add: noop, remove: noop } }),
        querySelectorAll: () => [],
        getContext: () => mockCtx,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 480, height: 800 }),
        addEventListener: noop,
        removeEventListener: noop
    };
}

class HeadlessSimulator {
    static runLevelTest(level = 1, botType = 'average', customOptions = {}) {
        window._headless = true;
        GameConfig.Grid.tileSize = 64;
        const mockCanvas = createMockCanvas(600, 1000);

        // Save current global state to restore after simulation
        const originalGameScene = window.gameScene;
        const originalGame = window.game;

        // Instantiate isolated GameScene
        const scene = new GameScene(mockCanvas);
        scene.waterEnabled = false;

        // Proxy sound manager to safely no-op any audio call
        const noop = () => {};
        scene.soundManager = new Proxy({
            getDynamicVolumeScale: () => 1.0
        }, {
            get: (target, prop) => {
                if (prop in target) return target[prop];
                return noop;
            }
        });

        // Override countdowns to be instantaneous in headless mode
        scene.startCountdown = function(seconds, onComplete) {
            this.isCountingDown = false;
            if (typeof onComplete === 'function') {
                onComplete();
            }
        };

        scene.selectedLevel = level;
        scene.start();

        // Overrides if testing custom HP / Speed
        if (customOptions.hpMultiplier) {
            scene.gameStateManager.hpMult = customOptions.hpMultiplier;
        }

        const maxSteps = customOptions.maxSteps || 100000;
        let stepCount = 0;
        let totalKills = 0;
        let cumulativeGameTime = 0;
        let result = {
            level,
            botType,
            victory: false,
            roundsCompleted: 0,
            finalCastleHp: 100,
            finalGold: 0,
            totalEnemiesKilled: 0,
            durationSeconds: 0,
            towersBuilt: {}
        };

        const dt = 0.016; // 60 FPS fixed step

        // Main Simulation Loop
        while (stepCount++ < maxSteps && scene.gameStateManager.isPlaying) {
            // Place Castle if not placed yet
            if (scene.castle === null && scene.gridSystem && scene.gridSystem.tiles && scene.gridSystem.tiles.length > 0) {
                const gridRows = scene.gridSystem.tiles.length;
                const gridCols = scene.gridSystem.tiles[0].length;
                const castleTile = scene.gridSystem.tiles[gridRows - 3][Math.floor(gridCols / 2)];
                if (castleTile) {
                    scene.setupCastle(castleTile);
                    scene.placementMode = false;
                    scene.startNextRound();
                }
            }

            // Execute bot building decisions (controlled rate)
            if (scene.castle !== null && stepCount % 20 === 0) {
                this._executeBotPlacement(scene, level, botType);
            }

            // Step Physics & Game Loop
            cumulativeGameTime += dt;
            const killsBefore = scene.enemiesKilledInRound;
            scene.update(dt, cumulativeGameTime);
            if (scene.enemiesKilledInRound > killsBefore) {
                totalKills += (scene.enemiesKilledInRound - killsBefore);
            }

            // Check Defeat / Victory
            if (scene.castle && scene.castle.health <= 0) {
                result.victory = false;
                result.finalCastleHp = 0;
                result.roundsCompleted = Math.max(0, scene.gameStateManager.round - 1);
                break;
            }

            if (scene.gameStateManager.round > 10) {
                result.victory = true;
                result.roundsCompleted = 10;
                result.finalCastleHp = Math.round(scene.castle ? scene.castle.health : 100);
                break;
            }

            // Safety: if enemies are stuck too long or loop, force round completion if all spawned and most dead
            if (scene.enemyQueue.length === 0 && scene.enemies.length < 5 && stepCount > 50000) {
                // If it's taking too long to clear the last few stragglers (pathing loops), just count them as dead for simulation
                scene.enemies.forEach(e => e.isDead = true);
                scene.enemies = [];
            }
        }

        result.finalGold = scene.gameStateManager.gold;
        result.totalEnemiesKilled = totalKills;
        result.durationSeconds = Math.round(cumulativeGameTime);

        // Count towers built with their upgrade levels
        scene.towers.concat(scene.walls, scene.spikes, scene.mirrors, scene.Lilypads).forEach(t => {
            const key = t.type || 'tower';
            const lvl = (t.upgradeLevel !== undefined ? t.upgradeLevel + 1 : (t.dmgLevel !== undefined ? t.dmgLevel + 1 : 1));
            const label = `${key} (Lvl ${lvl})`;
            result.towersBuilt[label] = (result.towersBuilt[label] || 0) + 1;
        });

        // Restore original global references
        window.gameScene = originalGameScene;
        window.game = originalGame;

        return result;
    }

    static _executeBotPlacement(scene, level, botType) {
        if (!scene || !scene.castle) return;
        const gold = scene.gameStateManager.gold;
        const grid = scene.gridSystem;
        if (!grid || !grid.tiles || grid.tiles.length === 0) return;

        const maxStructures = Math.min(25, level + 15);
        const structureCount = scene.towers.length + scene.spikes.length;
        const shouldBuildNew = structureCount < maxStructures;

        const numRows = grid.tiles.length;
        const numCols = grid.tiles[0].length;

        // Get current active enemy path
        const activePath = grid.getCenterPath(scene.towers, 'normal', scene.walls, true);
        const pathTileKeys = {};
        if (activePath && activePath.length > 0) {
            activePath.forEach(pt => {
                const t = grid.getTileAtPosition(pt.x, pt.y);
                if (t) pathTileKeys[grid.pathFinder.keyOf(t)] = true;
            });
        }

        // Find candidate tiles
        const candidateTiles = [];
        const pTiles = [];
        for (let r = 1; r < numRows - 3; r++) {
            for (let c = 0; c < numCols; c++) {
                const tile = grid.tiles[r][c];
                if (tile && !tile.occupied && !tile.reserved && !tile.water) {
                    const key = grid.pathFinder.keyOf(tile);
                    if (pathTileKeys[key]) {
                        pTiles.push(tile);
                    } else {
                        candidateTiles.push(tile);
                    }
                }
            }
        }

        if (botType === 'naive') {
            const type = 'cannon';
            const cost = GameConfig.Tower.Cannon.cost || 20;
            if (shouldBuildNew && gold >= cost && candidateTiles.length > 0) {
                scene.selectedTowerType = type;
                for (let i = 0; i < candidateTiles.length; i++) {
                    const tile = candidateTiles[i];
                    if (grid.pathFinder.canPlaceTower(tile, scene.towers, scene.walls, scene.mirrors)) {
                        scene.handleTileClick(tile.x + 10, tile.y + 10);
                        break;
                    }
                }
            } else {
                scene.towers.forEach(t => {
                    if (t.type === 'cannon' && !t.isUpgrading && t.upgradeLevel < 5) {
                        const upCost = t.getUpgradeCost ? t.getUpgradeCost() : 100;
                        if (scene.gameStateManager.gold >= upCost) {
                            scene.gameStateManager.spendGold(upCost);
                            t.upgradeLevel++;
                        }
                    }
                });
            }
        } else if (botType === 'average' || botType === 'minmax') {
            let targetType = 'cannon';
            if (level === 2) {
                const frostCount = scene.towers.filter(t => t.type === 'frost').length;
                targetType = (frostCount < 2) ? 'frost' : 'cannon';
            } else if (level === 3) {
                const mgCount = scene.towers.filter(t => t.type === 'machinegun').length;
                targetType = (mgCount < 2) ? 'machinegun' : 'cannon';
            } else if (level === 4) {
                const mortarCount = scene.towers.filter(t => t.type === 'mortar').length;
                targetType = (mortarCount < 2) ? 'mortar' : 'machinegun';
            } else if (level === 5) {
                const upgraderCount = scene.towers.filter(t => t.type === 'upgrader').length;
                targetType = (upgraderCount < 2) ? 'upgrader' : 'cannon';
            } else if (level === 6) {
                const aaCount = scene.towers.filter(t => t.type === 'aa').length;
                targetType = (aaCount < 3) ? 'aa' : 'machinegun';
            } else if (level === 7) {
                const sniperCount = scene.towers.filter(t => t.type === 'sniper').length;
                targetType = (sniperCount < 2) ? 'sniper' : 'cannon';
            } else if (level === 8) {
                const mortarCount = scene.towers.filter(t => t.type === 'mortar').length;
                const mgCount = scene.towers.filter(t => t.type === 'machinegun').length;
                const spikeCount = scene.spikes.length;
                if (mortarCount < 1) targetType = 'mortar';
                else if (mgCount < 2) targetType = 'machinegun';
                else if (spikeCount < 6) targetType = 'spike';
                else targetType = 'machinegun';
            } else if (level === 9) {
                // Tanks + Speedy: Needs Frost for speedy and Enhancer for tanks
                const frostCount = scene.towers.filter(t => t.type === 'frost').length;
                const upgraderCount = scene.towers.filter(t => t.type === 'upgrader').length;
                const mgCount = scene.towers.filter(t => t.type === 'machinegun').length;
                if (frostCount < 2) targetType = 'frost';
                else if (upgraderCount < 2) targetType = 'upgrader';
                else if (mgCount < 4) targetType = 'machinegun';
                else targetType = 'cannon';
            }

            const isTrap = targetType === 'spike';
            const pool = isTrap ? pTiles : candidateTiles;
            const cost = isTrap ? GameConfig.Spike.cost : (TOWER_CONFIG_KEYS[targetType] ? GameConfig.Tower[TOWER_CONFIG_KEYS[targetType]].cost : 20);

            if (shouldBuildNew && gold >= cost && pool.length > 0) {
                let chosenTile = pool[0];
                if (targetType === 'upgrader' && scene.towers.length > 0) {
                    const cannon = scene.towers.find(t => t.type === 'cannon') || scene.towers[0];
                    const cannonTile = grid.getTileAtPosition(cannon.x, cannon.y);
                    if (cannonTile) {
                        const adjTile = pool.find(ct => Math.abs(ct.col - cannonTile.col) <= 1 && Math.abs(ct.row - cannonTile.row) <= 1);
                        if (adjTile) chosenTile = adjTile;
                    }
                }
                scene.selectedTowerType = targetType;
                if (isTrap || grid.pathFinder.canPlaceTower(chosenTile, scene.towers, scene.walls, scene.mirrors)) {
                    scene.handleTileClick(chosenTile.x + 10, chosenTile.y + 10);
                }
            } else {
                const priorityTowers = scene.towers.filter(t => t.type !== 'cannon').concat(scene.towers.filter(t => t.type === 'cannon')).concat(scene.spikes);
                for (let i = 0; i < priorityTowers.length; i++) {
                    const t = priorityTowers[i];
                    if (!t.isUpgrading && t.upgradeLevel < 5) {
                        const upCost = t.getUpgradeCost ? t.getUpgradeCost() : 100;
                        if (scene.gameStateManager.gold >= upCost) {
                            scene.gameStateManager.spendGold(upCost);
                            t.upgradeLevel++;
                            break;
                        }
                    }
                }
            }
        }
    }

    static runComprehensiveSuite(level = 1) {
        console.log(`%c=== SIMULATING LEVEL ${level} BALANCING SUITE ===`, "color: #00E5FF; font-weight: bold; font-size: 14px;");

        const naiveRes = this.runLevelTest(level, 'naive');
        const avgRes = this.runLevelTest(level, 'average');
        const minMaxRes = this.runLevelTest(level, 'minmax');

        console.table([
            { Archetype: "Naive Bot (Mono-Cannon)", Victory: naiveRes.victory ? "WIN" : "FAIL", "Rounds Cleared": naiveRes.roundsCompleted, "Castle HP": naiveRes.finalCastleHp + "%", "Gold Left": naiveRes.finalGold + "g" },
            { Archetype: "Average Gamer Bot", Victory: avgRes.victory ? "WIN" : "FAIL", "Rounds Cleared": avgRes.roundsCompleted, "Castle HP": avgRes.finalCastleHp + "%", "Gold Left": avgRes.finalGold + "g" },
            { Archetype: "Min-Maxer Bot", Victory: minMaxRes.victory ? "WIN" : "FAIL", "Rounds Cleared": minMaxRes.roundsCompleted, "Castle HP": minMaxRes.finalCastleHp + "%", "Gold Left": minMaxRes.finalGold + "g" }
        ]);

        let verdict = "";
        if (!naiveRes.victory && avgRes.victory) {
            verdict = "PERFECT BALANCE! The level requires the specialized tower to win. Mono-Cannon fails.";
        } else if (naiveRes.victory) {
            verdict = "TOO EASY! Mono-Cannon was able to beat the level without the specialized tower.";
        } else {
            verdict = "TOO HARD! Even the Average Gamer Bot failed to complete all 10 rounds.";
        }

        console.log(`%cVERDICT: ${verdict}`, "color: #FFD700; font-weight: bold;");
        return { naiveRes, avgRes, minMaxRes, verdict };
    }
}

window.HeadlessSimulator = HeadlessSimulator;
