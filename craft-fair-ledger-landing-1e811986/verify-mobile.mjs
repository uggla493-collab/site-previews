import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const base = path.dirname(fileURLToPath(import.meta.url));
const html = await readFile(path.join(base, 'release/index.html'), 'utf8');
const css = await readFile(path.join(base, 'release/styles.css'), 'utf8');
const source = JSON.stringify(html.replace('<link rel="stylesheet" href="./styles.css">', '<style>' + css + '</style>')).replaceAll('<', '\u003c');
const harness = '<!doctype html><html lang="en"><meta charset="utf-8"><title>Offline mobile layout checks</title><body><pre id="results">Running</pre><script>const source=' + source + `;
(async()=>{
  const results=[];
  for(const width of [320,375,390,600,601,768,1024,1280]) {
    const frame=document.createElement('iframe');
    frame.style.cssText='border:0;display:block;height:2400px;width:'+width+'px';
    const loaded=new Promise(resolve=>frame.onload=resolve);
    frame.srcdoc=source;document.body.append(frame);await loaded;
    const d=frame.contentDocument,w=frame.contentWindow;
    const steps=[...d.querySelectorAll('.calculation-steps li')];
    const columns=w.getComputedStyle(d.querySelector('.calculation-steps')).gridTemplateColumns.split(' ').length;
    const outside=[...d.querySelectorAll('h1,h2,h3,p,.button,.text-link,.calculation-steps li')].filter(el=>{
      const r=el.getBoundingClientRect();return r.left < -1 || r.right > width+1 || el.scrollWidth > el.clientWidth+1;
    }).map(el=>el.className||el.tagName);
    const checks={noHorizontalOverflow:d.documentElement.scrollWidth<=width,contentFits:outside.length===0,correctColumns:columns===(width<=800?1:3),purchaseTargetFits:d.querySelector('.button').getBoundingClientRect().height>=44,previewVisible:d.querySelector('.preview-label').getBoundingClientRect().height>0};
    results.push({width,checks,outside,status:Object.values(checks).every(Boolean)?'PASS':'FAIL'});
    frame.remove();
  }
  document.querySelector('#results').textContent=JSON.stringify({status:results.every(r=>r.status==='PASS')?'PASS':'FAIL',results});
  if(location.hash==='#preview') {
    document.body.style.margin='0';document.querySelector('#results').hidden=true;
    const preview=document.createElement('iframe');preview.style.cssText='width:375px;height:3300px;border:0;display:block';preview.srcdoc=source;document.body.append(preview);
  }
})().catch(e=>document.querySelector('#results').textContent=JSON.stringify({status:'ERROR',error:String(e)}));
<\/script></body></html>`;
await writeFile(path.join(base,'mobile-check.html'),harness);
const browser=globalThis.process?.argv[2] || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const args=['--headless','--no-sandbox','--disable-gpu','--disable-extensions','--no-first-run','--disable-background-networking','--disable-component-update','--disable-sync','--disable-breakpad','--host-resolver-rules=MAP * ~NOTFOUND','--user-data-dir='+path.join(base,'.browser-check'),'--dump-dom','--virtual-time-budget=5000',pathToFileURL(path.join(base,'mobile-check.html')).href];
const run=await new Promise(resolve=>{
 const child=spawn(browser,args,{cwd:base,windowsHide:true});let stdout='',stderr='';
 const timer=setTimeout(()=>{child.kill();resolve({error:'Browser timed out'});},20000);
 child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);
 child.on('error',e=>{clearTimeout(timer);resolve({error:String(e)});});
 child.on('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr});});
});
let report;
const match=run.stdout?.match(/<pre id="results">([^<]+)<\/pre>/);
if(match) { try {report=JSON.parse(match[1].replaceAll('&quot;','"').replaceAll('&amp;','&'));} catch {} }
report ??= {status:'BLOCKED',reason:run.error || 'Browser failed before returning layout results',exitCode:run.code,stderr:run.stderr?.slice(0,1500),manualCheck:'Open mobile-check.html in a browser to run the offline layout checks.'};
await writeFile(path.join(base,'mobile-results.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(report.status!=='PASS' && globalThis.process) globalThis.process.exitCode=1;
