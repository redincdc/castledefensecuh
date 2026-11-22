/* Castle Defense Cuh v5.18 polish layer.
 * Visual-only: terrain + path art, tower/enemy art, combat juice, placement preview,
 * HUD extras and the first-run Level 1 tutorial. Does not touch balance or wave data,
 * and never calls Math.random (seeded test runs stay identical). */
(function () {
    'use strict';
    if (typeof GameScene === 'undefined') return;

    // ---------- helpers ----------
    let _seed = 0x2F6E2B1;
    function frand() { // own PRNG for cosmetics only
        _seed |= 0; _seed = (_seed + 0x6D2B79F5) | 0;
        let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    function hash(a, b) { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
    const _colCtx = document.createElement('canvas').getContext('2d');
    const _colCache = {};
    function rgb(c) {
        if (_colCache[c]) return _colCache[c];
        _colCtx.fillStyle = '#000'; _colCtx.fillStyle = c;
        const v = _colCtx.fillStyle; let out;
        if (v[0] === '#') out = [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)];
        else { const m = v.match(/[\d.]+/g) || [128, 128, 128]; out = [+m[0], +m[1], +m[2]]; }
        _colCache[c] = out; return out;
    }
    function shade(c, amt) { // amt -1..1
        const [r, g, b] = rgb(c);
        const f = (x) => Math.round(amt >= 0 ? x + (255 - x) * amt : x * (1 + amt));
        return 'rgb(' + f(r) + ',' + f(g) + ',' + f(b) + ')';
    }
    function rrect(ctx, x, y, w, h, r) {
        r = Math.min(r, w / 2, h / 2);
        ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    }
    const isBot = () => !!window.__BOT;
    const scene = () => window.gameScene;

    // ---------- 3. Terrain ----------
    if (typeof GridSystem !== 'undefined') {
        const origBuild = GridSystem.prototype._buildStaticBackground;
        GridSystem.prototype._buildStaticBackground = function () {
            if (window.textureManager && window.textureManager.getImage('grid', 'grass')) return origBuild.call(this);
            const ts = GameConfig.Grid.tileSize, cols = GameConfig.Grid.columns, rows = GameConfig.Grid.rows;
            const canvas = document.createElement('canvas'); canvas.width = this.canvas.width; canvas.height = this.canvas.height;
            const ctx = canvas.getContext('2d');
            const W = canvas.width, H = canvas.height;
            // soft base gradient
            const g = ctx.createLinearGradient(0, 0, 0, H);
            g.addColorStop(0, '#5fa94a'); g.addColorStop(1, '#4f9a40');
            ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
            for (let row = 0; row < rows; row++) {
                for (let col = 0; col < cols; col++) {
                    const t = this.tiles[row][col]; if (t.water) continue;
                    // subtle checker so tiles stay readable for building
                    ctx.fillStyle = ((row + col) % 2 === 0) ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.035)';
                    ctx.fillRect(t.x, t.y, ts, ts);
                    // mottled patches
                    for (let k = 0; k < 3; k++) {
                        const h1 = hash(row * 7 + k, col * 13 + k * 3), h2 = hash(col * 5 + k, row * 11 - k);
                        ctx.fillStyle = h1 > 0.5 ? 'rgba(120,190,80,0.16)' : 'rgba(30,90,30,0.13)';
                        ctx.beginPath(); ctx.ellipse(t.x + ts * h1, t.y + ts * h2, ts * (0.18 + h2 * 0.2), ts * (0.1 + h1 * 0.12), h1 * 3, 0, Math.PI * 2); ctx.fill();
                    }
                    // grass tufts
                    const tufts = 2 + Math.floor(hash(row, col) * 3);
                    ctx.lineCap = 'round';
                    for (let k = 0; k < tufts; k++) {
                        const hx = hash(row * 31 + k, col * 17), hy = hash(col * 29 + k, row * 19);
                        const x = t.x + ts * (0.12 + hx * 0.76), y = t.y + ts * (0.2 + hy * 0.7), h = ts * (0.08 + hx * 0.06);
                        ctx.strokeStyle = hy > 0.5 ? 'rgba(40,110,35,0.55)' : 'rgba(150,210,95,0.5)';
                        ctx.lineWidth = Math.max(1, ts * 0.03);
                        ctx.beginPath(); ctx.moveTo(x - h * 0.5, y - h); ctx.lineTo(x, y); ctx.lineTo(x + h * 0.5, y - h); ctx.moveTo(x, y); ctx.lineTo(x, y - h * 1.2); ctx.stroke();
                    }
                    // flowers and pebbles
                    const d = hash(row * 101, col * 37);
                    if (d < 0.07) {
                        const fx = t.x + ts * (0.25 + hash(row, col * 3) * 0.5), fy = t.y + ts * (0.25 + hash(row * 3, col) * 0.5), fr = Math.max(1.2, ts * 0.045);
                        ctx.fillStyle = d < 0.035 ? '#fff7d6' : '#ffd84d';
                        for (let p = 0; p < 5; p++) { const a = p * 1.2566; ctx.beginPath(); ctx.arc(fx + Math.cos(a) * fr, fy + Math.sin(a) * fr, fr * 0.8, 0, Math.PI * 2); ctx.fill(); }
                        ctx.fillStyle = '#e3902a'; ctx.beginPath(); ctx.arc(fx, fy, fr * 0.7, 0, Math.PI * 2); ctx.fill();
                    } else if (d < 0.12) {
                        const px = t.x + ts * (0.2 + hash(col, row * 5) * 0.6), py = t.y + ts * (0.3 + hash(col * 5, row) * 0.5);
                        ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.beginPath(); ctx.ellipse(px + 1, py + 1.5, ts * 0.09, ts * 0.06, 0, 0, Math.PI * 2); ctx.fill();
                        ctx.fillStyle = '#9ea39a'; ctx.beginPath(); ctx.ellipse(px, py, ts * 0.09, ts * 0.06, 0, 0, Math.PI * 2); ctx.fill();
                        ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.ellipse(px - ts * 0.02, py - ts * 0.02, ts * 0.04, ts * 0.025, 0, 0, Math.PI * 2); ctx.fill();
                    }
                    ctx.strokeStyle = 'rgba(0,0,0,0.07)'; ctx.lineWidth = 1; ctx.strokeRect(t.x + 0.5, t.y + 0.5, ts - 1, ts - 1);
                }
            }
            // vignette edge
            const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.45, W / 2, H / 2, Math.max(W, H) * 0.75);
            v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,30,0,0.28)');
            ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
            this._staticBgCanvas = canvas;
        };

        // Dirt trail along the current enemy route
        const origRender = GridSystem.prototype.render;
        GridSystem.prototype.render = function () {
            origRender.call(this);
            const s = scene();
            if (!s || s.gridSystem !== this || !s.castle || s.placementMode) return;
            try { drawTrail(s, this, 'ground'); } catch (e) { /* cosmetic only */ }
        };
        // v5.21: direction chevrons + a thin guide line are drawn again AFTER spikes/lilypads (game.js calls this
        // between render pass 1 and 2) so the path stays readable through spike traps
        window.CDC_drawTrailOver = function (s) {
            if (!s || !s.castle || s.placementMode || !s.gridSystem) return;
            try { drawTrail(s, s.gridSystem, 'over'); } catch (e) { /* cosmetic only */ }
        };
    }

    function pathKey(s) {
        let k = s.gridSystem.portalCol + ':' + s.gridSystem.castleRow + ',' + s.gridSystem.castleCol + '|' + GameConfig.Grid.tileSize;
        for (let i = 0; i < s.towers.length; i++) k += ';' + (s.towers[i].x | 0) + ',' + (s.towers[i].y | 0);
        for (let i = 0; i < s.walls.length; i++) k += ';w' + (s.walls[i].x | 0) + ',' + (s.walls[i].y | 0);
        return k;
    }
    function drawTrail(s, gs, layer) {
        const key = pathKey(s);
        if (key !== s._cdcTrailKey) {
            s._cdcTrailKey = key;
            s._cdcTrail = gs.getCenterPath(s.towers, 'normal', s.walls, true) || null;
        }
        const pts = s._cdcTrail; if (!pts || pts.length < 2) return;
        const ctx = gs.ctx, ts = GameConfig.Grid.tileSize;
        ctx.save();
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        const trace = () => { ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y); };
        if (layer !== 'over') { // v5.21: lighter, see-through dirt band (was 0.45 / 0.78 / 0.45)
            trace(); ctx.strokeStyle = 'rgba(92,62,30,0.2)'; ctx.lineWidth = ts * 0.74; ctx.stroke();
            trace(); ctx.strokeStyle = 'rgba(181,140,86,0.32)'; ctx.lineWidth = ts * 0.6; ctx.stroke();
            trace(); ctx.strokeStyle = 'rgba(214,180,124,0.2)'; ctx.lineWidth = ts * 0.26; ctx.stroke();
            ctx.restore(); return;
        }
        // above spikes: faint dashed guide line + marching chevrons showing which way enemies walk
        trace(); ctx.setLineDash([ts * 0.18, ts * 0.22]); ctx.strokeStyle = 'rgba(255,240,200,0.35)'; ctx.lineWidth = Math.max(1, ts * 0.05); ctx.stroke(); ctx.setLineDash([]);
        const t = performance.now() / 1000;
        ctx.fillStyle = 'rgba(255,240,200,0.72)'; ctx.strokeStyle = 'rgba(60,40,15,0.5)'; ctx.lineWidth = Math.max(0.8, ts * 0.025);
        let acc = 0; const spacing = ts * 1.1, offset = (t * ts * 0.9) % spacing;
        for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1], b = pts[i], dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy); if (!len) continue;
            const ang = Math.atan2(dy, dx);
            let d = (spacing - ((acc - offset) % spacing + spacing) % spacing) % spacing;
            for (; d < len; d += spacing) {
                const x = a.x + dx * d / len, y = a.y + dy * d / len, c = ts * 0.1;
                ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
                ctx.beginPath(); ctx.moveTo(c, 0); ctx.lineTo(-c, -c); ctx.lineTo(-c * 0.4, 0); ctx.lineTo(-c, c); ctx.closePath(); ctx.fill(); ctx.stroke();
                ctx.restore();
            }
            acc += len;
        }
        ctx.restore();
    }

    // ---------- 3. Tower art (weapon tower bases) ----------
    if (typeof Tower !== 'undefined') {
        const origBase = Tower.prototype.renderBase;
        const WEAPONS = { machinegun: 1, cannon: 1, mortar: 1, tesla: 1, aa: 1, sniper: 1, frost: 1, flame: 1, upgrader: 1, laser: 1 };
        Tower.prototype.renderBase = function (ctx) {
            const size = this.size || GameConfig.Grid.tileSize || 40;
            const baseImg = (this.type === 'cannon') ? null : (window.textureManager && window.textureManager.getImage('towers', this.type + '_base'));
            if (baseImg || !WEAPONS[this.type]) return origBase.call(this, ctx);
            ctx.save(); ctx.translate(this.x, this.y);
            const enhanceCount = this.enhancedBy ? this.enhancedBy.size : 0;
            if (enhanceCount > 0) {
                const pulse = 0.4 + Math.sin(Date.now() / 250) * 0.15, glowR = size * 0.7;
                const grad = ctx.createRadialGradient(0, 0, size * 0.3, 0, 0, glowR);
                grad.addColorStop(0, `rgba(255, 215, 0, ${0.4 * pulse * enhanceCount})`); grad.addColorStop(0.6, `rgba(255, 180, 0, ${0.15 * pulse * enhanceCount})`); grad.addColorStop(1, 'rgba(255, 180, 0, 0)');
                ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(0, 0, glowR, 0, Math.PI * 2); ctx.fill();
            }
            const lvl = this.upgradeLevel || 0;
            if (lvl > 0 && this.isBuilt) {
                const t = Date.now() / 1000;
                const auraColors = [{ r: 0, g: 220, b: 255 }, { r: 255, g: 80, b: 220 }, { r: 255, g: 200, b: 60 }, { r: 220, g: 20, b: 60 }, { r: 255, g: 245, b: 200 }];
                const c = auraColors[Math.min(lvl - 1, 4)], pulse = 0.5 + Math.sin(t * 3) * 0.2, auraR = size * (0.65 + lvl * 0.08);
                const grad = ctx.createRadialGradient(0, 0, size * 0.35, 0, 0, auraR);
                grad.addColorStop(0, `rgba(${c.r}, ${c.g}, ${c.b}, ${0.35 * pulse})`); grad.addColorStop(1, `rgba(${c.r}, ${c.g}, ${c.b}, 0)`);
                ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(0, 0, auraR, 0, Math.PI * 2); ctx.fill();
            }
            const s = size * 0.94, h = s / 2, r = s * 0.2, col = this.color || '#888';
            // drop shadow
            ctx.fillStyle = 'rgba(0,0,0,0.28)'; rrect(ctx, -h + s * 0.05, -h + s * 0.08, s, s, r); ctx.fill();
            // stone plinth
            const g = ctx.createLinearGradient(0, -h, 0, h);
            g.addColorStop(0, shade(col, 0.28)); g.addColorStop(0.55, col); g.addColorStop(1, shade(col, -0.3));
            ctx.fillStyle = g; rrect(ctx, -h, -h, s, s, r); ctx.fill();
            ctx.lineWidth = Math.max(1.5, s * 0.05); ctx.strokeStyle = shade(col, -0.55); ctx.stroke();
            // inner plate
            const ip = s * 0.16;
            rrect(ctx, -h + ip, -h + ip, s - ip * 2, s - ip * 2, r * 0.6);
            ctx.fillStyle = 'rgba(0,0,0,0.13)'; ctx.fill();
            ctx.lineWidth = Math.max(1, s * 0.025); ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.stroke();
            // top bevel glint
            ctx.fillStyle = 'rgba(255,255,255,0.22)'; rrect(ctx, -h + s * 0.12, -h + s * 0.05, s * 0.76, s * 0.08, s * 0.04); ctx.fill();
            // rivets
            ctx.fillStyle = shade(col, -0.45);
            const rv = Math.max(1.2, s * 0.045), ro = h - s * 0.09;
            [[-ro, -ro], [ro, -ro], [-ro, ro], [ro, ro]].forEach(p => { ctx.beginPath(); ctx.arc(p[0], p[1], rv, 0, Math.PI * 2); ctx.fill(); });
            // upgrade pips along the bottom edge
            if (lvl > 0) {
                const n = Math.min(lvl, 5), pr = Math.max(1.6, s * 0.05), gap = pr * 2.6, x0 = -((n - 1) * gap) / 2, y0 = h - s * 0.085;
                for (let i = 0; i < n; i++) {
                    ctx.fillStyle = '#3a2a00'; ctx.beginPath(); ctx.arc(x0 + i * gap, y0, pr + 0.8, 0, Math.PI * 2); ctx.fill();
                    ctx.fillStyle = '#FFD54F'; ctx.beginPath(); ctx.arc(x0 + i * gap, y0, pr, 0, Math.PI * 2); ctx.fill();
                }
            }
            if (lvl >= 5) {
                const pulse = 0.5 + Math.sin(Date.now() / 300) * 0.3;
                ctx.fillStyle = `rgba(255, 230, 120, ${0.35 * pulse})`; ctx.beginPath(); ctx.arc(0, 0, s * 0.16, 0, Math.PI * 2); ctx.fill();
            }
            ctx.restore();
        };
    }

    // ---------- 3. Enemy art ----------
    function feet(ctx, e, r, col) {
        const ph = e.walkPhase || 0, sw = Math.sin(ph) * r * 0.18;
        ctx.fillStyle = shade(col, -0.5);
        ctx.beginPath(); ctx.ellipse(-r * 0.42, r * 0.78 + sw, r * 0.24, r * 0.16, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(r * 0.42, r * 0.78 - sw, r * 0.24, r * 0.16, 0, 0, Math.PI * 2); ctx.fill();
    }
    function blob(ctx, x, y, r, col) {
        ctx.fillStyle = shade(col, -0.55); ctx.beginPath(); ctx.arc(x, y, r + Math.max(1, r * 0.12), 0, Math.PI * 2); ctx.fill();
        const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
        g.addColorStop(0, shade(col, 0.4)); g.addColorStop(0.6, col); g.addColorStop(1, shade(col, -0.25));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.ellipse(x - r * 0.38, y - r * 0.55, r * 0.22, r * 0.12, -0.5, 0, Math.PI * 2); ctx.fill();
    }
    function eye(ctx, x, y, er, pr) {
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, er, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = Math.max(0.6, er * 0.18); ctx.stroke();
        ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(x, y + er * 0.1, pr, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x - pr * 0.35, y - pr * 0.25, pr * 0.35, 0, Math.PI * 2); ctx.fill();
    }
    if (typeof Normy !== 'undefined') Normy.prototype.renderBody = function (ctx, c) {
        const r = this.size / 2; feet(ctx, this, r, c); blob(ctx, 0, 0, r, c);
        eye(ctx, -r * 0.3, -r * 0.15, r * 0.2, r * 0.1); eye(ctx, r * 0.3, -r * 0.15, r * 0.2, r * 0.1);
        ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = Math.max(0.8, r * 0.08); ctx.beginPath(); ctx.arc(0, r * 0.25, r * 0.22, 0.2, Math.PI - 0.2); ctx.stroke();
    };
    if (typeof Groupie !== 'undefined') Groupie.prototype.renderBody = function (ctx, c) {
        const r = this.size / 2; feet(ctx, this, r, c); blob(ctx, 0, 0, r, c);
        eye(ctx, -r * 0.24, -r * 0.15, r * 0.18, r * 0.09); eye(ctx, r * 0.24, -r * 0.15, r * 0.18, r * 0.09);
    };
    if (typeof Tank !== 'undefined') Tank.prototype.renderBody = function (ctx, c) {
        const r = this.size / 2; feet(ctx, this, r, c); blob(ctx, 0, 0, r, c);
        // armour band
        ctx.strokeStyle = shade(c, -0.4); ctx.lineWidth = Math.max(1.5, r * 0.12); ctx.beginPath(); ctx.arc(0, 0, r * 0.82, 0.3, Math.PI - 0.3); ctx.stroke();
        eye(ctx, -r * 0.35, -r * 0.3, r * 0.17, r * 0.08); eye(ctx, r * 0.35, -r * 0.3, r * 0.17, r * 0.08);
        ctx.fillStyle = '#111'; ctx.save(); ctx.translate(0, -r * 0.55); ctx.rotate(0); ctx.fillRect(-r * 0.55, -r * 0.08, r * 1.1, r * 0.16); ctx.restore();
    };
    if (typeof Splitter !== 'undefined') Splitter.prototype.renderBody = function (ctx, c) {
        const r = this.size / 2;
        if (this.splitLevel >= 2) {
            feet(ctx, this, r, c); blob(ctx, 0, 0, r, c);
            eye(ctx, -r * 0.25, -r * 0.2, r * 0.22, r * 0.11); eye(ctx, r * 0.25, -r * 0.2, r * 0.22, r * 0.11);
        } else {
            const o = r * 0.5;
            feet(ctx, this, r, c); blob(ctx, -o, 0, r, c); blob(ctx, o, 0, r, c);
            ctx.strokeStyle = shade(c, -0.45); ctx.lineWidth = Math.max(1, r * 0.08); ctx.beginPath(); ctx.moveTo(0, -r * 0.7); ctx.lineTo(0, r * 0.7); ctx.stroke();
            eye(ctx, -o - r * 0.25, -r * 0.2, r * 0.2, r * 0.1); eye(ctx, o + r * 0.25, -r * 0.2, r * 0.2, r * 0.1);
        }
    };
    if (typeof Speedy !== 'undefined') {
        Speedy.prototype.renderBody = function (ctx, c) {
            ctx.rotate(this.facingAngle);
            const r = this.size / 2;
            // speed streaks
            ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = Math.max(1, r * 0.1); ctx.lineCap = 'round';
            for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(-r * 2.9, i * r * 0.45); ctx.lineTo(-r * 3.6, i * r * 0.45); ctx.stroke(); }
            const body = () => { ctx.beginPath(); ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2); ctx.lineTo(-r * 2.8, 0); ctx.closePath(); };
            const g = ctx.createLinearGradient(0, -r, 0, r); g.addColorStop(0, shade(c, 0.35)); g.addColorStop(1, shade(c, -0.25));
            body(); ctx.fillStyle = g; ctx.fill(); ctx.lineWidth = Math.max(1, r * 0.12); ctx.strokeStyle = shade(c, -0.55); ctx.stroke();
            eye(ctx, r * 0.3, -r * 0.3, r * 0.2, r * 0.09); eye(ctx, r * 0.3, r * 0.3, r * 0.2, r * 0.09);
        };
    }

    // ---------- 4. Combat juice ----------
    const FX = { sparks: [], pops: [], texts: [], rings: [], shakeUntil: 0, flashUntil: 0, last: 0 };
    const MAXP = 320;
    function addSparks(x, y, n, color) {
        for (let i = 0; i < n && FX.sparks.length < MAXP; i++) {
            const a = frand() * Math.PI * 2, v = 60 + frand() * 140;
            FX.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.22 + frand() * 0.2, max: 0.42, c: color || (frand() < 0.5 ? '#FFF59D' : '#FFB300'), w: 1 + frand() * 1.5 });
        }
    }
    function addPop(x, y, r, color) {
        FX.rings.push({ x, y, r: r * 0.6, R: r * 2.2, life: 0.35, max: 0.35, c: '#ffffff' });
        for (let i = 0; i < 9 && FX.pops.length < MAXP; i++) {
            const a = (i / 9) * Math.PI * 2 + frand() * 0.5, v = 50 + frand() * 110;
            FX.pops.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30, life: 0.45 + frand() * 0.25, max: 0.7, s: Math.max(2, r * (0.25 + frand() * 0.25)), c: color });
        }
    }
    function addText(x, y, text, color, size) { FX.texts.push({ x, y, text, c: color, life: 0.95, max: 0.95, size: size || 1 }); if (FX.texts.length > 60) FX.texts.shift(); }

    if (typeof Enemy !== 'undefined') {
        const origTD = Enemy.prototype.takeDamage;
        Enemy.prototype.takeDamage = function (damage, source) {
            const wasDead = this.isDead;
            const r = origTD.apply(this, arguments);
            if (wasDead || !this._scene || this._scene !== scene()) return r;
            const now = performance.now();
            if (damage > 0.5 && (!this._fxLastHit || now - this._fxLastHit > 70)) { this._fxLastHit = now; addSparks(this.x, this.y, this.isDead ? 3 : 4); }
            if (this.isDead && !this._fxPopped) {
                this._fxPopped = true;
                addPop(this.x, this.y, Math.max(4, (this.size || 20) / 2), this.color || '#aaa');
                addText(this.x, this.y - (this.size || 20) * 0.4, '+' + (this.reward || 3), '#FFD54F', 1);
            }
            return r;
        };
    }
    if (typeof Castle !== 'undefined') {
        const origCD = Castle.prototype.takeDamage;
        Castle.prototype.takeDamage = function (damage) {
            const r = origCD.apply(this, arguments);
            if (this._scene === scene() && damage > 0) {
                const now = performance.now();
                FX.shakeUntil = now + 220; FX.flashUntil = now + 260;
                if (!this._fxLast || now - this._fxLast > 120) { this._fxLast = now; addText(this.x, this.y - GameConfig.Castle.size * 0.45, '-' + Math.round(damage), '#FF5252', 1.1); }
            }
            return r;
        };
    }

    function stepFX(dt) {
        const step = (arr, fn) => { for (let i = arr.length - 1; i >= 0; i--) { const p = arr[i]; p.life -= dt; if (p.life <= 0) { arr[i] = arr[arr.length - 1]; arr.pop(); } else fn(p); } };
        step(FX.sparks, p => { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.9; p.vy *= 0.9; });
        step(FX.pops, p => { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 260 * dt; p.vx *= 0.96; });
        step(FX.texts, p => { p.y -= 34 * dt; });
        step(FX.rings, () => {});
    }
    function drawFX(ctx) {
        const sc = GameConfig.scale || 1;
        ctx.save();
        FX.rings.forEach(p => { const k = 1 - p.life / p.max; ctx.globalAlpha = (1 - k) * 0.7; ctx.strokeStyle = p.c; ctx.lineWidth = Math.max(1, 3 * (1 - k)); ctx.beginPath(); ctx.arc(p.x, p.y, p.r + (p.R - p.r) * k, 0, Math.PI * 2); ctx.stroke(); });
        FX.pops.forEach(p => { ctx.globalAlpha = Math.min(1, p.life / p.max * 1.6); ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, p.s * (0.5 + 0.5 * p.life / p.max), 0, Math.PI * 2); ctx.fill(); });
        ctx.lineCap = 'round';
        FX.sparks.forEach(p => { ctx.globalAlpha = Math.min(1, p.life / 0.25); ctx.strokeStyle = p.c; ctx.lineWidth = p.w; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035); ctx.stroke(); });
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        FX.texts.forEach(p => {
            const k = p.life / p.max, pop = k > 0.85 ? 1 + (k - 0.85) * 3 : 1;
            ctx.globalAlpha = Math.min(1, k * 2);
            ctx.font = '900 ' + Math.round(15 * sc * p.size * pop + 4) + 'px Arial';
            ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.strokeText(p.text, p.x, p.y);
            ctx.fillStyle = p.c; ctx.fillText(p.text, p.x, p.y);
        });
        ctx.restore();
    }

    // Placement preview (hover ghost + range) and castle footprint
    const hover = { x: -1, y: -1, inside: false };
    function bindHover(canvas) {
        if (canvas._cdcHover) return; canvas._cdcHover = true;
        canvas.addEventListener('mousemove', e => { const r = canvas.getBoundingClientRect(); hover.x = (e.clientX - r.left) * canvas.width / r.width; hover.y = (e.clientY - r.top) * canvas.height / r.height; hover.inside = true; });
        canvas.addEventListener('mouseleave', () => { hover.inside = false; });
    }
    function costOf(type) {
        const k = TOWER_CONFIG_KEYS[type];
        if (k) return GameConfig.Tower[k].cost;
        const m = { wall: 'Wall', spike: 'Spike', mirror: 'Mirror', lilypad: 'Lilypad' }[type];
        return m && GameConfig[m] ? GameConfig[m].cost : 0;
    }
    function drawPreview(s, ctx) {
        if (!hover.inside) return;
        const ts = GameConfig.Grid.tileSize;
        const tile = s.gridSystem.getTileAtPosition(hover.x, hover.y);
        if (!tile) return;
        ctx.save();
        if (s.placementMode) {
            const ok = !tile.occupied && !tile.reserved && !tile.water && s.gridSystem.tiles[tile.row + 1] && s.gridSystem.tiles[tile.row + 1][tile.col + 1];
            ctx.fillStyle = ok ? 'rgba(255,215,0,0.28)' : 'rgba(255,60,60,0.25)';
            ctx.strokeStyle = ok ? 'rgba(255,215,0,0.95)' : 'rgba(255,80,80,0.9)'; ctx.lineWidth = 2;
            rrect(ctx, tile.x + 1, tile.y + 1, ts * 2 - 2, ts * 2 - 2, ts * 0.2); ctx.fill(); ctx.stroke();
            ctx.restore(); return;
        }
        const type = s.selectedTowerType;
        if (!type) { ctx.restore(); return; }
        const enemyOn = s.enemies.some(e => !e.isDead && e.special !== 'fly' && s.gridSystem.getTileAtPosition(e.x, e.y) === tile);
        let ok = !tile.occupied && !tile.reserved && (type === 'lilypad' ? tile.water : !tile.water) && s.gameStateManager.gold >= costOf(type) && (type === 'spike' || !enemyOn);
        ctx.fillStyle = ok ? 'rgba(120,255,120,0.22)' : 'rgba(255,60,60,0.25)';
        ctx.strokeStyle = ok ? 'rgba(170,255,170,0.9)' : 'rgba(255,90,90,0.9)'; ctx.lineWidth = 2;
        rrect(ctx, tile.x + 1, tile.y + 1, ts - 2, ts - 2, ts * 0.15); ctx.fill(); ctx.stroke();
        const k = TOWER_CONFIG_KEYS[type];
        const range = k ? GameConfig.Tower[k].range : 0;
        const cx = tile.x + ts / 2, cy = tile.y + ts / 2;
        if (range && isFinite(range)) {
            ctx.setLineDash([6, 5]); ctx.lineWidth = 1.5; ctx.strokeStyle = ok ? 'rgba(255,255,255,0.75)' : 'rgba(255,120,120,0.7)';
            ctx.fillStyle = ok ? 'rgba(255,255,255,0.08)' : 'rgba(255,60,60,0.06)';
            ctx.beginPath(); ctx.arc(cx, cy, range, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
        }
        const icon = s.towerIconCache && s.towerIconCache[type];
        if (icon) { ctx.globalAlpha = ok ? 0.6 : 0.35; ctx.drawImage(icon, tile.x, tile.y, ts, ts); }
        ctx.restore();
    }

    // Wrap render: FX + preview + tutorial hints on top of the scene
    const origSceneRender = GameScene.prototype.render;
    GameScene.prototype.render = function () {
        origSceneRender.apply(this, arguments);
        if (this !== scene()) return;
        const now = performance.now();
        const dt = FX.last ? Math.min(0.05, (now - FX.last) / 1000) : 0; FX.last = now;
        stepFX(dt);
        const ctx = this.ctx;
        try {
            bindHover(this.canvas);
            drawPreview(this, ctx);
            Tutorial.draw(this, ctx);
            drawFX(ctx);
            if (now < FX.flashUntil) {
                const a = (FX.flashUntil - now) / 260 * 0.35, W = this.canvas.width, H = this.canvas.height;
                const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
                v.addColorStop(0, 'rgba(255,0,0,0)'); v.addColorStop(1, 'rgba(255,0,0,' + a.toFixed(3) + ')');
                ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
            }
            const shaking = now < FX.shakeUntil;
            if (shaking) { const m = 3 * (FX.shakeUntil - now) / 220; this.canvas.style.transform = 'translate(' + ((frand() - 0.5) * 2 * m).toFixed(1) + 'px,' + ((frand() - 0.5) * 2 * m).toFixed(1) + 'px)'; this._cdcShook = true; }
            else if (this._cdcShook) { this.canvas.style.transform = ''; this._cdcShook = false; }
            hudTick(this);
        } catch (e) { /* cosmetic only */ }
    };

    // Build puff when something is placed
    const origTileClick = GameScene.prototype.handleTileClick;
    GameScene.prototype.handleTileClick = function (x, y) {
        const before = this.towers.length + this.walls.length + this.spikes.length + this.mirrors.length + this.Lilypads.length;
        const g0 = this.gameStateManager.gold;
        const r = origTileClick.apply(this, arguments);
        const after = this.towers.length + this.walls.length + this.spikes.length + this.mirrors.length + this.Lilypads.length;
        if (after > before && this === scene()) {
            const tile = this.gridSystem.getTileAtPosition(x, y), ts = GameConfig.Grid.tileSize;
            if (tile) {
                FX.rings.push({ x: tile.x + ts / 2, y: tile.y + ts / 2, r: ts * 0.3, R: ts * 0.9, life: 0.4, max: 0.4, c: '#FFF3C4' });
                addSparks(tile.x + ts / 2, tile.y + ts * 0.7, 6, 'rgba(200,170,120,0.9)');
                const spent = g0 - this.gameStateManager.gold;
                if (spent > 0) addText(tile.x + ts / 2, tile.y, '-' + spent, '#FFAB91', 0.85);
            }
            Tutorial.onBuilt(this);
        }
        return r;
    };

    // HUD: gold tick animation + level / round labels
    let lastGold = null;
    function hudTick(s) {
        const g = s.gameStateManager.gold;
        if (lastGold !== null && g !== lastGold) {
            const el = document.querySelector('.stat-gold');
            if (el) { el.classList.remove('tick-up', 'tick-down'); void el.offsetWidth; el.classList.add(g > lastGold ? 'tick-up' : 'tick-down'); }
        }
        lastGold = g;
    }
    function setHudLevel(s) {
        const lvl = s.selectedLevel || 1;
        const a = document.getElementById('hudLevel'); if (a) a.textContent = 'Level ' + lvl;
        const b = document.getElementById('roundTotal'); if (b) b.textContent = '/' + (s.getTotalRoundsForLevel ? s.getTotalRoundsForLevel(lvl) : 10);
    }
    const origStart = GameScene.prototype.start;
    GameScene.prototype.start = function () {
        const r = origStart.apply(this, arguments);
        FX.sparks.length = FX.pops.length = FX.texts.length = FX.rings.length = 0;
        this._cdcTrailKey = null; lastGold = null;
        setHudLevel(this);
        Tutorial.onStart(this);
        scheduleBackdrop();
        return r;
    };
    const origLoad = GameScene.prototype.loadGame;
    if (origLoad) GameScene.prototype.loadGame = function () { const r = origLoad.apply(this, arguments); this._cdcTrailKey = null; setHudLevel(this); return r; };

    // ---------- 2. First-run tutorial (Level 1) ----------
    const TUT_KEY = 'cdc_tutorial_done';
    const Tutorial = {
        active: false, step: 0, el: null, ring: null, s: null,
        shouldAutoStart() {
            if (isBot()) return false;
            try {
                if (localStorage.getItem(TUT_KEY)) return false;
                if (parseInt(localStorage.getItem('td_max_level') || 1) > 1) return false;
                if (localStorage.getItem('td_saved_game')) return false;
            } catch (e) { return false; }
            return true;
        },
        markDone() { try { localStorage.setItem(TUT_KEY, '1'); } catch (e) {} },
        ui() {
            if (this.el) return;
            const host = document.querySelector('.game-container'); if (!host) return;
            const el = document.createElement('div'); el.className = 'cdc-coach'; el.id = 'cdcCoach';
            el.innerHTML = '<div class="cdc-coach-text" id="cdcCoachText"></div><div class="cdc-coach-actions"><button type="button" class="cdc-coach-next" id="cdcCoachNext">Got it ▶</button><button type="button" class="cdc-coach-skip" id="cdcCoachSkip">Skip tutorial</button></div>';
            host.appendChild(el); this.el = el;
            const ring = document.createElement('div'); ring.className = 'cdc-coach-ring'; host.appendChild(ring); this.ring = ring;
            el.querySelector('#cdcCoachSkip').addEventListener('click', (e) => { e.stopPropagation(); this.finish(true); });
            el.querySelector('#cdcCoachNext').addEventListener('click', (e) => { e.stopPropagation(); this.next(); });
        },
        begin(s) {
            this.s = s; this.active = true; this.step = 1; this.ui();
            this.show('<b>Welcome, defender!</b> Tap a grassy spot to place your <b>castle</b>. Monsters come out of the swirling portal at the top.', false);
        },
        onStart(s) {
            if (this._pending) { this._pending = false; this.begin(s); return; }
            if (this.active) this.finish(false);
        },
        show(html, nextBtn, targetSel) {
            if (!this.el) return;
            this.el.querySelector('#cdcCoachText').innerHTML = html;
            this.el.querySelector('#cdcCoachNext').style.display = nextBtn ? '' : 'none';
            this.el.style.display = 'flex';
            this.target = targetSel || null; this.placeRing();
        },
        placeRing() {
            if (!this.ring) return;
            const t = this.target && document.querySelector(this.target);
            if (!t || !t.offsetParent) { this.ring.style.display = 'none'; return; }
            const host = document.querySelector('.game-container').getBoundingClientRect(), r = t.getBoundingClientRect();
            const pad = 6;
            Object.assign(this.ring.style, { display: 'block', left: (r.left - host.left - pad) + 'px', top: (r.top - host.top - pad) + 'px', width: (r.width + pad * 2) + 'px', height: (r.height + pad * 2) + 'px' });
        },
        next() {
            const s = this.s; if (!s) return;
            if (this.step === 4) {
                this.step = 5; s._tutorialHold = false;
                const cd = document.getElementById('roundCountdown'); if (cd && s.isCountingDown) cd.style.display = 'block';
                this.show('Kill monsters to earn <b>gold</b>, then build more. Tap a tower to upgrade it. Good luck!', false);
                setTimeout(() => { if (this.step === 5) this.finish(true); }, 4500);
            }
        },
        finish(done) {
            if (done !== false) this.markDone();
            this.active = false; this.step = 0;
            if (this.s) { this.s._tutorialHold = false; const cd = document.getElementById('roundCountdown'); if (cd && this.s.isCountingDown) cd.style.display = 'block'; }
            if (this.el) this.el.style.display = 'none';
            if (this.ring) this.ring.style.display = 'none';
            this.target = null;
        },
        onBuilt(s) {
            if (!this.active || s !== this.s) return;
            if (this.step <= 3 && s.towers.length >= 1) {
                this.step = 4;
                this.show('Nice shot! Cannons fire at anything in range. <b>Walls</b> (5g) bend the dirt path, so monsters walk further. You can never fully block it.', true);
            }
        },
        tick() {
            const s = this.s; if (!this.active || !s) return;
            if (!s.gameStateManager.isPlaying && !s.placementMode) { this.finish(true); return; }
            if (this.step === 1 && !s.placementMode && s.castle) {
                this.step = 2; s._tutorialHold = true;
                const cd = document.getElementById('roundCountdown'); if (cd) cd.style.display = 'none';
                this.show('Your castle is up. The dirt trail shows where monsters will walk. Now tap the <b>Cannon</b> (20g).', false, '#slowTowerBtn');
            }
            if (this.step === 2 && s.selectedTowerType === 'cannon') {
                this.step = 3;
                this.show('Tap a glowing tile <b>next to the trail</b> to build it.', false);
            }
            if (this.step === 3 && s.selectedTowerType !== 'cannon' && s.towers.length === 0) {
                this.step = 2; this.show('Tap the <b>Cannon</b> (20g) to pick it.', false, '#slowTowerBtn');
            }
            if (this.target) this.placeRing();
        },
        draw(s, ctx) {
            this.tick();
            if (!this.active || s !== this.s) return;
            const ts = GameConfig.Grid.tileSize, t = performance.now() / 1000, pulse = 0.5 + 0.5 * Math.sin(t * 5);
            if (this.step === 1) {
                // suggest a castle spot in the lower half
                const gs = s.gridSystem, row = GameConfig.Grid.rows - 4, col = Math.max(0, Math.min(GameConfig.Grid.columns - 2, gs.portalCol < 5 ? gs.portalCol + 1 : gs.portalCol - 2));
                const tile = gs.tiles[row] && gs.tiles[row][col];
                if (tile) {
                    ctx.save(); ctx.strokeStyle = 'rgba(255,215,0,' + (0.5 + pulse * 0.5) + ')'; ctx.lineWidth = 3; ctx.setLineDash([8, 6]);
                    rrect(ctx, tile.x + 2, tile.y + 2, ts * 2 - 4, ts * 2 - 4, ts * 0.25); ctx.stroke(); ctx.setLineDash([]);
                    ctx.font = '900 ' + Math.round(ts * 0.75) + 'px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                    ctx.fillText('👆', tile.x + ts, tile.y + ts + Math.sin(t * 4) * ts * 0.12);
                    ctx.restore();
                }
                if (s.portal) { ctx.save(); ctx.strokeStyle = 'rgba(200,120,255,' + (0.4 + pulse * 0.5) + ')'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(s.portal.x, s.portal.y, ts * (0.7 + pulse * 0.15), 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
            }
            if (this.step === 3 && s._cdcTrail) {
                // glow free tiles next to the trail
                const gs = s.gridSystem, seen = {};
                ctx.save();
                s._cdcTrail.forEach(p => {
                    const pt = gs.getTileAtPosition(p.x, p.y); if (!pt) return;
                    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(d => {
                        const r = pt.row + d[1], c = pt.col + d[0], tile = gs.tiles[r] && gs.tiles[r][c];
                        if (!tile || tile.occupied || tile.reserved || tile.water || seen[r + ',' + c] || r < 2) return;
                        if (s._cdcTrail.some(q => gs.getTileAtPosition(q.x, q.y) === tile)) return;
                        seen[r + ',' + c] = 1;
                        ctx.fillStyle = 'rgba(160,255,120,' + (0.12 + pulse * 0.2) + ')'; ctx.fillRect(tile.x + 2, tile.y + 2, ts - 4, ts - 4);
                    });
                });
                ctx.restore();
            }
        },
    };
    window.cdcTutorial = Tutorial;

    function startFirstRun(s) {
        const menu = document.getElementById('mainMenu'); if (menu) menu.style.display = 'none';
        const ls = document.getElementById('levelSelectScreen'); if (ls) ls.style.display = 'none';
        s.selectedLevel = 1; s.waterEnabled = false;
        try { localStorage.removeItem('td_saved_game'); } catch (e) {}
        Tutorial._pending = true;
        s.start();
    }

    // ---------- 1. Wide-layout backdrop (procedural forest around the board) ----------
    function drawBackdrop() {
        let c = document.getElementById('cdcBackdrop');
        const wide = document.body.classList.contains('cdc-wide');
        if (!wide) { if (c) c.style.display = 'none'; return; }
        if (!c) { c = document.createElement('canvas'); c.id = 'cdcBackdrop'; c.setAttribute('aria-hidden', 'true'); document.body.insertBefore(c, document.body.firstChild); }
        c.style.display = 'block';
        const W = window.innerWidth, H = window.innerHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
        c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
        const ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const g = ctx.createRadialGradient(W / 2, H * 0.45, H * 0.1, W / 2, H * 0.5, Math.max(W, H) * 0.75);
        g.addColorStop(0, '#3b7343'); g.addColorStop(0.55, '#24492f'); g.addColorStop(1, '#10241a');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        const cv = document.getElementById('gameCanvas'), br = cv ? cv.getBoundingClientRect() : { left: W * 0.35, right: W * 0.65 };
        const keepL = br.left - 30, keepR = br.right + 30;
        let sd = 1337; const rnd = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
        const trees = [];
        for (let i = 0; i < 140; i++) {
            const x = rnd() * W, y = rnd() * H * 1.05; if (x > keepL && x < keepR) continue;
            trees.push({ x, y, r: (14 + rnd() * 26) * Math.max(0.6, H / 720), k: rnd() });
        }
        trees.sort((a, b) => a.y - b.y);
        trees.forEach(t => {
            ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(t.x + t.r * 0.2, t.y + t.r * 0.75, t.r * 0.9, t.r * 0.35, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#4a3120'; ctx.fillRect(t.x - t.r * 0.12, t.y, t.r * 0.24, t.r * 0.7);
            const dark = t.k < 0.5 ? '#1f4a2a' : '#245a30', mid = t.k < 0.5 ? '#2f6e3a' : '#3a7f3f';
            ctx.fillStyle = dark; ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = mid; ctx.beginPath(); ctx.arc(t.x - t.r * 0.25, t.y - t.r * 0.3, t.r * 0.62, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = 'rgba(190,240,150,0.18)'; ctx.beginPath(); ctx.arc(t.x - t.r * 0.38, t.y - t.r * 0.45, t.r * 0.28, 0, Math.PI * 2); ctx.fill();
        });
        const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.7);
        v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.45)');
        ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
    }
    let _bdT = null;
    function scheduleBackdrop() { clearTimeout(_bdT); _bdT = setTimeout(drawBackdrop, 220); }

    function boot() {
        const s = scene();
        if (!s) { setTimeout(boot, 50); return; }
        const replay = document.getElementById('tutorialReplayBtn');
        if (replay && !replay._cdc) {
            replay._cdc = true;
            replay.addEventListener('click', () => { try { localStorage.removeItem(TUT_KEY); } catch (e) {} try { if (s.soundManager) s.soundManager.playButtonClick(); } catch (e) {} startFirstRun(s); });
        }
        if (Tutorial.shouldAutoStart()) startFirstRun(s);
        window.addEventListener('resize', () => { Tutorial.placeRing(); scheduleBackdrop(); });
        if (window.visualViewport) window.visualViewport.addEventListener('resize', scheduleBackdrop);
        scheduleBackdrop();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 0)); else setTimeout(boot, 0);
})();

/* v5.22: slim AA tracer missiles + compact top bar on narrow board columns. Visual only (no Math.random). */
(function () {
    'use strict';
    // ---- AA missile: small finned rocket with a glowing exhaust trail (was a big plain yellow circle) ----
    if (typeof Projectile !== 'undefined') {
        const origRender = Projectile.prototype.render;
        Projectile.prototype.render = function (ctx) {
            if (!this.isRocket || this.isDead) return origRender.call(this, ctx);
            const k = Math.max(0.55, ((window.GameConfig && GameConfig.Grid && GameConfig.Grid.tileSize) || 46) / 46);
            // exhaust trail from the recorded positions (oldest -> newest)
            const n = this.trail.length, pts = [];
            for (let i = 0; i < n; i++) { const p = this.trail[(this._trailIdx + i) % n]; if (p.active) pts.push(p); }
            pts.push({ x: this.x, y: this.y });
            ctx.save();
            ctx.lineCap = 'round';
            for (let i = 1; i < pts.length; i++) {
                const a = i / pts.length;
                ctx.strokeStyle = `rgba(255, ${Math.round(140 + 90 * a)}, 60, ${0.08 + 0.5 * a})`;
                ctx.lineWidth = (1 + 2.6 * a) * k;
                ctx.beginPath(); ctx.moveTo(pts[i - 1].x, pts[i - 1].y); ctx.lineTo(pts[i].x, pts[i].y); ctx.stroke();
            }
            ctx.translate(this.x, this.y);
            ctx.rotate(this.angle);
            const L = 9 * k, W = 2.6 * k, fl = 0.75 + 0.25 * Math.sin((performance.now() + this.startX * 7) / 35);
            // engine glow
            const g = ctx.createRadialGradient(-L * 0.55, 0, 0, -L * 0.55, 0, 6 * k);
            g.addColorStop(0, 'rgba(255,245,200,0.95)'); g.addColorStop(0.4, 'rgba(255,170,40,0.6)'); g.addColorStop(1, 'rgba(255,90,0,0)');
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(-L * 0.55, 0, 6 * k, 0, Math.PI * 2); ctx.fill();
            // flame tongue
            ctx.fillStyle = 'rgba(255,220,120,0.95)';
            ctx.beginPath(); ctx.moveTo(-L * 0.5, -W * 0.45); ctx.lineTo(-L * 0.5 - 5 * k * fl, 0); ctx.lineTo(-L * 0.5, W * 0.45); ctx.closePath(); ctx.fill();
            // fins
            ctx.fillStyle = '#7a1f1f';
            ctx.beginPath(); ctx.moveTo(-L * 0.45, -W * 0.5); ctx.lineTo(-L * 0.62, -W * 1.25); ctx.lineTo(-L * 0.18, -W * 0.5); ctx.closePath(); ctx.fill();
            ctx.beginPath(); ctx.moveTo(-L * 0.45, W * 0.5); ctx.lineTo(-L * 0.62, W * 1.25); ctx.lineTo(-L * 0.18, W * 0.5); ctx.closePath(); ctx.fill();
            // body
            const bg = ctx.createLinearGradient(0, -W / 2, 0, W / 2);
            bg.addColorStop(0, '#f2f4f5'); bg.addColorStop(0.5, '#b8c0c6'); bg.addColorStop(1, '#6d777e');
            ctx.fillStyle = bg; ctx.fillRect(-L * 0.5, -W / 2, L * 0.78, W);
            // nose cone
            ctx.fillStyle = '#d32f2f';
            ctx.beginPath(); ctx.moveTo(L * 0.28, -W / 2); ctx.quadraticCurveTo(L * 0.5, -W * 0.2, L * 0.55, 0); ctx.quadraticCurveTo(L * 0.5, W * 0.2, L * 0.28, W / 2); ctx.closePath(); ctx.fill();
            // band
            ctx.fillStyle = '#FFD54F'; ctx.fillRect(L * 0.05, -W / 2, 1.2 * k, W);
            ctx.restore();
        };
    }

    // ---- Top bar: compact cells when the board column is narrow (short phones) ----
    function fitHud() {
        const hud = document.querySelector('.game-info'); if (!hud) return;
        const wide = document.body.classList.contains('cdc-wide');
        hud.classList.toggle('hud-compact', !wide && hud.clientWidth > 0 && hud.clientWidth < 300);
    }
    function bootHud() {
        const hud = document.querySelector('.game-info'); if (!hud) { setTimeout(bootHud, 50); return; }
        if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fitHud).observe(hud);
        window.addEventListener('resize', fitHud); fitHud();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootHud); else bootHud();
})();
