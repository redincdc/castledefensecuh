// Global Reusable Damage Crack Renderer
function renderDamageCracks(ctx, x, y, width, height, healthRatio) {
    if (healthRatio >= 0.99 || healthRatio <= 0) return;

    const damageRatio = 1 - healthRatio;
    const alpha = Math.min(0.85, 0.25 + damageRatio * 0.6);
    const numCracks = Math.floor(damageRatio * 5) + 1;

    ctx.save();
    ctx.strokeStyle = `rgba(15, 10, 5, ${alpha})`;
    ctx.lineWidth = Math.max(1.5, width * 0.03);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const seed = Math.abs(Math.sin(x * 12.9898 + y * 78.233)) * 43758.5453;
    const pseudoRandom = (i) => {
        const s = Math.sin(seed + i * 1.31) * 10000;
        return s - Math.floor(s);
    };

    const halfW = width / 2;
    const halfH = height / 2;

    for (let c = 0; c < numCracks; c++) {
        const startX = x + (pseudoRandom(c * 3) - 0.5) * halfW * 1.1;
        const startY = y + (pseudoRandom(c * 3 + 1) - 0.5) * halfH * 1.1;
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        let curX = startX, curY = startY;
        const segments = Math.floor(2 + damageRatio * 3);
        for (let seg = 0; seg < segments; seg++) {
            const angle = (pseudoRandom(c * 10 + seg) * Math.PI * 2);
            const len = (width * 0.12) + pseudoRandom(c * 20 + seg) * (width * 0.14);
            curX += Math.cos(angle) * len;
            curY += Math.sin(angle) * len;
            curX = Math.max(x - halfW * 0.85, Math.min(x + halfW * 0.85, curX));
            curY = Math.max(y - halfH * 0.85, Math.min(y + halfH * 0.85, curY));
            ctx.lineTo(curX, curY);
            if (damageRatio > 0.45 && pseudoRandom(c * 30 + seg) > 0.5) {
                const branchAngle = angle + (pseudoRandom(c * 40 + seg) > 0.5 ? 0.75 : -0.75);
                const branchLen = len * 0.55;
                ctx.moveTo(curX, curY);
                ctx.lineTo(curX + Math.cos(branchAngle) * branchLen, curY + Math.sin(branchAngle) * branchLen);
                ctx.moveTo(curX, curY);
            }
        }
        ctx.stroke();
    }
    ctx.restore();
}

// Global Reusable Ash Death Effect Renderer (for Flame, Tesla, Laser) — v5.19 cartoon sequence (~1.25s):
// char black -> eyes blink twice -> body collapses into an ash pile while the eyes hang in the air ->
// eyes drop into the pile -> a gust of wind blows the ash away. Eyes stay upright (no rotation).
function renderAshDeathEffect(ctx, effect) {
    const t = effect.time, r = effect.size / 2;
    if (t >= 1250) return;
    ctx.save();
    ctx.translate(effect.x, effect.y);
    const groundY = r * 0.85;
    const eyeY0 = -r * 0.15, eyeDX = r * 0.3, eyeR = Math.max(2.2, r * 0.2);
    let eyeY = eyeY0, eyeSquash = 1, eyesOn = true, pile = 0, bodyScaleY = 1, bodyScaleX = 1;
    if (t < 120) {
        // 1) turn black: colored body cross-fades to a charred silhouette
        const k = t / 120;
        if (effect.colorCanvas) { ctx.globalAlpha = 1 - k; ctx.drawImage(effect.colorCanvas, -effect.colorCanvas.width / 2, -effect.colorCanvas.height / 2); }
        ctx.globalAlpha = k;
        ctx.drawImage(effect.canvas, -effect.canvas.width / 2, -effect.canvas.height / 2);
        ctx.globalAlpha = 1;
        eyesOn = k > 0.6;
    } else if (t < 420) {
        // 2) two fast blinks
        ctx.drawImage(effect.canvas, -effect.canvas.width / 2, -effect.canvas.height / 2);
        const b = (t - 120) / 300;
        if ((b > 0.15 && b < 0.3) || (b > 0.55 && b < 0.7)) eyeSquash = 0.08;
    } else if (t < 620) {
        // 3) collapse into an ash pile; eyes hang where they were
        const k = (t - 420) / 200, e = k * k;
        bodyScaleY = 1 - 0.85 * e; bodyScaleX = 1 + 0.35 * e;
        ctx.save();
        ctx.translate(0, groundY);
        ctx.scale(bodyScaleX, bodyScaleY);
        ctx.translate(0, -groundY);
        ctx.drawImage(effect.canvas, -effect.canvas.width / 2, -effect.canvas.height / 2);
        ctx.restore();
        pile = e;
    } else {
        pile = 1;
        if (t < 760) {
            // 4) eyes hang in mid-air for a beat (tiny wobble)
            eyeY = eyeY0 + Math.sin((t - 620) / 25) * 0.6;
        } else if (t < 880) {
            // 5) eyes drop into the pile (gravity ease-in), squash on landing
            const k = (t - 760) / 120;
            eyeY = eyeY0 + (groundY - r * 0.1 - eyeY0) * k * k;
            if (k > 0.85) eyeSquash = 0.45;
        } else {
            eyesOn = false;
        }
    }
    // ash pile + wind gust
    if (pile > 0) {
        const pw = r * 1.1 * Math.min(1, pile + 0.2), ph = r * 0.45 * pile;
        if (t < 880) {
            ctx.fillStyle = '#2a2a2a';
            ctx.beginPath(); ctx.ellipse(0, groundY, pw, Math.max(1, ph), 0, Math.PI, 0); ctx.fill();
            ctx.fillStyle = '#444';
            ctx.beginPath(); ctx.ellipse(-pw * 0.3, groundY - ph * 0.4, pw * 0.35, Math.max(1, ph * 0.45), 0, 0, Math.PI * 2); ctx.fill();
        } else {
            // 6) gust: the pile shrinks while ash flakes drift sideways and fade
            const k = (t - 880) / 370, dir = effect.windDir || 1;
            if (k < 0.6) {
                const sk = 1 - k / 0.6;
                ctx.fillStyle = '#2a2a2a';
                ctx.beginPath(); ctx.ellipse(dir * k * r * 0.6, groundY, pw * sk, Math.max(0.5, ph * sk), 0, Math.PI, 0); ctx.fill();
            }
            const flakes = effect.flakes || [];
            for (let i = 0; i < flakes.length; i++) {
                const f = flakes[i], fk = Math.max(0, Math.min(1, (k - f.d) / (1 - f.d)));
                if (fk <= 0) continue;
                ctx.globalAlpha = (1 - fk) * 0.9;
                ctx.fillStyle = f.c;
                const fx = f.x * pw + dir * fk * r * f.v * 3.2, fy = groundY - f.y * ph - fk * r * f.up + Math.sin(fk * 9 + i) * 1.5;
                ctx.fillRect(fx, fy, f.s, f.s);
            }
            ctx.globalAlpha = 1;
            // wind streaks
            ctx.strokeStyle = 'rgba(255,255,255,' + (0.35 * (1 - k)).toFixed(2) + ')'; ctx.lineWidth = 1.5;
            for (let i = 0; i < 2; i++) {
                const sy = groundY - r * (0.2 + i * 0.5), sx = -r * 1.4 + dir * k * r * 2.6;
                ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo(sx + dir * r * 0.6, sy - r * 0.25, sx + dir * r * 1.2, sy); ctx.stroke();
            }
        }
    }
    if (eyesOn) {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.ellipse(-eyeDX, eyeY, eyeR, Math.max(0.3, eyeR * eyeSquash), 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(eyeDX, eyeY, eyeR, Math.max(0.3, eyeR * eyeSquash), 0, 0, Math.PI * 2); ctx.fill();
        if (eyeSquash > 0.5) {
            ctx.fillStyle = '#000';
            ctx.beginPath(); ctx.arc(-eyeDX, eyeY, eyeR * 0.45, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(eyeDX, eyeY, eyeR * 0.45, 0, Math.PI * 2); ctx.fill();
        }
    }
    ctx.restore();
}

// Global Reusable Structure Health Bar Renderer
function renderStructureHealthBar(ctx, x, y, width, healthRatio) {
    if (healthRatio >= 0.99 || healthRatio <= 0) return;

    const barW = Math.max(22, width * 0.65);
    const barH = 5;
    const barX = x - barW / 2;
    // Unify bar position: slightly below the top edge
    const barY = y - (width / 2) + 6;

    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);

    ctx.fillStyle = '#CC2222';
    ctx.fillRect(barX, barY, barW, barH);

    const healthColor = healthRatio > 0.5 ? '#4CAF50' : (healthRatio > 0.25 ? '#FF9800' : '#F44336');
    ctx.fillStyle = healthColor;
    ctx.fillRect(barX, barY, barW * healthRatio, barH);

    ctx.restore();
}

// BuildableEntity — base class for entities with build/destroy phases
class BuildableEntity {
    constructor() {
        this.isBuilt = false;
        this.buildProgress = 0;
        this.isDestroying = false;
        this.destroyProgress = 0;
        this.maxHealth = 60;
        this.health = 60;
        this.lastHitTime = 0;
        this.totalInvested = 0;
    }

    getSellPrice() {
        const ratio = (GameConfig && GameConfig.sellRefundRatio !== undefined) ? GameConfig.sellRefundRatio : 0.50;
        const invested = (this.totalInvested !== undefined && this.totalInvested > 0) ? this.totalInvested : (this.cost || 0);
        const healthRatio = (this.maxHealth && this.maxHealth > 0) ? Math.max(0, Math.min(1, this.health / this.maxHealth)) : 1;
        return Math.max(0, Math.floor(invested * ratio * healthRatio));
    }

    takeDamage(amount, source) {
        if (!this.isBuilt || this.isDestroying || this.isSpike) return;
        this.health = Math.max(0, this.health - amount);
        this.lastHitTime = Date.now();

        if (window.logManager && amount >= 0.5) {
            const attacker = source ? (source.type || "BKR") : "BKR";
            window.logManager.log(`${getLogId(this.type)} -${Math.round(amount)} (${getLogId(attacker)})`, "DAMAGE");
        }

        if (this.health <= 0) {
            this.startDestroy();
        }
    }

    getRepairCost() {
        if (this.health >= this.maxHealth) return 0;
        const invested = (this.totalInvested !== undefined && this.totalInvested > 0) ? this.totalInvested : (this.cost || 50);
        const missingRatio = (this.maxHealth - this.health) / (this.maxHealth || 1);
        // Repair cost is proportional to missing HP (75% max of total investment) and hard-capped at totalInvested
        const rawCost = Math.ceil(invested * missingRatio * 0.75);
        const maxAllowed = Math.max(1, invested);
        return Math.max(1, Math.min(rawCost, maxAllowed));
    }

    repair(gameStateManager) {
        if (this.isDestroying || this.health >= this.maxHealth) return false;
        const cost = this.getRepairCost();
        if (gameStateManager.spendGold(cost)) {
            this.health = this.maxHealth;
            if (window.gameScene) window.gameScene.showTowerPopup(this);
            return true;
        }
        return false;
    }

    getHealthRatio() {
        return Math.max(0, Math.min(1, (this.health || 0) / (this.maxHealth || 1)));
    }

    getPerformanceFactor() {
        // Weapon performance drops smoothly from 1.0 (at 100% HP) down to 0.5 (near 0% HP)
        const ratio = this.getHealthRatio();
        return 0.5 + 0.5 * ratio;
    }

    getBuildProgress() {
        if (this.isDestroying) return Math.max(0, 1 - this.destroyProgress);
        return Math.min(1, this.buildProgress);
    }

    startDestroy() {
        if (this.isDestroying || !this.isBuilt) return false;
        this.isDestroying = true;
        this.destroyProgress = 0;
        if (window.gameScene && window.gameScene.resetFastForward) {
            window.gameScene.resetFastForward();
        }
        return true;
    }

    // Shared build/destroy update — returns true when destroy completes
    updateBuildDestroy(deltaTime, castle) {
        // God mode: instant build/destroy (100x speed)
        const speedMult = 1;
        if (this.isDestroying) {
            this.destroyProgress += deltaTime * 1000 / this.baseDestroyTime * getHealthRatio(castle) * speedMult;
            return this.destroyProgress >= 1;
        }
        if (!this.isBuilt) {
            this.buildProgress += deltaTime * 1000 / this.baseBuildTime * getHealthRatio(castle) * speedMult;
            if (this.buildProgress >= 1) {
                this.isBuilt = true;
                if (window.gameScene) window.gameScene._entitiesDirty = true;
                window.gameScene?.updateLaserPaths?.();
                if (this.isLaser) {
                    window.gameScene?.soundManager?.playLightsaberIgnite();
                } else if (!this.isLilypad) {
                    window.gameScene?.soundManager?.playUpgradeComplete();
                }
            }
        }
        return false;
    }

    // Shared progress ring renderer — draws build (clockwise) or destroy (counterclockwise) arc
    renderProgressRing(ctx, x, y, ringRadius, buildColor, options = {}) {
        const lineWidth = options.lineWidth !== undefined ? options.lineWidth : 5;
        const isUpgrade = options.isUpgrade !== undefined ? options.isUpgrade : false;
        const upgradeProgress = options.upgradeProgress !== undefined ? options.upgradeProgress : 0;
        const upgradeColor = options.upgradeColor !== undefined ? options.upgradeColor : '#AA44FF';

        ctx.save();
        // Background ring
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        ctx.arc(x, y, ringRadius, 0, Math.PI * 2);
        ctx.stroke();

        if (this.isDestroying) {
            const progress = this.getBuildProgress();
            ctx.strokeStyle = '#FF4444';
            ctx.lineWidth = lineWidth;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.arc(x, y, ringRadius, -Math.PI / 2 + Math.PI * 2 * (1 - progress), -Math.PI / 2 + Math.PI * 2);
            ctx.stroke();

            // X mark
            ctx.strokeStyle = '#FF0000';
            ctx.lineWidth = 3;
            const xs = ringRadius * 0.4;
            ctx.beginPath();
            ctx.moveTo(x - xs, y - xs); ctx.lineTo(x + xs, y + xs);
            ctx.moveTo(x + xs, y - xs); ctx.lineTo(x - xs, y + xs);
            ctx.stroke();
        } else if (isUpgrade) {
            const progress = Math.min(1, upgradeProgress);
            ctx.strokeStyle = upgradeColor;
            ctx.lineWidth = lineWidth;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.arc(x, y, ringRadius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
            ctx.stroke();

            // Up arrow
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = 3;
            const as = ringRadius * 0.4;
            ctx.beginPath();
            ctx.moveTo(x, y + as); ctx.lineTo(x, y - as);
            ctx.moveTo(x - as * 0.6, y - as * 0.4); ctx.lineTo(x, y - as); ctx.lineTo(x + as * 0.6, y - as * 0.4);
            ctx.stroke();
        } else {
            const progress = this.getBuildProgress();
            ctx.strokeStyle = buildColor;
            ctx.lineWidth = lineWidth;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.arc(x, y, ringRadius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
            ctx.stroke();
        }
        ctx.restore();
    }

    renderStructureOverlays(ctx) {
        if (this.isBuilt && this.health < this.maxHealth) {
            const hRatio = this.getHealthRatio();
            const s = this.size || GameConfig.Grid.tileSize || 64;

            // Rotational vibration while taking damage
            // Resets back to 0 when not recently damaged (within 250ms)
            const recentlyDamaged = (Date.now() - this.lastHitTime < 250);
            if (recentlyDamaged) {
                ctx.save();
                ctx.translate(this.x, this.y);
                const vibRotation = Math.sin(Date.now() * 0.06) * (2 * Math.PI / 180);
                ctx.rotate(vibRotation);
                ctx.translate(-this.x, -this.y);
            }

            renderDamageCracks(ctx, this.x, this.y, s, s, hRatio);
            renderStructureHealthBar(ctx, this.x, this.y, s, hRatio);

            if (recentlyDamaged) ctx.restore();
        }
    }

    render(ctx, time) {
        // Base method - children should implement their own render or renderBase/renderTop
        if (this.renderBase) this.renderBase(ctx);
        if (this.renderTop) this.renderTop(ctx, time);
    }

    renderRangeOverlay(ctx) {
        // GDD: Sniper (400/128) and Mortar (160/96)
        const range = this.range || 0;
        const minRange = this.minRange || 0;

        if (range <= 0 || range === Infinity) return;

        ctx.save();

        // 1. Blue Range Ring (Annulus: from minRange to range)
        ctx.fillStyle = 'rgba(40, 120, 255, 0.2)';
        ctx.beginPath();
        ctx.arc(this.x, this.y, range, 0, Math.PI * 2);
        if (minRange > 0) {
            // Draw inner circle in REVERSE direction to "cut" the hole
            ctx.arc(this.x, this.y, minRange, 0, Math.PI * 2, true);
        }
        ctx.fill();

        // 2. Red Dead Zone (Inner Circle: 0 to minRange)
        if (minRange > 0) {
            ctx.beginPath();
            ctx.fillStyle = 'rgba(255, 60, 60, 0.25)';
            ctx.arc(this.x, this.y, minRange, 0, Math.PI * 2);
            ctx.fill();

            // Inner border
            ctx.strokeStyle = 'rgba(255, 100, 100, 0.4)';
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        // 3. Outer Border
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(40, 120, 255, 0.5)';
        ctx.lineWidth = 2;
        ctx.arc(this.x, this.y, range, 0, Math.PI * 2);
        ctx.stroke();

        ctx.restore();
    }
}

// Castle Entity
class Castle extends BuildableEntity {
    constructor(x, y) {
        super();
        this.x = x;
        this.y = y;
        this.type = 'castle';
        this.isCastle = true;
        this.isBuilt = true; // Castle is already built when placed
        this.health = GameConfig.Castle.health;
        this.maxHealth = GameConfig.Castle.maxHealth;
        this.attackDamage = GameConfig.Castle.attackDamage;
        this.upgradeLevel = 0;
        this.maxUpgrades = 5;
        this.lastRegenTime = 0;
        this.lastAttackTime = 0;
        this.currentTarget = null;
        this.cannonAngle = -Math.PI / 2;
        this.size = GameConfig.Castle.size;
        this.color = '#A9A9A9'; // GDD: Castle base color for UI rings
        this.range = GameConfig.Castle.cannonRange;
        this.color = '#8A7A6A'; // GDD: Define base color for UI/FX
        this.shakeTime = 0;
        this.shakeDuration = 0;
        this.lastHitTime = -1000;
        this._hasPlayedDeathSfx = false;
        this.regenMultiplier = 1;
        this.isWarningPulse = false;
        // Upgrade system: timed upgrades, castle can't fire while upgrading
        this.isUpgrading = false;
        this.upgradeProgress = 0;
        this.upgradeDuration = 0;
        this.baseUpgradeTime = 15000; // 15s base, doubles each level
    }

    getUpgradeCost() {
        // Castle upgrades start at 100g: Lvl 1: 100g, Lvl 2: 200g, Lvl 3: 400g, Lvl 4: 800g, Lvl 5: 1600g
        return 100 * Math.pow(2, this.upgradeLevel);
    }

    getUpgradeTime() {
        return this.baseUpgradeTime * Math.pow(2, this.upgradeLevel);
    }

    cancelUpgrade() {
        if (!this.isUpgrading) return false;
        this.isUpgrading = false;
        this.upgradeProgress = 0;
        if (window.gameScene) window.gameScene.showTowerPopup(this);
        return true;
    }

    startUpgrade() {
        if (this.upgradeLevel >= this.maxUpgrades || this.isUpgrading) return false;
        this.isUpgrading = true;
        this.upgradeProgress = 0;
        this.upgradeDuration = this.getUpgradeTime();
        this.currentTarget = null; // stop targeting while upgrading
        return true;
    }

    upgrade() {
        this.upgradeLevel++;
        if (window.gameScene) window.gameScene._entitiesDirty = true;
        // Castle health doubles with each upgrade
        this.maxHealth = Math.floor(this.maxHealth * 2);
        this.attackDamage = Math.floor(this.attackDamage * 2);

        // Range: 1.5 tiles base + 0.5 tiles per level
        const ts = GameConfig.Grid.tileSize || 64;
        this.range = (1.5 + 0.5 * this.upgradeLevel) * ts;

        // Heal to new max on upgrade
        this.health = this.maxHealth;
        this.isUpgrading = false;
        this.upgradeProgress = 0;
        if (this._scene && this._scene.soundManager) {
            this._scene.soundManager.playUpgradeComplete();
        }
    }

    recalcStats() {
        // GDD: Base stats for castle are scaled during upgrade() completion
    }

    update(deltaTime, currentTime, enemies, scene) {
        if (this.isDestroying || !this.isBuilt || this.health <= 0) return;

        const speedMult = getHealthRatio(this);

        // Upgrade in progress — cannot fire or regen until complete
        if (this.isUpgrading) {
            this.upgradeProgress += deltaTime * 1000 / this.upgradeDuration * speedMult;
            if (this.upgradeProgress >= 1) {
                this.upgrade();
                scene.gameStateManager.setCastleHealth(this.health);
            }
            return; // no targeting, no attacking, no regen while upgrading
        }

        // Health regeneration (paused for 1 second after taking damage)
        // Uses gameTime (scaled) for both damage cooldown and regen interval
        if (currentTime - this.lastHitTime >= 1000 && currentTime - this.lastRegenTime >= 1000) {
            this.health = Math.min(this.maxHealth, this.health + GameConfig.Castle.hpRegenSpeed * this.regenMultiplier);
            this.lastRegenTime = currentTime;
            scene.gameStateManager.setCastleHealth(this.health);
        }

        // Find target for cannons
        this.findTarget(enemies);

        // Attack if target in range
        if (this.currentTarget && currentTime - this.lastAttackTime >= (GameConfig.Castle.attackSpeed / this.getPerformanceFactor())) {
            this.attack(scene);
            this.lastAttackTime = currentTime;
        }

        // Update cannon angle to track target
        if (this.currentTarget) {
            const dx = this.currentTarget.x - this.x;
            const dy = this.currentTarget.y - this.y;
            this.cannonAngle = Math.atan2(dy, dx);
        }
    }

    findTarget(enemies) {
        let closestEnemy = null;
        let closestDistance = this.range;

        for (let i = 0; i < enemies.length; i++) {
            const enemy = enemies[i];
            if (enemy.isDead) continue;
            // Crocodiles under a Lilypad are hidden — can't be targeted
            if (enemy.isUnderLilypad && enemy.isUnderLilypad()) continue;

            const distance = dist(this.x, this.y, enemy.x, enemy.y);

            if (distance < closestDistance) {
                closestDistance = distance;
                closestEnemy = enemy;
            }
        }

        this.currentTarget = closestEnemy;
    }

    attack(scene) {
        if (!this.currentTarget) return;
        const lvl = this.upgradeLevel;
        const numCannons = lvl >= 3 ? 4 : 2;

        for (let i = 0; i < numCannons; i++) {
            let ox = 0, oy = 0;
            if (numCannons === 2) {
                ox = (i === 0 ? -15 : 15);
            } else {
                // 4 cannons in a square pattern at center
                ox = (i % 2 === 0 ? -18 : 18);
                oy = (i < 2 ? -18 : 18);
            }

            // Calculate precise mathematical angle from each individual cannon barrel to the enemy
            // so they don't fire parallel lines that miss small/fast targets
            const dx = this.currentTarget.x - (this.x + ox);
            const dy = this.currentTarget.y - (this.y + oy);
            const independentFireAngle = Math.atan2(dy, dx);

            scene.addProjectile(new Projectile(
                'castle', this.x + ox, this.y + oy, this.currentTarget,
                this.attackDamage, 400, independentFireAngle
            ));
        }
        scene?.soundManager?.playWeaponSound('cannon');
    }

    renderStructureOverlays(ctx) {
        const size = this.size;
        const healthPercent = this.health / this.maxHealth;
        this._renderCastleOverlays(ctx, size, healthPercent);
    }

    takeDamage(damage, source) {
        if (this.health <= 0) return;

        this.health -= damage;
        if (this.health <= 0) {
            this.health = 0;
            if (this._scene) {
                this._scene.gameStateManager.setCastleHealth(0);
                if (this._scene.resetFastForward) {
                    this._scene.resetFastForward();
                }
            }
            if (this._scene && this._scene.soundManager && !this._hasPlayedDeathSfx) {
                this._hasPlayedDeathSfx = true;
                this._scene.soundManager.playCastleDeath();
            }
        } else {
            if (this._scene) {
                this._scene.gameStateManager.setCastleHealth(this.health);
            }
            if (this._scene && this._scene.soundManager) {
                this._scene.soundManager.playCastleDamage();
            }
        }

        // Native vibration when castle takes damage
        if (typeof Android !== 'undefined' && this._scene?.soundManager?.vibrationEnabled) {
            Android.vibrate(Math.floor(this.health <= 0 ? 300 : 50));
        }

        // Use real system time for visual feedback timers
        this.lastHitTime = Date.now();
        this.shakeTime = Date.now();
        this.shakeDuration = 500;
    }

    _renderCastleOverlays(ctx, size, healthPercent) {
        ctx.save();
        this._applyShake(ctx);
        // Render procedural damage cracks over the Castle footprint
        renderDamageCracks(ctx, 0, 0, size, size, healthPercent);
        // Render structure health bar using the global utility
        renderStructureHealthBar(ctx, 0, 0, size, healthPercent);
        ctx.restore();
    }

    _applyShake(ctx) {
        const now = Date.now();
        const elapsed = now - this.shakeTime;
        if (elapsed >= 0 && elapsed < this.shakeDuration) {
            const progress = elapsed / this.shakeDuration;
            const intensity = Math.pow(1 - progress, 1.5); // Ease-out decay
            const offsetX = Math.sin(elapsed * 0.12) * 8 * intensity; // ±8px X rumble
            const offsetY = Math.cos(elapsed * 0.15) * 6 * intensity; // ±6px Y rumble
            const shakeAngle = Math.sin(elapsed * 0.09) * 0.12 * intensity; // ±7° rotational rumble

            ctx.translate(this.x + offsetX, this.y + offsetY);
            ctx.rotate(shakeAngle);
        } else {
            ctx.translate(this.x, this.y);
        }
    }

    renderBase(ctx) {
        const size = this.size;
        const healthPercent = this.health / this.maxHealth;
        const s = size / 2;
        const lvl = this.upgradeLevel;

        const img = window.textureManager.getImage('grid', 'castle');

        ctx.save();
        this._applyShake(ctx);

        if (img) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'; ctx.beginPath(); ctx.ellipse(0, s, s * 1.1, s * 0.4, 0, 0, Math.PI * 2); ctx.fill();
            ctx.drawImage(img, -s, -s, size, size);
            ctx.restore();
            this._renderCastleOverlays(ctx, size, healthPercent);
            return;
        }

        // --- 1. Large Shadow ---
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.beginPath();
        ctx.ellipse(0, s * 0.05, size * 0.55, size * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();

        // Colors
        const baseColor = '#707070';
        const trimColor = '#505050';
        const highlighting = 'rgba(255,255,255,0.1)';

        // --- 2. Main Foundation (2x2 Platform) ---
        ctx.fillStyle = baseColor;
        ctx.fillRect(-s, -s, size, size);

        // Foundation trim
        ctx.strokeStyle = trimColor;
        ctx.lineWidth = 4;
        ctx.strokeRect(-s + 2, -s + 2, size - 4, size - 4);

        // Stone Floor Pattern (Level 1+)
        if (lvl >= 1) {
            ctx.strokeStyle = 'rgba(0,0,0,0.15)';
            ctx.lineWidth = 1;
            const step = size / 4;
            for (let i = -s + step; i < s; i += step) {
                ctx.beginPath(); ctx.moveTo(i, -s); ctx.lineTo(i, s); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(-s, i); ctx.lineTo(s, i); ctx.stroke();
            }
        }

        // --- 3. Outer Defensive Walls ---
        ctx.fillStyle = '#8A7A6A';
        var scale = GameConfig.scale || 1.0;
        var wallW = (10 + lvl * 2) * scale;
        // Draw walls on all 4 sides with gaps for corners
        ctx.fillRect(-s, -s + 15 * scale, wallW, size - 30 * scale); // Left
        ctx.fillRect(s - wallW, -s + 15 * scale, wallW, size - 30 * scale); // Right
        ctx.fillRect(-s + 15 * scale, -s, size - 30 * scale, wallW); // Top
        ctx.fillRect(-s + 15 * scale, s - wallW, size - 30 * scale, wallW); // Bottom

        // --- 4. Massive Corner Bastions ---
        const bS = s * (0.4 + lvl * 0.05); // Larger bastions
        ctx.fillStyle = '#7A6A5A';

        const bastions = [
            { x: -s, y: -s }, { x: s - bS, y: -s },
            { x: -s, y: s - bS }, { x: s - bS, y: s - bS }
        ];

        bastions.forEach(pos => {
            // Draw Bastion Base
            ctx.fillStyle = '#7A6A5A';
            ctx.fillRect(pos.x, pos.y, bS, bS);

            // Bastion Detail (Top ring)
            ctx.fillStyle = highlighting;
            ctx.fillRect(pos.x, pos.y, bS, wallW / 2);

            // Outline
            ctx.strokeStyle = 'rgba(0,0,0,0.3)';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(pos.x, pos.y, bS, bS);
        });

        // --- 5. Inner Sanctum (Level 2+) ---
        if (lvl >= 2) {
            const sanctumSize = size * 0.5;
            ctx.fillStyle = '#606060';
            ctx.fillRect(-sanctumSize/2, -sanctumSize/2, sanctumSize, sanctumSize);
            ctx.strokeStyle = '#404040';
            ctx.strokeRect(-sanctumSize/2, -sanctumSize/2, sanctumSize, sanctumSize);
        }

        // --- 6. Magical Core / Garden (Level 5) ---
        if (lvl >= 5) {
            const pulse = 0.5 + Math.sin(Date.now() / 200) * 0.5;
            const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 0.6);
            grad.addColorStop(0, `rgba(100, 200, 255, ${0.5 * pulse})`);
            grad.addColorStop(1, 'rgba(100, 200, 255, 0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(0, 0, s * 0.6, 0, Math.PI * 2);
            ctx.fill();

            // Floating crystals
            for (let i = 0; i < 4; i++) {
                const a = (Date.now() / 1000) + (i * Math.PI / 2);
                const r = s * 0.3;
                ctx.fillStyle = '#E0F7FF';
                ctx.fillRect(Math.cos(a) * r - 4, Math.sin(a) * r - 4, 8, 8);
            }
        }

        ctx.restore();
    }

    renderTop(ctx) {
        const size = this.size, s = size / 2;
        const lvl = this.upgradeLevel;
        ctx.save();
        this._applyShake(ctx);

        const img = window.textureManager.getImage('grid', 'castle');
        if (img) {
            ctx.restore();
            return;
        }

        // --- 1. The High Keep (Center) ---
        const keepSize = size * 0.45;
        ctx.fillStyle = '#3D2B1F'; // Dark Wood/Thatch
        if (lvl >= 3) ctx.fillStyle = '#2A2A2A'; // Slate/Metal

        ctx.fillRect(-keepSize/2, -keepSize/2, keepSize, keepSize);

        // Roof details
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-keepSize/2, -keepSize/2); ctx.lineTo(keepSize/2, keepSize/2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(keepSize/2, -keepSize/2); ctx.lineTo(-keepSize/2, keepSize/2); ctx.stroke();

        // --- 2. Heavy Battlements (Perimeter) ---
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        var scale = GameConfig.scale || 1.0;
        var notchSize = 6 * scale;
        for (var i = -s; i < s; i += notchSize * 2) {
            ctx.fillRect(i, -s, notchSize, notchSize); // North
            ctx.fillRect(i, s - notchSize, notchSize, notchSize); // South
            ctx.fillRect(-s, i, notchSize, notchSize); // West
            ctx.fillRect(s - notchSize, i, notchSize, notchSize); // East
        }

        // --- 3. Center Flag Array ---
        const flagCount = lvl >= 4 ? 3 : 1;
        for (let i = 0; i < flagCount; i++) {
            const fx = (i - (flagCount-1)/2) * 15 * scale;
            const fy = -10 * scale;
            ctx.fillStyle = '#333';
            ctx.beginPath(); ctx.arc(fx, fy, 2.5 * scale, 0, Math.PI * 2); ctx.fill();

            const wave = Math.sin(Date.now() * 0.006 + i) * 4 * scale;
            ctx.fillStyle = '#E74C3C'; // Red flag on all towers (including middle tower)
            ctx.beginPath();
            ctx.moveTo(fx, fy);
            ctx.lineTo(fx + 18 * scale, fy - 6 * scale + wave);
            ctx.lineTo(fx + 14 * scale, fy + 6 * scale);
            ctx.closePath();
            ctx.fill();
        }

        // --- 4. Centered Defense Array ---
        // Cannons are now moved to the center hub
        const cLen = (22 + lvl * 2) * scale, cW = (8 + lvl * 0.6) * scale;
        const numCannons = lvl >= 3 ? 4 : 2;

        for (let i = 0; i < numCannons; i++) {
            ctx.save();
            // Position in center hub
            if (numCannons === 2) {
                ctx.translate((i === 0 ? -15 : 15) * scale, 0);
            } else {
                const ox = (i % 2 === 0 ? -18 : 18) * scale;
                const oy = (i < 2 ? -18 : 18) * scale;
                ctx.translate(ox, oy);
            }

            // Rotating Turret Base
            ctx.fillStyle = '#444';
            ctx.beginPath(); ctx.arc(0, 0, 10 * scale, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#222';
            ctx.lineWidth = 2 * scale;
            ctx.stroke();

            // Centered Barrel
            ctx.rotate(this.cannonAngle);

            // Shading
            const grad = ctx.createLinearGradient(0, -cW/2, 0, cW/2);
            grad.addColorStop(0, '#333');
            grad.addColorStop(0.5, '#444');
            grad.addColorStop(1, '#222');
            ctx.fillStyle = grad;

            ctx.fillRect(0, -cW / 2, cLen, cW);

            // Muzzle Reinforcement (Grows with level)
            ctx.fillStyle = '#111';
            ctx.fillRect(cLen - 6 * scale, -cW/2 - 2 * scale, 6 * scale, cW + 4 * scale);

            ctx.restore();
        }

        ctx.restore();
    }
}
