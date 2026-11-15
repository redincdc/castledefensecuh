class Splitter extends Enemy {
    constructor(path, scene = null) {
        super('splitter', path, scene);
    }

    update(deltaTime, castle, gridSystem, gameTime) {
        if (this.isDead) return;

        if (this.splitDriftTime < this.splitDriftDuration) {
            this.splitDriftTime += deltaTime;
            const t = Math.min(1.0, this.splitDriftTime / this.splitDriftDuration);

            // Ease-Out Quad: High initial burst that smoothly decelerates to a stop
            const easeOut = 1 - (1 - t) * (1 - t);

            this.x = this.splitDriftStartX + (this.splitDriftTargetX - this.splitDriftStartX) * easeOut;
            this.y = this.splitDriftStartY + (this.splitDriftTargetY - this.splitDriftStartY) * easeOut;

            this.walkPhase += deltaTime * 12;

            // Maintain forward facing angle towards the next waypoint during drift (no visual snap)
            if (this.path && this.path[this.pathIndex]) {
                const targetNode = this.path[this.pathIndex];
                const dx = targetNode.x - this.x;
                const dy = targetNode.y - this.y;
                if (dx !== 0 || dy !== 0) {
                    this.facingAngle = Math.atan2(dy, dx);
                }
            }

            // Once sideways drift completes, recalculate optimal path from the child's new position
            if (t >= 1.0 && gridSystem && this._scene) {
                const newPath = gridSystem.findPathFrom(this.x, this.y, this._scene.towers, 'normal', this._scene.walls);
                if (newPath && newPath.length > 0) {
                    this.path = newPath;
                    this.pathIndex = 0;
                }
            }
            return;
        }

        super.update(deltaTime, castle, gridSystem, gameTime);
    }

    renderBody(ctx, bodyColor) {
        const r = this.size / 2;
        const isFinal = this.splitLevel >= 2;
        ctx.fillStyle = bodyColor;

        if (isFinal) {
            ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(-r * 0.25, -r * 0.2, r * 0.22, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(r * 0.25, -r * 0.2, r * 0.22, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#000000'; ctx.beginPath(); ctx.arc(-r * 0.25, -r * 0.2, r * 0.11, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(r * 0.25, -r * 0.2, r * 0.11, 0, Math.PI * 2); ctx.fill();
        } else {
            const offset = r * 0.5;
            ctx.beginPath(); ctx.arc(-offset, 0, r, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(offset, 0, r, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(-offset, 0, r, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(offset, 0, r, 0, Math.PI * 2); ctx.stroke();
            ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(-offset - r * 0.25, -r * 0.2, r * 0.2, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#000000'; ctx.beginPath(); ctx.arc(-offset - r * 0.3, -r * 0.2, r * 0.1, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(offset + r * 0.25, -r * 0.2, r * 0.2, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#000000'; ctx.beginPath(); ctx.arc(offset + r * 0.3, -r * 0.2, r * 0.1, 0, Math.PI * 2); ctx.fill();
        }
    }
}
