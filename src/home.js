// The title screen: shown every time the game starts. Logo and main menu on
// the left over a live view of the Dustline, the player's raider card and
// field bulletin on the right.

import { ITEMS, RARITY } from './config.js';
import { loadoutValue } from './inventory.js';
import * as Audio from './audio.js';
import { connect, createAccount, signIn, resumeSession, currentUser, isAdmin, readBulletin, passwordProblem, USERNAME_RULE } from './accounts.js';

export const VERSION = '0.6';

// Newest first. Shown in the Field Bulletin.
const BULLETIN = [
  { tag: 'New', title: 'Account security', body: 'Your account and save are private to your Claude login. Change your password in Settings.' },
  { tag: 'New', title: 'Raider accounts', body: 'Sign in with a username and password. On the Claude page your progress follows you between PC and phone.' },
  { tag: 'New', title: 'Item menus', body: 'Right-click (or hold on a phone) any item to sell, move or repair it.' },
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
        <button class="hm subtle" data-a="signout"><span>Sign out</span></button>
      </nav>
    </section>
    <aside class="home-side">
      <div class="home-card">
        <div class="hc-head"><span class="hc-name">${escapeHtml(currentUser() || 'Raider')}${isAdmin() ? ' <i class="admin-badge">ADMIN</i>' : ''}</span><span class="hc-level">LVL ${p.level}</span></div>
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
        <div class="news-list">${newsHtml(BULLETIN)}</div>
      </div>
    </aside>
    <footer class="home-foot">
      <span>v${VERSION}</span>
      <span>Press Enter to play · progress saves in this browser</span>
    </footer>`;

  // posts from the admin go above the built-in notes
  readBulletin().then((posted) => {
    if (posted && posted.length) home.querySelector('.news-list').innerHTML = newsHtml([...posted, ...BULLETIN]);
  });

  const actions = {
    play: () => ui.leaveHome(),
    signout: () => ui.signOut(),
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

function newsHtml(items) {
  return items.slice(0, 6).map((b) => `<div class="news"><span class="news-tag">${escapeHtml(b.tag || 'News')}</span><b>${escapeHtml(b.title || '')}</b><p>${escapeHtml(b.body || '')}</p></div>`).join('');
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Sign-in / create-account screen, shown before the title menu.
export function renderLogin(ui) {
  const wrap = el('div', 'home login');
  wrap.innerHTML = `
    <div class="home-shade"></div>
    <section class="home-main">
      <div class="home-logo">SCRAP<span>FALL</span></div>
      <p class="home-tag">Scavenge the Dustline. Outlast the Husks. Get out alive.</p>
      <form class="auth" novalidate>
        <div class="auth-tabs" role="tablist">
          <button type="button" class="auth-tab on" data-m="in">Sign in</button>
          <button type="button" class="auth-tab" data-m="up">Create account</button>
        </div>
        <label class="field"><span>Username</span><input id="auth-user" name="username" autocomplete="username" maxlength="16" spellcheck="false" autocapitalize="off"></label>
        <label class="field"><span>Password</span><input id="auth-pass" name="password" type="password" autocomplete="current-password"></label>
        <label class="field confirm hidden"><span>Confirm password</span><input id="auth-pass2" name="password2" type="password" autocomplete="new-password"></label>
        <label class="keep"><input id="auth-keep" type="checkbox" checked> Keep me signed in on this device</label>
        <div class="auth-error" role="alert"></div>
        <button type="submit" class="hm primary auth-go" disabled><span>Connecting…</span></button>
        <p class="auth-note"></p>
      </form>
    </section>
    <footer class="home-foot"><span>v${VERSION}</span><span></span></footer>`;

  const form = wrap.querySelector('form');
  const user = wrap.querySelector('#auth-user');
  const pass = wrap.querySelector('#auth-pass');
  const pass2 = wrap.querySelector('#auth-pass2');
  const keep = wrap.querySelector('#auth-keep');
  const err = wrap.querySelector('.auth-error');
  const go = wrap.querySelector('.auth-go');
  const note = wrap.querySelector('.auth-note');
  let mode = 'in';
  let ready = false;
  let busy = false;

  const setMode = (m) => {
    mode = m;
    for (const t of wrap.querySelectorAll('.auth-tab')) t.classList.toggle('on', t.dataset.m === m);
    wrap.querySelector('.confirm').classList.toggle('hidden', m !== 'up');
    pass.autocomplete = m === 'up' ? 'new-password' : 'current-password';
    err.textContent = '';
    if (ready) go.querySelector('span').textContent = m === 'up' ? 'Create account' : 'Sign in';
  };
  for (const t of wrap.querySelectorAll('.auth-tab')) t.addEventListener('click', () => setMode(t.dataset.m));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!ready || busy) return;
    Audio.initAudio();
    err.textContent = '';
    if (mode === 'up') {
      if (!USERNAME_RULE.test(user.value.trim())) return void (err.textContent = 'Usernames are 3–16 letters, numbers or underscores.');
      const problem = passwordProblem(pass.value);
      if (problem) return void (err.textContent = problem);
      if (pass.value !== pass2.value) return void (err.textContent = 'The two passwords don’t match.');
    } else if (!user.value.trim() || !pass.value) {
      return void (err.textContent = 'Enter your username and password.');
    }
    busy = true;
    go.disabled = true;
    go.querySelector('span').textContent = mode === 'up' ? 'Creating…' : 'Signing in…';
    const res = mode === 'up' ? await createAccount(user.value, pass.value, keep.checked) : await signIn(user.value, pass.value, keep.checked);
    busy = false;
    go.disabled = false;
    go.querySelector('span').textContent = mode === 'up' ? 'Create account' : 'Sign in';
    if (res.error) {
      err.textContent = res.error;
      Audio.playDeny();
      return;
    }
    Audio.playChime();
    ui.signedIn(res.profile);
  });

  // connect to storage, then try the remembered session
  connect().then(async (kind) => {
    note.textContent = kind === 'cloud'
      ? 'Your account works on any device where you open this game in Claude.'
      : 'Accounts are saved in this browser only.';
    const resumed = await resumeSession();
    if (resumed) {
      ui.signedIn(resumed.profile);
      return;
    }
    ready = true;
    go.disabled = false;
    setMode(mode);
    user.focus();
  });
  return wrap;
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
