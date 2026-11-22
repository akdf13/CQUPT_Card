/**
 * 余额对账：把「账户余额」和「所有可能产生扣费的流水来源」一次性拉出来，
 * 看差额能不能被流水解释 —— 排查"余额少了但明细里看不到"。
 *
 * 用法：$env:CQUPT_USER / $env:CQUPT_PASS; node reconcile.mjs [天数]
 */
import { call } from "./src/gateway.js";
import * as svc from "./src/service.js";

const USER = process.env.CQUPT_USER;
const PASS = process.env.CQUPT_PASS;
const DAYS = Number(process.argv[2] || 7);
if (!USER || !PASS) {
  console.error("请先设置 CQUPT_USER / CQUPT_PASS");
  process.exit(1);
}

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const to = new Date();
const from = new Date(Date.now() - DAYS * 86400_000);

const session = await svc.login(USER, PASS);

/** service.js 的 biz 没导出，这里复刻同名语义：自动补 EMPID + 带上票据 */
const biz = (service, params = {}) =>
  call(service, { ...params, EMPID: session.empid }, { token: session.token, userid: session.userid });

console.log("=== 账户现状 ===");
const bal = await svc.balance(session);
const it = bal?.item ?? {};
console.log(
  JSON.stringify(
    {
      accountAmount0: it.accountAmount0,
      accountCount0: it.accountCount0,
      freeZnAmount0: it.freeZnAmount0,
      overdraftAmount0: it.overdraftAmount0,
      accountStatusStr: it.accountStatusStr,
      occurTime: it.occurTime?.time ? new Date(it.occurTime.time).toISOString() : it.occurTime,
    },
    null,
    1,
  ),
);

const window = { STARTTIME: ymd(from), ENDTIME: ymd(to) };
console.log(`\n=== 抓取窗口 ${window.STARTTIME} ~ ${window.ENDTIME}（${DAYS} 天）===\n`);

/** 通用：分页拉全 */
async function page(service, buildParams, pageSize = 50, maxPages = 8) {
  const out = [];
  for (let p = 1; p <= maxPages; p++) {
    const r = await biz(service, buildParams(p, pageSize)).catch((e) => ({ __err: e.message }));
    if (r.__err) return { err: r.__err, rows: out };
    const item = r?.item ?? r;
    const list = item?.list || item?.data?.records || item?.records || [];
    out.push(...list);
    const pages = Number(item?.pageCount || item?.data?.pages || item?.pages || 1);
    if (p >= pages || list.length === 0) break;
  }
  return { rows: out };
}

const sources = [
  ["电子账户流水 getEAccountData", "getEAccountData", (p, s) => ({ ...window, PAGESIZE: s, PAGENO: p })],
  ["校园卡流水 getCardTransaction", "getCardTransaction", (p, s) => ({ ...window, SDATE: window.STARTTIME, EDATE: window.ENDTIME, PAGESIZE: s, PAGENO: p })],
  ["聚合支付 queryEmpAggPayData", "queryEmpAggPayData", (p, s) => ({ ...window, SDATE: window.STARTTIME, EDATE: window.ENDTIME, PAGESIZE: s, PAGENO: p, TYPE: "" })],
  ["水控 query4GWaterValvePage", "query4GWaterValvePage", (p, s) => ({ TRANSCODE: "", ACCOUNTTYPE: 2, PAGE: p, PAGESIZE: s, ...window })],
  ["电费账单 getPaymentMessage", "getPaymentMessage", (p, s) => ({ DATATYPE: 3, PAGENO: p, PAGESIZE: s })],
  ["冻结 findEaccountFreeznData", "findEaccountFreeznData", () => ({ ...window })],
];

const collected = {};
for (const [label, service, build] of sources) {
  const { rows, err } = await page(service, build);
  collected[label] = rows;
  if (err) {
    console.log(`【${label}】调用失败：${err}`);
    continue;
  }
  console.log(`【${label}】${rows.length} 条`);
  for (const r of rows.slice(0, 40)) {
    const time = r.occurtime || r.occurTime || r.transdate || r.createdate || r.recordTime || "";
    const amt = r.amount ?? r.amount2 ?? r.tranamt ?? "";
    const balAfter = r.accountvalue ?? r.cardValue ?? r.balance ?? "";
    const title = r.transname || r.transCodeName || r.itemname || r.remark || "";
    const dev = r.deviceno || r.deviceNo || "";
    const code = r.transcode || r.transCode || "";
    console.log(`  ${String(time).padEnd(20)} ${String(amt).padStart(8)}  余${String(balAfter).padStart(8)}  ${title}${dev ? " · 设备" + dev : ""}${code ? " (tc=" + code + ")" : ""}`);
  }
  if (rows.length > 40) console.log(`  … 其余 ${rows.length - 40} 条略`);
  console.log("");
}

/** 数值化 */
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const eacc = collected["电子账户流水 getEAccountData"];
if (eacc?.length) {
  const spend = eacc.filter((r) => num(r.amount) !== null && num(r.amount) < 0);
  const sumSpend = spend.reduce((a, r) => a + Math.abs(num(r.amount)), 0);
  const withBal = eacc.filter((r) => num(r.accountvalue) !== null);
  console.log("=== 对账（电子账户流水）===");
  console.log(`支出笔数 ${spend.length}，合计 ¥${sumSpend.toFixed(2)}`);
  if (withBal.length) {
    const byTime = withBal
      .slice()
      .sort((a, b) => String(a.occurtime || a.occurTime).localeCompare(String(b.occurtime || b.occurTime)));
    const first = byTime[0];
    const last = byTime[byTime.length - 1];
    console.log(`首条 ${first.occurtime || first.occurTime} 余额 ${first.accountvalue}`);
    console.log(`末条 ${last.occurtime || last.occurTime} 余额 ${last.accountvalue}`);
    const drop = num(first.accountvalue) - num(last.accountvalue);
    console.log(`该窗口内余额变化：${drop >= 0 ? "减少" : "增加"} ¥${Math.abs(drop).toFixed(2)}`);
    console.log(`流水明细合计支出 ¥${sumSpend.toFixed(2)}`);
    const missing = Math.abs(drop) - sumSpend;
    console.log(
      `差额 ${missing >= 0 ? "+" : ""}${missing.toFixed(2)} —— ${
        Math.abs(missing) < 0.01
          ? "完全对得上"
          : missing > 0
            ? "有余额减少但**没有流水**解释，可能存在其它扣费通道"
            : "流水合计大于余额变化，可能有其它入账"
      }`,
    );
  }
}

/** 余额字段口径：accountAmount0 是元，accountCount0 是分 */
if (it.accountAmount0 !== undefined && it.accountCount0 !== undefined) {
  console.log(
    `\n口径核对：accountAmount0=${it.accountAmount0} 元，accountCount0=${it.accountCount0} 分 → ${(
      it.accountCount0 / 100
    ).toFixed(2)} 元`,
  );
}
