import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as svc from "./service.js";
import { UpstreamError } from "./gateway.js";
import { createSession, getSession, dropSession, publicSession } from "./session.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 18900);
const HOST = process.env.HOST || "127.0.0.1";
const DIST = path.resolve(__dirname, "../../web/dist");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

const MAX_BODY = 1024 * 64;

function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(payload);
}

const ok = (res, data, headers) => send(res, 200, { ok: true, data }, headers);
const fail = (res, err) => {
  const code = err?.code || "ERROR";
  const status =
    code === "NEED_LOGIN" || code === "NO_TOKEN"
      ? 401
      : code === "LOGIN_FAIL" || code === "BAD_PARAM"
        ? 400
        : code === "NO_ORDERSN"
          ? 409
          : 502;
  send(res, status, { ok: false, error: { code, message: err?.message || "请求失败" } });
};

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error("请求体过大"), { code: "BAD_PARAM" }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("请求体不是合法 JSON"), { code: "BAD_PARAM" }));
      }
    });
    req.on("error", (e) => reject(e));
  });
}

function auth(req) {
  const h = req.headers.authorization || "";
  let sid = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!sid) sid = String(req.headers["x-sid"] || "");
  if (!sid) {
    try {
      sid = new URL(req.url, "http://localhost").searchParams.get("sid") || "";
    } catch {
      sid = "";
    }
  }
  return getSession(sid);
}

function requireSession(req) {
  const s = auth(req);
  if (!s) throw Object.assign(new Error("请先登录"), { code: "NEED_LOGIN" });
  return s;
}

const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

route("GET", "/api/health", async () => ({ up: true, ts: Date.now() }));

route("POST", "/api/auth/login", async ({ body }) => {
  const userno = String(body.userno || "").trim();
  const password = String(body.password || "").trim();
  if (!userno || !password) throw Object.assign(new Error("学号与密码不能为空"), { code: "BAD_PARAM" });
  const s = await svc.login(userno, password);
  const session = createSession({
    userno: s.userno,
    password: s.password,
    token: s.token,
    userid: s.userid,
    empid: s.empid,
    eaccountid: s.eaccountid,
    empno: s.empno,
    name: s.name,
    tel: s.tel,
    itemlist: s.itemlist,
    login: s.login,
    avatar: s.avatar,
  });
  // 头像稍后回填
  setTimeout(() => {
    const cur = getSession(session.sid);
    if (cur && s.avatar) cur.avatar = s.avatar;
  }, 1200);
  return { sid: session.sid, user: publicSession(session) };
});

route("POST", "/api/auth/logout", async ({ req }) => {
  const s = auth(req);
  if (s) dropSession(s.sid);
  return { done: true };
});

route("GET", "/api/me", async ({ req }) => publicSession(requireSession(req)));

route("GET", "/api/home", async ({ req }) => svc.home(requireSession(req)));
route("GET", "/api/balance", async ({ req }) => svc.balance(requireSession(req)));
route("GET", "/api/card", async ({ req }) => svc.cardStatus(requireSession(req)));
route("POST", "/api/card/report", async ({ req, body }) =>
  svc.reportCard(requireSession(req), Boolean(body.lost))
);

route("GET", "/api/transactions", async ({ req, query }) =>
  svc.transactions(requireSession(req), {
    page: Number(query.page || 1),
    size: Number(query.size || 20),
    sdate: query.sdate,
    edate: query.edate,
  })
);

route("GET", "/api/canteen", async ({ req, query }) =>
  svc.canteen(requireSession(req), {
    page: Number(query.page || 1),
    size: Number(query.size || 20),
    sdate: query.sdate,
    edate: query.edate,
  })
);

route("GET", "/api/payments", async ({ req, query }) =>
  svc.payments(requireSession(req), {
    page: Number(query.page || 1),
    size: Number(query.size || 20),
    datatype: Number(query.datatype || 1),
  })
);

route("GET", "/api/water/device", async ({ req }) => {
  const s = requireSession(req);
  const r = await svc.waterDevice(s);
  return { deviceno: r?.item?.data?.deviceno || r?.item?.deviceno || null, raw: r };
});

route("POST", "/api/water/open", async ({ req, body }) => {
  const s = requireSession(req);
  const deviceno = String(body.deviceno || "").trim();
  if (!/^\d{6,20}$/.test(deviceno)) {
    throw Object.assign(new Error("设备号应为 6–20 位数字"), { code: "BAD_PARAM" });
  }
  return svc.openWater(s, deviceno);
});

route("GET", "/api/water/orders", async ({ req }) => svc.closingOrders(requireSession(req)));

route("POST", "/api/water/settle", async ({ req, body }) => {
  const s = requireSession(req);
  const ordersn = String(body.ordersn || "").trim();
  if (!ordersn) throw Object.assign(new Error("缺少订单号"), { code: "BAD_PARAM" });
  return svc.settleOrder(s, ordersn);
});

route("GET", "/api/water/history", async ({ req, query }) =>
  svc.waterHistory(requireSession(req), {
    page: Number(query.page || 1),
    size: Number(query.size || 10),
  })
);

route("GET", "/api/electric/buildings", async ({ req }) => svc.elecBuildings(requireSession(req)));
route("GET", "/api/electric/floors", async ({ req, query }) =>
  svc.elecFloors(requireSession(req), query.buildno)
);
route("GET", "/api/electric/rooms", async ({ req, query }) =>
  svc.elecRooms(requireSession(req), query.buildno, query.floor)
);
route("GET", "/api/electric/room", async ({ req, query }) =>
  svc.elecRoomInfo(requireSession(req), query.allroomno)
);

route("POST", "/api/electric/recharge", async ({ req, body }) => {
  const s = requireSession(req);
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw Object.assign(new Error("充值金额不合法"), { code: "BAD_PARAM" });
  }
  return svc.elecRecharge(s, { amount: amount.toFixed(2), roomno: body.roomno });
});

route("POST", "/api/payment/pay", async ({ req, body }) => {
  const s = requireSession(req);
  const id = String(body.receivableaccountid || "").trim();
  const amount = Number(body.amount);
  if (!id) throw Object.assign(new Error("缺少账单编号"), { code: "BAD_PARAM" });
  if (!Number.isFinite(amount) || amount <= 0) {
    throw Object.assign(new Error("支付金额不合法"), { code: "BAD_PARAM" });
  }
  return svc.payBill(s, { receivableaccountid: id, amount });
});

route("POST", "/api/recharge/online", async ({ req, body }) => {
  const s = requireSession(req);
  const channel = body.channel === "alipay" ? "alipay" : "wechat";
  return svc.payOnline(s, { channel, amount: body.amount });
});

route("POST", "/api/paycode/password", async ({ req, body }) => {
  const s = requireSession(req);
  const pwd = String(body.pwd || "").trim();
  if (!/^\d{6}$/.test(pwd)) throw Object.assign(new Error("支付密码为 6 位数字"), { code: "BAD_PARAM" });
  return svc.checkPayPassword(s, pwd);
});

route("GET", "/api/paycode", async ({ req }) => {
  const s = requireSession(req);
  return svc.paycode(s);
});

route("GET", "/api/paycode/result", async ({ req, query }) => {
  const s = requireSession(req);
  return svc.paycodeResult(s, query.qrcode);
});

route("GET", "/api/notices", async ({ req }) => {
  const s = requireSession(req);
  return svc.notices(s);
});

route("GET", "/api/notice", async ({ req, query }) => svc.noticeInfo(requireSession(req), query.id));

route("GET", "/api/bind", async ({ req }) => svc.bindStatus(requireSession(req)));

route("GET", "/api/bind/alipay/auth", async ({ req }) => svc.alipayAuth(requireSession(req)));

route("POST", "/api/bind/alipay", async ({ req, body }) =>
  svc.alipayBind(requireSession(req), body.code),
);

route("GET", "/api/device", async ({ req, query }) =>
  svc.deviceInfo(requireSession(req), query.deviceno),
);

route("POST", "/api/pay/initiative", async ({ req, body }) =>
  svc.payInitiative(requireSession(req), {
    deviceno: body.deviceno,
    amount: body.amount,
  }),
);

route("POST", "/api/settings/pwdcheck", async ({ req, body }) => {
  const s = requireSession(req);
  return svc.setPwdCheck(s, Number(body.status) === 1 ? 1 : 0);
});

async function serveStatic(req, res, pathname) {
  if (!fs.existsSync(DIST)) {
    return send(res, 404, { ok: false, error: { code: "NO_BUILD", message: "前端尚未构建" } });
  }
  const clean = decodeURIComponent(pathname.split("?")[0]);
  let file = path.join(DIST, clean === "/" ? "index.html" : clean);
  if (!file.startsWith(DIST)) file = path.join(DIST, "index.html");
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(DIST, "index.html");
  }
  const ext = path.extname(file).toLowerCase();
  const data = fs.readFileSync(file);
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
  });
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  if (!pathname.startsWith("/api/")) {
    try {
      return await serveStatic(req, res, pathname);
    } catch (e) {
      return send(res, 500, { ok: false, error: { code: "STATIC_FAIL", message: String(e) } });
    }
  }

  const hit = routes.find((r) => r.method === req.method && r.pattern === pathname);
  if (!hit) return send(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "接口不存在" } });

  try {
    const body = req.method === "POST" ? await readJson(req) : {};
    const query = Object.fromEntries(url.searchParams);
    const data = await hit.handler({ req, res, body, query });
    return ok(res, data);
  } catch (err) {
    if (err instanceof UpstreamError) return fail(res, err);
    return fail(res, err);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[cqupt-pwa] API listening on http://${HOST}:${PORT}`);
  console.log(`[cqupt-pwa] static dist: ${DIST}`);
});
