/**
 * 切换 tab 的手感测量：从点 tab 到内容真正出现要多久，期间发了几个网关请求。
 *
 * 用法（dist/ 需要是直连产物：VITE_DIRECT=1 npx vite build，并已 npx vite preview --port 5199）：
 *   $env:CQUPT_USER="学号"; $env:CQUPT_PASS="密码"; node timing.mjs
 */
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = "http://127.0.0.1:5199";
const USER = process.env.CQUPT_USER;
const PASS = process.env.CQUPT_PASS;
if (!USER || !PASS) {
  console.error("请先设置 CQUPT_USER / CQUPT_PASS");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 真实就绪条件：首页要画出余额数字，账单要出现流水行或"没有记录"
const HOME_READY = () => !!document.querySelector(".home .bc-amount");
const BILLS_READY = () =>
  !!document.querySelector(".bills .tx-row") || !!document.querySelector(".bills .empty-title");

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--disable-web-security", "--user-data-dir=" + process.env.TEMP + "\\cqupt-timing-" + Date.now(), "--no-first-run"],
  defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 },
});

const page = await browser.newPage();
const hits = [];
page.on("request", (r) => {
  const u = r.url();
  if (u.includes("appEntrance")) hits.push(u.split("!").pop().split("?")[0]);
});

await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
await page.goto(BASE + "/#/login", { waitUntil: "networkidle2" });
await page.waitForSelector("input", { timeout: 20000 });
const inputs = await page.$$("input");
await inputs[0].type(USER);
await inputs[1].type(PASS);
await page.click('button[type="submit"]');
await page.waitForFunction(HOME_READY, { timeout: 40000 });
await sleep(1200);

async function goto(hash, readyFn, label) {
  hits.length = 0;
  const t0 = Date.now();
  await page.evaluate((h) => (location.hash = h), hash);
  await page.waitForFunction(readyFn, { timeout: 20000 });
  const total = Date.now() - t0;
  console.log(
    `  ${label.padEnd(22)} ${String(total).padStart(4)}ms   网关请求 ${hits.length}${hits.length ? " [" + hits.join(",") + "]" : ""}`
  );
  return total;
}

const cold = [];
console.log("\n【第一次进入（没有缓存，必须走网络）】");
cold.push(await goto("#/bills", BILLS_READY, "首页 → 账单"));
cold.push(await goto("#/", HOME_READY, "账单 → 首页"));

const warm = [];
console.log("\n【切回已看过的 tab（KeepAlive + 本地缓存）】");
for (let i = 0; i < 3; i++) {
  warm.push(await goto("#/bills", BILLS_READY, `首页 → 账单 #${i + 1}`));
  warm.push(await goto("#/", HOME_READY, `账单 → 首页 #${i + 1}`));
}

console.log("\n【未缓存的 tab（对照组）】");
const other = [];
other.push(await goto("#/paycode", () => !!document.querySelector(".paycode"), "首页 → 付款码"));
other.push(await goto("#/me", () => !!document.querySelector(".me"), "付款码 → 我的"));
other.push(await goto("#/", HOME_READY, "我的 → 首页"));

const avg = (a) => Math.round(a.reduce((x, y) => x + y, 0) / a.length);
console.log("\n── 汇总 ──");
console.log(`  冷启动平均 ${avg(cold)}ms ／ 热切换平均 ${avg(warm)}ms ／ 其他 tab 平均 ${avg(other)}ms`);
console.log(`  提速 ${(avg(cold) / Math.max(1, avg(warm))).toFixed(1)}×`);

const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("cqupt.cache.")));
console.log("  缓存键：" + JSON.stringify(keys));

await browser.close();
