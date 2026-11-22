<script setup lang="ts">
import { onUnmounted, watch } from "vue";

const props = defineProps<{ open: boolean; title?: string }>();
const emit = defineEmits<{ close: [] }>();

/**
 * 打开面板时往 history 里压一条假记录，让 Android 返回键先命中 popstate 关掉面板，
 * 而不是直接 goBack 到桌面。用户点 × / 点遮罩关闭时，再把这条假记录 back 掉。
 */
let pushed = false;
/** 打开前的滚动位置：history.back() 会把 WebView 滚回顶部，关闭后要还原 */
let savedY = 0;

function onPop() {
  if (!pushed) return;
  pushed = false;
  emit("close");
}

function requestClose() {
  if (pushed) {
    pushed = false;
    history.back();
  }
  emit("close");
}

watch(
  () => props.open,
  (v) => {
    // 不用 body overflow 锁滚动：Android WebView 里改这个会把页面滚回顶部，
    // 关闭时看起来像刷新过。滚动由遮罩上的 touchmove.prevent 拦住。
    if (v && !pushed) {
      savedY = window.scrollY;
      history.pushState({ sheet: 1 }, "");
      pushed = true;
      window.addEventListener("popstate", onPop);
    } else if (!v) {
      window.removeEventListener("popstate", onPop);
      const y = savedY;
      requestAnimationFrame(() => window.scrollTo(0, y));
      setTimeout(() => window.scrollTo(0, y), 60);
    }
  }
);

onUnmounted(() => window.removeEventListener("popstate", onPop));
</script>

<template>
  <teleport to="#app">
    <transition name="sheet">
      <div v-if="open" class="sheet-wrap" @click.self="requestClose" @touchmove.self.prevent>
        <div class="sheet" role="dialog" aria-modal="true">
          <div class="handle" aria-hidden="true"></div>
          <header v-if="title" class="sheet-head">
            <h3 class="t-h3">{{ title }}</h3>
            <button class="close" @click="requestClose" aria-label="关闭">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </header>
          <button v-else class="close close-float" @click="requestClose" aria-label="关闭">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
          <div class="sheet-body">
            <slot />
          </div>
        </div>
      </div>
    </transition>
  </teleport>
</template>

<style scoped>
.sheet-wrap {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(15, 23, 32, 0.42);
  backdrop-filter: blur(2px);
}
.sheet {
  position: relative;
  width: 100%;
  max-width: var(--max-w);
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-card);
  border-radius: var(--r-xl) var(--r-xl) 0 0;
  padding-bottom: var(--safe-b);
  box-shadow: var(--elev-3);
}
.handle {
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: var(--line);
  margin: 8px auto 4px;
  flex: none;
}
.sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px var(--page-x) 4px;
  flex: none;
}
.close {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: var(--r-full);
  color: var(--text-secondary);
}
.close:active {
  background: var(--bg-hover);
}
/* 无标题时关闭按钮浮在右上角 */
.close-float {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 2;
}
.sheet-body {
  overflow-y: auto;
  padding: 8px var(--page-x) 20px;
  -webkit-overflow-scrolling: touch;
}
.sheet-enter-active,
.sheet-leave-active {
  transition: opacity var(--dur-base) var(--ease-standard);
}
.sheet-enter-active .sheet,
.sheet-leave-active .sheet {
  transition: transform var(--dur-emphasized) var(--ease-emphasized);
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-from .sheet,
.sheet-leave-to .sheet {
  transform: translateY(14px);
}
</style>
