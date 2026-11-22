import crypto from "node:crypto";

/** 上游协议常量（原 APK 硬编码，服务端侧保管，前端永不接触） */
export const UPSTREAM_AES_KEY = "lyy4pGK2Iw0XtQPq";
export const UPSTREAM_MC_KEY = "gQCob9ZNJ7k0WUjr";

const AES_ALGO = "aes-128-ecb";

function ecbEncrypt(plain, keyBuf) {
  const cipher = crypto.createCipheriv(AES_ALGO, keyBuf, null);
  return Buffer.concat([cipher.update(Buffer.from(plain, "utf8")), cipher.final()]);
}

function ecbDecrypt(buf, keyBuf) {
  const decipher = crypto.createDecipheriv(AES_ALGO, keyBuf, null);
  return Buffer.concat([decipher.update(buf), decipher.final()]).toString("utf8");
}

const MASTER = Buffer.from(UPSTREAM_AES_KEY, "utf8");

/** encrypt(text) → base64，密钥为主密钥 */
export function encrypt(text) {
  return ecbEncrypt(text, MASTER).toString("base64");
}

/** decrypt(base64) → 明文 */
export function decrypt(b64) {
  return ecbDecrypt(Buffer.from(b64, "base64"), MASTER);
}

/** 用主密钥加密后取 base64 前 16 字符，作为派生密钥 */
export function encryptSub16(text) {
  let s = ecbEncrypt(text, MASTER).toString("base64");
  if (s.length > 16) return s.slice(0, 16);
  while (s.length < 16) s += "F";
  return s;
}

/** 指定密钥的 AES-ECB 加密 */
export function encryptPkey(text, key) {
  return ecbEncrypt(text, Buffer.from(key, "utf8")).toString("base64");
}

const UNDEF = Symbol("undefined");

/** 等价于 APK 的 tansParams：对象值展平为 k[sub]=v，跳过空值 */
export function tansParams(obj) {
  let out = "";
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v === null || v === "" || v === undefined || v === UNDEF) continue;
    if (typeof v === "object") {
      for (const sub of Object.keys(v)) {
        const sv = v[sub];
        if (sv === null || sv === "" || sv === undefined) continue;
        out += `${encodeURIComponent(`${k}[${sub}]`)}=${encodeURIComponent(sv)}&`;
      }
    } else {
      out += `${encodeURIComponent(k)}=${encodeURIComponent(v)}&`;
    }
  }
  return out;
}

/** 等价于 APK 的 generateMAC：排序后 MD5 大写 */
export function generateMAC(s) {
  const withKey = `${s}&MCKEY=${UPSTREAM_MC_KEY}`;
  const joined = withKey.split("&").sort().join("");
  return crypto.createHash("md5").update(joined, "utf8").digest("hex").toUpperCase();
}
