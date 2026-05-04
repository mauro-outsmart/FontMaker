import { getGlyph, getAllGlyphs, getSettings } from './glyphs.js';
import { getBoilFrames } from './boil.js';

function buildAllGlyphData() {
  const settings = getSettings();
  const allGlyphs = getAllGlyphs();
  const glyphs = {};

  for (const glyph of allGlyphs) {
    if (!glyph.strokes || glyph.strokes.length === 0) continue;
    const char = glyph.char;
    const strokes = glyph.strokes;
    const kl = (glyph.kerningLeft !== null || glyph.kerningRight !== null) ? (glyph.kerningLeft || 0) : null;
    const kr = (glyph.kerningLeft !== null || glyph.kerningRight !== null) ? (glyph.kerningRight || 0) : null;

    // Pre-generate boil frames
    const boilFrames = getBoilFrames(char, strokes);
    const boilData = boilFrames.map(frame =>
      frame.map(stroke => stroke.map(p => [p.x, p.y]))
    );
    // Original strokes with timing
    const strokeData = strokes.map(stroke => stroke.map(p => {
      const arr = [p.x, p.y];
      if (p.t !== undefined) arr.push(p.t);
      return arr;
    }));
    // Duration
    let maxT = 0;
    for (const s of strokes) for (const p of s) if (p.t !== undefined && p.t > maxT) maxT = p.t;
    const duration = maxT > 0 ? maxT : 500;

    glyphs[char] = { s: strokeData, b: boilData, kl, kr, d: duration };
  }

  return { glyphs, strokeWidth: settings.strokeWidth, kerning: settings.kerning, brushType: settings.brushType };
}

function generateJS(fontName) {
  const data = buildAllGlyphData();
  const json = JSON.stringify(data);

  return `(function(){
"use strict";
const F=${json};
const BF=4,BFPS=8,DD=500;

function ds(ctx,pts,lw,bt,ox,oy,w,h,col){
if(pts.length<2)return;
ctx.strokeStyle=col;
if(bt==='growing'){dg(ctx,pts,lw,ox,oy,w,h);return}
if(bt==='rough'){dr(ctx,pts,lw,ox,oy,w,h);return}
ctx.save();ctx.lineWidth=lw;ctx.lineCap='round';ctx.lineJoin='round';
ctx.beginPath();ctx.moveTo(ox+pts[0][0]*w,oy+pts[0][1]*h);
for(let i=1;i<pts.length-1;i++){
const xc=ox+(pts[i][0]+pts[i+1][0])/2*w;
const yc=oy+(pts[i][1]+pts[i+1][1])/2*h;
ctx.quadraticCurveTo(ox+pts[i][0]*w,oy+pts[i][1]*h,xc,yc);}
const l=pts[pts.length-1];ctx.lineTo(ox+l[0]*w,oy+l[1]*h);
ctx.stroke();ctx.restore();}

function dor(ctx,strokes,ox,oy,w,h,col){
ctx.save();ctx.fillStyle=col;ctx.beginPath();
for(const s of strokes){
if(!s||s.length<3)continue;
ctx.moveTo(ox+s[0][0]*w,oy+s[0][1]*h);
for(let i=1;i<s.length;i++)ctx.lineTo(ox+s[i][0]*w,oy+s[i][1]*h);
ctx.closePath();}
ctx.fill('evenodd');ctx.restore();}

function dg(ctx,pts,lw,ox,oy,w,h){
const mn=lw*0.25;ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
let cd=0;
for(let i=1;i<pts.length;i++){
const p=pts[i-1],c=pts[i];
const dx=(c[0]-p[0])*w,dy=(c[1]-p[1])*h;
cd+=Math.sqrt(dx*dx+dy*dy)/w;
const t=Math.min(1,cd/0.4),e=1-(1-t)*(1-t);
ctx.lineWidth=mn+(lw-mn)*e;
ctx.beginPath();ctx.moveTo(ox+p[0]*w,oy+p[1]*h);
ctx.lineTo(ox+c[0]*w,oy+c[1]*h);ctx.stroke();}
ctx.restore();}

function dr(ctx,pts,lw,ox,oy,w,h){
const a=lw*0.15/w;
ctx.save();ctx.lineWidth=lw;ctx.lineCap='round';ctx.lineJoin='round';
ctx.beginPath();ctx.moveTo(ox+pts[0][0]*w,oy+pts[0][1]*h);
for(let i=1;i<pts.length-1;i++){
const j=jt(pts[i][0],pts[i][1],i,a),j1=jt(pts[i+1][0],pts[i+1][1],i+1,a);
const cpx=ox+(pts[i][0]+j[0])*w,cpy=oy+(pts[i][1]+j[1])*h;
const xc=ox+((pts[i][0]+j[0]+pts[i+1][0]+j1[0])/2)*w;
const yc=oy+((pts[i][1]+j[1]+pts[i+1][1]+j1[1])/2)*h;
ctx.quadraticCurveTo(cpx,cpy,xc,yc);}
const l=pts[pts.length-1];ctx.lineTo(ox+l[0]*w,oy+l[1]*h);
ctx.stroke();ctx.restore();}

function jt(x,y,i,a){
const h1=hs(x*10000+y*100+i),h2=hs(y*10000+x*100+i+9973);
return[(h1-0.5)*2*a,(h2-0.5)*2*a];}
function hs(n){let x=Math.sin(n)*43758.5453;return x-Math.floor(x)}

function gp(strokes,elapsed){
const hasT=strokes.some(s=>s.some(p=>p.length>2));
if(!hasT){
const tot=strokes.reduce((n,s)=>n+s.length,0);
const frac=Math.min(1,elapsed/DD);
const show=Math.ceil(tot*frac);const r=[];let c=0;
for(const s of strokes){if(c>=show)break;const rem=show-c;
if(rem>=s.length){r.push(s);c+=s.length}else{r.push(s.slice(0,rem));c+=rem}}
return r;}
const r=[];
for(const s of strokes){
if(s[0].length>2&&s[0][2]>elapsed)break;
const v=s.filter(p=>p.length<=2||p[2]<=elapsed);
if(v.length>=2)r.push(v);}
return r;}

class FontAnim extends HTMLElement{
static get observedAttributes(){return['mode','speed','color','size']}
constructor(){
super();
this._shadow=this.attachShadow({mode:'open'});
this._canvas=document.createElement('canvas');
this._shadow.appendChild(this._canvas);
this._ctx=this._canvas.getContext('2d');
this._raf=null;this._boilFrame=0;this._lastBoilT=0;this._startTs=0;
this._text='';this._running=false;
}
connectedCallback(){
this._text=this.textContent||'';
new MutationObserver(()=>{
const t=this.textContent||'';
if(t!==this._text){this._text=t;this._restart();}
}).observe(this,{childList:true,characterData:true,subtree:true});
this._restart();
}
disconnectedCallback(){if(this._raf)cancelAnimationFrame(this._raf);this._running=false;}
attributeChangedCallback(){this._restart();}

get _mode(){return this.getAttribute('mode')||'static'}
get _speed(){return parseFloat(this.getAttribute('speed'))||1}
get _color(){return this.getAttribute('color')||'#ffffff'}
get _size(){return parseInt(this.getAttribute('size'))||48}

_restart(){
if(this._raf)cancelAnimationFrame(this._raf);
this._startTs=0;this._boilFrame=0;this._lastBoilT=0;
this._running=true;
this._layout();
if(this._mode==='static'){
this._renderFrame((ch,ci,g)=>g.s||[]);
this._running=false;return;}
this._raf=requestAnimationFrame(ts=>this._tick(ts));
}

_layout(){
const S=this._size;
const BL=Math.round(S*0.17);
const spaceAdv=S*400/1000;
let totalW=0;
for(const ch of this._text){
if(ch===' '){totalW+=spaceAdv;continue}
const g=F.glyphs[ch];if(!g)continue;
const hp=g.kl!==null;
const kl=hp?g.kl:0,kr=hp?g.kr:0;
const k=hp?(kl+kr):F.kerning;
totalW+=S*(650+k)/1000;}
const pad=S*0.3;
this._S=S;this._BL=BL;this._pad=pad;
this._totalW=totalW;
const cw=Math.ceil(totalW+pad*2);
const ch=S+BL*2;
const dpr=window.devicePixelRatio||1;
this._canvas.width=cw*dpr;this._canvas.height=ch*dpr;
this._canvas.style.width=cw+'px';this._canvas.style.height=ch+'px';
this._canvas.style.display='block';
this._ctx.scale(dpr,dpr);
this._cw=cw;this._ch=ch;this._dpr=dpr;
// Build timeline for reveal
this._chars=[];
let cum=0;
for(const ch of this._text){
if(ch===' '){this._chars.push({char:' ',d:0,st:cum});continue}
const g=F.glyphs[ch];
const d=g?g.d:0;
this._chars.push({char:ch,d:d,st:cum});
cum+=d;}
this._totalDur=cum;
}

_renderFrame(getStrokes){
const ctx=this._ctx;const S=this._S;const dpr=this._dpr;
ctx.save();ctx.setTransform(dpr,0,0,dpr,0,0);
ctx.clearRect(0,0,this._cw,this._ch);
const spaceAdv=S*400/1000;
const col=this._color;
let x=this._pad,ci=0;
for(const ch of this._text){
if(ch===' '){x+=spaceAdv;continue}
const g=F.glyphs[ch];if(!g){ci++;continue}
const hp=g.kl!==null;
const kl=hp?g.kl:0,kr=hp?g.kr:0;
const k=hp?(kl+kr):F.kerning;
const adv=S*(650+k)/1000,lo=S*kl/1000;
const lw=F.strokeWidth*(S/200);
const strokes=getStrokes(ch,ci,g);
if(strokes&&strokes.length>0){
if(F.brushType==='original'){dor(ctx,strokes,x+lo,this._BL,S,S,col)}
else{for(const s of strokes){if(s.length>=2)ds(ctx,s,lw,F.brushType,x+lo,this._BL,S,S,col)}}}
x+=adv;ci++;}
ctx.restore();
}

_tick(ts){
if(!this._running)return;
if(!this._startTs)this._startTs=ts;
const bi=1000/BFPS;
if(ts-this._lastBoilT>bi){this._boilFrame=(this._boilFrame+1)%BF;this._lastBoilT=ts}
const mode=this._mode;
const hasBoil=mode==='boil'||mode==='both';
const hasReveal=mode==='reveal'||mode==='both';
const speed=this._speed;
const bf=this._boilFrame;

if(hasReveal&&this._totalDur>0){
const elapsed=((ts-this._startTs)*speed)%(this._totalDur+1500);
let ni=0;
this._renderFrame((ch,ci,g)=>{
const c=this._chars.filter(c=>c.char!==' ')[ci];
if(!c||!g.s||g.s.length===0)return[];
const ge=elapsed-c.st;
if(ge<0)return[];
if(ge>=c.d)return hasBoil?g.b[bf%g.b.length]:g.s;
return gp(g.s,ge);});
}else{
this._renderFrame((ch,ci,g)=>{
if(!g.b||g.b.length===0)return g.s||[];
return g.b[bf%g.b.length];});}

this._raf=requestAnimationFrame(ts2=>this._tick(ts2));
}
}
customElements.define('font-anim',FontAnim);
})();`;
}

export function exportWebFont(fontName) {
  const js = generateJS(fontName);
  const blob = new Blob([js], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const sanitized = (fontName || 'MyFont').replace(/[^a-zA-Z0-9]/g, '');
  a.download = sanitized + '.js';
  a.click();
  URL.revokeObjectURL(url);
}
