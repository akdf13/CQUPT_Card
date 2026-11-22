import { encrypt, encryptPkey, encryptSub16, decrypt, generateMAC, tansParams } from "./crypto.js";

const BASE = process.env.UPSTREAM_BASE || "http://202.202.43.47:8080";
const GATEWAY = `${BASE}/ZNCard-Access/appEntrance!gateWay.action`;
const NEWID = `${BASE}/ZNCard-Access/appEntrance!newid.action`;
const PHOTO = `${BASE}/ZNCard-Access/appEntrance!getPhotoImg.action`;

export class UpstreamError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "UpstreamError";
    this.code = code;
  }
}

/** 取一次性 uuid（用作登录信封的派生密钥来源） */
export async function newUuid() {
  const res = await fetch(NEWID, {
    method: "POST",
    body: new URLSearchParams({ TIMESTAMP: String(Date.now()) }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    signal: AbortSignal.timeout(8000),
  });
  const arr = await res.json();
  const head = Array.isArray(arr) ? arr[0] : arr;
  if (!head || head.IS_SUCCESS !== "T") {
    throw new UpstreamError(head?.MSG || "获取会话标识失败", "NEWID_FAIL");
  }
  return head.DATA;
}

/**
 * 复刻 APK 的加密网关调用。
 * way: "" 业务接口 | "uuid" 登录 | "common" 明文 | "key" 对称
 */
export async function call(service, params = {}, opts = {}) {
  const { way = "", uuid = null, token = null, userid = null, data = null, timeout = 15000 } = opts;

  const p = { SERVICE_TYPE: service, TIMESTAMP: Date.now(), ...params };
  if (token) p.TOKEN = token;
  if (userid) p.USERID = userid;
  p.WAY = way;
  if (data !== null && data !== undefined) p.DATA = data;

  const wayValue = p.WAY;
  const dataValue = p.DATA;
  delete p.WAY;
  delete p.DATA;

  const mac = generateMAC(tansParams(p).slice(0, -1));
  p.MAC = mac;
  if (dataValue !== undefined) p.DATA = dataValue;

  const sentWithToken = { ...p };
  delete p.TOKEN; // 明文不含 TOKEN，密钥由 TOKEN 派生
  const plain = tansParams(p);

  let body;
  if (wayValue === "common") {
    body = { ...p };
  } else if (wayValue === "key") {
    body = { INFO: encrypt(plain), USID: userid || "" };
  } else if (wayValue === "uuid") {
    if (!uuid) throw new UpstreamError("缺少 uuid", "NO_UUID");
    body = { INFO: encryptPkey(plain, encryptSub16(uuid)) };
  } else {
    if (!token) throw new UpstreamError("会话已失效，请重新登录", "NO_TOKEN");
    body = { INFO: encryptPkey(plain, encryptSub16(token)), USID: userid || "" };
  }

  const res = await fetch(GATEWAY, {
    method: "POST",
    body: new URLSearchParams(body),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "okhttp/3.12.13",
    },
    signal: AbortSignal.timeout(timeout),
  });

  const text = await res.text();
  let outer;
  try {
    outer = JSON.parse(text);
  } catch {
    throw new UpstreamError("上游返回非 JSON", "BAD_RESPONSE");
  }
  const head = Array.isArray(outer) ? outer[0] : outer;
  if (!head || head.IS_SUCCESS !== "T") {
    throw new UpstreamError(head?.MSG || "上游拒绝请求", "UPSTREAM_REJECT");
  }
  return JSON.parse(decrypt(head.DATA));
}

/** 头像：GET photoImg?EMPLOYEENO=手机号，返回 data URI */
export async function fetchAvatar(employeeNo) {
  const res = await fetch(`${PHOTO}?EMPLOYEENO=${encodeURIComponent(employeeNo)}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) return null;
  return `data:image/png;base64,${buf.toString("base64")}`;
}

export { BASE, GATEWAY, PHOTO };
