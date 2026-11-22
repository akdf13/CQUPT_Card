import { reactive, computed } from "vue";
import { Api, ApiError, getSid, setSid, type SessionUser, type Balance, type Row } from "./api";
import { cacheClearAll, cacheDropPrefix } from "./cache";

/* ---------------- Toast ---------------- */
export type ToastItem = { id: number; text: string; type: "info" | "success" | "error" };
let toastSeed = 1;
export const toasts = reactive<ToastItem[]>([]);

export function toast(text: string, type: ToastItem["type"] = "info", ms = 2600) {
  const id = toastSeed++;
  toasts.push({ id, text, type });
  setTimeout(() => {
    const i = toasts.findIndex((t) => t.id === id);
    if (i >= 0) toasts.splice(i, 1);
  }, ms);
}

export function toastError(e: unknown) {
  const msg = e instanceof ApiError || e instanceof Error ? e.message : String(e);
  toast(msg, "error", 3200);
}

/* ---------------- 全局状态 ---------------- */
export const state = reactive({
  user: null as SessionUser | null,
  balance: null as Balance["item"] | null,
  balanceAt: 0,
  recent: [] as Row[],
  booted: false,
  offline: false,
});

export const isLoggedIn = computed(() => Boolean(state.user));
export const amount = computed(() => state.balance?.accountAmount0 ?? 0);

/** 老版本会在本地缓存账号里的水控设备号；这里做一次清理，避免把真实设备号带下去 */
try {
  localStorage.removeItem("cqupt.waterDevice");
} catch {
  /* 隐私模式忽略 */
}

export async function refreshMe() {
  state.user = await Api.me();
}

export async function refreshBalance(force = false) {
  const fresh = Date.now() - state.balanceAt < 8000;
  if (!force && fresh && state.balance) return state.balance;
  const before = state.balance?.accountAmount0;
  const r = await Api.balance();
  if (r?.item) {
    state.balance = r.item;
    state.balanceAt = Date.now();
    /*
     * 余额变了，说明账上发生了变动。此时若账单页还留着旧缓存，
     * 用户会看到"钱少了但明细里没有这笔" —— 必须让流水缓存一起失效。
     */
    if (before !== undefined && Number(before) !== Number(r.item.accountAmount0)) {
      cacheDropPrefix("bills:");
    }
  }
  return state.balance;
}

export async function boot() {
  if (!getSid()) {
    state.booted = true;
    return;
  }
  try {
    await refreshMe();
  } catch {
    setSid(null);
  } finally {
    state.booted = true;
  }
}

export async function doLogin(userno: string, password: string) {
  cacheClearAll();
  const r = await Api.login(userno, password);
  setSid(r.sid);
  state.user = r.user;
  state.balance = null;
  state.balanceAt = 0;
  if (r.user.avatar) state.user.avatar = r.user.avatar;
  // 头像后端异步补齐
  setTimeout(async () => {
    try {
      const me = await Api.me();
      if (me?.avatar) state.user = me;
    } catch {
      /* 忽略 */
    }
  }, 2000);
  return r.user;
}

export async function doLogout() {
  cacheClearAll();
  try {
    await Api.logout();
  } catch {
    /* 忽略 */
  }
  setSid(null);
  state.user = null;
  state.balance = null;
  state.recent = [];
}

/* ---------------- 金额格式化 ---------------- */
export function fmtMoney(n: number | string | undefined | null, withSign = false) {
  const v = Number(n ?? 0);
  const s = Math.abs(v).toFixed(2);
  const [int, dec] = s.split(".");
  const spaced = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const sign = withSign ? (v > 0 ? "+" : v < 0 ? "-" : "") : v < 0 ? "-" : "";
  return { text: `${sign}${spaced}.${dec}`, int: `${sign}${spaced}`, dec };
}

export function money(n: number | string | undefined | null) {
  return fmtMoney(n).text;
}

/** 余额类展示：没拿到数据时给占位符，避免把"还没加载"画成 0.00 */
export function moneyOrDash(n: number | string | undefined | null) {
  if (n === null || n === undefined || n === "") return "—";
  return fmtMoney(n).text;
}

/** "2026-11-20 19:54:12" → { date:"11-20", day:"今天", time:"19:54" } */
export function parseTime(t: string) {
  if (!t) return { date: "", time: "", dayLabel: "未知时间", ymd: "" };
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})[ T]?(\d{2}):(\d{2})/);
  if (!m) return { date: t.slice(0, 10), time: "", dayLabel: t.slice(0, 10), ymd: t.slice(0, 10) };
  const [, y, mo, d, hh, mm] = m;
  const ymd = `${y}-${mo}-${d}`;
  const today = new Date();
  const pad = (x: number) => String(x).padStart(2, "0");
  const todayYmd = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const yest = new Date(Date.now() - 864e5);
  const yestYmd = `${yest.getFullYear()}-${pad(yest.getMonth() + 1)}-${pad(yest.getDate())}`;
  const dayLabel = ymd === todayYmd ? "今天" : ymd === yestYmd ? "昨天" : `${Number(mo)}月${Number(d)}日`;
  return { date: `${mo}-${d}`, time: `${hh}:${mm}`, dayLabel, ymd };
}

/** 按日期分组，保持顺序 */
/** "2026-11-20 19:54:12" → "11-20 19:54"；解析不出时间就原样返回 */
export function shortTime(t: string | undefined | null): string {
  const src = String(t ?? "");
  const p = parseTime(src);
  if (!p.time) return src;
  return `${p.date} ${p.time}`;
}

/** 流水行图标：按标题+场景文本判定，避免 scene 为空后一律退化成 receipt */
export function rowIcon(r: { title?: string; scene?: string; amount?: number; dir?: string }): string {
  const t = `${r.title ?? ""}${r.scene ?? ""}`;
  if (/食堂|餐厅|餐饮|食间|档口|面馆|粉|饭/.test(t)) return "utensils";
  if (/[水饮澡浴]/.test(t)) return "droplet";
  if (/电/.test(t)) return "bolt";
  if (/网|流量/.test(t)) return "wifi";
  if (/补|助|领/.test(t)) return "gift";
  if (r.dir === "in" || (r.amount ?? 0) > 0) return "wallet";
  return "receipt";
}

export function groupByDay(rows: Row[]) {
  const map = new Map<string, { label: string; ymd: string; rows: Row[]; total: number }>();
  for (const r of rows) {
    const p = parseTime(r.time);
    const key = p.ymd || "unknown";
    if (!map.has(key)) map.set(key, { label: p.dayLabel, ymd: p.ymd, rows: [], total: 0 });
    const g = map.get(key)!;
    g.rows.push(r);
    g.total += r.amount;
  }
  return [...map.values()];
}
