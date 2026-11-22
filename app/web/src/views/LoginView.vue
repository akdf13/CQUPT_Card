<script setup lang="ts">
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import Icon from "../components/Icon.vue";
import { doLogin, toast } from "../store";

const router = useRouter();
const route = useRoute();

const userno = ref("");
const password = ref("");
const show = ref(false);
const busy = ref(false);
const err = ref("");

async function submit() {
  if (!userno.value.trim() || !password.value) {
    err.value = "请输入统一认证码和密码";
    return;
  }
  busy.value = true;
  err.value = "";
  try {
    await doLogin(userno.value.trim(), password.value);
    toast("登录成功", "success");
    const next = typeof route.query.next === "string" ? route.query.next : "/";
    router.replace(next);
  } catch (e: any) {
    err.value = e?.message || "登录失败，请检查账号密码";
  } finally {
    busy.value = false;
  }
}

</script>

<template>
  <div class="login">
    <div class="hero">
      <div class="hero-glow" aria-hidden="true"></div>
      <div class="logo">
        <Icon name="card" :size="26" :stroke="2" />
      </div>
      <h1 class="hero-title">重邮一卡通</h1>
      <p class="hero-sub">余额 · 付款码 · 洗澡开水 · 电费，一站完成</p>
    </div>

    <div class="form-wrap">
      <form class="card form" @submit.prevent="submit">
        <label class="field">
          <span class="field-label">统一认证码</span>
          <input
            v-model="userno"
            class="input"
            :class="{ 'input-error': err }"
            inputmode="numeric"
            autocomplete="username"
            placeholder="请输入统一认证码"
          />
        </label>

        <label class="field" style="margin-top: 14px">
          <span class="field-label">密码</span>
          <div class="pwd-wrap">
            <input
              v-model="password"
              class="input"
              :class="{ 'input-error': err }"
              :type="show ? 'text' : 'password'"
              autocomplete="current-password"
              placeholder="请输入密码"
            />
            <button type="button" class="eye" :aria-label="show ? '隐藏密码' : '显示密码'" @click="show = !show">
              <Icon :name="show ? 'eye-off' : 'eye'" :size="20" />
            </button>
          </div>
        </label>

        <p v-if="err" class="err">
          <Icon name="alert" :size="15" />
          {{ err }}
        </p>

        <button class="btn btn-primary btn-lg btn-block" style="margin-top: 20px" :disabled="busy" type="submit">
          {{ busy ? "登录中…" : "登录" }}
        </button>

      </form>

      <div class="notes">
        <p>
          <Icon name="lock" :size="14" />
          账号与密码仅保存在本机，用于会话过期后自动续期，不会上传到任何第三方服务器；数据实时来自学校一卡通网关。
        </p>
        <p>
          <Icon name="info" :size="14" />
          初始密码为身份证后六位，如需重置请前往自助机或卡务中心办理。
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  padding-top: var(--safe-t);
  background: var(--bg-page);
}
.hero {
  position: relative;
  padding: 56px var(--page-x) 40px;
  overflow: hidden;
  isolation: isolate;
}
.hero-glow {
  position: absolute;
  width: 280px;
  height: 280px;
  left: -70px;
  top: -120px;
  border-radius: 50%;
  background: radial-gradient(circle, color-mix(in srgb, var(--primary-600) 22%, transparent), transparent 70%);
  z-index: -1;
}
.logo {
  width: 52px;
  height: 52px;
  border-radius: var(--r-md);
  background: var(--primary-600);
  color: #fff;
  display: grid;
  place-items: center;
  box-shadow: var(--elev-2);
}
.hero-title {
  margin-top: 20px;
  font-size: 28px;
  line-height: 36px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.hero-sub {
  margin-top: 8px;
  font-size: 14px;
  line-height: 22px;
  color: var(--text-secondary);
}
.form-wrap {
  padding: 0 var(--page-x) calc(var(--safe-b) + 32px);
}
.form {
  padding: 20px;
  border-radius: var(--r-lg);
}
.pwd-wrap {
  position: relative;
}
.pwd-wrap .input {
  padding-right: 48px;
}
.eye {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  color: var(--text-tertiary);
  border-radius: var(--r-sm);
}
.eye:active {
  background: var(--bg-hover);
}
.err {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 14px;
  font-size: 13px;
  color: var(--danger-600);
}
.notes {
  margin-top: 24px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.notes p {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 12px;
  line-height: 18px;
  color: var(--text-tertiary);
}
</style>
