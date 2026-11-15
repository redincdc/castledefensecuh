class Groupie extends Enemy {
    constructor(path, scene = null) {
        super('groupie', path, scene);
    }

    onSpawn() {
        const offsetRange = GameConfig.Grid.tileSize * 0.35;
        this.x += (Math.random() - 0.5) * offsetRange;
        this.y += (Math.random() - 0.5) * offsetRange;
    }

    renderBody(ctx, bodyColor) {
        const r = this.size / 2;
        ctx.fillStyle = bodyColor;
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(180,150,0,0.5)'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(-r * 0.22, -r * 0.15, r * 0.16, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(r * 0.22, -r * 0.15, r * 0.16, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#000000'; ctx.beginPath(); ctx.arc(-r * 0.22, -r * 0.15, r * 0.08, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(r * 0.22, -r * 0.15, r * 0.08, 0, Math.PI * 2); ctx.fill();
    }
}
