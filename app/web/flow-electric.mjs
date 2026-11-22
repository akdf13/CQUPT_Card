import puppeteer from "puppeteer-core";

if (!process.env.CQUPT_USER || !process.env.CQUPT_PASS) {
  console.error("请先设置环境变量 CQUPT_USER / CQUPT_PASS（自己的学号与密码），例如：");
  console.error('  $env:CQUPT_USER="2024000000"; $env:CQUPT_PASS="******"; node flow-electric.mjs');
  process.exit(1);
}
const BASE = "http://127.0.0.1:18900";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const r0 = await fetch(`${BASE}/api/auth/login`, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userno: process.env.CQUPT_USER || "",password: process.env.CQUPT_PASS || ""})});
const sid = (await r0.json()).data.sid;
const b = await puppeteer.launch({executablePath:CHROME, headless:"new", args:["--no-sandbox","--lang=zh-CN"]});
const p = await b.newPage();
await p.setViewport({width:390,height:844,deviceScaleFactor:2,isMobile:true,hasTouch:true});
await p.emulateMediaFeatures([{name:"prefers-color-scheme",value:"light"}]);
await p.evaluateOnNewDocument((s)=>localStorage.setItem("cqupt.sid",s), sid);
p.on("pageerror", e=>console.log("  [pageerror]", e.message));
await p.goto(`${BASE}/#/electric`, {waitUntil:"networkidle2"});
await new Promise(r=>setTimeout(r,900));
const text = async (sel) => p.$eval(sel, el=>el.textContent.trim().replace(/\s+/g," ")).catch(()=>null);

await p.click(".step");
await new Promise(r=>setTimeout(r,600));
await p.type(".input", "留学生31");
await new Promise(r=>setTimeout(r,400));
await p.click(".b-item");
await new Promise(r=>setTimeout(r,1400));
console.log("楼层:", (await p.$$eval(".chips-floor .mini-chip", els=>els.map(e=>e.textContent.trim()))).join(","));
await p.click(".chips-floor .mini-chip");
await new Promise(r=>setTimeout(r,1400));
console.log("房间:", (await p.$$eval(".chips-room .mini-chip", els=>els.slice(0,8).map(e=>e.textContent.trim()))).join(","));
await p.click(".chips-room .mini-chip");
await new Promise(r=>setTimeout(r,1600));
console.log("已选房间:", await text(".room-card .t-h2"));
console.log("读数面板:", (await p.$eval(".meter-hero", el=>el.textContent.replace(/\s+/g," ").trim()).catch(()=>"(无)")));
console.log("房间信息:", JSON.stringify(await p.$$eval(".facts .fact", els=>els.map(e=>e.textContent.trim().replace(/\s+/g," ")))));
console.log("充值区余额:", await text(".section-head .t3"));
await p.screenshot({path:"D:/Employee/Deepseek/work/cqupt-yikatong/shots/07b-electric-room.png", fullPage:true});

await p.click(".btn-primary.btn-lg");
await new Promise(r=>setTimeout(r,900));
console.log("toast:", await text(".toast"));
await p.screenshot({path:"D:/Employee/Deepseek/work/cqupt-yikatong/shots/07c-electric-toast.png"});
await b.close();
