const MAX_PLACEMENT_LEVEL = 5;

/**
 * GameStateManager handles gold, score, health, and global state transitions.
 */
class GameStateManager {
    constructor() {
        this.score = 0;
        this.gold = GameConfig.Difficulty.startingGold;
        this.round = 0;
        this.isPlaying = false;
        this.isPaused = false;
        this.castleHealth = GameConfig.Castle.maxHealth;
        this.gameOverTriggered = false;

        this.placementUpgrades = {};
        this.placementUpgradeState = {};

        this.callbacks = {
            scoreChanged: [],
            goldChanged: [],
            roundChanged: [],
            castleHealthChanged: [],
            gameOver: []
        };
    }

    getPlacementLevel(type) {
        return this.placementUpgrades[type] || 0;
    }

    getPlacementUpgradeCost(type) {
        const level = this.getPlacementLevel(type);
        const btnDef = BUILD_BUTTONS.find(function(b) { return b.type === type; });
        const base = btnDef ? btnDef.cost : 10;
        return Math.floor(base * POW_3[Math.min(level, 6)]);
    }

    canUpgradePlacement(type) {
        return this.getPlacementLevel(type) < MAX_PLACEMENT_LEVEL;
    }

    addGold(amount) {
        this.gold += amount;
        if (window.balanceAnalytics) window.balanceAnalytics.onGoldEarned(amount);
        this.notify('goldChanged', this.gold);
    }

    spendGold(amount) {
        if (this.gold >= amount) {
            this.gold -= amount;
            if (window.balanceAnalytics) window.balanceAnalytics.onGoldSpent(amount);
            this.notify('goldChanged', this.gold);
            return true;
        }
        return false;
    }

    setCastleHealth(health) {
        this.castleHealth = health;
        this.notify('castleHealthChanged', health);

        if (health <= 0 && !this.gameOverTriggered && this.isPlaying) {
            this.gameOverTriggered = true;
            this.isPlaying = false;
            this.notify('gameOver');
        }
    }

    nextRound() {
        this.round++;
        this.notify('roundChanged', this.round);
    }

    reset() {
        this.score = 0;
        this.gold = GameConfig.Difficulty.startingGold;
        this.round = 0;
        this.isPlaying = false;
        this.isPaused = false;
        this.castleHealth = GameConfig.Castle.maxHealth;
        this.gameOverTriggered = false;
        this.placementUpgrades = {};
        this.placementUpgradeState = {};
        if (window.balanceAnalytics) window.balanceAnalytics.reset();

        this.notify('scoreChanged', this.score);
        this.notify('goldChanged', this.gold);
        this.notify('roundChanged', this.round);
        this.notify('castleHealthChanged', this.castleHealth);
    }

    addScore(points) {
        // GDD §2: Composite Score
    }

    on(event, callback) {
        if (this.callbacks[event]) {
            this.callbacks[event].push(callback);
        }
    }

    notify(event, data) {
        if (this.callbacks[event]) {
            for (let i = 0; i < this.callbacks[event].length; i++) {
                this.callbacks[event][i](data);
            }
        }
    }
}

/**
 * A* Pathfinding logic with binary heap and diagonal support.
 */
class PathFinder {
    constructor(gridSystem) {
        this.gridSystem = gridSystem;
        this.allowDiagonal = true;
    }

    keyOf(tile) { return tile.row * 10000 + tile.col; }

    findPath(startPos, endPos, occupiedTiles = {}) {
        const startTile = this.gridSystem.getTileAtPosition(startPos.x, startPos.y);
        const endTile = this.gridSystem.getTileAtPosition(endPos.x, endPos.y);

        if (!startTile || !endTile) return null;
        if (startTile === endTile) return [startTile];

        const openHeap = new MinHeap(function(a, b) { return a.f - b.f; });
        const closedSet = {};
        const cameFrom = {};
        const gScore = {};

        const startKey = this.keyOf(startTile);
        const endKey = this.keyOf(endTile);

        gScore[startKey] = 0;
        openHeap.push({ tile: startTile, f: this.heuristic(startTile, endTile), key: startKey });

        let iterations = 0;
        const MAX_ITERATIONS = 1000;

        while (openHeap.size() > 0) {
            if (iterations++ > MAX_ITERATIONS) { GameLogger.error("Pathfinding infinite loop guard triggered!"); return null; }
            const current = openHeap.pop();
            const currentKey = current.key;

            if (currentKey === endKey) {
                return this.smoothPath(this.reconstructPath(cameFrom, current.tile), occupiedTiles);
            }

            closedSet[currentKey] = true;

            const neighbors = this.getNeighbors(current.tile, occupiedTiles, closedSet);
            for (let i = 0; i < neighbors.length; i++) {
                const n = neighbors[i];
                const neighbor = n.neighbor;
                const cost = n.cost;
                const neighborKey = this.keyOf(neighbor);
                if (closedSet[neighborKey]) continue;

                const tentativeG = gScore[currentKey] + cost;

                if (gScore[neighborKey] === undefined || tentativeG < gScore[neighborKey]) {
                    cameFrom[neighborKey] = current.tile;
                    gScore[neighborKey] = tentativeG;
                    const f = tentativeG + this.heuristic(neighbor, endTile);
                    openHeap.push({ tile: neighbor, f: f, key: neighborKey });
                }
            }
        }
        return null;
    }

    findLowTurnPath(startPos, endPos, occupiedTiles = {}, enemySpecial = 'normal') {
        const startTile = this.gridSystem.getTileAtPosition(startPos.x, startPos.y);
        const endTile = this.gridSystem.getTileAtPosition(endPos.x, endPos.y);
        if (!startTile || !endTile) return null;
        if (startTile === endTile) return [startTile];

        const openHeap = new MinHeap(function(a, b) { return a.f - b.f; });
        const closedSet = {};
        const cameFrom = {};
        const gScore = {};
        const startKey = this.keyOf(startTile) + ":start";
        const endTileKey = this.keyOf(endTile);
        const turnPenalty = 0.5;
        const directions = [
            { dr: -1, dc: 0 }, { dr: 1, dc: 0 }, { dr: 0, dc: -1 }, { dr: 0, dc: 1 },
            { dr: -1, dc: -1 }, { dr: -1, dc: 1 }, { dr: 1, dc: -1 }, { dr: 1, dc: 1 },
        ];

        gScore[startKey] = 0;
        openHeap.push({
            tile: startTile,
            direction: null,
            key: startKey,
            f: Math.abs(startTile.row - endTile.row) + Math.abs(startTile.col - endTile.col),
        });

        let iterations = 0;
        const MAX_ITERATIONS = 2000;

        while (openHeap.size() > 0) {
            if (iterations++ > MAX_ITERATIONS) { GameLogger.error("LowTurn pathfinding infinite loop guard triggered!"); return null; }
            const current = openHeap.pop();
            if (closedSet[current.key]) continue;
            if (this.keyOf(current.tile) === endTileKey) {
                const path = [];
                let pathState = current;
                while (pathState) {
                    path.push(pathState.tile);
                    pathState = cameFrom[pathState.key];
                }
                path.reverse();
                return this.smoothPath(path, occupiedTiles);
            }
            closedSet[current.key] = true;

            for (let i = 0; i < directions.length; i++) {
                const d = directions[i];
                const dr = d.dr;
                const dc = d.dc;
                const row = current.tile.row + dr;
                const col = current.tile.col + dc;
                if (row < 0 || row >= GameConfig.Grid.rows || col < 0 || col >= GameConfig.Grid.columns) continue;

                const neighbor = this.gridSystem.tiles[row][col];
                const direction = dr + "," + dc;
                const key = this.keyOf(neighbor) + ":" + direction;
                if (occupiedTiles[this.keyOf(neighbor)] || closedSet[key]) continue;

                // Diagonal Corner Squeeze Guard
                if (dr !== 0 && dc !== 0) {
                    const corner1 = this.gridSystem.tiles[current.tile.row + dr][current.tile.col];
                    const corner2 = this.gridSystem.tiles[current.tile.row][current.tile.col + dc];
                    if (occupiedTiles[this.keyOf(corner1)] || occupiedTiles[this.keyOf(corner2)]) continue;
                }

                const turnCost = current.direction && current.direction !== direction ? turnPenalty : 0;
                const tentativeG = gScore[current.key] + this.getTileCost(neighbor, enemySpecial, occupiedTiles) + turnCost;
                if (gScore[key] === undefined || tentativeG < gScore[key]) {
                    cameFrom[key] = current;
                    gScore[key] = tentativeG;
                    const heuristic = Math.abs(row - endTile.row) + Math.abs(col - endTile.col);
                    openHeap.push({ tile: neighbor, direction: direction, key: key, f: tentativeG + heuristic });
                }
            }
        }
        return null;
    }

    heuristic(a, b) {
        const dr = Math.abs(a.row - b.row);
        const dc = Math.abs(a.col - b.col);
        if (this.allowDiagonal) {
            return (dr + dc) + (Math.SQRT2 - 2) * Math.min(dr, dc);
        }
        return dr + dc;
    }

    getTileCost(tile, enemySpecial, occupied) {
        let cost = 1.0;
        if (enemySpecial === 'swim') {
            if (this.gridSystem.isLilypadTile(tile)) cost = 0.05;
            else if (tile.water) cost = 0.3;
            else cost = 1.5;
        }

        if (occupied) {
            const neighborCount = this.getOccupiedNeighborCount(tile, occupied);
            if (neighborCount > 0) {
                cost += neighborCount === 1 ? 0.2 : neighborCount === 2 ? 0.8 : 2.5;
            }
        }

        return cost;
    }

    getOccupiedNeighborCount(tile, occupied, cardinalOnly = false) {
        const row = tile.row, col = tile.col;
        let count = 0;
        const checkDirs = cardinalOnly ?
            [[-1, 0], [1, 0], [0, -1], [0, 1]] :
            [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];

        for (let i = 0; i < checkDirs.length; i++) {
            const r = row + checkDirs[i][0], c = col + checkDirs[i][1];
            if (r < 0 || r >= GameConfig.Grid.rows || c < 0 || c >= GameConfig.Grid.columns) continue;
            if (occupied[r * 10000 + c]) count++;
        }
        return count;
    }

    isNearOccupied(tile, occupied) {
        return this.getOccupiedNeighborCount(tile, occupied) > 0;
    }

    getNeighbors(tile, occupied, closedSet, enemySpecial = 'normal') {
        const neighbors = [];
        const row = tile.row, col = tile.col;
        const directions = [
            { dr: -1, dc: 0, cost: 1 }, { dr: 1, dc: 0, cost: 1 }, { dr: 0, dc: -1, cost: 1 }, { dr: 0, dc: 1, cost: 1 },
            { dr: -1, dc: -1, cost: Math.SQRT2 }, { dr: -1, dc: 1, cost: Math.SQRT2 },
            { dr: 1, dc: -1, cost: Math.SQRT2 }, { dr: 1, dc: 1, cost: Math.SQRT2 },
        ];

        for (let i = 0; i < directions.length; i++) {
            const d = directions[i];
            const newRow = row + d.dr, newCol = col + d.dc;
            if (newRow < 0 || newRow >= GameConfig.Grid.rows || newCol < 0 || newCol >= GameConfig.Grid.columns) continue;
            const neighbor = this.gridSystem.tiles[newRow][newCol], neighborKey = this.keyOf(neighbor);
            if (occupied[neighborKey]) continue;

            if (d.dr !== 0 && d.dc !== 0) {
                const corner1 = this.gridSystem.tiles[row + d.dr][col];
                const corner2 = this.gridSystem.tiles[row][col + d.dc];
                if (occupied[this.keyOf(corner1)] || occupied[this.keyOf(corner2)]) continue;
            }
            neighbors.push({ neighbor: neighbor, cost: d.cost * this.getTileCost(neighbor, enemySpecial, occupied) });
        }
        return neighbors;
    }

    reconstructPath(cameFrom, current) {
        const path = [current];
        let key = this.keyOf(current);
        let safety = 0;
        while (cameFrom[key] && safety++ < 1000) {
            current = cameFrom[key];
            key = this.keyOf(current);
            path.push(current);
        }
        path.reverse();
        return path;
    }

    smoothPath(path, occupied = {}) {
        if (!path || path.length <= 2 || this._raw) return path;
        const smoothed = [path[0]];
        let currentIdx = 0;

        while (currentIdx < path.length - 1) {
            let nextIdx = currentIdx + 1;
            for (let i = path.length - 1; i > currentIdx + 1; i--) {
                if (this.hasLineOfSight(path[currentIdx], path[i], occupied)) {
                    nextIdx = i;
                    break;
                }
            }
            smoothed.push(path[nextIdx]);
            currentIdx = nextIdx;
        }
        return smoothed;
    }

    hasLineOfSight(t1, t2, occupied) {
        if (!t1 || !t2) return false;
        let x1 = t1.col, y1 = t1.row;
        const x2 = t2.col, y2 = t2.row;
        const dx = Math.abs(x2 - x1), dy = Math.abs(y2 - y1);
        const sx = (x1 < x2) ? 1 : -1, sy = (y1 < y2) ? 1 : -1;
        let err = dx - dy, safety = 0;

        while (safety++ < 100) {
            if (x1 === x2 && y1 === y2) break;
            const oldX = x1, oldY = y1;
            const e2 = 2 * err;
            if (e2 > -dy) { err -= dy; x1 += sx; }
            if (e2 < dx) { err += dx; y1 += sy; }

            if (x1 !== oldX && y1 !== oldY) {
                if (occupied[oldY * 10000 + x1] || occupied[y1 * 10000 + oldX]) return false;
            }
            if (x1 === x2 && y1 === y2) break;
            if (occupied[y1 * 10000 + x1]) return false;
            if (this.getOccupiedNeighborCount({ row: y1, col: x1 }, occupied, true) >= 2) return false;
        }
        return true;
    }

    buildOccupiedSet(towers, walls, mirrors = [], extraTile = null) {
        const occupied = this.gridSystem.getWaterTiles();
        const allBlockers = [].concat(towers, walls, mirrors);
        for (let i = 0; i < allBlockers.length; i++) {
            const b = allBlockers[i];
            if (b.isDestroying) continue;
            const t = this.gridSystem.getTileAtPosition(b.x, b.y);
            if (t) occupied[this.keyOf(t)] = true;
        }
        if (extraTile) occupied[this.keyOf(extraTile)] = true;
        return occupied;
    }

    canPlaceTower(tile, towers, walls = [], mirrors = []) {
        if (!tile || tile.water) return true;
        const occupied = this.buildOccupiedSet(towers, walls, mirrors, tile);
        const startTile = this.gridSystem.tiles[0][this.gridSystem.portalCol];

        const ts = GameConfig.Grid.tileSize;
        const endX = this.gridSystem.tiles[this.gridSystem.castleRow][this.gridSystem.castleCol].x + ts;
        const endY = this.gridSystem.tiles[this.gridSystem.castleRow][this.gridSystem.castleCol].y + ts;

        if (!startTile) return true;
        if (tile.reserved) return false;

        return this.findPath({ x: startTile.x, y: startTile.y }, { x: endX, y: endY }, occupied) !== null;
    }

    canPlaceCastle(tile, towers = [], walls = [], mirrors = []) {
        if (!tile) return false;
        const r = tile.row, c = tile.col;
        const rows = GameConfig.Grid.rows, cols = GameConfig.Grid.columns;

        for (let dr = 0; dr < 2; dr++) {
            for (let dc = 0; dc < 2; dc++) {
                const row = r + dr, col = c + dc;
                if (row >= rows || col >= cols) return false;
                const t = this.gridSystem.tiles[row][col];
                if (t.water || t.occupied || t.reserved) return false;
            }
        }

        const occupied = this.buildOccupiedSet(towers, walls, mirrors);
        const startTile = this.gridSystem.tiles[0][this.gridSystem.portalCol];

        return this.findPath({ x: startTile.x, y: startTile.y }, { x: tile.x, y: tile.y }, occupied) !== null;
    }
}

/**
 * Binary min-heap for efficient open-set management in A*.
 */
class MinHeap {
    constructor(compareFn) {
        this.heap = [];
        this.compare = compareFn;
    }
    size() { return this.heap.length; }
    push(item) {
        this.heap.push(item);
        this.bubbleUp(this.heap.length - 1);
    }
    pop() {
        if (this.heap.length === 0) return null;
        const top = this.heap[0], last = this.heap.pop();
        if (this.heap.length > 0) { this.heap[0] = last; this.bubbleDown(0); }
        return top;
    }
    bubbleUp(idx) {
        while (idx > 0) {
            const parent = Math.floor((idx - 1) / 2);
            if (this.compare(this.heap[idx], this.heap[parent]) >= 0) break;
            const temp = this.heap[idx];
            this.heap[idx] = this.heap[parent];
            this.heap[parent] = temp;
            idx = parent;
        }
    }
    bubbleDown(idx) {
        const n = this.heap.length;
        while (true) {
            let smallest = idx;
            const left = 2 * idx + 1, right = 2 * idx + 2;
            if (left < n && this.compare(this.heap[left], this.heap[smallest]) < 0) smallest = left;
            if (right < n && this.compare(this.heap[right], this.heap[smallest]) < 0) smallest = right;
            if (smallest === idx) break;
            const temp = this.heap[idx];
            this.heap[idx] = this.heap[smallest];
            this.heap[smallest] = temp;
            idx = smallest;
        }
    }
}
