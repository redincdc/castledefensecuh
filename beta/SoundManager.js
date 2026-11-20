class SoundManager {
    constructor() {
        this.ctx = null;
        this.masterGain = null;
        this.compressor = null;
        this.sfxEnabled = true;
        this.musicEnabled = true;
        // v5.19: volume sliders (0..1, default 0.5 = the old fixed loudness)
        this.sfxVolume = 0.5;
        this.musicVolume = 0.5;
        this.vibrationEnabled = true;
        this._resumeBound = null;
        this._bufferCache = new Map(); // src -> Promise<AudioBuffer|null>, decoded once and reused for every playback
        this.activeMachineGunVoices = new Map();
        this.activeTeslaVoices = new Map();
        this.activeAAMissileVoices = new Map();
        this.activeFlameVoices = new Map();
        this.activeOneShotVoices = new Set();
        this.activeTurretOneShotVoices = new Set();
        // Generous caps — the grid can hold well under 100 towers, these just guard against runaway leaks
        this.maxMachineGunVoices = 16;
        this.maxAAMissileVoices = 8;
        this.maxTeslaVoices = 8;
        this.maxFlameVoices = 8;
        this.maxOneShotVoices = 16;

        // Background Music State — one shared <audio> for the whole page
        SoundManager._instance = this;
        this.bgMusicAudio = SoundManager._sharedBgMusic || null;
        this.currentMusicPath = (this.bgMusicAudio && SoundManager._sharedMusicPath) || null;
        this._musicPlayToken = 0;
        this._musicStarting = false;
        this._musicStartPromise = null;
        this._musicTimeUpdateBound = null;
        this._visibilityBound = null;
        this._attachMusicVisibilityHandler();
        this.musicTracks = [
            'audio/music/better-days.mp3'
        ];

        this.weaponClips = {
            gameOver:        ['audio/sfx/Fahhh Castle Death.mp3'],
            castleDeath:     ['audio/sfx/Fahhh Castle Death.mp3'],
            machinegun:      ['audio/sfx/machine-gun.mp3'],
            cannon:          ['audio/sfx/cannon.mp3'],
            aa:              ['audio/sfx/aa-gun.mp3'],
            sniper:          ['audio/sfx/sniper.mp3'],
            upgrade:         ['audio/sfx/upgrade.mp3'],
            mortarShoot:     ['audio/sfx/mortar-tower-shoot.mp3'],
            mortarExplosion: ['audio/sfx/mortar-tower-explosion.mp3'],
            laserAction:     ['audio/sfx/laser.mp3'],
            tesla:           ['audio/sfx/tesla-zap.mp3'],
            frost: [
                'audio/sfx/frost-gun-1.mp3',
                'audio/sfx/frost-gun-2.mp3',
                'audio/sfx/frost-gun-3.mp3',
            ],
            Lilypad:        ['audio/sfx/lilly-pad.mp3'],
            flame:           ['audio/sfx/flame-thrower.mp3'],
        };
        // Web build ships only the castle-death clip (plus the menu music track).
        // Other weapon filenames are not in the repo; skip fetching them so the
        // console stays clean and the existing procedural synths can play instead.
        this._shippedClips = new Set([
            'audio/sfx/Fahhh Castle Death.mp3',
            'audio/music/better-days.mp3',
        ]);
        this._preloadClips();
    }

    // Decode every clip once up front so playback never has to wait on a
    // network fetch or MP3 decode — this is what previously caused audible
    // lag and dropped machine gun sounds under load.
    _preloadClips() {
        if (!this._createContextIfNeeded()) return;
        for (const clips of Object.values(this.weaponClips)) {
            for (const src of clips) this._getBuffer(src);
        }
    }

    _attachResumeListeners() {
        if (this._resumeBound || !window || !document) return;
        this._resumeBound = () => {
            if (this.ctx && this.ctx.state === 'suspended') {
                this.ctx.resume().catch(() => {});
            }
        };
        window.addEventListener('pointerdown', this._resumeBound, { once: true, passive: true });
        window.addEventListener('keydown', this._resumeBound, { once: true, passive: true });
    }

    _createContextIfNeeded() {
        if (this.ctx) return this.ctx;
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return null;
        try {
            this.ctx = new AudioCtx();
        } catch (e) {
            console.error("AudioContext initialization failed:", e);
            return null;
        }
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.35 * this.sfxVolume * 2;
        // Bus limiter — automatically tames the mix when many towers fire at once,
        // instead of every simultaneous voice adding up to an ever-louder peak.
        this.compressor = this.ctx.createDynamicsCompressor();
        this.compressor.threshold.value = -24;
        this.compressor.knee.value = 24;
        this.compressor.ratio.value = 12;
        this.compressor.attack.value = 0.003;
        this.compressor.release.value = 0.25;
        this.masterGain.connect(this.compressor);
        this.compressor.connect(this.ctx.destination);
        this._attachResumeListeners();
        return this.ctx;
    }

    ensureContext() {
        if (!this.sfxEnabled) return null;
        const ctx = this._createContextIfNeeded();
        if (!ctx) {
            this.sfxEnabled = false;
            return null;
        }
        if (ctx.state === 'suspended') {
            ctx.resume().catch(() => {});
        }
        return ctx;
    }

    // Fetch + decode a clip exactly once; every future play of this src reuses the same buffer
    _getBuffer(src) {
        if (this._bufferCache.has(src)) return this._bufferCache.get(src);
        if (this._shippedClips && !this._shippedClips.has(src)) {
            const skipped = Promise.resolve(null);
            this._bufferCache.set(src, skipped);
            return skipped;
        }
        const promise = (async () => {
            const ctx = this._createContextIfNeeded();
            if (!ctx) return null;
            try {
                const response = await fetch(encodeURI(src));
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                const arrayBuffer = await response.arrayBuffer();
                if (arrayBuffer.byteLength === 0) throw new Error(`File is empty: ${src}`);
                return await ctx.decodeAudioData(arrayBuffer);
            } catch (e) {
                console.warn(`Failed to load audio: ${src}`, e);
                return null;
            }
        })();
        this._bufferCache.set(src, promise);
        return promise;
    }

    // Start playback of a decoded buffer. Returns a promise resolving to
    // { source, gain } once the (already-decoded, near-instant) buffer is ready, or null on failure.
    async _playBufferSource(src, { volume = 0.35, loop = false, offset = 0 } = {}) {
        const ctx = this.ensureContext();
        if (!ctx) return null;
        const buffer = await this._getBuffer(src);
        if (!buffer || !this.sfxEnabled) return null;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = loop;
        const gain = ctx.createGain();
        gain.gain.value = volume;
        source.connect(gain);
        gain.connect(this.masterGain);
        source.start(0, offset);
        return { source, gain };
    }

    _startTone(freq, duration, options = {}) {
        if (!this.sfxEnabled) return;
        const ctx = this.ensureContext();
        if (!ctx) return;
        const start = ctx.currentTime;
        const type = options.type || 'triangle';
        const volume = Math.min(0.35, (options.volume || 0.06) * 1.8);
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, start);
        if (options.glide) {
            osc.frequency.exponentialRampToValueAtTime(freq * options.glide, start + Math.min(duration, 0.08));
        }
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(volume, start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(start);
        osc.stop(start + duration + 0.02);
    }

    _playNoiseBurst(options = {}) {
        if (!this.sfxEnabled) return;
        const ctx = this.ensureContext();
        if (!ctx) return;
        const start = ctx.currentTime;
        const duration = options.duration || 0.12;
        const volume = Math.min(0.35, (options.volume || 0.2) * 1.2);
        const bufferSize = ctx.sampleRate * duration;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * volume;
        }
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        const filter = ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = options.filterFreq || 700;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(volume, start);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        source.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain);
        source.start(start);
        source.stop(start + duration);
    }

    getDynamicVolumeScale() {
        let activeTowerCount = 0;
        if (window.gameScene && window.gameScene.allEntities) {
            // Count all built towers/traps that currently have an active target or are currently firing
            activeTowerCount = window.gameScene.allEntities.filter(e =>
                e && e.isBuilt && !e.isUpgrading && !e.isDestroying &&
                (e.currentTarget || e.isFiringFlame || e.isStabbing)
            ).length;
        }

        // Fallback to active sound voice count if scene not ready
        if (activeTowerCount <= 0) {
            activeTowerCount = this.activeOneShotVoices.size +
                               this.activeMachineGunVoices.size +
                               this.activeTeslaVoices.size +
                               this.activeAAMissileVoices.size +
                               this.activeFlameVoices.size;
        }

        // Dynamic scale formula: 1 tower = 100%, 2 towers = 50% each, 4 = 25% each, N = 1 / N
        return 1 / Math.max(1, activeTowerCount);
    }

    playMachineGunSynth(volume = 0.25) {
        if (!this.sfxEnabled) return;
        const ctx = this.ensureContext();
        if (!ctx) return;
        volume = volume * this.getDynamicVolumeScale();
        const now = ctx.currentTime;
        const duration = 0.045; // 45ms crisp mechanical shot

        // Component 1: Mechanical Muzzle Thump (Low-frequency pitch drop 280Hz -> 45Hz)
        const osc = ctx.createOscillator();
        const oscGain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(280, now);
        osc.frequency.exponentialRampToValueAtTime(45, now + duration);

        oscGain.gain.setValueAtTime(volume * 0.45, now);
        oscGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

        osc.connect(oscGain);
        oscGain.connect(this.masterGain);
        osc.start(now);
        osc.stop(now + duration + 0.01);

        // Component 2: Metallic Crack / Shell Ejection Noise (Bandpass Filtered Noise at 1200Hz)
        const bufferSize = Math.floor(ctx.sampleRate * duration);
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1);
        }

        const noise = ctx.createBufferSource();
        noise.buffer = buffer;

        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(1200, now);
        filter.Q.setValueAtTime(1.8, now);

        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(volume * 0.35, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(this.masterGain);

        noise.start(now);
        noise.stop(now + duration);
    }

    playCannonSynth(volume = 0.45) {
        if (!this.sfxEnabled) return;
        const ctx = this.ensureContext();
        if (!ctx) return;
        volume = volume * this.getDynamicVolumeScale();
        const now = ctx.currentTime;
        const duration = 0.28; // 280ms booming heavy shot

        // Component 1: Deep Sub-Bass Cannon Thump (Low pitch drop 150Hz -> 22Hz)
        const osc = ctx.createOscillator();
        const oscGain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.exponentialRampToValueAtTime(22, now + duration);

        oscGain.gain.setValueAtTime(volume * 0.85, now);
        oscGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

        osc.connect(oscGain);
        oscGain.connect(this.masterGain);
        osc.start(now);
        osc.stop(now + duration + 0.02);

        // Component 2: Heavy Muzzle Blast (Lowpass Filtered Noise at 320Hz)
        const bufferSize = Math.floor(ctx.sampleRate * duration);
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1);
        }

        const noise = ctx.createBufferSource();
        noise.buffer = buffer;

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(320, now);
        filter.frequency.exponentialRampToValueAtTime(80, now + duration);

        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(volume * 0.6, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(this.masterGain);

        noise.start(now);
        noise.stop(now + duration);

        // Component 3: Punchy Transient Pop (Triangle wave 420Hz -> 80Hz over 20ms)
        const popOsc = ctx.createOscillator();
        const popGain = ctx.createGain();
        popOsc.type = 'triangle';
        popOsc.frequency.setValueAtTime(420, now);
        popOsc.frequency.exponentialRampToValueAtTime(80, now + 0.02);

        popGain.gain.setValueAtTime(volume * 0.4, now);
        popGain.gain.exponentialRampToValueAtTime(0.001, now + 0.02);

        popOsc.connect(popGain);
        popGain.connect(this.masterGain);
        popOsc.start(now);
        popOsc.stop(now + 0.025);
    }

    playAAGunSynth(volume = 0.12) {
        if (!this.sfxEnabled) return;
        const ctx = this.ensureContext();
        if (!ctx) return;
        volume = volume * this.getDynamicVolumeScale();
        const now = ctx.currentTime;
        const duration = 0.12; // 120ms smooth, low-pitch anti-air pulse

        // Component 1: Low-Pitch Thruster Thud (Triangle wave 380Hz -> 90Hz)
        const osc = ctx.createOscillator();
        const oscGain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(380, now);
        osc.frequency.exponentialRampToValueAtTime(90, now + duration);

        oscGain.gain.setValueAtTime(volume * 0.35, now);
        oscGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

        osc.connect(oscGain);
        oscGain.connect(this.masterGain);
        osc.start(now);
        osc.stop(now + duration + 0.01);

        // Component 2: Muffled Lowpass Muzzle Noise (Lowpass Filter at 420Hz removes high-frequency sizzle)
        const bufferSize = Math.floor(ctx.sampleRate * duration);
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1);
        }

        const noise = ctx.createBufferSource();
        noise.buffer = buffer;

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(420, now);
        filter.frequency.exponentialRampToValueAtTime(120, now + duration);

        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(volume * 0.25, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(this.masterGain);

        noise.start(now);
        noise.stop(now + duration);

        // Component 3: Soft Secondary Pulse (Low Triangle wave 220Hz -> 70Hz at +35ms)
        const popOsc = ctx.createOscillator();
        const popGain = ctx.createGain();
        popOsc.type = 'triangle';
        popOsc.frequency.setValueAtTime(220, now + 0.035);
        popOsc.frequency.exponentialRampToValueAtTime(70, now + duration);

        popGain.gain.setValueAtTime(0.001, now);
        popGain.gain.setValueAtTime(volume * 0.2, now + 0.035);
        popGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

        popOsc.connect(popGain);
        popGain.connect(this.masterGain);
        popOsc.start(now + 0.035);
        popOsc.stop(now + duration + 0.01);
    }

    playFrostSynth(volume = 0.35) {
        if (!this.sfxEnabled) return;
        const ctx = this.ensureContext();
        if (!ctx) return;
        volume = volume * this.getDynamicVolumeScale();
        const now = ctx.currentTime;
        const duration = 0.22; // 220ms power-down pitch drop

        // Component 1: Power-Down Pitch Drop (Sawtooth 520Hz -> 65Hz)
        const osc = ctx.createOscillator();
        const oscGain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(520, now);
        osc.frequency.exponentialRampToValueAtTime(65, now + duration);

        oscGain.gain.setValueAtTime(volume * 0.45, now);
        oscGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

        osc.connect(oscGain);
        oscGain.connect(this.masterGain);
        osc.start(now);
        osc.stop(now + duration + 0.01);

        // Component 2: Thermal Drain Filter Closing (Lowpass Filter 1800Hz -> 100Hz)
        const bufferSize = Math.floor(ctx.sampleRate * duration);
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1);
        }

        const noise = ctx.createBufferSource();
        noise.buffer = buffer;

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1800, now);
        filter.frequency.exponentialRampToValueAtTime(100, now + duration);

        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(volume * 0.35, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(this.masterGain);

        noise.start(now);
        noise.stop(now + duration);

        // Component 3: Sub-Bass Standstill Hum (Sine wave 120Hz -> 35Hz)
        const subOsc = ctx.createOscillator();
        const subGain = ctx.createGain();
        subOsc.type = 'sine';
        subOsc.frequency.setValueAtTime(120, now);
        subOsc.frequency.exponentialRampToValueAtTime(35, now + duration);

        subGain.gain.setValueAtTime(volume * 0.5, now);
        subGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

        subOsc.connect(subGain);
        subGain.connect(this.masterGain);
        subOsc.start(now);
        subOsc.stop(now + duration + 0.01);
    }

    playSpikeStabSynth(volume = 0.35) {
        if (!this.sfxEnabled) return;
        const ctx = this.ensureContext();
        if (!ctx) return;
        volume = volume * this.getDynamicVolumeScale();
        const now = ctx.currentTime;
        const duration = 0.06; // 60ms rapid sharp stab

        // Component 1: Sharp Blade Entry Slice (Triangle 2200Hz -> 280Hz over 25ms)
        const blade = ctx.createOscillator();
        const bladeGain = ctx.createGain();
        blade.type = 'triangle';
        blade.frequency.setValueAtTime(2200, now);
        blade.frequency.exponentialRampToValueAtTime(280, now + 0.025);

        bladeGain.gain.setValueAtTime(volume * 0.55, now);
        bladeGain.gain.exponentialRampToValueAtTime(0.001, now + 0.025);

        blade.connect(bladeGain);
        bladeGain.connect(this.masterGain);
        blade.start(now);
        blade.stop(now + 0.03);

        // Component 2: Armor / Point-of-Contact Pierce (Bandpass Noise at 1600Hz)
        const bufferSize = Math.floor(ctx.sampleRate * duration);
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1);
        }

        const noise = ctx.createBufferSource();
        noise.buffer = buffer;

        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(1600, now);
        filter.Q.setValueAtTime(2.0, now);

        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(volume * 0.45, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(this.masterGain);

        noise.start(now);
        noise.stop(now + duration);

        // Component 3: Mechanical Spring Release Snap (Square 950Hz -> 320Hz over 15ms)
        const snap = ctx.createOscillator();
        const snapGain = ctx.createGain();
        snap.type = 'square';
        snap.frequency.setValueAtTime(950, now);
        snap.frequency.exponentialRampToValueAtTime(320, now + 0.015);

        snapGain.gain.setValueAtTime(volume * 0.3, now);
        snapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.015);

        snap.connect(snapGain);
        snapGain.connect(this.masterGain);
        snap.start(now);
        snap.stop(now + 0.02);

        // Component 4: Solid Base Thump (Triangle 190Hz -> 55Hz over 60ms)
        const thump = ctx.createOscillator();
        const thumpGain = ctx.createGain();
        thump.type = 'triangle';
        thump.frequency.setValueAtTime(190, now);
        thump.frequency.exponentialRampToValueAtTime(55, now + duration);

        thumpGain.gain.setValueAtTime(volume * 0.4, now);
        thumpGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

        thump.connect(thumpGain);
        thumpGain.connect(this.masterGain);
        thump.start(now);
        thump.stop(now + duration + 0.01);
    }

    playMortarShootSynth(volume = 0.45) {
        if (!this.sfxEnabled) return;
        const ctx = this.ensureContext();
        if (!ctx) return;
        volume = volume * this.getDynamicVolumeScale();
        const now = ctx.currentTime;
        const duration = 0.2; // 200ms hollow tube artillery thunk

        // Component 1: Hollow Tube Resonance (Triangle wave 240Hz -> 32Hz)
        const osc = ctx.createOscillator();
        const oscGain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(240, now);
        osc.frequency.exponentialRampToValueAtTime(32, now + duration);

        oscGain.gain.setValueAtTime(volume * 0.75, now);
        oscGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

        osc.connect(oscGain);
        oscGain.connect(this.masterGain);
        osc.start(now);
        osc.stop(now + duration + 0.01);

        // Component 2: Tube Acoustic Air Displacement (Bandpass Filtered Noise at 480Hz)
        const bufferSize = Math.floor(ctx.sampleRate * duration);
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1);
        }

        const noise = ctx.createBufferSource();
        noise.buffer = buffer;

        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(480, now);
        filter.Q.setValueAtTime(2.4, now);

        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(volume * 0.5, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(this.masterGain);

        noise.start(now);
        noise.stop(now + duration);

        // Component 3: Ignition Transient Pop (Square wave 380Hz -> 80Hz over 25ms)
        const popOsc = ctx.createOscillator();
        const popGain = ctx.createGain();
        popOsc.type = 'square';
        popOsc.frequency.setValueAtTime(380, now);
        popOsc.frequency.exponentialRampToValueAtTime(80, now + 0.025);

        popGain.gain.setValueAtTime(volume * 0.35, now);
        popGain.gain.exponentialRampToValueAtTime(0.001, now + 0.025);

        popOsc.connect(popGain);
        popGain.connect(this.masterGain);
        popOsc.start(now);
        popOsc.stop(now + 0.03);
    }

    playMortarExplosionSynth(volume = 0.5) {
        if (!this.sfxEnabled) return;
        const ctx = this.ensureContext();
        if (!ctx) return;
        volume = volume * this.getDynamicVolumeScale();
        const now = ctx.currentTime;
        const duration = 0.35; // 350ms heavy ground blast

        // Component 1: Earth Tremor Sub-Bass (Sine wave 160Hz -> 20Hz)
        const sub = ctx.createOscillator();
        const subGain = ctx.createGain();
        sub.type = 'sine';
        sub.frequency.setValueAtTime(160, now);
        sub.frequency.exponentialRampToValueAtTime(20, now + duration);

        subGain.gain.setValueAtTime(volume * 0.9, now);
        subGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

        sub.connect(subGain);
        subGain.connect(this.masterGain);
        sub.start(now);
        sub.stop(now + duration + 0.01);

        // Component 2: Debris & Shrapnel Blast Roar (Lowpass Noise 600Hz -> 60Hz)
        const bufferSize = Math.floor(ctx.sampleRate * duration);
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1);
        }

        const noise = ctx.createBufferSource();
        noise.buffer = buffer;

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(600, now);
        filter.frequency.exponentialRampToValueAtTime(60, now + duration);

        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(volume * 0.65, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(this.masterGain);

        noise.start(now);
        noise.stop(now + duration);
    }

    playTeslaZapSynth(volume = 0.35) {
        if (!this.sfxEnabled) return;
        const ctx = this.ensureContext();
        if (!ctx) return;
        volume = volume * this.getDynamicVolumeScale();
        const now = ctx.currentTime;
        const duration = 0.12; // 120ms sharp high-voltage arc zap

        // Component 1: High-Voltage Electrical Buzz (Sawtooth 180Hz -> 320Hz -> 90Hz pitch jitter)
        const osc = ctx.createOscillator();
        const oscGain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(180, now);
        osc.frequency.linearRampToValueAtTime(320, now + 0.03);
        osc.frequency.exponentialRampToValueAtTime(90, now + duration);

        oscGain.gain.setValueAtTime(volume * 0.5, now);
        oscGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

        osc.connect(oscGain);
        oscGain.connect(this.masterGain);
        osc.start(now);
        osc.stop(now + duration + 0.01);

        // Component 2: High-Frequency Spark Crackle / Ionization Snap (Highpass Noise at 3600Hz)
        const bufferSize = Math.floor(ctx.sampleRate * duration);
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            if (Math.random() < 0.3) {
                data[i] = (Math.random() * 2 - 1) * 0.9;
            } else {
                data[i] = (Math.random() * 2 - 1) * 0.1;
            }
        }

        const noise = ctx.createBufferSource();
        noise.buffer = buffer;

        const filter = ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.setValueAtTime(3600, now);

        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(volume * 0.55, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(this.masterGain);

        noise.start(now);
        noise.stop(now + duration);

        // Component 3: Rapid Arc Secondary Snap (Square wave 650Hz -> 140Hz at +25ms)
        const popOsc = ctx.createOscillator();
        const popGain = ctx.createGain();
        popOsc.type = 'square';
        popOsc.frequency.setValueAtTime(650, now + 0.025);
        popOsc.frequency.exponentialRampToValueAtTime(140, now + duration);

        popGain.gain.setValueAtTime(0.001, now);
        popGain.gain.setValueAtTime(volume * 0.35, now + 0.025);
        popGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

        popOsc.connect(popGain);
        popGain.connect(this.masterGain);
        popOsc.start(now + 0.025);
        popOsc.stop(now + duration + 0.01);
    }

    startFlameSound(tower) {
        if (!this.sfxEnabled || !tower) return false;
        const activeVoice = this.activeFlameVoices.get(tower);
        if (activeVoice) {
            this._renewFlameStop(tower, activeVoice);
            return true;
        }

        const voice = { nodes: [], gains: [], stopTimeout: null, stopped: false };
        this.activeFlameVoices.set(tower, voice);

        // Play smooth, calm continuous thermal hum
        this.playCalmFlameHumSynth(tower, voice);
        this._renewFlameStop(tower, voice);
        return true;
    }

    playCalmFlameHumSynth(tower, voice) {
        if (!this.sfxEnabled) return;
        const ctx = this.ensureContext();
        if (!ctx) return;
        const now = ctx.currentTime;

        // 1. Soft Thermal Hum (Triangle wave at 115Hz with smooth 5.5Hz vibrato)
        const osc = ctx.createOscillator();
        const lfo = ctx.createOscillator();
        const lfoGain = ctx.createGain();
        const oscGain = ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(115, now);

        // LFO for warm flame flutter
        lfo.type = 'sine';
        lfo.frequency.setValueAtTime(5.5, now);
        lfoGain.gain.setValueAtTime(6, now); // ±6Hz gentle pitch wobble
        lfo.connect(osc.frequency);

        oscGain.gain.setValueAtTime(0.001, now);
        oscGain.gain.linearRampToValueAtTime(0.12, now + 0.15); // Smooth 150ms fade-in

        osc.connect(oscGain);
        oscGain.connect(this.masterGain);
        osc.start(now);
        lfo.start(now);

        // 2. Muffled Soft Gas Flow (Lowpass Filtered Noise at 260Hz)
        const bufferSize = Math.floor(ctx.sampleRate * 2.0); // 2s loopable noise
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1);
        }

        const noise = ctx.createBufferSource();
        noise.buffer = buffer;
        noise.loop = true;

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(260, now);

        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(0.001, now);
        noiseGain.gain.linearRampToValueAtTime(0.08, now + 0.15);

        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(this.masterGain);
        noise.start(now);

        voice.nodes = [osc, lfo, noise];
        voice.gains = [oscGain, noiseGain];
    }

    _renewFlameStop(tower, voice) {
        clearTimeout(voice.stopTimeout);
        voice.stopTimeout = setTimeout(() => {
            if (this.activeFlameVoices.get(tower) === voice) {
                this.stopFlameSound(tower);
            }
        }, 250);
    }

    stopFlameSound(tower) {
        const voice = this.activeFlameVoices.get(tower);
        if (!voice) return;
        this.activeFlameVoices.delete(tower);
        clearTimeout(voice.stopTimeout);
        voice.stopped = true;

        const ctx = this.ctx;
        const now = ctx ? ctx.currentTime : 0;

        if (voice.gains && ctx) {
            voice.gains.forEach(g => {
                try {
                    g.gain.setTargetAtTime(0, now, 0.05); // Smooth 50ms fade out on stop
                } catch (e) {}
            });
            setTimeout(() => {
                if (voice.nodes) {
                    voice.nodes.forEach(n => { try { n.stop(); } catch (e) {} });
                }
            }, 100);
        } else if (voice.nodes) {
            voice.nodes.forEach(n => { try { n.stop(); } catch (e) {} });
        }
    }

    stopAllFlameSounds() {
        for (const tower of [...this.activeFlameVoices.keys()]) {
            this.stopFlameSound(tower);
        }
    }

    playLaserReadySynth(volume = 0.4) {
        if (!this.sfxEnabled) return;
        const ctx = this.ensureContext();
        if (!ctx) return;
        volume = volume * this.getDynamicVolumeScale();
        const now = ctx.currentTime;
        const duration = 0.28; // 280ms charge-up energy surge

        // Component 1: Ascending Sci-Fi Power Charge (Sine wave 220Hz -> 1600Hz)
        const charge = ctx.createOscillator();
        const chargeGain = ctx.createGain();
        charge.type = 'sine';
        charge.frequency.setValueAtTime(220, now);
        charge.frequency.exponentialRampToValueAtTime(1600, now + 0.22);

        chargeGain.gain.setValueAtTime(volume * 0.4, now);
        chargeGain.gain.linearRampToValueAtTime(volume * 0.8, now + 0.22);
        chargeGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

        charge.connect(chargeGain);
        chargeGain.connect(this.masterGain);
        charge.start(now);
        charge.stop(now + duration + 0.01);

        // Component 2: High Voltage Energy Lock-In Spark (Square wave 1200Hz -> 2400Hz at peak)
        const spark = ctx.createOscillator();
        const sparkGain = ctx.createGain();
        spark.type = 'square';
        spark.frequency.setValueAtTime(1200, now + 0.18);
        spark.frequency.exponentialRampToValueAtTime(2400, now + 0.25);

        sparkGain.gain.setValueAtTime(0.001, now);
        sparkGain.gain.setValueAtTime(volume * 0.5, now + 0.18);
        sparkGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

        spark.connect(sparkGain);
        sparkGain.connect(this.masterGain);
        spark.start(now + 0.18);
        spark.stop(now + duration + 0.01);

        // Component 3: Harmonic Energy Chime (Triangle wave 440Hz -> 3200Hz)
        const chime = ctx.createOscillator();
        const chimeGain = ctx.createGain();
        chime.type = 'triangle';
        chime.frequency.setValueAtTime(440, now + 0.1);
        chime.frequency.exponentialRampToValueAtTime(3200, now + 0.25);

        chimeGain.gain.setValueAtTime(0.001, now);
        chimeGain.gain.setValueAtTime(volume * 0.35, now + 0.1);
        chimeGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

        chime.connect(chimeGain);
        chimeGain.connect(this.masterGain);
        chime.start(now + 0.1);
        chime.stop(now + duration + 0.01);
    }

    playLaserSynth(volume = 0.35) {
        if (!this.sfxEnabled) return;
        const ctx = this.ensureContext();
        if (!ctx) return;
        volume = volume * this.getDynamicVolumeScale();
        const now = ctx.currentTime;
        const duration = 0.14; // 140ms high-tech laser beam zap

        // Component 1: Bright Glassy Energy Beam (Sawtooth 1450Hz with 45Hz vibrato)
        const osc = ctx.createOscillator();
        const lfo = ctx.createOscillator();
        const lfoGain = ctx.createGain();
        const oscGain = ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(1450, now);
        osc.frequency.exponentialRampToValueAtTime(650, now + duration);

        lfo.type = 'sine';
        lfo.frequency.setValueAtTime(45, now);
        lfoGain.gain.setValueAtTime(80, now);
        lfo.connect(osc.frequency);

        oscGain.gain.setValueAtTime(volume * 0.5, now);
        oscGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

        osc.connect(oscGain);
        oscGain.connect(this.masterGain);
        osc.start(now);
        lfo.start(now);
        osc.stop(now + duration + 0.01);
        lfo.stop(now + duration + 0.01);

        // Component 2: Thermal Ionization Crackle (Highpass Noise at 3200Hz)
        const bufferSize = Math.floor(ctx.sampleRate * duration);
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1);
        }

        const noise = ctx.createBufferSource();
        noise.buffer = buffer;

        const filter = ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.setValueAtTime(3200, now);

        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(volume * 0.4, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(this.masterGain);

        noise.start(now);
        noise.stop(now + duration);
    }

    playSniperSynth(volume = 0.45) {
        if (!this.sfxEnabled) return;
        const ctx = this.ensureContext();
        if (!ctx) return;
        const now = ctx.currentTime;
        const duration = 0.28; // 280ms high-caliber sniper shot with distance echo tail

        // Component 1: Supersonic Crack (Triangle 3200Hz -> 450Hz over 25ms)
        const crack = ctx.createOscillator();
        const crackGain = ctx.createGain();
        crack.type = 'triangle';
        crack.frequency.setValueAtTime(3200, now);
        crack.frequency.exponentialRampToValueAtTime(450, now + 0.025);

        crackGain.gain.setValueAtTime(volume * 0.7, now);
        crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.025);

        crack.connect(crackGain);
        crackGain.connect(this.masterGain);
        crack.start(now);
        crack.stop(now + 0.03);

        // Component 2: High-Caliber Breech Recoil (Sine 180Hz -> 28Hz over 220ms)
        const sub = ctx.createOscillator();
        const subGain = ctx.createGain();
        sub.type = 'sine';
        sub.frequency.setValueAtTime(180, now);
        sub.frequency.exponentialRampToValueAtTime(28, now + 0.22);

        subGain.gain.setValueAtTime(volume * 0.8, now);
        subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

        sub.connect(subGain);
        subGain.connect(this.masterGain);
        sub.start(now);
        sub.stop(now + 0.23);

        // Component 3: Distance Rifle Echo Tail (Bandpass Noise at 900Hz decaying over 280ms)
        const bufferSize = Math.floor(ctx.sampleRate * duration);
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1);
        }

        const noise = ctx.createBufferSource();
        noise.buffer = buffer;

        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(900, now);
        filter.Q.setValueAtTime(1.6, now);

        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(volume * 0.5, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(this.masterGain);

        noise.start(now);
        noise.stop(now + duration);
    }

    _playRandomClip(clips, onUnavailable, volume = 0.35, priority = 10, turret = null, balanceKey = 'generic') {
        if (!this.sfxEnabled || !clips || clips.length === 0) return false;

        this._stopOneShotsBelowPriority(priority);
        // Drop low-priority effects when the real-time voice budget is full.
        // Fast-forward creates more gameplay events, but should not create audio clutter.
        if (this.activeOneShotVoices.size >= this.maxOneShotVoices) return true;

        const src = clips[Math.floor(Math.random() * clips.length)];
        const active = { source: null, gain: null, baseVolume: volume, balanceKey, priority, turret, cancelled: false };
        this.activeOneShotVoices.add(active);
        if (turret) this.activeTurretOneShotVoices.add(active);
        this._playBufferSource(src, { volume }).then(voice => {
            if (!voice) {
                this.activeOneShotVoices.delete(active);
                this.activeTurretOneShotVoices.delete(active);
                if (!active.cancelled) onUnavailable?.();
                return;
            }
            if (active.cancelled) {
                try { voice.source.stop(); } catch {}
                return;
            }
            active.source = voice.source;
            active.gain = voice.gain;
            this._rebalanceAllTowerVoices();
            voice.source.addEventListener('ended', () => this.activeOneShotVoices.delete(active), { once: true });
            voice.source.addEventListener('ended', () => {
                this.activeTurretOneShotVoices.delete(active);
                this._rebalanceAllTowerVoices();
            }, { once: true });
        });
        return true;
    }

    _stopOneShotsBelowPriority(priority) {
        for (const active of [...this.activeOneShotVoices]) {
            if (active.priority >= priority) continue;
            this.activeOneShotVoices.delete(active);
            this.activeTurretOneShotVoices.delete(active);
            active.cancelled = true;
            if (active.source) {
                try { active.source.stop(); } catch {}
            }
        }
    }

    stopAllOneShotSounds() {
        for (const active of [...this.activeOneShotVoices]) {
            this.activeOneShotVoices.delete(active);
            this.activeTurretOneShotVoices.delete(active);
            active.cancelled = true;
            if (active.source) {
                try { active.source.stop(); } catch {}
            }
        }
    }

    _stealOldestVoice(voices, limit, stopVoice) {
        if (voices.size < limit) return;
        const oldestOwner = voices.keys().next().value;
        if (oldestOwner) stopVoice.call(this, oldestOwner);
    }

    _rebalanceAllTowerVoices() {
        const activeVoices = [
            ...this.activeMachineGunVoices.values(),
            ...this.activeTeslaVoices.values(),
            ...this.activeAAMissileVoices.values(),
            ...this.activeTurretOneShotVoices,
        ];
        const voicesByType = new Map();
        for (const voice of activeVoices) {
            const typeVoices = voicesByType.get(voice.balanceKey) || [];
            typeVoices.push(voice);
            voicesByType.set(voice.balanceKey, typeVoices);
        }
        for (const typeVoices of voicesByType.values()) {
            const count = typeVoices.length;
            typeVoices.forEach(voice => {
            if (!voice.gain || !this.ctx) return;
            const scale = Math.min(1, 1.5 / count);
            voice.gain.gain.setTargetAtTime(
                voice.baseVolume * scale,
                this.ctx.currentTime,
                0.015
            );
            });
        }
    }

    startMachineGunSound(tower) {
        if (!this.sfxEnabled || !tower) return false;
        const activeVoice = this.activeMachineGunVoices.get(tower);
        if (activeVoice) {
            this._renewMachineGunStop(tower, activeVoice);
            return true;
        }
        const clips = this.weaponClips.machinegun;
        if (!clips || clips.length === 0) return false;
        this._stealOldestVoice(this.activeMachineGunVoices, this.maxMachineGunVoices, this.stopMachineGunSound);

        const voice = { source: null, gain: null, baseVolume: 0.0875, balanceKey: 'machinegun', stopTimeout: null, stopped: false };
        this.activeMachineGunVoices.set(tower, voice);
        this._rebalanceAllTowerVoices();
        this._playBufferSource(clips[0], { volume: voice.baseVolume, loop: true }).then(playing => {
            if (!playing || voice.stopped) {
                if (playing) { try { playing.source.stop(); } catch {} }
                if (this.activeMachineGunVoices.get(tower) === voice) {
                    this.activeMachineGunVoices.delete(tower);
                    this._rebalanceAllTowerVoices();
                }
                if (!voice.stopped) this.playMachineGunSynth(0.2);
                return;
            }
            voice.source = playing.source;
            voice.gain = playing.gain;
            this._rebalanceAllTowerVoices();
        });
        this._renewMachineGunStop(tower, voice);
        return true;
    }

    _renewMachineGunStop(tower, voice) {
        clearTimeout(voice.stopTimeout);
        voice.stopTimeout = setTimeout(() => {
            if (this.activeMachineGunVoices.get(tower) === voice) {
                this.stopMachineGunSound(tower);
            }
        }, 250);
    }

    stopMachineGunSound(tower) {
        const voice = this.activeMachineGunVoices.get(tower);
        if (!voice) return;
        this.activeMachineGunVoices.delete(tower);
        this._rebalanceAllTowerVoices();
        voice.stopped = true;
        clearTimeout(voice.stopTimeout);
        if (voice.source) {
            try { voice.source.stop(); } catch {}
        }
    }

    stopAllMachineGunSounds() {
        for (const tower of [...this.activeMachineGunVoices.keys()]) {
            this.stopMachineGunSound(tower);
        }
    }

    playTeslaZap(tower, durationMs) {
        if (!this.sfxEnabled || !tower) return false;
        this.stopTeslaZap(tower);
        const clips = this.weaponClips.tesla;
        if (!clips || clips.length === 0) return false;

        this._stealOldestVoice(this.activeTeslaVoices, this.maxTeslaVoices, this.stopTeslaZap);
        const voice = { source: null, gain: null, baseVolume: 0.35, balanceKey: 'tesla', stopped: false, timeoutId: null };
        this.activeTeslaVoices.set(tower, voice);
        this._rebalanceAllTowerVoices();
        this._playBufferSource(clips[0], { volume: voice.baseVolume }).then(playing => {
            if (!playing || voice.stopped) {
                if (playing) { try { playing.source.stop(); } catch {} }
                if (this.activeTeslaVoices.get(tower) === voice) {
                    this.activeTeslaVoices.delete(tower);
                    this._rebalanceAllTowerVoices();
                }
                if (!voice.stopped) this.playTeslaZapSynth(0.35);
                return;
            }
            voice.source = playing.source;
            voice.gain = playing.gain;
            this._rebalanceAllTowerVoices();
            playing.source.addEventListener('ended', () => {
                if (this.activeTeslaVoices.get(tower) === voice) {
                    this.activeTeslaVoices.delete(tower);
                    this._rebalanceAllTowerVoices();
                }
            }, { once: true });
        });
        voice.timeoutId = setTimeout(() => this.stopTeslaZap(tower), Math.max(1, durationMs));
        return true;
    }

    stopTeslaZap(tower) {
        const voice = this.activeTeslaVoices.get(tower);
        if (!voice) return;
        this.activeTeslaVoices.delete(tower);
        this._rebalanceAllTowerVoices();
        voice.stopped = true;
        clearTimeout(voice.timeoutId);
        if (voice.source) {
            try { voice.source.stop(); } catch {}
        }
    }

    stopAllTeslaZaps() {
        for (const tower of [...this.activeTeslaVoices.keys()]) {
            this.stopTeslaZap(tower);
        }
    }

    startAAMissileSound(projectile) {
        if (!this.sfxEnabled || !projectile) return false;
        const clips = this.weaponClips.aa;
        if (!clips || clips.length === 0) return false;

        this._stealOldestVoice(this.activeAAMissileVoices, this.maxAAMissileVoices, this.stopAAMissileSound);
        const voice = { source: null, gain: null, baseVolume: 0.35, balanceKey: 'aa', stopped: false };
        this.activeAAMissileVoices.set(projectile, voice);
        this._rebalanceAllTowerVoices();
        this._playBufferSource(clips[0], { volume: voice.baseVolume, loop: true }).then(playing => {
            if (!playing || voice.stopped) {
                if (playing) { try { playing.source.stop(); } catch {} }
                if (this.activeAAMissileVoices.get(projectile) === voice) {
                    this.activeAAMissileVoices.delete(projectile);
                    this._rebalanceAllTowerVoices();
                }
                if (!voice.stopped) this.playAAGunSynth(0.12);
                return;
            }
            voice.source = playing.source;
            voice.gain = playing.gain;
            this._rebalanceAllTowerVoices();
        });
        return true;
    }

    stopAAMissileSound(projectile) {
        const voice = this.activeAAMissileVoices.get(projectile);
        if (!voice) return;
        this.activeAAMissileVoices.delete(projectile);
        this._rebalanceAllTowerVoices();
        voice.stopped = true;
        if (voice.source) {
            try { voice.source.stop(); } catch {}
        }
    }

    stopAllAAMissileSounds() {
        for (const projectile of [...this.activeAAMissileVoices.keys()]) {
            this.stopAAMissileSound(projectile);
        }
    }

    // --- Background Music Management with Extended Fade Transitions ---

    _attachMusicVisibilityHandler() {
        if (this._visibilityBound || !document) return;
        this._visibilityBound = () => {
            if (document.hidden) return;
            if (!this.musicEnabled) return;
            // Resume the same element only — never allocate a new track
            if (this.bgMusicAudio && (this.bgMusicAudio.paused || this.bgMusicAudio.ended)) {
                this.fadeInMusic(800);
            }
        };
        document.addEventListener('visibilitychange', this._visibilityBound);
    }

    _attachAutoplayResumeListener() {
        if (!window) return;
        if (this._autoplayBound) {
            window.removeEventListener('pointerdown', this._autoplayBound);
            window.removeEventListener('touchstart', this._autoplayBound);
            window.removeEventListener('keydown', this._autoplayBound);
            window.removeEventListener('click', this._autoplayBound);
        }
        this._autoplayBound = () => {
            if (this._autoplayBound) {
                window.removeEventListener('pointerdown', this._autoplayBound);
                window.removeEventListener('touchstart', this._autoplayBound);
                window.removeEventListener('keydown', this._autoplayBound);
                window.removeEventListener('click', this._autoplayBound);
                this._autoplayBound = null;
            }
            if (this.musicEnabled) {
                this.playRandomMusic();
            }
        };
        window.addEventListener('pointerdown', this._autoplayBound, { passive: true });
        window.addEventListener('touchstart', this._autoplayBound, { passive: true });
        window.addEventListener('keydown', this._autoplayBound, { passive: true });
        window.addEventListener('click', this._autoplayBound, { passive: true });
    }

    _ensureMusicElement() {
        if (this.bgMusicAudio) return this.bgMusicAudio;
        if (SoundManager._sharedBgMusic) {
            this.bgMusicAudio = SoundManager._sharedBgMusic;
            return this.bgMusicAudio;
        }
        const audio = new Audio();
        audio.preload = 'auto';
        audio.loop = false;
        this._musicTimeUpdateBound = () => this._onMusicTimeUpdate();
        audio.addEventListener('timeupdate', this._musicTimeUpdateBound);
        this.bgMusicAudio = audio;
        SoundManager._sharedBgMusic = audio;
        return audio;
    }

    _onMusicTimeUpdate() {
        const audio = this.bgMusicAudio;
        if (!audio || !audio.duration) return;
        const remaining = audio.duration - audio.currentTime;

        // Trigger long fade out during last 6 seconds of the track
        if (remaining <= 6.0 && !this._nearEndFading && this.musicEnabled) {
            this._nearEndFading = true;
            this._fadeVolume(0, 5000);
        }

        // Loop back to start when track finishes — reuse the same element
        if (audio.currentTime >= audio.duration - 0.25 || audio.ended) {
            this._nearEndFading = false;
            try { audio.currentTime = 0; } catch (e) {}
            audio.volume = 0;
            if (this.musicEnabled) {
                const p = audio.play();
                if (p && p.catch) p.catch(() => {});
                this.fadeInMusic(5000);
            }
        }
    }

    _fadeVolume(targetVol, durationMs = 4000, onComplete = null) {
        if (this._musicFadeInterval) {
            clearInterval(this._musicFadeInterval);
            this._musicFadeInterval = null;
        }

        if (!this.bgMusicAudio) {
            if (onComplete) onComplete();
            return;
        }

        const startVol = this.bgMusicAudio.volume;
        const diff = targetVol - startVol;
        if (Math.abs(diff) < 0.01) {
            this.bgMusicAudio.volume = targetVol;
            if (onComplete) onComplete();
            return;
        }

        const intervalMs = 30;
        const steps = durationMs / intervalMs;
        const stepChange = diff / steps;
        let currentStep = 0;
        const token = this._musicPlayToken;

        this._musicFadeInterval = setInterval(() => {
            if (!this.bgMusicAudio || token !== this._musicPlayToken) {
                clearInterval(this._musicFadeInterval);
                this._musicFadeInterval = null;
                return;
            }

            currentStep++;
            let newVol = startVol + stepChange * currentStep;
            newVol = Math.max(0, Math.min(1, newVol));
            this.bgMusicAudio.volume = newVol;

            if (currentStep >= steps || Math.abs(newVol - targetVol) < 0.01) {
                this.bgMusicAudio.volume = targetVol;
                clearInterval(this._musicFadeInterval);
                this._musicFadeInterval = null;
                if (onComplete) onComplete();
            }
        }, intervalMs);
    }

    fadeInMusic(durationMs = 2500) {
        if (!this.musicEnabled) return;
        const audio = this._ensureMusicElement();
        if (!audio) return;
        if (audio.paused || audio.ended) {
            audio.volume = 0;
            const p = audio.play();
            if (p && p.catch) {
                p.catch(() => {
                    this._attachAutoplayResumeListener();
                });
            }
        }
        this._fadeVolume(this.musicTargetVolume(), durationMs);
    }

    fadeOutMusic(durationMs = 4000, stopAfter = true) {
        const token = this._musicPlayToken;
        this._fadeVolume(0, durationMs, () => {
            if (stopAfter && token === this._musicPlayToken) this.stopMusic();
        });
    }

    async playMusic(src, targetVol = this.musicTargetVolume(), fadeInMs = 2500) {
        if (!this.musicEnabled || !src) return false;

        const audio = this._ensureMusicElement();
        const alreadyThisTrack = this.currentMusicPath === src && audio;
        const isActive = alreadyThisTrack && !audio.paused && !audio.ended;

        // Reuse the singleton — never allocate a second element for the same track
        if (alreadyThisTrack) {
            if (!isActive) this.fadeInMusic(fadeInMs);
            return true;
        }

        if (this._musicStarting) {
            return this._musicStartPromise || true;
        }

        this._musicStarting = true;
        this._musicPlayToken = (this._musicPlayToken || 0) + 1;
        const token = this._musicPlayToken;

        if (this._musicFadeInterval) {
            clearInterval(this._musicFadeInterval);
            this._musicFadeInterval = null;
        }

        this.currentMusicPath = src;
        SoundManager._sharedMusicPath = src;

        const run = async () => {
            try {
                // Pause any current playback on the shared element, then (re)load src if needed
                try {
                    if (!audio.paused) audio.pause();
                } catch (e) {}

                const abs = (() => {
                    try { return new URL(src, document.baseURI || window.location.href).href; }
                    catch (e) { return src; }
                })();
                // audio.src is always absolute; only reload when the track actually changes
                if (audio.src !== abs && audio.getAttribute('src') !== src) {
                    audio.src = src;
                }
                audio.loop = false;
                audio.volume = 0;
                this._nearEndFading = false;
                try { audio.currentTime = 0; } catch (e) {}

                const playPromise = audio.play();
                if (playPromise !== undefined) {
                    await playPromise;
                }
                if (token !== this._musicPlayToken) return false;
                if (this.musicEnabled) {
                    this.fadeInMusic(fadeInMs);
                }
                return true;
            } catch (e) {
                console.warn("Background music play failed (awaiting user interaction):", e);
                try { if (audio && !audio.paused) audio.pause(); } catch (err) {}
                this.currentMusicPath = src; // keep desired track so a later resume reuses this element
                SoundManager._sharedMusicPath = src;
                this._attachAutoplayResumeListener();
                return false;
            } finally {
                if (token === this._musicPlayToken) {
                    this._musicStarting = false;
                    this._musicStartPromise = null;
                }
            }
        };

        this._musicStartPromise = run();
        return this._musicStartPromise;
    }

    stopMusic() {
        if (this._musicFadeInterval) {
            clearInterval(this._musicFadeInterval);
            this._musicFadeInterval = null;
        }
        this._musicPlayToken = (this._musicPlayToken || 0) + 1;
        this._musicStarting = false;
        this._musicStartPromise = null;
        const audio = this.bgMusicAudio || SoundManager._sharedBgMusic;
        if (audio) {
            try {
                audio.pause();
                audio.currentTime = 0;
            } catch (e) {}
            this.bgMusicAudio = audio; // keep the singleton element
        }
        this.currentMusicPath = null;
        SoundManager._sharedMusicPath = null;
        this._nearEndFading = false;
    }

    updateMusicVolume(enabled) {
        this.musicEnabled = enabled;
        if (enabled) {
            if (this.bgMusicAudio && this.currentMusicPath) {
                this.fadeInMusic(2500);
            } else {
                this.playRandomMusic();
            }
        } else {
            this.fadeOutMusic(2500, true);
        }
    }

    playRandomMusic() {
        if (!this.musicEnabled) return;
        if (!this.musicTracks || this.musicTracks.length === 0) return;
        // Already playing or a start is in flight — do not create/start another track
        if (this._musicStarting) return this._musicStartPromise;
        const audio = this.bgMusicAudio || SoundManager._sharedBgMusic;
        if (audio && this.currentMusicPath && !audio.paused && !audio.ended) {
            return;
        }
        const src = (this.currentMusicPath && this.musicTracks.indexOf(this.currentMusicPath) >= 0)
            ? this.currentMusicPath
            : this.musicTracks[0];
        return this.playMusic(src);
    }

    playButtonClick() {
        if (!this.sfxEnabled) return;
        if (!this.ensureContext()) return;
        const now = this.ctx.currentTime;
        const base = this.masterGain;
        const osc1 = this.ctx.createOscillator();
        const osc2 = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc1.type = 'square';
        osc2.type = 'triangle';
        osc1.frequency.setValueAtTime(720, now);
        osc2.frequency.setValueAtTime(1080, now);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.08, now + 0.002);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(base);
        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 0.12);
        osc2.stop(now + 0.12);
    }

    playPlacement(isWater = false) {
        const freq = isWater ? 780 : 640;
        const vol = isWater ? 0.07 : 0.09;
        this._startTone(freq, 0.14, { type: 'sine', volume: vol, glide: 1.05 });
    }

    playLilypadPlacement() {
        this._playRandomClip(this.weaponClips.Lilypad, null, 0.35, 10, null, 'Lilypad');
    }

    playLaserAction() {
        // v5.19: the laser beam is silent while firing; the lightsaber ignite plays once when it is built.
    }

    // v5.19 volume sliders
    musicTargetVolume() { return 0.25 * this.musicVolume * 2; }
    setSfxVolume(v) {
        this.sfxVolume = Math.max(0, Math.min(1, v));
        this.sfxEnabled = this.sfxVolume > 0;
        if (this.masterGain) this.masterGain.gain.value = 0.35 * this.sfxVolume * 2;
    }
    setMusicVolume(v) {
        this.musicVolume = Math.max(0, Math.min(1, v));
        this.musicEnabled = this.musicVolume > 0;
        if (this.bgMusicAudio && !this.bgMusicAudio.paused && !this._musicFadeInterval) this.bgMusicAudio.volume = Math.min(1, this.musicTargetVolume());
    }

    // v5.19: synthesized lightsaber ignite + short hum (no audio files, nothing copyrighted). Plays once.
    playLightsaberIgnite(volume = 0.5) {
        if (!this.sfxEnabled) return;
        const ctx = this.ensureContext();
        if (!ctx) return;
        const now = ctx.currentTime, dur = 1.1;
        const out = ctx.createGain();
        out.gain.setValueAtTime(0.0001, now);
        out.gain.exponentialRampToValueAtTime(volume, now + 0.06);
        out.gain.setValueAtTime(volume, now + 0.35);
        out.gain.linearRampToValueAtTime(volume * 0.55, now + 0.6);
        out.gain.exponentialRampToValueAtTime(0.0001, now + dur);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.Q.value = 6;
        lp.frequency.setValueAtTime(300, now);
        lp.frequency.exponentialRampToValueAtTime(2400, now + 0.18);
        lp.frequency.exponentialRampToValueAtTime(900, now + 0.5);
        lp.connect(out); out.connect(this.masterGain);
        [[1, 'sawtooth', 0.5], [1.012, 'sawtooth', 0.4], [2, 'square', 0.12]].forEach(([m, type, g]) => {
            const o = ctx.createOscillator(), og = ctx.createGain();
            o.type = type;
            o.frequency.setValueAtTime(55 * m, now);
            o.frequency.exponentialRampToValueAtTime(130 * m, now + 0.16);
            o.frequency.exponentialRampToValueAtTime(92 * m, now + 0.45);
            og.gain.value = g;
            o.connect(og); og.connect(lp);
            o.start(now); o.stop(now + dur + 0.05);
        });
        // ignition "whoosh": band-passed noise sweeping up
        const len = Math.floor(ctx.sampleRate * 0.4), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
        const n = ctx.createBufferSource(); n.buffer = buf;
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.5;
        bp.frequency.setValueAtTime(400, now); bp.frequency.exponentialRampToValueAtTime(3500, now + 0.3);
        const ng = ctx.createGain(); ng.gain.setValueAtTime(volume * 0.5, now); ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
        n.connect(bp); bp.connect(ng); ng.connect(this.masterGain);
        n.start(now); n.stop(now + 0.4);
    }

    playMortarExplosion() {
        const played = this._playRandomClip(this.weaponClips.mortarExplosion, () => this.playMortarExplosionSynth(0.5));
        if (!played) this.playMortarExplosionSynth(0.5);
    }

    playCastleDeath() {
        if (this._castleDeathSfxPlaying) return;
        this._castleDeathSfxPlaying = true;

        // 1. Instantly cut background music and all active weapon SFX
        this.stopMusic();
        this.stopAllOneShotSounds();
        this.stopAllMachineGunSounds();
        this.stopAllTeslaZaps();
        this.stopAllAAMissileSounds();
        this.stopAllFlameSounds();

        // 2. Play Castle Death sound effect at FULL max volume (1.0), cropping the first 0.7s offset
        try {
            if (this.sfxVolume <= 0) throw 0;
            const sfx = new Audio(encodeURI('audio/sfx/Fahhh Castle Death.mp3'));
            sfx.volume = Math.min(1, this.sfxVolume * 2);
            sfx.currentTime = 0.7; // Crop the first 0.7 seconds
            sfx.play().catch(e => {
                console.warn("Castle Death HTML5 play warning, falling back to Web Audio:", e);
                this._playBufferSource('audio/sfx/Fahhh Castle Death.mp3', { volume: 1.0, offset: 0.7 });
            });
        } catch (e) {
            if (this.sfxVolume > 0) this._playBufferSource('audio/sfx/Fahhh Castle Death.mp3', { volume: 1.0, offset: 0.7 });
        }

        // Reset flag after 3 seconds for future game runs
        setTimeout(() => {
            this._castleDeathSfxPlaying = false;
        }, 3000);
    }

    playGameOver() {
        this.playCastleDeath();
    }

    playCountdownTick() {
        this._startTone(880, 0.06, { type: 'square', volume: 0.05, glide: 1.04 });
    }

    playCountdownFinal() {
        this._startTone(660, 0.08, { type: 'triangle', volume: 0.06, glide: 1.08 });
        this._startTone(920, 0.12, { type: 'sine', volume: 0.05, glide: 1.12 });
    }

    playCastlePlacement(rejected = false) {
        if (rejected) {
            this._startTone(220, 0.08, { type: 'sawtooth', volume: 0.04, glide: 0.9 });
            return;
        }
        this._startTone(520, 0.1, { type: 'triangle', volume: 0.06, glide: 1.08 });
        this._startTone(780, 0.12, { type: 'sine', volume: 0.05, glide: 1.12 });
    }

    playSpeedChange(speedMultiplier) {
        if (speedMultiplier > 1) {
            this._startTone(480, 0.08, { type: 'square', volume: 0.05, glide: 1.35 });
            let freq = 720;
            if (speedMultiplier === 4) freq = 900;
            else if (speedMultiplier === 8) freq = 1080;
            this._startTone(freq, 0.12, { type: 'triangle', volume: 0.05, glide: 1.16 });
            return;
        }
        this._startTone(620, 0.1, { type: 'triangle', volume: 0.05, glide: 0.78 });
        this._startTone(400, 0.13, { type: 'sine', volume: 0.04, glide: 0.88 });
    }

    playRoundStart() {
        this._startTone(620, 0.16, { type: 'triangle', volume: 0.09, glide: 1.18 });
        this._startTone(780, 0.12, { type: 'sine', volume: 0.08, glide: 1.10 });
    }

    playPause() {
        this._startTone(420, 0.1, { type: 'sine', volume: 0.07 });
        this._startTone(320, 0.14, { type: 'triangle', volume: 0.06, glide: 0.92 });
    }

    playResume() {
        this._startTone(320, 0.1, { type: 'triangle', volume: 0.06 });
        this._startTone(450, 0.14, { type: 'sine', volume: 0.06, glide: 1.16 });
    }

    playCastleDamage() {
        this._playNoiseBurst({ volume: 0.28, duration: 0.18, filterFreq: 300 });
        this._startTone(160, 0.18, { type: 'sawtooth', volume: 0.08, glide: 0.65 });
    }

    playUpgradeComplete() {
        this._playRandomClip(this.weaponClips.upgrade, null);
    }

    playWaveComplete() {
        this._startTone(540, 0.14, { type: 'triangle', volume: 0.07, glide: 1.18 });
        this._startTone(660, 0.18, { type: 'sine', volume: 0.06, glide: 1.12 });
        this._startTone(820, 0.2, { type: 'square', volume: 0.05, glide: 1.08 });
    }

    playWeaponSound(towerType = 'machinegun', tower, projectile = null) {
        const type = String(towerType || 'machinegun').toLowerCase();
        if (type === 'machinegun') {
            this.startMachineGunSound(tower);
        } else if (type === 'cannon') {
            const played = this._playRandomClip(this.weaponClips.cannon, () => this.playCannonSynth(0.45), 0.45, 10, tower, 'cannon');
            if (!played) this.playCannonSynth(0.45);
        } else if (type === 'sniper') {
            const played = this._playRandomClip(this.weaponClips.sniper, () => this.playSniperSynth(0.45), 0.45, 10, tower, 'sniper');
            if (!played) this.playSniperSynth(0.45);
        } else if (type === 'aa') {
            const played = this.startAAMissileSound(projectile || tower);
            if (!played) this.playAAGunSynth(0.12);
        } else if (type === 'mortar') {
            const played = this._playRandomClip(this.weaponClips.mortarShoot, () => this.playMortarShootSynth(0.45), 0.5, 10, tower, 'mortar');
            if (!played) this.playMortarShootSynth(0.45);
        } else if (type === 'tesla') {
            const played = this.playTeslaZap(tower, 120);
            if (!played) this.playTeslaZapSynth(0.35);
        } else if (type === 'frost') {
            const played = this._playRandomClip(this.weaponClips.frost, () => this.playFrostSynth(0.28), 0.35, 10, tower, 'frost');
            if (!played) this.playFrostSynth(0.28);
        } else if (type === 'laser') {
            this.playLaserAction();
        } else if (type === 'flame') {
            this.startFlameSound(tower);
        } else if (type === 'spike') {
            this.playSpikeStabSynth(0.35);
        } else {
            this._startTone(760, 0.1, { type: 'triangle', volume: 0.06, glide: 1.08 });
        }
    }
}
