// Device detection and graphics quality presets. Phones and tablets default
// to "low"; the choice is saved and can be changed from the pause menu or hub.

const KEY = 'scrapfall_quality';

export const IS_TOUCH = (() => {
  try {
    return window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  } catch (err) {
    return false;
  }
})();

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
  return IS_TOUCH ? 'low' : 'high';
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
