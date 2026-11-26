import { createServer } from "node:http";
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Local review demo</title><style>body{font:18px system-ui;max-width:700px;margin:60px auto}button,input{font:inherit;padding:10px;margin:8px}</style></head><body><h1>Local review demo</h1><p>Select the button using App Feedback. Selection must not submit the form.</p><form><button type="submit">Save changes</button><label>Password (never captured)<input type="password" value="not-feedback"></label></form><p id="result">No submissions</p><a href="/app/other">Other route</a><script>let count=0;document.querySelector('form').addEventListener('submit',e=>{e.preventDefault();document.getElementById('result').textContent='Submissions: '+(++count);});</script></body></html>`;
createServer((_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(html);
}).listen(4173, "127.0.0.1", () =>
  console.log("Local fixture: http://localhost:4173/app"),
);
