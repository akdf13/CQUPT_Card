<script setup lang="ts">
import { toasts } from "../store";
import Icon from "./Icon.vue";
</script>

<template>
  <div class="toast-host">
    <transition-group name="toast">
      <div v-for="t in toasts" :key="t.id" class="toast" :class="t.type" role="status">
        <Icon
          :name="t.type === 'success' ? 'check' : t.type === 'error' ? 'alert' : 'info'"
          :size="17"
          :stroke="2.1"
        />
        <span>{{ t.text }}</span>
      </div>
    </transition-group>
  </div>
</template>

<style scoped>
.toast-host {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  bottom: calc(var(--tabbar-h) + var(--safe-b) + 24px);
  width: min(92vw, 400px);
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 90;
  pointer-events: none;
}
.toast {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px 16px;
  border-radius: var(--r-md);
  background: var(--ink-900);
  color: #fff;
  font-size: 14px;
  line-height: 20px;
  box-shadow: var(--elev-2);
}
.toast.success {
  background: var(--success-600);
}
.toast.error {
  background: var(--danger-600);
}
.toast-enter-active,
.toast-leave-active {
  transition:
    opacity var(--dur-base) var(--ease-standard),
    transform var(--dur-base) var(--ease-standard);
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
