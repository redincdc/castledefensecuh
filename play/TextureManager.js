/**
 * Texture Manager - handles colors and image placeholders for the entire game.
 * Uses a theme system and preloads images from assets/textures/.
 */
class TextureManager {
    constructor() {
        this.activeTheme = localStorage.getItem('td_game_theme') || 'default';
        this.cache = new Map(); // Cache for loaded images
        this.themes = {
            'default': {
                grid: {
                    grassLight: '#5cb85c',
                    grassDark: '#4cae4c',
                    border: '#4a9a4a',
                    waterBase: [40, 140, 200], // [R, G, B] - used in gradients
                    waterSparkle: 'rgba(255, 255, 255, 0.6)'
                },
                towers: {
                    machinegun: { color: '#4169E1', topColor: '#00BFFF' },
                    cannon: { color: '#D32F2F', topColor: '#B71C1C' },
                    sniper:    { color: '#2E8B57', topColor: '#98FB98' },
                    aa:        { color: '#4169E1', topColor: '#FFD700' },
                    mortar:    { color: '#556B2F', topColor: '#8FBC8F' },
                    tesla:     { color: '#483D8B', topColor: '#00FFFF' },
                    upgrader:  { color: '#FFD700', topColor: '#FFA500' },
                    frost:     { color: '#1B4F72', topColor: '#AED6F1' },
                    laser:     { color: '#8B0000', topColor: '#FF1744' },
                    flame:     { color: '#E64A19', topColor: '#FF9800' }
                },
                buildables: {
                    wall:      { color: '#8B4513', topColor: '#A0522D' },
                    mirror:    { color: '#78909C', surfaceColor: '#E0F7FF' },
                    lilypad:  {
                        padColor: '#3A8B3A',
                        padHighlight: '#5CBF5C',
                        padDark: '#2A6B2A',
                        flowerColor: '#FFC0CB',
                        flowerCenter: '#FFD700'
                    },
                    spike: {
                        tiers: [
                            { spike: '#8B6F47', base: '#A0826D' },   // wood (brown)
                            { spike: '#C0C0C0', base: '#A9A9A9' },   // silver
                            { spike: '#FFD700', base: '#DAA520' },   // gold
                            { spike: '#9B59B6', base: '#7D3C98' },   // purple
                            { spike: '#DC143C', base: '#8B0000' },   // crimson
                            { spike: '#FF0000', base: '#2A2A2A' },   // glowing red / dark gray
                        ]
                    }
                },
                enemies: {
                    normy:     { color: '#808080' },
                    groupie:   { color: '#FFFF00' },
                    speedy:    { color: '#FF0000' },
                    tank:      { color: '#2C3E50' },
                    crocodile: { color: '#4A7C3A' },
                    flyer:     { color: '#F1C40F' },
                    splitter:  { color: '#00FF00' },
                    breaker:   { color: '#1A1A1A' },
                    boss:      { color: '#000000' }
                },
                fx: {
                    projectile: '#333',
                    explosion: '#FF4500'
                }
            },
            'pixel-art': {
                grid: {
                    grassLight: '#4B7B4B',
                    grassDark: '#3E663E',
                    border: '#2E4D2E',
                    waterBase: [30, 100, 160],
                    waterSparkle: 'rgba(255, 255, 255, 0.4)'
                },
                towers: {},
                enemies: {},
                fx: {}
            }
        };
    }

    async preloadTheme() {
        // Web build uses procedural (canvas) art. The optional PNG texture pack
        // is not shipped, so skip requests that would only 404 in the console.
        if (!window.__CDC_TEXTURE_PACK__) {
            GameLogger.info(`Starting texture preload for theme: ${this.activeTheme}...`);
            GameLogger.info("Texture preload skipped (procedural art).");
            return;
        }
        const theme = this.activeTheme === 'default' ? '' : `${this.activeTheme}/`;
        const basePath = `textures/${theme}`;

        const assets = [
            { cat: 'grid', names: ['grass', 'water', 'portal'] },
            { cat: 'castle', names: ['castle', 'castle_cannon'] },
            { cat: 'enemies', names: ['normy', 'groupie', 'speedy', 'tank', 'crocodile', 'flyer', 'splitter', 'breaker', 'boss'] },
            { cat: 'buildables', names: ['wall', 'mirror', 'lilypad', 'spike'] },
            { cat: 'towers', names: [
                'speedy_base', 'speedy_top', 'cannon_base', 'cannon_top',
                'sniper_base', 'sniper_top', 'aa_base', 'aa_top',
                'mortar_base', 'mortar_top', 'tesla_base', 'tesla_top',
                'upgrader_base', 'upgrader_top', 'frost_base', 'frost_top',
                'laser_base', 'laser_top', 'flame_base', 'flame_top'
            ]},
            { cat: 'UI/buttons', names: ['pause', 'play', 'restart', 'settings', 'fast_forward', 'upgrade_all', 'continue'] },
            { cat: 'UI/game_stats', names: ['gold_icon', 'heart_icon', 'timer_icon', 'round_icon', 'trophy_icon'] },
            { cat: 'UI/main_menu', names: ['menu_background', 'title_logo', 'leaderboard_btn'] }
        ];

        const loadPromises = [];
        for (const category of assets) {
            for (const name of category.names) {
                const src = `${basePath}${category.cat}/${name}.png`;
                loadPromises.push(this._loadImage(category.cat, name, src));
            }
        }

        GameLogger.info(`Starting texture preload for theme: ${this.activeTheme}...`);
        await Promise.all(loadPromises);
        GameLogger.info("Texture preload complete.");
    }

    _loadImage(category, name, src) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                this.cache.set(`${category}:${name}`, img);
                resolve(true);
            };
            img.onerror = () => {
                resolve(false);
            };
            img.src = src;
        });
    }

    getImage(category, name) {
        return this.cache.get(`${category}:${name}`) || null;
    }

    get(path) {
        const parts = path.split('.');
        const theme = this.themes[this.activeTheme] || this.themes['default'];
        const def = this.themes['default'];

        let value = theme;
        let fallback = def;

        for (const part of parts) {
            value = value ? value[part] : undefined;
            fallback = fallback ? fallback[part] : undefined;
        }

        return value !== undefined ? value : fallback;
    }

    getTower(type) {
        const t = this.get('towers.' + type);
        if (!t || Object.keys(t).length === 0) {
            const fallback = this.themes['default'].towers[type];
            if (!fallback) GameLogger.warn(`Tower texture for "${type}" not found. Using default fallback.`);
            return fallback || { color: '#4169E1', topColor: '#00BFFF' };
        }
        return t;
    }

    getBuildable(type) {
        const b = this.get('buildables.' + type);
        if (!b || Object.keys(b).length === 0) {
            const fallback = this.themes['default'].buildables[type];
            if (!fallback) GameLogger.warn(`Buildable texture for "${type}" not found. Using default fallback.`);
            return fallback;
        }
        return b;
    }

    getEnemy(type) {
        const e = this.get('enemies.' + type);
        if (!e || Object.keys(e).length === 0) {
            const fallback = this.themes['default'].enemies[type];
            if (!fallback) GameLogger.warn(`Enemy texture for "${type}" not found. Using default fallback.`);
            return fallback || { color: '#808080' };
        }
        return e;
    }
}

// Global instance
window.textureManager = new TextureManager();
