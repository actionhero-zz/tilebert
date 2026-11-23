// End-to-End ausschliesslich gegen die isolierte loxsim/lpsim-Umgebung.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const {chromium}=createRequire('/home/dietpi/projekte/tools/browser/x.js')('playwright-core');
const SIM='http://127.0.0.1:8180', BASE='http://127.0.0.1:8100';
const out=process.env.TEST_OUT||'/tmp/tilebert-0211-e2e'; fs.mkdirSync(out,{recursive:true});
const j=async u=>{const r=await fetch(u); assert.ok(r.ok,`${u}: ${r.status}`);return r.json();};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const state=(u,n,v)=>j(`${SIM}/sim/state?uuid=${u}&name=${n}&value=${encodeURIComponent(typeof v==='object'?JSON.stringify(v):v)}${typeof v==='number'?'':'&text=1'}`);
const seq=async()=>(await j(`${SIM}/sim/log?since=999999999`)).seq;
const logs=async s=>(await j(`${SIM}/sim/log?since=${s}&kind=cmd`)).log;
const info=await j(`${SIM}/sim/info`), ctl=t=>info.controls.find(c=>c.type===t);
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:480,height:480},locale:'de-DE'});
page.setDefaultTimeout(10000);
const errors=[], rx=[], results=[], iconRequests=[];
page.on('request',r=>{if(/\/(gicon|uicon|icon|loxlib)[?\/]/.test(r.url()))iconRequests.push(r.url());});
page.on('pageerror',e=>errors.push(String(e)));
page.on('websocket',w=>w.on('framereceived',e=>{try{rx.push(JSON.parse(e.payload));}catch{}}));
const current=()=>page.evaluate(()=>view);
const wait=async(fn,ms=12000)=>{const end=Date.now()+ms;while(Date.now()<end){const v=await fn();if(v)return v;await pause(150);}throw Error('Bedingung nicht erreicht');};
const nav=async r=>{await page.evaluate(r=>{hideSaver();wake();nav(r);},r);await wait(async()=>{const v=await current();return v?.route?.id===r.id&&v.route.view===r.view&&v.route.tab===r.tab&&v;});await pause(650);return current();};
const detail=c=>nav({view:'control',id:c.uuid});
const room=c=>nav({view:'group',kind:'room',id:c.room});
const cmd=(c,command,pin)=>page.evaluate(([u,cmd,pin])=>send({t:'cmd',uuid:u,cmd,...(pin?{pin}:{})}),[c.uuid,command,pin]);
const blocks=async()=>((await current()).blocks||[]);
const text=async()=>JSON.stringify(await current());
async function test(name,fn){try{await fn();results.push({name,ok:true});console.log('PASS '+name);}catch(e){results.push({name,ok:false,error:String(e)});console.log('FAIL '+name+': '+e);await page.screenshot({path:`${out}/failure-${results.length}.png`}).catch(()=>{});}}
try{
 await j(`${SIM}/sim/reset?states=1`);
 await page.goto(BASE,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>typeof view!=='undefined'&&view&&typeof ws!=='undefined'&&ws.readyState===1);
 await pause(1800);
 const spot=ctl('SpotPriceOptimizer'), climate=ctl('ClimateControllerUS'), alarm=ctl('AlarmClock'), win=ctl('WindowMonitor');
 const sw=info.controls.find(c=>c.type==='Switch'&&!c.secured), sec=info.controls.find(c=>c.type==='Switch'&&c.secured);
 await test('Strompreis: Kachel, negativer Preis und Live-Update',async()=>{
  await state(spot.uuid,'current',-0.123);await state(spot.uuid,'active',1);await room(spot);
  await wait(async()=>{const i=(await current()).items?.find(i=>i.id===spot.uuid);return i?.sublabel.includes('-0,123')||i?.sublabel.includes('-0.123');});
  const i=(await current()).items.find(i=>i.id===spot.uuid);assert.equal(i.on,true);assert.equal(i.nav.id,spot.uuid);
 });
 await test('Strompreis: getForecasts, Preis- und Einsatzdiagramm',async()=>{
  const s=await seq();await state(spot.uuid,'forecastsTimestamp',Date.now()/1000);await detail(spot);
  await page.getByRole('button',{name:'Prognose',exact:true}).click();
  await wait(async()=>(await blocks()).filter(b=>b.k==='chart').length===2);
  const chart=(await blocks()).filter(b=>b.k==='chart');assert.equal(chart[0].series[0].pts.length,48);
  assert.ok((await logs(s)).some(e=>e.cmd==='getForecasts'));
  await page.screenshot({path:`${out}/forecast-480.png`});
  await page.evaluate(()=>back()); await wait(async()=>!(await current()).route.tab); await pause(650);
 });
 await test('Strompreis: kein Befehlsversand beim Tippen, Eingaben bleiben bei Live-Update',async()=>{
  await detail(spot);const s=await seq();await page.locator('[name=bedarf]').fill('1.25');await page.locator('[name=zeitraum]').fill('4');
  await state(spot.uuid,'active',0);await state(spot.uuid,'current',0.333);await pause(800);
  assert.equal(await page.locator('[name=bedarf]').inputValue(),'1.25');assert.ok(!(await logs(s)).some(e=>e.cmd.startsWith('start/')));
 });
 await test('Strompreis: Start 1,25 h / 4 h bis zum Simulator und Live-Zyklus',async()=>{
  const s=await seq();await page.locator('.spotform [type=submit]').click();
  await wait(async()=>(await logs(s)).some(e=>e.cmd==='start/1.25/4'&&e.code===200));
  await wait(async()=>(await text()).includes('Zyklus läuft bis'));assert.equal((await j(`${SIM}/sim/states?uuid=${spot.uuid}`)).demand,1.25);
 });
 await test('Strompreis: Abbruch verwerfen sendet nichts',async()=>{
  const s=await seq();await page.locator('[data-cancel]').click();await page.locator('.spotask [value=no]').last().click();await pause(450);
  assert.ok(!(await logs(s)).some(e=>e.cmd==='cancel'));
 });
 await test('Strompreis: bestätigter Abbruch erreicht Simulator',async()=>{
  const s=await seq();await page.locator('[data-cancel]').click();await page.locator('.spotask [value=yes]').click();
  await wait(async()=>(await logs(s)).some(e=>e.cmd==='cancel'&&e.code===200));await wait(async()=>!(await text()).includes('Zyklus läuft bis'));
 });
 await test('Strompreis: ungültige Werte client- und serverseitig blockiert',async()=>{
  const s=await seq();await page.locator('[name=bedarf]').fill('0');await page.locator('[type=submit]').click();
  for(const c of ['start/0/4','start/5/4','start/0.1/4','start/1/0','start/1/NaN'])await cmd(spot,c);
  await pause(650);assert.ok(!(await logs(s)).some(e=>e.cmd.startsWith('start/')));
 });
 await test('Strompreis: Prognose bei geändertem Stand neu laden',async()=>{
  const s=await seq();await state(spot.uuid,'forecastsTimestamp',Date.now()/1000);await wait(async()=>(await logs(s)).some(e=>e.cmd==='getForecasts'));
 });
 await test('jLocked: Logiksperre mit Grund, kein Befehl am Simulator',async()=>{
  await state(sw.uuid,'jLocked',{locked:2,reason:'E2E Wartung'});await detail(sw);await wait(async()=>(await text()).includes('E2E Wartung'));
  const s=await seq();await cmd(sw,'on');await pause(500);assert.equal((await logs(s)).filter(e=>e.uuid===sw.uuid).length,0);
  assert.ok(rx.some(m=>m.t==='notify'&&m.text.includes('E2E Wartung')));
 });
 await test('jLocked: Entsperren stellt Bedienung und Rückmeldung wieder her',async()=>{
  await state(sw.uuid,'jLocked','');await wait(async()=>!(await current()).gesperrt);const s=await seq();await cmd(sw,'on');
  await wait(async()=>(await logs(s)).some(e=>e.uuid===sw.uuid&&e.cmd==='on'&&e.code===200));
 });
 await test('jLocked: PIN-geschützter Baustein bleibt mit richtiger PIN gesperrt',async()=>{
  await state(sec.uuid,'jLocked',{locked:1,reason:'Visu gesperrt'});await detail(sec);const s=await seq();await cmd(sec,'on','1234');await pause(500);
  assert.equal((await logs(s)).filter(e=>e.uuid===sec.uuid).length,0);await state(sec.uuid,'jLocked','');
 });
 await test('jLocked: Strompreis-Formular deaktiviert, auch rohe Befehle blockiert',async()=>{
  await state(spot.uuid,'jLocked',{locked:2,reason:'Spot gesperrt'});await detail(spot);
  assert.equal(await page.locator('.spotform [type=submit]').isDisabled(),true);const s=await seq();await cmd(spot,'start/1/4');await pause(500);
  assert.ok(!(await logs(s)).some(e=>e.cmd==='start/1/4'));await state(spot.uuid,'jLocked','');
 });
 for(const offset of [3600,7200])await test(`Wecker: UTC in Miniserver-Ortszeit +${offset/3600} h`,async()=>{
  await j(`${SIM}/sim/fault?tz=${offset}`);const unix=Date.UTC(2026,11,24,5,30)/1000;
  await state(alarm.uuid,'nextEntryTime',unix-1230768000);await room(alarm);
  await wait(async()=>{const i=(await current()).items?.find(i=>i.id===alarm.uuid);return i?.sublabel.includes(offset===3600?'06:30':'07:30');});
 });
 await test('Wecker: kein nächster Termin bei Null-State',async()=>{
  await state(alarm.uuid,'nextEntryTime',0);await room(alarm);await pause(400);
  assert.ok(!/\d\d:\d\d/.test((await current()).items.find(i=>i.id===alarm.uuid).sublabel));
 });
 const irc=ctl('IRoomControllerV2'), ac=ctl('ACControl');
 await test('Klima: Räume, Anforderung zuerst und Wechsel auf Anlagenzählung',async()=>{
  await state(climate.uuid,'controls',[{uuid:ac.uuid,demand:0},{uuid:irc.uuid,demand:1}]);await detail(climate);
  await wait(async()=>{const b=(await blocks()).find(b=>b.k==='mlist');return b?.rows[0]?.id===irc.uuid;});
  assert.ok((await text()).includes('1/2 Anlagen'));await state(climate.uuid,'controls',[{uuid:irc.uuid,demand:1}]);await room(climate);
  await wait(async()=>(await current()).items?.find(i=>i.id===climate.uuid)?.sublabel.includes('1 Raum'));
 });
 await test('Klima: Sollwerttaste sendet richtigen Raumbefehl',async()=>{
  await detail(climate);const rows=(await blocks()).find(b=>b.k==='mlist').rows;const expected=rows[0].btns[1].cmd;const s=await seq();
  await page.locator('.mlist [data-mb="2"]').first().click();await wait(async()=>(await logs(s)).some(e=>e.uuid===expected.uuid&&e.cmd===expected.cmd&&e.code===200));
 });
 await test('Klima: Raum öffnen und Modus wechseln',async()=>{
  await detail(climate);await page.locator('.mlist .mchev').first().click();await wait(async()=>(await current()).route.id===irc.uuid);
  await detail(climate);const s=await seq();await page.locator('.mseg [data-i]').filter({hasText:'Kühlen'}).click();
  await wait(async()=>(await logs(s)).some(e=>e.uuid===climate.uuid&&e.cmd==='setMode/3'&&e.code===200));
 });
 await test('Fensterliste: Reihenfolge bleibt nach Zustandswechsel stabil',async()=>{
  await state(win.uuid,'windowStates','1,2,4,9,,17');await detail(win);const before=(await current()).items?.map(i=>i.id)||[];
  // Die Detailseite nutzt in tilebert mlist; IDs aus beiden Darstellungen erfassen.
  const ids=v=>v.items?.map(i=>i.id)||v.blocks?.filter(b=>b.k==='mlist'||b.k==='scenes').flatMap(b=>(b.rows||b.items).map(r=>r.id))||[];
  const a=ids(await current());assert.ok(a.length>=3,JSON.stringify(await current()));
  await state(win.uuid,'windowStates','4,1,1,9,,17');await pause(700);assert.deepEqual(ids(await current()),a);
  await nav({view:'group',kind:'room',id:win.room});await detail(win);assert.notDeepEqual(ids(await current()),a);void before;
 });
 await test('Lichtzentrale: aktive zuerst, Live-Reihenfolge stabil, Neuaufruf sortiert neu',async()=>{
  const c=ctl('CentralLightController');
  const response=await fetch(`${SIM}/data/LoxAPP3.json`,{headers:{Authorization:'Basic '+Buffer.from('simuser:simpass').toString('base64')}});
  const structure=await response.json();const members=structure.controls[c.uuid].details.controls.map(x=>x.uuid);
  assert.ok(members.length>=2);
  for(const u of members)await state(u,'activeMoods','[778]');await state(members[1],'activeMoods','[1]');await pause(400);
  await nav({view:'group',kind:'central',id:c.uuid});
  const ids=async()=>(await blocks()).find(b=>b.k==='scenes').items.map(x=>x.id);
  const first=await ids();assert.equal(first[0],members[1]);
  await state(members[1],'activeMoods','[778]');await state(members[0],'activeMoods','[1]');await pause(650);assert.deepEqual(await ids(),first);
  await room(c);await nav({view:'group',kind:'central',id:c.uuid});assert.equal((await ids())[0],members[0]);
 });
 await test('Unbekannter Bausteintyp: klarer Hinweis statt leerer Kachel',async()=>{
  const c=ctl('Heatmixer');await room(c);assert.ok((await current()).items.find(i=>i.id===c.uuid).unbekannt);
  assert.ok((await current()).items.find(i=>i.id===c.uuid).sublabel.includes('nicht unterstützt'));
 });
 for(const [width,height] of [[480,480],[960,480],[390,844]])await test(`Neue Detailseiten ohne horizontalen Überlauf ${width}×${height}`,async()=>{
  await page.setViewportSize({width,height});for(const c of [spot,climate,alarm,win]){await detail(c);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,c.type);}
  await detail(spot);await page.screenshot({path:`${out}/spot-${width}.png`});
 });
 for(const [width,height] of [[480,480],[960,480],[390,844]])await test(`Strompreis: Prognose-Unterseite passt ohne Scrollen ${width}×${height}`,async()=>{
  await page.setViewportSize({width,height});await detail(spot);
  await page.getByRole('button',{name:'Prognose',exact:true}).click();
  await wait(async()=>(await current()).route.tab==='prognose');
  await wait(()=>page.locator('.chart').count());
  const dims=await page.evaluate(()=>({charts:[...document.querySelectorAll('.chart')].map(e=>({height:e.getBoundingClientRect().height,bottom:e.querySelector('.chsvg')?.getBoundingClientRect().bottom})),bottom:document.querySelector('#grid').getBoundingClientRect().bottom,overflow:document.querySelector('#grid').scrollHeight-document.querySelector('#grid').clientHeight}));
  assert.ok(dims.charts.length===2&&dims.charts.every(c=>c.height>=80&&c.bottom<=dims.bottom)&&dims.overflow<=2,JSON.stringify(dims));
  assert.equal(await page.locator('.spotform').count(),0);await page.screenshot({path:`${out}/forecast-${width}.png`});
  await page.evaluate(()=>back());await wait(async()=>!(await current()).route.tab);assert.equal(await page.locator('.spotform').count(),1);
 });
 for(const [width,height] of [[480,480],[960,480],[390,844]])await test(`Strompreis: Zahlenfelder lesbar (Kontrast ≥ 7:1) ${width}×${height}`,async()=>{
  await page.setViewportSize({width,height});await detail(spot);
  const ratio=await page.locator('.spotform input').first().evaluate(e=>{
   const s=getComputedStyle(e), lum=c=>{const x=c.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;});return x[0]*0.2126+x[1]*0.7152+x[2]*0.0722;};
   const a=lum(s.color),b=lum(s.backgroundColor);return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
  });assert.ok(ratio>=7,`Kontrast ${ratio.toFixed(2)}:1`);
 });
 for(const [width,height] of [[480,480],[960,480],[390,844]])await test(`Strompreis: alle Felder und Aktionen ohne Scrollen ${width}×${height}`,async()=>{
  await state(spot.uuid,'cycleUntil',Date.now()/1000-1230768000+7200);
  await page.setViewportSize({width,height});await detail(spot);
  assert.equal(await page.locator('.chart,.dbg').count(),0);
  const dims=await page.evaluate(()=>{const g=document.querySelector('#grid'),r=g.getBoundingClientRect();return {overflow:g.scrollHeight-g.clientHeight,items:[...g.querySelectorAll('.spotform input,.spotform button')].map(e=>{const b=e.getBoundingClientRect();return {visible:b.top>=r.top&&b.bottom<=r.bottom&&e.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)),height:b.height,width:b.width};})};});
  assert.ok(dims.items.length===4&&dims.items.every(e=>e.visible&&e.height>=44&&e.width>=44)&&dims.overflow<=2,JSON.stringify(dims));
  const top=await page.evaluate(()=>{const g=document.querySelector('#grid'),r=g.getBoundingClientRect(),form=g.querySelector('.spotform').getBoundingClientRect();return [...g.querySelector('.pantop').children].map(e=>{const b=e.getBoundingClientRect();return {top:b.top,bottom:b.bottom,visible:b.top>=(e.classList.contains('dhead')?0:r.top+12)&&b.bottom<=form.top};});});
  assert.ok(top.every((e,i)=>e.visible&&(!i||e.top>=top[i-1].bottom)),JSON.stringify(top));
  await page.screenshot({path:`${out}/form-${width}.png`});
 });
 await test('Strompreis: Paneldialog passt auf 480×480 und neue Sperre verhindert Abbruch',async()=>{
  await page.setViewportSize({width:480,height:480});await detail(spot);const s=await seq();
  await page.locator('[data-cancel]').click();
  const dims=await page.locator('.spotask').evaluate(e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,overflow:e.scrollHeight-e.clientHeight};});
  assert.ok(dims.top>=0&&dims.bottom<=480&&dims.overflow<=2,JSON.stringify(dims));
  await page.screenshot({path:`${out}/cancel-480.png`});
  await state(spot.uuid,'jLocked',{locked:2,reason:'Wartung'});await wait(async()=>(await current()).gesperrt);
  await page.locator('.spotask [value=yes]').click();await pause(350);
  assert.ok(!(await logs(s)).some(e=>e.cmd==='cancel'));await state(spot.uuid,'jLocked','');await wait(async()=>!(await current()).gesperrt);
 });
 await test('Strompreis: Nachtabdunklung über Dialog, Alarm hat Vorrang',async()=>{
  await page.locator('[data-cancel]').click();
  assert.equal(await page.locator('.spotask #nightdim').count(),1);
  await page.evaluate(()=>{window._qaNight={...NIGHT};NIGHT.on=true;NIGHT.dim=40;applyNight(false);});
  assert.equal(await page.locator('#nightdim').evaluate(e=>e.style.opacity),'0.4');
  await page.evaluate(()=>secAlarm({id:'qa',name:'Testalarm',on:true,acts:[]}));
  await wait(()=>page.locator('.spotask').count().then(n=>n===0));
  assert.equal(await page.locator('#secAl').isVisible(),true);
  assert.equal(await page.locator('body>#nightdim').count(),1);
  await page.evaluate(()=>{secAlarm({id:'qa',on:false});Object.assign(NIGHT,window._qaNight);applyNight(false);delete window._qaNight;});
 });
 await test('Strompreis: Abbruchdialog schließt mit Escape und Navigation ohne Befehl',async()=>{
  const s=await seq();await page.locator('[data-cancel]').click();
  assert.equal(await page.locator('.spotask [value=no]').last().evaluate(e=>e===document.activeElement),true);
  await page.keyboard.press('Escape');await wait(()=>page.locator('.spotask').count().then(n=>n===0));
  await page.locator('[data-cancel]').click();await room(spot);await wait(()=>page.locator('.spotask').count().then(n=>n===0));
  assert.ok(!(await logs(s)).some(e=>e.cmd==='cancel'));
 });
 await test('Icon-Anfragen: keine entfernten /gicon- oder /uicon-Quellen',()=>{assert.ok(iconRequests.length);assert.ok(iconRequests.every(u=>!/[\/]([gu]icon)[?\/]/.test(u)));});
 await test('Simulator-Verbindungsabbruch: Wiederverbindung und frischer Preis',async()=>{
  await detail(spot);await j(`${SIM}/sim/fault?drop=1`);await pause(1500);await state(spot.uuid,'current',0.456);
  await wait(async()=>(await text()).includes('0,456')||(await text()).includes('0.456'),45000);
 });
 await test('Keine JavaScript-Laufzeitfehler' ,()=>assert.deepEqual(errors,[]));
}finally{
 await j(`${SIM}/sim/reset?states=1`).catch(()=>{});await browser.close();
 fs.writeFileSync(`${out}/results.json`,JSON.stringify({at:new Date().toISOString(),results,errors},null,2));
}
console.log(JSON.stringify({pass:results.filter(r=>r.ok).length,fail:results.filter(r=>!r.ok).length,out}));
process.exitCode=results.some(r=>!r.ok)?1:0;
