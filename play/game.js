/**
 * game.js - Main Game Orchestrator
 */
class GameScene {
    constructor(canvas) {
        window.gameScene = this;
        window.game = this;

        // Testing reset on boot removed so level progression actually saves!
        localStorage.removeItem('td_saved_game');

        try {
            this.canvas = canvas;
            this.ctx = canvas ? canvas.getContext('2d') : null;
            this.gameStateManager = new GameStateManager();

            // Bind Event Listeners FIRST so UI works even if sub-systems fail!
            this.setupEventListeners();

            try { this.gridSystem = new GridSystem(canvas); } catch (e) { console.warn("GridSystem init:", e); }
            try { this.inputManager = new InputManager(this); } catch (e) { console.warn("InputManager init:", e); }
            try { this.soundManager = new SoundManager(); } catch (e) { console.warn("SoundManager init:", e); }

            this.towers = [];
            this.walls = [];
            this.Lilypads = [];
            this.spikes = [];
            this.mirrors = [];
            this.enemies = [];
            this.projectiles = [];
            this.explosions = [];
            this.confetti = [];
            this.damageNumbers = [];
            this.ashEffects = [];

            this.allEntities = [];
            this._entitiesDirty = true;

            if (this.gridSystem) {
                this.gridSystem.drowningCounts = new Map();
            }

            this.lastTime = 0;
            this.spawnTimer = 0;
            this.spawnInterval = GameConfig.Spawning.initialInterval;
            this.selectedTowerType = null;
            this.autoUpgrade = false;

            this.enemiesSpawnedInRound = 0;
            this.enemiesKilledInRound = 0;
            this.enemiesPerRound = GameConfig.Spawning.enemiesPerRoundBase;
            this.isCountingDown = false;

            this.selectedTower = null;
            this.placementMode = false;
            this.castle = null;
            this.castleTile = null;

            this.waterEnabled = true;
            this._settingsOrigin = 'mainMenu';
            this.speedMultiplier = 1;
            this.gameTime = 0;
            this.realTimeSurvived = 0; // GDD: Track real-world seconds
            this.sessionStartTime = Date.now();

            // DDA / Adaptive Difficulty (GDD §9a)
            this.smoothedScore = 0.5;
            this.adaptiveHpMult = 1.0;
            this.adaptiveCountMult = 1.0;
            this.castleHpAtRoundStart = 100;
            this.roundSurviveRatios = [];

            // Spawn Density Control (Safety Guard)
            this._spawnRollingCount = 0;
            this._spawnRollingTimer = 0;

            try { this.setupUI(); } catch (e) {}
            try { this.setupPortal(); } catch (e) {}
            try { this.setupTowerIcons(); } catch (e) {}
            try { this.updateTowerButtonAffordability(this.gameStateManager.gold); } catch (e) {}
            try { this.updateBuildButtonLabels(); } catch (e) {}
            try { this.setupLeaderboardCallbacks(); } catch (e) {}
            try { this.setupThemes(); } catch (e) {}
            try { this.applyUITextures(); } catch (e) {}
            GameLogger.info("GameScene initialization complete. System Ready.");
        } catch (e) {
            GameLogger.error("GameScene initialization failed: " + e);
            console.error(e);
        }
    }

    setupEventListeners() {
        const bind = (id, fn) => {
            const el = document.getElementById(id);
            if (!el) return;

            const handler = (e) => {
                try {
                    if (this.soundManager) this.soundManager.playButtonClick();
                    if (window.logManager) window.logManager.log(`🖱 #${id}`, "CLICK");
                } catch (audioErr) {
                    console.warn("Audio click feedback error:", audioErr);
                }
                try {
                    fn(e);
                } catch (actionErr) {
                    console.error(`Action for #${id} failed:`, actionErr);
                }
            };

            if (el._boundHandler) el.removeEventListener('click', el._boundHandler);
            el._boundHandler = handler;
            el.addEventListener('click', handler);
        };

        this.setupMainMenu();

        bind('pauseBtn', () => this.togglePause());
        bind('resumeBtn', () => this.resume());
        bind('pauseSettingsBtn', () => this.openSettingsMenu());
        bind('reportBugBtn', () => this.openBugReport());
        bind('restartBtn', () => this.restart());
        bind('quitToMenuBtn', () => {
            this.deselectTower();
            document.getElementById('confirmModalOverlay').style.display = 'flex';
        });
        bind('confirmNoBtn', () => document.getElementById('confirmModalOverlay').style.display = 'none');
        bind('confirmYesBtn', () => {
            document.getElementById('confirmModalOverlay').style.display = 'none';
            this.saveGame();
            this.quitToMainMenu();
        });
        bind('gameOverRestartBtn', () => this.restart());
        bind('gameOverMenuBtn', () => this.quitToMainMenu());
        bind('postGameOverMenuBtn', () => this.quitToMainMenu());
        bind('submitScoreBtn', () => this.submitGlobalScore());
        bind('skipSubmissionBtn', () => this.restart());
        bind('sfxToggleBtn', () => this.setSfxEnabled(!this.soundManager.sfxEnabled));
        bind('musicToggleBtn', () => this.setMusicEnabled(!this.soundManager.musicEnabled));
        bind('vibrateToggleBtn', () => this.setVibrationEnabled(!this.soundManager.vibrationEnabled));
        bind('ffBtn', () => this.toggleFastForward());
        bind('upgradeAllHudBtn', () => this.toggleAutoUpgrade());
        bind('viewLogBtn', () => this.openLogViewer());
        bind('closeLogBtn', () => this.closeLogViewer());
        bind('copyLogBtn', () => this.copyLogToClipboard());

        // Log Filter Buttons
        document.querySelectorAll('.log-filter-btn').forEach(btn => {
            btn.onclick = (e) => {
                document.querySelectorAll('.log-filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.openLogViewer(btn.getAttribute('data-filter'));
                if (this.soundManager) this.soundManager.playButtonClick();
            };
        });

        BUILD_BUTTONS.forEach(({ id, type }) => {
            const btn = document.getElementById(id);
            if (btn) {
                const handler = (e) => {
                    try {
                        if (this.soundManager) this.soundManager.playButtonClick();
                    } catch (audioErr) {}
                    this.selectTowerType(type);
                };
                if (btn._boundHandler) btn.removeEventListener('click', btn._boundHandler);
                btn._boundHandler = handler;
                btn.addEventListener('click', handler);
            }
        });

        GameLogger.info("Event listeners setup complete.");
    }

    setupUI() {
        this._el = {
            score: document.getElementById('score'),
            gold: document.getElementById('gold'),
            round: document.getElementById('round'),
            castleHealth: document.getElementById('castleHealth'),
            hudHighScore: document.getElementById('hudHighScore'),
        };

        // Initialize HUD High Score from storage
        const best = parseInt(localStorage.getItem('td_personal_best') || 0);
        if (this._el.hudHighScore) this._el.hudHighScore.textContent = this._formatTime(best);

        this.gameStateManager.on('goldChanged', gold => {
            if (this._el.gold) this._el.gold.textContent = gold;
            this.updateTowerButtonAffordability(gold);
            this.updateActivePopupAffordability();
        });
        this.gameStateManager.on('roundChanged', round => { if (this._el.round) this._el.round.textContent = round; });
        this.gameStateManager.on('castleHealthChanged', health => { if (this._el.castleHealth) this._el.castleHealth.textContent = Math.round(health); });
        this.gameStateManager.on('gameOver', () => { if (this.soundManager) this.soundManager.playCastleDeath(); this.showGameOver(); });

        // Ad Callbacks
        window.onAdClosed = () => {
            const reviveBtn = document.getElementById('reviveAdBtn');
            if (reviveBtn) {
                reviveBtn.textContent = '📺 Watch Ad to Revive';
                reviveBtn.disabled = false;
            }
        };

        window.onAdError = () => {
            GameLogger.warn("Ad failed to load or show.");
            const reviveBtn = document.getElementById('reviveAdBtn');
            if (reviveBtn) {
                reviveBtn.textContent = '📺 Watch Ad to Revive';
                reviveBtn.disabled = false;
            }
        };

        window.onAdRewardEarned = () => {
            // Web build: ads are off; do not grant revive or double-gold.
            return;
            try {
                if (this._adRewardContext === 'doubleRewards') {
                    this._adRewardContext = 'revive';
                    const btn = document.getElementById('doubleRewardsBtn');
                    if (btn) { btn.textContent = '📺 Double Rewards'; btn.disabled = false; }
                    this.applyDoubleRewardsAndExit();
                    return;
                }
                GameLogger.info("Reward earned. Reviving castle & restarting wave...");
                this.hasRevivedThisRun = true;
                const screen = document.getElementById('gameOverScreen');
                if (screen) screen.style.display = 'none';
                document.body.classList.remove('modal-open');

                // 1. Clear any active intermission countdown
                this.clearCountdown();

                // 2. Revive Castle
                this.gameStateManager.castleHealth = GameConfig.Castle.maxHealth;
                if (this.castle) {
                    this.castle.health = this.castle.maxHealth;
                    this.castle.isDestroying = false;
                    this.castle.destroyProgress = 0;
                    this.castle.isBuilt = true;
                    this.castle._hasPlayedDeathSfx = false; // Reset death SFX trigger
                } else {
                    GameLogger.warn("Castle reference is null during revive!");
                }
                this.gameStateManager.setCastleHealth(this.gameStateManager.castleHealth); // Force HUD update

                // 3. Clear Active Entities
                this.enemies.forEach(e => {
                    if (this.addDamageNumber) this.addDamageNumber(e.x, e.y, "REVIVED!");
                    e.isDead = true;
                });
                this.enemies = [];
                this.projectiles = [];
                this.explosions = [];

                // 4. Re-enqueue Current Round Wave
                const countMult = window.balanceAnalytics ? window.balanceAnalytics.getEnemyCountMultiplier() : 1.0;
                const currentLvl = this.selectedLevel || 1;
                this.enemyQueue = this.getRoundComposition(currentLvl, this.gameStateManager.round, countMult);
                this.enemiesPerRound = this.enemyQueue.length;
                this.enemiesSpawnedInRound = 0;
                this.enemiesKilledInRound = 0;
                this.spawnTimer = 0;
                this._spawnRollingCount = 0;

                if (this.portal) {
                    this.portal.isActive = true;
                }

                // 5. Unlock Game States
                this.gameStateManager.gameOverTriggered = false;
                this.gameStateManager.isPlaying = true;
                this.gameStateManager.isPaused = false;
                this.placementMode = false;

                if (this.soundManager) {
                    if (this.soundManager.musicEnabled) this.soundManager.playRandomMusic();
                }

                // 6. Resume Game Loop
                this.lastTime = performance.now();
                if (this._rafId) {
                    cancelAnimationFrame(this._rafId);
                }
                this._rafId = requestAnimationFrame(() => this.gameLoop());
                GameLogger.info("Revive complete! Round " + this.gameStateManager.round + " wave restarted (" + this.enemiesPerRound + " enemies).");
            } catch (err) {
                GameLogger.error("Exception in onAdRewardEarned: " + err.stack);
                // Emergency Recovery
                this.gameStateManager.gameOverTriggered = false;
                this.gameStateManager.isPlaying = true;
                this.gameStateManager.isPaused = false;
                this.lastTime = performance.now();
                this.gameLoop();
            }
        };
    }

    setupMainMenu() {
        const mainMenu = document.getElementById('mainMenu');
        const waterPopup = document.getElementById('waterPopup');

        const bind = (id, fn) => {
            const el = document.getElementById(id);
            if (!el) return;

            const handler = (e) => {
                try {
                    if (this.soundManager) this.soundManager.playButtonClick();
                    if (window.logManager) window.logManager.log(`🖱 #${id}`, "CLICK");
                } catch (audioErr) {
                    console.warn("Audio click feedback error:", audioErr);
                }
                try {
                    fn(e);
                } catch (actionErr) {
                    console.error(`Action for #${id} failed:`, actionErr);
                }
            };

            if (el._boundHandler) el.removeEventListener('click', el._boundHandler);
            el._boundHandler = handler;
            el.addEventListener('click', handler);
        };

        this.onPlayClicked = () => {
            const mainMenu = document.getElementById('mainMenu');
            const levelSelectScreen = document.getElementById('levelSelectScreen');
            if (mainMenu) mainMenu.style.display = 'none';
            if (levelSelectScreen) levelSelectScreen.style.display = 'flex';
            this.setupLevelSelect();
        };

        bind('playBtn', () => this.onPlayClicked());

        bind('startGameBtn', () => {
            localStorage.removeItem('td_saved_game');
            this.waterEnabled = this._menuPendingWater;
            if (waterPopup) waterPopup.style.display = 'none';
            this.start();
        });
        bind('settingsBtn', () => this.openSettingsMenu());
        bind('leaderboardBtn', () => this.openLeaderboard());
        bind('continueBtn', () => this.loadGame());
        bind('settingsBackBtn', () => this.closeSettingsMenu());
        bind('leaderboardBackBtn', () => this.closeLeaderboard());
        bind('waterBackBtn', () => {
            if (waterPopup) waterPopup.style.display = 'none';
            const levelSelectScreen = document.getElementById('levelSelectScreen');
            if (levelSelectScreen) levelSelectScreen.style.display = 'flex';
        });
        bind('waterOnBtn', () => { this._menuPendingWater = true; this._updateWaterPopupSelection(); });
        bind('waterOffBtn', () => { this._menuPendingWater = false; this._updateWaterPopupSelection(); });

        bind('nextLevelBtn', () => {
            const currentLvl = this._pendingVictoryLevel || 1;
            const baseEarned = this._pendingVictoryGold || 0;
            let globalGold = parseInt(localStorage.getItem('td_global_gold') || 0);
            globalGold += baseEarned;
            localStorage.setItem('td_global_gold', globalGold);
            this.updateGlobalGoldDisplay();

            const screen = document.getElementById('levelCompleteScreen');
            if (screen) screen.style.display = 'none';
            document.body.classList.remove('modal-open');

            const nextLvl = currentLvl + 1;
            if (nextLvl <= 25) {
                this.selectedLevel = nextLvl;
                this.waterEnabled = false; // World 1 is dry ground; World 2 will be Swamp World!
                localStorage.removeItem('td_saved_game');
                this.start();
            } else {
                const levelSelectScreen = document.getElementById('levelSelectScreen');
                if (levelSelectScreen) levelSelectScreen.style.display = 'flex';
                if (this.setupLevelSelect) this.setupLevelSelect();
            }
        });

        bind('levelCompleteMenuBtn', () => {
            const baseEarned = this._pendingVictoryGold || 0;
            let globalGold = parseInt(localStorage.getItem('td_global_gold') || 0);
            globalGold += baseEarned;
            localStorage.setItem('td_global_gold', globalGold);
            this.updateGlobalGoldDisplay();

            const screen = document.getElementById('levelCompleteScreen');
            if (screen) screen.style.display = 'none';
            document.body.classList.remove('modal-open');
            this.showMainMenu();
        });

        // Web build: AdMob / rewarded ads are off. Buttons stay hidden and grant nothing.
        const hideAdUi = () => {
            ['reviveAdBtn', 'doubleRewardsBtn', 'mockAdOverlay'].forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    el.style.display = 'none';
                    el.setAttribute('hidden', '');
                }
            });
        };
        hideAdUi();
        bind('doubleRewardsBtn', () => { hideAdUi(); });
        bind('mockAdCloseBtn', () => {
            const adOverlay = document.getElementById('mockAdOverlay');
            if (adOverlay) adOverlay.style.display = 'none';
            // Do not grant a reward on web.
        });

        this.waterEnabled = false; this._menuPendingWater = false;
    }

    getLevelUnlockCost(lvl) {
        if (lvl <= 1) return 0;
        return lvl * 1000; // Level 2 = 2000g, Level 3 = 3000g, ..., Level 25 = 25000g
    }

    setupLevelSelect() {
        this.updateGlobalGoldDisplay();
        const globalBadge = document.querySelector('.global-gold-badge');
        if (globalBadge) globalBadge.style.display = 'flex';

        const levelSelectScreen = document.getElementById('levelSelectScreen');
        const world1View = document.getElementById('world1View');
        const world2View = document.getElementById('world2View');
        const worldTitle = document.getElementById('worldTitle');
        const levelGrid1 = document.getElementById('levelGrid1');
        const nextWorldBtn = document.getElementById('nextWorldBtn');
        const prevWorldBtn = document.getElementById('prevWorldBtn');
        const backBtn = document.getElementById('levelSelectBackBtn');
        const waterPopup = document.getElementById('waterPopup');

        let currentWorld = 1;
        const maxUnlocked = parseInt(localStorage.getItem('td_max_level') || 1);

        // Populate 5x5 level grid (Levels 1 to 25)
        if (levelGrid1) {
            levelGrid1.innerHTML = '';
            for (let lvl = 1; lvl <= 25; lvl++) {
                const btn = document.createElement('button');
                const isUnlocked = lvl <= maxUnlocked;

                btn.className = `level-btn ${isUnlocked ? 'unlocked' : 'locked'}`;

                if (isUnlocked) {
                    btn.textContent = lvl;
                } else {
                    btn.innerHTML = `<span style="font-size:12px; color:#888;">${lvl}</span><br><span style="font-size:13px;">🔒</span>`;
                }

                btn.onclick = () => {
                    if (!isUnlocked) {
                        this.showLevelSelectToast("locked level", btn);
                        return;
                    }

                    this.selectedLevel = lvl;
                    if (levelSelectScreen) levelSelectScreen.style.display = 'none';
                    if (waterPopup) waterPopup.style.display = 'none';

                    this.waterEnabled = false; // World 1 is dry ground; World 2 will be Swamp World!
                    localStorage.removeItem('td_saved_game');
                    this.start();
                };
                levelGrid1.appendChild(btn);
            }
        }

        const updateWorldView = () => {
            if (currentWorld === 1) {
                if (world1View) world1View.style.display = 'flex';
                if (world2View) world2View.style.display = 'none';
                if (worldTitle) worldTitle.textContent = "World 1: Outskirts";
                if (prevWorldBtn) prevWorldBtn.style.visibility = 'hidden';
                if (nextWorldBtn) nextWorldBtn.style.visibility = 'visible';
            } else {
                if (world1View) world1View.style.display = 'none';
                if (world2View) world2View.style.display = 'flex';
                if (worldTitle) worldTitle.textContent = "World 2: Swamp World (Coming Soon)";
                if (prevWorldBtn) prevWorldBtn.style.visibility = 'visible';
                if (nextWorldBtn) nextWorldBtn.style.visibility = 'hidden';
            }
        };

        if (nextWorldBtn) nextWorldBtn.onclick = () => { currentWorld = 2; updateWorldView(); };
        if (prevWorldBtn) prevWorldBtn.onclick = () => { currentWorld = 1; updateWorldView(); };
        if (backBtn) backBtn.onclick = () => {
            if (levelSelectScreen) levelSelectScreen.style.display = 'none';
            this.showMainMenu();
        };

        // Touch swipe support for worlds slider
        const slider = document.getElementById('worldSlider');
        if (slider && !slider._swipeInitialized) {
            slider._swipeInitialized = true;
            let startX = 0;
            slider.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, {passive: true});
            slider.addEventListener('touchend', e => {
                const diff = e.changedTouches[0].clientX - startX;
                if (diff < -50 && currentWorld === 1) { currentWorld = 2; updateWorldView(); }
                else if (diff > 50 && currentWorld === 2) { currentWorld = 1; updateWorldView(); }
            }, {passive: true});
        }

        updateWorldView();
    }

    applyDoubleRewardsAndExit() {
        const baseEarned = this._pendingVictoryGold || 0;
        // Add the bonus portion again to double the rewards (2x total)
        let globalGold = parseInt(localStorage.getItem('td_global_gold') || 0);
        globalGold += baseEarned;
        localStorage.setItem('td_global_gold', globalGold);

        this.updateGlobalGoldDisplay();
        this.showLevelSelectToast(`+${baseEarned}g Ad Bonus Added!`, null);

        this._pendingVictoryGold = 0;
        const btn = document.getElementById('doubleRewardsBtn');
        if (btn) { btn.textContent = '📺 Double Rewards'; btn.disabled = false; }
    }

    showLevelSelectToast(msg, targetElement) {
        const levelSelectScreen = document.getElementById('levelSelectScreen');
        if (!levelSelectScreen) return;

        const oldToast = levelSelectScreen.querySelector('.level-toast');
        if (oldToast) oldToast.remove();

        const toast = document.createElement('div');
        toast.className = 'level-toast';
        toast.textContent = msg;

        if (targetElement) {
            const rect = targetElement.getBoundingClientRect();
            const parentRect = levelSelectScreen.getBoundingClientRect();
            toast.style.left = (rect.left + rect.width / 2 - parentRect.left) + 'px';
            toast.style.top = (rect.top - parentRect.top - 8) + 'px';
            toast.style.transform = 'translateX(-50%)';
        } else {
            toast.style.left = '50%';
            toast.style.top = '40%';
            toast.style.transform = 'translate(-50%, -50%)';
        }

        levelSelectScreen.appendChild(toast);

        setTimeout(() => {
            toast.remove();
        }, 1200);
    }

    start() {
        if (window.logManager) window.logManager.initSession();
        document.body.classList.remove('modal-open');
        this._hideAllOverlays();
        this.gameStateManager.reset();
        const currentLvl = this.selectedLevel || 1;
        if (currentLvl === 2) {
            this.gameStateManager.gold = 150;
            this.gameStateManager.notify('goldChanged', 150);
        } else if (currentLvl === 3) {
            this.gameStateManager.gold = 250;
            this.gameStateManager.notify('goldChanged', 250);
        } else if (currentLvl === 4) {
            this.gameStateManager.gold = 250;
            this.gameStateManager.notify('goldChanged', 250);
        } else if (currentLvl === 5) {
            this.gameStateManager.gold = 450;
            this.gameStateManager.notify('goldChanged', 450);
        } else if (currentLvl === 6) {
            this.gameStateManager.gold = 450;
            this.gameStateManager.notify('goldChanged', 450);
        } else if (currentLvl === 7) {
            this.gameStateManager.gold = 600;
            this.gameStateManager.notify('goldChanged', 600);
        } else if (currentLvl === 8) {
            this.gameStateManager.gold = 350;
            this.gameStateManager.notify('goldChanged', 350);
        } else if (currentLvl === 9) {
            this.gameStateManager.gold = 500;
            this.gameStateManager.notify('goldChanged', 500);
        } else if (currentLvl === 10) {
            this.gameStateManager.gold = 700;
            this.gameStateManager.notify('goldChanged', 700);
        } else if (currentLvl === 11) {
            this.gameStateManager.gold = 700;
            this.gameStateManager.notify('goldChanged', 700);
        } else if (currentLvl === 12) {
            this.gameStateManager.gold = 1100;
            this.gameStateManager.notify('goldChanged', 1100);
        } else if (currentLvl === 13 || currentLvl === 14) {
            this.gameStateManager.gold = 1100;
            this.gameStateManager.notify('goldChanged', 1100);
        } else if (currentLvl >= 15) {
            /*AUTOBAL_GOLD_START*/
            const autobalGold = {10:700, 11:700, 12:1100, 13:1100, 14:1100, 15:1300, 16:1350, 17:1650, 18:2000, 19:1400, 20:1400, 21:1200, 22:1200, 23:1300, 24:1300, 25:1500};
            if (autobalGold[currentLvl] != null) {
                this.gameStateManager.gold = autobalGold[currentLvl];
                this.gameStateManager.notify('goldChanged', autobalGold[currentLvl]);
            }
            /*AUTOBAL_GOLD_END*/
        }
        this.resetFastForward();

        const globalBadge = document.querySelector('.global-gold-badge');
        if (globalBadge) globalBadge.style.display = 'none';

        // Ensure all auto-upgrades (global and per-type) are OFF by default on new game start
        this.autoUpgrade = false;
        const upgradeAllBtn = document.getElementById('upgradeAllHudBtn');
        if (upgradeAllBtn) upgradeAllBtn.classList.remove('active');

        this.enemies = []; this.towers = []; this.walls = []; this.Lilypads = []; this.spikes = []; this.mirrors = []; this.projectiles = [];
        this.explosions = []; this.confetti = []; this.damageNumbers = []; this.ashEffects = [];
        this.castle = null; this.castleTile = null; this.selectedTower = null; this.selectedTowerType = null;
        this._entitiesDirty = true;

        this.gameTime = 0;
        this.realTimeSurvived = 0; // GDD: Reset real-world timer
        this.adaptiveHpMult = 1.0; this.adaptiveCountMult = 1.0; this.castleHpAtRoundStart = 100; this.roundSurviveRatios = [];
        this.hasRevivedThisRun = false;
        this.buildCooldowns = {};

        // Refresh Best score in HUD
        const best = parseInt(localStorage.getItem('td_personal_best') || 0);
        if (this._el && this._el.hudHighScore) this._el.hudHighScore.textContent = this._formatTime(best);

        // Start background music if enabled
        if (this.soundManager && this.soundManager.musicEnabled) {
            this.soundManager.playRandomMusic();
        }

        this.gridSystem.createGrid();
        this.setupPortal();
        this.gridSystem.generateWater(this.waterEnabled ? 15 : 0);
        this.placementMode = true;
        this.enemiesSpawnedInRound = 0; this.enemiesKilledInRound = 0;
        this.updateBuildButtonLabels();
        this.gameStateManager.isPlaying = true;
        this.lastTime = performance.now();
        if (!this._rafId) this.gameLoop();
    }



    gameLoop() {
        try {
            if (!this.gameStateManager.isPlaying || this.gameStateManager.isPaused) {
                GameLogger.info("gameLoop halted (isPlaying=" + this.gameStateManager.isPlaying + ", isPaused=" + this.gameStateManager.isPaused + ")");
                this._rafId = null;
                return;
            }
            const now = performance.now();
            // Hard safety boundary: If delta is extreme (like a 60 second tab freeze), clamp it to 0.1s max to prevent physics explosions
            const deltaMs = now - this.lastTime;
            if (deltaMs > 1000) GameLogger.info("Massive time skip detected: " + deltaMs + "ms. Clamping physics frame.");

            const unscaledDelta = Math.min(deltaMs / 1000, 0.1);
            const deltaTime = unscaledDelta * this.speedMultiplier;
            this.lastTime = now; this.lastDeltaTime = deltaTime;

            // Performance Debugging
            this._frameStart = now;
            this.update(deltaTime, unscaledDelta);
            this.render();

            this._frameEnd = performance.now();
            this._lastFrameMs = this._frameEnd - this._frameStart;
            if (this._lastFrameMs > 100) {
                GameLogger.warn(`Jank detected: Frame took ${this._lastFrameMs.toFixed(1)}ms`);
            }

            this._rafId = requestAnimationFrame(() => this.gameLoop());
        } catch (e) {
            GameLogger.error("CRITICAL CRASH in gameLoop: " + e.stack);
            this.gameStateManager.isPlaying = false;
            this.autoSubmitError("CRITICAL CRASH in gameLoop: " + (e.stack || e.message || e));

            // Attempt to show error on screen
            if (this.ctx) {
                const ctx = this.ctx;
                ctx.save();
                ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset all transforms
                ctx.fillStyle = 'rgba(180, 0, 0, 1.0)'; // Solid Deep Red
                ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

                ctx.fillStyle = 'white';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                const midX = this.canvas.width / 2;
                const midY = this.canvas.height / 2;

                ctx.font = 'bold 24px sans-serif';
                ctx.fillText("⚠️ SYSTEM CRASH", midX, midY - 140);

                ctx.font = '16px monospace';
                ctx.fillText("An unrecoverable error occurred.", midX, midY - 100);

                ctx.fillStyle = '#FFCCCC';
                ctx.font = '10px monospace';
                const stackLines = (e.stack || e.message || "Unknown Error").split('\n');
                for (let i = 0; i < Math.min(stackLines.length, 15); i++) {
                    ctx.fillText(stackLines[i].substring(0, 90), midX, midY - 60 + i * 14);
                }

                ctx.fillStyle = 'white';
                ctx.font = '12px sans-serif';
                ctx.fillText("The developer has been notified.", midX, midY + 180);
                ctx.fillText("Please restart the app.", midX, midY + 205);
                ctx.restore();
            }
        }
    }

    update(deltaTime, unscaledDelta = 0) {
        if (this.placementMode) return; // Timer and logic suspended until castle is placed

        this.gameTime += deltaTime;
        this.realTimeSurvived += unscaledDelta;
        const currentMs = this.gameTime * 1000;

        // GDD §2: Update Survival Time HUD (Real-world seconds)
        if (this._el.score) {
            this._el.score.textContent = this._formatTime(Math.floor(this.realTimeSurvived));
        }

        // GDD §2: Calculate and Notify Composite Score
        const oldScore = Math.floor(this.gameStateManager.score);
        const currentScore = Math.floor(this.realTimeSurvived) + (this.gameStateManager.round - 1) * 100;
        if (currentScore > oldScore) {
            this.gameStateManager.score = currentScore;
            this.gameStateManager.notify('scoreChanged', currentScore);
        }

        if (this.castle) this.castle.update(deltaTime, currentMs, this.enemies, this);
        if (this.portal) this.portal.update(deltaTime);

        // GDD §7: Throttled Pathfinding (Spread CPU load to prevent ANR/App Closure)
        // Increased from 5 to 15 for better responsiveness, or 50 if a tower was just placed.
        this._pathfindingBudget = this._urgentRepath ? 50 : 15;
        this._urgentRepath = false;

        for (let i = 0; i < this.enemies.length; i++) {
            const e = this.enemies[i];
            if (e.needsPathUpdate && this._pathfindingBudget > 0) {
                e._repath(this.gridSystem);
                this._pathfindingBudget--;
            }
            e.update(deltaTime, this.castle, this.gridSystem, currentMs);
        }

        // Auto-reset Fast-Forward to 1x speed if any enemy is <= 2 seconds away from reaching the Castle
        if (this.speedMultiplier > 1 && this.enemies.length > 0) {
            for (let i = 0; i < this.enemies.length; i++) {
                const e = this.enemies[i];
                if (!e.isDead && e.getTimeToCastle(this.gridSystem) <= 2000) {
                    this.resetFastForward();
                    break;
                }
            }
        }

        // Update Loops with removal handling
        this.towers = this.towers.filter(t => {
            const destroyed = t.update(this.enemies, currentMs, this, this.castle);
            if (destroyed) {
                const tile = this.gridSystem.getTileAtPosition(t.x, t.y);
                if (tile) { tile.occupied = false; tile.reserved = false; }
                this._entitiesDirty = true;
                return false;
            }
            return true;
        });

        this.walls = this.walls.filter(w => {
            const destroyed = w.update(deltaTime, this.castle);
            if (destroyed) {
                const tile = this.gridSystem.getTileAtPosition(w.x, w.y);
                if (tile) { tile.occupied = false; tile.reserved = false; tile.isWall = false; }
                this._entitiesDirty = true;
                return false;
            }
            return true;
        });

        this.mirrors = this.mirrors.filter(m => {
            const destroyed = m.update(deltaTime, this.castle);
            if (destroyed) {
                const tile = this.gridSystem.getTileAtPosition(m.x, m.y);
                if (tile) { tile.occupied = false; tile.reserved = false; }
                this._entitiesDirty = true;
                this.updateLaserPaths();
                return false;
            }
            return true;
        });

        this.spikes = this.spikes.filter(s => {
            s.update(this.enemies, currentMs, this);
            if (s.isDestroying && s.updateDestroy(deltaTime, this.castle)) {
                this._entitiesDirty = true;
                return false;
            }
            return true;
        });

        this.Lilypads = this.Lilypads.filter(l => {
            const destroyed = l.update(deltaTime, this.castle, this.enemies, currentMs);
            if (destroyed) {
                const tile = this.gridSystem.getTileAtPosition(l.x, l.y);
                if (tile) { tile.occupied = false; tile.reserved = false; this.gridSystem.removeLilypad(tile); }
                this._entitiesDirty = true;
                return false;
            }
            return true;
        });

        // Projectiles
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const p = this.projectiles[i];
            p.update(deltaTime, this.canvas, this);
            if (p.isDead) {
                this.projectiles[i] = this.projectiles[this.projectiles.length - 1];
                this.projectiles.pop();
            }
        }

        // Enemies cleanup and logic
        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const e = this.enemies[i];
            if (e.isDead) {
                if (!e._ratioRecorded) {
                    const ratio = e.distanceTraveled / (e.totalPathLength || 1);
                    this.roundSurviveRatios.push(Math.min(1.0, ratio));
                    e._ratioRecorded = true;
                    this.enemiesKilledInRound++;
                    this.gameStateManager.addGold(e.reward || 3);

                    // GDD §9: Handle Splitter splitting logic
                    if (e.canSplit && e.canSplit()) {
                        e.split(this);
                    }
                }
                // In-place remove
                this.enemies[i] = this.enemies[this.enemies.length - 1];
                this.enemies.pop();
                this._entitiesDirty = true;
            }
        }

        for (let i = this.ashEffects.length - 1; i >= 0; i--) {
            const effect = this.ashEffects[i];
            effect.time += deltaTime * 1000;
            if (effect.time > 1500) {
                this.ashEffects[i] = this.ashEffects[this.ashEffects.length - 1];
                this.ashEffects.pop();
            }
        }

        // Explosions
        for (let i = this.explosions.length - 1; i >= 0; i--) {
            const exp = this.explosions[i];
            exp.life -= deltaTime * 1000;
            if (exp.life <= 0) {
                this.explosions[i] = this.explosions[this.explosions.length - 1];
                this.explosions.pop();
            }
        }

        // Confetti
        for (let i = this.confetti.length - 1; i >= 0; i--) {
            const p = this.confetti[i];
            p.x += p.vx * deltaTime; p.y += p.vy * deltaTime;
            p.vy += 400 * deltaTime; p.life -= deltaTime; p.rot += p.vr * deltaTime;
            if (p.life <= 0) {
                this.confetti[i] = this.confetti[this.confetti.length - 1];
                this.confetti.pop();
            }
        }

        // Damage Numbers
        for (let i = this.damageNumbers.length - 1; i >= 0; i--) {
            const dn = this.damageNumbers[i];
            dn.y -= 30 * deltaTime; dn.life -= deltaTime;
            if (dn.life <= 0) {
                this.damageNumbers[i] = this.damageNumbers[this.damageNumbers.length - 1];
                this.damageNumbers.pop();
            }
        }

        if (this.blockedPathMessageAlpha > 0) { this.blockedPathMessageAlpha -= deltaTime; this.blockedPathMessageOffset += 30 * deltaTime; }

        if (!this.placementMode && this.enemiesSpawnedInRound < this.enemiesPerRound && !this.isCountingDown) {
            this.spawnTimer += deltaTime * 1000;
            this._spawnRollingTimer += unscaledDelta;

            if (this._spawnRollingTimer >= 2.0) {
                this._spawnRollingCount = 0;
                this._spawnRollingTimer = 0;
            }

            let effectiveInterval = this.spawnInterval;
            if (this.enemyQueue && this.enemyQueue.length > 0) {
                const nextType = this.enemyQueue[0].type;
                const round = this.gameStateManager.round;
                if (nextType === 'crocodile') {
                    effectiveInterval *= 2.5;
                } else if (nextType === 'speedy') {
                    // Speedy are fast but we want them slightly more spread out so the player is easily overwhelmed if they don't have Frost.
                    // Start at 2.0x the normal interval, and decrease gently as rounds progress
                    const speedFactor = Math.pow(1.1, round - 1);
                    effectiveInterval = Math.max(500, (this.spawnInterval * 2.0) / speedFactor);
                }
            }

            // Force immediate spawn if grid is empty
            const forceSpawn = (this.enemies.length === 0 && this.enemyQueue && this.enemyQueue.length > 0);

            // Hard density cap: Max 16 units spawned per 2 seconds (rolling window)
            if (this.spawnTimer >= effectiveInterval || forceSpawn) {
                if (this._spawnRollingCount < 16) {
                    this.spawnEnemy();
                    this.spawnTimer = 0;
                    if (this.enemiesSpawnedInRound >= this.enemiesPerRound && this.portal) {
                        this.portal.isActive = false;
                    }
                } else if (window.logManager && !this._lastDensityWarningTime || Date.now() - this._lastDensityWarningTime > 2000) {
                    window.logManager.log(`Spawn density cap reached (16/2s). Throttling...`, "AI");
                    this._lastDensityWarningTime = Date.now();
                }
            }
        }

        if (!this.placementMode && this.enemiesSpawnedInRound >= this.enemiesPerRound && this.enemies.length === 0 && !this.isCountingDown) {
            this.startIntermission();
        }

        // GDD §4/5a: Auto Upgrade logic (runs every 1 second)
        this._autoUpgradeTimer = (this._autoUpgradeTimer || 0) + deltaTime;
        if (this._autoUpgradeTimer >= 1.0) {
            this._runAutoUpgradeSweep();
            this._autoUpgradeTimer = 0;
        }
    }

    _runAutoUpgradeSweep() {
        const entities = [...this.towers, ...this.spikes, ...this.mirrors, ...this.Lilypads, ...this.walls];
        if (this.castle) entities.push(this.castle);

        entities.forEach(e => {
            // Skip UpgraderTower from auto-upgrade
            if (e.isUpgrader) return;

            let shouldUpgrade = false;
            if (e.autoUpgrade === true) {
                shouldUpgrade = true;
            } else if (e.autoUpgrade === false) {
                shouldUpgrade = false;
            } else {
                shouldUpgrade = this.autoUpgrade; // Fallback to global "Upgrade All" HUD toggle
            }

            if (shouldUpgrade) {
                this._attemptEntityUpgrade(e);
            }
        });
    }

    _attemptEntityUpgrade(e) {
        if (!e || e.isDestroying || e.isUpgrading || !e.isBuilt) return;
        const maxLvl = e.maxUpgrades !== undefined ? e.maxUpgrades : 5;
        if (e.upgradeLevel >= maxLvl) return;

        const cost = e.getUpgradeCost ? e.getUpgradeCost() : 0;
        if (this.gameStateManager.gold >= cost) {
            const started = e.startUpgrade ? e.startUpgrade() : false;
            if (started) {
                this.gameStateManager.spendGold(cost);
                this._entitiesDirty = true;
                if (window.logManager) window.logManager.log(`▲ ${getLogId(e.isCastle ? 'castle' : e.type)} ➜ Lv${e.upgradeLevel + 1} (-${cost}g)`, "TOWERS");
            } else if (!e.startUpgrade) {
                if (this.gameStateManager.spendGold(cost)) {
                    e.upgrade ? e.upgrade() : (e.upgradeLevel++);
                    if (window.logManager) window.logManager.log(`▲ ${e.type || 'castle'} ➜ Lv${e.upgradeLevel} (-${cost}g)`, "TOWERS");
                }
            }
            if (e.recalcStats) e.recalcStats();
            // GDD: Construction sound handled by completeUpgrade for timed builds
        }
    }

    _getNearbyEnemies(x, y, range) {
        const rangeSq = range * range;
        return this.enemies.filter(e => !e.isDead && distSq(x, y, e.x, e.y) <= rangeSq);
    }

    _isStillOnMap(e) {
        if (!e) return false;
        const list = e.isWall ? this.walls : (e.isSpike ? this.spikes : (e.isMirror ? this.mirrors : (e.isLilypad ? this.Lilypads : this.towers)));
        return list.indexOf(e) !== -1;
    }

    _rebuildEntities() {
        this.allEntities = [...this.enemies, ...this.towers, ...this.walls, ...this.Lilypads, ...this.spikes, ...this.mirrors];
        if (this.castle) this.allEntities.push(this.castle);
        if (this.portal) this.allEntities.push(this.portal);

        // Sorting: Primary sort by Y-coordinate for depth, secondary by layer
        this.allEntities.sort((a, b) => {
            const yA = (a.y !== undefined) ? a.y : 0;
            const yB = (b.y !== undefined) ? b.y : 0;
            if (Math.abs(yA - yB) > 1) return yA - yB;

            // Secondary sort: ensure ground-traps (Spikes/Lilypads) are always below bodies at same Y
            const layerA = (a.isSpike || a.isLilypad) ? 0 : 1;
            const layerB = (b.isSpike || b.isLilypad) ? 0 : 1;
            return layerA - layerB;
        });

        // Specialized sub-lists for multi-pass rendering
        this._renderPasses = {
            underLilypad: [],
            groundFlats: [], // Spikes, Lilypads
            interleaved: [],  // Bases + Ground Enemies
            tops: [],
            air: [],        // Flyers
            buildables: []
        };

        this.allEntities.forEach(ent => {
            const isFlyer = ent.type === 'flyer';
            const isUnder = ent.isEnemy && ent.isUnderLilypad && ent.isUnderLilypad();
            const isFlat = ent.isSpike || ent.isLilypad;

            if (isUnder) {
                this._renderPasses.underLilypad.push(ent);
            } else if (isFlyer) {
                this._renderPasses.air.push(ent);
            } else if (isFlat) {
                this._renderPasses.groundFlats.push(ent);
            } else {
                // Everything else (Bases + Regular Enemies) goes into Interleaved pass
                this._renderPasses.interleaved.push(ent);
            }

            if (ent.renderTop) this._renderPasses.tops.push(ent);

            // Track entities for progress rings
            if (ent.renderProgressRing && (!ent.isBuilt || ent.isDestroying || ent.isUpgrading)) {
                this._renderPasses.buildables.push(ent);
            }
        });

        this._entitiesDirty = false;
    }

    render() {
        if (this._entitiesDirty) this._rebuildEntities();

        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.gridSystem.render();

        // Pass 0: Enemies under Lilypads (Deepest)
        this._renderPasses.underLilypad.forEach(ent => ent.render(this.ctx, this.gameTime));

        // Pass 1: Ground Flats (Spikes, Lilypads)
        this._renderPasses.groundFlats.forEach(ent => ent.render(this.ctx, this.gameTime));

        // Pass 2: Interleaved Bodies (Tower Bases, Regular Enemies, Walls, Mirrors)
        // Y-sorting here handles occlusion correctly (walking behind towers)
        this._renderPasses.interleaved.forEach(ent => {
            if (ent.isEnemy) ent.render(this.ctx, this.gameTime);
            else if (ent.renderBase) ent.renderBase(this.ctx, this.gameTime);
            else if (ent.isWall) ent.render(this.ctx, this.walls);
            else if (ent.render) ent.render(this.ctx, this.gameTime);
        });

        // Pass 3: Tops/Barrels (Occlude enemies and bases)
        this._renderPasses.tops.forEach(ent => ent.renderTop(this.ctx, this.gameTime));

        // Pass 4: Air (Flyers fly OVER barrels)
        this._renderPasses.air.forEach(ent => ent.render(this.ctx, this.gameTime));

        // Pass 5: Structural Overlays (Damage Cracks & HP Bars)
        this.allEntities.forEach(ent => {
            if (ent.renderStructureOverlays) ent.renderStructureOverlays(this.ctx);
        });

        // Projectiles and Weapon FX (Fire particles, Lasers, etc.)
        for (let i = 0; i < this.projectiles.length; i++) this.projectiles[i].render(this.ctx);
        for (let i = 0; i < this.towers.length; i++) if (this.towers[i].renderWeaponEffects) this.towers[i].renderWeaponEffects(this.ctx);

        // GDD §14: Range Circles & FOV Overlays (Rendered ABOVE weapon fire layer)
        if (this.selectedTower && this.selectedTower.renderRangeOverlay) {
            this.selectedTower.renderRangeOverlay(this.ctx);
        }

        this.ashEffects.forEach(effect => {
            if (typeof renderAshDeathEffect === 'function') {
                renderAshDeathEffect(this.ctx, effect);
            }
        });

        this.explosions.forEach(exp => {
            const alpha = exp.life / exp.maxLife; this.ctx.save(); this.ctx.globalAlpha = alpha;
            this.ctx.fillStyle = exp.color || '#FF6600'; this.ctx.beginPath();
            this.ctx.arc(exp.x, exp.y, exp.radius * (1.2 - alpha * 0.2), 0, Math.PI * 2); this.ctx.fill(); this.ctx.restore();
        });

        this.confetti.forEach(p => {
            this.ctx.save(); this.ctx.translate(p.x, p.y); this.ctx.rotate(p.rot);
            this.ctx.fillStyle = p.color; this.ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); this.ctx.restore();
        });

        var scale = GameConfig.scale || 1.0;
        this.ctx.font = 'bold ' + Math.round(14 * scale) + 'px Arial'; this.ctx.textAlign = 'center';
        for (var i = 0; i < this.damageNumbers.length; i++) {
            var dn = this.damageNumbers[i];
            this.ctx.fillStyle = 'rgba(255, 235, 59, ' + dn.life + ')';
            this.ctx.fillText(dn.damage, dn.x, dn.y);
        }

        // Build Progress Rings
        this._renderPasses.buildables.forEach(ent => {
            if (typeof ent.renderProgressRing === 'function') {
                const color = ent.isSpike ? '#AAA' : ent.isLilypad ? '#3A8B3A' : ent.isWall ? '#D2691E' : ent.isMirror ? '#88CCFF' : ent.color || '#FF8C00';
                ent.renderProgressRing(this.ctx, ent.x, ent.y, (ent.size / 2) + 6, color, { isUpgrade: ent.isUpgrading, upgradeProgress: ent.upgradeProgress });
            }
        });

        // Update Cooldown Progress Rings on Arsenal Canvases
        this.updateTowerCooldownVisuals();

        if (this.blockedPathMessageAlpha > 0) {
            this.ctx.save();
            var scale = GameConfig.scale || 1.0;
            this.ctx.globalAlpha = Math.min(1.0, this.blockedPathMessageAlpha);
            this.ctx.fillStyle = 'red';
            this.ctx.font = 'bold ' + Math.round(16 * scale) + 'px Arial';
            this.ctx.textAlign = 'center';
            const text = this.blockedPathMessage;
            const metrics = this.ctx.measureText(text);
            const halfWidth = metrics.width / 2;
            const drawX = Math.max(halfWidth + 10, Math.min(this.canvas.width - halfWidth - 10, this.blockedPathMessageX));
            const drawY = Math.max(30, Math.min(this.canvas.height - 10, this.blockedPathMessageY - this.blockedPathMessageOffset));
            this.ctx.fillText(text, drawX, drawY);
            this.ctx.restore();
        }

        if (this.placementMode) {
            const scale = Math.max(0.4, Math.min(1.0, this.canvas.width / 420));
            const fontSize = Math.round(13 * scale);
            const bannerH = Math.round(28 * scale);
            this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            this.ctx.fillRect(0, this.canvas.height / 2 - bannerH / 2, this.canvas.width, bannerH);
            this.ctx.fillStyle = '#FFD700';
            this.ctx.font = 'bold ' + fontSize + 'px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.fillText('PLACE YOUR CASTLE', this.canvas.width / 2, this.canvas.height / 2);
        }
    }

    handleMouseDown(e, x, y) {
        if (this.placementMode) {
            const tile = this.gridSystem.getTileAtPosition(x, y);
            if (tile && !tile.occupied && !tile.reserved && !tile.water) {
                if (!this.gridSystem.pathFinder.canPlaceCastle(tile, this.towers, this.walls, this.mirrors)) {
                    this.setBlockedMessage("No path from Portal!", x, y);
                    return;
                }
                this.setupCastle(tile);
                this.placementMode = false;
                this._entitiesDirty = true;
                const firstCd = (this.selectedLevel === 10) ? 40 : (this.selectedLevel >= 11 && this.selectedLevel <= 25) ? 30 : 10;
                this.startCountdown(firstCd, () => this.startNextRound());
            }
            return;
        }
        const entity = this._getEntityAt(x, y);
        if (entity) {
            if (this.selectedTower === entity) {
                this.deselectTower();
            } else {
                if (this._switchTimeoutID) {
                    clearTimeout(this._switchTimeoutID);
                    this._switchTimeoutID = null;
                }

                if (this.selectedTower) {
                    // Close current with animation, then open new
                    this.deselectTower();
                    this._switchTimeoutID = setTimeout(() => {
                        this.selectedTower = entity;
                        this.showTowerPopup(entity);
                        this._switchTimeoutID = null;
                    }, 320);
                } else {
                    this.selectedTower = entity;
                    this.showTowerPopup(entity);
                }
            }
        } else {
            if (this.selectedTower) this.deselectTower();
            this.handleTileClick(x, y);
        }
    }

    handleMouseMove(e, x, y) {
        // Placeholder for future hover effects or drag-to-build
    }

    handleMouseUp(e) {
        // Placeholder for future click-up logic
    }

    _getEntityAt(x, y) {
        const entities = [...this.towers, ...this.walls, ...this.spikes, ...this.mirrors, ...this.Lilypads];
        if (this.castle) entities.push(this.castle);
        if (this.portal) entities.push(this.portal);
        for (let i = 0; i < entities.length; i++) {
            const ent = entities[i];
            const size = ent.isCastle ? GameConfig.Castle.size : (ent.isPortal ? ent.size : (ent.size || 40));
            if (dist(x, y, ent.x, ent.y) < size / 2) return ent;
        }
        return null;
    }

    handleTileClick(x, y) {
        const tile = this.gridSystem.getTileAtPosition(x, y);
        if (!tile || tile.occupied || tile.reserved || !this.selectedTowerType) return;
        const type = this.selectedTowerType;
        if (tile.water && type !== 'lilypad') return;
        if (!tile.water && type === 'lilypad') return;

        // Check if building this tower type is currently on cooldown
        const currentMs = this.gameTime * 1000;
        if (this.buildCooldowns && this.buildCooldowns[type] && currentMs < this.buildCooldowns[type]) {
            this.setBlockedMessage("Cooling down!", x, y);
            if (this.soundManager) this.soundManager.playCastlePlacement(true);
            return;
        }

        // Check if a ground enemy is standing on this tile (Spikes and Flyers are exempt)
        const isSpike = (type === 'spike');
        if (!isSpike) {
            const hasGroundEnemy = this.enemies.some(e => {
                if (e.isDead || e.special === 'fly') return false; // Flyers are exempt
                const eTile = this.gridSystem.getTileAtPosition(e.x, e.y);
                return eTile === tile;
            });
            if (hasGroundEnemy) {
                this.setBlockedMessage("Enemy on tile!", x, y);
                return;
            }
        }

        const configKey = TOWER_CONFIG_KEYS[type];
        const cost = configKey ? GameConfig.Tower[configKey].cost : (type === 'wall' ? GameConfig.Wall.cost : type === 'spike' ? GameConfig.Spike.cost : type === 'mirror' ? GameConfig.Mirror.cost : type === 'lilypad' ? GameConfig.Lilypad.cost : 0);

        if ((configKey || type === 'wall' || type === 'mirror') && !this.gridSystem.pathFinder.canPlaceTower(tile, this.towers, this.walls, this.mirrors)) {
            this.setBlockedMessage("Can't block the path!", x, y); return;
        }

        if (this.gameStateManager.spendGold(cost)) {
            const ts = GameConfig.Grid.tileSize, tx = tile.x + ts/2, ty = tile.y + ts/2;
            let ent;
            switch(type) {
                case 'machinegun': ent = new MachineGunTower(tx, ty); break;
                case 'cannon': ent = new CannonTower(tx, ty); break;
                case 'sniper': ent = new SniperTower(tx, ty); break;
                case 'aa': ent = new AAGunTower(tx, ty); break;
                case 'mortar': ent = new MortarTower(tx, ty); break;
                case 'frost': ent = new FrostTower(tx, ty); break;
                case 'tesla': ent = new TeslaTower(tx, ty); break;
                case 'upgrader': ent = new UpgraderTower(tx, ty); break;
                case 'laser': ent = new LaserTower(tx, ty); break;
                case 'flame': ent = new FlameTower(tx, ty); break;
                case 'wall': ent = new WallTower(tx, ty, tile.col, tile.row); break;
                case 'spike': ent = new SpikeTrap(tx, ty, tile.col, tile.row); break;
                case 'mirror': ent = new MirrorTower(tx, ty, tile.col, tile.row); break;
                case 'lilypad': ent = new LilypadTower(tx, ty, tile.col, tile.row); break;
                default: ent = new Tower(type, tx, ty);
            }
            if (type === 'wall') {
                this.walls.push(ent);
                tile.isWall = true;
            } else if (type === 'spike') {
                this.spikes.push(ent);
            } else if (type === 'mirror') {
                this.mirrors.push(ent);
            } else if (type === 'lilypad') {
                this.Lilypads.push(ent);
                this.gridSystem.addLilypad(tile, ent);
            } else {
                this.towers.push(ent);
            }
            this._entitiesDirty = true;

            if (window.logManager) {
                window.logManager.log(`⚒ ${getLogId(type)} @ [${tile.col},${tile.row}] (-${cost}g)`, "TOWERS");
            }
            if (type !== 'spike' && type !== 'lilypad') tile.occupied = true;
            tile.reserved = true;

            // Apply Placement Cooldown
            if (!this.buildCooldowns) this.buildCooldowns = {};
            const def = BUILD_BUTTONS.find(b => b.type === type);
            if (def && def.cooldown) {
                this.buildCooldowns[type] = currentMs + def.cooldown;
            }

            this.updateEnemyPaths();
            this.updateLaserPaths();
            if (this.soundManager) this.soundManager.playButtonClick();
        }
    }

    deselectTower() {
        if (this._switchTimeoutID) {
            clearTimeout(this._switchTimeoutID);
            this._switchTimeoutID = null;
        }

        const popup = document.getElementById('towerPopup');
        if (this._popupTimeoutID) {
            clearTimeout(this._popupTimeoutID);
            this._popupTimeoutID = null;
        }

        if (popup && popup.style.display !== 'none') {
            popup.classList.remove('popup-open');
            popup.classList.add('popup-closing');
            this._popupTimeoutID = setTimeout(() => {
                popup.style.display = 'none';
                this.selectedTower = null;
                this._popupTimeoutID = null;
            }, 300);
        } else {
            this.selectedTower = null;
            this._hideAllPopups();
        }
    }

    _hideAllOverlays() {
        ['towerPopup', 'settingsPopup', 'leaderboardPopup', 'gameOverScreen', 'pauseMenu', 'waterPopup', 'confirmModalOverlay', 'levelSelectScreen', 'levelCompleteScreen', 'mockAdOverlay'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
    }

    _hideAllPopups() {
        ['towerPopup', 'settingsPopup', 'leaderboardPopup'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.style.display = 'none';
                el.classList.remove('popup-open');
            }
        });
    }

    showTowerPopup(tower) {
        if (this._popupTimeoutID) {
            clearTimeout(this._popupTimeoutID);
            this._popupTimeoutID = null;
        }
        let popup = document.getElementById('towerPopup');
        if (!popup) {
            popup = document.createElement('div');
            popup.id = 'towerPopup';
            popup.className = 'tower-popup';
            document.querySelector('.game-container').appendChild(popup);
        }

        const typeName = tower.isCastle ? 'The Castle' : (tower.isPortal ? 'The Portal' : (TOWER_DISPLAY_NAMES[tower.type] || tower.type));
        const cost = tower.getUpgradeCost ? tower.getUpgradeCost() : 0;
        const maxLvl = tower.maxUpgrades !== undefined ? tower.maxUpgrades : 5;
        const canUpgrade = !tower.isPortal && tower.upgradeLevel < maxLvl;

        // Per-tower auto upgrade state
        const autoUpgradeActive = tower.autoUpgrade === true;

        let statsHtml = '';
        if (tower.isCastle) {
            const numCannons = tower.upgradeLevel >= 3 ? 4 : 2;
            const totalDps = ((tower.attackDamage * numCannons) / (GameConfig.Castle.attackSpeed / 1000)).toFixed(1);
            statsHtml = `
                <div class="stat-box"><span>Health</span> <b>${Math.round(tower.health)}</b></div>
                <div class="stat-box"><span>Cannons</span> <b>${numCannons}</b></div>
                <div class="stat-box"><span>Attack</span> <b>${totalDps}dps</b></div>
            `;
        } else if (tower.isPortal) {
            statsHtml = `
                <div class="stat-box"><span>Round</span> <b>${this.gameStateManager.round}</b></div>
                <div class="stat-box"><span>Enemies</span> <b>${this.enemiesPerRound}</b></div>
                <div class="stat-box"><span>Status</span> <b>${this.isCountingDown ? 'Ready' : 'Active'}</b></div>
            `;
        } else if (tower.isUpgrader) {
            const boost = (tower.getBoostMultiplier() || 1.1).toFixed(1);
            const radius = tower.getRangeRadius();
            statsHtml = `
                <div class="stat-box"><span>Dmg Boost</span> <b>${boost}x</b></div>
                <div class="stat-box"><span>Rng Radius</span> <b>${radius} Tile${radius > 1 ? 's' : ''}</b></div>
                <div class="stat-box"><span>Type</span> <b>Aura</b></div>
            `;
        } else if (tower.isTesla) {
            const dps = (tower.shockDamage / (tower.shockInterval / 1000)).toFixed(1);
            statsHtml = `
                <div class="stat-box"><span>Attack</span> <b>${dps}dps</b></div>
                <div class="stat-box"><span>Range</span> <b>${Math.round(tower.range)}</b></div>
                <div class="stat-box"><span>Shock</span> <b>${tower.shockDamage}</b></div>
            `;
        } else if (tower.isFrost) {
            const slowPct = Math.round((1 - tower.slowMult) * 100);
            statsHtml = `
                <div class="stat-box"><span>Slow</span> <b>${slowPct}%</b></div>
                <div class="stat-box"><span>Range</span> <b>${Math.round(tower.range)}</b></div>
                <div class="stat-box"><span>Reload</span> <b>${tower.fireRate}ms</b></div>
            `;
        } else if (tower.isLaser) {
            const dps = (tower.damage / 0.1).toFixed(1); // 100ms interval
            statsHtml = `
                <div class="stat-box"><span>Attack</span> <b>${dps}dps</b></div>
                <div class="stat-box"><span>Bounces</span> <b>50</b></div>
                <button id="autoUpgradeTypeBtn" class="btn-auto ${autoUpgradeActive ? 'active' : ''}">
                    Auto: ${autoUpgradeActive ? 'ON' : 'OFF'}
                </button>
            `;
        } else if (tower.isFlame) {
            const dps = (tower.damage / 0.08).toFixed(1); // 80ms interval
            statsHtml = `
                <div class="stat-box"><span>Attack</span> <b>${dps}dps</b></div>
                <div class="stat-box"><span>Range</span> <b>${Math.round(tower.range)}</b></div>
                <button id="autoUpgradeTypeBtn" class="btn-auto ${autoUpgradeActive ? 'active' : ''}">
                    Auto: ${autoUpgradeActive ? 'ON' : 'OFF'}
                </button>
            `;
        } else if (tower.isMirror) {
            const lossPct = Math.round((tower.damageReduction || 0) * 100);
            const reflectPct = 100 - lossPct;
            statsHtml = `
                <div class="stat-box"><span>Reflect</span> <b>${reflectPct}%</b></div>
                <div class="stat-box"><span>Dmg Loss</span> <b>${lossPct}%</b></div>
                <button id="autoUpgradeTypeBtn" class="btn-auto ${autoUpgradeActive ? 'active' : ''}">
                    Auto: ${autoUpgradeActive ? 'ON' : 'OFF'}
                </button>
            `;
        } else if (tower.isSpike) {
            const damage = tower.getDamage ? tower.getDamage() : 0;
            const dps = (damage / (GameConfig.Spike.damageInterval / 1000)).toFixed(1);
            const slowPct = tower.upgradeLevel >= 3 ? Math.round((1 - GameConfig.Spike.tierSlowMult) * 100) : 0;
            statsHtml = `
                <div class="stat-box"><span>Attack</span> <b>${dps}dps</b></div>
                <div class="stat-box"><span>Slow</span> <b>${slowPct}%</b></div>
                <div class="stat-box"><span>Tick</span> <b>${damage}</b></div>
            `;
        } else if (tower.isLilypad) {
            const damage = GameConfig.Lilypad.damage[Math.min(tower.upgradeLevel, 5)] || 0;
            const dps = (damage / (GameConfig.Lilypad.damageInterval / 1000)).toFixed(1);
            const slowPct = tower.upgradeLevel >= 3 ? Math.round((1 - GameConfig.Lilypad.slowMult) * 100) : 0;
            statsHtml = `
                <div class="stat-box"><span>Attack</span> <b>${dps}dps</b></div>
                <div class="stat-box"><span>Slow</span> <b>${slowPct}%</b></div>
                <div class="stat-box"><span>Tick</span> <b>${damage}</b></div>
            `;
        } else if (tower.isWall) {
            const wallTierNames = ['Wood Fence', 'Red Brick', 'Steel Brick', 'Steel Armor', 'Dark Matter'];
            const tierName = wallTierNames[Math.min(tower.upgradeLevel, 4)] || 'Wall';
            statsHtml = `
                <div class="stat-box"><span>Health</span> <b>${Math.round(tower.health)} / ${tower.maxHealth}</b></div>
                <div class="stat-box"><span>Tier</span> <b>${tierName}</b></div>
                <div class="stat-box"><span>Type</span> <b>Blocker</b></div>
            `;
        } else {
            const dps = tower.getDps ? tower.getDps() : 0;
            statsHtml = `
                <div class="stat-box"><span>Attack</span> <b>${dps}dps</b></div>
                <div class="stat-box"><span>Range</span> <b>${Math.round(tower.range || 0)}</b></div>
                <div class="stat-box"><span>Dmg</span> <b>${tower.damage || 0}</b></div>
            `;
        }

        let arrowRot = 0;
        if (tower.isLaser) arrowRot = (tower.laserDirection / 4) * 360;
        else if (tower.isFlame) arrowRot = (tower.flameDirection / 8) * 360;
        else if (tower.isMirror) arrowRot = (tower.angleIndex === 1) ? 135 : 45;

        let actionHtml = '';
        if (tower.isPortal) {
            actionHtml = this.isCountingDown ? '<button id="nextRoundBtn" class="btn-upgrade btn-full-width">Start Wave</button>' : '<div class="max-upgrade btn-full-width">WAVE ACTIVE</div>';
        } else if (tower.isUpgrader) {
            const dmgCost = tower.getUpgradeCost('dmg');
            const rngCost = tower.getUpgradeCost('range');
            const maxDmg = tower.dmgLevel >= (tower.maxDmgLevel || 5);
            const maxRng = tower.rangeLevel >= (tower.maxRangeLevel || 5);

            const canAffordDmg = !maxDmg && this.gameStateManager.gold >= dmgCost && !tower.isUpgradingRange;
            const canAffordRng = !maxRng && this.gameStateManager.gold >= rngCost && !tower.isUpgradingDmg;

            const dmgL = tower.isUpgradingDmg ? `${Math.floor(tower.upgradeProgress * 100)}%` : (maxDmg ? 'MAX DMG' : `Dmg (${dmgCost}g)`);
            const rngL = tower.isUpgradingRange ? `${Math.floor(tower.upgradeProgress * 100)}%` : (maxRng ? 'MAX RNG' : `Rng (${rngCost}g)`);

            const sellPrice = tower.getSellPrice ? tower.getSellPrice() : 0;
            const repairCost = tower.getRepairCost ? tower.getRepairCost() : 0;
            const canAffordRepair = this.gameStateManager.gold >= repairCost;

            let btn3 = tower.isUpgrading ? '<button id="cancelUpgradeBtn" class="btn-remove">Cancel</button>' : `<button id="removeBtn" class="btn-remove">Sell (${sellPrice}g)</button>`;
            if (tower.health < tower.maxHealth) {
                btn3 = `<button id="repairBtn" class="btn-repair ${!canAffordRepair ? 'disabled' : ''}" ${!canAffordRepair ? 'disabled' : ''}>Repair (${repairCost}g)</button>`;
            }

            actionHtml = `
                <button id="upgradeDmgBtn" class="btn-upgrade ${!canAffordDmg ? 'disabled' : ''}" ${!canAffordDmg ? 'disabled' : ''}>${dmgL}</button>
                <button id="upgradeRangeBtn" class="btn-upgrade ${!canAffordRng ? 'disabled' : ''}" style="background: #2196F3;" ${!canAffordRng ? 'disabled' : ''}>${rngL}</button>
                ${btn3}
            `;
        } else if (tower.isCastle) {
            if (tower.isUpgrading) {
                actionHtml = `
                    <button class="btn-upgrade" disabled style="grid-column: span 2;">Upgrading... ${Math.floor((tower.upgradeProgress || 0) * 100)}%</button>
                    <button id="cancelUpgradeBtn" class="btn-remove">Cancel</button>
                `;
            } else {
                let repairBtn = '';
                let upBtnClass = 'btn-full-width';
                if (tower.health < tower.maxHealth) {
                    repairBtn = `<button id="repairBtn" class="btn-repair">Repair (${tower.getRepairCost()}g)</button>`;
                    upBtnClass = '';
                }
                actionHtml = `
                    <button id="upgradeBtn" class="btn-upgrade ${upBtnClass}" ${!canUpgrade ? 'disabled' : ''} style="${repairBtn ? 'grid-column: span 2;' : ''}">${canUpgrade ? `Upgrade (${cost}g)` : 'MAX LEVEL'}</button>
                    ${repairBtn}
                `;
            }
        } else {
            const sellPrice = tower.getSellPrice ? tower.getSellPrice() : 0;
            const upgradeLabel = tower.isUpgrading ? `${Math.floor(tower.upgradeProgress * 100)}%` : (canUpgrade ? `Upgrade (${cost}g)` : 'MAX LEVEL');
            const upgradeBtn = `<button id="upgradeBtn" class="btn-upgrade ${!canUpgrade ? 'max-level' : ''}" ${tower.isUpgrading || !canUpgrade ? 'disabled' : ''}>${upgradeLabel}</button>`;
            const sellBtn = `<button id="removeBtn" class="btn-remove">Sell (${sellPrice}g)</button>`;

            let middleBtn = '';
            if (tower.isUpgrading) {
                middleBtn = '<button id="cancelUpgradeBtn" class="btn-remove">Cancel</button>';
            } else if (tower.health < tower.maxHealth) {
                middleBtn = `<button id="repairBtn" class="btn-repair">Repair (${tower.getRepairCost()}g)</button>`;
            } else if (tower.isLaser || tower.isFlame || tower.isMirror) {
                const iconClass = tower.isMirror ? 'rotate-line' : 'rotate-arrow';
                const inner = tower.isMirror ? '' : '➔';
                middleBtn = `<button id="rotateBtn" class="btn-rotate"><span class="${iconClass}" style="transform: rotate(${arrowRot}deg)">${inner}</span></button>`;
            } else {
                middleBtn = `<button id="autoUpgradeTypeBtn" class="btn-auto ${autoUpgradeActive ? 'active' : ''}">Auto: ${autoUpgradeActive ? 'ON' : 'OFF'}</button>`;
            }

            actionHtml = `
                ${upgradeBtn}
                ${middleBtn}
                ${sellBtn}
            `;
        }

        const lvlTag = tower.isPortal ? '' : (tower.isUpgrader ? ` Lv ${tower.dmgLevel + 1}` : (!canUpgrade ? ` Lv ${tower.upgradeLevel + 1} (MAX)` : ` Lv ${tower.upgradeLevel + 1}`));

        popup.innerHTML = `
            <div class="popup-header">
                <span>${typeName}${lvlTag}</span>
                ${(tower.isCastle || tower.isPortal) ? '' : `<span class="kill-count">Kills: ${tower.killCount || 0}</span>`}
            </div>
            <div class="popup-grid">
                ${statsHtml}
                ${actionHtml}
            </div>
            <button class="close-popup" id="closePopupBtn">✕</button>
        `;

        popup.style.display = 'flex';
        popup.offsetHeight;
        popup.classList.remove('popup-closing');
        popup.classList.add('popup-open');

        // Event Listeners
        const nextBtn = document.getElementById('nextRoundBtn');
        if (nextBtn) {
            nextBtn.onclick = () => {
                this.stopCountdown();
                this.deselectTower();
            };
        }

        const upDmgBtn = document.getElementById('upgradeDmgBtn');
        if (upDmgBtn) {
            const refresh = () => {
                if (!this.selectedTower || this.selectedTower !== tower) return;
                if (tower.isUpgradingDmg) {
                    const pct = Math.floor(tower.upgradeProgress * 100);
                    upDmgBtn.textContent = `Upgrading... ${pct}%`;
                    upDmgBtn.disabled = true;
                    requestAnimationFrame(refresh);
                } else if (this._lastDmgLv !== tower.dmgLevel) {
                    this._lastDmgLv = tower.dmgLevel;
                    this.showTowerPopup(tower);
                }
            };
            this._lastDmgLv = tower.dmgLevel;
            if (tower.isUpgradingDmg) refresh();

            upDmgBtn.onclick = () => {
                if (tower.isUpgrading) return;
                const cost = tower.getUpgradeCost('dmg');
                if (this.gameStateManager.gold < cost) {
                    this.setBlockedMessage("Not enough gold!", this.canvas.width/2, this.canvas.height - 100);
                    return;
                }
                if (tower.startUpgrade('dmg')) {
                    this.gameStateManager.spendGold(cost);
                    refresh();
                }
            };
        }

        const upRangeBtn = document.getElementById('upgradeRangeBtn');
        if (upRangeBtn) {
            const refresh = () => {
                if (!this.selectedTower || this.selectedTower !== tower) return;
                if (tower.isUpgradingRange) {
                    const pct = Math.floor(tower.upgradeProgress * 100);
                    upRangeBtn.textContent = `Upgrading... ${pct}%`;
                    upRangeBtn.disabled = true;
                    requestAnimationFrame(refresh);
                } else if (this._lastRangeLv !== tower.rangeLevel) {
                    this._lastRangeLv = tower.rangeLevel;
                    this.showTowerPopup(tower);
                }
            };
            this._lastRangeLv = tower.rangeLevel;
            if (tower.isUpgradingRange) refresh();

            upRangeBtn.onclick = () => {
                if (tower.isUpgrading) return;
                const cost = tower.getUpgradeCost('range');
                if (this.gameStateManager.gold < cost) {
                    this.setBlockedMessage("Not enough gold!", this.canvas.width/2, this.canvas.height - 100);
                    return;
                }
                if (tower.startUpgrade('range')) {
                    this.gameStateManager.spendGold(cost);
                    refresh();
                }
            };
        }

        const upBtn = document.getElementById('upgradeBtn');
        if (upBtn) {
            const refreshBtn = () => {
                if (!this.selectedTower || this.selectedTower !== tower) return;
                const currentCost = tower.getUpgradeCost ? tower.getUpgradeCost() : 0;
                const maxAllowedLvl = tower.maxUpgrades !== undefined ? tower.maxUpgrades : 5;
                const canUp = !tower.isPortal && tower.upgradeLevel < maxAllowedLvl;

                if (!canUp) {
                    upBtn.disabled = true;
                    upBtn.classList.add('disabled', 'max-level');
                    upBtn.textContent = 'MAX LEVEL';
                } else if (tower.isUpgrading) {
                    upBtn.disabled = true;
                    const pct = Math.floor((tower.upgradeProgress || 0) * 100);
                    upBtn.textContent = `Upgrading... ${pct}%`;
                    requestAnimationFrame(refreshBtn);
                } else {
                    upBtn.disabled = this.gameStateManager.gold < currentCost;
                    upBtn.textContent = `Upgrade (${currentCost}g)`;
                    // If it just finished upgrading, refresh the whole panel once to update stats/Lv
                    if (this._lastLvSeen !== tower.upgradeLevel) {
                        this._lastLvSeen = tower.upgradeLevel;
                        this.showTowerPopup(tower);
                    }
                }
            };
            this._lastLvSeen = tower.upgradeLevel;
            if (tower.isUpgrading) refreshBtn();

            upBtn.onclick = () => {
                const maxAllowedLvl = tower.maxUpgrades !== undefined ? tower.maxUpgrades : 5;
                if (tower.isUpgrading || tower.upgradeLevel >= maxAllowedLvl) return;
                if (this.gameStateManager.gold < cost) {
                    this.setBlockedMessage("Not enough gold!", this.canvas.width/2, this.canvas.height - 100);
                    return;
                }
                const started = tower.startUpgrade ? tower.startUpgrade() : false;
                if (started) {
                    this.gameStateManager.spendGold(cost);
                    this.updateLaserPaths();
                    this._entitiesDirty = true;
                    refreshBtn();
                } else if (!tower.startUpgrade) {
                    if (this.gameStateManager.spendGold(cost)) {
                        tower.upgrade ? tower.upgrade() : (tower.upgradeLevel++);
                        if (tower.recalcStats) tower.recalcStats();
                        this.updateLaserPaths();
                        this.showTowerPopup(tower);
                        if (this.soundManager) this.soundManager.playUpgradeComplete();
                    }
                }
            };
        }

        const autoBtn = document.getElementById('autoUpgradeTypeBtn');
        if (autoBtn) autoBtn.onclick = () => {
            tower.autoUpgrade = !tower.autoUpgrade;
            this.showTowerPopup(tower);
            if (this.soundManager) this.soundManager.playButtonClick();
        };

        const rotBtn = document.getElementById('rotateBtn');
        if (rotBtn) rotBtn.onclick = () => {
            if (tower.rotate) tower.rotate();

            this.updateLaserPaths();
            this.showTowerPopup(tower); // Refresh UI to show new state
            if (this.soundManager) this.soundManager.playButtonClick();
        };

        const repairBtn = document.getElementById('repairBtn');
        if (repairBtn) {
            repairBtn.onclick = () => {
                if (tower.repair) tower.repair(this.gameStateManager);
                if (this.soundManager) this.soundManager.playButtonClick();
            };
        }

        const cancelUpgradeBtn = document.getElementById('cancelUpgradeBtn');
        if (cancelUpgradeBtn) {
            cancelUpgradeBtn.onclick = () => {
                let cost = tower.getUpgradeCost ? tower.getUpgradeCost() : 0;
                if (tower.isUpgrader) {
                    if (tower.isUpgradingDmg) cost = tower.getUpgradeCost('dmg');
                    else if (tower.isUpgradingRange) cost = tower.getUpgradeCost('range');
                }
                if (tower.cancelUpgrade && tower.cancelUpgrade()) {
                    if (cost > 0) this.gameStateManager.addGold(cost);
                    if (window.logManager) {
                        window.logManager.log(`↩ Canceled upgrade for ${getLogId(tower.type)} (+${cost}g)`, "TOWERS");
                    }
                }
                if (this.soundManager) this.soundManager.playButtonClick();
            };
        }

        const remBtn = document.getElementById('removeBtn');
        if (remBtn) remBtn.onclick = () => {
            const sellPrice = tower.getSellPrice ? tower.getSellPrice() : 0;
            if (sellPrice > 0) {
                this.gameStateManager.addGold(sellPrice);
                if (window.logManager) {
                    window.logManager.log(`💰 Sold ${getLogId(tower.type)} (+${sellPrice}g)`, "TOWERS");
                }
            }
            const tile = this.gridSystem.getTileAtPosition(tower.x, tower.y);
            if (tile) {
                tile.occupied = false;
                tile.reserved = false;
                tile.isWall = false;
            }
            this.towers = this.towers.filter(t => t !== tower);
            this.walls = this.walls.filter(w => w !== tower);
            this.spikes = this.spikes.filter(s => s !== tower);
            this.mirrors = this.mirrors.filter(m => m !== tower);
            if (tower.isLilypad) this.gridSystem.removeLilypad(tile);
            this.Lilypads = this.Lilypads.filter(l => l !== tower);
            this._entitiesDirty = true;
            this.deselectTower();
            this.updateEnemyPaths();
            this.updateLaserPaths();
            if (this.soundManager) this.soundManager.playButtonClick();
        };

        const closeBtn = document.getElementById('closePopupBtn');
        if (closeBtn) closeBtn.onclick = () => this.deselectTower();

        this.updateActivePopupAffordability();
    }

    updateActivePopupAffordability() {
        if (!this.selectedTower) return;
        const tower = this.selectedTower;

        const btn = document.getElementById('upgradeBtn');
        if (btn) {
            const maxAllowedLvl = tower.maxUpgrades !== undefined ? tower.maxUpgrades : 5;
            const canUp = !tower.isPortal && tower.upgradeLevel < maxAllowedLvl;

            if (!canUp) {
                btn.disabled = true;
                btn.classList.add('disabled', 'max-level');
                btn.textContent = 'MAX LEVEL';
            } else {
                const cost = tower.getUpgradeCost ? tower.getUpgradeCost() : 0;
                const canAfford = this.gameStateManager.gold >= cost && !tower.isUpgrading;
                btn.disabled = !canAfford;
                btn.classList.toggle('disabled', !canAfford);
                btn.classList.remove('max-level');
                // GDD: Refresh button text if it was showing a progress bar that is now finished
                if (!tower.isPortal && !tower.isUpgrading && !btn.textContent.includes('Upgrade')) {
                    btn.textContent = `Upgrade (${cost}g)`;
                }
            }
        }

        const upDmgBtn = document.getElementById('upgradeDmgBtn');
        if (upDmgBtn && tower.isUpgrader) {
            const cost = tower.getUpgradeCost('dmg');
            const maxDmg = tower.dmgLevel >= (tower.maxDmgLevel || 5);
            const canAfford = !maxDmg && this.gameStateManager.gold >= cost && !tower.isUpgradingRange;
            upDmgBtn.disabled = !canAfford;
            upDmgBtn.classList.toggle('disabled', !canAfford);
        }

        const upRangeBtn = document.getElementById('upgradeRangeBtn');
        if (upRangeBtn && tower.isUpgrader) {
            const cost = tower.getUpgradeCost('range');
            const maxRng = tower.rangeLevel >= (tower.maxRangeLevel || 5);
            const canAfford = !maxRng && this.gameStateManager.gold >= cost && !tower.isUpgradingDmg;
            upRangeBtn.disabled = !canAfford;
            upRangeBtn.classList.toggle('disabled', !canAfford);
        }

        const repairBtn = document.getElementById('repairBtn');
        if (repairBtn && tower.getRepairCost) {
            const repairCost = tower.getRepairCost();
            const canAffordRepair = this.gameStateManager.gold >= repairCost;
            repairBtn.disabled = !canAffordRepair;
            repairBtn.classList.toggle('disabled', !canAffordRepair);
        }
    }

    startIntermission() {
        if (this.gameStateManager.round > 0) {
            // Reward 30g for finishing the previous round BEFORE the intermission countdown starts
            this.gameStateManager.addGold(30);

            // BalanceAnalytics: Evaluate completed round performance & adjust difficulty
            if (window.balanceAnalytics) {
                window.balanceAnalytics.evaluateRound(this);
            }

            // World 1 Level Completion: Round 10 is the final boss round of the level
            if (this.gameStateManager.round === 10) {
                this.completeLevelVictory();
                return;
            }
        }
        const justFinished = this.gameStateManager.round;
        let inter = 2;
        /*AUTOBAL_INTER_START*/
        const autobalInter = {15:8, 16:2, 17:2, 18:6, 19:6, 20:8, 25:8};
        if ((this.selectedLevel || 1) === 10 && justFinished <= 3) inter = 10;
        else if (autobalInter[this.selectedLevel || 1] != null) inter = autobalInter[this.selectedLevel || 1];
            /*AUTOBAL_INTER_END*/
        this.startCountdown(inter, () => this.startNextRound());
    }

    completeLevelVictory() {
        this.gameStateManager.isPlaying = false;
        if (this._rafId) cancelAnimationFrame(this._rafId);

        const remainingGold = this.gameStateManager.gold;
        const earnedGold = this.waterEnabled ? remainingGold * 2 : remainingGold;

        this._pendingVictoryGold = earnedGold;
        this._pendingVictoryLevel = this.selectedLevel || 1;

        // Unlock next level immediately upon beating the round!
        const currentLvl = this._pendingVictoryLevel;
        const maxUnlocked = parseInt(localStorage.getItem('td_max_level') || 1);
        if (currentLvl >= maxUnlocked && currentLvl < 25) {
            localStorage.setItem('td_max_level', currentLvl + 1);
        }

        this._hideAllOverlays();
        const screen = document.getElementById('levelCompleteScreen');
        if (screen) {
            const titleEl = document.getElementById('levelCompleteTitle');
            const goldEl = document.getElementById('levelCompleteGold');
            const waterEl = document.getElementById('levelCompleteWaterNotice');

            if (titleEl) titleEl.textContent = `Level ${currentLvl} Complete!`;
            if (goldEl) goldEl.textContent = earnedGold;
            const timeEl = document.getElementById('levelCompleteTime');
            if (timeEl) timeEl.textContent = this._formatTime(Math.floor(this.realTimeSurvived || 0));
            if (waterEl) waterEl.style.display = this.waterEnabled ? 'block' : 'none';

            const doubleBtn = document.getElementById('doubleRewardsBtn');
            if (doubleBtn) { doubleBtn.style.display = 'none'; doubleBtn.setAttribute('hidden', ''); }

            screen.style.display = 'flex';
            document.body.classList.add('modal-open');
        }

        this.updateGlobalGoldDisplay();
    }

    updateGlobalGoldDisplay() {
        const globalGold = parseInt(localStorage.getItem('td_global_gold') || 0);
        const els = document.querySelectorAll('#globalGoldDisplay');
        els.forEach(el => { el.textContent = globalGold; });
    }

    startNextRound() {
        if (this.gameStateManager.round > 0) {
            if (this.castle) this.castleHpAtRoundStart = this.castle.health;
        }
        this.gameStateManager.nextRound();
        this.enemiesSpawnedInRound = 0;
        this.enemiesKilledInRound = 0;

        const countMult = window.balanceAnalytics ? window.balanceAnalytics.getEnemyCountMultiplier() : 1.0;
        const currentLvl = this.selectedLevel || 1;
        this.enemyQueue = this.getRoundComposition(currentLvl, this.gameStateManager.round, countMult);
        this.enemiesPerRound = this.enemyQueue.length;

        // Accelerated Spawn Rate: decrease interval each round
        const initialInt = GameConfig.Spawning.initialInterval;
        const minInt = GameConfig.Spawning.minimumInterval;
        const decrease = GameConfig.Spawning.intervalDecrease;
        this.spawnInterval = Math.max(minInt, initialInt - (this.gameStateManager.round - 1) * decrease);

        this.spawnTimer = 9999;

        if (window.balanceAnalytics) {
            window.balanceAnalytics.onRoundStart(this);
        }

        if (this.portal) {
            this.portal.isActive = true;
            const isBossRound = this.gameStateManager.round % 10 === 0;
            if (isBossRound) {
                this.portal.primaryColor = '#FF4444'; // Boss Red
                this.portal.secondaryColor = '#8B0000';
            } else {
                this.portal.primaryColor = '#9932CC'; // Amethyst
                this.portal.secondaryColor = '#BA55D3';
            }
        }

        // GDD: Speed multiplier affects intermission too, but countdown is handled in startCountdown
    }

    getTotalRoundsForLevel(lvl) {
        return 10; // Placeholder: 10 rounds per level
    }

    getRoundComposition(levelOrRound, roundOrCountMult, maybeCountMult = 1.0) {
        let level = 1;
        let round = 1;
        let countMult = 1.0;

        if (arguments.length >= 3 || (typeof roundOrCountMult === 'number' && maybeCountMult !== undefined)) {
            level = levelOrRound || 1;
            round = roundOrCountMult || 1;
            countMult = maybeCountMult || 1.0;
        } else {
            level = this.selectedLevel || 1;
            round = levelOrRound || 1;
            countMult = roundOrCountMult || 1.0;
        }

        const totalRounds = 10;
        const isBossRound = (round === totalRounds);

        let types = ['normy'];
        if (level === 1) {
            types = ['normy'];
        } else if (level === 2) {
            types = ['speedy'];
        } else if (level === 3) {
            types = ['splitter'];
        } else if (level === 4) {
            types = ['groupie'];
        } else if (level === 5) {
            types = ['tank'];
        } else if (level === 6) {
            types = ['flyer'];
        } else if (level === 7) {
            types = ['breaker'];
        } else if (level === 8) {
            types = ['groupie', 'splitter'];
        } else if (level === 9) {
            types = ['tank', 'speedy'];
        } else if (level === 10) {
            // L10: flyers only in R1-R3 so a delayed opening AA is not aura-deleted before a sniper is up.
            // Breakers join from R4.
            types = (round <= 3) ? ['flyer'] : ['flyer', 'breaker'];
        } else if (level === 11) {
            // L11: flyers-only R1-R3 (hand-pace opening); tanks join from R4 (no aura, path-hug flame is safe).
            types = (round <= 3) ? ['flyer'] : ['tank', 'flyer'];
        } else if (level === 12) {
            // L12: flyers-only R1-R3; groupie+tank+flyer from R4 so a right-aiming laser can cut packed ground lines.
            types = (round <= 3) ? ['flyer'] : ['groupie', 'tank', 'flyer'];
        } else if (level === 13) {
            // L13: flyers-only R1-R3; groupie+tank+flyer from R4 (mirror extends the L12 laser line).
            types = (round <= 3) ? ['flyer'] : ['groupie', 'tank', 'flyer'];
        } else if (level === 14) {
            // L14: same groupie+tank+flyer mix as L13 (pre-boss toolkit exam). Good plan buys castle L2 from R9.
            types = (round <= 3) ? ['flyer'] : ['groupie', 'tank', 'flyer'];
        } else if (level === 15) {
            // L15 boss: flyers R1-R5; breaker+flyer R6-R8 (aura exam); speedies join from R9.
            types = (round <= 5) ? ['flyer'] : (round <= 8) ? ['breaker', 'flyer'] : ['breaker', 'speedy', 'flyer'];
        } else if (level === 16) {
            // L16: post-boss recovery. Flyers R1-R3; groupie+tank+flyer from R4.
            types = (round <= 3) ? ['flyer'] : ['groupie', 'tank', 'flyer'];

        } else if (level === 17) {
            // L17: splitters join the L16 mix. Flyers R1-R3.
            types = (round <= 3) ? ['flyer'] : ['splitter', 'groupie', 'tank', 'flyer'];

        } else if (level === 18) {
            // L18: aura returns, no speedies. Flyers R1-R4; breaker+groupie+flyer from R5.
            types = (round <= 4) ? ['flyer'] : ['breaker', 'groupie', 'flyer'];

        } else if (level === 19) {
            // L19: pre-L20 exam. Flyers R1-R4; breaker+speedy+flyer from R5.
            types = (round <= 4) ? ['flyer'] : ['breaker', 'speedy', 'flyer'];

        } else if (level === 20) {
            // L20 boss: flyers R1-R5; breaker+flyer R6-R8; speedies from R9.
            types = (round <= 5) ? ['flyer'] : (round <= 8) ? ['breaker', 'flyer'] : ['breaker', 'speedy', 'flyer'];
        } else if (level === 25) {
            // L25 finale: flyers R1-R5; breaker+tank+flyer R6-R8; speedies+groupies from R9.
            types = (round <= 5) ? ['flyer'] : (round <= 8) ? ['breaker', 'tank', 'flyer'] : ['breaker', 'speedy', 'groupie', 'flyer'];
        } else {
            types = ['normy'];
        }

        const countProgression = [6, 10, 16, 24, 34, 46, 60, 78, 100, 130];
        const l10Counts = [6, 10, 16, 20, 30, 40, 54, 70, 100, 130]; // L10: slightly lighter R4-R8 (first breaker rounds)
        const l15Counts = [6, 10, 16, 24, 34, 18, 26, 32, 32, 24]; // L15 boss: light R6-R8 aura waves; R9-R10 add speedies, R10 all-bosses
        const l16Counts = [6, 10, 16, 28, 40, 56, 74, 96, 108, 128]; // autobal L16
        const l19Counts = [6, 10, 16, 24, 34, 28, 36, 44, 36, 29]; // autobal L19
        const l18Counts = [6, 10, 16, 24, 34, 40, 52, 28, 28, 35]; // autobal L18
        const l17Counts = [6, 10, 16, 24, 34, 46, 60, 54, 53, 69]; // autobal L17
        const l25Counts = [6, 10, 16, 24, 34, 22, 30, 40, 40, 32]; // autobal L25
        const l20Counts = [6, 10, 16, 24, 34, 20, 28, 36, 36, 28]; // autobal L20
        /*AUTOBAL_COUNT_PICK*/
        const autobalCounts = {10:l10Counts, 15:l15Counts, 16:l16Counts, 17: (typeof l17Counts!=='undefined'?l17Counts:null), 18: (typeof l18Counts!=='undefined'?l18Counts:null), 19: (typeof l19Counts!=='undefined'?l19Counts:null), 20: (typeof l20Counts!=='undefined'?l20Counts:null), 21: (typeof l21Counts!=='undefined'?l21Counts:null), 22: (typeof l22Counts!=='undefined'?l22Counts:null), 23: (typeof l23Counts!=='undefined'?l23Counts:null), 24: (typeof l24Counts!=='undefined'?l24Counts:null), 25: (typeof l25Counts!=='undefined'?l25Counts:null)};
        const countCurve = autobalCounts[level] || countProgression;
        const count = Math.round(countCurve[Math.min(9, round - 1)] * countMult);

        const pool = [];
        for (let i = 0; i < count; i++) {
            pool.push({ type: types[Math.floor(Math.random() * types.length)], isBoss: false });
        }

        // GDD §9: Each non-boss round has 1 boss among them
        if (!isBossRound && pool.length > 0) {
            pool[Math.floor(Math.random() * pool.length)].isBoss = true;
        } else if (isBossRound) {
            // In a boss round, they are all tough, but one is the "Super Boss"
            pool.forEach(e => e.isBoss = true);
        }

        pool.sort((a, b) => a.type.localeCompare(b.type));

        const result = [];
        const buckets = {};
        pool.forEach(e => {
            if (!buckets[e.type]) buckets[e.type] = [];
            buckets[e.type].push(e);
        });

        const keys = Object.keys(buckets);
        // L10: flyers (fast, straight) arrive first so AA can work; slower breakers follow.
        if (level >= 10 && level <= 25) keys.sort((a, b) => (a === 'flyer' ? 0 : 1) - (b === 'flyer' ? 0 : 1));
        let safety = 0;
        while (result.length < count && safety++ < 1000) {
            let addedThisPass = false;
            for (let i = 0; i < keys.length; i++) {
                const k = keys[i];
                if (buckets[k].length > 0) {
                    result.push(buckets[k].shift());
                    addedThisPass = true;
                }
            }
            if (!addedThisPass) break;
        }
        return result;
    }

    startCountdown(seconds, onComplete) {
        if (this._countdownTimer) clearInterval(this._countdownTimer);

        this.isCountingDown = true;
        let remainingMs = seconds * 1000;
        const el = document.getElementById('roundCountdown');
        if (el) { el.style.display = 'block'; el.textContent = seconds; }

        this._countdownOnComplete = onComplete;
        const updateInterval = 100; // Check every 100ms for more precision with speed mult
        this._countdownTimer = setInterval(() => {
            if (this.gameStateManager.isPaused) return;

            remainingMs -= updateInterval * this.speedMultiplier;
            const displaySecs = Math.ceil(remainingMs / 1000);

            if (el) el.textContent = Math.max(0, displaySecs);

            if (remainingMs <= 0) {
                this.stopCountdown();
            }
        }, updateInterval);
    }

    clearCountdown() {
        if (this._countdownTimer) {
            clearInterval(this._countdownTimer);
            this._countdownTimer = null;
        }
        this.isCountingDown = false;
        this._countdownOnComplete = null;
        const el = document.getElementById('roundCountdown');
        if (el) el.style.display = 'none';
    }

    stopCountdown() {
        if (this._countdownTimer) {
            clearInterval(this._countdownTimer);
            this._countdownTimer = null;
        }
        this.isCountingDown = false;
        const el = document.getElementById('roundCountdown');
        if (el) { el.style.display = 'none'; if (this.soundManager) this.soundManager.playRoundStart(); }
        if (this._countdownOnComplete) {
            const fn = this._countdownOnComplete;
            this._countdownOnComplete = null;
            fn();
        }
    }

    spawnEnemy() {
        if (!this.enemyQueue || this.enemyQueue.length === 0) return;

        const toSpawn = [];
        const first = this.enemyQueue.shift();
        toSpawn.push(first);

        // Groupie logic: Pull ALL groupies from the queue to spawn them simultaneously
        if (first.type === 'groupie') {
            for (let i = this.enemyQueue.length - 1; i >= 0; i--) {
                if (this.enemyQueue[i].type === 'groupie') {
                    toSpawn.push(this.enemyQueue.splice(i, 1)[0]);
                }
            }
        }

        const count = toSpawn.length;
        this._spawnRollingCount += count;

        toSpawn.forEach((eData, index) => {
            const type = eData.type;
            const isBoss = eData.isBoss;
            const isBreaker = (type === 'breaker');

            const spec = type === 'flyer' ? 'fly' : (type === 'crocodile' ? 'swim' : 'normal');
            // Ground units (including Breakers) find the "Low Turn" straight physical path
            const path = this.gridSystem.getCenterPath(this.towers, spec, this.walls, true);
            const enemy = Enemy.create(type, path, this);

            if (window.logManager) {
                window.logManager.log(`+ ${count > 1 ? count + 'x ' : ''}${getLogId(type)}${isBoss ? '*' : ''}`, "ENEMY");
            }

            // Slightly spread them out so they don't look like 1 enemy
            if (count > 1) {
                const angle = (index / count) * Math.PI * 2;
                const spread = 15 + Math.random() * 5;
                enemy.x += Math.cos(angle) * spread;
                enemy.y += Math.sin(angle) * spread;
            }

            const round = this.gameStateManager.round;
            const hpMult = GameConfig.Difficulty.enemyHpMult || 1.0;
            const level = this.selectedLevel || 1;

            // 1.6x exponential HP scaling for Flyer/Level 6, 1.15x for Breaker/Level 7
            let levelHpBonus = Math.min(10, round);
            if (level === 1) {
                levelHpBonus = 1 + (round - 1) * 0.5; // Final middle-ground linear growth for Level 1 equilibrium
            } else if (level === 3) {
                levelHpBonus = 1 + (round - 1) * 0.2; // Gentler 20% linear growth for Level 3 Splitters
            } else if (level === 5) {
                levelHpBonus = 1 + (round - 1) * 0.2; // Gentler 20% linear growth for Level 5 Tanks
            } else if (level === 10) {
                levelHpBonus = Math.pow(type === 'flyer' ? 1.35 : 1.15, round - 1); // L10 flyer+breaker mix
            } else if (level === 11) {
                levelHpBonus = Math.pow(type === 'flyer' ? 1.3 : 1.2, round - 1); // L11 flyer+tank, flame
            } else if (level === 12) {
                levelHpBonus = Math.pow(type === 'flyer' ? 1.3 : 1.2, round - 1); // L12 flyer+groupie+tank, laser
            } else if (level === 13) {
                levelHpBonus = Math.pow(type === 'flyer' ? 1.3 : 1.2, round - 1); // L13 flyer+splitter+groupie, mirror
            } else if (level === 14) {
                // Breakers stay on the shallower 1.15 curve (aura is the threat); flyers/groupies 1.3/1.2.
                levelHpBonus = Math.pow(type === 'flyer' ? 1.3 : (type === 'breaker' ? 1.15 : 1.2), round - 1);
            } else if (level === 15) {
                // L15 boss: breaker 1.15 (aura is the threat), speedy 1.1, flyer 1.3.
                levelHpBonus = Math.pow(type === 'flyer' ? 1.3 : (type === 'breaker' ? 1.15 : (type === 'speedy' ? 1.1 : 1.2)), round - 1);



            } else if (level === 20) {
                // L20 boss: breaker 1.15, speedy 1.1, flyer 1.3
                levelHpBonus = Math.pow(type === 'flyer' ? 1.3 : (type === 'breaker' ? 1.15 : (type === 'speedy' ? 1.1 : 1.2)), round - 1);
            } else if (level === 25) {
                // L25 finale: breaker 1.15, speedy 1.1, flyer 1.3, else 1.2
                levelHpBonus = Math.pow(type === 'flyer' ? 1.3 : (type === 'breaker' ? 1.15 : (type === 'speedy' ? 1.1 : 1.2)), round - 1);
            } else if (level === 16) {
                // L16: flyer 1.3, ground 1.2
                levelHpBonus = Math.pow(type === 'flyer' ? 1.3 : 1.2, round - 1);
            } else if (level === 17) {
                // L17: flyer 1.3, ground 1.2
                levelHpBonus = Math.pow(type === 'flyer' ? 1.3 : 1.2, round - 1);
            } else if (level === 18) {
                // L18: breaker 1.15 (aura is the threat), flyer 1.3, else 1.2
                levelHpBonus = Math.pow(type === 'flyer' ? 1.3 : (type === 'breaker' ? 1.15 : 1.2), round - 1);
            } else if (level === 19) {
                // L19: breaker 1.15, speedy 1.1, flyer 1.3
                levelHpBonus = Math.pow(type === 'flyer' ? 1.3 : (type === 'breaker' ? 1.15 : (type === 'speedy' ? 1.1 : 1.2)), round - 1);
            } else if (level === 6 || type === 'flyer') {
                levelHpBonus = Math.pow(1.6, round - 1);
            } else if (level === 7 || type === 'breaker') {
                levelHpBonus = Math.pow(1.15, round - 1);
            } else if (level === 9) {
                levelHpBonus = Math.pow(1.25, round - 1); // Increased from 1.15 to account for lower base HP
            } else if (level === 8) {
                levelHpBonus = Math.pow(1.1, round - 1);
            } else if (level === 2 || type === 'speedy') {
                levelHpBonus = Math.pow(1.1, round - 1);
            }

            const roundHpScale = 1.0;
            const adaptiveHpMult = window.balanceAnalytics ? window.balanceAnalytics.getHpMultiplier() : 1.0;

            // Calculate total health multiplier (accounting for level progression, world difficulty, and adaptive balancing)
            const totalHpMult = hpMult * roundHpScale * levelHpBonus * adaptiveHpMult * (isBoss ? 2.0 : 1.0);
            enemy.maxHealth = Math.round(enemy.maxHealth * totalHpMult);
            enemy.health = enemy.maxHealth;

            // GDD §9c: Dynamic Size Scaling (Concave Asymptotic Growth)
            // Enemies grow as they get tougher, but scaling slows down and caps.
            // Formula: sizeMult = 1 + (maxMult - 1) * (1 - 1 / totalHpMult^power)
            let maxSizeCap = 2.0;
            let scalePower = 0.4;
            if (type === 'breaker') {
                // Exception for Breakers: Cap at 3 tiles wide (192px / 40px base = 4.8x cap)
                maxSizeCap = 4.8;
                scalePower = 0.15; // Breakers scale slower than rest of enemies
            }
            const dynamicSizeMult = 1 + (maxSizeCap - 1) * (1 - 1 / Math.pow(totalHpMult, scalePower));
            enemy.size *= dynamicSizeMult;

            if (level === 2 || type === 'speedy') {
                enemy.speed = enemy.speed * Math.pow(1.1, round - 1);
            } else {
                enemy.speed *= Math.min(1.5, 1 + (round - 1) * 0.02);
            }
            // L11: slightly faster tanks so slow-turning cannons struggle; flame cones still connect.
            if (level === 11 && type === 'tank') {
                enemy.speed *= 1.7;
            }

            // GDD §9: Apply Boss Traits
            if (isBoss) {
                enemy.isBoss = true;
                // enemy.size increase is now handled by the dynamic formula above (which factors in the Boss 2x HP bonus)
                enemy.damage *= 2.0;    // 2x Damage
                enemy.reward *= 4.0;    // 4x Reward

                // Special traits based on type
                if (type === 'speedy' || type === 'flyer') {
                    enemy.speed *= 1.3; // 30% faster
                } else if (type === 'crocodile') {
                    // Croc boss is a "Giant Croc" instantly
                    enemy.isGiantCroc = true;
                }
            }

            enemy.health = enemy.maxHealth;
            this.enemies.push(enemy);
            this.enemiesSpawnedInRound++;

            if (window.balanceAnalytics) {
                window.balanceAnalytics.onEnemySpawn(enemy, this.gameTime * 1000);
            }
        });

        this._entitiesDirty = true;
    }

    setupPortal() {
        const col = Math.floor(Math.random() * GameConfig.Grid.columns); this.gridSystem.portalCol = col;
        const tile = this.gridSystem.tiles[0][col]; this.portal = new Portal(tile.x + GameConfig.Grid.tileSize/2, tile.y + GameConfig.Grid.tileSize/2);
        tile.reserved = true;
        // tile.occupied must remain false to allow enemies to spawn and walk out
    }

    setupCastle(tile) {
        const ts = GameConfig.Grid.tileSize;
        // Position at the intersection of 4 tiles (center of 2x2)
        this.castle = new Castle(tile.x + ts, tile.y + ts);
        this.castle._scene = this;

        // Reserve 2x2 area
        for (let dr = 0; dr < 2; dr++) {
            for (let dc = 0; dc < 2; dc++) {
                const r = tile.row + dr, c = tile.col + dc;
                if (this.gridSystem.tiles[r] && this.gridSystem.tiles[r][c]) {
                    this.gridSystem.tiles[r][c].reserved = true;
                }
            }
        }

        this.gridSystem.castleRow = tile.row; // Track top-left row for pathfinding end
        this.gridSystem.castleCol = tile.col; // Track top-left col
        this.updateTowerButtonAffordability(this.gameStateManager.gold);
        this.updateLaserPaths();
    }

    updateTowerButtonAffordability(gold) { BUILD_BUTTONS.forEach(b => { const el = document.getElementById(b.id); if (el) el.classList.toggle('disabled', gold < b.cost); }); }

    updateTowerCooldownVisuals() {
        if (!this.buildCooldowns) return;
        const currentMs = this.gameTime * 1000;

        BUILD_BUTTONS.forEach(({ id, type, cooldown = 1500 }) => {
            const canvas = document.querySelector(`#${id} .tower-icon-canvas`);
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            const cdEnd = this.buildCooldowns[type] || 0;

            if (currentMs < cdEnd) {
                const remaining = cdEnd - currentMs;
                const elapsed = cooldown - remaining;
                const progress = Math.max(0, Math.min(1.0, elapsed / cooldown)); // 0.0 up to 1.0 (filling progress)

                // Redraw base cached icon
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                if (this.towerIconCache && this.towerIconCache[type]) {
                    ctx.drawImage(this.towerIconCache[type], 0, 0, canvas.width, canvas.height);
                }

                // Darken canvas slightly
                ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                // Draw loading progress ring (clockwise arc around center)
                const cx = canvas.width / 2;
                const cy = canvas.height / 2;
                const ringRadius = canvas.width * 0.38;

                // Outer dark track ring
                ctx.save();
                ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
                ctx.lineWidth = 4;
                ctx.beginPath();
                ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
                ctx.stroke();

                // Bright cyan progress ring arc
                ctx.strokeStyle = '#00E5FF';
                ctx.lineWidth = 4;
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.arc(cx, cy, ringRadius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
                ctx.stroke();
                ctx.restore();

                canvas._wasOnCooldown = true;
            } else if (canvas._wasOnCooldown) {
                // Cooldown just finished — restore crisp clean cached icon once
                canvas._wasOnCooldown = false;
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                if (this.towerIconCache && this.towerIconCache[type]) {
                    ctx.drawImage(this.towerIconCache[type], 0, 0, canvas.width, canvas.height);
                }
            }
        });
    }

    updateBuildButtonLabels() {
        const currentLvl = this.selectedLevel || 1;
        const unlockedFor = (lvl) => {
            if (lvl === 1) return ['cannon', 'wall'];
            if (lvl === 2) return ['cannon', 'frost', 'wall'];
            if (lvl === 3) return ['cannon', 'frost', 'wall', 'machinegun'];
            if (lvl === 4) return ['cannon', 'frost', 'wall', 'machinegun', 'mortar'];
            if (lvl === 5) return ['cannon', 'frost', 'wall', 'machinegun', 'mortar', 'upgrader'];
            if (lvl === 6) return ['cannon', 'frost', 'wall', 'machinegun', 'mortar', 'upgrader', 'aa'];
            if (lvl === 7) return ['cannon', 'frost', 'wall', 'machinegun', 'mortar', 'upgrader', 'aa', 'sniper'];
            if (lvl === 8 || lvl === 9) return ['cannon', 'frost', 'wall', 'machinegun', 'mortar', 'upgrader', 'aa', 'sniper', 'spike'];
            if (lvl === 10) return ['cannon', 'frost', 'wall', 'machinegun', 'mortar', 'upgrader', 'aa', 'sniper', 'spike', 'tesla'];
            if (lvl === 11) return ['cannon', 'frost', 'wall', 'machinegun', 'mortar', 'upgrader', 'aa', 'sniper', 'spike', 'tesla', 'flame'];
            if (lvl === 12) return ['cannon', 'frost', 'wall', 'machinegun', 'mortar', 'upgrader', 'aa', 'sniper', 'spike', 'tesla', 'flame', 'laser'];
            if (lvl >= 13 && lvl <= 25) return ['cannon', 'frost', 'wall', 'machinegun', 'mortar', 'upgrader', 'aa', 'sniper', 'spike', 'tesla', 'flame', 'laser', 'mirror'];
            return null;
        };

        const unlocked = unlockedFor(currentLvl);
        BUILD_BUTTONS.forEach(b => {
            const el = document.getElementById(b.id); if (!el) return;
            const wrap = el.parentElement;
            wrap.style.gridColumn = '';
            wrap.style.gridRow = '';
            let show;
            if (unlocked) {
                show = unlocked.includes(b.type);
            } else {
                show = (b.type === 'lilypad') ? !!this.waterEnabled : true;
            }
            wrap.style.display = show ? 'flex' : 'none';
            const p = wrap.querySelector('.tower-price'); if (p) p.textContent = b.cost + 'g';
        });
        this._layoutArsenal();
    }

    _layoutArsenal() {
        const controlsEl = document.querySelector('.controls');
        if (!controlsEl) return;

        if (!this._arsenalResizeBound) {
            this._arsenalResizeBound = () => this._layoutArsenal();
            window.addEventListener('resize', this._arsenalResizeBound);
            if (window.visualViewport) {
                window.visualViewport.addEventListener('resize', this._arsenalResizeBound);
            }
        }

        const unlockOrder = ['cannon', 'frost', 'wall', 'machinegun', 'mortar', 'upgrader', 'aa', 'sniper', 'spike', 'tesla', 'flame', 'laser', 'mirror', 'lilypad'];
        const wraps = Array.from(controlsEl.querySelectorAll('.tower-btn-wrap'));
        wraps.forEach(w => {
            const btn = w.querySelector('button');
            const def = btn ? BUILD_BUTTONS.find(b => b.id === btn.id) : null;
            const idx = def ? unlockOrder.indexOf(def.type) : 99;
            w.style.order = String(idx < 0 ? 99 : idx);
            w.style.gridColumn = '';
            w.style.gridRow = '';
        });

        const visible = wraps.filter(w => w.style.display !== 'none');
        const n = visible.length;
        const width = controlsEl.clientWidth || (controlsEl.parentElement && controlsEl.parentElement.clientWidth) || 280;
        const gapX = 2;
        const comfortable = 48;
        const minCell = 36;
        const maxFit = (cell) => Math.max(1, Math.floor((width + gapX) / (cell + gapX)));
        const maxComfortable = maxFit(comfortable);
        const maxMin = maxFit(minCell);

        let perRow;
        if (n <= 0) perRow = 6;
        else if (n <= maxComfortable) perRow = n; // one centered row when every tower fits at a comfortable size
        else if (n <= 12) perRow = Math.min(6, maxMin); // phones: ~6 per row, newest wraps under
        else perRow = maxMin >= 7 ? 7 : Math.min(6, maxMin); // 13–14 towers stay on two rows when 7 fit

        controlsEl.style.display = 'flex';
        controlsEl.style.flexWrap = 'wrap';
        controlsEl.style.justifyContent = 'center';
        controlsEl.style.alignItems = 'center';
        controlsEl.style.alignContent = 'center';
        controlsEl.style.gridTemplateColumns = '';
        controlsEl.style.gridTemplateRows = '';
        controlsEl.style.gap = '4px ' + gapX + 'px';

        const applyBasis = (count, px) => {
            const basis = (px != null)
                ? (px + 'px')
                : 'calc((100% - ' + ((count - 1) * gapX) + 'px) / ' + count + ')';
            wraps.forEach(w => {
                w.style.flex = '0 0 ' + basis;
                w.style.maxWidth = basis;
                w.style.width = basis;
                w.style.boxSizing = 'border-box';
            });
        };

        if (n > 0 && n <= maxComfortable) {
            const cell = Math.min(64, Math.max(minCell, Math.floor((width - (n - 1) * gapX) / n)));
            applyBasis(n, cell);
        } else {
            applyBasis(perRow, null);
        }

        const rows = n ? Math.ceil(n / perRow) : 1;
        controlsEl.classList.toggle('has-two-rows', rows === 2);
        controlsEl.classList.toggle('has-three-rows', rows >= 3);
    }

    applyUITextures() {
        const tm = window.textureManager;
        const btns = ['pauseBtn', 'playBtn', 'resumeBtn', 'restartBtn', 'settingsBtn'];
        btns.forEach(id => {
            const el = document.getElementById(id), img = tm.getImage('UI/buttons', id.replace('Btn', ''));
            if (el && img) { el.style.backgroundImage = `url(${img.src})`; el.style.backgroundSize = 'contain'; el.style.backgroundRepeat = 'no-repeat'; el.style.backgroundPosition = 'center'; el.textContent = ''; }
        });
    }

    _updateWaterPopupSelection() {
        const on = document.getElementById('waterOnBtn'), off = document.getElementById('waterOffBtn');
        if (on && off) {
            on.classList.toggle('selected', this._menuPendingWater);
            off.classList.toggle('selected', !this._menuPendingWater);
        }

        // Show Preview
        if (this.gridSystem) {
            this.gridSystem.createGrid();
            this.setupPortal();
            this._entitiesDirty = true;
            if (this._menuPendingWater) {
                this.gridSystem.generateWater(GameConfig.Difficulty.waterPercent || 15);
            }
            this.render();
        }
    }
    _updateSoundSettingsUI() {
        const sfx = document.getElementById('sfxToggleBtn');
        const mus = document.getElementById('musicToggleBtn');
        const vib = document.getElementById('vibrateToggleBtn');
        if (sfx) sfx.textContent = `SFX: ${this.soundManager.sfxEnabled ? 'On' : 'Off'}`;
        if (mus) mus.textContent = `Music: ${this.soundManager.musicEnabled ? 'On' : 'Off'}`;
        if (vib) vib.textContent = `Vibration: ${this.soundManager.vibrationEnabled ? 'On' : 'Off'}`;
    }
    _applyStoredSoundPreference() {
        this.soundManager.sfxEnabled = localStorage.getItem('td_sfx_enabled') !== 'false';
        this.soundManager.musicEnabled = localStorage.getItem('td_music_enabled') !== 'false';
        this.soundManager.vibrationEnabled = localStorage.getItem('td_vibrate_enabled') !== 'false';
    }
    openSettingsMenu() {
        this.deselectTower();
        this._updateSoundSettingsUI();
        document.getElementById('settingsPopup').style.display = 'flex';
    }
    closeSettingsMenu() { document.getElementById('settingsPopup').style.display = 'none'; }
    initWebFirebase() {
        if (typeof firebase !== 'undefined' && !this._firebaseWebInit) {
            try {
                const firebaseConfig = {
                    apiKey: "AIzaSyD_p7_ypHcSG1TVjIoglSw6hwwXPSue1Do",
                    authDomain: "castle-defense-cuh.firebaseapp.com",
                    databaseURL: "https://castle-defense-cuh-default-rtdb.firebaseio.com",
                    projectId: "castle-defense-cuh",
                    storageBucket: "castle-defense-cuh.firebasestorage.app",
                    appId: "1:278473810690:web:castledefense"
                };
                if (!firebase.apps.length) {
                    firebase.initializeApp(firebaseConfig);
                }
                firebase.auth().signInAnonymously().catch(err => {
                    console.warn("Firebase Web Auth:", err);
                });
                this._firebaseWebInit = true;
            } catch (e) {
                console.warn("Firebase Web Init error:", e);
            }
        }
    }

    openLeaderboard() {
        this.deselectTower();
        const popup = document.getElementById('leaderboardPopup');
        if (popup) popup.style.display = 'flex';

        const list = document.getElementById('leaderboardList');
        if (list) {
            list.innerHTML = '<div style="padding:20px; text-align:center; color:#aaa;">Loading rankings...</div>';
        }

        let localScores = [];
        try {
            const stored = localStorage.getItem('td_web_leaderboard');
            if (stored) localScores = JSON.parse(stored);
        } catch (e) {}

        if (typeof Android !== 'undefined' && Android.fetchGlobalScores) {
            Android.fetchGlobalScores();
        } else if (typeof firebase !== 'undefined' && firebase.database) {
            this.initWebFirebase();
            firebase.database().ref("leaderboard").orderByChild("rounds").limitToLast(50).once("value", snapshot => {
                const scores = [];
                snapshot.forEach(child => {
                    const val = child.val();
                    if (val) {
                        scores.push({
                            player: val.player || "Anonymous",
                            rounds: Number(val.rounds || 1),
                            seconds: Number(val.seconds || 0)
                        });
                    }
                });
                const merged = this._mergeScores(scores, localScores);
                if (window.onScoresFetched) window.onScoresFetched(merged);
            }, err => {
                console.warn("Firebase Web Fetch Error:", err);
                if (window.onScoresFetched) window.onScoresFetched(localScores);
            });
        } else {
            if (window.onScoresFetched) window.onScoresFetched(localScores);
        }
    }

    _mergeScores(remoteScores, localScores) {
        const map = new Map();
        [...remoteScores, ...localScores].forEach(s => {
            if (!s || !s.player) return;
            const key = `${s.player}_${s.rounds}_${s.seconds}`;
            if (!map.has(key)) map.set(key, s);
        });
        return Array.from(map.values());
    }

    _fetchLocalStorageScores() {
        setTimeout(() => {
            let localScores = [];
            try {
                const stored = localStorage.getItem('td_web_leaderboard');
                if (stored) localScores = JSON.parse(stored);
            } catch (e) {}

            if (!localScores || localScores.length === 0) {
                localScores = [
                    { player: "Castle Guard", rounds: 15, seconds: 620 },
                    { player: "Local Hero", rounds: 12, seconds: 450 },
                    { player: "Defender", rounds: 8, seconds: 300 }
                ];
            }

            if (window.onScoresFetched) window.onScoresFetched(localScores);
        }, 200);
    }

    closeLeaderboard() { document.getElementById('leaderboardPopup').style.display = 'none'; }

    async openLogViewer(filter = 'all') {
        const viewer = document.getElementById('logViewerPopup');
        const content = document.getElementById('logContentArea');
        if (!viewer || !content || !window.logManager) return;

        viewer.style.display = 'flex';

        const logText = await window.logManager.getLogContent(filter);
        content.textContent = logText;

        // Auto-scroll to bottom
        content.scrollTop = content.scrollHeight;
    }

    closeLogViewer() {
        document.getElementById('logViewerPopup').style.display = 'none';
    }

    copyLogToClipboard() {
        const content = document.getElementById('logContentArea');
        if (!content) return;

        const text = content.textContent;
        navigator.clipboard.writeText(text).then(() => {
            if (this.soundManager) this.soundManager.playButtonClick();
            this.setBlockedMessage("Log Copied!", this.canvas.width / 2, this.canvas.height / 2);
        }).catch(err => {
            console.error('Copy failed', err);
            // Fallback for older browsers or insecure contexts
            const textArea = document.createElement("textarea");
            textArea.value = text;
            document.body.appendChild(textArea);
            textArea.select();
            try {
                document.execCommand('copy');
                this.setBlockedMessage("Log Copied!", this.canvas.width / 2, this.canvas.height / 2);
            } catch (e) {}
            document.body.removeChild(textArea);
        });
    }

    updateEnemyPaths() {
        this.enemies.forEach(e => { e.needsPathUpdate = true; });
        this.walls.forEach(w => { w._linksDirty = true; });
        this._urgentRepath = true;
    }
    updateLaserPaths() { this.towers.forEach(t => { if (t.isLaser) t._laserPathDirty = true; }); }

    _formatTime(s) { return `${Math.floor(s/60)}:${(s%60).toString().padStart(2, '0')}`; }
    setSfxEnabled(en) {
        this.soundManager.sfxEnabled = en;
        localStorage.setItem('td_sfx_enabled', en);
        this._updateSoundSettingsUI();
    }
    setMusicEnabled(en) {
        this.soundManager.musicEnabled = en;
        localStorage.setItem('td_music_enabled', en);
        en ? this.soundManager.playRandomMusic() : this.soundManager.stopMusic();
        this._updateSoundSettingsUI();
    }
    setVibrationEnabled(en) {
        this.soundManager.vibrationEnabled = en;
        localStorage.setItem('td_vibrate_enabled', en);
        this._updateSoundSettingsUI();
    }
    toggleFastForward() {
        if (this.speedMultiplier === 1) this.speedMultiplier = 2;
        else if (this.speedMultiplier === 2) this.speedMultiplier = 4;
        else if (this.speedMultiplier === 4) this.speedMultiplier = 8;
        else this.speedMultiplier = 1;

        const btn = document.getElementById('ffBtn');
        if (btn) {
            btn.textContent = this.speedMultiplier === 1 ? '▶▶' : (this.speedMultiplier + 'x');
            btn.classList.toggle('active', this.speedMultiplier > 1);
        }
        if (this.soundManager) this.soundManager.playSpeedChange(this.speedMultiplier);
    }

    resetFastForward() {
        this.speedMultiplier = 1;
        const btn = document.getElementById('ffBtn');
        if (btn) {
            btn.textContent = '▶▶';
            btn.classList.remove('active');
        }
    }

    toggleAutoUpgrade() {
        this.autoUpgrade = !this.autoUpgrade;
        const btn = document.getElementById('upgradeAllHudBtn');
        if (btn) btn.classList.toggle('active', this.autoUpgrade);
    }
    setupLeaderboardCallbacks() {
        window.onScoresFetched = (scores) => {
            const list = document.getElementById('leaderboardList');
            if (!list) return;

            if (!scores || !Array.isArray(scores) || scores.length === 0) {
                list.innerHTML = '<div style="padding:20px; text-align:center; color:#aaa;">No records yet. Be the first!</div>';
                return;
            }

            // Safe numeric sort: rounds desc, then seconds desc
            scores.sort((a, b) => (Number(b.rounds || 0) - Number(a.rounds || 0)) || (Number(b.seconds || 0) - Number(a.seconds || 0)));

            list.innerHTML = scores.map((s, i) => `
                <div class="leaderboard-entry">
                    <div class="leaderboard-rank">#${i + 1}</div>
                    <div class="leaderboard-name">${s.player || 'Anonymous'}</div>
                    <div class="leaderboard-score">
                        <b>Round ${s.rounds || 1}</b>
                        <span>${this._formatTime(s.seconds || 0)}</span>
                    </div>
                </div>
            `).join('');
        };

        window.onScoresFetchError = (msg) => {
            const list = document.getElementById('leaderboardList');
            if (list) list.innerHTML = `<div style="padding:20px; text-align:center; color:#f44336;">Failed to load: ${msg}</div>`;
        };

        window.onScoreSubmitSuccess = () => {
            if (typeof Android !== 'undefined') Android.showToast("Score submitted successfully!");
            this.openLeaderboard(); // Refresh
        };

        window.onScoreSubmitError = (msg) => {
            if (typeof Android !== 'undefined') Android.showToast("Error: " + msg);
        };
    }
    setupThemes() {}
    togglePause() {
        this.deselectTower();
        this.gameStateManager.isPaused = !this.gameStateManager.isPaused;
        document.getElementById('pauseMenu').style.display = this.gameStateManager.isPaused ? 'flex' : 'none';

        if (!this.gameStateManager.isPaused) {
            this.lastTime = performance.now();
            if (!this._rafId) this.gameLoop();
        }
    }
    resume() {
        this.gameStateManager.isPaused = false;
        document.getElementById('pauseMenu').style.display = 'none';
        this.lastTime = performance.now();
        if (!this._rafId) this.gameLoop();
    }
    saveGame() {
        if (!this.castle) return;
        const data = {
            gold: this.gameStateManager.gold,
            round: this.gameStateManager.round,
            score: this.gameStateManager.score,
            castleHealth: this.gameStateManager.castleHealth,
            waterEnabled: this.waterEnabled,
            placementUpgrades: this.gameStateManager.placementUpgrades,
            realTimeSurvived: this.realTimeSurvived,
            castle: { row: this.gridSystem.castleRow, col: this.gridSystem.castleCol },
            entities: [
                ...this.towers.map(t => ({ type: t.type, x: t.x, y: t.y, lvl: t.upgradeLevel })),
                ...this.walls.map(w => ({ type: 'wall', x: w.x, y: w.y, col: w.col, row: w.row, lvl: w.upgradeLevel })),
                ...this.spikes.map(s => ({ type: 'spike', x: s.x, y: s.y, lvl: s.upgradeLevel })),
                ...this.mirrors.map(m => ({ type: 'mirror', x: m.x, y: m.y, angle: m.angle })),
                ...this.Lilypads.map(l => ({ type: 'lilypad', x: l.x, y: l.y, lvl: l.upgradeLevel }))
            ]
        };
        localStorage.setItem('td_saved_game', JSON.stringify(data));
        GameLogger.info("Game auto-saved.");
    }
    loadGame() {
        const json = localStorage.getItem('td_saved_game');
        if (!json) { this.start(); return; }

        try {
            const data = JSON.parse(json);
            this.start(); // Reset everything first

            // Overwrite state
            this.gameStateManager.gold = data.gold;
            this.gameStateManager.round = data.round;
            this.gameStateManager.score = data.score;
            this.gameStateManager.castleHealth = data.castleHealth;
            this.waterEnabled = data.waterEnabled;
            this.gameStateManager.placementUpgrades = data.placementUpgrades || {};
            this.realTimeSurvived = data.realTimeSurvived || 0;

            // Restore Castle
            const cTile = this.gridSystem.tiles[data.castle.row][data.castle.col];
            if (cTile) {
                this.setupCastle(cTile);
                this.castle.health = data.castleHealth;
                this.placementMode = false;
            }

            // Restore Entities
            data.entities.forEach(ent => {
                const tile = this.gridSystem.getTileAtPosition(ent.x, ent.y);
                if (!tile) return;

                this.selectedTowerType = ent.type;
                this.handleTileClick(ent.x, ent.y);

                // Find the newly created entity and set its level
                const list = (ent.type === 'wall') ? this.walls :
                             (ent.type === 'spike') ? this.spikes :
                             (ent.type === 'mirror') ? this.mirrors :
                             (ent.type === 'lilypad') ? this.Lilypads : this.towers;

                const created = list[list.length - 1];
                if (created && created.isLilypad) {
                    this.gridSystem.addLilypad(tile, created);
                }
                if (created && ent.lvl !== undefined) {
                    created.upgradeLevel = ent.lvl;
                    if (created.recalcStats) created.recalcStats();
                }
                if (created && ent.angle !== undefined) {
                    created.angle = ent.angle;
                }
            });

            this.selectedTowerType = null;
            this.gameStateManager.notify('goldChanged', this.gameStateManager.gold);
            this.gameStateManager.notify('roundChanged', this.gameStateManager.round);
            this.gameStateManager.notify('castleHealthChanged', this.gameStateManager.castleHealth);

            document.getElementById('mainMenu').style.display = 'none';
        } catch (e) {
            GameLogger.error("Failed to load game: " + e);
            this.start();
        }
    }
    restart() {
        this.start();
        GameLogger.info("Game Restarted (Immediate)");
    }
    showMainMenu() {
        const mm = document.getElementById('mainMenu');
        if (mm) mm.style.display = 'flex';

        const globalBadge = document.querySelector('.global-gold-badge');
        if (globalBadge) globalBadge.style.display = 'flex';

        this.updateGlobalGoldDisplay();

        // Statically render the custom 3-tower castle icon
        this.renderMainMenuCastleIcon();

        // Start background music as soon as Main Menu is started/shown
        if (this.soundManager && this.soundManager.musicEnabled) {
            this.soundManager.playRandomMusic();

            // Continuous check for browser autoplay unlocking
            if (!this._mainMenuMusicInterval) {
                this._mainMenuMusicInterval = setInterval(() => {
                    const menu = document.getElementById('mainMenu');
                    if (menu && menu.style.display !== 'none' && this.soundManager.musicEnabled) {
                        if (!this.soundManager.bgMusicAudio || this.soundManager.bgMusicAudio.paused) {
                            // If paused due to autoplay policy, attempt to play (will succeed immediately upon user interaction)
                            this.soundManager.playRandomMusic();
                        }
                    } else if (menu && menu.style.display === 'none') {
                        clearInterval(this._mainMenuMusicInterval);
                        this._mainMenuMusicInterval = null;
                    }
                }, 500); // Check frequently so it starts instantly on interaction
            }
        }
    }

    quitToMainMenu() {
        GameLogger.info("Returning to Main Menu...");
        this.gameStateManager.isPlaying = false;
        this.gameStateManager.isPaused = false;
        this._hideAllOverlays();
        this.showMainMenu();
        // Stop the game loop if it's running
        if (this._rafId) cancelAnimationFrame(this._rafId);
    }
    selectTowerType(t) {
        if (this.selectedTowerType === t) this.selectedTowerType = null;
        else {
            const def = BUILD_BUTTONS.find(b => b.type === t);
            if (def && this.gameStateManager.gold < def.cost) { this.setBlockedMessage("Not enough gold!", this.canvas.width / 2, this.canvas.height - 100); return; }
            this.selectedTowerType = t; this.deselectTower();
        }
        BUILD_BUTTONS.forEach(b => { const el = document.getElementById(b.id); if (el) el.classList.toggle('selected', b.type === this.selectedTowerType); });
    }

    showGameOver() {
        GameLogger.info("Entering showGameOver()");
        this.deselectTower();
        if (this.soundManager) this.soundManager.fadeOutMusic(1500, true);
        const screen = document.getElementById('gameOverScreen');
        if (!screen) return;
        document.body.classList.add('modal-open');

        const best = parseInt(localStorage.getItem('td_personal_best') || 0);
        const current = Math.floor(this.realTimeSurvived) + (this.gameStateManager.round - 1) * 100;

        if (current > best) {
            localStorage.setItem('td_personal_best', current);
            localStorage.setItem('td_personal_best_rounds', this.gameStateManager.round);
            const msg = document.getElementById('newHighScoreMsg');
            if (msg) { msg.style.display = 'block'; setTimeout(() => msg.style.display = 'none', 3000); }
        }

        const scoreEl = document.getElementById('finalScore');
        if (scoreEl) scoreEl.textContent = this._formatTime(Math.floor(this.realTimeSurvived));

        const roundsEl = document.getElementById('finalRounds');
        if (roundsEl) roundsEl.textContent = this.gameStateManager.round;

        const bestDisplay = document.getElementById('highScoreDisplay');
        if (bestDisplay) {
            const bScore = Math.max(best, current);
            const bRounds = localStorage.getItem('td_personal_best_rounds') || this.gameStateManager.round;
            bestDisplay.textContent = `${this._formatTime(bScore)} (Round ${bRounds})`;
        }

        const nameInput = document.getElementById('playerNameInput');
        if (nameInput) {
            nameInput.value = '';
            nameInput.placeholder = "Your Name";
            nameInput.classList.remove('input-error');
            nameInput.onfocus = function() { this.select(); };
        }

        const reviveBtn = document.getElementById('reviveAdBtn');
        if (reviveBtn) {
            // Web build: no rewarded ads, never show or grant a revive.
            reviveBtn.style.display = 'none';
            reviveBtn.setAttribute('hidden', '');
            reviveBtn.onclick = null;
        }

        const area = document.getElementById('scoreSubmissionArea');
        if (area) area.style.display = 'flex';
        const post = document.getElementById('postSubmissionArea');
        if (post) post.style.display = 'none';

        screen.style.display = 'flex';
    }

    openBugReport() {
        this.deselectTower();
        const overlay = document.getElementById('bugModalOverlay');
        if (!overlay) { GameLogger.warn('openBugReport: #bugModalOverlay not found in DOM'); return; }
        overlay.style.display = 'flex';

        const cancelBtn = document.getElementById('cancelBugBtn');
        if (cancelBtn) cancelBtn.onclick = () => overlay.style.display = 'none';

        const submitBtn = document.getElementById('submitBugBtn');
        if (submitBtn) submitBtn.onclick = () => this._submitBug();
    }

    _getReportContext(type, message) {
        const gsm = this.gameStateManager || {};
        const rawRound = gsm.round || 0;
        const inLevel = !!(this.selectedLevel || this.placementMode || this.isCountingDown || gsm.isPlaying);
        const round = rawRound > 0 ? rawRound : (inLevel ? 1 : 0);
        const level = this.selectedLevel || 0;
        const castleHp = this.castle ? Math.round(this.castle.health) : Math.round(gsm.castleHealth || 0);
        const platform = (typeof Android !== 'undefined') ? 'android' : 'web';
        const version = (typeof CDC_VERSION !== 'undefined' && CDC_VERSION) ? CDC_VERSION : (platform === 'android' ? '1.2' : '5.10');
        const isCrash = (type === 'CRASH' || type === 'AUTO_CRASH');
        const subject = isCrash
            ? ('CDC CRASH – L' + (level || '?'))
            : ('CDC Player Report – L' + (level || '?'));
        const vv = window.visualViewport;
        const payload = {
            message: message || '',
            _subject: subject,
            type: type,
            level: level,
            round: round,
            gold: gsm.gold,
            score: gsm.score,
            castleHp: castleHp,
            screen: window.innerWidth + 'x' + window.innerHeight,
            viewport: vv ? (Math.round(vv.width) + 'x' + Math.round(vv.height)) : (window.innerWidth + 'x' + window.innerHeight),
            platform: platform,
            version: version,
            time: new Date().toISOString(),
            device: navigator.userAgent
        };
        return payload;
    }

    _sendFeedback(payload) {
        if (typeof window.cdcSendFeedback === 'function') {
            window.cdcSendFeedback(payload);
            return;
        }
        if (typeof Android !== 'undefined' && Android.submitFeedback) {
            Android.submitFeedback(JSON.stringify(payload));
            return;
        }
        fetch("https://formspree.io/f/mkjwjbog", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify(payload)
        }).then(res => {
            GameLogger.info("Web bug report sent to Formspree (Status " + res.status + ")");
        }).catch(err => {
            GameLogger.warn("Web bug report fetch failed: " + err);
        });
    }

    _submitBug() {
        const overlay = document.getElementById('bugModalOverlay');
        const msg = document.getElementById('bugMessage');
        const loader = document.getElementById('bugLoader');
        if (!msg || !msg.value.trim()) return;

        if (loader) loader.style.display = 'flex';

        const payload = this._getReportContext('USER_REPORT', msg.value.trim());
        this._sendFeedback(payload);
        GameLogger.info('Bug report submitted (' + payload.platform + ').');

        setTimeout(() => {
            if (loader) loader.style.display = 'none';
            if (overlay) overlay.style.display = 'none';
            msg.value = '';
        }, 1500);
    }

    autoSubmitError(errorMsg) {
        if (typeof window.cdcReportCrash === 'function') {
            window.cdcReportCrash('AUTO_CRASH', errorMsg);
            return;
        }
        if (window._cdcCrashSent) return;
        window._cdcCrashSent = true;
        this._sendFeedback(this._getReportContext('AUTO_CRASH', errorMsg));
    }

    submitGlobalScore() {
        const nameInput = document.getElementById('playerNameInput');
        const typedName = nameInput ? nameInput.value.trim() : '';

        // Validation: If empty, turn input red and vibrate phone
        if (!typedName) {
            if (nameInput) {
                nameInput.classList.add('input-error');
                nameInput.focus();
                setTimeout(() => nameInput.classList.remove('input-error'), 2000);
            }
            if (typeof Android !== 'undefined') {
                Android.vibrate(200);
            } else if (navigator.vibrate) {
                navigator.vibrate(200);
            }
            if (this.soundManager) {
                this.soundManager.playCastlePlacement(true); // Error feedback tone
            }
            return; // Block submission!
        }

        localStorage.setItem('td_player_name', typedName);
        const playerName = typedName;

        const rounds = Math.max(1, this.gameStateManager.round || 1);
        const seconds = Math.max(1, Math.floor(this.realTimeSurvived || 0));

        // GDD §2: Sync keys with WebAppInterface.kt
        const payload = {
            player: playerName,
            rounds_completed: rounds,
            seconds: seconds
        };

        // Always save a local copy immediately so user score appears on leaderboard
        this._saveLocalStorageScore(payload, rounds, seconds);

        if (typeof Android !== 'undefined' && Android.submitGlobalScore) {
            Android.submitGlobalScore(JSON.stringify(payload));
        } else if (typeof firebase !== 'undefined' && firebase.database) {
            this.initWebFirebase();
            const user = firebase.auth().currentUser;
            const uid = user ? user.uid : ("web_" + Date.now());

            firebase.database().ref("leaderboard/" + uid).set({
                player: payload.player,
                rounds: rounds,
                seconds: seconds,
                timestamp: firebase.database.ServerValue.TIMESTAMP
            }).then(() => {
                if (window.onScoreSubmitSuccess) window.onScoreSubmitSuccess();
            }).catch(err => {
                console.warn("Firebase Web Submit Error:", err);
                if (window.onScoreSubmitSuccess) window.onScoreSubmitSuccess();
            });
        } else {
            setTimeout(() => {
                if (window.onScoreSubmitSuccess) window.onScoreSubmitSuccess();
            }, 250);
        }

        const area = document.getElementById('scoreSubmissionArea');
        if (area) area.style.display = 'none';
        const post = document.getElementById('postSubmissionArea');
        if (post) post.style.display = 'flex';
    }

    _saveLocalStorageScore(payload, rounds, seconds) {
        try {
            let localScores = [];
            const stored = localStorage.getItem('td_web_leaderboard');
            if (stored) localScores = JSON.parse(stored);

            const exists = localScores.some(s => s.player === payload.player && Number(s.rounds) === Number(rounds) && Number(s.seconds) === Number(seconds));
            if (!exists) {
                localScores.unshift({ player: payload.player, rounds: Number(rounds), seconds: Number(seconds), timestamp: Date.now() });
                localStorage.setItem('td_web_leaderboard', JSON.stringify(localScores));
            }
        } catch (e) {}
    }

    setBlockedMessage(msg, x, y) { this.blockedPathMessage = msg; this.blockedPathMessageAlpha = 2.0; this.blockedPathMessageX = x; this.blockedPathMessageY = y; this.blockedPathMessageOffset = 0; }

    setupTowerIcons() {
        this.towerIconCache = {};
        const iconConfigs = [
            { type: 'wall',     class: WallTower },
            { type: 'machinegun',   class: MachineGunTower },
            { type: 'spike',    class: SpikeTrap },
            { type: 'mirror',   class: MirrorTower },
            { type: 'lilypad', class: LilypadTower },
            { type: 'cannon',     class: CannonTower },
            { type: 'sniper',   class: SniperTower },
            { type: 'aa',       class: AAGunTower },
            { type: 'mortar',   class: MortarTower },
            { type: 'tesla',    class: TeslaTower },
            { type: 'upgrader', class: UpgraderTower },
            { type: 'frost',    class: FrostTower },
            { type: 'laser',    class: LaserTower },
            { type: 'flame',    class: FlameTower }
        ];

        iconConfigs.forEach(cfg => {
            this.towerIconCache[cfg.type] = this.captureIconFromEntity(cfg.type, cfg.class);
        });

        BUILD_BUTTONS.forEach(({ id, type }) => {
            const canvas = document.querySelector(`#${id} .tower-icon-canvas`);
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            if (this.towerIconCache[type]) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(this.towerIconCache[type], 0, 0, canvas.width, canvas.height);
            }
        });
    }

    captureIconFromEntity(type, ClassRef) {
        const offscreen = document.createElement('canvas');
        offscreen.width = 100; offscreen.height = 100;
        const ctx = offscreen.getContext('2d');

        try {
            // Create a dummy instance at (0,0) with enough arguments for all entity types
            // Args: (x, y, col/startLevel, row, startLevel)
            const dummy = new ClassRef(0, 0, 0, 0, 0);
            dummy.isBuilt = true;
            dummy.upgradeLevel = 0;
            dummy.buildProgress = 1.0; // GDD: Ensure icon is fully visible

            // Standardize size for the icon
            const ts = GameConfig.Grid.tileSize || 64;
            dummy.size = ts;

            ctx.save();
            ctx.translate(50, 50); // Move center of canvas to (50,50)
            const scale = 100 / ts; // 100% scale so the tower image matches the bubble size 1:1
            ctx.scale(scale, scale);

            if (dummy.isWall) {
                dummy.render(ctx, []);
            } else {
                if (dummy.renderBase) dummy.renderBase(ctx, 0);
                else if (dummy.render) dummy.render(ctx, 0);
                if (dummy.renderTop) dummy.renderTop(ctx, 0);
            }
            ctx.restore();
        } catch (e) {
            GameLogger.error(`Failed to capture icon for ${type}: ${e}`);
        }

        return offscreen;
    }

    renderMainMenuEnemyRow() {
        const canvas = document.getElementById('mainMenuEnemyRowCanvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // 1:1 Aspect Ratio Normalization
        const parentW = canvas.parentElement ? canvas.parentElement.clientWidth : 480;
        const parentH = canvas.parentElement ? canvas.parentElement.clientHeight : 80; // Expanded to 80px CSS height to prevent clipping

        // Wait until CSS layout has actually computed dimensions
        if (parentW === 0 || parentH === 0) return;

        if (canvas.width !== parentW) canvas.width = parentW;
        if (canvas.height !== parentH) canvas.height = parentH;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Wait for textures to fully load before starting the cinematic sequence
        // This guarantees no invisible animations play in the background!
        const testImg = window.textureManager.getImage('enemies', 'normy');
        if (!testImg || !testImg.complete || testImg.naturalWidth === 0) {
            return; // Abort drawing until textures are actually loaded
        }

        // Initialize Dummies
        if (!this._menuEnemyDummies) {
            const types = ['normy', 'groupie', 'speedy', 'tank', 'crocodile', 'flyer', 'splitter', 'breaker'];
            this._menuEnemyDummies = types.map(type => {
                const e = Enemy.create(type, [{x:0, y:0}], this);
                e.health = 100;
                e.maxHealth = 100;
                e.isBoss = false;
                e.size = (type === 'tank') ? 32 : ((type === 'groupie') ? 22 : 26);
                return e;
            });
        }

        const now = performance.now();

        // Start the clock ONLY when we are finally rendering the first frame
        if (!this._menuIntroState.started) {
            this._menuIntroState.started = true;
            this._menuIntroState.startTime = now;
            this._menuIntroState.lastFrameTime = now;
            this._menuIntroState.animAccumulator = 0;
        }

        // Calculate time progress
        const elapsed = now - this._menuIntroState.startTime;
        const deltaMs = Math.min(now - this._menuIntroState.lastFrameTime, 100);
        this._menuIntroState.lastFrameTime = now;

        const duration = 2000; // Exactly 2.0 seconds
        let t = elapsed / duration;
        if (t > 1.0) t = 1.0;

        // Smooth ease-out physics (quadratic deceleration)
        const easeOut = t * (2 - t);

        // Time dilation factor (Slows down to exactly 0 at t=1.0)
        const timeScale = 1.0 - t;

        // Accumulate internal animations (walk, spin) affected by time dilation
        this._menuIntroState.animAccumulator += deltaMs * timeScale;
        const animTime = this._menuIntroState.animAccumulator;

        // Start above screen (-40px) -> End peeking in view (30px)
        const startY = -40;
        const targetY = 30;
        const currentY = startY + (targetY - startY) * easeOut;

        const count = this._menuEnemyDummies.length;
        const step = canvas.width / count;
        const castleTargetY = 250; // Approximated position of castle relative to this canvas

        this._menuEnemyDummies.forEach((enemy, i) => {
            const cx = (i + 0.5) * step;
            const cy = currentY;

            // Target / Orientation = Castle position
            const targetX = canvas.width / 2;
            const angleToCenter = Math.atan2(castleTargetY - cy, targetX - cx);

            enemy.facingAngle = angleToCenter;

            // Animation phases slow down and freeze completely!
            enemy.walkPhase = animTime * 0.015 + i;
            if (enemy.type === 'breaker') {
                enemy.bodyRotationAngle = animTime * 0.005;
            }

            ctx.save();
            ctx.translate(cx, cy);

            // Render Sabotage Aura for Breaker (Fades out cleanly as it stops)
            if (enemy.type === 'breaker') {
                const pulse = 0.5 + Math.sin(animTime * 0.01) * 0.2;
                ctx.beginPath();
                ctx.arc(0, 0, 18, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(255, 50, 50, ${0.2 * pulse * timeScale})`;
                ctx.fill();
            }

            ctx.rotate(angleToCenter);

            const img = window.textureManager.getImage('enemies', enemy.type);
            if (img && img.complete && img.naturalWidth !== 0) {
                ctx.drawImage(img, -enemy.size / 2, -enemy.size / 2, enemy.size, enemy.size);
            } else if (enemy.renderBody) {
                enemy.renderBody(ctx, enemy.color || '#808080');
            }

            ctx.restore();
        });
    }

    renderMainMenuCastleIcon() {
        const canvas = document.getElementById('mainMenuCastleCanvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const time = Date.now() * 0.005;

        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2 + 10);

        // --- 1. Base Wall & Gateway ---
        ctx.fillStyle = '#64748B'; // Slate stone
        ctx.fillRect(-65, -20, 130, 50);

        // Wall battlements / notches
        ctx.fillStyle = '#475569';
        for (let x = -65; x < 65; x += 18) {
            ctx.fillRect(x, -28, 10, 8);
        }

        // Center Arch Gateway
        ctx.fillStyle = '#1E293B';
        ctx.beginPath();
        ctx.arc(0, 30, 16, Math.PI, 0);
        ctx.fill();

        // --- 2. Left Tower / Spire ---
        ctx.fillStyle = '#475569';
        ctx.fillRect(-60, -50, 24, 40);
        // Left Conical Roof
        ctx.fillStyle = '#334155';
        ctx.beginPath();
        ctx.moveTo(-72, -50);
        ctx.lineTo(-48, -75);
        ctx.lineTo(-24, -50);
        ctx.closePath();
        ctx.fill();

        // --- 3. Right Tower / Spire ---
        ctx.fillStyle = '#475569';
        ctx.fillRect(36, -50, 24, 40);
        // Right Conical Roof
        ctx.fillStyle = '#334155';
        ctx.beginPath();
        ctx.moveTo(24, -50);
        ctx.lineTo(48, -75);
        ctx.lineTo(72, -50);
        ctx.closePath();
        ctx.fill();

        // --- 4. Middle Keep / Tallest Center Tower ---
        ctx.fillStyle = '#334155';
        ctx.fillRect(-22, -70, 44, 60);
        // Middle Conical Roof (Tallest Center Spire)
        ctx.fillStyle = '#1E293B';
        ctx.beginPath();
        ctx.moveTo(-30, -70);
        ctx.lineTo(0, -100);
        ctx.lineTo(30, -70);
        ctx.closePath();
        ctx.fill();

        // --- 5. RED FLAGS ON ALL THREE TOWERS (Left, Middle, Right) ---
        const spires = [
            { x: -48, y: -75 }, // Left Spire
            { x: 0,   y: -100 }, // Middle Spire (Tallest Center)
            { x: 48,  y: -75 }  // Right Spire
        ];

        spires.forEach((spire, idx) => {
            // Flag Pole
            ctx.strokeStyle = '#CBD5E1';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(spire.x, spire.y);
            ctx.lineTo(spire.x, spire.y - 22);
            ctx.stroke();

            // Gold Finial Ball at tip
            ctx.fillStyle = '#FFD700';
            ctx.beginPath();
            ctx.arc(spire.x, spire.y - 23, 3, 0, Math.PI * 2);
            ctx.fill();

            // Waving Red Flag
            const wave = Math.sin(time + idx * 1.5) * 4;
            ctx.fillStyle = '#E74C3C'; // Bright Red Flag on ALL THREE TOWERS
            ctx.beginPath();
            ctx.moveTo(spire.x, spire.y - 22);
            ctx.lineTo(spire.x + 22, spire.y - 16 + wave);
            ctx.lineTo(spire.x, spire.y - 10);
            ctx.closePath();
            ctx.fill();
        });

        ctx.restore();
    }

    renderTowerIcon(canvas, type) {
        const ctx = canvas.getContext('2d'), visuals = window.textureManager.getTower(type), size = 56;
        ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.save(); ctx.translate(canvas.width / 2, canvas.height / 2); ctx.scale(0.5, 0.5);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.2)'; ctx.fillRect(-size / 2 + 4, -size / 2 + 4, size, size);
        ctx.fillStyle = visuals.color; ctx.fillRect(-size / 2, -size / 2, size, size);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)'; ctx.fillRect(-size / 2, -size / 2, size, size * 0.2);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.15)'; ctx.fillRect(-size / 2, size * 0.3, size, size * 0.2);
        ctx.rotate(-Math.PI / 2); ctx.fillStyle = visuals.topColor;
        if (type === 'sniper') { ctx.fillRect(-10, -10, 20, 20); ctx.fillStyle = '#111'; ctx.fillRect(0, -4, 40, 8); ctx.fillStyle = '#FF0000'; ctx.beginPath(); ctx.arc(40, 0, 3, 0, Math.PI * 2); ctx.fill(); }
        else if (type === 'aa') { ctx.fillRect(-12, -12, 24, 24); ctx.fillStyle = '#222'; for (let i = -1; i <= 1; i++) ctx.fillRect(0, i * 12 - 3, 25, 6); ctx.fillStyle = visuals.topColor; ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill(); }
        else if (type === 'mortar') { ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = visuals.topColor; ctx.lineWidth = 3; ctx.stroke(); }
        else if (type === 'tesla') { const tS = size * 0.4; ctx.fillRect(-tS / 2, -tS / 2, tS, tS); ctx.strokeStyle = visuals.topColor; ctx.lineWidth = 3; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(0, 0, 10 + i * 5, 0, Math.PI * 2); ctx.stroke(); } ctx.fillStyle = '#00FFFF'; ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill(); }
        else if (type === 'laser') { const tS = size * 0.4; ctx.fillRect(-tS / 2, -tS / 2, tS, tS); ctx.fillStyle = '#FF1744'; ctx.beginPath(); ctx.arc(12, 0, 7, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.arc(12, 0, 3, 0, Math.PI * 2); ctx.fill(); }
        else if (type === 'flame') { const tS = size * 0.45; ctx.fillRect(-tS / 2, -tS / 2, tS, tS); ctx.fillStyle = '#222'; ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(20, -10); ctx.lineTo(20, 10); ctx.lineTo(0, 7); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#FF4500'; ctx.beginPath(); ctx.arc(20, 0, 4, 0, Math.PI * 2); ctx.fill(); }
        else if (type === 'upgrader') { const tS = size * 0.45; ctx.fillRect(-tS / 2, -tS / 2, tS, tS); ctx.fillStyle = '#FFD700'; ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-7, 7); ctx.lineTo(7, -7); ctx.stroke(); }
        else if (type === 'frost') { const tS = size * 0.42; ctx.fillRect(-tS / 2, -tS / 2, tS, tS); ctx.fillStyle = '#D6EAF8'; ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(8, 0); ctx.lineTo(0, 12); ctx.lineTo(-8, 0); ctx.closePath(); ctx.fill(); }
        else { const isMG = type === 'machinegun'; ctx.fillStyle = visuals.topColor; ctx.fillRect(isMG ? -10 : -15, isMG ? -10 : -15, isMG ? 20 : 30, isMG ? 20 : 30); ctx.fillStyle = '#111'; const bLen = isMG ? 25 : 35, bW = isMG ? 8 : 14; ctx.fillRect(0, -bW / 2, bLen, bW); }
        ctx.restore();
    }

    renderWallIcon(canvas) { const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.save(); ctx.translate(20, 20); ctx.fillStyle = '#A0522D'; ctx.fillRect(-15, -15, 30, 30); ctx.restore(); }
    renderSpikeIcon(canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save(); ctx.translate(20, 20);
        // Base
        ctx.fillStyle = '#8B6F47';
        ctx.fillRect(-15, -15, 30, 30);
        // Cross-hatch spikes
        ctx.strokeStyle = '#5C4033'; ctx.lineWidth = 2;
        for(let i=-10; i<=10; i+=10) {
            ctx.beginPath(); ctx.moveTo(i, -12); ctx.lineTo(i, 12); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(-12, i); ctx.lineTo(12, i); ctx.stroke();
        }
        ctx.restore();
    }

    renderMirrorIcon(canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save(); ctx.translate(20, 20);
        // 3D Frame Look
        ctx.fillStyle = '#455A64';
        ctx.fillRect(-14, -14, 28, 28);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = '#E0F7FF';
        ctx.fillRect(-16, -3, 32, 6);
        ctx.restore();
    }
    renderLilypadIcon(canvas) { const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.save(); ctx.translate(20, 20); ctx.fillStyle = '#228B22'; ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }

    addAshEffect(enemy) {
        const size = enemy.size || 20;
        const pad = 10;
        const canvas = document.createElement('canvas');
        canvas.width = size + pad * 2;
        canvas.height = size + pad * 2;
        const ctx = canvas.getContext('2d');
        ctx.translate(canvas.width / 2, canvas.height / 2);

        enemy.renderBody(ctx, '#222222');
        ctx.globalCompositeOperation = 'source-in';
        ctx.fillStyle = '#111111';
        ctx.fillRect(-canvas.width/2, -canvas.height/2, canvas.width, canvas.height);

        this.ashEffects.push({
            x: enemy.x,
            y: enemy.y,
            size: size,
            facingAngle: enemy.facingAngle,
            canvas: canvas,
            time: 0
        });
    }

    addExplosion(x, y, radius, color = '#FF6600') { this.explosions.push({ x, y, radius, color, life: 500, maxLife: 500 }); }
    addDamageNumber(x, y, damage) { this.damageNumbers.push({ x, y, damage, life: 1.0 }); }
    spawnConfetti(x, y, size = 5, isBoss = false) {
        const count = isBoss ? 40 : 12, colors = ['#FFD700', '#FF4500', '#FF1493', '#00BFFF', '#32CD32'];
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2, force = (Math.random() * 200) + (isBoss ? 100 : 50);
            this.confetti.push({ x, y, size: (Math.random() * 4) + 3, vx: Math.cos(angle) * force, vy: Math.sin(angle) * force - 50, life: (Math.random() * 1.5) + 0.5, color: colors[Math.floor(Math.random() * colors.length)], rot: Math.random() * Math.PI * 2, vr: (Math.random() * 10) - 5 });
        }
    }
    addProjectile(p) { this.projectiles.push(p); }
}

let _gameInitAttempted = false;
async function initializeGame() {
    if (_gameInitAttempted) return;
    _gameInitAttempted = true;

    console.log("Game: Initializing...");

    const canvas = document.getElementById('gameCanvas');
    if (!canvas) {
        console.error("Game: Canvas not found!");
        return;
    }
    const container = canvas.parentElement;

    if (window._originalGameConfig) {
        const base = JSON.parse(JSON.stringify(window._originalGameConfig));
        for (const key in base) {
            if (typeof GameConfig[key] === 'object' && GameConfig[key] !== null) Object.assign(GameConfig[key], JSON.parse(JSON.stringify(base[key])));
            else GameConfig[key] = base[key];
        }
    }

    // Load textures in background without blocking
    window.textureManager.preloadTheme().catch(e => console.warn("Background texture preload failed: " + e));

    const columns = 10;
    const targetRows = 16; // Strictly fixed 10x16 grid!

    // Detect environment
    const isAndroid = typeof Android !== 'undefined';
    if (!isAndroid) document.body.classList.add('is-browser');

    // Priority 1: Scale grid to match screen width (lock aspect ratio: 10 columns x 16 rows)
    const availableWidth = container.clientWidth || window.innerWidth;
    const availableHeight = container.clientHeight || window.innerHeight;

    // Calculate tile size from available width (using 8px padding)
    const tileSizeW = Math.floor((availableWidth - 8) / columns);
    // Height cap: HUD + up to two (sometimes three) arsenal rows must stay in the visible viewport
    const maxTileSizeH = Math.floor((availableHeight - 260) / targetRows);

    const tileSize = Math.max(18, Math.min(tileSizeW, maxTileSizeH));

    canvas.width = columns * tileSize;
    canvas.style.width = canvas.width + 'px';
    canvas.style.margin = "0 auto";

    const rows = targetRows; // Strictly 16 rows!
    canvas.height = rows * tileSize;
    canvas.style.height = canvas.height + 'px';

    if (!isAndroid) {
        // Tighten container width on browser to match canvas width
        container.style.maxWidth = Math.max(300, canvas.width + 16) + 'px';
    }
    if (window.gameScene && typeof window.gameScene._layoutArsenal === 'function') {
        window.gameScene._layoutArsenal();
    }

    GameConfig.Grid.columns = columns; GameConfig.Grid.rows = rows; GameConfig.Grid.tileSize = tileSize;
    const scale = tileSize / 64;
    GameConfig.scale = scale;
    GameConfig.Castle.size = tileSize * 2;
    for (const type in GameConfig.Enemy) { GameConfig.Enemy[type].size = Math.round(GameConfig.Enemy[type].size * scale); GameConfig.Enemy[type].speed *= scale; }
    for (const key in GameConfig.Tower) {
        if (GameConfig.Tower[key].size) GameConfig.Tower[key].size = tileSize;
        if (GameConfig.Tower[key].range && GameConfig.Tower[key].range !== Infinity) {
            GameConfig.Tower[key].range *= scale;
        }
        if (GameConfig.Tower[key].minRange) {
            GameConfig.Tower[key].minRange *= scale;
        }
        if (GameConfig.Tower[key].slowRadius) {
            GameConfig.Tower[key].slowRadius *= scale;
        }
        if (GameConfig.Tower[key].splashRadius) {
            GameConfig.Tower[key].splashRadius *= scale;
        }
    }
    ['Wall', 'Spike', 'Mirror', 'Lilypad'].forEach(k => { if(GameConfig[k]) GameConfig[k].size = tileSize; });

    if (!window.gameScene) {
        console.log("Game: Initializing GameScene...");
        const scene = new GameScene(canvas);
        scene.showMainMenu();
        scene.render();
        console.log("Game: Ready.");
    } else {
        window.gameScene.canvas = canvas;
        window.gameScene.ctx = canvas.getContext('2d');
        if (window.gameScene.gridSystem) {
            window.gameScene.gridSystem.canvas = canvas;
            window.gameScene.gridSystem.ctx = canvas.getContext('2d');
        }
        window.gameScene._entitiesDirty = true;
        window.gameScene.render();
    }
}

// Reverted to DOMContentLoaded for faster responsiveness
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initializeGame();
} else {
    document.addEventListener('DOMContentLoaded', initializeGame);
}

// Handle window resize dynamically for browser mode
let resizeTimeout;
window.addEventListener('resize', function() {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(initializeGame, 150);
});

// Ultra-fast fallback
setTimeout(initializeGame, 1000);
