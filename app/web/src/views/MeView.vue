<script setup lang="ts">
// 构建时注入（见 vite.config.ts 的 define）
const appVersion = __APP_VERSION__;
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import Icon from "../components/Icon.vue";
import Sheet from "../components/Sheet.vue";
import { Api } from "../api";
import { state, doLogout, refreshBalance, toast, toastError, money, moneyOrDash } from "../store";
import { badResponses, clearBadResponses } from "../core/upstream";

const router = useRouter();
defineOptions({ name: "MeView" });
const about = ref(false);
const busy = ref(false);
const pwdTip = ref(false);

const user = computed(() => state.user);
/** 余额来自 store，可能已经被首页刷新过；这里只做一次轻量校验 */
const balances = computed(() => state.balance);

const entries = [
  { label: "我的校园卡", sub: "卡号 · 卡状态 · 挂失", icon: "card", to: "/card" },
  { label: "交易流水", sub: "全部消费与充值记录", icon: "receipt", to: "/bills" },
  { label: "洗澡 / 开水", sub: "远程开阀与用水记录", icon: "droplet", to: "/water" },
  { label: "缴电费", sub: "宿舍电费充值", icon: "bolt", to: "/electric" },
  { label: "其他缴费", sub: "报名费 / 工本费等应收单", icon: "receipt", to: "/payitems" },
  { label: "支付绑定", sub: "微信 / 支付宝绑定状态", icon: "wallet", to: "/bind" },
];

const pwdOn = computed(() => {
  const v = String(balances.value?.consumptionopenpwd ?? "");
  return v === "1" || v.toLowerCase() === "true";
});

async function togglePwdCheck() {
  if (busy.value) return;
  const next = pwdOn.value ? 0 : 1;
  busy.value = true;
  try {
    await Api.setPwdCheck(next as 0 | 1);
    await refreshBalance(true);
    toast(next ? "已开启：出示付款码需验证密码" : "已关闭：付款码直接出示", "success");
  } catch (e) {
    toastError(e);
  } finally {
    busy.value = false;
  }
}

async function logout() {
  if (!confirm("确认退出登录？")) return;
  busy.value = true;
  await doLogout();
  busy.value = false;
  router.replace("/login");
}

async function copyQQ() {
  const qq = "2768703273";
  try {
    await navigator.clipboard.writeText(qq);
    toast("已复制 QQ：" + qq, "success");
  } catch {
    toast("QQ：" + qq);
  }
}

/** 点气泡以外的任何位置都关掉它（气泡与 ⓘ 用 closest 排除） */
function onDocDown(e: PointerEvent) {
  if (!pwdTip.value) return;
  const el = e.target as HTMLElement | null;
  if (el?.closest(".info-wrap")) return;
  pwdTip.value = false;
}

/** 「学校系统返回格式异常」的现场留档：有记录时在关于面板里露出，点一下就能复制给作者 */
const badLog = ref<ReturnType<typeof badResponses>>([]);

async function copyBadLog() {
  const text = JSON.stringify(badResponses(), null, 2);
  try {
    await navigator.clipboard.writeText(text);
    toast("已复制诊断信息，可发给作者", "success");
  } catch {
    toast("复制失败，请截图本页");
  }
}

async function clearLog() {
  clearBadResponses();
  badLog.value = [];
  toast("已清空诊断记录");
}

onMounted(() => {
  refreshBalance(true).catch(() => {});
  badLog.value = badResponses();
  document.addEventListener("pointerdown", onDocDown);
});
onUnmounted(() => document.removeEventListener("pointerdown", onDocDown));
</script>

<template>
  <div class="page me">
    <header class="appbar">
      <div class="brand">我的</div>
    </header>

    <!-- 用户卡 -->
    <section class="user-card">
      <div class="avatar">
        <img v-if="user?.avatar" :src="user.avatar" alt="" />
        <Icon v-else name="user" :size="26" class="avatar-ico" />
      </div>
      <div class="grow">
        <div class="u-name">{{ user?.name || "未登录" }}</div>
        <div class="u-sub mono">{{ user?.userno }}</div>
      </div>
      <div class="u-bal">
        <span class="k">余额</span>
        <span class="v mono">¥{{ moneyOrDash(balances?.accountAmount0) }}</span>
      </div>
    </section>

    <!-- 快捷 -->
    <section class="section">
      <div class="card card-tight divide">
        <button v-for="e in entries" :key="e.to" class="list-row" @click="router.push(e.to)">
          <span class="icon-box"><Icon :name="e.icon" :size="19" /></span>
          <span class="grow">
            <span class="list-row-title">{{ e.label }}</span>
            <span class="list-row-sub">{{ e.sub }}</span>
          </span>
          <Icon name="chevron-right" :size="16" class="t3" />
        </button>
      </div>
    </section>

    <!-- 设置 -->
    <section class="section">
      <div class="section-head"><h2 class="t-h3">其他</h2></div>
      <div class="card card-tight divide">
        <div class="list-row pwd-row">
          <span class="icon-box"><Icon name="key" :size="19" /></span>
          <span class="grow">
            <span class="list-row-title">消费密码校验</span>
            <span class="list-row-sub">{{ pwdOn ? "已开启：刷卡消费需验证密码" : "未开启：刷卡消费免密" }}</span>
          </span>
          <span class="info-wrap">
            <button class="info-btn" :class="{ on: pwdTip }" aria-label="说明" @click.stop="pwdTip = !pwdTip">
              <Icon name="info" :size="16" />
            </button>
            <span v-if="pwdTip" class="tip-pop" @click.stop>
              消费密码由校内消费终端校验，这里的开关改的是账户设置；付款码取码本身不会弹密码。
            </span>
          </span>
          <button class="btn btn-ghost btn-sm" :disabled="busy" @click="togglePwdCheck">{{ pwdOn ? "关闭" : "开启" }}</button>
        </div>
        <div class="list-row">
          <span class="icon-box"><Icon name="info" :size="19" /></span>
          <span class="grow">
            <span class="list-row-title">账户信息</span>
            <span class="list-row-sub mono">EMPID {{ user?.empid }} · EACCT {{ user?.eaccountid }}</span>
          </span>
        </div>
        <button class="list-row" @click="about = true">
          <span class="icon-box"><Icon name="help" :size="19" /></span>
          <span class="grow">
            <span class="list-row-title">关于本 App</span>
            <span class="list-row-sub">版本 {{ appVersion }} · 联系作者</span>
          </span>
          <Icon name="chevron-right" :size="16" class="t3" />
        </button>
      </div>
    </section>

    <button class="btn btn-outline btn-block logout" :disabled="busy" @click="logout">      <Icon name="logout" :size="18" />
      退出登录
    </button>


    <Sheet :open="about" @close="about = false">
      <div class="about">
        <div class="maker-head">
          <span class="maker-name">CQUPT_Card</span>
          <span class="maker-tag">重邮一卡通·第三方客户端</span>
          <span class="maker-ver">v{{ appVersion }}</span>
        </div>
        <p class="lede">更轻、更快的一卡通客户端：直连学校网关，不经过任何中间服务器。</p>
        <ul>
          <li><b>首屏即用</b>：余额与付款码同屏，少翻两层菜单。</li>
          <li><b>三槽记忆</b>：洗澡开水三个槽位各记设备号，切换只要一下。</li>
          <li><b>两本账</b>：一卡通消费与食堂扫码分开看，可跳到具体某一天。</li>
          <li><b>局部降级</b>：单个接口失败只影响那一块，不会整页白屏。</li>
        </ul>
        
        <div class="maker">
          <span class="maker-label">联系作者</span>
          <a class="maker-row" href="https://github.com/akdf13" target="_blank" rel="noreferrer noopener">
            <Icon name="external" :size="15" />
            <span>github.com/akdf13</span>
          </a>
          <button class="maker-row" @click="copyQQ">
            <Icon name="user" :size="15" />
            <span>QQ 2768703273</span>
          </button>
        </div>

        <div v-if="badLog.length" class="maker diag">
          <span class="maker-label">诊断（最近 {{ badLog.length }} 次异常响应）</span>
          <button class="maker-row" @click="copyBadLog">
            <Icon name="info" :size="15" />
            <span>复制给作者</span>
          </button>
          <button class="maker-row" @click="clearLog">
            <Icon name="x" :size="15" />
            <span>清空记录</span>
          </button>
        </div>
      </div>
    </Sheet>
  </div>
</template>

<style scoped>
.me {
  padding-bottom: calc(var(--tabbar-h) + var(--safe-b) + 40px);
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

.user-card {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 4px;
  padding: 18px;
  border-radius: var(--r-lg);
  background: var(--bg-card);
  border: 1px solid var(--line-soft);
}
.avatar {
  width: 54px;
  height: 54px;
  border-radius: 50%;
  background: var(--primary-50);
  color: var(--primary-700);
  display: grid;
  place-items: center;
  font-size: 22px;
  font-weight: 700;
  overflow: hidden;
  flex: none;
}
.avatar-ico {
  color: var(--text-tertiary);
}
.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.u-name {
  font-size: 18px;
  font-weight: 600;
  line-height: 26px;
}
.u-sub {
  font-size: 13px;
  color: var(--text-tertiary);
}
.u-bal {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}
.u-bal .k {
  font-size: 11px;
  color: var(--text-tertiary);
}
.u-bal .v {
  font-size: 17px;
  font-weight: 700;
}

.logout {
  margin-top: 28px;
  color: var(--danger-600);
  border-color: color-mix(in srgb, var(--danger-600) 32%, transparent);
}

.pwd-row {
  position: relative;
}
/* 点说明图标 / 气泡时，整行不要跟着出现按下的灰底，两者分开 */
.pwd-row:active {
  background: transparent;
}
.info-wrap {
  position: relative;
  flex: none;
  display: flex;
  align-items: center;
}
.info-btn {
  flex: none;
  width: 30px;
  height: 30px;
  margin-right: 2px;
  display: grid;
  place-items: center;
  border-radius: var(--r-full);
  color: var(--text-tertiary);
  -webkit-tap-highlight-color: transparent;
}
.info-btn.on {
  color: var(--primary-600);
  background: var(--primary-50);
}
.tip-pop {
  position: absolute;
  right: -2px;
  bottom: calc(100% + 10px);
  z-index: 30;
  width: 200px;
  padding: 10px 12px;
  border-radius: var(--r-md);
  background: var(--bg-card);
  border: 1px solid var(--line-soft);
  box-shadow: var(--elev-2);
  font-size: var(--fs-body-s);
  line-height: 1.55;
  color: var(--text-secondary);
  text-align: left;
  -webkit-tap-highlight-color: transparent;
  animation: tip-in 160ms var(--ease-standard);
}
/* 小尾巴指向 ⓘ，让气泡看起来是挂在这个图标上的 */
.tip-pop::after {
  content: "";
  position: absolute;
  right: 9px;
  bottom: -5px;
  width: 9px;
  height: 9px;
  background: var(--bg-card);
  border-right: 1px solid var(--line-soft);
  border-bottom: 1px solid var(--line-soft);
  transform: rotate(45deg);
}
@keyframes tip-in {
  from {
    opacity: 0;
    transform: translateY(3px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .tip-pop {
    animation: none;
  }
}
.ver {
  text-align: center;  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 20px;
}

.about p {
  margin-bottom: 12px;
}
.maker-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 14px;
  padding-right: 40px;
}
.maker-name {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.3px;
  color: var(--text-primary);
}
.maker-tag {
  font-size: 11px;
  color: var(--text-tertiary);
}
.maker-ver {
  margin-left: auto;
  font-size: 11px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  color: var(--text-tertiary);
}
.lede {
  font-size: 15px;
  line-height: 1.6;
  color: var(--text-primary);
  margin-bottom: 14px;
}
.maker {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--line-soft);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.maker-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-tertiary);
}
.maker-row {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  padding: 0 12px;
  border-radius: var(--r-sm);
  background: var(--bg-inset);
  font-size: 13px;
  color: var(--text-primary);
  text-align: left;
  width: 100%;
}
.maker-row:active {
  background: var(--bg-hover);
}
.maker-row :deep(svg) {
  color: var(--primary-600);
  flex: none;
}
.about ul {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}
.about li {
  font-size: 13px;
  line-height: 20px;
  color: var(--text-secondary);
  padding-left: 14px;
  position: relative;
}
.about li::before {
  content: "";
  position: absolute;
  left: 2px;
  top: 9px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--primary-600);
}
</style>
