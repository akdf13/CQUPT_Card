<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import Icon from "../components/Icon.vue";
import { Api } from "../api";
import { toast, toastError } from "../store";

const router = useRouter();
defineOptions({ name: "BindView" });

type Slot = { bound: boolean; nickname: string; id: string };
const loading = ref(true);
const err = ref("");
const wechat = ref<Slot>({ bound: false, nickname: "", id: "" });
const alipay = ref<Slot>({ bound: false, nickname: "", id: "" });
const binding = ref(false);

async function load() {
  loading.value = true;
  err.value = "";
  try {
    const r = await Api.bind();
    wechat.value = r.wechat;
    alipay.value = r.alipay;
  } catch (e) {
    err.value = e instanceof Error ? e.message : "读取绑定状态失败";
  } finally {
    loading.value = false;
  }
}

/** 原生 AuthTask 桥（MainActivity.PayBridge.auth） */
type AuthBridge = { auth?: (authInfo: string) => void; hasAlipay?: () => boolean };
const bridge = () => (window as unknown as { AndroidPay?: AuthBridge }).AndroidPay;

function bindAlipay() {
  const b = bridge();
  const fn = b?.auth;
  if (!fn) {
    toast("支付宝绑定需在 APK 内完成；网页版请回原版 App 绑定", "info", 3600);
    return;
  }
  void (async () => {
    try {
      const { authInfo } = await Api.alipayAuth();
      binding.value = true;
      (window as unknown as { __alipayAuth?: (r: string) => void }).__alipayAuth = handleAuth;
      fn(authInfo);
    } catch (e) {
      binding.value = false;
      toastError(e);
    }
  })();
}

async function handleAuth(payload: string) {
  binding.value = false;
  let code = "";
  try {
    const o = JSON.parse(payload) as { code?: string; authCode?: string; status?: string; memo?: string };
    code = o.code || o.authCode || "";
    if (!code) {
      toast(`支付宝授权未完成${o.status ? `（${o.status}）` : ""}`, "info", 3000);
      return;
    }
  } catch {
    toast("支付宝授权返回内容无法解析", "info", 3000);
    return;
  }
  try {
    const r = await Api.alipayBind(code);
    if (r.ok) {
      toast(`已绑定支付宝${r.nickname ? `：${r.nickname}` : ""}`, "success", 3000);
      await load();
    } else {
      toast(r.message || "绑定失败", "info", 3600);
    }
  } catch (e) {
    toastError(e);
  }
}

onMounted(() => {
  (window as unknown as { __alipayAuth?: (r: string) => void }).__alipayAuth = handleAuth;
  void load();
});
</script>

<template>
  <div class="page bind">
    <header class="appbar">
      <button class="icon-btn" aria-label="返回" @click="router.back()">
        <Icon name="chevron-left" :size="22" />
      </button>
      <div class="brand">支付绑定</div>
    </header>

    <section v-if="loading" class="section">
      <div class="sk sk-line"></div>
    </section>
    <section v-else-if="err" class="section">
      <div class="card card-tight err-card">
        <p class="err">{{ err }}</p>
        <button class="btn btn-ghost btn-sm" @click="load">重试</button>
      </div>
    </section>

    <section v-else class="section">
      <div class="card card-tight divide">
        <div class="list-row">
          <span class="icon-box"><Icon name="wallet" :size="19" /></span>
          <span class="grow">
            <span class="list-row-title">微信</span>
            <span class="list-row-sub">
              {{ wechat.bound ? `已绑定${wechat.nickname ? "：" + wechat.nickname : ""}` : "未绑定" }}
            </span>
          </span>
          <span class="chip" :class="wechat.bound ? 'chip-success' : ''">
            {{ wechat.bound ? "已绑定" : "未绑定" }}
          </span>
        </div>

        <div class="list-row">
          <span class="icon-box"><Icon name="wallet" :size="19" /></span>
          <span class="grow">
            <span class="list-row-title">支付宝</span>
            <span class="list-row-sub">
              {{ alipay.bound ? `已绑定${alipay.nickname ? "：" + alipay.nickname : ""}` : "未绑定" }}
            </span>
          </span>
          <button
            v-if="!alipay.bound"
            class="btn btn-ghost btn-sm"
            :disabled="binding"
            @click="bindAlipay"
          >
            {{ binding ? "授权中…" : "去绑定" }}
          </button>
          <span v-else class="chip chip-success">已绑定</span>
        </div>
      </div>
    </section>

    <aside class="foot-note">
      <Icon name="info" :size="15" class="fn-ico" />
      <span>
        本界面只显示绑定状态。微信换绑要拿公众号授权的 openid，只能在微信内或原版 App 完成；支付宝这一项可直接在上面的「去绑定」走官方授权。
      </span>
    </aside>
  </div>
</template>

<style scoped>
.bind {
  padding-bottom: calc(var(--safe-b) + 24px);
}
.tip {
  margin: 0;
  font-size: var(--fs-body-s);
  line-height: 1.6;
  color: var(--text-secondary);
}
.tip.dim {
  color: var(--text-tertiary);
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
.err-card {
  display: flex;
  align-items: center;
  gap: 12px;
}
.err {
  margin: 0;
  flex: 1;
  font-size: var(--fs-body-s);
  color: var(--danger-600);
}
.btn-sm {
  height: 32px;
  padding: 0 12px;
  font-size: var(--fs-body-s);
}
</style>
