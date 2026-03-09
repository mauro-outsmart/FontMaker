const FALLBACK_FONTS = [
  'Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Georgia',
  'Verdana', 'Comic Sans MS', 'Impact', 'Trebuchet MS', 'Palatino',
  'Garamond', 'Bookman', 'Avant Garde', 'Futura', 'Geneva',
  'Optima', 'Didot', 'American Typewriter', 'Baskerville',
  'Menlo', 'Monaco', 'SF Mono', 'SF Pro', 'Helvetica Neue',
];

const GOOGLE_FONTS = [
  'ABeeZee', 'Abril Fatface', 'Alegreya', 'Archivo', 'Arvo',
  'Bitter', 'Cabin', 'Crimson Text', 'DM Sans', 'DM Serif Display',
  'EB Garamond', 'Epilogue', 'Fraunces', 'Geologica', 'IBM Plex Sans',
  'IBM Plex Serif', 'IBM Plex Mono', 'Inter', 'Josefin Sans',
  'Karla', 'Lato', 'Libre Baskerville', 'Libre Franklin', 'Lora',
  'Merriweather', 'Montserrat', 'Mulish', 'Noto Sans', 'Noto Serif',
  'Nunito', 'Open Sans', 'Oswald', 'Outfit', 'Playfair Display',
  'Plus Jakarta Sans', 'Poppins', 'PT Sans', 'PT Serif', 'Raleway',
  'Roboto', 'Roboto Mono', 'Roboto Slab', 'Rubik', 'Source Code Pro',
  'Source Sans 3', 'Source Serif 4', 'Space Grotesk', 'Space Mono',
  'Syne', 'Work Sans',
];

function loadGoogleFonts(families) {
  const params = families.map(f => 'family=' + encodeURIComponent(f)).join('&');
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?' + params + '&display=swap';
  document.head.appendChild(link);
}

async function getSystemFonts() {
  let systemFonts = [];
  try {
    if ('queryLocalFonts' in window) {
      const fonts = await window.queryLocalFonts();
      systemFonts = [...new Set(fonts.map(f => f.family))];
    }
  } catch (e) {
    // Permission denied or unsupported
  }
  if (systemFonts.length === 0) systemFonts = FALLBACK_FONTS;

  // Load and merge Google Fonts
  loadGoogleFonts(GOOGLE_FONTS);
  const all = [...new Set([...systemFonts, ...GOOGLE_FONTS])];
  return all.sort();
}

// Unicode ranges to scan for font glyph detection
const UNICODE_RANGES = [
  [0x0021, 0x007E],  // Basic Latin (printable)
  [0x00A1, 0x00FF],  // Latin-1 Supplement
  [0x0100, 0x017F],  // Latin Extended-A
  [0x0180, 0x024F],  // Latin Extended-B
  [0x0370, 0x03FF],  // Greek and Coptic
  [0x0400, 0x04FF],  // Cyrillic
  [0x2010, 0x2027],  // General Punctuation (subset)
  [0x2030, 0x205E],  // General Punctuation (subset 2)
  [0x20A0, 0x20CF],  // Currency Symbols
  [0x2150, 0x218F],  // Number Forms
  [0x2190, 0x21FF],  // Arrows
];

const _fontCharCache = new Map();

async function detectFontChars(fontName) {
  if (_fontCharCache.has(fontName)) return _fontCharCache.get(fontName);

  // Ensure font is loaded (important for Google Fonts)
  try {
    await document.fonts.load(`24px "${fontName}"`);
  } catch { /* ignore */ }

  const canvas = document.createElement('canvas');
  canvas.width = 50;
  canvas.height = 50;
  const ctx = canvas.getContext('2d');
  const size = 24;

  const chars = [];
  for (const [start, end] of UNICODE_RANGES) {
    for (let code = start; code <= end; code++) {
      const char = String.fromCodePoint(code);

      // Measure with target font + serif fallback
      ctx.font = `${size}px "${fontName}", serif`;
      const w1 = ctx.measureText(char).width;

      // Measure with target font + monospace fallback
      ctx.font = `${size}px "${fontName}", monospace`;
      const w2 = ctx.measureText(char).width;

      // If both widths match and > 0, font has the glyph
      if (w1 === w2 && w1 > 0) {
        chars.push(char);
      }
    }
  }

  _fontCharCache.set(fontName, chars);
  return chars;
}

export { getSystemFonts, FALLBACK_FONTS, detectFontChars };
