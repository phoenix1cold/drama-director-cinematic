/**
 * Drama Director - Foundry VTT Module V13
 * @version 4.0.0
 */

import {
  executeSinCityIntro, skipSinCityIntro,
  executeMacheteIntro, skipMacheteIntro,
  executeMacheteBloodIntro, skipMacheteBloodIntro,
  executeSnatchIntro, skipSnatchIntro,
  executeSciFiIntro, skipSciFiIntro,
  executeDetectiveIntro, skipDetectiveIntro,
} from './introductions.mjs';
// Endings (outro) sequences removed — module split now lives without them.
// JoJo Session Recorder + ability-trigger attack-roll parser also removed
// along with the endings panel that consumed them.
// Cross-module bridges (visual-novel and footsteps now live in their own modules):
//   - VN: read presence via game.modules.get('drama-director-novella')?.active and call globalThis.DDVNApi
//   - Footsteps: read presence via game.modules.get('drama-director-footsteps')?.active
function _vn() {
  if (!game.modules.get('drama-director-novella')?.active) return null;
  return globalThis.DDVNApi ?? null;
}
function _vnEmotionManager() {
  if (!game.modules.get('drama-director-novella')?.active) return null;
  return globalThis.DDVNEmotionManager ?? null;
}
function _vnMic() {
  if (!game.modules.get('drama-director-novella')?.active) return null;
  return globalThis.DDVNMic ?? null;
}
function _vnOverlay() {
  if (!game.modules.get('drama-director-novella')?.active) return null;
  return globalThis.DDVNOverlay ?? null;
}
function _vnIsOpen() {
  if (!game.modules.get('drama-director-novella')?.active) return false;
  return typeof globalThis.isVNOpen === 'function' ? !!globalThis.isVNOpen() : false;
}
// Sidebar / panels are now provided by drama-director-hub and registered
// from main.mjs of this module.

const MODULE_ID = 'drama-director-cinematic';
const SOCKET_EVENT = `module.${MODULE_ID}`;

// ── Language override ────────────────────────────────────────────────────────
// Stored as a Promise so _prepareContext can await it before rendering.
let _ddLangPromise = Promise.resolve();

// Export the promise so other modules can await it
export function getLanguagePromise() { return _ddLangPromise; }

function _ddDeepMerge(target, src) {
  for (const key of Object.keys(src)) {
    const val = src[key];
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      if (typeof target[key] !== 'object' || target[key] === null) target[key] = {};
      _ddDeepMerge(target[key], val);
    } else {
      target[key] = val;
    }
  }
}

// i18nInit fires after Foundry loads its own lang files — ideal place to inject ours.
// NOTE: Foundry does NOT await async hooks, so we store a Promise instead of using async.
// By this point 'init' has already fired, so game.settings.get() works fine.
Hooks.once('i18nInit', () => {
  let langPref = 'auto';
  try {
    langPref = game.settings.get(MODULE_ID, 'language') ?? 'auto';
  } catch(e) {
    // Fallback: try reading raw localStorage with multiple possible key formats
    langPref = localStorage.getItem(`${MODULE_ID}.language`)
            ?? localStorage.getItem(`client.${MODULE_ID}.language`)
            ?? 'auto';
  }

  if (langPref === 'auto') return;

  _ddLangPromise = fetch(`modules/${MODULE_ID}/lang/${langPref}.json`)
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then(data => {
      _ddDeepMerge(game.i18n.translations, data);
      console.log(`Drama Director | Language override applied: ${langPref}`);
    })
    .catch(e => console.warn(`Drama Director | Language load failed (${langPref}):`, e));
});

// ═══════════════════════════════════════════════════════════════════════════
// MAP EFFECTS (DramaDirector)
// ═══════════════════════════════════════════════════════════════════════════

class DramaDirector {
  constructor() {
    this.activeEffects = new Map();
    this.audioContext  = null;
    this._currentAudio = null;
    this._filmRaf      = null;
    this.initialized   = false;
  }

  init() {
    if (this.initialized) return;
    console.log('Drama Director | Initializing v4.0.0...');
    this._registerSettings();
    this._createOverlays();
    this._setupSocketListener();
    this.initialized = true;
    console.log('Drama Director | Ready!');
  }

  _registerSettings() {
    // Note: 'language' setting is registered in the 'init' hook (see bottom of file)
    // to ensure it's available early enough for the i18nInit override below.

    game.settings.register(MODULE_ID, 'vignetteIntensity', {
      name: 'DRAMADIRECTOR.settings.vignetteIntensity',
      hint: 'DRAMADIRECTOR.settings.vignetteIntensityHint',
      scope: 'world', config: true, type: Number,
      range: { min: 0, max: 100, step: 5 }, default: 50,
    });
    game.settings.register(MODULE_ID, 'defaultTextDuration', {
      name: 'DRAMADIRECTOR.settings.textDuration',
      hint: 'DRAMADIRECTOR.settings.textDurationHint',
      scope: 'world', config: true, type: Number,
      range: { min: 1000, max: 15000, step: 500 }, default: 4000,
    });
    game.settings.register(MODULE_ID, 'enableSounds', {
      name: 'DRAMADIRECTOR.settings.enableSounds',
      hint: 'DRAMADIRECTOR.settings.enableSoundsHint',
      scope: 'client', config: true, type: Boolean, default: true,
    });
    game.settings.register(MODULE_ID, 'soundVolume', {
      name: 'DRAMADIRECTOR.settings.soundVolume',
      hint: 'DRAMADIRECTOR.settings.soundVolumeHint',
      scope: 'client', config: true, type: Number,
      range: { min: 0, max: 1, step: 0.1 }, default: 0.7,
    });

    // Text effect presets — stored per-world, GM only
    game.settings.register(MODULE_ID, 'textPresets', {
      scope: 'world', config: false, type: Array, default: [],
    });

    // Loading screen config
    game.settings.register(MODULE_ID, 'loadingScreen', {
      scope: 'world', config: false, type: Object,
      default: { enabled: false, order: 'random', playlist: [], _seqIndex: 0 },
    });

    // Ability effects bindings: [{ itemUuid, itemName, itemImg, actorId, actorName, presetName, critOnly }]
    game.settings.register(MODULE_ID, 'abilityEffects', {
      scope: 'world', config: false, type: Array, default: [],
    });

    // ── Footsteps settings ──────────────────────────────────────────────────
    game.settings.register(MODULE_ID, 'stepsEnabled', {
      scope: 'world', config: false, type: Boolean, default: false,
    });
    game.settings.register(MODULE_ID, 'stepsSurface', {
      scope: 'world', config: false, type: String, default: 'rock',
    });
    game.settings.register(MODULE_ID, 'stepsCustomUrl', {
      scope: 'world', config: false, type: String, default: '',
    });
    game.settings.register(MODULE_ID, 'stepsCustomUrl2', {
      scope: 'world', config: false, type: String, default: '',
    });
    game.settings.register(MODULE_ID, 'stepsCellInterval', {
      scope: 'world', config: false, type: Number, default: 2,
    });
    game.settings.register(MODULE_ID, 'stepSoundPresets', {
      scope: 'world', config: false, type: Array, default: [],
    });
    game.settings.register(MODULE_ID, 'stepsVolumeAll', {
      scope: 'world', config: false, type: Number, default: 0.8,
    });
    game.settings.register(MODULE_ID, 'stepsVolumeGM', {
      scope: 'client', config: false, type: Number, default: 0.7,
    });
    game.settings.register(MODULE_ID, 'stepsMuteGM', {
      scope: 'client', config: false, type: Boolean, default: false,
    });
    game.settings.register(MODULE_ID, 'stepsRealistic', {
      scope: 'world', config: false, type: Boolean, default: false,
    });
    game.settings.register(MODULE_ID, 'stepsRealisticLevel', {
      scope: 'world', config: false, type: String, default: 'medium',
    });
    game.settings.register(MODULE_ID, 'stepsSpatial', {
      scope: 'world', config: false, type: Boolean, default: false,
    });
    game.settings.register(MODULE_ID, 'stepsWallMode', {
      scope: 'world', config: false, type: String, default: 'none',
    });
    game.settings.register(MODULE_ID, 'stepsFadeMs', {
      scope: 'world', config: false, type: Number, default: 261,
    });
    game.settings.register(MODULE_ID, 'stepsDistFull', {
      scope: 'world', config: false, type: Number, default: 5,
    });
    game.settings.register(MODULE_ID, 'stepsDistMax', {
      scope: 'world', config: false, type: Number, default: 30,
    });
    game.settings.register(MODULE_ID, 'stepsRegions', {
      scope: 'world', config: false, type: Array, default: [],
    });
    game.settings.register(MODULE_ID, 'stepsRegionPresets', {
      scope: 'world', config: false, type: Array, default: [],
    });
    // Sound regions (separate from distance regions)
    game.settings.register(MODULE_ID, 'stepsSoundRegions', {
      scope: 'world', config: false, type: Array, default: [],
    });
    game.settings.register(MODULE_ID, 'stepsSoundRegionPresets', {
      scope: 'world', config: false, type: Array, default: [],
    });
    // Distance (attenuation) regions
    game.settings.register(MODULE_ID, 'stepsDistRegions', {
      scope: 'world', config: false, type: Array, default: [],
    });
    game.settings.register(MODULE_ID, 'stepsDistRegionPresets', {
      scope: 'world', config: false, type: Array, default: [],
    });

    // (JoJo Session Recorder removed alongside endings panel.)
  }

  _createOverlays() {
    // Canvas-bound — only covers the map, not the UI
    const canvasEl = document.querySelector('#canvas') ?? document.body;
    const mapContainer = document.createElement('div');
    mapContainer.id = 'dd-map-container';
    mapContainer.innerHTML = `
      <div id="dd-vignette"  class="dd-map-effect dd-hidden"></div>
      <div id="dd-grayscale" class="dd-map-effect dd-hidden"></div>
      <div id="dd-sepia"     class="dd-map-effect dd-hidden"></div>
      <div id="dd-film"      class="dd-map-effect dd-hidden"></div>
      <div id="dd-sketch"    class="dd-map-effect dd-hidden"></div>
      <div id="dd-drunk"     class="dd-map-effect dd-hidden"></div>
      <div id="dd-high"      class="dd-map-effect dd-hidden"></div>
      <div id="dd-glitch"    class="dd-map-effect dd-hidden"></div>
      <div id="dd-particles" class="dd-map-effect"></div>
      <div id="dd-blood"     class="dd-map-effect"></div>
    `;
    canvasEl.appendChild(mapContainer);

    // Full-screen — text, intro, video, loading go here
    const fullContainer = document.createElement('div');
    fullContainer.id = 'drama-director-container';
    fullContainer.innerHTML = `
      <div id="dd-text"    class="dd-effect dd-hidden"></div>
      <div id="dd-intro"   class="dd-effect dd-hidden"></div>
      <div id="dd-video"   class="dd-effect dd-hidden"></div>
      <div id="dd-loading" class="dd-effect dd-hidden dd-loading-screen"></div>
    `;
    document.body.appendChild(fullContainer);

    this.overlays = {
      vignette:  mapContainer.querySelector('#dd-vignette'),
      grayscale: mapContainer.querySelector('#dd-grayscale'),
      sepia:     mapContainer.querySelector('#dd-sepia'),
      film:      mapContainer.querySelector('#dd-film'),
      sketch:    mapContainer.querySelector('#dd-sketch'),
      drunk:     mapContainer.querySelector('#dd-drunk'),
      high:      mapContainer.querySelector('#dd-high'),
      glitch:    mapContainer.querySelector('#dd-glitch'),
      particles: mapContainer.querySelector('#dd-particles'),
      blood:     mapContainer.querySelector('#dd-blood'),
      text:      fullContainer.querySelector('#dd-text'),
      intro:     fullContainer.querySelector('#dd-intro'),
      video:     fullContainer.querySelector('#dd-video'),
      loading:   fullContainer.querySelector('#dd-loading'),
    };
  }

  _setupSocketListener() {
    game.socket.on(SOCKET_EVENT, (data) => {
      if (data.targetUser && data.targetUser !== game.user.id) return;
      // Skip own broadcasts — GM already applied locally before emitting
      if (!data.targetUser && data.senderId && data.senderId === game.user.id) return;
      switch (data.action) {
        case 'effect':          this._applyEffect(data.effect, data.options); break;
        // Player-triggered effect: GM receives this and rebroadcasts to all clients
        case 'gmBroadcastEffect':
          if (game.user.isGM) {
            this._applyEffect(data.effect, data.options);
            game.socket.emit(SOCKET_EVENT, { action: 'effect', effect: data.effect, options: data.options, targetUser: null, senderId: data.initiatorId });
          }
          break;
        case 'clear':           this._clearEffects(); break;
        case 'dismissText':     this._dismissText(); break;
        case 'sound':           this._playAudioFile(data.url, data.volume ?? 0.7); break;
        case 'stopSound':       this.stopCustomSound(false); break;
        // 'stepSound' and 'stepsSpatial' moved to drama-director-footsteps's own socket channel.
        case 'video':           this._showVideo(data.url, data.options); break;
        case 'stopVideo':       this._stopVideo(); break;
        case 'showLoading':     this._showLoadingScreen(data.entry); break;
        case 'hideLoading':     this._hideLoadingScreen(); break;
        case 'sinCityIntro':     executeSinCityIntro(data.campaignName ?? ''); break;
        case 'snatchIntro':     executeSnatchIntro(data.campaignName ?? ''); break;
        case 'sinCitySkip':     skipSinCityIntro(); break;
        case 'macheteIntro':    executeMacheteIntro(data.campaignName ?? ''); break;
        case 'macheteSkip':     skipMacheteIntro(); break;
        case 'macheteBloodIntro': executeMacheteBloodIntro(data.campaignName ?? ''); break;
        case 'macheteBloodSkip':  skipMacheteBloodIntro(); break;
        case 'snatchSkip':      skipSnatchIntro(); break;
        // Endings (wbrb/jojo/jojoSession/scifiSession) socket actions removed.
        case 'scifiIntro':      executeSciFiIntro(data.campaignName ?? '', data.gmName ?? ''); break;
        case 'scifiSkip':       skipSciFiIntro(); break;
        case 'detectiveIntro':  executeDetectiveIntro(data.campaignName ?? '', data.gmName ?? ''); break;
        case 'detSkip':         skipDetectiveIntro(); break;
      }
    });
  }

  // ─── Effect dispatcher ────────────────────────────────────────────────────

  applyEffect(effectId, options = {}, targetUser = null) {
    if (targetUser && game.user.isGM) {
      game.socket.emit(SOCKET_EVENT, { action: 'effect', effect: effectId, options, targetUser });
      return;
    }
    this._applyEffect(effectId, options);
    if (game.user.isGM && !targetUser) {
      game.socket.emit(SOCKET_EVENT, { action: 'effect', effect: effectId, options, targetUser: null, senderId: game.user.id });
    } else if (!game.user.isGM && !targetUser) {
      // Player: apply locally and ask the active GM to rebroadcast to all other clients
      game.socket.emit(SOCKET_EVENT, { action: 'gmBroadcastEffect', effect: effectId, options, initiatorId: game.user.id });
    }
  }

  _applyEffect(effectId, options = {}) {
    const map = {
      'vignette':  () => this._effectVignette(options),
      'grayscale': () => this._effectGrayscale(options),
      'sepia':     () => this._effectSepia(options),
      'film':      () => this._effectFilm(options),
      'sketch':    () => this._effectSketch(options),
      'drunk':     () => this._effectDrunk(options),
      'high':      () => this._effectHigh(options),
      'glitch':    () => this._effectGlitch(options),
      'blood':     () => this._effectBlood(options),
      'sakura':    () => this._effectSakura(options),
      'hearts':    () => this._effectHearts(options),
      'text':      () => this._effectText(options),
      'intro':     () => this._effectIntro(options),
    };
    map[effectId]?.();
  }

  // ─── Basic ────────────────────────────────────────────────────────────────

  _effectVignette(o = {}) {
    const on = o.active !== false;
    if (on) {
      this.overlays.vignette.style.setProperty('--vignette-intensity', `${o.intensity ?? game.settings.get(MODULE_ID,'vignetteIntensity')}%`);
      this.overlays.vignette.classList.remove('dd-hidden');
      this.activeEffects.set('vignette', true);
    } else {
      this.overlays.vignette.classList.add('dd-hidden');
      this.activeEffects.delete('vignette');
    }
  }

  _effectGrayscale(o = {}) {
    const on = o.active !== false;
    if (on) {
      this.overlays.grayscale.style.setProperty('--grayscale', `${o.intensity ?? 100}%`);
      this.overlays.grayscale.classList.remove('dd-hidden');
      this.activeEffects.set('grayscale', true);
    } else {
      this.overlays.grayscale.classList.add('dd-hidden');
      this.activeEffects.delete('grayscale');
    }
  }

  _effectSepia(o = {}) {
    const on = o.active !== false;
    if (on) {
      this.overlays.sepia.style.setProperty('--sepia', `${o.intensity ?? 90}%`);
      this.overlays.sepia.classList.remove('dd-hidden');
      this.activeEffects.set('sepia', true);
    } else {
      this.overlays.sepia.classList.add('dd-hidden');
      this.activeEffects.delete('sepia');
    }
  }

  _effectFilm(o = {}) {
    const on = o.active !== false;
    if (on) {
      this.overlays.film.classList.remove('dd-hidden');
      this.activeEffects.set('film', true);
      this._startFilmGrain();
    } else {
      this.overlays.film.classList.add('dd-hidden');
      this.activeEffects.delete('film');
      this._stopFilmGrain();
    }
  }

  _startFilmGrain() {
    const canvas = document.createElement('canvas');
    canvas.id = 'dd-film-canvas';
    canvas.width  = Math.ceil(window.innerWidth  / 2);
    canvas.height = Math.ceil(window.innerHeight / 2);
    canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;';
    this.overlays.film.innerHTML = '';
    this.overlays.film.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    let frame = 0;
    const draw = () => {
      if (!this.activeEffects.has('film')) return;
      frame++;
      const img = ctx.createImageData(canvas.width, canvas.height);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const v = Math.random() * 255 | 0;
        d[i] = d[i+1] = d[i+2] = v;
        d[i+3] = Math.random() < 0.3 ? 35 : 0;
      }
      ctx.putImageData(img, 0, 0);
      if (Math.random() < 0.04) {
        const x = Math.random() * canvas.width;
        ctx.strokeStyle = `rgba(255,255,255,${.05+Math.random()*.12})`;
        ctx.lineWidth = .5 + Math.random();
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + (Math.random()-.5)*6, canvas.height);
        ctx.stroke();
      }
      if (frame % 3 === 0) this.overlays.film.style.setProperty('--film-brightness', Math.random() < .03 ? '.93' : '1');
      this._filmRaf = requestAnimationFrame(draw);
    };
    this._filmRaf = requestAnimationFrame(draw);
  }

  _stopFilmGrain() {
    if (this._filmRaf) cancelAnimationFrame(this._filmRaf);
    this._filmRaf = null;
    this.overlays.film.innerHTML = '';
  }

  _effectSketch(o = {}) {
    const on = o.active !== false;
    if (on) {
      this.overlays.sketch.classList.remove('dd-hidden');
      this.activeEffects.set('sketch', true);
    } else {
      this.overlays.sketch.classList.add('dd-hidden');
      this.activeEffects.delete('sketch');
    }
  }

  // ─── Status ───────────────────────────────────────────────────────────────

  _effectDrunk(o = {}) {
    const on = o.active !== false;
    if (on) {
      this.overlays.drunk.classList.remove('dd-hidden');
      this.activeEffects.set('drunk', true);
      if (o.temporary) setTimeout(() => this._effectDrunk({ active: false }), o.duration ?? 10000);
    } else {
      this.overlays.drunk.classList.add('dd-hidden');
      this.activeEffects.delete('drunk');
    }
  }

  _effectHigh(o = {}) {
    const on = o.active !== false;
    if (on) {
      this.overlays.high.classList.remove('dd-hidden');
      this.activeEffects.set('high', true);
      if (o.temporary) setTimeout(() => this._effectHigh({ active: false }), o.duration ?? 15000);
    } else {
      this.overlays.high.classList.add('dd-hidden');
      this.activeEffects.delete('high');
    }
  }

  // ─── Special ──────────────────────────────────────────────────────────────

  _effectGlitch(o = {}) {
    const on = o.active !== false;
    if (on) {
      this.overlays.glitch.innerHTML = `
        <div class="dd-glitch-slice" style="--slice-from:5%;  --slice-to:28%; --offset:-14px; --hue:180deg; --delay:0s;"></div>
        <div class="dd-glitch-slice" style="--slice-from:35%; --slice-to:52%; --offset:10px;  --hue:270deg; --delay:.07s;"></div>
        <div class="dd-glitch-slice" style="--slice-from:60%; --slice-to:85%; --offset:-7px;  --hue:90deg;  --delay:.13s;"></div>
        <div class="dd-glitch-aberration"></div>
        <div class="dd-glitch-flash"></div>`;
      this.overlays.glitch.classList.remove('dd-hidden');
      this.activeEffects.set('glitch', true);
      if (o.duration) setTimeout(() => this._effectGlitch({ active: false }), o.duration);
    } else {
      this.overlays.glitch.classList.add('dd-hidden');
      this.overlays.glitch.innerHTML = '';
      this.activeEffects.delete('glitch');
    }
  }

  _effectBlood(o = {}) {
    const count = o.count ?? 18;
    const dur   = o.duration ?? 9000;
    for (let i = 0; i < count; i++) setTimeout(() => this._createBloodDrop(dur), Math.random() * 1500);
  }

  _createBloodDrop(totalDur = 9000) {
    const drop = document.createElement('div');
    drop.className = 'dd-blood-drop';
    drop.style.left = `${Math.random() * window.innerWidth}px`;
    drop.style.setProperty('--drop-height', `${50 + Math.random()*140}px`);
    drop.style.setProperty('--drop-width',  `${3 + Math.random()*7}px`);
    drop.style.animationDuration = `${2500 + Math.random()*4000}ms`;
    this.overlays.blood.appendChild(drop);
    setTimeout(() => drop.remove(), totalDur);
  }

  // ─── Particles ────────────────────────────────────────────────────────────

  _effectSakura(o = {}) {
    for (let i = 0; i < (o.count ?? 40); i++)
      setTimeout(() => this._createParticle('sakura', o.duration ?? 8000), Math.random() * 3000);
  }
  _effectHearts(o = {}) {
    for (let i = 0; i < (o.count ?? 25); i++)
      setTimeout(() => this._createParticle('heart', o.duration ?? 4000), Math.random() * 2000);
  }
  _createParticle(type, duration) {
    const p = document.createElement('div');
    p.className = `dd-particle dd-${type}`;
    p.style.left = `${Math.random() * window.innerWidth}px`;
    p.style.top  = type === 'heart' ? `${window.innerHeight}px` : '-50px';
    this.overlays.particles.appendChild(p);
    setTimeout(() => p.remove(), duration);
  }

  // ─── Text ─────────────────────────────────────────────────────────────────

  // Maps panel animation id → CSS keyframe name for image/text layers
  static ANIM_KEYFRAME = {
    'fade':       'text-fade-in',
    'zoom':       'text-zoom',
    'zoom-out':   'text-zoom-out',
    'impact':     'text-impact',
    'shake':      'text-shake-in',
    'slideUp':    'text-slideUp-in',
    'slideDown':  'text-slideDown-in',
    'slideLeft':  'text-slideLeft-in',
    'slideRight': 'text-slideRight-in',
    'bounce':     'text-bounce-in',
    'flip':       'text-flip-in',
    'flipY':      'text-flipY-in',
    'typewriter': 'text-typewriter',
    'glitch':     'text-glitch-in',
    'blur':       'text-blur-in',
    'swipeLeft':  'text-swipeLeft',
    'swipeRight': 'text-swipeRight',
    'rise':       'text-rise-in',
    'drop':       'text-drop-in',
    'spin':       'text-spin-in',
  };

  _effectText(o = {}) {
    // Editor-mode payload (textpics "monteur"): clip list + keyframes.
    // Branches to a dedicated timeline player; legacy options below.
    if (o && o.timeline && Array.isArray(o.timeline.clips) && o.timeline.clips.length) {
      return this._playTimeline(o);
    }
    const style     = o.style ?? 'default';
    const animation = o.animation ?? 'fade';
    const duration  = o.duration ?? game.settings.get(MODULE_ID, 'defaultTextDuration');
    const color     = o.color ?? '#ffffff';

    // Character Introduction
    const charIntro = o.charIntro ?? false;
    // If useSelectedToken, grab the first controlled token on canvas right now
    let tokenId = o.tokenId ?? '';
    if (charIntro && (o.useSelectedToken ?? false)) {
      const controlled = canvas?.tokens?.controlled?.[0];
      tokenId = controlled?.id ?? '';
    }
    const charAnim  = o.charIntroAnim ?? 'fade';
    const portraitScale = o.portraitScale ?? 1;
    const portraitX     = o.portraitX ?? 0;
    const portraitY     = o.portraitY ?? 0;
    const portraitZ     = o.portraitZ ?? 0;

    const posMap = { 'left-block':'pos-left','right-block':'pos-right','bottom':'pos-bottom' };
    const posClass = posMap[style] ?? 'pos-center';
    this.overlays.text.className = `dd-effect ${posClass}`;
    this.overlays.text.style.color = color;
    this.overlays.text.style.setProperty('--text-duration', `${duration}ms`);
    this.overlays.text.innerHTML = '';

    // ── Multi-image layers ──
    const imageLayers = o.imageLayers ?? (o.image ? [{ url: o.image, scale: o.imageScale ?? 1, x: o.imageX ?? 0, y: o.imageY ?? 0, z: 0, animation: 'fade' }] : []);
    imageLayers.forEach((img, idx) => {
      if (!img.url) return;
      // Outer wrapper: handles position offset (x/y %) — no transform animation here
      const imgWrap = document.createElement('div');
      imgWrap.className = 'dd-image-layer';
      imgWrap.style.cssText = `
        position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
        transform: translate(${img.x ?? 0}%, ${img.y ?? 0}%);
        transform-origin: center center;
        z-index: ${10 + (img.z ?? 0)};
        opacity: ${img.opacity ?? 1};
      `;
      // Scale wrapper: isolated from animation transform so scale is preserved
      const scaleWrap = document.createElement('div');
      scaleWrap.style.cssText = `display:inline-flex;transform:scale(${img.scale ?? 1});transform-origin:center center;`;
      // Animated inner: applies CSS keyframe animation without conflicting with scale
      const animWrap = document.createElement('div');
      const animName = DramaDirector.ANIM_KEYFRAME[img.animation ?? 'fade'] ?? 'text-fade-in';
      animWrap.style.cssText = `display:inline-flex;animation:${animName} 0.5s ease-out forwards;`;
      const imgEl = document.createElement('img');
      imgEl.src = img.url;
      imgEl.style.cssText = img.fullscreen
        ? 'width:100vw;height:100vh;object-fit:cover;display:block;'
        : 'max-width:100vw;max-height:100vh;object-fit:contain;display:block;';
      animWrap.appendChild(imgEl);
      scaleWrap.appendChild(animWrap);
      imgWrap.appendChild(scaleWrap);
      this.overlays.text.appendChild(imgWrap);
    });

    // ── Video layers ──
    const videoLayers = o.videoLayers ?? [];
    videoLayers.forEach((vid) => {
      if (!vid.url) return;
      const vidWrap = document.createElement('div');
      vidWrap.style.cssText = `
        position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
        transform: translate(${vid.x ?? 0}%, ${vid.y ?? 0}%);
        z-index: ${10 + (vid.z ?? 0)};
        opacity: ${vid.opacity ?? 1};
      `;
      const scaleWrap = document.createElement('div');
      scaleWrap.style.cssText = `display:inline-flex;transform:scale(${vid.scale ?? 1});transform-origin:center center;`;
      const vidEl = document.createElement('video');
      vidEl.src      = vid.url;
      vidEl.loop     = vid.loop   ?? false;
      vidEl.muted    = vid.muted  !== false;
      vidEl.autoplay = true;
      vidEl.playsInline = true;
      vidEl.style.cssText = vid.fullscreen
        ? 'width:100vw;height:100vh;object-fit:cover;display:block;'
        : 'max-width:100vw;max-height:100vh;object-fit:contain;display:block;pointer-events:none;';
      scaleWrap.appendChild(vidEl);
      vidWrap.appendChild(scaleWrap);
      this.overlays.text.appendChild(vidWrap);
      vidEl.play().catch(() => {});
    });

    // ── Sequence (image sequence) layers ──
    const seqLayers = o.seqLayers ?? [];
    seqLayers.forEach((seq) => {
      if (!seq.firstFile || !seq.lastFile) return;
      const firstNum = seq.firstNum ?? 0;
      const lastNum  = seq.lastNum  ?? 0;
      const padLen   = seq.padLen   ?? 1;
      const fps      = Math.max(1, Math.min(60, seq.fps ?? 24));
      const basePath = seq.basePath ?? seq.firstFile.replace(/\d+(\.[^.]+)$/, '');
      const ext      = seq.ext ?? (seq.firstFile.match(/\.[^.]+$/)?.[0] ?? '.png');
      const frameCount = lastNum - firstNum + 1;
      if (frameCount < 1) return;

      const seqWrap = document.createElement('div');
      seqWrap.style.cssText = `
        position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
        transform: translate(${seq.x ?? 0}%, ${seq.y ?? 0}%);
        z-index: ${10 + (seq.z ?? 0)};
        opacity: ${seq.opacity ?? 1};
      `;
      const scaleWrap = document.createElement('div');
      scaleWrap.style.cssText = `display:inline-flex;transform:scale(${seq.scale ?? 1});transform-origin:center center;`;
      const imgEl = document.createElement('img');
      imgEl.style.cssText = 'max-width:100vw;max-height:100vh;object-fit:contain;display:block;pointer-events:none;';
      imgEl.src = seq.firstFile;

      scaleWrap.appendChild(imgEl);
      seqWrap.appendChild(scaleWrap);
      this.overlays.text.appendChild(seqWrap);

      // Build padded frame URL helper
      const _frameUrl = (n) => {
        const padded = String(n).padStart(padLen, '0');
        return basePath + padded + ext;
      };

      // Preload all frames then animate
      let currentFrame = 0;
      let seqTimer     = null;
      const isLooping  = seq.loop !== false;

      const _startSeq = () => {
        const interval = 1000 / fps;
        seqTimer = setInterval(() => {
          currentFrame++;
          if (currentFrame >= frameCount) {
            if (isLooping) {
              currentFrame = 0;
            } else {
              clearInterval(seqTimer);
              return;
            }
          }
          imgEl.src = _frameUrl(firstNum + currentFrame);
        }, interval);
      };

      // Preload first few frames, then start
      const preloadCount = Math.min(frameCount, 10);
      let loaded = 0;
      for (let i = 0; i < preloadCount; i++) {
        const pre = new Image();
        pre.onload = pre.onerror = () => {
          loaded++;
          if (loaded === preloadCount) _startSeq();
        };
        pre.src = _frameUrl(firstNum + i);
      }

      // Cleanup: stop interval when overlay hides
      const _stopSeq = () => { if (seqTimer) { clearInterval(seqTimer); seqTimer = null; } };
      const _obs = new MutationObserver(() => {
        if (this.overlays.text.classList.contains('dd-hidden')) { _stopSeq(); _obs.disconnect(); }
      });
      _obs.observe(this.overlays.text, { attributes: true, attributeFilter: ['class'] });
    });

    // ── Sound (saved in preset, plays on every trigger) ──
    if (o.soundUrl) {
      this._playAudioFile(o.soundUrl, o.soundVol ?? 0.7);
    }

    // ── Character Introduction overlay ──
    if (charIntro) {
      this._effectCharIntro(tokenId, o.text ?? '', charAnim, duration, this.overlays.text, { scale: portraitScale, x: portraitX, y: portraitY, z: portraitZ, hideFrame: o.hidePortraitFrame ?? false });
    }

    // ── Multi-text layers ──
    const textLayers = o.textLayers ?? (o.text ? [{ text: o.text, subtitle: o.subtitle, style: o.style ?? 'default', animation: o.animation ?? 'fade', scale: o.textScale ?? 1, x: o.textX ?? 0, y: o.textY ?? 0, z: 0 }] : []);
    // Resolve token names at playback time (useTokenName layers)
    textLayers.forEach(layer => {
      if (!layer.useTokenName) return;
      let name = '';
      if (layer.tokenNameSource === 'selected') {
        name = canvas?.tokens?.controlled?.[0]?.name ?? '';
      } else if (layer.tokenNameId) {
        const t = canvas?.tokens?.placeables?.find(t => t.id === layer.tokenNameId);
        name = t?.name ?? '';
      }
      if (name) layer.text = name;
    });
    textLayers.forEach((layer) => {
      if (!layer.text) return;
      const layerStyle = layer.style ?? 'default';
      const layerPosMap = { 'left-block':'pos-left','right-block':'pos-right','bottom':'pos-bottom' };
      const layerPosClass = layerPosMap[layerStyle] ?? 'pos-center';
      const subHtml = (layerStyle === 'chapter' && layer.subtitle)
        ? `<div class="dd-dramatic-subtitle">${layer.subtitle}</div>` : '';

      // Position wrapper: translate(x%, y%) — no animation transform here
      const textWrap = document.createElement('div');
      textWrap.className = 'dd-text-layer-wrap';
      textWrap.style.cssText = `
        position: absolute; inset: 0;
        display: flex;
        align-items: ${layerPosClass === 'pos-bottom' ? 'flex-end' : 'center'};
        justify-content: ${layerPosClass === 'pos-left' ? 'flex-start' : layerPosClass === 'pos-right' ? 'flex-end' : 'center'};
        transform: translate(${layer.x ?? 0}%, ${layer.y ?? 0}%);
        z-index: ${20 + (layer.z ?? 0)};
      `;
      // Scale wrapper: isolated so CSS keyframe transform on textEl doesn't affect user scale
      const scaleWrap = document.createElement('div');
      scaleWrap.style.cssText = `transform:scale(${layer.scale ?? 1});transform-origin:center center;display:inline-block;`;
      if (layer.opacity != null && layer.opacity !== 1) scaleWrap.style.opacity = layer.opacity;
      // Animated element: CSS class drives the keyframe animation cleanly
      const textEl = document.createElement('div');
      textEl.className = `dd-dramatic-text style-${layerStyle} anim-${layer.animation || 'fade'}`;
      if (layer.color)       textEl.style.color      = layer.color;
      if (layer.bold)        textEl.style.fontWeight  = 'bold';
      if (layer.italic)      textEl.style.fontStyle   = 'italic';
      if (layer.shadowColor) {
        const sc = layer.shadowColor;
        textEl.style.textShadow = `0 0 10px ${sc},0 0 20px ${sc}`;
      }
      textEl.innerHTML = layer.text + subHtml;
      // FIX 3: glitch animation also injects real glitch slices into the textEl
      if ((layer.animation ?? 'fade') === 'glitch') {
        textEl.style.position = 'relative';
        textEl.innerHTML += `
          <div class="dd-glitch-slice" style="--slice-from:5%;--slice-to:28%;--offset:-12px;--hue:180deg;--delay:0s;"></div>
          <div class="dd-glitch-slice" style="--slice-from:40%;--slice-to:58%;--offset:10px;--hue:270deg;--delay:.07s;"></div>
          <div class="dd-glitch-slice" style="--slice-from:65%;--slice-to:88%;--offset:-7px;--hue:90deg;--delay:.13s;"></div>
          <div class="dd-glitch-aberration"></div>`;
      }
      scaleWrap.appendChild(textEl);
      textWrap.appendChild(scaleWrap);
      this.overlays.text.appendChild(textWrap);
    });

    // ── Temporary screen effects (active for the duration) ──
    const tempEffects = o.screenEffects ?? [];
    const wasActive = {};
    tempEffects.forEach(eid => {
      wasActive[eid] = this.activeEffects.has(eid);
      if (!wasActive[eid]) this._applyEffect(eid, { active: true });
    });

    this.overlays.text.classList.remove('dd-hidden');
    this.overlays.text.classList.remove('dd-text-fadeout');

    const cleanup = () => {
      tempEffects.forEach(eid => {
        if (!wasActive[eid]) this._applyEffect(eid, { active: false });
      });
    };

    const fadeOut = !!(o.soundFadeOut && o.soundUrl);
    if (o.holdUntilDismissed) {
      // Ждём любого клика или нажатия клавиши — тогда плавно скрываем
      this._textDismissCleanup = cleanup;
      this._textSoundFadeOut   = fadeOut;
      const _onInteract = () => {
        document.removeEventListener('click',   _onInteract, true);
        document.removeEventListener('keydown', _onInteract, true);
        this._dismissText();
      };
      // Небольшая задержка чтобы сам клик «Show» не сработал сразу
      setTimeout(() => {
        document.addEventListener('click',   _onInteract, true);
        document.addEventListener('keydown', _onInteract, true);
      }, 300);
    } else {
      this._textDismissCleanup = null;
      this._textSoundFadeOut   = fadeOut;
      // Start audio fade-out 800ms before text fades
      if (fadeOut && duration > 800) {
        setTimeout(() => this._fadeOutAudio(700), duration - 700);
      }
      setTimeout(() => {
        this._dismissText();
        cleanup();
      }, duration);
    }
  }

  // ─── Editor-mode timeline player (TextPics "monteur") ─────────────────────
  // Renders a timeline-payload with keyframes by:
  //   1. Scheduling each clip's DOM creation at clip.start.
  //   2. Animating x/y/scale/rotation/opacity/blur (+ color/fontSize for text)
  //      between keyframes via requestAnimationFrame.
  //   3. Cleaning up at the end of clip.duration.
  // Re-uses the same overlay container as the legacy path so dismiss / hold
  // semantics stay consistent.
  _playTimeline(o) {
    const total = o.timeline.total ?? 4000;
    const clips = o.timeline.clips ?? [];
    const ov    = this.overlays.text;
    ov.className = 'dd-effect pos-center';
    ov.innerHTML = '';
    ov.style.setProperty('--text-duration', `${total}ms`);

    // Inline keyframe sampler (sibling of editor-engine.mjs in textpics).
    const EASE = {
      linear:    (t) => t,
      easeIn:    (t) => t * t,
      easeOut:   (t) => 1 - (1 - t) * (1 - t),
      easeInOut: (t) => (t < 0.5) ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
    };
    const parseHex = (s) => {
      if (!s || s[0] !== '#') return null;
      const h = s.slice(1);
      if (h.length === 3) return [0, 1, 2].map(i => parseInt(h[i] + h[i], 16));
      if (h.length === 6) return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
      return null;
    };
    const lerpColor = (a, b, t) => {
      const pa = parseHex(a), pb = parseHex(b);
      if (!pa || !pb) return t < 0.5 ? a : b;
      const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
      return '#' + c.map(n => n.toString(16).padStart(2, '0')).join('');
    };
    const sample = (keys, prop, t, fallback) => {
      if (!keys || !keys.length) return fallback;
      const ks = [...keys].sort((a, b) => a.t - b.t);
      if (t <= ks[0].t) return ks[0][prop] ?? fallback;
      if (t >= ks[ks.length - 1].t) return ks[ks.length - 1][prop] ?? fallback;
      for (let i = 0; i < ks.length - 1; i++) {
        const a = ks[i], b = ks[i + 1];
        if (t >= a.t && t <= b.t) {
          const f = (b.t - a.t) <= 0 ? 0 : (t - a.t) / (b.t - a.t);
          const tt = (EASE[a.easing] ?? EASE.linear)(f);
          const va = a[prop] ?? fallback;
          const vb = b[prop] ?? fallback;
          if (typeof va === 'number' && typeof vb === 'number') return va + (vb - va) * tt;
          if (typeof va === 'string' && va[0] === '#' && typeof vb === 'string' && vb[0] === '#') return lerpColor(va, vb, tt);
          return tt < 0.5 ? va : vb;
        }
      }
      return fallback;
    };

    const resolveImg = (lay) => {
      const src = lay.source ?? 'url';
      if (src === 'url') return lay.url || '';
      const t = canvas?.tokens?.controlled?.[0];
      if (!t) return lay.url || '';
      if (src === 'tokenPortrait') return t.actor?.img || t.document?.texture?.src || lay.url || '';
      if (src === 'tokenImage')    return t.document?.texture?.src || t.actor?.prototypeToken?.texture?.src || lay.url || '';
      if (src === 'actorPortrait') return t.actor?.img || lay.url || '';
      return lay.url || '';
    };

    // Build a runtime entry per clip.
    const runtime = clips.map(clip => {
      const lay = clip.type === 'text'  ? (o.textLayers  ?? [])[clip.sourceIdx]
                : clip.type === 'image' ? (o.imageLayers ?? [])[clip.sourceIdx]
                : clip.type === 'video' ? (o.videoLayers ?? [])[clip.sourceIdx]
                : clip.type === 'audio' ? (o.audioLayers ?? [])[clip.sourceIdx]
                : (o.seqLayers ?? [])[clip.sourceIdx];
      return { clip, lay: lay ?? {}, el: null };
    });

    // ── Per-frame updater ──
    const startWall = performance.now();
    let rafId = 0;
    const animate = () => {
      const elapsed = performance.now() - startWall;
      if (elapsed >= total) { _finish(); return; }
      runtime.forEach(rt => {
        const c = rt.clip;
        const inWindow = elapsed >= c.start && elapsed <= c.start + c.duration;
        if (inWindow && !rt.el) rt.el = _spawn(rt);
        if (!inWindow && rt.el) {
          // Stop/clean media before removing the element.
          if (c.type === 'audio' || c.type === 'video') { try { rt.el.pause?.(); } catch {} }
          rt.el.remove(); rt.el = null;
          return;
        }
        if (!rt.el) return;
        const localT = elapsed - c.start;
        if (c.type === 'audio') {
          const vol = sample(c.keyframes, 'volume', localT, c.baseline.volume ?? 1);
          rt.el.volume = Math.max(0, Math.min(1, vol));
          return;
        }
        const v = {
          x:        sample(c.keyframes, 'x',        localT, c.baseline.x),
          y:        sample(c.keyframes, 'y',        localT, c.baseline.y),
          scale:    sample(c.keyframes, 'scale',    localT, c.baseline.scale),
          rotation: sample(c.keyframes, 'rotation', localT, c.baseline.rotation),
          opacity:  sample(c.keyframes, 'opacity',  localT, c.baseline.opacity),
          blur:     sample(c.keyframes, 'blur',     localT, c.baseline.blur),
          color:    sample(c.keyframes, 'color',    localT, c.baseline.color),
          fontSize: sample(c.keyframes, 'fontSize', localT, c.baseline.fontSize),
        };
        rt.el.style.transform = `translate(calc(-50% + ${v.x}%), calc(-50% + ${v.y}%)) scale(${v.scale}) rotate(${v.rotation}deg)`;
        rt.el.style.opacity = String(v.opacity);
        rt.el.style.filter  = v.blur > 0 ? `blur(${v.blur}px)` : '';
        if (rt.clip.type === 'text') {
          if (v.color)    rt.el.style.color    = v.color;
          if (v.fontSize) rt.el.style.fontSize = `${v.fontSize}rem`;
        }
      });
      rafId = requestAnimationFrame(animate);
    };

    // Spawn one DOM element for a clip the first time it enters its window.
    const _spawn = (rt) => {
      const c = rt.clip, lay = rt.lay;
      let el;
      if (c.type === 'text') {
        el = document.createElement('div');
        el.className = 'dd-dramatic-text';
        el.style.position = 'absolute';
        el.style.left = '50%';
        el.style.top = '50%';
        el.style.transformOrigin = 'center center';
        el.textContent = lay.text || '';
        if (lay.color)       el.style.color = lay.color;
        if (lay.bold)        el.style.fontWeight = '700';
        if (lay.italic)      el.style.fontStyle = 'italic';
        if (lay.shadowColor) el.style.textShadow = `0 0 10px ${lay.shadowColor},0 0 20px ${lay.shadowColor}`;
      } else if (c.type === 'image') {
        el = document.createElement('img');
        el.style.position = 'absolute';
        el.style.left = '50%';
        el.style.top = '50%';
        el.style.transformOrigin = 'center center';
        el.style.maxWidth  = '100vw';
        el.style.maxHeight = '100vh';
        el.style.objectFit = 'contain';
        const url = resolveImg(lay);
        if (url) el.src = url;
      } else if (c.type === 'video') {
        el = document.createElement('video');
        el.src = lay.url || '';
        el.loop = lay.loop ?? false;
        el.muted = lay.muted !== false;
        el.autoplay = true;
        el.playsInline = true;
        el.style.position = 'absolute';
        el.style.left = '50%';
        el.style.top = '50%';
        el.style.maxWidth  = '100vw';
        el.style.maxHeight = '100vh';
        el.style.objectFit = 'contain';
        el.play?.().catch(() => {});
      } else if (c.type === 'audio') {
        el = document.createElement('audio');
        el.src = lay.url || '';
        el.loop = !!lay.loop;
        el.volume = Math.max(0, Math.min(1, lay.volume ?? c.baseline?.volume ?? 1));
        el.autoplay = true;
        el.style.display = 'none';
        el.play?.().catch(() => {});
      } else {
        // sequence — minimal fallback: first frame only (no animation here)
        el = document.createElement('img');
        el.src = lay.firstFile || '';
        el.style.position = 'absolute';
        el.style.left = '50%';
        el.style.top = '50%';
        el.style.maxWidth  = '100vw';
        el.style.maxHeight = '100vh';
        el.style.objectFit = 'contain';
      }
      ov.appendChild(el);
      return el;
    };

    const _finish = () => {
      if (rafId) cancelAnimationFrame(rafId);
      runtime.forEach(rt => {
        if (rt.el) {
          // Stop media (audio/video) before unmount.
          if (rt.clip.type === 'audio' || rt.clip.type === 'video') { try { rt.el.pause?.(); } catch {} }
          rt.el.remove();
        }
        rt.el = null;
      });
      this._dismissText();
    };

    // Sound (carries over from legacy payload).
    if (o.soundUrl) this._playAudioFile(o.soundUrl, o.soundVol ?? 0.7);

    // Screen effects (carries over from legacy payload).
    const tempEffects = o.screenEffects ?? [];
    const wasActive = {};
    tempEffects.forEach(eid => {
      wasActive[eid] = this.activeEffects.has(eid);
      if (!wasActive[eid]) this._applyEffect(eid, { active: true });
    });
    this._textDismissCleanup = () => {
      tempEffects.forEach(eid => { if (!wasActive[eid]) this._applyEffect(eid, { active: false }); });
    };

    ov.classList.remove('dd-hidden');
    ov.classList.remove('dd-text-fadeout');
    rafId = requestAnimationFrame(animate);
  }

  _dismissText() {
    const overlay = this.overlays.text;
    if (!overlay || overlay.classList.contains('dd-hidden')) return;
    overlay.classList.add('dd-text-fadeout');
    const cleanup    = this._textDismissCleanup;
    const shouldFade = this._textSoundFadeOut;
    this._textDismissCleanup = null;
    this._textSoundFadeOut   = false;
    // Fade out sound in sync with text fadeout (~600ms)
    if (shouldFade) this._fadeOutAudio(550);
    setTimeout(() => {
      overlay.classList.add('dd-hidden');
      overlay.classList.remove('dd-text-fadeout');
      if (cleanup) cleanup();
    }, 600);
  }

  dismissText(targetUser = null) {
    if (targetUser && game.user.isGM) {
      game.socket.emit(SOCKET_EVENT, { action: 'dismissText', targetUser });
      return;
    }
    this._dismissText();
    if (game.user.isGM && !targetUser) {
      game.socket.emit(SOCKET_EVENT, { action: 'dismissText', targetUser: null, senderId: game.user.id });
    }
  }

  // ─── Character Introduction ───────────────────────────────────────────────

  _effectCharIntro(tokenId, nameText, animStyle, duration, container, posOpts = {}) {
    // Resolve portrait
    let portrait = 'icons/svg/mystery-man.svg';
    let title = '';
    if (tokenId) {
      const token = canvas?.tokens?.placeables?.find(t => t.id === tokenId);
      if (token?.actor) {
        portrait = token.actor.img || portrait;
        const actor = token.actor;
        const cls = Object.values(actor.classes ?? {});
        title = cls.length ? cls.map(c => c.name).join(' / ')
              : (actor.system?.details?.race || actor.system?.details?.type?.value || '');
        if (title) title = title.charAt(0).toUpperCase() + title.slice(1);
      }
    }

    const scale = posOpts.scale ?? 1;
    const px    = posOpts.x ?? 0;
    const py    = posOpts.y ?? 0;
    const pz    = posOpts.z ?? 0;
    const hideFrame = posOpts.hideFrame ?? false;

    // Extended animation set
    const smokeAnim   = animStyle === 'smoke';
    const flipAnim    = animStyle === 'flip';
    const bounceAnim  = animStyle === 'bounce';
    const slideDownA  = animStyle === 'slideDown';

    const overlay = document.createElement('div');
    const extraAnim = (smokeAnim || flipAnim || bounceAnim) ? '' : ` anim-${animStyle}`;
    overlay.className = `dd-char-intro-overlay${extraAnim}`;
    overlay.style.cssText = `
      transform: translate(${px}%, ${py}%) scale(${scale});
      transform-origin: center center;
      z-index: ${10 + pz};
    `;

    overlay.innerHTML = `
      <div class="dd-char-intro-portrait-wrap">
        ${hideFrame
          ? `<img src="${portrait}" alt="${nameText}" style="max-width:100%;max-height:100%;object-fit:contain;" onerror="this.src='icons/svg/mystery-man.svg'">`
          : `<div class="dd-char-frame"><img src="${portrait}" alt="${nameText}" onerror="this.src='icons/svg/mystery-man.svg'"></div>`
        }
        ${nameText ? `<div class="dd-char-intro-name">${nameText}</div>` : ''}
        ${title    ? `<div class="dd-char-intro-title">${title}</div>` : ''}
      </div>
    `;

    container.appendChild(overlay);

    // ── Smoke animation via SVG displacement filter ──
    if (smokeAnim) {
      overlay.style.opacity = '0';
      const svgNS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(svgNS, 'svg');
      svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;top:0;left:0;pointer-events:none;';
      const fid = `dd-ci-sf-${Date.now()}`;
      svg.innerHTML = `<defs><filter id="${fid}" x="-50%" y="-50%" width="200%" height="200%">
        <feTurbulence id="${fid}-t" type="fractalNoise" baseFrequency="0.025 0.04" numOctaves="5" seed="${(Math.random()*100)|0}" result="noise"/>
        <feDisplacementMap id="${fid}-d" in="SourceGraphic" in2="noise" scale="0" xChannelSelector="R" yChannelSelector="G"/>
      </filter></defs>`;
      document.body.appendChild(svg);
      const turb = svg.querySelector(`#${fid}-t`);
      const disp = svg.querySelector(`#${fid}-d`);
      overlay.style.filter = `url(#${fid})`;
      let start = null;
      const dur = 1000;
      const frame = (ts) => {
        if (!start) start = ts;
        const raw = Math.min((ts - start) / dur, 1);
        const p = 1 - Math.pow(1 - raw, 2);
        const sc = (1 - p) * 220;
        const freq = 0.025 + (1 - p) * 0.1;
        turb.setAttribute('baseFrequency', `${freq.toFixed(4)} ${(freq*1.7).toFixed(4)}`);
        disp.setAttribute('scale', sc.toFixed(1));
        overlay.style.opacity = raw.toString();
        if (raw < 1) requestAnimationFrame(frame);
        else { svg.remove(); overlay.style.filter = ''; }
      };
      requestAnimationFrame(frame);
    }

    // ── Flip animation ──
    if (flipAnim) {
      overlay.style.perspective = '800px';
      overlay.style.animation = 'dd-flip-in 0.7s cubic-bezier(.42,0,.27,1.5) forwards';
    }

    // ── Bounce animation ──
    if (bounceAnim) {
      overlay.style.animation = 'dd-bounce-in 0.8s cubic-bezier(.36,.07,.19,.97) forwards';
    }

    // ── SlideDown animation ──
    if (slideDownA) {
      overlay.style.animation = 'dd-slide-down 0.6s ease-out forwards';
    }
  }

  // ─── Presets ──────────────────────────────────────────────────────────────
  //
  // Text & Pictures presets are now owned by the drama-director-textpics
  // module. Cinematic reads/writes through that namespace when textpics is
  // installed, and transparently migrates any legacy presets that were
  // saved in cinematic's own namespace.

  _textpicsPresetNs() {
    return game.modules.get('drama-director-textpics')?.active
      ? 'drama-director-textpics'
      : MODULE_ID;
  }

  getTextPresets() {
    const ns = this._textpicsPresetNs();
    let primary = [];
    try { primary = game.settings.get(ns, 'textPresets') ?? []; } catch { primary = []; }

    // Fallback / merge with any legacy presets stored under the cinematic
    // namespace so a one-time migration is automatic.
    if (ns !== MODULE_ID) {
      let legacy = [];
      try { legacy = game.settings.get(MODULE_ID, 'textPresets') ?? []; } catch { legacy = []; }
      if (legacy.length && primary.length === 0) return legacy;
      if (legacy.length && primary.length) {
        const byName = new Map(primary.map(p => [p.name, p]));
        for (const p of legacy) if (!byName.has(p.name)) byName.set(p.name, p);
        return [...byName.values()];
      }
    }
    return primary;
  }

  async saveTextPreset(name, options) {
    if (!name) return;
    const ns = this._textpicsPresetNs();
    const presets = this.getTextPresets().filter(p => p.name !== name);
    presets.push({ name, options });
    await game.settings.set(ns, 'textPresets', presets);
    ui.notifications?.info(game.i18n.format('DRAMADIRECTOR.presetSaved', { name }));
    return presets;
  }

  async deleteTextPreset(name) {
    if (!name) return;
    const ns = this._textpicsPresetNs();
    const presets = this.getTextPresets().filter(p => p.name !== name);
    await game.settings.set(ns, 'textPresets', presets);
    ui.notifications?.info(game.i18n.localize('DRAMADIRECTOR.presetDeleted'));
    return presets;
  }

  // ─── Loading Screen ──────────────────────────────────────────────────────

  getLoadingScreen() {
    try { return game.settings.get(MODULE_ID, 'loadingScreen') ?? { enabled: false, order: 'random', playlist: [], _seqIndex: 0 }; }
    catch { return { enabled: false, order: 'random', playlist: [], _seqIndex: 0 }; }
  }

  async saveLoadingScreen(config) {
    await game.settings.set(MODULE_ID, 'loadingScreen', config);
  }

  _pickLoadingEntry() {
    const cfg = this.getLoadingScreen();
    const pl  = cfg.playlist ?? [];
    if (!pl.length) return null;
    if (cfg.order === 'sequential') {
      const idx   = (cfg._seqIndex ?? 0) % pl.length;
      const entry = pl[idx];
      this.saveLoadingScreen({ ...cfg, _seqIndex: idx + 1 });
      return entry;
    }
    return pl[Math.floor(Math.random() * pl.length)];
  }

  /** Called on canvasTearDown — show screen, broadcast to players, no auto-hide */
  triggerLoadingScreen() {
    const cfg = this.getLoadingScreen();
    if (!cfg.enabled || !cfg.playlist?.length) return;
    const entry = this._pickLoadingEntry();
    if (!entry) return;
    // Show locally (GM)
    this._showLoadingScreen(entry);
    // Broadcast to all players — they will show and then hide on their own canvasReady
    game.socket.emit(SOCKET_EVENT, { action: 'showLoading', entry, senderId: game.user.id });
  }

  /** Called on canvasReady — hide + broadcast hide to everyone */
  finishLoadingScreen() {
    this._hideLoadingScreen();
    const cfg = this.getLoadingScreen();
    if (cfg.enabled) {
      game.socket.emit(SOCKET_EVENT, { action: 'hideLoading', senderId: game.user.id });
    }
  }

  _showLoadingScreen(entry) {
    if (!entry) return;
    const overlay = this.overlays?.loading;
    if (!overlay) return;
    overlay.innerHTML = '';
    overlay.classList.remove('dd-hidden', 'dd-ls-fade-out');
    // FIX: _effectText overwrites className of whatever element is in this.overlays.text,
    // stripping dd-loading-screen (black bg, fixed position, flex centering).
    // Ensure the class is always present — even after a previous textpics render.
    overlay.classList.add('dd-loading-screen');

    if (entry.type === 'portrait') {
      const playerUsers = game.users.filter(u => !u.isGM && u.character);
      if (!playerUsers.length) { overlay.classList.add('dd-hidden'); return; }
      const u    = playerUsers[Math.floor(Math.random() * playerUsers.length)];
      const char = u.character;
      const img  = char?.img ?? 'icons/svg/mystery-man.svg';
      overlay.innerHTML = `
        <div class="dd-ls-portrait-wrap dd-ls-anim-in">
          <div class="dd-ls-portrait-frame">
            <img class="dd-ls-portrait-img" src="${img}" alt="${char?.name ?? ''}">
          </div>
          <div class="dd-ls-portrait-charname">${char?.name ?? '—'}</div>
          <div class="dd-ls-portrait-playername">${u.name}</div>
          <div class="dd-ls-progress-bar"><div class="dd-ls-progress-fill"></div></div>
        </div>`;
    } else if (entry.type === 'particles') {
      // Spawn canvas-animated particles via JS after mount
      const wrap = document.createElement('div');
      wrap.className = 'dd-ls-particles';
      wrap.innerHTML = `
        <canvas class="dd-ls-ptcl-canvas"></canvas>
        <div class="dd-ls-ptcl-center">
          <div class="dd-ls-ptcl-title">${game.scenes?.current?.name ?? ''}</div>
          <div class="dd-ls-ptcl-dots"><span></span><span></span><span></span></div>
        </div>
        <div class="dd-ls-progress-bar dd-ls-progress-bottom"><div class="dd-ls-progress-fill"></div></div>`;
      overlay.appendChild(wrap);
      // Animate particles
      requestAnimationFrame(() => {
        const canvas = wrap.querySelector('.dd-ls-ptcl-canvas');
        if (!canvas) return;
        canvas.width  = overlay.offsetWidth  || window.innerWidth;
        canvas.height = overlay.offsetHeight || window.innerHeight;
        const ctx = canvas.getContext('2d');
        const N   = 80;
        const pts = Array.from({ length: N }, () => ({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          r: Math.random() * 2 + .5,
          vx: (Math.random() - .5) * .4,
          vy: (Math.random() - .5) * .4,
          a: Math.random(),
        }));
        let running = true;
        wrap._stopParticles = () => { running = false; };
        const tick = () => {
          if (!running) return;
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          for (const p of pts) {
            p.x = (p.x + p.vx + canvas.width)  % canvas.width;
            p.y = (p.y + p.vy + canvas.height) % canvas.height;
            p.a = .3 + .5 * Math.abs(Math.sin(Date.now() / 2000 + p.r));
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(148,163,184,${p.a.toFixed(2)})`;
            ctx.fill();
          }
          requestAnimationFrame(tick);
        };
        tick();
      });

    } else if (entry.type === 'textpics') {
      const preset = this.getTextPresets().find(p => p.name === entry.presetName);
      if (!preset) { overlay.classList.add('dd-hidden'); return; }

      // Strip options that must NOT bleed outside the loading overlay:
      //  - screenEffects (e.g. grayscale) would apply to map and not get cleaned up
      //  - soundUrl plays immediately; we delay it slightly so it doesn't fight scene loading
      //  - holdUntilDismissed must be off — we control dismiss via canvasReady
      const safeOptions = {
        ...(preset.options ?? {}),
        screenEffects:     undefined,   // no canvas effects during loading
        holdUntilDismissed: false,
        duration:           99999,       // we dismiss manually on canvasReady
        soundUrl:           undefined,   // suppress — avoid audio race on scene load
        soundVol:           undefined,
        soundFadeOut:       undefined,
      };

      // FIX: render into a child wrapper, NOT directly into the overlay element.
      // _effectText does `element.className = "dd-effect pos-center"` which would strip
      // dd-loading-screen from the overlay, removing the black background and fixed positioning.
      // By pointing it at a dedicated inner div, the overlay's classes stay intact.
      const textWrapper = document.createElement('div');
      textWrapper.style.cssText = 'position:absolute;inset:0;overflow:hidden;';
      overlay.appendChild(textWrapper);
      const savedOverlay = this.overlays.text;
      this.overlays.text = textWrapper;
      this._effectText(safeOptions);
      this.overlays.text = savedOverlay;

      // Append indeterminate progress bar
      const bar = document.createElement('div');
      bar.className = 'dd-ls-progress-bar dd-ls-progress-bottom';
      bar.innerHTML = '<div class="dd-ls-progress-fill"></div>';
      overlay.appendChild(bar);
    }
  }

  _hideLoadingScreen() {
    const overlay = this.overlays?.loading;
    if (!overlay || overlay.classList.contains('dd-hidden')) return;
    // Stop JS-driven animations before removing DOM
    overlay.querySelector('.dd-ls-particles')?._stopParticles?.();
    overlay.classList.add('dd-ls-fade-out');
    setTimeout(() => {
      overlay.classList.add('dd-hidden');
      overlay.classList.remove('dd-ls-fade-out');
      overlay.innerHTML = '';
    }, 600);
    // Clean up any canvas effects that might have leaked from a textpics preset
    // (e.g. if grayscale/sepia was active before the scene change, restore clean state)
    // Only if no effects were intentionally active before loading
    if (!this.activeEffects.size) {
      ['grayscale','sepia','sketch','vignette','drunk','high'].forEach(k => {
        this.overlays[k]?.classList.add('dd-hidden');
      });
      this._effectGlitch({ active: false });
      this._effectFilm({ active: false });
    }
  }

  // ─── Ability Effects ──────────────────────────────────────────────────────

  getAbilityEffects() {
    try { return game.settings.get(MODULE_ID, 'abilityEffects') ?? []; }
    catch { return []; }
  }

  async saveAbilityEffects(list) {
    await game.settings.set(MODULE_ID, 'abilityEffects', list);
  }

  /**
   * @param {Item}   item        - Foundry Item document
   * @param {string} triggerType - 'use' | 'attack' | 'damage' | 'crit'
   * @param {boolean} isCrit
   */
  _onItemUse(item, triggerType = 'use', isCrit = false) {
    if (!game.user.isGM) return;
    const bindings = this.getAbilityEffects();
    if (!bindings.length) return;

    const actorId  = item?.parent?.id ?? item?.actor?.id ?? '';
    const itemUuid = item?.uuid ?? '';
    const itemName = (item?.name ?? '').toLowerCase();

    // Build identity token set for flexible UUID matching
    const liveIds = new Set([
      itemUuid,
      itemUuid.split('.').pop(),
      item?.flags?.core?.sourceId,
      item?.flags?.core?.sourceId?.split('.').pop(),
    ].filter(Boolean));

    const matches = bindings.filter(b => {
      // ── Item identity ──────────────────────────────────────────────────
      if (b.actorId && b.actorId !== actorId) return false;

      if (b.itemUuid) {
        const stored = new Set([b.itemUuid, b.itemUuid.split('.').pop()].filter(Boolean));
        let idOk = false;
        for (const t of liveIds) if (stored.has(t)) { idOk = true; break; }
        if (!idOk) return false;
      } else if (b.itemName) {
        if (b.itemName.toLowerCase() !== itemName) return false;
      } else {
        return false;
      }

      // ── Trigger filter ─────────────────────────────────────────────────
      // binding.trigger: 'use' | 'attack' | 'damage' | 'crit'
      const wantTrigger = b.trigger ?? 'use';

      if (wantTrigger === 'crit') {
        // Only fire on actual crits regardless of triggerType
        return isCrit;
      }
      // For 'attack': also accept 'crit' events (crits ARE attacks)
      if (wantTrigger === 'attack') {
        return triggerType === 'attack' || triggerType === 'crit';
      }
      return wantTrigger === triggerType;
    });

    if (!matches.length) return;

    for (const match of matches) {
      const preset = this.getTextPresets().find(p => p.name === match.presetName);
      if (!preset) {
        console.warn(`Drama Director | Preset "${match.presetName}" not found`);
        continue;
      }
      console.log(`Drama Director | Firing "${preset.name}" for "${item?.name}" (trigger: ${triggerType})`);
      this.applyEffect('text', preset.options ?? {});
    }
  }

  // ─── Macro generation ────────────────────────────────────────────────────

  generateTextMacro(options, targetUser = null) {
    // If useSelectedToken on charIntro, strip tokenId — resolved at runtime
    const macroOpts = { ...options };
    if (macroOpts.useSelectedToken) delete macroOpts.tokenId;

    // Add runtime note for any useTokenName text layers
    const hasTokenNameSelected = (macroOpts.textLayers || []).some(l => l.useTokenName && l.tokenNameSource === 'selected');
    const hasTokenNameDropdown  = (macroOpts.textLayers || []).some(l => l.useTokenName && l.tokenNameSource === 'dropdown');

    const opts = JSON.stringify(macroOpts, null, 2);
    const userArg = targetUser ? `, "${targetUser}"` : '';
    let comment = macroOpts.useSelectedToken
      ? '\n// ⚠ useSelectedToken: true — используется выделенный токен на карте при запуске'
      : '';
    if (hasTokenNameSelected)
      comment += '\n// ⚠ Token name (selected): текст слоя заменяется именем выделенного токена при запуске';
    if (hasTokenNameDropdown)
      comment += '\n// ⚠ Token name (dropdown): текст слоя заменяется именем указанного токена при запуске';

    return `// Drama Director — Text Effect Macro
// Generated ${new Date().toLocaleDateString()}${comment}
game.dramaDirector.applyEffect('text', ${opts}${userArg});`;
  }

  // ─── Cinematic Intro ──────────────────────────────────────────────────────

  _effectIntro(o = {}) {
    const { title = '', subtitle = '', style = 'epic', animIn = 'reveal', duration = 6000 } = o;
    this.overlays.intro.className = `dd-effect dd-intro-style-${style} dd-intro-anim-${animIn}`;
    this.overlays.intro.innerHTML = `
      <div class="dd-intro-bg"></div>
      <div class="dd-intro-content">
        <div class="dd-intro-line dd-intro-line-top"></div>
        <div class="dd-intro-title">${title}</div>
        ${subtitle ? `<div class="dd-intro-subtitle">${subtitle}</div>` : ''}
        <div class="dd-intro-line dd-intro-line-bottom"></div>
      </div>`;
    const fadeDelay = Math.max(duration - 1000, 500);
    setTimeout(() => {
      this.overlays.intro.classList.add('dd-intro-fadeout');
      setTimeout(() => {
        this.overlays.intro.className = 'dd-effect dd-hidden';
        this.overlays.intro.innerHTML = '';
      }, 1000);
    }, fadeDelay);
  }

  // ─── Video ────────────────────────────────────────────────────────────────

  showVideo(url, options = {}, targetUser = null) {
    if (!url) return;
    if (targetUser && game.user.isGM) {
      game.socket.emit(SOCKET_EVENT, { action: 'video', url, options, targetUser });
      return;
    }
    this._showVideo(url, options);
    if (game.user.isGM && !targetUser) {
      game.socket.emit(SOCKET_EVENT, { action: 'video', url, options, targetUser: null, senderId: game.user.id });
    }
  }

  _showVideo(url, options = {}) {
    const loop   = options.loop   ?? false;
    const volume = options.volume ?? 0.8;
    const autoClose = options.autoClose ?? true;

    this.overlays.video.innerHTML = `
      <div class="dd-video-bg"></div>
      <video id="dd-video-player" class="dd-video-player"
        src="${url}"
        ${loop ? 'loop' : ''}
        autoplay playsinline>
      </video>
      ${game.user.isGM ? `<button class="dd-video-close-btn" id="dd-video-close">
        <i class="fas fa-times"></i>
      </button>` : ''}
    `;
    this.overlays.video.classList.remove('dd-hidden');

    const vid = this.overlays.video.querySelector('#dd-video-player');
    vid.volume = Math.min(1, Math.max(0, volume));
    vid.play().catch(e => console.warn('DD Video | play error', e));

    if (autoClose && !loop) {
      vid.addEventListener('ended', () => this._stopVideo());
    }

    this.overlays.video.querySelector('#dd-video-close')?.addEventListener('click', () => {
      this.stopVideo(null);
    });
  }

  stopVideo(targetUser = null) {
    if (targetUser && game.user.isGM) {
      game.socket.emit(SOCKET_EVENT, { action: 'stopVideo', targetUser });
      return;
    }
    this._stopVideo();
    if (game.user.isGM && !targetUser) {
      game.socket.emit(SOCKET_EVENT, { action: 'stopVideo', targetUser: null, senderId: game.user.id });
    }
  }

  _stopVideo() {
    const vid = document.getElementById('dd-video-player');
    if (vid) { vid.pause(); vid.src = ''; }
    this.overlays.video.classList.add('dd-hidden');
    this.overlays.video.innerHTML = '';
  }

  // ─── Cinematic Intros (all-players) ──────────────────────────────────────

  async triggerSciFiIntro(campaignName = '') {
    const gmUser = game.users.find(u => u.isGM && u.active) || game.users.find(u => u.isGM);
    const gmName = gmUser?.name || 'Game Master';
    executeSciFiIntro(campaignName, gmName);
    if (game.user.isGM) {
      game.socket.emit(SOCKET_EVENT, { action: 'scifiIntro', campaignName, gmName, senderId: game.user.id });
    }
  }

  async triggerDetectiveIntro(campaignName = '') {
    const gmUser = game.users.find(u => u.isGM && u.active) || game.users.find(u => u.isGM);
    const gmName = gmUser?.name || game.i18n.localize('DRAMADIRECTOR.intro.gmDefault');
    executeDetectiveIntro(campaignName, gmName);
    if (game.user.isGM) {
      game.socket.emit(SOCKET_EVENT, { action: 'detectiveIntro', campaignName, gmName, senderId: game.user.id });
    }
  }

  async triggerSinCityIntro(campaignName = '') {
    executeSinCityIntro(campaignName);
    if (game.user.isGM) {
      game.socket.emit(SOCKET_EVENT, { action: 'sinCityIntro', campaignName, senderId: game.user.id });
    }
  }
  async triggerMacheteBloodIntro(campaignName = '') {
    executeMacheteBloodIntro(campaignName);
    if (game.user.isGM) {
      game.socket.emit(SOCKET_EVENT, { action: 'macheteBloodIntro', campaignName, senderId: game.user.id });
    }
  }

  async triggerMacheteIntro(campaignName = '') {
    executeMacheteIntro(campaignName);
    if (game.user.isGM) {
      game.socket.emit(SOCKET_EVENT, { action: 'macheteIntro', campaignName, senderId: game.user.id });
    }
  }

  async triggerSnatchIntro(campaignName = '') {
    executeSnatchIntro(campaignName);
    if (game.user.isGM) {
      game.socket.emit(SOCKET_EVENT, { action: 'snatchIntro', campaignName, senderId: game.user.id });
    }
  }

  // ─── Endings (removed) ───────────────────────────────────────────────────
  // The legacy endings (WBRB / JoJo / JojoSession / ScifiSession) and the JoJo
  // session recorder have been removed from cinematic. The hub no longer
  // exposes an "Endings" panel and no endings-related sockets are wired.

  // Expose emit so external callers can broadcast through us if needed.
  emit(data) {
    game.socket.emit(SOCKET_EVENT, { ...data });
  }

  // ─── Clear ────────────────────────────────────────────────────────────────

  clearEffects(targetUser = null) {
    if (targetUser && game.user.isGM) {
      game.socket.emit(SOCKET_EVENT, { action: 'clear', targetUser });
      return;
    }
    this._clearEffects();
    if (game.user.isGM && !targetUser) {
      game.socket.emit(SOCKET_EVENT, { action: 'clear', targetUser: null, senderId: game.user.id });
    }
  }

  _clearEffects() {
    // Hide all overlay effects
    ['vignette','grayscale','sepia','sketch','text','intro','drunk','high'].forEach(k =>
      this.overlays[k]?.classList.add('dd-hidden'));
    this.overlays.intro.innerHTML = '';
    // Deactivate toggle effects
    this._effectGlitch({ active: false });
    this._effectFilm({ active: false });
    // Clear particles and blood
    this.overlays.particles.innerHTML = '';
    this.overlays.blood.innerHTML = '';
    // Clear all active effects tracking
    this.activeEffects.clear();
  }

  // ─── Sounds ───────────────────────────────────────────────────────────────

  playSound(id) {
    if (!game.settings.get(MODULE_ID, 'enableSounds')) return;
    const vol = game.settings.get(MODULE_ID, 'soundVolume');
    const ctx = this._getAudioContext();
    ({ chord: () => this._playChord(ctx, vol), impact: () => this._playImpact(ctx, vol), sweep: () => this._playSweep(ctx, vol) })[id]?.();
  }

  playCustomSound(url, options = {}) {
    if (!url) return;
    const volume = options.volume ?? game.settings.get(MODULE_ID, 'soundVolume');
    if (options.targetAll && game.user.isGM)
      game.socket.emit(SOCKET_EVENT, { action: 'sound', url, volume, targetUser: null, senderId: game.user.id });
    this._playAudioFile(url, volume);
  }

  stopCustomSound(targetAll = false) {
    if (this._currentAudio) { this._currentAudio.pause(); this._currentAudio.currentTime = 0; this._currentAudio = null; }
    if (targetAll && game.user.isGM)
      game.socket.emit(SOCKET_EVENT, { action: 'stopSound', targetUser: null });
  }

  _playAudioFile(url, volume = 0.7) {
    try {
      if (this._currentAudio) { this._currentAudio.pause(); this._currentAudio = null; }
      const audio = new Audio(url);
      audio.volume = Math.min(1, Math.max(0, volume));
      audio.play().catch(e => console.warn('DD | Audio failed:', e));
      this._currentAudio = audio;
      this._currentAudioBaseVol = audio.volume;
      audio.addEventListener('ended', () => { if (this._currentAudio === audio) this._currentAudio = null; });
      return audio;
    } catch(e) { console.warn('DD | Audio error:', e); return null; }
  }

  /** Smoothly fade out current audio over `ms` milliseconds then stop it. */
  _fadeOutAudio(ms = 800) {
    const audio = this._currentAudio;
    if (!audio) return;
    const startVol  = audio.volume;
    const startTime = performance.now();
    const _tick = (now) => {
      if (this._currentAudio !== audio) return; // was replaced
      const elapsed = now - startTime;
      const t = Math.min(elapsed / ms, 1);
      audio.volume = startVol * (1 - t);
      if (t < 1) {
        requestAnimationFrame(_tick);
      } else {
        audio.pause();
        this._currentAudio = null;
      }
    };
    requestAnimationFrame(_tick);
  }

  _getAudioContext() {
    if (!this.audioContext) this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    return this.audioContext;
  }

  _playChord(ctx, vol) {
    const now = ctx.currentTime;
    [130.81,164.81,196.00,261.63].forEach((freq,i) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'sine'; osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(vol*.25, now+.1);
      gain.gain.exponentialRampToValueAtTime(.001, now+2);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(now+i*.05); osc.stop(now+2);
    });
  }

  _playImpact(ctx, vol) {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = 'sine'; osc.frequency.setValueAtTime(100, now);
    osc.frequency.exponentialRampToValueAtTime(30, now+.3);
    gain.gain.setValueAtTime(vol*.5, now);
    gain.gain.exponentialRampToValueAtTime(.001, now+.4);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(now); osc.stop(now+.4);
  }

  _playSweep(ctx, vol) {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = 'sine'; osc.frequency.setValueAtTime(200, now);
    osc.frequency.exponentialRampToValueAtTime(1200, now+1);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(vol*.3, now+.3);
    gain.gain.exponentialRampToValueAtTime(.001, now+1.5);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(now); osc.stop(now+1.5);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════════════

Hooks.once('init', () => {
  game.dramaDirector = new DramaDirector();
  // Helpers for VN templates
  Handlebars.registerHelper('isVideo', src => /\.(webm|mp4|ogv)$/i.test(src || ''));
  Handlebars.registerHelper('add', (a, b) => (Number(a) + Number(b)));
  Handlebars.registerHelper('eq', (a, b) => a === b);

  // Register the language setting early (during init) so it's available for the override
  game.settings.register(MODULE_ID, 'language', {
    name: 'DRAMADIRECTOR.settings.language',
    hint: 'DRAMADIRECTOR.settings.languageHint',
    scope: 'client', config: true, type: String,
    choices: {
      auto: 'DRAMADIRECTOR.settings.languageAuto',
      en:   'English',
      ru:   'Русский',
      fr:   'Français',
      zh:   '简体中文',
    },
    default: 'auto',
    onChange: () => window.location.reload(),
  });

  // ── Keybindings ───────────────────────────────────────────────────────────
  game.keybindings.register(MODULE_ID, 'emotionWheel', {
    name:     'DRAMADIRECTOR.keybindings.emotionWheel',
    hint:     'DRAMADIRECTOR.keybindings.emotionWheelHint',
    editable: [],           // default: no key (middle mouse is handled separately)
    onDown:   (ctx) => {
      if (!_vnIsOpen()) return false;
      const em = _vnEmotionManager();
      if (!em) return false;
      const x = em._lastMouseX ?? window.innerWidth / 2;
      const y = em._lastMouseY ?? window.innerHeight / 2;
      const char = em._getPlayerChar?.();
      if (!char) return false;
      const favs = em.getFavoritesForChar?.(char.id);
      if (!favs?.length) return false;
      if (em._wheelOpen) em.hideWheel();
      else em.showWheel(x, y);
      return true;
    },
    restricted: false,
    precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL,
  });

  game.keybindings.register(MODULE_ID, 'toggleMic', {
    name:     'DRAMADIRECTOR.keybindings.toggleMic',
    hint:     'DRAMADIRECTOR.keybindings.toggleMicHint',
    editable: [{ key: 'KeyM', modifiers: ['Control'] }],
    onDown:   (ctx) => {
      if (!_vnIsOpen()) return false;
      const mic = _vnMic();
      if (!mic) return false;
      if (mic._active) mic.stop();
      else mic.start();
      _vnOverlay()?.updateMicIndicator?.();
      return true;
    },
    restricted: false,
    precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL,
  });

  // Note: Hub sidebar tab registration is handled in drama-director-hub.mjs
});

// Note: The old button in token tools has been replaced with the Hub sidebar tab.
// Users can access Drama Director via the theater-masks icon in the sidebar.

Hooks.once('ready', () => {
  game.dramaDirector.init();
  // initVNSystem now belongs to drama-director-novella; cinematic doesn't boot VN itself.

  // Activate footsteps if previously enabled
  try {
    // Footsteps boot moved to drama-director-footsteps.
  } catch {}

  // Session Recorder + ending-trigger hooks removed alongside endings panel.

  window.DramaDirector = {
    effect:   (id, opts, user) => game.dramaDirector.applyEffect(id, opts, user),
    dismiss:  (user) => game.dramaDirector.dismissText(user),
    clear:    (user) => game.dramaDirector.clearEffects(user),
    sound:    (id) => game.dramaDirector.playSound(id),
    audio:    (url, opts) => game.dramaDirector.playCustomSound(url, opts),
    stop:     (all) => game.dramaDirector.stopCustomSound(all),
    video:    (url, opts, user) => game.dramaDirector.showVideo(url, opts, user),
    sincity:      (name) => game.dramaDirector.triggerSinCityIntro(name),
    machete:      (name) => game.dramaDirector.triggerMacheteIntro(name),
    macheteBlood: (name) => game.dramaDirector.triggerMacheteBloodIntro(name),
    snatch:       (name) => game.dramaDirector.triggerSnatchIntro(name),
    scifi:        (name) => game.dramaDirector.triggerSciFiIntro(name),
    detective:    (name) => game.dramaDirector.triggerDetectiveIntro(name),
    // Visual Novel
    vn: _vn(),
    // Hub access
    hub: () => ui['drama-director-hub'],
  };
});

// ─── Loading Screen hooks ────────────────────────────────────────────────────
//
// Timing:
//   canvasTearDown  → old scene starts unloading  → SHOW loading screen
//   canvasReady     → new scene fully loaded       → HIDE loading screen
//
// The GM picks the entry on canvasTearDown and broadcasts to players via socket.
// canvasReady fires independently on each client — everyone hides themselves.

Hooks.on('canvasTearDown', () => {
  if (!game.user?.isGM) return;
  game.dramaDirector?.triggerLoadingScreen?.();
});

Hooks.on('canvasReady', () => {
  // ALL clients hide their loading screen once the scene is fully ready
  // Small delay ensures canvas assets have actually rendered
  setTimeout(() => {
    game.dramaDirector?._hideLoadingScreen?.();
  }, 200);
});

// ═══════════════════════════════════════════════════════════════════════════
// ABILITY EFFECTS — SYSTEM-AGNOSTIC ENGINE
// Trigger types: 'use' | 'attack' | 'damage' | 'crit'
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Detect trigger type from a chat message in a system-agnostic way.
 * Returns: 'attack' | 'damage' | 'use' | null (null = not an item-related message)
 * Also returns isCrit.
 */
function _ddClassifyMessage(msg) {
  const allFlags = msg.flags ?? {};
  const rolls    = msg.rolls ?? [];
  let isCrit     = false;

  // ── Skip pure OOC / emote / non-item messages ─────────────────────────────
  // MESSAGE_TYPES: 0=ROLL, 1=OOC, 2=EMOTE, 3=WHISPER, 4=OTHER
  // We process ROLL(0) and OTHER(4) — skip social types
  if (msg.type === 1 || msg.type === 2) return { type: null, isCrit };

  // ── dnd5e v4: roll.type in flags.dnd5e ───────────────────────────────────
  const dnd = allFlags.dnd5e;
  if (dnd?.roll?.type) {
    const rt = dnd.roll.type;
    isCrit = !!(dnd.roll.isCritical ?? dnd.isCritical ?? false);
    if (rt === 'attack')     return { type: isCrit ? 'crit' : 'attack', isCrit };
    if (rt === 'damage')     return { type: 'damage', isCrit };
    if (rt === 'check' || rt === 'save') return { type: 'attack', isCrit };
    // Anything else from dnd5e (tool, ability, etc.) → 'use'
    return { type: 'use', isCrit };
  }

  // ── PF2e: context.type ────────────────────────────────────────────────────
  const pf2 = allFlags.pf2e;
  if (pf2?.context?.type) {
    const rt = pf2.context.type;
    isCrit = pf2.context.outcome === 'criticalSuccess';
    if (rt === 'attack-roll' || rt === 'spell-attack-roll')
      return { type: isCrit ? 'crit' : 'attack', isCrit };
    if (rt === 'damage-roll' || rt === 'spell-damage')
      return { type: 'damage', isCrit };
    return { type: 'use', isCrit };
  }

  // ── WFRP4e ────────────────────────────────────────────────────────────────
  const wfrp = allFlags.wfrp4e;
  if (wfrp) {
    const isHit = wfrp.postData?.result === 'hit' || wfrp.preData?.extra?.hit;
    isCrit = !!(wfrp.postData?.critical || wfrp.preData?.extra?.critical);
    if (wfrp.preData?.weapon || wfrp.preData?.skill)
      return { type: isCrit ? 'crit' : (isHit ? 'attack' : 'use'), isCrit };
  }

  // ── CoC7 ──────────────────────────────────────────────────────────────────
  const coc = allFlags.CoC7 ?? allFlags.coc7;
  if (coc) {
    const success = coc.result?.success;
    isCrit = coc.result?.critical === true;
    return { type: isCrit ? 'crit' : 'attack', isCrit };
  }

  // ── SWADE ─────────────────────────────────────────────────────────────────
  const swade = allFlags.swade;
  if (swade) {
    isCrit = !!(swade.raise || swade.totalRaise);
    return { type: isCrit ? 'crit' : 'attack', isCrit };
  }

  // ── Generic: inspect rolls array ─────────────────────────────────────────
  // Look for damage dice (non-d20 polyhedral formulas with no modifier-only)
  // vs attack dice (has d20 or single flat roll)
  if (rolls.length > 0) {
    let hasD20   = false;
    let hasDamage = false;
    for (const r of rolls) {
      const formula = (r.formula ?? r._formula ?? '').toLowerCase();
      if (/\bd20\b/.test(formula) || r.dice?.some(d => d.faces === 20)) hasD20 = true;
      // Damage: has dx but NOT d20, or has multiple dice terms
      if (/\bd(4|6|8|10|12|20)\b/.test(formula) && !/^\s*\d+d20/.test(formula)) hasDamage = true;
      // Crit detection from roll terms
      if (r.terms?.some?.(t => t.results?.some?.(res => res.result === 20 && res.active !== false && t.faces === 20)))
        isCrit = true;
    }
    if (hasD20)    return { type: isCrit ? 'crit' : 'attack', isCrit };
    if (hasDamage) return { type: 'damage', isCrit };
  }

  // ── No rolls and has item reference → treat as 'use' card ────────────────
  return { type: 'use', isCrit };
}

/**
 * Extract the Item object from a chat message (system-agnostic, 7 strategies).
 */
function _ddExtractItemFromMessage(msg) {
  const actor    = msg.speaker?.actor ? game.actors.get(msg.speaker.actor) : null;
  const allFlags = msg.flags ?? {};

  // Strategy 1: msg.item — pf2e, wfrp4e, swade, etc.
  if (msg.item instanceof Item) return msg.item;

  // Strategy 2: uuid in any flag namespace
  for (const ns of Object.values(allFlags)) {
    if (typeof ns !== 'object' || ns === null) continue;
    const uuid = ns.uuid ?? ns.itemUuid ?? ns.origin?.uuid ?? ns.item?.uuid;
    if (typeof uuid === 'string' && uuid.includes('.')) {
      try { const it = fromUuidSync?.(uuid); if (it instanceof Item) return it; } catch {}
    }
  }

  // Strategy 3: actor.items by id in flags
  if (actor) {
    for (const ns of Object.values(allFlags)) {
      if (typeof ns !== 'object' || ns === null) continue;
      const ids = [
        ns.itemId, ns.item?._id, ns.item?.id, ns.itemData?._id,
        ns.origin?.id, ns.origin?.itemId, ns.roll?.itemId, ns.sourceId,
      ].filter(Boolean);
      for (const id of ids) { const it = actor.items.get(id); if (it) return it; }
    }
  }

  // Strategy 4: dnd5e v4
  const dnd = allFlags.dnd5e;
  if (dnd && actor) {
    const itemId = dnd.roll?.itemId ?? dnd.itemId ?? dnd.item?.id;
    if (itemId) { const it = actor.items.get(itemId); if (it) return it; }
  }

  // Strategy 5: pf2e origin
  const pf2 = allFlags.pf2e;
  if (pf2) {
    const uuid = pf2.origin?.uuid ?? pf2.item?.uuid;
    if (uuid) {
      try { const it = fromUuidSync?.(uuid); if (it instanceof Item) return it; } catch {}
    }
  }

  // Strategy 6: WFRP4e
  const wfrp = allFlags.wfrp4e;
  if (wfrp && actor) {
    const itemId = wfrp.preData?.weapon?.id ?? wfrp.preData?.skill?.id ?? wfrp.itemId;
    if (itemId) { const it = actor.items.get(itemId); if (it) return it; }
  }

  // Strategy 7: rolls[].data.itemId
  for (const roll of (msg.rolls ?? [])) {
    const d = roll?.data ?? roll?.options ?? {};
    const id = d.itemId ?? d.item?._id;
    if (id && actor) { const it = actor.items.get(id); if (it) return it; }
  }

  return null;
}

/**
 * De-duplication: track (itemUuid + triggerType) pairs processed this tick.
 * Prevents the same event from firing multiple times via different hooks.
 */
const _aeProcessed = new Set();
function _ddFireAbilityEffect(item, triggerType, isCrit, dedupKey) {
  if (!item || !game.user?.isGM) return;
  const key = dedupKey ?? `${item.uuid}::${triggerType}`;
  if (_aeProcessed.has(key)) return;
  _aeProcessed.add(key);
  setTimeout(() => _aeProcessed.delete(key), 800);
  game.dramaDirector?._onItemUse?.(item, triggerType, isCrit ?? false);
}

// ── Universal: createChatMessage — fires for EVERY system ────────────────────
Hooks.on('createChatMessage', (msg) => {
  if (!game.user?.isGM) return;
  const classified = _ddClassifyMessage(msg);
  if (!classified.type) return;
  const item = _ddExtractItemFromMessage(msg);
  if (!item) return;
  _ddFireAbilityEffect(item, classified.type, classified.isCrit, `msg::${msg.id}::${classified.type}`);
});

// ── dnd5e v4 useActivity — fires on the "use" click before any rolls ─────────
Hooks.on('dnd5e.useActivity', (activity) => {
  const item = activity?.item ?? activity?.parent;
  if (!(item instanceof Item)) return;
  _ddFireAbilityEffect(item, 'use', false, `useActivity::${item.uuid}`);
});

// ── dnd5e v3 legacy ──────────────────────────────────────────────────────────
Hooks.on('dnd5e.useItem', (item) => {
  if (!(item instanceof Item)) return;
  _ddFireAbilityEffect(item, 'use', false, `useItem::${item.uuid}`);
});

// ── midi-qol — authoritative isCritical, fires after full resolution ──────────
Hooks.on('midi-qol.RollComplete', (workflow) => {
  const item = workflow?.item;
  if (!(item instanceof Item)) return;
  const isCrit    = !!(workflow?.isCritical || workflow?.isCrit);
  const rollType  = isCrit ? 'crit' : 'attack';
  // midi-qol fires once per full roll sequence — deduplicate by workflow id
  const dedupId   = workflow?.id ?? workflow?.uuid ?? item.uuid;
  _ddFireAbilityEffect(item, rollType,  isCrit, `midi::${dedupId}::${rollType}`);
  // Also fire 'damage' if workflow has damage rolls
  if (workflow?.damageRolls?.length || workflow?.damageTotal != null) {
    _ddFireAbilityEffect(item, 'damage', isCrit, `midi::${dedupId}::damage`);
  }
});
