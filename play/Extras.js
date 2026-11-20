// v5.19 extras: auto-unselect after placing, drag-and-drop tower placement (mouse + touch).
(function () {
    'use strict';
    if (typeof GameScene === 'undefined') return;
    const scene = () => window.gameScene;
    const count = s => s.towers.length + s.walls.length + s.spikes.length + (s.mirrors ? s.mirrors.length : 0) + (s.Lilypads ? s.Lilypads.length : 0);
    const refreshButtons = s => BUILD_BUTTONS.forEach(b => { const el = document.getElementById(b.id); if (el) el.classList.toggle('selected', b.type === s.selectedTowerType); });

    // 1) A tower is placed once per selection: drop the selection after a successful build.
    const origTileClick = GameScene.prototype.handleTileClick;
    GameScene.prototype.handleTileClick = function (x, y) {
        const n0 = count(this);
        const r = origTileClick.apply(this, arguments);
        if (count(this) > n0 && this.selectedTowerType) { this.selectedTowerType = null; refreshButtons(this); }
        return r;
    };

    // 2) Drag a build button onto the board. Tap-to-select then tap-to-place still works.
    const drag = { type: null, btn: null, sx: 0, sy: 0, active: false, touch: false, ghost: null, wasSelected: false };
    function canvasPoint(s, cx, cy) {
        const c = s.canvas, r = c.getBoundingClientRect();
        if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) return null;
        return { x: (cx - r.left) * c.width / r.width, y: (cy - r.top) * c.height / r.height };
    }
    function feedHover(s, cx, cy) {
        // Polish.js draws the placement preview from canvas mouse events; feed it during touch drags too.
        const c = s.canvas;
        if (canvasPoint(s, cx, cy)) c.dispatchEvent(new MouseEvent('mousemove', { clientX: cx, clientY: cy }));
        else c.dispatchEvent(new MouseEvent('mouseleave'));
    }
    function moveGhost(cx, cy) {
        if (!drag.ghost) return;
        drag.ghost.style.transform = 'translate(' + (cx - 24) + 'px,' + (cy - 24) + 'px)';
    }
    function begin(cx, cy) {
        const s = scene(); if (!s) return false;
        const gsm = s.gameStateManager;
        if (!gsm.isPlaying || gsm.isPaused || s.placementMode) return false;
        drag.wasSelected = s.selectedTowerType === drag.type;
        if (!drag.wasSelected) s.selectTowerType(drag.type);
        if (s.selectedTowerType !== drag.type) return false; // not enough gold etc.
        if (s.selectedTower) s.deselectTower();
        drag.active = true;
        const icon = drag.btn.querySelector('canvas');
        const g = document.createElement('div');
        g.className = 'cdc-drag-ghost';
        if (icon && icon.width) { try { g.style.backgroundImage = 'url(' + icon.toDataURL() + ')'; } catch (e) {} }
        document.body.appendChild(g); drag.ghost = g;
        document.body.classList.add('cdc-dragging');
        moveGhost(cx, cy);
        return true;
    }
    function finish(cx, cy) {
        const s = scene();
        const wasActive = drag.active;
        if (drag.ghost) drag.ghost.remove();
        drag.ghost = null; drag.active = false; drag.btn = null;
        document.body.classList.remove('cdc-dragging');
        if (!wasActive || !s) { drag.type = null; return; }
        const p = canvasPoint(s, cx, cy);
        if (p && s.gameStateManager.isPlaying && !s.gameStateManager.isPaused) {
            s.handleTileClick(p.x, p.y);
        }
        // A drag never leaves a tool armed: placed -> already cleared; dropped off-board or blocked -> cancel.
        if (s.selectedTowerType === drag.type) { s.selectedTowerType = null; refreshButtons(s); }
        s.canvas.dispatchEvent(new MouseEvent('mouseleave'));
        drag.type = null;
    }
    function shouldStart(dx, dy) {
        if (Math.hypot(dx, dy) < 10) return false;
        const panel = drag.btn && drag.btn.closest('.controls');
        if (!panel) return true;
        const r = panel.getBoundingClientRect();
        // Vertical arsenal (wide layout) scrolls up/down: a sideways pull starts a drag. Bottom bar: an upward pull.
        return r.height > r.width ? Math.abs(dx) > Math.abs(dy) : Math.abs(dy) > Math.abs(dx);
    }

    function bind() {
        BUILD_BUTTONS.forEach(({ id, type }) => {
            const btn = document.getElementById(id);
            if (!btn || btn._cdcDrag) return; btn._cdcDrag = true;
            btn.addEventListener('mousedown', e => {
                if (e.button !== 0) return;
                Object.assign(drag, { type, btn, sx: e.clientX, sy: e.clientY, active: false, touch: false });
            });
            btn.addEventListener('touchstart', e => {
                const t = e.touches[0];
                Object.assign(drag, { type, btn, sx: t.clientX, sy: t.clientY, active: false, touch: true });
            }, { passive: true });
            btn.addEventListener('dragstart', e => e.preventDefault());
        });
        document.addEventListener('mousemove', e => {
            if (!drag.type || drag.touch) return;
            if (!drag.active) {
                if (!(e.buttons & 1)) { drag.type = null; return; }
                if (!shouldStart(e.clientX - drag.sx, e.clientY - drag.sy) || !begin(e.clientX, e.clientY)) return;
            }
            moveGhost(e.clientX, e.clientY);
        });
        document.addEventListener('mouseup', e => { if (drag.type && !drag.touch) { if (drag.active) finish(e.clientX, e.clientY); else drag.type = null; } });
        document.addEventListener('touchmove', e => {
            if (!drag.type || !drag.touch) return;
            const t = e.touches[0];
            if (!drag.active) {
                if (!shouldStart(t.clientX - drag.sx, t.clientY - drag.sy)) return;
                if (!e.cancelable || !begin(t.clientX, t.clientY)) { drag.type = null; return; }
            }
            e.preventDefault();
            moveGhost(t.clientX, t.clientY);
            feedHover(scene(), t.clientX, t.clientY);
        }, { passive: false });
        const tend = e => {
            if (!drag.type || !drag.touch) return;
            if (drag.active) { const t = e.changedTouches[0]; e.preventDefault(); finish(t.clientX, t.clientY); }
            else drag.type = null;
        };
        document.addEventListener('touchend', tend, { passive: false });
        document.addEventListener('touchcancel', () => { if (drag.active) finish(-1, -1); drag.type = null; });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind); else bind();
    window.addEventListener('load', bind);
})();
