// Player accounts: a username and password per player, each with its own save.
//
// On the Claude page, the server enforces who can touch what (see the access
// rules the page is published with):
//  - Each player's account record (password hash) and saves live in their own
//    private area, data/users/<their Claude id>/. Nobody else can read or
//    write it, not even the page's owner.
//  - registry/<Claude id> lists the usernames that person has claimed, so
//    names stay unique. Everyone can read it; each person can only write
//    their own entry.
//  - admin/* (bulletin, bans) can only be written by the page's owner.
//  - The admin account is "Poqui", and it is only admin when the viewer is
//    the page's owner, which the platform verifies.
//
// Off the Claude page (GitHub Pages, local dev) there is no server, so
// accounts live in this browser's storage and there is no admin.
//
// Passwords are never stored: only a salted PBKDF2-SHA256 hash.

import { normalizeProfile, blankProfile, takeLegacySave, setSaver } from './inventory.js';

export const ADMIN_NAME = 'Poqui';
const ADMIN_KEY = ADMIN_NAME.toLowerCase();

const LOCAL_ACCOUNTS = 'scrapfall_accounts_v1';
const LOCAL_SAVE = 'scrapfall_acct_';
const SESSION = 'scrapfall_session_v2';
const THROTTLE = 'scrapfall_login_throttle';
const ITERATIONS = 150000;
const MAX_FAILS = 5;
const LOCKOUT_MS = 60 * 1000;

export const USERNAME_RULE = /^[A-Za-z0-9_]{3,16}$/;
export const MIN_PASSWORD = 8;

let backend = null;
let current = null; // { key, username, hash, salt, created, admin }

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

// Compare without stopping at the first difference.
function sameHash(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function passwordProblem(pw) {
  if (pw.length < MIN_PASSWORD) return `Passwords need at least ${MIN_PASSWORD} characters.`;
  if (pw.length > 128) return 'That password is too long.';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Use at least one letter and one number.';
  return null;
}

// ---------- failed-login throttle ----------
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

const memThrottle = { fails: 0, until: 0 };

function throttleState() {
  const t = readLocal(THROTTLE, null) || memThrottle;
  return { fails: t.fails || 0, until: t.until || 0 };
}

function lockedFor() {
  return Math.max(0, throttleState().until - Date.now());
}

function noteFailure() {
  const t = throttleState();
  t.fails += 1;
  if (t.fails >= MAX_FAILS) {
    t.until = Date.now() + LOCKOUT_MS * Math.min(8, 2 ** (t.fails - MAX_FAILS)); // 1, 2, 4… minutes
  }
  Object.assign(memThrottle, t);
  writeLocal(THROTTLE, t);
}

function clearFailures() {
  Object.assign(memThrottle, { fails: 0, until: 0 });
  try {
    localStorage.removeItem(THROTTLE);
  } catch (err) {
    // ignore
  }
}

// ---------- storage backends ----------
function localBackend() {
  return {
    kind: 'local',
    async ownerCheck() {
      return false;
    },
    async getAccount(key) {
      return readLocal(LOCAL_ACCOUNTS, {})[key] || null;
    },
    async nameTaken(key) {
      return !!readLocal(LOCAL_ACCOUNTS, {})[key];
    },
    async createAccount(key, record) {
      const all = readLocal(LOCAL_ACCOUNTS, {});
      if (all[key]) return false;
      all[key] = record;
      if (!writeLocal(LOCAL_ACCOUNTS, all)) throw new Error('storage');
      return true;
    },
    async updateAccount(key, record) {
      const all = readLocal(LOCAL_ACCOUNTS, {});
      all[key] = record;
      writeLocal(LOCAL_ACCOUNTS, all);
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
    async readAdmin() {
      return null;
    },
  };
}

function cloudBackend(db, user, uid) {
  const mine = (doc) => db.doc(`data/users/${uid}/${doc}`);
  const registry = db.collection('registry');
  return {
    kind: 'cloud',
    uid,
    async ownerCheck() {
      return user ? user.isOwner() : false;
    },
    async getAccount(key) {
      const snap = await mine(`acct-${key}`).get();
      return snap.exists ? { ...snap.data() } : null;
    },
    // Taken by someone else (another Claude user's registry lists it)?
    async nameTaken(key) {
      const snap = await registry.where('names', 'array-contains', key).get();
      return snap.docs.some((d) => d.id !== uid);
    },
    async createAccount(key, record) {
      if (await this.nameTaken(key)) return false;
      if ((await mine(`acct-${key}`).get()).exists) return false;
      await mine(`acct-${key}`).set(record);
      const regRef = registry.doc(uid);
      const reg = await regRef.get();
      const names = reg.exists && Array.isArray(reg.data().names) ? [...reg.data().names] : [];
      if (!names.includes(key)) names.push(key);
      await regRef.set({ names });
      return true;
    },
    async updateAccount(key, record) {
      await mine(`acct-${key}`).set(record);
    },
    async loadSave(key) {
      const snap = await mine(`save-${key}`).get();
      if (!snap.exists) return null;
      try {
        return JSON.parse(snap.data().data);
      } catch (err) {
        return null;
      }
    },
    async writeSave(key, json) {
      await mine(`save-${key}`).set({ data: json, updated: Date.now() });
    },
    async readAdmin(doc) {
      const snap = await db.doc(`admin/${doc}`).get();
      return snap.exists ? { ...snap.data() } : null;
    },
    async writeAdmin(doc, data) {
      await db.doc(`admin/${doc}`).set(data);
    },
    async listPlayers() {
      const snap = await registry.get();
      const names = [];
      for (const d of snap.docs) for (const n of d.data().names || []) names.push(n);
      return names.sort();
    },
  };
}

// Pick the backend: the page's database inside the Claude viewer, else this browser.
export async function connect() {
  if (backend) return backend.kind;
  let db = null;
  let user = null;
  try {
    if (window.claude && typeof window.claude.use === 'function') {
      [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
    }
  } catch (err) {
    db = null;
  }
  const uid = user ? await user.id() : null;
  backend = db && uid ? cloudBackend(db, user, uid) : localBackend();
  return backend.kind;
}

export function storageKind() {
  return backend ? backend.kind : 'local';
}

export function currentUser() {
  return current ? current.username : null;
}

export function isAdmin() {
  return !!(current && current.admin);
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
    console.warn('Save failed; will retry', err);
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
  return username.trim().toLowerCase();
}

function remember(on) {
  try {
    if (on && current) localStorage.setItem(SESSION, JSON.stringify({ key: current.key, hash: current.hash, uid: backend.uid || null }));
    else localStorage.removeItem(SESSION);
  } catch (err) {
    // ignore
  }
}

async function finishSignIn(account, keep) {
  const key = keyFor(account.username);
  const admin = key === ADMIN_KEY && (await backend.ownerCheck());
  current = { key, username: account.username, hash: account.hash, salt: account.salt, created: account.created, admin };
  remember(keep);
  const saved = await backend.loadSave(key);
  return normalizeProfile(saved || blankProfile());
}

async function bannedName(key) {
  if (key === ADMIN_KEY) return false;
  try {
    const bans = await backend.readAdmin('bans');
    return !!(bans && Array.isArray(bans.names) && bans.names.includes(key));
  } catch (err) {
    return false;
  }
}

function lockMessage() {
  return `Too many wrong passwords. Try again in ${Math.ceil(lockedFor() / 1000)} seconds.`;
}

// Returns { profile } or { error }.
export async function createAccount(username, password, keep) {
  username = username.trim();
  const key = keyFor(username);
  if (!USERNAME_RULE.test(username)) return { error: 'Usernames are 3–16 letters, numbers or underscores.' };
  const problem = passwordProblem(password);
  if (problem) return { error: problem };
  if (key === ADMIN_KEY && !(await backend.ownerCheck())) return { error: 'That username is reserved.' };
  if (await bannedName(key)) return { error: 'That username is not available.' };
  const salt = newSalt();
  const hash = await hashPassword(password, salt);
  const record = { username, salt, hash, created: Date.now() };
  let ok;
  try {
    ok = await backend.createAccount(key, record);
  } catch (err) {
    if (err && err.code === 'invalid_argument') return { error: 'Your access to this game is view-only. Ask its owner to share it with you as a Contributor.' };
    return { error: 'Could not create the account. Check your connection and try again.' };
  }
  if (!ok) return { error: 'That username is taken.' };
  const legacy = takeLegacySave();
  const profile = await finishSignIn(record, keep);
  const start = legacy || profile;
  queueSave(start);
  await flushNow();
  return { profile: start, imported: !!legacy };
}

export async function signIn(username, password, keep) {
  if (lockedFor() > 0) return { error: lockMessage() };
  const key = keyFor(username);
  let account;
  try {
    account = await backend.getAccount(key);
  } catch (err) {
    return { error: 'Could not reach the save server. Check your connection and try again.' };
  }
  // Same message and same work for a missing account as for a wrong
  // password, so the login form can't be used to find out which names exist.
  const hash = await hashPassword(password, account ? account.salt : newSalt());
  if (!account || !sameHash(hash, account.hash)) {
    noteFailure();
    if (lockedFor() > 0) return { error: lockMessage() };
    return { error: 'Wrong username or password.' };
  }
  if (await bannedName(key)) return { error: 'This account has been suspended.' };
  clearFailures();
  try {
    return { profile: await finishSignIn(account, keep) };
  } catch (err) {
    current = null;
    return { error: 'Signed in, but your save could not be loaded. Try again.' };
  }
}

// "Keep me signed in": the saved hash must still match the account (so a
// password change signs out other devices) and, on the Claude page, the
// session must belong to the same Claude login.
export async function resumeSession() {
  const s = readLocal(SESSION, null);
  if (!s || !s.key) return null;
  if (backend.kind === 'cloud' && s.uid !== backend.uid) {
    remember(false);
    return null;
  }
  try {
    const account = await backend.getAccount(s.key);
    if (!account || !sameHash(account.hash, s.hash) || (await bannedName(s.key))) {
      remember(false);
      return null;
    }
    return { profile: await finishSignIn(account, true) };
  } catch (err) {
    return null;
  }
}

export async function changePassword(oldPassword, newPassword) {
  if (!current) return { error: 'You are not signed in.' };
  const problem = passwordProblem(newPassword);
  if (problem) return { error: problem };
  if (lockedFor() > 0) return { error: lockMessage() };
  const check = await hashPassword(oldPassword, current.salt);
  if (!sameHash(check, current.hash)) {
    noteFailure();
    return { error: lockedFor() > 0 ? lockMessage() : 'Your current password is wrong.' };
  }
  if (oldPassword === newPassword) return { error: 'Pick a password you haven’t used here.' };
  clearFailures();
  const salt = newSalt();
  const hash = await hashPassword(newPassword, salt);
  const record = { username: current.username, salt, hash, created: current.created || Date.now(), changed: Date.now() };
  try {
    await backend.updateAccount(current.key, record);
  } catch (err) {
    return { error: 'Could not save the new password. Try again.' };
  }
  const keep = !!readLocal(SESSION, null);
  current.hash = hash;
  current.salt = salt;
  remember(keep);
  return { ok: true };
}

export async function signOut() {
  await flushNow();
  current = null;
  pending = null;
  remember(false);
}

// ---------- admin (Poqui on the owner's Claude login only) ----------
export async function readBulletin() {
  try {
    const b = await backend.readAdmin('bulletin');
    return b && Array.isArray(b.items) ? b.items : null;
  } catch (err) {
    return null;
  }
}

export async function adminData() {
  if (!isAdmin() || backend.kind !== 'cloud') return null;
  const [players, bans, bulletin] = await Promise.all([
    backend.listPlayers().catch(() => []),
    backend.readAdmin('bans').catch(() => null),
    readBulletin(),
  ]);
  return { players, bans: (bans && bans.names) || [], bulletin: bulletin || [] };
}

export async function adminSetBans(names) {
  if (!isAdmin()) return false;
  await backend.writeAdmin('bans', { names: names.filter((n) => n !== ADMIN_KEY) });
  return true;
}

export async function adminSetBulletin(items) {
  if (!isAdmin()) return false;
  await backend.writeAdmin('bulletin', { items });
  return true;
}
