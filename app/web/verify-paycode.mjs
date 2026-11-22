/**
 * 验证付款码页的"保活 + 到期"策略：
 *   1. 进付款码 → 拿到码
 *   2. 切到账单停留 3s → 切回：码应复用（不重新请求），倒计时按真实时间扣减
 *   3. 再离开 8s → 切回：码仍复用，剩余秒数继续按真实时间走
 *   4. 硬刷新页面后重新取码（对照）
 *
 * 用法：VITE_DIRECT=1 npx vite build && npx vite preview --port 5199
 *       $env:CQUPT_USER / $env:CQUPT_PASS 后 node verify-paycode.mjs
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

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: [
    "--disable-web-security",
    "--user-data-dir=" + path.join(os.tmpdir(), "cqupt-paycode-" + Date.now()),
    "--no-first-run",
    "--window-size=390,844",
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true });
await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);

const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));


const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const snap = () =>
  page.evaluate(() => ({
    code: document.querySelector(".paycode .code-text")?.textContent?.trim() || "",
    left: document.querySelector(".paycode .countdown")?.textContent?.trim() || "",
    hasQr: Boolean(document.querySelector(".paycode img.qr")),
  }));

/** 登录 */
await page.goto(BASE + "/#/login", { waitUntil: "networkidle2" });
await page.waitForSelector("input", { timeout: 20000 });
const box = await page.$$("input");
await box[0].click();
await box[0].type(USER);
await box[1].click();
await box[1].type(PASS);
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => /登录/.test(x.textContent || ""));
  if (b) b.click();
});
await page.waitForSelector(".home .bc-amount", { timeout: 40000 });

/** 1. 进付款码 */
await page.click('a[href="#/paycode"], [href="#/paycode"]');
await page.waitForSelector(".paycode .code-text", { timeout: 20000 });
await sleep(1500);
const first = await snap();


/** 2. 离开 3 秒再回来 */
await page.click('[href="#/bills"]');
await sleep(3000);
await page.click('[href="#/paycode"]');
await sleep(600);
const second = await snap();


/** 3. 再离开 8 秒 */
await page.click('[href="#/my"], [href="#/me"]');
await sleep(8000);
await page.click('[href="#/paycode"]');
await sleep(600);
const third = await snap();


const num = (s) => Number((s.match(/(\d+)/) || [])[1] || -1);
const sameCode = (a, b) => a && b && a.slice(0, 16) === b.slice(0, 16);

console.log("第 1 次进付款码：", first, );
console.log("离开 3s 后回来：", second, );
console.log("离开 8s 后回来：", third, );
console.log("errors：", errors.length ? errors : "无");

const checks = [
  ["首次拿到码与二维码", Boolean(first.code) && first.hasQr],
  ["3s 回来后复用同一张码", sameCode(first.code, second.code)],
  ["3s 回来后倒计时没被重置（说明没重新取码）", num(second.left) < 59],
  ["倒计时按真实时间扣减（约 3s）", num(first.left) - num(second.left) >= 2],
  ["8s 回来后仍复用同一张码", sameCode(first.code, third.code)],
  ["8s 回来后倒计时仍连续（未重置）", num(third.left) < 59],
  ["累计倒计时与离开总时长吻合（约 11s）", num(first.left) - num(third.left) >= 9],
];
let bad = 0;
for (const [name, ok] of checks) {
  if (!ok) bad++;
  console.log((ok ? "✓ " : "✗ ") + name);
}
console.log(bad === 0 ? "\n全部通过" : `\n${bad} 项未通过`);

await browser.close();
process.exit(bad === 0 ? 0 : 1);
