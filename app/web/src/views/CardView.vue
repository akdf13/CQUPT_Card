<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import Icon from "../components/Icon.vue";
import { Api } from "../api";
import { state, refreshBalance, toast, toastError, money, moneyOrDash } from "../store";

const router = useRouter();
const card = ref<any>(null);
const loading = ref(true);

const busy = ref(false);

const info = computed(() => card.value?.item ?? null);
const cardNo = computed(() => String(info.value?.cardid ?? ""));
const cardNoText = computed(() => cardNo.value || "----");
const statusText = computed(() => info.value?.cardstatusStr || "未知");
const isLost = computed(() => Number(info.value?.cardstatusid) === 4);

async function load() {
  loading.value = true;
  try {
    const r = await Api.card();
    card.value = r;
  } catch (e) {
    toastError(e);
  } finally {
    loading.value = false;
    refreshBalance(true).catch(() => {});
  }
}



async function toggleLost() {
  const target = !isLost.value;
  const msg = target
    ? "挂失后该卡将立即停止消费与洗澡功能，确认挂失？"
    : "确认解除挂失，恢复用卡？";
  if (!confirm(msg)) return;
  busy.value = true;
  try {
    await Api.reportCard(target);
    toast(target ? "已挂失" : "已解挂", "success");
    await load();
  } catch (e) {
    toastError(e);
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="page cardpage">
    <header class="appbar">
      <button class="nav-btn" @click="router.back()" aria-label="返回">
        <Icon name="chevron-right" :size="22" style="transform: rotate(180deg)" />
      </button>
      <h1 class="t-h3">我的校园卡</h1>
      <span style="width: 44px"></span>
    </header>

    <!-- 卡面 -->
    <section class="face" :class="{ lost: isLost }">
      <div class="face-top">
        <span class="face-brand">重庆邮电大学</span>
        <span class="face-badge" :class="{ lost: isLost }">
          {{ loading ? "…" : statusText }}
        </span>
      </div>
      <div class="face-mid">
        <span class="face-chip" aria-hidden="true"></span>
        <span class="face-no mono">{{ cardNoText }}</span>
      </div>
      <div class="face-bot">
        <span class="face-name">{{ state.user?.name || "—" }}</span>
        <span class="face-bal mono">¥{{ moneyOrDash(state.balance?.accountAmount0) }}</span>
      </div>
      <div class="face-glow" aria-hidden="true"></div>
    </section>

    <!-- 信息 -->
    <section class="card info">
      <div class="irow">
        <span class="k">姓名</span>
        <span class="v">{{ state.user?.name || "—" }}</span>
      </div>
      <div class="irow">
        <span class="k">学号 / 工号</span>
        <span class="v mono">{{ state.user?.userno || "—" }}</span>
      </div>
      <div class="irow">
        <span class="k">卡号</span>
        <span class="v mono">{{ cardNo || "—" }}</span>
      </div>
      <div class="irow">
        <span class="k">卡状态</span>
        <span class="v" :class="isLost ? 't-danger' : 't-success'">{{ statusText }}</span>
      </div>
      <div class="irow">
        <span class="k">账户状态</span>
        <span class="v">{{ state.balance?.accountStatusStr || "—" }}</span>
      </div>
      <div class="irow">
        <span class="k">电子账户</span>
        <span class="v mono">{{ state.user?.eaccountid || "—" }}</span>
      </div>
    </section>

    <!-- 操作 -->
    <section class="section">
      <button class="btn btn-lg btn-block danger" :class="isLost ? 'btn-outline' : 'btn-danger-outline'" style="margin-top: 4px" :disabled="busy" @click="toggleLost">
        <Icon :name="isLost ? 'check' : 'lock'" :size="18" />
        {{ busy ? "处理中…" : isLost ? "解除挂失" : "挂失此卡" }}
      </button>
      <p class="t-body-s t3 note">
        挂失即时生效，实体卡与虚拟卡同时停用；解挂后需重新刷卡激活。
      </p>
    </section>
  </div>
</template>

<style scoped>
.cardpage {
  padding-top: calc(var(--safe-t) + 8px);
  padding-bottom: calc(var(--tabbar-h) + var(--safe-b) + 24px);
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

.face {
  position: relative;
  margin-top: 4px;
  aspect-ratio: 1.9 / 1;
  border-radius: var(--r-lg);
  padding: 18px 20px;
  background: linear-gradient(135deg, #12304f, #0d1f33 62%, #164bc4 160%);
  color: #fff;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  overflow: hidden;
  isolation: isolate;
  box-shadow: var(--elev-2);
}
.face.lost {
  filter: grayscale(0.7);
  opacity: 0.86;
}
.face-glow {
  position: absolute;
  width: 260px;
  height: 260px;
  right: -90px;
  bottom: -140px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.2), transparent 66%);
  z-index: -1;
}
.face-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.face-brand {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.04em;
  opacity: 0.94;
}
.face-badge {
  height: 22px;
  padding: 0 9px;
  display: inline-flex;
  align-items: center;
  border-radius: var(--r-full);
  background: rgba(255, 255, 255, 0.18);
  font-size: 11px;
  font-weight: 600;
}
.face-badge.lost {
  background: rgba(192, 39, 30, 0.85);
}
.face-mid {
  display: flex;
  align-items: center;
  gap: 8px;
}
.face-chip {
  width: 26px;
  height: 20px;
  border-radius: 4px;
  background: linear-gradient(135deg, #e8c98a, #b8934e);
  flex: none;
}
.face-no {
  font-size: 17px;
  font-weight: 600;
  letter-spacing: 0.12em;
}
.face-bot {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
}
.face-name {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.06em;
}
.face-bal {
  font-size: 15px;
  font-weight: 600;
  opacity: 0.94;
}

.info {
  margin-top: var(--gap-card);
}
.irow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 44px;
}
.irow + .irow {
  border-top: 1px solid var(--line-soft);
}
.irow .k {
  font-size: 13px;
  color: var(--text-secondary);
}
.irow .v {
  font-size: 14px;
  font-weight: 500;
}
.danger {
  margin-top: 20px;
}
.note {
  margin-top: 10px;
  text-align: center;
  line-height: 18px;
}
</style>
