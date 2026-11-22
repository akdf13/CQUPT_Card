const list = await (await fetch("http://127.0.0.1:9223/json")).json();
const ws = new WebSocket(list[0].webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0;
function ev(expression) {
  const myId = ++id;
  return new Promise((res, rej) => {
    const h = (m) => { const d = JSON.parse(m.data); if (d.id === myId) { ws.removeEventListener("message", h); res(d.result?.result?.value); } };
    ws.addEventListener("message", h);
    ws.send(JSON.stringify({ id: myId, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
    setTimeout(() => rej(new Error("timeout")), 10000);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await ev("document.querySelector('.bc-pill').click(); 'clicked'");
await sleep(1800);
console.log("hash:", await ev("location.hash"));

// 找支付宝那一行
const payRows = await ev(`JSON.stringify([...document.querySelectorAll('.list-row, .pay-row, .radio-row')].map(e => ({cls: e.className, txt: e.textContent.trim().slice(0, 30)})))`);
console.log("支付行:", payRows);

const clicked = await ev(`(() => {
  const row = [...document.querySelectorAll('*')].find(e => e.children.length <= 3 && /支付宝/.test(e.textContent) && /list-row|pay|radio/.test(e.className));
  if (!row) return 'row not found';
  (row.closest('button') || row).click();
  return 'clicked: ' + row.className;
})()`);
console.log("选支付宝:", clicked);
await sleep(700);

const btn = await ev(`(() => { const b = document.querySelector('.dock button, .dock .btn, button.btn-primary'); if(!b) return 'btn not found'; return b.textContent.trim() + ' | ' + b.className; })()`);
console.log("充值按钮:", btn);
await ev("(() => { const b = document.querySelector('.dock button, .dock .btn, button.btn-primary'); if(b) b.click(); return 'ok'; })()");
await sleep(2500);
console.log("订单状态:", await ev(`(() => { const c = document.querySelector('.order-card'); return c ? c.textContent.trim().replace(/\\s+/g,' ').slice(0,80) : 'no order card'; })()`));
ws.close();
