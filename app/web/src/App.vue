<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import TabBar from "./components/TabBar.vue";
import ToastHost from "./components/ToastHost.vue";
import { isLoggedIn } from "./store";

const route = useRoute();
const showTab = computed(() => isLoggedIn.value && Boolean(route.meta.tab));

/**
 * 只缓存最常用的两个 tab 页：切回来是同一个组件实例，不再重新挂载、不再发首屏请求。
 * 付款码页有倒计时与轮询，缓存会让计时器在后台空转，所以不放进 include，保持每次新建。
 */
const KEEP = ["HomeView", "BillsView", "MeView", "PayCodeView"];

/** tab 之间切换不加过渡（瞬时），详情页进出才淡入淡出 */
const isTab = computed(() => Boolean(route.meta.tab));
</script>

<template>
  <div class="shell">
    <router-view v-slot="{ Component }">
      <transition :name="isTab ? 'tab' : 'fade'">
        <keep-alive :include="KEEP">
          <component :is="Component" />
        </keep-alive>
      </transition>
    </router-view>
    <TabBar v-if="showTab" :active="String(route.meta.tab || 'home')" />
    <ToastHost />
  </div>
</template>

<style scoped>
.shell {
  min-height: 100vh;
  background: var(--bg-page);
  display: flex;
  flex-direction: column;
}

/*
 * tab 切换：新页面淡入并轻微上移（240ms，ease-out），旧页面立即退场。
 * 旧页面不参与过渡是为了避免两张全屏页同时存在时的重影与滚动抖动；
 * 但新页面自己要有"出现"的过程，否则切换就是一帧突变，看着生硬。
 */
.tab-enter-active {
  transition:
    opacity var(--dur-base) var(--ease-standard),
    transform var(--dur-base) var(--ease-standard);
}
.tab-enter-from {
  opacity: 0;
  transform: translateY(6px);
}
.tab-leave-active {
  position: absolute;
  inset: 0;
  visibility: hidden;
  transition: none;
}

/* 详情页进出：短促交叉淡入 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity var(--dur-fast) linear;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .tab-enter-active,
  .fade-enter-active,
  .fade-leave-active {
    transition: none;
  }
}
</style>
