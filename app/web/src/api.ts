import { Direct } from "./core/direct";

const SID_KEY = "cqupt.sid";

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(message: string, code = "ERROR", status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function getSid(): string | null {
  return localStorage.getItem(SID_KEY);
}
export function setSid(sid: string | null) {
  if (sid) localStorage.setItem(SID_KEY, sid);
  else localStorage.removeItem(SID_KEY);
}

type Opts = { method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal; timeout?: number };

export async function api<T = any>(path: string, opts: Opts = {}): Promise<T> {
  const { method = "GET", body, signal, timeout = 20000 } = opts;
  const headers: Record<string, string> = {};
  const sid = getSid();
  if (sid) headers.Authorization = `Bearer ${sid}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  if (signal) signal.addEventListener("abort", () => ctrl.abort(), { once: true });

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body ? { ...headers, "Content-Type": "application/json" } : headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e: any) {
    clearTimeout(timer);
    if (e?.name === "AbortError") throw new ApiError("网络超时，请重试", "TIMEOUT", 0);
    throw new ApiError("网络不可用，请检查连接", "NETWORK", 0);
  }
  clearTimeout(timer);

  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    throw new ApiError("服务返回异常", "BAD_RESPONSE", res.status);
  }

  if (!res.ok || !payload?.ok) {
    const err = payload?.error || {};
    if (res.status === 401) {
      setSid(null);
      throw new ApiError(err.message || "登录已过期，请重新登录", "NEED_LOGIN", 401);
    }
    throw new ApiError(err.message || "请求失败", err.code || "ERROR", res.status);
  }
  return payload.data as T;
}

/* ---------------- 领域接口 ---------------- */

export type UserFeature = { alias: string; name: string; type: number; status: number; orderid: number };
export type SessionUser = {
  userno: string;
  name: string;
  empno: string;
  empid: number;
  userid: number;
  eaccountid: number;
  avatar: string | null;
  features: UserFeature[];
  loginAt: number;
};

export type Balance = {
  status: number;
  message: string;
  item: {
    accountAmount0: number;
    accountCount0: number;
    freeZnAmount0: number;
    overdraftAmount0: number;
    accountStatus: number;
    accountStatusStr: string;
    consumptionopenpwd: string;
    exceedlimit: string;
    paydayconfine: number;
    paydayconfineMaximum: string;
    withdrawalingAmount: number;
  };
};

export type Row = {
  id: string;
  title: string;
  scene: string;
  time: string;
  amount: number;
  balance: number;
  dir: "in" | "out";
  kind: string;
  raw: any;
};

export type HomeData = {
  balance: Balance | null;
  balanceError: string | null;
  alert: any;
  notices: { ID: string; TITLE: string; MODIFYTIME: string }[];
  card: any;
  waterDevice: string | null;
  recent: Row[];
  monthSpend?: number;
  monthSpendCount?: number;
  monthSpendPartial?: boolean;
};

const backendApi = {
  login: (userno: string, password: string) =>
    api<{ sid: string; user: SessionUser }>("/api/auth/login", { method: "POST", body: { userno, password } }),
  logout: () => api("/api/auth/logout", { method: "POST" }),
  me: () => api<SessionUser>("/api/me"),
  home: () => api<HomeData>("/api/home"),
  balance: () => api<Balance>("/api/balance"),
  card: () => api<any>("/api/card"),
  reportCard: (lost: boolean) => api("/api/card/report", { method: "POST", body: { lost } }),
  transactions: (page = 1, size = 20, sdate?: string, edate?: string) =>
    api<{ page: number; pageCount: number; total: number; rows: Row[]; range: { from: string; to: string } }>(
      `/api/transactions?page=${page}&size=${size}${sdate ? `&sdate=${sdate}` : ""}${edate ? `&edate=${edate}` : ""}`
    ),
  /** 食堂 / 超市的聚合支付流水（原版 App 没做这个接口） */
  canteen: (page = 1, size = 20, sdate?: string, edate?: string) =>
    api<{ page: number; pageCount: number; total: number; rows: Row[]; range: { from: string; to: string } }>(
      `/api/canteen?page=${page}&size=${size}${sdate ? `&sdate=${sdate}` : ""}${edate ? `&edate=${edate}` : ""}`
    ),
  payments: (page = 1, size = 20, datatype = 1) =>
    api<{
      page: number;
      pageCount: number;
      total: number;
      rows: {
        id: string;
        title: string;
        fee: string;
        room: string;
        time: string;
        amount: number;
        paid: number;
        status: string;
        done: boolean;
        elec: boolean;
        raw: any;
      }[];
    }>(`/api/payments?page=${page}&size=${size}&datatype=${datatype}`),
  waterDevice: () => api<{ deviceno: string | null }>("/api/water/device"),
  openWater: (deviceno: string) =>
    api<{ ordersn: string; confirmed: boolean; raw: any }>("/api/water/open", {
      method: "POST",
      body: { deviceno },
    }),
  waterOrders: () => api<any>("/api/water/orders"),
  settleWater: (ordersn: string) =>
    api("/api/water/settle", { method: "POST", body: { ordersn } }),
  waterHistory: (page = 1, size = 10) =>
    api<{ rows: Row[]; current: number; pages: number }>(`/api/water/history?page=${page}&size=${size}`),
  elecBuildings: () => api<{ item: { BUILDNO: string; BUILDNAME: string; CYBUILDNO: string }[] }>(
    "/api/electric/buildings"
  ),
  elecFloors: (buildno: string) =>
    api<{ item: { FLOORNO: string }[] }>(`/api/electric/floors?buildno=${encodeURIComponent(buildno)}`),
  elecRooms: (buildno: string, floor: string) =>
    api<{ item: { ALLROOMNO: string; CYROOMNO: string; ROOMNO: string; OLDROOMNO: string }[] }>(
      `/api/electric/rooms?buildno=${encodeURIComponent(buildno)}&floor=${encodeURIComponent(floor)}`
    ),
  elecRoom: (allroomno: string) => api<any>(`/api/electric/room?allroomno=${encodeURIComponent(allroomno)}`),
  elecRecharge: (amount: number, roomno: string) =>
    api("/api/electric/recharge", { method: "POST", body: { amount, roomno } }),
  paycode: () => api<{ status: number; message: string; item: string }>("/api/paycode"),
  paycodeResult: (qrcode: string) =>
    api<{ status: number; message: string; item: any }>(`/api/paycode/result?qrcode=${encodeURIComponent(qrcode)}`),
  checkPwd: (pwd: string) =>
    api<{ ok: boolean; raw: any }>("/api/paycode/password", { method: "POST", body: { pwd } }),
  payOnline: (channel: "wechat" | "alipay", amount: number) =>
    api<{ channel: string; amount: string; item: any; message?: string }>("/api/recharge/online", {
      method: "POST",
      body: { channel, amount },
    }),

  payBill: (receivableaccountid: string, amount: number) =>
    api<{ ok: boolean; status: number; message: string }>("/api/payment/pay", {
      method: "POST",
      body: { receivableaccountid, amount },
    }),
  /** 后端已把上游的 { item: [...] } 归一成数组 */
  notices: () => api<{ ID: string; TITLE: string; MODIFYTIME: string }[]>("/api/notices"),
  noticeInfo: (id: string) =>
    api<{ id: string; title: string; time: string; editor: string; text: string }>(
      `/api/notice?id=${encodeURIComponent(id)}`,
    ),
  setPwdCheck: (status: 0 | 1) => api("/api/settings/pwdcheck", { method: "POST", body: { status } }),

  /** 支付绑定状态（getWithdrawalChannel 顺带返回 openid / alipayuserid） */
  bind: () =>
    api<{
      name: string;
      employeeno: string;
      wechat: { bound: boolean; nickname: string; id: string };
      alipay: { bound: boolean; nickname: string; id: string };
    }>("/api/bind"),
  /** 支付宝授权参数串（给原生 AuthTask.auth 用） */
  alipayAuth: () => api<{ authInfo: string }>("/api/bind/alipay/auth"),
  /** 用授权码绑定支付宝账号 */
  alipayBind: (code: string) =>
    api<{ ok: boolean; userid: string; nickname: string; message: string }>("/api/bind/alipay", {
      method: "POST",
      body: { code },
    }),
  /** 主动缴费：按设备号查商户 */
  device: (deviceno: string) =>
    api<{
      AREANAME?: string;
      MARKETNAME?: string;
      DEVICENAME?: string;
      DEVICENO?: string;
      DEVICEMODEL?: string;
    }>(`/api/device?deviceno=${encodeURIComponent(deviceno)}`),
  /** 主动缴费：向该商户付款（扣卡内余额） */
  payInitiative: (deviceno: string, amount: number) =>
    api<{ ok: boolean; market: string; amount: string; message: string }>("/api/pay/initiative", {
      method: "POST",
      body: { deviceno, amount },
    }),
};

/**
 * 两种运行形态共用同一套调用签名：
 * - 直连模式（APK）：浏览器直接请求学校网关，见 `core/direct.ts`；
 * - 代理模式（本地开发 / 桌面浏览器预览）：走同进程的 `/api/*`，见 `app/server`。
 * 桌面浏览器读不到学校网关的跨域响应头，所以只有 WebView 里能直连。
 */
// APK 产物（file:// 起、无后端）必须直连；桌面直连调试用 VITE_DIRECT=1
const DIRECT_MODE = import.meta.env.VITE_DIRECT === "1" || import.meta.env.VITE_APK === "1";

export const Api = (DIRECT_MODE ? Direct : backendApi) as typeof backendApi;
export const IS_DIRECT = DIRECT_MODE;
