// The title screen: shown every time the game starts. Logo and main menu on
// the left over a live view of the Dustline, the player's raider card and
// field bulletin on the right.

import { ITEMS, RARITY } from './config.js';
import { loadoutValue } from './inventory.js';
import * as Audio from './audio.js';

export const VERSION = '0.4';

// Newest first. Shown in the Field Bulletin.
const BULLETIN = [
  { tag: 'New', title: 'Title screen', body: 'The game now opens here instead of dropping you straight into your loadout.' },
  { tag: 'Change', title: 'Husks renamed', body: 'Skitter, Buzzer, Watcher, Pouncer and Warden. The exploding Pop is gone.' },
  { tag: 'New', title: 'Play on your phone', body: 'Touch controls, a phone layout and Low graphics for mobile. Turn the phone sideways.' },
];

const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

export function renderHome(ui) {
  const g = ui.game;
  const p = g.profile;
  const s = p.stats;
  const lo = p.loadout;
  const need = g.xpForLevel(p.level);
  const rate = s.raids ? Math.round((s.extracts / s.raids) * 100) : 0;
  const gear = [...lo.weapons, lo.shield].filter(Boolean)
    .map((st) => `<span class="gear" style="--rarity:${RARITY[ITEMS[st.id].rarity].color}">${ITEMS[st.id].name}</span>`)
    .join('') || '<span class="muted">Nothing equipped. Grab the free kit in the Burrow.</span>';
  const isNew = s.raids === 0;

  const home = el('div', 'home');
  home.innerHTML = `
    <div class="home-shade"></div>
    <section class="home-main">
      <div class="home-logo">SCRAP<span>FALL</span></div>
      <p class="home-tag">Scavenge the Dustline. Outlast the Husks. Get out alive.</p>
      <nav class="home-menu" aria-label="Main menu">
        <button class="hm primary" data-a="play"><span>${isNew ? 'Start' : 'Play'}</span><small>${isNew ? 'Your first raid starts in the Burrow' : 'Back to the Burrow'}</small></button>
        <button class="hm" data-a="how"><span>How to Play</span></button>
        <button class="hm" data-a="settings"><span>Settings</span></button>
        <button class="hm" data-a="credits"><span>Credits</span></button>
      </nav>
    </section>
    <aside class="home-side">
      <div class="home-card">
        <div class="hc-head"><span class="hc-label">RAIDER</span><span class="hc-level">LVL ${p.level}</span></div>
        <div class="hc-xp"><div style="width:${Math.min(100, (p.xp / need) * 100)}%"></div></div>
        <div class="hc-xp-text">${p.xp} / ${need} XP to level ${p.level + 1}</div>
        <div class="hc-stats">
          <div><b>⌬ ${p.credits.toLocaleString()}</b><span>Credits</span></div>
          <div><b>${s.raids}</b><span>Raids</span></div>
          <div><b>${rate}%</b><span>Survived</span></div>
          <div><b>${s.kills}</b><span>Husks</span></div>
        </div>
        <div class="hc-label">LOADOUT · ⌬ ${loadoutValue(lo).toLocaleString()}</div>
        <div class="hc-gear">${gear}</div>
      </div>
      <div class="home-card bulletin">
        <div class="hc-label">FIELD BULLETIN</div>
        ${BULLETIN.map((b) => `<div class="news"><span class="news-tag">${b.tag}</span><b>${b.title}</b><p>${b.body}</p></div>`).join('')}
      </div>
    </aside>
    <footer class="home-foot">
      <span>v${VERSION}</span>
      <span>${g.input.touch ? 'Progress saves on this device' : 'Press Enter to play · progress saves in this browser'}</span>
    </footer>`;

  const actions = {
    play: () => ui.leaveHome(),
    how: () => openModal(ui, 'HOW TO PLAY', ui.guideHtml()),
    settings: () => {
      const m = openModal(ui, 'SETTINGS', '');
      m.querySelector('.modal-body').appendChild(ui.settingsBlock(false));
    },
    credits: () => openModal(ui, 'CREDITS', `
      <div class="guide">
        <p><b>Scrapfall</b> is a third-person extraction shooter, built in the browser with Three.js.</p>
        <p>Every model, map, sound and screen is made in code, with no outside art or audio.</p>
        <p>Inspired by the extraction-shooter genre: go in with what you can afford to lose.</p>
        <p class="muted">Version ${VERSION}</p>
      </div>`),
  };
  for (const b of home.querySelectorAll('.hm')) {
    b.addEventListener('click', () => {
      Audio.initAudio();
      Audio.playUI();
      actions[b.dataset.a]();
    });
  }
  return home;
}

function openModal(ui, title, html) {
  const wrap = el('div', 'modal');
  wrap.innerHTML = `<div class="panel modal-panel"><div class="panel-title"><span>${title}</span><span class="close"><button class="x" aria-label="Close">✕</button></span></div><div class="modal-body panel-body">${html}</div></div>`;
  const close = () => {
    wrap.remove();
    ui.modal = null;
  };
  wrap.querySelector('.x').onclick = close;
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap) close();
  });
  ui.root.appendChild(wrap);
  ui.modal = { el: wrap, close };
  return wrap;
}
