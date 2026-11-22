<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import Icon from "../components/Icon.vue";
import { Api } from "../api";
import { toastError } from "../store";

const route = useRoute();
const router = useRouter();
const list = ref<{ ID: string; TITLE: string; MODIFYTIME: string }[]>([]);
const loading = ref(true);
const active = ref<string | null>(null);

const detail = ref<{ id: string; title: string; time: string; text: string } | null>(null);
/** 正文按空行切段，段内保留换行；避免一大片 pre-wrap 出现夸张行距 */
const paras = computed(() =>
  (detail.value?.text || "")
    .split(/\n{2,}/)
    .map((s) => s.replace(/[\u00a0\u3000]/g, " ").trim())
    .filter(Boolean),
);
const detailLoading = ref(false);
const detailErr = ref<string | null>(null);

async function loadDetail(id: string) {
  detailLoading.value = true;
  detailErr.value = null;
  detail.value = null;
  try {
    detail.value = await Api.noticeInfo(id);
  } catch (e: any) {
    detailErr.value = e?.message || "公告正文加载失败";
  } finally {
    detailLoading.value = false;
  }
}

async function pick(id: string) {
  active.value = id;
  await loadDetail(id);
}

async function load() {
  loading.value = true;
  try {
    const r = await Api.notices();
    list.value = Array.isArray(r) ? r : ((r as any)?.item ?? []);
    const id = String(route.params.id || "");
    if (id && id !== "0") active.value = id;
    else if (list.value.length) active.value = list.value[0].ID;
    if (active.value) await loadDetail(active.value);
  } catch (e) {
    toastError(e);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="page notices">
    <header class="appbar">
      <button class="nav-btn" @click="router.push('/')" aria-label="返回">
        <Icon name="chevron-right" :size="22" style="transform: rotate(180deg)" />
      </button>
      <h1 class="t-h3">通知公告</h1>
      <span style="width: 44px"></span>
    </header>

    <div v-if="loading" class="card">
      <div v-for="i in 3" :key="i" class="sk" style="height: 18px; margin: 10px 0"></div>
    </div>

    <div v-else-if="!list.length" class="card empty">
      <p class="empty-title">暂无公告</p>
      <p class="t-body-s t3">学校发布的通知会出现在这里</p>
    </div>

    <template v-else>
      <div class="card card-tight divide">
        <button
          v-for="n in list"
          :key="n.ID"
          class="list-row"
          :class="{ on: active === n.ID }"
          @click="pick(n.ID)"
        >
          <span class="icon-box"><Icon name="bell" :size="19" /></span>
          <span class="grow">
            <span class="list-row-title ellipsis">{{ n.TITLE }}</span>
            <span class="list-row-sub">{{ n.MODIFYTIME }}</span>
          </span>
          <Icon name="chevron-right" :size="16" class="t3" />
        </button>
      </div>

      <section v-if="active" class="body card">
        <h2 class="t-h2">{{ detail?.title || list.find((n) => n.ID === active)?.TITLE }}</h2>
        <p class="t-body-s t3 time">
          {{ detail?.time || list.find((n) => n.ID === active)?.MODIFYTIME }}
        </p>

        <div v-if="detailLoading" class="content">
          <div
            v-for="i in 5"
            :key="i"
            class="sk"
            :style="{ height: '14px', margin: '12px 0', width: 55 + ((i * 13) % 40) + '%' }"
          ></div>
        </div>

        <div v-else-if="detailErr" class="content">
          <p class="t-body-s t2">{{ detailErr }}</p>
          <button class="btn btn-ghost retry" @click="loadDetail(active)">重新加载</button>
        </div>

        <div v-else-if="paras.length" class="content">
          <p v-for="(t, i) in paras" :key="i" class="para">{{ t }}</p>
        </div>

        <div v-else class="content">
          <p class="t-body-s t3">这条公告只有标题，学校没有填写正文内容。</p>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.notices {
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
.list-row.on {
  background: var(--primary-50);
}
.body {
  margin-top: var(--gap-card);
}
.time {
  margin-top: 6px;
}
.content {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-size: 14px;
  line-height: 23px;
  color: var(--text-secondary);
}
.content .para {
  white-space: pre-wrap;
  font-size: 15px;
  line-height: 1.7;
  color: var(--ink-700);
  word-break: break-word;
}
.content .para + .para {
  margin-top: 10px;
}
.content .para:first-child {
  margin-top: 4px;
}
.retry {
  margin-top: 12px;
  height: 40px;
  font-size: 14px;
}
</style>
