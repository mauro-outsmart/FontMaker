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

function getGlyphSet(chars = GLYPHS) {
  const store = loadGlyphStore();
  return chars.map((char) => {
    const saved = store[char];
    if (saved) {
      return { char, strokes: saved.strokes || [], width: saved.width || DEFAULT_WIDTH,
               kerningLeft: saved.kerningLeft ?? null, kerningRight: saved.kerningRight ?? null };
    }
    return makeDefaultGlyph(char);
  });
}

function getGlyph(char) {
  const store = _batchStore || loadGlyphStore();
  const saved = store[char];
  if (saved) {
    return { char, strokes: saved.strokes || [], width: saved.width || DEFAULT_WIDTH,
             kerningLeft: saved.kerningLeft ?? null, kerningRight: saved.kerningRight ?? null };
  }
  return makeDefaultGlyph(char);
}

function saveGlyph(char, strokes, userDrawn = false) {
  const store = loadGlyphStore();
  // Once a glyph has been marked as user-drawn, keep that mark on subsequent
  // saves (e.g. re-saving in the editor) but never let auto-generation flip it
  // back to false.
  const prevUserDrawn = store[char]?.userDrawn === true;
  store[char] = {
    strokes,
    width: store[char]?.width || DEFAULT_WIDTH,
    kerningLeft: store[char]?.kerningLeft ?? null,
    kerningRight: store[char]?.kerningRight ?? null,
    userDrawn: userDrawn || prevUserDrawn,
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

// Compute per-glyph kerning so each drawn glyph has roughly equal visual
// padding on its left and right within the advance box. Uses the glyph's own
// horizontal extent — narrow letters (i, l) get tightened in, wide ones (M, W)
// get extra room. The user's global kerning slider stacks on top.
function autoKernAll(sideBearing = 60) {
  const store = loadGlyphStore();
  const baseAdvance = 650; // matches font-export and preview
  for (const char of Object.keys(store)) {
    const g = store[char];
    if (!g.strokes || g.strokes.length === 0) continue;
    let minX = Infinity, maxX = -Infinity;
    for (const stroke of g.strokes) {
      for (const p of stroke) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
      }
    }
    if (!isFinite(minX) || !isFinite(maxX)) continue;
    g.kerningLeft = Math.round(sideBearing - 1000 * minX);
    g.kerningRight = Math.round(1000 * maxX + sideBearing - baseAdvance);
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

function getAllGlyphs(chars = GLYPHS) {
  return getGlyphSet(chars);
}

function getDrawnCount(chars = null) {
  const store = loadGlyphStore();
  if (chars) {
    return chars.filter((ch) => {
      const g = store[ch];
      return g && g.strokes && g.strokes.length > 0;
    }).length;
  }
  return Object.values(store).filter((g) => g.strokes && g.strokes.length > 0).length;
}

// Number of glyphs the user has drawn by hand in the editor (excludes
// auto-generated ones). Used to gate the YOUR FONT Generate button.
function getUserDrawnCount() {
  const store = loadGlyphStore();
  return Object.values(store).filter(
    (g) => g.userDrawn === true && g.strokes && g.strokes.length > 0
  ).length;
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

// --- Batch write API (avoids repeated JSON.parse/stringify during generation) ---

let _batchStore = null;

function beginBatch() {
  _batchStore = loadGlyphStore();
}

function batchSaveGlyph(char, strokes) {
  if (!_batchStore) return saveGlyph(char, strokes);
  _batchStore[char] = {
    strokes,
    width: _batchStore[char]?.width || DEFAULT_WIDTH,
    kerningLeft: _batchStore[char]?.kerningLeft ?? null,
    kerningRight: _batchStore[char]?.kerningRight ?? null,
    // Auto-generated; preserve any existing user-drawn flag
    userDrawn: _batchStore[char]?.userDrawn === true,
  };
}

function flushBatch() {
  if (_batchStore) {
    saveGlyphStore(_batchStore);
  }
}

function endBatch() {
  if (_batchStore) {
    saveGlyphStore(_batchStore);
    _batchStore = null;
  }
}

export {
  GLYPHS,
  getGlyphSet,
  getGlyph,
  saveGlyph,
  saveGlyphKerning,
  resetAllKerning,
  autoKernAll,
  clearGlyph,
  clearAllGlyphs,
  isGlyphDrawn,
  getAllGlyphs,
  getDrawnCount,
  getUserDrawnCount,
  getSettings,
  saveSettings,
  exportProject,
  importProject,
  beginBatch,
  batchSaveGlyph,
  flushBatch,
  endBatch,
};
