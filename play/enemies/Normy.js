class Normy extends Enemy {
    constructor(path, scene = null) {
        super('normy', path, scene);
    }

    renderBody(ctx, bodyColor) {
        const r = this.size / 2;
        ctx.fillStyle = bodyColor;
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(-r * 0.3, -r * 0.15, r * 0.18, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(r * 0.3, -r * 0.15, r * 0.18, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#000000'; ctx.beginPath(); ctx.arc(-r * 0.3, -r * 0.15, r * 0.09, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(r * 0.3, -r * 0.15, r * 0.09, 0, Math.PI * 2); ctx.fill();
    }
}
