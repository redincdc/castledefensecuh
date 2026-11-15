/**
 * Portal - Animated spawn point with 3 spirals and a pulsing core.
 */
class Portal {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.tileSize = GameConfig.Grid.tileSize;
        this.size = this.tileSize; // For click detection
        // Strictly within 1x1 tile
        this.maxRadius = this.tileSize * 0.48;

        this.pulse = 0;
        this.isActive = false;
        this.isPortal = true;

        // 3 Spiral Rotations
        this.rotPurple = Math.random() * Math.PI * 2;
        this.rotDarkBlue = Math.random() * Math.PI * 2;
        this.rotLightBlue = Math.random() * Math.PI * 2;

        // Colors per instructions
        this.colorPurple = '#9932CC';
        this.colorDarkBlue = '#00008B';
        this.colorLightBlue = '#87CEEB';
    }

    update(deltaTime) {
        this.pulse += deltaTime * 4.0;

        // Update rotations at different RPMs (Opposite Direction)
        this.rotPurple -= deltaTime * 1.5;   // Slow
        this.rotDarkBlue -= deltaTime * 3.0; // Medium
        this.rotLightBlue -= deltaTime * 6.0; // Fast
    }

    render(ctx) {
        const baseR = this.maxRadius;
        const corePulse = 0.85 + Math.sin(this.pulse) * 0.15;
        const alpha = this.isActive ? 1.0 : 0.6;

        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.globalAlpha = alpha;

        // Helper to draw a spiral
        const drawSpiral = (rotation, color, numArms, lengthMult, width) => {
            ctx.save();
            ctx.rotate(rotation);
            ctx.strokeStyle = color;
            ctx.lineWidth = width;
            ctx.lineCap = 'round';

            for (let j = 0; j < numArms; j++) {
                ctx.save();
                ctx.rotate((j * Math.PI * 2) / numArms);
                ctx.beginPath();
                ctx.moveTo(0, 0);

                const points = 20;
                for (let i = 0; i <= points; i++) {
                    const t = i / points;
                    // Archimedean spiral: r = a + b * theta
                    const r = t * baseR * lengthMult;
                    const angle = t * Math.PI * 1.5;
                    ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
                }
                ctx.stroke();
                ctx.restore();
            }
            ctx.restore();
        };

        // 1. Dark Blue Spiral (Slowest/Base)
        drawSpiral(this.rotDarkBlue, this.colorDarkBlue, 6, 0.95, 6);

        // 2. Purple Spiral (Medium)
        drawSpiral(this.rotPurple, this.colorPurple, 5, 0.8, 4);

        // 3. Light Blue Spiral (Fastest/Top)
        drawSpiral(this.rotLightBlue, this.colorLightBlue, 4, 0.6, 3);

        // 4. Pulsing Black Dot in the middle
        const dotRadius = baseR * 0.25 * corePulse;
        ctx.fillStyle = '#000000';

        // Inner Glow for the dot to make it "pop"
        ctx.shadowBlur = 10;
        ctx.shadowColor = this.colorPurple;

        ctx.beginPath();
        ctx.arc(0, 0, dotRadius, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }

    renderRangeOverlay(ctx) {
        // Portal is a non-combat utility
    }
}
