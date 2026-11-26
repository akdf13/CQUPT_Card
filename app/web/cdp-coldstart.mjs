/**
 * 真机冷启动压测：每轮清空本地缓存（保留登录态）后重载，统计并发请求的表现
 * 用法：node cdp-coldstart.mjs [轮数] [端口] [--expire]
 *   --expire  每轮先把 token 改成失效值，逼出「会话过期 → 重新登录」路径
 */
const rounds = Number(process.argv[2] || 5);
const port = process.argv[3] || "9224";
const expire = process.argv.includes("--expire");
const chaos = Number(process.env.CHAOS || 0);

const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
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
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  }
});
await new Promise((r) => ws.addEventListener("open", r));

const HOOK = `(function(){ window.__CR = ${chaos};
  window.__gw = [];
  var open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send;
  var CHAOS = window.__CR || 0;
  XMLHttpRequest.prototype.open = function(m, u){
    this.__u = String(u||'');
    if (CHAOS > 0 && this.__u.indexOf('appEntrance') >= 0 && Math.random() < CHAOS) { this.__timeout = 1; this.timeout = 1; window.__chaosHits = (window.__chaosHits||0)+1; }
    return open.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function(){
    var x = this, t0 = Date.now();
    if (CHAOS > 0 && (x.__u || '').indexOf('appEntrance') >= 0 && Math.random() < CHAOS) {
      x.timeout = 1;
      window.__chaosHits = (window.__chaosHits || 0) + 1;
    }
    this.addEventListener('loadend', function(){
      var u = x.__u || '';
      if (u.indexOf('appEntrance') < 0) return;
      var body = '';
      try { body = (x.responseType === 'arraybuffer') ? '[bin]' : (x.responseText || ''); } catch(e){ body = '[unreadable]'; }
      var isBin = (body === '[bin]');
      var act = u.indexOf('newid') >= 0 ? 'newid' : (u.indexOf('getPhotoImg') >= 0 ? 'photo' : 'gateway');
      var okFlag = isBin ? true : (/^\\s*\\[\\s*\\{/.test(body) || /^\\s*\\{/.test(body));
      var suspicious = isBin && x.status === 200 && (x.response ? x.response.byteLength : 0) < 64;
      window.__gw.push({
        ms: Date.now() - t0, status: x.status, len: isBin ? (x.response ? x.response.byteLength : 0) : body.length,
        ok: okFlag && !suspicious, head: isBin ? ('[bin ' + (x.response ? x.response.byteLength : 0) + 'B]') : body.slice(0, 90).replace(/\\s+/g, ' '),
        act: act
      });
    });
    return send.apply(this, arguments);
  };
})();`;

await call("Page.enable");
await call("Page.addScriptToEvaluateOnNewDocument", { source: HOOK });


const evalJs = async (expr) => {
  const r = await call("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result?.value;
};

let totalReq = 0;
let totalBad = 0;
const slowest = [];
const badSamples = [];

for (let i = 1; i <= rounds; i++) {
  await evalJs(`(function(){
    Object.keys(localStorage).forEach(function(k){ if (k.indexOf('cqupt.cache.') === 0 || k === 'cqupt.badResponses') localStorage.removeItem(k); });
    ${expire ? `try{ var s = JSON.parse(localStorage.getItem('cqupt.session')||'{}'); if(s.token){ s.token='deadbeefdeadbeef'; localStorage.setItem('cqupt.session', JSON.stringify(s)); } }catch(e){}` : ""}
    return 'prepared';
  })()`);

  await call("Page.reload", { ignoreCache: false });
  await new Promise((r) => setTimeout(r, 8000));

  const res = await evalJs(
    `JSON.stringify({ hash: location.hash, log: window.__gw || [], toast: (document.querySelector('.toast')||{}).textContent||'', amt: (document.querySelector('.bc-amount')||{}).textContent||'', empty: (document.querySelector('.empty-title')||{}).textContent||'' })`,
  );
  const d = JSON.parse(res || "{}");
  const log = d.log || [];
  const bad = log.filter((x) => !x.ok);
  totalReq += log.length;
  totalBad += bad.length;
  const maxMs = log.reduce((a, b) => Math.max(a, b.ms), 0);
  slowest.push(maxMs);
  for (const b of bad) badSamples.push(b);

  console.log(
    `第 ${String(i).padStart(2)} 轮  ${String(log.length).padStart(2)} 请求 / ${bad.length} 异常  最慢 ${String(maxMs).padStart(5)}ms  余额=${d.amt || "-"}  ${d.toast ? "toast=" + d.toast.slice(0, 40) : ""}${d.empty ? " 空态=" + d.empty.slice(0, 20) : ""}`,
  );
  if (bad.length) {
    for (const b of bad) console.log(`      BAD ${b.status} ${b.len}B ${b.ms}ms ${b.head}`);
  }
}

console.log(`\n=== 汇总 ${rounds} 轮 ===`);
console.log(`请求总数 ${totalReq}，异常 ${totalBad}（${((totalBad / Math.max(1, totalReq)) * 100).toFixed(1)}%）`);
console.log(`最慢单次: ${slowest.map((x) => x + "ms").join(", ")}`);
if (badSamples.length) {
  console.log("异常样本（去重后前 5 条）：");
  const seen = new Set();
  for (const b of badSamples) {
    const k = b.status + "|" + b.head.slice(0, 40);
    if (seen.has(k)) continue;
    seen.add(k);
    console.log(`  ${b.status} ${b.len}B ${b.head}`);
    if (seen.size >= 5) break;
  }
}
ws.close();
