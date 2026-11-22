<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import QRCode from "qrcode";
import Icon from "../components/Icon.vue";
import { Api } from "../api";
import { state, toast, toastError, money, moneyOrDash, refreshBalance } from "../store";

const router = useRouter();
defineOptions({ name: "PayCodeView" });

const TTL = 60;
const code = ref("");
const qr = ref("");
const status = ref<"idle" | "loading" | "ready" | "waiting" | "success" | "expired" | "needpwd">("idle");
const left = ref(TTL);
const paid = ref<{ amount: number; value: number } | null>(null);
const pwd = ref("");
const pwdError = ref("");
const busy = ref(false);

let timer: number | undefined;
let poller: number | undefined;

const needPwd = computed(() => status.value === "needpwd");
const balanceText = computed(() => moneyOrDash(state.balance?.accountAmount0));

function clearTimers() {
  clearInterval(timer);
  clearInterval(poller);
  timer = undefined;
  poller = undefined;
}

async function renderCodes(text: string) {
  code.value = text;
  try {
    qr.value = await QRCode.toDataURL(text, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 720,
      color: { dark: "#0F1720", light: "#FFFFFF" },
    });
  } catch {
    qr.value = "";
  }

}

async function fetchCode() {
  status.value = "loading";
  clearTimers();
  try {
    const r = await Api.paycode();
    if (r.status === 0 && r.item && typeof r.item === "string") {
      await renderCodes(r.item);
      status.value = "waiting";
      left.value = TTL;
      startTimer();
      startPolling(r.item);
    } else {
      status.value = "needpwd";
    }
  } catch (e: any) {
    status.value = "expired";
    toastError(e);
  }
}

function startTimer() {
  timer = window.setInterval(() => {
    left.value -= 1;
    if (left.value <= 0) {
      clearTimers();
      status.value = "expired";
    }
  }, 1000);
}

function startPolling(qrcode: string) {
  poller = window.setInterval(async () => {
    try {
      const r = await Api.paycodeResult(qrcode);
      if (r.status === 0) {
        clearTimers();
        status.value = "success";
        paid.value = {
          amount: Number(r.item?.AMOUNT ?? r.item?.amount ?? 0),
          value: Number(r.item?.ACCOUNTVALUE ?? r.item?.accountvalue ?? 0),
        };
      } else if (r.status === 2) {
        clearTimers();
        status.value = "expired";
      }
    } catch {
      /* 忽略单次轮询失败 */
    }
  }, 3000);
}

async function submitPwd() {
  if (!/^\d{6}$/.test(pwd.value)) {
    pwdError.value = "请输入 6 位数字密码";
    return;
  }
  busy.value = true;
  pwdError.value = "";
  try {
    const r = await Api.checkPwd(pwd.value);
    if (r.ok) {
      pwd.value = "";
      await fetchCode();
    } else {
      pwdError.value = "密码不正确，请重试";
    }
  } catch (e: any) {
    pwdError.value = e?.message || "校验失败";
  } finally {
    busy.value = false;
  }
}

watch(status, (v) => {
  if (v === "expired") clearTimers();
});

onMounted(() => {
  refreshBalance(true).catch(() => {});
  fetchCode();
});

/**
 * 页面被 KeepAlive 留住，但**定时器不能留在后台空转**：
 * 离开时停掉倒计时与轮询，回来时先按真实经过时间扣减剩余秒数 ——
 * 短时间内离开就接着用这张码，超过有效期则重新取一张，绝不复用过期码。
 */
let paused = false;
let pausedAt = 0;

onDeactivated(() => {
  paused = true;
  pausedAt = Date.now();
  clearTimers();
});

onActivated(() => {
  if (!paused) return;
  paused = false;
  if (status.value === "waiting") {
    const gone = Math.floor((Date.now() - pausedAt) / 1000);
    left.value = Math.max(0, left.value - gone);
  }
  if (status.value === "waiting" && code.value && left.value > 3) {
    startTimer();
    startPolling(code.value);
  } else if (status.value === "waiting" || status.value === "loading") {
    fetchCode();
  }
});

onBeforeUnmount(clearTimers);
</script>

<template>
  <div class="paycode">
    <header class="appbar">
      <div class="brand">付款码</div>
      <button class="icon-btn" aria-label="关闭" @click="router.push('/')">
        <Icon name="x" :size="21" />
      </button>
    </header>

    <!-- 付款码面板：恒为白底黑码 -->
    <section class="panel">
      <div class="panel-head">
        <span class="ph-title">向收银员出示此码</span>
        <span class="ph-bal">余额 ¥{{ balanceText }}</span>
      </div>

      <div class="code-area">
        <!-- 需要密码 -->
        <div v-if="needPwd" class="pwd-box">
          <span class="lock-ico"><Icon name="lock" :size="22" /></span>
          <p class="t-h3">需要支付密码</p>
          <p class="t-body-s t3">该账户已开启消费密码校验</p>
          <input
            v-model="pwd"
            class="input pwd-input mono"
            type="password"
            inputmode="numeric"
            maxlength="6"
            placeholder="6 位密码"
            @keyup.enter="submitPwd"
          />
          <p v-if="pwdError" class="pwd-err">{{ pwdError }}</p>
          <button class="btn btn-primary btn-block" :disabled="busy" @click="submitPwd">
            {{ busy ? "校验中…" : "确认" }}
          </button>
        </div>

        <!-- 成功 -->
        <div v-else-if="status === 'success'" class="ok-box">
          <span class="ok-ico"><Icon name="check" :size="30" :stroke="2.6" /></span>
          <p class="t-h2">支付成功</p>
          <p class="ok-amt mono">¥{{ (paid?.amount ?? 0).toFixed(2) }}</p>
          <p class="t-body-s t3">余额 ¥{{ (paid?.value ?? 0).toFixed(2) }}</p>
          <button class="btn btn-ghost btn-block" style="margin-top: 16px" @click="fetchCode">再出示一次</button>
        </div>

        <!-- 过期 -->
        <div v-else-if="status === 'expired'" class="ok-box">
          <span class="exp-ico"><Icon name="clock" :size="26" /></span>
          <p class="t-h3">二维码已过期</p>
          <p class="t-body-s t3">为安全起见，付款码 60 秒自动失效</p>
          <button class="btn btn-primary btn-block" style="margin-top: 16px" @click="fetchCode">刷新付款码</button>
        </div>

        <!-- 正常 -->
        <div v-else class="codes">
          <div class="qr-wrap" :class="{ dim: status === 'loading' }">
            <img v-if="qr" :src="qr" alt="付款二维码" class="qr" />
            <div v-else class="sk qr-sk"></div>
          </div>

          <div class="countdown">
            <span class="bar"><i :style="{ width: (left / TTL) * 100 + '%' }"></i></span>
            <span class="t-body-s t3">{{ left }}s 后自动刷新</span>
          </div>
        </div>
      </div>
    </section>

    <div class="tips card">
      <p><Icon name="info" :size="14" /> 付款码仅用于校内消费，请勿截图或转发给他人</p>
      <p><Icon name="refresh" :size="14" /> 每 60 秒自动换码，付款后自动核对结果</p>
      <p><Icon name="wallet" :size="14" /> 余额不足时请先充值，或改用其他支付方式</p>
    </div>
  </div>
</template>

<style scoped>
.paycode {
  padding-top: calc(var(--safe-t) + 8px);
  padding-bottom: calc(var(--tabbar-h) + var(--safe-b) + 24px);
}
.appbar {
  height: var(--appbar-h);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--page-x);
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

.panel {
  margin: 4px var(--page-x) 0;
  border-radius: var(--r-lg);
  background: #fff;
  border: 1px solid var(--line-soft);
  overflow: hidden;
  box-shadow: var(--elev-2);
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid #edf1f5;
  color: #0f1720;
}
.ph-title {
  font-size: 13px;
  font-weight: 600;
}
.ph-bal {
  font-size: 12px;
  color: #5b6b7a;
  font-variant-numeric: tabular-nums;
}
.code-area {
  padding: 22px 18px 20px;
  display: flex;
  justify-content: center;
  min-height: 340px;
  align-items: center;
}
.codes {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.qr-wrap {
  padding: 10px;
  border-radius: 12px;
  background: #fff;
  transition: opacity var(--dur-fast) linear;
}
.qr-wrap.dim {
  opacity: 0.45;
}
.qr {
  display: block;
  width: 232px;
  height: 232px;
  image-rendering: pixelated;
}
.qr-sk {
  width: 232px;
  height: 232px;
}

.countdown {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.bar {
  width: 100%;
  height: 3px;
  border-radius: 2px;
  background: #edf1f5;
  overflow: hidden;
}
.bar i {
  display: block;
  height: 100%;
  background: var(--primary-600);
  transition: width 1s linear;
}

.pwd-box,
.ok-box {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  text-align: center;
  color: #0f1720;
  padding: 8px 4px;
}
.lock-ico,
.ok-ico,
.exp-ico {
  width: 54px;
  height: 54px;
  border-radius: 50%;
  display: grid;
  place-items: center;
}
.lock-ico {
  background: #eef4ff;
  color: #164bc4;
}
.ok-ico {
  background: #e8f6f0;
  color: #12855b;
}
.exp-ico {
  background: #fff4e5;
  color: #a85b00;
}
.pwd-input {
  width: 100%;
  max-width: 220px;
  margin-top: 8px;
  text-align: center;
  letter-spacing: 0.4em;
  font-size: 20px;
  color: #0f1720;
  background: #f6f8fa;
}
.pwd-err {
  font-size: 12px;
  color: #c0271e;
}
.ok-amt {
  font-size: 32px;
  font-weight: 700;
  color: #0f1720;
}

.tips {
  margin: 12px var(--page-x) 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.tips p {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 12px;
  line-height: 18px;
  color: var(--text-tertiary);
}
</style>
