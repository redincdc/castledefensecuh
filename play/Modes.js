// v5.20: two modes. TUTORIAL = the old Levels 1-12 as 12 short stages (one new enemy / weapon each, with coach
// cards). ENDLESS = every weapon unlocked, ever-harder mixed waves, time survived is the high score.
// v5.23: Play opens Tutorial / Worlds / Endless. Worlds uses the old L1-25 level data and unlocks.
(function () {
    'use strict';
    if (typeof GameScene === 'undefined') return;
    const ENDLESS = 99, TUT_STAGES = 12;
    const scene = () => window.gameScene;
    const isEndless = s => s && s.selectedLevel === ENDLESS;
    const P = GameScene.prototype;

    // ---------------- Endless waves ----------------
    const UNLOCK = [['normy', 1], ['splitter', 3], ['speedy', 4], ['groupie', 6], ['tank', 8], ['flyer', 10], ['breaker', 12]];
    const WEIGHT = { normy: 3, speedy: 1.4, splitter: 2, groupie: 1.6, tank: 1.6, flyer: 1.3, breaker: 1 };
    const CAP = { flyer: 0.3, breaker: 0.15, groupie: 0.25 }; // no long same-type stretches (e.g. flyers-only)
    P.getEndlessComposition = function (round) {
        const unlocked = UNLOCK.filter(u => round >= u[1]).map(u => u[0]);
        const k = Math.min(unlocked.length, 2 + Math.floor(round / 4), 5);
        // pick k distinct types (weighted); a newly unlocked type is always featured on its first round
        const pick = [], bag = unlocked.slice();
        const fresh = UNLOCK.find(u => u[1] === round); if (fresh) { pick.push(fresh[0]); bag.splice(bag.indexOf(fresh[0]), 1); }
        while (pick.length < k && bag.length) {
            const tot = bag.reduce((a, t) => a + WEIGHT[t] * (t === 'normy' && round > 8 ? 0.4 : 1), 0);
            let r = Math.random() * tot, i = 0;
            for (; i < bag.length - 1; i++) { r -= WEIGHT[bag[i]] * (bag[i] === 'normy' && round > 8 ? 0.4 : 1); if (r <= 0) break; }
            pick.push(bag.splice(i, 1)[0]);
        }
        const n = Math.round(6 + 2 * (round - 1) + 0.035 * (round - 1) * (round - 1));
        const wsum = pick.reduce((a, t) => a + WEIGHT[t], 0);
        const counts = {}; let used = 0;
        pick.forEach(t => { const c = Math.max(1, Math.min(Math.round(n * WEIGHT[t] / wsum), CAP[t] ? Math.max(1, Math.round(n * CAP[t])) : n)); counts[t] = c; used += c; });
        // top up with uncapped types so the wave keeps its size
        const fill = pick.filter(t => !CAP[t]); let fi = 0;
        while (used < n && fill.length) { counts[fill[fi++ % fill.length]]++; used++; }
        // interleave so types alternate through the whole wave
        const lists = pick.map(t => Array.from({ length: counts[t] }, () => ({ type: t, isBoss: false })));
        const out = []; let any = true;
        while (any) { any = false; for (const l of lists) if (l.length) { out.push(l.shift()); any = true; } }
        const bosses = round % 5 === 0 ? 1 + Math.floor(round / 10) : 1;
        for (let b = 0; b < bosses && out.length; b++) out[Math.floor(out.length * (b + 1) / (bosses + 1))].isBoss = true;
        return out;
    };
    P.endlessHpBonus = function (type, round) {
        const r = round - 1;
        return (1 + 0.1 * r) * Math.pow(type === 'flyer' ? 1.06 : 1.05, r);
    };
    P.endlessIntermission = function () { return 5; };
    // Economy keeps pace with the ramp: kill rewards grow per round, plus a growing wave-clear bonus.
    const origSpawn = P.spawnEnemy;
    P.spawnEnemy = function () {
        const n0 = this.enemies.length;
        const r = origSpawn.apply(this, arguments);
        if (isEndless(this)) { const m = 1 + 0.06 * (this.gameStateManager.round - 1); for (let i = n0; i < this.enemies.length; i++) this.enemies[i].reward = Math.round(this.enemies[i].reward * m); }
        return r;
    };
    const origInter = P.startIntermission;
    P.startIntermission = function () {
        if (isEndless(this) && this.gameStateManager.round > 0) this.gameStateManager.addGold(5 * this.gameStateManager.round);
        return origInter.apply(this, arguments);
    };
    const ENDLESS_GOLD = 500;

    // Adaptive difficulty (rubber-banding) is off in Endless so a better player really survives longer.
    const BA = window.balanceAnalytics;
    if (BA) {
        const oh = BA.getHpMultiplier.bind(BA), oc = BA.getEnemyCountMultiplier.bind(BA), oe = BA.evaluateRound.bind(BA);
        BA.getHpMultiplier = () => isEndless(scene()) ? 1 : oh();
        BA.getEnemyCountMultiplier = () => isEndless(scene()) ? 1 : oc();
        BA.evaluateRound = (gs) => isEndless(gs) ? undefined : oe(gs);
    }

    // Survival clock in Endless = game time (fast-forward is not penalised).
    const origUpdate = P.update;
    P.update = function (dt, unscaled) {
        const r = origUpdate.apply(this, arguments);
        if (isEndless(this) && !this.placementMode) this.realTimeSurvived = this.gameTime;
        return r;
    };

    const fmt = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
    const origStart = P.start;
    P.start = function () {
        const r = origStart.apply(this, arguments);
        const a = document.getElementById('hudLevel'), b = document.getElementById('roundTotal');
        if (isEndless(this)) {
            this.gameStateManager.gold = ENDLESS_GOLD; this.gameStateManager.notify('goldChanged', ENDLESS_GOLD);
            if (a) a.textContent = '♾ Endless'; if (b) b.textContent = '';
            const best = parseInt(localStorage.getItem('td_endless_best') || 0);
            if (this._el && this._el.hudHighScore) this._el.hudHighScore.textContent = fmt(best);
        } else if (this._cdcPlayMode === 'tutorial') {
            const lvl = this.selectedLevel || 1;
            if (a && lvl <= TUT_STAGES) a.textContent = 'Tutorial ' + lvl + '/' + TUT_STAGES;
            Coach.stage(this, lvl);
        }
        return r;
    };

    // Game Over in Endless: time survived + Best line
    const origGameOver = P.showGameOver;
    P.showGameOver = function () {
        const r = origGameOver.apply(this, arguments);
        if (!isEndless(this)) { const h0 = document.querySelector('#gameOverScreen h2'); if (h0) h0.textContent = '💀 Game Over'; return r; }
        const secs = Math.floor(this.realTimeSurvived || 0), round = this.gameStateManager.round;
        const best = parseInt(localStorage.getItem('td_endless_best') || 0);
        const isNew = secs > best;
        if (isNew) { localStorage.setItem('td_endless_best', secs); localStorage.setItem('td_endless_best_round', round); }
        const sc = document.getElementById('finalScore'); if (sc) sc.textContent = fmt(secs);
        const bd = document.getElementById('highScoreDisplay');
        if (bd) bd.textContent = fmt(Math.max(best, secs)) + ' · R' + (localStorage.getItem('td_endless_best_round') || round); // v5.22
        const br = document.getElementById('highScoreRow'); if (br) br.classList.toggle('is-new', isNew);
        const h = document.querySelector('#gameOverScreen h2'); if (h) h.textContent = '💀 You survived ' + fmt(secs);
        return r;
    };

    P.startEndless = function () {
        ['mainMenu', 'levelSelectScreen', 'waterPopup', 'levelCompleteScreen', 'gameOverScreen'].forEach(id => { const e = document.getElementById(id); if (e) e.style.display = 'none'; });
        document.body.classList.remove('modal-open');
        this._cdcPlayMode = 'endless'; this.selectedLevel = ENDLESS; this.waterEnabled = false;
        try { localStorage.removeItem('td_saved_game'); } catch (e) {}
        this.start();
    };

    // ---------------- Tutorial ----------------
    // Stage picker = the old level grid limited to 12 stages.
    const origLS = P.setupLevelSelect;
    P.setupLevelSelect = function () {
        const r = origLS.apply(this, arguments);
        const worlds = this._cdcPlayMode === 'worlds' || window.__BOT;
        document.querySelectorAll('#levelGrid1 .level-btn').forEach((btn, i) => {
            btn.style.display = (worlds || i < TUT_STAGES) ? '' : 'none';
        });
        const t = document.getElementById('worldTitle');
        if (t) t.textContent = worlds ? 'World 1: Outskirts' : '📘 Tutorial stages';
        if (!worlds) {
            ['prevWorldBtn', 'nextWorldBtn'].forEach(id => { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; });
        }
        const w2 = document.getElementById('world2View'); if (w2 && !worlds) w2.style.display = 'none';
        const w1 = document.getElementById('world1View'); if (w1) w1.style.display = 'flex';
        const back = document.getElementById('levelSelectBackBtn');
        if (back && !back._cdcPlayBack) {
            back._cdcPlayBack = true;
            const prev = back.onclick;
            back.onclick = () => {
                if (typeof prev === 'function') prev();
                else { const ls = document.getElementById('levelSelectScreen'); if (ls) ls.style.display = 'none'; this.showMainMenu(); }
                if (!window.__BOT && this.openPlayMenu) this.openPlayMenu();
            };
        }
        return r;
    };
    const origWin = P.completeLevelVictory;
    P.completeLevelVictory = function () {
        const lvl = this.selectedLevel || 1;
        const r = origWin.apply(this, arguments);
        if (this._cdcPlayMode === 'tutorial') {
            const t = document.getElementById('levelCompleteTitle'), nb = document.getElementById('nextLevelBtn');
            if (lvl >= TUT_STAGES) {
                try { localStorage.setItem('td_tutorial_complete', '1'); } catch (e) {}
                if (t) t.textContent = '🎓 Tutorial complete!';
                if (nb) nb.textContent = '♾ Play Endless';
            } else {
                if (t) t.textContent = 'Stage ' + lvl + ' of ' + TUT_STAGES + ' complete!';
                if (nb) nb.textContent = 'Next Stage ▶';
            }
        }
        return r;
    };

    // Short, skippable coach card at the start of each stage (stage 1 uses the v5.18 step-by-step coach).
    const STAGES = {
        2: ['💨 <b>Speedies</b> sprint down the path.', '❄️ New: <b>Frost</b> (15g) slows everything near it. Pair it with a Cannon.'],
        3: ['🟢 <b>Splitters</b> burst into smaller monsters when they die.', '🔫 New: <b>Machine Gun</b> (20g) shreds lots of small targets fast.'],
        4: ['👥 <b>Groupies</b> arrive in a big pack all at once.', '💣 New: <b>Mortar</b> (80g) splashes a whole area. Great vs packs.'],
        5: ['🛡️ <b>Tanks</b> are slow but very tough.', '⬆️ New: <b>Buff</b> tower (50g) powers up towers next to it.'],
        6: ['🦇 <b>Flyers</b> ignore the path and fly straight at your castle.', '🚀 New: <b>AA</b> (50g) is built to shoot them down.'],
        7: ['⬛ <b>Breakers</b> damage your towers as they walk past.', '🎯 New: <b>Sniper</b> (250g) hits hard from very far away.'],
        8: ['Groupies + Splitters together.', '🔺 New: <b>Spikes</b> (10g) go right on the path and stab whatever walks over.'],
        9: ['Tanks + Speedies: slow and fast at once.', 'No new weapon. Mix Frost, Cannons and upgrades. Tap a tower to upgrade it.'],
        10: ['Flyers + Breakers.', '⚡ New: <b>Tesla</b> (90g) zaps lightning that jumps between enemies.'],
        11: ['Tanks + Flyers.', '🔥 New: <b>Flame</b> (100g) burns everything in its cone. Tap it to turn it.'],
        12: ['Groupies, Tanks and Flyers. Final stage!', '🔴 New: <b>Laser</b> (450g) fires a beam across the whole board (not at flyers). Tap it to aim.<br>🪞 New: <b>Mirror</b> bounces the laser beam. Tap it to turn it.'],
    };
    const Coach = {
        el: null, t: null,
        ui() {
            if (this.el) return this.el;
            const host = document.querySelector('.game-container'); if (!host) return null;
            const el = document.createElement('div'); el.className = 'cdc-coach cdc-stage-coach'; el.id = 'cdcStageCoach';
            el.innerHTML = '<div class="cdc-coach-text" id="cdcStageText"></div><div class="cdc-coach-actions"><button type="button" class="cdc-coach-next" id="cdcStageOk">Got it ▶</button></div>';
            host.appendChild(el); this.el = el;
            el.querySelector('#cdcStageOk').addEventListener('click', e => { e.stopPropagation(); this.hide(); });
            return el;
        },
        hide() { clearTimeout(this.t); if (this.el) this.el.style.display = 'none'; },
        stage(s, lvl) {
            this.hide();
            if (window.__BOT) return;
            const st = STAGES[lvl]; if (!st) return;
            const el = this.ui(); if (!el) return;
            el.querySelector('#cdcStageText').innerHTML = '<b>Stage ' + lvl + '/' + TUT_STAGES + '</b><br>' + st[0] + '<br>' + st[1];
            el.style.display = 'flex';
            this.t = setTimeout(() => this.hide(), 12000);
        },
    };
    window.cdcStageCoach = Coach;

    // v5.24: tutorial highlights: pulsing arsenal button for the stage's new weapon + pulsing target tile
    // (a free tile next to the trail; Spikes go ON the trail; Buff goes next to a tower). Gone once it is built.
    const HINT = { 2: ['frost'], 3: ['machinegun'], 4: ['mortar'], 5: ['upgrader'], 6: ['aa'], 7: ['sniper'], 8: ['spike'], 10: ['tesla'], 11: ['flame'], 12: ['laser', 'mirror'] };
    function hintType(s) {
        if (!s || s._cdcPlayMode !== 'tutorial' || window.__BOT || !s.gameStateManager || !s.castle) return null;
        const list = HINT[s.selectedLevel || 1]; if (!list) return null;
        const all = [].concat(s.towers || [], s.mirrors || [], s.spikes || []);
        for (const t of list) if (!all.some(e => e.type === t || (t === 'mirror' && e.isMirror) || (t === 'spike' && e.isSpike))) return t;
        return null;
    }
    function hintTile(s, type) {
        const gs = s.gridSystem, pts = s._cdcTrail; if (!gs || !pts || pts.length < 2) return null;
        const k = type + ':' + pts.length + ':' + s.towers.length + ':' + s.walls.length;
        if (s._cdcHintKey === k && s._cdcHintTile && !s._cdcHintTile.occupied) return s._cdcHintTile;
        const free = t => t && !t.occupied && !t.reserved && !t.water;
        const onPath = new Set(); pts.forEach(p => { const t = gs.getTileAtPosition(p.x, p.y); if (t) onPath.add(t.row + ',' + t.col); });
        const near = (t, set, d) => { for (let dr = -d; dr <= d; dr++) for (let dc = -d; dc <= d; dc++) if ((dr || dc) && set.has((t.row + dr) + ',' + (t.col + dc))) return true; return false; };
        const anchors = new Set(); (s.towers || []).forEach(t => { const a = gs.getTileAtPosition(t.x, t.y); if (a) anchors.add(a.row + ',' + a.col); });
        let best = null, bd = 1e9; const mid = pts[Math.floor(pts.length / 2)];
        for (const row of gs.tiles) for (const t of row) {
            if (!free(t)) continue;
            const op = onPath.has(t.row + ',' + t.col);
            if (type === 'spike') { if (!op) continue; } else { if (op || !near(t, onPath, 1)) continue; }
            if (type === 'upgrader' && anchors.size && !near(t, anchors, 1)) continue;
            const d = Math.hypot(t.x - mid.x, t.y - mid.y); if (d < bd) { bd = d; best = t; }
        }
        s._cdcHintKey = k; s._cdcHintTile = best; return best;
    }
    const origRender = P.render;
    P.render = function () {
        const r = origRender.apply(this, arguments);
        try {
            const type = hintType(this), def = type && BUILD_BUTTONS.find(b => b.type === type);
            BUILD_BUTTONS.forEach(b => { const el = document.getElementById(b.id); if (el) el.classList.toggle('cdc-hl-btn', !!def && b === def && this.selectedTowerType !== type); });
            if (def && this.selectedTowerType === type && !this.placementMode) {
                const t = hintTile(this, type);
                if (t) {
                    const ts = GameConfig.Grid.tileSize, ctx = this.ctx, k = 0.5 + 0.5 * Math.sin(Date.now() / 260);
                    ctx.save(); ctx.strokeStyle = 'rgba(255,213,79,' + (0.55 + 0.45 * k) + ')'; ctx.lineWidth = 3;
                    ctx.fillStyle = 'rgba(255,213,79,' + (0.12 + 0.18 * k) + ')';
                    const pad = 2 - k * 2; ctx.fillRect(t.x + pad, t.y + pad, ts - pad * 2, ts - pad * 2); ctx.strokeRect(t.x + pad, t.y + pad, ts - pad * 2, ts - pad * 2);
                    ctx.restore();
                }
            }
        } catch (e) { /* cosmetic only */ }
        return r;
    };


    // ---------------- Menu (v5.23: Play -> Tutorial / Worlds / Endless) ----------------
    function hideOverlays(s) {
        ['levelSelectScreen', 'waterPopup', 'levelCompleteScreen', 'gameOverScreen'].forEach(id => { const e = document.getElementById(id); if (e) e.style.display = 'none'; });
        document.body.classList.remove('modal-open');
    }
    function openSelect(s, mode) {
        s._cdcPlayMode = mode;
        hideOverlays(s);
        const mm = document.getElementById('mainMenu'); if (mm) mm.style.display = 'none';
        const ls = document.getElementById('levelSelectScreen'); if (ls) ls.style.display = 'flex';
        s.setupLevelSelect();
    }
    P.openPlayMenu = function () {
        const mm = document.getElementById('mainMenu');
        if (mm) { mm.style.display = 'flex'; mm.classList.add('is-play-open'); }
        hideOverlays(this);
        refreshNudge();
    };
    P.closePlayMenu = function () {
        const mm = document.getElementById('mainMenu');
        if (mm) mm.classList.remove('is-play-open');
    };
    function boot() {
        const s = scene(); if (!s) { setTimeout(boot, 50); return; }
        const bind = (id, fn) => {
            const el = document.getElementById(id);
            if (el && !el._cdc) { el._cdc = true; el.addEventListener('click', () => { try { s.soundManager.playButtonClick(); } catch (e) {} fn(); }); }
        };
        bind('tutorialModeBtn', () => openSelect(s, 'tutorial'));
        bind('worldsModeBtn', () => openSelect(s, 'worlds'));
        bind('endlessBtn', () => s.startEndless());
        bind('playMenuBackBtn', () => { s.closePlayMenu(); s.showMainMenu(); });
        const nb = document.getElementById('nextLevelBtn');
        if (nb && !nb._cdcModes) {
            nb._cdcModes = true;
            nb.addEventListener('click', e => {
                if (s._cdcPlayMode !== 'tutorial' || (s._pendingVictoryLevel || 0) < TUT_STAGES) return;
                e.stopImmediatePropagation();
                const sc = document.getElementById('levelCompleteScreen'); if (sc) sc.style.display = 'none';
                s.startEndless();
            }, true);
        }
        refreshNudge();
    }
    function refreshNudge() {
        const tb = document.getElementById('tutorialModeBtn') || document.getElementById('playBtn'); if (!tb) return;
        let newbie = true;
        try { newbie = !localStorage.getItem('td_tutorial_complete') && parseInt(localStorage.getItem('td_max_level') || 1) < 4; } catch (e) {}
        tb.classList.toggle('cdc-nudge', newbie);
        const hint = document.getElementById('modeHint');
        if (hint) hint.textContent = newbie ? '⭐ New here? Start with the Tutorial' : ('Endless best: ' + fmt(parseInt(localStorage.getItem('td_endless_best') || 0)));
    }
    const origMenu = P.showMainMenu;
    P.showMainMenu = function () {
        this.closePlayMenu && this.closePlayMenu();
        const r = origMenu.apply(this, arguments);
        refreshNudge();
        return r;
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 0)); else setTimeout(boot, 0);
})();
