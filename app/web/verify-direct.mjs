// 验证"直连模式"能否在浏览器里跑通：登录 → 首页 → 余额/公告/电费。
// 桌面 Chrome 默认跨域读不到学校网关的响应头，所以这里显式 --disable-web-security。
// APK 的 WebView 靠 setAllowUniversalAccessFromFileURLs 达到同等效果，不需要这个开关。
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE || "http://127.0.0.1:5199";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER = process.env.CQUPT_USER;
const PASS = process.env.CQUPT_PASS;
if (!USER || !PASS) {
  console.error("需要设置 CQUPT_USER / CQUPT_PASS 环境变量");
  process.exit(1);
}

const log = (...a) => console.log("[direct]", ...a);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: [
    "--disable-web-security",
    "--disable-features=IsolateOrigins,site-per-process",
    "--user-data-dir=D:\\Employee\\Deepseek\\work\\cqupt-yikatong\\app\\web\\.chrome-direct",
    "--no-first-run",
    "--no-default-browser-check",
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});

// 记录关键网络请求，确认真的打到学校服务器而不是本地 /api
const hits = [];
page.on("request", (r) => {
  const u = r.url();
  if (u.includes("202.202.43.47") || u.includes("/api/")) hits.push(`${r.method()} ${u.slice(0, 96)}`);
});

await page.evaluateOnNewDocument(() => localStorage.clear());
await page.goto(`${BASE}/#/login`, { waitUntil: "networkidle2", timeout: 30000 });
await new Promise((r) => setTimeout(r, 600));

// 登录
const codeInput = await page.$('input[placeholder="请输入统一认证码"]');
const pwdInput = await page.$('input[placeholder="请输入密码"]');
if (!codeInput || !pwdInput) {
  log("找不到登录输入框");
  await browser.close();
  process.exit(1);
}
await codeInput.type(USER);
await pwdInput.type(PASS);
await page.click('button[type="submit"], .btn-primary');
log("已提交登录，等待首页…");

let ok = false;
for (let i = 0; i < 40; i += 1) {
  await new Promise((r) => setTimeout(r, 500));
  const hash = await page.evaluate(() => location.hash);
  const bal = await page.evaluate(() => document.querySelector(".bc-amount")?.textContent?.trim() || "");
  if (hash && !hash.includes("/login") && bal && bal !== "—") {
    log(`第 ${(i + 1) * 0.5}s：hash=${hash} 余额=${bal}`);
    ok = true;
    break;
  }
  if (i % 4 === 0) log(`等待中 ${(i + 1) * 0.5}s hash=${hash} 余额="${bal}"`);
}

const snapshot = await page.evaluate(() => ({
  hash: location.hash,
  balance: document.querySelector(".bc-amount")?.textContent?.trim() || null,
  caption: document.querySelector(".bc-cap")?.textContent?.trim() || null,
  name: document.querySelector(".bc-name")?.textContent?.trim() || null,
  notice: document.querySelector(".notice-bar")?.textContent?.trim() || null,
  quicks: Array.from(document.querySelectorAll(".quick .q-title")).map((n) => n.textContent?.trim()),
  recent: Array.from(document.querySelectorAll(".tx-row .tx-title")).map((n) => n.textContent?.trim()),
  session: !!localStorage.getItem("cqupt.session"),
  sid: !!localStorage.getItem("cqupt.sid"),
  bodyText: document.body.innerText.slice(0, 300),
}));

await page.screenshot({ path: "..\\..\\shots\\direct-01-home.png" });

// 顺带点开电费页，验证楼栋列表能否直连加载
await page.goto(`${BASE}/#/electric`, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1200));
const elecText = await page.evaluate(() => document.body.innerText.replace(/\n+/g, " | ").slice(0, 260));
await page.screenshot({ path: "..\\..\\shots\\direct-07-electric.png" });

log("结果：", JSON.stringify({ ok, snapshot, elecText, hits, errors }, null, 2));
await browser.close();
