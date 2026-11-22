/**
 * 极轻量的 SWR 缓存：内存一层 + localStorage 一层。
 *
 * 目的：切页时不重新走一遍网络（校园网关单次往返 100~400ms，六路并发叠起来就是"卡一下"）。
 * 用法：进入页面先用 `cacheGet` 的旧数据把界面画出来，再后台静默刷新，成功后覆盖。
 *
 * 之所以不用 Pinia / TanStack Query：这里只有两个列表要缓存，二十几行够用，
 * 也避免给 APK 产物再加一层依赖。
 */

const PREFIX = "cqupt.cache.";
const mem = new Map<string, { at: number; data: unknown }>();

export type Cached<T> = { data: T; at: number; age: number };

/** 数据仍算"新鲜"的阈值：这段时间内进页面直接复用，不发请求 */
export const FRESH_MS = 60_000;

export function cacheGet<T>(key: string): Cached<T> | null {
  const hit = mem.get(key);
  if (hit) return { data: hit.data as T, at: hit.at, age: Date.now() - hit.at };
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; data: T };
    if (!parsed || typeof parsed.at !== "number") return null;
    mem.set(key, parsed);
    return { data: parsed.data, at: parsed.at, age: Date.now() - parsed.at };
  } catch {
    return null;
  }
}

export function cacheSet<T>(key: string, data: T) {
  const entry = { at: Date.now(), data };
  mem.set(key, entry);
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(entry));
  } catch {
    /* 配额满 / 隐私模式：内存层仍然生效 */
  }
}

export function cacheDrop(key: string) {
  mem.delete(key);
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

/** 按前缀批量失效。余额变了就把所有和"钱"相关的缓存打掉，避免"余额更新了、明细还是旧的" */
export function cacheDropPrefix(prefix: string) {
  for (const k of [...mem.keys()]) {
    if (k.startsWith(prefix)) mem.delete(k);
  }
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX + prefix)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

/** 退出登录、切换账号时清空，避免上一个账号的流水出现在下一个人的手机上 */
export function cacheClearAll() {
  mem.clear();
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}
