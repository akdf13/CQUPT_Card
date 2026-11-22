<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import Icon from "../components/Icon.vue";
import { Api } from "../api";
import { state, refreshBalance, toast, toastError, money } from "../store";

const router = useRouter();

const presets = [50, 100, 200, 300, 500];
const picked = ref<number | null>(200);
const custom = ref("");
const customMode = ref(false);
const channel = ref<"wechat" | "alipay">("alipay");

/** 微信渠道已确认走不通（appid 绑定学校原版 App 的包名+签名），点了只给提示，不生成订单 */
function pickChannel(c: "wechat" | "alipay") {
  if (c === "wechat") {
    toast("微信支付暂不可用，请回原版软件充值", "info", 3600);
    return;
  }
  channel.value = c;
}
const busy = ref(false);
const billLoading = ref(true);
const bills = ref<any[]>([]);

const amount = computed(() => {
  if (customMode.value) {
    const v = Number(custom.value);
    return Number.isFinite(v) && v > 0 ? v : 0;
  }
  return picked.value ?? 0;
});
const balanceNow = computed(() => state.balance?.accountAmount0 ?? 0);
const after = computed(() => (balanceNow.value + amount.value).toFixed(2));

async function loadBills() {
  billLoading.value = true;
  try {
    const r = await Api.payments(1, 20, 1);
    bills.value = (r.rows as any[]).filter((x) => !x.done).slice(0, 5);
  } catch {
    bills.value = [];
  } finally {
    billLoading.value = false;
  }
}

const lastOrder = ref<{
  channel: string;
  amount: string;
  scheme: string;
  no: string;
  note?: string;
  orderInfo?: string;
  /** 支付成功后置 true：状态标签从「待付款」变「已支付」，并收掉「再次唤起」按钮 */
  paid?: boolean;
} | null>(null);

/**
 * 统一处理支付宝回传结果。
 * 新版原生桥给的是 {status, memo, raw} 的 JSON；老版本桥只给 PayTask 原始串。
 * 两条路都在这里收敛，避免 payOnline 与 reopen 各写一套解析。
 */
function handlePayResult(payload: string) {
  let code = "";
  let memo = "";
  try {
    const o = JSON.parse(payload) as { status?: string; memo?: string; raw?: string };
    code = (o.status || "").trim();
    memo = (o.memo || "").trim();
    if (!code && o.raw) {
      const p = parsePayStatus(o.raw);
      code = p.code;
      memo = memo || p.memo;
    }
  } catch {
    const p = parsePayStatus(payload);
    code = p.code;
    memo = p.memo;
  }
  if (code === "9000") {
    toast("支付成功，余额稍后刷新", "success", 3600);
    refreshBalance(true).catch(() => null);
    if (lastOrder.value) {
      lastOrder.value.note = "支付成功，余额已刷新。";
      lastOrder.value.paid = true;
    }
  } else if (code === "6001") {
    toast("已取消支付", "info", 2600);
  } else {
    toast(`支付未完成（${code || "未知"}${memo ? "：" + memo : ""}）`, "error", 4200);
  }
}

function isMobile() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

/**
 * 支付宝 APP 支付参数 → 唤起支付宝客户端。
 *
 * 有原生桥时走官方 PayTask（APK 里 MainActivity 暴露了 window.AndroidPay），这是唯一可靠的路径。
 * 网页形态退化为 alipays:// scheme —— 注意这条只对"H5 支付"有效，
 * 把 APP 支付的 orderInfo 塞进 url 参数，支付宝起来后会静默退出（真机实测过），
 * 所以它只是兜底，不当作主路径。
 */
type AlipayBridge = { alipay: (orderInfo: string) => void; hasAlipay?: () => boolean };

function alipayBridge(): AlipayBridge | null {
  const b = (window as unknown as { AndroidPay?: AlipayBridge }).AndroidPay;
  return b && typeof b.alipay === "function" ? b : null;
}

function alipayScheme(orderInfo: string): string {
  return "alipays://platformapi/startapp?appId=20000067&url=" + encodeURIComponent(orderInfo);
}

/** 解析 PayTask 返回的 "resultStatus=9000;result={...};memo=" 串 */
function parsePayStatus(raw: string): { code: string; memo: string } {
  /*
   * 兼容两种返回格式：
   *   resultStatus={9000};memo={};result={...}   ← PayTask 老格式，值外面套花括号
   *   {"resultStatus":"9000","memo":""}          ← 新格式 JSON
   * 原来的 /resultStatus=(\d+)/ 碰上前者匹配不到数字，导致付成功也判成「未完成」。
   */
  const code = /resultStatus["']?\s*[=:]\s*["{]?(\d+)["}]?/.exec(raw)?.[1] ?? "";
  const memo = (/memo["']?\s*[=:]\s*["{]?([^"};]*)/.exec(raw)?.[1] ?? "").replace(/"/g, "");
  return { code: code.trim(), memo: memo.trim() };
}

async function payOnline() {
  if (amount.value <= 0) {
    toast("请选择或输入充值金额", "error");
    return;
  }
  if (channel.value === "wechat") {
    toast("微信支付暂不可用，请回原版软件充值", "info", 3600);
    return;
  }
  busy.value = true;
  try {
    const r = await Api.payOnline(channel.value, amount.value);
    const item = r.item;
    /*
     * 只剩支付宝一条通道。
     * 微信 APP 支付走不通的原因（已实测确认，不是没试）：
     *   ① 参数是 APP 支付（package=Sign=WXPay），塞进 weixin://wap/pay 这个 H5 通道必然验签失败；
     *   ② 微信开放平台校验发起方包名 + 签名，appid 绑的是学校原版 App 的证书（个人开发者证书，
     *      私钥不在我们手上），第三方客户端改包名也过不了；
     *   ③ startWeiXinRecharge 的 DESTINATION 试了 1–30，返回清一色 APP 支付参数，没有 H5/JSAPI 通道。
     * 所以微信选项在 UI 上做成不可用，只提示回原版软件充值。
     */
    if (typeof item === "string") {
      const scheme = alipayScheme(item);
      lastOrder.value = {
        channel: "支付宝",
        amount: r.amount,
        scheme,
        no: "",
        orderInfo: item,
        note: "订单 30 分钟内有效；付款成功后余额会在几秒内刷新。",
      };
      const bridge = alipayBridge();
      if (bridge) {
        /*
         * 原生桥：PayTask 会阻塞到用户付完/取消，结果通过 window.__alipayResult 回传。
         * 9000 成功 / 6001 用户取消 / 4000 失败 / 5000 重复请求 / 6002 网络异常。
         */
        (window as unknown as { __alipayResult?: (r: string) => void }).__alipayResult = handlePayResult;
        bridge.alipay(item);
        toast(`已唤起支付宝，请完成 ¥${r.amount} 付款`, "info", 3000);
      } else if (isMobile()) {
        location.href = scheme;
        setTimeout(() => {
          toast("没有跳到支付宝？点下方「再次唤起」，或到支付宝 App 的账单里继续付款", "error", 5200);
        }, 3000);
      } else {
        toast(`已生成 ¥${r.amount} 支付宝订单，请在手机上打开以完成付款`, "success", 4200);
      }
    } else if (channel.value === "alipay") {
      lastOrder.value = {
        channel: "支付宝",
        amount: r.amount,
        scheme: "",
        no: "",
        note: r.message || "订单已生成，但上游没有返回可唤起的支付参数。",
      };
      toast(r.message || "订单已生成", "info", 3600);
    } else {
      toast(r.message || "订单已生成", "info", 3600);
    }
  } catch (e) {
    toastError(e);
  } finally {
    busy.value = false;
  }
}

/**
 * 「再次唤起」。
 *
 * 关键：不能直接 `location.href = scheme` —— alipays:// 的 url 参数只吃 H5 支付页，
 * 塞 APP 支付的 orderInfo 会卡在支付宝加载页然后静默退出（真机实测）。
 * 这里优先用原生桥重放同一笔 orderInfo（同一 out_trade_no，30 分钟内有效），
 * 没有桥（网页形态）才退回 scheme。
 */
function reopen() {
  const o = lastOrder.value;
  if (!o) return;
  const bridge = alipayBridge();
  if (bridge && o.orderInfo) {
    (window as unknown as { __alipayResult?: (r: string) => void }).__alipayResult = handlePayResult;
    bridge.alipay(o.orderInfo);
    toast(`已重新唤起支付宝，请完成 ¥${o.amount} 付款`, "info", 3000);
    return;
  }
  if (o.scheme) location.href = o.scheme;
}

async function payBill(b: any) {
  if (!b.id) {
    toast("该账单缺少编号，无法支付", "error");
    return;
  }
  if (!confirm(`确认用卡内余额支付 ${b.title} ¥${b.amount.toFixed(2)}？`)) return;
  busy.value = true;
  try {
    const r = await Api.payBill(b.id, b.amount);
    if (r.ok) {
      toast("支付成功", "success");
      await refreshBalance(true).catch(() => {});
      await loadBills();
    } else {
      toast(r.message || "支付未成功，请稍后重试", "error", 3600);
    }
  } catch (e) {
    toastError(e);
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  refreshBalance(true).catch(() => {});
  loadBills();
});
</script>

<template>
  <div class="page recharge">
    <header class="appbar">
      <button class="nav-btn" @click="router.back()" aria-label="返回">
        <Icon name="chevron-right" :size="22" style="transform: rotate(180deg)" />
      </button>
      <h1 class="t-h3">充值</h1>
      <span style="width: 44px"></span>
    </header>

    <!-- 当前余额 -->
    <section class="bal-strip">
      <div class="stack">
        <span class="t-label t3">当前余额</span>
        <span class="t-h1 mono">¥{{ money(balanceNow) }}</span>
      </div>
      <div class="arrow"><Icon name="arrow-right" :size="18" /></div>
      <div class="stack" style="text-align: right">
        <span class="t-label t3">充值后</span>
        <span class="t-h1 mono tp">¥{{ after }}</span>
      </div>
    </section>

    <!-- 金额 -->
    <section class="section">
      <div class="section-head"><h2 class="t-h3">选择金额</h2></div>
      <div class="grid">
        <button
          v-for="p in presets"
          :key="p"
          class="amt-btn"
          :class="{ on: !customMode && picked === p }"
          @click="((picked = p), (customMode = false))"
        >
          <span class="v">{{ p }}</span>
          <span class="u">元</span>
        </button>
        <button class="amt-btn" :class="{ on: customMode }" @click="customMode = true">
          <span class="v" style="font-size: 15px">其他</span>
        </button>
      </div>
      <input
        v-if="customMode"
        v-model="custom"
        class="input mono"
        style="margin-top: 12px"
        inputmode="decimal"
        placeholder="输入金额，最多两位小数"
      />
    </section>

    <!-- 支付方式 -->
    <section class="section">
      <div class="section-head"><h2 class="t-h3">支付方式</h2></div>
      <div class="card card-tight divide">
        <button class="pay-row off" disabled @click="pickChannel('wechat')">
          <span class="pay-ico wechat"><Icon name="wallet" :size="19" /></span>
          <span class="grow">
            <span class="list-row-title">微信支付</span>
            <span class="list-row-sub">暂不可用，请回原版软件充值</span>
          </span>
          <span class="tag-off">不可用</span>
        </button>
        <button class="pay-row" :class="{ on: channel === 'alipay' }" @click="pickChannel('alipay')">
          <span class="pay-ico alipay"><Icon name="wallet" :size="19" /></span>
          <span class="grow">
            <span class="list-row-title">支付宝</span>
            <span class="list-row-sub">可直接唤起支付宝完成付款</span>
          </span>
          <span class="radio" :class="{ on: channel === 'alipay' }"></span>
        </button>
      </div>
      <div class="trust">
        <p><Icon name="lock" :size="13" /> 付款由学校网关向支付宝发起，本机不接触支付签名</p>
        <p><Icon name="check" :size="13" /> 充值到账后余额实时刷新，可在账单页核对</p>
        <p><Icon name="info" :size="13" /> 若未能唤起支付 App，订单仍有效，可到「重邮一卡通」原 App 继续付款</p>
      </div>
    </section>

    <!-- 已生成的支付订单 -->
    <section v-if="lastOrder" class="section">
      <div class="card order-card">
        <div class="row-between">
          <div class="stack">
            <span class="t-label t3">
              {{ lastOrder.paid ? "充值成功" : lastOrder.channel + "订单已生成" }}
            </span>
            <span class="t-h2">¥{{ lastOrder.amount }}</span>
          </div>
          <span class="chip" :class="lastOrder.paid ? 'chip-success' : 'chip-primary'">
            {{ lastOrder.paid ? "已支付" : "待付款" }}
          </span>
        </div>
        <p class="t-body-s t3 order-note">
          {{ lastOrder.note || "订单 30 分钟内有效；付款成功后余额会在几秒内刷新。" }}
        </p>
        <button
          v-if="lastOrder.scheme && !lastOrder.paid"
          class="btn btn-ghost btn-block"
          style="margin-top: 12px"
          @click="reopen"
        >
          再次唤起{{ lastOrder.channel }}
        </button>
      </div>
    </section>

    <!-- 待缴账单（可用卡内余额支付） -->
    <section class="section">
      <div class="section-head">
        <h2 class="t-h3">待缴账单</h2>
        <button class="btn-text" @click="loadBills">刷新</button>
      </div>
      <div v-if="billLoading" class="card"><div class="sk" style="height: 56px"></div></div>
      <div v-else-if="!bills.length" class="card empty">
        <p class="empty-title">没有待缴账单</p>
        <p class="t-body-s t3">电费、水费等应收单据会显示在这里</p>
      </div>
      <div v-else class="card card-tight divide">
        <div v-for="b in bills" :key="b.id" class="bill-row">
          <div class="grow">
            <div class="list-row-title">{{ b.title }}</div>
            <div class="list-row-sub">{{ b.room }} {{ b.time }}</div>
          </div>
          <div class="stack" style="align-items: flex-end">
            <span class="mono strong">¥{{ b.amount.toFixed(2) }}</span>
            <button class="btn-text" :disabled="busy" @click="payBill(b)">用卡余额支付</button>
          </div>
        </div>
      </div>
    </section>

    <div class="dock">
      <button class="btn btn-primary btn-lg btn-block" :disabled="amount <= 0 || busy" @click="payOnline">
        {{ busy ? "生成订单中…" : `充值 ¥${amount ? amount.toFixed(2) : "0.00"}` }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.order-card {
  border: 1px solid color-mix(in srgb, var(--primary-600) 22%, transparent);
}
.order-note {
  margin-top: 10px;
}
.recharge {
  padding-top: calc(var(--safe-t) + 8px);
  padding-bottom: calc(var(--tabbar-h) + var(--safe-b) + 168px);
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
  margin-left: -10px;
}
.nav-btn:active {
  background: var(--bg-hover);
}

.bal-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 20px;
  border-radius: var(--r-lg);
  background: var(--bg-card);
  border: 1px solid var(--line-soft);
  margin-top: 4px;
}
.arrow {
  color: var(--text-tertiary);
}

.grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.amt-btn {
  height: 62px;
  border-radius: var(--r-md);
  border: 1px solid var(--line);
  background: var(--bg-card);
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 2px;
  transition:
    border-color var(--dur-fast) linear,
    background var(--dur-fast) linear,
    transform var(--dur-instant) linear;
}
.amt-btn:active {
  transform: scale(0.98);
}
.amt-btn .v {
  font-family: var(--font-num);
  font-size: 22px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.amt-btn .u {
  font-size: 12px;
  color: var(--text-tertiary);
}
.amt-btn.on {
  border-color: var(--primary-600);
  background: var(--primary-50);
}
.amt-btn.on .v {
  color: var(--primary-700);
}

.pay-row.off {
  opacity: 0.62;
  cursor: default;
}
.pay-row.off .pay-ico { filter: grayscale(1); }
.tag-off {
  flex: none;
  padding: 3px 9px;
  border-radius: var(--r-full);
  background: var(--ink-100);
  color: var(--ink-500);
  font-size: 11px;
  font-weight: 500;
}.pay-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  width: 100%;
  text-align: left;
  background: var(--bg-card);
}
.pay-row:active {
  background: var(--bg-hover);
}
.pay-ico {
  width: 36px;
  height: 36px;
  border-radius: var(--r-sm);
  display: grid;
  place-items: center;
  flex: none;
}
.pay-ico.wechat {
  background: var(--success-50);
  color: var(--success-600);
}
.pay-ico.alipay {
  background: var(--primary-50);
  color: var(--primary-600);
}
.radio {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1.5px solid var(--line);
  flex: none;
  display: grid;
  place-items: center;
}
.radio.on {
  border-color: var(--primary-600);
  border-width: 6px;
}

.trust {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 2px;
}
.trust p {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  line-height: 18px;
  color: var(--text-tertiary);
}

.bill-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
}

.dock {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  bottom: 0;
  width: 100%;
  max-width: var(--max-w);
  padding: 12px var(--page-x) calc(var(--safe-b) + 16px);
  background: linear-gradient(to top, var(--bg-page) 62%, transparent);
  z-index: 30;
}
</style>
