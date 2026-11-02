/**
 * The motion kit (owner, 2026-10-28): a fixed animation runtime injected into
 * every demo document, so the demo builder writes only SCENE code (~60–150
 * lines: objects + a timeline) instead of a whole player each time. That is
 * the token lever — the player, easing, effects, chrome and free-play
 * controls ship once, here, and look the same in every lesson.
 *
 * Look and feel: a dark 3Blue1Brown-style stage, a timeline you scrub,
 * captions as subtitles, predict pauses as diamonds on the track, speed and
 * loop. API reference for the builder lives in demo-builder.ts.
 *
 * Seek model: every object has an init state; each animation captures its
 * from/to at build time. seek(t) resets objects to init and re-applies every
 * started animation in order — so scrubbing backwards is exact.
 *
 * NOTE: the source is a plain string — keep it free of backticks and "${".
 */
export const MOTION_KIT_JS = `(function(){
"use strict";
if (window.LH) return;
var NS="http://www.w3.org/2000/svg";
var C={bg:"#0e0f12",ink:"#ececec",dim:"#8b8f98",faint:"#3a3f48",grid:"#1f3a4d",
 blue:"#58c4dd",teal:"#5cd0b3",green:"#83c167",yellow:"#ffe066",gold:"#f0ac5f",red:"#fc6255",
 purple:"#9a72ac",pink:"#d147bd",white:"#ececec",grey:"#8b8f98"};
var reduce=false;try{reduce=matchMedia("(prefers-reduced-motion: reduce)").matches}catch(e){}
var EASE={
 smooth:function(t){return t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2},
 linear:function(t){return t},
 out:function(t){return 1-Math.pow(1-t,3)},
 "in":function(t){return t*t*t},
 back:function(t){var c=1.70158,c3=c+1;return 1+c3*Math.pow(t-1,3)+c*Math.pow(t-1,2)},
 there:function(t){var s=Math.sin(Math.PI*t);return s*s}
};
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function col(c){return c==null?c:(C[c]||c)}
function rgb(c){c=col(c);if(!c)return null;var m=/rgba?\\(([\\d.]+)[ ,]+([\\d.]+)[ ,]+([\\d.]+)/.exec(c);if(m)return[+m[1],+m[2],+m[3]];if(c[0]!=="#")return null;if(c.length===4)c="#"+c[1]+c[1]+c[2]+c[2]+c[3]+c[3];
 var n=parseInt(c.slice(1),16);return[(n>>16)&255,(n>>8)&255,n&255]}
function mixc(a,b,t){var A=rgb(a),B=rgb(b);if(!A||!B)return t<.5?col(a):col(b);
 return"rgb("+Math.round(A[0]+(B[0]-A[0])*t)+","+Math.round(A[1]+(B[1]-A[1])*t)+","+Math.round(A[2]+(B[2]-A[2])*t)+")"}
function mk(tag,a,parent){var e=document.createElementNS(NS,tag);for(var k in a)if(a[k]!=null)e.setAttribute(k,a[k]);if(parent)parent.appendChild(e);return e}
function h(tag,cls,parent,html){var e=document.createElement(tag);if(cls)e.className=cls;if(html!=null)e.innerHTML=html;if(parent)parent.appendChild(e);return e}

var CSS=[
"html,body{margin:0;background:#0e0f12;color:#ececec;font-family:system-ui,-apple-system,'Segoe UI',sans-serif}",
".lh-scene{position:relative;background:#0e0f12;border-radius:14px;overflow:hidden;outline:none;user-select:none;-webkit-user-select:none}",
".lh-scene:focus-visible{box-shadow:0 0 0 2px #58c4dd}",
".lh-stage{display:block;width:100%;height:auto;cursor:pointer}",
".lh-stage text{font-family:system-ui,-apple-system,'Segoe UI',sans-serif}",
".lh-stage .lh-m{font-family:'Latin Modern Math','STIX Two Math','Cambria Math','Times New Roman',serif}",
".lh-view{position:relative}",
".lh-cap{min-height:2.9em;display:block;text-align:center;font-size:16px;line-height:1.45;color:#ececec;padding:6px 20px 2px;transition:opacity .4s cubic-bezier(.2,.7,.2,1),transform .4s cubic-bezier(.2,.7,.2,1)}",
".lh-cap.out{opacity:0;transform:translateY(6px)}",
".lh-cap i{font-family:'Latin Modern Math','STIX Two Math','Cambria Math','Times New Roman',serif;font-size:1.08em}",
".lh-cap b{color:#ffe066;font-weight:600}",
".lh-bar{display:flex;align-items:center;gap:10px;padding:6px 14px 12px;transition:opacity .35s ease}",
".lh-scene.playing .lh-bar{opacity:.55}",
".lh-scene.playing:hover .lh-bar,.lh-scene.playing:focus-within .lh-bar{opacity:1}",
".lh-btn{appearance:none;border:0;background:transparent;color:#ececec;width:34px;height:34px;border-radius:50%;display:grid;place-items:center;cursor:pointer;opacity:.8;transition:opacity .2s,background .2s,transform .15s;flex:none}",
".lh-btn:hover{opacity:1;background:rgba(255,255,255,.09)}",
".lh-btn:active{transform:scale(.92)}",
".lh-btn svg{width:16px;height:16px}",
".lh-btn.lh-play{width:40px;height:40px;opacity:1;background:rgba(255,255,255,.12)}",
".lh-btn.on{color:#58c4dd;opacity:1}",
".lh-track{position:relative;flex:1;height:24px;cursor:pointer;touch-action:none}",
".lh-rail{position:absolute;left:0;right:0;top:10px;height:4px;border-radius:2px;background:rgba(255,255,255,.16);transition:height .18s,top .18s}",
".lh-track:hover .lh-rail{height:6px;top:9px}",
".lh-fill{position:absolute;left:0;top:0;bottom:0;border-radius:2px;background:linear-gradient(90deg,#3d9ab3,#58c4dd);box-shadow:0 0 10px rgba(88,196,221,.5)}",
".lh-knob{position:absolute;top:12px;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;background:#fff;box-shadow:0 0 0 5px rgba(88,196,221,.22);transform:scale(0);transition:transform .18s cubic-bezier(.3,1.6,.5,1)}",
".lh-track:hover .lh-knob,.lh-scene:not(.playing) .lh-knob,.lh-track.drag .lh-knob{transform:scale(1)}",
".lh-tick{position:absolute;top:12px;width:2px;height:8px;margin:-4px 0 0 -1px;border-radius:1px;background:rgba(255,255,255,.4)}",
".lh-pin{position:absolute;top:12px;width:9px;height:9px;margin:-4.5px 0 0 -4.5px;background:#ffe066;transform:rotate(45deg);border-radius:2px;box-shadow:0 0 8px rgba(255,224,102,.6)}",
".lh-time{font:12px ui-monospace,SFMono-Regular,Consolas,monospace;color:#9aa0a8;font-variant-numeric:tabular-nums;white-space:nowrap;flex:none}",
".lh-speed{appearance:none;font:600 12px system-ui,sans-serif;color:#ececec;background:rgba(255,255,255,.1);border:0;border-radius:999px;height:28px;padding:0 10px;min-width:46px;cursor:pointer;flex:none;transition:background .2s}",
".lh-speed:hover{background:rgba(255,255,255,.18)}",
".lh-poster{position:absolute;inset:0;display:flex;flex-direction:column;gap:18px;align-items:center;justify-content:center;background:radial-gradient(ellipse at center,rgba(88,196,221,.10),rgba(14,15,18,.0) 60%),#0e0f12;transition:opacity .5s ease,visibility .5s;cursor:pointer}",
".lh-poster h1{margin:0;font:italic 400 28px 'Latin Modern Math','STIX Two Math','Cambria Math','Times New Roman',serif;color:#ececec;text-align:center;padding:0 24px}",
".lh-poster span{width:72px;height:72px;border-radius:50%;background:#58c4dd;display:grid;place-items:center;box-shadow:0 0 0 10px rgba(88,196,221,.14),0 0 48px rgba(88,196,221,.45);transition:transform .25s cubic-bezier(.3,1.6,.5,1)}",
".lh-poster:hover span{transform:scale(1.07)}",
".lh-poster span svg{width:28px;height:28px;margin-left:4px;color:#0e0f12}",
".lh-scene.started .lh-poster{opacity:0;visibility:hidden}",
".lh-ask{position:absolute;inset:0;display:grid;place-items:center;background:rgba(8,9,11,.5);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);opacity:0;visibility:hidden;transition:opacity .35s,visibility .35s}",
".lh-ask.show{opacity:1;visibility:visible}",
".lh-ask>div{max-width:min(440px,80%);text-align:center;padding:20px 24px;border-radius:16px;background:#16181d;border:1px solid rgba(255,224,102,.35);box-shadow:0 18px 50px rgba(0,0,0,.45);transform:translateY(10px) scale(.97);transition:transform .45s cubic-bezier(.2,1.3,.4,1)}",
".lh-ask.show>div{transform:none}",
".lh-ask small{display:block;font-size:11px;font-weight:700;letter-spacing:.14em;color:#ffe066;margin-bottom:8px}",
".lh-ask p{margin:0 0 16px;font-size:17px;line-height:1.45}",
".lh-ask i{font-family:'Latin Modern Math','STIX Two Math','Cambria Math','Times New Roman',serif}",
".lh-ask button{appearance:none;border:0;border-radius:999px;background:#ffe066;color:#0e0f12;font:600 14px system-ui,sans-serif;padding:9px 18px;cursor:pointer;transition:transform .15s}",
".lh-ask button:hover{transform:scale(1.04)}",
".lh-controls{display:flex;flex-wrap:wrap;gap:12px 24px;margin:4px 14px 14px;padding:14px 16px;align-items:center;border-radius:12px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.06)}",
".lh-controls:empty{display:none}",
".lh-ctl{display:flex;align-items:center;gap:12px;font-size:13px;color:#c9ccd2;flex:1 1 240px;min-width:0}",
".lh-ctl label{white-space:nowrap}",
".lh-ctl input[type=range]{-webkit-appearance:none;appearance:none;flex:1;min-width:80px;height:4px;border-radius:2px;background:rgba(255,255,255,.16);outline:none}",
".lh-ctl input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:var(--c,#ffe066);box-shadow:0 0 0 5px rgba(255,255,255,.07),0 0 14px var(--c,#ffe066);cursor:pointer;transition:transform .15s}",
".lh-ctl input[type=range]::-webkit-slider-thumb:hover{transform:scale(1.15)}",
".lh-ctl input[type=range]::-moz-range-thumb{width:16px;height:16px;border:0;border-radius:50%;background:var(--c,#ffe066)}",
".lh-val{font:12px ui-monospace,SFMono-Regular,Consolas,monospace;color:#ececec;font-variant-numeric:tabular-nums;min-width:48px}",
".lh-tog{appearance:none;border:1px solid rgba(255,255,255,.16);background:transparent;color:#c9ccd2;border-radius:999px;height:30px;padding:0 14px;font:500 13px system-ui,sans-serif;cursor:pointer;transition:all .2s}",
".lh-tog.on{border-color:var(--c,#58c4dd);color:var(--c,#58c4dd);background:rgba(88,196,221,.1)}",
".lh-read{font:14px ui-monospace,SFMono-Regular,Consolas,monospace;color:#ececec;padding:4px 12px;border-radius:8px;background:rgba(255,255,255,.06)}",
"@media (prefers-reduced-motion:reduce){.lh-cap,.lh-bar,.lh-poster,.lh-ask,.lh-ask>div{transition:none}}"
].join("\\n");

var IC={
 play:'<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4.5 2.6v10.8L13.2 8z"/></svg>',
 pause:'<svg viewBox="0 0 16 16" fill="currentColor"><rect x="3.6" y="2.8" width="3" height="10.4" rx=".8"/><rect x="9.4" y="2.8" width="3" height="10.4" rx=".8"/></svg>',
 replay:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8a5 5 0 1 0 1.6-3.7"/><path d="M3 2.6v3h3"/></svg>',
 loop:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 7V6a2.5 2.5 0 0 1 2.5-2.5h7.5"/><path d="M10.5 1.5l2 2-2 2"/><path d="M13.5 9v1a2.5 2.5 0 0 1-2.5 2.5H3.5"/><path d="M5.5 14.5l-2-2 2-2"/></svg>'
};

/* ---- math text: x^2, a_n, italic single letters, upright fn names ---- */
var FN={sin:1,cos:1,tan:1,log:1,ln:1,exp:1,lim:1,max:1,min:1,det:1,mod:1,arg:1,softmax:1,ReLU:1};
function mathInto(t,str){
 var re=/(\\^\\{[^}]*\\}|\\^.|_\\{[^}]*\\}|_.|[A-Za-z]+|[^A-Za-z^_]+)/g,m;
 while((m=re.exec(str))){var s=m[0];
  if(s[0]==="^"||s[0]==="_"){var body=s[1]==="{"?s.slice(2,-1):s.slice(1);
   var sp=mk("tspan",{"baseline-shift":s[0]==="^"?"super":"sub","font-size":"68%"},t);mathInto(sp,body);
   mk("tspan",{"font-size":"100%"},t).textContent="\\u200a";continue}
  var ts=mk("tspan",{},t);ts.textContent=s;
  if(/^[A-Za-z]+$/.test(s)&&!FN[s])ts.setAttribute("font-style","italic")}
}

/* ---------------------------------- objects ---------------------------------- */
function Obj(scene,el,kind,o){
 this.scene=scene;this.el=el;this.kind=kind;this.o=o||{};this.dash=el.style?el.style.strokeDasharray:"";
 this.init={tx:0,ty:0,sc:1,op:1,draw:1,color:null};this.children=null;this.touched=false;
 /* o.opacity lives in stroke/fill-opacity so element opacity stays free for animation */
 this.fo=(this.o.fillOpacity==null?1:this.o.fillOpacity)*(this.o.opacity==null?1:this.o.opacity);
 if(this.o.opacity!=null&&el.style){el.style.strokeOpacity=this.o.opacity;el.style.fillOpacity=this.fo}
}
Obj.prototype.st=function(){return this._v||(this._v=copy(this.init))};
Obj.prototype.reset=function(){this.cur=copy(this.init)};
Obj.prototype.apply=function(){var s=this.cur,e=this.el;
 if(this._base===undefined)this._base=(this.kind==="text"||this.kind==="dot")?e.style.fill:e.style.stroke;
 e.style.transform="translate("+s.tx+"px,"+s.ty+"px) scale("+s.sc+")";
 e.style.opacity=s.op;
 if(this.drawable){if(s.draw>=1){e.style.strokeDasharray=this.dash||"";e.style.strokeDashoffset=""}
  else{var len=this.len||(this.len=(e.getTotalLength&&e.getTotalLength())||1000);e.style.strokeDasharray=len+" "+len;e.style.strokeDashoffset=String(len*(1-s.draw))}
  if(this.hasFill)e.style.fillOpacity=String(clamp((s.draw-.55)/.45,0,1)*this.fo)}
 var cc=s.color==null?this._base:s.color;if(cc){if(this.kind==="text"||this.kind==="dot")e.style.fill=cc;else e.style.stroke=cc}
};
function copy(s){return{tx:s.tx,ty:s.ty,sc:s.sc,op:s.op,draw:s.draw,color:s.color}}
function styleShape(e,o,defStroke){
 var st=col(o.color||o.stroke||defStroke),fl=col(o.fill);
 e.style.stroke=st||"none";e.style.strokeWidth=(o.width||2.5)+"px";e.style.strokeLinecap="round";e.style.strokeLinejoin="round";
 e.style.fill=fl||"none";if(o.fillOpacity!=null)e.style.fillOpacity=o.fillOpacity;
 if(o.dash)e.style.strokeDasharray=o.dash===true?"6 5":o.dash;
 if(o.glow)e.setAttribute("filter","url(#lh-glow)");
 e.style.transformBox="fill-box";e.style.transformOrigin="center";
}

/* ---------------------------------- scene ---------------------------------- */
var scenes=[];
function Scene(opts){
 opts=opts||{};var self=this;this.w=opts.width||720;this.h=opts.height||380;
 if(!document.getElementById("lh-css")){var css=document.createElement("style");css.id="lh-css";css.textContent=CSS;(document.head||document.documentElement).appendChild(css)}
 this.objs=[];this.tl=[];this.caps=[];this.pauses=[];this.cursor=0;this.t=0;this.speed=1;this.loop=false;
 this.playing=false;this.passed={};
 var host=opts.el||document.body;
 this.root=h("div","lh-scene",host);this.root.tabIndex=0;
 var view=h("div","lh-view",this.root);
 this.svg=mk("svg",{viewBox:"0 0 "+this.w+" "+this.h,"class":"lh-stage",role:"img","aria-label":opts.title||"animation"},view);
 var defs=mk("defs",{},this.svg);var f=mk("filter",{id:"lh-glow",x:"-50%",y:"-50%",width:"200%",height:"200%"},defs);
 mk("feGaussianBlur",{stdDeviation:"3.2",result:"b"},f);var fm=mk("feMerge",{},f);mk("feMergeNode",{"in":"b"},fm);mk("feMergeNode",{"in":"SourceGraphic"},fm);
 this.layer=mk("g",{},this.svg);
 this.ask=h("div","lh-ask",view,'<div><small>PREDICT</small><p></p><button type="button">Continue</button></div>');
 this.ask.querySelector("button").onclick=function(e){e.stopPropagation();self.resume()};
 var poster=h("div","lh-poster",view,(opts.title?"<h1></h1>":"")+"<span>"+IC.play+"</span>");
 if(opts.title)poster.querySelector("h1").textContent=opts.title;
 poster.onclick=function(){self.play()};
 this.capEl=h("div","lh-cap",this.root);
 var bar=h("div","lh-bar",this.root);
 this.bPlay=h("button","lh-btn lh-play",bar,IC.play);this.bPlay.type="button";this.bPlay.setAttribute("aria-label","Play");
 this.track=h("div","lh-track",bar,'<div class="lh-rail"><div class="lh-fill"></div></div><div class="lh-knob"></div>');
 this.time=h("span","lh-time",bar);
 this.bSpeed=h("button","lh-speed",bar,"1×");this.bSpeed.type="button";this.bSpeed.setAttribute("aria-label","Playback speed");
 this.bLoop=h("button","lh-btn",bar,IC.loop);this.bLoop.type="button";this.bLoop.setAttribute("aria-label","Loop");this.bLoop.setAttribute("aria-pressed","false");
 this.controls=h("div","lh-controls",host);
 this.bPlay.onclick=function(e){e.stopPropagation();self.toggle()};
 this.svg.addEventListener("click",function(){self.toggle()});
 var speeds=[.5,1,1.5,2];
 this.bSpeed.onclick=function(e){e.stopPropagation();self.speed=speeds[(speeds.indexOf(self.speed)+1)%speeds.length];self.bSpeed.textContent=self.speed+"×"};
 this.bLoop.onclick=function(e){e.stopPropagation();self.loop=!self.loop;self.bLoop.classList.toggle("on",self.loop);self.bLoop.setAttribute("aria-pressed",String(self.loop))};
 var drag=false,seekAt=function(ev){var r=self.track.getBoundingClientRect();self.pause();self.seek(clamp((ev.clientX-r.left)/r.width,0,1)*self.duration);self.started()};
 this.track.addEventListener("pointerdown",function(ev){drag=true;self.track.classList.add("drag");try{self.track.setPointerCapture(ev.pointerId)}catch(e){}seekAt(ev)});
 this.track.addEventListener("pointermove",function(ev){if(drag)seekAt(ev)});
 this.track.addEventListener("pointerup",function(){drag=false;self.track.classList.remove("drag")});
 this.root.addEventListener("keydown",function(e){if(e.target.tagName==="INPUT")return;
  if(e.key===" "||e.key==="k"){e.preventDefault();self.toggle()}
  else if(e.key==="ArrowRight"){e.preventDefault();self.jump(1)}
  else if(e.key==="ArrowLeft"){e.preventDefault();self.jump(-1)}
  else if(e.key==="l"){self.bLoop.click()}});
 scenes.push(this);
 var built=false;var boot=function(){if(built)return;built=true;self.build()};
 if(document.readyState==="complete")setTimeout(boot,0);else window.addEventListener("load",boot);
 setTimeout(boot,30);
}
var P=Scene.prototype;
P.add=function(o){this.objs.push(o);return o};

/* primitives */
P.line=function(x1,y1,x2,y2,o){o=o||{};var e=mk("line",{x1:x1,y1:y1,x2:x2,y2:y2},this.layer);styleShape(e,o,"ink");var ob=new Obj(this,e,"shape",o);ob.drawable=true;return this.add(ob)};
P.path=function(d,o){o=o||{};var e=mk("path",{d:d},this.layer);styleShape(e,o,"ink");var ob=new Obj(this,e,"shape",o);ob.drawable=true;ob.hasFill=!!o.fill;return this.add(ob)};
P.circle=function(cx,cy,r,o){o=o||{};var e=mk("circle",{cx:cx,cy:cy,r:r},this.layer);styleShape(e,o,"ink");var ob=new Obj(this,e,"shape",o);ob.drawable=true;ob.hasFill=!!o.fill;return this.add(ob)};
P.rect=function(x,y,w,hh,o){o=o||{};var e=mk("rect",{x:x,y:y,width:w,height:hh,rx:o.rx==null?6:o.rx},this.layer);styleShape(e,o,"faint");var ob=new Obj(this,e,"shape",o);ob.drawable=true;ob.hasFill=!!o.fill;return this.add(ob)};
P.polygon=function(pts,o){var d="M"+pts.map(function(p){return p[0]+" "+p[1]}).join("L")+"Z";return this.path(d,o)};
P.dot=function(x,y,o){o=o||{};var e=mk("circle",{cx:0,cy:0,r:o.r||7},this.layer);e.style.fill=col(o.color||"yellow");
 if(o.ring!==false){e.style.stroke=C.bg;e.style.strokeWidth="2.5px"}if(o.glow!==false)e.setAttribute("filter","url(#lh-glow)");
 e.style.transformBox="fill-box";e.style.transformOrigin="center";
 var ob=new Obj(this,e,"dot",o);ob.init.tx=x;ob.init.ty=y;return this.add(ob)};
P.text=function(str,x,y,o){o=o||{};var e=mk("text",{x:0,y:0,"text-anchor":o.anchor||"middle","dominant-baseline":"middle","font-size":o.size||18,"font-weight":o.weight||null},this.layer);
 e.style.fill=col(o.color||"ink");e.style.transformBox="fill-box";e.style.transformOrigin="center";
 if(o.math){e.setAttribute("class","lh-m");mathInto(e,String(str))}else{String(str).split(/(\\s+)/).forEach(function(w){if(w)mk("tspan",{},e).textContent=w})}
 if(o.glow)e.setAttribute("filter","url(#lh-glow)");
 var ob=new Obj(this,e,"text",o);ob.init.tx=x;ob.init.ty=y;ob.setText=function(s){while(e.firstChild)e.removeChild(e.firstChild);if(o.math)mathInto(e,String(s));else e.textContent=s};return this.add(ob)};
P.math=function(str,x,y,o){o=o||{};o.math=true;if(!o.size)o.size=24;return this.text(str,x,y,o)};
P.arrow=function(x1,y1,x2,y2,o){o=o||{};var bend=o.curve||0,mx=(x1+x2)/2,my=(y1+y2)/2,dx=x2-x1,dy=y2-y1,len=Math.hypot(dx,dy)||1;
 var cx=mx-dy/len*bend*len,cy=my+dx/len*bend*len;var hl=o.head||11;
 var ang=Math.atan2(y2-cy,x2-cx),ex=x2-Math.cos(ang)*hl*.6,ey=y2-Math.sin(ang)*hl*.6;
 var shaft=this.path(bend?"M"+x1+" "+y1+"Q"+cx+" "+cy+" "+ex+" "+ey:"M"+x1+" "+y1+"L"+ex+" "+ey,{color:o.color||"ink",width:o.width||2.5,glow:o.glow});
 var a=hl,b=hl*.55,c=Math.cos(ang),s=Math.sin(ang);
 var head=this.path("M"+x2+" "+y2+"L"+(x2-a*c+b*s)+" "+(y2-a*s-b*c)+"L"+(x2-a*c-b*s)+" "+(y2-a*s+b*c)+"Z",{color:o.color||"ink",fill:o.color||"ink",width:1});
 return this.group([shaft,head])};
P.group=function(list){var g=mk("g",{},this.layer);var ob=new Obj(this,g,"group");ob.children=list.slice();
 list.forEach(function(c){g.appendChild(c.el)});g.style.transformBox="fill-box";g.style.transformOrigin="center";return this.add(ob)};
P.axes=function(o){o=o||{};var X=o.x||[-5,5,1],Y=o.y||[-3,3,1],box=o.box||[64,34,this.w-120,this.h-82],s=this;
 var x0=box[0],y0=box[1],W=box[2],H=box[3];
 var fx=function(v){return x0+(v-X[0])/(X[1]-X[0])*W},fy=function(v){return y0+H-(v-Y[0])/(Y[1]-Y[0])*H};
 var parts=[],v;
 if(o.grid){for(v=X[0];v<=X[1]+1e-9;v+=X[2])parts.push(s.line(fx(v),y0,fx(v),y0+H,{color:"grid",width:1}));
  for(v=Y[0];v<=Y[1]+1e-9;v+=Y[2])parts.push(s.line(x0,fy(v),x0+W,fy(v),{color:"grid",width:1}))}
 var ax0=clamp(0,Y[0],Y[1]),ay0=clamp(0,X[0],X[1]);
 parts.push(s.arrow(x0-6,fy(ax0),x0+W+16,fy(ax0),{color:"dim",width:2,head:9}));
 parts.push(s.arrow(fx(ay0),y0+H+6,fx(ay0),y0-14,{color:"dim",width:2,head:9}));
 if(o.nums!==false){var fmt=function(n){n=Math.round(n*1000)/1000;return n<0?"−"+(-n):String(n)};
  for(v=X[0];v<=X[1]+1e-9;v+=X[2]){if(Math.abs(v-ay0)<1e-9&&o.grid!==false&&Y[0]<0)continue;parts.push(s.text(fmt(v),fx(v),fy(ax0)+18,{size:13,color:"dim"}))}
  for(v=Y[0];v<=Y[1]+1e-9;v+=Y[2]){if(Math.abs(v-ax0)<1e-9)continue;parts.push(s.text(fmt(v),fx(ay0)-10,fy(v),{size:13,color:"dim",anchor:"end"}))}}
 if(o.labels){if(o.labels.x)parts.push(s.math(o.labels.x,x0+W+22,fy(ax0)-16,{size:18,anchor:"start"}));
  if(o.labels.y)parts.push(s.math(o.labels.y,fx(ay0)+14,y0-10,{size:18,anchor:"start"}))}
 var g=s.group(parts);g.X=fx;g.Y=fy;g.P=function(a,b){return[fx(a),fy(b)]};g.box=box;g.range={x:X,y:Y};
 g.plot=function(fn,po){po=po||{};var a=po.from==null?X[0]:po.from,b=po.to==null?X[1]:po.to,n=po.samples||240,d="",pen=false;
  for(var i=0;i<=n;i++){var xv=a+(b-a)*i/n,yv=fn(xv);if(!isFinite(yv)||yv<Y[0]-(Y[1]-Y[0])||yv>Y[1]+(Y[1]-Y[0])){pen=false;continue}
   d+=(pen?"L":"M")+fx(xv).toFixed(2)+" "+fy(yv).toFixed(2);pen=true}
  return s.path(d||"M0 0",{color:po.color||"blue",width:po.width||3,glow:po.glow!==false,dash:po.dash})};
 return g};

/* ---------------------------------- animations ---------------------------------- */
function A(type,o,x){x=x||{};x.type=type;x.o=o;return x}
var LH={colors:C,ease:EASE,scenes:scenes,
 scene:function(o){return new Scene(o)},
 create:function(o){return A("create",o)},
 write:function(o){return A("write",o)},
 fadeIn:function(o,shift){return A("fadeIn",o,{shift:shift||[0,12]})},
 fadeOut:function(o,shift){return A("fadeOut",o,{shift:shift||[0,0]})},
 grow:function(o){return A("grow",o)},
 shrink:function(o){return A("shrink",o)},
 move:function(o,dx,dy){return A("move",o,{dx:dx,dy:dy})},
 moveTo:function(o,x,y){return A("moveTo",o,{x:x,y:y})},
 along:function(o,fn,opt){return A("along",o,{fn:fn,trail:opt&&opt.trail,trailWidth:opt&&opt.width})},
 scale:function(o,k){return A("scale",o,{k:k})},
 color:function(o,c){return A("color",o,{c:col(c)})},
 dim:function(o,k){return A("opacity",o,{v:k==null?.25:k})},
 show:function(o){return A("opacity",o,{v:1})},
 indicate:function(o,c){return A("indicate",o,{c:col(c||"yellow")})},
 count:function(o,from,to,fmt){return A("tween",null,{fn:function(p){o.setText((fmt||function(v){return v.toFixed(2)})(from+(to-from)*p))}})},
 tween:function(fn){return A("tween",null,{fn:fn})}
};
window.LH=LH;

var INTRO={create:{op:0,draw:0},write:{op:1},fadeIn:{op:0},grow:{sc:0,op:0}};
P.play=function(){
 var args=[].slice.call(arguments),opt={};
 if(args.length&&!args[args.length-1].type&&!Array.isArray(args[args.length-1]))opt=args.pop();
 var list=[];args.forEach(function(a){if(Array.isArray(a))list=list.concat(a);else list.push(a)});
 var dur=(opt.dur==null?1:opt.dur),lag=opt.lag||0,ease=EASE[opt.ease]||null,self=this,start=this.cursor;
 var flat=[],expand=function(a){
  if((a.type==="create"||a.type==="fadeIn"||a.type==="grow")&&a.o&&a.o.children){a.o.touched=true;a.o.children.forEach(function(c){expand(A(a.type,c,{shift:a.shift}))})}
  else flat.push(a)};
 list.forEach(function(a){var grp=a.o&&a.o.children&&a.type==="create";expand(a);if(grp&&!lag)lag=-1});
 if(lag===-1)lag=Math.min(.6/Math.max(1,flat.length),.12);
 var n=flat.length,span=n>1&&lag?1-(n-1)*lag:1;if(span<.15){span=.15;lag=(1-span)/Math.max(1,n-1)}
 flat.forEach(function(a,i){var s0=start+dur*(lag?i*lag:0),d=dur*(lag?span:1);self._resolve(a,s0,d,ease)});
 this.cursor+=dur;return this};
P._resolve=function(a,s0,d,ease){
 var o=a.o,step={a:a,s:s0,d:Math.max(d,1e-3),ease:ease||(a.type==="grow"?EASE.back:a.type==="indicate"?EASE.linear:EASE.smooth)};
 if(o){var v=o.st();
  if(INTRO[a.type]&&!o.touched){var z=INTRO[a.type];for(var k in z){o.init[k]=z[k];v[k]=z[k]}
   if(a.type==="write")o.el.querySelectorAll("tspan").forEach(function(t){t.style.opacity=0})}
  o.touched=true;step.from=copy(v);var to=copy(v);
  switch(a.type){
   case"create":to.op=1;to.draw=1;break;
   case"write":to.op=1;break;
   case"fadeIn":to.op=1;step.from.tx=v.tx+a.shift[0];step.from.ty=v.ty+a.shift[1];break;
   case"fadeOut":to.op=0;to.tx=v.tx+a.shift[0];to.ty=v.ty+a.shift[1];break;
   case"grow":to.sc=1;to.op=1;if(step.from.sc>=1)step.from.sc=0;break;
   case"shrink":to.sc=0;to.op=0;break;
   case"move":to.tx=v.tx+a.dx;to.ty=v.ty+a.dy;break;
   case"moveTo":to.tx=a.x;to.ty=a.y;break;
   case"along":var e=a.fn(1);to.tx=e[0];to.ty=e[1];
    if(a.trail){var tr=this.path("M0 0",{color:a.trail,width:a.trailWidth||2.5,glow:true});tr.drawable=false;this.layer.insertBefore(tr.el,o.el);step.trail=tr;step.trailFn=a.fn}break;
   case"scale":to.sc=v.sc*a.k;break;
   case"color":to.color=a.c;if(step.from.color==null)step.from.color=o.kind==="text"||o.kind==="dot"?(o.el.style.fill||C.ink):(o.el.style.stroke||C.ink);break;
   case"opacity":to.op=a.v;break;
   case"indicate":step.base=step.from.color||(o.kind==="text"||o.kind==="dot"?o.el.style.fill:o.el.style.stroke);break}
  o._v=to;step.to=to}
 this.tl.push(step)};
P.wait=function(s){this.cursor+=(s==null?.8:s);return this};
P.caption=function(html){this.caps.push({t:this.cursor,html:html});return this};
P.build=function(){var self=this;this.duration=Math.max(this.cursor,.01);this.built=true;
 var tr=this.track;this.caps.forEach(function(c,i){if(i===0&&c.t<.01)return;var e=h("div","lh-tick",tr);e.style.left=(c.t/self.duration*100)+"%"});
 this.pauses.forEach(function(p){var e=h("div","lh-pin",tr);e.style.left=(p.t/self.duration*100)+"%"});
 this.seek(0);this._frame=this._frame.bind(this);requestAnimationFrame(this._frame)};
P.seek=function(t){t=clamp(t,0,this.duration||0);var self=this;
 this.objs.forEach(function(o){o.reset()});
 for(var i=this.tl.length-1;i>=0;i--){var st=this.tl[i];if(t>=st.s)continue;
  if(st.a.type==="tween")st.a.fn(0);else if(st.a.type==="write")st.a.o.el.querySelectorAll("tspan").forEach(function(x){x.style.opacity=0});else if(st.trail)st.trail.el.setAttribute("d","M0 0")}
 this.tl.forEach(function(st){if(t<st.s)return;var p=clamp((t-st.s)/st.d,0,1),q=st.ease(p);self._apply(st,p,q)});
 this.objs.forEach(function(o){o.apply()});
 this.t=t;this.passed={};this.pauses.forEach(function(pp,i){if(pp.t<t-1e-6)self.passed[i]=1});
 this._ui()};
P._apply=function(st,p,q){var a=st.a,o=a.o;
 if(a.type==="tween"){a.fn(q);return}
 var c=o.cur,f=st.from,to=st.to,L=function(k){c[k]=f[k]+(to[k]-f[k])*q};
 switch(a.type){
  case"create":c.op=p>0?1:0;c.draw=q;break;
  case"write":c.op=1;var ts=o.el.querySelectorAll("tspan"),n=ts.length;ts.forEach(function(t,i){t.style.opacity=clamp(q*n*1.15-i,0,1)});break;
  case"color":c.color=mixc(f.color,to.color,q);break;
  case"indicate":c.sc=f.sc*(1+.22*EASE.there(p));c.color=mixc(st.base||C.ink,a.c,EASE.there(p));if(p>=1)c.color=f.color;break;
  case"along":var xy=a.fn(q);c.tx=xy[0];c.ty=xy[1];
   if(st.trail){var d="",n2=Math.max(2,Math.ceil(80*q));for(var i=0;i<=n2;i++){var pt=a.fn(q*i/n2);d+=(i?"L":"M")+pt[0].toFixed(1)+" "+pt[1].toFixed(1)}st.trail.el.setAttribute("d",d);st.trail.len=0}break;
  default:L("tx");L("ty");L("sc");L("op");L("draw")}
 if(a.type==="write"&&p<=0)o.el.querySelectorAll("tspan").forEach(function(t){t.style.opacity=0})};
P._frame=function(now){var dt=this._last?Math.min(.05,(now-this._last)/1000):0;this._last=now;
 if(this.playing){var nt=this.t+(reduce?dt*4:dt)*this.speed,self=this,hit=-1;
  this.pauses.forEach(function(pp,i){if(hit<0&&!self.passed[i]&&pp.t>=self.t-1e-6&&pp.t<=nt)hit=i});
  if(hit>=0){this.seek(this.pauses[hit].t);this.passed[hit]=1;this.playing=false;this._askShow(this.pauses[hit].q)}
  else if(nt>=this.duration){this.seek(this.duration);if(this.loop){this.seek(0)}else this.playing=false}
  else this.seek(nt)}
 requestAnimationFrame(this._frame)};
P._go=function(){if(!this.built)return;if(this.t>=this.duration-1e-6)this.seek(0);this.playing=true;this.started();this._askHide();this._ui()};
P.pause=function(q){if(typeof q==="string")return this._pauseMark(q);this.playing=false;this._ui();return this};
P._pauseMark=function(q){this.pauses.push({t:this.cursor,q:q});this.cursor+=.001;return this};
P.resume=function(){this._askHide();this.playing=true;this._ui()};
P.toggle=function(){if(this.ask.classList.contains("show")){this.resume();return}if(this.playing)this.pause();else this._go()};
P.started=function(){this.root.classList.add("started")};
P.jump=function(dir){var marks=[0].concat(this.caps.map(function(c){return c.t}),this.pauses.map(function(p){return p.t})).sort(function(a,b){return a-b}),t=this.t,target=dir>0?this.duration:0;
 if(dir>0){for(var i=0;i<marks.length;i++)if(marks[i]>t+.05){target=marks[i];break}}else{for(var j=marks.length-1;j>=0;j--)if(marks[j]<t-.3){target=marks[j];break}}
 this.pause();this.started();this.seek(target)};
P._askShow=function(q){this.ask.querySelector("p").innerHTML=q||"What happens next?";this.ask.classList.add("show");this._ui()};
P._askHide=function(){this.ask.classList.remove("show")};
P._ui=function(){var d=this.duration||1,f=this.t/d;
 this.track.querySelector(".lh-fill").style.width=(f*100)+"%";this.track.querySelector(".lh-knob").style.left=(f*100)+"%";
 var fmt=function(s){s=Math.max(0,s);return Math.floor(s/60)+":"+("0"+Math.floor(s%60)).slice(-2)};
 this.time.textContent=fmt(this.t)+" / "+fmt(d);
 var end=this.t>=d-1e-6;this.bPlay.innerHTML=this.playing?IC.pause:end?IC.replay:IC.play;this.bPlay.setAttribute("aria-label",this.playing?"Pause":end?"Replay":"Play");
 this.root.classList.toggle("playing",this.playing);
 var cap="";for(var i=0;i<this.caps.length;i++)if(this.caps[i].t<=this.t+1e-6)cap=this.caps[i].html;
 if(cap!==this._cap){var el=this.capEl,self=this;this._cap=cap;el.classList.add("out");clearTimeout(this._ct);
  this._ct=setTimeout(function(){el.innerHTML=self._cap;el.classList.remove("out")},reduce?0:180)}};
/* play() with no args = start playback; with animations = timeline step */
var buildPlay=P.play;P.play=function(){if(arguments.length===0){this._go();return this}return buildPlay.apply(this,arguments)};

/* free-play controls (live after the timeline) */
P._toEnd=function(){if(this.t<this.duration-1e-6||this.playing){this.playing=false;this._askHide();this.started();this.seek(this.duration)}};
P.slider=function(o){var self=this,w=h("div","lh-ctl",this.controls),id="lh"+Math.random().toString(36).slice(2,7);
 var lab=h("label","",w);lab.htmlFor=id;lab.innerHTML=o.label||"";var inp=h("input","",w);inp.type="range";inp.id=id;
 inp.min=o.min;inp.max=o.max;inp.step=o.step||(o.max-o.min)/200;inp.value=o.value==null?o.min:o.value;if(o.color)inp.style.setProperty("--c",col(o.color));
 var val=h("span","lh-val",w),fmt=o.format||function(v){return(+v).toFixed(2)};val.textContent=fmt(+inp.value);
 inp.addEventListener("input",function(){val.textContent=fmt(+inp.value);self._toEnd();o.onInput&&o.onInput(+inp.value)});return inp};
P.toggle2=function(o){var self=this,b=h("button","lh-tog"+(o.value?" on":""),this.controls);b.type="button";if(o.color)b.style.setProperty("--c",col(o.color));
 var v=!!o.value,lab=function(){b.innerHTML=typeof o.label==="function"?o.label(v):o.label};lab();
 b.onclick=function(){v=!v;b.classList.toggle("on",v);lab();self._toEnd();o.onChange&&o.onChange(v)};return b};
P.readout=function(txt){var e=h("span","lh-read",this.controls,txt||"");return{set:function(t){e.innerHTML=t}}};
P.switch=P.toggle2;
})();`;

/** Inject the kit as the first script in the document (before any scene code). */
export function withMotionKit(html: string): string {
	const tag = `<script>${MOTION_KIT_JS}</script>`;
	if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}${tag}`);
	if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => `${m}<head>${tag}</head>`);
	return `${tag}${html}`;
}
