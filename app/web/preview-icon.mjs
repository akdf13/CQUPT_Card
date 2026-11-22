import puppeteer from "puppeteer-core";

/*
 * 本地预览自适应图标效果，不需要连手机。
 * 把 vector drawable 的 pathData 原样搬到 SVG（语法通用），
 * 再套三种启动器遮罩（圆形 / 圆角方形 / 水滴），外加各密度 PNG。
 */
const icon = (size) => `
<svg viewBox="0 0 108 108" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1D5BEA"/>
      <stop offset="1" stop-color="#164BC4"/>
    </linearGradient>
  </defs>
  <rect width="108" height="108" fill="url(#g)"/>
  <path d="M35.5,36h37a4.5,4.5 0 0 1 4.5,4.5v23a4.5,4.5 0 0 1 -4.5,4.5h-37a4.5,4.5 0 0 1 -4.5,-4.5v-23a4.5,4.5 0 0 1 4.5,-4.5z"
        fill="none" stroke="#fff" stroke-width="3.6"/>
  <path d="M31,47.5h46" stroke="#fff" stroke-width="3.6" stroke-linecap="round"/>
  <path d="M38,57h14a1.7,1.7 0 0 1 0,3.4h-14a1.7,1.7 0 0 1 0,-3.4z" fill="#fff"/>
  <circle cx="68" cy="58.7" r="2.8" fill="#fff" fill-opacity="0.9"/>
</svg>`;

const cell = (title, inner, clip, bg = "transparent") => `
  <div class="cell">
    <div class="stage" style="background:${bg}">
      <div class="clip" style="clip-path:${clip}">${inner}</div>
    </div>
    <div class="cap">${title}</div>
  </div>`;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;padding:28px;background:#F6F8FA;font:13px/1.5 "Segoe UI","Microsoft YaHei",sans-serif;color:#0F1720}
  h1{font-size:16px;margin:0 0 4px}
  .sub{color:#5B6B7A;margin-bottom:20px}
  .row{display:flex;gap:22px;align-items:flex-start;flex-wrap:wrap}
  .cell{text-align:center}
  .stage{width:132px;height:132px;display:flex;align-items:center;justify-content:center;border-radius:8px}
  .clip{width:120px;height:120px;overflow:hidden;display:flex}
  .clip svg{width:120px;height:120px}
  .cap{margin-top:8px;color:#33414F;font-size:12px}
  .hint{margin-top:22px;padding:12px 14px;background:#EEF4FF;border-radius:10px;color:#164BC4;font-size:12px;max-width:640px}
</style></head><body>
  <h1>自适应图标预览（Android 8+，启动器会按自己的形状裁切）</h1>
  <div class="sub">同一套 background + foreground，在三种遮罩下的实际观感</div>
  <div class="row">
    ${cell("圆形（MIUI/HyperOS 默认）", icon(120), "circle(50%)")}
    ${cell("圆角方形（原生 Pixel）", icon(120), "inset(0 round 26px)")}
    ${cell("水滴（部分厂商）", icon(120), "circle(50% at 50% 50%)")}
    ${cell("旧系统 PNG 兜底 192", icon(120), "inset(0 round 26px)")}
  </div>
  <h1 style="margin-top:30px">放到桌面上的真实尺寸（48dp）</h1>
  <div class="row" style="gap:16px">
    ${cell("48dp", icon(48), "circle(50%)")}
    ${cell("48dp", icon(48), "inset(0 round 11px)")}
    ${cell("72dp", icon(72), "circle(50%)")}
  </div>
  <div class="hint">
    前景图案全部收在中心 72dp 安全区（108dp 画布的 30~78 区间），所以任何遮罩都不会切到卡片边框；
    背景是 108dp 满铺渐变，被裁掉的部分正是边角，不影响观感。
  </div>
</body></html>`;

const browser = await puppeteer.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: "new",
  args: ["--no-first-run", "--no-default-browser-check"],
});
const page = await browser.newPage();
await page.setViewport({ width: 720, height: 620, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: "load" });
await page.screenshot({ path: "..\\..\\shots\\icon-preview.png", fullPage: true });
await browser.close();
console.log("written: shots/icon-preview.png");