/**
 * 验证"票据失效自动换票"是 single-flight 的：
 * 故意把本地票据改坏，首屏六路并发应只换一次票，然后全部成功。
 *
 * 用法：先 `VITE_DIRECT=1 npx vite build`，再起 `npx vite preview --port 5199`，然后
 *   $env:CQUPT_USER="..."; $env:CQUPT_PASS="..."; node verify-relogin.mjs
 */
import puppeteer from "puppeteer-core";
import os from "node:os";
import path from "node:path";

const BASE = process.env.BASE || "http://127.0.0.1:5199";
const CHROME = process.env.CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER = process.env.CQUPT_USER;
const PASS = process.env.CQUPT_PASS;
if (!USER || !PASS) {
  console.error("请先设置 CQUPT_USER / CQUPT_PASS");
  process.exit(1);
}

const profile = path.join(os.tmpdir(), "cqupt-relogin-" + Date.now());
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: [
    "--disable-web-security",
    "--user-data-dir=" + profile,
    "--no-first-run",
    "--window-size=390,844",
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true });
await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);

const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const hits = [];
page.on("request", (r) => {
  const u = r.url();
  if (u.includes("appEntrance!")) {
    const m = u.match(/appEntrance!(\w+)/);
    hits.push(m ? m[1] : "?");
  }
});

const count = (name) => hits.filter((h) => h === name).length;

/** 登录 */
await page.goto(BASE + "/#/login", { waitUntil: "networkidle2" });
await page.waitForSelector("input", { timeout: 20000 });
const box = await page.$$("input");
await box[0].click();
await box[0].type(USER);
await box[1].click();
await box[1].type(PASS);
await page.evaluate(() => {
  const btns = [...document.querySelectorAll("button")];
  const b = btns.find((x) => /登录/.test(x.textContent || ""));
  if (b) b.click();
});
await page.waitForSelector(".home .bc-amount", { timeout: 40000 });
const afterLogin = { newid: count("newid"), gateway: count("gateWay") };

/** 把票据改坏，模拟"被其它设备顶号" */
await page.evaluate(() => {
  const raw = localStorage.getItem("cqupt.session");
  const s = JSON.parse(raw);
  s.token = "deadbeefdeadbeefdeadbeefdeadbeef";
  localStorage.setItem("cqupt.session", JSON.stringify(s));
  localStorage.removeItem("cqupt.cache.home");
});
hits.length = 0;

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".home .bc-amount", { timeout: 40000 });
await new Promise((r) => setTimeout(r, 4000));

const state = await page.evaluate(() => {
  const amt = document.querySelector(".home .bc-amount")?.textContent?.trim() || "";
  const rows = document.querySelectorAll(".home .tx-row").length;
  const emptyTitle = document.querySelector(".home .empty-title")?.textContent?.trim() || "";
  const staleChip = document.querySelector(".home .bc-chip.warn")?.textContent?.trim() || "";
  const failed = document.querySelector(".home .t-body-s.t3")?.textContent?.trim() || "";
  return { amt, rows, emptyTitle, staleChip, failed };
});

console.log("登录阶段请求：", afterLogin);
console.log("换票阶段请求：newid =", count("newid"), " gateWay =", count("gateWay"));
console.log("页面状态：", state);
console.log("errors：", errors.length ? errors : "无");

const ok =
  count("newid") <= 1 &&
  state.rows > 0 &&
  !state.emptyTitle &&
  errors.length === 0;
console.log(ok ? "\n✓ 换票只发生一次，首屏六路全部成功" : "\n✗ 仍有问题");

await browser.close();
