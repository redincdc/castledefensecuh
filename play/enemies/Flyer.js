class Flyer extends Enemy {
    constructor(path, scene = null) {
        super('flyer', path, scene);
    }

    renderBody(ctx, bodyColor) {
        ctx.rotate(this.facingAngle);
        const r = this.size / 2;
        this.wingFlap += 0.3;
        const flap = Math.abs(Math.sin(this.wingFlap));
        const wingHeight = r * (0.3 + flap * 1.2);

        // Shadow on the ground below (gives sense of flying)
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        ctx.beginPath();
        ctx.ellipse(0, r * 1.5, r * 0.8, r * 0.3, 0, 0, Math.PI * 2);
        ctx.fill();

        // Wings (behind body, flapping up and down)
        ctx.fillStyle = 'rgba(255, 200, 230, 0.7)';
        ctx.beginPath();
        ctx.ellipse(-r * 0.2, -wingHeight, r * 1.4, r * 0.5, -0.3 - flap * 0.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(-r * 0.2, wingHeight, r * 1.4, r * 0.5, 0.3 + flap * 0.4, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = 'rgba(200, 100, 160, 0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(-r * 0.2, -wingHeight, r * 1.4, r * 0.5, -0.3 - flap * 0.4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(-r * 0.2, wingHeight, r * 1.4, r * 0.5, 0.3 + flap * 0.4, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = bodyColor;
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 0.9, r * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.arc(r * 0.5, 0, r * 0.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(r * 0.6, -r * 0.2, r * 0.18, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(r * 0.6, r * 0.2, r * 0.18, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#000000';
        ctx.beginPath(); ctx.arc(r * 0.7, -r * 0.2, r * 0.08, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(r * 0.7, r * 0.2, r * 0.08, 0, Math.PI * 2); ctx.fill();
    }
}
