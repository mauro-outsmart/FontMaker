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

export { getSystemFonts, FALLBACK_FONTS };
