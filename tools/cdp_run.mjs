// Headless Chrome'u Chrome DevTools Protocol (CDP) ile sürer. Bağımlılık YOK: Node 24'ün yerleşik fetch + WebSocket'i.
// Kullanım:
//   node cdp_run.mjs capture <url> <kare_klasörü> <kare_sayısı> <log>   → window.frame() + Page.captureScreenshot (PNG)
//   node cdp_run.mjs realtime <url> <saniye> <log>                    → gerçek zamanlı ?auto=1, konsolu toplar (fps)
// Chrome önceden --remote-debugging-port=$CDP_PORT ile açılmış olmalı.
import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs';

const PORT = process.env.CDP_PORT || '9333';
const [mode, url, ...rest] = process.argv.slice(2);
const logFile = rest[rest.length - 1];
writeFileSync(logFile, '');
const out = s => { appendFileSync(logFile, s + '\n'); console.log(s); };

const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const pending = new Map();
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const { r, j } = pending.get(m.id); pending.delete(m.id); m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result); }
  else if (m.method === 'Runtime.consoleAPICalled') out(m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
  else if (m.method === 'Runtime.exceptionThrown') out('[HATA] ' + JSON.stringify(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  else if (m.method === 'Network.responseReceived') net.set(m.params.requestId, { url: m.params.response.url, status: m.params.response.status });
  else if (m.method === 'Network.loadingFinished') { const n = net.get(m.params.requestId); if (n) n.bytes = m.params.encodedDataLength; }
};
const net = new Map();
const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; pending.set(i, { r, j }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;

await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 1080, height: 1080, deviceScaleFactor: 1, mobile: false });
const tNav = Date.now();
await send('Page.navigate', { url });
while (!(await evalJs('window.__ready === true').catch(() => false))) await new Promise(r => setTimeout(r, 20));
out(`[cdp] sayfa + GLB hazır: ${Date.now() - tNav} ms (navigate → window.__ready, önbellek kapalı)`);
const nav = await evalJs(`JSON.stringify(performance.getEntriesByType('navigation').map(e=>({dcl:Math.round(e.domContentLoadedEventEnd),load:Math.round(e.loadEventEnd)})))`);
out(`[cdp] navigation timing: ${nav}`);
let total = 0;
for (const n of net.values()) { total += n.bytes || 0; out(`[cdp] ağ: ${n.status} ${(n.bytes || 0)} bayt ${n.url.replace(/^https?:\/\/[^/]+/, '')}`); }
out(`[cdp] ağ toplamı: ${total} bayt (${(total / 1024 / 1024).toFixed(2)} MiB, aktarılan)`);

if (mode === 'capture') {
  const [dir, nStr] = rest;
  const n = parseInt(nStr, 10);
  mkdirSync(dir, { recursive: true });
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    // window.frame(): sanal saati 2 × 1/60 sn ilerletir + çizer; sonra DOM (tuş göstergesi) boyansın diye 2 rAF bekle
    await evalJs('window.frame(2), new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
    const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    writeFileSync(`${dir}/f_${String(i + 1).padStart(4, '0')}.png`, Buffer.from(shot.data, 'base64'));
  }
  out(`[cdp] ${n} kare yakalandı, ${((Date.now() - t0) / 1000).toFixed(1)} sn (${((Date.now() - t0) / n).toFixed(0)} ms/kare)`);
} else {
  const secs = parseFloat(rest[0]);
  const t0 = Date.now();
  while (Date.now() - t0 < secs * 1000 && !(await evalJs('window.__fpsDone === true'))) await new Promise(r => setTimeout(r, 200));
  out(`[cdp] gerçek zamanlı koşu bitti (${((Date.now() - t0) / 1000).toFixed(1)} sn)`);
}
await send('Target.closeTarget', { targetId: target.id }).catch(() => {});
ws.close();
process.exit(0);
