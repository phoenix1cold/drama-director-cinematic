/**
 * Drama Director - Introductions
 * + Gentlemen & Snatch cinematic intros
 */

const MODULE_ID = 'drama-director-cinematic';

function injectStyles(id, css) {
  if (document.getElementById(id)) return;
  const s = document.createElement('style'); s.id = id; s.textContent = css;
  document.head.appendChild(s);
}

// ─── Get actor data: portrait = actor.img (not token) ─────────────────────

export function getSelectedTokenData() {
  const token = canvas?.tokens?.controlled?.[0];
  if (!token?.actor) return null;
  const actor = token.actor;
  const portrait = actor.img;
  let name = (token.document?.name || actor.prototypeToken?.name || actor.name)
    .replace(/\s*\[[^\]]*\]/g, '').split('/')[0].trim();
  let title = actor.getFlag?.(MODULE_ID, 'introTitle') || '';
  if (!title) {
    if (actor.type === 'npc') {
      const ct = actor.system?.details?.type?.value;
      title = ct ? ct.charAt(0).toUpperCase() + ct.slice(1) : '';
    } else {
      const cls = Object.values(actor.classes ?? {});
      title = cls.length ? cls.map(c => c.name).join(' / ') : (actor.system?.details?.race || '');
    }
  }
  const bio = actor.system?.details?.biography?.value || '';
  const description = bio.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150);
  return { portrait, name, title, description };
}

// ─── Collect all active players data for cinematic intros ─────────────────

async function getIntroPlayersData() {
  const players = [];
  for (const user of game.users.filter(u => u.active && !u.isGM)) {
    const ch = user.character;
    let title = '';
    if (ch) {
      title = ch.getFlag?.(MODULE_ID, 'introTitle') || '';
      if (!title) {
        const cls = Object.values(ch.classes ?? {});
        title = cls.length ? cls.map(c => c.name).join(' / ') : (ch.system?.details?.race || ch.system?.details?.type?.value || '');
        if (title) title = title.charAt(0).toUpperCase() + title.slice(1);
      }
    }
    players.push({
      playerName: user.name,
      characterName: ch?.name || user.name,
      portrait: ch?.img || user.avatar || 'icons/svg/mystery-man.svg',
      title,
    });
  }
  // If no players, fall back to GM characters on canvas
  if (!players.length) {
    const tokens = (canvas?.tokens?.placeables ?? []).filter(t => t.actor && !t.document.hidden);
    for (const t of tokens.slice(0, 6)) {
      players.push({
        playerName: 'GM',
        characterName: t.actor.name,
        portrait: t.actor.img || 'icons/svg/mystery-man.svg',
        title: '',
      });
    }
  }
  return players;
}

// ─── Smoke transition engine (SVG displacement filter) ────────────────────

function animateSmokeFilter(element, direction, duration) {
  return new Promise(resolve => {
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;top:0;left:0;';
    const id = `sf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    svg.innerHTML = `<defs>
      <filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">
        <feTurbulence id="${id}-t" type="fractalNoise" baseFrequency="0.025 0.04"
          numOctaves="5" seed="${(Math.random() * 100) | 0}" result="noise"/>
        <feDisplacementMap id="${id}-d" in="SourceGraphic" in2="noise"
          scale="0" xChannelSelector="R" yChannelSelector="G"/>
      </filter>
    </defs>`;
    document.body.appendChild(svg);

    const turb = svg.querySelector(`#${id}-t`);
    const disp = svg.querySelector(`#${id}-d`);

    element.style.filter = `url(#${id})`;
    element.style.opacity = direction === 'out' ? '1' : '0';

    let start = null;
    const frame = (ts) => {
      if (!start) start = ts;
      const raw = Math.min((ts - start) / duration, 1);
      const p = direction === 'out' ? raw * raw : 1 - Math.pow(1 - raw, 2);
      const maxScale = 220;
      const scale = direction === 'out' ? p * maxScale : (1 - p) * maxScale;
      const freq = 0.025 + (direction === 'out' ? p : (1 - p)) * 0.1;

      turb.setAttribute('baseFrequency', `${freq.toFixed(4)} ${(freq * 1.7).toFixed(4)}`);
      disp.setAttribute('scale', scale.toFixed(1));
      element.style.opacity = (direction === 'out' ? 1 - raw : raw).toString();

      if (raw < 1) {
        requestAnimationFrame(frame);
      } else {
        svg.remove();
        element.style.filter = '';
        resolve();
      }
    };
    requestAnimationFrame(frame);
  });
}

function smokeMaterialize(el, dur = 1000) { return animateSmokeFilter(el, 'in', dur); }
function smokeDissolve(el, dur = 1000)    { return animateSmokeFilter(el, 'out', dur); }

// ─── Helpers ──────────────────────────────────────────────────────────────

function waitMs(ms) { return new Promise(r => setTimeout(r, ms)); }

function waitSkippable(ms, isSkip) {
  return new Promise(resolve => {
    const step = 50; let elapsed = 0;
    const tick = () => {
      if (isSkip()) { resolve(true); return; }
      elapsed += step;
      if (elapsed >= ms) { resolve(false); return; }
      setTimeout(tick, step);
    };
    setTimeout(tick, step);
  });
}

// ─── Shared preload utility ──────────────────────────────────────────────────
// Preloads images, audio and video files before playback to avoid buffering stalls.
// items: [{ type: 'image'|'audio'|'video', url: string }]
// Resolves when all done OR timeoutMs elapses — whichever comes first.
function _ddPreload(items, timeoutMs = 9000) {
  const promises = items.map(({ type, url }) => new Promise(resolve => {
    if (!url) return resolve();
    if (type === 'image') {
      const el = new Image();
      el.onload = el.onerror = resolve;
      el.src = url;
    } else if (type === 'audio') {
      const el = new Audio();
      el.preload = 'auto';
      const done = () => { clearTimeout(t); resolve(); };
      const t = setTimeout(done, 6000);
      el.addEventListener('canplaythrough', done, { once: true });
      el.addEventListener('error', done, { once: true });
      el.src = url;
      el.load();
    } else if (type === 'video') {
      const el = document.createElement('video');
      el.preload = 'auto'; el.muted = true;
      el.style.cssText = 'position:fixed;opacity:0;pointer-events:none;top:-9999px;left:-9999px;width:1px;height:1px;';
      document.body.appendChild(el);
      const done = () => { clearTimeout(t); resolve(); };
      const t = setTimeout(done, 10000);
      el.addEventListener('canplaythrough', done, { once: true });
      el.addEventListener('error', done, { once: true });
      el.src = url; el.load();
      setTimeout(() => el.remove(), 20000);
    } else {
      resolve();
    }
  }));
  return Promise.race([
    Promise.all(promises),
    new Promise(r => setTimeout(r, timeoutMs)),
  ]);
}

// ═══════════════════════════════════════════════════════════════════════════
// SIN CITY INTRO — Frank Miller / Robert Rodriguez style
// ═══════════════════════════════════════════════════════════════════════════

injectStyles('dd-sincity-styles', `
@import url('https://fonts.googleapis.com/css2?family=Anton&family=Special+Elite&display=swap');

/* ── overlay (always black) ── */
.sc-overlay {
  position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
  z-index: 10000; overflow: hidden; pointer-events: auto; background: #000;
}

/* ── black curtain sits on TOP of everything — fades in/out ── */
.sc-curtain {
  position: absolute; inset: 0; z-index: 80;
  background: #000; pointer-events: none;
  opacity: 1; transition: opacity 0.32s ease-in-out;
}
.sc-curtain.sc-open { opacity: 0; }

/* ── film grain ── */
.sc-grain {
  position: absolute; inset: 0; z-index: 70; pointer-events: none;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 300 300' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  opacity: 0.08; mix-blend-mode: overlay;
  animation: sc-grain 0.09s steps(3) infinite;
}
@keyframes sc-grain {
  0%   { background-position: 0 0; }
  33%  { background-position: 12px -9px; }
  66%  { background-position: -8px 15px; }
}

/* ══ TITLE CARD — like the screenshot ══
   • Small cream italic "GM's" top-left
   • Massive dark red title, rotated -3deg, bottom-anchored, fills screen
*/
.sc-title-card { position: absolute; inset: 0; z-index: 10; }

.sc-gm-byline {
  position: absolute;
  top: clamp(20px, 4vh, 60px);
  left: clamp(28px, 4vw, 70px);
  font-family: 'Special Elite', 'Georgia', serif;
  font-size: clamp(1rem, 2vw, 2.4rem);
  color: #f0ead6; font-style: italic; letter-spacing: 0.08em;
  text-shadow: 0 2px 12px rgba(0,0,0,0.8);
}

.sc-campaign-title {
  position: absolute;
  top: 50%; left: 50%;
  width: 90vw;
  font-family: 'Anton', 'Impact', sans-serif;
  font-size: clamp(5rem, 17vw, 22rem);
  color: #7a0000;
  line-height: 0.82; text-transform: uppercase; letter-spacing: -0.02em;
  text-align: center;
  /* centered, then rotated -3deg on its center — exactly like the poster */
  transform: translate(-50%, -50%) rotate(-3deg);
  text-shadow: 4px 4px 0 #420000, 9px 9px 0 #1a0000, 0 0 100px rgba(80,0,0,0.6);
}

/* ══ CHARACTER CARDS ══ */
.sc-char-card { position: absolute; inset: 0; z-index: 10; }

/* Portrait — occupies right or left half, slides in and STAYS */
.sc-portrait-wrap {
  position: absolute; top: 0; bottom: 0; width: 55vw; overflow: hidden;
  display: flex; align-items: flex-end; justify-content: center;
}
.sc-portrait-wrap.sc-right { right: 0; }
.sc-portrait-wrap.sc-left  { left: 0; }

.sc-portrait-img {
  display: block; width: 100%; height: 100%;
  object-fit: cover; object-position: center top;
  filter: grayscale(1) contrast(6) brightness(1.1);
  opacity: 0;
  transition: opacity 1.2s ease-out;
}
/* Continuous drift — portrait never stops, moves from edge toward and past center */
.sc-portrait-wrap.sc-right .sc-portrait-img {
  animation: sc-port-drift-right 60s linear forwards;
}
.sc-portrait-wrap.sc-left .sc-portrait-img {
  animation: sc-port-drift-left 60s linear forwards;
}
@keyframes sc-port-drift-right {
  0%   { transform: translateX(0vw);   opacity: 0; }
  8%   { opacity: 1; }
  100% { transform: translateX(-30vw); opacity: 1; }
}
@keyframes sc-port-drift-left {
  0%   { transform: translateX(0vw);  opacity: 0; }
  8%   { opacity: 1; }
  100% { transform: translateX(30vw); opacity: 1; }
}
/* Fade out together */
.sc-portrait-img.sc-out {
  opacity: 0 !important;
  transition: opacity 1s ease-in !important;
  animation-play-state: paused !important;
}

/* Name text — drifts slowly from its edge into resting position, then fades out */
.sc-char-name-wrap {
  position: absolute; z-index: 25;
  top: 50%;
  display: flex; flex-direction: column;
  pointer-events: none; opacity: 0;
}
/* Portrait RIGHT → name occupies LEFT half */
.sc-char-name-wrap.sc-txt-left {
  left: clamp(20px, 3vw, 50px); right: 55vw; text-align: left;
}
/* Portrait LEFT → name occupies RIGHT half */
.sc-char-name-wrap.sc-txt-right {
  left: 55vw; right: clamp(20px, 3vw, 50px); text-align: left;
}
/* Continuous drift — name never stops, moves from its edge toward center */
@keyframes sc-name-drift-left {
  0%   { transform: translateY(-50%) translateX(0vw);   opacity: 0; }
  10%  { opacity: 1; }
  100% { transform: translateY(-50%) translateX(25vw);  opacity: 1; }
}
@keyframes sc-name-drift-right {
  0%   { transform: translateY(-50%) translateX(0vw);   opacity: 0; }
  10%  { opacity: 1; }
  100% { transform: translateY(-50%) translateX(-25vw); opacity: 1; }
}
.sc-char-card.sc-on .sc-char-name-wrap.sc-txt-left  { animation: sc-name-drift-left  60s linear forwards; }
.sc-char-card.sc-on .sc-char-name-wrap.sc-txt-right { animation: sc-name-drift-right 60s linear forwards; }
/* Fade out together */
.sc-char-name-wrap.sc-out {
  opacity: 0 !important;
  transition: opacity 1s ease-in !important;
  animation-play-state: paused !important;
}

.sc-char-name {
  font-family: 'Anton', 'Impact', sans-serif;
  font-size: clamp(2.8rem, 7.5vw, 10rem);
  color: #8b0000; line-height: 0.85;
  text-transform: uppercase; letter-spacing: 0.01em;
  -webkit-text-stroke: clamp(2px, 0.3vw, 4px) #ffffff;
  paint-order: stroke fill;
  text-shadow: 3px 3px 0 #3d0000, 6px 6px 0 #1a0000;
  word-break: break-word;
}
.sc-player-name {
  font-family: 'Special Elite', serif; font-style: italic;
  font-size: clamp(0.7rem, 1vw, 1.2rem);
  color: rgba(240,234,214,0.5); letter-spacing: 0.3em;
  margin-top: clamp(8px, 1vh, 16px); text-transform: uppercase;
}

/* ── directed-by card ── */
.sc-dirby-card {
  position: absolute; inset: 0; z-index: 10;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
}
.sc-dirby-label {
  font-family: 'Special Elite', serif; font-style: italic;
  font-size: clamp(0.8rem, 1.3vw, 1.6rem);
  color: rgba(240,234,214,0.38); letter-spacing: 0.55em; text-transform: uppercase;
  margin-bottom: clamp(10px, 1.5vh, 22px);
}
.sc-dirby-name {
  font-family: 'Anton', 'Impact', sans-serif;
  font-size: clamp(2.8rem, 7vw, 9rem);
  color: #8b0000; text-transform: uppercase; letter-spacing: 0.03em;
  text-shadow: 3px 3px 0 #3a0000, 6px 6px 0 #1a0000;
}

/* ── skip button ── */
.sc-skip-btn {
  position: fixed; bottom: 22px; right: 22px; z-index: 10020;
  display: flex; align-items: center; gap: 7px;
  padding: 8px 18px; background: rgba(0,0,0,0.92);
  border: 1px solid rgba(139,0,0,0.5); border-radius: 1px; color: #8b0000;
  font-family: 'Anton', sans-serif; font-size: 13px;
  letter-spacing: 3px; text-transform: uppercase;
  cursor: pointer; opacity: 0; transform: translateY(12px);
  transition: opacity 0.35s, transform 0.35s; pointer-events: auto;
}
.sc-skip-btn.sc-on { opacity: 1; transform: translateY(0); }
.sc-skip-btn:hover { border-color: #8b0000; }
`);

// ─── Player data ───────────────────────────────────────────────────────────
async function getSinCityPlayersData() {
  const players = [];
  for (const user of game.users.filter(u => u.active && !u.isGM)) {
    const ch = user.character;
    if (!ch) continue;
    players.push({
      playerName:    user.name,
      characterName: ch.name.toUpperCase(),
      portrait:      ch.img || user.avatar || 'icons/svg/mystery-man.svg',
    });
  }
  return players;
}

// ─── Curtain helpers — curtain starts OPAQUE (dark), we open/close it ─────
// "open" = scene visible, "close" = black
async function curtainOpen(el) {
  el.classList.add('sc-open');
  await waitMs(350);
}
async function curtainClose(el) {
  el.classList.remove('sc-open');
  await waitMs(350);
}

let scPlaying = false, scSkipFlag = false, scAudio = null;

export async function executeSinCityIntro(campaignName = '') {
  if (scPlaying) return;
  scPlaying  = true;
  scSkipFlag = false;
  const isSkip = () => scSkipFlag;

  const players = await getSinCityPlayersData();
  const gmUser  = game.users.find(u => u.isGM && u.active) || game.users.find(u => u.isGM);
  const gmName  = gmUser?.name || 'Game Master';

  // ── Preload ──────────────────────────────────────────────────────────────
  await _ddPreload([
    { type: 'audio', url: `modules/${MODULE_ID}/assets/sounds/sin.ogg` },
    ...players.map(p => ({ type: 'image', url: p.portrait })),
  ]);

  // Audio
  scAudio = new Audio(`modules/${MODULE_ID}/assets/sounds/sin.ogg`);
  scAudio.volume = 0.85;
  scAudio.play().catch(() => {});

  // Build overlay — curtain starts OPAQUE (everything hidden behind it)
  const overlay = document.createElement('div');
  overlay.className = 'sc-overlay';
  overlay.innerHTML = `
    <div class="sc-grain"></div>
    <div class="sc-curtain" id="sc-curtain"></div>
  `;
  document.body.appendChild(overlay);

  // Skip button
  if (game.user?.isGM) {
    const skipBtn = document.createElement('button');
    skipBtn.className = 'sc-skip-btn';
    skipBtn.innerHTML = `<i class="fa-solid fa-forward"></i> ${game.i18n.localize('DRAMADIRECTOR.intro.skip')}`;
    document.body.appendChild(skipBtn);
    setTimeout(() => skipBtn?.classList.add('sc-on'), 1400);
    skipBtn.addEventListener('click', () => {
      scSkipFlag = true;
      game.socket?.emit(`module.${MODULE_ID}`, { action: 'sinCitySkip' });
      scCleanup();
    });
  }

  const curtain = overlay.querySelector('#sc-curtain');

  // ── PHASE 1: Title card ───────────────────────────────────────────────
  const titleText = (campaignName?.trim() || game.i18n.localize('DRAMADIRECTOR.intro.defaultCampaign')).toUpperCase();
  const titleCard = document.createElement('div');
  titleCard.className = 'sc-title-card';
  titleCard.innerHTML = `
    <div class="sc-gm-byline">${gmName.toUpperCase()}'s</div>
    <div class="sc-campaign-title">${titleText}</div>
  `;
  overlay.insertBefore(titleCard, curtain);

  await waitMs(200);
  if (isSkip()) { scCleanup(); return; }

  // Reveal title from black
  await curtainOpen(curtain);
  if (isSkip()) { scCleanup(); return; }

  if (await waitSkippable(2500, isSkip)) { scCleanup(); return; }

  // Close to black, remove title
  await curtainClose(curtain);
  titleCard.remove();
  if (isSkip()) { scCleanup(); return; }
  await waitMs(200);

  // ── PHASE 2: Character cards ──────────────────────────────────────────
  for (let i = 0; i < players.length; i++) {
    if (isSkip()) break;
    const p = players[i];
    const portraitRight = (i % 2 === 0);

    // Build card — IMMEDIATELY add sc-on so transitions are primed
    const card = document.createElement('div');
    card.className = 'sc-char-card';

    const pw = document.createElement('div');
    pw.className = `sc-portrait-wrap ${portraitRight ? 'sc-right' : 'sc-left'}`;
    const pImg = document.createElement('img');
    pImg.className = 'sc-portrait-img';
    pImg.src = p.portrait;
    pImg.onerror = () => { pImg.src = 'icons/svg/mystery-man.svg'; };
    pw.appendChild(pImg);

    const words = p.characterName.split(/\s+/).filter(Boolean);
    const nameHtml = words.map(w => `<div>${w}</div>`).join('');
    const nw = document.createElement('div');
    nw.className = `sc-char-name-wrap ${portraitRight ? 'sc-txt-left' : 'sc-txt-right'}`;
    nw.innerHTML = `
      <div class="sc-char-name">${nameHtml}</div>
      <div class="sc-player-name">— ${p.playerName} —</div>
    `;

    card.appendChild(pw);
    card.appendChild(nw);
    overlay.insertBefore(card, curtain);

    // Force reflow — ensure animation start positions are applied
    card.offsetHeight;

    // Open curtain
    await curtainOpen(curtain);
    if (isSkip()) { card.remove(); break; }

    // Start continuous drift animations (portrait and name drift simultaneously)
    card.classList.add('sc-on');

    // Hold — they keep drifting continuously
    const skipped = await waitSkippable(3500, isSkip);

    // Close curtain while they're still in motion (no fade-out)
    await curtainClose(curtain);
    card.remove();
    if (isSkip() || skipped) break;
    await waitMs(60);
  }

  if (isSkip()) { scCleanup(); return; }

  // ── PHASE 3: Directed by ─────────────────────────────────────────────
  const dirCard = document.createElement('div');
  dirCard.className = 'sc-dirby-card';
  dirCard.innerHTML = `
    <div class="sc-dirby-label">D I R E C T E D &nbsp; B Y</div>
    <div class="sc-dirby-name">${gmName.toUpperCase()}</div>
  `;
  overlay.insertBefore(dirCard, curtain);

  await curtainOpen(curtain);
  if (isSkip()) { scCleanup(); return; }

  if (await waitSkippable(2500, isSkip)) { scCleanup(); return; }

  // Final fade: close curtain + fade audio
  await curtainClose(curtain);
  if (scAudio) {
    const steps = 12;
    for (let i = 0; i < steps; i++) {
      await waitMs(80);
      if (scAudio) scAudio.volume = Math.max(0, scAudio.volume - 0.85 / steps);
    }
  }
  scCleanup();
}

function scCleanup() {
  document.querySelector('.sc-overlay')?.remove();
  document.querySelector('.sc-skip-btn')?.remove();
  if (scAudio) { scAudio.pause(); scAudio = null; }
  scPlaying  = false;
  scSkipFlag = false;
}

export function skipSinCityIntro() {
  scSkipFlag = true;
  scCleanup();
}

// ═══════════════════════════════════════════════════════════════════════════
// SNATCH INTRO — Guy Ritchie "Snatch" — poster / duotone / namecard style
// ═══════════════════════════════════════════════════════════════════════════

injectStyles('dd-snatch-styles', `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap');

/* ── overlay ── */
.snatch-overlay {
  position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
  z-index: 10000; overflow: hidden; pointer-events: auto;
  background: #000;
  opacity: 0; transition: opacity 0.5s ease-out;
}
.snatch-overlay.sn-on { opacity: 1; }

/* ── film grain ── */
.sn-grain {
  position: absolute; inset: 0; z-index: 30; pointer-events: none;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  opacity: 0.09; mix-blend-mode: overlay;
  animation: sn-grain-shift 0.1s steps(2) infinite;
}
@keyframes sn-grain-shift {
  0%   { background-position: 0   0; }
  50%  { background-position: 8px 10px; }
  100% { background-position: -5px -7px; }
}

/* ── portrait section (hidden until phase 2) ── */
.sn-portrait-section {
  position: absolute; inset: 0; z-index: 5;
  display: flex; align-items: stretch; justify-content: flex-end;
  overflow: hidden;
  opacity: 0; transition: opacity 0.5s ease-out;
}
.sn-portrait-section.sn-on { opacity: 1; }
.sn-portrait-img-wrap {
  position: relative; width: 65vw; height: 100%; overflow: hidden;
}
/* Phase A: portrait on black, no filter, base scale */
.sn-portrait-img {
  width: 100%; height: 100%;
  object-fit: cover; object-position: center top; display: block;
  filter: none; mix-blend-mode: normal;
  transform: scale(1.0);
  transition: filter 0s, mix-blend-mode 0s, transform 0.3s cubic-bezier(0.22,1,0.36,1);
}
/* Phase B: duotone + snap zoom 15% + then slow drift via animation */
.sn-portrait-img.sn-duotone {
  filter: grayscale(1) contrast(1.75) brightness(0.72);
  mix-blend-mode: multiply;
  transform: scale(1.15);
}
/* Slow drift continues after snap — applied via JS after transition ends */
@keyframes sn-zoom-drift-slow {
  from { transform: scale(1.15); }
  to   { transform: scale(1.32); }
}
.sn-portrait-img.sn-drifting {
  animation: sn-zoom-drift-slow 20s linear forwards;
  transition: none;
}
/* Olive background behind portrait (shown only in phase B) */
.sn-olive-bg {
  position: absolute; inset: 0; z-index: 4;
  background: var(--sn-bg-color, #6c5a28);
  opacity: 0; transition: opacity 0.5s ease-out;
}
.sn-olive-bg.sn-on { opacity: 1; }

/* ── left black fade ── */
.sn-left-fade {
  position: absolute; inset: 0; z-index: 7; pointer-events: none;
  background: linear-gradient(90deg, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.3) 40%, transparent 64%);
}

/* ── namecard — left-aligned (character cards) ── */
.sn-namecard {
  position: absolute;
  left: clamp(30px,5vw,80px);
  top: 50%;
  transform: translateY(-50%) translateX(-60px);
  z-index: 20; opacity: 0;
  transition: opacity 0.25s ease-out, transform 0.35s cubic-bezier(0.22,1,0.36,1);
}
.sn-namecard.sn-on {
  opacity: 1; transform: translateY(-50%) translateX(0);
}

/* ── namecard — CENTER (title card + directed-by) ── */
.sn-namecard-center {
  position: absolute; left: 50%; top: 50%;
  transform: translate(-50%,-50%) scale(0.88);
  z-index: 20; opacity: 0;
  transition: opacity 0.3s ease-out, transform 0.4s cubic-bezier(0.22,1,0.36,1);
}
.sn-namecard-center.sn-on {
  opacity: 1; transform: translate(-50%,-50%) scale(1);
}

/* black box shared */
.sn-namecard-box {
  background: #000;
  display: inline-flex; flex-direction: column; align-items: stretch;
  padding: clamp(6px,1vh,12px) clamp(14px,2vw,28px);
  min-width: clamp(180px,28vw,460px);
}
.sn-namecard-box.sn-wide {
  min-width: clamp(220px,38vw,600px);
}
.sn-namecard-hline { width: 100%; height: 2px; background: #fff; flex-shrink: 0; }
.sn-namecard-row {
  display: flex; align-items: center; justify-content: center;
  gap: clamp(8px,1.2vw,18px); padding: clamp(2px,0.5vh,6px) 0;
}
.sn-namecard-star {
  color: #fff; font-size: clamp(0.9rem,1.6vw,2rem); line-height: 1;
  font-family: serif; flex-shrink: 0;
}
.sn-namecard-name {
  font-family: 'Bebas Neue', 'Impact', 'Arial Black', sans-serif;
  font-size: clamp(2.2rem,5vw,7rem); color: #fff;
  letter-spacing: 0.10em; line-height: 1;
  text-transform: uppercase; white-space: nowrap;
}
.sn-namecard-name.sn-big {
  font-size: clamp(2.8rem,7vw,10rem);
}
.sn-namecard-name.sn-small {
  font-size: clamp(1.2rem,2.2vw,3rem); letter-spacing: 0.25em;
}

/* ── sublabel under namecard ── */
.sn-sublabel {
  font-family: 'Bebas Neue', sans-serif;
  font-size: clamp(0.7rem,1vw,1.1rem); letter-spacing: 0.35em;
  color: rgba(255,255,255,0.45); text-transform: uppercase;
  text-align: center;
  margin-top: clamp(6px,0.8vh,12px);
  opacity: 0; transform: translateY(8px);
  transition: opacity 0.35s ease 0.25s, transform 0.35s ease 0.25s;
}
.sn-namecard.sn-on      .sn-sublabel { opacity: 1; transform: translateY(0); }
.sn-namecard-center.sn-on .sn-sublabel { opacity: 1; transform: translateY(0); }

/* ── flash (cut) ── */
.sn-flash {
  position: absolute; inset: 0; z-index: 50;
  background: #fff; opacity: 0; pointer-events: none;
}

/* ── skip button ── */
.sn-skip-btn {
  position: fixed; bottom: 22px; right: 22px; z-index: 10020;
  display: flex; align-items: center; gap: 7px;
  padding: 8px 18px; background: rgba(0,0,0,0.88);
  border: 1px solid rgba(255,255,255,0.25); border-radius: 1px;
  color: rgba(255,255,255,0.75);
  font-family: 'Bebas Neue', sans-serif;
  font-size: 13px; letter-spacing: 3px; text-transform: uppercase;
  cursor: pointer; opacity: 0; transform: translateY(12px);
  transition: opacity 0.35s, transform 0.35s; pointer-events: auto;
}
.sn-skip-btn.sn-on { opacity: 1; transform: translateY(0); }
.sn-skip-btn:hover { border-color: rgba(255,255,255,0.7); }
`);

let snatchPlaying = false, snatchSkipFlag = false, snatchAudio = null;

// ─── Only real player characters, no GM fallback ──────────────────────────
async function getSnatchPlayersData() {
  const players = [];
  for (const user of game.users.filter(u => u.active && !u.isGM)) {
    const ch = user.character;
    if (!ch) continue;
    let title = ch.getFlag?.(MODULE_ID, 'introTitle') || '';
    if (!title) {
      const cls = Object.values(ch.classes ?? {});
      title = cls.length ? cls.map(c => c.name).join(' / ')
                         : (ch.system?.details?.race || ch.system?.details?.type?.value || '');
      if (title) title = title.charAt(0).toUpperCase() + title.slice(1);
    }
    players.push({
      playerName:    user.name,
      characterName: ch.name,
      portrait:      ch.img || user.avatar || 'icons/svg/mystery-man.svg',
      title,
    });
  }
  return players;
}

// ─── Build a namecard element ─────────────────────────────────────────────
function makeNamecard(text, sublabel = '', center = false, big = false, small = false) {
  const el = document.createElement('div');
  el.className = center ? 'sn-namecard-center' : 'sn-namecard';
  const nameClass = big ? 'sn-namecard-name sn-big' : small ? 'sn-namecard-name sn-small' : 'sn-namecard-name';
  const boxClass  = (center && big) ? 'sn-namecard-box sn-wide' : 'sn-namecard-box';
  el.innerHTML = `
    <div class="${boxClass}">
      <div class="sn-namecard-hline"></div>
      <div class="sn-namecard-row">
        <span class="sn-namecard-star">&#9733;</span>
        <span class="${nameClass}">${text}</span>
        <span class="sn-namecard-star">&#9733;</span>
      </div>
      <div class="sn-namecard-hline"></div>
    </div>
    ${sublabel ? `<div class="sn-sublabel">${sublabel}</div>` : ''}
  `;
  return el;
}

export async function executeSnatchIntro(campaignName = '') {
  if (snatchPlaying) return;
  snatchPlaying  = true;
  snatchSkipFlag = false;
  const isSkip = () => snatchSkipFlag;

  const players = await getSnatchPlayersData();
  const gmUser  = game.users.find(u => u.isGM && u.active) || game.users.find(u => u.isGM);
  const gmName  = gmUser?.name || game.i18n.localize('DRAMADIRECTOR.intro.gmDefault');

  // ── Preload ──────────────────────────────────────────────────────────────
  await _ddPreload([
    { type: 'audio', url: `modules/${MODULE_ID}/assets/sounds/snatch.ogg` },
    ...players.map(p => ({ type: 'image', url: p.portrait })),
  ]);

  // Audio
  snatchAudio = new Audio(`modules/${MODULE_ID}/assets/sounds/snatch.ogg`);
  snatchAudio.volume = 0.85;
  snatchAudio.currentTime = 50; // Start from 0:50
  snatchAudio.play().catch(() => {});

  // Build overlay
  const overlay = document.createElement('div');
  overlay.className = 'snatch-overlay';
  overlay.innerHTML = `
    <div class="sn-grain"></div>
    <div class="sn-olive-bg" id="sn-olive"></div>
    <div class="sn-portrait-section" id="sn-ps">
      <div class="sn-portrait-img-wrap">
        <img class="sn-portrait-img" id="sn-img" src="" alt="">
      </div>
    </div>
    <div class="sn-left-fade" id="sn-lf" style="opacity:0;transition:opacity 0.5s"></div>
    <div class="sn-flash" id="sn-fl"></div>
  `;
  document.body.appendChild(overlay);

  // Skip button (GM only)
  let skipBtn = null;
  if (game.user?.isGM) {
    skipBtn = document.createElement('button');
    skipBtn.className = 'sn-skip-btn';
    skipBtn.innerHTML = `<i class="fa-solid fa-forward"></i> ${game.i18n.localize('DRAMADIRECTOR.intro.skip')}`;
    document.body.appendChild(skipBtn);
    setTimeout(() => skipBtn?.classList.add('sn-on'), 800);
    skipBtn.addEventListener('click', () => {
      snatchSkipFlag = true;
      game.socket?.emit(`module.${MODULE_ID}`, { action: 'snatchSkip' });
      snatchCleanup();
    });
  }

  const img     = overlay.querySelector('#sn-img');
  const olive   = overlay.querySelector('#sn-olive');
  const portSec = overlay.querySelector('#sn-ps');
  const leftFade= overlay.querySelector('#sn-lf');
  const flash   = overlay.querySelector('#sn-fl');

  const doFlash = async (dur = 90) => {
    flash.style.transition = `opacity ${Math.round(dur*0.3)}ms ease`;
    flash.style.opacity = '0.75';
    await waitMs(dur);
    flash.style.transition = `opacity ${Math.round(dur*0.7)}ms ease`;
    flash.style.opacity = '0';
    await waitMs(Math.round(dur * 0.7));
  };

  const showCard = async (card, holdMs, isSkip) => {
    overlay.appendChild(card);
    await waitMs(40);
    card.classList.add('sn-on');
    const skipped = await waitSkippable(holdMs, isSkip);
    card.classList.remove('sn-on');
    await waitMs(250);
    card.remove();
    return skipped;
  };

  // ── PHASE 1: Campaign title card (centered, black bg) ────────────────────
  overlay.classList.add('sn-on'); // fade in overlay (black bg)
  await waitMs(300);
  if (isSkip()) { snatchCleanup(); return; }

  const titleText = (campaignName?.trim() || game.i18n.localize('DRAMADIRECTOR.intro.defaultCampaign')).toUpperCase();
  const titleCard = makeNamecard(titleText, '', true, true, false);
  if (await showCard(titleCard, 2000, isSkip)) { snatchCleanup(); return; }

  await doFlash(120);
  if (isSkip()) { snatchCleanup(); return; }

  // ── PHASE 2: Character portraits + namecards ──────────────────────────────
  const SN_BG_COLORS = ['#8b1a1a','#1a3a8b','#a07800','#1a6b2a','#6c5a28','#5a1a8b'];

  for (let i = 0; i < players.length; i++) {
    if (isSkip()) break;
    const p = players[i];
    // Pick a random background color for this character
    const bgColor = SN_BG_COLORS[Math.floor(Math.random() * SN_BG_COLORS.length)];
    overlay.style.setProperty('--sn-bg-color', bgColor);

    // Set portrait (full color, black bg first)
    img.src = p.portrait;
    img.className = 'sn-portrait-img';         // reset duotone
    img.style.animation = 'none';
    img.classList.remove('sn-duotone', 'sn-drifting');
    img.style.transform = '';                    // reset to CSS default scale(1.0)
    img.style.transition = '';
    img.offsetHeight;

    olive.classList.remove('sn-on');
    leftFade.style.opacity = '0';
    portSec.classList.add('sn-on');

    await waitMs(1300);                         // viewer sees normal portrait on black
    if (isSkip()) break;

    // Instant bg + duotone; zoom snaps via CSS transition (0.3s)
    olive.style.transition = 'none';
    olive.classList.add('sn-on');
    img.classList.add('sn-duotone');   // triggers transform: scale(1.15) w/ 0.3s ease
    leftFade.style.opacity = '1';
    // After snap completes, switch to slow drift animation
    setTimeout(() => {
      if (!img.classList.contains('sn-duotone')) return;
      img.classList.add('sn-drifting');
    }, 320);

    await waitMs(200);
    if (isSkip()) break;

    // Namecard slams in from left
    const charCard = makeNamecard(p.characterName.toUpperCase(), '— ' + p.playerName + ' —', false, false, false);
    overlay.appendChild(charCard);
    await waitMs(40);
    charCard.classList.add('sn-on');

    if (await waitSkippable(2000, isSkip)) {
      charCard.remove();
      break;
    }

    // Namecard out
    charCard.classList.remove('sn-on');
    await waitMs(250);
    charCard.remove();
    if (isSkip()) break;

    // Flash between characters
    portSec.classList.remove('sn-on');
    await doFlash(100);
    if (isSkip()) break;
    await waitMs(80);
  }

  if (isSkip()) { snatchCleanup(); return; }

  // ── PHASE 3: Directed by GM (centered, black bg) ─────────────────────────
  portSec.classList.remove('sn-on');
  olive.classList.remove('sn-on');
  leftFade.style.opacity = '0';
  overlay.style.background = '#000';

  await waitMs(200);
  if (isSkip()) { snatchCleanup(); return; }

  // "Directed by" small label + GM name
  const dirCard = document.createElement('div');
  dirCard.className = 'sn-namecard-center';
  dirCard.innerHTML = `
    <div class="sn-namecard-box sn-wide">
      <div class="sn-namecard-hline"></div>
      <div class="sn-namecard-row" style="flex-direction:column; gap:0; padding: clamp(4px,0.8vh,10px) 0;">
        <span class="sn-namecard-name sn-small">D I R E C T E D &nbsp; B Y</span>
        <div style="width:100%;height:1px;background:rgba(255,255,255,0.25);margin:clamp(3px,0.5vh,7px) 0;"></div>
        <div style="display:flex;align-items:center;justify-content:center;gap:clamp(8px,1.2vw,18px);">
          <span class="sn-namecard-star">&#9733;</span>
          <span class="sn-namecard-name">${gmName.toUpperCase()}</span>
          <span class="sn-namecard-star">&#9733;</span>
        </div>
      </div>
      <div class="sn-namecard-hline"></div>
    </div>
  `;
  overlay.appendChild(dirCard);
  await waitMs(40);
  dirCard.classList.add('sn-on');

  if (await waitSkippable(2500, isSkip)) { snatchCleanup(); return; }

  // Fade out everything
  overlay.style.transition = 'opacity 1.5s ease-out';
  overlay.style.opacity = '0';
  if (snatchAudio) {
    const steps = 15;
    for (let i = 0; i < steps && !isSkip(); i++) {
      await waitMs(100);
      if (snatchAudio) snatchAudio.volume = Math.max(0, snatchAudio.volume - 0.85 / steps);
    }
  }
  await waitMs(1500);
  snatchCleanup();
}

function snatchCleanup() {
  document.querySelector('.snatch-overlay')?.remove();
  document.querySelector('.sn-skip-btn')?.remove();
  if (snatchAudio) { snatchAudio.pause(); snatchAudio = null; }
  snatchPlaying  = false;
  snatchSkipFlag = false;
}

export function skipSnatchIntro() {
  snatchSkipFlag = true;
  snatchCleanup();
}


// ═══════════════════════════════════════════════════════════════════════════
// MACHETE INTRO — Robert Rodriguez / Grindhouse / Mexploitation style
// ═══════════════════════════════════════════════════════════════════════════

injectStyles('dd-machete-styles', `
@import url('https://fonts.googleapis.com/css2?family=Alfa+Slab+One&family=Oswald:wght@700&display=swap');

/* ── base overlay ── */
.mch-overlay {
  position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
  z-index: 10000; overflow: hidden; pointer-events: auto;
  background: #0a0600;
}

/* ── vignette ── */
.mch-vignette {
  position: absolute; inset: 0; z-index: 60; pointer-events: none;
  background: radial-gradient(ellipse at center,
    transparent 40%, rgba(0,0,0,0.55) 75%, rgba(0,0,0,0.92) 100%);
}

/* ── film grain (heavy) ── */
.mch-grain {
  position: absolute; inset: 0; z-index: 61; pointer-events: none;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 250 250' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.92' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23g)'/%3E%3C/svg%3E");
  opacity: 0.18; mix-blend-mode: overlay;
  animation: mch-grain-shift 0.07s steps(4) infinite;
}
@keyframes mch-grain-shift {
  0%   { background-position: 0 0; }
  25%  { background-position: 15px -12px; }
  50%  { background-position: -9px 18px; }
  75%  { background-position: 6px -6px; }
}

/* ── horizontal film scratches ── */
.mch-scratches {
  position: absolute; inset: 0; z-index: 62; pointer-events: none;
  opacity: 0;
  animation: mch-scratch-appear 4s steps(1) infinite;
}
.mch-scratch-line {
  position: absolute; left: 0; width: 100%;
  height: 1px; background: rgba(255,240,180,0.6);
}
@keyframes mch-scratch-appear {
  0%   { opacity: 0; }
  5%   { opacity: 1; }
  8%   { opacity: 0; }
  45%  { opacity: 0; }
  47%  { opacity: 1; }
  50%  { opacity: 0; }
  80%  { opacity: 0; }
  82%  { opacity: 1; }
  84%  { opacity: 0; }
}

/* ── cigarette burn (reel change marker — top right circle) ── */
.mch-burn {
  position: absolute; top: clamp(12px, 2vh, 28px); right: clamp(12px, 2vw, 28px);
  z-index: 65; width: clamp(20px,2.5vw,36px); height: clamp(20px,2.5vw,36px);
  border-radius: 50%; background: rgba(255,240,160,0.9);
  box-shadow: 0 0 18px 6px rgba(255,200,80,0.7);
  opacity: 0; pointer-events: none;
  animation: mch-burn-flicker 0.18s steps(2) 2;
}
@keyframes mch-burn-flicker { 0%{opacity:0;} 50%{opacity:1;} 100%{opacity:0;} }

/* ── black curtain for cuts ── */
.mch-curtain {
  position: absolute; inset: 0; z-index: 70;
  background: #000; opacity: 1; pointer-events: none;
  transition: opacity 0.25s ease-in-out;
}
.mch-curtain.mch-open { opacity: 0; }

/* ── warm amber color grade applied to content layer ── */
.mch-content {
  position: absolute; inset: 0; z-index: 10;
  /* warm orange tint via CSS filter — classic 70s exploitation look */
  filter: sepia(0.55) saturate(1.9) hue-rotate(-8deg) contrast(1.15) brightness(1.05);
}

/* ══ FILM LEADER COUNTDOWN ══ */
.mch-leader {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  background: #e8d89a;
}
.mch-leader-circle {
  width: clamp(180px, 28vw, 380px); height: clamp(180px, 28vw, 380px);
  border-radius: 50%; border: clamp(6px, 1vw, 14px) solid #8a6a10;
  display: flex; align-items: center; justify-content: center;
  position: relative;
}
.mch-leader-circle::before {
  content: ''; position: absolute; inset: clamp(14px,2vw,22px);
  border-radius: 50%; border: clamp(3px, 0.5vw, 6px) solid #8a6a10;
}
/* Crosshair lines */
.mch-leader-circle::after {
  content: ''; position: absolute;
  width: 100%; height: clamp(2px,0.3vw,4px); background: #8a6a10;
  box-shadow: 0 calc(clamp(180px,28vw,380px)/2) 0 #8a6a10,
              0 calc(-1 * clamp(180px,28vw,380px)/2) 0 #8a6a10;
}
.mch-leader-num {
  font-family: 'Oswald', sans-serif; font-weight: 700;
  font-size: clamp(5rem, 15vw, 18rem);
  color: #8a6a10; line-height: 1;
  position: relative; z-index: 2;
}
/* Vertical crosshair */
.mch-leader-vert {
  position: absolute; top: 0; bottom: 0;
  left: 50%; width: clamp(2px,0.3vw,4px);
  background: #8a6a10; transform: translateX(-50%);
}

/* ══ TITLE CARD ══ */
.mch-title-card {
  position: absolute; inset: 0;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  background: #1a0e00;
}
.mch-presents {
  font-family: 'Oswald', sans-serif; font-weight: 700;
  font-size: clamp(0.8rem, 1.4vw, 1.7rem);
  color: #c8920a; letter-spacing: 0.5em; text-transform: uppercase;
  margin-bottom: clamp(8px, 1.5vh, 22px);
  text-shadow: 0 0 30px rgba(200,146,10,0.4);
}
.mch-title {
  font-family: 'Alfa Slab One', serif;
  font-size: clamp(3.5rem, 11vw, 15rem);
  color: #d4821e;
  text-transform: uppercase; text-align: center;
  line-height: 0.88; letter-spacing: 0.03em;
  text-shadow:
    3px 3px 0 #7a3a00,
    6px 6px 0 #3a1800,
    0 0 80px rgba(212,130,30,0.5);
  position: relative;
}
/* Extrusion effect — like the actual Machete logo */
.mch-title::after {
  content: attr(data-text);
  position: absolute; top: 5px; left: 5px; z-index: -1;
  color: #7a3a00;
  font-family: inherit; font-size: inherit; text-transform: inherit;
  line-height: inherit; letter-spacing: inherit;
  white-space: pre-wrap;
}

/* ══ LOBBY CARD (character card) ══ */
.mch-lobby-card {
  position: absolute; inset: 0;
  display: flex; align-items: stretch;
  background: #1a0e00;
}
/* Portrait half */
.mch-port-half {
  position: relative; overflow: hidden;
  flex: 0 0 52%;
  display: flex; align-items: flex-end;
}
.mch-port-half.mch-right { order: 2; }
.mch-port-half.mch-left  { order: 1; }

.mch-port-img {
  width: 100%; height: 100%;
  object-fit: cover; object-position: center top;
  /* Warm exploitation look: sepia + high contrast + slightly overexposed */
  filter: sepia(0.45) saturate(1.6) contrast(1.2) brightness(1.08);
  display: block;
}

/* Lobby card damage texture over portrait */
.mch-port-damage {
  position: absolute; inset: 0;
  background:
    repeating-linear-gradient(
      90deg,
      transparent,
      transparent 3px,
      rgba(0,0,0,0.04) 3px,
      rgba(0,0,0,0.04) 4px
    ),
    repeating-linear-gradient(
      0deg,
      transparent,
      transparent 6px,
      rgba(0,0,0,0.03) 6px,
      rgba(0,0,0,0.03) 7px
    );
  pointer-events: none;
}
/* Framed border on portrait like a real lobby card */
.mch-port-border {
  position: absolute; inset: clamp(4px, 0.8vw, 10px);
  border: clamp(2px, 0.3vw, 4px) solid rgba(200,146,10,0.3);
  pointer-events: none;
}

/* Text half */
.mch-text-half {
  flex: 1; display: flex; flex-direction: column;
  justify-content: center; padding: clamp(16px, 3vw, 50px);
  background: #120900;
  position: relative;
}
.mch-text-half.mch-right { order: 1; align-items: flex-end; text-align: right; }
.mch-text-half.mch-left  { order: 2; align-items: flex-start; text-align: left; }

/* Decorative horizontal rule */
.mch-rule {
  width: clamp(40px, 8vw, 100px); height: clamp(2px, 0.3vw, 4px);
  background: linear-gradient(90deg, #c8920a, #7a3a00);
  margin: clamp(8px, 1.5vh, 18px) 0;
}
.mch-text-half.mch-right .mch-rule {
  background: linear-gradient(90deg, #7a3a00, #c8920a);
}

.mch-char-number {
  font-family: 'Oswald', sans-serif; font-weight: 700;
  font-size: clamp(0.6rem, 1vw, 1.1rem);
  color: rgba(200,146,10,0.5); letter-spacing: 0.4em; text-transform: uppercase;
  margin-bottom: clamp(4px, 0.6vh, 8px);
}
.mch-char-name {
  font-family: 'Alfa Slab One', serif;
  font-size: clamp(2rem, 5.5vw, 7.5rem);
  color: #d4821e; text-transform: uppercase;
  line-height: 0.85; letter-spacing: 0.02em;
  text-shadow: 3px 3px 0 #7a3a00, 5px 5px 0 #2a1000;
  word-break: break-word;
}
.mch-player-name {
  font-family: 'Oswald', sans-serif; font-weight: 700;
  font-size: clamp(0.65rem, 0.9vw, 1.1rem);
  color: rgba(200,146,10,0.45); letter-spacing: 0.35em;
  text-transform: uppercase; margin-top: clamp(6px, 1vh, 14px);
}

/* Slide-in animations — triggered by .mch-on class */
.mch-port-half { transform: translateX(0); opacity: 1; }
.mch-port-half.mch-left  { transform: translateX(-60px); opacity: 0;
  transition: transform 0.55s cubic-bezier(0.16,1,0.3,1), opacity 0.4s ease-out; }
.mch-port-half.mch-right { transform: translateX(60px); opacity: 0;
  transition: transform 0.55s cubic-bezier(0.16,1,0.3,1), opacity 0.4s ease-out; }
.mch-text-half { opacity: 0;
  transition: opacity 0.4s ease-out 0.15s; }

.mch-lobby-card.mch-on .mch-port-half { transform: translateX(0); opacity: 1; }
.mch-lobby-card.mch-on .mch-text-half { opacity: 1; }

/* ── directed-by card ── */
.mch-dirby-card {
  position: absolute; inset: 0;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  background: #1a0e00;
}
.mch-dirby-label {
  font-family: 'Oswald', sans-serif; font-weight: 700;
  font-size: clamp(0.7rem, 1.1vw, 1.3rem);
  color: rgba(200,146,10,0.4); letter-spacing: 0.55em; text-transform: uppercase;
  margin-bottom: clamp(8px, 1.2vh, 18px);
}
.mch-dirby-rule {
  width: clamp(60px, 12vw, 160px); height: 2px;
  background: linear-gradient(90deg, transparent, #c8920a, transparent);
  margin-bottom: clamp(8px, 1.2vh, 18px);
}
.mch-dirby-name {
  font-family: 'Alfa Slab One', serif;
  font-size: clamp(2.5rem, 6.5vw, 9rem);
  color: #d4821e; text-transform: uppercase; letter-spacing: 0.03em;
  text-shadow: 3px 3px 0 #7a3a00, 5px 5px 0 #2a1000;
}

/* ── skip button ── */
.mch-skip-btn {
  position: fixed; bottom: 22px; right: 22px; z-index: 10020;
  display: flex; align-items: center; gap: 7px;
  padding: 8px 18px; background: rgba(10,6,0,0.95);
  border: 1px solid rgba(200,146,10,0.5); border-radius: 2px;
  color: #c8920a;
  font-family: 'Oswald', sans-serif; font-weight: 700;
  font-size: 13px; letter-spacing: 3px; text-transform: uppercase;
  cursor: pointer; opacity: 0; transform: translateY(12px);
  transition: opacity 0.35s, transform 0.35s; pointer-events: auto;
}
.mch-skip-btn.mch-on { opacity: 1; transform: translateY(0); }
.mch-skip-btn:hover { border-color: #d4821e; }
`);

// ─── Player data ───────────────────────────────────────────────────────────
async function getMachetePlayersData() {
  const players = [];
  for (const user of game.users.filter(u => u.active && !u.isGM)) {
    const ch = user.character;
    if (!ch) continue;
    players.push({
      playerName:    user.name,
      characterName: ch.name.toUpperCase(),
      portrait:      ch.img || user.avatar || 'icons/svg/mystery-man.svg',
    });
  }
  return players;
}

// ─── Cigarette burn then hard cut ─────────────────────────────────────────
async function mchBurnCut(overlay, curtain) {
  // Burn circle flickers in top-right
  const burn = document.createElement('div');
  burn.className = 'mch-burn';
  overlay.appendChild(burn);
  await waitMs(380);
  burn.remove();
  // Hard cut: curtain instantly opaque
  curtain.style.transition = 'none';
  curtain.classList.remove('mch-open');
  await waitMs(80);
  // Restore transition for next open
  curtain.style.transition = 'opacity 0.25s ease-in-out';
}

// ─── Add random scratch lines ──────────────────────────────────────────────
function mchAddScratches(scratchEl) {
  scratchEl.innerHTML = '';
  const count = Math.floor(Math.random() * 3) + 1;
  for (let i = 0; i < count; i++) {
    const line = document.createElement('div');
    line.className = 'mch-scratch-line';
    line.style.top = `${Math.random() * 100}%`;
    line.style.opacity = (Math.random() * 0.5 + 0.3).toString();
    scratchEl.appendChild(line);
  }
}

let mchPlaying = false, mchSkipFlag = false, mchAudio = null;

export async function executeMacheteIntro(campaignName = '') {
  if (mchPlaying) return;
  mchPlaying  = true;
  mchSkipFlag = false;
  const isSkip = () => mchSkipFlag;

  const players = await getMachetePlayersData();
  const gmUser  = game.users.find(u => u.isGM && u.active) || game.users.find(u => u.isGM);
  const gmName  = gmUser?.name || 'Game Master';

  // ── Preload ──────────────────────────────────────────────────────────────
  await _ddPreload([
    { type: 'audio', url: `modules/${MODULE_ID}/assets/sounds/kinoprokat.ogg` },
    ...players.map(p => ({ type: 'image', url: p.portrait })),
  ]);

  // Audio
  mchAudio = new Audio(`modules/${MODULE_ID}/assets/sounds/kinoprokat.ogg`);
  mchAudio.volume = 0.85;
  mchAudio.play().catch(() => {});

  // Build overlay
  const overlay = document.createElement('div');
  overlay.className = 'mch-overlay';
  overlay.innerHTML = `
    <div class="mch-content" id="mch-content"></div>
    <div class="mch-vignette"></div>
    <div class="mch-grain"></div>
    <div class="mch-scratches" id="mch-scratches"></div>
    <div class="mch-curtain" id="mch-curtain"></div>
  `;
  document.body.appendChild(overlay);

  const content   = overlay.querySelector('#mch-content');
  const curtain   = overlay.querySelector('#mch-curtain');
  const scratches = overlay.querySelector('#mch-scratches');

  // Randomise scratch positions periodically
  const scratchTimer = setInterval(() => mchAddScratches(scratches), 1800);

  // Skip button
  if (game.user?.isGM) {
    const skipBtn = document.createElement('button');
    skipBtn.className = 'mch-skip-btn';
    skipBtn.innerHTML = `<i class="fa-solid fa-forward"></i> ${game.i18n.localize('DRAMADIRECTOR.intro.skip')}`;
    document.body.appendChild(skipBtn);
    setTimeout(() => skipBtn?.classList.add('mch-on'), 1200);
    skipBtn.addEventListener('click', () => {
      mchSkipFlag = true;
      game.socket?.emit(`module.${MODULE_ID}`, { action: 'macheteSkip' });
      mchCleanup(scratchTimer);
    });
  }

  // ── PHASE 1: Film leader countdown (4 → 3 → 2 → 1) ─────────────────────
  for (const num of [4, 3, 2, 1]) {
    if (isSkip()) { mchCleanup(scratchTimer); return; }

    const leader = document.createElement('div');
    leader.className = 'mch-leader';
    leader.innerHTML = `
      <div class="mch-leader-circle">
        <div class="mch-leader-vert"></div>
        <div class="mch-leader-num">${num}</div>
      </div>
    `;
    content.appendChild(leader);

    // Hard-cut reveal (no transition)
    curtain.style.transition = 'none';
    curtain.classList.remove('mch-open');
    await waitMs(16);
    curtain.classList.add('mch-open');
    curtain.style.transition = 'opacity 0.25s ease-in-out';

    if (await waitSkippable(260, isSkip)) { mchCleanup(scratchTimer); return; }

    // Hard cut out
    curtain.style.transition = 'none';
    curtain.classList.remove('mch-open');
    await waitMs(60);
    leader.remove();
    await waitMs(60);
  }

  if (isSkip()) { mchCleanup(scratchTimer); return; }
  await waitMs(120);

  // ── PHASE 2: Title card ───────────────────────────────────────────────
  const titleText = (campaignName?.trim() || game.i18n.localize('DRAMADIRECTOR.intro.defaultCampaign')).toUpperCase();
  const titleCard = document.createElement('div');
  titleCard.className = 'mch-title-card';
  titleCard.innerHTML = `
    <div class="mch-presents">${gmName.toUpperCase()} PRESENTS</div>
    <div class="mch-title" data-text="${titleText}">${titleText}</div>
  `;
  content.appendChild(titleCard);

  // Fade in
  curtain.style.transition = 'opacity 0.3s ease-in-out';
  curtain.classList.add('mch-open');
  await waitMs(320);

  if (await waitSkippable(3000, isSkip)) { mchCleanup(scratchTimer); return; }

  // Cigarette burn → hard cut out
  await mchBurnCut(overlay, curtain);
  titleCard.remove();
  await waitMs(100);

  // ── PHASE 3: Character lobby cards ───────────────────────────────────
  for (let i = 0; i < players.length; i++) {
    if (isSkip()) break;
    const p = players[i];
    const portraitLeft = (i % 2 === 0); // even → portrait left, text right

    const card = document.createElement('div');
    card.className = 'mch-lobby-card';

    // Portrait half
    const portHalf = document.createElement('div');
    portHalf.className = `mch-port-half ${portraitLeft ? 'mch-left' : 'mch-right'}`;
    const img = document.createElement('img');
    img.className = 'mch-port-img';
    img.src = p.portrait;
    img.onerror = () => { img.src = 'icons/svg/mystery-man.svg'; };
    const dmg = document.createElement('div');
    dmg.className = 'mch-port-damage';
    const brd = document.createElement('div');
    brd.className = 'mch-port-border';
    portHalf.appendChild(img);
    portHalf.appendChild(dmg);
    portHalf.appendChild(brd);

    // Text half
    const textHalf = document.createElement('div');
    textHalf.className = `mch-text-half ${portraitLeft ? 'mch-left' : 'mch-right'}`;
    const words = p.characterName.split(/\s+/).filter(Boolean);
    const nameLines = words.map(w => `<div>${w}</div>`).join('');
    textHalf.innerHTML = `
      <div class="mch-char-number">LOBBY CARD No.${String(i+1).padStart(2,'0')}</div>
      <div class="mch-rule"></div>
      <div class="mch-char-name">${nameLines}</div>
      <div class="mch-player-name">— ${p.playerName} —</div>
      <div class="mch-rule" style="margin-top: clamp(8px,1.5vh,18px);"></div>
    `;

    card.appendChild(portHalf);
    card.appendChild(textHalf);
    content.appendChild(card);

    // Hard cut in
    curtain.style.transition = 'none';
    curtain.classList.remove('mch-open');
    await waitMs(16);
    card.offsetHeight; // reflow
    curtain.classList.add('mch-open');
    curtain.style.transition = 'opacity 0.25s ease-in-out';
    await waitMs(100);

    // Trigger slide animations
    card.classList.add('mch-on');

    if (await waitSkippable(3500, isSkip)) {
      await mchBurnCut(overlay, curtain);
      card.remove(); break;
    }

    await mchBurnCut(overlay, curtain);
    card.remove();
    if (isSkip()) break;
    await waitMs(80);
  }

  if (isSkip()) { mchCleanup(scratchTimer); return; }

  // ── PHASE 4: Directed by ─────────────────────────────────────────────
  const dirCard = document.createElement('div');
  dirCard.className = 'mch-dirby-card';
  dirCard.innerHTML = `
    <div class="mch-dirby-label">D I R E C T E D &nbsp; B Y</div>
    <div class="mch-dirby-rule"></div>
    <div class="mch-dirby-name">${gmName.toUpperCase()}</div>
  `;
  content.appendChild(dirCard);

  curtain.style.transition = 'opacity 0.3s ease-in-out';
  curtain.classList.add('mch-open');
  await waitMs(320);

  if (await waitSkippable(3000, isSkip)) { mchCleanup(scratchTimer); return; }

  // Final fade + audio ramp
  curtain.style.transition = 'opacity 1.2s ease-in';
  curtain.classList.remove('mch-open');
  if (mchAudio) {
    const steps = 12;
    for (let i = 0; i < steps; i++) {
      await waitMs(80);
      if (mchAudio) mchAudio.volume = Math.max(0, mchAudio.volume - 0.85 / steps);
    }
  }
  await waitMs(800);
  mchCleanup(scratchTimer);
}

function mchCleanup(scratchTimer) {
  clearInterval(scratchTimer);
  document.querySelector('.mch-overlay')?.remove();
  document.querySelector('.mch-skip-btn')?.remove();
  if (mchAudio) { mchAudio.pause(); mchAudio = null; }
  mchPlaying  = false;
  mchSkipFlag = false;
}

export function skipMacheteIntro() {
  mchSkipFlag = true;
}

// ═══════════════════════════════════════════════════════════════════════════
// MACHETE BLOOD — экран заливает кровью сверху вниз, злой смех
// ═══════════════════════════════════════════════════════════════════════════

injectStyles('dd-machete-blood-styles', `
@font-face {
  font-family: 'Crackhouse';
  src: url('modules/drama-director-cinematic/assets/fonts/Crackhouse.otf') format('opentype');
}
@font-face {
  font-family: 'DynarShadow';
  src: url('modules/drama-director-cinematic/assets/fonts/dynarshadowc.otf') format('opentype');
}

/* ── overlay ── */
.mchb-overlay {
  position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
  z-index: 10000; overflow: hidden; pointer-events: auto; background: transparent;
}

/* ── blood streaks — неровные кровяные подтёки ── */
.mchb-streak {
  position: absolute; top: 0; z-index: 1;
  transform: translateY(-110vh);
  animation: mchb-drip var(--dur) var(--ease) var(--delay) forwards;
  will-change: transform;
  /* clip-path делает неровные рваные края вместо прямоугольника */
  clip-path: polygon(
    var(--cl0,2%) 0%,
    var(--cr0,98%) 0%,
    var(--cr1,100%) 8%,
    var(--cr2,96%) 20%,
    var(--cr3,102%) 35%,
    var(--cr4,98%) 50%,
    var(--cr5,104%) 65%,
    var(--cr6,97%) 78%,
    var(--crb,85%) 92%,
    var(--ctip,50%) 100%,
    var(--clb,15%) 92%,
    var(--cl6,3%) 78%,
    var(--cl5,−4%) 65%,
    var(--cl4,2%) 50%,
    var(--cl3,−2%) 35%,
    var(--cl2,4%) 20%,
    var(--cl1,0%) 8%
  );
  background: linear-gradient(
    180deg,
    #6a0000 0%,
    #9b0000 15%,
    #cc0000 40%,
    #aa0000 65%,
    #880000 82%,
    #660000 93%,
    #330000 100%
  );
}
@keyframes mchb-drip { 0%{transform:translateY(-110vh);}100%{transform:translateY(0);} }

/* каждый потёк — отдельный div без blob, форма задаётся clip-path через JS */


/* ── flood ── */
.mchb-flood {
  position: absolute; inset: 0; z-index: 2;
  background: radial-gradient(ellipse at 50% 30%,rgba(160,0,0,.97) 0%,rgba(100,0,0,1) 50%,rgba(40,0,0,1) 100%);
  opacity: 0; pointer-events: none; transition: opacity 1.5s ease-in;
}
.mchb-flood.mchb-on { opacity: 1; }

/* ── white flash layer ── */
.mchb-flash {
  position: absolute; inset: 0; z-index: 50;
  background: #fff; opacity: 0; pointer-events: none;
}

/* ── transition animations for slide/zoom ── */
@keyframes mchb-slide-in-left  { from{transform:translateX(-100vw);}to{transform:translateX(0);} }
@keyframes mchb-slide-in-right { from{transform:translateX(100vw);}to{transform:translateX(0);} }
@keyframes mchb-slide-in-top   { from{transform:translateY(-100vh);}to{transform:translateY(0);} }
@keyframes mchb-zoom-in-enter  { from{transform:scale(1.5);opacity:0;}to{transform:scale(1);opacity:1;} }
@keyframes mchb-zoom-out-enter { from{transform:scale(0.55);opacity:0;}to{transform:scale(1);opacity:1;} }
@keyframes mchb-slide-out-left { from{transform:translateX(0);}to{transform:translateX(-100vw);} }
@keyframes mchb-slide-out-right{ from{transform:translateX(0);}to{transform:translateX(100vw);} }

.mchb-trans-in  { animation: var(--ta-in)  .32s cubic-bezier(.22,0,.36,1) both; }
.mchb-trans-out { animation: var(--ta-out) .28s cubic-bezier(.55,0,1,.45) both; }

/* ── video background (blood_background.webm) ── */
.mchb-video-bg {
  position: absolute; inset: 0; z-index: 3; pointer-events: none;
  overflow: hidden; opacity: 0; transition: opacity .4s ease-out;
}
.mchb-video-bg.mchb-on { opacity: 1; }
.mchb-video-bg video {
  width: 100%; height: 100%; object-fit: cover; display: block;
}

/* ── bg layer ── */
.mchb-bg-layer {
  position: absolute; inset: -15%; z-index: 3;
  background-size: cover; background-position: center 50%; background-repeat: no-repeat;
  opacity: 1; pointer-events: none;
  /* campaign: 130% scale + slow drift up + mild shake */
  animation: mchb-bg-drift 18s linear forwards, mchb-bg-shake .55s steps(2) infinite;
  transform-origin: center center;
}
/* base: invisible until needed */
.mchb-bg-layer { opacity: 0; animation: none; }
.mchb-bg-layer.mchb-campaign-on {
  opacity: 1;
  animation: mchb-bg-drift 12s linear forwards, mchb-bg-shake .55s steps(2) infinite;
}
@keyframes mchb-bg-drift {
  0%   { transform: scale(1.30) translateY(0); }
  100% { transform: scale(1.25) translateY(-6%); }
}
@keyframes mchb-bg-shake {
  0%  { margin-left: 0;    margin-top: 0; }
  25% { margin-left: -3px; margin-top: 2px; }
  50% { margin-left: 3px;  margin-top: -2px; }
  75% { margin-left: -2px; margin-top: 3px; }
}

/* ── stage ── */
.mchb-stage { position: absolute; inset: 0; z-index: 4; overflow: hidden; }

/* ── shake — интенсивность вдвое меньше ── */
@keyframes mchb-shake {
  0%,100%{transform:translate(0,0) rotate(0);}
  10%{transform:translate(-1.5px,1px) rotate(-.2deg);}
  25%{transform:translate(2px,-1px) rotate(.25deg);}
  40%{transform:translate(-2px,1.5px) rotate(-.18deg);}
  55%{transform:translate(1.5px,-1.5px) rotate(.2deg);}
  70%{transform:translate(-1px,2px) rotate(-.25deg);}
  85%{transform:translate(2px,-.5px) rotate(.15deg);}
}
@keyframes mchb-shake-hard {
  0%,100%{transform:translate(0,0) rotate(0);}
  12%{transform:translate(-3.5px,2.5px) rotate(-.55deg);}
  28%{transform:translate(4px,-3px) rotate(.65deg);}
  44%{transform:translate(-4.5px,-2px) rotate(-.45deg);}
  60%{transform:translate(3.5px,3.5px) rotate(.5deg);}
  76%{transform:translate(-4px,-2.5px) rotate(-.55deg);}
  92%{transform:translate(4.5px,1.5px) rotate(.4deg);}
}

/* ── «GM представляет» ── */
.mchb-presents {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  animation: mchb-shake .6s steps(2) infinite;
}
.mchb-gm-name {
  font-family: 'Crackhouse', fantasy;
  font-size: clamp(3rem,9vw,12rem); color: #fff;
  text-align: center; line-height: .88;
  text-shadow: 3px 3px 0 #8b0000, 7px 7px 0 #3a0000, 0 0 60px rgba(200,0,0,.4);
  padding: 0 4vw; word-break: break-word;
}
.mchb-presents-word {
  font-family: 'Crackhouse', fantasy;
  font-size: clamp(1.5rem,4vw,5.5rem); color: rgba(255,255,255,.82);
  text-align: center; letter-spacing: .12em;
  text-shadow: 2px 2px 0 #8b0000;
  margin-top: clamp(8px,1.5vh,22px);
}

/* ── campaign title ── */
/* ── campaign title container — НЕ трясётся, только bg под ней ── */
.mchb-campaign {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  /* без animation — title стоит неподвижно */
}
.mchb-campaign-title {
  font-family: 'DynarShadow', fantasy;
  font-size: clamp(3.5rem,11vw,16rem); color: #fff;
  text-align: center; line-height: .86; letter-spacing: .02em;
  text-shadow: 4px 4px 0 rgba(0,0,0,.75), 0 0 80px rgba(180,0,0,.5);
  padding: 0 5vw; word-break: break-word;
  position: relative; z-index: 1;
}

/* ── preset image wrapper ── */
.mchb-preset-wrap {
  position: absolute; inset: 0; overflow: hidden;
  animation: mchb-shake .4s steps(3) infinite;
}
.mchb-preset-bg {
  position: absolute; inset: 0;
  background-size: cover; background-position: center; background-repeat: no-repeat;
  transform-origin: center center;
}
/* первый кадр N.png — зум 130 -> 100 */
.mchb-preset-bg.mchb-zoom-in {
  animation: mchb-zoom-in 1.5s cubic-bezier(.25,0,.35,1) forwards;
}
@keyframes mchb-zoom-in { 0%{transform:scale(1.30);}100%{transform:scale(1.00);} }
/* второй кадр N-2.png — нормальный размер */
.mchb-preset-bg.mchb-zoom-normal { transform: scale(1.0); }

/* призрак портрета под machete3-2.png */
.mchb-portrait-ghost {
  position: absolute; inset: 0; z-index: 0;
  display: flex; align-items: center; justify-content: center;
}
.mchb-portrait-ghost img {
  width: 50%; height: auto; max-height: 90vh; object-fit: contain;
  filter: grayscale(1) sepia(1) hue-rotate(-20deg) contrast(1.5) saturate(6) brightness(.75);
  opacity: .55;
}

/* ── player card ── */
.mchb-card {
  position: absolute; inset: 0; display: flex; align-items: stretch;
  animation: mchb-card-zoom 2.5s cubic-bezier(.22,0,.36,1) forwards;
  transform-origin: center center;
}
/* Тряска на внутреннем слое — чуть-чуть */
.mchb-card-inner {
  display: contents;
  animation: mchb-shake-micro .5s steps(2) infinite;
}
@keyframes mchb-shake-micro {
  0%,100%{ transform: translate(0,0) rotate(0); }
  33%    { transform: translate(-.7px,.5px) rotate(-.08deg); }
  66%    { transform: translate(.8px,-.4px) rotate(.07deg); }
}
@keyframes mchb-card-zoom {
  0%   { transform: scale(1.30); }
  50%  { transform: scale(1.30); }
  100% { transform: scale(1.00); }
}
.mchb-card-portrait {
  flex: 0 0 55%; position: relative; overflow: hidden;
}
.mchb-card-portrait > img {
  width: 100%; height: 100%;
  object-fit: cover; object-position: center top; display: block;
  /* чёрно-красный */
  filter: grayscale(1) sepia(1) hue-rotate(-20deg) contrast(1.6) saturate(7) brightness(.72);
  position: relative; z-index: 0;
}
.mchb-card-names {
  flex: 1; display: flex; flex-direction: column; justify-content: center;
  padding: clamp(18px,3.5vw,55px); background: transparent;
}
.mchb-card-char {
  font-family: 'Crackhouse', fantasy;
  font-size: clamp(2rem,6vw,8rem); color: #fff; text-transform: uppercase;
  line-height: .86; word-break: break-word;
  text-shadow: 3px 3px 0 #8b0000, 6px 6px 0 #3a0000;
}
.mchb-card-player {
  font-family: 'Crackhouse', fantasy;
  font-size: clamp(.9rem,2.2vw,2.8rem); color: rgba(255,255,255,.55);
  text-transform: uppercase; letter-spacing: .08em;
  margin-top: clamp(8px,1.5vh,20px); text-shadow: 1px 1px 0 #8b0000;
}

/* ── кровяные пятна + потёки на фоне портрета ── */
.mchb-bloodstains {
  position: absolute; inset: 0; z-index: 1; pointer-events: none; overflow: hidden;
}
.mchb-bloodstain {
  position: absolute; border-radius: 50%;
  background: radial-gradient(circle,rgba(140,0,0,.92) 0%,rgba(80,0,0,.62) 40%,transparent 75%);
  transform: scale(0); transform-origin: center;
  animation: mchb-stain-spread var(--sd) cubic-bezier(.15,0,.35,1) var(--sdelay) forwards;
}
@keyframes mchb-stain-spread {
  0%  { transform: scale(0); opacity: .9; }
  65% { opacity: .78; }
  100%{ transform: scale(1); opacity: .55; }
}
.mchb-drip-line {
  position: absolute; width: var(--dw,6px); border-radius: 3px;
  background: linear-gradient(180deg,rgba(140,0,0,.95) 0%,rgba(80,0,0,.4) 80%,transparent 100%);
  top: var(--dt,0%); left: var(--dl,50%);
  height: 0;
  animation: mchb-drip-line-grow var(--dd,1.2s) ease-in var(--ddelay,0ms) forwards;
}
@keyframes mchb-drip-line-grow {
  0%  { height: 0; opacity: 1; }
  85% { opacity: .8; }
  100%{ height: var(--dh,120px); opacity: .4; }
}

/* ── splatters ── */
.mchb-splatters { position: absolute; inset: 0; z-index: 5; pointer-events: none; overflow: hidden; }
.mchb-splat {
  position: absolute; border-radius: 50%;
  background: radial-gradient(circle,rgba(200,0,0,.95) 0%,rgba(90,0,0,.55) 55%,transparent 100%);
  animation: mchb-splat-pop .18s ease-out forwards;
}
@keyframes mchb-splat-pop { 0%{transform:scale(0);opacity:1;}100%{transform:scale(1);opacity:.72;} }

/* ── particles — изогнутые полоски как повреждённая плёнка ── */
.mchb-particles { position: absolute; inset: 0; z-index: 6; pointer-events: none; overflow: hidden; }
.mchb-ptcl {
  position: absolute;
  border-radius: var(--pr, 2px);
  animation: mchb-ptcl-fly var(--pd) ease-out var(--pdelay,0ms) forwards;
}
@keyframes mchb-ptcl-fly {
  0%  { opacity: .9;  transform: translate(0,0) rotate(var(--prot)) scaleX(1); }
  60% { opacity: .75; }
  100%{ opacity: 0;   transform: translate(var(--pdx),var(--pdy)) rotate(calc(var(--prot) + var(--prspin))) scaleX(var(--psx,.4)); }
}

/* ── grain ── */
.mchb-grain {
  position: absolute; inset: 0; z-index: 7; pointer-events: none;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 300 300' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  opacity: .12; mix-blend-mode: overlay;
  animation: mchb-grain-shift .07s steps(4) infinite;
}
@keyframes mchb-grain-shift {
  0%{background-position:0 0;}25%{background-position:15px -12px;}
  50%{background-position:-9px 18px;}75%{background-position:6px -6px;}
}

/* ── vignette ── */
.mchb-vignette {
  position: absolute; inset: 0; z-index: 8; pointer-events: none;
  background: radial-gradient(ellipse at center,transparent 30%,rgba(0,0,0,.55) 72%,rgba(0,0,0,.92) 100%);
}

/* ── end titles ── */
.mchb-titles {
  position: absolute; inset: 0; background: #000;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: clamp(10px,2vh,30px);
  /* без тряски */
}
.mchb-title-line {
  font-family: 'Crackhouse', fantasy;
  font-size: clamp(1.4rem,3.2vw,4.5rem); color: #fff;
  text-align: center; line-height: 1.1; padding: 0 5vw;
  text-shadow: 2px 2px 0 #8b0000, 0 0 35px rgba(200,0,0,.45);
  opacity: 0; transform: scaleX(.75);
  transition: opacity .1s ease-out, transform .1s ease-out;
}
.mchb-title-line.mchb-on { opacity: 1; transform: scaleX(1); }

/* ── skip ── */
.mchb-skip-btn {
  position: fixed; bottom: 22px; right: 22px; z-index: 10020;
  display: flex; align-items: center; gap: 7px;
  padding: 8px 18px; background: rgba(30,0,0,.95);
  border: 1px solid rgba(180,0,0,.6); border-radius: 2px; color: #cc2222;
  font-family: 'Crackhouse', fantasy; font-size: 13px;
  letter-spacing: 3px; text-transform: uppercase;
  cursor: pointer; opacity: 0; transform: translateY(12px);
  transition: opacity .35s, transform .35s; pointer-events: auto;
}
.mchb-skip-btn.mchb-on { opacity: 1; transform: translateY(0); }
.mchb-skip-btn:hover { border-color: #cc0000; color: #ff3333; }
`);

// ─── Потёки ────────────────────────────────────────────────────────────────
function _mchbGenerateStreaks() {
  const streaks = [];
  const rnd = (a, b) => a + Math.random() * (b - a);

  // Функция генерирует случайные переменные для clip-path — рваные края
  const irregClip = () => {
    // left edge points (0%=левый край, могут уходить немного за)
    const cl = Array.from({length:7}, () => `${rnd(-5,8).toFixed(1)}%`);
    // right edge points
    const cr = Array.from({length:7}, () => `${rnd(92,107).toFixed(1)}%`);
    // tip — нижний кончик капли, случайно смещён от центра
    const tip = `${rnd(35,65).toFixed(1)}%`;
    // shoulder — ширина чуть выше кончика
    const clb = `${rnd(8,25).toFixed(1)}%`;
    const crb = `${rnd(75,92).toFixed(1)}%`;
    return { cl, cr, tip, clb, crb };
  };

  // 16 широких — покрывают всю ширину
  for (let i = 0; i < 16; i++) {
    const w    = 4 + rnd(0, 6);          // 4–10vw
    const left = (100 / 16) * i + rnd(-1.5, 1.5);
    const ic   = irregClip();
    streaks.push({
      left: Math.max(0, Math.min(95, left)), width: w,
      delay: rnd(0, 700), dur: rnd(1500, 2300),
      ease: Math.random() > 0.5 ? 'cubic-bezier(0.2,0,0.4,1)' : 'cubic-bezier(0.35,0.05,0.6,0.95)',
      clip: ic,
    });
  }
  // 20 тонких — хаотичные
  for (let i = 0; i < 20; i++) {
    const w  = 1 + rnd(0, 5);
    const ic = irregClip();
    streaks.push({
      left: rnd(0, 97), width: w,
      delay: rnd(100, 1100), dur: rnd(1300, 2300),
      ease: 'cubic-bezier(0.3,0,0.8,0.8)',
      clip: ic,
    });
  }
  return streaks;
}

// ─── Частицы — изогнутые полоски как плёночные царапины ──────────────────
function _mchbSpawnParticles(container, intervalMs = 160) {
  const colors = ['#ff0000','#cc0000','#ff2200','#ff5500','#dd0000','#ff3300','#ee1100'];
  let active = true;
  const spawn = () => {
    if (!active || !container.isConnected) return;
    const p = document.createElement('div');
    p.className = 'mchb-ptcl';
    // полоска: узкая и длинная, с небольшим border-radius — как царапина
    const w   = 3  + Math.random() * 6;          // 3–9px ширина
    const h   = 35 + Math.random() * 90;          // 35–125px длина
    const rot = (Math.random() - 0.5) * 80;       // угол -40..+40 deg
    const spin= (Math.random() - 0.5) * 120;      // доп. вращение за полёт
    const sx  = Math.random() * window.innerWidth;
    const sy  = 20 + Math.random() * (window.innerHeight * 0.9);
    const dx  = (Math.random() - 0.5) * 260;
    const dy  = -(50 + Math.random() * 280);
    const dur = 550 + Math.random() * 700;
    const color = colors[Math.floor(Math.random() * colors.length)];
    p.style.cssText = [
      `left:${sx.toFixed(0)}px`, `top:${sy.toFixed(0)}px`,
      `width:${w.toFixed(1)}px`, `height:${h.toFixed(0)}px`,
      `background:linear-gradient(180deg,transparent 0%,${color} 20%,${color} 80%,transparent 100%)`,
      `--pr:${(1 + Math.random() * 2).toFixed(1)}px`,
      `--prot:${rot.toFixed(1)}deg`, `--prspin:${spin.toFixed(1)}deg`,
      `--psx:${(.2 + Math.random() * .5).toFixed(2)}`,
      `--pd:${Math.round(dur)}ms`, `--pdx:${Math.round(dx)}px`, `--pdy:${Math.round(dy)}px`,
    ].join(';');
    container.appendChild(p);
    setTimeout(() => p.remove(), dur + 100);
    setTimeout(spawn, intervalMs + Math.random() * intervalMs * 0.6);
  };
  spawn();
  return () => { active = false; };
}

// ─── Брызги крови ──────────────────────────────────────────────────────────
function _mchbSpawnSplatters(container) {
  let active = true;
  const spawn = () => {
    if (!active || !container.isConnected) return;
    const s = document.createElement('div');
    s.className = 'mchb-splat';
    const size = 30 + Math.random() * 100;
    s.style.cssText = `left:${Math.random()*91}%;top:${Math.random()*91}%;width:${size}px;height:${size}px;`;
    container.appendChild(s);
    setTimeout(() => s.remove(), 1600 + Math.random() * 2400);
    setTimeout(spawn, 220 + Math.random() * 320);
  };
  spawn();
  return () => { active = false; };
}

// ─── Кровяные пятна + потёки на портрете ──────────────────────────────────
function _mchbAddBloodStains(container) {
  // Максимум 2 большие пятна
  const count = 1 + Math.floor(Math.random() * 2); // 1 или 2
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.className = 'mchb-bloodstain';
    const size = 200 + Math.random() * 220; // 200–420px — большие
    el.style.cssText = `left:${(Math.random()*55).toFixed(1)}%;top:${(Math.random()*55).toFixed(1)}%;width:${size.toFixed(0)}px;height:${size.toFixed(0)}px;--sd:${Math.round(1100+Math.random()*700)}ms;--sdelay:${Math.round(Math.random()*600)}ms;`;
    container.appendChild(el);
  }
  // Потёки — оставляем
  const dripCount = 5 + Math.floor(Math.random() * 4);
  for (let i = 0; i < dripCount; i++) {
    const el = document.createElement('div');
    el.className = 'mchb-drip-line';
    const w = 4 + Math.random() * 8;
    const h = 60 + Math.random() * 160;
    el.style.cssText = `--dw:${w.toFixed(1)}px;--dl:${(Math.random()*90).toFixed(1)}%;--dt:${(Math.random()*40).toFixed(1)}%;--dh:${Math.round(h)}px;--dd:${Math.round(800+Math.random()*600)}ms;--ddelay:${Math.round(Math.random()*1500)}ms;`;
    container.appendChild(el);
  }
}

// ─── Переход — всегда белая вспышка ──────────────────────────────────────
async function _mchbTransition(flashEl, stage, oldEl, newEl) {
  flashEl.style.transition = 'none';
  flashEl.style.opacity    = '1';
  await waitMs(16);
  if (oldEl) oldEl.remove();
  if (newEl) stage.appendChild(newEl);
  flashEl.style.transition = 'opacity 250ms ease-in';
  flashEl.style.opacity    = '0';
  await waitMs(260);
}

// ─── State ─────────────────────────────────────────────────────────────────
let mchbPlaying = false, mchbSkipFlag = false, mchbAudio = null, mchbAudio2 = null;
let _mchbStopFns = [];

// ─── Предзагрузка изображений ─────────────────────────────────────────────
function _mchbPreload(urls) {
  return Promise.all(urls.map(src => new Promise(resolve => {
    if (!src) return resolve();
    const img = new Image();
    img.onload  = resolve;
    img.onerror = resolve; // не блокируем если нет файла
    img.src = src;
  })));
}

export async function executeMacheteBloodIntro(campaignName = '') {
  if (mchbPlaying) return;
  mchbPlaying  = true;
  mchbSkipFlag = false;
  _mchbStopFns = [];
  const isSkip = () => mchbSkipFlag;

  const MBASE    = `modules/${MODULE_ID}/assets/`;
  const BASE     = `modules/${MODULE_ID}/assets/machette/`;
  const FPS      = 24;
  const FRAME_MS = 1000 / FPS;
  const pad4     = n => String(n).padStart(4, '0');
  const range    = (a, b, fn) => { const r = []; for (let i = a; i <= b; i++) r.push(fn(i)); return r; };

  // ── DOM ──────────────────────────────────────────────────────────────────
  const overlay  = document.createElement('div'); overlay.className  = 'mchb-overlay';
  const stage    = document.createElement('div'); stage.className    = 'mchb-stage';
  const grain    = document.createElement('div'); grain.className    = 'mchb-grain';
  const flashEl  = document.createElement('div'); flashEl.className  = 'mchb-flash';
  [stage, grain, flashEl].forEach(el => overlay.appendChild(el));
  document.body.appendChild(overlay);

  if (game.user?.isGM) {
    const skipBtn = document.createElement('button');
    skipBtn.className = 'mchb-skip-btn';
    skipBtn.innerHTML = `<i class="fa-solid fa-forward"></i> ${game.i18n.localize('DRAMADIRECTOR.intro.skip')}`;
    document.body.appendChild(skipBtn);
    setTimeout(() => skipBtn?.classList.add('mchb-on'), 800);
    skipBtn.addEventListener('click', () => {
      mchbSkipFlag = true;
      game.socket?.emit(`module.${MODULE_ID}`, { action: 'macheteBloodSkip' });
      mchbCleanup();
    });
  }
  if (isSkip()) { mchbCleanup(); return; }

  // ── Игроки ────────────────────────────────────────────────────────────────
  const players = [];
  for (const user of game.users.filter(u => u.active && !u.isGM)) {
    const ch = user.character;
    if (!ch) continue;
    players.push({ playerName: user.name, characterName: ch.name,
                   portrait: ch.img || user.avatar || 'icons/svg/mystery-man.svg' });
  }

  // ── Rolling prefetcher ────────────────────────────────────────────────────
  // Грузит кадры вперёд по 48 штук. 404 = null (держим последний валидный кадр).
  // Не блокирует интро — сразу начинаем воспроизведение.
  const AHEAD = 48;
  const makePrefetcher = (urls) => {
    const cache    = new Array(urls.length).fill(undefined); // undefined=ещё не запрошен
    const inFlight = new Set();

    const fetchOne = i => {
      if (i < 0 || i >= urls.length || cache[i] !== undefined || inFlight.has(i)) return;
      inFlight.add(i);
      fetch(urls[i])
        .then(r => r.ok ? r.blob() : Promise.reject())
        .then(b => createImageBitmap(b))
        .then(bmp => { cache[i] = bmp; })
        .catch(()  => { cache[i] = null; })
        .finally(() => inFlight.delete(i));
    };

    const prefetchAhead = from => {
      for (let i = from; i < Math.min(from + AHEAD, urls.length); i++) fetchOne(i);
    };

    prefetchAhead(0); // стартуем сразу

    return { get: i => cache[i], prefetchAhead, length: urls.length };
  };

  // ── Canvas player ─────────────────────────────────────────────────────────
  // undefined кадр (ещё грузится) = держим предыдущий кадр → нет мерцания.
  // null кадр (404)               = держим предыдущий кадр → нет мерцания.
  const playSeq = (pf, container, onFrame, zIndex = 1, onLastFrame) => new Promise(async resolve => {
    // Ждём пока первый кадр загрузится (обычно < 200мс, сеть локальная)
    while (pf.get(0) === undefined && !isSkip()) await waitMs(32);
    if (isSkip()) { resolve(); return; }

    const cvs = document.createElement('canvas');
    cvs.style.cssText = `position:absolute;inset:0;width:100%;height:100%;display:block;z-index:${zIndex};`;
    cvs.width  = window.innerWidth;
    cvs.height = window.innerHeight;
    container.appendChild(cvs);
    const ctx = cvs.getContext('2d', { alpha: true, willReadFrequently: false });

    let lastBmp = null;
    const draw = bmp => {
      if (bmp) lastBmp = bmp;
      if (!lastBmp) return;
      const cw = cvs.width, ch = cvs.height;
      ctx.clearRect(0, 0, cw, ch);
      const { width: bw, height: bh } = lastBmp;
      const s = Math.max(cw / bw, ch / bh);
      ctx.drawImage(lastBmp, (cw - bw*s)/2, (ch - bh*s)/2, bw*s, bh*s);
    };

    let frame = 0, acc = 0, prev = performance.now(), rafId;
    draw(pf.get(0));

    const tick = now => {
      if (isSkip()) { cancelAnimationFrame(rafId); resolve(); return; }
      acc += now - prev; prev = now;
      while (acc >= FRAME_MS) {
        acc -= FRAME_MS;
        if (frame >= pf.length) {
          onLastFrame?.();          // ← вспышка на последнем кадре
          cancelAnimationFrame(rafId); resolve(); return;
        }
        draw(pf.get(frame));
        onFrame?.(frame);
        frame++;
        pf.prefetchAhead(frame);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    _mchbStopFns.push(() => cancelAnimationFrame(rafId));
  });

  // ── Карточка персонажа ────────────────────────────────────────────────────
  const makeCard = (player, portraitSide) => {
    const portDiv = document.createElement('div');
    portDiv.className = 'mchb-card-portrait';
    portDiv.style.cssText = 'flex:0 0 55%;position:relative;overflow:hidden;animation:mchb-shake .4s steps(3) infinite;';
    const pImg = document.createElement('img');
    pImg.src = player.portrait;
    pImg.onerror = () => { pImg.src = 'icons/svg/mystery-man.svg'; };
    pImg.style.cssText = 'width:100%;height:100%;object-fit:cover;object-position:center top;display:block;'
      + 'filter:grayscale(1) sepia(1) hue-rotate(-20deg) contrast(1.6) saturate(7) brightness(.72);';
    portDiv.appendChild(pImg);

    const nameDiv = document.createElement('div');
    nameDiv.className = 'mchb-card-names';
    nameDiv.style.cssText = 'flex:1;display:flex;flex-direction:column;justify-content:center;'
      + 'padding:clamp(18px,3.5vw,55px);animation:mchb-shake .4s steps(3) infinite;';
    const words = player.characterName.toUpperCase().split(/\s+/).filter(Boolean);
    nameDiv.innerHTML = `<div class="mchb-card-char">${words.map(w=>`<div>${w}</div>`).join('')}</div>`
      + `<div class="mchb-card-player">— ${player.playerName} —</div>`;

    const card = document.createElement('div');
    card.style.cssText = 'position:absolute;inset:0;display:flex;align-items:stretch;';
    if (portraitSide === 'right') { card.appendChild(nameDiv); card.appendChild(portDiv); }
    else                          { card.appendChild(portDiv); card.appendChild(nameDiv); }
    return card;
  };

  // ── Вспышка: flashIn вызывается на ПОСЛЕДНЕМ кадре (внутри onFrame),
  //             flashOut — сразу после await playSeq, пока следующая сцена уже строится.
  const flashIn  = () => { flashEl.style.transition = 'none'; flashEl.style.opacity = '1'; };
  const flashOut = async () => {
    await waitMs(16);
    flashEl.style.transition = 'opacity 280ms ease-in';
    flashEl.style.opacity = '0';
    await waitMs(290);
  };

  // ── Звук ──────────────────────────────────────────────────────────────────
  mchbAudio = new Audio(`${MBASE}sounds/evil_laugh.ogg`);
  mchbAudio.volume = 0.88;
  mchbAudio.play().catch(() => {});

  mchbAudio2 = new Audio(`${MBASE}sounds/machete.ogg`);
  mchbAudio2.volume = 0.0; mchbAudio2.loop = true;
  mchbAudio2.play().catch(() => {});

  let macheteRampDone = false;
  (async () => {
    const steps = 20, stepMs = 2400 / steps;
    for (let i = 0; i < steps; i++) {
      await waitMs(stepMs);
      if (!mchbAudio2 || macheteRampDone) break;
      mchbAudio2.volume = Math.min(0.85, (i + 1) * (0.85 / steps));
    }
    macheteRampDone = true;
    if (mchbAudio2) mchbAudio2.volume = 0.85;
  })();

  // Запускаем все prefetch-ы ДО blood — пока blood+intro играют (~13с) всё грузится
  const pfIntro    = makePrefetcher(range(1, 96,  i => `${BASE}intro/intro%20(${i}).webp`));
  const pfP1Fg     = players.length > 0 ? makePrefetcher(range(1, 144, i => `${BASE}phase1/m_p%20(${i}).webp`))       : null;
  const pfP1Bg     = players.length > 0 ? makePrefetcher(range(1, 144, i => `${BASE}phase1_2/phase1_2%20(${i}).webp`)) : null;
  const pfP2       = players.length > 0 ? makePrefetcher(range(1, 223, i => `${BASE}phase2/phase2%20(${i}).webp`))     : null;
  const pfP3       = players.length > 0 ? makePrefetcher(range(1, 286, i => `${BASE}phase3/phase3%20(${i}).webp`))     : null;

  // ═══════════════════════════════════════════════════════════════════════════
  // КРОВЬ — blood (1)→(223).webp @ 24fps
  // ═══════════════════════════════════════════════════════════════════════════
  {
    const pf   = makePrefetcher(range(1, 223, i => `${BASE}blood/blood%20(${i}).webp`));
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:absolute;inset:0;z-index:3;';
    stage.appendChild(wrap);

    await playSeq(pf, wrap, frame => {
      if (frame === pf.length - 1) flashIn();
    }, 1);
    if (isSkip()) { mchbCleanup(); return; }

    // Аудио глушим асинхронно — не блокируем старт следующей сцены
    macheteRampDone = true;
    if (mchbAudio2) mchbAudio2.volume = 0.85;
    if (mchbAudio) {
      const a = mchbAudio; mchbAudio = null;
      (async () => {
        for (let i = 0; i < 10; i++) { await waitMs(70); a.volume = Math.max(0, a.volume - 0.088); }
        a.pause();
      })();
    }

    wrap.remove();
    overlay.style.background = '#000';
    flashOut();
    if (isSkip()) { mchbCleanup(); return; }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ИНТРО — intro (1)→(96).webp @ 24fps + текст ГМ
  // ═══════════════════════════════════════════════════════════════════════════
  {
    const gmUser = game.users.find(u => u.isGM && u.active) || game.users.find(u => u.isGM);
    const gmName = gmUser?.name || 'Game Master';
    const title  = (campaignName?.trim() || game.world?.title
      || game.i18n.localize('DRAMADIRECTOR.intro.defaultCampaign')).toUpperCase();

    const introWrap = document.createElement('div');
    introWrap.style.cssText = 'position:absolute;inset:0;z-index:3;';
    overlay.appendChild(introWrap);

    const introText = document.createElement('div');
    introText.style.cssText = 'position:absolute;inset:0;z-index:4;display:flex;flex-direction:column;'
      + 'align-items:center;justify-content:center;animation:mchb-shake .6s steps(2) infinite;';
    introText.innerHTML = `
      <div class="mchb-gm-name">${gmName.toUpperCase()}</div>
      <div class="mchb-presents-word">${game.i18n.localize('DRAMADIRECTOR.intro.presents').toUpperCase()}</div>
      <div class="mchb-campaign-title" style="margin-top:clamp(10px,2vh,28px);font-size:clamp(2.5rem,8vw,11rem);">${title}</div>
    `;
    overlay.appendChild(introText);

    await playSeq(pfIntro, introWrap, frame => {
      if (frame === pfIntro.length - 1) flashIn();
    }, 1);
    if (isSkip()) { mchbCleanup(); return; }

    introWrap.remove(); introText.remove();
    flashOut();
    if (isSkip()) { mchbCleanup(); return; }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ФАЗЫ ИГРОКОВ — цикл 1→2→3→1→2→3
  // ═══════════════════════════════════════════════════════════════════════════
  for (let pi = 0; pi < players.length; pi++) {
    if (isSkip()) { mchbCleanup(); return; }
    const player = players[pi];
    const phase  = (pi % 3) + 1;
    const isLast = pi === players.length - 1;

    // ── ФАЗА 1: m_p (прозрачный поверх) + phase1_2 фон + карточка ──
    // z:3  phase1_2 canvas (фон, стартует на кадре 104)
    // z:4  карточка (появляется на кадре 104)
    // z:5  m_p canvas (прозрачный поверх всего)
    if (phase === 1) {
      const pfBg = (pi < 3 && pfP1Bg) ? pfP1Bg : makePrefetcher(range(1, 144, i => `${BASE}phase1_2/phase1_2%20(${i}).webp`));
      const pfFg = (pi < 3 && pfP1Fg) ? pfP1Fg : makePrefetcher(range(1, 144, i => `${BASE}phase1/m_p%20(${i}).webp`));

      const bgWrap = document.createElement('div');
      bgWrap.style.cssText  = 'position:absolute;inset:0;z-index:3;pointer-events:none;';
      const fgWrap = document.createElement('div');
      fgWrap.style.cssText  = 'position:absolute;inset:0;z-index:5;pointer-events:none;';
      const card = makeCard(player, 'right');
      card.style.zIndex     = '4';
      card.style.opacity    = '0';
      card.style.transition = 'opacity .35s ease';
      overlay.appendChild(bgWrap);
      overlay.appendChild(card);
      overlay.appendChild(fgWrap);

      let bgDone = null;
      await playSeq(pfFg, fgWrap, frame => {
        if (frame === 104 && !bgDone) {
          card.style.opacity = '1';
          bgDone = playSeq(pfBg, bgWrap, frame2 => {
            if (frame2 === pfBg.length - 1) flashIn();
          }, 1);
        }
      }, 1);
      if (isSkip()) { mchbCleanup(); return; }
      if (bgDone) await bgDone;
      if (isSkip()) { mchbCleanup(); return; }

      card.remove(); bgWrap.remove(); fgWrap.remove();
      if (!isLast) flashOut();
    }

    // ── ФАЗА 2: phase2 (1)→(223), карточка выезжает на кадре 100 ────────────
    else if (phase === 2) {
      const pf     = (pi < 3 && pfP2) ? pfP2 : makePrefetcher(range(1, 223, i => `${BASE}phase2/phase2%20(${i}).webp`));
      const seqWrap = document.createElement('div');
      seqWrap.style.cssText = 'position:absolute;inset:0;z-index:3;pointer-events:none;';
      const card = makeCard(player, 'right');
      card.style.zIndex     = '4';
      card.style.transform  = 'translateX(100vw)';
      card.style.transition = 'transform .6s cubic-bezier(.22,0,.36,1)';
      overlay.appendChild(seqWrap);
      overlay.appendChild(card);

      await playSeq(pf, seqWrap, frame => {
        if (frame === 100) card.style.transform = 'translateX(0)';
        if (frame === pf.length - 1) flashIn();
      }, 1);
      if (isSkip()) { mchbCleanup(); return; }

      card.remove(); seqWrap.remove();
      if (!isLast) flashOut();
    }

    // ── ФАЗА 3: phase3 (1)→(286), карточка появляется на кадре 187 ──────────
    else {
      const pf      = (pi < 3 && pfP3) ? pfP3 : makePrefetcher(range(1, 286, i => `${BASE}phase3/phase3%20(${i}).webp`));
      const seqWrap = document.createElement('div');
      seqWrap.style.cssText = 'position:absolute;inset:0;z-index:3;pointer-events:none;';
      const card = makeCard(player, 'left');
      card.style.zIndex     = '4';
      card.style.opacity    = '0';
      card.style.transition = 'opacity .4s ease';
      overlay.appendChild(seqWrap);
      overlay.appendChild(card);

      await playSeq(pf, seqWrap, frame => {
        if (frame === 187) card.style.opacity = '1';
        if (frame === pf.length - 1) flashIn();
      }, 1);
      if (isSkip()) { mchbCleanup(); return; }

      card.remove(); seqWrap.remove();
      if (!isLast) flashOut();
    }

    if (isSkip()) { mchbCleanup(); return; }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ФИНАЛЬНЫЕ ТИТРЫ — появляются под вспышкой последней фазы
  // ═══════════════════════════════════════════════════════════════════════════
  // flashIn уже сработал на последнем кадре последней фазы в цикле выше;
  // здесь строим титры и запускаем flashOut — они появятся когда flash догаснет.
  {
    const gmUser = game.users.find(u => u.isGM && u.active) || game.users.find(u => u.isGM);
    const title  = (campaignName?.trim() || game.world?.title || '').toUpperCase();

    const credits = document.createElement('div');
    credits.style.cssText = 'position:absolute;inset:0;z-index:5;display:flex;flex-direction:column;'
      + 'align-items:center;justify-content:center;gap:4vh;';

    if (title) {
      const titleEl = document.createElement('div');
      titleEl.className = 'mchb-campaign-title';
      titleEl.style.cssText = 'font-size:clamp(1.5rem,5vw,6rem);text-align:center;';
      titleEl.textContent = title;
      credits.appendChild(titleEl);
    }

    const castRow = document.createElement('div');
    castRow.style.cssText = 'display:flex;flex-wrap:wrap;justify-content:center;gap:clamp(16px,3vw,48px);max-width:90vw;';
    for (const p of players) {
      const entry = document.createElement('div');
      entry.style.cssText = 'text-align:center;animation:mchb-shake .4s steps(3) infinite;';
      const words = p.characterName.toUpperCase().split(/\s+/).filter(Boolean);
      entry.innerHTML = `<div class="mchb-card-char" style="font-size:clamp(.9rem,2.5vw,2.8rem);">${words.map(w=>`<div>${w}</div>`).join('')}</div>`
        + `<div class="mchb-card-player" style="font-size:clamp(.65rem,1.4vw,1.3rem);">— ${p.playerName} —</div>`;
      castRow.appendChild(entry);
    }
    credits.appendChild(castRow);

    if (gmUser) {
      const gmEl = document.createElement('div');
      gmEl.className = 'mchb-presents-word';
      gmEl.style.cssText = 'font-size:clamp(.7rem,1.5vw,1.4rem);margin-top:1vh;';
      gmEl.textContent = `${game.i18n.localize('DRAMADIRECTOR.intro.presents').toUpperCase()} ${gmUser.name.toUpperCase()}`;
      credits.appendChild(gmEl);
    }

    overlay.appendChild(credits);
    flashOut(); // flash гаснет — титры на чёрном фоне появляются

    if (await waitSkippable(4500, isSkip)) { mchbCleanup(); return; }
  }

  // ── Финальное затемнение ──────────────────────────────────────────────────
  _mchbStopFns.forEach(fn => fn?.());
  _mchbStopFns = [];

  overlay.style.transition = 'opacity 1.5s ease-out';
  overlay.style.opacity    = '0';
  if (mchbAudio2) {
    const steps = 15;
    for (let i = 0; i < steps; i++) {
      await waitMs(100);
      if (mchbAudio2) mchbAudio2.volume = Math.max(0, mchbAudio2.volume - 0.85 / steps);
    }
  }
  await waitMs(1500);
  mchbCleanup();
}


function mchbCleanup() {
  _mchbStopFns.forEach(fn => fn?.());
  _mchbStopFns = [];
  document.querySelector('.mchb-overlay')?.remove();
  document.querySelector('.mchb-skip-btn')?.remove();
  if (mchbAudio)  { mchbAudio.pause();  mchbAudio  = null; }
  if (mchbAudio2) { mchbAudio2.pause(); mchbAudio2 = null; }
  mchbPlaying  = false;
  mchbSkipFlag = false;
}

export function skipMacheteBloodIntro() {
  mchbSkipFlag = true;
  mchbCleanup();
}


// ═══════════════════════════════════════════════════════════════════════════
// SCI-FI INTRO — Tactical/Military Sci-Fi opening with image sequence
// Frame sequence: assets/sequence/scifi/scifi0000.webp → scifi0201.webp
//   Intro+text:  scifi0000–scifi0106 (played once)
//   Loop:        scifi0116–scifi0201 (looped during chars + outro)
// ═══════════════════════════════════════════════════════════════════════════

injectStyles('dd-scifi-styles', `
@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Share+Tech+Mono&display=swap');

.scifi-overlay {
  position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
  z-index: 10000; overflow: hidden; pointer-events: auto;
  background: #000;
}

/* ── Starfield canvas sits at the very bottom ── */
.scifi-stars {
  position: absolute; inset: 0; z-index: 0;
}
.scifi-stars canvas {
  width: 100%; height: 100%; display: block;
}

/* nebula glow patches behind stars */
.scifi-nebula {
  position: absolute; inset: 0; z-index: 0; pointer-events: none;
  background:
    radial-gradient(ellipse 55% 35% at 20% 35%,  rgba(20,0,60,0.55)   0%, transparent 70%),
    radial-gradient(ellipse 40% 50% at 80% 65%,  rgba(0,20,70,0.50)   0%, transparent 65%),
    radial-gradient(ellipse 60% 30% at 55% 80%,  rgba(5,30,80,0.35)   0%, transparent 70%),
    radial-gradient(ellipse 80% 40% at 50% 50%,  rgba(0,5,20,0.80)    0%, transparent 100%);
}

.scifi-bg {
  position: absolute; inset: 0; z-index: 1;
}
.scifi-bg img {
  width: 100%; height: 100%; object-fit: cover; display: block;
  image-rendering: auto;
  /* allow stars to show through dark areas of the sequence */
  mix-blend-mode: screen;
}

/* scanlines overlay */
.scifi-scanlines {
  position: absolute; inset: 0; z-index: 4; pointer-events: none;
  background: repeating-linear-gradient(
    0deg, transparent, transparent 2px,
    rgba(0,240,255,0.025) 2px, rgba(0,240,255,0.025) 4px
  );
}

/* vignette */
.scifi-vignette {
  position: absolute; inset: 0; z-index: 5; pointer-events: none;
  background: radial-gradient(ellipse at center, transparent 38%, rgba(0,0,15,0.55) 72%, rgba(0,0,10,0.90) 100%);
}

/* ── TEXT LAYER ── */
.scifi-text-layer {
  position: absolute; inset: 0; z-index: 10;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: clamp(12px, 2vh, 28px);
  pointer-events: none;
}

.scifi-text-line {
  font-family: 'Orbitron', 'Courier New', monospace;
  font-weight: 700;
  font-size: clamp(1.1rem, 2.6vw, 3rem);
  color: #00e5ff;
  text-transform: uppercase;
  letter-spacing: 0.22em;
  text-shadow:
    0 0 12px rgba(0,229,255,0.9),
    0 0 28px rgba(0,180,255,0.5),
    0 0 55px rgba(0,130,220,0.25);
  opacity: 0;
  min-height: 1.6em;
  text-align: center;
  padding: 0 3vw;
  transition: opacity 0.25s;
}
.scifi-text-line.active { opacity: 1; }

/* blinking cursor — dash at the bottom of text */
.scifi-cursor {
  display: inline-block;
  width: 0.55em;
  height: 0.10em;
  background: #00e5ff;
  margin-left: 4px;
  margin-bottom: 0.12em;
  vertical-align: bottom;
  box-shadow: 0 0 8px rgba(0,229,255,0.9);
  animation: scifi-cursor-blink 0.6s steps(1) infinite;
}
@keyframes scifi-cursor-blink {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0; }
}

/* ── DECOR: horizontal lines around text ── */
.scifi-text-decor {
  position: absolute; left: 8vw; right: 8vw;
  height: 1px; background: rgba(0,220,255,0.25);
  pointer-events: none;
}
.scifi-text-decor.top { top: calc(50% - clamp(80px,12vh,140px)); }
.scifi-text-decor.bot { top: calc(50% + clamp(80px,12vh,140px)); }

/* ── CHARACTER SECTION ── */
.scifi-char-section {
  position: absolute; inset: 0; z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: clamp(30px, 5vw, 80px);
  opacity: 0;
}
.scifi-char-section.scifi-on { opacity: 1; }

/* Portrait — Sin City strict B&W + blue tint */
.scifi-portrait-wrap {
  position: relative; flex-shrink: 0;
  width: clamp(180px, 26vw, 380px);
  height: clamp(240px, 40vh, 540px);
  overflow: hidden;
}

.scifi-portrait-img {
  width: 100%; height: 100%;
  object-fit: cover; object-position: center top; display: block;
  /* strict two-tone B&W like Sin City */
  filter: grayscale(1) contrast(7) brightness(1.25);
}

/* blue tint screen layer */
.scifi-portrait-tint {
  position: absolute; inset: 0; z-index: 1; pointer-events: none;
  background: rgba(20, 100, 200, 0.20);
  mix-blend-mode: screen;
}

/* blue glow halo */
.scifi-portrait-halo {
  position: absolute; inset: -8px; z-index: 2; pointer-events: none;
  box-shadow:
    0 0 30px 8px rgba(0, 140, 255, 0.65),
    0 0 70px 20px rgba(0, 80, 200, 0.30);
  border: 1px solid rgba(0, 200, 255, 0.30);
}

/* scanlines on portrait */
.scifi-portrait-scan {
  position: absolute; inset: 0; z-index: 3; pointer-events: none;
  background: repeating-linear-gradient(
    0deg, transparent, transparent 3px,
    rgba(0,0,0,0.12) 3px, rgba(0,0,0,0.12) 4px
  );
}

/* glitch appear animation */
@keyframes scifi-glitch-appear {
  0%   { clip-path: inset(48% 0 48% 0); transform: translateX(-8px) scaleX(1.04); filter: grayscale(1) contrast(12) brightness(2.5) hue-rotate(150deg); }
  8%   { clip-path: inset(5%  0 85% 0); transform: translateX(6px); }
  16%  { clip-path: inset(72% 0 8%  0); transform: translateX(-4px); filter: grayscale(1) contrast(9) brightness(1.8) hue-rotate(200deg); }
  24%  { clip-path: inset(25% 0 45% 0); transform: translateX(10px); }
  32%  { clip-path: inset(60% 0 20% 0); transform: translateX(-6px); filter: grayscale(1) contrast(7) brightness(1.4); }
  40%  { clip-path: inset(10% 0 70% 0); transform: translateX(4px); }
  52%  { clip-path: inset(0 0 0 0);     transform: translateX(0);   filter: grayscale(1) contrast(7) brightness(1.25); }
  62%  { clip-path: inset(35% 0 55% 0); transform: translateX(-3px); }
  72%  { clip-path: inset(0 0 0 0);     transform: translateX(0); }
  82%  { clip-path: inset(80% 0 5%  0); transform: translateX(2px); filter: grayscale(1) contrast(7) brightness(1.3); }
  92%  { clip-path: inset(0 0 0 0);     transform: translateX(0); }
  100% { clip-path: inset(0 0 0 0);     transform: translateX(0);   filter: grayscale(1) contrast(7) brightness(1.25); }
}
.scifi-portrait-img.glitch-in {
  animation: scifi-glitch-appear 0.7s cubic-bezier(0.22, 0.8, 0.36, 1) forwards;
}

/* ── NAME BLOCK (right of portrait) ── */
.scifi-name-block {
  display: flex; flex-direction: column;
  gap: clamp(6px, 1vh, 14px);
  max-width: clamp(180px, 35vw, 500px);
}

.scifi-char-name {
  font-family: 'Orbitron', monospace; font-weight: 900;
  font-size: clamp(1.5rem, 3.5vw, 5rem);
  color: #00e5ff; text-transform: uppercase;
  letter-spacing: 0.08em; line-height: 0.9;
  text-shadow:
    0 0 15px rgba(0,229,255,0.95),
    0 0 35px rgba(0,160,255,0.5);
  word-break: break-word;
}

.scifi-player-name {
  font-family: 'Share Tech Mono', 'Courier New', monospace;
  font-size: clamp(0.7rem, 1.1vw, 1.3rem);
  color: rgba(0, 200, 255, 0.55);
  letter-spacing: 0.35em; text-transform: uppercase;
}

/* ── OUTRO ── */
.scifi-outro-layer {
  position: absolute; inset: 0; z-index: 15;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: clamp(14px, 2.5vh, 32px);
  pointer-events: none; opacity: 0; transition: opacity 0.6s;
}
.scifi-outro-layer.scifi-on { opacity: 1; }

.scifi-outro-text {
  font-family: 'Orbitron', monospace; font-weight: 900;
  font-size: clamp(1.8rem, 4.5vw, 6.5rem);
  color: #00e5ff; text-transform: uppercase;
  letter-spacing: 0.25em; text-align: center;
  text-shadow:
    0 0 20px rgba(0,229,255,1),
    0 0 50px rgba(0,180,255,0.7),
    0 0 90px rgba(0,120,200,0.35);
  padding: 0 4vw;
}

/* ── SKIP BUTTON ── */
.scifi-skip-btn {
  position: fixed; bottom: 22px; right: 22px; z-index: 10020;
  display: flex; align-items: center; gap: 7px;
  padding: 8px 18px; background: rgba(0,8,18,0.92);
  border: 1px solid rgba(0,180,255,0.40); border-radius: 2px;
  color: #00aadd;
  font-family: 'Orbitron', monospace; font-size: 10px;
  letter-spacing: 3px; text-transform: uppercase;
  cursor: pointer; opacity: 0; transform: translateY(12px);
  transition: opacity 0.35s, transform 0.35s; pointer-events: auto;
}
.scifi-skip-btn.scifi-on { opacity: 1; transform: translateY(0); }
.scifi-skip-btn:hover { border-color: #00ccff; color: #00ccff; }

/* Flash for transitions */
.scifi-flash {
  position: absolute; inset: 0; z-index: 20; pointer-events: none;
  background: rgba(0,180,255,0.8); opacity: 0;
}
`);

// ─── Module-level state ────────────────────────────────────────────────────
let scifiPlaying = false, scifiSkipFlag = false;
let _scifiFrameRaf = null;
let _scifiAudio    = null;
let _scifiStarRaf  = null;

async function scifiTypeText(el, text, msPerChar, isSkip) {
  el.classList.add('active');
  const cursor = document.createElement('span');
  cursor.className = 'scifi-cursor';
  for (let i = 0; i <= text.length; i++) {
    if (isSkip()) {
      el.textContent = text;
      el.appendChild(cursor);
      return true;
    }
    el.textContent = text.slice(0, i);
    el.appendChild(cursor);
    await waitMs(msPerChar);
  }
  return false;
}

export async function executeSciFiIntro(campaignName = '', gmName = '') {
  if (scifiPlaying) return;
  scifiPlaying  = true;
  scifiSkipFlag = false;
  const isSkip = () => scifiSkipFlag;

  if (!gmName) {
    const gmUser = game.users.find(u => u.isGM && u.active) || game.users.find(u => u.isGM);
    gmName = gmUser?.name || 'Game Master';
  }

  const campaignTitle = (campaignName?.trim() || game.i18n.localize('DRAMADIRECTOR.intro.scifiUnknown')).toUpperCase();
  const BASE = `modules/${MODULE_ID}/assets/sequence/scifi/`;

  // ── Frame ranges ──
  // Intro      : scifi0000–scifi0106  (played once, ~4.42s @ 24fps) — text plays over this
  //   Wait-loop: scifi0091–scifi0106  (looped if text needs more time before transition)
  // Transit    : scifi0107–scifi0115  (played once, ~0.38s) — brief transition before loop
  // Loop       : scifi0116–scifi0201  (looped during character cards + outro)
  const INTRO_END       = 106;
  const INTRO_LOOP_START= 91;   // loop these frames while waiting for text to finish
  const TRANSIT_START   = 107;
  const TRANSIT_END     = 115;
  const LOOP_START      = 116;
  const LOOP_END        = 201;
  const LOOP_LEN        = LOOP_END - LOOP_START + 1;

  // Total intro text budget: 106 frames / 24fps = 4.42s
  // Subtract fade-in 0.4s → initial text window ≈ 4.0s
  // If text needs more time, frames 91–106 loop automatically (~0.67s per cycle)
  // until the text phase sets frameMode = 'transit' to trigger the transition.
  // Timeline:
  //   Line1 type  ~17ch @ 30ms = 0.51s | hold 0.42s | fade 0.12s → 1.05s
  //   Line2 type ~30ch @ 28ms = 0.84s | hold+tail 1.35s          → 2.19s
  //   Line3 type ~13ch @ 28ms = 0.36s | hold 0.40s               → 0.76s (+ loops if needed)
  //   Text fadeout 0.25s                                          → 0.25s
  //   Total ≈ 4.25s — fits in first pass; longer campaign names loop seamlessly

  const padNum = (n) => n.toString().padStart(4, '0');

  // ── Music ──────────────────────────────────────────────────────────────
  _scifiAudio = new Audio(`modules/${MODULE_ID}/assets/sounds/scifi.ogg`);
  _scifiAudio.volume = 0.85;
  _scifiAudio.play().catch(() => {});

  // ── Build overlay ──────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.className = 'scifi-overlay';
  overlay.style.opacity = '0';
  overlay.style.transition = 'opacity 0.4s ease-out';
  overlay.innerHTML = `
    <div class="scifi-nebula"></div>
    <div class="scifi-stars"><canvas id="scifi-star-canvas"></canvas></div>
    <div class="scifi-bg"><img id="scifi-frame-img" src="${BASE}scifi0000.webp" alt=""></div>
    <div class="scifi-scanlines"></div>
    <div class="scifi-vignette"></div>
    <div class="scifi-flash" id="scifi-flash"></div>
  `;
  document.body.appendChild(overlay);

  // ── Starfield animation ────────────────────────────────────────────────
  const starCanvas = overlay.querySelector('#scifi-star-canvas');
  starCanvas.width  = window.innerWidth;
  starCanvas.height = window.innerHeight;
  const sCtx = starCanvas.getContext('2d');

  // Generate stars: small static + tiny twinkling + a few large bright ones
  const STAR_COUNT = 420;
  const stars = Array.from({ length: STAR_COUNT }, (_, i) => ({
    x:    Math.random() * starCanvas.width,
    y:    Math.random() * starCanvas.height,
    r:    i < 8   ? 1.8 + Math.random() * 1.4          // 8 large
        : i < 60  ? 0.9 + Math.random() * 0.8           // 52 medium
        :           0.2 + Math.random() * 0.55,          // rest tiny
    base: i < 8   ? 0.75 + Math.random() * 0.25
        : i < 60  ? 0.45 + Math.random() * 0.40
        :           0.15 + Math.random() * 0.55,
    phase:  Math.random() * Math.PI * 2,
    speed:  0.4  + Math.random() * 1.2,
    // subtle colour tint
    hue:  Math.random() < 0.15 ? (Math.random() < 0.5 ? '#b8d4ff' : '#ffd8b8') : '#ffffff',
    // shooting star chance for 3 stars
    shoot: i < 3,
    shootX: 0, shootY: 0, shootActive: false, shootTimer: Math.random() * 8000 + 4000,
  }));

  let _starLastTs = 0;
  const drawStars = (ts) => {
    const dt = ts - _starLastTs;
    _starLastTs = ts;
    sCtx.clearRect(0, 0, starCanvas.width, starCanvas.height);

    for (const s of stars) {
      s.phase += s.speed * 0.016;
      const alpha = Math.max(0.05, s.base + Math.sin(s.phase) * s.base * 0.45);

      // draw star
      sCtx.beginPath();
      sCtx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      sCtx.fillStyle = s.hue === '#ffffff'
        ? `rgba(255,255,255,${alpha.toFixed(3)})`
        : s.hue === '#b8d4ff'
          ? `rgba(184,212,255,${alpha.toFixed(3)})`
          : `rgba(255,216,184,${alpha.toFixed(3)})`;
      sCtx.fill();

      // glow for larger stars
      if (s.r > 0.9) {
        const grd = sCtx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 4);
        grd.addColorStop(0, `rgba(160,210,255,${(alpha * 0.35).toFixed(3)})`);
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        sCtx.beginPath();
        sCtx.arc(s.x, s.y, s.r * 4, 0, Math.PI * 2);
        sCtx.fillStyle = grd;
        sCtx.fill();
      }

      // shooting stars
      if (s.shoot) {
        s.shootTimer -= dt;
        if (s.shootTimer <= 0 && !s.shootActive) {
          s.shootActive = true;
          s.shootX = s.x; s.shootY = s.y;
          s.shootTimer = Math.random() * 10000 + 6000;
        }
        if (s.shootActive) {
          s.shootX += 9; s.shootY += 3.5;
          const tail = 80;
          const grd2 = sCtx.createLinearGradient(s.shootX - tail, s.shootY - tail * 0.39, s.shootX, s.shootY);
          grd2.addColorStop(0, 'rgba(255,255,255,0)');
          grd2.addColorStop(1, 'rgba(200,230,255,0.9)');
          sCtx.beginPath();
          sCtx.moveTo(s.shootX - tail, s.shootY - tail * 0.39);
          sCtx.lineTo(s.shootX, s.shootY);
          sCtx.strokeStyle = grd2;
          sCtx.lineWidth = 1.5;
          sCtx.stroke();
          if (s.shootX > starCanvas.width + 50 || s.shootY > starCanvas.height + 50) {
            s.shootActive = false;
            s.shootX = Math.random() * starCanvas.width * 0.3;
            s.shootY = Math.random() * starCanvas.height * 0.4;
          }
        }
      }
    }
    _scifiStarRaf = requestAnimationFrame(drawStars);
  };
  _scifiStarRaf = requestAnimationFrame(drawStars);

  // Skip button (GM only)
  if (game.user?.isGM) {
    const skipBtn = document.createElement('button');
    skipBtn.className = 'scifi-skip-btn';
    skipBtn.innerHTML = `<i class="fa-solid fa-forward"></i> ${game.i18n.localize('DRAMADIRECTOR.intro.skip')}`;
    document.body.appendChild(skipBtn);
    setTimeout(() => skipBtn?.classList.add('scifi-on'), 1600);
    skipBtn.addEventListener('click', () => {
      scifiSkipFlag = true;
      game.socket?.emit(`module.${MODULE_ID}`, { action: 'scifiSkip' });
      scifiCleanup();
    });
  }

  const frameImg = overlay.querySelector('#scifi-frame-img');

  // ── Frame sequencer ────────────────────────────────────────────────────
  // Modes: 'intro' → 'transit' → 'loop'
  let frameMode    = 'intro';
  let introFrame   = 0;
  let transitFrame = TRANSIT_START;
  let loopFrame    = 0;
  const FPS      = 24;
  const FRAME_MS = 1000 / FPS;
  let lastFrameTs = 0;

  const runFrame = (ts) => {
    if (ts - lastFrameTs >= FRAME_MS) {
      lastFrameTs = ts;
      if (frameMode === 'intro') {
        frameImg.src = `${BASE}scifi${padNum(introFrame)}.webp`;
        introFrame++;
        // Once we reach the end of the intro, loop frames 91–106
        // until the text phase manually switches frameMode to 'transit'
        if (introFrame > INTRO_END) introFrame = INTRO_LOOP_START;
      } else if (frameMode === 'transit') {
        if (transitFrame <= TRANSIT_END) {
          frameImg.src = `${BASE}scifi${padNum(transitFrame)}.webp`;
          transitFrame++;
        } else {
          frameMode = 'loop'; // auto-switch to loop when transit done
        }
      } else {
        // loop
        frameImg.src = `${BASE}scifi${padNum(LOOP_START + loopFrame)}.webp`;
        loopFrame = (loopFrame + 1) % LOOP_LEN;
      }
    }
    _scifiFrameRaf = requestAnimationFrame(runFrame);
  };
  _scifiFrameRaf = requestAnimationFrame(runFrame);

  // ── Preload in background ──────────────────────────────────────────────
  const _preloaded = new Set();
  const preload = (n) => {
    const src = `${BASE}scifi${padNum(n)}.webp`;
    if (_preloaded.has(src)) return;
    _preloaded.add(src); new Image().src = src;
  };
  for (let i = 0; i <= 30; i++) preload(i);
  for (let i = TRANSIT_START; i <= TRANSIT_END; i++) preload(i);
  for (let i = LOOP_START; i < LOOP_START + 20; i++) preload(i);
  let _preloadIdx = 31;
  const preloadNext = setInterval(() => {
    for (let k = 0; k < 10; k++) {
      if (_preloadIdx <= LOOP_END) preload(_preloadIdx++);
      else { clearInterval(preloadNext); break; }
    }
  }, 180);

  // ── Fade in overlay ────────────────────────────────────────────────────
  await waitMs(30);
  overlay.style.opacity = '1';
  await waitMs(420); // fast fade — leave max time for text
  if (isSkip()) { clearInterval(preloadNext); scifiCleanup(); return; }

  // ── PHASE 1: Text layer (must complete within ~4.0s while intro frames play) ──
  // Budget: Line1 ~1.0s | Line2 ~2.1s | Line3 ~1.1s | fade 0.25s = 4.45s (tight but OK)
  const textLayer = document.createElement('div');
  textLayer.className = 'scifi-text-layer';
  ['top', 'bot'].forEach(cls => {
    const d = document.createElement('div');
    d.className = `scifi-text-decor ${cls}`;
    textLayer.appendChild(d);
  });
  overlay.appendChild(textLayer);

  // Line 1 — "MISSION RECEIVED" equivalent (17 chars RU @ 30ms = 510ms + 420ms hold = 930ms + 120ms fade = 1.05s)
  const line1 = document.createElement('div');
  line1.className = 'scifi-text-line';
  textLayer.appendChild(line1);
  await scifiTypeText(line1, game.i18n.localize('DRAMADIRECTOR.intro.scifiLine1'), 30, isSkip);
  if (isSkip()) { clearInterval(preloadNext); scifiCleanup(); return; }
  await waitSkippable(420, isSkip);
  if (isSkip()) { clearInterval(preloadNext); scifiCleanup(); return; }
  line1.style.transition = 'opacity 0.12s';
  line1.style.opacity = '0';
  await waitMs(130);
  line1.remove();

  // Line 2 — "CODENAME — «...»" (~25-35ch @ 28ms ≈ 750ms + 1350ms hold = 2.1s)
  const line2 = document.createElement('div');
  line2.className = 'scifi-text-line';
  textLayer.appendChild(line2);
  const text2 = game.i18n.format('DRAMADIRECTOR.intro.scifiLine2', { name: campaignTitle });
  await scifiTypeText(line2, text2, 28, isSkip);
  if (isSkip()) { clearInterval(preloadNext); scifiCleanup(); return; }
  await waitSkippable(1000, isSkip); // 1.0s hold
  if (isSkip()) { clearInterval(preloadNext); scifiCleanup(); return; }
  await waitSkippable(350, isSkip);  // 0.35s extra shown
  if (isSkip()) { clearInterval(preloadNext); scifiCleanup(); return; }

  // Line 3 — "MISSION ROSTER" equivalent (~14ch @ 25ms ≈ 350ms + 400ms hold = 750ms)
  const line3 = document.createElement('div');
  line3.className = 'scifi-text-line';
  textLayer.appendChild(line3);
  const text3 = game.i18n.localize('DRAMADIRECTOR.intro.scifiLine3');
  await scifiTypeText(line3, text3, 28, isSkip);
  if (isSkip()) { clearInterval(preloadNext); scifiCleanup(); return; }
  await waitSkippable(500, isSkip);
  if (isSkip()) { clearInterval(preloadNext); scifiCleanup(); return; }

  // Fade out text, simultaneously start transition frames
  textLayer.style.transition = 'opacity 0.25s';
  textLayer.style.opacity = '0';
  // Kick off transition sequence (107–115 ≈ 375ms @ 24fps)
  frameMode = 'transit';
  transitFrame = TRANSIT_START;
  await waitMs(260);
  textLayer.remove();

  // Wait for transit to finish playing (9 frames = ~375ms, we already waited 260ms)
  await waitMs(120);
  if (isSkip()) { clearInterval(preloadNext); scifiCleanup(); return; }

  // ── PHASE 2 now begins — frameMode is 'loop' (set automatically by transit) ──
  loopFrame = 0; // reset loop counter

  // ── PHASE 2: Character portraits ──────────────────────────────────────
  const players = [];
  for (const user of game.users.filter(u => u.active && !u.isGM)) {
    const ch = user.character;
    if (!ch) continue;
    let title = ch.getFlag?.(MODULE_ID, 'introTitle') || '';
    if (!title) {
      const cls = Object.values(ch.classes ?? {});
      title = cls.length
        ? cls.map(c => c.name).join(' / ')
        : (ch.system?.details?.race || ch.system?.details?.type?.value || '');
      if (title) title = title.charAt(0).toUpperCase() + title.slice(1);
    }
    players.push({
      playerName:    user.name,
      characterName: ch.name,
      portrait:      ch.img || user.avatar || 'icons/svg/mystery-man.svg',
      title,
    });
  }

  // If no players, show a placeholder so the sequence still runs
  if (!players.length) {
    await waitSkippable(2000, isSkip);
  }

  for (let i = 0; i < players.length; i++) {
    if (isSkip()) break;
    const p = players[i];

    // Build char section
    const charSection = document.createElement('div');
    charSection.className = 'scifi-char-section';
    charSection.style.opacity = '0';

    // Portrait
    const portraitWrap = document.createElement('div');
    portraitWrap.className = 'scifi-portrait-wrap';

    const pImg = document.createElement('img');
    pImg.className = 'scifi-portrait-img';
    pImg.src = p.portrait;
    pImg.onerror = () => { pImg.src = 'icons/svg/mystery-man.svg'; };

    const tint  = document.createElement('div'); tint.className = 'scifi-portrait-tint';
    const halo  = document.createElement('div'); halo.className = 'scifi-portrait-halo';
    const scan  = document.createElement('div'); scan.className = 'scifi-portrait-scan';

    portraitWrap.appendChild(pImg);
    portraitWrap.appendChild(tint);
    portraitWrap.appendChild(halo);
    portraitWrap.appendChild(scan);

    // Name block (right side, types in)
    const nameBlock = document.createElement('div');
    nameBlock.className = 'scifi-name-block';

    const charNameEl   = document.createElement('div'); charNameEl.className   = 'scifi-char-name';
    const playerNameEl = document.createElement('div'); playerNameEl.className = 'scifi-player-name';
    nameBlock.appendChild(charNameEl);
    nameBlock.appendChild(playerNameEl);

    charSection.appendChild(portraitWrap);
    charSection.appendChild(nameBlock);
    overlay.appendChild(charSection);

    // Glitch appear: fade section in, then start glitch anim
    charSection.style.transition = 'none';
    await waitMs(40);
    charSection.style.opacity = '1';

    // Trigger glitch animation on portrait
    pImg.classList.add('glitch-in');

    // Type char name within ~1 second total for both name+player
    const charText   = p.characterName.toUpperCase();
    const playerText = `// ${p.playerName.toUpperCase()}`;
    const totalLen   = charText.length + playerText.length;
    const msPerChar  = Math.max(25, Math.min(65, 900 / Math.max(totalLen, 1)));

    // Type char name
    const cursor1 = document.createElement('span'); cursor1.className = 'scifi-cursor';
    for (let c = 0; c <= charText.length; c++) {
      if (isSkip()) break;
      charNameEl.textContent = charText.slice(0, c);
      charNameEl.appendChild(cursor1);
      await waitMs(msPerChar);
    }
    cursor1.remove();
    if (isSkip()) { charSection.remove(); break; }

    // Type player name
    const cursor2 = document.createElement('span'); cursor2.className = 'scifi-cursor';
    for (let c = 0; c <= playerText.length; c++) {
      if (isSkip()) break;
      playerNameEl.textContent = playerText.slice(0, c);
      playerNameEl.appendChild(cursor2);
      await waitMs(msPerChar);
    }
    if (isSkip()) { charSection.remove(); break; }

    // Hold 3 seconds
    const skipped = await waitSkippable(3000, isSkip);

    // Fade out portrait section
    charSection.style.transition = 'opacity 0.4s ease-in';
    charSection.style.opacity = '0';
    await waitMs(430);
    charSection.remove();

    if (skipped || isSkip()) break;
    await waitMs(150);
  }

  if (isSkip()) { clearInterval(preloadNext); scifiCleanup(); return; }

  // ── PHASE 3: Outro text ───────────────────────────────────────────────
  const outroLayer = document.createElement('div');
  outroLayer.className = 'scifi-outro-layer';
  outroLayer.style.flexDirection = 'column';
  outroLayer.style.gap = 'clamp(14px,2.5vh,32px)';

  const outroTextEl = document.createElement('div');
  outroTextEl.className = 'scifi-outro-text';

  const outroSubEl = document.createElement('div');
  outroSubEl.className = 'scifi-outro-text';
  outroSubEl.style.fontSize = 'clamp(0.7rem, 1.4vw, 1.7rem)';
  outroSubEl.style.letterSpacing = '0.30em';
  outroSubEl.style.opacity = '0';
  outroSubEl.style.transition = 'opacity 0.5s';
  outroSubEl.style.textShadow = '0 0 12px rgba(0,200,255,0.7), 0 0 30px rgba(0,140,220,0.35)';

  outroLayer.appendChild(outroTextEl);
  outroLayer.appendChild(outroSubEl);
  overlay.appendChild(outroLayer);

  outroLayer.classList.add('scifi-on');

  // Type outro message (localised)
  const outroMsg = game.i18n.localize('DRAMADIRECTOR.intro.scifiOutro');
  const outroCursor = document.createElement('span'); outroCursor.className = 'scifi-cursor';
  for (let c = 0; c <= outroMsg.length; c++) {
    if (isSkip()) break;
    outroTextEl.textContent = outroMsg.slice(0, c);
    outroTextEl.appendChild(outroCursor);
    await waitMs(75);
  }
  outroCursor.remove();
  if (isSkip()) { clearInterval(preloadNext); scifiCleanup(); return; }

  // Brief pause, then show ГЛАВНОКОМАНДУЮЩИЙ beneath
  await waitSkippable(600, isSkip);
  if (isSkip()) { clearInterval(preloadNext); scifiCleanup(); return; }

  // Type commander subtitle (localised)
  const gmMsg = game.i18n.format('DRAMADIRECTOR.intro.scifiCommander', { name: gmName.toUpperCase() });
  outroSubEl.style.opacity = '1';
  const outroCursor2 = document.createElement('span'); outroCursor2.className = 'scifi-cursor';
  outroCursor2.style.width = '0.4em';
  for (let c = 0; c <= gmMsg.length; c++) {
    if (isSkip()) break;
    outroSubEl.textContent = gmMsg.slice(0, c);
    outroSubEl.appendChild(outroCursor2);
    await waitMs(30);
  }
  if (isSkip()) { clearInterval(preloadNext); scifiCleanup(); return; }

  await waitSkippable(2200, isSkip);

  // Final fade out — overlay + music
  overlay.style.transition = 'opacity 1.2s ease-out';
  overlay.style.opacity = '0';
  if (_scifiAudio) {
    const steps = 12;
    for (let i = 0; i < steps; i++) {
      await waitMs(100);
      if (_scifiAudio) _scifiAudio.volume = Math.max(0, _scifiAudio.volume - 0.85 / steps);
    }
  }
  await waitMs(200);

  clearInterval(preloadNext);
  scifiCleanup();
}

function scifiCleanup() {
  if (_scifiFrameRaf) { cancelAnimationFrame(_scifiFrameRaf); _scifiFrameRaf = null; }
  if (_scifiStarRaf)  { cancelAnimationFrame(_scifiStarRaf);  _scifiStarRaf  = null; }
  if (_scifiAudio)    { _scifiAudio.pause(); _scifiAudio = null; }
  document.querySelector('.scifi-overlay')?.remove();
  document.querySelector('.scifi-skip-btn')?.remove();
  scifiPlaying  = false;
  scifiSkipFlag = false;
}

export function skipSciFiIntro() {
  scifiSkipFlag = true;
  scifiCleanup();
}




// ═══════════════════════════════════════════════════════════════════════════
// DETECTIVE INTRO — Flashlight title → video dialogue → swinging lamp + chars
// ═══════════════════════════════════════════════════════════════════════════

injectStyles('dd-detective-styles', `
@font-face {
  font-family: 'Scare';
  src: url('modules/drama-director-cinematic/assets/fonts/scare.otf') format('opentype');
  font-weight: normal; font-style: normal;
}

.det-overlay {
  position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
  z-index: 10000; overflow: hidden; pointer-events: auto; background: #000;
}
.det-canvas {
  position: absolute; inset: 0; z-index: 3;
  width: 100%; height: 100%; pointer-events: none;
}
/* Video — only shown during dialogue phase */
.det-video {
  position: absolute; inset: 0; z-index: 1;
  width: 100%; height: 100%; object-fit: cover;
  opacity: 0; transition: opacity 0.7s ease-in;
}
.det-video.det-vis { opacity: 1; }

/* Subtitle bar */
.det-subtitle {
  position: absolute; bottom: clamp(28px,4vh,56px); left: 0; right: 0;
  z-index: 50; text-align: center; pointer-events: none;
}
.det-sub-line {
  display: inline-block;
  font-family: 'Courier New', monospace;
  font-size: clamp(1rem, 2.1vw, 1.9rem);
  color: #f0e8d0;
  background: rgba(0,0,0,0.65);
  padding: 6px 26px 7px;
  border-radius: 3px;
  letter-spacing: 0.04em;
  opacity: 0; transition: opacity 0.4s ease-out;
  white-space: pre-wrap; max-width: 84vw;
}
.det-sub-line.det-on { opacity: 1; }

/* Clipboard card */
.det-phase-wrap {
  position: absolute; inset: 0; z-index: 30;
  opacity: 0; transition: opacity 0.6s ease-out;
  pointer-events: none;
}
.det-phase-wrap.det-on { opacity: 1; }

/* ── Phase 1: talking video fullscreen ──────────────────────────────── */
.det-talking-video {
  position: absolute; inset: 0;
  width: 100%; height: 100%; object-fit: cover; z-index: 1;
}

/* ── Phases 2&3: split screen ──────────────────────────────────────── */
.det-split {
  position: absolute; inset: 0; display: flex;
}
.det-split-left {
  flex: 1; position: relative; overflow: hidden;
}
.det-split-right {
  flex: 1; position: relative; overflow: hidden;
}
.det-split-divider {
  width: 3px; background: rgba(180,140,80,.35); flex-shrink: 0; z-index: 2;
  box-shadow: 0 0 18px 4px rgba(0,0,0,.7);
}

/* Left panel: layered portrait-behind-image layout */

/* Container that maintains image aspect ratio */
.det-left-scene {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
}

/* Wrapper that keeps the image aspect ratio so % positions are accurate */
.det-scene-inner {
  position: relative;
  /* Image is portrait 1024x1536 = 2:3 ratio */
  /* Fill height, let width follow aspect */
  height: 100%;
  aspect-ratio: 1024 / 1536;
  max-width: 100%;
  animation: det-slow-zoom 4.5s ease-out forwards;
  transform-origin: center center;
  flex-shrink: 0;
}
@keyframes det-slow-zoom {
  from { transform: scale(1.0); }
  to   { transform: scale(1.13); }
}

/* Portrait sits BEHIND the foreground image, in the cutout area */
.det-portrait-layer {
  position: absolute;
  /* These % values match the cutout in the PNG at 1024×1536:
     top=525/1536=34.18%  left=360/1024=35.16%
     right=355/1024=34.67%  bottom=720/1536=46.88% from bottom */
  top:    34.18%;
  left:   35.16%;
  right:  34.67%;
  bottom: 46.88%;
  z-index: 1;
  overflow: hidden;
}
.det-portrait-layer img {
  width: 100%; height: 100%;
  object-fit: cover; object-position: top center;
  filter: grayscale(1) contrast(1.1) brightness(0.9);
}

/* Foreground PNG (with transparent cutout) sits on top of portrait */
.det-bg-img {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  object-fit: fill; /* exact fit — image defines the coordinate space */
  z-index: 2;
}

/* Name text overlaid at the portrait bottom, slight right tilt, max 300px */
.det-name-overlay {
  position: absolute;
  /* bottom of portrait area = 46.88% from bottom, shifted down 20px → 45.57% */
  bottom: 45.57%;
  /* center horizontally over the cutout, shifted 20px left */
  left:   calc(35.16% - 20px);
  right:  34.67%;
  z-index: 3;
  text-align: center;
  transform: rotate(10deg);
  transform-origin: center bottom;
  max-width: 30.18%; /* same as portrait width % = 309/1024 */
}
.det-name-char {
  font-family: 'Courier New', monospace;
  font-size: clamp(0.7rem, 1.35vw, 1.2rem);
  font-weight: bold;
  color: #1a1a1a;
  letter-spacing: 0.04em;
  line-height: 1.2;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.det-name-player {
  display: none;
}

/* ── Street fullscreen overlay layout ─────────────────────────── */
.det-street-scene {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
}
/* Wrapper keeps overlay aspect ratio 1536×1024 */
.det-street-inner {
  position: relative;
  width: 100%; height: 100%;
}
.det-street-video-el {
  position: absolute; inset: 0;
  width: 100%; height: 100%; object-fit: cover;
  z-index: 1;
}
/* Portrait sits between video and overlay */
.det-street-portrait {
  position: absolute;
  /* dec_street_overlay.png 1536×1024:
     top=290/1024=28.32%  bottom(frm)=480/1024=46.875%
     left=857/1536=55.794%  right(frm)=395/1536=25.716% */
  top:    28.32%;
  bottom: 46.875%;
  left:   55.794%;
  right:  25.716%;
  z-index: 2;
  overflow: hidden;
}
.det-street-portrait img {
  width: 100%; height: 100%;
  object-fit: cover; object-position: top center;
  filter: grayscale(1) contrast(1.1) brightness(0.9);
}
/* Overlay PNG on top */
.det-street-overlay-img {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  object-fit: fill;
  z-index: 3;
  pointer-events: none;
}
/* Name text over overlay */
.det-street-name {
  position: absolute;
  bottom: 42.480%;   /* (440-5)/1024 */
  left:   calc(56.445% - 220px);  /* shifted 220px left */
  right:  25.065%;   /* (395-10)/1536 */
  z-index: 4;
  text-align: center;
  transform: translateY(20px) rotate(10deg);
  transform-origin: center bottom;
}
.det-street-name .det-name-char {
  font-size: clamp(1.4rem, 2.7vw, 2.4rem);
}

/* Right panel: video */
.det-right-video {
  position: absolute; inset: 0;
  width: 100%; height: 100%; object-fit: cover;
}

/* ── Phase 4: street video fullscreen ──────────────────────────────── */
.det-street-video {
  position: absolute; inset: 0;
  width: 100%; height: 100%; object-fit: cover; z-index: 1;
}

/* Phase subtitle style – for phases 1 and continuation */
.det-sub-line-white {
  display: inline-block;
  font-family: 'Courier New', monospace;
  font-size: clamp(0.9rem, 2vw, 1.6rem);
  color: #fff;
  background: rgba(0,0,0,0.55);
  padding: 6px 26px 7px;
  border-radius: 3px;
  letter-spacing: 0.04em;
  opacity: 0; transition: opacity 0.4s ease-out;
  white-space: pre-wrap; max-width: 84vw;
}
.det-sub-line-white.det-on { opacity: 1; }

/* Skip */
.det-skip-btn {
  position: fixed; bottom: 22px; right: 22px; z-index: 10020;
  display: flex; align-items: center; gap: 7px;
  padding: 8px 18px; background: rgba(10,8,5,0.90);
  border: 1px solid rgba(200,168,100,0.35); border-radius: 2px;
  color: #9a8850; font-family: serif; font-size: 11px; font-style: italic;
  letter-spacing: 2px; text-transform: uppercase;
  cursor: pointer; opacity: 0; transform: translateY(12px);
  transition: opacity 0.35s, transform 0.35s; pointer-events: auto;
}
.det-skip-btn.det-on { opacity: 1; transform: translateY(0); }
.det-skip-btn:hover  { border-color: #c8a060; color: #c8a060; }
`);

let detPlaying  = false;
let detSkipFlag = false;
let _detRaf     = null;
let _detAudio   = null;
let _lampRaf    = null;

function detWait(ms) { return new Promise(r => setTimeout(r, ms)); }
function detWaitSkip(ms, isSkip) {
  return new Promise(resolve => {
    const step = 50; let elapsed = 0;
    const tick = () => {
      if (isSkip()) { resolve(true); return; }
      elapsed += step;
      if (elapsed >= ms) { resolve(false); return; }
      setTimeout(tick, step);
    };
    setTimeout(tick, step);
  });
}
function detTypeText(el, text, msPerChar, isSkip) {
  return new Promise(resolve => {
    let i = 0;
    const next = async () => {
      if (isSkip() || i > text.length) { resolve(); return; }
      el.textContent = text.slice(0, i++);
      setTimeout(next, msPerChar);
    };
    next();
  });
}
async function detShowSubtitle(container, text, holdMs, isSkip, italic = false) {
  const line = document.createElement('div');
  line.className = 'det-sub-line';
  if (italic) line.style.fontStyle = 'italic';
  container.appendChild(line);
  line.classList.add('det-on');
  const mspc = Math.max(22, Math.min(55, 1200 / Math.max(text.length, 1)));
  await detTypeText(line, text, mspc, isSkip);
  if (!isSkip()) await detWaitSkip(holdMs, isSkip);
  line.style.transition = 'opacity 0.4s ease-in';
  line.style.opacity = '0';
  await detWait(420);
  line.remove();
}

// ── Swinging lamp renderer ─────────────────────────────────────────────────
function startSwingingLamp(ctx, W, H, isSkip) {
  // Lamp physics: pendulum
  let angle      = 0.35;   // starting angle (radians from vertical)
  let angVel     = 0;
  const GRAVITY  = 0.0018; // pendulum constant (tuned for ~1.8s period)
  const DAMPING  = 0.9985; // very slow decay
  const ROPE_LEN = () => H() * 0.28; // pivot → bulb centre

  // Flicker
  let lampFlick = 1.0, lampFlickTimer = 0, lampFlickActive = false;
  let lampFlickDur = 0, lampFlickEl = 0, lampFlickTarget = 1.0;
  const schedLampFlick = () => { lampFlickTimer = 900 + Math.random() * 2800; };
  schedLampFlick();

  let lastTs = null;

  const drawLamp = (ts) => {
    if (lastTs === null) lastTs = ts;
    const dt = Math.min(ts - lastTs, 60);
    lastTs = ts;

    // Pendulum step
    angVel += -GRAVITY * Math.sin(angle);
    angVel *= DAMPING;
    angle  += angVel;

    // Lamp flicker update
    if (!lampFlickActive) {
      lampFlickTimer -= dt;
      if (lampFlickTimer <= 0) {
        lampFlickActive = true;
        lampFlickDur    = 40 + Math.random() * 160;
        lampFlickEl     = 0;
        lampFlickTarget = 0.10 + Math.random() * 0.45;
      }
    } else {
      lampFlickEl += dt;
      const p = lampFlickEl / lampFlickDur;
      lampFlick = p < 0.5
        ? 1.0 - (1.0 - lampFlickTarget) * (p / 0.5)
        : lampFlickTarget + (1.0 - lampFlickTarget) * ((p - 0.5) / 0.5);
      if (lampFlickEl >= lampFlickDur) { lampFlick = 1.0; lampFlickActive = false; schedLampFlick(); }
    }

    const cw = W(), ch = H();
    const pivotX = cw * 0.5;
    const pivotY = 0;           // pivot at top-center of screen
    const ropeL  = ROPE_LEN();
    const bulbX  = pivotX + Math.sin(angle) * ropeL;
    const bulbY  = pivotY + Math.cos(angle) * ropeL;

    // ── Draw ──────────────────────────────────────────────────────────
    ctx.clearRect(0, 0, cw, ch);

    // 1) Full black base
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, ch);

    const ea = lampFlick;

    // 2) Light cone — fan from bulb down to floor
    const coneHalfAngle = Math.PI / 4.5; // ~40° half-angle
    const coneLen = ch - bulbY + 40;
    const coneL = { x: bulbX + Math.cos(Math.PI/2 + coneHalfAngle + angle) * coneLen,
                    y: bulbY + Math.sin(Math.PI/2 + coneHalfAngle + angle) * coneLen };
    const coneR = { x: bulbX + Math.cos(Math.PI/2 - coneHalfAngle + angle) * coneLen,
                    y: bulbY + Math.sin(Math.PI/2 - coneHalfAngle + angle) * coneLen };

    // Cone gradient: bright at bulb → dim at floor
    const coneGrad = ctx.createRadialGradient(bulbX, bulbY, 0, bulbX, bulbY, coneLen);
    coneGrad.addColorStop(0,    `rgba(255,255,235,${(ea * 0.90).toFixed(3)})`);
    coneGrad.addColorStop(0.18, `rgba(255,252,215,${(ea * 0.65).toFixed(3)})`);
    coneGrad.addColorStop(0.45, `rgba(245,235,180,${(ea * 0.32).toFixed(3)})`);
    coneGrad.addColorStop(0.75, `rgba(220,200,130,${(ea * 0.10).toFixed(3)})`);
    coneGrad.addColorStop(1.0,  'rgba(0,0,0,0)');

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(bulbX, bulbY);
    ctx.lineTo(coneL.x, coneL.y);
    ctx.lineTo(coneR.x, coneR.y);
    ctx.closePath();
    ctx.fillStyle = coneGrad;
    ctx.fill();
    ctx.restore();

    // 3) Ambient glow around bulb
    const glowR = cw * 0.12;
    const glowGrad = ctx.createRadialGradient(bulbX, bulbY, 0, bulbX, bulbY, glowR);
    glowGrad.addColorStop(0,   `rgba(255,255,220,${(ea * 0.95).toFixed(3)})`);
    glowGrad.addColorStop(0.2, `rgba(255,248,200,${(ea * 0.60).toFixed(3)})`);
    glowGrad.addColorStop(0.5, `rgba(240,220,150,${(ea * 0.22).toFixed(3)})`);
    glowGrad.addColorStop(1.0, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.fillStyle = glowGrad;
    ctx.beginPath();
    ctx.arc(bulbX, bulbY, glowR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 4) Rope — thin line from pivot to lamp top
    ctx.save();
    ctx.strokeStyle = `rgba(180,160,110,${(ea * 0.85).toFixed(3)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pivotX, pivotY);
    ctx.lineTo(bulbX, bulbY - 14);
    ctx.stroke();
    ctx.restore();

    // 5) Lamp housing (metal shade) — trapezoidal shape above bulb
    const shadeW = 38, shadeH = 22;
    ctx.save();
    ctx.translate(bulbX, bulbY);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(-shadeW, -shadeH);
    ctx.lineTo( shadeW, -shadeH);
    ctx.lineTo( shadeW * 0.55, 0);
    ctx.lineTo(-shadeW * 0.55, 0);
    ctx.closePath();
    const shadeGrad = ctx.createLinearGradient(0, -shadeH, 0, 0);
    shadeGrad.addColorStop(0, '#555');
    shadeGrad.addColorStop(1, '#2a2a2a');
    ctx.fillStyle = shadeGrad;
    ctx.fill();
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 1;
    ctx.stroke();
    // Thin bottom rim of shade — glowing edge
    ctx.beginPath();
    ctx.moveTo(-shadeW * 0.55, 0);
    ctx.lineTo( shadeW * 0.55, 0);
    ctx.strokeStyle = `rgba(255,245,200,${(ea * 0.7).toFixed(3)})`;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // 6) Bulb — small glowing circle
    ctx.save();
    ctx.beginPath();
    ctx.arc(bulbX, bulbY, 9, 0, Math.PI * 2);
    const bulbGrad = ctx.createRadialGradient(bulbX, bulbY - 2, 0, bulbX, bulbY, 9);
    bulbGrad.addColorStop(0,   `rgba(255,255,240,${ea.toFixed(3)})`);
    bulbGrad.addColorStop(0.6, `rgba(255,240,180,${(ea * 0.85).toFixed(3)})`);
    bulbGrad.addColorStop(1,   `rgba(200,160,80,${(ea * 0.5).toFixed(3)})`);
    ctx.fillStyle = bulbGrad;
    ctx.fill();
    ctx.restore();

    // 7) Darkness overlay on edges (vignette)
    const vig = ctx.createRadialGradient(cw*0.5, ch*0.4, ch*0.15, cw*0.5, ch*0.4, ch*0.85);
    vig.addColorStop(0,   'rgba(0,0,0,0)');
    vig.addColorStop(0.6, 'rgba(0,0,0,0.25)');
    vig.addColorStop(1.0, 'rgba(0,0,0,0.88)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, cw, ch);

    _lampRaf = requestAnimationFrame(drawLamp);
  };

  _lampRaf = requestAnimationFrame(drawLamp);
}

export async function executeDetectiveIntro(campaignName = '', gmName = '') {
  if (detPlaying) return;
  detPlaying  = true;
  detSkipFlag = false;
  const isSkip = () => detSkipFlag;

  const title = (campaignName?.trim() || game.i18n.localize('DRAMADIRECTOR.intro.defaultCampaign'));
  if (!gmName) {
    const gm = game.users.find(u => u.isGM && u.active) || game.users.find(u => u.isGM);
    gmName = gm?.name || game.i18n.localize('DRAMADIRECTOR.intro.gmDefault');
  }

  // ── Resolve players list ───────────────────────────────────────────────
  const players = [];
  for (const user of game.users.filter(u => u.active && !u.isGM)) {
    const ch = user.character;
    if (!ch) continue;
    players.push({ characterName: ch.name || user.name, playerName: user.name, portrait: ch.img || user.avatar || 'icons/svg/mystery-man.svg' });
  }
  if (!players.length) {
    for (const t of (canvas?.tokens?.placeables ?? []).filter(t => t.actor && !t.document.hidden).slice(0, 6)) {
      players.push({ characterName: t.actor.name, playerName: '', portrait: t.actor.img || 'icons/svg/mystery-man.svg' });
    }
  }

  // ── Preload all detective assets in parallel before showing anything ───
  const M_PRE = `modules/${MODULE_ID}`;
  await _ddPreload([
    { type: 'audio',  url: `${M_PRE}/assets/sounds/detective.ogg` },
    { type: 'video',  url: `${M_PRE}/assets/detective/talking.mp4` },
    { type: 'video',  url: `${M_PRE}/assets/detective/decclipboard.mp4` },
    { type: 'video',  url: `${M_PRE}/assets/detective/decbook.mp4` },
    { type: 'video',  url: `${M_PRE}/assets/detective/dec_street.mp4` },
    { type: 'image',  url: `${M_PRE}/assets/detective/clipboard.png` },
    { type: 'image',  url: `${M_PRE}/assets/detective/wall.png` },
    { type: 'image',  url: `${M_PRE}/assets/detective/dec_street_overlay.png` },
    ...players.map(p => ({ type: 'image', url: p.portrait })),
  ], 12000); // allow up to 12s — videos are large

  // ── Overlay ────────────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.className = 'det-overlay';
  overlay.style.opacity = '0';
  overlay.style.transition = 'opacity 0.5s ease-in';
  overlay.innerHTML = `
    <canvas class="det-canvas" id="det-canvas"></canvas>
    <div class="det-grain"></div>
  `;
  document.body.appendChild(overlay);

  const canvasEl = overlay.querySelector('#det-canvas');
  const resize   = () => { canvasEl.width = window.innerWidth; canvasEl.height = window.innerHeight; };
  resize();
  window.addEventListener('resize', resize);
  const ctx = canvasEl.getContext('2d');
  const W = () => canvasEl.width;
  const H = () => canvasEl.height;

  await document.fonts.load(`80px Scare`).catch(() => {});

  // ── Skip button ────────────────────────────────────────────────────────
  if (game.user?.isGM) {
    const skipBtn = document.createElement('button');
    skipBtn.className = 'det-skip-btn';
    skipBtn.innerHTML = `<i class="fa-solid fa-forward"></i> ${game.i18n.localize('DRAMADIRECTOR.intro.skip')}`;
    document.body.appendChild(skipBtn);
    setTimeout(() => skipBtn?.classList.add('det-on'), 1800);
    skipBtn.addEventListener('click', () => {
      detSkipFlag = true;
      game.socket?.emit(`module.${MODULE_ID}`, { action: 'detSkip' });
      detCleanup();
    });
  }

  // ── Phase 0: Flashlight + Campaign title ──────────────────────────────
  const makeOsc  = (f, a) => ({ freq: f, amp: a, phase: Math.random() * Math.PI * 2 });
  const driftX   = [makeOsc(0.20,0.028), makeOsc(0.33,0.015), makeOsc(0.09,0.035)];
  const driftY   = [makeOsc(0.24,0.018), makeOsc(0.14,0.024), makeOsc(0.41,0.013)];
  const jitterX  = [makeOsc(1.9,0.0045), makeOsc(3.1,0.0022), makeOsc(4.7,0.0012)];
  const jitterY  = [makeOsc(2.2,0.0038), makeOsc(3.8,0.0018), makeOsc(5.3,0.0012)];
  const evalOsc  = (oscs, t) => oscs.reduce((s, o) => s + Math.sin(t * o.freq + o.phase) * o.amp, 0);
  const glowR    = () => Math.min(W(), H()) * 0.50;

  let flickAlpha = 1.0, flickTimer = 0, flickActive = false;
  let flickDur = 0, flickEl = 0, flickTarget = 1.0;
  const schedFlick = () => { flickTimer = 1600 + Math.random() * 3800; };
  schedFlick();

  const T_APPROACH = 2000, T_SWEEP = 4200, T_TEXTFADE = 1200;
  const FPH = { APPROACH:0, SWEEP:1, TEXTFADE:2 };
  let fphase = FPH.APPROACH, fphStart = null;
  let lightAlpha = 0, textAlpha = 1.0;
  let fLastTs = null, flashDone = false;

  const drawFlash = (ts) => {
    if (flashDone) return;
    if (fLastTs === null) fLastTs = ts;
    const dt = Math.min(ts - fLastTs, 60);
    fLastTs = ts;
    if (fphStart === null) fphStart = ts;
    const elapsed = ts - fphStart;
    const tSec = ts / 1000;
    if (!flickActive) {
      flickTimer -= dt;
      if (flickTimer <= 0) { flickActive=true; flickDur=55+Math.random()*180; flickEl=0; flickTarget=0.12+Math.random()*0.40; }
    } else {
      flickEl += dt;
      const p = flickEl / flickDur;
      flickAlpha = p<0.5 ? 1-(1-flickTarget)*(p/0.5) : flickTarget+(1-flickTarget)*((p-0.5)/0.5);
      if (flickEl >= flickDur) { flickAlpha=1.0; flickActive=false; schedFlick(); }
    }
    const cx = W()*0.5, cy = H()*0.5;
    let lx, ly;
    const tLeft = cx - W()*0.38, tRight = cx + W()*0.38;
    if (fphase === FPH.APPROACH) {
      const t = Math.min(elapsed/T_APPROACH,1);
      const e = t<0.5?2*t*t:1-Math.pow(-2*t+2,2)/2;
      lx = W()*0.04 + (tLeft-W()*0.18-W()*0.04)*e;
      ly = H()*0.75 + (cy-H()*0.75)*e;
      lightAlpha = Math.min(elapsed/700,1);
      lx += evalOsc(driftX,tSec)*W()+evalOsc(jitterX,tSec)*W();
      ly += evalOsc(driftY,tSec)*H()+evalOsc(jitterY,tSec)*H();
      if (t>=1){ fphase=FPH.SWEEP; fphStart=ts; }
    } else if (fphase === FPH.SWEEP) {
      const t = Math.min(elapsed/T_SWEEP,1);
      const e = t<0.08?t/0.08*0.08:t>0.92?0.92+(t-0.92)/0.08*0.08:t;
      lx = (tLeft-W()*0.18)+(tRight+W()*0.18-(tLeft-W()*0.18))*e;
      ly = cy; lightAlpha = 1;
      lx += evalOsc(driftX,tSec)*W()+evalOsc(jitterX,tSec)*W();
      ly += evalOsc(driftY,tSec)*H()+evalOsc(jitterY,tSec)*H();
      if (t>=1){ fphase=FPH.TEXTFADE; fphStart=ts; }
    } else if (fphase === FPH.TEXTFADE) {
      const t = Math.min(elapsed/T_TEXTFADE,1);
      lightAlpha = 1-t*t*t; textAlpha = 1-t*t;
      lx = tRight+W()*0.1+evalOsc(driftX,tSec)*W()*(1-t)+evalOsc(jitterX,tSec)*W();
      ly = cy+evalOsc(driftY,tSec)*H()*(1-t)+evalOsc(jitterY,tSec)*H();
      if (t>=1){ flashDone=true; return; }
    }
    ctx.fillStyle = '#000'; ctx.fillRect(0,0,W(),H());
    if (lightAlpha > 0.001) {
      const ea = lightAlpha*flickAlpha, R = glowR();
      const g = ctx.createRadialGradient(lx,ly,0,lx,ly,R);
      g.addColorStop(0,   `rgba(255,255,252,${ea.toFixed(3)})`);
      g.addColorStop(0.10,`rgba(255,255,248,${(ea*.98).toFixed(3)})`);
      g.addColorStop(0.28,`rgba(252,248,232,${(ea*.82).toFixed(3)})`);
      g.addColorStop(0.50,`rgba(242,228,195,${(ea*.46).toFixed(3)})`);
      g.addColorStop(0.72,`rgba(215,195,150,${(ea*.18).toFixed(3)})`);
      g.addColorStop(0.88,`rgba(150,130,85,${(ea*.05).toFixed(3)})`);
      g.addColorStop(1.0, 'rgba(0,0,0,0)');
      ctx.fillStyle=g; ctx.fillRect(0,0,W(),H());
      const d = ctx.createRadialGradient(lx,ly,0,lx,ly,R);
      d.addColorStop(0,   'rgba(0,0,0,0)');
      d.addColorStop(0.22,'rgba(0,0,0,0)');
      d.addColorStop(0.50,`rgba(0,0,0,${(ea*.60).toFixed(3)})`);
      d.addColorStop(0.72,`rgba(0,0,0,${(ea*.88).toFixed(3)})`);
      d.addColorStop(0.88,`rgba(0,0,0,${(ea*.97).toFixed(3)})`);
      d.addColorStop(1.0, 'rgba(0,0,0,1)');
      ctx.fillStyle=d; ctx.fillRect(0,0,W(),H());
    }
    if (textAlpha > 0.01) {
      const fs = Math.min(W()*0.085, H()*0.17, 150);
      ctx.save(); ctx.globalAlpha = textAlpha;
      ctx.font = `normal ${fs}px Scare, 'Palatino Linotype', serif`;
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillStyle='#000'; ctx.fillText(title, W()*0.5, H()*0.5);
      ctx.restore();
    }
    _detRaf = requestAnimationFrame(drawFlash);
  };

  await detWait(30);
  overlay.style.opacity = '1';

  // ── Start background audio immediately with flashlight ─────────────────
  _detAudio = new Audio(`modules/${MODULE_ID}/assets/sounds/detective.ogg`);
  _detAudio.volume = 0.0;
  _detAudio.loop   = true;
  _detAudio.play().catch(() => {});
  (async () => {
    const steps = 20, target = 0.75;
    for (let i = 0; i < steps; i++) {
      await detWait(75);
      if (_detAudio) _detAudio.volume = Math.min(target, _detAudio.volume + target / steps);
    }
  })();

  await detWait(60);
  _detRaf = requestAnimationFrame(drawFlash);
  await new Promise(resolve => {
    const check = setInterval(() => {
      if (flashDone || isSkip()) { clearInterval(check); resolve(); }
    }, 80);
  });
  if (isSkip()) { detCleanup(); return; }
  if (_detRaf) { cancelAnimationFrame(_detRaf); _detRaf = null; }

  // Black pause
  ctx.fillStyle='#000'; ctx.fillRect(0,0,W(),H());
  await detWaitSkip(300, isSkip);
  if (isSkip()) { detCleanup(); return; }

  // ── Helper: show a phase wrapper with optional fade-out ────────────────
  const M = `modules/${MODULE_ID}`;
  const showPhase = (html) => {
    const w = document.createElement('div');
    w.className = 'det-phase-wrap';
    w.innerHTML = html;
    overlay.appendChild(w);
    requestAnimationFrame(() => requestAnimationFrame(() => w.classList.add('det-on')));
    return w;
  };
  const fadePhase = async (w) => {
    w.style.transition = 'opacity 0.6s ease-in';
    w.style.opacity = '0';
    // Pause any videos inside
    w.querySelectorAll('video').forEach(v => v.pause());
    await detWait(650);
    w.remove();
  };

  // ── Subtitle helper for white-on-dark style ────────────────────────────
  const subBox = document.createElement('div');
  subBox.className = 'det-subtitle';
  overlay.appendChild(subBox);

  const showSubtitleWhite = async (text, holdMs) => {
    const line = document.createElement('div');
    line.className = 'det-sub-line-white';
    subBox.appendChild(line);
    line.classList.add('det-on');
    const mspc = Math.max(22, Math.min(50, 1100 / Math.max(text.length, 1)));
    await detTypeText(line, text, mspc, isSkip);
    if (!isSkip()) await detWaitSkip(holdMs, isSkip);
    line.style.transition = 'opacity 0.4s ease-in';
    line.style.opacity = '0';
    await detWait(420);
    line.remove();
  };

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 1 — talking.mp4 fullscreen + subtitle
  // ═══════════════════════════════════════════════════════════════════════
  if (!isSkip()) {
    canvasEl.style.transition = 'opacity 0.5s';
    canvasEl.style.opacity = '0';

    const p1 = showPhase(`
      <video class="det-talking-video" src="${M}/assets/detective/talking.mp4"
        playsinline preload="auto" autoplay></video>
    `);
    p1.querySelector('video').play().catch(() => {});

    // Subtitle: white text on subtle dark bg
    await detWaitSkip(500, isSkip);
    if (!isSkip()) {
      await showSubtitleWhite(game.i18n.localize('DRAMADIRECTOR.intro.detectiveLine1'), 2200);
    }
    await detWaitSkip(400, isSkip);
    await fadePhase(p1);
  }
  if (isSkip()) { detCleanup(); return; }

  // Brief black
  await detWaitSkip(200, isSkip);
  if (isSkip()) { detCleanup(); return; }

  // ═══════════════════════════════════════════════════════════════════════
  // PHASES 2 & 3 — per-player split screens, cycling videos
  // Cycle: clipboard → wall → clipboard → wall…
  // Phase 4 (3rd+ player) uses street video, fullscreen, with polaroid overlay
  // ═══════════════════════════════════════════════════════════════════════
  const bgAssets = [
    // clipboard.png 1024×1536 — portrait: top=34.18% bottom=46.88% left=35.16% right=34.67%
    {
      img: `${M}/assets/detective/clipboard.png`,
      video: `${M}/assets/detective/decclipboard.mp4`,
      fullscreen: false,
      portraitStyle: '',
      nameStyle: '',
    },
    // wall.png 1024×1536 — portrait: top=31.25% bottom=53.19% left=38.672% right=37.598%
    {
      img: `${M}/assets/detective/wall.png`,
      video: `${M}/assets/detective/decbook.mp4`,
      fullscreen: false,
      portraitStyle: 'top:31.25%;bottom:53.19%;left:38.672%;right:37.598%;',
      nameStyle: 'bottom:51.432%;left:38.672%;right:37.598%;max-width:20.996%;transform:rotate(10deg);transform-origin:center bottom;',
    },
    // Street: fullscreen video with portrait overlay
    {
      video: `${M}/assets/detective/dec_street.mp4`,
      fullscreen: true,
    },
  ];
  // Cycles through clipboard → wall → street → clipboard → wall → street…

  for (let pi = 0; pi < players.length; pi++) {
    if (isSkip()) break;
    const p = players[pi];

    // Cycle through all 3 asset types in order
    const asset = bgAssets[pi % bgAssets.length];

    let phaseHtml;
    if (asset.fullscreen) {
      // Street: video + portrait layer + PNG overlay on top
      phaseHtml = `
        <div class="det-street-scene">
          <div class="det-street-inner">
            <video class="det-street-video-el" src="${asset.video}"
              playsinline preload="auto" loop></video>
            <div class="det-street-portrait">
              <img src="${p.portrait}" onerror="this.src='icons/svg/mystery-man.svg'" loading="eager">
            </div>
            <img class="det-street-overlay-img"
              src="${M}/assets/detective/dec_street_overlay.png" alt="">
            <div class="det-street-name">
              <div class="det-name-char">${p.characterName}</div>
              <div class="det-name-player">${p.playerName || ''}</div>
            </div>
          </div>
        </div>`;
    } else {
      // Split: left = portrait BEHIND image (using layered layout), right = video
      const nameHtml = `
        <div class="det-name-overlay" style="${asset.nameStyle ?? ''}">
          <div class="det-name-char">${p.characterName}</div>
          <div class="det-name-player">${p.playerName || ''}</div>
        </div>`;
      phaseHtml = `
        <div class="det-split">
          <div class="det-split-left">
            <div class="det-left-scene">
              <div class="det-scene-inner">
                <div class="det-portrait-layer" style="${asset.portraitStyle ?? ''}">
                  <img src="${p.portrait}" onerror="this.src='icons/svg/mystery-man.svg'" loading="eager">
                </div>
                <img class="det-bg-img" src="${asset.img}" alt="">
                ${nameHtml}
              </div>
            </div>
          </div>
          <div class="det-split-divider"></div>
          <div class="det-split-right">
            <video class="det-right-video" src="${asset.video}"
              playsinline preload="auto" loop></video>
          </div>
        </div>`;
    }

    const pw = showPhase(phaseHtml);
    pw.querySelectorAll('video').forEach(v => v.play().catch(() => {}));
    await detWaitSkip(4000, isSkip);
    await fadePhase(pw);
    if (!isSkip()) await detWaitSkip(150, isSkip);
  }
  if (isSkip()) { detCleanup(); return; }

  // ── GM outro subtitle ──────────────────────────────────────────────────
  await detWaitSkip(300, isSkip);
  if (!isSkip()) {
    await showSubtitleWhite(game.i18n.format('DRAMADIRECTOR.intro.detectiveLine2', { name: gmName }), 3000);
  }
  await detWaitSkip(400, isSkip);
  if (isSkip()) { detCleanup(); return; }

  // ── Fade out ───────────────────────────────────────────────────────────
  // Fade audio
  if (_detAudio) {
    const steps = 12;
    for (let i = 0; i < steps; i++) {
      await detWait(80);
      if (_detAudio) _detAudio.volume = Math.max(0, _detAudio.volume - 0.75 / steps);
    }
  }
  overlay.style.transition = 'opacity 1.2s ease-out';
  overlay.style.opacity = '0';
  await detWait(1250);
  detCleanup();
}

export function skipDetectiveIntro() {
  detSkipFlag = true;
  detCleanup();
}

function detCleanup() {
  if (_detRaf)  { cancelAnimationFrame(_detRaf);  _detRaf  = null; }
  if (_lampRaf) { cancelAnimationFrame(_lampRaf); _lampRaf = null; }
  if (_detAudio){ _detAudio.pause(); _detAudio.src = ''; _detAudio = null; }
  document.querySelectorAll('.det-overlay').forEach(el => el.remove());
  document.querySelectorAll('.det-skip-btn').forEach(el => el.remove());
  detPlaying  = false;
  detSkipFlag = false;
}
