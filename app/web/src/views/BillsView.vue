<script setup lang="ts">
import { computed, onMounted, onActivated, ref } from "vue";
import { useRouter } from "vue-router";
import Icon from "../components/Icon.vue";
import { Api, type Row } from "../api";
import { cacheGet, cacheSet, FRESH_MS } from "../cache";
import { groupByDay, money, state, toastError, rowIcon, toast } from "../store";
import CalSheet from "../components/CalSheet.vue";
import { nextTick } from "vue";

// KeepAlive 需要组件名来缓存实例
defineOptions({ name: "BillsView" });

const router = useRouter();

type BillsCache = { rows: Row[]; page: number; pageCount: number; total: number };

const months = (() => {
  const out: { key: string; label: string; from: string; to: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const last = new Date(y, m, 0).getDate();
    const pad = (n: number) => String(n).padStart(2, "0");
    out.push({
      key: `${y}-${pad(m)}`,
      label: i === 0 ? "本月" : `${m} 月`,
      from: `${y}-${pad(m)}-01`,
      to: `${y}-${pad(m)}-${pad(last)}`,
    });
  }
  return out;
})();

/**
 * 两个数据源：
 *   card    = 一卡通电子账户流水（水控、直饮水、电费、充值）—— getEAccountData
 *   canteen = 食堂 / 超市的聚合支付流水（微信/支付宝/刷卡）—— queryEmpAggPayData
 * 后者是原版 App 完全没做的接口，靠 STARTTIME/ENDTIME 才拉得到。
 */

type Source = "card" | "canteen";
const source = ref<Source>("card");
const activeMonth = ref(months[0]);
const cacheKey = () => `bills:${source.value}:${activeMonth.value.key}`;

/** 先用上次这个月的数据铺满界面，避免切回来自看到骨架屏 */
const seeded = cacheGet<BillsCache>(cacheKey());
const rows = ref<Row[]>(seeded?.data.rows ?? []);
// 旧版本可能留下 page > pageCount 的脏缓存（一路「加载更多」加到越界），这里自愈
const page = ref(
  seeded && seeded.data.page > (seeded.data.pageCount || 1) ? 1 : seeded?.data.page ?? 1
);
const pageCount = ref(seeded?.data.pageCount ?? 1);
const total = ref(seeded?.data.total ?? 0);
const loading = ref(!seeded);
const loadingMore = ref(false);
const err = ref("");
const dataAt = ref(seeded?.at ?? 0);

/**
 * 整月全量（后台补齐，仅用于汇总）。
 * 列表是分页展示的，但「支出/汇入」必须算整月——只算已加载的前 50 笔会严重偏低
 * （实测 11 月前 50 笔只有 ¥5.69，全月其实是 ¥90.81，大头是月初的电费 77 元）。
 */
const allRows = ref<Row[]>([]);

const summary = computed(() => {
  const src = allRows.value.length ? allRows.value : rows.value;
  let out = 0;
  let inc = 0;
  for (const r of src) {
    if (r.amount < 0) out += Math.abs(r.amount);
    else inc += r.amount;
  }
  return { out, inc, count: src.length, loaded: rows.value.length, total: total.value };
});

const groups = computed(() => groupByDay(rows.value));

/**
 * 请求序号：切月/切源时旧请求可能后返回，用序号把过期响应丢掉，
 * 否则会出现「点了 9 月、页面显示 8 月」这种错位。
 */
/**
 * 请求序号：切月/切源时旧请求可能后返回，用序号把过期响应丢掉，
 * 否则会出现「点了 9 月、页面显示 8 月」这种错位。
 */
let seq = 0;

/** 统一的分页请求，size 固定 50（20 条只够盖住两天，用户会以为记录丢了） */
async function fetchPage(pg: number) {
  return source.value === "canteen"
    ? await Api.canteen(pg, 50, activeMonth.value.from, activeMonth.value.to)
    : await Api.transactions(pg, 50, activeMonth.value.from, activeMonth.value.to);
}

function saveCache() {
  cacheSet(cacheKey(), { rows: rows.value, page: page.value, pageCount: pageCount.value, total: total.value });
}

/** 首屏 / 换血：总是从第 1 页整页替换 */
async function load(_reset = true, silent = false) {
  const my = ++seq;
  if (!silent) loading.value = true;
  err.value = "";
  try {
    const r = await fetchPage(1);
    if (my !== seq) return;
    rows.value = r.rows;
    page.value = 1;
    pageCount.value = r.pageCount || 1;
    total.value = r.total || r.rows.length;
    allRows.value = r.rows.slice();
    dataAt.value = Date.now();
    loading.value = false; // 首屏先出来，剩下的后台补
    saveCache();

    // 后台把整月拉完，只为让汇总（支出/汇入）是整月的真实数字
    const pc = pageCount.value;
    if (pc > 1) {
      let acc = r.rows.slice();
      for (let pg = 2; pg <= pc && pg <= 40; pg++) {
        const more = await fetchPage(pg);
        if (my !== seq) return;
        acc = acc.concat(more.rows);
        allRows.value = acc;
        dataAt.value = Date.now();
      }
    }
  } catch (e: any) {
    if (my !== seq) return;
    if (!rows.value.length) err.value = e?.message || "加载失败";
    else toastError(e);
  } finally {
    if (my === seq) loading.value = false;
  }
}
function pickMonth(m: (typeof months)[number]) {
  if (m.key === activeMonth.value.key) return;
  activeMonth.value = m;
  const hit = cacheGet<BillsCache>(cacheKey());
  if (hit) {
    rows.value = hit.data.rows;
    page.value = hit.data.page;
    pageCount.value = hit.data.pageCount;
    total.value = hit.data.total;
    dataAt.value = hit.at;
    loading.value = false;
    load(true, true); // 后台换血
  } else {
    rows.value = [];
    page.value = 1;
    pageCount.value = 1;
    total.value = 0;
    dataAt.value = 0;
    load(true);
  }
}

/** 切换数据源：先吃该来源的缓存，没有就拉网络 */
/* ---------- 日历：跳到某一天 ---------- */

const calOpen = ref(false);
const calMonth = ref(months[0].key);
const calDays = ref<string[]>([]);
const calLoading = ref(false);
const dayHit = ref("");

const calMin = computed(() => months[months.length - 1].key);
const calMax = computed(() => months[0].key);
const monthOf = (key: string) => months.find((m) => m.key === key);

/** 该月「有记录的日子」缓存键 —— 日期集合不随分页变化，可以放心缓存 */
const daysKey = (key: string) => `days:${source.value}:${key}`;

/** 拉一整月（循环分页到底），只留日期，用于日历上标点 */
async function loadCalDays(key: string) {
  const m = monthOf(key);
  if (!m) {
    calDays.value = [];
    return;
  }
  const cached = cacheGet<{ days: string[] }>(daysKey(key));
  if (cached) calDays.value = cached.data.days;

  calLoading.value = true;
  const set = new Set<string>(cached?.data.days ?? []);
  try {
    for (let pg = 1; pg <= 20; pg++) {
      const r =
        source.value === "canteen"
          ? await Api.canteen(pg, 100, m.from, m.to)
          : await Api.transactions(pg, 100, m.from, m.to);
      for (const x of r.rows) {
        const d = String(x.time || "").slice(0, 10);
        if (d) set.add(d);
      }
      if (pg >= (r.pageCount || 1)) break;
    }
    calDays.value = [...set].sort();
    cacheSet(daysKey(key), { days: calDays.value });
  } catch (e: any) {
    if (!calDays.value.length) toastError(e);
  } finally {
    calLoading.value = false;
  }
}

async function openCal() {
  calMonth.value = activeMonth.value.key;
  calOpen.value = true;
  await loadCalDays(calMonth.value);
}

async function changeCalMonth(key: string) {
  calMonth.value = key;
  calDays.value = [];
  await loadCalDays(key);
}

/**
 * 把列表加载到目标那天出现为止。
 * 该天可能在后面的分页里，不加载就滚不过去。
 * 这里自己维护 page/rows 的同步：只要某页被丢弃（被更新的请求取代）就立刻退出，
 * 免得出现「页号前进了、数据没进来」的错位缓存。
 */
async function ensureDay(ymd: string) {
  const hit = (list: Row[]) => list.some((r) => String(r.time || "").slice(0, 10) === ymd);
  if (hit(rows.value)) return true;

  // 后台已把整月拉全，直接铺开即可（不用再一页页翻）
  if (hit(allRows.value)) {
    rows.value = allRows.value.slice();
    page.value = pageCount.value;
    dataAt.value = Date.now();
    saveCache();
    return true;
  }

  const my = ++seq;
  let acc: Row[] = [];
  let pg = 1;
  let pc = 1;
  for (; pg <= 40; pg++) {
    const r = await fetchPage(pg);
    if (my !== seq) return hit(rows.value);
    acc = pg === 1 ? r.rows : [...acc, ...r.rows];
    pc = r.pageCount || 1;
    rows.value = acc;
    page.value = pg;
    pageCount.value = pc;
    total.value = r.total || acc.length;
    if (hit(acc) || pg >= pc) break;
  }
  dataAt.value = Date.now();
  saveCache();
  return hit(rows.value);
}

async function pickDay(ymd: string) {
  const key = ymd.slice(0, 7);
  const m = monthOf(key);
  if (!m) return;
  calOpen.value = false;

  if (activeMonth.value.key !== key) {
    activeMonth.value = m;
    page.value = 1;
    await load(true);
  }
  const found = await ensureDay(ymd);
  await nextTick();

  const el = document.getElementById("d-" + ymd);
  if (el && found) {
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    dayHit.value = ymd;
    window.setTimeout(() => (dayHit.value = ""), 2400);
  } else {
    toast("这一天没有记录", "info", 2400);
  }
}
function switchSource(s: Source) {
  if (s === source.value) return;
  source.value = s;
  const hit = cacheGet<BillsCache>(cacheKey());
  if (hit) {
    rows.value = hit.data.rows;
    page.value = hit.data.page;
    pageCount.value = hit.data.pageCount;
    total.value = hit.data.total;
    dataAt.value = hit.at;
    loading.value = false;
    load(true, true);
  } else {
    rows.value = [];
    page.value = 1;
    pageCount.value = 1;
    total.value = 0;
    dataAt.value = 0;
    load(true);
  }
}

async function loadMore() {
  if (page.value >= pageCount.value || loadingMore.value) return;
  const my = ++seq;
  const next = page.value + 1;
  loadingMore.value = true;
  try {
    const r = await fetchPage(next);
    if (my !== seq) return;
    rows.value = [...rows.value, ...r.rows];
    page.value = next;
    pageCount.value = r.pageCount || 1;
    total.value = r.total || rows.value.length;
    if (!allRows.value.length) allRows.value = rows.value.slice();
    dataAt.value = Date.now();
    saveCache();
  } catch (e: any) {
    if (my === seq) toastError(e);
  } finally {
    loadingMore.value = false;
  }
}

/** 进入页面（含从别的 tab 切回来）：有数据且不过期就不发请求 */
function activate() {
  if (!rows.value.length) return void load(true);
  /*
   * 除了"缓存太旧"，还有一种情况必须刷新：账上已经发生变动（余额变了），
   * 但这份缓存是在变动之前存的 —— 否则用户会看到"余额少了、明细里却没有这笔"。
   */
  const newestBal = rows.value[0]?.balance;
  const liveBal = state.balance?.accountAmount0;
  const drifted =
    newestBal !== undefined &&
    newestBal !== null &&
    liveBal !== undefined &&
    liveBal !== null &&
    Number(newestBal) !== Number(liveBal);
  if (drifted || Date.now() - dataAt.value > FRESH_MS) load(true, true);
}

onMounted(activate);
onActivated(activate);
</script>

<template>
  <div class="page bills">
    <header class="appbar">
      <div class="brand">账单</div>
      <div class="acts">
        <button class="icon-btn" aria-label="跳到某天" @click="openCal">
          <Icon name="calendar" :size="20" />
        </button>
        <button class="icon-btn" aria-label="刷新" @click="load(true)">
          <Icon name="refresh" :size="20" />
        </button>
      </div>
    </header>

    <!-- 数据源：一卡通流水 / 食堂聚合支付 -->
    <div class="seg">
      <button class="seg-btn" :class="{ on: source === 'card' }" @click="switchSource('card')">一卡通</button>
      <button class="seg-btn" :class="{ on: source === 'canteen' }" @click="switchSource('canteen')">食堂消费</button>
    </div>

    <!-- 月份 -->
    <div class="months">
      <button
        v-for="m in months"
        :key="m.key"
        class="m-chip"
        :class="{ on: activeMonth.key === m.key }"
        @click="pickMonth(m)"
      >
        {{ m.label }}
      </button>
    </div>

    <!-- 汇总 -->
    <section class="sum">
      <div class="sum-col">
        <span class="k">支出</span>
        <span class="v out">¥{{ money(summary.out) }}</span>
      </div>
      <div class="sum-div"></div>
      <!-- 食堂消费走聚合码，只可能支出，不摆一列恒为 0 的「收入」 -->
      <template v-if="source === 'card'">
        <div class="sum-col">
          <span class="k">汇入</span>
          <span class="v inc">¥{{ money(summary.inc) }}</span>
        </div>
        <div class="sum-div"></div>
      </template>
      <div class="sum-col">
        <span class="k">笔数</span>
        <span class="v">{{ summary.count }}<span v-if="summary.total > summary.count" class="v-total"> / {{ summary.total }}</span></span>
      </div>
    </section>
    <p v-if="source === 'card'" class="sum-note t-body-s t3">
      统计基于 {{ activeMonth.label }}已加载记录；下拉到底可继续加载
    </p>

    <!-- 列表 -->
    <div v-if="loading" class="loading">
      <div v-for="i in 6" :key="i" class="sk-row">
        <div class="sk sk-ico"></div>
        <div class="grow">
          <div class="sk sk-line" style="width: 48%"></div>
          <div class="sk sk-line sm" style="width: 28%"></div>
        </div>
        <div class="sk sk-amt"></div>
      </div>
    </div>

    <div v-else-if="err && !rows.length" class="card empty">
      <p class="empty-title">加载失败</p>
      <p class="t-body-s t3">{{ err }}</p>
      <button class="btn btn-ghost btn-sm" style="margin-top: 12px" @click="load(true)">重试</button>
    </div>

    <div v-else-if="!rows.length" class="card empty">
      <p class="empty-title">{{ activeMonth.label }}没有记录</p>
      <p v-if="source === 'canteen'" class="t-body-s t3">
        这个月没有食堂消费记录。需要先在<router-link to="/bind" class="inline-link">本 App</router-link> 或原版 App 里绑定微信 / 支付宝，之后用学校聚合码扫码付款才会被记下来。
      </p>
      <p v-else class="t-body-s t3">换个月份看看，或确认近期是否使用过校园卡</p>
    </div>

    <div v-else class="groups">
      <section v-for="g in groups" :key="g.ymd" :id="'d-' + g.ymd" class="group" :class="{ 'day-hit': dayHit === g.ymd }">
        <header class="g-head">
          <span>{{ g.label }}</span>
          <span class="g-sum mono">{{ g.total < 0 ? "-" : "" }}¥{{ Math.abs(g.total).toFixed(2) }}</span>
        </header>
        <div class="card card-tight">
          <div v-for="r in g.rows" :key="r.id" class="tx-row">
            <span class="icon-box">
              <Icon :name="rowIcon(r)" :size="21" />
            </span>
            <span class="grow">
              <span class="list-row-title ellipsis">{{ r.title }}</span>
              <span class="list-row-sub ellipsis">{{ r.scene ? r.scene + " · " : "" }}{{ r.time.slice(11, 16) }}</span>
            </span>
            <span class="amt">
              <span class="v" :class="{ inc: r.amount > 0 }">
                {{ r.amount < 0 ? "-" : "+" }}¥{{ Math.abs(r.amount).toFixed(2) }}
              </span>
              <span v-if="r.balance" class="b">余额 {{ r.balance.toFixed(2) }}</span>
            </span>
          </div>
        </div>
      </section>
    </div>

    <button v-if="page < pageCount" class="btn btn-ghost btn-block load-more" :disabled="loadingMore" @click="loadMore">
      {{ loadingMore ? "加载中…" : `加载更多（已 ${rows.length} / 共 ${total || rows.length} 笔）` }}
    </button>
  </div>

  <CalSheet
    :open="calOpen"
    :month="calMonth"
    :days="calDays"
    :loading="calLoading"
    :min-month="calMin"
    :max-month="calMax"
    :active="activeMonth.key"
    @close="calOpen = false"
    @pick="pickDay"
    @month-change="changeCalMonth"
  />
</template>

<style scoped>
.bills {
  padding-bottom: calc(var(--tabbar-h) + var(--safe-b) + 20px);
  padding-top: calc(var(--safe-t) + 8px);
}
.appbar {
  height: var(--appbar-h);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.brand {
  font-size: 20px;
  font-weight: 600;
}
.icon-btn {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border-radius: var(--r-full);
  color: var(--text-secondary);
  margin-right: -10px;
}
.icon-btn:active {
  background: var(--bg-hover);
}

.seg {
  display: flex;
  gap: 4px;
  margin: 0 0 var(--s-3);
  padding: 4px;
  background: var(--ink-100);
  border-radius: var(--r-full);
}
.seg-btn {
  flex: 1;
  height: 36px;
  border: 0;
  border-radius: var(--r-full);
  background: transparent;
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 500;
  transition: background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard);
}
.seg-btn.on {
  background: var(--surface);
  color: var(--text-primary);
  font-weight: 600;
  box-shadow: var(--elev-1);
}
.months {
  padding-right: var(--page-x);
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 4px 0 2px;
  scrollbar-width: none;
  mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent);
  -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent);
}
/* 末尾留白：最后一颗胶囊不贴边、不被裁切 */
.months::after {
  content: "";
  flex: 0 0 var(--s-3);
}

.months::-webkit-scrollbar {
  display: none;
}
.m-chip {
  flex: none;
  height: 32px;
  padding: 0 14px;
  border-radius: var(--r-full);
  background: var(--bg-card);
  border: 1px solid var(--line-soft);
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 500;
}
.m-chip.on {
  background: var(--primary-600);
  border-color: var(--primary-600);
  color: #fff;
  font-weight: 600;
}

.sum {
  display: flex;
  align-items: center;
  margin-top: 12px;
  padding: 16px 8px;
  border-radius: var(--r-lg);
  background: var(--bg-card);
  border: 1px solid var(--line-soft);
}
.sum-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.sum-div {
  width: 1px;
  height: 28px;
  background: var(--line-soft);
}
.sum-col .k {
  font-size: 11px;
  color: var(--text-tertiary);
}
.sum-col .v {
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums;
  font-size: 17px;
  font-weight: 600;
}
.v-total {
  font-size: var(--fs-body-s);
  font-weight: 500;
  color: var(--text-tertiary);
}

.sum-col .v.out {
  color: var(--text-primary);
}
.sum-col .v.inc {
  color: var(--success-600);
}
.sum-note {
  margin: 8px 2px 0;
}

.groups {
  margin-top: 12px;
}
.group + .group {
  margin-top: 20px;
}
.g-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 0 4px 8px;
  font-size: 13px;
  color: var(--text-secondary);
  font-weight: 500;
}
.g-sum {
  font-size: 12px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}
.tx-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 68px;
  padding: 12px 16px;
}
/* 账单行图标比全局 icon-box 大一档，跟原版密度对齐 */
.tx-row .icon-box {
  width: 44px;
  height: 44px;
  border-radius: 14px;
}
.tx-row + .tx-row {
  border-top: 1px solid var(--line-soft);
}
.amt {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}
.amt .v {
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums;
  font-size: 17px;
  font-weight: 600;
}
.amt .v.inc {
  color: var(--success-600);
}
.amt .b {
  font-size: 11px;
  color: var(--text-tertiary);
}


/* 顶栏右侧两个按钮并排（.icon-btn 自带的 -10px 右外边距只在最右那个保留，否则会叠在一起） */
.acts {
  display: flex;
  align-items: center;
  margin-left: auto;
}
.acts .icon-btn {
  margin-right: 0;
}
.acts .icon-btn:last-child {
  margin-right: -10px;
}

.day-hit > .g-head {
  color: var(--primary-600);
}
.day-hit > .g-head > span:first-child::after {
  content: "已定位";
  margin-left: 8px;
  padding: 1px 7px;
  border-radius: var(--r-full);
  background: var(--primary-50);
  font-size: 10px;
  font-weight: 600;
  color: var(--primary-600);
  vertical-align: 1px;
}

.loading {
  margin-top: 16px;
}
.sk-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 4px;
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
  width: 60px;
  height: 14px;
}
.load-more {
  margin-top: 20px;
}
</style>
