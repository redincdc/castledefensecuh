class Crocodile extends Enemy {
    constructor(path, scene = null) {
        super('crocodile', path, scene);
    }

    onSpawn() {
        if (Math.random() < 1 / 9) {
            this.isGrowerCroc = true;
        }
    }

    update(deltaTime, castle, gridSystem, gameTime) {
        if (this.isDead) return;

        if (this.isGrowerCroc && !this.isGiantCroc && gridSystem) {
            const tile = gridSystem.getTileAtPosition(this.x, this.y);
            if (tile && tile.water) {
                if (!this.isGrowingCroc) { this.isGrowingCroc = true; this.crocGrowTimer = 0; }
                this.crocGrowTimer += deltaTime;
                if (this.crocGrowTimer >= 6.0) {
                    this.isGrowingCroc = false;
                    this.isGiantCroc = true;
                    this.size = Math.floor(this.size * 1.6);
                    const hpBonus = this.maxHealth * 3.0;
                    this.maxHealth += hpBonus;
                    this.health += hpBonus;
                }
                return;
            } else if (this.isGrowingCroc) {
                this.isGrowingCroc = false;
            }
        }

        super.update(deltaTime, castle, gridSystem, gameTime);
    }

    renderBody(ctx, bodyColor) {
        ctx.rotate(this.facingAngle);
        const r = this.size / 2;
        const t = Date.now() / 1000;
        const inWater = this._scene?.gridSystem?.getTileAtPosition(this.x, this.y)?.water || false;

        // Common top-view color palette
        const darkScaleColor = 'rgba(0, 0, 0, 0.25)';
        const ridgeColor = '#244018';
        const eyeColor = '#FFD700'; // Gold
        const pupilColor = '#000000';
        const toothColor = '#FFFFFF';

        if (inWater) {
            // --- TOP-VIEW IN WATER (Submerged Swimming) ---
            ctx.translate(0, Math.sin(t * 3) * r * 0.1);
            const tailSway = Math.sin(t * 6) * r * 0.45;

            // 1. Water Ripple Effect
            ctx.strokeStyle = 'rgba(120, 210, 255, 0.45)';
            ctx.lineWidth = 2;
            const ripplePhase = (t * 2) % 1;
            ctx.beginPath();
            ctx.ellipse(0, 0, r * (1.5 + ripplePhase * 0.4), r * (0.8 + ripplePhase * 0.2), 0, 0, Math.PI * 2);
            ctx.stroke();

            // 2. Swimming Tail (Thicker towards body)
            ctx.fillStyle = bodyColor;
            ctx.beginPath();
            ctx.moveTo(-r * 0.7, -r * 0.55); // Wider base
            ctx.quadraticCurveTo(-r * 1.8, tailSway * 0.5 - r * 0.1, -r * 2.5, tailSway);
            ctx.lineTo(-r * 2.4, tailSway + r * 0.08);
            ctx.quadraticCurveTo(-r * 1.6, tailSway * 0.5 + r * 0.1, -r * 0.7, r * 0.55); // Wider base
            ctx.closePath();
            ctx.fill();

            // 3. Submerged Torso
            ctx.beginPath();
            ctx.ellipse(0, 0, r * 1.3, r * 0.65, 0, 0, Math.PI * 2);
            ctx.fill();

            // 4. Submerged Tucked Legs
            ctx.strokeStyle = bodyColor;
            ctx.lineWidth = r * 0.16;
            ctx.lineCap = 'round';
            // Tucked back alongside body
            ctx.beginPath(); ctx.moveTo(r * 0.3, -r * 0.5); ctx.lineTo(-r * 0.2, -r * 0.8); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(r * 0.3, r * 0.5); ctx.lineTo(-r * 0.2, r * 0.8); ctx.stroke();

            // 5. Tapered Snout (Thicker towards body)
            ctx.beginPath();
            ctx.moveTo(r * 0.6, -r * 0.55); // Wider base
            ctx.lineTo(r * 1.8, -r * 0.18);
            ctx.quadraticCurveTo(r * 2.0, 0, r * 1.8, r * 0.18);
            ctx.lineTo(r * 0.6, r * 0.55); // Wider base
            ctx.closePath();
            ctx.fill();


            // 6. Dorsal Armor Scales (Center Spine)
            ctx.fillStyle = ridgeColor;
            for (let i = 0; i < 4; i++) {
                const sx = -r * 0.6 + i * r * 0.4;
                ctx.fillRect(sx, -r * 0.2, r * 0.25, r * 0.15);
                ctx.fillRect(sx, r * 0.05, r * 0.25, r * 0.15);
            }

            // 7. Symmetric Top-View Eyes & Ridges (Both Left & Right)
            ctx.fillStyle = bodyColor;
            ctx.beginPath(); ctx.ellipse(r * 0.7, -r * 0.32, r * 0.25, r * 0.15, -0.2, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.ellipse(r * 0.7, r * 0.32, r * 0.25, r * 0.15, 0.2, 0, Math.PI * 2); ctx.fill();

            ctx.fillStyle = eyeColor;
            ctx.beginPath(); ctx.arc(r * 0.7, -r * 0.32, r * 0.12, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(r * 0.7, r * 0.32, r * 0.12, 0, Math.PI * 2); ctx.fill();

            ctx.fillStyle = pupilColor;
            ctx.beginPath(); ctx.fillRect(r * 0.7 - 1, -r * 0.32 - r * 0.08, 2, r * 0.16);
            ctx.beginPath(); ctx.fillRect(r * 0.7 - 1, r * 0.32 - r * 0.08, 2, r * 0.16);

        } else {
            // --- TOP-VIEW ON LAND (Symmetrical Crawling Croc) ---
            const legSwing1 = Math.sin(t * 7) * r * 0.25;
            const legSwing2 = Math.sin(t * 7 + Math.PI) * r * 0.25;
            const tailSway = Math.sin(t * 4.5) * r * 0.3;

            // 1. 4 Splayed Reptilian Legs (Symmetrical Left/Right Crawl)
            ctx.strokeStyle = bodyColor;
            ctx.lineWidth = r * 0.22;
            ctx.lineCap = 'round';

            // Front Left & Right
            ctx.beginPath(); ctx.moveTo(r * 0.4, -r * 0.4); ctx.lineTo(r * 0.5 + legSwing1, -r * 1.15); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(r * 0.4, r * 0.4); ctx.lineTo(r * 0.5 + legSwing2, r * 1.15); ctx.stroke();

            // Rear Left & Right
            ctx.beginPath(); ctx.moveTo(-r * 0.4, -r * 0.4); ctx.lineTo(-r * 0.3 + legSwing2, -r * 1.15); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(-r * 0.4, r * 0.4); ctx.lineTo(-r * 0.3 + legSwing1, r * 1.15); ctx.stroke();

            // Webbed Claw Claws at leg tips
            ctx.fillStyle = darkScaleColor;
            const claws = [
                { x: r * 0.5 + legSwing1, y: -r * 1.15 },
                { x: r * 0.5 + legSwing2, y: r * 1.15 },
                { x: -r * 0.3 + legSwing2, y: -r * 1.15 },
                { x: -r * 0.3 + legSwing1, y: r * 1.15 }
            ];
            claws.forEach(c => {
                ctx.beginPath(); ctx.arc(c.x, c.y, r * 0.12, 0, Math.PI * 2); ctx.fill();
            });

            // 2. Thick Muscular Tail (Thicker towards body)
            ctx.fillStyle = bodyColor;
            ctx.beginPath();
            ctx.moveTo(-r * 0.75, -r * 0.55); // Wider base
            ctx.quadraticCurveTo(-r * 1.8, tailSway * 0.5 - r * 0.12, -r * 2.5, tailSway);
            ctx.lineTo(-r * 2.45, tailSway + r * 0.08);
            ctx.quadraticCurveTo(-r * 1.6, tailSway * 0.5 + r * 0.12, -r * 0.75, r * 0.55); // Wider base
            ctx.closePath();
            ctx.fill();

            // Serrated Tail Ridges
            ctx.fillStyle = ridgeColor;
            for (let i = 0; i < 4; i++) {
                const tx = -r * 0.9 - i * r * 0.38;
                const ty = tailSway * (i / 4);
                ctx.beginPath();
                ctx.moveTo(tx, ty - r * 0.15);
                ctx.lineTo(tx - r * 0.15, ty);
                ctx.lineTo(tx, ty + r * 0.15);
                ctx.closePath();
                ctx.fill();
            }

            // 3. Main Torso Body
            ctx.fillStyle = bodyColor;
            ctx.beginPath();
            ctx.ellipse(0, 0, r * 1.35, r * 0.68, 0, 0, Math.PI * 2);
            ctx.fill();

            // Double Row of Armor Osteoderm Scales (Top & Bottom spine rows)
            ctx.fillStyle = ridgeColor;
            for (let i = 0; i < 5; i++) {
                const sx = -r * 0.8 + i * r * 0.36;
                // Top row scale
                ctx.fillRect(sx, -r * 0.4, r * 0.22, r * 0.18);
                // Bottom row scale
                ctx.fillRect(sx, r * 0.22, r * 0.22, r * 0.18);
            }

            // 4. Snout / Tapered Jaws (Thicker towards body)
            ctx.fillStyle = bodyColor;
            ctx.beginPath();
            ctx.moveTo(r * 0.6, -r * 0.6); // Wider base
            ctx.lineTo(r * 1.9, -r * 0.2);
            ctx.quadraticCurveTo(r * 2.1, 0, r * 1.9, r * 0.2);
            ctx.lineTo(r * 0.6, r * 0.6); // Wider base
            ctx.closePath();
            ctx.fill();


            // Teeth Protruding from Jawline (Both Upper & Lower)
            ctx.fillStyle = toothColor;
            for (let i = 0; i < 4; i++) {
                const tx = r * 0.8 + i * r * 0.26;
                // Upper teeth (-y)
                ctx.beginPath();
                ctx.moveTo(tx, -r * 0.38 + i * r * 0.05);
                ctx.lineTo(tx + r * 0.06, -r * 0.48 + i * r * 0.05);
                ctx.lineTo(tx + r * 0.12, -r * 0.38 + i * r * 0.05);
                ctx.closePath();
                ctx.fill();

                // Lower teeth (+y)
                ctx.beginPath();
                ctx.moveTo(tx, r * 0.38 - i * r * 0.05);
                ctx.lineTo(tx + r * 0.06, r * 0.48 - i * r * 0.05);
                ctx.lineTo(tx + r * 0.12, r * 0.38 - i * r * 0.05);
                ctx.closePath();
                ctx.fill();
            }

            // Nostrils at Tip
            ctx.fillStyle = darkScaleColor;
            ctx.beginPath(); ctx.arc(r * 1.95, -r * 0.08, r * 0.05, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(r * 1.95, r * 0.08, r * 0.05, 0, Math.PI * 2); ctx.fill();

            // 5. Raised Eye Ridges & Symmetrical Gold Eyes (Left & Right)
            ctx.fillStyle = bodyColor;
            ctx.beginPath(); ctx.ellipse(r * 0.75, -r * 0.38, r * 0.28, r * 0.18, -0.2, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.ellipse(r * 0.75, r * 0.38, r * 0.28, r * 0.18, 0.2, 0, Math.PI * 2); ctx.fill();

            ctx.fillStyle = eyeColor;
            ctx.beginPath(); ctx.arc(r * 0.75, -r * 0.38, r * 0.14, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(r * 0.75, r * 0.38, r * 0.14, 0, Math.PI * 2); ctx.fill();

            // Vertical Slit Pupils
            ctx.fillStyle = pupilColor;
            ctx.beginPath(); ctx.fillRect(r * 0.75 - 1, -r * 0.38 - r * 0.09, 2, r * 0.18);
            ctx.beginPath(); ctx.fillRect(r * 0.75 - 1, r * 0.38 - r * 0.09, 2, r * 0.18);
        }

        if (this.isGiantCroc) {
            const pulse = 0.5 + Math.sin(t * 3) * 0.2;
            ctx.strokeStyle = `rgba(255, 100, 0, ${0.5 * pulse})`;
            ctx.lineWidth = 2.5;
            ctx.beginPath(); ctx.ellipse(0, 0, r * 1.8, r * 0.9, 0, 0, Math.PI * 2); ctx.stroke();
        }
    }
}
