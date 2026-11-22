/**
 * GridSystem handles tile management, water generation, and coordinate mapping.
 */
class GridSystem {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.tiles = [];
        this.portalCol = Math.floor(GameConfig.Grid.columns / 2); // default center
        this.castleCol = Math.floor(GameConfig.Grid.columns / 2); // default center
        this.castleRow = 0; // set during placement
        this.drowningCounts = {}; // Plain object for ES5
        this.lilypadMap = {}; // Plain object for ES5
        this.waterTiles = {}; // Plain object for ES5
        this.createGrid();
        this.pathFinder = new PathFinder(this);
    }

    createGrid() {
        const tileSize = GameConfig.Grid.tileSize;
        const columns = GameConfig.Grid.columns;
        const rows = GameConfig.Grid.rows;
        const gridWidth = columns * tileSize;
        const startX = (this.canvas.width - gridWidth) / 2;
        const startY = (this.canvas.height - (rows * tileSize)) / 2;

        this.drowningCounts = {};
        this.lilypadMap = {};
        this.waterTiles = {};

        for (let row = 0; row < rows; row++) {
            this.tiles[row] = [];
            for (let col = 0; col < columns; col++) {
                const isLight = (row + col) % 2 === 0;
                const grassLight = window.textureManager.get('grid.grassLight');
                const grassDark = window.textureManager.get('grid.grassDark');
                this.tiles[row][col] = {
                    x: startX + col * tileSize, y: startY + row * tileSize,
                    row: row, col: col, color: isLight ? grassLight : grassDark,
                    occupied: false, reserved: false, water: false, overlayColor: null
                };
            }
        }

        this._origin = { x: this.tiles[0][0].x, y: this.tiles[0][0].y };
        this._buildStaticBackground();
    }

    generateWater(percent = 15, pattern = 'random') {
        this.waterTiles = {};
        const rows = GameConfig.Grid.rows;
        const columns = GameConfig.Grid.columns;

        if (pattern === 'verticalStrips') {
            const numStrips = Math.floor(Math.random() * 3) + 1;
            const avoidCols = { 0: true };
            avoidCols[this.portalCol] = true;
            if (this.castleRow > 0 && this.castleRow < rows) avoidCols[this.castleCol] = true;
            const usedCols = {};

            for (let s = 0; s < numStrips; s++) {
                const avail = [];
                for (let c = 1; c < columns; c++) { if (!avoidCols[c] && !usedCols[c]) avail.push(c); }
                if (avail.length === 0) break;
                const col = avail[Math.floor(Math.random() * avail.length)]; usedCols[col] = true;
                let width = Math.random() < 0.5 ? 1 : 2;
                for (let w = 1; w < width; w++) { if (col + w >= columns || avoidCols[col + w] || usedCols[col + w]) { width = w; break; } }
                const height = Math.floor(Math.random() * 3) + 4, startRow = Math.floor(Math.random() * (rows - height - 1)) + 1;
                for (let r = startRow; r < startRow + height && r < rows; r++) {
                    for (let w = 0; w < width; w++) {
                        const c = col + w; if (c >= columns || avoidCols[c] || usedCols[c] || r === 0) continue;
                        if (this.castleRow > 0 && this.castleRow < rows && r === this.castleRow && c === this.castleCol) continue;
                        this.tiles[r][c].water = true;
                        this.waterTiles[this.pathFinder.keyOf(this.tiles[r][c])] = true;
                    }
                }
            }
            return;
        }

        const totalTiles = rows * columns, target = Math.floor(totalTiles * (percent / 100));
        let waterCount = 0, attempts = 0;
        const shapes = [[[0, 0]], [[0, 0], [0, 1]], [[0, 0], [1, 0]], [[0, 0], [0, 1], [1, 0], [1, 1]]];

        while (waterCount < target && attempts < totalTiles * 2) {
            attempts++;
            if (attempts > 5000) { GameLogger.error("Water generation took too many attempts!"); break; }
            const shape = shapes[Math.floor(Math.random() * shapes.length)], br = Math.floor(Math.random() * rows), bc = Math.floor(Math.random() * columns);
            let ok = true;
            for (let i = 0; i < shape.length; i++) {
                const dr = shape[i][0];
                const dc = shape[i][1];
                const r = br + dr, c = bc + dc;
                if (r < 0 || r >= rows || c < 0 || c >= columns || r === 0 || this.tiles[r][c].water) { ok = false; break; }
            }
            if (!ok) continue;
            for (let i = 0; i < shape.length; i++) {
                const dr = shape[i][0];
                const dc = shape[i][1];
                const tile = this.tiles[br + dr][bc + dc];
                tile.water = true;
                this.waterTiles[this.pathFinder.keyOf(tile)] = true;
                waterCount++;
            }
        }
    }

    getWaterTiles() {
        const waterKeys = {};
        for (const key in this.waterTiles) {
            waterKeys[key] = true;
        }
        for (const key in this.lilypadMap) {
            const lp = this.lilypadMap[key];
            if (lp.isBuilt && !lp.isDestroying) {
                delete waterKeys[key];
            }
        }
        return waterKeys;
    }

    clearOverlays() {
        for (let row = 0; row < GameConfig.Grid.rows; row++) {
            for (let col = 0; col < GameConfig.Grid.columns; col++) {
                this.tiles[row][col].overlayColor = null;
            }
        }
    }

    getTileAtPosition(x, y) {
        const tileSize = GameConfig.Grid.tileSize;
        const rows = GameConfig.Grid.rows;
        const columns = GameConfig.Grid.columns;
        const col = Math.floor((x - this._origin.x) / tileSize), row = Math.floor((y - this._origin.y) / tileSize);
        return (row >= 0 && row < rows && col >= 0 && col < columns) ? this.tiles[row][col] : null;
    }

    getStructureAtTile(tile) {
        if (!tile || !window.gameScene) return null;
        const s = window.gameScene;
        const structures = [].concat(s.towers, s.walls, s.mirrors, s.spikes, s.Lilypads);
        for (let i = 0; i < structures.length; i++) {
            const ent = structures[i];
            const eTile = this.getTileAtPosition(ent.x, ent.y);
            if (eTile === tile) return ent;
        }
        return null;
    }

    isTileWalkable(tile, enemySpecial = 'normal') {
        if (tile.occupied) {
            return false;
        }
        if (tile.water && enemySpecial !== 'swim') {
            if (this.isLilypadTile(tile)) return true;
            return (this.drowningCounts[this.pathFinder.keyOf(tile)] || 0) > 0;
        }
        return true;
    }

    isLilypadTile(tile) {
        const lp = this.lilypadMap[this.pathFinder.keyOf(tile)];
        return lp && lp.isBuilt && !lp.isDestroying;
    }

    addLilypad(tile, entity) {
        this.lilypadMap[this.pathFinder.keyOf(tile)] = entity;
    }

    removeLilypad(tile) {
        delete this.lilypadMap[this.pathFinder.keyOf(tile)];
    }

    buildEnemyOccupiedSet(towers, walls, enemySpecial) {
        const occupied = {};
        const rows = GameConfig.Grid.rows;
        const cols = GameConfig.Grid.columns;

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const tile = this.tiles[r][c];
                if (!tile) continue;

                if (enemySpecial !== 'swim' && tile.water) {
                    if (!this.isLilypadTile(tile)) {
                        occupied[this.pathFinder.keyOf(tile)] = true;
                    }
                }

                if (tile.occupied) {
                    occupied[this.pathFinder.keyOf(tile)] = true;
                }
            }
        }

        // Castle tiles must NOT block pathfinding from reaching the castle end target!
        if (this.castleRow !== undefined && this.castleCol !== undefined) {
            for (let dr = 0; dr < 2; dr++) {
                for (let dc = 0; dc < 2; dc++) {
                    const r = this.castleRow + dr, c = this.castleCol + dc;
                    if (this.tiles[r] && this.tiles[r][c]) {
                        delete occupied[this.pathFinder.keyOf(this.tiles[r][c])];
                    }
                }
            }
        }

        if (this.drowningCounts && enemySpecial !== 'swim') {
            for (const key in this.drowningCounts) {
                if (this.drowningCounts[key] > 0) {
                    delete occupied[key];
                }
            }
        }

        return occupied;
    }

    tilesToCoords(pathTiles) {
        const coords = [];
        for (let i = 0; i < pathTiles.length; i++) {
            coords.push({ x: pathTiles[i].x + GameConfig.Grid.tileSize / 2, y: pathTiles[i].y + GameConfig.Grid.tileSize / 2 });
        }
        return coords;
    }

    getCenterPath(towers = [], enemySpecial = 'normal', walls = [], preferFewTurns = true) {
        const ts = GameConfig.Grid.tileSize;
        const endPos = { x: this.tiles[this.castleRow][this.castleCol].x + ts, y: this.tiles[this.castleRow][this.castleCol].y + ts };
        if (enemySpecial === 'fly') return [{ x: this.tiles[0][this.portalCol].x + ts / 2, y: this.tiles[0][this.portalCol].y + ts / 2 }, endPos];
        const startPos = { x: this.tiles[0][this.portalCol].x + ts / 2, y: this.tiles[0][this.portalCol].y + ts / 2 };
        const occupied = this.buildEnemyOccupiedSet(towers, walls, enemySpecial);
        const pathTiles = preferFewTurns ? this.pathFinder.findLowTurnPath(startPos, endPos, occupied, enemySpecial) : this.pathFinder.findPath(startPos, endPos, occupied, enemySpecial);
        return pathTiles ? this.tilesToCoords(pathTiles) : this.getStraightPath();
    }

    findPathFrom(enemyX, enemyY, towers = [], enemySpecial = 'normal', walls = [], preferFewTurns = true, raw = false) {
        const ts = GameConfig.Grid.tileSize;
        const endPos = { x: this.tiles[this.castleRow][this.castleCol].x + ts, y: this.tiles[this.castleRow][this.castleCol].y + ts };
        if (enemySpecial === 'fly') return [{ x: enemyX, y: enemyY }, endPos];
        const occupied = this.buildEnemyOccupiedSet(towers, walls, enemySpecial), enemyTile = this.getTileAtPosition(enemyX, enemyY);
        if (enemyTile) delete occupied[this.pathFinder.keyOf(enemyTile)];
        // v5.21: raw = tile-center to tile-center path (no corner-cutting smoothing); used to unstick big bodies
        this.pathFinder._raw = !!raw;
        let pathTiles;
        try { pathTiles = preferFewTurns ? this.pathFinder.findLowTurnPath({ x: enemyX, y: enemyY }, endPos, occupied, enemySpecial) : this.pathFinder.findPath({ x: enemyX, y: enemyY }, endPos, occupied, enemySpecial); }
        finally { this.pathFinder._raw = false; }
        return pathTiles ? this.tilesToCoords(pathTiles) : null;
    }

    getStraightPath() {
        const path = [], col = this.portalCol;
        for (let row = 0; row < GameConfig.Grid.rows; row++) {
            const tile = this.tiles[row][col];
            path.push({ x: tile.x + GameConfig.Grid.tileSize / 2, y: tile.y + GameConfig.Grid.tileSize / 2 });
        }
        return path;
    }

    render() {
        const time = Date.now() * 0.001, ts = GameConfig.Grid.tileSize;
        if (this._staticBgCanvas) this.ctx.drawImage(this._staticBgCanvas, 0, 0);
        for (let row = 0; row < GameConfig.Grid.rows; row++) {
            for (let col = 0; col < GameConfig.Grid.columns; col++) {
                const tile = this.tiles[row][col]; if (!tile.water) continue;
                const img = window.textureManager.getImage('grid', 'water');
                if (img) { this.ctx.drawImage(img, tile.x, tile.y, ts, ts); continue; }
                const wave = Math.sin(time * 2 + (tile.row + tile.col) * 0.5) * 0.5, waterBase = window.textureManager.get('grid.waterBase'), baseBlue = waterBase[2] + Math.floor(wave * 20);
                const grad = this.ctx.createLinearGradient(tile.x, tile.y, tile.x, tile.y + ts);
                grad.addColorStop(0, 'rgb(' + waterBase[0] + ', ' + (waterBase[1] + (baseBlue - waterBase[2])) + ', ' + (baseBlue + 20) + ')'); grad.addColorStop(1, 'rgb(' + (waterBase[0] - 20) + ', ' + (waterBase[1] + (baseBlue - waterBase[2]) - 20) + ', ' + baseBlue + ')');
                this.ctx.fillStyle = grad; this.ctx.fillRect(tile.x, tile.y, ts, ts);
                this.ctx.strokeStyle = 'rgba(200, 230, 255, ' + (0.2 + wave * 0.1) + ')'; this.ctx.lineWidth = 1.5;
                for (let i = 0; i < 2; i++) {
                    const yOff = ts * (0.3 + i * 0.35) + Math.sin(time * 3 + (tile.row + tile.col) * 0.8 + i) * 3;
                    this.ctx.beginPath(); this.ctx.moveTo(tile.x + 4, tile.y + yOff); this.ctx.quadraticCurveTo(tile.x + ts / 2, tile.y + yOff + 3, tile.x + ts - 4, tile.y + yOff); this.ctx.stroke();
                }
                const sparkSeed = (tile.row * 7 + tile.col * 13) % 100, sparkPhase = (time * 1.5 + sparkSeed) % (Math.PI * 2), sparkAlpha = Math.max(0, Math.sin(sparkPhase)) * 0.6;
                if (sparkAlpha > 0.1) { this.ctx.fillStyle = window.textureManager.get('grid.waterSparkle'); this.ctx.beginPath(); this.ctx.arc(tile.x + ts * (0.2 + (sparkSeed % 60) / 100), tile.y + ts * (0.3 + (sparkSeed % 40) / 100), 1.5, 0, Math.PI * 2); this.ctx.fill(); }
                this.ctx.strokeStyle = 'rgba(30, 100, 160, 0.4)'; this.ctx.strokeRect(tile.x, tile.y, ts, ts);
            }
        }
        for (let row = 0; row < GameConfig.Grid.rows; row++) {
            for (let col = 0; col < GameConfig.Grid.columns; col++) {
                const tile = this.tiles[row][col]; if (tile.overlayColor) { this.ctx.fillStyle = tile.overlayColor; this.ctx.fillRect(tile.x, tile.y, ts, ts); }
            }
        }
    }

    _buildStaticBackground() {
        const tileSize = GameConfig.Grid.tileSize;
        const columns = GameConfig.Grid.columns;
        const rows = GameConfig.Grid.rows;
        const canvas = document.createElement('canvas'); canvas.width = this.canvas.width; canvas.height = this.canvas.height;
        const ctx = canvas.getContext('2d');
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < columns; col++) {
                const tile = this.tiles[row][col]; if (tile.water) continue;
                const grassImg = window.textureManager.getImage('grid', 'grass');
                if (grassImg) { ctx.drawImage(grassImg, tile.x, tile.y, tileSize, tileSize); continue; }
                ctx.fillStyle = tile.color; ctx.fillRect(tile.x, tile.y, tileSize, tileSize);
                const seed = (tile.row * 31 + tile.col * 17) % 100;
                if (seed < 40) {
                    const tx = tile.x + tileSize * (0.15 + (seed % 70) / 100), ty = tile.y + tileSize * (0.2 + (seed % 60) / 100);
                    ctx.strokeStyle = 'rgba(60, 140, 60, 0.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(tx, ty + 3); ctx.lineTo(tx, ty); ctx.stroke();
                    ctx.beginPath(); ctx.moveTo(tx + 2, ty + 3); ctx.lineTo(tx + 2, ty); ctx.stroke();
                }
                ctx.strokeStyle = window.textureManager.get('grid.border'); ctx.strokeRect(tile.x, tile.y, tileSize, tileSize);
            }
        }
        this._staticBgCanvas = canvas;
    }
}
