import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

/*
 * 生成 Android 桌面图标。
 *
 * Android 8.0+ 走 res/mipmap-anydpi-v26/ic_launcher.xml 的自适应图标（矢量，任意密度都清晰），
 * 这里的 PNG 只是给 7.x 及以下兜底，所以按标准 5 个密度各出一张：
 *   mdpi 48 / hdpi 72 / xhdpi 96 / xxhdpi 144 / xxxhdpi 192
 *
 * 源图用 public/icon.svg（512 画布、圆角 112 的蓝渐变卡片），旧系统没有启动器遮罩，
 * 保留圆角是对的；8.0+ 由自适应图标自己裁形状，不会出现「双重圆角」。
 */
const SIZES = [
  ["mipmap-mdpi", 48],
  ["mipmap-hdpi", 72],
  ["mipmap-xhdpi", 96],
  ["mipmap-xxhdpi", 144],
  ["mipmap-xxxhdpi", 192],
];

const svg = fs.readFileSync("public/icon.svg", "utf8");
const browser = await puppeteer.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: "new",
  args: ["--no-first-run", "--no-default-browser-check"],
});
const page = await browser.newPage();

let total = 0;
for (const [dir, size] of SIZES) {
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${svg}</body></html>`,
    { waitUntil: "load" },
  );
  const outDir = path.join("..", "android", "res", dir);
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, "ic_launcher.png");
  await page.screenshot({ path: out, omitBackground: true });
  const bytes = fs.statSync(out).size;
  total += bytes;
  console.log(`${dir}/ic_launcher.png  ${size}x${size}  ${bytes} B`);
}
await browser.close();
console.log(`合计 ${(total / 1024).toFixed(1)} KB`);