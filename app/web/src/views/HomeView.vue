<script setup lang="ts">
import { onMounted, onActivated, ref, computed, watch } from "vue";
import { useRouter } from "vue-router";
import Icon from "../components/Icon.vue";
import { Api, type HomeData } from "../api";
import { cacheGet, cacheSet, FRESH_MS } from "../cache";
import { state, refreshBalance, toast, toastError, money, fmtMoney, groupByDay, rowIcon } from "../store";

// KeepAlive 需要组件名来缓存实例；没有它，每次切回首页都会重新挂载 + 重新请求
defineOptions({ name: "HomeView" });

const router = useRouter();

/** 进页面先把上次的数据画出来（同步、零网络），再决定要不要后台刷新 */
const seeded = cacheGet<HomeData>("home");
const data = ref<HomeData | null>(seeded?.data ?? null);
const loading = ref(!seeded);
const failed = ref<string | null>(null);
const dataAt = ref(seeded?.at ?? 0);
/** 有一次刷新失败、但页面上还铺着旧数据 —— 需要明确告诉用户"这些是旧的" */
const stale = ref(false);

/** "3 分钟前" 这类相对时间，只在数据确实陈旧时用得上 */
const staleAge = computed(() => {
  if (!dataAt.value) return "";
  const mins = Math.floor((Date.now() - dataAt.value) / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} 小时前`;
  return `${Math.floor(hrs / 24)} 天前`;
});

/** 挂载时若 store 里已有余额（从别的页面切回来），直接以它为初值：
 *  否则 watch 因为没有变化不会触发，卡片会一直停在 0.00 */
const balanceShown = ref(Number(state.balance?.accountAmount0 ?? 0));
const balanceTarget = computed(() => state.balance?.accountAmount0 ?? 0);
const balanceReady = computed(() => state.balance != null);

function animateBalance(to: number) {
  const from = balanceShown.value;
  if (Math.abs(to - from) < 0.005) {
    balanceShown.value = to;
    return;
  }
  const start = performance.now();
  const dur = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : 420;
  const step = (t: number) => {
    const p = Math.min(1, (t - start) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    balanceShown.value = from + (to - from) * e;
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

watch(balanceTarget, (v) => animateBalance(v), { immediate: true });

const bd = computed(() => fmtMoney(balanceShown.value));
/** 卡片上的身份信息：姓名 + 学号（截图脚本会替换成占位） */
const who = computed(() => state.user?.name || "");
const whoNo = computed(() => state.user?.userno || "");
const monthSpend = computed(() => Number(data.value?.monthSpend ?? 0));

/** 只读本地槽位（用户自己填过的），不拿账号里的设备号做预输入 */
const slotHint = computed(() => {
  try {
    const arr = JSON.parse(localStorage.getItem("cqupt.water.slots") || "[]");
    if (!Array.isArray(arr)) return "";
    const i = Number(localStorage.getItem("cqupt.water.active") || 0);
    const cur = arr[i] || arr.find((x: any) => x?.no) || null;
    if (!cur || !cur.no) return "";
    return cur.note ? String(cur.note) : "已记住设备号";
  } catch {
    return "";
  }
});

const quickLinks = computed(() => [
  {
    key: "water",
    label: "洗澡开水",
    sub: slotHint.value || "三个槽位随意切",
    icon: "droplet",
    to: "/water",
    solid: true,
  },
  { key: "recharge", label: "充值余额", sub: "微信 / 支付宝", icon: "wallet", to: "/recharge", solid: false },
  { key: "electric", label: "缴电费", sub: "宿舍电费充值", icon: "bolt", to: "/electric", solid: false },
]);

const alertText = computed(() => {
  const a = data.value?.alert;
  if (!a || a.status !== 0 || !a.message || a.message === "无提示信息") return "";
  return a.message;
});

const notice = computed(() => data.value?.notices?.[0] ?? null);
const recentGroups = computed(() => groupByDay((data.value?.recent ?? []).slice(0, 3)));

let inflight = false;

/** silent=true 时不显示 loading、不清旧数据 —— 用于"已经有内容，只在后台换血" */
async function load(silent = false) {
  if (inflight) return;
  inflight = true;
  if (!silent) {
    loading.value = true;
    failed.value = null;
  }
  try {
    const [home] = await Promise.all([Api.home(), refreshBalance(true).catch(() => null)]);
    data.value = home;
    dataAt.value = Date.now();
    cacheSet("home", home);
    failed.value = home.balanceError || null;
    stale.value = false;
    // home 聚合里已经带了余额，回填 store：就算 /api/balance 那一次请求失败，卡片也不会空
    if (home.balance?.item) {
      state.balance = home.balance.item;
      state.balanceAt = Date.now();
    }
  } catch (e) {
    // 只有完全没内容时才把错误铺到页面上，否则保留旧数据 + 打一条 toast
    if (!data.value) failed.value = (e as Error).message;
    else {
      stale.value = true;
      toastError(e);
    }
  } finally {
    loading.value = false;
    inflight = false;
  }
}

/** 每次进入（含 KeepAlive 激活）：热数据直接用，冷数据静默刷新 */
function activate() {
  if (!data.value) return load();
  // 账上已经变动过（余额与缓存里的最新一条对不上）就别再拿旧流水糊弄人
  const newestBal = data.value.recent?.[0]?.balance;
  const liveBal = state.balance?.accountAmount0;
  const drifted =
    newestBal !== undefined &&
    newestBal !== null &&
    liveBal !== undefined &&
    liveBal !== null &&
    Number(newestBal) !== Number(liveBal);
  if (drifted || Date.now() - dataAt.value > FRESH_MS) load(true);
  else refreshBalance().catch(() => null);
}

onMounted(activate);
onActivated(activate);

function goWater() {
  router.push("/water");
}
</script>

<template>
  <div class="page home">
    <!-- 顶栏 -->
    <header class="appbar">
      <div class="brand">重邮一卡通</div>
    </header>

    <!-- 余额卡 -->
    <section class="balance-card" :class="{ dim: loading }">
      <div class="bc-top">
        <div class="bc-id">
          <span class="bc-name">{{ who || "同学" }}</span>
          <span class="bc-cap">{{ whoNo ? whoNo + " · " : "" }}账户余额</span>
        </div>
        <button class="bc-pill" @click="router.push('/recharge')">
          <Icon name="plus" :size="15" :stroke="2.4" />
          充值
        </button>
      </div>
      <div v-if="loading" class="sk bc-sk"></div>
      <div v-else class="bc-amount">
        <span class="t-display bc-int">{{ balanceReady ? bd.int : "—" }}</span>
        <span v-if="balanceReady" class="bc-dec">.{{ bd.dec }}</span>
        <span class="bc-unit">元</span>
      </div>
      <div class="bc-meta">
        <span class="bc-chip">
          <Icon name="receipt" :size="13" /> 校园卡
          {{ data?.card?.item?.cardstatusStr || "查询中" }}
        </span>
        <span v-if="monthSpend > 0" class="bc-chip ghost">本月支出 ¥{{ monthSpend.toFixed(2) }}</span>
        <span v-if="stale && staleAge" class="bc-chip warn">数据更新失败 · {{ staleAge }}</span>
      </div>
      <button class="bc-pay" @click="router.push('/paycode')">
        <Icon name="qr" :size="18" />
        付款码
        <Icon name="chevron-right" :size="16" />
      </button>
      <div class="bc-glow" aria-hidden="true"></div>
    </section>

    <!-- 快捷三宫格 -->
    <section class="quick">
      <button
        v-for="q in quickLinks"
        :key="q.key"
        class="q"
        :class="{ solid: q.solid }"
        @click="router.push(q.to)"
      >
        <span class="q-icon"><Icon :name="q.icon" :size="22" /></span>
        <span class="q-txt">
          <span class="q-label">{{ q.label }}</span>
          <span class="q-sub">{{ q.sub }}</span>
        </span>
      </button>
    </section>

    <!-- 提示 / 公告 -->
    <div v-if="alertText" class="alert-bar">
      <Icon name="alert" :size="17" />
      <span class="ellipsis">{{ alertText }}</span>
    </div>
    <button v-if="notice" class="notice-bar" @click="router.push(`/notice/${notice.ID}`)">
      <span class="chip chip-primary">公告</span>
      <span class="ellipsis">{{ notice.TITLE }}</span>
      <Icon name="chevron-right" :size="16" class="t3" />
    </button>

    <!-- 最近流水 -->
    <section class="section">
      <div class="section-head">
        <h2 class="t-h3">最近消费</h2>
        <button class="btn-text" @click="router.push('/bills')">全部流水</button>
      </div>

      <div v-if="loading" class="card card-tight">
        <div v-for="i in 3" :key="i" class="sk-row">
          <div class="sk sk-ico"></div>
          <div class="grow">
            <div class="sk sk-line" style="width: 46%"></div>
            <div class="sk sk-line sm" style="width: 30%"></div>
          </div>
          <div class="sk sk-amt"></div>
        </div>
      </div>

      <div v-else-if="failed && !data?.recent?.length" class="card empty">
        <p class="empty-title">暂时取不到数据</p>
        <p class="t-body-s t3">{{ failed }}</p>
        <button class="btn btn-ghost btn-sm" style="margin-top: 12px" @click="load()">重试</button>
      </div>

      <div v-else-if="!data?.recent?.length" class="card empty">
        <p class="empty-title">本月还没有消费记录</p>
        <p class="t-body-s t3">在食堂、直饮水或洗澡消费后会显示在这里</p>
      </div>

      <div v-else class="card card-tight divide">
        <div v-for="g in recentGroups" :key="g.ymd" class="day-group">
          <div v-for="r in g.rows" :key="r.id" class="tx-row">
            <span class="icon-box"><Icon :name="rowIcon(r)" :size="19" /></span>
            <span class="grow">
              <span class="list-row-title ellipsis">{{ r.title }}</span>
              <span class="list-row-sub ellipsis">{{ r.scene ? r.scene + " · " : "" }}{{ r.time.slice(11, 16) }}</span>
            </span>
            <span class="tx-amt" :class="{ out: r.amount < 0 }">
              {{ r.amount < 0 ? "-" : "+" }}¥{{ Math.abs(r.amount).toFixed(2) }}
            </span>
          </div>
        </div>
      </div>
    </section>

    <p class="foot-note">数据来自一卡通中心</p>
  </div>
</template>

<style scoped>
.home {
  padding-bottom: calc(var(--tabbar-h) + var(--safe-b) + 20px);
  padding-top: calc(var(--safe-t) + 8px);
}

/* 顶栏 */
.appbar {
  height: var(--appbar-h);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.brand {
  font-size: 20px;
  line-height: 28px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.icon-btn {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border-radius: var(--r-full);
  color: var(--text-secondary);
  position: relative;
}
.icon-btn:active {
  background: var(--bg-hover);
}

/* 余额卡 */
.balance-card {
  position: relative;
  margin-top: 4px;
  padding: 20px;
  border-radius: var(--r-lg);
  background: linear-gradient(135deg, var(--primary-600), var(--primary-700));
  color: #fff;
  overflow: hidden;
  isolation: isolate;
  transition: opacity var(--dur-base) linear;
}
.balance-card.dim {
  opacity: 0.92;
}
.bc-glow {
  position: absolute;
  width: 220px;
  height: 220px;
  right: -80px;
  top: -110px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.22), transparent 68%);
  z-index: -1;
}
.bc-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.bc-id {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.bc-name {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.2px;
  color: #fff;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bc-cap {
  font-size: 13px;
  line-height: 20px;
  opacity: 0.86;
  font-weight: 500;
}
.bc-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 12px;
  border-radius: var(--r-full);
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  backdrop-filter: blur(4px);
}
.bc-pill:active {
  background: rgba(255, 255, 255, 0.28);
}
.bc-amount {
  margin-top: 10px;
  display: flex;
  align-items: baseline;
  gap: 2px;
}
.bc-int {
  font-size: 40px;
  line-height: 46px;
}
.bc-dec {
  font-family: var(--font-num);
  font-size: 22px;
  line-height: 30px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.bc-unit {
  font-size: 14px;
  margin-left: 4px;
  opacity: 0.9;
}
.bc-sk {
  height: 46px;
  margin-top: 10px;
  width: 60%;
  border-radius: var(--r-sm);
  opacity: 0.5;
}
.bc-meta {
  display: flex;
  gap: 8px;
  margin-top: 10px;
  flex-wrap: wrap;
}
.bc-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 9px;
  border-radius: var(--r-full);
  background: rgba(255, 255, 255, 0.16);
  font-size: 11px;
  font-weight: 500;
}
.bc-chip.warn {
  background: rgba(255, 214, 153, 0.22);
  color: #ffdfae;
}
.bc-chip.ghost {
  background: rgba(255, 255, 255, 0.1);
  opacity: 0.92;
}
.bc-pay {
  margin-top: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 42px;
  padding: 0 14px;
  border-radius: var(--r-btn);
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  border: 1px solid rgba(255, 255, 255, 0.14);
}
.bc-pay:active {
  background: rgba(255, 255, 255, 0.24);
}
.bc-pay svg:last-child {
  margin-left: auto;
  opacity: 0.8;
}

/* 快捷 */
.quick {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--gap-card);
  margin-top: var(--gap-card);
}
.q {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 64px;
  padding: 12px 14px;
  border-radius: var(--r-md);
  background: var(--bg-card);
  border: 1px solid var(--line-soft);
  text-align: left;
  transition:
    transform var(--dur-instant) linear,
    background var(--dur-fast) linear;
}
.q:active {
  transform: scale(0.985);
}
.q:first-child {
  grid-column: 1 / -1;
}
.q.solid {
  background: var(--primary-50);
  border-color: color-mix(in srgb, var(--primary-600) 16%, transparent);
}
.q-icon {
  width: 40px;
  height: 40px;
  border-radius: var(--r-sm);
  display: grid;
  place-items: center;
  background: var(--bg-inset);
  color: var(--text-secondary);
  flex: none;
}
.q.solid .q-icon {
  background: var(--primary-600);
  color: var(--text-on-primary);
}
.q-txt {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.q-label {
  font-size: 15px;
  font-weight: 600;
  line-height: 21px;
}
.q-sub {
  font-size: 12px;
  color: var(--text-tertiary);
  line-height: 17px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 提示条 */
.alert-bar,
.notice-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: var(--gap-card);
  min-height: 40px;
  padding: 8px 14px;
  border-radius: var(--r-md);
  font-size: 13px;
  text-align: left;
  width: 100%;
}
.alert-bar {
  background: var(--warning-50);
  color: var(--warning-600);
}
.notice-bar {
  background: var(--bg-card);
  border: 1px solid var(--line-soft);
  color: var(--text-secondary);
}

/* 流水 */
.sk-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
}
.sk-ico {
  width: 40px;
  height: 40px;
  border-radius: var(--r-sm);
}
.sk-line {
  height: 12px;
  margin-bottom: 6px;
}
.sk-line.sm {
  height: 10px;
  margin-bottom: 0;
}
.sk-amt {
  width: 64px;
  height: 14px;
}
.day-group + .day-group {
  border-top: 1px solid var(--line-soft);
}
.tx-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 60px;
  padding: 10px 16px;
}
.tx-amt {
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}
.tx-amt.out {
  color: var(--text-primary);
}
.foot-note {
  text-align: center;
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 24px;
}
</style>
