<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import Icon from "../components/Icon.vue";
import Sheet from "../components/Sheet.vue";
import { Api } from "../api";
import { state, refreshBalance, toast, toastError, money, moneyOrDash } from "../store";

const router = useRouter();

type Building = { BUILDNO: string; BUILDNAME: string; CYBUILDNO: string };

const buildings = ref<Building[]>([]);
const floors = ref<{ FLOORNO: string }[]>([]);
const rooms = ref<{ ALLROOMNO: string; CYROOMNO: string; ROOMNO: string }[]>([]);

const build = ref<Building | null>(null);
const floor = ref<string>("");
const room = ref<{ ALLROOMNO: string; CYROOMNO: string } | null>(null);

const sheet = ref(false);
const search = ref("");
const loading = ref({ b: false, f: false, r: false, info: false });
const info = ref<any>(null);
/** 真正要扣的金额：自定义模式读输入框，否则读预设档 */
const amount = computed(() => {
  if (customMode.value) {
    const v = Number(custom.value);
    return Number.isFinite(v) && v > 0 ? v : 0;
  }
  return picked.value ?? 0;
});
const presets = [20, 50, 100, 200];
const picked = ref<number | null>(50);
const customMode = ref(false);
const custom = ref("");
const busy = ref(false);

/** 记住上次充值的房间：缴电费是高频重复动作，不应每次重选楼栋楼层 */
type LastRoom = { buildName: string; buildNo: string; floor: string; allRoomNo: string; cyRoom: string };
const lastRoom = ref<LastRoom | null>(readLast());
const LAST_KEY = "cqupt.room";
function readLast(): LastRoom | null {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    return raw ? (JSON.parse(raw) as LastRoom) : null;
  } catch {
    return null;
  }
}
function saveLast() {
  if (!build.value || !room.value) return;
  const v: LastRoom = {
    buildName: build.value.BUILDNAME,
    buildNo: build.value.BUILDNO,
    floor: floor.value,
    allRoomNo: room.value.ALLROOMNO,
    cyRoom: room.value.CYROOMNO,
  };
  lastRoom.value = v;
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(v));
  } catch {
    /* 隐私模式下写入失败不影响主流程 */
  }
}
async function useLastRoom() {
  const v = lastRoom.value;
  if (!v) return;
  if (!buildings.value.length) await loadBuildings();
  const b = buildings.value.find((x) => x.BUILDNO === v.buildNo);
  if (!b) {
    toast("上次的楼栋信息已失效，请重新选择", "error");
    return;
  }
  await pickBuilding(b);
  await pickFloor(v.floor);
  const target = rooms.value.find((x) => x.ALLROOMNO === v.allRoomNo);
  if (target) await pickRoom(target);
  else toast("上次的房间已不存在，请重新选择", "error");
}

const filtered = computed(() => {
  const q = search.value.trim();
  const list = buildings.value;
  if (!q) return list.slice(0, 200);
  return list.filter((b) => b.BUILDNAME.includes(q) || b.CYBUILDNO?.includes(q)).slice(0, 200);
});

/** 后端把电水读数塞在中文串里："电量103.51水量0.00"、"电价0.540水价3.500" */
function pickNum(text: unknown, label: string): number | null {
  const m = String(text ?? "").match(new RegExp(`${label}([\\d.]+)`));
  return m ? Number(m[1]) : null;
}
function pickTime(text: unknown, label: string): string {
  const m = String(text ?? "").match(new RegExp(`${label}([\\d/:\\s]+?)(?:水时间|$)`));
  return m ? m[1].trim() : "";
}

const elec = computed(() => {
  // 后端返回 { message, status, item:{...} }，而 Api 层已解到 data，item 可能已被取出
  const it = info.value?.item ?? info.value;
  if (!it || (!it.buildno && !it.amount && !it.newRoomNo)) return null;
  return {
    buildName: it.buildno || build.value?.BUILDNAME || "",
    roomNo: it.roomno || "",
    kwh: pickNum(it.amount, "电量"),
    water: pickNum(it.amount, "水量"),
    priceKwh: pickNum(it.price, "电价"),
    priceWater: pickNum(it.price, "水价"),
    feeElec: pickNum(it.totalValue, "电费"),
    feeWater: pickNum(it.totalValue, "水费"),
    startKwh: pickNum(it.start, "电起"),
    endKwh: pickNum(it.end, "电止"),
    subsidyElec: pickNum(it.subsidy, "电补"),
    subsidyWater: pickNum(it.subsidy, "水补"),
    balance: it.blanceValue === "" || it.blanceValue == null ? null : Number(it.blanceValue),
    recordTime: pickTime(it.recordTime, "电时间"),
    meterNo: it.newRoomNo || room.value?.ALLROOMNO || "",
  };
});

const stepText = computed(() => {
  if (!build.value) return "选择楼栋";
  if (!floor.value) return "选择楼层";
  if (!room.value) return "选择房间";
  return "确认并充值";
});

async function loadBuildings() {
  loading.value.b = true;
  try {
    const r = await Api.elecBuildings();
    // 上游有重复楼栋（同一个 BUILDNO 出现多次），按楼栋号去重
    const seen = new Set<string>();
    buildings.value = (r.item || []).filter((b) => {
      if (!b?.BUILDNO || seen.has(b.BUILDNO)) return false;
      seen.add(b.BUILDNO);
      return true;
    });
  } catch (e) {
    toastError(e);
  } finally {
    loading.value.b = false;
  }
}

async function pickBuilding(b: Building) {
  build.value = b;
  sheet.value = false;
  search.value = "";
  floor.value = "";
  room.value = null;
  info.value = null;
  rooms.value = [];
  loading.value.f = true;
  try {
    const r = await Api.elecFloors(b.BUILDNO);
    floors.value = (r.item || []).map((x: any) => ({ FLOORNO: x.FLOORNO }));
  } catch (e) {
    toastError(e);
    floors.value = [];
  } finally {
    loading.value.f = false;
  }
}

async function pickFloor(f: string) {
  floor.value = f;
  room.value = null;
  info.value = null;
  rooms.value = [];
  loading.value.r = true;
  try {
    const r = await Api.elecRooms(build.value!.BUILDNO, f);
    rooms.value = (r.item || []).map((x: any) => ({
      ALLROOMNO: x.ALLROOMNO,
      CYROOMNO: x.CYROOMNO,
      ROOMNO: x.ROOMNO,
    }));
  } catch (e) {
    toastError(e);
  } finally {
    loading.value.r = false;
  }
}

async function pickRoom(r: { ALLROOMNO: string; CYROOMNO: string }) {
  room.value = r;
  info.value = null;
  loading.value.info = true;
  try {
    const res = await Api.elecRoom(r.ALLROOMNO);
    info.value = res?.item ?? null;
    saveLast();
  } catch (e) {
    toastError(e);
  } finally {
    loading.value.info = false;
  }
}

/** 二次确认用自绘对话框，不用浏览器原生 confirm（系统白框跟整套设计语言完全不搭） */
const confirmOpen = ref(false);

function askRecharge() {
  if (!room.value || !info.value?.newRoomNo) {
    toast("请先选中房间", "error");
    return;
  }
  const bal = state.balance?.accountAmount0 ?? 0;
  if (amount.value > bal) {
    toast(`卡内余额不足（当前 ¥${bal.toFixed(2)}）`, "error");
    return;
  }
  if (amount.value <= 0) {
    toast("请输入充值金额", "error");
    return;
  }
  confirmOpen.value = true;
}

async function doRecharge() {
  confirmOpen.value = false;
  if (!room.value || !info.value?.newRoomNo) return;
  busy.value = true;
  try {
    await Api.elecRecharge(amount.value, info.value.newRoomNo);
    toast("电费充值成功", "success");
    await refreshBalance(true).catch(() => {});
    await pickRoom(room.value);
  } catch (e) {
    toastError(e);
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  loadBuildings();
  refreshBalance(true).catch(() => {});
});
</script>

<template>
  <div class="page elec">
    <header class="appbar">
      <button class="nav-btn" @click="router.back()" aria-label="返回">
        <Icon name="chevron-right" :size="22" style="transform: rotate(180deg)" />
      </button>
      <h1 class="t-h3">缴电费</h1>
      <span style="width: 44px"></span>
    </header>

    <!-- 上次用过的房间：一键复用 -->
    <section v-if="lastRoom && !room" class="card recall">
      <div class="row-between">
        <div class="stack">
          <span class="t-label t3">上次充值</span>
          <span class="t-h3">{{ lastRoom.buildName }} {{ lastRoom.cyRoom }}</span>
        </div>
        <button class="btn btn-primary btn-sm" @click="useLastRoom">继续充值</button>
      </div>
    </section>

    <!-- 步骤 -->
    <section class="steps card">
      <button class="step" @click="sheet = true">
        <span class="s-idx">1</span>
        <span class="s-body">
          <span class="s-label">楼栋</span>
          <span class="s-value" :class="{ ph: !build }">{{ build?.BUILDNAME || "点击选择" }}</span>
        </span>
        <Icon name="chevron-right" :size="16" class="t3" />
      </button>

      <div class="step-sep"></div>

      <div class="step static">
        <span class="s-idx">2</span>
        <span class="s-body">
          <span class="s-label">楼层</span>
          <span v-if="loading.f" class="sk" style="width: 90px; height: 18px"></span>
          <span v-else-if="!floors.length" class="s-value ph">
            {{ build ? "暂无楼层" : "先选楼栋" }}
          </span>
          <span v-else class="chips chips-floor">
            <button
              v-for="f in floors.filter((x) => Number(x.FLOORNO) <= 40)"
              :key="f.FLOORNO"
              class="mini-chip"
              :class="{ on: floor === f.FLOORNO }"
              @click="pickFloor(f.FLOORNO)"
            >
              {{ Number(f.FLOORNO) }}F
            </button>
          </span>
        </span>
      </div>

      <div class="step-sep"></div>

      <div class="step static">
        <span class="s-idx">3</span>
        <span class="s-body">
          <span class="s-label">房间</span>
          <span v-if="loading.r" class="sk" style="width: 120px; height: 18px"></span>
          <span v-else-if="!rooms.length" class="s-value ph">
            {{ floor ? "暂无房间" : "先选楼层" }}
          </span>
          <span v-else class="chips chips-room">
            <button
              v-for="r in rooms"
              :key="r.ALLROOMNO"
              class="mini-chip"
              :class="{ on: room?.ALLROOMNO === r.ALLROOMNO }"
              @click="pickRoom(r)"
            >
              {{ r.CYROOMNO }}
            </button>
          </span>
        </span>
      </div>
    </section>

    <!-- 房间信息 -->
    <section v-if="room" class="card room-card">
      <div class="row-between">
        <div class="stack">
          <span class="t-label t3">已选房间</span>
          <span class="t-h2">{{ build?.BUILDNAME }} {{ room.CYROOMNO }}</span>
        </div>
        <span class="chip chip-primary mono">{{ room.ALLROOMNO }}</span>
      </div>

      <div v-if="loading.info" class="sk" style="height: 88px; margin-top: 14px"></div>
      <template v-else-if="elec">
        <!-- 账户余额是学生最关心的：欠费为负数，单独放大 -->
        <div class="meter-hero" :class="{ owe: (elec.balance ?? 0) < 0 }">
          <div class="mh-main">
            <span class="mh-k">账户余额</span>
            <span class="mh-v">
              <b class="mono">{{ elec.balance == null ? "—" : elec.balance.toFixed(2) }}</b><i>元</i>
            </span>
          </div>
          <div class="mh-side">
            <span class="mh-k">电价</span>
            <span class="mh-s mono">¥{{ elec.priceKwh?.toFixed(3) ?? "-" }}/度</span>
          </div>
        </div>
        <p v-if="(elec.balance ?? 0) < 0" class="t-body-s owe-tip">
          当前欠费 ¥{{ Math.abs(elec.balance ?? 0).toFixed(2) }}，充值后自动抵扣。
        </p>

        <div class="facts">
          <div class="fact">
            <span class="k">本月用电</span>
            <span class="v mono">{{ elec.kwh ?? "-" }} 度</span>
          </div>
          <div class="fact">
            <span class="k">本月电费</span>
            <span class="v mono">¥{{ elec.feeElec?.toFixed(2) ?? "-" }}</span>
          </div>
          <div class="fact">
            <span class="k">电表读数</span>
            <span class="v mono">{{ elec.startKwh?.toFixed(2) }} → {{ elec.endKwh?.toFixed(2) }}</span>
          </div>
          <div class="fact">
            <span class="k">抄表时间</span>
            <span class="v">{{ elec.recordTime || "-" }}</span>
          </div>
          <div v-if="elec.water" class="fact">
            <span class="k">本月用水</span>
            <span class="v mono">{{ elec.water }} 吨 · ¥{{ elec.feeWater?.toFixed(2) }}</span>
          </div>
        </div>
      </template>
    </section>

    <!-- 充值 -->
    <section v-if="room" class="section">
      <div class="section-head">
        <h2 class="t-h3">充值金额</h2>
        <span class="t-body-s t3">卡内余额 ¥{{ moneyOrDash(state.balance?.accountAmount0) }}</span>
      </div>
      <div class="grid">
        <button
          v-for="p in presets"
          :key="p"
          class="amt-btn"
          :class="{ on: !customMode && picked === p }"
          @click="((picked = p), (customMode = false))"
        >
          <span class="v">{{ p }}</span><span class="u">元</span>
        </button>
        <button class="amt-btn" :class="{ on: customMode }" @click="customMode = true">
          <span class="v" style="font-size: 15px">其他</span>
        </button>
      </div>
      <input
        v-if="customMode"
        v-model="custom"
        class="input mono"
        style="margin-top: 12px"
        inputmode="decimal"
        placeholder="输入金额，最多两位小数"
      />
      <button class="btn btn-primary btn-lg btn-block" style="margin-top: 16px" :disabled="busy" @click="askRecharge">
        {{ busy ? "处理中…" : `充值 ¥${amount.toFixed(2)}` }}
      </button>
      <p class="t-body-s t3 note">
        电费从一卡通余额扣除，充值成功后即时到账。
      </p>
    </section>

    <!-- 每日用量查询（社区项目） -->
    <section class="card promo">
      <div class="row-between">
        <span class="t-h3">每天用了多少电？</span>
        <Icon name="external" :size="15" class="t3" />
      </div>
      <p class="t-body-s t3" style="margin-top: 6px">
        如想查询每天电费用量，请参阅此项目
      </p>
      <a
        class="promo-link"
        href="https://github.com/akdf13/CQUPT_ELE_AUTO"
        target="_blank"
        rel="noopener noreferrer"
      >
        akdf13 / CQUPT_ELE_AUTO
      </a>
    </section>

    <!-- 楼栋选择 -->
    <Sheet :open="sheet" title="选择楼栋" @close="sheet = false">
      <input v-model="search" class="input" placeholder="搜索楼栋名称，如 明理苑 / 24 栋" />
      <div v-if="loading.b" class="sk" style="height: 120px; margin-top: 12px"></div>
      <div v-else class="b-list">
        <button v-for="b in filtered" :key="b.BUILDNO" class="b-item" @click="pickBuilding(b)">
          <span class="icon-box icon-box-sm"><Icon name="building" :size="17" /></span>
          <span class="grow">
            <span class="list-row-title">{{ b.BUILDNAME }}</span>
            <span class="list-row-sub mono">{{ b.BUILDNO }}<template v-if="b.CYBUILDNO && b.CYBUILDNO !== b.BUILDNAME"> · {{ b.CYBUILDNO }}</template></span>
          </span>
          <Icon v-if="build?.BUILDNO === b.BUILDNO" name="check" :size="17" class="tp" />
        </button>
        <p v-if="!filtered.length" class="empty t-body-s">没有匹配的楼栋</p>
      </div>
    </Sheet>

    <!-- 充值二次确认（自绘，不用原生 confirm） -->
    <div v-if="confirmOpen" class="dlg-mask" @click.self="confirmOpen = false">
      <div class="dlg" role="dialog" aria-modal="true">
        <p class="dlg-title">确认充值</p>
        <p class="dlg-body">
          从一卡通余额扣除
          <b class="mono">¥{{ amount.toFixed(2) }}</b>
          充入
          <b>{{ room?.CYROOMNO ? room.CYROOMNO + " 房间" : "该房间" }}</b>
          电费
        </p>
        <p class="dlg-note">充值成功后电表通常几分钟内到账</p>
        <div class="dlg-acts">
          <button class="btn btn-ghost" @click="confirmOpen = false">取消</button>
          <button class="btn btn-primary" :disabled="busy" @click="doRecharge">
            {{ busy ? "处理中…" : "确认充值" }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.elec {
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

.recall {
  margin-top: 12px;
  display: flex;
  align-items: center;
}
.recall .row-between {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.meter-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin-top: 14px;
  padding: 14px 16px;
  border-radius: var(--r-md);
  background: var(--primary-50);
}
.meter-hero.owe {
  background: var(--danger-50);
}
.meter-hero.owe .mh-v b {
  color: var(--danger-600);
}
.meter-hero.owe .mh-k,
.meter-hero.owe .mh-s {
  color: #8f4b47;
}
.owe-tip {
  margin-top: 8px;
  color: var(--danger-600);
}
.promo {
  margin-top: 12px;
}
.promo-link {
  display: inline-block;
  margin-top: 10px;
  font-size: var(--fs-body-s);
  font-weight: 600;
  color: var(--primary-600);
  text-decoration: none;
  border-bottom: 1px solid var(--primary-50);
  padding-bottom: 1px;
}
.mh-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.mh-k {
  font-size: var(--fs-label);
  color: var(--text-tertiary);
}
.mh-v b {
  font-size: 32px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--primary-700);
  font-variant-numeric: tabular-nums;
}
.mh-v i {
  font-style: normal;
  font-size: var(--fs-body-s);
  color: var(--text-secondary);
  margin-left: 4px;
}
.mh-side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}
.mh-s {
  font-size: var(--fs-body);
  font-weight: 600;
  color: var(--text-secondary);
}
.facts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 16px;
  margin-top: 16px;
}
.fact {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.fact .k {
  font-size: var(--fs-label);
  color: var(--text-tertiary);
}
.fact .v {
  font-size: var(--fs-body);
  font-weight: 500;
  color: var(--text-primary);
}
.meter-note {
  margin-top: 14px;
}
.steps {
  margin-top: 4px;
  padding: 4px 0;
}
.step {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  width: 100%;
  padding: 12px 16px;
  text-align: left;
  background: none;
}
.step:active:not(.static) {
  background: var(--bg-hover);
}
.s-idx {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--primary-50);
  color: var(--primary-700);
  font-size: 12px;
  font-weight: 700;
  display: grid;
  place-items: center;
  flex: none;
  margin-top: 2px;
}
.s-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.s-label {
  font-size: 12px;
  color: var(--text-tertiary);
}
.s-value {
  font-size: 15px;
  font-weight: 600;
}
.s-value.ph {
  color: var(--text-tertiary);
  font-weight: 400;
}
.step-sep {
  height: 1px;
  background: var(--line-soft);
  margin: 0 16px 0 50px;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}
.mini-chip {
  height: 30px;
  min-width: 42px;
  padding: 0 10px;
  border-radius: var(--r-xs);
  border: 1px solid var(--line);
  background: var(--bg-card);
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
}
.mini-chip.on {
  border-color: var(--primary-600);
  background: var(--primary-50);
  color: var(--primary-700);
  font-weight: 600;
}

.room-card {
  margin-top: var(--gap-card);
}
.room-facts {
  display: flex;
  gap: 24px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--line-soft);
}
.fact {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.fact .k {
  font-size: 11px;
  color: var(--text-tertiary);
}
.fact .v {
  font-size: 14px;
  font-weight: 600;
}

.grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
.amt-btn {
  height: 58px;
  border-radius: var(--r-md);
  border: 1px solid var(--line);
  background: var(--bg-card);
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 2px;
}
.amt-btn .v {
  font-family: var(--font-num);
  font-size: 20px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.amt-btn .u {
  font-size: 11px;
  color: var(--text-tertiary);
}
.amt-btn.on {
  border-color: var(--primary-600);
  background: var(--primary-50);
}
.amt-btn.on .v {
  color: var(--primary-700);
}
.note {
  margin-top: 12px;
  line-height: 19px;
}

.b-list {
  margin-top: 8px;
}
.b-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 4px;
  text-align: left;
  background: none;
  border-radius: var(--r-sm);
}
.b-item:active {
  background: var(--bg-hover);
}
/* ---------- 充值确认对话框 ---------- */
.dlg-mask {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(15, 23, 32, 0.44);
  animation: dlg-in var(--dur-fast) var(--ease-standard);
}
.dlg {
  width: 100%;
  max-width: 320px;
  padding: 20px;
  border-radius: var(--r-lg);
  background: var(--bg-card);
  box-shadow: var(--elev-3);
}
.dlg-title {
  font-size: var(--fs-h3);
  font-weight: 600;
  color: var(--text-primary);
}
.dlg-body {
  margin-top: 10px;
  font-size: var(--fs-body);
  line-height: 1.55;
  color: var(--text-secondary);
}
.dlg-body b {
  color: var(--text-primary);
  font-weight: 600;
}
.dlg-note {
  margin-top: 6px;
  font-size: var(--fs-body-s);
  color: var(--text-tertiary);
}
.dlg-acts {
  display: flex;
  gap: 10px;
  margin-top: 18px;
}
.dlg-acts .btn {
  flex: 1;
}
@keyframes dlg-in {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
}
@media (prefers-reduced-motion: reduce) {
  .dlg-mask {
    animation: none;
  }
}
</style>
