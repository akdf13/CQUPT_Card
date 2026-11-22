/*
 * 探测 payInitiative / ete 的参数要求。
 * 安全约束：一律用「不存在的设备号」/「错误密码」，保证上游校验失败、不会真扣款。
 */
import { call } from "./src/gateway.js";
import * as svc from "./src/service.js";

const U = process.env.CQUPT_USER, P = process.env.CQUPT_PASS;
const s = await svc.login(U, P);
const biz = (service, params = {}) =>
  call(service, { ...params, EMPID: s.empid }, { token: s.token, userid: s.userid });
const show = (n, r) => console.log(`\n--- ${n} ---\n` + JSON.stringify(r).slice(0, 600));

// 1. 不存在的设备号
try { show("queryDeviceInfo 999999（不存在）", await biz("queryDeviceInfo", { DEVICENO: "999999" })); }
catch (e) { console.log("\nqueryDeviceInfo 999999 抛错：" + e.message); }

// 2. payInitiative 用不存在的设备号 —— 上游必然拒绝，不会扣款
try {
  show("payInitiative 不存在设备号", await biz("payInitiative", {
    AMOUNT: "0.01", DEVICENO: "999999", EACCOUNTID: s.eaccountid,
  }));
} catch (e) { console.log("\npayInitiative 抛错：" + e.message); }

// 3. ete —— 错误密码 000000，必填齐（INEMPNO 用自己、OUTEMPID 用自己）
try {
  show("ete 错误密码", await biz("ete", {
    AMOUNT: "0.01", INEMPNO: s.userno, OUTEMPID: s.empid, PWD: "000000", USERNO: s.userno,
  }));
} catch (e) { console.log("\nete 抛错：" + e.message); }

// 4. getAliPayUserInfo 用假 code —— 只为看返回结构
try { show("getAliPayUserInfo 假 code", await biz("getAliPayUserInfo", { CODE: "0" })); }
catch (e) { console.log("\ngetAliPayUserInfo 抛错：" + e.message); }

// 5. 绑定的写入接口 —— 空参看参数要求（不写数据）
for (const [n, p] of [["setEmpAlipayInfo 空参", {}], ["setEmpWeixinInfo 空参", {}]]) {
  try { show(n, await biz(n.split(" ")[0], p)); } catch (e) { console.log(`\n${n} 抛错：${e.message}`); }
}
process.exit(0);
