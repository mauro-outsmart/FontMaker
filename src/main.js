import { getSystemFonts, detectFontChars } from './fonts.js';
import { getGlyphSet, getGlyph, getSettings, saveSettings, getDrawnCount, GLYPHS, importProject, clearAllGlyphs, resetAllKerning } from './glyphs.js';
import { renderGrid, updateCard, refreshAllThumbnails, refreshAllThumbnailsBoilFrame } from './grid.js';
import { Editor } from './editor.js';
import { Preview } from './preview.js';
import { exportFont } from './font-export.js';
import { exportGIF } from './gif-export.js';
import { exportHTML } from './html-export.js';
import { getBoilFrames, BOIL_FRAMES } from './boil.js';
import { generateGlyphsProgressive } from './generate.js';
import { exportWebFont } from './webfont-export.js';

let activeChars = GLYPHS;

async function init() {
  // Load settings
  const settings = getSettings();

  // Restore font name
  const fontNameInput = document.getElementById('fontName');
  fontNameInput.value = settings.fontName;
  fontNameInput.addEventListener('input', () => {
    saveSettings({ fontName: fontNameInput.value });
  });

  // Load system fonts
  const fonts = await getSystemFonts();
  const refFontSelect = document.getElementById('refFont');
  // "None" option is already in HTML; select it if no saved reference font
  if (!settings.referenceFont) refFontSelect.value = '';
  for (const font of fonts) {
    const option = document.createElement('option');
    option.value = font;
    option.textContent = font;
    if (font === settings.referenceFont) option.selected = true;
    refFontSelect.appendChild(option);
  }
  // Stroke width
  const strokeWidthInput = document.getElementById('strokeWidth');
  const strokeWidthValue = document.getElementById('strokeWidthValue');
  strokeWidthInput.value = settings.strokeWidth;
  strokeWidthValue.textContent = settings.strokeWidth + 'px';

  // Kerning
  const kerningInput = document.getElementById('kerning');
  const kerningValue = document.getElementById('kerningValue');
  kerningInput.value = settings.kerning;
  kerningValue.textContent = settings.kerning;

  // Brush type
  const brushTypeSelect = document.getElementById('brushType');
  brushTypeSelect.value = settings.brushType;

  // Line Boil
  const lineBoilCheckbox = document.getElementById('lineBoil');
  lineBoilCheckbox.checked = settings.lineBoil;

  // Initialize editor
  const editor = new Editor({
    modal: document.getElementById('editorModal'),
    canvasWrap: document.getElementById('editorCanvasWrap'),
    canvas: document.getElementById('editorCanvas'),
    label: document.getElementById('editorLabel'),
    save: document.getElementById('editorSave'),
    clear: document.getElementById('editorClear'),
    undo: document.getElementById('editorUndo'),
    cancel: document.getElementById('editorCancel'),
    prev: document.getElementById('editorPrev'),
    next: document.getElementById('editorNext'),
    kerningToggle: document.getElementById('editorKerningToggle'),
  });

  // Initialize preview
  const preview = new Preview(
    document.getElementById('previewCanvas'),
    document.getElementById('previewInput')
  );
  preview.setReferenceFont(settings.referenceFont);
  preview.setKerning(settings.kerning);
  preview.setStrokeWidth(settings.strokeWidth);
  preview.setBrushType(settings.brushType);

  // Mobile preview toggle
  const previewSection = document.getElementById('previewSection');
  const previewHandle = document.getElementById('previewHandle');
  const isMobile = () => window.matchMedia('(max-width: 640px)').matches;

  if (isMobile()) previewSection.classList.add('preview-section--collapsed');

  previewHandle.addEventListener('click', () => {
    previewSection.classList.toggle('preview-section--collapsed');
  });

  let touchStartY = 0;
  previewSection.addEventListener('touchstart', (e) => {
    touchStartY = e.touches[0].clientY;
  }, { passive: true });
  previewSection.addEventListener('touchend', (e) => {
    if (!isMobile()) return;
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (dy < -30) previewSection.classList.remove('preview-section--collapsed');
    if (dy > 30) previewSection.classList.add('preview-section--collapsed');
  }, { passive: true });

  document.getElementById('previewInput').addEventListener('focus', () => {
    if (isMobile()) previewSection.classList.remove('preview-section--collapsed');
  });

  // Render glyph grid
  const glyphGrid = document.getElementById('glyphGrid');

  function openGlyph(char) {
    editor.open(char, refFontSelect.value, parseInt(strokeWidthInput.value));
  }

  function rebuildGrid() {
    renderGrid(glyphGrid, getGlyphSet(activeChars), getSettings(), openGlyph);
    updateProgress();
  }

  async function updateCharSet(fontName) {
    if (!fontName) {
      activeChars = GLYPHS;
    } else {
      activeChars = await detectFontChars(fontName);
    }
    editor.setGlyphChars(activeChars);
    rebuildGrid();
  }

  refFontSelect.addEventListener('change', async () => {
    saveSettings({ referenceFont: refFontSelect.value });
    editor.updateReferenceFont(refFontSelect.value);
    preview.setReferenceFont(refFontSelect.value);
    await updateCharSet(refFontSelect.value);
  });

  strokeWidthInput.addEventListener('input', () => {
    strokeWidthValue.textContent = strokeWidthInput.value + 'px';
    saveSettings({ strokeWidth: parseInt(strokeWidthInput.value) });
    editor.updateStrokeWidth(parseInt(strokeWidthInput.value));
    preview.setStrokeWidth(parseInt(strokeWidthInput.value));
    refreshAllThumbnails(glyphGrid, getGlyphSet(activeChars), getSettings());
  });

  brushTypeSelect.addEventListener('change', () => {
    saveSettings({ brushType: brushTypeSelect.value });
    editor.updateBrushType(brushTypeSelect.value);
    preview.setBrushType(brushTypeSelect.value);
    refreshAllThumbnails(glyphGrid, getGlyphSet(activeChars), getSettings());
  });

  kerningInput.addEventListener('input', () => {
    kerningValue.textContent = kerningInput.value;
    saveSettings({ kerning: parseInt(kerningInput.value) });
    preview.setKerning(parseInt(kerningInput.value));
  });

  // Animation bar controls
  const revealAnimCheckbox = document.getElementById('revealAnim');
  const playAnimBtn = document.getElementById('playAnimBtn');
  const animSpeedInput = document.getElementById('animSpeed');
  const animSpeedValue = document.getElementById('animSpeedValue');
  const exportGifBtn = document.getElementById('exportGifBtn');

  function updateAnimControls() {
    const anyChecked = lineBoilCheckbox.checked || revealAnimCheckbox.checked;
    const revealChecked = revealAnimCheckbox.checked;
    // Export GIF: enabled when either checkbox is checked
    const animControls = document.querySelectorAll('.anim-control');
    for (const el of animControls) {
      el.disabled = !anyChecked;
      for (const child of el.querySelectorAll('input')) {
        child.disabled = !anyChecked;
      }
    }
    // Play + Speed: visible and enabled only when Reveal is checked
    const revealControls = document.querySelectorAll('.reveal-control');
    for (const el of revealControls) {
      el.hidden = !revealChecked;
      el.disabled = !revealChecked;
      for (const child of el.querySelectorAll('input')) {
        child.disabled = !revealChecked;
      }
    }
  }

  updateAnimControls();

  playAnimBtn.addEventListener('click', () => {
    if (preview.isPlaying) {
      preview.stopAnimation();
    } else {
      preview.playAnimation(parseFloat(animSpeedInput.value), lineBoilCheckbox.checked);
    }
  });

  preview.onPlayStateChange = (playing) => {
    playAnimBtn.textContent = playing ? '\u25A0' : '\u25B6';
  };

  animSpeedInput.addEventListener('input', () => {
    animSpeedValue.textContent = animSpeedInput.value + 'x';
  });

  function getAnimMode() {
    return lineBoilCheckbox.checked && revealAnimCheckbox.checked ? 'both'
      : revealAnimCheckbox.checked ? 'reveal'
      : 'boil';
  }

  exportGifBtn.addEventListener('click', () => {
    const text = document.getElementById('previewInput').value;
    if (!text) return;
    exportGIF(text, getSettings(), fontNameInput.value, getAnimMode());
  });

  const exportHtmlBtn = document.getElementById('exportHtmlBtn');
  exportHtmlBtn.addEventListener('click', () => {
    const text = document.getElementById('previewInput').value;
    if (!text) return;
    exportHTML(text, getSettings(), fontNameInput.value, getAnimMode());
  });

  lineBoilCheckbox.addEventListener('change', () => {
    saveSettings({ lineBoil: lineBoilCheckbox.checked });
    updateAnimControls();
    if (!lineBoilCheckbox.checked) {
      refreshAllThumbnails(glyphGrid, getGlyphSet(activeChars), getSettings());
      preview.render();
    }
  });

  revealAnimCheckbox.addEventListener('change', () => {
    updateAnimControls();
  });

  // Detect initial char set and render grid
  await updateCharSet(settings.referenceFont);

  // Reset kerning button
  document.getElementById('resetKerningBtn').addEventListener('click', () => {
    if (!confirm('Reset kerning? This cannot be undone.')) return;
    kerningInput.value = 0;
    kerningValue.textContent = '0';
    saveSettings({ kerning: 0 });
    preview.setKerning(0);
    resetAllKerning();
    preview.render();
  });

  // Clear all button
  document.getElementById('clearAllBtn').addEventListener('click', () => {
    if (!confirm('Clear all glyphs? This cannot be undone.')) return;
    clearAllGlyphs();
    rebuildGrid();
  });

  // Generate button
  const generateBtn = document.getElementById('generateBtn');
  let generateController = null;

  generateBtn.addEventListener('click', async () => {
    // If generating, cancel
    if (generateController) {
      generateController.abort();
      return;
    }

    if (!confirm('Generate all glyphs from reference font? This will overwrite existing glyphs.')) return;

    generateController = new AbortController();
    generateBtn.textContent = 'Cancel (0%)';

    const currentSettings = getSettings();
    const result = await generateGlyphsProgressive(
      refFontSelect.value,
      activeChars,
      (char, strokes, index, total) => {
        const pct = Math.round((index + 1) / total * 100);
        generateBtn.textContent = 'Cancel (' + pct + '%)';
        const glyph = getGlyph(char);
        updateCard(glyphGrid, char, glyph, currentSettings);
        updateProgress();
        // Update preview every 10 glyphs
        if ((index + 1) % 10 === 0) preview.render();
      },
      generateController.signal,
      brushTypeSelect.value
    );

    generateController = null;
    generateBtn.textContent = 'Generate';
    preview.render();
    if (result.error) alert(result.error);
  });

  // Export button
  const exportBtn = document.getElementById('exportBtn');
  exportBtn.addEventListener('click', () => {
    const fontName = document.getElementById('fontName').value || 'MyFont';
    const sw = parseInt(document.getElementById('strokeWidth').value);
    const kern = parseInt(document.getElementById('kerning').value);
    const bt = document.getElementById('brushType').value;
    exportFont(fontName, sw, kern, bt);
  });

  // Export JS web component button
  const exportJsBtn = document.getElementById('exportJsBtn');
  exportJsBtn.addEventListener('click', () => {
    const fontName = document.getElementById('fontName').value || 'MyFont';
    exportWebFont(fontName);
  });

  // Import button
  const importFileInput = document.getElementById('importFile');
  document.getElementById('importBtn').addEventListener('click', () => {
    importFileInput.click();
  });
  importFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const ext = (file.name.split('.').pop() || '').toLowerCase();

    if (['ttf', 'otf', 'woff', 'woff2'].includes(ext)) {
      try {
        const buffer = await file.arrayBuffer();
        const base = file.name.replace(/\.[^.]+$/, '');
        let family = base;
        let n = 2;
        while (Array.from(refFontSelect.options).some((o) => o.value === family)) {
          family = base + ' ' + n++;
        }
        const fontFace = new FontFace(family, buffer);
        await fontFace.load();
        document.fonts.add(fontFace);

        const opt = document.createElement('option');
        opt.value = family;
        opt.textContent = family;
        refFontSelect.appendChild(opt);
        refFontSelect.value = family;
        refFontSelect.dispatchEvent(new Event('change'));
      } catch (err) {
        alert('Could not load font: ' + err.message);
      }
      importFileInput.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (importProject(data)) {
          // Restore all UI from imported data
          const s = getSettings();
          fontNameInput.value = s.fontName;
          strokeWidthInput.value = s.strokeWidth;
          strokeWidthValue.textContent = s.strokeWidth + 'px';
          kerningInput.value = s.kerning;
          kerningValue.textContent = s.kerning;
          lineBoilCheckbox.checked = s.lineBoil;
          updateAnimControls();
          // Update reference font select if the font is in the list
          for (const opt of refFontSelect.options) {
            if (opt.value === s.referenceFont) {
              opt.selected = true;
              break;
            }
          }
          brushTypeSelect.value = s.brushType || 'normal';
          editor.updateReferenceFont(s.referenceFont);
          editor.updateStrokeWidth(s.strokeWidth);
          editor.updateBrushType(s.brushType || 'normal');
          preview.setReferenceFont(s.referenceFont);
          preview.setKerning(s.kerning);
          preview.setStrokeWidth(s.strokeWidth);
          preview.setBrushType(s.brushType || 'normal');
          rebuildGrid();
        }
      } catch {
        // Invalid JSON
      }
      importFileInput.value = '';
    };
    reader.readAsText(file);
  });

  // Listen for glyph updates to refresh cards
  window.addEventListener('glyph-updated', (e) => {
    const char = e.detail;
    const glyph = getGlyph(char);
    const currentSettings = getSettings();
    updateCard(glyphGrid, char, glyph, currentSettings);
    updateProgress();
  });

  // Start Animation Loop
  let lastBoilAdvance = 0;
  let currentBoilFrame = 0;
  const BOIL_FPS = 8; // Boil updates 8 times a second
  const BOIL_INTERVAL = 1000 / BOIL_FPS;

  function animationLoop(timestamp) {
    if (lineBoilCheckbox.checked) {
      if (timestamp - lastBoilAdvance > BOIL_INTERVAL) {
        currentBoilFrame = (currentBoilFrame + 1) % BOIL_FRAMES;
        lastBoilAdvance = timestamp;

        const currentSettings = getSettings();
        const glyphs = getGlyphSet(activeChars);

        const getCustomStrokes = (char, fallbackStrokes) => {
          const frames = getBoilFrames(char, fallbackStrokes);
          return frames[currentBoilFrame] || fallbackStrokes;
        };

        // Update preview (skip if reveal animation is playing)
        if (!preview.isPlaying && (!previewSection.classList.contains('preview-section--collapsed') || !isMobile())) {
          preview.render(getCustomStrokes);
        }

        // Update grid
        refreshAllThumbnailsBoilFrame(glyphGrid, glyphs, currentSettings, getCustomStrokes);
      }
    } else {
      // If the checkbox was just unchecked, ensure we are not stuck halfway through a boil frame tick
      lastBoilAdvance = 0;
    }
    requestAnimationFrame(animationLoop);
  }

  // Kick off animation loop
  requestAnimationFrame(animationLoop);
}

function updateProgress() {
  const count = getDrawnCount(activeChars);
  document.getElementById('progressCount').textContent = count + ' / ' + activeChars.length;
  const noGlyphs = count === 0;
  document.getElementById('exportBtn').disabled = noGlyphs;
  document.getElementById('exportJsBtn').disabled = noGlyphs;
}

// Make updateProgress available for other modules
window.updateProgress = updateProgress;

init();
