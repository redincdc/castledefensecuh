/**
 * Flame Thrower Tower
 * Fires a continuous cone of fire in a fixed direction.
 */
class FlameTower extends Tower {
    constructor(x, y, startLevel = 0) {
        super('flame', x, y, startLevel);
    }

    renderRangeOverlay(ctx) {
        const range = this.range || 0;
        if (range <= 0 || range === Infinity) return;

        ctx.save();
        ctx.translate(this.x, this.y);

        // GDD: 45 degree spread (1/8th of a circle)
        const spread = Math.PI / 4;
        const startAngle = this.flameAngle - spread / 2;
        const endAngle = this.flameAngle + spread / 2;

        // 1. Blue Range Wedge (FOV Cone above fire)
        ctx.fillStyle = 'rgba(40, 140, 255, 0.35)';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, range, startAngle, endAngle);
        ctx.closePath();
        ctx.fill();

        // 2. Outer Border
        ctx.strokeStyle = 'rgba(100, 200, 255, 0.85)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, range, startAngle, endAngle);
        ctx.closePath();
        ctx.stroke();

        // 3. Directional Indicator Line (Center of flame)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(this.flameAngle) * range, Math.sin(this.flameAngle) * range);
        ctx.stroke();

        ctx.restore();
    }
}
