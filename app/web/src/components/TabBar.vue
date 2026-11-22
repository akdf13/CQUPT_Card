<script setup lang="ts">
import { computed } from "vue";
import Icon from "./Icon.vue";

const props = defineProps<{ active: string }>();

const tabs = [
  { key: "home", label: "首页", icon: "home", to: "/" },
  { key: "bills", label: "账单", icon: "receipt", to: "/bills" },
  { key: "paycode", label: "付款码", icon: "qr", to: "/paycode" },
  { key: "me", label: "我的", icon: "user", to: "/me" },
];

/** 顶部指示条跟着选中项滑过去，而不是各跳各的 */
const idx = computed(() => {
  const i = tabs.findIndex((t) => t.key === props.active);
  return i < 0 ? 0 : i;
});
</script>

<template>
  <nav class="tabbar">
    <span class="ind" :style="{ transform: `translateX(${idx * 100}%)` }" aria-hidden="true" />
    <router-link
      v-for="t in tabs"
      :key="t.key"
      :to="t.to"
      class="tab"
      :class="{ on: active === t.key }"
      replace
    >
      <span class="ico">
        <Icon :name="t.icon" :size="23" :stroke="active === t.key ? 2.1 : 1.7" />
      </span>
      <span class="lab">{{ t.label }}</span>
    </router-link>
  </nav>
</template>

<style scoped>
.tabbar {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  bottom: 0;
  width: 100%;
  max-width: var(--max-w);
  height: calc(var(--tabbar-h) + var(--safe-b));
  padding-bottom: var(--safe-b);
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  background: color-mix(in srgb, var(--bg-card) 92%, transparent);
  backdrop-filter: saturate(180%) blur(16px);
  border-top: 1px solid var(--line-soft);
  z-index: 40;
}

/* 选中指示：一条会滑动的短线，比"整块变色"轻 */
.ind {
  position: absolute;
  top: 0;
  left: 0;
  width: 25%;
  height: 3px;
  display: flex;
  justify-content: center;
  transition: transform var(--dur-base) var(--ease-standard);
  will-change: transform;
}
.ind::after {
  content: "";
  width: 20px;
  height: 3px;
  border-radius: 0 0 3px 3px;
  background: var(--primary-600);
}

.tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  color: var(--text-tertiary);
  text-decoration: none;
  position: relative;
  -webkit-tap-highlight-color: transparent;
}
.ico {
  display: grid;
  place-items: center;
  height: 24px;
  transition:
    transform var(--dur-base) var(--ease-standard),
    color var(--dur-fast) linear;
}
.tab.on {
  color: var(--primary-600);
}
.tab.on .ico {
  transform: translateY(-1px) scale(1.07);
}
.tab:active .ico {
  transform: scale(0.92);
  transition-duration: var(--dur-instant);
}
.lab {
  font-size: 11px;
  line-height: 14px;
  font-weight: 500;
  transition: color var(--dur-fast) linear;
}
.tab.on .lab {
  font-weight: 600;
}

/* 尊重系统"减少动态效果" */
@media (prefers-reduced-motion: reduce) {
  .ind,
  .ico,
  .lab {
    transition: none;
  }
}
</style>