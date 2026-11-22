import { call, newUuid } from "./src/gateway.js";
import { DEVICE_ID } from "./src/service.js";

const US = { userno: process.env.CQUPT_USER || "", password: process.env.CQUPT_PASS || "" };

const uuid = await newUuid();
const login = await call(
  "appLoginUser",
  { DEVICEID: DEVICE_ID, TIMESTAMP: Date.now(), LOGINTYPE: false, DATA: "", USERNO: US.userno, PASSWORD: US.password },
  { way: "uuid", uuid }
);
const item = login.item;
const base = { EMPID: item.empvo.empId };
const opts = { token: item.tokenId, userid: item.userid };
console.log("login:", login.status, item.empvo.name, "tokenLen", String(item.tokenId).length);

async function probe(label, svc, params) {
  try {
    const r = await call(svc, { ...base, ...params }, opts);
    const txt = JSON.stringify(r);
    console.log(`\n### ${label} (${svc}) ->`, txt.slice(0, 900));
  } catch (e) {
    console.log(`\n### ${label} (${svc}) !!`, e.message);
  }
}

const today = new Date().toISOString().slice(0, 10);
const ago = new Date(Date.now() - 864e5 * 60).toISOString().slice(0, 10);

await probe("rooms", "getElectricityRoom", { ARCHITECTUREID: "424", FLOOR: "01" });
await probe("aggPay", "queryEmpAggPayData", { SDATE: ago, EDATE: today, PAGESIZE: 5, PAGENO: 1, TYPE: "" });
await probe("eAccountData", "getEAccountData", { STARTTIME: ago, ENDTIME: today, PAGESIZE: 5, PAGENO: 1 });
await probe("cardTrans", "getCardTransaction", { SDATE: ago, EDATE: today, PAGESIZE: 5, PAGENO: 1 });
await probe("waterPage", "query4GWaterValvePage", {
  TRANSCODE: "", ACCOUNTTYPE: 2, PAGE: 1, PAGESIZE: 5, STARTTIME: ago, ENDTIME: today,
});
await probe("payMsg", "getPaymentMessage", { DATATYPE: 3, PAGENO: 1, PAGESIZE: 5 });
