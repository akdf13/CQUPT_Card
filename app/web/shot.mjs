import puppeteer from "puppeteer-core";
import QRCode from "qrcode";

if (!process.env.CQUPT_USER || !process.env.CQUPT_PASS) {
  console.error("请先设置环境变量 CQUPT_USER / CQUPT_PASS（自己的学号与密码），例如：");
  console.error('  $env:CQUPT_USER="2024000000"; $env:CQUPT_PASS="******"; node shot.mjs');
  process.exit(1);
}
import fs from "node:fs";
import path from "node:path";

const BASE = "http://127.0.0.1:18900";
const OUT = path.resolve("../../shots");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

fs.mkdirSync(OUT, { recursive: true });

/** 付款码页统一换成这张假码（内容就是 test），避免真实付款码外泄 */
const TEST_QR = await QRCode.toDataURL("test", {
  margin: 1,
  width: 464,
  color: { dark: "#0F1720", light: "#FFFFFF" },
});

/** 头像统一换成灰色剪影（比删 src 干净，不会留下破图残影） */
const MASK_AVATAR =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#EEF4FF"/>' +
      '<circle cx="32" cy="24" r="10.5" fill="#A9B4BF"/>' +
      '<path d="M11 62c0-11.6 9.4-21 21-21s21 9.4 21 21z" fill="#A9B4BF"/></svg>'
  );

/** 从 /api/me、/api/card、/api/bind 取真实值，动态生成脱敏规则：换个人跑也不会漏 */
async function buildMask(sid) {
  const H = { Authorization: "Bearer " + sid };
  const out = [];
  try {
    const me = (await (await fetch(`${BASE}/api/me`, { headers: H })).json()).data;
    const card = (await (await fetch(`${BASE}/api/card`, { headers: H })).json()).data;
    const cardId = card?.item?.cardid ?? card?.item?.CARDID;
    let bind = null;
    try {
      bind = (await (await fetch(`${BASE}/api/bind`, { headers: H })).json()).data;
    } catch {
      /* 绑定信息拿不到不影响其它脱敏 */
    }
    const pairs = [
      [me?.name, "同学"],
      [me?.userno, "0000000"],
      [me?.empno, "0000000000"],
      [me?.eaccountid, "000000"],
      [me?.empid, "000000"],
      [me?.userid, "000000"],
      [cardId, "000000"],
      // 绑定页会显示微信 / 支付宝昵称，这两个也得换掉
      [bind?.wechat?.nickname, "微信用户"],
      [bind?.alipay?.nickname, "支付宝用户"],
      [bind?.wechat?.id, "0000000000000000"],
      [bind?.alipay?.id, "0000000000000000"],
    ];
    for (const [from, to] of pairs) {
      const v = from == null ? "" : String(from);
      if (v.length >= 3) out.push([v, to]);
    }
  } catch (e) {
    console.log("  [mask] 取用户信息失败，跳过脱敏:", e.message);
  }
  // 长串优先：「Dr.张三」必须先于「张三」被替换，否则会得到「Dr.微信用户」
  out.sort((a, b) => b[0].length - a[0].length);
  return out;
}

async function applyMask(page, rules, testQr) {
  if (rules.length) {
    await page.evaluate((rs) => {
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walk.nextNode()) nodes.push(walk.currentNode);
      for (const n of nodes) {
        let t = n.nodeValue;
        for (const [from, to] of rs) if (t && t.includes(from)) t = t.split(from).join(to);
        if (t !== n.nodeValue) n.nodeValue = t;
      }
      for (const el of document.querySelectorAll("input,textarea")) {
        if (!el.value) continue;
        let v = el.value;
        for (const [from, to] of rs) if (v.includes(from)) v = v.split(from).join(to);
        if (v !== el.value) el.value = v;
      }
    }, rules);
  }
  // 头像换成灰色剪影；付款码换成假码。这两处是图片，文本替换盖不住。
  await page.evaluate(
    ({ qr, avatar }) => {
      for (const img of document.querySelectorAll(".avatar img, .user-avatar img")) {
        img.src = avatar;
        img.removeAttribute("srcset");
      }
      for (const el of document.querySelectorAll(".code-area img, .qr img, .code-area canvas, .qr canvas")) {
        if (el.tagName === "IMG") el.src = qr;
      }
    },
    { qr: testQr, avatar: MASK_AVATAR }
  );
}

/** 除首页外，其余截图都不带底栏：隐藏 tabbar，并把给 tabbar 预留的底部留白收掉 */
async function stripTabbar(page) {
  await page.evaluate(() => {
    const tab = document.querySelector(".tabbar");
    if (tab) tab.style.display = "none";
    for (const el of document.querySelectorAll("body *")) {
      const pb = parseFloat(getComputedStyle(el).paddingBottom) || 0;
      if (pb > 88) el.style.paddingBottom = "24px";
    }
  });
}

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userno: process.env.CQUPT_USER || "", password: process.env.CQUPT_PASS || "" }),
  });
  const j = await res.json();
  if (!j.ok) throw new Error("登录失败: " + JSON.stringify(j));
  return j.data.sid;
}

const pages = [
  { name: "01-home", hash: "#/", wait: 2600, keepTab: true },
  { name: "02-bills", hash: "#/bills", wait: 2400 },
  { name: "03-paycode", hash: "#/paycode", wait: 2600 },
  { name: "04-me", hash: "#/me", wait: 1600 },
  { name: "05-water", hash: "#/water", wait: 2400 },
  { name: "06-recharge", hash: "#/recharge", wait: 2000 },
  { name: "07-electric", hash: "#/electric", wait: 1800 },
  { name: "08-card", hash: "#/card", wait: 1800 },
  { name: "09-notice", hash: "#/notice/104", wait: 1500 },
  { name: "10-payitems", hash: "#/payitems", wait: 2000 },
  { name: "11-bind", hash: "#/bind", wait: 1800 },
];

const darkPages = [
  { name: "01-home-dark", hash: "#/", wait: 2600 },
  { name: "03-paycode-dark", hash: "#/paycode", wait: 2600 },
];

async function shot(browser, sid, item, dark, maskRules = []) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.emulateMediaFeatures([
    { name: "prefers-color-scheme", value: dark ? "dark" : "light" },
  ]);
  if (sid) {
    await page.evaluateOnNewDocument((s) => localStorage.setItem("cqupt.sid", s), sid);
  }
  page.on("console", (m) => {
    if (m.type() === "error") console.log(`  [console:${item.name}] ${m.text()}`);
  });
  page.on("pageerror", (e) => console.log(`  [pageerror:${item.name}] ${e.message}`));

  await page.goto(`${BASE}/${item.hash}`, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, item.wait));
  await applyMask(page, maskRules, TEST_QR);
  // 只有首页那张保留底栏，其余都不带
  const keepTab = item.keepTab === true;
  if (!keepTab) await stripTabbar(page);
  const url = page.url();
  const file = path.join(OUT, `${item.name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  const full = path.join(OUT, `${item.name}-full.png`);
  await page.screenshot({ path: full, fullPage: true });
  const title = await page.evaluate(
    () =>
      document.querySelector(".brand,.hero-title,h1,.panel-head .ph-title")?.textContent?.trim() ||
      document.title
  );
  console.log(`✓ ${item.name}  «${title}»  ${url.replace(BASE, "")}${keepTab ? " ·含底栏" : ""}`);
  await page.close();
}

async function shotLogin(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  await page.evaluateOnNewDocument(() => localStorage.removeItem("cqupt.sid"));
  await page.goto(`${BASE}/#/login`, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 1200));
  await page.screenshot({ path: path.join(OUT, "00-login.png") });
  console.log("✓ 00-login");
  await page.close();
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none", "--lang=zh-CN"],
});

try {
  await shotLogin(browser);
  const sid = await login();
  console.log("sid ok:", sid.slice(0, 8) + "…");
  const maskRules = await buildMask(sid);
  console.log("脱敏规则:", maskRules.length, "条");
  for (const item of pages) await shot(browser, sid, item, false, maskRules);
  for (const item of darkPages) await shot(browser, sid, item, true, maskRules);
  console.log("done →", OUT);
} finally {
  await browser.close();
}
