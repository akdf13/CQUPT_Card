/**
 * 真机 WebView 抓包：hook XHR，记录每次网关调用的状态码 / 长度 / 前 120 字符
 * 用法：node cdp-hook.mjs [9224]
 */
const PORT = process.argv[2] || "9224";

const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const page = list.find((p) => p.type === "page" && /index\.html|cqupt/.test(p.url + p.title)) || list[0];
if (!page) {
  console.log("没有找到 WebView 页面");
  process.exit(1);
}
console.log("target:", page.title, page.url);

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
  XMLHttpRequest.prototype.open = function(m,u){ this.__u = u; return open.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function(){
    var self = this;
    this.addEventListener('loadend', function(){
      var t = '';
      try { t = self.responseType === 'arraybuffer' ? '[binary]' : (self.responseText || ''); } catch(e){ t = '[unreadable]'; }
      if (String(self.__u||'').indexOf('appEntrance') < 0) return;
      window.__gwLog.push({
        t: Date.now(), action: String(self.__u||'').split('!').pop(), status: self.status,
        len: t.length, head: t.slice(0, 140), isJson: /^\\s*\\[?\\{/.test(t)
      });
    });
    return send.apply(this, arguments);
  };
  var of = window.fetch;
  window.fetch = function(input, init){
    var url = String(input && input.url ? input.url : input);
    return of.apply(this, arguments).then(function(res){
      if (url.indexOf('appEntrance') >= 0) {
        var c = res.clone();
        c.text().then(function(t){
          window.__gwLog.push({ t: Date.now(), action: url.split('!').pop(), status: res.status, len: t.length, head: t.slice(0,140), isJson: /^\\s*\\[?\\{/.test(t) });
        }).catch(function(){});
      }
      return res;
    });
  };
})();`;

await call("Page.enable");
await call("Page.addScriptToEvaluateOnNewDocument", { source: HOOK });
console.log("hook 已注入，重载页面…");
await call("Page.reload", { ignoreCache: false });
await new Promise((r) => setTimeout(r, 9000));

const res = await call("Runtime.evaluate", {
  expression: `JSON.stringify({url: location.hash, log: window.__gwLog || [], err: (document.querySelector('.toast')||{}).textContent || ''})`,
  returnByValue: true,
  awaitPromise: true,
});
const data = JSON.parse(res.result.value);
console.log("当前路由:", data.url);
console.log("toast:", data.err || "(无)");
console.log(`网关调用 ${data.log.length} 次：`);
const bad = data.log.filter((x) => !x.isJson);
for (const x of data.log) {
  const flag = x.isJson ? "ok " : "BAD";
  console.log(`  ${flag} ${new Date(x.t).toLocaleTimeString()} ${x.action.padEnd(22)} HTTP ${x.status} ${String(x.len).padStart(6)}B  ${x.head.replace(/\s+/g, " ").slice(0, 110)}`);
}
console.log(`\n非 JSON 响应: ${bad.length}${bad.length ? " ← 这就是「格式异常」的来源" : ""}`);
ws.close();
