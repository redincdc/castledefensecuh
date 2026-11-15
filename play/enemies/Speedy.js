class Speedy extends Enemy {
    constructor(path, scene = null) {
        super('speedy', path, scene);
    }

    update(deltaTime, castle, gridSystem, gameTime) {
        if (this.isDead) return;

        if (this.isBouncing) {
            this.x += this.bounceVx * deltaTime;
            this.y += this.bounceVy * deltaTime;
            this.bounceTimer -= deltaTime;
            this.facingAngle = Math.atan2(this.bounceVy, this.bounceVx);
            this.walkPhase += deltaTime * 20;
            if (this.bounceTimer <= 0) {
                this.isBouncing = false;
                this.needsPathUpdate = true;
                this.isBlocked = false;
            }
            return;
        }

        super.update(deltaTime, castle, gridSystem, gameTime);
    }

    renderBody(ctx, bodyColor) {
        ctx.rotate(this.facingAngle);
        const r = this.size / 2;
        ctx.fillStyle = bodyColor;
        ctx.beginPath();
        ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2);
        ctx.lineTo(-r * 2.8, 0);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(r * 0.3, -r * 0.3, r * 0.18, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(r * 0.3, r * 0.3, r * 0.18, 0, Math.PI * 2); ctx.fill();

        ctx.fillStyle = '#000000';
        ctx.beginPath(); ctx.arc(r * 0.35, -r * 0.3, r * 0.08, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(r * 0.35, r * 0.3, r * 0.08, 0, Math.PI * 2); ctx.fill();
    }
}
