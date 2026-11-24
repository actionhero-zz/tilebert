// Kamerawechsel mit verzoegerten Testbildern, ohne echte Kameraverbindungen.
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {chromium}=createRequire('/home/dietpi/projekte/tools/browser/x.js')('playwright-core');
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try {
 const page=await browser.newPage({viewport:{width:480,height:480}}), errors=[], pending=[];
 page.on('pageerror',e=>errors.push(String(e)));
 await page.addInitScript(()=>{window.WebSocket=class {static OPEN=1;readyState=0;send(){}close(){}};});
 let jpg;
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:readFileSync('config/app/webfrontend/html/panel.html')});
  if(u.pathname==='/mjpeg'){
   await new Promise(resolve=>pending.push({id:u.searchParams.get('id'),resolve}));
   return route.fulfill({contentType:'image/jpeg',body:jpg}).catch(()=>{});
  }
  return route.fulfill({status:404,body:''});
 });
 await page.goto('http://panel.test/',{waitUntil:'domcontentloaded'});
 jpg=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=160;c.height=90;const x=c.getContext('2d');x.fillStyle='#287d63';x.fillRect(0,0,160,90);return c.toDataURL('image/jpeg').split(',')[1];}),'base64');
 for(const lite of [false,true]){
  await page.evaluate(lite=>{
   document.querySelector('#fixture')?.remove();camsSweep();bootDone();hideSaver();wake();LITE=lite;CAM_DARK=false;
   const cell=document.createElement('div');cell.id='fixture';cell.className='svw svw-camera-cell';cell.dataset.k='test';
   cell.style.cssText='position:fixed;left:20px;top:80px;width:440px;height:300px;z-index:1000';
   cell._it={type:'camera',cam:'a',back:0};cell._sd={cameras:[{id:'a',name:'Eingang',src:'/mjpeg?id=a'},{id:'b',name:'Garten',src:'/mjpeg?id=b'}]};
   camSel.test='a';cell.innerHTML=svWidgetHTML(cell._it,cell._sd);document.querySelector('.screen').appendChild(cell);camSwStart(cell);
  },lite);
  const frame=page.locator('#fixture .sv-cam-frame'), skel=page.locator('#fixture .camskel');
  await skel.waitFor({state:'visible'});assert.equal(await frame.getAttribute('aria-busy'),'true');
  assert.equal(await skel.evaluate(e=>getComputedStyle(e).animationName),'none');
  await page.waitForTimeout(120);await page.screenshot({path:`/tmp/camera-skeleton-${lite?'lite':'normal'}.png`});
  const release=()=>{pending.splice(0).forEach(p=>{p.resolve();});};release();
  await skel.waitFor({state:'hidden'});assert.equal(await frame.getAttribute('aria-busy'),'false');
  assert.equal(await page.locator('#fixture .sv-cam-status').isVisible(),false);
  await page.locator('#fixture [data-ci="1"].campill').click();await skel.waitFor({state:'visible'});
  await page.waitForTimeout(100);await page.locator('#fixture [data-ci="0"].campill').click();
  assert.equal(await page.evaluate(()=>camImgs.size),1);release();
  await page.waitForTimeout(100);release();await skel.waitFor({state:'hidden'});
  assert.equal(await page.locator('#fixture .camimg.on').getAttribute('data-ci'),'0');
  // Bereits angezeigte Kamera erneut waehlen: kein neuer Skeleton.
  await page.locator('#fixture [data-ci="0"].campill').click();assert.equal(await skel.isVisible(),false);
  await page.evaluate(()=>document.querySelector('#fixture .camimg.on').onerror());
  assert.equal(await skel.isVisible(),false);assert.match(await page.locator('#fixture .sv-cam-status').textContent(),/nicht erreichbar/);
  await page.evaluate(()=>{document.querySelectorAll('#fixture img').forEach(camStop);document.querySelector('#fixture').remove();});release();
  assert.equal(await page.evaluate(()=>camImgs.size),0);
  console.log(`PASS ${lite?'Einzelbilder':'Bildstream'}: Platzhalter, Erstbild, schneller Wechsel, erneute Auswahl, Fehler, Aufraeumen`);
 }
 assert.deepEqual(errors,[]);
} finally {await browser.close();}
