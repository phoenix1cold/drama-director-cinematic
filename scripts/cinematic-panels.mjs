/**
 * Drama Director - Individual Panels
 * Each panel is a separate ApplicationV2 window.
 *
 * Currently shipped panels:
 *   - IntroPanel    — Sin City / Snatch / Machete / MacheteBlood / Sci-Fi / Detective intros
 *   - EffectsPanel  — Ability Effects only (item→preset bindings); legacy
 *                     screen effects and Loading Screen tabs were removed.
 *
 * Removed (formerly here):
 *   - EndingsPanel  — WBRB/Jojo/JojoSession/ScifiSession outros + JoJo recorder
 *   - VideoPanel    — replaced by the video layer in drama-director-textpics
 */

const MODULE_ID = 'drama-director-cinematic';
const { HandlebarsApplicationMixin } = foundry.applications.api;

// ═══════════════════════════════════════════════════════════════════════════
// INTRO PANEL
// ═══════════════════════════════════════════════════════════════════════════

export class IntroPanel extends HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: 'dd-intro-panel',
    classes: ['drama-director', 'dd-panel'],
    tag: 'div',
    window: { title: 'DRAMADIRECTOR.tabs.intro', icon: 'fas fa-film', resizable: true },
    position: { width: 480, height: 'auto' }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/intro-panel.hbs` }
  };

  async _prepareContext() {
    return {
      campaignName: '',
      introStyles: [
        { id:'sincity',    name: game.i18n.localize('DRAMADIRECTOR.intro.sincityTitle'),    icon: 'fa-solid fa-city' },
        { id:'snatch',     name: game.i18n.localize('DRAMADIRECTOR.intro.snatchTitle'),     icon: 'fa-solid fa-fist-raised' },
        { id:'machete',    name: game.i18n.localize('DRAMADIRECTOR.intro.macheteTitle'),    icon: 'fa-solid fa-user-ninja' },
        { id:'machete-blood', name: game.i18n.localize('DRAMADIRECTOR.intro.macheteBloodTitle'), icon: 'fa-solid fa-tint' },
        { id:'scifi',      name: 'Sci-Fi Opening', icon: 'fa-solid fa-rocket' },
        { id:'detective',  name: game.i18n.localize('DRAMADIRECTOR.intro.detectiveTitle'), icon: 'fa-solid fa-search' },
      ]
    };
  }

  _onRender(context, options) {
    const html = this.element;

    html.querySelector('[data-action="run-sincity"]')?.addEventListener('click', () => {
      const name = html.querySelector('#dd-campaign-name')?.value?.trim() ?? '';
      game.dramaDirector.triggerSinCityIntro(name);
    });
    html.querySelector('[data-action="run-snatch"]')?.addEventListener('click', () => {
      const name = html.querySelector('#dd-campaign-name')?.value?.trim() ?? '';
      game.dramaDirector.triggerSnatchIntro(name);
    });
    html.querySelector('[data-action="run-machete"]')?.addEventListener('click', () => {
      const name = html.querySelector('#dd-campaign-name')?.value?.trim() ?? '';
      game.dramaDirector.triggerMacheteIntro(name);
    });
    html.querySelector('[data-action="run-machete-blood"]')?.addEventListener('click', () => {
      const name = html.querySelector('#dd-campaign-name')?.value?.trim() ?? '';
      game.dramaDirector.triggerMacheteBloodIntro(name);
    });
    html.querySelector('[data-action="run-scifi"]')?.addEventListener('click', () => {
      const name = html.querySelector('#dd-campaign-name')?.value?.trim() ?? '';
      game.dramaDirector.triggerSciFiIntro(name);
    });
    html.querySelector('[data-action="run-detective"]')?.addEventListener('click', () => {
      const name = html.querySelector('#dd-campaign-name')?.value?.trim() ?? '';
      game.dramaDirector.triggerDetectiveIntro(name);
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EFFECTS PANEL — now ABILITY EFFECTS only.
// (Screen-effect toggles and Loading Screen tab removed.)
// ═══════════════════════════════════════════════════════════════════════════

export class EffectsPanel extends HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: 'dd-effects-panel',
    classes: ['drama-director', 'dd-panel'],
    tag: 'div',
    window: { title: 'DRAMADIRECTOR.abilityEffects.tabLabel', icon: 'fas fa-bolt', resizable: true },
    position: { width: 500, height: 640 }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/effects-panel.hbs` }
  };

  async _prepareContext() {
    return {
      textPresets: game.dramaDirector.getTextPresets(),
    };
  }

  _onRender(context, options) {
    const html = this.element;
    this._initAbilitiesTab(html);
  }

  // ─── Ability Effects logic ────────────────────────────────────────────────

  _initAbilitiesTab(html) {
    const loc     = k => game.i18n.localize(k);

    // ── State ──────────────────────────────────────────────────────────────
    // `presets` is mutable so that re-pulling from the textpics namespace
    // (after the user creates a new preset there) does not require a full
    // panel re-render — only a list rebuild.
    let bindings = [...(game.dramaDirector.getAbilityEffects() ?? [])];
    let presets  = game.dramaDirector.getTextPresets() ?? [];

    const TRIGGERS = [
      { id: 'use',    icon: 'fas fa-hand-pointer', labelKey: 'DRAMADIRECTOR.abilityEffects.triggerUse'    },
      { id: 'attack', icon: 'fas fa-dice-d20',     labelKey: 'DRAMADIRECTOR.abilityEffects.triggerAttack' },
      { id: 'damage', icon: 'fas fa-tint',         labelKey: 'DRAMADIRECTOR.abilityEffects.triggerDamage' },
      { id: 'crit',   icon: 'fas fa-star',         labelKey: 'DRAMADIRECTOR.abilityEffects.triggerCrit'   },
    ];

    const save = async () => {
      await game.dramaDirector.saveAbilityEffects(bindings);
    };

    const _refreshPresets = () => {
      presets = game.dramaDirector.getTextPresets() ?? [];
    };

    const _buildList = () => {
      const list = html.querySelector('#dd-ae-list');
      if (!list) return;
      list.innerHTML = '';
      if (!bindings.length) {
        list.innerHTML = `<div class="dd-ae-empty">${loc('DRAMADIRECTOR.abilityEffects.empty')}</div>`;
        return;
      }

      bindings.forEach((b, i) => {
        const row = document.createElement('div');
        row.className = 'dd-ae-row';

        // Timeline-mode presets (those with options.timeline.clips) get a
        // film icon; legacy simple-mode presets get an image icon. <option>
        // elements don't render FontAwesome, so we prefix the visible label
        // with an emoji glyph as a portable marker.
        const _glyph = (p) => (p?.options?.timeline?.clips?.length ? '🎬' : '🖼');
        const presetOpts = presets.map(p =>
          `<option value="${p.name}" ${p.name === b.presetName ? 'selected' : ''}>${_glyph(p)}  ${p.name}</option>`
        ).join('');

        const currentTrigger = b.trigger ?? 'use';

        const triggerBtns = TRIGGERS.map(t => `
          <button type="button"
            class="dd-ae-trigger-btn ${currentTrigger === t.id ? 'active' : ''}"
            data-trigger="${t.id}"
            title="${loc(t.labelKey)}">
            <i class="${t.icon}"></i>
            <span>${loc(t.labelKey)}</span>
          </button>`
        ).join('');

        row.innerHTML = `
          <div class="dd-ae-row-header">
            <img class="dd-ae-item-img" src="${b.itemImg || 'icons/svg/item-bag.svg'}" title="${b.itemName || ''}">
            <div class="dd-ae-row-info">
              <span class="dd-ae-item-name">${b.itemName || loc('DRAMADIRECTOR.abilityEffects.unknownItem')}</span>
              <span class="dd-ae-actor-name">${b.actorName ? '(' + b.actorName + ')' : loc('DRAMADIRECTOR.abilityEffects.anyActor')}</span>
            </div>
            <button type="button" class="dd-icon-btn dd-ae-remove-btn" title="${loc('DRAMADIRECTOR.loadingScreen.remove')}">
              <i class="fas fa-times"></i>
            </button>
          </div>
          <div class="dd-ae-trigger-row">${triggerBtns}</div>
          <div class="dd-ae-row-controls">
            <select class="dd-input dd-ae-preset-sel" style="flex:1">
              <option value="">— ${loc('DRAMADIRECTOR.abilityEffects.selectPreset')} —</option>
              ${presetOpts}
            </select>
            <button type="button" class="dd-icon-btn dd-ae-refresh-btn"
              title="${loc('DRAMADIRECTOR.abilityEffects.refreshPresets') || 'Refresh presets'}">
              <i class="fas fa-sync-alt"></i>
            </button>
          </div>`;

        // Remove binding
        row.querySelector('.dd-ae-remove-btn').addEventListener('click', () => {
          bindings.splice(i, 1);
          save();
          _buildList();
        });

        // Trigger selector — single-active toggle
        row.querySelectorAll('.dd-ae-trigger-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            bindings[i].trigger = btn.dataset.trigger;
            save();
            row.querySelectorAll('.dd-ae-trigger-btn').forEach(b2 =>
              b2.classList.toggle('active', b2 === btn)
            );
          });
        });

        // Preset selector
        row.querySelector('.dd-ae-preset-sel').addEventListener('change', (e) => {
          bindings[i].presetName = e.target.value;
          save();
        });

        // Per-row refresh button: pull latest presets from textpics namespace.
        row.querySelector('.dd-ae-refresh-btn').addEventListener('click', () => {
          _refreshPresets();
          _buildList();
        });

        list.appendChild(row);
      });
    };

    _buildList();

    // Toolbar-level refresh (re-reads textpics presets without re-rendering panel)
    html.querySelector('[data-action="ae-refresh-presets"]')?.addEventListener('click', () => {
      _refreshPresets();
      _buildList();
      ui.notifications?.info(
        loc('DRAMADIRECTOR.abilityEffects.presetsRefreshed') || 'Presets refreshed.'
      );
    });

    // ── Drop zone ──────────────────────────────────────────────────────────
    const dropzone = html.querySelector('#dd-ae-dropzone');
    if (!dropzone) return;

    dropzone.addEventListener('dragover',  (e) => { e.preventDefault(); dropzone.classList.add('dd-ae-dropzone--over'); });
    dropzone.addEventListener('dragleave', ()  => dropzone.classList.remove('dd-ae-dropzone--over'));
    dropzone.addEventListener('drop', async (e) => {
      e.preventDefault();
      dropzone.classList.remove('dd-ae-dropzone--over');

      let data;
      try { data = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
      if (data?.type !== 'Item' && data?.type !== 'item') return;

      const uuid = data.uuid ?? data.pack ?? null;
      if (!uuid) return;

      let item;
      try { item = await fromUuid(uuid); } catch { return; }
      if (!item) return;

      const actor = item.parent instanceof Actor ? item.parent : null;

      const exists = bindings.find(b =>
        b.itemUuid === uuid && (b.actorId ?? '') === (actor?.id ?? '')
      );
      if (exists) { ui.notifications?.warn(loc('DRAMADIRECTOR.abilityEffects.alreadyAdded')); return; }

      // Make sure we have the latest presets so the new row can pick from them.
      _refreshPresets();

      bindings.push({
        itemUuid:   uuid,
        itemName:   item.name ?? '',
        itemImg:    item.img  ?? 'icons/svg/item-bag.svg',
        actorId:    actor?.id   ?? '',
        actorName:  actor?.name ?? '',
        presetName: presets[0]?.name ?? '',
        trigger:    'use',
      });
      save();
      _buildList();
      ui.notifications?.info(game.i18n.format('DRAMADIRECTOR.abilityEffects.added', { name: item.name ?? '' }));
    });
  }
}
