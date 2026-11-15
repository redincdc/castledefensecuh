/**
 * Wall Tower
 * Cheap, blocks enemies, dynamically links to adjacent walls.
 * Highly durable structure designed as a primary counter against Breakers.
 * Upgradable up to Level 4 (5 total distinct tiers: Lvl 0 to Lvl 4).
 */
class WallTower extends BuildableEntity {
    constructor(x, y, col, row, startLevel = 0) {
        super();
        this.x = x;
        this.y = y;
        this.col = col;
        this.row = row;
        this.type = 'wall';
        this.size = GameConfig.Wall.size || 56;
        const visuals = window.textureManager.getBuildable('wall');
        this.color = visuals.color;
        this.topColor = visuals.topColor;

        this.cost = GameConfig.Wall.cost || 5;
        this.totalInvested = this.cost;
        this.isWall = true;

        this.maxUpgrades = 4; // 5 total tiers: Lvl 0 (Wood Fence), Lvl 1 (Brick), Lvl 2 (Steel Brick), Lvl 3 (Steel Armor), Lvl 4 (Dark Matter)
        this.upgradeLevel = Math.min(4, startLevel);
        this.placementLevel = this.upgradeLevel;
        this.isUpgrading = false;
        this.upgradeProgress = 0;

        this.baseMaxHealth = GameConfig.Wall.health || 150;
        this.maxHealth = this.baseMaxHealth;
        this.health = this.maxHealth;

        this.baseBuildTime = Math.max(1000, this.cost * 300 * Math.pow(0.7, startLevel));
        this.baseDestroyTime = Math.max(300, this.cost * 200);

        this.recalcStats();
    }

    getUpgradeCost() {
        const costs = [10, 20, 40, 80];
        return costs[Math.min(this.upgradeLevel, costs.length - 1)];
    }

    getUpgradeTime() {
        return Math.max(1000, 2000 + this.upgradeLevel * 500);
    }

    startUpgrade() {
        if (this.upgradeLevel >= this.maxUpgrades || this.isUpgrading || this.isDestroying || !this.isBuilt) return false;
        this.isUpgrading = true;
        this.upgradeProgress = 0;
        return true;
    }

    cancelUpgrade() {
        if (!this.isUpgrading) return false;
        const cost = this.getUpgradeCost();
        const gameState = window.gameScene?.gameStateManager;
        if (gameState) gameState.addGold(cost);
        this.isUpgrading = false;
        this.upgradeProgress = 0;
        return true;
    }

    completeUpgrade() {
        const spentCost = this.getUpgradeCost();
        this.upgradeLevel++;
        this.totalInvested += spentCost;
        this.recalcStats();
        this.isUpgrading = false;
        this.upgradeProgress = 0;
        window.gameScene?.soundManager?.playUpgradeComplete();

        if (window.gameScene) {
            window.gameScene._entitiesDirty = true;
            if (window.gameScene.selectedTower === this) {
                window.gameScene.showTowerPopup(this);
            }
        }
    }

    recalcStats() {
        const oldMax = this.maxHealth || 150;
        this.baseMaxHealth = 150;
        // 50% compounding health increase per upgrade level (L0: 150, L1: 225, L2: 338, L3: 506, L4: 759)
        const newMax = Math.floor(this.baseMaxHealth * Math.pow(1.5, Math.min(4, this.upgradeLevel)));
        const hpDiff = newMax - oldMax;
        if (hpDiff > 0 && this.health > 0) {
            this.health = Math.min(newMax, this.health + hpDiff);
        }
        this.maxHealth = newMax;
    }

    update(deltaTime, castle) {
        const speedMult = getHealthRatio(castle);

        if (this.isUpgrading) {
            this.upgradeProgress += (deltaTime * 1000) / this.getUpgradeTime() * speedMult;
            if (this.upgradeProgress >= 1) {
                this.completeUpgrade();
            }
        }
        return this.updateBuildDestroy(deltaTime, castle);
    }

    // Determine which sides have adjacent walls for dynamic linking
    getLinks(walls) {
        if (this._cachedLinks && !this._linksDirty) return this._cachedLinks;

        const links = { top: false, bottom: false, left: false, right: false };
        const dirs = {
            top: [-1, 0], bottom: [1, 0], left: [0, -1], right: [0, 1]
        };

        const tiles = window.gameScene?.gridSystem?.tiles;
        if (!tiles) return links;

        for (const dir in dirs) {
            const dr = dirs[dir][0];
            const dc = dirs[dir][1];
            const nr = this.row + dr;
            const nc = this.col + dc;

            if (nr >= 0 && nr < GameConfig.Grid.rows && nc >= 0 && nc < GameConfig.Grid.columns) {
                const targetTile = tiles[nr][nc];
                links[dir] = targetTile && targetTile.isWall;
            }
        }

        this._cachedLinks = links;
        this._linksDirty = false;
        return links;
    }

    render(ctx, walls) {
        const links = this.getLinks(walls);
        const ts = GameConfig.Grid.tileSize || 64;
        const half = ts / 2;

        ctx.save();
        ctx.translate(this.x, this.y);

        // Render 5 distinct wall tiers (Level 0 to Level 4)
        switch (Math.min(4, this.upgradeLevel)) {
            case 0:
                this._renderLvl0_WoodFence(ctx, ts, half, links);
                break;
            case 1:
                this._renderLvl1_BrickWall(ctx, ts, half, links);
                break;
            case 2:
                this._renderLvl2_ReinforcedBrickWall(ctx, ts, half, links);
                break;
            case 3:
                this._renderLvl3_SteelWall(ctx, ts, half, links);
                break;
            case 4:
            default:
                this._renderLvl4_DarkMatterWall(ctx, ts, half, links);
                break;
        }

        ctx.restore();

        // Render progress rings for build, destroy, and upgrade phases
        if (!this.isBuilt || this.isDestroying) {
            this.renderProgressRing(ctx, this.x, this.y, ts * 0.4, '#D2691E', { lineWidth: 3 });
        } else if (this.isUpgrading) {
            this.renderProgressRing(ctx, this.x, this.y, ts * 0.4, '#00BFFF', { lineWidth: 4, progress: this.upgradeProgress });
        }
    }

    // --- LEVEL 0: Pointy Wood Fence ---
    _renderLvl0_WoodFence(ctx, ts, half, links) {
        // Horizontal support cross rails
        ctx.fillStyle = '#5C4033'; // Dark wood rail
        ctx.fillRect(-half, -6, ts, 12);
        if (links.top)    ctx.fillRect(-6, -half, 12, half);
        if (links.bottom) ctx.fillRect(-6, 0, 12, half);
        if (links.left)   ctx.fillRect(-half, -6, half, 12);
        if (links.right)  ctx.fillRect(0, -6, half, 12);

        // Draw vertical planks with 45° pointy tops
        const plankCount = 4;
        const plankW = Math.floor(ts / (plankCount + 1));
        const spacing = Math.floor((ts - plankCount * plankW) / (plankCount + 1));
        const startX = -half + spacing;

        const colors = ['#8B5A2B', '#CD853F', '#A0522D', '#8B5A2B'];

        for (let i = 0; i < plankCount; i++) {
            const px = startX + i * (plankW + spacing);
            const py = -half + 4;
            const ph = ts - 8;

            ctx.fillStyle = colors[i % colors.length];

            // Pointy Top Plank (45° angle tip)
            ctx.beginPath();
            ctx.moveTo(px, py + ph);
            ctx.lineTo(px, py + plankW / 2);
            ctx.lineTo(px + plankW / 2, py); // 45° tip
            ctx.lineTo(px + plankW, py + plankW / 2);
            ctx.lineTo(px + plankW, py + ph);
            ctx.closePath();
            ctx.fill();

            // Plank border & grain line
            ctx.strokeStyle = '#3E2723';
            ctx.lineWidth = 1;
            ctx.stroke();

            // Iron nail head on horizontal cross rail
            ctx.fillStyle = '#3A3A3A';
            ctx.beginPath();
            ctx.arc(px + plankW / 2, 0, 1.5, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // --- LEVEL 1: Clean Detailed Brick Wall ---
    _renderLvl1_BrickWall(ctx, ts, half, links) {
        // Concrete mortar substrate
        ctx.fillStyle = '#4A5568';
        ctx.fillRect(-half, -half, ts, ts);
        if (links.top)    ctx.fillRect(-half, -half, ts, half);
        if (links.bottom) ctx.fillRect(-half, 0, ts, half);
        if (links.left)   ctx.fillRect(-half, -half, half, ts);
        if (links.right)  ctx.fillRect(0, -half, half, ts);

        // High-detail 16-course staggered brick grid
        this._drawDetailedBricks(ctx, -half, -half, ts, ts);
        if (links.top)    this._drawDetailedBricks(ctx, -half, -half, ts, half);
        if (links.bottom) this._drawDetailedBricks(ctx, -half, 0, ts, half);
        if (links.left)   this._drawDetailedBricks(ctx, -half, -half, half, ts);
        if (links.right)  this._drawDetailedBricks(ctx, 0, -half, half, ts);

        // Top stone coping slab cap
        ctx.fillStyle = '#E2E8F0';
        ctx.fillRect(-half + 1, -half + 1, ts - 2, 4);
        ctx.fillStyle = '#A0AEC0';
        ctx.fillRect(-half + 1, -half + 4, ts - 2, 2);
    }

    // --- LEVEL 2: Metallic Steel Brick Wall ---
    _renderLvl2_ReinforcedBrickWall(ctx, ts, half, links) {
        const steelPalette = ['#475569', '#334155', '#64748B', '#1E293B', '#94A3B8'];

        // Dark iron mortar substrate
        ctx.fillStyle = '#1E293B';
        ctx.fillRect(-half, -half, ts, ts);
        if (links.top)    ctx.fillRect(-half, -half, ts, half);
        if (links.bottom) ctx.fillRect(-half, 0, ts, half);
        if (links.left)   ctx.fillRect(-half, -half, half, ts);
        if (links.right)  ctx.fillRect(0, -half, half, ts);

        // High-detail metallic steel brick course
        this._drawDetailedBricks(ctx, -half, -half, ts, ts, steelPalette);
        if (links.top)    this._drawDetailedBricks(ctx, -half, -half, ts, half, steelPalette);
        if (links.bottom) this._drawDetailedBricks(ctx, -half, 0, ts, half, steelPalette);
        if (links.left)   this._drawDetailedBricks(ctx, -half, -half, half, ts, steelPalette);
        if (links.right)  this._drawDetailedBricks(ctx, 0, -half, half, ts, steelPalette);

        // Polished steel coping cap
        ctx.fillStyle = '#CBD5E1';
        ctx.fillRect(-half + 1, -half + 1, ts - 2, 4);
        ctx.fillStyle = '#64748B';
        ctx.fillRect(-half + 1, -half + 4, ts - 2, 2);
    }

    // --- LEVEL 3: Industrial Steel Armor Wall (No Barbed Wire) ---
    _renderLvl3_SteelWall(ctx, ts, half, links) {
        // Dark industrial steel alloy base
        ctx.fillStyle = '#1E293B';
        ctx.fillRect(-half, -half, ts, ts);
        if (links.top)    ctx.fillRect(-half, -half, ts, half);
        if (links.bottom) ctx.fillRect(-half, 0, ts, half);
        if (links.left)   ctx.fillRect(-half, -half, half, ts);
        if (links.right)  ctx.fillRect(0, -half, half, ts);

        // Vertical interlocking steel armor slats
        const slatW = Math.floor((ts - 8) / 3);
        for (let i = 0; i < 3; i++) {
            const sx = -half + 4 + i * slatW;
            ctx.fillStyle = i % 2 === 0 ? '#334155' : '#475569';
            ctx.fillRect(sx, -half + 3, slatW - 2, ts - 6);

            // Metallic shine highlight
            ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
            ctx.fillRect(sx + 1, -half + 3, 2, ts - 6);
        }

        // Horizontal steel reinforcement bands
        ctx.fillStyle = '#64748B';
        ctx.fillRect(-half + 2, -half + 8, ts - 4, 5);
        ctx.fillRect(-half + 2, half - 13, ts - 4, 5);

        if (links.top)    ctx.fillRect(-half + 2, -half, ts - 4, 4);
        if (links.bottom) ctx.fillRect(-half + 2, half - 4, ts - 4, 4);
        if (links.left)   ctx.fillRect(-half, -half + 8, half, 5);
        if (links.right)  ctx.fillRect(0, -half + 8, half, 5);

        // Steel plate seam borders
        ctx.strokeStyle = '#94A3B8';
        ctx.lineWidth = 1;
        ctx.strokeRect(-half + 3, -half + 3, ts - 6, ts - 6);
    }

    // --- LEVEL 4: Detailed Purple Dark Matter Void Crystal Wall (No Barbed Wire) ---
    _renderLvl4_DarkMatterWall(ctx, ts, half, links) {
        // Deep space void alloy base
        ctx.fillStyle = '#0F172A';
        ctx.fillRect(-half, -half, ts, ts);
        if (links.top)    ctx.fillRect(-half, -half, ts, half);
        if (links.bottom) ctx.fillRect(-half, 0, ts, half);
        if (links.left)   ctx.fillRect(-half, -half, half, ts);
        if (links.right)  ctx.fillRect(0, -half, half, ts);

        // Multi-faceted purple dark matter crystal core
        ctx.fillStyle = '#3B0764';
        ctx.fillRect(-half + 3, -half + 3, ts - 6, ts - 6);

        ctx.fillStyle = '#581C87';
        ctx.beginPath();
        ctx.moveTo(-half + 3, -half + 3);
        ctx.lineTo(0, 0);
        ctx.lineTo(half - 3, -half + 3);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#2E1065';
        ctx.beginPath();
        ctx.moveTo(-half + 3, half - 3);
        ctx.lineTo(0, 0);
        ctx.lineTo(half - 3, half - 3);
        ctx.closePath();
        ctx.fill();

        // Pulsing purple void glyph / core energy lines
        const time = Date.now() / 1000;
        const alpha = 0.6 + 0.4 * Math.sin(time * 3);
        ctx.strokeStyle = `rgba(232, 121, 249, ${alpha})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-half + 6, -half + 6);
        ctx.lineTo(half - 6, half - 6);
        ctx.moveTo(half - 6, -half + 6);
        ctx.lineTo(-half + 6, half - 6);
        ctx.stroke();

        // Bio-luminescent neon green crystal border aura (in-bounds framing)
        ctx.save();
        ctx.shadowColor = '#00FF00';
        ctx.shadowBlur = 8;
        ctx.strokeStyle = `rgba(34, 197, 94, ${alpha})`;
        ctx.lineWidth = 2;
        ctx.strokeRect(-half + 4, -half + 4, ts - 8, ts - 8);
        ctx.restore();
    }

    // Helper to draw high-detail miniature brick grid strictly clipped to bounding rectangle
    _drawDetailedBricks(ctx, x, y, w, h, colorPalette) {
        ctx.save();
        // Strict boundary clip ensures no bricks ever stick out past the wall dimensions
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();

        const brickW = 8;
        const brickH = 3.5;
        const gap = 1;
        const rowStep = brickH + gap;
        const colStep = brickW + gap;

        const colors = colorPalette || ['#B22222', '#8B0000', '#A52A2A', '#991B1B', '#701010'];

        let rowIdx = 0;
        for (let by = y; by < y + h; by += rowStep) {
            const isOffset = rowIdx % 2 === 1;
            let colIdx = 0;

            const startBx = x - (isOffset ? colStep / 2 : 0);
            for (let bx = startBx; bx < x + w + colStep; bx += colStep) {
                const color = colors[(rowIdx * 3 + colIdx) % colors.length];
                ctx.fillStyle = color;
                ctx.fillRect(bx, by, brickW, brickH);

                // Subtle top brick highlight line
                ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
                ctx.fillRect(bx, by, brickW, 0.8);

                colIdx++;
            }
            rowIdx++;
        }

        ctx.restore();
    }
}
