/**
 * 真机遍历各页面，收集网关响应并找出非 JSON
 * 用法：node cdp-walk.mjs [9224]
 */
const PORT = process.argv[2] || "9224";

const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const page = list.find((p) => p.type === "page") || list[0];
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const call = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
});
await new Promise((r) => ws.addEventListener("open", r));

const HOOK = `(function(){
  if (window.__gwHooked) return; window.__gwHooked = true;
  window.__gwLog = [];
  var open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(m, u){ this.__u = u; return open.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function(){
    var self = this;
    this.addEventListener('loadend', function(){
      var u = String(self.__u || '');
      if (u.indexOf('appEntrance') < 0) return;
      var t = '';
      try { t = (self.responseType === 'arraybuffer') ? '[binary]' : (self.responseText || ''); } catch(e){ t = '[unreadable]'; }
      window.__gwLog.push({ t: Date.now(), action: u.split('!').pop(), status: self.status, len: t.length,
        head: t.slice(0, 160), isJson: /^\\s*\\[(\\{|\\])/.test(t.trim()) || /^\\s*\\{/.test(t.trim()) });
    });
    return send.apply(this, arguments);
  };
})();`;

// 注入（若页面已重载过，这里只补一次）
await call("Page.enable");
await call("Page.addScriptToEvaluateOnNewDocument", { source: HOOK });
await call("Runtime.evaluate", { expression: HOOK });
await call("Runtime.evaluate", { expression: "window.__gwLog = []; 'cleared'", returnByValue: true });

const routes = [
  ["#/", "首页"],
  ["#/bills", "账单"],
  ["#/water", "洗澡开水"],
  ["#/electric", "缴电费"],
  ["#/payitems", "其他缴费"],
  ["#/bind", "支付绑定"],
  ["#/card", "我的校园卡"],
  ["#/me", "我的"],
  ["#/", "首页(回)"],
];

for (const [hash, name] of routes) {
  await call("Runtime.evaluate", { expression: `location.hash = ${JSON.stringify(hash)}; 'ok'`, returnByValue: true });
  await new Promise((r) => setTimeout(r, 2600));
  const r = await call("Runtime.evaluate", {
    expression: `JSON.stringify({hash: location.hash, toast: document.querySelector('.toast') ? document.querySelector('.toast').textContent : '', err: document.querySelector('.err-card') ? document.querySelector('.err-card').textContent.slice(0,80) : ''})`,
    returnByValue: true,
  });
  const s = JSON.parse(r.result.value);
  console.log(`→ ${name.padEnd(8)} ${s.hash}  toast=${s.toast || "-"}  err=${s.err || "-"}`);
}

const res = await call("Runtime.evaluate", {
  expression: `JSON.stringify(window.__gwLog || [])`,
  returnByValue: true,
});
const log = JSON.parse(res.result.value);
const bad = log.filter((x) => !x.isJson);
console.log(`\n共 ${log.length} 次网关调用，非 JSON ${bad.length} 次`);
for (const x of log) {
  console.log(`  ${x.isJson ? "ok " : "BAD"} ${new Date(x.t).toLocaleTimeString()} ${String(x.action).padEnd(26)} ${x.status} ${String(x.len).padStart(6)}B ${x.head.replace(/\s+/g, " ").slice(0, 100)}`);
}
ws.close();
