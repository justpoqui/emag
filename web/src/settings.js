// Graphics quality presets; the choice is saved and can be changed from the
// pause menu or hub.

const KEY = 'scrapfall_quality';

export const QUALITY = {
  low: { label: 'Low', pixelRatio: 1, antialias: false, shadows: false, shadowMap: 1024, grass: 2500, drawDist: 110 },
  medium: { label: 'Medium', pixelRatio: 1.25, antialias: true, shadows: true, shadowMap: 1024, grass: 5000, drawDist: 150 },
  high: { label: 'High', pixelRatio: 1.5, antialias: true, shadows: true, shadowMap: 2048, grass: 9000, drawDist: 200 },
};

export function getQualityName() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && QUALITY[saved]) return saved;
  } catch (err) {
    // storage blocked: fall through to the default
  }
  return 'medium';
}

export function setQualityName(name) {
  try {
    localStorage.setItem(KEY, name);
  } catch (err) {
    // ignore
  }
}

export function getQuality() {
  return QUALITY[getQualityName()];
}

// Frame-rate cap. Drawing more frames than needed is the biggest CPU cost, so
// it defaults to 60 even on fast monitors. 0 = match the monitor.
export const FPS_CAPS = [30, 60, 120, 0];

// Resolution scale: render fewer pixels and let the browser stretch them.
export const RES_SCALES = [0.6, 0.75, 1];

function readNumber(key, allowed, fallback) {
  try {
    const v = Number(localStorage.getItem(key));
    if (allowed.includes(v) && localStorage.getItem(key) !== null) return v;
  } catch (err) {
    // storage blocked
  }
  return fallback;
}

function writeValue(key, v) {
  try {
    localStorage.setItem(key, String(v));
  } catch (err) {
    // ignore
  }
}

export const getFpsCap = () => readNumber('scrapfall_fps', FPS_CAPS, 60);
export const setFpsCap = (v) => writeValue('scrapfall_fps', v);
export const getResScale = () => readNumber('scrapfall_res', RES_SCALES, 1);
export const setResScale = (v) => writeValue('scrapfall_res', v);
export function getShowFps() {
  try {
    return localStorage.getItem('scrapfall_showfps') === '1';
  } catch (err) {
    return false;
  }
}
export const setShowFps = (on) => writeValue('scrapfall_showfps', on ? '1' : '0');
