import { getGlyph } from './glyphs.js';
import { getBoilFrames, BOIL_FRAMES } from './boil.js';

function getGlyphDuration(strokes) {
  if (!strokes || strokes.length === 0) return 500;
  let maxT = 0;
  for (const s of strokes) for (const p of s) if (p.t !== undefined && p.t > maxT) maxT = p.t;
  return maxT > 0 ? maxT : 500;
}

function buildGlyphData(text, settings) {
  const glyphs = {};
  const chars = [];
  for (const char of text) {
    if (char === ' ') {
      chars.push({ char: ' ', duration: 0 });
      continue;
    }
    const glyph = getGlyph(char);
    const strokes = (glyph.strokes && glyph.strokes.length > 0) ? glyph.strokes : [];
    const duration = getGlyphDuration(strokes);
    const kl = (glyph.kerningLeft !== null || glyph.kerningRight !== null) ? (glyph.kerningLeft || 0) : null;
    const kr = (glyph.kerningLeft !== null || glyph.kerningRight !== null) ? (glyph.kerningRight || 0) : null;

    if (!glyphs[char]) {
      // Pre-generate boil frames
      const boilFrames = getBoilFrames(char, strokes);
      // Strip timing from boil frames (only need x,y)
      const boilData = boilFrames.map(frame =>
        frame.map(stroke => stroke.map(p => [p.x, p.y]))
      );
      // Original strokes with timing
      const strokeData = strokes.map(stroke => stroke.map(p => {
        const arr = [p.x, p.y];
        if (p.t !== undefined) arr.push(p.t);
        return arr;
      }));
      glyphs[char] = { strokes: strokeData, boil: boilData, kl, kr };
    }

    chars.push({ char, duration });
  }
  return { glyphs, chars };
}

function generateHTML(text, settings, fontName, mode) {
  const { glyphs, chars } = buildGlyphData(text, settings);
  const { strokeWidth, kerning, brushType } = settings;

  // Compact the data
  const data = JSON.stringify({
    text, glyphs, chars, strokeWidth, kerning, brushType, mode
  });

  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${fontName || 'FontMaker'} Animation</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:transparent;display:flex;align-items:center;justify-content:center;min-height:100vh}
canvas{max-width:100%;height:auto}
</style>
</head><body>
<canvas id="c"></canvas>
<script>
(function(){
const D=${data};
const BOIL_FRAMES=4,BOIL_FPS=8,REVEAL_FPS=30,DEFAULT_DUR=500;
const canvas=document.getElementById('c');
const ctx=canvas.getContext('2d');

// Layout
const S=120,BL=20,CH=S+BL*2,PAD=S*0.3;
const spaceAdv=S*400/1000;
let totalW=0;
for(const c of D.text){
  if(c===' '){totalW+=spaceAdv;continue}
  const g=D.glyphs[c];if(!g)continue;
  const hp=g.kl!==null;
  const kl=hp?g.kl:0,kr=hp?g.kr:0;
  const k=hp?(kl+kr):D.kerning;
  totalW+=S*(650+k)/1000;
}
const CW=Math.ceil(totalW)+PAD*2;
canvas.width=CW;canvas.height=CH;
canvas.style.width=CW/2+'px';canvas.style.height=CH/2+'px';

function drawStroke(pts,lw,bt,ox,oy,w,h){
  if(pts.length<2)return;
  if(bt==='growing'){drawGrowing(pts,lw,ox,oy,w,h);return}
  if(bt==='rough'){drawRough(pts,lw,ox,oy,w,h);return}
  ctx.save();ctx.lineWidth=lw;ctx.lineCap='round';ctx.lineJoin='round';
  ctx.beginPath();ctx.moveTo(ox+pts[0][0]*w,oy+pts[0][1]*h);
  for(let i=1;i<pts.length-1;i++){
    const xc=ox+(pts[i][0]+pts[i+1][0])/2*w;
    const yc=oy+(pts[i][1]+pts[i+1][1])/2*h;
    ctx.quadraticCurveTo(ox+pts[i][0]*w,oy+pts[i][1]*h,xc,yc);
  }
  const l=pts[pts.length-1];ctx.lineTo(ox+l[0]*w,oy+l[1]*h);
  ctx.stroke();ctx.restore();
}
function drawGrowing(pts,lw,ox,oy,w,h){
  const mn=lw*0.25;ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
  let cd=0;
  for(let i=1;i<pts.length;i++){
    const p=pts[i-1],c=pts[i];
    const dx=(c[0]-p[0])*w,dy=(c[1]-p[1])*h;
    cd+=Math.sqrt(dx*dx+dy*dy)/w;
    const t=Math.min(1,cd/0.4),e=1-(1-t)*(1-t);
    ctx.lineWidth=mn+(lw-mn)*e;
    ctx.beginPath();ctx.moveTo(ox+p[0]*w,oy+p[1]*h);
    ctx.lineTo(ox+c[0]*w,oy+c[1]*h);ctx.stroke();
  }
  ctx.restore();
}
function drawRough(pts,lw,ox,oy,w,h){
  const a=lw*0.15/w;
  ctx.save();ctx.lineWidth=lw;ctx.lineCap='round';ctx.lineJoin='round';
  ctx.beginPath();ctx.moveTo(ox+pts[0][0]*w,oy+pts[0][1]*h);
  for(let i=1;i<pts.length-1;i++){
    const j=jit(pts[i][0],pts[i][1],i,a),j1=jit(pts[i+1][0],pts[i+1][1],i+1,a);
    const cpx=ox+(pts[i][0]+j[0])*w,cpy=oy+(pts[i][1]+j[1])*h;
    const xc=ox+((pts[i][0]+j[0]+pts[i+1][0]+j1[0])/2)*w;
    const yc=oy+((pts[i][1]+j[1]+pts[i+1][1]+j1[1])/2)*h;
    ctx.quadraticCurveTo(cpx,cpy,xc,yc);
  }
  const l=pts[pts.length-1];ctx.lineTo(ox+l[0]*w,oy+l[1]*h);
  ctx.stroke();ctx.restore();
}
function jit(x,y,i,a){
  const h1=hs(x*10000+y*100+i),h2=hs(y*10000+x*100+i+9973);
  return[(h1-0.5)*2*a,(h2-0.5)*2*a];
}
function hs(n){let x=Math.sin(n)*43758.5453;return x-Math.floor(x)}

function renderFrame(getStrokes){
  ctx.clearRect(0,0,CW,CH);
  let x=PAD,ci=0;
  ctx.strokeStyle='#fff';
  for(const ch of D.text){
    if(ch===' '){x+=spaceAdv;continue}
    const g=D.glyphs[ch];if(!g){ci++;continue}
    const hp=g.kl!==null;
    const kl=hp?g.kl:0,kr=hp?g.kr:0;
    const k=hp?(kl+kr):D.kerning;
    const adv=S*(650+k)/1000,lo=S*kl/1000;
    const lw=D.strokeWidth*(S/200);
    const strokes=getStrokes(ch,ci,g);
    if(strokes&&strokes.length>0){
      for(const s of strokes){if(s.length>=2)drawStroke(s,lw,D.brushType,x+lo,BL,S,S)}
    }
    x+=adv;ci++;
  }
}

function getPartial(strokes,elapsed){
  const hasT=strokes.some(s=>s.some(p=>p.length>2));
  if(!hasT){
    const tot=strokes.reduce((n,s)=>n+s.length,0);
    const frac=Math.min(1,elapsed/DEFAULT_DUR);
    const show=Math.ceil(tot*frac);const r=[];let c=0;
    for(const s of strokes){if(c>=show)break;const rem=show-c;
      if(rem>=s.length){r.push(s);c+=s.length}else{r.push(s.slice(0,rem));c+=rem}}
    return r;
  }
  const r=[];
  for(const s of strokes){
    if(s[0].length>2&&s[0][2]>elapsed)break;
    const v=s.filter(p=>p.length<=2||p[2]<=elapsed);
    if(v.length>=2)r.push(v);
  }
  return r;
}

// Build timeline
let cum=0;
for(const c of D.chars){c.st=cum;cum+=c.duration}
const totalDur=cum;

// Animation
const mode=D.mode;
const hasBoil=mode==='boil'||mode==='both';
const hasReveal=mode==='reveal'||mode==='both';
let boilFrame=0,lastBoilT=0;
const boilInterval=1000/BOIL_FPS;

function tick(ts){
  if(ts-lastBoilT>boilInterval){boilFrame=(boilFrame+1)%BOIL_FRAMES;lastBoilT=ts}

  if(hasReveal){
    const elapsed=(ts*1)%(totalDur+1500);// loop with 1.5s pause at end
    renderFrame((ch,ci,g)=>{
      let ns=0,ti=0;
      for(let i=0;i<D.chars.length;i++){if(D.chars[i].char!==' '){if(ns===ci){ti=i;break}ns++}}
      const c=D.chars[ti];if(!g.strokes||g.strokes.length===0)return[];
      const ge=elapsed-c.st;
      if(ge<0)return[];
      if(ge>=c.duration){
        return hasBoil?g.boil[boilFrame%g.boil.length]:g.strokes;
      }
      return getPartial(g.strokes,ge);
    });
  }else{
    // Boil only
    renderFrame((ch,ci,g)=>{
      if(!g.boil||g.boil.length===0)return[];
      return g.boil[boilFrame%g.boil.length];
    });
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
})();
</script></body></html>`;
}

export function exportHTML(text, settings, fontName, mode = 'boil') {
  if (!text) return;
  const html = generateHTML(text, settings, fontName, mode);
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const sanitized = (fontName || 'MyFont').replace(/[^a-zA-Z0-9]/g, '');
  a.download = sanitized + '-animation.html';
  a.click();
  URL.revokeObjectURL(url);
}
