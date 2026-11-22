import crypto from "node:crypto";
import { call, newUuid, fetchAvatar, UpstreamError } from "./gateway.js";
import { touchUpstream } from "./session.js";

/** 浏览器端无法提供 uni.getDeviceInfo().deviceId，这里生成一个稳定设备号 */
export const DEVICE_ID = (process.env.DEVICE_ID || `cqupt-pwa-${crypto.randomBytes(4).toString("hex")}`).slice(0, 32);

function needsRelogin(err) {
  if (!(err instanceof UpstreamError)) return false;
  const m = err.message || "";
  return m.includes("重新登录") || m.includes("其它设备") || m.includes("其他设备") || err.code === "NO_TOKEN";
}

async function relogin(session) {
  if (!session.userno || !session.password) throw new UpstreamError("会话已过期，请重新登录", "NEED_LOGIN");
  const uuid = await newUuid();
  const res = await call(
    "appLoginUser",
    {
      DEVICEID: DEVICE_ID,
      TIMESTAMP: Date.now(),
      LOGINTYPE: false,
      DATA: "",
      USERNO: session.userno,
      PASSWORD: session.password,
    },
    { way: "uuid", uuid }
  );
  if (res.status !== 0) throw new UpstreamError(res.message || "登录失败", "LOGIN_FAIL");
  touchUpstream(session, res);
  session.reloginAt = Date.now();
  return session;
}

/** 业务调用：自动补 EMPID/TOKEN/USERID，会话失效自动重登一次 */
async function biz(session, service, params = {}) {
  const build = (s) => {
    const p = { ...params };
    if (s.empid) p.EMPID = s.empid;
    return p;
  };
  try {
    return await call(service, build(session), { token: session.token, userid: session.userid });
  } catch (err) {
    if (!needsRelogin(err)) throw err;
    await relogin(session);
    return call(service, build(session), { token: session.token, userid: session.userid });
  }
}

export async function login(userno, password) {
  const uuid = await newUuid();
  const res = await call(
    "appLoginUser",
    {
      DEVICEID: DEVICE_ID,
      TIMESTAMP: Date.now(),
      LOGINTYPE: false,
      DATA: "",
      USERNO: userno,
      PASSWORD: password,
    },
    { way: "uuid", uuid }
  );
  if (res.status !== 0) throw new UpstreamError(res.message || "学号或密码错误", "LOGIN_FAIL");
  const item = res.item || {};
  if (!item.tokenId) throw new UpstreamError("登录返回缺少 token", "LOGIN_FAIL");
  const emp = item.empvo || {};
  const session = {
    userno: item.userno || userno,
    password,
    token: item.tokenId,
    userid: item.userid,
    empid: emp.empId,
    eaccountid: emp.eAccountId,
    empno: emp.empNo,
    name: emp.name,
    tel: emp.tel,
    itemlist: item.itemlist || [],
    login: item,
  };
  // 头像异步补，不阻塞登录
  fetchAvatar(session.userno)
    .then((data) => {
      if (data) session.avatar = data;
    })
    .catch(() => {});
  return session;
}

export const balance = (s) => biz(s, "getEAcountNum", { EACCOUNTID: s.eaccountid });
export const cardStatus = (s) => biz(s, "getCardStatus", {});
export const itemCaseload = (s) => {
  const alias = (s.itemlist || []).map((x) => x.itemalias).filter(Boolean).join(",");
  return biz(s, "getItemCaseload", { ITEMALIAS: alias });
};
export async function notices(s) {
  const r = await call("getTopNotice", {}, { token: s.token, userid: s.userid });
  const it = r?.item ?? r;
  return Array.isArray(it) ? it : it ? [it] : [];
}
const NAMED_ENTITY = {
  nbsp: " ",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  hellip: "…",
  middot: "·",
  mdash: "—",
  ndash: "–",
  times: "×",
  deg: "°",
  quot: '"',
  amp: "&",
  lt: "<",
  gt: ">",
  apos: "'",
  copy: "©",
  reg: "®",
  trade: "™",
  laquo: "«",
  raquo: "»",
  sect: "§",
  para: "¶",
  bull: "•",
  prime: "′",
  Prime: "″",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
};

/** 上游公告正文是 Word 导出的 HTML，且中文写成数字实体（&#27700; = 水），要解码后当纯文本展示 */
function htmlToText(html) {
  const s0 = String(html ?? "");
  if (!s0) return "";
  return s0
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<td[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&(nbsp|ldquo|rdquo|lsquo|rsquo|hellip|middot|mdash|ndash|times|deg|quot|amp|lt|gt|apos|copy|reg|trade|laquo|raquo|sect|para|bull|prime|Prime|ensp|emsp|thinsp);/g, (_, n) => NAMED_ENTITY[n] ?? "")
    .replace(/&[a-z]+;/gi, "")
    .replace(/\r/g, "")
    .replace(/[\u200b\u00a0\u3000]/g, " ")
    .replace(/\u200b/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 上游这个接口偶尔返回 item:null（约 1/3 概率），重试几次即可稳定 */
export async function noticeInfo(s, id) {
  const noticeid = String(id || "").trim();
  if (!noticeid) throw new BadRequest("缺少公告 ID");
  let item = null;
  let lastErr = null;
  for (let i = 0; i < 4; i++) {
    try {
      const r = await biz(s, "getNoticeInfo", { NOTICEID: noticeid });
      item = r?.item ?? null;
      if (item) break;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((res) => setTimeout(res, 200));
  }
  if (!item) throw new UpstreamError(lastErr?.message || "公告详情暂时取不到，请稍后重试");
  const t = item.modifyTime;
  const timeText =
    t && typeof t === "object" && t.time
      ? new Date(t.time).toLocaleString("zh-CN", { hour12: false }).replace(/\//g, "-")
      : typeof t === "string"
        ? t
        : "";
  const text = htmlToText(item.attachment) || htmlToText(item.content) || "";
  return {
    id: String(item.id ?? noticeid),
    title: String(item.title ?? ""),
    time: timeText || String(item.startTime ?? ""),
    editor: String(item.editor ?? ""),
    text,
  };
}

export const alertMessage = (s) => biz(s, "getAlertMessage", {});
export const waterDevice = (s) => biz(s, "getWaterSetByEmp", {});

function normalizeRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => {
    const amountRaw =
      r.amount ?? r.amount2 ?? r.AMOUNT ?? r.AMOUNT2 ?? r.tranamt ?? r.TRANAMT ?? r.money ?? 0;
    const amount = Number(String(amountRaw).replace(/[^\d.-]/g, "")) || 0;
    const time =
      r.occurtime || r.occurTime || r.transdate || r.TRANSDATE || r.optime || r.OPTIME ||
      r.createdate || r.CREATEDATE || "";
    const title =
      r.transname || r.transCodeName || r.transtypename || r.TRANSTYPENAME || r.merchantname ||
      r.MERCHANTNAME || r.itemname || r.remark || r.REMARK || r.paytype || "消费";
    const sceneRaw =
      r.marketName || r.merchantname || r.MERCHANTNAME || r.devname || r.roomname || r.address ||
      r.memo || (r.deviceno || r.deviceNo ? `设备 ${r.deviceno || r.deviceNo}` : "");
    // 上游对线上充值记的商户名就是「未知」，别当场景显示
    const sceneText = /^(未知|空|null|undefined|-|--)$/i.test(String(sceneRaw).trim()) ? "" : sceneRaw;
    // 场景与标题往往是同一个词（"直饮水扣费" / "直饮水"），拼接渲染会出现「直饮水扣费直饮水」
    const clean = (v) => String(v ?? "").trim();
    const scene =
      !clean(sceneText) || clean(sceneText) === clean(title) || clean(title).includes(clean(sceneText))
        ? ""
        : clean(sceneText);
    return {
      id: String(
        r.eaccountdataId ?? r.id ?? r.transCode ?? r.TRANSCODE ?? r.receivableaccountid ?? Math.random()
      ),
      title,
      scene,
      time,
      amount,
      balance:
        Number(String(r.accountvalue ?? r.cardValue ?? r.ACCOUNTVALUE ?? r.balance ?? 0).replace(/[^\d.-]/g, "")) || 0,
      dir: amount < 0 ? "out" : "in",
      kind: r.transcode ?? r.transCode ?? r.datatype ?? r.DATATYPE ?? "",
      raw: r,
    };
  });
}

export async function transactions(s, { page = 1, size = 20, sdate, edate } = {}) {
  const to = edate || new Date().toISOString().slice(0, 10);
  const from = sdate || new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString().slice(0, 10);
  // getEAccountData 是唯一稳定返回明细的流水接口（getCardTransaction 常为空）
  const res = await biz(s, "getEAccountData", {
    STARTTIME: from,
    ENDTIME: to,
    PAGESIZE: size,
    PAGENO: page,
  });
  const list = res.item?.list || [];
  return {
    page: res.item?.pageNo ?? page,
    pageCount: res.item?.pageCount ?? 1,
    total: res.item?.rowCount ?? list.length,
    rows: normalizeRows(list),
    range: { from, to },
  };
}

/**
 * 食堂 / 超市等"聚合支付"消费流水（queryEmpAggPayData）。
 *
 * 这是原版 App 里根本没做的接口，参数坑很深：
 *   - 只认 SDATE / EDATE；STARTTIME / ENDTIME 会被静默忽略（传 10 月仍返回全量 79 条，容易误以为时间过滤生效）
 *   - 行字段全大写：OCCURTIME / MARKETNAME / AMOUNT / TYPESTR / TYPE / DEVICENO / ID
 *   - TYPESTR 是付款渠道（微信支付 / 支付宝支付 / 校园卡），不是消费类型
 * 实测某账号近一年 79 笔、合计 ¥642.11，全部是食堂档口（千禧鹤/樱花/中心/延生…）。
 */
export async function canteen(s, { page = 1, size = 20, sdate, edate } = {}) {
  const to = edate || new Date().toISOString().slice(0, 10);
  const from = sdate || new Date(Date.now() - 1000 * 60 * 60 * 24 * 365).toISOString().slice(0, 10);
  const res = await biz(s, "queryEmpAggPayData", {
    SDATE: from,
    EDATE: to,
    PAGESIZE: size,
    PAGENO: page,
    TYPE: "",
  });
  const item = res.item || {};
  const list = item.list || [];
  return {
    page: item.pageNo ?? page,
    pageCount: item.pageCount ?? 1,
    total: item.rowCount ?? list.length,
    range: { from, to },
    rows: list.map((r) => ({
      id: String(r.ID ?? ""),
      title: r.MARKETNAME || "食堂消费",
      scene: r.TYPESTR || "",
      time: r.OCCURTIME || "",
      amount: -Math.abs(Number(r.AMOUNT ?? 0)),
      dir: "out",
      kind: `agg-${r.TYPE ?? ""}`,
      raw: r,
    })),
  };
}
export async function payments(s, { page = 1, size = 20, datatype = 1 } = {}) {
  const res = await biz(s, "getPaymentMessage", { DATATYPE: datatype, PAGENO: page, PAGESIZE: size });
  const list = res.item?.list || [];
  const num = (v) => Number(String(v ?? 0).replace(/[^\d.-]/g, "")) || 0;
  return {
    page: res.item?.pageNo ?? page,
    pageCount: res.item?.pageCount ?? 1,
    total: res.item?.rowCount ?? list.length,
    rows: list.map((r) => {
      const name = String(r.executespanname || r.EXECUTESPANNAME || "");
      const fee = String(r.financingname || r.FINANCINGNAME || "");
      const amount = num(r.receivableamount ?? r.RECEIVABLEAMOUNT ?? r.amount);
      const paid = num(r.amount2 ?? r.AMOUNT2);
      const status = String(r.typename || r.TYPENAME || "");
      const elec = /电费/.test(fee) || /[舍室]$/.test(name);
      return {
        id: String(r.receivableaccountid ?? r.RECEIVABLEACCOUNTID ?? ""),
        title: name || fee || "应缴费用",
        fee,
        room: elec ? name : "",
        time: String(r.createdate || r.CREATEDATE || ""),
        amount,
        paid,
        status,
        done: status.includes("已缴") || (amount > 0 && paid >= amount),
        elec,
        raw: r,
      };
    }),
    raw: list,
  };
}

export async function openWater(s, deviceno) {
  const scan = await biz(s, "scanning4GWaterValve", { DEVICENO: deviceno });
  const ordersn = scan?.item?.data?.id || scan?.item?.id;
  if (!ordersn) {
    throw new UpstreamError(scan?.item?.message || "未取到订单号，设备可能离线", "NO_ORDERSN");
  }
  const confirm = await biz(s, "createorderissuccess4GWaterValve", { ORDERSN: ordersn });
  return { ordersn, raw: { scan, confirm }, confirmed: confirm?.status === 0 };
}

export const closingOrders = (s) => biz(s, "queryClosingOrder", {});
export const settleOrder = (s, ordersn) => biz(s, "activesetttleaccounts4GWaterValve", { ORDERSN: ordersn });

export async function waterHistory(s, { page = 1, size = 10, sdate, edate } = {}) {
  const to = edate || new Date().toISOString().slice(0, 10);
  const from = sdate || new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString().slice(0, 10);
  const res = await biz(s, "query4GWaterValvePage", {
    TRANSCODE: "",
    ACCOUNTTYPE: 2,
    PAGE: page,
    PAGESIZE: size,
    STARTTIME: from,
    ENDTIME: to,
  });
  const d = res?.item?.data || {};
  return {
    rows: normalizeRows(d.records || []),
    current: d.current || page,
    pages: d.pages || 1,
    raw: d.records || [],
  };
}

export const elecBuildings = (s) => biz(s, "getElectricityBuilding", { TYPE: 1 });
export const elecFloors = (s, buildno) => biz(s, "getElectricityFloor", { BUILDNO: buildno });
export const elecRooms = (s, buildno, floor) =>
  biz(s, "getElectricityRoom", { ARCHITECTUREID: buildno, FLOOR: floor });
export const elecRoomInfo = (s, allroomno) => biz(s, "queryRoomEleByAllroomno", { ALLROOMNO: allroomno });

export function elecRecharge(s, { amount, roomno }) {
  return biz(s, "rechargeRoomEle", {
    AMOUNT: amount,
    USECOUNT: 0,
    CARDVALUE: 0,
    TYPE: 1,
    ROOMNO: roomno,
    DEVICENO: DEVICE_ID,
  });
}

export const reportCard = (s, lost) =>
  biz(s, "reportCard", {
    CARDSTATUS: lost ? 4 : 0,
    USERNO: s.userno,
    DEVICENO: DEVICE_ID,
  });

/**
 * 在线充值下单：newOperatekey 取一次性 key → startWeiXin/startAlipayRecharge。
 * 返回的是发给微信/支付宝客户端的支付参数；网页端能否唤起取决于目标渠道。
 * 微信返回 { appid, partnerid, prepayid, package, noncestr, timestamp, sign }，
 * 支付宝返回 orderInfo 串（method=alipay.trade.app.pay）。
 */
export async function payOnline(session, { channel, amount }) {
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    throw Object.assign(new Error("充值金额不合法"), { code: "BAD_PARAM" });
  }
  const keyRes = await biz(session, "newOperatekey", {});
  const operatekey =
    typeof keyRes?.item === "string"
      ? keyRes.item
      : keyRes?.item?.operatekey || keyRes?.item?.OPERATEKEY || "";
  if (!operatekey) throw new UpstreamError("未取得操作密钥，请稍后重试", "NO_OPERATEKEY");

  const svcName = channel === "alipay" ? "startAlipayRecharge" : "startWeiXinRecharge";
  const res = await biz(session, svcName, {
    AMOUNT: amt.toFixed(2),
    DEVICENO: DEVICE_ID,
    OPERATEKEY: operatekey,
    USERNO: session.userno,
    DESTINATION: 6,
  });
  if (res?.status !== 0) {
    throw new UpstreamError(res?.message || "充值订单生成失败", "PAY_ORDER_FAIL");
  }
  return { channel: channel === "alipay" ? "alipay" : "wechat", amount: amt.toFixed(2), item: res.item, message: res.message };
}

/** 用卡内余额支付应收账单：newOperatekey 取一次性操作 key → setPaymentById 提交 */
export async function payBill(s, { receivableaccountid, amount }) {
  const keyRes = await biz(s, "newOperatekey", {});
  const operatekey =
    keyRes?.item?.operatekey || keyRes?.item?.OPERATEKEY || (typeof keyRes?.item === "string" ? keyRes.item : "");
  if (!operatekey) throw new UpstreamError("未取得操作密钥，请稍后重试", "NO_OPERATEKEY");
  const res = await biz(s, "setPaymentById", {
    RECEIVABLEACCOUNTID: receivableaccountid,
    AMOUNT: Number(amount).toFixed(2),
    USERNO: s.userno,
    EACCOUNTID: s.eaccountid,
    DEVICENO: DEVICE_ID,
    OPERATEKEY: operatekey,
  });
  return { ok: res?.status === 0, status: res?.status ?? -1, message: res?.message || "", raw: res };
}

/**
 * 支付绑定状态。
 * getWithdrawalChannel 原本是提现渠道接口，但它顺带返回微信 openid / 支付宝 userid，
 * 是目前唯一能读到「绑没绑」的入口，所以这里复用它。
 */
export async function bindStatus(s) {
  const res = await biz(s, "getWithdrawalChannel", {});
  const it = res?.item || {};
  return {
    name: it.name || "",
    employeeno: it.employeeNO || "",
    wechat: {
      bound: !!it.appOpenId,
      nickname: it.appnickname || "",
      id: it.appOpenId || "",
    },
    alipay: {
      bound: !!it.alipayuserid,
      nickname: it.alipaynickname || "",
      id: it.alipayuserid || "",
    },
    raw: it,
  };
}

/** 支付宝授权参数串（喂给原生 AuthTask.auth） */
export async function alipayAuth(s) {
  const res = await biz(s, "getAlipaySign", {});
  const info = res?.item;
  if (!info || typeof info !== "string") {
    throw new UpstreamError("未取到支付宝授权参数", "NO_AUTH_INFO");
  }
  return { authInfo: info };
}

/**
 * 用 authCode 换支付宝账号并绑定。
 * 字段名上游没有文档，这里按常见拼写做兼容；绑不上会抛错而不是静默成功。
 */
export async function alipayBind(s, code) {
  const c = String(code || "").trim();
  if (!c) throw Object.assign(new Error("缺少授权码"), { code: "BAD_PARAM" });
  const r1 = await biz(s, "getAliPayUserInfo", { CODE: c });
  const it = r1?.item || {};
  const userid = it.userId || it.userid || it.ALIPAYUSERID || it.alipayuserid || it.userID;
  if (!userid) {
    throw new UpstreamError(r1?.message || "未取到支付宝账号", "NO_ALIPAY_USER");
  }
  const nickname = it.nickName || it.nickname || it.ALIPAYNICKNAME || it.alipaynickname || "";
  const r2 = await biz(s, "setEmpAlipayInfo", {
    ALIPAYUSERID: String(userid),
    ALIPAYNICKNAME: String(nickname),
  });
  return {
    ok: r2?.status === 0,
    userid: String(userid),
    nickname: String(nickname),
    message: r2?.message || "",
    raw: { user: r1, save: r2 },
  };
}

/** 主动缴费第 1 步：按设备号查商户（queryDeviceInfo） */
export async function deviceInfo(s, deviceno) {
  const no = String(deviceno || "").trim();
  if (!/^\d{6,20}$/.test(no)) {
    throw Object.assign(new Error("设备号应为 6~20 位数字"), { code: "BAD_PARAM" });
  }
  const res = await biz(s, "queryDeviceInfo", { DEVICENO: no });
  if (res?.status !== 0 || !res.item) {
    throw new UpstreamError(res?.message || "没有对应的设备详情", "NO_DEVICE");
  }
  return res.item;
}

/**
 * 主动缴费第 2 步：向该商户付款（payInitiative）。
 * 注意上游不接收密码参数，扣的是卡内余额；调用方必须先做二次确认。
 */
export async function payInitiative(s, { deviceno, amount }) {
  const no = String(deviceno || "").trim();
  if (!/^\d{6,20}$/.test(no)) {
    throw Object.assign(new Error("设备号应为 6~20 位数字"), { code: "BAD_PARAM" });
  }
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    throw Object.assign(new Error("缴费金额不合法"), { code: "BAD_PARAM" });
  }
  const res = await biz(s, "payInitiative", {
    AMOUNT: amt.toFixed(2),
    DEVICENO: no,
    EACCOUNTID: s.eaccountid,
  });
  if (res?.status !== 0) {
    throw new UpstreamError(res?.message || "缴费失败", "PAY_FAIL");
  }
  return {
    ok: true,
    market: res.item?.MARKETNAME || "",
    amount: res.item?.AMOUNT || amt.toFixed(2),
    message: res.message || "",
    raw: res,
  };
}

export const setPwdCheck = (s, status) =>
  biz(s, "setIsOpenPwdCheck", {
    EACCOUNTID: s.eaccountid,
    STATUS: status,
    USERNO: s.userno,
    DEVICENO: DEVICE_ID,
  });

export async function checkPayPassword(s, pwd) {
  const res = await biz(s, "checkPayPassword", {
    ACCOUNTID: s.eaccountid,
    EACCOUNTID: s.eaccountid,
    PWD: pwd,
  });
  return { ok: res?.item === "true" || res?.item === true, raw: res };
}

export async function paycode(s) {
  const res = await biz(s, "getTransKey", { DEVICENO: DEVICE_ID, ACCOUNTID: s.eaccountid });
  return res;
}
export function paycodeResult(s, qrcode) {
  return biz(s, "getPayResult", { QRCODE: qrcode, ACCOUNTID: s.eaccountid, DEVICENO: DEVICE_ID });
}

export async function home(s) {
  const safe = (p) => p.then((v) => ({ ok: true, v })).catch((e) => ({ ok: false, e }));
  const aliases = (s.itemlist || []).map((x) => x.itemalias).filter(Boolean).join(",");
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
  const [bal, al, nt, cs, wd, tx, tx2] = await Promise.all([
    safe(balance(s)),
    safe(call("getAlertMessage", { EMPID: s.empid }, { token: s.token, userid: s.userid })),
    safe(call("getTopNotice", {}, { token: s.token, userid: s.userid })),
    safe(biz(s, "getCardStatus", {})),
    safe(biz(s, "getWaterSetByEmp", {})),
    safe(
      biz(s, "getEAccountData", {
        STARTTIME: monthStart,
        ENDTIME: todayStr,
        PAGESIZE: 100,
        PAGENO: 1,
      })
    ),
    safe(
      biz(s, "getEAccountData", {
        STARTTIME: monthStart,
        ENDTIME: todayStr,
        PAGESIZE: 100,
        PAGENO: 2,
      })
    ),
  ]);
  // 上游单页上限 100 条（传 200 也只回 100）。「本月支出」必须是整月合计，
  // 只算第 1 页会严重偏低（实测 11 月前 50 笔 ¥5.69，整月 ¥90.81）。
  let rows = tx.ok ? normalizeRows(tx.v?.item?.list || []) : [];
  const pageInfo = tx.ok ? tx.v?.item || {} : {};
  const totalPages = Number(pageInfo.pageCount || pageInfo.pages || 1) || 1;
  if (totalPages > 1 && tx2.ok) rows = rows.concat(normalizeRows(tx2.v?.item?.list || []));
  for (let pg = 3; pg <= totalPages && pg <= 20; pg++) {
    try {
      const more = await biz(s, "getEAccountData", {
        STARTTIME: monthStart,
        ENDTIME: todayStr,
        PAGESIZE: 100,
        PAGENO: pg,
      });
      rows = rows.concat(normalizeRows(more?.item?.list || []));
    } catch {
      break;
    }
  }
  const spend = rows.filter((r) => r.amount < 0);
  const monthSpend = Math.round(spend.reduce((a, r) => a + Math.abs(r.amount), 0) * 100) / 100;
  return {
    balance: bal.ok ? bal.v : null,
    balanceError: bal.ok ? null : bal.e.message,
    alert: al.ok ? al.v : null,
    notices: nt.ok ? (Array.isArray(nt.v?.item) ? nt.v.item : nt.v?.item ? [nt.v.item] : []) : [],
    card: cs.ok ? cs.v : null,
    waterDevice: wd.ok ? wd.v?.item?.data?.deviceno || wd.v?.item?.deviceno || null : null,
    recent: rows.slice(0, 5),
    monthSpend,
    monthSpendCount: spend.length,
    monthSpendPartial: totalPages > 1,
  };
}
