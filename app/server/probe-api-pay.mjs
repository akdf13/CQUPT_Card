const BASE = "http://127.0.0.1:18900";
const login = await fetch(`${BASE}/api/auth/login`, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userno:process.env.CQUPT_USER || "",password:process.env.CQUPT_PASS || ""})});
const sid = (await login.json()).data.sid;
const r = await fetch(`${BASE}/api/recharge/online`, {method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${sid}`},body:JSON.stringify({channel:"alipay",amount:0.01})});
console.log(JSON.stringify(await r.json()).slice(0, 420));
