const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const html = fs.readFileSync('www/index.html', 'utf8');
for (const block of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)) new Function(block[1]);
const extract = name => html.match(new RegExp('function ' + name + '\\([^]*?\\n}'))[0];
// Effects keep their original density and rebuild only when artwork changes.
const effects = {ctx:{drawImage(){}}, RENDER_SCALE:3, EFFECT_FRAMES:new Map(),
  document:{createElement:()=>({getContext:()=>({setTransform(){}})})}};
vm.createContext(effects);
vm.runInContext(extract('drawEffectSprite'), effects);
let paints=0;
const original=effects.ctx;
for(let i=0;i<600;i++) effects.drawEffectSprite('coin',i,10,52,52,()=>paints++);
assert.equal(paints,1);
assert.equal(effects.EFFECT_FRAMES.get('coin:3').width,156);
assert.equal(effects.ctx,original);
for(let i=0;i<100;i++) effects.drawEffectSprite('score'+i,0,0,180,180,()=>{});
assert.equal(effects.EFFECT_FRAMES.size,32);
assert.throws(()=>effects.drawEffectSprite('broken',0,0,10,10,()=>{throw Error('test');}));
assert.equal(effects.ctx,original);
console.log('PASS: effect artwork rendered once across 600 frames, HD preserved, cache bounded and context restored on failure.');
let renders = 0, copies = 0, shape = 'line', colour = '#abc';
const screen = { drawImage(){ copies++; } };
const sandbox = { ctx:screen, RENDER_SCALE:3, W:450, TRACK_FRAME:null,
  A:{cx:225,cy:470}, shp:()=>({id:shape}), tier:()=>({col:colour}),
  drawTrackFlat(){ renders++; },
  document:{createElement:()=>({getContext:()=>({setTransform(){}})})}
};
vm.createContext(sandbox);
vm.runInContext(extract('drawCachedTrack'), sandbox);
for (let i=0;i<600;i++) sandbox.drawCachedTrack(40);
assert.equal(renders,1); assert.equal(copies,600);
assert.equal(sandbox.TRACK_FRAME.image.width,1350);
assert.equal(sandbox.ctx,screen);
shape='star'; sandbox.drawCachedTrack(40); assert.equal(renders,2);
colour='#def'; sandbox.drawCachedTrack(40); assert.equal(renders,3);
sandbox.A.cx=230; sandbox.drawCachedTrack(40); assert.equal(renders,4);
sandbox.RENDER_SCALE=2; sandbox.drawCachedTrack(40); assert.equal(renders,5);
sandbox.drawCachedTrack(44); assert.equal(renders,6);
console.log('PASS: 600 steady frames use one track render; shape, tier, layout, resolution and width changes rebuild it. HD backing size preserved. JS syntax valid.');
let zoneRenders = 0;
sandbox.IS_MOBILE=true; sandbox.ZONE_FRAME=null;
sandbox.S={zoneA:0.3,zoneW:0.26,drift:0};
sandbox.CFG={perfectBand:0.18,minZone:0.03}; sandbox.TT=0;
sandbox.shp=()=>({id:shape,lw:40});
sandbox.drawZoneFlat=()=>{zoneRenders++;};
screen.save=()=>{}; screen.restore=()=>{}; screen.globalAlpha=1;
vm.runInContext(extract('drawCachedZone'),sandbox);
for(let i=0;i<600;i++){sandbox.TT=i/60;sandbox.drawCachedZone();}
assert.equal(zoneRenders,1);
sandbox.S.zoneA=0.5;sandbox.drawCachedZone();assert.equal(zoneRenders,2);
sandbox.S.zoneW=0.1;sandbox.drawCachedZone();assert.equal(zoneRenders,3);
sandbox.S.drift=0.01;sandbox.drawCachedZone();sandbox.drawCachedZone();assert.equal(zoneRenders,5);
assert.equal(sandbox.ctx,screen);
console.log('PASS: target cache survives animation, refreshes on target changes, and uses live rendering while drifting.');
