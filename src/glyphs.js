const STORAGE_KEY = 'FontMaker_glyphs';
const SETTINGS_KEY = 'FontMaker_settings';
const DEFAULT_WIDTH = 650;

const GLYPHS = [
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
  ...'abcdefghijklmnopqrstuvwxyz'.split(''),
  ...'0123456789'.split(''),
  ...'.,!?\'"\\-():;'.split(''),
];

function loadGlyphStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveGlyphStore(store) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function makeDefaultGlyph(char) {
  return { char, strokes: [], width: DEFAULT_WIDTH, kerningLeft: null, kerningRight: null };
}

function getGlyphSet() {
  const store = loadGlyphStore();
  return GLYPHS.map((char) => {
    const saved = store[char];
    if (saved) {
      return { char, strokes: saved.strokes || [], width: saved.width || DEFAULT_WIDTH,
               kerningLeft: saved.kerningLeft ?? null, kerningRight: saved.kerningRight ?? null };
    }
    return makeDefaultGlyph(char);
  });
}

function getGlyph(char) {
  const store = loadGlyphStore();
  const saved = store[char];
  if (saved) {
    return { char, strokes: saved.strokes || [], width: saved.width || DEFAULT_WIDTH,
             kerningLeft: saved.kerningLeft ?? null, kerningRight: saved.kerningRight ?? null };
  }
  return makeDefaultGlyph(char);
}

function saveGlyph(char, strokes) {
  const store = loadGlyphStore();
  store[char] = {
    strokes,
    width: store[char]?.width || DEFAULT_WIDTH,
    kerningLeft: store[char]?.kerningLeft ?? null,
    kerningRight: store[char]?.kerningRight ?? null,
  };
  saveGlyphStore(store);
}

function saveGlyphKerning(char, kerningLeft, kerningRight) {
  const store = loadGlyphStore();
  if (!store[char]) store[char] = { strokes: [], width: DEFAULT_WIDTH };
  store[char].kerningLeft = kerningLeft;
  store[char].kerningRight = kerningRight;
  saveGlyphStore(store);
}

function resetAllKerning() {
  const store = loadGlyphStore();
  for (const char of Object.keys(store)) {
    delete store[char].kerningLeft;
    delete store[char].kerningRight;
  }
  saveGlyphStore(store);
}

function clearGlyph(char) {
  const store = loadGlyphStore();
  delete store[char];
  saveGlyphStore(store);
}

function isGlyphDrawn(char) {
  const store = loadGlyphStore();
  const saved = store[char];
  return !!(saved && saved.strokes && saved.strokes.length > 0);
}

function getAllGlyphs() {
  return getGlyphSet();
}

function getDrawnCount() {
  const store = loadGlyphStore();
  return Object.values(store).filter((g) => g.strokes && g.strokes.length > 0).length;
}

function getSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const saved = raw ? JSON.parse(raw) : {};
    return {
      fontName: saved.fontName || 'My Font',
      referenceFont: saved.referenceFont || 'Arial',
      strokeWidth: saved.strokeWidth || 8,
      kerning: saved.kerning ?? 0,
      lineBoil: saved.lineBoil ?? false,
      brushType: saved.brushType || 'normal',
    };
  } catch {
    return { fontName: 'My Font', referenceFont: 'Arial', strokeWidth: 8, kerning: 0, lineBoil: false, brushType: 'normal' };
  }
}

function saveSettings(settings) {
  const current = getSettings();
  const merged = { ...current, ...settings };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
}

function exportProject() {
  return {
    version: 1,
    settings: getSettings(),
    glyphs: loadGlyphStore(),
  };
}

function importProject(data) {
  if (!data || !data.glyphs) return false;
  if (data.settings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(data.settings));
  }
  saveGlyphStore(data.glyphs);
  return true;
}

function clearAllGlyphs() {
  saveGlyphStore({});
}

export {
  GLYPHS,
  getGlyphSet,
  getGlyph,
  saveGlyph,
  saveGlyphKerning,
  resetAllKerning,
  clearGlyph,
  clearAllGlyphs,
  isGlyphDrawn,
  getAllGlyphs,
  getDrawnCount,
  getSettings,
  saveSettings,
  exportProject,
  importProject,
};
