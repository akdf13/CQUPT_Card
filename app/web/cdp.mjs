// 真机 CDP 小工具：node cdp.mjs "<js 表达式>" [端口，默认 9223]
const expr = process.argv[2];
const port = process.argv[3] || "9223";
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = list.find((t) => t.type === "page") || list[0];
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
ws.send(JSON.stringify({
  id: 1,
  method: "Runtime.evaluate",
  params: { expression: expr, awaitPromise: true, returnByValue: true },
}));
const msg = await new Promise((r) => ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id === 1) r(m);
}));
const out = msg.result?.result?.value ?? msg.result?.result?.description ?? msg;
console.log(typeof out === "string" ? out : JSON.stringify(out, null, 2));
ws.close();