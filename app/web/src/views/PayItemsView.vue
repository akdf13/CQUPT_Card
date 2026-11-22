<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import Icon from "../components/Icon.vue";
import { Api } from "../api";
import { money, moneyOrDash, refreshBalance, toast, toastError, state } from "../store";

defineOptions({ name: "PayItemsView" });

type PayRow = {
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
};

const router = useRouter();
const rows = ref<PayRow[]>([]);
const page = ref(1);
const pageCount = ref(1);
const total = ref(0);
const loading = ref(true);
const loadingMore = ref(false);
const err = ref("");
const target = ref<PayRow | null>(null);
const paying = ref(false);

/** 电费预充值由「缴电费」页专门处理，这里只留报名费 / 工本费一类的应收单 */
const feeRows = computed(() => rows.value.filter((r) => !r.elec));
const pending = computed(() => feeRows.value.filter((r) => !r.done));
const done = computed(() => feeRows.value.filter((r) => r.done));
const hasMore = computed(() => page.value < pageCount.value && rows.value.length < total.value);
const balance = computed(() => state.balance?.accountAmount0 ?? null);

/** 上游项目名常常带 20250304 这种日期前缀，日期已经单独一行了，这里剥掉 */
function nameOf(r: PayRow) {
  const s = r.title.replace(/^\d{8}\s*/, "").trim();
  return s || r.title;
}
async function load(silent = false) {
  if (!silent) loading.value = true;
  err.value = "";
  try {
    const r = await Api.payments(1, 50, 1);
    rows.value = r.rows as PayRow[];
    page.value = 1;
    pageCount.value = r.pageCount || 1;
    total.value = r.total ?? rows.value.length;
  } catch (e) {
    err.value = e instanceof Error ? e.message : "读取缴费项目失败";
  } finally {
    loading.value = false;
  }
}

async function more() {
  if (loadingMore.value || !hasMore.value) return;
  loadingMore.value = true;
  try {
    const next = page.value + 1;
    const r = await Api.payments(next, 50, 1);
    rows.value = [...rows.value, ...(r.rows as PayRow[])];
    page.value = next;
    pageCount.value = r.pageCount || pageCount.value;
    total.value = r.total ?? total.value;
  } catch (e) {
    toastError(e);
  } finally {
    loadingMore.value = false;
  }
}

function ask(r: PayRow) {
  if (r.done) return;
  if (r.amount <= 0) {
    toast("这一项没有需要缴的金额", "info", 2400);
    return;
  }
  if (balance.value !== null && Number(balance.value) < r.amount) {
    toast(`卡内余额不足（当前 ¥${money(balance.value)}）`, "info", 2800);
    return;
  }
  target.value = r;
}

async function doPay() {
  if (!target.value || paying.value) return;
  paying.value = true;
  try {
    const r = await Api.payBill(target.value.id, target.value.amount);
    if (r.ok) {
      toast(`「${target.value.title}」缴费成功`, "success", 2600);
      target.value.done = true;
      target.value.status = "已缴清";
      target.value.paid = target.value.amount;
    } else {
      toast(r.message || "缴费未成功，请稍后再试", "error", 3000);
    }
    void refreshBalance(true);
  } catch (e) {
    toastError(e);
  } finally {
    paying.value = false;
    target.value = null;
  }
}

onMounted(() => {
  void load();
});
</script>

<template>
  <div class="page pays">
    <header class="appbar">
      <button class="icon-btn" aria-label="返回" @click="router.back()">
        <Icon name="chevron-left" :size="22" />
      </button>
      <div class="brand">其他缴费</div>
    </header>

    <div v-if="loading" class="sk-wrap">
      <div v-for="i in 4" :key="i" class="sk sk-row" />
    </div>

    <template v-else>
      <div v-if="err" class="err-card">
        <p class="err-title">读取失败</p>
        <p class="err-sub">{{ err }}</p>
        <button class="btn btn-sm" @click="load()">重试</button>
      </div>

      <template v-else>
        <section v-if="pending.length" class="section">
          <div class="section-head">
            <span class="t-h3">待缴</span>
            <span class="cnt">{{ pending.length }} 项</span>
          </div>
          <div class="card card-tight divide">
            <button v-for="r in pending" :key="r.id" class="list-row" @click="ask(r)">
              <span class="icon-box"><Icon name="receipt" :size="20" /></span>
              <span class="grow">
                <span class="list-row-title">{{ nameOf(r) }}</span>
                <span class="list-row-sub">{{ r.time }}</span>
              </span>
              <span class="amt">
                <span class="v mono">¥{{ money(r.amount) }}</span>
                <span class="st">{{ r.status || "待缴" }}</span>
              </span>
            </button>
          </div>
        </section>

        <section v-if="done.length" class="section">
          <div class="section-head">
            <span class="t-h3">已缴清</span>
            <span class="cnt">{{ done.length }} 项</span>
          </div>
          <div class="card card-tight divide">
            <div v-for="r in done" :key="r.id" class="list-row static">
              <span class="icon-box gray"><Icon name="receipt" :size="20" /></span>
              <span class="grow">
                <span class="list-row-title">{{ nameOf(r) }}</span>
                <span class="list-row-sub">{{ r.time }}</span>
              </span>
              <span class="amt">
                <span class="v mono muted">¥{{ money(r.amount) }}</span>
                <span class="st ok">{{ r.status || "已缴清" }}</span>
              </span>
            </div>
          </div>
        </section>

        <div v-if="!feeRows.length" class="empty">
          <p class="empty-title">没有查到应收单</p>
          <p class="empty-sub">学校开出新的报名费 / 工本费后，会出现在这里。</p>
        </div>

        <button v-if="hasMore" class="btn btn-ghost btn-block load-more" :disabled="loadingMore" @click="more">
          {{ loadingMore ? "加载中…" : `加载更多（已 ${rows.length} / 共 ${total} 条）` }}
        </button>
      </template>
    </template>

    <aside class="foot-note">
      <Icon name="info" :size="15" class="fn-ico" />
      <span>
        比赛 / 考试报名费、办卡工本费等由学校开出的应收单都会出现在这里，缴费从一卡通余额扣除；电费预充值请到「缴电费」。
      </span>
    </aside>

    <div v-if="target" class="dlg-mask" @click.self="target = null">
      <div class="dlg">
        <p class="dlg-title">确认缴费</p>
        <p class="dlg-body">
          从一卡通余额扣除 <b>¥{{ money(target.amount) }}</b> 缴纳「{{ target.title }}」
        </p>
        <p class="dlg-note">
          当前余额 ¥{{ moneyOrDash(balance) }}。缴费成功后可在「缴费记录」里核对。
        </p>
        <div class="dlg-acts">
          <button class="btn btn-ghost" @click="target = null">取消</button>
          <button class="btn" :disabled="paying" @click="doPay">{{ paying ? "缴费中…" : "确认缴费" }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pays {
  padding: 0 var(--page-x) calc(var(--tabbar-h) + var(--safe-b) + 20px);
}
.appbar {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 56px;
}
.brand {
  font-size: 20px;
  font-weight: 600;
  color: var(--ink-900);
}
.section {
  margin-top: var(--s-3);
}
.foot-note {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: var(--s-5);
  padding: 0 4px;
  font-size: var(--fs-body-s);
  line-height: 1.6;
  color: var(--text-tertiary);
}
.fn-ico {
  flex: none;
  margin-top: 2px;
}
.section-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0 4px 8px;
}
.cnt {
  font-size: var(--fs-body-s);
  color: var(--text-tertiary);
}
.list-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 68px;
  padding: 12px 4px;
  text-align: left;
  background: none;
  border: 0;
  font: inherit;
  color: inherit;
}
.list-row.static {
  cursor: default;
}
.grow {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.list-row-title {
  font-size: var(--fs-body);
  color: var(--ink-900);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.list-row-sub {
  font-size: var(--fs-body-s);
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.icon-box {
  flex: 0 0 auto;
  width: 44px;
  height: 44px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--primary-50);
  color: var(--primary-600);
}
.icon-box.gray {
  background: var(--bg-inset);
  color: var(--ink-400);
}
.amt {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
}
.amt .v {
  font-size: 17px;
  font-weight: 600;
  color: var(--ink-900);
  font-variant-numeric: tabular-nums;
}
.amt .v.muted {
  color: var(--ink-400);
  font-weight: 500;
}
.st {
  font-size: 11px;
  color: var(--warning-600);
}
.st.ok {
  color: var(--success-600);
}
.sk-wrap {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 8px 0;
}
.sk-row {
  height: 68px;
  border-radius: var(--r-md);
}
.load-more {
  margin-top: var(--s-4);
}
.err-card {
  margin-top: var(--s-3);
  padding: 16px;
  border-radius: var(--r-md);
  background: var(--danger-50);
}
.err-title {
  font-size: var(--fs-body);
  font-weight: 600;
  color: var(--danger-600);
}
.err-sub {
  margin: 4px 0 12px;
  font-size: var(--fs-body-s);
  color: var(--text-secondary);
  word-break: break-all;
}
.dlg-mask {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(15, 23, 32, 0.44);
  animation: fade-in 180ms var(--ease-standard);
}
.dlg {
  width: 100%;
  max-width: 320px;
  padding: 22px 20px 16px;
  border-radius: var(--r-lg);
  background: var(--bg-card);
  box-shadow: var(--elev-3);
  animation: pop 180ms var(--ease-standard);
}
.dlg-title {
  font-size: 17px;
  font-weight: 600;
  color: var(--ink-900);
}
.dlg-body {
  margin-top: 10px;
  font-size: var(--fs-body);
  line-height: 1.55;
  color: var(--text-secondary);
}
.dlg-body b {
  color: var(--ink-900);
}
.dlg-note {
  margin-top: 10px;
  font-size: var(--fs-body-s);
  color: var(--text-tertiary);
}
.dlg-acts {
  display: flex;
  gap: 10px;
  margin-top: 18px;
}
.dlg-acts .btn {
  flex: 1;
}
@keyframes fade-in {
  from {
    opacity: 0;
  }
}
@keyframes pop {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
}
@media (prefers-reduced-motion: reduce) {
  .dlg-mask,
  .dlg {
    animation: none;
  }
}
</style>
