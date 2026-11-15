// Game Configuration
const GameConfig = {
    sellRefundRatio: 0.50,         // 50% refund on sale (base + upgrades - damage)
    Grid: {
        tileSize: 64,
        columns: 10,
        rows: 16
    },
    Difficulty: {
        enemyHpMult: 1.4,          // Increased base health (1.4x)
        enemyDamageMult: 1.0,
        enemySpeedMult: 1.0,
        waterPercent: 15,          // used when water is enabled
        startingGold: 60,
        castleHpMult: 1.0,
        castleRegenMult: 1.0,
        spawnIntervalMult: 1.0,
        enemiesPerRoundBase: 6,
        enemiesPerRoundIncrease: 2,
        roundHpScale: 1.00,       // No per-round HP growth (0%)
        roundSpeedScale: 0.02,    // linear: +2% speed per round, capped
        roundSpeedCap: 1.5,
        bigEnemyChanceBase: 0.10,
        bigEnemyChanceGrowth: 0.025
    },
    Tower: {
        MachineGun: {
            damage: 5,             // Increased from 4
            fireRate: 100,          // ~10 shots/sec => 50 DPS
            range: 96,              // GDD: 1.5 tiles base
            projectileSpeed: 700,
            size: 56,
            cost: 20,
            targets: 'all',        // can target flyers, but only 15% of shots hit them
            damageMultVsTank: 0.3,
            flyerHitChance: 0.15,
        },
        Cannon: {
            damage: 100,            // Increased from 80
            fireRate: 1800,         // Slower fire rate (1.8s) => 55 DPS
            range: 96,
            minRange: 48,           // MASSIVE blind spot (inner half of range is safe zone)
            projectileSpeed: 150,   // Very slow cannonballs (easy for Speedy to outrun)
            size: 56,
            cost: 20,
            targets: 'ground',
            rotationSpeed: 0.5,     // Excruciatingly slow turning
        },
        Sniper: {
            damage: 150,
            fireRate: 1500,         // ~100 DPS
            range: 400,             // ~6.3 tiles — map-wide coverage
            minRange: 128,          // inner radius 2 tiles — donut FOV like the mortar
            projectileSpeed: 900,
            size: 56,
            cost: 250,
            targets: 'ground',      // cannot hit flyers
            rotationSpeed: 3,       // slow, deliberate rotation
        },
        AA: {
            damage: 80,             // Increased from 60
            fireRate: 250,          // ~4 shots/sec => 300 DPS vs flyers
            range: 96,              // GDD: 1.5 tiles base
            projectileSpeed: 500,   // rocket speed (homing)
            size: 48,
            cost: 50,
            targets: 'fly',         // ONLY hits flyers
            isAA: true,             // fires homing rockets
        },
        Mortar: {
            damage: 80,             // Increased from 60
            fireRate: 3500,         // ~23 DPS single target, huge AoE impact
            range: 160,             // outer radius 2.5 tiles
            minRange: 96,           // inner radius 1.5 tiles — donut FOV
            projectileSpeed: 300,
            size: 48,
            cost: 80,
            targets: 'ground',      // cannot hit flyers
            splashRadius: 96,       // 1.5 tiles area damage
            isMortar: true
        },
        Tesla: {
            damage: 0,              // tesla doesn't fire projectiles — it zaps directly
            fireRate: 0,
            range: 96,              // GDD: 1.5 tiles base
            projectileSpeed: 0,
            size: 56,
            cost: 90,
            targets: 'all',         // zaps all enemy types (including flyers)
            isTesla: true,
            shockDamage: 4,         // reduced from 6 — AoE weapon does less damage
            shockInterval: 350,     // every 0.35s => ~11.4 DPS to ALL enemies in range
        },
        Upgrader: {
            damage: 0,              // doesn't attack — upgrades adjacent towers
            fireRate: 0,
            range: 0,
            projectileSpeed: 0,
            size: 48,
            cost: 50,               // cheaper (50g) to allow early placement alongside Cannons
            targets: 'none',
            isUpgrader: true,
            upgradeInterval: 4000,   // tries to upgrade an adjacent tower every 4s
            multipliers: [1.5, 1.5, 2.0, 2.5, 3.0, 4.0] // Boost per level: L1=1.5x, L2=2.0x, L3=2.5x, L4=3.0x, L5=4.0x
        },
        Frost: {
            damage: 3,              // AoE weapon does less damage
            fireRate: 1500,         // Fires every 1.5s (ensures 100% slow uptime)
            minFireRate: 800,       // Faster at max upgrade
            range: 96,
            projectileSpeed: 500,
            size: 48,
            cost: 15,
            targets: 'ground',
            isFrost: true,
            slowMult: 0.5,          // enemies move at 50% speed
            slowDuration: 2000,     // slow lasts 2 seconds
            slowRadius: 96,         // 1.5 tiles AoE slow around impact (1x1 area)
        },
        Laser: {
            damage: 3,              // per tick
            fireRate: 100,          // damage tick every 100ms => 30 DPS (unchanged — continuous beam)
            range: Infinity,        // infinite — beam goes to map edge
            projectileSpeed: 0,     // hitscan, no projectile
            size: 48,
            cost: 450,              // rebalanced top-tier line-clearing weapon
            targets: 'ground',      // CHANGED: can no longer hit flyers
            isLaser: true,
            // 4 rotatable directions (90° each): 0=right, 1=down, 2=left, 3=up
            numDirections: 4,
        },
        Flame: {
            damage: 4,              // per tick (Increased 2x)
            fireRate: 80,           // damage tick every 80ms => 25 DPS per enemy
            range: 96,              // GDD: 1.5 tiles base
            projectileSpeed: 0,
            size: 52,
            cost: 100,
            targets: 'ground',
            isFlame: true,
            numDirections: 8,       // math base (45 degree steps)
            flameArc: Math.PI / 4   // 45 degree spread (1/8th of a circle)
        }
    },
    Wall: {
        cost: 5,                    // cheapest placeable
        size: 56,
        health: 150,                // 2.5x tougher than lvl0 towers (60 HP)
        maxHealth: 150,
        topColor: '#A0522D',
        canPlaceOnWater: false
    },
    Mirror: {
        cost: 15,                   // reflective surface for laser beams
        size: 56,
        surfaceColor: '#E0F7FF',
        canPlaceOnWater: false,
        // Two angles: 45° (\) and 135° (/)
        angles: [Math.PI / 4, 3 * Math.PI / 4],
    },
    Lilypad: {
        cost: 10,                    // Lilypad — placed on water tiles
        size: 56,
        padColor: '#3A8B3A',        // green Lilypad
        padHighlight: '#5CBF5C',    // lighter green
        padDark: '#2A6B2A',         // darker green veins
        flowerColor: '#FFC0CB',     // pink flower
        flowerCenter: '#FFD700',    // gold center
        slowMult: 0.5,
        slowDuration: 1000,
        damage: [0, 5, 12, 20, 32, 50],      // damage per tick at each level (0-5)
        damageInterval: 600,        // same tick rate as spikes
        canPlaceOnWater: true       // ONLY placeable on water
    },
    Spike: {
        cost: 10,                   // cheap trap
        size: 56,
        damage: 8,                  // Increased from 6
        damageInterval: 600,        // every 0.6s while on the spike
        tierNames: ['Wood', 'Silver', 'Gold', 'Purple', 'Crimson', 'Obsidian'],
        tierColors: [
            { spike: '#8B6F47', base: '#A0826D' },   // wood (brown)
            { spike: '#C0C0C0', base: '#A9A9A9' },   // silver
            { spike: '#FFD700', base: '#DAA520' },   // gold
            { spike: '#9B59B6', base: '#7D3C98' },   // purple
            { spike: '#DC143C', base: '#8B0000' },   // crimson
            { spike: '#FF0000', base: '#2A2A2A' },   // glowing red / dark gray
        ],
        tierDamage: [10, 18, 28, 45, 65, 90],
        tierSlowMult: 0.45,                 // 55% slow
        tierSlowDuration: 1200,
        canPlaceOnWater: false,
        isSpike: true
    },
    Enemy: {
        Normy: { health: 85, speed: 50, size: 20, damage: 3, attackSpeed: 1000, special: 'normal', reward: 1 },
        Groupie: { health: 85, speed: 45, size: 18, damage: 2, attackSpeed: 1000, special: 'normal', reward: 1 },
        Speedy: { health: 100, speed: 180, size: 24, damage: 4, attackSpeed: 700, special: 'normal', reward: 1 },
        Tank: { health: 140, speed: 35, size: 40, damage: 15, attackSpeed: 1200, special: 'normal', reward: 1 },
        Crocodile: { health: 80, speed: 30, size: 28, damage: 6, attackSpeed: 1000, special: 'swim', reward: 1 },
        Flyer: { health: 70, speed: 85, size: 22, damage: 5, attackSpeed: 800, special: 'fly', reward: 1 },
        Splitter: { health: 45, speed: 50, size: 32, damage: 6, attackSpeed: 900, special: 'normal', reward: 1 },
        Breaker: { health: 400, speed: 38, size: 40, damage: 10, attackSpeed: 1000, special: 'breaker', reward: 5 }
    },
    Castle: {
        health: 100, maxHealth: 100, hpRegenSpeed: 3, attackDamage: 30, attackSpeed: 800, cannonRange: 96, size: 128, roofColor: '#A9A9A9'
    },
    Spawning: {
        initialInterval: 2000, minimumInterval: 600, intervalDecrease: 100,
        enemiesPerRoundBase: 6, enemiesPerRoundIncrease: 3, roundClearBonusBase: 20, roundClearBonusPerRound: 4,
        miniRoundBaseCount: 2, miniRoundIncrease: 1, miniRoundSpacing: 1500,
        groupiePackSizes: [3, 6, 9],
        RoundType: {
            normal: { enemyCountMult: 1.0, hpMult: 1.0, sizeMult: 1.0, spawnIntervalMult: 1.0, bossRound: false, rewardMult: 1.0 },
            boss: { enemyCountMult: 0.4, hpMult: 5.0, sizeMult: 1.5, spawnIntervalMult: 1.5, bossRound: true, rewardMult: 6.0 },
            swarm: { enemyCountMult: 2.5, hpMult: 0.6, sizeMult: 0.8, spawnIntervalMult: 0.4, bossRound: false, rewardMult: 0.7 },
            mixed: { enemyCountMult: 1.3, hpMult: 1.1, sizeMult: 1.0, spawnIntervalMult: 0.9, bossRound: false, rewardMult: 1.3 }
        },
        bossRoundInterval: 10, swarmRoundInterval: 5, mixedRoundInterval: 3,
    }
};

function getConfigValue(path) {
    return path.split('.').reduce((value, key) => value?.[key], GameConfig);
}

function setConfigValue(path, value) {
    const keys = path.split('.');
    const property = keys.pop();
    const target = keys.reduce((object, key) => object?.[key], GameConfig);
    if (target && property) target[property] = value;
}

// --- CRITICAL: Capture base config BEFORE any scaling happens ---
window._originalGameConfig = JSON.parse(JSON.stringify(GameConfig));

// Shared build button definitions — used by updateBuildButtonSelection, refreshBuildButtonIcons, etc.
const BUILD_BUTTONS = [
    { id: 'wallBtn',        type: 'wall',       costPath: 'Wall.cost',              name: 'Wall', cooldown: 2000 },
    { id: 'spikeBtn',       type: 'spike',      costPath: 'Spike.cost',             name: 'Spike Trap', cooldown: 3000 },
    { id: 'lilypadBtn',    type: 'lilypad',   costPath: 'Lilypad.cost',          name: 'Lilypad', cooldown: 3000 },
    { id: 'mirrorBtn',      type: 'mirror',     costPath: 'Mirror.cost',            name: 'Mirror', cooldown: 3000 },
    { id: 'frostTowerBtn',  type: 'frost',      costPath: 'Tower.Frost.cost',       name: TOWER_DISPLAY_NAMES.frost, cooldown: 4000 },
    { id: 'fastTowerBtn',   type: 'machinegun',  costPath: 'Tower.MachineGun.cost',   name: TOWER_DISPLAY_NAMES.machinegun, cooldown: 4000 },
    { id: 'slowTowerBtn',   type: 'cannon',    costPath: 'Tower.Cannon.cost',     name: TOWER_DISPLAY_NAMES.cannon, cooldown: 4000 },
    { id: 'aaTowerBtn',     type: 'aa',         costPath: 'Tower.AA.cost',          name: TOWER_DISPLAY_NAMES.aa, cooldown: 4000 },
    { id: 'upgraderBtn',    type: 'upgrader',   costPath: 'Tower.Upgrader.cost',    name: TOWER_DISPLAY_NAMES.upgrader, cooldown: 5000 },
    { id: 'mortarTowerBtn', type: 'mortar',     costPath: 'Tower.Mortar.cost',      name: TOWER_DISPLAY_NAMES.mortar, cooldown: 5000 },
    { id: 'teslaTowerBtn',  type: 'tesla',      costPath: 'Tower.Tesla.cost',       name: TOWER_DISPLAY_NAMES.tesla, cooldown: 5000 },
    { id: 'flameTowerBtn',  type: 'flame',      costPath: 'Tower.Flame.cost',       name: TOWER_DISPLAY_NAMES.flame, cooldown: 5000 },
    { id: 'sniperTowerBtn', type: 'sniper',     costPath: 'Tower.Sniper.cost',      name: TOWER_DISPLAY_NAMES.sniper, cooldown: 5000 },
    { id: 'laserTowerBtn',  type: 'laser',      costPath: 'Tower.Laser.cost',       name: TOWER_DISPLAY_NAMES.laser, cooldown: 6000 },
];

// Resolving cost against GameConfig on every read
for (const button of BUILD_BUTTONS) {
    Object.defineProperty(button, 'cost', {
        get: () => getConfigValue(button.costPath),
        enumerable: true,
    });
}
const BUILD_TYPES = BUILD_BUTTONS.map(b => b.type);
