// Formular und Live-Neuaufbau mit abgefangenen Befehlen, keine echten Schaltungen.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire('/home/dietpi/projekte/tools/browser/package.json');
const { chromium } = require('playwright-core');
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 480, height: 480 } });
  page.setDefaultTimeout(10000);
  await page.addInitScript(() => { window.WebSocket=class { static OPEN=1; readyState=0; send() {} close() {} }; });
  await page.goto('http://127.0.0.1:8099/', {waitUntil:'domcontentloaded'});
  await page.waitForFunction(() => typeof renderPanel === 'function');
  await page.evaluate(() => {
    if(typeof ws !== 'undefined' && ws) { ws.onclose=null; ws.close(); }
    window._commands=[]; sendCmd=(uuid,cmd)=>window._commands.push([uuid,cmd]);
    window._spot={k:'spotform',uuid:'test',tmpl:'start/{bedarf}/{zeitraum}',cancel:true,fields:[
      {name:'bedarf',label:'Bedarf',min:0.25,step:0.25,value:1},
      {name:'zeitraum',label:'Zeitraum',min:1,step:1,value:4}]};
    view={route:{view:'control',id:'test'},blocks:[window._spot]};
    hideSaver(); wake();
    renderPanel(view.blocks);
  });
  await page.locator('[name=bedarf]').fill('1.25');
  assert.deepEqual(await page.evaluate(()=>window._commands), []);
  await page.evaluate(()=>renderPanel(view.blocks));
  assert.equal(await page.locator('[name=bedarf]').inputValue(),'1.25');
  await page.locator('[type=submit]').click();
  assert.deepEqual(await page.evaluate(()=>window._commands), [['test','start/1.25/4']]);
  await page.locator('[name=bedarf]').fill('0');
  await page.locator('[type=submit]').click();
  assert.equal(await page.evaluate(()=>window._commands.length),1);
  page.once('dialog',dialog=>dialog.dismiss());
  await page.locator('[data-cancel]').click();
  assert.equal(await page.evaluate(()=>window._commands.length),1);
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('[data-cancel]').click();
  assert.deepEqual(await page.evaluate(()=>window._commands.at(-1)),['test','cancel']);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>480),false);
  await page.evaluate(()=>{ view.gesperrt='Wartung'; renderPanel(view.blocks); });
  assert.equal(await page.locator('[type=submit]').isDisabled(),true);
  console.log('PASS: Formularbefehle, Viertelstunden, Eingabeerhalt, Mindestwert, Abbruchbestätigung, 480px');
} finally { await browser.close(); }
