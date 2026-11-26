/**
 * 学校一卡通网关的浏览器实现。
 *
 * APK 里这套逻辑是 `app-service.js` 内的几个模块（加密 "f0a6"、MAC "002c"、
 * 请求封装 "57e8"、参数序列化 "bd71"），后端版本在 `app/server/src/{crypto,gateway}.js`。
 * 这里把它搬到浏览器，让 App 不依赖任何中间服务器就能直连学校系统。
 *
 * 两个平台差异已经处理：
 * 1. 浏览器 WebCrypto 不支持 AES-ECB，这里用 crypto-js 实现（与服务端逐字节一致，有对拍验证）。
 * 2. 页面以 file:// 起在 WebView 里时 `fetch` 会被 CORS 预检拦掉，而 XHR 走
 *    `setAllowUniversalAccessFromFileURLs` 通道可以直发，所以统一用 XMLHttpRequest。
 */
// 按需引入：crypto-js 的默认入口会把 DES/3DES/RC4/Rabbit/SHA1/SHA256/SHA512/PBKDF2 全打包进来，
// 这里只用到 AES-ECB、MD5 和 Utf8/Base64 编解码。
import AES from "crypto-js/aes";
import MD5 from "crypto-js/md5";
import Utf8 from "crypto-js/enc-utf8";
import Base64 from "crypto-js/enc-base64";
import ECB from "crypto-js/mode-ecb";
import Pkcs7 from "crypto-js/pad-pkcs7";

export const BASE = "http://202.202.43.47:8080";
const GATEWAY = `${BASE}/ZNCard-Access/appEntrance!gateWay.action`;
const NEWID = `${BASE}/ZNCard-Access/appEntrance!newid.action`;
const PHOTO = `${BASE}/ZNCard-Access/appEntrance!getPhotoImg.action`;

/** 与 APK 内硬编码的常量一致 */
const AES_KEY = "lyy4pGK2Iw0XtQPq";
const MC_KEY = "gQCob9ZNJ7k0WUjr";

export class UpstreamError extends Error {
  code: string;
  /** 服务端原始响应片段，出「格式异常」时把它一起带出来，方便定位是网关换了结构还是被中间设备改写 */
  raw?: string;
  constructor(message: string, code = "UPSTREAM", raw?: string) {
    super(message);
    this.name = "UpstreamError";
    this.code = code;
    this.raw = raw;
  }
}

/** 最近 20 次「非预期响应」留档，排查用（localStorage，不上传） */
const BAD_LOG_KEY = "cqupt.badResponses";
interface BadRecord {
  at: number;
  action: string;
  status: number;
  len: number;
  head: string;
}
function recordBad(action: string, status: number, text: string) {
  try {
    const list: BadRecord[] = JSON.parse(localStorage.getItem(BAD_LOG_KEY) || "[]");
    list.unshift({
      at: Date.now(),
      action,
      status,
      len: text.length,
      head: text.slice(0, 300),
    });
    localStorage.setItem(BAD_LOG_KEY, JSON.stringify(list.slice(0, 20)));
  } catch {
    /* localStorage 不可用时忽略 */
  }
}
export function badResponses(): BadRecord[] {
  try {
    return JSON.parse(localStorage.getItem(BAD_LOG_KEY) || "[]");
  } catch {
    return [];
  }
}
export function clearBadResponses() {
  try {
    localStorage.removeItem(BAD_LOG_KEY);
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ 加解密 */

function keyOf(k: string) {
  return Utf8.parse(k);
}

/** AES-128-ECB / PKCS7，返回 base64 */
export function encrypt(text: string, keyStr: string = AES_KEY): string {
  const enc = AES.encrypt(text, keyOf(keyStr), {
    mode: ECB,
    padding: Pkcs7,
  });
  return Base64.stringify(enc.ciphertext);
}

export function decrypt(b64: string, keyStr: string = AES_KEY): string {
  const dec = AES.decrypt(
    { ciphertext: Base64.parse(b64) } as never,
    keyOf(keyStr),
    { mode: ECB, padding: Pkcs7 },
  );
  return dec.toString(Utf8);
}

/** 派生一次一密的会话密钥：base64 前 16 位，不足补 "F" */
export function encryptSub16(text: string): string {
  return (encrypt(text) + "FFFFFFFFFFFFFFFF").slice(0, 16);
}

export function encryptPkey(text: string, keyStr: string): string {
  return encrypt(text, keyStr);
}

/* -------------------------------------------------------------- 参数与签名 */

type Params = Record<string, unknown>;

/**
 * 复刻 APK 的 tansParams：跳过 null / undefined / 空串，
 * 对象值展平成 `k[sub]=v`，每个键值对后面都带 `&`（调用方自行去掉尾部）。
 */
export function tansParams(obj: Params): string {
  let out = "";
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v === null || v === undefined || v === "") continue;
    if (typeof v === "object") {
      const sub = v as Params;
      for (const sk of Object.keys(sub)) {
        const sv = sub[sk];
        if (sv === null || sv === undefined || sv === "") continue;
        out += `${encodeURIComponent(`${k}[${sk}]`)}=${encodeURIComponent(String(sv))}&`;
      }
    } else {
      out += `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}&`;
    }
  }
  return out;
}

/** MD5(排序后的 a=b&c=d 串 + MCKEY)，大写 —— 密钥硬编码在客户端，所以 MAC 只是防手滑 */
export function generateMAC(s: string): string {
  const raw = `${s}&MCKEY=${MC_KEY}`;
  return MD5(raw.split("&").sort().join("")).toString().toUpperCase();
}

/* ------------------------------------------------------------------ 传输层 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function request(
  url: string,
  init: { method?: string; body?: string; timeout?: number; arraybuffer?: boolean },
): Promise<{ text: string; buffer: ArrayBuffer | null; status: number }> {
  const { method = "POST", body = "", timeout = 15000, arraybuffer = false } = init;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    xhr.timeout = timeout;
    if (arraybuffer) xhr.responseType = "arraybuffer";
    if (method === "POST") xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 400) {
        const text = arraybuffer ? "" : xhr.responseText;
        // 弱网下偶尔会「连上了但只收到半截」，这种情况直接当失败，上层会重试
        const declared = Number(xhr.getResponseHeader("Content-Length") || 0);
        if (!arraybuffer && declared > 0 && text.length > 0) {
          const actual = new TextEncoder().encode(text).length;
          if (Math.abs(actual - declared) > 2) {
            recordBad(`${url.split("!").pop()}(truncated)`, xhr.status, `declared=${declared} actual=${actual}`);
            reject(
              new UpstreamError(
                `学校系统返回不完整（${actual}/${declared} 字节）`,
                "BAD_RESPONSE",
                text.slice(0, 300),
              ),
            );
            return;
          }
        }
        resolve({
          text,
          buffer: arraybuffer ? (xhr.response as ArrayBuffer) : null,
          status: xhr.status,
        });
      } else {
        const body = arraybuffer ? "" : xhr.responseText || "";
        recordBad(`${url.split("!").pop()}`, xhr.status, body);
        reject(
          new UpstreamError(
            `学校系统返回异常（HTTP ${xhr.status}）`,
            "HTTP_ERROR",
            body.slice(0, 300),
          ),
        );
      }
    };
    xhr.onerror = () =>
      reject(new UpstreamError("连接学校系统失败，请检查网络（校园网 / VPN）后重试", "NETWORK"));
    xhr.ontimeout = () => reject(new UpstreamError("请求超时，请重试", "TIMEOUT"));
    xhr.send(body || null);
  });
}

function form(obj: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v === null || v === undefined) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.join("&");
}

/** 把网关返回的 `[{IS_SUCCESS,DATA,MSG}]` 拆出来；不是 JSON 就留档并抛 BAD_RESPONSE */
function parseOuter(text: string, action: string, status: number) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    recordBad(action, status, text);
    const brief = text.trim().replace(/\s+/g, " ").slice(0, 60);
    throw new UpstreamError(
      `学校系统返回了非预期内容（HTTP ${status} · ${text.length} 字节${brief ? ` · ${brief}` : ""}）`,
      "BAD_RESPONSE",
      text.slice(0, 300),
    );
  }
  return (Array.isArray(parsed) ? parsed[0] : parsed) as { IS_SUCCESS?: string; DATA?: string; MSG?: string };
}

/** 一次性的 uuid，用作登录信封的派生密钥来源。偶发非预期响应时自动重试一次 */
export async function newUuid(): Promise<string> {
  const attempt = async () => {
    const res = await request(NEWID, { body: form({ TIMESTAMP: Date.now() }), timeout: 10000 });
    const head = parseOuter(res.text, "newid", res.status);
    if (!head || head.IS_SUCCESS !== "T" || !head.DATA) {
      throw new UpstreamError(head?.MSG || "获取会话标识失败", "NEWID_FAIL", res.text.slice(0, 300));
    }
    return head.DATA;
  };
  let lastErr: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      return await attempt();
    } catch (e) {
      lastErr = e;
      const code = (e as UpstreamError).code;
      const retryable = code === "BAD_RESPONSE" || code === "NETWORK" || code === "TIMEOUT";
      if (!retryable || i === 2) throw e;
      await sleep(300 * (i + 1));
    }
  }
  throw lastErr;
}

export interface CallOpts {
  way?: "" | "common" | "key" | "uuid";
  uuid?: string | null;
  token?: string | null;
  userid?: number | string | null;
  data?: unknown;
  timeout?: number;
}

/**
 * 复刻 APK 的信封。注意三个容易错的点（错一个就全线失败）：
 * 1. MAC 的计算输入**包含** TOKEN / USERID，但不含 WAY / DATA；
 * 2. 真正发出去的明文里**删掉了 TOKEN**（密钥是由 TOKEN 派生的），USERID 保留；
 * 3. 业务接口必须带 EMPID（由调用方通过 params 传入）。
 */
export async function call(service: string, params: Params = {}, opts: CallOpts = {}): Promise<any> {
  const { way = "", uuid = null, token = null, userid = null, data = null, timeout = 15000 } = opts;

  const p: Params = { SERVICE_TYPE: service, TIMESTAMP: Date.now(), ...params };
  if (token) p.TOKEN = token;
  if (userid !== null && userid !== undefined) p.USERID = userid;
  p.WAY = way;
  if (data !== null && data !== undefined) p.DATA = data;

  const wayValue = String(p.WAY ?? "");
  const dataValue = p.DATA;
  delete p.WAY;
  delete p.DATA;

  p.MAC = generateMAC(tansParams(p).slice(0, -1));
  if (dataValue !== undefined) p.DATA = dataValue;

  delete p.TOKEN; // 明文不含 TOKEN
  const plain = tansParams(p);

  let body: Record<string, unknown>;
  if (wayValue === "common") {
    body = { ...p };
  } else if (wayValue === "key") {
    body = { INFO: encrypt(plain), USID: userid ?? "" };
  } else if (wayValue === "uuid") {
    if (!uuid) throw new UpstreamError("缺少会话标识", "NO_UUID");
    body = { INFO: encryptPkey(plain, encryptSub16(uuid)) };
  } else {
    if (!token) throw new UpstreamError("登录状态已失效，请重新登录", "NO_TOKEN");
    body = { INFO: encryptPkey(plain, encryptSub16(token)), USID: userid ?? "" };
  }

  /**
   * 发一次并解码。`非预期内容 / 连接失败 / 超时` 视为「这次没拿到业务结果」，
   * 上层会重试一次 —— 网关偶发返回半截内容时，重试通常就好了。
   */
  const attempt = async () => {
    const res = await request(GATEWAY, { body: form(body), timeout });
    const head = parseOuter(res.text, service, res.status);
    if (!head || head.IS_SUCCESS !== "T" || !head.DATA) {
      throw new UpstreamError(head?.MSG || "学校系统拒绝了这次请求", "UPSTREAM_REJECT", res.text.slice(0, 300));
    }
    try {
      return JSON.parse(decrypt(head.DATA));
    } catch {
      recordBad(`${service}(decrypt)`, res.status, String(head.DATA).slice(0, 300));
      throw new UpstreamError("响应解密失败", "BAD_PAYLOAD", String(head.DATA).slice(0, 300));
    }
  };

  // 弱网下偶发失败就重发：最多 3 次尝试（350ms / 700ms 退避）。
  // 这层比上游的 timeout(15s) 更早生效，用户基本感知不到。
  let lastErr: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      return await attempt();
    } catch (e) {
      lastErr = e;
      const code = (e as UpstreamError).code;
      const retryable = code === "BAD_RESPONSE" || code === "NETWORK" || code === "TIMEOUT";
      if (!retryable || i === 2) throw e;
      await sleep(350 * (i + 1));
    }
  }
  throw lastErr;
}

/* -------------------------------------------------------------------- 头像 */

function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(bin);
}

/** GET photoImg?EMPLOYEENO=<学号> → data URI；取不到就返回 null，不抛错 */
export async function fetchAvatar(employeeNo: string): Promise<string | null> {
  if (!employeeNo) return null;
  try {
    const res = await request(`${PHOTO}?EMPLOYEENO=${encodeURIComponent(employeeNo)}`, {
      method: "GET",
      timeout: 8000,
      arraybuffer: true,
    });
    const buf = res.buffer;
    // 这个接口在没照片时会回几个字节的错误串，直接当图片用会渲染成破图
    if (!buf || buf.byteLength < 64) return null;
    const b = new Uint8Array(buf);
    const isPng = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
    const isJpg = b[0] === 0xff && b[1] === 0xd8;
    const isGif = b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46;
    const isWebp = b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46;
    if (!isPng && !isJpg && !isGif && !isWebp) return null;
    const mime = isPng ? "image/png" : isJpg ? "image/jpeg" : isGif ? "image/gif" : "image/webp";
    return `data:${mime};base64,${bufToBase64(buf)}`;
  } catch {
    return null;
  }
}
