// Player accounts: a username and password per player, each with its own save.
//
// On the Claude page the accounts and saves live in the page's shared
// database, so the same login works on any device. Anywhere else (GitHub
// Pages, local dev) they live in this browser's storage.
//
// Passwords are never stored: only a salted PBKDF2 hash. This keeps casual
// snooping out, but it is a game login, not a bank: everything runs in the
// browser, so someone with edit access to the page's data could still tamper
// with saves.

import { normalizeProfile, blankProfile, takeLegacySave, setSaver } from './inventory.js';

const LOCAL_ACCOUNTS = 'scrapfall_accounts_v1';
const LOCAL_SAVE = 'scrapfall_acct_';
const SESSION = 'scrapfall_session_v1';
const ITERATIONS = 120000;

export const USERNAME_RULE = /^[A-Za-z0-9_]{3,16}$/;
export const MIN_PASSWORD = 6;

let backend = null;
let current = null; // { key, username, hash }

// ---------- password hashing ----------
function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password, saltHex) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, keyMaterial, 256);
  return toHex(bits);
}

function newSalt() {
  return toHex(crypto.getRandomValues(new Uint8Array(16)));
}

// ---------- storage backends ----------
function readLocal(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (err) {
    return fallback;
  }
}

function writeLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    return false;
  }
}

function localBackend() {
  return {
    kind: 'local',
    async getAccount(key) {
      return readLocal(LOCAL_ACCOUNTS, {})[key] || null;
    },
    async claimAccount(key, record) {
      const all = readLocal(LOCAL_ACCOUNTS, {});
      if (all[key]) return false;
      all[key] = record;
      if (!writeLocal(LOCAL_ACCOUNTS, all)) throw new Error('storage');
      return true;
    },
    async loadSave(key) {
      return readLocal(LOCAL_SAVE + key, null);
    },
    async writeSave(key, json) {
      try {
        localStorage.setItem(LOCAL_SAVE + key, json);
      } catch (err) {
        console.warn('Save failed', err);
      }
    },
  };
}

function cloudBackend(db) {
  return {
    kind: 'cloud',
    async getAccount(key) {
      const snap = await db.doc(`accounts/${key}`).get();
      return snap.exists ? { ...snap.data() } : null;
    },
    // Usernames are first-come: hold a short lease while checking and writing
    // so two people can't create the same name at once.
    async claimAccount(key, record) {
      const ref = db.doc(`accounts/${key}`);
      const lease = await ref.acquire({ holder: `${key}-${record.salt}`, ttlMs: 8000 });
      if (!lease.acquired) return false;
      const snap = await ref.get();
      if (snap.exists && snap.data().hash) return false;
      await ref.set(record);
      return true;
    },
    async loadSave(key) {
      const snap = await db.doc(`saves/${key}`).get();
      if (!snap.exists) return null;
      try {
        return JSON.parse(snap.data().data);
      } catch (err) {
        return null;
      }
    },
    async writeSave(key, json) {
      await db.doc(`saves/${key}`).set({ data: json, updated: Date.now() });
    },
  };
}

// Pick the backend: the page's database inside the Claude viewer, else this browser.
export async function connect() {
  if (backend) return backend.kind;
  let db = null;
  try {
    if (window.claude && typeof window.claude.use === 'function') db = await window.claude.use('db');
  } catch (err) {
    db = null;
  }
  backend = db ? cloudBackend(db) : localBackend();
  return backend.kind;
}

export function storageKind() {
  return backend ? backend.kind : 'local';
}

export function currentUser() {
  return current ? current.username : null;
}

// ---------- saving (debounced, one write at a time) ----------
let pending = null;
let writing = false;
let timer = null;

async function flushNow() {
  clearTimeout(timer);
  timer = null;
  if (!current || pending === null || writing) return;
  const json = pending;
  const key = current.key;
  pending = null;
  writing = true;
  try {
    await backend.writeSave(key, json);
  } catch (err) {
    console.warn('Cloud save failed; will retry', err);
    if (pending === null) pending = json;
    setTimeout(flushNow, 3000);
  } finally {
    writing = false;
  }
  if (pending !== null) flushNow();
}

function queueSave(profile) {
  if (!current) return;
  pending = JSON.stringify(profile);
  clearTimeout(timer);
  timer = setTimeout(flushNow, backend.kind === 'cloud' ? 700 : 0);
}

export function flushSave() {
  return flushNow();
}

window.addEventListener('pagehide', () => flushNow());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushNow();
});

setSaver(queueSave);

// ---------- sign up / sign in ----------
function keyFor(username) {
  return username.toLowerCase();
}

function remember(on) {
  try {
    if (on && current) localStorage.setItem(SESSION, JSON.stringify({ key: current.key, hash: current.hash }));
    else localStorage.removeItem(SESSION);
  } catch (err) {
    // ignore
  }
}

async function finishSignIn(account, keep) {
  current = { key: keyFor(account.username), username: account.username, hash: account.hash };
  remember(keep);
  const saved = await backend.loadSave(current.key);
  return normalizeProfile(saved || blankProfile());
}

// Returns { profile } or { error }.
export async function createAccount(username, password, keep) {
  username = username.trim();
  if (!USERNAME_RULE.test(username)) return { error: 'Usernames are 3–16 letters, numbers or underscores.' };
  if (password.length < MIN_PASSWORD) return { error: `Passwords need at least ${MIN_PASSWORD} characters.` };
  const salt = newSalt();
  const hash = await hashPassword(password, salt);
  const record = { username, salt, hash, created: Date.now() };
  let ok;
  try {
    ok = await backend.claimAccount(keyFor(username), record);
  } catch (err) {
    if (err && err.code === 'invalid_argument') return { error: 'Your access to this game is view-only. Ask its owner to share it with you as a Contributor.' };
    return { error: 'Could not create the account. Check your connection and try again.' };
  }
  if (!ok) return { error: 'That username is taken.' };
  // a brand-new account inherits the progress this browser had before accounts existed
  const legacy = takeLegacySave();
  const profile = await finishSignIn(record, keep);
  const start = legacy || profile;
  queueSave(start);
  await flushNow();
  return { profile: start, imported: !!legacy };
}

export async function signIn(username, password, keep) {
  username = username.trim();
  let account;
  try {
    account = await backend.getAccount(keyFor(username));
  } catch (err) {
    return { error: 'Could not reach the save server. Check your connection and try again.' };
  }
  if (!account) return { error: 'No account with that username.' };
  const hash = await hashPassword(password, account.salt);
  if (hash !== account.hash) return { error: 'Wrong password.' };
  try {
    return { profile: await finishSignIn(account, keep) };
  } catch (err) {
    current = null;
    return { error: 'Signed in, but your save could not be loaded. Try again.' };
  }
}

// "Keep me signed in": the saved hash must still match the account.
export async function resumeSession() {
  const s = readLocal(SESSION, null);
  if (!s || !s.key) return null;
  try {
    const account = await backend.getAccount(s.key);
    if (!account || account.hash !== s.hash) {
      remember(false);
      return null;
    }
    return { profile: await finishSignIn(account, true) };
  } catch (err) {
    return null;
  }
}

export async function signOut() {
  await flushNow();
  current = null;
  pending = null;
  remember(false);
}
