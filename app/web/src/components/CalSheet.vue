<script setup lang="ts">
import { computed } from "vue";
import Sheet from "./Sheet.vue";
import Icon from "./Icon.vue";

const props = defineProps<{
  open: boolean;
  /** 当前显示的月份，形如 "2026-11" */
  month: string;
  /** 该月有记录的日期集合，形如 ["2026-11-20", ...] */
  days: string[];
  /** 正在拉该月的数据 */
  loading: boolean;
  /** 可选月份范围（含端点），形如 "2026-06" ~ "2026-11" */
  minMonth: string;
  maxMonth: string;
  /** 已选中的日期，用于高亮 */
  active?: string;
}>();

const emit = defineEmits<{
  close: [];
  pick: [ymd: string];
  monthChange: [key: string];
}>();

const WEEK = ["一", "二", "三", "四", "五", "六", "日"];

const todayYmd = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
})();

const has = computed(() => new Set(props.days));

const monthLabel = computed(() => {
  const [y, m] = props.month.split("-");
  return `${y} 年 ${Number(m)} 月`;
});

const canPrev = computed(() => props.month > props.minMonth);
const canNext = computed(() => props.month < props.maxMonth);

/** 周一为一周起点，前置空格补齐 */
const cells = computed(() => {
  const [y, m] = props.month.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const lead = (first.getDay() + 6) % 7;
  const count = new Date(y, m, 0).getDate();
  const out: { key: string; ymd: string | null; day: number }[] = [];
  for (let i = 0; i < lead; i++) out.push({ key: `lead-${i}`, ymd: null, day: 0 });
  for (let d = 1; d <= count; d++) {
    const ymd = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    out.push({ key: ymd, ymd, day: d });
  }
  return out;
});

const dayCount = computed(() => props.days.length);

function shift(step: number) {
  const [y, m] = props.month.split("-").map(Number);
  const d = new Date(y, m - 1 + step, 1);
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  if (key < props.minMonth || key > props.maxMonth) return;
  emit("monthChange", key);
}

function tap(cell: { ymd: string | null }) {
  if (!cell.ymd || !has.value.has(cell.ymd)) return;
  emit("pick", cell.ymd);
}

function toToday() {
  const key = todayYmd.slice(0, 7);
  if (key >= props.minMonth && key <= props.maxMonth && key !== props.month) {
    emit("monthChange", key);
    return;
  }
  if (has.value.has(todayYmd)) emit("pick", todayYmd);
}
</script>

<template>
  <Sheet :open="open" title="选择日期" @close="emit('close')">
    <div class="cal-top">
      <button class="cal-nav" :disabled="!canPrev" aria-label="上个月" @click="shift(-1)">
        <Icon name="chevron-right" :size="18" class="flip" />
      </button>
      <span class="cal-month">{{ monthLabel }}</span>
      <button class="cal-nav" :disabled="!canNext" aria-label="下个月" @click="shift(1)">
        <Icon name="chevron-right" :size="18" />
      </button>
    </div>

    <div class="cal-grid">
      <span v-for="w in WEEK" :key="w" class="cal-dow">{{ w }}</span>
      <span
        v-for="c in cells"
        :key="c.key"
        class="cal-cell"
        :class="{
          off: !c.ymd || !has.has(c.ymd),
          has: !!c.ymd && has.has(c.ymd),
          today: c.ymd === todayYmd,
          on: !!c.ymd && c.ymd === active,
        }"
        @click="tap(c)"
      >
        {{ c.day || "" }}
      </span>
    </div>

    <div class="cal-foot">
      <span v-if="loading" class="cal-note">正在统计有记录的日子…</span>
      <span v-else-if="dayCount" class="cal-note">本月有记录的日子 <b>{{ dayCount }}</b> 天，带圆点的可点</span>
      <span v-else class="cal-note">这个月还没有记录</span>
      <button class="cal-today" @click="toToday">回到今天</button>
    </div>
  </Sheet>
</template>

<style scoped>
.cal-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 0 0 10px;
}
.cal-month {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}
.cal-nav {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: var(--r-full);
  background: var(--ink-100);
  color: var(--text-secondary);
  cursor: pointer;
}
.cal-nav:disabled {
  opacity: 0.35;
}
.cal-nav:active:not(:disabled) {
  background: var(--ink-200);
}
.cal-nav .flip {
  transform: rotate(180deg);
}

.cal-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}
.cal-dow {
  height: 28px;
  display: grid;
  place-items: center;
  font-size: 11px;
  font-weight: 500;
  color: var(--ink-400);
}
.cal-cell {
  height: 46px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-radius: var(--r-sm);
  font-size: 15px;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
  cursor: default;
  user-select: none;
}
.cal-cell.has {
  font-weight: 600;
  cursor: pointer;
}
.cal-cell.has::after {
  content: "";
  width: 4px;
  height: 4px;
  margin-top: 3px;
  border-radius: 50%;
  background: var(--primary-600);
}
.cal-cell.off {
  color: var(--ink-300);
}
.cal-cell.today {
  box-shadow: inset 0 0 0 1.5px var(--primary-600);
}
.cal-cell.on {
  background: var(--primary-600);
  color: #fff;
}
.cal-cell.on::after {
  background: #fff;
}
.cal-cell.has:active:not(.on) {
  background: var(--primary-50);
}

.cal-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 14px;
}
.cal-note {
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-tertiary);
}
.cal-note b {
  color: var(--primary-600);
  font-variant-numeric: tabular-nums;
}
.cal-today {
  flex: none;
  height: 34px;
  padding: 0 14px;
  border: 0;
  border-radius: var(--r-full);
  background: var(--ink-100);
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}
.cal-today:active {
  background: var(--ink-200);
}
</style>
