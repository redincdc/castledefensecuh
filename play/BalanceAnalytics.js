/**
 * BalanceAnalytics.js - Sophisticated Balance-Analytics & Adaptive Difficulty System
 * Collects per-enemy instance telemetry, computes per-round aggregates, and adjusts
 * enemy HP and count multipliers using a band-targeted, smoothed error algorithm.
 */

class BalanceAnalytics {
    constructor() {
        this.activeEnemies = {}; // Plain object for ES5 compatibility
        this.currentRoundRecords = [];
        this.roundStartTime = 0;

        // Economy & Castle tracking
        this.goldEarnedThisRound = 0;
        this.goldSpentThisRound = 0;
        this.castleHpAtRoundStart = 100;

        // Tower Telemetry
        this.towerDamageDealt = {}; // { towerType: totalDamage }
        this.towerActiveTime = {};   // { towerType: activeSeconds }

        // Adaptive Multiplier State
        this.smoothedError = 0.0;
        this.adaptiveHpMult = 1.0;
        this.adaptiveCountMult = 1.0;
        this.lastSummary = null;

        this.nextEnemyId = 1;
    }

    reset() {
        this.activeEnemies = {};
        this.currentRoundRecords = [];
        this.roundStartTime = Date.now();
        this.goldEarnedThisRound = 0;
        this.goldSpentThisRound = 0;
        this.castleHpAtRoundStart = 100;
        this.towerDamageDealt = {};
        this.towerActiveTime = {};
        this.smoothedError = 0.0;
        this.adaptiveHpMult = 1.0;
        this.adaptiveCountMult = 1.0;
        this.lastSummary = null;
        this.nextEnemyId = 1;

        if (window.logManager) {
            window.logManager.log("Session Reset | Baseline HP Mult: 1.00x | Count Mult: 1.00x", "STATS");
            window.logManager.log("Session Reset | Baseline Telemetry Initialized", "AVG");
        }
    }

    // --- Event Hooks ---

    onEnemySpawn(enemy, gameTimeMs) {
        if (!enemy) return;
        const id = 'e_' + this.nextEnemyId++;
        enemy._analyticsId = id;

        const record = {
            enemyId: id,
            type: enemy.type || 'unknown',
            isBoss: !!enemy.isBoss,
            spawnTimeMs: gameTimeMs || 0,
            deathTimeMs: 0,
            timeAliveSeconds: 0,
            progress: 0.0,
            breached: false,
            maxHp: enemy.maxHealth || 1,
            hpAtDeath: enemy.health || 0,
            finalBlowDamage: 0,
            unusedHpFraction: 0.0,
            killedByTowerType: null,
            damageSourceBreakdown: {}, // { towerType: amount }
            slowUptimeSeconds: 0.0,
            lastSlowCheckTimeMs: gameTimeMs || 0
        };

        this.activeEnemies[id] = record;
    }

    onEnemyHit(enemy, towerType, damage, gameTimeMs) {
        if (!enemy || !enemy._analyticsId) return;
        const record = this.activeEnemies[enemy._analyticsId];
        if (!record) return;

        const type = towerType || 'other';
        record.damageSourceBreakdown[type] = (record.damageSourceBreakdown[type] || 0) + damage;

        // Accumulate tower damage for telemetry
        this.towerDamageDealt[type] = (this.towerDamageDealt[type] || 0) + damage;

        // Track slow uptime
        if (enemy.slowMult && enemy.slowMult < 1.0) {
            const dt = Math.max(0, (gameTimeMs - record.lastSlowCheckTimeMs) / 1000);
            record.slowUptimeSeconds += dt;
        }
        record.lastSlowCheckTimeMs = gameTimeMs;
    }

    onEnemyDeath(enemy, finalBlowDamage, killerTowerType, gameTimeMs) {
        if (!enemy || !enemy._analyticsId) return;
        const record = this.activeEnemies[enemy._analyticsId];
        if (!record) return;

        record.deathTimeMs = gameTimeMs || Date.now();
        record.timeAliveSeconds = Math.max(0.1, (record.deathTimeMs - record.spawnTimeMs) / 1000);

        // Distance ratio along path
        const ratio = enemy.distanceTraveled / (enemy.totalPathLength || 1);
        record.progress = Math.min(1.0, Math.max(0.0, ratio));
        record.breached = false;

        record.hpAtDeath = Math.max(0, enemy.health + finalBlowDamage); // HP right before final hit
        record.finalBlowDamage = finalBlowDamage || 0;

        const overkill = Math.max(0, finalBlowDamage - record.hpAtDeath);
        record.unusedHpFraction = Math.min(1.0, overkill / record.maxHp);

        record.killedByTowerType = killerTowerType || null;

        this.currentRoundRecords.push(record);
        delete this.activeEnemies[enemy._analyticsId];
    }

    onEnemyBreach(enemy, castle, gameTimeMs) {
        if (!enemy || !enemy._analyticsId) return;
        const record = this.activeEnemies[enemy._analyticsId];
        if (!record) return;

        record.deathTimeMs = gameTimeMs || Date.now();
        record.timeAliveSeconds = Math.max(0.1, (record.deathTimeMs - record.spawnTimeMs) / 1000);
        record.progress = 1.0; // Breached castle
        record.breached = true;
        record.hpAtDeath = enemy.health || 0;
        record.finalBlowDamage = 0;
        record.unusedHpFraction = 0.0;
        record.killedByTowerType = null;

        this.currentRoundRecords.push(record);
        delete this.activeEnemies[enemy._analyticsId];
    }

    onGoldEarned(amount) {
        if (amount > 0) this.goldEarnedThisRound += amount;
    }

    onGoldSpent(amount) {
        if (amount > 0) this.goldSpentThisRound += amount;
    }

    onRoundStart(gameScene) {
        this.currentRoundRecords = [];
        this.goldEarnedThisRound = 0;
        this.goldSpentThisRound = 0;
        this.towerDamageDealt = {};
        this.towerActiveTime = {};
        this.roundStartTime = gameScene ? gameScene.gameTime : 0;
        if (gameScene && gameScene.castle) {
            this.castleHpAtRoundStart = gameScene.castle.health;
        }
        const roundNum = gameScene?.gameStateManager?.round || 1;
        GameLogger.info(`--- ROUND ${roundNum} STARTED ---`);

        if (window.logManager) {
            window.logManager.log(`Rnd ${roundNum} START: HP Mult ${this.adaptiveHpMult.toFixed(2)}x | Count Mult ${this.adaptiveCountMult.toFixed(2)}x`, "STATS");
            window.logManager.log(`Rnd ${roundNum} INIT: Awaiting wave telemetry...`, "AVG");
        }
    }

    // --- Adaptive Evaluation Algorithm ---

    evaluateRound(gameScene) {
        const roundNum = gameScene ? gameScene.gameStateManager.round : 1;
        const roundDurationSeconds = Math.max(1.0, (gameScene ? gameScene.gameTime : 0) - this.roundStartTime);
        const totalRecords = this.currentRoundRecords.length;

        if (totalRecords === 0) {
            GameLogger.warn(`Round ${roundNum} Ended: No enemy records collected.`);
            return;
        }

        // 1. Progress & Breach Aggregates
        let sumProgress = 0;
        let breachCount = 0;
        let sumOverkill = 0;
        const progressList = [];

        for (let i = 0; i < totalRecords; i++) {
            const r = this.currentRoundRecords[i];
            sumProgress += r.progress;
            progressList.push(r.progress);
            if (r.breached) breachCount++;
            sumOverkill += r.unusedHpFraction;
        }

        progressList.sort(function(a, b) { return a - b; });
        const avgProgress = sumProgress / totalRecords;

        // 90th percentile
        const p90Idx = Math.min(progressList.length - 1, Math.floor(progressList.length * 0.90));
        const p90Progress = progressList[p90Idx];

        const breachRate = breachCount / totalRecords;
        const avgOverkill = sumOverkill / totalRecords;

        // Castle HP Loss
        const castleMaxHp = gameScene && gameScene.castle ? gameScene.castle.maxHealth : 100;
        const currentCastleHp = gameScene && gameScene.castle ? gameScene.castle.health : 100;
        const castleHpLost = Math.max(0, this.castleHpAtRoundStart - currentCastleHp);
        const castleHpLostRatio = castleHpLost / Math.max(1, castleMaxHp);

        // 2. Weighted Signal & Dynamic Target Progress Band Calculation
        const effectiveProgress = (0.60 * avgProgress) + (0.40 * p90Progress);

        let bandMin = 0.70;
        let bandMax = 0.85;
        if (roundNum <= 15) {
            bandMin = 0.20;
            bandMax = 0.50;
        } else if (roundNum <= 35) {
            bandMin = 0.25;
            bandMax = 0.70;
        }

        let rawProgressError = 0.0;
        if (effectiveProgress > bandMax) {
            rawProgressError = effectiveProgress - bandMax; // Struggling (+ error)
        } else if (effectiveProgress < bandMin) {
            rawProgressError = effectiveProgress - bandMin; // Dominating (- error)
        } else {
            rawProgressError = 0.0; // Inside Target Band
        }

        // GDD §9a: Breach Penalty (Emergency brake if enemies leak or hit castle)
        const breachPenalty = (0.65 * breachRate) + (0.35 * castleHpLostRatio);

        // Additive Error Signal
        const roundError = rawProgressError + breachPenalty;

        // 3. EMA Smoothing (alpha = 0.35 for smooth trajectory response)
        const alpha = 0.35;
        this.smoothedError = (alpha * roundError) + ((1 - alpha) * this.smoothedError);

        // 4. Clamping & Multiplier Updates (Step capped at ±5.00% for R1-35, ±8.00% for R36+)
        const maxStep = roundNum <= 35 ? 0.05 : 0.08;
        const rawAdjustment = -1.0 * this.smoothedError;
        const clampedStep = Math.max(-maxStep, Math.min(maxStep, rawAdjustment));

        this.adaptiveHpMult = Math.max(0.50, Math.min(10.00, this.adaptiveHpMult + clampedStep));
        this.adaptiveCountMult = Math.max(0.70, Math.min(2.50, this.adaptiveCountMult + (0.50 * clampedStep)));

        // 5. Per-Tower Telemetry Summary
        const towerSummary = {};
        if (gameScene) {
            const allTowers = [].concat(gameScene.towers, gameScene.spikes, gameScene.mirrors, gameScene.Lilypads);
            if (gameScene.castle) allTowers.push(gameScene.castle);

            const towerTypeStats = {};
            for (let i = 0; i < allTowers.length; i++) {
                const t = allTowers[i];
                const type = t.isCastle ? 'castle' : t.type;
                if (!towerTypeStats[type]) towerTypeStats[type] = { count: 0, sumDps: 0 };

                let dps = 0;
                if (t.getDps) {
                    dps = parseFloat(t.getDps());
                } else if (t.isCastle) {
                    // Castle DPS: dmg * numCannons / (speed / 1000)
                    const numCannons = t.upgradeLevel >= 3 ? 4 : 2;
                    dps = (t.attackDamage * numCannons) / (GameConfig.Castle.attackSpeed / 1000);
                } else if (t.isSpike) {
                    const dmg = t.getDamage ? t.getDamage() : 6;
                    dps = dmg / (GameConfig.Spike.damageInterval / 1000);
                } else if (t.isLilypad) {
                    const dmg = GameConfig.Lilypad.damage[Math.min(t.upgradeLevel, 5)] || 0;
                    dps = dmg / (GameConfig.Lilypad.damageInterval / 1000);
                } else {
                    // Fallback for types that rely on GameConfig directly (like Machine Gun)
                    const cfg = GameConfig.Tower[TOWER_CONFIG_KEYS[type] || 'MachineGun'];
                    if (cfg && cfg.damage && cfg.fireRate) {
                        dps = (cfg.damage * (1 + 0.5 * t.upgradeLevel)) / (cfg.fireRate / 1000);
                    }
                }

                towerTypeStats[type].count++;
                towerTypeStats[type].sumDps += dps;
            }

            for (var type in this.towerDamageDealt) {
                var totalDmg = this.towerDamageDealt[type] || 0;
                var stats = towerTypeStats[type] || { count: 1, sumDps: 0 };
                // Per-Tower Average Realized DPS
                var realizedDps = (totalDmg / roundDurationSeconds / Math.max(1, stats.count)).toFixed(1);
                var avgTheorDps = (stats.sumDps / Math.max(1, stats.count)).toFixed(1);

                towerSummary[type] = {
                    placed: stats.count,
                    realizedDps: realizedDps,
                    theorDps: avgTheorDps,
                    totalDmg: Math.round(totalDmg)
                };
            }
        }

        // Store summary for diagnostics
        this.lastSummary = {
            round: roundNum,
            avgProgress: avgProgress.toFixed(2),
            p90Progress: p90Progress.toFixed(2),
            effectiveProgress: effectiveProgress.toFixed(2),
            targetBandStr: '[' + bandMin.toFixed(2) + '-' + bandMax.toFixed(2) + ']',
            breachCount: breachCount,
            breachRate: (breachRate * 100).toFixed(1) + '%',
            castleHpLost: castleHpLost,
            roundError: roundError.toFixed(3),
            smoothedError: this.smoothedError.toFixed(3),
            clampedStep: (clampedStep * 100).toFixed(2) + '%',
            newHpMult: this.adaptiveHpMult.toFixed(2) + 'x',
            newCountMult: this.adaptiveCountMult.toFixed(2) + 'x',
            goldEarned: this.goldEarnedThisRound,
            goldSpent: this.goldSpentThisRound,
            netGold: this.goldEarnedThisRound - this.goldSpentThisRound
        };

        // Output structured summary to GameLogger
        this.logSummary(towerSummary);

        // Persistent Session Logging
        if (window.logManager) {
            window.logManager.logWeaponStats(roundNum, {
                sum: this.lastSummary,
                tel: towerSummary
            });

            let damageDetail = 'Rnd ' + roundNum + ' DMG:';
            for(const type in towerSummary) {
                damageDetail += ' | ' + getLogId(type) + ':' + towerSummary[type].totalDmg;
            }
            window.logManager.log(damageDetail, "DAMAGE");

            // --- ADVANCED AVERAGES (For [AVG] filter) ---
            let breachHpSum = 0, breachHpCount = 0;
            let lifespanSum = 0;
            let slowRatioSum = 0;
            let overkillSum = 0;

            for (let i = 0; i < totalRecords; i++) {
                const r = this.currentRoundRecords[i];
                if (r.breached) { breachHpSum += r.hpAtDeath; breachHpCount++; }
                lifespanSum += r.timeAliveSeconds;
                slowRatioSum += (r.slowUptimeSeconds / r.timeAliveSeconds);
                overkillSum += r.unusedHpFraction;
            }

            const avgBreachHp = breachHpCount > 0 ? (breachHpSum / breachHpCount).toFixed(1) : "0";
            const avgLifespan = (lifespanSum / totalRecords).toFixed(2);
            const avgSlowUptime = ((slowRatioSum / totalRecords) * 100).toFixed(1) + "%";
            const avgOverkill = (overkillSum / totalRecords).toFixed(2);

            let totalRealizedDps = 0;
            for (const type in towerSummary) { totalRealizedDps += parseFloat(towerSummary[type].realizedDps); }

            const avgLog = 'Rnd ' + roundNum + ' AVG: Life:' + avgLifespan + 's | K/B:' + avgProgress.toFixed(2) + ' | OK:' + avgOverkill + ' | Slow:' + avgSlowUptime + ' | Brch:' + avgBreachHp + 'HP | Gold:' + this.lastSummary.netGold + 'g | DPS:' + totalRealizedDps.toFixed(1);

            window.logManager.log(avgLog, "AVG");
        }
    }

    logSummary(towerSummary) {
        if (!this.lastSummary) return;
        const s = this.lastSummary;

        let towerLog = '';
        for (const type in towerSummary) {
            const t = towerSummary[type];
            towerLog += '\n  - ' + type.toUpperCase() + ' (' + t.placed + ' placed): Total Dmg ' + t.totalDmg + ' | Realized DPS ' + t.realizedDps + ' (Theor: ' + t.theorDps + ')';
        }

        GameLogger.info(
            '[ANALYTICS] === Round ' + s.round + ' Balance Summary ===\n' +
            'Round ' + s.round + ' Progress : Avg ' + s.avgProgress + ' | P90 ' + s.p90Progress + ' | Eff ' + s.effectiveProgress + ' (Band ' + (s.targetBandStr || '[0.70-0.85]') + ')\n' +
            'Round ' + s.round + ' Breaches : ' + s.breachCount + ' (' + s.breachRate + ') | Castle HP Lost: ' + s.castleHpLost + '\n' +
            'Round ' + s.round + ' Economy  : ' + (s.netGold >= 0 ? '+' : '') + s.netGold + 'g (Earned ' + s.goldEarned + 'g / Spent ' + s.goldSpent + 'g)\n' +
            'Round ' + s.round + ' Adaptive : Error ' + s.roundError + ' -> Smooth ' + s.smoothedError + ' -> Step ' + s.clampedStep + ' -> HP Mult: ' + s.newHpMult + ' | Count Mult: ' + s.newCountMult +
            (towerLog ? '\nTower Telemetry:' + towerLog : '') +
            '\n==========================================='
        );

        if (window.logManager) {
            window.logManager.log('Rnd ' + s.round + ' STATS: Prog ' + s.avgProgress + ' | Brch ' + s.breachRate + ' | Gold ' + s.netGold + 'g', "STATS");
        }
    }

    getHpMultiplier() {
        return this.adaptiveHpMult;
    }

    getEnemyCountMultiplier() {
        return this.adaptiveCountMult;
    }
}

// Global Instance
window.balanceAnalytics = new BalanceAnalytics();
