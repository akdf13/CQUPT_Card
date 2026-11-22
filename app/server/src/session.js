import crypto from "node:crypto";

const TTL_MS = 1000 * 60 * 60 * 12; // 会话 12 小时

const sessions = new Map();

export function createSession(payload) {
  const sid = crypto.randomBytes(24).toString("hex");
  const now = Date.now();
  const s = { sid, ...payload, createdAt: now, lastSeen: now };
  sessions.set(sid, s);
  return s;
}

export function getSession(sid) {
  if (!sid) return null;
  const s = sessions.get(sid);
  if (!s) return null;
  if (Date.now() - s.lastSeen > TTL_MS) {
    sessions.delete(sid);
    return null;
  }
  s.lastSeen = Date.now();
  return s;
}

export function dropSession(sid) {
  sessions.delete(sid);
}

export function touchUpstream(session, loginResult) {
  const item = loginResult?.item || {};
  const emp = item.empvo || {};
  session.token = item.tokenId || session.token;
  session.userid = item.userid ?? session.userid;
  session.empid = emp.empId ?? session.empid;
  session.eaccountid = emp.eAccountId ?? session.eaccountid;
  session.empno = emp.empNo || session.empno;
  session.name = emp.name || session.name;
  session.tel = emp.tel || session.tel;
  session.userno = item.userno || session.userno;
  session.itemlist = item.itemlist || session.itemlist;
  session.login = item;
  return session;
}

/** 供前端使用的安全视图（绝不含 token / 密码） */
export function publicSession(s) {
  return {
    userno: s.userno,
    name: s.name,
    empno: s.empno,
    empid: s.empid,
    userid: s.userid,
    eaccountid: s.eaccountid,
    avatar: s.avatar || null,
    features: (s.itemlist || []).map((x) => ({
      alias: x.itemalias,
      name: x.itemname,
      type: x.itemtype,
      status: x.status,
      orderid: x.orderid,
    })),
    loginAt: s.createdAt,
  };
}
