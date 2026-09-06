const fs = require('node:fs');
const assert = require('node:assert/strict');
(async () => {
  const targets = await (await fetch('http://localhost:9231/json')).json();
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener('open', resolve, {once:true}));
  let seq=0; const pending=new Map();
  ws.addEventListener('message', event => {
    const msg=JSON.parse(event.data), task=pending.get(msg.id);
    if(task){pending.delete(msg.id);msg.error?task.reject(msg.error):task.resolve(msg.result);}
  });
  const call=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));
  });
  await call('Emulation.setDeviceMetricsOverride',{width:360,height:800,deviceScaleFactor:2,mobile:true});
  await call('Emulation.setUserAgentOverride',{userAgent:'Mozilla/5.0 (Linux; Android 11; Mobile) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36'});
  await call('Page.addScriptToEvaluateOnNewDocument',{source:'window.requestAnimationFrame = function(){return 0;};'});
  await call('Page.navigate',{url:'file:///'+process.cwd().replaceAll('\\','/')+'/www/index.html'});
  await new Promise(resolve=>setTimeout(resolve,1500));
  const html=fs.readFileSync('www/index.html','utf8');
  let script=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).find(s=>s.includes('function stopLine'));
  script=script.replace(/\}\)\(\);\s*$/, 'window.tapTest={S,CFG,frame,stopLine,newRun,drawGame,getCache:()=>EFFECT_FRAMES};})();');
  let result=await call('Runtime.evaluate',{expression:script});
  assert.ok(!result.exceptionDetails,JSON.stringify(result.exceptionDetails));
  await new Promise(resolve=>setTimeout(resolve,1500));
  result=await call('Runtime.evaluate',{returnByValue:true,expression:`(() => {
    const t=window.tapTest, s=t.S, times=[];
    t.newRun();t.frame(1000);s.pos=s.zoneA+s.zoneW/2;
    t.stopLine();const won=s.level===1;t.frame(1016);
    for(let i=0;i<90;i++){const start=performance.now();t.frame(1032+i*16);times.push(performance.now()-start);}
    s.pos=0;s.phase='run';t.stopLine();const miss=s.phase==='miss';
    t.frame(2488);t.frame(2600);t.frame(2680);
    const recovered=s.phase==='run';
    t.drawGame();const cache=[...t.getCache().keys()];
    return {won,miss,recovered,missFreeze:t.CFG.missFreeze,cacheSize:cache.length,
      headerVersions:cache.filter(k=>k.startsWith('header:')).length,
      powersVersions:cache.filter(k=>k.startsWith('powers:')).length,
      maxDrawMs:Math.max(...times),meanDrawMs:times.reduce((a,b)=>a+b)/times.length};
  })()`});
  assert.ok(!result.exceptionDetails,JSON.stringify(result.exceptionDetails));
  const report=result.result.value;
  assert.ok(report.won && report.miss && report.recovered, JSON.stringify(report));
  assert.equal(report.headerVersions,1);assert.equal(report.powersVersions,1);
  assert.equal(report.missFreeze,0.18);
  console.log(JSON.stringify(report,null,2));
  console.log('PASS: real Chrome canvas renders hits and misses; recovery under 200ms; panel caches invalidate. Desktop timings are NOT phone FPS.');
  await call('Browser.close');
})().catch(error=>{console.error(error);process.exit(1);});
