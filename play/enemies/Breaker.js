/**
 * Breaker Enemy Class
 * A slow, heavy unit with a spinning black square body and fixed angry red slit eyes.
 * Follows the standard ground path like other units.
 * Special Ability: Deals gradual "Aura Damage" to towers as it passes by.
 */

class Breaker extends Enemy {
    constructor(path, scene = null) {
        super('breaker', path, scene);
        this.bodyRotationAngle = 0;
    }

    update(deltaTime, castle, gridSystem, gameTime) {
        if (this.isDead) return;

        // Continuous spinning black square body (Faster rotation during movement)
        this.bodyRotationAngle += deltaTime * 3.5;

        // --- AURA DAMAGE LOGIC ---
        if (this._scene) {
            const s = this._scene;
            const structures = [...s.towers, ...s.walls, ...s.mirrors, ...s.spikes, ...s.Lilypads];
            const ts = GameConfig.Grid.tileSize;
            const radius = (this.size / 2) + (ts * 1.25);
            const radiusSq = radius * radius;
            const damagePerSec = 2.5;

            for (let i = 0; i < structures.length; i++) {
                const ent = structures[i];
                if (ent.isDestroying || !ent.isBuilt || ent.isSpike) continue;

                const dx = ent.x - this.x;
                const dy = ent.y - this.y;
                if (dx * dx + dy * dy <= radiusSq) {
                    // Deal gradual damage
                    ent.takeDamage(damagePerSec * deltaTime, this);

                    // Interrupt Upgrades
                    if (ent.isUpgrading) {
                        if (ent.cancelUpgrade()) {
                            if (window.logManager) {
                                window.logManager.log(`! BKR interrupted upgrade of ${getLogId(ent.type)}`, "AI");
                            }
                        }
                    }
                }
            }
        }

        // Breaker now uses standard enemy movement (following the maze)
        super.update(deltaTime, castle, gridSystem, gameTime);
    }

    render(ctx, time) {
        if (this.isDead) return;

        // --- SABOTAGE AURA VISUAL ---
        const ts = GameConfig.Grid.tileSize;
        const radius = (this.size / 2) + (ts * 1.25);
        const pulse = 0.5 + Math.sin(time * 10) * 0.2;

        ctx.save();
        ctx.translate(this.x, this.y);

        // Faint red outer pulse
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        const grad = ctx.createRadialGradient(0, 0, radius * 0.4, 0, 0, radius);
        grad.addColorStop(0, 'rgba(255, 0, 0, 0)');
        grad.addColorStop(1, 'rgba(255, 0, 0, ' + (0.15 * pulse) + ')');
        ctx.fillStyle = grad;
        ctx.fill();

        // Rotating "Glitch" ring
        ctx.rotate(time * -2);
        ctx.strokeStyle = 'rgba(255, 50, 50, ' + (0.3 * pulse) + ')';
        ctx.setLineDash([5, 10]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, radius * 0.9, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.restore();

        // Continue with normal body rendering
        super.render(ctx, time);
    }

    renderBody(ctx, bodyColor) {
        const r = this.size / 2;
        const side = this.size * 0.85;

        // 1. ROTATING BLACK SQUARE BODY
        ctx.save();
        ctx.rotate(this.bodyRotationAngle);

        ctx.fillStyle = '#111111';
        ctx.fillRect(-side / 2, -side / 2, side, side);

        ctx.strokeStyle = '#333333';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-side / 2, -side / 2, side, side);

        ctx.fillStyle = '#222222';
        ctx.fillRect(-side / 4, -side / 4, side / 2, side / 2);
        ctx.restore();

        // 2. NON-ROTATING ANGRY RED SLIT EYES
        ctx.save();
        ctx.rotate(this.facingAngle);
        const eyeX = r * 0.25, eyeY = r * 0.35, eyeW = r * 0.6, eyeH = r * 0.22;

        [1, -1].forEach(dir => {
            ctx.save();
            ctx.translate(eyeX, eyeY * dir);
            ctx.rotate(0.35 * dir);
            ctx.fillStyle = '#FF0000';
            ctx.beginPath(); ctx.ellipse(0, 0, eyeW / 2, eyeH / 2, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#000000'; ctx.fillRect(-1, -eyeH / 2, 2, eyeH);
            ctx.restore();
        });
        ctx.restore();
    }
}
