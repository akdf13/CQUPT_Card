<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import Icon from "../components/Icon.vue";
import { Api, type Row } from "../api";
import { state, toast, toastError, money, moneyOrDash, refreshBalance, shortTime } from "../store";

const router = useRouter();

/* ---- 三个槽位：每个槽记住一个水控设备号 + 备注（宿舍通常三台水控来回切） ---- */
type Slot = { no: string; note: string };
const SLOTS_KEY = "cqupt.water.slots";
const ACTIVE_KEY = "cqupt.water.active";

function readSlots(): Slot[] {
  let out: Slot[] = [];
  try {
    const raw = localStorage.getItem(SLOTS_KEY);
    const arr = raw ? JSON.parse(raw) : null;
    if (Array.isArray(arr)) {
      out = arr.slice(0, 3).map((x: any) => ({ no: String(x?.no ?? ""), note: String(x?.note ?? "") }));
    }
  } catch {
    out = [];
  }
  while (out.length < 3) out.push({ no: "", note: "" });
  return out;
}
function readActive(): number {
  const n = Number(localStorage.getItem(ACTIVE_KEY));
  return Number.isInteger(n) && n >= 0 && n < 3 ? n : 0;
}

const slots = ref<Slot[]>(readSlots());
const active = ref(readActive());
const device = computed(() => slots.value[active.value]?.no ?? "");
const note = computed(() => slots.value[active.value]?.note ?? "");

const editing = ref(false);
const noInput = ref("");
const noteInput = ref("");
const busy = ref(false);
const phase = ref<"idle" | "opening" | "running" | "settling">("idle");
const ordersn = ref("");
const startedAt = ref(0);
const elapsed = ref(0);
let tick: number | undefined;

const pending = ref<any[]>([]);
const history = ref<Row[]>([]);
const historyPage = ref(1);
const historyPages = ref(1);
const historyLoading = ref(false);

const deviceValid = computed(() => /^\d{6,20}$/.test(device.value.trim()));
const balanceText = computed(() => moneyOrDash(state.balance?.accountAmount0));
const elapsedText = computed(() => {
  const s = Math.floor(elapsed.value / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
});

function startTick() {
  startedAt.value = Date.now();
  elapsed.value = 0;
  clearInterval(tick);
  tick = window.setInterval(() => {
    elapsed.value = Date.now() - startedAt.value;
  }, 500);
}
function stopTick() {
  clearInterval(tick);
  tick = undefined;
}

async function loadPending() {
  try {
    const r: any = await Api.waterOrders();
    const list = r?.item?.data;
    pending.value = Array.isArray(list) ? list : [];
  } catch {
    pending.value = [];
  }
}

async function loadHistory(page = 1) {
  historyLoading.value = true;
  try {
    const r = await Api.waterHistory(page, 10);
    history.value = page === 1 ? r.rows : [...history.value, ...r.rows];
    historyPage.value = r.current;
    historyPages.value = r.pages;
  } catch (e) {
    toastError(e);
  } finally {
    historyLoading.value = false;
  }
}

function persist() {
  try {
    localStorage.setItem(SLOTS_KEY, JSON.stringify(slots.value));
    localStorage.setItem(ACTIVE_KEY, String(active.value));
  } catch {
    /* 隐私模式写入失败不影响本次使用 */
  }
}
function useSlot(i: number) {
  if (i === active.value) return;
  if (phase.value === "running" || phase.value === "settling") {
    toast("先结束当前用水再切换槽位", "error");
    return;
  }
  active.value = i;
  editing.value = false;
  persist();
}
function startEdit() {
  noInput.value = slots.value[active.value]?.no ?? "";
  noteInput.value = slots.value[active.value]?.note ?? "";
  editing.value = true;
}
function saveSlot() {
  const v = noInput.value.trim();
  if (v && !/^\d{6,20}$/.test(v)) {
    toast("设备号应为 6–20 位数字", "error");
    return;
  }
  slots.value[active.value] = { no: v, note: noteInput.value.trim().slice(0, 24) };
  persist();
  editing.value = false;
  toast(v ? "槽 " + (active.value + 1) + " 已保存" : "已清空该槽", "success");
}

async function openValve() {
  if (!deviceValid.value) {
    toast("请先填写水控设备号", "error");
    editing.value = true;
    return;
  }
  busy.value = true;
  phase.value = "opening";
  try {
    const r = await Api.openWater(device.value.trim());
    ordersn.value = r.ordersn;
    phase.value = "running";
    startTick();
    toast("已开阀，正在出水", "success");
    loadPending();
  } catch (e) {
    phase.value = "idle";
    toastError(e);
  } finally {
    busy.value = false;
  }
}

async function settle() {
  if (!ordersn.value) return;
  busy.value = true;
  phase.value = "settling";
  try {
    await Api.settleWater(ordersn.value);
    toast("已结算，用水结束", "success");
    phase.value = "idle";
    ordersn.value = "";
    stopTick();
    loadPending();
    loadHistory(1);
    refreshBalance(true).catch(() => {});
  } catch (e) {
    phase.value = "running";
    toastError(e);
  } finally {
    busy.value = false;
  }
}

async function settlePending(row: any) {
  const sn = row.ordersn || row.ORDERSN || row.orderno || row.id;
  if (!sn) {
    toast("该订单缺少订单号", "error");
    return;
  }
  busy.value = true;
  try {
    await Api.settleWater(String(sn));
    toast("结算成功", "success");
    await loadPending();
    loadHistory(1);
  } catch (e) {
    toastError(e);
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  refreshBalance(true).catch(() => {});
  loadPending();
  loadHistory(1);
});
onBeforeUnmount(stopTick);
</script>

<template>
  <div class="page water">
    <header class="appbar">
      <button class="nav-btn" @click="router.back()" aria-label="返回">
        <Icon name="chevron-right" :size="22" style="transform: rotate(180deg)" />
      </button>
      <h1 class="t-h3">洗澡 / 开水</h1>
      <span style="width: 44px"></span>
    </header>

    <!-- 槽位（宿舍三台水控来回切） -->
    <section class="dev card">
      <div class="slots">
        <button
          v-for="(sl, i) in slots"
          :key="i"
          class="slot"
          :class="{ on: active === i, filled: !!sl.no }"
          @click="useSlot(i)"
        >
          <span class="slot-i">槽 {{ i + 1 }}</span>
          <span class="slot-t ellipsis">{{ sl.note || (sl.no ? sl.no : "未设置") }}</span>
        </button>
      </div>

      <div class="row-between" style="margin-top: 14px">
        <div class="row gap-3" style="min-width: 0">
          <span class="dev-ico"><Icon name="droplet" :size="22" /></span>
          <div class="stack" style="min-width: 0">
            <span class="t-label t3">槽 {{ active + 1 }} · 水控设备号</span>
            <span class="dev-no mono ellipsis">{{ device || "未设置" }}</span>
            <span v-if="note && !editing" class="t-body-s t3 ellipsis">{{ note }}</span>
          </div>
        </div>
        <button class="btn btn-ghost btn-sm" @click="editing ? saveSlot() : startEdit()">
          {{ editing ? "保存" : device ? "修改" : "设置" }}
        </button>
      </div>

      <div v-if="editing" class="edit-row">
        <input
          v-model="noInput"
          class="input mono"
          inputmode="numeric"
          placeholder="水控设备号"
          maxlength="20"
        />
        <input v-model="noteInput" class="input" placeholder="备注：宿舍热水" maxlength="24" />
      </div>

      <div class="dev-meta">
        <span class="chip"><Icon name="wallet" :size="13" /> 卡内余额 ¥{{ balanceText }}</span>
        <span class="chip chip-primary">远程水控</span>
      </div>
    </section>

    <!-- 操作区 -->
    <section class="act card" :class="{ live: phase === 'running' }">
      <template v-if="phase === 'idle'">
        <p class="act-title">点一下，远程打开水阀</p>
        <p class="act-sub">不用再去浴室插卡，到点直接用；结束后在这里结算即可。</p>
        <button class="btn btn-primary btn-lg btn-block" :disabled="busy" @click="openValve">
          <Icon name="droplet" :size="20" />
          开阀用水
        </button>
      </template>

      <template v-else-if="phase === 'opening'">
        <div class="live-box">
          <span class="spinner"></span>
          <span class="t-h3">正在下发开阀指令…</span>
          <span class="t-body-s t3">通常 2–5 秒，请稍候</span>
        </div>
      </template>

      <template v-else>
        <div class="live-box">
          <span class="live-dot"></span>
          <span class="t-h3">正在出水</span>
          <span class="timer mono">{{ elapsedText }}</span>
          <span class="t-body-s t3">订单号 {{ ordersn }}</span>
        </div>
        <button class="btn btn-primary btn-lg btn-block" :disabled="busy" @click="settle">
          {{ phase === "settling" ? "结算中…" : "结束并结算" }}
        </button>
      </template>
    </section>

    <!-- 未结算 -->
    <section v-if="pending.length" class="section">
      <div class="section-head">
        <h2 class="t-h3">未结算订单</h2>
        <span class="chip chip-warning">{{ pending.length }} 笔</span>
      </div>
      <div class="card card-tight divide">
        <div v-for="(p, i) in pending" :key="i" class="pending-row">
          <div class="grow">
            <div class="list-row-title">
              {{ p.deviceno || p.DEVICENO || "水控设备" }}
            </div>
            <div class="list-row-sub">
              订单 {{ p.ordersn || p.ORDERSN || p.id }} · {{ p.createtime || p.CREATETIME || "" }}
            </div>
          </div>
          <button class="btn btn-outline btn-sm" :disabled="busy" @click="settlePending(p)">结算</button>
        </div>
      </div>
    </section>

    <!-- 历史 -->
    <section class="section">
      <div class="section-head">
        <h2 class="t-h3">用水记录</h2>
        <button class="btn-text" @click="loadHistory(1)">刷新</button>
      </div>
      <div v-if="historyLoading && !history.length" class="card">
        <div v-for="i in 3" :key="i" class="sk-row">
          <div class="sk sk-ico"></div>
          <div class="grow"><div class="sk sk-line" style="width: 50%"></div></div>
          <div class="sk sk-amt"></div>
        </div>
      </div>
      <div v-else-if="!history.length" class="card empty">
        <p class="empty-title">还没有用水记录</p>
        <p class="t-body-s t3">开阀用水后，这里会按次记录金额</p>
      </div>
      <div v-else class="card card-tight divide">
        <div v-for="r in history" :key="r.id" class="tx-row">
          <span class="icon-box"><Icon name="droplet" :size="19" /></span>
          <span class="grow">
            <span class="list-row-title ellipsis">{{ r.title }}</span>
            <span class="list-row-sub ellipsis">{{ shortTime(r.time) || r.scene }}</span>
          </span>
          <span class="amt">
            <span class="v">-¥{{ Math.abs(r.amount).toFixed(2) }}</span>
            <span class="b">余 {{ r.balance.toFixed(2) }}</span>
          </span>
        </div>
      </div>
      <button
        v-if="historyPage < historyPages"
        class="btn btn-ghost btn-block load-more"
        :disabled="historyLoading"
        @click="loadHistory(historyPage + 1)"
      >
        {{ historyLoading ? "加载中…" : "加载更多" }}
      </button>
    </section>
  </div>
</template>

<style scoped>
.water {
  padding-bottom: calc(var(--tabbar-h) + var(--safe-b) + 20px);
  padding-top: calc(var(--safe-t) + 8px);
}
.appbar {
  height: var(--appbar-h);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.nav-btn {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border-radius: var(--r-full);
  color: var(--text-primary);
  margin-left: -10px;
}
.nav-btn:active {
  background: var(--bg-hover);
}

.dev {
  margin-top: 4px;
}
.slots {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.slot {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  padding: 10px 12px;
  border-radius: var(--r-sm);
  border: 1px solid var(--line);
  background: var(--surface);
  text-align: left;
  min-width: 0;
  transition: border-color var(--dur-fast) var(--ease-standard), background var(--dur-fast) var(--ease-standard);
}
.slot-i {
  font-size: var(--fs-label);
  color: var(--text-tertiary);
}
.slot-t {
  font-size: var(--fs-body-s);
  font-weight: 600;
  color: var(--text-primary);
  max-width: 100%;
}
.slot.filled .slot-t {
  color: var(--text-primary);
}
.slot.on {
  border-color: var(--primary-600);
  background: var(--primary-50);
}
.slot.on .slot-i {
  color: var(--primary-600);
  font-weight: 600;
}
.slot:active {
  transform: scale(0.985);
}
.dev-ico {
  width: 44px;
  height: 44px;
  border-radius: var(--r-sm);
  display: grid;
  place-items: center;
  background: var(--primary-50);
  color: var(--primary-600);
}
.dev-no {
  font-size: 19px;
  font-weight: 600;
  letter-spacing: 0.04em;
}
.edit-row {
  margin-top: 14px;
}
/* 输入框本身 17px 偏大，编辑槽位时收一档；placeholder 再小一档，避免抢视线 */
.edit-row .input {
  height: 48px;
  font-size: var(--fs-body);
}
.edit-row .input + .input {
  margin-top: 8px;
}
.edit-row .input::placeholder {
  font-size: var(--fs-body-s);
  color: var(--text-tertiary);
}
.hint {
  margin-top: 8px;
}
.dev-meta {
  display: flex;
  gap: 8px;
  margin-top: 14px;
  flex-wrap: wrap;
}

.act {
  margin-top: var(--gap-card);
}
.act-title {
  font-size: 17px;
  font-weight: 600;
  line-height: 24px;
}
.act-sub {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 6px 0 16px;
  line-height: 20px;
}
.act.live {
  background: var(--primary-50);
  border-color: color-mix(in srgb, var(--primary-600) 20%, transparent);
}
.live-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 12px 0 18px;
  text-align: center;
}
.live-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--success-600);
  box-shadow: 0 0 0 0 color-mix(in srgb, var(--success-600) 60%, transparent);
  animation: pulse 1.8s ease-out infinite;
}
@keyframes pulse {
  0% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--success-600) 55%, transparent);
  }
  100% {
    box-shadow: 0 0 0 14px transparent;
  }
}
.spinner {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2.5px solid var(--line);
  border-top-color: var(--primary-600);
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.timer {
  font-size: 32px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--primary-700);
}

.pending-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
}
.tx-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 60px;
  padding: 10px 16px;
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
  font-size: 16px;
  font-weight: 600;
}
.amt .b {
  font-size: 11px;
  color: var(--text-tertiary);
}
.sk-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
}
.sk-ico {
  width: 40px;
  height: 40px;
  border-radius: var(--r-sm);
}
.sk-line {
  height: 12px;
}
.sk-amt {
  width: 60px;
  height: 14px;
}
.load-more {
  margin-top: 12px;
}
</style>
