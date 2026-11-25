// Isolierte Layout-Fixtures: keine Verbindung zu LoxBerry oder Miniserver.
import {createRequire} from 'node:module';
import {readFileSync,existsSync} from 'node:fs';
import assert from 'node:assert/strict';
const {chromium}=createRequire('/home/dietpi/projekte/tools/browser/x.js')('playwright-core');
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const errors=[];
async function open(viewport,ipad=false){
 const p=await browser.newPage({viewport});
 p.on('pageerror',e=>errors.push(String(e)));
 await p.addInitScript(ipad=>{
  window.WebSocket=class {static OPEN=1;readyState=0;send(){}close(){}};
  if(ipad){Object.defineProperty(navigator,'platform',{value:'MacIntel'});Object.defineProperty(navigator,'maxTouchPoints',{value:5,configurable:true});}
 },ipad);
 await p.route('**/*',r=>{
  const u=new URL(r.request().url()),path=u.pathname==='/'?'config/app/webfrontend/html/panel.html':`config/app/webfrontend${u.pathname}`;
  if(existsSync(path))return r.fulfill({body:readFileSync(path),contentType:path.endsWith('.woff2')?'font/woff2':'text/html'});
  if(u.pathname==='/mjpeg')return r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="gray"/></svg>'});
  return r.fulfill({status:204,body:''});
 });
 await p.goto('http://layout.test/');
 await p.evaluate(()=>{
  bootDone();hideSaver();wake();ws={readyState:1,send(){}};themeSplit=true;themePhone=false;themeFill=false;
  profCols=profRows=2;uiScaleCfg='auto';tabsCfg=['favoriten'];stack=[{view:'tab',tab:'favoriten'}];
  window.fixtureGrid=()=>{view={route:stack[0],items:Array.from({length:8},(_,i)=>({id:String(i),label:'Lichtsteuerung Schlafbereich',room:'OG Schlafzimmer',sublabel:'Aus',icon:'light',nav:{view:'control',id:String(i)}}))};render();applyScale();};
  fixtureGrid();
 });
 return p;
}
const dimensions=p=>p.evaluate(()=>{const s=document.querySelector('.screen'),g=el('grid');return {adaptive:document.documentElement.classList.contains('adaptive'),scale:uiScaleEff,w:s.getBoundingClientRect().width,h:s.getBoundingClientRect().height,gw:g.clientWidth,gh:g.clientHeight,cols:gridCols,count:g.querySelectorAll('.tile').length};});
try{
 for(const size of [{width:480,height:480},{width:960,height:480}]){
  const p=await open(size);const d=await dimensions(p);assert.equal(d.adaptive,false);assert.equal(d.w,size.width);assert.equal(d.h,size.height);assert.equal(d.count,8);await p.close();
 }
 console.log('PASS Wandpanels 480x480 und 960x480 unveraendert');
 const desktop=await open({width:1024,height:748});assert.equal((await dimensions(desktop)).adaptive,false);await desktop.close();
 const p=await open({width:1024,height:748},true);
 for(const scale of ['off','auto',1.5]){
  await p.evaluate(scale=>{uiScaleCfg=scale;applyScale();},scale);
  const d=await dimensions(p);assert.equal(d.adaptive,true);assert.equal(d.scale,1);assert.equal(d.w,1024);assert.equal(d.h,748);assert.equal(d.cols,4);assert.equal(d.count,8);assert.ok(d.gh>600);
 }
 await p.waitForTimeout(800);
 await p.screenshot({path:'/tmp/tilebert-ipad-adaptive.png'});
 console.log('PASS iPad-Mac-Erkennung: volle 1024x748 bei altem Auto-/Festzoom, gleiche acht Kacheln');
 await p.evaluate(()=>{DEV_MODEL='ipad';Object.defineProperty(navigator,'maxTouchPoints',{value:0});applyScale();});
 assert.equal((await dimensions(p)).adaptive,true);
 console.log('PASS Bestehendes iPad-Geraetemodell reicht ohne neue Einstellung');
 await p.evaluate(()=>{profCols=profRows=3;fixtureGrid();});
 const dense=await dimensions(p);assert.equal(dense.cols,6);assert.equal(dense.w,1024);assert.equal(dense.h,748);
 await p.evaluate(()=>{profCols=profRows=2;fixtureGrid();});
 console.log('PASS Vorhandenes 3x3-Raster bleibt 3x3 je Panelhaelfte');
 await p.evaluate(()=>{panesCfg={favoriten:'weather'};render();});
 const split=await p.evaluate(()=>({screen:document.querySelector('.screen').clientWidth,left:el('grid').clientWidth,right:el('frontpane').clientWidth}));
 assert.equal(split.screen,1024);assert.ok(split.left>450&&split.right>450);assert.ok(Math.abs(split.left-split.right)<5);
 await p.evaluate(()=>{panesCfg={};render();});
 console.log('PASS Vorhandene Split-Pane bleibt gleichmaessig aufgeteilt');
 await p.evaluate(()=>{
  window.camConfig={grid:2,items:[{type:'camera',x:0,y:0,w:4,h:2,back:1}]};
  window.camOriginal=JSON.stringify(camConfig);
  view={route:{view:'tab',tab:'favoriten'},layout:'cells',...camConfig,cells:camConfig.items,wd:{cameras:[{id:'a',name:'Testkamera',src:'/mjpeg?id=a'}]}};
  render();window.camNode=el('grid').querySelector('.camimg');
 });
 await p.setViewportSize({width:1100,height:760});await p.waitForTimeout(350);
 assert.equal(await p.evaluate(()=>!!camNode&&el('grid').querySelector('.camimg')===camNode),true);
 assert.equal(await p.evaluate(()=>JSON.stringify(camConfig)===camOriginal),true);
 console.log('PASS Kamerawidget: gleiche Belegung, gleicher Bildknoten bei neuer Querformat-Groesse');
 await p.evaluate(()=>{
  view={route:{view:'control',id:'input'},blocks:[{k:'dhead',room:'Test',name:'Eingabe'},{k:'minput',uuid:'input',ph:'Text',max:100}]};renderPanel(view.blocks);
  window.inputNode=el('grid').querySelector('input');inputNode.value='Bleibt erhalten';inputNode.focus();
 });
 await p.setViewportSize({width:768,height:1024});await p.waitForTimeout(350);
 assert.equal(await p.evaluate(()=>el('grid').querySelector('input')===inputNode&&inputNode.value==='Bleibt erhalten'&&document.activeElement===inputNode),true);
 assert.equal(await p.evaluate(()=>el('grid').classList.contains('panel')),true);
 await p.setViewportSize({width:1024,height:748});await p.waitForTimeout(350);
 assert.equal(await p.evaluate(()=>document.activeElement===inputNode&&inputNode.value==='Bleibt erhalten'),true);
 console.log('PASS Detailansicht und ungesendete Eingabe/Fokus bleiben beim Drehen erhalten');
 await p.evaluate(()=>{
  fixtureGrid();saverCfg={grid:2,exit:['x'],items:[{type:'clock',x:0,y:0,w:2,h:2},{type:'camera',x:2,y:0,w:2,h:2,back:1}]};
  saverData={cameras:[{id:'a',name:'Test',src:'/mjpeg?id=a'}]};renderSaverGrid();
 });
 const saver=await p.evaluate(()=>({count:el('svGrid').querySelectorAll('.svw').length,h:el('svGrid').clientHeight,w:el('svGrid').clientWidth}));
 assert.equal(saver.count,2);assert.ok(saver.h>600);assert.ok(saver.w>980);
 await p.evaluate(()=>{const st=el('svSt');st.innerHTML='<span>Fenster zu</span>';applyScale();});
 assert.equal(await p.evaluate(()=>el('svSt').parentNode===document.querySelector('.screen')),true);
 assert.ok(await p.evaluate(()=>{const a=el('svGrid').getBoundingClientRect(),b=el('svSt').getBoundingClientRect();return a.bottom<=b.top;}));
 console.log('PASS Dashboard fuellt Flaeche; bestehende Statusleiste ueberlappt nicht');
 await p.setViewportSize({width:390,height:844});await p.waitForTimeout(350);
 assert.equal((await dimensions(p)).adaptive,false);assert.equal(await p.evaluate(()=>el('svSt').parentNode===el('svBar')),true);
 console.log('PASS Schmale Split View nutzt Handy-Layout und setzt Statusleiste zurueck');
 await p.close();assert.deepEqual(errors,[]);console.log('PASS Keine JavaScript-Laufzeitfehler');
}finally{await browser.close();}
