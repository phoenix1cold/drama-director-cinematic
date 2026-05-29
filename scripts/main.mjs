/**
 * Drama Director — Cinematic — Module entry point
 *
 * Loads the cinematic core (effect engine, intros, loading screen) and
 * registers per-panel sidebar buttons with the hub.
 *
 * Removed in this build:
 *   - Endings panel (WBRB / Jojo / JojoSession / ScifiSession outros + JoJo recorder)
 *   - Video panel (standalone) — video is now an in-place layer inside TextPics
 *
 * Effects panel is now Ability Effects only.
 */

// Side-effect import: cinematic-core registers Hooks.once('init'/'ready'/...)
// itself and exposes `game.dramaDirector`.
import './cinematic-core.mjs';

// Panel classes for hub registration:
import {
  IntroPanel,
  EffectsPanel,
} from './cinematic-panels.mjs';

const MODULE_ID = 'drama-director-cinematic';
const HUB_ID    = 'drama-director-hub';

function _ensureHub() {
  return game.modules.get(HUB_ID)?.api;
}

Hooks.once('setup', () => {
  const hub = _ensureHub();
  if (!hub) {
    console.error('[DD Cinematic] hub not available; cinematic panels will not appear in sidebar');
    return;
  }

  hub.registerPanel({
    id: 'intros',
    moduleId: MODULE_ID,
    label: 'DDCINEMATIC.hub.introsLabel',
    hint:  'DDCINEMATIC.hub.introsHint',
    description: 'DDCINEMATIC.hub.introsDesc',
    icon: 'fa-solid fa-clapperboard',
    color: '#e8a020',
    order: 10,
    open: () => new IntroPanel().render(true),
  });

  hub.registerPanel({
    id: 'effects',
    moduleId: MODULE_ID,
    label: 'DDCINEMATIC.hub.effectsLabel',
    hint:  'DDCINEMATIC.hub.effectsHint',
    description: 'DDCINEMATIC.hub.effectsDesc',
    icon: 'fa-solid fa-bolt',
    color: '#9d70ff',
    order: 30,
    open: () => new EffectsPanel().render(true),
  });
});
