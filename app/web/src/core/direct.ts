/**
 * 直连版数据层：浏览器/WebView 里直接和学校一卡通网关说话，不经过中间服务器。
 *
 * 这是 `app/server/src/service.js` 的浏览器移植版：同样的接口参数、同样的字段归一、
 * 同样的会话失效重登策略。APK 里用的是这一份；本地开发（页面在 5180 端口）仍走
 * `/api/*` 后端代理，因为浏览器跨域读不到学校网关的响应头。
 */
import { call, newUuid, fetchAvatar, UpstreamError } from "./upstream";
import type { SessionUser, HomeData, Row, Balance, UserFeature } from "../api";

const SESSION_KEY = "cqupt.session";
const DEVICE_KEY = "cqupt.device";

/** 功能别名 → 中文名。上游 itemlist 里的 itemalias，决定首页宫格显示什么 */
const FEATURE_NAME: Record<string, string> = {
  balance: "余额/充值",
  subsidy: "领取",
  scavengingPayment: "二维码消费",
  onlinePayment: "在线缴费",
  scan: "扫码消费",
  waterControl: "洗澡水控",
  identity: "身份识别",
  myMessage: "我的信息",
  accountTransfer: "账户转账",
  schoolCard: "校卡管理",
  tradingFlow: "交易流水",
  paymentRecord: "缴费记录",
  weChatRecharge: "微信充值",
  alipayRecharge: "支付宝充值",
  accountFlow: "电子账户流水",
  cardFlow: "校园卡流水",
  rechargeElectricityBill: "预充值电费",
  payMentCode: "收款二维码",
  drinkingwater: "直饮水",
};

type Session = {
  userno: string;
  password: string;
  token: string;
  userid: number;
  empid: number;
  eaccountid: number;
  empno: string;
  name: string;
  tel: string;
  avatar: string | null;
  itemlist: any[];
  loginAt: number;
};

let session: Session | null = null;
let loading = false;

function loadSession(): Session | null {
  if (session) return session;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) session = JSON.parse(raw) as Session;
  } catch {
    session = null;
  }
  return session;
}

function saveSession(s: Session | null) {
  session = s;
  if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  else localStorage.removeItem(SESSION_KEY);
}

/** 设备标识：学校系统要求固定，本地生成一次后长期复用（≤32 字符） */
function deviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    const hex = Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    id = `cqupt-pwa-${hex}`;
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

function needSession(): Session {
  const s = loadSession();
  if (!s) throw new UpstreamError("登录已过期，请重新登录", "NEED_LOGIN");
  return s;
}

/* ------------------------------------------------------------------ 通用请求 */

async function rawLogin(userno: string, password: string): Promise<Session> {
  const uuid = await newUuid();
  const res = await call(
    "appLoginUser",
    {
      DEVICEID: deviceId(),
      TIMESTAMP: Date.now(),
      LOGINTYPE: false,
      DATA: "",
      USERNO: userno,
      PASSWORD: password,
    },
    { way: "uuid", uuid },
  );

  if (res?.status !== 0) throw new UpstreamError(res?.message || "统一认证码或密码不正确", "LOGIN_FAIL");
  const item = res.item;
  if (!item?.tokenId) throw new UpstreamError(res?.message || "登录失败，请稍后重试", "LOGIN_FAIL");

  const emp = item.empvo || {};
  const s: Session = {
    userno: item.userno || userno,
    password,
    token: item.tokenId,
    userid: item.userid,
    empid: emp.empId,
    eaccountid: emp.eAccountId,
    empno: emp.empNo || "",
    name: emp.name || "",
    tel: emp.tel || "",
    avatar: null,
    itemlist: Array.isArray(item.itemlist) ? item.itemlist : [],
    loginAt: Date.now(),
  };

  // 头像非关键路径，取不到就用占位图标
  fetchAvatar(s.userno).then((url) => {
    if (url && session?.token === s.token) {
      s.avatar = url;
      saveSession(s);
    }
  });
  return s;
}

/** 判断这次失败是不是"票据失效"，失效才值得换票重试 */
function isStale(e: unknown): boolean {
  const msg = (e as Error)?.message || "";
  const code = (e as UpstreamError)?.code || "";
  return (
    code === "NO_TOKEN" ||
    msg.includes("重新登录") ||
    msg.includes("其它设备") ||
    msg.includes("其他设备") ||
    msg.includes("登录超时")
  );
}

/**
 * 换票只换一次（single-flight）。
 * 首屏是六路并发，如果每路各自 login，会互相把刚发的票据顶掉 —— 表现就是"怎么重试都失败"。
 */
let refreshing: Promise<Session> | null = null;
function reloginOnce(s: Session): Promise<Session> {
  if (!refreshing) {
    refreshing = rawLogin(s.userno, s.password)
      .then((fresh) => {
        saveSession(fresh);
        return fresh;
      })
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

/** 所有业务调用都过这里：自动补 EMPID，会话失效自动重登一次再重试 */
async function biz(service: string, params: Record<string, unknown> = {}, retry = true): Promise<any> {
  const s = needSession();
  try {
    return await call(
      service,
      { ...params, EMPID: s.empid },
      { token: s.token, userid: s.userid },
    );
  } catch (e) {
    if (!retry || !isStale(e)) throw e;
    await reloginOnce(s);
    return biz(service, params, false);
  }
}

/** 少数不带 EMPID 的接口（公告等），同样享受失效自动换票 */
async function callAuth(service: string, params: Record<string, unknown> = {}): Promise<any> {
  const s = needSession();
  try {
    return await call(service, params, { token: s.token, userid: s.userid });
  } catch (e) {
    if (!isStale(e)) throw e;
    const fresh = await reloginOnce(s);
    return call(service, params, { token: fresh.token, userid: fresh.userid });
  }
}

/* ---------------------------------------------------------------- 字段归一 */

function pickAmount(r: any): number {
  const v = r?.amount ?? r?.amount2 ?? r?.AMOUNT ?? r?.AMOUNT2 ?? r?.tranamt ?? r?.TRANAMT ?? r?.money;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeRows(rows: any[]): Row[] {
  return (rows || []).map((r, i) => {
    const title =
      r?.transname ||
      r?.transCodeName ||
      r?.transtypename ||
      r?.merchantname ||
      r?.itemname ||
      r?.remark ||
      r?.paytype ||
      "消费";
    const deviceno = r?.deviceno || r?.deviceNo || "";
    const sceneRaw =
      r?.marketName ||
      r?.merchantname ||
      r?.devname ||
      r?.roomname ||
      r?.address ||
      r?.memo ||
      (deviceno ? `设备 ${deviceno}` : "");
    // 场景与标题重复时清空，避免出现「直饮水扣费直饮水」这种拼接
    // 上游对线上充值记的商户名就是「未知」，也别当场景显示
    const sceneText = /^(未知|空|null|undefined|-|--)$/i.test(String(sceneRaw ?? "").trim()) ? "" : sceneRaw;
    const scene =
      !sceneText || sceneText === title || String(title).includes(String(sceneText)) ? "" : sceneText;
    const amount = pickAmount(r);
    const balanceRaw = r?.accountvalue ?? r?.cardValue ?? r?.ACCOUNTVALUE ?? r?.balance;
    return {
      id: String(r?.eaccountdataId ?? r?.id ?? `${i}-${title}`),
      title: String(title),
      scene: String(scene),
      time: String(
        r?.occurtime ||
          r?.occurTime ||
          r?.transdate ||
          r?.TRANSDATE ||
          r?.optime ||
          r?.OPTIME ||
          r?.createdate ||
          r?.CREATEDATE ||
          "",
      ),
      amount,
      balance: Number(balanceRaw ?? 0),
      dir: amount < 0 ? "out" : "in",
      kind: String(r?.transcode ?? r?.transCode ?? r?.datatype ?? r?.DATATYPE ?? ""),
      raw: r,
    };
  });
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysAgo = (n: number) => ymd(new Date(Date.now() - n * 86400000));
const monthStart = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
};

/** 公告正文是 Word 导出的 GBK HTML，用 DOMParser 解实体、按块级元素补换行 */
function htmlToText(html: string): string {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("style,script,meta,link,title").forEach((n) => n.remove());
  const out: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out.push(node.nodeValue || "");
      return;
    }
    const el = node as HTMLElement;
    const tag = (el.tagName || "").toLowerCase();
    if (tag === "br") {
      out.push("\n");
      return;
    }
    const block = /^(p|div|li|tr|h[1-6]|table|section|blockquote)$/.test(tag);
    if (block) out.push("\n");
    el.childNodes.forEach(walk);
    if (block) out.push("\n");
  };
  walk(doc.body);
  return out
    .join("")
    .replace(/[\u200b\u00a0\u3000]/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ------------------------------------------------------------------- 领域接口 */

async function balance(s: Session): Promise<Balance> {
  return (await biz("getEAcountNum", { EACCOUNTID: s.eaccountid })) as Balance;
}

async function cardStatus(s: Session) {
  return biz("getCardStatus", {});
}

async function waterDevice(s: Session): Promise<{ deviceno: string | null }> {
  const r = await biz("getWaterSetByEmp", {});
  const item = r?.item ?? r;
  const no = item?.data?.deviceno || item?.deviceno || null;
  return { deviceno: no };
}

async function topNotices(): Promise<{ ID: string; TITLE: string; MODIFYTIME: string }[]> {
  const r = await callAuth("getTopNotice", {});
  const item = r?.item ?? r;
  if (Array.isArray(item)) return item;
  return item ? [item] : [];
}

async function noticeInfo(id: string) {
  // 上游约 1/3 概率返回空 item，重试几次
  let r: any = null;
  for (let i = 0; i < 4; i += 1) {
    r = await biz("getNoticeInfo", { NOTICEID: id });
    if (r?.item) break;
  }
  const item = r?.item || {};
  const stamp = item?.modifyTime?.time ?? item?.modifyTime ?? item?.MODIFYTIME ?? "";
  return {
    id: String(item?.id ?? item?.ID ?? id),
    title: String(item?.title ?? item?.TITLE ?? ""),
    time: stamp ? String(stamp) : "",
    editor: String(item?.editor ?? ""),
    text: htmlToText(String(item?.attachment ?? item?.content ?? "")),
  };
}

async function transactions(page = 1, size = 20, sdate?: string, edate?: string) {
  const from = sdate || daysAgo(30);
  const to = edate || ymd(new Date());
  const r = await biz("getEAccountData", {
    STARTTIME: from,
    ENDTIME: to,
    PAGESIZE: size,
    PAGENO: page,
  });
  const item = r?.item ?? {};
  const list: any[] = item?.list || [];
  return {
    page: Number(item?.pageNo ?? page),
    pageCount: Number(item?.pageCount ?? 1),
    total: Number(item?.rowCount ?? list.length),
    rows: normalizeRows(list),
    range: { from, to },
  };
}

/**
 * 食堂 / 超市的聚合支付流水（queryEmpAggPayData）。
 * 原版 App 没做这个接口；只认 SDATE/EDATE，STARTTIME/ENDTIME 会被静默忽略并返回全量。
 */
async function canteenImpl(page = 1, size = 20, sdate?: string, edate?: string) {
  const from = sdate || daysAgo(365);
  const to = edate || ymd(new Date());
  const r = await biz("queryEmpAggPayData", {
    SDATE: from,
    EDATE: to,
    PAGESIZE: size,
    PAGENO: page,
    TYPE: "",
  });
  const item = r?.item ?? {};
  const list: any[] = item?.list || [];
  return {
    page: Number(item?.pageNo ?? page),
    pageCount: Number(item?.pageCount ?? 1),
    total: Number(item?.rowCount ?? list.length),
    range: { from, to },
    rows: list.map((x: any) => ({
      id: String(x.ID ?? ""),
      title: x.MARKETNAME || "食堂消费",
      scene: x.TYPESTR || "",
      time: x.OCCURTIME || "",
      // 与 getEAccountData 口径一致：支出记负数，账单页的汇总与配色才统一
      amount: -Math.abs(Number(x.AMOUNT ?? 0)),
      balance: undefined,
      dir: "out" as const,
      kind: `agg-${x.TYPE ?? ""}`,
      raw: x,
    })),
  };
}
async function payments(page = 1, size = 20, datatype = 1) {
  const r = await biz("getPaymentMessage", { DATATYPE: datatype, PAGENO: page, PAGESIZE: size });
  const item = r?.item ?? {};
  const list: any[] = item?.list || [];
  const num = (v: unknown) => Number(String(v ?? 0).replace(/[^\d.-]/g, "")) || 0;
  return {
    page: Number(item?.pageNo ?? page),
    pageCount: Number(item?.pageCount ?? 1),
    total: Number(item?.rowCount ?? list.length),
    rows: list.map((x) => {
      const name = String(x.executespanname || x.EXECUTESPANNAME || "");
      const fee = String(x.financingname || x.FINANCINGNAME || "");
      const amount = num(x.receivableamount ?? x.RECEIVABLEAMOUNT ?? x.amount);
      const paid = num(x.amount2 ?? x.AMOUNT2);
      const status = String(x.typename || x.TYPENAME || "");
      const elec = /电费/.test(fee) || /[舍室]$/.test(name);
      return {
        id: String(x.receivableaccountid ?? ""),
        title: name || fee || "应缴费用",
        fee,
        room: elec ? name : "",
        time: String(x.createdate || ""),
        amount,
        paid,
        status,
        done: status.includes("已缴") || (amount > 0 && paid >= amount),
        elec,
        raw: x,
      };
    }),
  };
}

async function openWater(deviceno: string) {
  const scan = await biz("scanning4GWaterValve", { DEVICENO: deviceno });
  const ordersn = scan?.item?.data?.id || scan?.item?.id || null;
  if (!ordersn) {
    throw new UpstreamError(scan?.item?.message || scan?.message || "开阀失败，请确认设备号", "NO_ORDERSN");
  }
  const confirm = await biz("createorderissuccess4GWaterValve", { ORDERSN: ordersn });
  return { ordersn: String(ordersn), confirmed: confirm?.status === 0, raw: { scan, confirm } };
}

async function closingOrders() {
  return biz("queryClosingOrder", {});
}

async function settleWater(ordersn: string) {
  return biz("activesetttleaccounts4GWaterValve", { ORDERSN: ordersn });
}

async function waterHistory(page = 1, size = 10) {
  const r = await biz("query4GWaterValvePage", {
    TRANSCODE: "",
    ACCOUNTTYPE: 2,
    PAGE: page,
    PAGESIZE: size,
    STARTTIME: daysAgo(90),
    ENDTIME: ymd(new Date()),
  });
  const data = r?.item?.data ?? r?.item ?? {};
  return {
    rows: normalizeRows(data?.records || []),
    current: Number(data?.current ?? page),
    pages: Number(data?.pages ?? 1),
  };
}

async function elecBuildings() {
  return biz("getElectricityBuilding", { TYPE: 1 });
}
async function elecFloors(buildno: string) {
  return biz("getElectricityFloor", { BUILDNO: buildno });
}
async function elecRooms(buildno: string, floor: string) {
  return biz("getElectricityRoom", { ARCHITECTUREID: buildno, FLOOR: floor });
}
async function elecRoom(allroomno: string) {
  return biz("queryRoomEleByAllroomno", { ALLROOMNO: allroomno });
}
async function elecRecharge(amount: number, roomno: string) {
  const s = needSession();
  return biz("rechargeRoomEle", {
    AMOUNT: Number(amount).toFixed(2),
    USECOUNT: 0,
    CARDVALUE: 0,
    TYPE: 1,
    ROOMNO: roomno,
    DEVICENO: await cardNo(s),
  });
}

/** 卡号（部分接口的 DEVICENO 其实是校园卡号） */
async function cardNo(s: Session): Promise<string> {
  try {
    const r = await cardStatus(s);
    const item = r?.item ?? {};
    return String(item.cardid ?? item.CARDID ?? "");
  } catch {
    return "";
  }
}

async function reportCard(lost: boolean) {
  const s = needSession();
  return biz("reportCard", { CARDSTATUS: lost ? 4 : 0, USERNO: s.userno, DEVICENO: await cardNo(s) });
}

async function operatekey(): Promise<string> {
  const r = await biz("newOperatekey", {});
  const item = r?.item;
  const key = typeof item === "string" ? item : item?.operatekey || item?.OPERATEKEY || "";
  if (!key) throw new UpstreamError(r?.message || "获取支付凭证失败，请重试", "NO_OPERATEKEY");
  return String(key);
}

async function payOnline(channel: "wechat" | "alipay", amount: number) {
  const s = needSession();
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) throw new UpstreamError("请输入有效的充值金额", "BAD_PARAM");
  const key = await operatekey();
  const r = await biz(channel === "alipay" ? "startAlipayRecharge" : "startWeiXinRecharge", {
    AMOUNT: amt.toFixed(2),
    DEVICENO: await cardNo(s),
    OPERATEKEY: key,
    USERNO: s.userno,
    DESTINATION: 6,
  });
  if (r?.status !== 0) throw new UpstreamError(r?.message || "生成支付订单失败", "PAY_ORDER_FAIL");
  return { channel, amount: amt.toFixed(2), item: r.item, message: r.message };
}

async function payBill(receivableaccountid: string, amount: number) {
  const s = needSession();
  const amt = Number(amount);
  const key = await operatekey();
  const r = await biz("setPaymentById", {
    RECEIVABLEACCOUNTID: receivableaccountid,
    AMOUNT: amt.toFixed(2),
    USERNO: s.userno,
    EACCOUNTID: s.eaccountid,
    DEVICENO: await cardNo(s),
    OPERATEKEY: key,
  });
  return { ok: r?.status === 0, status: r?.status, message: r?.message || "", raw: r };
}

/**
 * 支付绑定状态。
 * getWithdrawalChannel 本是提现渠道接口，但顺带返回微信 openid / 支付宝 userid，
 * 是唯一能读到「绑没绑」的入口，所以复用它。
 */
async function bindStatus() {
  const res = await biz("getWithdrawalChannel", {});
  const it = (res?.item || {}) as Record<string, string>;
  return {
    name: it.name || "",
    employeeno: it.employeeNO || "",
    wechat: { bound: !!it.appOpenId, nickname: it.appnickname || "", id: it.appOpenId || "" },
    alipay: { bound: !!it.alipayuserid, nickname: it.alipaynickname || "", id: it.alipayuserid || "" },
  };
}

/** 支付宝授权参数串（喂给原生 AuthTask.auth） */
async function alipayAuth() {
  const res = await biz("getAlipaySign", {});
  const info = res?.item;
  if (!info || typeof info !== "string") throw new UpstreamError("未取到支付宝授权参数", "NO_AUTH_INFO");
  return { authInfo: info };
}

/** 用 authCode 换支付宝账号并绑定 */
async function alipayBind(code: string) {
  const c = String(code || "").trim();
  if (!c) throw new UpstreamError("缺少授权码", "BAD_PARAM");
  const r1 = await biz("getAliPayUserInfo", { CODE: c });
  const it = (r1?.item || {}) as Record<string, string>;
  const userid = it.userId || it.userid || it.ALIPAYUSERID || it.alipayuserid || it.userID;
  if (!userid) throw new UpstreamError(r1?.message || "未取到支付宝账号", "NO_ALIPAY_USER");
  const nickname = it.nickName || it.nickname || it.ALIPAYNICKNAME || it.alipaynickname || "";
  const r2 = await biz("setEmpAlipayInfo", {
    ALIPAYUSERID: String(userid),
    ALIPAYNICKNAME: String(nickname),
  });
  return {
    ok: r2?.status === 0,
    userid: String(userid),
    nickname: String(nickname),
    message: r2?.message || "",
  };
}

/** 主动缴费第 1 步：按设备号查商户 */
async function deviceInfo(deviceno: string) {
  const no = String(deviceno || "").trim();
  if (!/^\d{6,20}$/.test(no)) throw new UpstreamError("设备号应为 6~20 位数字", "BAD_PARAM");
  const res = await biz("queryDeviceInfo", { DEVICENO: no });
  if (res?.status !== 0 || !res.item) {
    throw new UpstreamError(res?.message || "没有对应的设备详情", "NO_DEVICE");
  }
  return res.item as {
    AREANAME?: string;
    MARKETNAME?: string;
    DEVICENAME?: string;
    DEVICENO?: string;
    DEVICEMODEL?: string;
  };
}

/** 主动缴费第 2 步：向该商户付款（上游不接收密码，扣卡内余额，调用方须二次确认） */
async function payInitiative(deviceno: string, amount: number) {
  const no = String(deviceno || "").trim();
  if (!/^\d{6,20}$/.test(no)) throw new UpstreamError("设备号应为 6~20 位数字", "BAD_PARAM");
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) throw new UpstreamError("缴费金额不合法", "BAD_PARAM");
  const s = needSession();
  const res = await biz("payInitiative", {
    AMOUNT: amt.toFixed(2),
    DEVICENO: no,
    EACCOUNTID: s.eaccountid,
  });
  if (res?.status !== 0) throw new UpstreamError(res?.message || "缴费失败", "PAY_FAIL");
  const it = (res.item || {}) as Record<string, string>;
  return {
    ok: true,
    market: it.MARKETNAME || "",
    amount: it.AMOUNT || amt.toFixed(2),
    message: res.message || "",
  };
}

async function setPwdCheck(status: 0 | 1) {
  const s = needSession();
  return biz("setIsOpenPwdCheck", {
    EACCOUNTID: s.eaccountid,
    STATUS: status,
    USERNO: s.userno,
    DEVICENO: await cardNo(s),
  });
}

async function checkPwd(pwd: string) {
  const s = needSession();
  const r = await biz("checkPayPassword", {
    ACCOUNTID: s.eaccountid,
    EACCOUNTID: s.eaccountid,
    PWD: pwd,
  });
  return { ok: r?.item === "true" || r?.item === true, raw: r };
}

async function paycode() {
  const s = needSession();
  return biz("getTransKey", { DEVICENO: await cardNo(s), ACCOUNTID: s.eaccountid });
}

async function paycodeResult(qrcode: string) {
  const s = needSession();
  return biz("getPayResult", { QRCODE: qrcode, ACCOUNTID: s.eaccountid, DEVICENO: await cardNo(s) });
}

async function home(): Promise<HomeData> {
  const s = needSession();
  const today = ymd(new Date());
  // 本月流水单独处理：上游单页上限 100 条（传 200 也只回 100），
  // 而「本月支出」必须是整月合计——只算第 1 页会严重偏低（11 月前 50 笔 ¥5.69，整月 ¥90.81）。
  const flowReq = (pg: number) =>
    biz("getEAccountData", {
      STARTTIME: monthStart(),
      ENDTIME: today,
      PAGESIZE: 100,
      PAGENO: pg,
    });

  const [bal, alert, nt, card, wd, f1, f2] = await Promise.allSettled([
    balance(s),
    callAuth("getAlertMessage", { EMPID: s.empid }),
    callAuth("getTopNotice", {}),
    cardStatus(s),
    waterDevice(s),
    flowReq(1),
    flowReq(2),
  ]);

  let rows: Row[] = [];
  let pageCount = 1;
  if (f1.status === "fulfilled") {
    rows = normalizeRows(f1.value?.item?.list || []);
    pageCount = Number(f1.value?.item?.pageCount ?? 1);
    if (pageCount > 1 && f2.status === "fulfilled") {
      rows = rows.concat(normalizeRows(f2.value?.item?.list || []));
    }
    // 极少数月份超过两页时再补（正常不会走到这里）
    for (let pg = 3; pg <= pageCount && pg <= 20; pg++) {
      try {
        const more = await flowReq(pg);
        rows = rows.concat(normalizeRows(more?.item?.list || []));
      } catch {
        break;
      }
    }
  }

  const spendRows = rows.filter((r) => r.amount < 0);
  const monthSpend = Math.round(spendRows.reduce((a, b) => a + Math.abs(b.amount), 0) * 100) / 100;

  const ntItem = nt.status === "fulfilled" ? nt.value?.item ?? nt.value : null;
  const notices = Array.isArray(ntItem) ? ntItem : ntItem ? [ntItem] : [];

  return {
    balance: bal.status === "fulfilled" ? (bal.value as Balance) : null,
    balanceError: bal.status === "rejected" ? (bal.reason as Error)?.message || "余额查询失败" : null,
    alert: alert.status === "fulfilled" ? alert.value : null,
    notices,
    card: card.status === "fulfilled" ? card.value : null,
    waterDevice: wd.status === "fulfilled" ? wd.value.deviceno : null,
    recent: rows.slice(0, 5),
    monthSpend,
    monthSpendCount: spendRows.length,
    monthSpendPartial: pageCount > 1,
  };
}

function publicUser(s: Session): SessionUser {
  const features: UserFeature[] = (s.itemlist || []).map((x: any, i: number) => {
    const alias = String(x?.itemalias ?? x?.alias ?? "");
    return {
      alias,
      name: FEATURE_NAME[alias] || String(x?.itemname ?? alias),
      type: Number(x?.type ?? 0),
      status: Number(x?.status ?? 0),
      orderid: Number(x?.orderid ?? i),
    };
  });
  return {
    userno: s.userno,
    name: s.name,
    empno: s.empno,
    empid: s.empid,
    userid: s.userid,
    eaccountid: s.eaccountid,
    avatar: s.avatar,
    features,
    loginAt: s.loginAt,
  };
}

/* ---------------------------------------------------------------- 对外接口 */

export const Direct = {
  async login(userno: string, password: string) {
    if (!userno || !password) throw new UpstreamError("请输入统一认证码和密码", "BAD_PARAM");
    if (loading) throw new UpstreamError("正在登录，请稍候", "BUSY");
    loading = true;
    try {
      const s = await rawLogin(userno.trim(), password);
      saveSession(s);
      return { sid: s.token, user: publicUser(s) };
    } finally {
      loading = false;
    }
  },

  async logout() {
    saveSession(null);
    return { ok: true };
  },

  async me(): Promise<SessionUser> {
    const s = needSession();
    if (!s.avatar) {
      const url = await fetchAvatar(s.userno);
      if (url) {
        s.avatar = url;
        saveSession(s);
      }
    }
    return publicUser(s);
  },

  home,
  async balance(): Promise<Balance> {
    return balance(needSession());
  },
  card: async () => cardStatus(needSession()),
  reportCard,
  transactions,
  canteen: canteenImpl,
  payments,
  waterDevice: async () => waterDevice(needSession()),
  openWater,
  waterOrders: closingOrders,
  settleWater,
  waterHistory,
  elecBuildings,
  elecFloors,
  elecRooms,
  elecRoom,
  elecRecharge,
  paycode,
  paycodeResult,
  checkPwd,
  payOnline,
  payBill,
  notices: topNotices,
  noticeInfo,
  setPwdCheck,
  bind: bindStatus,
  alipayAuth,
  alipayBind,
  device: deviceInfo,
  payInitiative,
  /** 仅本地用：暴露是否已有会话，供 store 启动判断 */
  hasSession: () => !!loadSession(),
};
