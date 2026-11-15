class Tank extends Enemy {
    constructor(path, scene = null) {
        super('tank', path, scene);
    }

    static getAdaptiveMult(baseMult) {
        // Tanks only get 50% of the adaptive change
        return 1 + (baseMult - 1) * 0.5;
    }

    renderBody(ctx, bodyColor) {
        const r = this.size / 2;
        ctx.fillStyle = bodyColor;
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff';
        // Reduced eye radius from 0.25 to 0.16 for a more balanced, mean look
        ctx.beginPath(); ctx.arc(-r * 0.35, -r * 0.3, r * 0.16, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(r * 0.35, -r * 0.3, r * 0.16, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#000000';
        // Adjusted unibrow to match the smaller eyes
        ctx.fillRect(-r * 0.5, -r * 0.55, r * 1.0, r * 0.15);
    }
}
