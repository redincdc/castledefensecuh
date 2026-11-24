class Projectile {
    constructor(towerType, x, y, target, damage, speed, angle, splashRadius = 0, owner = null) {
        this.type = towerType; // Rename towerType to type for Enemy.js takeDamage detection
        this.towerType = towerType; // Keep original for mortar check
        this.owner = owner;
        this.x = x;
        this.y = y;
        this.startX = x;
        this.startY = y;
        this.target = target;
        this.damage = damage;
        this.speed = speed;
        this.angle = angle;
        this.splashRadius = splashRadius;
        this.isDead = false;
        this.isMortar = towerType === 'mortar';
        this.isHoming = towerType === 'aa'; // ONLY AA fires heat-seeking homing rockets
        this.isFrost = false;
        this.isRocket = towerType === 'aa';
        this.slowMult = 0;
        this.slowDuration = 0;
        this.slowRadius = 0;
        this.damageMultVsTank = 1;
        this.flyerHitChance = 0;

        // Trail: use a fixed size array of reused objects to avoid GC pressure
        this.trail = [];
        this._trailLimit = 6;
        for (let i = 0; i < this._trailLimit; i++) {
            this.trail.push({ x: 0, y: 0, active: false });
        }
        this._trailIdx = 0;

        // For mortar: store target position at fire time (in case target dies)
        if (this.isMortar && target) {
            this.targetX = target.x;
            this.targetY = target.y;
            this.totalDistance = Math.sqrt(
                Math.pow(this.targetX - this.startX, 2) +
                Math.pow(this.targetY - this.startY, 2)
            );
            this.traveled = 0;
        }

        const visuals = PROJECTILE_VISUALS[towerType] || DEFAULT_PROJECTILE;
        this.color = visuals.color;
        this.size = visuals.size;
    }

    update(deltaTime, canvas, scene) {
        if (this.isDead) return;

        // Record trail position (circular buffer reuse)
        if (!this.isMortar) {
            const p = this.trail[this._trailIdx];
            p.x = this.x;
            p.y = this.y;
            p.active = true;
            this._trailIdx = (this._trailIdx + 1) % this._trailLimit;
        }

        if (this.isMortar) {
            // Mortar shell: arcs to fixed target position, then explodes
            if (this.traveled >= this.totalDistance) {
                // Impact — deal splash damage to all enemies in radius
                if (scene) {
                    const radiusSq = this.splashRadius * this.splashRadius;
                    const candidates = scene._getNearbyEnemies(this.targetX, this.targetY, this.splashRadius);

                    for (const enemy of candidates) {
                        if (enemy.isDead) continue;
                        if (enemy.type === 'flyer') continue;
                        if (enemy.isUnderLilypad && enemy.isUnderLilypad()) continue;
                        const dx = enemy.x - this.targetX;
                        const dy = enemy.y - this.targetY;
                        const distSq = dx * dx + dy * dy;
                        if (distSq <= radiusSq) {
                            // GDD §10: Mortar Splash Falloff (100% center -> 25% edge)
                            const distance = Math.sqrt(distSq);
                            const falloff = 1.0 - (distance / this.splashRadius) * 0.75;
                            enemy.takeDamage(this.damage * falloff, this);
                        }
                    }
                    // Visual explosion effect
                    scene.addExplosion(this.targetX, this.targetY, this.splashRadius);
                    scene.soundManager?.playMortarExplosion();
                }
                this.isDead = true;
                return;
            }

            // Move toward target position
            const dx = this.targetX - this.startX;
            const dy = this.targetY - this.startY;
            const moveDistance = this.speed * deltaTime;
            this.traveled += moveDistance;
            const progress = Math.min(1, this.traveled / this.totalDistance);

            // Linear interpolation for position
            this.x = this.startX + dx * progress;
            this.y = this.startY + dy * progress;

            // Arc height: parabolic — peaks at midpoint
            // arcHeight is visual only (subtracted from y to go "up")
            const arcHeight = this.totalDistance * 0.3;
            this.arcOffset = Math.sin(progress * Math.PI) * arcHeight;
        } else if (this.isHoming && this.target && !this.target.isDead) {
            // Homing projectile (AA rockets)
            const dx = this.target.x - this.x;
            const dy = this.target.y - this.y;
            const distSq = dx * dx + dy * dy;
            const distance = Math.sqrt(distSq);
            const moveDistance = this.speed * deltaTime;

            // Hit target if within 10px OR if movement in this frame covers/overshoots the remaining distance
            if (distSq <= 100 || moveDistance >= distance) {
                // Snap to target position for clean collision and damage
                this.x = this.target.x;
                this.y = this.target.y;

                let actualDamage = this.damage;
                const target = this.target;

                if (target.type === 'tank' && this.damageMultVsTank !== 1) actualDamage *= this.damageMultVsTank;

                if (target.type === 'flyer') {
                    if (this.flyerHitChance > 0 && this.flyerHitChance < 1 && Math.random() > this.flyerHitChance) {
                        scene?.soundManager?.stopAAMissileSound(this);
                        this.isDead = true;
                        return;
                    }
                }

                target.takeDamage(actualDamage, this);
                if (this.isFrost && scene) this.applyFrostSlow(scene);
                scene?.soundManager?.stopAAMissileSound(this);
                this.isDead = true;
            } else {
                this.x += (dx / distance) * moveDistance;
                this.y += (dy / distance) * moveDistance;
                this.angle = Math.atan2(dy, dx);
            }
        } else {
            // Non-Homing: Move in a perfect straight line!
            const moveDistance = this.speed * deltaTime;
            const prevX = this.x;
            const prevY = this.y;

            this.x += Math.cos(this.angle) * moveDistance;
            this.y += Math.sin(this.angle) * moveDistance;

            // Check collision with ANY enemy whose hitbox intersects our path
            if (scene) {
                for (let i = 0; i < scene.enemies.length; i++) {
                    const enemy = scene.enemies[i];
                    if (enemy.isDead) continue;
                    if (enemy.type === 'flyer' && this.flyerHitChance <= 0 && !this.isHoming) continue;
                    if (enemy.isUnderLilypad && enemy.isUnderLilypad()) continue;

                    // Hitbox math: Check if distance from enemy center to projectile's current spot is within radius
                    const dx = enemy.x - this.x;
                    const dy = enemy.y - this.y;
                    const hitRadius = (enemy.size / 2) + (this.size / 2);
                    // v5.27: cheap reject - an enemy farther than (hit radius + this frame's travel) on either axis can't be hit
                    const reach = hitRadius + moveDistance + 1;
                    if (dx > reach || dx < -reach || dy > reach || dy < -reach) continue;
                    const distSq = dx * dx + dy * dy;
                    const hitRadiusSq = hitRadius * hitRadius;

                    // Fast-forward check (Line segment point-distance) to prevent jumping over enemies at 8x speed
                    const segmentDistSq = this._pointToSegmentDistSq(enemy.x, enemy.y, prevX, prevY, this.x, this.y);

                    if (distSq <= hitRadiusSq || segmentDistSq <= hitRadiusSq) {
                        let actualDamage = this.damage;
                        if (enemy.type === 'tank' && this.damageMultVsTank !== 1) actualDamage *= this.damageMultVsTank;
                        if (enemy.type === 'flyer') {
                            if (this.flyerHitChance > 0 && this.flyerHitChance < 1 && Math.random() > this.flyerHitChance) {
                                scene?.soundManager?.stopAAMissileSound(this);
                                this.isDead = true;
                                return;
                            }
                        }
                        enemy.takeDamage(actualDamage, this);
                        if (this.isFrost) this.applyFrostSlow(scene);
                        scene?.soundManager?.stopAAMissileSound(this);
                        this.isDead = true;
                        return; // Bullet consumed
                    }
                }
            }

            // Remove if out of bounds (flew off map)
            const maxX = canvas ? canvas.width : 2000;
            const maxY = canvas ? canvas.height : 2000;
            if (this.x < -100 || this.x > maxX + 100 || this.y < -100 || this.y > maxY + 100) {
                scene?.soundManager?.stopAAMissileSound(this);
                this.isDead = true;
            }
        }
    }

    _pointToSegmentDistSq(px, py, x1, y1, x2, y2) {
        const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
        if (l2 === 0) return (px - x1) * (px - x1) + (py - y1) * (py - y1);
        let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
        t = Math.max(0, Math.min(1, t));
        const projX = x1 + t * (x2 - x1);
        const projY = y1 + t * (y2 - y1);
        return (px - projX) * (px - projX) + (py - projY) * (py - projY);
    }

    applyFrostSlow(scene) {
        // Find all enemies in slow radius
        for (let i = 0; i < scene.enemies.length; i++) {
            const enemy = scene.enemies[i];
            if (enemy.isDead) continue;
            const d = dist(this.x, this.y, enemy.x, enemy.y);
            if (d <= this.slowRadius) {
                // Apply slow
                enemy.slowMult = this.slowMult;
                enemy.slowEndTime = scene.gameTime * 1000 + this.slowDuration;
            }
        }
        // Visual: frost burst effect
        scene.addExplosion(this.x, this.y, this.slowRadius, '#AED6F1');
    }

    render(ctx) {
        if (this.isDead) return;

        ctx.save();
        ctx.translate(this.x, this.y - (this.arcOffset || 0));

        // Mortar: scales up/down as it arcs
        if (this.isMortar && this.totalDistance > 0) {
            const progress = this.traveled / this.totalDistance;
            const arcScale = 1 + Math.sin(progress * Math.PI) * 0.8;
            ctx.scale(arcScale, arcScale);
        } else if (this.isRocket) {
            ctx.rotate(this.angle);
        } else {
            // Draw trail lines for straight projectiles
            ctx.rotate(this.angle);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(-this.size * 2, 0);
            ctx.strokeStyle = this.color;
            ctx.lineWidth = this.size * 0.8;
            ctx.lineCap = 'round';
            ctx.stroke();
            ctx.restore();
            return;
        }

        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(0, 0, this.size, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }
}