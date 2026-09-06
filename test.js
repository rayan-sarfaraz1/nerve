
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('sw.js').catch(function(err) {
      console.log('ServiceWorker registration failed: ', err);
    });
  });
}
(function(){
"use strict";

/* ----------------------------------------------------------
   0. PLAYABLES SDK BRIDGE
   ---------------------------------------------------------- */
var YT = (typeof ytgame !== "undefined" && ytgame.IN_PLAYABLES_ENV) ? ytgame : null;
var IN_YT = !!YT;

var firstFrameSent = false, gameReadySent = false, dataReady = false;
var paused = false, ytAudioOK = true, userSound = true;
var savePending = false, saveTimer = 0, lastSentScore = -1;
var deaths = 0, lastTouch = 0;

var ADS = { enabled: false, everyNDeaths: 3 };

function logErr(){  try { if (IN_YT && YT.health) YT.health.logError();   } catch(e){} }
function logWarn(){ try { if (IN_YT && YT.health) YT.health.logWarning(); } catch(e){} }

function serialize(){
  var own = [], k;
  for (k in OWNED) if (OWNED[k]) own.push(k);
  return JSON.stringify({ v:2, best:best, coins:wallet, own:own, ch:charId, ob:objId, bg:bgId, sh:shapeId, bl:bestLevel, bs:CFG.barStyle });
}

function applySave(txt){
  if (!txt) return;
  var d, i;
  try { d = JSON.parse(txt); } catch(e){ return; }
  if (!d || typeof d !== "object") return;
  if (typeof d.best  === "number") best   = Math.max(best,   Math.floor(d.best));
  if (typeof d.bl    === "number") bestLevel = Math.max(bestLevel, Math.floor(d.bl));
  if (typeof d.bs === "string" && STYLES.indexOf(d.bs) >= 0) CFG.barStyle = d.bs;
  if (typeof d.coins === "number") wallet = Math.max(999999, Math.floor(d.coins));
  else wallet = 999999;
  if (d.own && d.own.length) for (i = 0; i < d.own.length; i++) OWNED[d.own[i]] = true;
  if (d.ch && findChar(d.ch)) charId = d.ch;
  if (d.ob && findObj(d.ob))  objId  = d.ob;
  if (d.bg && findBg(d.bg))   bgId   = d.bg;
  if (d.sh && findShape(d.sh)) {
    shapeId = d.sh;
    var sidx = SHAPES.findIndex(function(s) { return s.id === shapeId; });
    S.shape = sidx >= 0 ? sidx : 0;
  }
}

function loadSave(){
  var done = false;
  function finish(){ if (done) return; done = true; dataReady = true; }
  setTimeout(finish, 3000);
  if (IN_YT && YT.game && YT.game.loadData) {
    try {
      YT.game.loadData().then(
        function(txt){ applySave(txt); finish(); },
        function(){ logWarn(); finish(); }
      );
    } catch(e){ logWarn(); finish(); }
  } else {
    try {
      var raw = localStorage.getItem("nerve_save");
      if (raw) applySave(raw);
      else {
        var old = localStorage.getItem("nerve_best");
        if (old) best = Math.max(best, parseInt(old, 10) || 0);
      }
    } catch(e){}
    finish();
  }
}

function saveNow(){
  savePending = false;
  var txt = serialize();
  if (IN_YT && YT.game && YT.game.saveData) {
    try { YT.game.saveData(txt).then(null, function(){ logWarn(); }); } catch(e){ logWarn(); }
  } else {
    try { localStorage.setItem("nerve_save", txt); } catch(e){}
  }
}

function queueSave(){
  savePending = true;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(function(){ saveTimer = 0; saveNow(); }, 700);
}

function sendScore(v){
  v = Math.floor(v);
  if (v <= 0 || v <= lastSentScore) return;
  lastSentScore = v;
  if (IN_YT && YT.engagement && YT.engagement.sendScore) {
    try { YT.engagement.sendScore({ value: v }); } catch(e){ logWarn(); }
  }
}

function ytFirstFrame(){
  if (firstFrameSent) return;
  firstFrameSent = true;
  if (IN_YT && YT.game && YT.game.firstFrameReady) {
    try { YT.game.firstFrameReady(); } catch(e){ logWarn(); }
  }
}

function tryGameReady(){
  if (gameReadySent || !firstFrameSent || !dataReady) return;
  gameReadySent = true;
  if (IN_YT && YT.game && YT.game.gameReady) {
    try { YT.game.gameReady(); } catch(e){ logWarn(); }
  }
}

function maybeAd(){
  if (!ADS.enabled || !IN_YT || !YT.ads) return;
  if (deaths % ADS.everyNDeaths !== 0) return;
  try { YT.ads.requestInterstitialAd().then(null, function(){ logWarn(); }); } catch(e){ logWarn(); }
}

function audioAllowed(){ return ytAudioOK && (IN_YT ? true : userSound); }

function applyAudioGate(){
  if (!master) return;
  try { master.gain.value = (audioAllowed() && !paused) ? 0.9 : 0; } catch(e){}
}

function doPause(){
  if (paused) return;
  paused = true;
  applyAudioGate();
  saveNow();
}

function doResume(){
  if (!paused) return;
  paused = false;
  last = 0;
  applyAudioGate();
}

window.addEventListener("error", logErr);
window.addEventListener("unhandledrejection", logWarn);
document.addEventListener("visibilitychange", function(){
  if (document.hidden) doPause(); else doResume();
});
window.addEventListener("pagehide", saveNow);
document.addEventListener("touchmove",    function(e){ if (e.cancelable) e.preventDefault(); }, { passive: false });
document.addEventListener("gesturestart", function(e){ e.preventDefault(); });
document.addEventListener("dblclick",     function(e){ e.preventDefault(); });
document.addEventListener("contextmenu",  function(e){ e.preventDefault(); });


/* ----------------------------------------------------------
   1. TUNING KNOBS
   ---------------------------------------------------------- */
var CFG = {
  baseSpeed:   0.75,
  speedGain:   1.075,
  baseZone:    0.26,
  zoneShrink:  0.90,
  minZone:     0.030,
  maxSpeed:    4.2,
  closeMargin: 0.040,
  perfectBand: 0.18,
  slowMoTime:  0.85,
  slowMoRate:  0.16,
  lives:       3,
  missFreeze:  0.95,
  shapeEvery:  3,
  minReact:    0.30,   /* FIX: zone kabhi itna qareeb spawn na ho ke react karna namumkin ho (seconds) */
  trailN:      18,     /* marker ke peeche ghost trail ke points */
  driftFrom:   20,     /* is level ke baad zone khud sarakna shuru karta hai */
  driftRate:   0.05,   /* zone sarakne ki raftaar (per second) */
  barStyle:    "pro"   /* bar ka look: "pro" | "flat" | "segment" | "neon" | "glass"  (game mein BAR button se badlo) */
};

var W = 450, H = 800;


/* ----------------------------------------------------------
   2. COLOUR TIERS
   ---------------------------------------------------------- */
var TIERS = [
  { at: 0,  name: "WARM UP", col: "#22d3a6", glow: "rgba(34,211,166,"  },
  { at: 4,  name: "NICE",    col: "#38bdf8", glow: "rgba(56,189,248,"  },
  { at: 7,  name: "HOT",     col: "#ffd166", glow: "rgba(255,209,102," },
  { at: 11, name: "DANGER",  col: "#fb923c", glow: "rgba(251,146,60,"  },
  { at: 16, name: "INSANE",  col: "#ff4d8d", glow: "rgba(255,77,141,"  },
  { at: 22, name: "GODLIKE", col: "#a855f7", glow: "rgba(168,85,247,"  },
  { at: 28, name: "MYTHIC",  col: "#2dd4bf", glow: "rgba(45,212,191,"  },
  { at: 34, name: "COSMIC",  col: "#e879f9", glow: "rgba(232,121,249," }
];
function tier(){
  var t = TIERS[0], i;
  for (i = 0; i < TIERS.length; i++) if (S.level >= TIERS[i].at) t = TIERS[i];
  return t;
}
var MILESTONES = { 5:"HEATING UP", 10:"UNSTOPPABLE", 15:"NO FEAR", 20:"LEGEND", 25:"INHUMAN",
                   30:"UNREAL", 35:"MACHINE", 40:"GOD MODE" };


/* ----------------------------------------------------------
   3. SHAPES - yehi naya bada feature hai
   ---------------------------------------------------------- */
var SHAPES = [
  { id:"line",  name:"SLIDER",   unlock:0,  wrap:false, lw:44 },
  { id:"vert",  name:"VERTICAL", unlock:3,  wrap:false, lw:44 },
  { id:"ring",  name:"CIRCLE",   unlock:6,  wrap:true,  lw:26 },
  { id:"cross", name:"X CROSS",  unlock:9,  wrap:true,  lw:24 },
  { id:"inf",   name:"INFINITY", unlock:12, wrap:true,  lw:24 },
  { id:"tri",   name:"TRIANGLE", unlock:15, wrap:true,  lw:24 },
  { id:"sqr",   name:"SQUARE",   unlock:18, wrap:true,  lw:24 },
  { id:"hex",   name:"HEXAGON",  unlock:21, wrap:true,  lw:22 },
  { id:"star",  name:"STAR",     unlock:24, wrap:true,  lw:19 },
  { id:"wave",  name:"WAVE",     unlock:27, wrap:false, lw:32 }
];

var A = { cx:225, cy:470, r:92, x0:45, x1:405, y0:378, y1:562, arm:78, iw:100, ih:55,
          pr:95, so:104, si:46, wa:60 };
var CROSS_TIPS = [[-1,-1],[1,1],[1,-1],[-1,1]];

/* regular polygon - har kinara barabar lamba, is liye raftaar bhi barabar */
function polyAt(t, n, rad, rot){
  var seg = 1 / n, i = Math.floor(t / seg), f, a1, a2, x1, y1, x2, y2;
  if (i >= n) i = n - 1;
  f = (t - i * seg) / seg;
  a1 = rot + (i * Math.PI * 2) / n;
  a2 = rot + ((i + 1) * Math.PI * 2) / n;
  x1 = A.cx + Math.cos(a1) * rad; y1 = A.cy + Math.sin(a1) * rad;
  x2 = A.cx + Math.cos(a2) * rad; y2 = A.cy + Math.sin(a2) * rad;
  return { x: x1 + (x2 - x1) * f, y: y1 + (y2 - y1) * f };
}

function starPt(k, pts, rOut, rIn, rot){
  var r = (k % 2 === 0) ? rOut : rIn;
  var a = rot + (k * Math.PI) / pts;
  return { x: A.cx + Math.cos(a) * r, y: A.cy + Math.sin(a) * r };
}
function starAt(t, pts, rOut, rIn, rot){
  var n = pts * 2, seg = 1 / n, i = Math.floor(t / seg), f, p1, p2;
  if (i >= n) i = n - 1;
  f = (t - i * seg) / seg;
  p1 = starPt(i, pts, rOut, rIn, rot);
  p2 = starPt(i + 1, pts, rOut, rIn, rot);
  return { x: p1.x + (p2.x - p1.x) * f, y: p1.y + (p2.y - p1.y) * f };
}

function shp(){ return SHAPES[S.shape] || SHAPES[0]; }

/* t = 0..1 raaste par kahan ho. Har shape ke liye ek hi interface. */
function pathAt(t){
  var id = shp().id, a, seg, f, k, tip, th;
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  if (id === "line") return { x: A.x0 + t * (A.x1 - A.x0), y: A.cy };
  if (id === "vert") return { x: A.cx, y: A.y1 - t * (A.y1 - A.y0) };
  if (id === "ring") {
    a = -Math.PI / 2 + t * Math.PI * 2;
    return { x: A.cx + Math.cos(a) * A.r, y: A.cy + Math.sin(a) * A.r };
  }
  if (id === "cross") {
    /* 8 tukde: markaz -> nok -> markaz, chaar baar. Raasta kabhi tootta nahi. */
    seg = Math.floor(t * 8); if (seg > 7) seg = 7;
    f = t * 8 - seg;
    k = (seg % 2 === 0) ? f : 1 - f;
    tip = CROSS_TIPS[Math.floor(seg / 2)];
    return { x: A.cx + tip[0] * A.arm * k, y: A.cy + tip[1] * A.arm * k };
  }
  if (id === "tri")  return polyAt(t, 3, A.pr, -Math.PI / 2);
  if (id === "sqr")  return polyAt(t, 4, A.pr,  Math.PI / 4);
  if (id === "hex")  return polyAt(t, 6, A.pr,  0);
  if (id === "star") return starAt(t, 5, A.so, A.si, -Math.PI / 2);
  if (id === "wave") return { x: A.x0 + t * (A.x1 - A.x0),
                              y: A.cy + A.wa * Math.sin(t * Math.PI * 3) };
  /* infinity - Gerono lemniscate */
  th = t * Math.PI * 2;
  return { x: A.cx + A.iw * Math.cos(th), y: A.cy + A.ih * Math.sin(2 * th) };
}

var lastAng = 0;
function tangentAt(t){
  /* FIX: X CROSS ke nok aur markaz par dono sample points barabar aa jate the,
     atan2(0,0) = 0 -> object achanak flat ho jata tha. Ab epsilon barhta hai. */
  var e = 0.005, a, b, p, q, dx, dy, k;
  for (k = 0; k < 4; k++) {
    a = t - e; b = t + e;
    if (shp().wrap) { if (a < 0) a += 1; if (b > 1) b -= 1; }
    else            { if (a < 0) a = 0;  if (b > 1) b = 1;  }
    p = pathAt(a); q = pathAt(b);
    dx = q.x - p.x; dy = q.y - p.y;
    if (dx * dx + dy * dy > 0.02) { lastAng = Math.atan2(dy, dx); return lastAng; }
    e *= 3;
  }
  return lastAng;
}

for (var i = 0; i < SHAPES.length; i++) {
  SHAPES[i].id = "shape_" + i;
  SHAPES[i].price = i === 0 ? 0 : i * 50;
  SHAPES[i].col = "#38bdf8";
}


/* ----------------------------------------------------------
   4. SHOP CATALOG - kamaye hue coins yahan kharch hote hain
   ---------------------------------------------------------- */
var CHARS = [
  { id:"blob",  name:"BLOB",  price:0,   col:null      },
  { id:"pill",  name:"PILL",  price:35,  col:"#38bdf8" },
  { id:"star",  name:"STAR",  price:90,  col:"#ffd166" },
  { id:"ghost", name:"GHOST", price:160, col:"#a855f7" },
  { id:"bot",   name:"BOT",   price:260, col:"#fb923c" },
  { id:"flame", name:"FLAME", price:400, col:"#ff4d5e" }
];
var OBJS = [
  { id:"bar",     name:"BAR",     price:0,   col:"#ffffff" },
  { id:"orb",     name:"ORB",     price:30,  col:"#22d3a6" },
  { id:"arrow",   name:"ARROW",   price:75,  col:"#38bdf8" },
  { id:"diamond", name:"DIAMOND", price:140, col:"#ffd166" },
  { id:"blade",   name:"BLADE",   price:230, col:"#ff4d8d" },
  { id:"comet",   name:"COMET",   price:350, col:"#a855f7" }
];
var BGS = [
  { id:"alien",  name:"ALIEN",  price:0,   src:"background/alien-planet.jpg" },
  { id:"sci-fi", name:"SCI-FI", price:50,  src:"background/cartoon-sci-fi.jpg" },
  { id:"cosmic", name:"COSMIC", price:100, src:"background/cosmic-space.jpg" },
  { id:"abyss",  name:"ABYSS",  price:150, src:"background/deep-abyss.png" },
  { id:"matrix", name:"MATRIX", price:250, src:"background/matrix.png" },
  { id:"city",   name:"CITY",   price:350, src:"background/neon-city.jpg" },
  { id:"retro",  name:"RETRO",  price:500, src:"background/retrowave.png" }
];

var IMG_CACHE = {};
function getImg(src) {
  if (!src) return null;
  if (IMG_CACHE[src]) return IMG_CACHE[src];
  var img = new Image();
  img.src = src;
  IMG_CACHE[src] = img;
  return img;
}

var best = 0, wallet = 999999, charId = "blob", objId = "bar", bgId = "alien", shapeId = "shape_0";
var bestLevel = 0;   /* ab tak ka sab se ooncha level - LEVELS screen isi se unlock dikhati hai */
var OWNED = { "char:blob": true, "obj:bar": true, "bg:alien": true, "shape:shape_0": true };

function findChar(id){ var i; for (i=0;i<CHARS.length;i++) if (CHARS[i].id===id) return CHARS[i]; return null; }
function findObj(id){  var i; for (i=0;i<OBJS.length;i++)  if (OBJS[i].id===id)  return OBJS[i];  return null; }
function findBg(id){   var i; for (i=0;i<BGS.length;i++)   if (BGS[i].id===id)   return BGS[i];   return null; }
function findShape(id){var i; for (i=0;i<SHAPES.length;i++) if (SHAPES[i].id===id) return SHAPES[i]; return null; }
function curChar(){ return findChar(charId) || CHARS[0]; }
function curObj(){  return findObj(objId)  || OBJS[0];  }
function curBg(){   return findBg(bgId)    || BGS[0];   }
function charCol(){ var c = curChar(); return c.col ? c.col : tier().col; }

var TW = 118, TH = 112, GX = 12, GY = 12, TX0 = 36;
var ROW_Y = [160, 284];
var BACK = { x:125, y:668, w:200, h:56 };

function tileBox(kind, idx){
  var col = idx % 3, row = Math.floor(idx / 3);
  return { x: TX0 + col * (TW + GX), y: ROW_Y[row], w: TW, h: TH };
}


/* ----------------------------------------------------------
   5. AUDIO - poori tarah code se banti hai, 0 bytes ki files
   ---------------------------------------------------------- */
var AC = null, master = null, drone = null, droneGain = null;
var mTimer = 0, mStep = 0, beat = 0;
var SCALE = [0,3,5,7,10], ROOT = 220;

function initAudio(){
  if (AC) { if (AC.state === "suspended") { try { AC.resume(); } catch(e){} } return; }
  try {
    var C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    AC = new C();
    master = AC.createGain();
    master.gain.value = 0.9;
    master.connect(AC.destination);

    droneGain = AC.createGain();
    droneGain.gain.value = 0;
    var lp = AC.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 220;
    drone = AC.createOscillator();
    drone.type = "triangle";
    drone.frequency.value = 44;
    drone.connect(lp); lp.connect(droneGain); droneGain.connect(master);
    drone.start();
    applyAudioGate();
  } catch(e){ AC = null; }
}

function hz(semi){ return ROOT * Math.pow(2, semi / 12); }

function blip(freq, dur, type, vol){
  if (!AC || !audioAllowed() || paused) return;
  try {
    var o = AC.createOscillator(), g = AC.createGain(), t = AC.currentTime;
    o.type = type || "square";
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol || 0.18, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  } catch(e){}
}

function noise(dur, cut, vol, q){
  if (!AC || !audioAllowed() || paused) return;
  try {
    var n = Math.floor(AC.sampleRate * dur), i;
    var buf = AC.createBuffer(1, n, AC.sampleRate);
    var d = buf.getChannelData(0);
    for (i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    var src = AC.createBufferSource(); src.buffer = buf;
    var f = AC.createBiquadFilter();
    f.type = "bandpass"; f.frequency.value = cut || 1200; f.Q.value = q || 1;
    var g = AC.createGain(); g.gain.value = vol || 0.12;
    src.connect(f); f.connect(g); g.connect(master);
    src.start();
  } catch(e){}
}

/* NAYA SOUNDTRACK: narm house beat + warm bass pluck + saaf arp melody
   (purana beat har step par shor karta tha, ab groove hai) */
var BASSLINE = [0, 0, 7, 3, 5, 5, 10, 7];
var ARP      = [12, 19, 24, 19, 15, 22, 27, 22, 12, 17, 24, 17, 14, 21, 26, 21];

function musicTick(dt){
  if (!AC || !audioAllowed() || paused) return;
  if (S.phase !== "run" && S.phase !== "idle") return;
  var period = Math.max(0.105, 0.34 - S.level * 0.009);   /* level ke sath tempo tez */
  mTimer += dt;
  if (mTimer < period) return;
  mTimer = 0;
  mStep = (mStep + 1) % 16;
  beat++;
  var bar16 = Math.floor(beat / 16);

  /* KICK - sirf step 1 aur 9 par, gehra aur narm */
  if (mStep === 0 || mStep === 8) {
    try {
      var o = AC.createOscillator(), g = AC.createGain(), t = AC.currentTime;
      o.type = "sine";
      o.frequency.setValueAtTime(64, t);
      o.frequency.exponentialRampToValueAtTime(34, t + 0.16);
      g.gain.setValueAtTime(0.26, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.20);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + 0.22);
    } catch(e){}
  }

  /* HATS - bohot halke (pehle har doosre step par shor tha) */
  if (mStep === 4 || mStep === 12) noise(0.045, 5600, 0.026, 2.2);
  else if (mStep % 4 === 2)        noise(0.028, 9500, 0.013, 4.0);

  /* BASS pluck - warm sine, har 4 step par, pattern badalta rehta hai */
  if (mStep % 4 === 0) {
    blip(hz(BASSLINE[((mStep / 4) + bar16) % BASSLINE.length] - 12), 0.22, "sine", 0.15);
  }

  /* MELODY arp - level 3 se, saaf triangle, dheemi awaz */
  if (S.level >= 3 && mStep % 2 === 1) {
    blip(hz(ARP[mStep % ARP.length] + (S.level >= 12 ? 12 : 0)), 0.13, "triangle", 0.050);
  }

  /* perfect chain par chhoti chamakti ghanti */
  if (S.chain >= 3 && mStep % 8 === 6) blip(hz(36), 0.16, "sine", 0.05);
  if (droneGain && drone) {
    try {
      drone.frequency.value = 44 + S.level * 1.6;
      droneGain.gain.value = (S.level >= 3) ? Math.min(0.070, (S.level - 2) * 0.008) : 0.018;
    } catch(e){}
  }
}

function later(ms, fn){ setTimeout(fn, ms); }

function sfxHit(perfect){
  var n = Math.min(S.chain, 7), base = SCALE[n % SCALE.length];
  /* ghanti jaisi saaf awaz - purana square beep katora lagta tha */
  blip(hz(base + (perfect ? 24 : 19)), perfect ? 0.20 : 0.14, "triangle", perfect ? 0.17 : 0.12);
  blip(hz(base + (perfect ? 31 : 26)), perfect ? 0.26 : 0.17, "sine",     perfect ? 0.11 : 0.07);
  if (perfect) later(60, function(){ blip(hz(base + 36), 0.22, "sine", 0.08); });
}
function sfxMiss(){ blip(98, 0.34, "triangle", 0.17); blip(146, 0.22, "sine", 0.10); noise(0.22, 420, 0.10, 0.9); }
function sfxLife(){ blip(165, 0.16, "triangle", 0.15); later(80, function(){ blip(98, 0.30, "triangle", 0.13); }); }
function sfxCash(){
  var i;
  for (i = 0; i < 5; i++) {
    (function(k){ later(k * 55, function(){ blip(hz(SCALE[k % 5] + 24), 0.12, "triangle", 0.14); }); })(i);
  }
}
function sfxMile(){
  var i;
  for (i = 0; i < 4; i++) {
    (function(k){ later(k * 80, function(){ blip(hz(SCALE[k % 5] + 12 + k * 2), 0.18, "square", 0.15); }); })(i);
  }
}
function sfxShape(){ blip(hz(24), 0.10, "triangle", 0.16); later(90, function(){ blip(hz(31), 0.18, "triangle", 0.16); }); }
function sfxBuy(){   blip(hz(19), 0.10, "square", 0.15);   later(80, function(){ blip(hz(26), 0.16, "square", 0.15); }); }
function sfxEquip(){ blip(hz(24), 0.12, "triangle", 0.14); }
function sfxDeny(){  blip(120, 0.16, "sawtooth", 0.16); }
function sfxOpen(){  blip(hz(12), 0.10, "triangle", 0.12); }
function buzz(p){ try { if (navigator.vibrate) navigator.vibrate(p); } catch(e){} }


/* ----------------------------------------------------------
   6. PARTICLES + POPUPS
   ---------------------------------------------------------- */
var parts = [], pops = [], trail = [], stops = [];
var shocks = [], coinsFly = [], dust = [];

function burst(x, y, n, col, spd){
  var i, a, s, lf;
  for (i = 0; i < n; i++) {
    a  = Math.random() * Math.PI * 2;
    s  = (spd || 200) * (0.35 + Math.random() * 0.9);
    lf = 0.5 + Math.random() * 0.5;
    parts.push({ x:x, y:y, vx:Math.cos(a)*s, vy:Math.sin(a)*s - 60,
                 r: 2 + Math.random()*3.5, col: col, life: lf, max: lf });
  }
  if (parts.length > 260) parts.splice(0, parts.length - 260);
}

function pop(t, x, y, col, size){
  pops.push({ t:t, x:x, y:y, col:col, size:size || 20, life:1 });
  if (pops.length > 14) pops.shift();
}

/* ---- extra animations: shockwave rings, urrte sikke, dust, screen wash ---- */
function shock(x, y, col, big){
  shocks.push({ x:x, y:y, col:col, r: big ? 14 : 9, max: big ? 155 : 100, life: 1 });
  if (shocks.length > 8) shocks.shift();
}

function sfxTick(){ blip(hz(31), 0.05, "triangle", 0.06); }

/* hit par sikke marker se CASH OUT box tak arc mein urrte hain */
function coinFly(x, y, n){
  var i, a;
  for (i = 0; i < n; i++) {
    a = (i / n) * Math.PI * 2;
    coinsFly.push({
      sx: x + Math.cos(a) * 12, sy: y + Math.sin(a) * 12,
      tx: CASH.x + CASH.w / 2 + (Math.random() - 0.5) * 40, ty: CASH.y + 22,
      cx: x, cy: y, t: 0, d: i * 0.045
    });
  }
  if (coinsFly.length > 40) coinsFly.splice(0, coinsFly.length - 40);
}

function initDust(){
  var i;
  for (i = 0; i < 28; i++) dust.push({
    x: Math.random() * W, y: Math.random() * H,
    r: 0.6 + Math.random() * 1.7, v: 5 + Math.random() * 17,
    a: 0.05 + Math.random() * 0.15
  });
}

function wash(col){ S.wash = 1; S.washCol = col; }


/* ----------------------------------------------------------
   7. GAME STATE
   ---------------------------------------------------------- */
var TT = 0, slowT = 0, idleT = 0, last = 0;

var S = {
  screen:"game", phase:"idle", shopTab:"char",
  banked:0, pot:0, level:0, lives:CFG.lives,
  pos:0, dir:1, zoneA:0.3, zoneW:CFG.baseZone, speed:CFG.baseSpeed, shape:0,
  flash:0, shake:0, happyT:0, blink:0, zoom:0, chain:0,
  msg:"", msgSub:"", msgT:0,
  mile:"", mileSub:"", mileT:0,
  missT:0, missGap:0, missPos:0,
  coinsRun:0, newBest:false,
  shopMsg:"", shopMsgT:0, buyFlash:0
};


/* ----------------------------------------------------------
   8. THE CORE LOOP
   ---------------------------------------------------------- */
function applyLevel(){
  var diff = S.level % 3;
  var effLevel = diff * 4 + (S.shape * 0.2); // 0 (Easy), 4 (Middle), 8 (Hard)
  
  S.speed = Math.min(CFG.maxSpeed, CFG.baseSpeed * Math.pow(CFG.speedGain, effLevel));
  S.zoneW = Math.max(CFG.minZone, CFG.baseZone * Math.pow(CFG.zoneShrink, effLevel));
  
  /* level 20+ : zone khud bhi sarakta hai - speed cap ke baad bhi game barhta rehta hai */
  S.drift = (effLevel >= CFG.driftFrom)
    ? (Math.random() < 0.5 ? -1 : 1) * Math.min(0.20, CFG.driftRate * (1 + (effLevel - CFG.driftFrom) * 0.08))
    : 0;
}

function placeZone(){
  var m = shp().wrap ? 0.02 : 0.035;
  var span = 1 - S.zoneW - m * 2;
  if (span < 0) span = 0;

  /* FIX (fairness): marker hamesha t=0 se chalta hai. Pehle zone bilkul start ke
     paas bhi ban sakta tha -> level 14 par sirf 24ms react time. Ab minimum
     reaction window guarantee hai. */
  var need = S.speed * CFG.minReact + S.zoneW / 2;
  var maxMid = m + span + S.zoneW / 2;
  if (need > maxMid * 0.92) need = maxMid * 0.92;

  var lo = need - S.zoneW / 2;
  if (lo < m) lo = m;
  var hi = m + span;
  if (hi < lo) hi = lo;
  S.zoneA = lo + Math.random() * (hi - lo);

  S.zoneIn = 0;      /* naya zone chhota se bara ho kar aata hai */
  trail.length = 0;
}

function say(t, sub){ S.msg = t; S.msgSub = sub || ""; S.msgT = 1.7; }
function banner(t, sub){ S.mile = t; S.mileSub = sub || ""; S.mileT = 1.6; }
function shopSay(t){ S.shopMsg = t; S.shopMsgT = 1.8; }

function gainFor(perfect){
  var g = 1 + Math.floor(S.level / 2);
  if (perfect) g *= 2;
  if (S.chain >= 3) g += Math.floor(S.chain / 3);
  return g;
}

function newRun(){
  S.phase = "idle"; S.banked = 0; S.pot = 0; S.level = 0; S.lives = CFG.lives;
  S.pos = 0; S.dir = 1; S.chain = 0; 
  var sidx = SHAPES.findIndex(function(s) { return s.id === shapeId; });
  S.shape = sidx >= 0 ? sidx : 0;
  S.coinsRun = 0; S.newBest = false;
  S.zoneIn = 0; S.wash = 0; S.potPunch = 0; S.washCol = "#ffffff";
  shocks.length = 0; coinsFly.length = 0;
  S.flash = 0; S.shake = 0; S.happyT = 0; S.zoom = 0;
  S.missT = 0; S.mileT = 0;
  lastSentScore = -1;
  parts.length = 0; pops.length = 0; trail.length = 0; stops.length = 0;
  applyLevel();
  placeZone();
  say("TAP TO STOP THE LINE", "3 LIVES - CASH OUT EARLY");
}

function gameOver(){
  S.phase = "over";
  deaths++;              /* FIX: ad gate ab game-over ginta hai, har life nahi */
  sfxMiss();
  if (S.banked > best) { best = S.banked; S.newBest = true; }
  sendScore(S.banked);
  queueSave();
  maybeAd();
  if (S.newBest) {
    var cc = ["#ffd166", "#22d3a6", "#38bdf8", "#ff4d8d", "#a855f7"], ci;
    for (ci = 0; ci < 5; ci++) burst(55 + ci * 85, 150, 14, cc[ci], 330);
    wash("#ffd166");
  }
}

function stopLine(){
  if (S.phase === "over" || S.phase === "miss") return;
  if (S.phase === "idle") S.phase = "run";

  var half = S.zoneW / 2;
  var mid  = S.zoneA + half;
  var d    = S.pos - mid;
  if (shp().wrap) { if (d > 0.5) d -= 1; if (d < -0.5) d += 1; }
  var ad = Math.abs(d);
  var hit = ad <= half;
  var m, i, forced, perfect, g, close;

  if (hit) {
    perfect = ad <= half * CFG.perfectBand;
    if (perfect) S.chain++; else S.chain = 0;
    g = gainFor(perfect);
    S.pot += g;
    S.level++;
    if (S.level > bestLevel) { bestLevel = S.level; queueSave(); }
    S.happyT = 0.5; S.zoom = 1; S.flash = perfect ? 0.55 : 0.30;
    m = pathAt(S.pos);
    burst(m.x, m.y, perfect ? 26 : 14, perfect ? "#ffd166" : tier().col, perfect ? 300 : 200);
    shock(m.x, m.y, perfect ? "#ffd166" : tier().col, !!perfect);
    coinFly(m.x, m.y, Math.min(9, 2 + Math.floor(g / 2)));
    if (S.chain >= 3) burst(m.x, m.y, 10, "#ffd166", 170);
    pop("+" + g, 225, 262, perfect ? "#ffd166" : "#ffffff", perfect ? 26 : 21);
    say(perfect ? "PERFECT!" : "GOOD", S.chain >= 2 ? ("CHAIN x" + S.chain) : "");
    sfxHit(perfect);
    buzz(perfect ? [12,18,12] : 18);
    slowT = 0;   /* FIX: pehle perfect hit slow-motion deta tha -> agla round asaan ho jata tha (ulta inaam) */
    stops.push({ t:S.pos, ok:true, life:1.5 });
    if (stops.length > 6) stops.shift();

    if (MILESTONES[S.level]) { banner(MILESTONES[S.level], "LEVEL " + S.level); sfxMile(); buzz([20,40,20,40]); wash(tier().col); }

    /* The shape is now exclusively driven by the Shop selection. S.shape is updated in buyOrEquip() and initGame(). */

    applyLevel();
    S.pos = 0; S.dir = 1;
    placeZone();

  } else {
    S.lives--;
    S.missPos = S.pos;
    S.missGap = ad - half;
    stops.push({ t:S.pos, ok:false, life:1.5 });
    if (stops.length > 6) stops.shift();
    S.pot = 0;
    S.chain = 0;
    S.flash = 0.85; S.shake = 1;
    close = ad <= half + CFG.closeMargin;
    m = pathAt(S.pos);
    burst(m.x, m.y, 20, "#ff4d5e", 240);
    shock(m.x, m.y, "#ff4d5e", true);
    wash("#ff4d5e");
    pop("-1 LIFE", 225, 262, "#ff4d5e", 22);
    sfxLife();
    buzz(close ? 60 : 120);

    if (S.lives <= 0) {
      S.lives = 0;
      gameOver();
    } else {
      say(close ? "SO CLOSE" : "MISSED", S.lives + (S.lives === 1 ? " LIFE LEFT" : " LIVES LEFT"));
      S.phase = "miss";
      S.missT = CFG.missFreeze;
    }
  }
}

function cashOut(){
  if (S.pot <= 0) { say("NOTHING TO BANK", ""); sfxDeny(); return; }
  var v = S.pot;
  S.pot = 0;
  S.banked   += v;
  wallet     += v;
  S.coinsRun += v;
  if (S.banked > best) { best = S.banked; S.newBest = true; }
  sendScore(S.banked);
  queueSave();
  burst(225, 288, 30, "#22d3a6", 280);
  pop("+" + v + " BANKED", 225, 250, "#22d3a6", 24);
  say("BANKED " + v, "COINS +" + v);
  sfxCash(); buzz([15,30,15,30,40]);
  S.chain = 0;
  S.phase = "run";
  S.pos = 0; S.dir = 1;
  placeZone();
}

function buyOrEquip(kind, idx){
  var list = (kind === "char") ? CHARS : (kind === "obj" ? OBJS : (kind === "bg" ? BGS : SHAPES));
  var it = list[idx];
  if (!it) return;
  var key = kind + ":" + it.id;
  var owned = !!OWNED[key] || it.price === 0;
  var b;

  if (!owned) {
    if (wallet < it.price) {
      shopSay("NEED " + (it.price - wallet) + " MORE COINS");
      sfxDeny(); buzz(40);
      return;
    }
    wallet -= it.price;
    OWNED[key] = true;
    shopSay("BOUGHT " + it.name + " - " + wallet + " COINS LEFT");
    sfxBuy(); buzz([15,25,15]);
    S.buyFlash = 1;
    b = tileBox(kind, idx);
    burst(b.x + b.w / 2, b.y + 40, 22, it.col || "#22d3a6", 220);
    queueSave();
    return;
  }

  if (kind === "char") charId = it.id; else if (kind === "obj") objId = it.id; else if (kind === "bg") bgId = it.id; else shapeId = it.id;
  
  if (kind === "shape") {
      var sidx = SHAPES.findIndex(function(s) { return s.id === shapeId; });
      S.shape = sidx >= 0 ? sidx : 0;
  }
  
  shopSay(it.name + " EQUIPPED");
  sfxEquip(); buzz(15);
  queueSave();
}


/* ----------------------------------------------------------
   9. INPUT
   ---------------------------------------------------------- */
var cvs = document.getElementById("c");
var ctx = cvs.getContext("2d");

var SND   = { x:338, y:26,  w:78,  h:28 };
var STYB  = { x:34,  y:26,  w:96,  h:28 };
var STYLES = ["pro", "flat", "segment", "neon", "glass"];

/* bar ka look game ke andar se badlo - jo pasand aaye wahi save ho jata hai */
function cycleStyle(){
  var i = STYLES.indexOf(CFG.barStyle);
  CFG.barStyle = STYLES[(i + 1) % STYLES.length];
  say("BAR STYLE", CFG.barStyle.toUpperCase());
  sfxOpen();
  queueSave();
}
var CASH  = { x:45,  y:640, w:168, h:62 };
var SHOPB = { x:223, y:640, w:88,  h:62 };
var LEVB  = { x:321, y:640, w:84,  h:62 };
var LBACK = { x:125, y:714, w:200, h:52 };

function toLocal(src){
  var r = cvs.getBoundingClientRect();
  var cx = (src.clientX !== undefined) ? src.clientX : 0;
  var cy = (src.clientY !== undefined) ? src.clientY : 0;
  return { x: (cx - r.left) / r.width * W, y: (cy - r.top) / r.height * H };
}
function hitBox(p, b){ return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h; }

function press(e){
  var now = Date.now(), p, i, b;

  /* mobile double-fire guard: touchstart ke baad synthetic mousedown aata hai */
  if (e.type === "touchstart") lastTouch = now;
  else if (now - lastTouch < 600) return;

  if (e.cancelable) e.preventDefault();
  initAudio();
  if (!gameReadySent || paused) return;

  if (e.type === "touchstart" && e.changedTouches && e.changedTouches.length) p = toLocal(e.changedTouches[0]);
  else p = toLocal(e);

  if (S.screen === "levels") {
    S.screen = "game"; sfxOpen();
    return;
  }

  if (S.screen === "shop") {
    if (p.y >= 90 && p.y <= 140) {
      if (p.x < 112) S.shopTab = "char";
      else if (p.x < 225) S.shopTab = "obj";
      else if (p.x < 337) S.shopTab = "shape";
      else S.shopTab = "bg";
      S.shopPage = 0;
      sfxOpen();
      return;
    }
    var list = (S.shopTab === "char") ? CHARS : (S.shopTab === "obj" ? OBJS : (S.shopTab === "shape" ? SHAPES : BGS));
    S.shopPage = S.shopPage || 0;
    var maxPages = Math.ceil(list.length / 6);
    if (maxPages > 1 && p.y >= 430 && p.y <= 480) {
        if (p.x < 170 && S.shopPage > 0) { S.shopPage--; sfxOpen(); return; }
        if (p.x > 280 && S.shopPage < maxPages - 1) { S.shopPage++; sfxOpen(); return; }
    }
    var startIdx = S.shopPage * 6;
    var endIdx = Math.min(startIdx + 6, list.length);
    for (i = startIdx; i < endIdx; i++) { 
      b = tileBox(S.shopTab, i - startIdx); 
      if (hitBox(p, b)) { buyOrEquip(S.shopTab, i); return; } 
    }
    if (hitBox(p, BACK)) { S.screen = "game"; sfxOpen(); }
    return;
  }

  if (hitBox(p, STYB)) { cycleStyle(); return; }

  if (!IN_YT && hitBox(p, SND)) { userSound = !userSound; applyAudioGate(); return; }

  if (hitBox(p, LEVB)) { S.screen = "levels"; sfxOpen(); return; }

  if (S.phase === "over") {
    if (hitBox(p, SHOPB)) { S.screen = "shop"; sfxOpen(); return; }
    newRun();
    return;
  }

  if (S.phase === "idle" && hitBox(p, SHOPB)) { S.screen = "shop"; sfxOpen(); return; }

  if (hitBox(p, CASH)) { cashOut(); return; }

  stopLine();
}

window.addEventListener("mousedown", press);
window.addEventListener("touchstart", press, { passive: false });
window.addEventListener("keydown", function(e){
  if (!gameReadySent) return;
  if (e.code === "Space" || e.code === "Enter" || e.code === "NumpadEnter") {
    e.preventDefault();
    initAudio();
    if (S.screen === "shop" || S.screen === "levels") { S.screen = "game"; return; }
    if (S.phase === "over") newRun(); else stopLine();
  } else if (e.code === "KeyC") {
    initAudio();
    if (S.screen === "game") cashOut();
  } else if (e.code === "KeyB") {
    initAudio();
    S.screen = (S.screen === "shop") ? "game" : "shop";
  } else if (e.code === "KeyL") {
    initAudio();
    S.screen = (S.screen === "levels") ? "game" : "levels";
  } else if (e.code === "KeyS") {
    initAudio();
    cycleStyle();
  } else if (e.code === "KeyM" && !IN_YT) {
    userSound = !userSound; applyAudioGate();
  }
});


/* ----------------------------------------------------------
   10. DRAW HELPERS
   ---------------------------------------------------------- */
function resize(){
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var vw = window.innerWidth  || W;
  var vh = window.innerHeight || H;
  var sc = Math.min(vw / W, vh / H);
  cvs.width  = Math.round(W * dpr);
  cvs.height = Math.round(H * dpr);
  cvs.style.width  = Math.round(W * sc) + "px";
  cvs.style.height = Math.round(H * sc) + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.textBaseline = "middle";
}
window.addEventListener("resize", resize);
window.addEventListener("orientationchange", function(){ setTimeout(resize, 120); });

function rr(x, y, w, h, r){
  if (r > w / 2) r = w / 2;
  if (r > h / 2) r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);     ctx.quadraticCurveTo(x + w, y,     x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);     ctx.quadraticCurveTo(x, y + h,     x, y + h - r);
  ctx.lineTo(x, y + r);         ctx.quadraticCurveTo(x, y,         x + r, y);
  ctx.closePath();
}

function text(t, x, y, size, color, align, sp){
  ctx.save();
  ctx.font = "700 " + size + "px ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
  ctx.fillStyle = color || "#e9edf5";
  ctx.textAlign = align || "center";
  ctx.textBaseline = "middle";
  if (sp) { try { ctx.letterSpacing = sp + "px"; } catch(e){} }
  ctx.fillText(t, x, y);
  ctx.restore();
}

var TRACK = ["#252f5c", "#1c5573", "#1a6b56", "#6b5a1a", "#6b2340"];
function hx(c){
  return [parseInt(c.substr(1,2),16), parseInt(c.substr(3,2),16), parseInt(c.substr(5,2),16)];
}
function mix(a, b, t){
  var A = hx(a), B = hx(b);
  return "rgb(" + Math.round(A[0]+(B[0]-A[0])*t) + "," +
                 Math.round(A[1]+(B[1]-A[1])*t) + "," +
                 Math.round(A[2]+(B[2]-A[2])*t) + ")";
}
function trackCol(t){
  var n = TRACK.length - 1;
  var i = Math.min(n - 1, Math.max(0, Math.floor(t * n)));
  return mix(TRACK[i], TRACK[i+1], t * n - i);
}

/* Ek hi function har shape ka raasta bana deta hai. */
function strokePath(from, to, steps){
  var i, t, p;
  ctx.beginPath();
  for (i = 0; i <= steps; i++) {
    t = from + (to - from) * (i / steps);
    p = pathAt(t);
    if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
}

/* raaste ke samandar-samandar (normal ke saath) shift kar ke stroke */
function strokePathOffset(from, to, steps, off){
  var i, t, p, ang, x, y;
  ctx.beginPath();
  for (i = 0; i <= steps; i++) {
    t = from + (to - from) * (i / steps);
    p = pathAt(t); ang = tangentAt(t);
    x = p.x - Math.sin(ang) * off;
    y = p.y + Math.cos(ang) * off;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/* raaste ke aar-paar khadi chhoti lakeer (tick / zone post) */
function crossTick(t, len, w, col, alpha){
  var p = pathAt(t), ang = tangentAt(t);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(p.x, p.y);
  ctx.rotate(ang);
  ctx.fillStyle = col;
  rr(-w / 2, -len / 2, w, len, w / 2);
  ctx.fill();
  ctx.restore();
}

/* chalti hui chevron - direction batati hai */
function chevron(t, col, alpha, sc){
  var p = pathAt(t), ang = tangentAt(t);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(p.x, p.y);
  ctx.rotate(ang);
  ctx.strokeStyle = col;
  ctx.lineWidth = 2.4 * sc;
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(-4 * sc, -5 * sc);
  ctx.lineTo( 3 * sc, 0);
  ctx.lineTo(-4 * sc, 5 * sc);
  ctx.stroke();
  ctx.restore();
}

function drawTrack(){
  var lw = shp().lw;
  if (CFG.barStyle === "pro")     { drawTrackPro(lw);     return; }
  if (CFG.barStyle === "flat")    { drawTrackFlat(lw);    return; }
  if (CFG.barStyle === "segment") { drawTrackSegment(lw); return; }
  if (CFG.barStyle === "neon")    { drawTrackNeon(lw);    return; }
  drawTrackGlass(lw);
}

/* STYLE 5 - "pro" (naya default): saaf slate bar + tier rang ki progress fill.
   koi rainbow gradient nahi, is liye game ke dark neon theme se sabse zyada match karta hai. */
function drawTrackPro(lw){
  var T = tier(), segs = 90, i, a, b, upto = S.pos;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  /* bahri narm glow */
  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = T.col;
  ctx.shadowColor = T.glow + "0.90)"; ctx.shadowBlur = 26;
  ctx.lineWidth = lw + 11;
  strokePath(0, 1, 60);
  ctx.shadowBlur = 0;

  /* housing - neutral slate, saaf aur premium */
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "#161d2e";
  ctx.lineWidth = lw + 4;
  strokePath(0, 1, 70);
  ctx.strokeStyle = "#0a0f1c";
  ctx.lineWidth = lw;
  strokePath(0, 1, 70);

  /* andar halka shade - gehrai */
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = "#151d30";
  ctx.lineWidth = lw * 0.50;
  strokePathOffset(0, 1, 70, -(lw * 0.22));
  ctx.globalAlpha = 1;

  /* progress fill - start se marker tak tier rang bharta jata hai */
  if (upto > 0.006) {
    for (i = 0; i < segs; i++) {
      a = (i / segs) * upto;
      b = ((i + 1.25) / segs) * upto;
      if (b > upto) b = upto;
      ctx.globalAlpha = 0.16 + 0.72 * (i / segs);
      ctx.strokeStyle = T.col;
      ctx.lineWidth = lw * 0.70;
      strokePath(a, b, 2);
    }
    ctx.globalAlpha = 1;
  }

  /* 8 saaf tick lakeeren */
  for (i = 1; i < 8; i++) crossTick(i / 8, lw * 0.44, 1.4, "#ffffff", 0.07);

  /* upar chamak + patli rim light */
  ctx.globalAlpha = 0.11;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = lw * 0.20;
  strokePathOffset(0, 1, 70, -(lw * 0.30));
  ctx.globalAlpha = 0.14;
  ctx.lineWidth = 1.2;
  strokePathOffset(0, 1, 70, -(lw * 0.5 - 0.8));
  strokePathOffset(0, 1, 70,  (lw * 0.5 - 0.8));

  ctx.restore();
}

/* STYLE 1 - "segment": LED khanay. Position parhna sabse asaan. */
function drawTrackSegment(lw){
  var n = 24, i, a, b, c, g = 0.0024;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  ctx.shadowColor = "rgba(0,0,0,0.9)"; ctx.shadowBlur = 22;
  ctx.strokeStyle = "#05070d";
  ctx.lineWidth = lw + 13;
  strokePath(0, 1, 80);
  ctx.shadowBlur = 0;

  ctx.strokeStyle = "#0d1424";
  ctx.lineWidth = lw + 2;
  strokePath(0, 1, 80);

  ctx.lineCap = "butt";
  for (i = 0; i < n; i++) {
    a = i / n + g; b = (i + 1) / n - g;
    c = trackCol((i + 0.5) / n);
    ctx.strokeStyle = c;
    ctx.globalAlpha = 0.24;
    ctx.lineWidth = lw * 0.90;
    strokePath(a, b, 3);
    ctx.globalAlpha = 0.92;
    ctx.shadowColor = c; ctx.shadowBlur = 12;
    ctx.lineWidth = lw * 0.24;
    strokePath(a, b, 3);
    ctx.shadowBlur = 0;
  }
  ctx.restore();
}

/* STYLE 2 - "neon": khokhla track, do chamakti rails. */
/* hex colour ko kaale ki taraf dabana - shafaf (alpha) fill ke bajaye thos rang,
   is se overlap ki lakeeren (seams) nahi banti */
/* STYLE 4 - "flat": saaf thos gradient bar + safed outline zone (user ki pasand). */
function drawTrackFlat(lw){
  var segs = 120, i, a, b, T = tier();
  ctx.save();
  ctx.lineJoin = "round";

  /* tier ke rang ka bahri glow - game ke neon theme se match karta hai */
  ctx.lineCap = "round";
  ctx.globalAlpha = 0.20;
  ctx.strokeStyle = T.col;
  ctx.shadowColor = T.glow + "0.95)"; ctx.shadowBlur = 30;
  ctx.lineWidth = lw + 12;
  strokePath(0, 1, 60);
  ctx.shadowBlur = 0;

  /* neeche gehra saya - bar utthi hui lagti hai */
  ctx.globalAlpha = 0.60;
  ctx.strokeStyle = "#03050a";
  ctx.shadowColor = "rgba(0,0,0,0.90)"; ctx.shadowBlur = 16;
  ctx.lineWidth = lw + 5;
  strokePath(0, 1, 60);
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;

  /* thos hamwar gradient - opaque rang, is liye koi seam nahi banta */
  ctx.lineCap = "butt";
  for (i = 0; i < segs; i++) {
    a = i / segs; b = (i + 1.25) / segs; if (b > 1) b = 1;
    ctx.strokeStyle = trackCol(a);
    ctx.lineWidth = lw;
    strokePath(a, b, 2);
  }

  /* dono sire gol */
  ctx.lineCap = "round";
  ctx.strokeStyle = trackCol(0);     strokePath(0, 0.009, 2);
  ctx.strokeStyle = trackCol(0.999); strokePath(0.991, 1, 2);

  /* upar chamak + neeche shade - glossy pill (flat magar basic nahi) */
  ctx.globalAlpha = 0.13;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = lw * 0.30;
  strokePathOffset(0, 1, 70, -(lw * 0.31));
  ctx.globalAlpha = 0.26;
  ctx.strokeStyle = "#03050a";
  ctx.lineWidth = lw * 0.26;
  strokePathOffset(0, 1, 70, (lw * 0.33));
  ctx.globalAlpha = 1;

  /* baareek ticks - bar par paimana, theme ki detail */
  for (i = 1; i < 24; i++) crossTick(i / 24, lw * 0.50, 1.1, "#ffffff", 0.055);

  /* kinaron par patli roshni */
  ctx.globalAlpha = 0.10;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.1;
  strokePathOffset(0, 1, 70, -(lw * 0.5 - 0.6));
  strokePathOffset(0, 1, 70,  (lw * 0.5 - 0.6));

  ctx.restore();
}

/* flat style ka zone: thos rang + safed baahri outline + safed PERFECT patti */
function drawZoneFlat(){
  var T = tier(), lw = shp().lw;
  var a = S.zoneA, b = S.zoneA + S.zoneW;
  var half = S.zoneW / 2, mid = a + half, pb = half * CFG.perfectBand;
  var tight = S.zoneW <= CFG.minZone * 1.7;
  var pulse = 0.5 + 0.5 * Math.sin(TT * (tight ? 10.5 : 5.0));
  var col   = tight ? "#ff4d5e" : T.col;
  var glow  = tight ? "rgba(255,77,94," : T.glow;
  var gin   = 0.35 + 0.65 * Math.min(1, (S.zoneIn === undefined ? 1 : S.zoneIn) * 1.5);

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "butt";

  /* halka halo */
  ctx.globalAlpha = (0.16 + 0.14 * pulse) * gin;
  ctx.shadowColor = glow + "0.90)";
  ctx.shadowBlur = 26;
  ctx.strokeStyle = col;
  ctx.lineWidth = lw + 10;
  strokePath(a, b, 14);
  ctx.shadowBlur = 0;

  /* thos zone */
  ctx.globalAlpha = gin;
  ctx.strokeStyle = col;
  ctx.lineWidth = lw;
  strokePath(a, b, 16);

  /* PERFECT patti - colored gold so it doesn't look like a second needle */
  ctx.shadowColor = "rgba(255,209,102,0.85)";
  ctx.shadowBlur = 12 + 8 * pulse;
  ctx.strokeStyle = "#ffd166";
  ctx.lineWidth = lw;
  strokePath(mid - pb, mid + pb, 6);
  ctx.shadowBlur = 0;
  
  /* Inner bright stripe for perfect band */
  ctx.strokeStyle = "#fff0b3";
  ctx.lineWidth = lw * 0.4;
  strokePath(mid - pb * 0.6, mid + pb * 0.6, 6);

  /* safed outline - screenshot wala look */
  ctx.lineCap = "round";
  ctx.globalAlpha = 0.95 * gin;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2.2;
  strokePathOffset(a, b, 16, -(lw * 0.5 + 1.7));
  strokePathOffset(a, b, 16,  (lw * 0.5 + 1.7));
  crossTick(a, lw + 3.4, 2.2, "#ffffff", 0.95 * gin);
  crossTick(b, lw + 3.4, 2.2, "#ffffff", 0.95 * gin);

  ctx.restore();
}

/* flat style ka needle: patli safed lakeer jo bar se bahar nikalti hai */
function drawNeedleFlat(p, ang, col){
  var lw = shp().lw, ext = lw * 1.05;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(ang);

  /* Drop shadow housing for pop */
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = "#030408";
  ctx.shadowColor = "rgba(0,0,0,0.85)";
  ctx.shadowBlur = 12;
  rr(-3.5, -ext, 7.0, ext * 2, 3.5);
  ctx.fill();
  ctx.shadowBlur = 0;

  /* Bright white main body */
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(255,255,255,0.95)";
  ctx.shadowBlur = 16;
  rr(-1.8, -ext * 0.96, 3.6, ext * 1.92, 1.8);
  ctx.fill();
  ctx.shadowBlur = 0;

  /* Inner color stripe */
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = col;
  rr(-0.8, -ext * 0.65, 1.6, ext * 1.30, 0.8);
  ctx.fill();
  
  /* Precision tips */
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "#ffffff";
  ctx.shadowBlur = 8;
  ctx.beginPath(); ctx.arc(0, -ext * 0.85, 2.2, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(0,  ext * 0.85, 2.2, 0, Math.PI*2); ctx.fill();

  ctx.restore();
}

function dimHex(h, f){
  var r = parseInt(h.slice(1,3),16), g = parseInt(h.slice(3,5),16), b = parseInt(h.slice(5,7),16);
  return "rgb(" + ((r*f)|0) + "," + ((g*f)|0) + "," + ((b*f)|0) + ")";
}

function drawTrackNeon(lw){
  ctx.save();
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  
  /* Deep Blue/Cyan glowing outer aura */
  ctx.shadowColor = "#00f0ff";
  ctx.shadowBlur = 20;
  ctx.strokeStyle = "rgba(0, 240, 255, 0.4)";
  ctx.lineWidth = lw * 0.8;
  strokePath(0, 1, 80);
  
  /* Inner bright crisp track line */
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#e0ffff";
  ctx.lineWidth = 3.5;
  strokePath(0, 1, 90);
  
  ctx.restore();
}

/* STYLE 3 - "glass": shishe jaisa bar (pichla wala). */
function drawTrackGlass(lw){
  var segs = 110, i, a, b, p, q, k, ct;

  ctx.save();
  ctx.lineJoin = "round";

  /* 1. neeche gehra saya - track hawa mein tairta hua lagta hai */
  ctx.lineCap = "round";
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = lw + 16;
  ctx.shadowColor = "rgba(0,0,0,0.9)";
  ctx.shadowBlur = 24;
  strokePath(0, 1, 80);
  ctx.shadowBlur = 0;

  /* 2. bahar ka rim - kinara saaf nazar aata hai */
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "#0b0f1a";
  ctx.lineWidth = lw + 7;
  strokePath(0, 1, 80);

  /* 3. base gradient - 110 segments + butt caps = bilkul smooth, koi seam nahi
        (pehle 48 round-cap segments overlap kar ke dhabbe banate thay) */
  ctx.lineCap = "butt";
  ctx.lineWidth = lw;
  for (i = 0; i < segs; i++) {
    a = i / segs;
    b = (i + 1.15) / segs; if (b > 1) b = 1;
    p = pathAt(a); q = pathAt(b);
    ctx.strokeStyle = trackCol(a);
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
  }
  /* butt caps ki wajah se sire kate hue thay - dobara gol karo */
  ctx.lineCap = "round";
  ctx.strokeStyle = trackCol(0);     strokePath(0, 0.010, 2);
  ctx.strokeStyle = trackCol(0.999); strokePath(0.990, 1, 2);

  /* 4. shishe wali gehrai: upar safed highlight, neeche kaala shade */
  ctx.globalAlpha = 0.13;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = lw * 0.19;
  strokePathOffset(0, 1, 80, -lw * 0.31);

  ctx.globalAlpha = 0.32;
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = lw * 0.26;
  strokePathOffset(0, 1, 80, lw * 0.30);
  ctx.globalAlpha = 1;

  /* 5. ticks - marker kahan hai, ab aankh se parha ja sakta hai */
  for (k = 1; k < 20; k++) {
    crossTick(k / 20, lw * ((k % 5 === 0) ? 0.78 : 0.50), 1.6, "#ffffff",
              (k % 5 === 0) ? 0.15 : 0.07);
  }

  /* 6. behti hui chevrons - direction saaf */
  for (k = 0; k < 3; k++) {
    ct = (TT * 0.22 + k / 3) % 1;
    chevron(ct, "#ffffff", 0.11, 1);
  }

  ctx.restore();
}

function drawZone(){
  if (CFG.barStyle === "flat" || CFG.barStyle === "pro") { drawZoneFlat(); return; }
  var T = tier(), lw = shp().lw;
  var a = S.zoneA, b = S.zoneA + S.zoneW;
  var half = S.zoneW / 2, mid = a + half, pb = half * CFG.perfectBand;
  
  if (CFG.barStyle === "neon") {
    ctx.save();
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    var pinkCol = "#ff007f";
    ctx.shadowColor = pinkCol; ctx.shadowBlur = 25;
    ctx.strokeStyle = pinkCol; ctx.lineWidth = lw * 1.1;
    strokePath(a, b, 18);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#ff66b2"; ctx.lineWidth = lw * 0.4;
    strokePath(a, b, 18);
    ctx.shadowColor = "#ffffff"; ctx.shadowBlur = 10;
    ctx.strokeStyle = "#ffffff"; ctx.lineWidth = lw * 0.4;
    strokePath(mid - pb * 0.6, mid + pb * 0.6, 6);
    ctx.restore();
    return;
  }
  
  var tight = S.zoneW <= CFG.minZone * 1.7;
  var pulse = 0.5 + 0.5 * Math.sin(TT * (tight ? 10.5 : 5.0));
  var col   = tight ? "#ff4d5e" : T.col;
  var glow  = tight ? "rgba(255,77,94," : T.glow;

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  /* bahar ka neon halo */
  ctx.globalAlpha = 0.20 + 0.16 * pulse;
  ctx.shadowColor = glow + "0.95)";
  ctx.shadowBlur = 30;
  ctx.strokeStyle = col;
  ctx.lineWidth = lw + 15;
  strokePath(a, b, 16);
  ctx.shadowBlur = 0;

  /* zone ka body */
  ctx.globalAlpha = 0.62 + 0.20 * pulse;
  ctx.strokeStyle = col;
  ctx.lineWidth = lw;
  strokePath(a, b, 18);

  /* body ke upar shine - wohi glassy look */
  ctx.globalAlpha = 0.38;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = lw * 0.15;
  strokePathOffset(a, b, 14, -lw * 0.31);

  /* PERFECT patti - distinct gold color */
  ctx.globalAlpha = 1;
  ctx.lineCap = "butt";
  ctx.shadowColor = "rgba(255,209,102,0.95)";
  ctx.shadowBlur = 12 + 10 * pulse;
  ctx.strokeStyle = "#ffd166";
  ctx.lineWidth = lw * 0.45;
  strokePath(mid - pb, mid + pb, 6);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#fff0b3";
  ctx.lineWidth = lw * 0.15;
  strokePath(mid - pb * 0.45, mid + pb * 0.45, 4);
  ctx.lineCap = "round";

  /* dono kinaron par khambe - zone ki hadd bilkul saaf */
  crossTick(a, lw * 1.45, 3.4, col, 0.95);
  crossTick(b, lw * 1.45, 3.4, col, 0.95);

  ctx.restore();
}

/* marker ke peeche ghost trail */
function drawTrail(col){
  var i, p, n = trail.length;
  if (n < 2) return;
  ctx.save();
  for (i = 0; i < n; i++) {
    p = trail[i];
    ctx.globalAlpha = (i / n) * (i / n) * 0.45;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.4 + (i / n) * 5.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/* needle - stop point ka exact pixel, isi se precision parhi jati hai */
function drawNeedle(p, ang, col){
  if (objId !== "bar") { drawObj(objId, p.x, p.y, ang, col, 1.15); return; }
  
  if (CFG.barStyle === "flat" || CFG.barStyle === "pro") { drawNeedleFlat(p, ang, col); return; }
  var lw = shp().lw;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(ang);
  
  /* 1. Base Dark Halo / Housing */
  ctx.globalAlpha = 0.65;
  ctx.fillStyle = "#05060a";
  ctx.shadowColor = "rgba(0,0,0,0.8)";
  ctx.shadowBlur = 10;
  rr(-3.8, -lw * 0.75, 7.6, lw * 1.50, 3.8);
  ctx.fill();
  ctx.shadowBlur = 0;

  /* 2. Outer Rim Light (Glassy reflection) */
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.2;
  ctx.stroke();

  /* 3. Colored Core with Glow */
  ctx.globalAlpha = 1;
  ctx.fillStyle = col;
  ctx.shadowColor = col;
  ctx.shadowBlur = 18;
  rr(-1.5, -lw * 0.68, 3.0, lw * 1.36, 1.5);
  ctx.fill();
  ctx.shadowBlur = 0;

  /* 4. Bright White Center Dot for Precision */
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "#ffffff";
  ctx.shadowBlur = 8;
  rr(-0.5, -lw * 0.30, 1.0, lw * 0.60, 0.5);
  ctx.fill();

  ctx.restore();
}

/* is run mein kahan kahan ruke - hara = laga, surkh = chooka */
function drawStops(){
  var i, s, p;
  for (i = 0; i < stops.length; i++) {
    s = stops[i];
    if (s.life <= 0) continue;
    p = pathAt(s.t);
    ctx.save();
    ctx.globalAlpha = Math.min(0.6, s.life * 0.45);
    ctx.fillStyle = s.ok ? "#22d3a6" : "#ff4d5e";
    ctx.beginPath(); ctx.arc(p.x, p.y, 2.8, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}


/* ----------------------------------------------------------
   11. THE CHARACTERS - shop se badalte hain
   ---------------------------------------------------------- */
function moodNow(){
  if (S.phase === "over") return 3;   /* mar gaya */
  if (S.happyT > 0)       return 1;   /* khush */
  if (S.level >= 8)       return 2;   /* dara hua */
  return 0;                            /* normal */
}

function drawFace(cx, cy, s, mood){
  var ex = s * 0.19, ey = cy - s * 0.05, er = s * 0.105;
  var i, sx, blinking = (S.blink > 0);

  ctx.save();
  ctx.lineCap = "round";

  if (mood === 3) {
    ctx.strokeStyle = "#05060a"; ctx.lineWidth = s * 0.05;
    for (i = -1; i <= 1; i += 2) {
      sx = cx + i * ex;
      ctx.beginPath();
      ctx.moveTo(sx - er, ey - er); ctx.lineTo(sx + er, ey + er);
      ctx.moveTo(sx + er, ey - er); ctx.lineTo(sx - er, ey + er);
      ctx.stroke();
    }
  } else if (blinking) {
    ctx.strokeStyle = "#05060a"; ctx.lineWidth = s * 0.045;
    for (i = -1; i <= 1; i += 2) {
      sx = cx + i * ex;
      ctx.beginPath(); ctx.moveTo(sx - er, ey); ctx.lineTo(sx + er, ey); ctx.stroke();
    }
  } else {
    for (i = -1; i <= 1; i += 2) {
      sx = cx + i * ex;
      ctx.beginPath(); ctx.arc(sx, ey, er, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff"; ctx.fill();
      ctx.beginPath();
      ctx.arc(sx + (mood === 2 ? -er * 0.25 : 0), ey + er * 0.12, er * 0.48, 0, Math.PI * 2);
      ctx.fillStyle = "#05060a"; ctx.fill();
    }
  }

  ctx.strokeStyle = "#05060a";
  ctx.lineWidth = s * 0.045;
  ctx.beginPath();
  if (mood === 1)      ctx.arc(cx, cy + s * 0.10, s * 0.16, 0.15 * Math.PI, 0.85 * Math.PI);
  else if (mood === 2) ctx.arc(cx, cy + s * 0.22, s * 0.15, 1.15 * Math.PI, 1.85 * Math.PI);
  else if (mood === 3) ctx.arc(cx, cy + s * 0.24, s * 0.14, 1.15 * Math.PI, 1.85 * Math.PI);
  else                 ctx.arc(cx, cy + s * 0.12, s * 0.13, 0.20 * Math.PI, 0.80 * Math.PI);
  ctx.stroke();

  if (mood === 1) {
    ctx.fillStyle = "rgba(255,120,150,0.45)";
    for (i = -1; i <= 1; i += 2) {
      ctx.beginPath(); ctx.arc(cx + i * s * 0.30, cy + s * 0.06, s * 0.075, 0, Math.PI * 2); ctx.fill();
    }
  }

  if (mood === 2) {
    ctx.strokeStyle = "#05060a"; ctx.lineWidth = s * 0.038;
    ctx.beginPath();
    ctx.moveTo(cx - ex - er, ey - er * 1.5); ctx.lineTo(cx - ex + er, ey - er * 2.3);
    ctx.moveTo(cx + ex + er, ey - er * 1.5); ctx.lineTo(cx + ex - er, ey - er * 2.3);
    ctx.stroke();
    ctx.fillStyle = "#7dd3fc";
    ctx.beginPath();
    ctx.arc(cx + s * 0.34, cy - s * 0.12 + Math.sin(TT * 3) * s * 0.02, s * 0.05, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawBody(id, cx, cy, s, col){
  var i, a, r, x1, x2;
  ctx.fillStyle = col;

  if (id === "pill") {
    rr(cx - s*0.32, cy - s*0.48, s*0.64, s*0.96, s*0.32); ctx.fill();

  } else if (id === "star") {
    ctx.beginPath();
    for (i = 0; i < 10; i++) {
      a = -Math.PI/2 + i * Math.PI / 5;
      r = (i % 2 === 0) ? s*0.56 : s*0.25;
      if (i === 0) ctx.moveTo(cx + Math.cos(a)*r, cy + Math.sin(a)*r);
      else         ctx.lineTo(cx + Math.cos(a)*r, cy + Math.sin(a)*r);
    }
    ctx.closePath(); ctx.fill();

  } else if (id === "ghost") {
    ctx.beginPath();
    ctx.arc(cx, cy - s*0.06, s*0.44, Math.PI, 0);
    ctx.lineTo(cx + s*0.44, cy + s*0.30);
    for (i = 0; i < 4; i++) {
      x1 = cx + s*0.44 - s*0.11 - s*0.22*i;
      x2 = cx + s*0.44 - s*0.22*(i + 1);
      ctx.quadraticCurveTo(x1, cy + s*0.30 + ((i % 2) ? -s*0.11 : s*0.11), x2, cy + s*0.30);
    }
    ctx.closePath(); ctx.fill();

  } else if (id === "bot") {
    ctx.strokeStyle = col; ctx.lineWidth = s*0.05; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(cx, cy - s*0.42); ctx.lineTo(cx, cy - s*0.60); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy - s*0.64, s*0.06, 0, Math.PI*2); ctx.fill();
    rr(cx - s*0.42, cy - s*0.42, s*0.84, s*0.84, s*0.16); ctx.fill();

  } else if (id === "flame") {
    ctx.beginPath();
    ctx.moveTo(cx, cy - s*0.56);
    ctx.bezierCurveTo(cx + s*0.46, cy - s*0.14, cx + s*0.40, cy + s*0.50, cx, cy + s*0.50);
    ctx.bezierCurveTo(cx - s*0.40, cy + s*0.50, cx - s*0.46, cy - s*0.14, cx, cy - s*0.56);
    ctx.closePath(); ctx.fill();

  } else {
    /* blob - default */
    rr(cx - s*0.44, cy - s*0.44, s*0.88, s*0.88, s*0.30); ctx.fill();
  }
}

function drawChar(id, cx, cy, s, col, mood){
  var T = tier();
  var y = cy + Math.sin(TT * 2.1) * s * 0.03;
  ctx.save();
  ctx.shadowColor = T.glow + "0.55)";
  ctx.shadowBlur  = s * 0.55;
  drawBody(id, cx, y, s, col);
  ctx.restore();
  drawFace(cx, y, s, mood);
}


/* ----------------------------------------------------------
   12. THE MOVING OBJECTS - shop se badalte hain
   ---------------------------------------------------------- */
function drawObj(id, x, y, ang, col, sc){
  sc = sc || 1;
  var i;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.shadowColor = col;
  ctx.shadowBlur = 18 * sc;
  ctx.fillStyle = col;

  if (id === "orb") {
    ctx.beginPath(); ctx.arc(0, 0, 12*sc, 0, Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.arc(-3.5*sc, -3.5*sc, 4*sc, 0, Math.PI*2);
    ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.fill();

  } else if (id === "arrow") {
    ctx.beginPath();
    ctx.moveTo(16*sc, 0);
    ctx.lineTo(-10*sc, -13*sc);
    ctx.lineTo(-4*sc, 0);
    ctx.lineTo(-10*sc, 13*sc);
    ctx.closePath(); ctx.fill();

  } else if (id === "diamond") {
    ctx.rotate(TT * 3);
    ctx.beginPath();
    ctx.moveTo(0, -15*sc); ctx.lineTo(11*sc, 0);
    ctx.lineTo(0,  15*sc); ctx.lineTo(-11*sc, 0);
    ctx.closePath(); ctx.fill();

  } else if (id === "blade") {
    rr(-20*sc, -4*sc, 40*sc, 8*sc, 4*sc); ctx.fill();
    ctx.globalAlpha = 0.35;
    rr(-36*sc, -2*sc, 22*sc, 4*sc, 2*sc); ctx.fill();
    ctx.globalAlpha = 1;

  } else if (id === "comet") {
    for (i = 3; i >= 1; i--) {
      ctx.globalAlpha = 0.15 * i;
      ctx.beginPath(); ctx.arc(-i*11*sc, 0, (11 - i*2.2)*sc, 0, Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(0, 0, 11*sc, 0, Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.arc(-3*sc, -3*sc, 3.5*sc, 0, Math.PI*2);
    ctx.fillStyle = "rgba(255,255,255,0.9)"; ctx.fill();

  } else {
    /* bar - default (looks like a sleek needle now) */
    ctx.globalAlpha = 0.65;
    ctx.fillStyle = "#05060a";
    rr(-3.8*sc, -19*sc, 7.6*sc, 38*sc, 3.8*sc);
    ctx.fill();
    
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.2*sc;
    ctx.stroke();
    
    ctx.globalAlpha = 1;
    ctx.fillStyle = col;
    ctx.shadowColor = col;
    ctx.shadowBlur = 18*sc;
    rr(-1.5*sc, -17*sc, 3.0*sc, 34*sc, 1.5*sc);
    ctx.fill();
    ctx.shadowBlur = 0;
    
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "#ffffff";
    ctx.shadowBlur = 8*sc;
    rr(-0.5*sc, -8*sc, 1.0*sc, 16*sc, 0.5*sc);
    ctx.fill();
  }
  ctx.restore();
}

function drawHeart(x, y, s, filled){
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(0, s*0.34);
  ctx.bezierCurveTo(-s*1.10, -s*0.42, -s*0.36, -s*1.02, 0, -s*0.34);
  ctx.bezierCurveTo( s*0.36, -s*1.02,  s*1.10, -s*0.42, 0,  s*0.34);
  ctx.closePath();
  if (filled) {
    ctx.fillStyle = "#ff4d5e";
    ctx.shadowColor = "rgba(255,77,94,0.65)";
    ctx.shadowBlur = 10;
    ctx.fill();
  } else {
    ctx.strokeStyle = "#9ca3af";
    ctx.lineWidth = s * 0.22;
    ctx.stroke();
  }
  ctx.restore();
}

function drawCoin(x, y, r){
  ctx.save();
  ctx.shadowColor = "rgba(255,209,102,0.55)"; ctx.shadowBlur = 8;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2);
  ctx.fillStyle = "#ffd166"; ctx.fill();
  ctx.restore();
  ctx.beginPath(); ctx.arc(x, y, r*0.52, 0, Math.PI*2);
  ctx.fillStyle = "rgba(5,6,10,0.35)"; ctx.fill();
}

function stepFx(dt){
  var i, p;
  for (i = parts.length - 1; i >= 0; i--) {
    p = parts[i];
    p.life -= dt;
    if (p.life <= 0) { parts.splice(i, 1); continue; }
    p.vy += 620 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.985;
  }
  for (i = stops.length - 1; i >= 0; i--) {
    stops[i].life -= dt;
    if (stops[i].life <= 0) stops.splice(i, 1);
  }
  for (i = pops.length - 1; i >= 0; i--) {
    pops[i].life -= dt * 1.25;
    pops[i].y -= 42 * dt;
    if (pops[i].life <= 0) pops.splice(i, 1);
  }

  if (S.zoneIn === undefined) { S.zoneIn = 1; S.wash = 0; S.potPunch = 0; S.washCol = "#ffffff"; }
  if (S.zoneIn < 1)   { S.zoneIn   += dt * 4.2; if (S.zoneIn > 1)   S.zoneIn   = 1; }
  if (S.wash > 0)     { S.wash     -= dt * 1.9; if (S.wash < 0)     S.wash     = 0; }
  if (S.potPunch > 0) { S.potPunch -= dt * 3.0; if (S.potPunch < 0) S.potPunch = 0; }

  for (i = shocks.length - 1; i >= 0; i--) {
    p = shocks[i];
    p.life -= dt * 2.1;
    p.r += (p.max - p.r) * Math.min(1, dt * 7);
    if (p.life <= 0) shocks.splice(i, 1);
  }

  for (i = coinsFly.length - 1; i >= 0; i--) {
    p = coinsFly[i];
    if (p.d > 0) { p.d -= dt; continue; }
    p.t += dt * 1.6;
    if (p.t >= 1) {
      S.potPunch = 1;
      if (Math.random() < 0.5) sfxTick();
      coinsFly.splice(i, 1);
      continue;
    }
    var e = p.t * p.t * (3 - 2 * p.t);
    p.cx = p.sx + (p.tx - p.sx) * e;
    p.cy = p.sy + (p.ty - p.sy) * e - Math.sin(p.t * Math.PI) * 85;
  }

  if (!dust.length) initDust();
  for (i = 0; i < dust.length; i++) {
    dust[i].y -= dust[i].v * dt;
    if (dust[i].y < -4) { dust[i].y = H + 4; dust[i].x = Math.random() * W; }
  }
}

function drawFx(){
  var i, p;
  for (i = 0; i < parts.length; i++) {
    p = parts[i];
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.max));
    ctx.fillStyle = p.col;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  /* shockwave rings - har hit aur miss par phailti hui goli */
  for (i = 0; i < shocks.length; i++) {
    p = shocks[i];
    ctx.save();
    ctx.globalAlpha = Math.max(0, p.life * 0.5);
    ctx.strokeStyle = p.col;
    ctx.lineWidth = 1.5 + 4 * Math.max(0, p.life);
    ctx.shadowColor = p.col; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  /* urrte sikke */
  for (i = 0; i < coinsFly.length; i++) {
    p = coinsFly[i];
    if (p.d > 0) continue;
    drawCoin(p.cx, p.cy, 6);
  }

  for (i = 0; i < pops.length; i++) {
    p = pops[i];
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
    text(p.t, p.x, p.y, p.size, p.col);
  }
  ctx.globalAlpha = 1;

  /* poori screen par halka rang - milestone, new shape, miss, new best */
  if (S.wash > 0) {
    ctx.globalAlpha = S.wash * 0.16;
    ctx.fillStyle = S.washCol || "#ffffff";
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }
}

/* narm roshni ka gola - background ke liye */
function blob(x, y, r, col){
  var rg = ctx.createRadialGradient(x, y, 0, x, y, r);
  rg.addColorStop(0, col);
  rg.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = rg;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function drawBg(){
  var T = tier(), x, y, k, t = TT, off, g, fg, vg;
  var bgo = curBg();
  var img = getImg(bgo.src);
  if (img && img.complete) {
    /* draw cover image */
    var scale = Math.max(W / img.width, H / img.height);
    var dw = img.width * scale;
    var dh = img.height * scale;
    var dx = (W - dw) / 2;
    var dy = (H - dh) / 2;
    ctx.drawImage(img, dx, dy, dw, dh);
    
    /* 40% dark overlay so neon pops */
    ctx.fillStyle = "rgba(5, 6, 10, 0.65)";
    ctx.fillRect(0, 0, W, H);
  } else {
    /* fallback to gradient if image not loaded or not found */
    g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0,    "#0c1226");
    g.addColorStop(0.42, "#06080f");
    g.addColorStop(0.78, "#080610");
    g.addColorStop(1,    "#12081c");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  /* keep only the core vignette and some ambient glowing */
  blob(225 + Math.sin(TT * 0.11) * 150, 235 + Math.cos(TT * 0.09) * 80, 250, T.glow + "0.13)");
  
  blob(A.cx, A.cy, 265, T.glow + (0.10 + Math.min(0.13, S.level * 0.005)).toFixed(3) + ")");
  fg = ctx.createLinearGradient(0, A.cy + 105, 0, A.cy + 195);
  fg.addColorStop(0, T.glow + "0.10)");
  fg.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = fg;
  ctx.fillRect(0, A.cy + 105, W, 90);

  vg = ctx.createRadialGradient(225, 380, 200, 225, 380, 500);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.60)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
}


/* ----------------------------------------------------------
   13. GAME SCREEN
   ---------------------------------------------------------- */
function drawGame(){
  var T = tier(), i;

  ctx.save();
  if (S.shake > 0) ctx.translate((Math.random()-0.5)*14*S.shake, (Math.random()-0.5)*14*S.shake);

  drawBg();

  text("NERVE", 225, 44, 24, "#e9edf5", "center", 6);

  /* BAR look switcher - tap karo aur apni pasand ka style chuno (keyboard: S) */
  rr(STYB.x, STYB.y, STYB.w, STYB.h, 14);
  ctx.fillStyle = "#12182a"; ctx.fill();
  ctx.strokeStyle = "#2a3140"; ctx.lineWidth = 1; ctx.stroke();
  text("BAR " + CFG.barStyle.toUpperCase(), STYB.x + STYB.w/2, STYB.y + STYB.h/2, 10, "#8ea3c0", "center", 1);

  if (!IN_YT) {
    rr(SND.x, SND.y, SND.w, SND.h, 14);
    ctx.fillStyle = "#161a26"; ctx.fill();
    ctx.strokeStyle = "#2a3140"; ctx.lineWidth = 1; ctx.stroke();
    text(userSound ? "MUSIC" : "MUTED", SND.x + SND.w/2, SND.y + SND.h/2, 11,
         userSound ? "#ffffff" : "#ffffff", "center", 1);
  }

  /* 3 dil - yeh naya hai */
  for (i = 0; i < CFG.lives; i++) drawHeart(52 + i * 27, 76, 10, i < S.lives);

  text("BEST " + best, 225, 76, 13, "#ffffff", "center", 1);

  drawCoin(392, 76, 8);
  text(String(wallet), 378, 76, 14, "#ffd166", "right", 0);

  var bw = 182;
  rr(225 - bw/2, 96, bw, 26, 13);
  ctx.fillStyle = T.glow + "0.13)"; ctx.fill();
  ctx.strokeStyle = T.glow + "0.50)"; ctx.lineWidth = 1; ctx.stroke();
  var dNames=["EASY","MIDDLE","HARD"]; text(T.name + "   LV " + S.level + " - " + dNames[S.level % 3], 225, 109, 12, T.col, "center", 1.5);

  drawChar(charId, 225, 176, 86, charCol(), moodNow());

  text("AT RISK", 225, 244, 11, "#ffffff", "center", 3);
  ctx.save();
  if (S.pot > 0) { ctx.shadowColor = T.glow + "0.60)"; ctx.shadowBlur = 22; }
  text(String(S.pot), 225, 288, 56 + Math.min(14, S.zoom * 14) + (S.potPunch || 0) * 9, S.pot > 0 ? "#ffffff" : "#9ca3af");
  ctx.restore();

  if (S.chain >= 2) text("PERFECT CHAIN x" + S.chain, 225, 320, 13, "#ffd166", "center", 1);
  else              text("BANKED " + S.banked, 225, 320, 13, "#ffffff", "center", 1);

  if (S.msgT > 0) {
    ctx.globalAlpha = Math.min(1, S.msgT * 1.4);
    text(S.msg, 225, 346, 20, "#e9edf5", "center", 1);
    if (S.msgSub) text(S.msgSub, 225, 366, 12, "#ffffff", "center", 1);
    ctx.globalAlpha = 1;
  }

  /* ARENA */
  drawTrack();
  drawZone();

  drawStops();
  drawTrail(curObj().col);
  var mp = pathAt(S.pos), mang = tangentAt(S.pos);
  /* FIX: pehle needle AUR shop object dono sath dikhte the (do moving object).
     Ab sirf EK marker: "bar" object = saaf needle, warna sirf shop ka object. */
  if (objId === "bar") {
    drawNeedle(mp, mang, curObj().col);
  } else {
    drawObj(objId, mp.x, mp.y, mang, curObj().col, 1 + Math.min(0.30, S.zoom * 0.30));
  }

  if (S.missT > 0) {
    var xp = pathAt(S.missPos);
    var edgeT = (S.missPos > S.zoneA + S.zoneW / 2) ? (S.zoneA + S.zoneW) : S.zoneA;
    var ep = pathAt(edgeT);
    var offPx = Math.round(Math.sqrt((ep.x - xp.x) * (ep.x - xp.x) + (ep.y - xp.y) * (ep.y - xp.y)));
    ctx.save();
    ctx.strokeStyle = "#ff4d5e"; ctx.lineCap = "round";
    /* naapne wali dashed lakeer: "bas itne px door thay" */
    ctx.lineWidth = 2;
    try { ctx.setLineDash([5, 5]); } catch(e){}
    ctx.beginPath(); ctx.moveTo(xp.x, xp.y); ctx.lineTo(ep.x, ep.y); ctx.stroke();
    try { ctx.setLineDash([]); } catch(e){}
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(xp.x - 10, xp.y - 10); ctx.lineTo(xp.x + 10, xp.y + 10);
    ctx.moveTo(xp.x + 10, xp.y - 10); ctx.lineTo(xp.x - 10, xp.y + 10);
    ctx.stroke();
    ctx.restore();
    if (offPx > 0) text(offPx + "px OFF", (xp.x + ep.x) / 2, A.cy - shp().lw - 18, 12, "#ff4d5e", "center", 1);
  }

  var ng = gainFor(false);
  text("NEXT HIT +" + ng + "    PERFECT +" + (ng * 2), 225, 592, 12, "#ffffff", "center", 1);
  text(shp().name, 225, 616, 13, T.col, "center", 4);

  var canCash = S.pot > 0 && S.phase !== "over";
  rr(CASH.x, CASH.y, CASH.w, CASH.h, 16);
  ctx.fillStyle = canCash ? "#062018" : "#0f1320"; ctx.fill();
  ctx.strokeStyle = canCash ? "#22d3a6" : "#1c2029"; ctx.lineWidth = 2; ctx.stroke();
  text("CASH OUT", CASH.x + CASH.w/2, CASH.y + 24, 17, canCash ? "#22d3a6" : "#9ca3af", "center", 2);
  text(canCash ? ("BANK " + S.pot + " COINS") : "NOTHING YET",
       CASH.x + CASH.w/2, CASH.y + 45, 10, canCash ? "#ffffff" : "#262c38", "center", 1);

  var shopOn = (S.phase === "idle" || S.phase === "over");
  rr(SHOPB.x, SHOPB.y, SHOPB.w, SHOPB.h, 16);
  ctx.fillStyle = "#0f1320"; ctx.fill();
  ctx.strokeStyle = shopOn ? "#ffd166" : "#1c2029"; ctx.lineWidth = 2; ctx.stroke();
  text("SHOP", SHOPB.x + SHOPB.w/2, SHOPB.y + 24, 16, shopOn ? "#ffd166" : "#9ca3af", "center", 2);
  text(shopOn ? "SPEND COINS" : "RUNS ONLY",
       SHOPB.x + SHOPB.w/2, SHOPB.y + 45, 8, shopOn ? "#ffffff" : "#262c38", "center", 1);

  /* LEVELS button - saari shapes aur unlock levels dikhata hai */
  rr(LEVB.x, LEVB.y, LEVB.w, LEVB.h, 16);
  ctx.fillStyle = "#0b1520"; ctx.fill();
  ctx.strokeStyle = "#38bdf8"; ctx.lineWidth = 2; ctx.stroke();
  text("LEVELS", LEVB.x + LEVB.w/2, LEVB.y + 24, 13, "#38bdf8", "center", 2);
  text("ALL SHAPES", LEVB.x + LEVB.w/2, LEVB.y + 45, 8, "#ffffff", "center", 1);

  var hint = "";
  if (S.phase === "idle")      hint = "TAP ANYWHERE TO STOP THE LINE";
  else if (S.phase === "run")  hint = "TAP = STOP     MISS = LOSE A LIFE";
  else if (S.phase === "over") hint = "TAP ANYWHERE TO PLAY AGAIN";
  if (hint) {
    ctx.globalAlpha = 0.55 + 0.35 * Math.sin(TT * 2.6);
    text(hint, 225, 734, 12, "#ffffff", "center", 1);
    ctx.globalAlpha = 1;
  }

  drawFx();

  if (S.mileT > 0) {
    ctx.globalAlpha = Math.min(1, S.mileT * 1.5);
    ctx.fillStyle = "rgba(5,6,10,0.82)";
    ctx.fillRect(0, 215, W, 90);
    ctx.fillStyle = T.glow + "0.85)";
    ctx.fillRect(0, 215, W, 3);
    ctx.fillRect(0, 302, W, 3);
    text(S.mile, 225, 250, 30, T.col, "center", 4);
    if (S.mileSub) text(S.mileSub, 225, 282, 13, "#e9edf5", "center", 3);
    ctx.globalAlpha = 1;
  }

  if (S.phase === "over") {
    rr(30, 372, W - 60, 192, 18);
    ctx.fillStyle = "rgba(5,6,10,0.90)"; ctx.fill();
    ctx.strokeStyle = S.newBest ? "#ffd166" : "#2a3140"; ctx.lineWidth = 2; ctx.stroke();
    text(S.newBest ? "NEW BEST!" : "WIPED OUT", 225, 406, 29, S.newBest ? "#ffd166" : "#ff4d5e", "center", 2);
    text("BANKED THIS RUN", 225, 442, 11, "#ffffff", "center", 2);
    text(String(S.banked), 225, 470, 34, "#ffffff");
    text("BEST " + best + "     COINS +" + S.coinsRun, 225, 502, 12, "#ffffff", "center", 1);
    text("TAP TO PLAY AGAIN", 225, 534, 12, "#22d3a6", "center", 2);
  }

  ctx.restore();

  if (S.flash > 0) {
    ctx.fillStyle = "rgba(255,255,255," + (S.flash * 0.16).toFixed(3) + ")";
    ctx.fillRect(0, 0, W, H);
  }

  if (!gameReadySent) {
    ctx.fillStyle = "rgba(5,6,10,0.88)"; ctx.fillRect(0, 0, W, H);
    text("NERVE",   225, H/2 - 26, 34, "#e9edf5", "center", 8);
    text("LOADING", 225, H/2 + 16, 12, "#ffffff", "center", 4);
  }

  if (paused) {
    ctx.fillStyle = "rgba(5,6,10,0.75)"; ctx.fillRect(0, 0, W, H);
    text("PAUSED", 225, H/2, 26, "#e9edf5", "center", 6);
  }
}


/* ----------------------------------------------------------
   13b. LEVELS / SHAPES SCREEN
   ---------------------------------------------------------- */
/* kisi bhi shape ka chhota preview - path sample kar ke tile mein fit karta hai */
function drawMiniShape(idx, cx, cy, size, col, alpha){
  var keep = S.shape, n = 96, i, p, pts = [];
  var mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9, sc, X, Y;
  S.shape = idx;
  for (i = 0; i <= n; i++) {
    p = pathAt(i / n);
    pts.push({ x:p.x, y:p.y });
    if (p.x < mnx) mnx = p.x;
    if (p.x > mxx) mxx = p.x;
    if (p.y < mny) mny = p.y;
    if (p.y > mxy) mxy = p.y;
  }
  S.shape = keep;

  sc = size / Math.max(1, Math.max(mxx - mnx, mxy - mny));
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = col;
  ctx.lineWidth = 3.2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = "rgba(255,255,255,0.22)";
  ctx.shadowBlur = 6;
  ctx.beginPath();
  for (i = 0; i < pts.length; i++) {
    X = cx + (pts[i].x - (mnx + mxx) / 2) * sc;
    Y = cy + (pts[i].y - (mny + mxy) / 2) * sc;
    if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
  }
  ctx.stroke();
  ctx.restore();
}

function levTileBox(i){
  var col = i % 2, row = (i - col) / 2;
  return { x: 30 + col * 204, y: 122 + row * 104, w: 186, h: 96 };
}

function drawLevels(){
  var i, b, sh, unlocked, cur, T = tier(), statTxt, statCol, mCol;
  drawBg();

  text("ALL SHAPES", 225, 46, 27, "#e9edf5", "center", 7);
  text(SHAPES.length + " SHAPES  -  UNLOCK BY LEVEL", 225, 74, 10, "#ffffff", "center", 3);
  text("BEST LEVEL " + bestLevel + "      NOW LV " + S.level, 225, 100, 12, "#ffd166", "center", 2);

  for (i = 0; i < SHAPES.length; i++) {
    sh = SHAPES[i];
    b  = levTileBox(i);
    unlocked = (bestLevel >= sh.unlock) || (S.level >= sh.unlock);
    cur = (i === S.shape);

    rr(b.x, b.y, b.w, b.h, 14);
    ctx.fillStyle = cur ? "#101a24" : (unlocked ? "#0d1018" : "#090b12");
    ctx.fill();
    ctx.strokeStyle = cur ? T.col : (unlocked ? "#2a3348" : "#171b28");
    ctx.lineWidth = cur ? 2 : 1;
    ctx.stroke();

    mCol = unlocked ? (cur ? T.col : "#8ea3c0") : "#2a3348";
    drawMiniShape(i, b.x + 46, b.y + b.h / 2, 52, mCol, unlocked ? 1 : 0.5);

    text(sh.name, b.x + 84, b.y + 34, 13, unlocked ? "#e9edf5" : "#ffffff", "left", 1);
    text("LV " + sh.unlock, b.x + 84, b.y + 55, 11, unlocked ? "#38bdf8" : "#9ca3af", "left", 2);

    if (cur)           { statTxt = "PLAYING NOW"; statCol = T.col; }
    else if (unlocked) { statTxt = "UNLOCKED";    statCol = "#22d3a6"; }
    else               { statTxt = "LOCKED";      statCol = "#ffffff"; }
    text(statTxt, b.x + 84, b.y + 74, 9, statCol, "left", 2);
  }

  text("SHAPES MIX EVERY " + CFG.shapeEvery + " LEVELS  -  ZONE DRIFTS FROM LV " + CFG.driftFrom,
       225, 660, 9, "#9ca3af", "center", 1);
  text("TAP ANYWHERE TO GO BACK", 225, 690, 9, "#9ca3af", "center", 2);

  rr(LBACK.x, LBACK.y, LBACK.w, LBACK.h, 16);
  ctx.fillStyle = "#062018"; ctx.fill();
  ctx.strokeStyle = "#22d3a6"; ctx.lineWidth = 2; ctx.stroke();
  text("BACK TO GAME", LBACK.x + LBACK.w/2, LBACK.y + LBACK.h/2, 15, "#22d3a6", "center", 2);

  drawFx();

  if (!gameReadySent) {
    ctx.fillStyle = "rgba(5,6,10,0.88)"; ctx.fillRect(0, 0, W, H);
    text("NERVE",   225, H/2 - 26, 34, "#e9edf5", "center", 8);
    text("LOADING", 225, H/2 + 16, 12, "#ffffff", "center", 4);
  }
}


/* ----------------------------------------------------------
   14. SHOP SCREEN
   ---------------------------------------------------------- */
function drawTile(b, it, owned, eq, kind){
  rr(b.x, b.y, b.w, b.h, 14);
  ctx.fillStyle = eq ? "#101a24" : "#0d1018"; ctx.fill();
  ctx.strokeStyle = eq ? (it.col || "#22d3a6") : (owned ? "#2a3348" : "#1a1f2e");
  ctx.lineWidth = eq ? 2 : 1;
  ctx.stroke();

  var cx = b.x + b.w / 2, cy = b.y + 40;
  ctx.save();
  if (!owned) ctx.globalAlpha = 0.40;
  if (kind === "char") drawChar(it.id, cx, cy, 44, it.col || "#22d3a6", 1);
  else if (kind === "obj") drawObj(it.id, cx, cy, 0, it.col, 1);
  else if (kind === "shape") {
    var pts = it.make(24);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath();
    for (var k=0; k<pts.length; k++) {
      var px = pts[k].x * 16, py = pts[k].y * 16;
      if (k===0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    if (it.wrap) ctx.closePath();
    ctx.strokeStyle = it.col || "#38bdf8";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  }
  else if (kind === "bg") {
    var img = getImg(it.src);
    if (img && img.complete) {
      ctx.save();
      ctx.beginPath();
      rr(cx - 24, cy - 24, 48, 48, 8);
      ctx.clip();
      ctx.drawImage(img, 0, 0, img.width, img.height, cx - 24, cy - 24, 48, 48);
      ctx.restore();
    } else {
      ctx.fillStyle = "#1a1f2e";
      rr(cx - 24, cy - 24, 48, 48, 8);
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.lineWidth = 1;
    rr(cx - 24, cy - 24, 48, 48, 8);
    ctx.stroke();
  }
  ctx.restore();

  text(it.name, cx, b.y + 76, 11, owned ? "#e9edf5" : "#ffffff", "center", 1);

  if (eq) {
    text("EQUIPPED", cx, b.y + 94, 10, it.col || "#22d3a6", "center", 1);
  } else if (owned) {
    text("TAP TO USE", cx, b.y + 94, 10, "#ffffff", "center", 1);
  } else {
    drawCoin(cx - 21, b.y + 94, 6);
    text(String(it.price), cx - 10, b.y + 94, 12, wallet >= it.price ? "#ffd166" : "#ffffff", "left", 0);
  }
}

function drawShop(){
  var i, b, it, owned, eq;
  drawBg();

  text("SHOP", 225, 48, 30, "#e9edf5", "center", 8);
  drawCoin(190, 82, 9);
  text(wallet + " COINS", 205, 82, 15, "#ffd166", "left", 1);

  var tabC = (S.shopTab === "char") ? "#e9edf5" : "#ffffff";
  var tabO = (S.shopTab === "obj")  ? "#e9edf5" : "#ffffff";
  var tabS = (S.shopTab === "shape")? "#e9edf5" : "#ffffff";
  var tabB = (S.shopTab === "bg")   ? "#e9edf5" : "#ffffff";
  
  text("CHARACTERS",  60, 118, 10, tabC, "center", 2);
  text("OBJECTS",    170, 118, 10, tabO, "center", 2);
  text("SHAPES",     280, 118, 10, tabS, "center", 2);
  text("BACKDROPS",  390, 118, 10, tabB, "center", 2);

  var list = (S.shopTab === "char") ? CHARS : (S.shopTab === "obj" ? OBJS : (S.shopTab === "shape" ? SHAPES : BGS));
  var curId = (S.shopTab === "char") ? charId : (S.shopTab === "obj" ? objId : (S.shopTab === "shape" ? shapeId : bgId));

  S.shopPage = S.shopPage || 0;
  var maxPages = Math.ceil(list.length / 6);
  var startIdx = S.shopPage * 6;
  var endIdx = Math.min(startIdx + 6, list.length);

  for (i = startIdx; i < endIdx; i++) {
    it = list[i]; b = tileBox(S.shopTab, i - startIdx);
    owned = !!OWNED[S.shopTab + ":" + it.id] || it.price === 0;
    drawTile(b, it, owned, curId === it.id, S.shopTab);
  }

  if (maxPages > 1) {
    if (S.shopPage > 0) text("< PREV", 100, 455, 14, "#22d3a6", "center", 2);
    text("PAGE " + (S.shopPage+1) + "/" + maxPages, 225, 455, 11, "#ffffff", "center", 2);
    if (S.shopPage < maxPages - 1) text("NEXT >", 350, 455, 14, "#22d3a6", "center", 2);
  }

  rr(BACK.x, BACK.y, BACK.w, BACK.h, 16);
  ctx.fillStyle = "#062018"; ctx.fill();
  ctx.strokeStyle = "#22d3a6"; ctx.lineWidth = 2; ctx.stroke();
  text("BACK TO GAME", BACK.x + BACK.w/2, BACK.y + BACK.h/2, 15, "#22d3a6", "center", 2);

  if (S.shopMsgT > 0) {
    ctx.globalAlpha = Math.min(1, S.shopMsgT);
    text(S.shopMsg, 225, 744, 12, "#ffd166", "center", 1);
    ctx.globalAlpha = 1;
  } else {
    text("TAP AN ITEM TO BUY OR EQUIP", 225, 744, 11, "#9ca3af", "center", 2);
  }

  drawFx();

  if (!gameReadySent) {
    ctx.fillStyle = "rgba(5,6,10,0.88)"; ctx.fillRect(0, 0, W, H);
    text("NERVE",   225, H/2 - 26, 34, "#e9edf5", "center", 8);
    text("LOADING", 225, H/2 + 16, 12, "#ffffff", "center", 4);
  }
}


/* ----------------------------------------------------------
   15. MAIN LOOP
   ---------------------------------------------------------- */
function frame(now){
  requestAnimationFrame(frame);

  if (!last) last = now;
  var dt = (now - last) / 1000;
  last = now;
  if (dt > 0.05) dt = 0.05;
  if (dt < 0)    dt = 0;
  if (paused)    dt = 0;

  TT    += dt;
  idleT += dt;
  S.blink -= dt;
  if (S.blink < -2.4) S.blink = 0.12 + Math.random() * 0.10;

  if (S.screen === "game") {
    if (S.phase === "idle" || S.phase === "run") {
      var sp = S.speed * (slowT > 0 ? CFG.slowMoRate : 1);
      if (shp().wrap) {
        S.pos += sp * dt;
        while (S.pos > 1) S.pos -= 1;
      } else {
        S.pos += S.dir * sp * dt;
        if (S.pos > 1) { S.pos = 1; S.dir = -1; }
        if (S.pos < 0) { S.pos = 0; S.dir =  1; }
      }
      var tp = pathAt(S.pos);
      trail.push({ x: tp.x, y: tp.y });
      if (trail.length > CFG.trailN) trail.shift();
      if (S.drift) {           /* sarakta hua zone (level 20+) */
        var dLo = shp().wrap ? 0.012 : 0.035, dHi = 1 - S.zoneW - dLo;
        S.zoneA += S.drift * dt;
        if (S.zoneA < dLo) { S.zoneA = dLo; S.drift = -S.drift; }
        if (S.zoneA > dHi) { S.zoneA = dHi; S.drift = -S.drift; }
      }
    } else if (S.phase === "miss") {
      S.missT -= dt;
      if (S.missT <= 0) {
        S.missT = 0;
        S.phase = "run";
        S.pos = 0; S.dir = 1;
        placeZone();
        say("GO AGAIN", S.lives + (S.lives === 1 ? " LIFE LEFT" : " LIVES LEFT"));
      }
    }
    musicTick(dt);
  }

  if (slowT      > 0) slowT      -= dt;
  if (S.flash    > 0) S.flash    -= dt * 2.4;
  if (S.shake    > 0) S.shake    -= dt * 3.2;
  if (S.happyT   > 0) S.happyT   -= dt;
  if (S.zoom     > 0) S.zoom     -= dt * 3;
  if (S.msgT     > 0) S.msgT     -= dt;
  if (S.mileT    > 0) S.mileT    -= dt;
  if (S.shopMsgT > 0) S.shopMsgT -= dt;
  if (S.buyFlash > 0) S.buyFlash -= dt * 2;

  stepFx(dt);

  if (S.screen === "shop")        drawShop();
  else if (S.screen === "levels") drawLevels();
  else                            drawGame();

  ytFirstFrame();
  tryGameReady();
}


/* ----------------------------------------------------------
   BOOT
   ---------------------------------------------------------- */
if (IN_YT && YT.system) {
  try {
    if (YT.system.isAudioEnabled) ytAudioOK = !!YT.system.isAudioEnabled();
    if (YT.system.onAudioEnabledChange) {
      YT.system.onAudioEnabledChange(function(on){ ytAudioOK = !!on; applyAudioGate(); });
    }
    if (YT.system.onPause)  YT.system.onPause(doPause);
    if (YT.system.onResume) YT.system.onResume(doResume);
  } catch(e){ logWarn(); }
}

resize();
newRun();
loadSave();
last = 0;
requestAnimationFrame(frame);

})();
