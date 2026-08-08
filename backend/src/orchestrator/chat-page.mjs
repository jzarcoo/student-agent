export const CHAT_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agente Estudiantil UNAM</title>
<style>
  :root { --bg:#0a1628; --panel:#112240; --accent:#006847; --accent2:#ce1126; --text:#eaf1f8; --dim:#8ba3bc; }
  * { box-sizing: border-box; margin: 0; }
  body { background: var(--bg); color: var(--text); font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
         height: 100vh; display: flex; flex-direction: column; }
  header { padding: 14px 20px; background: var(--panel); border-bottom: 2px solid var(--accent); display: flex; align-items: center; gap: 12px; }
  header h1 { font-size: 16px; font-weight: 600; }
  header span { font-size: 12px; color: var(--dim); }
  #log { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 12px; }
  .msg { max-width: 78%; padding: 10px 14px; border-radius: 12px; line-height: 1.5; white-space: pre-wrap; word-wrap: break-word; }
  .user  { align-self: flex-end; background: var(--accent); color: #fff; border-bottom-right-radius: 3px; }
  .agent { align-self: flex-start; background: var(--panel); border-bottom-left-radius: 3px; }
  .tool  { align-self: flex-start; font-size: 12px; color: var(--dim); background: #0d1e35;
           border: 1px solid #1e3a5f; border-radius: 8px; padding: 5px 10px; }
  .error { align-self: flex-start; background: #4a1515; border: 1px solid #a33; color: #ffd7d7;
           font-family: ui-monospace, monospace; font-size: 13px; }
  .sys   { align-self: center; font-size: 12px; color: var(--dim); }
  form { display: flex; gap: 10px; padding: 16px 20px; background: var(--panel); border-top: 1px solid #1e3a5f; }
  input { flex: 1; padding: 12px 14px; border-radius: 10px; border: 1px solid #1e3a5f;
          background: var(--bg); color: var(--text); font-size: 15px; outline: none; }
  input:focus { border-color: var(--accent); }
  button { padding: 12px 22px; border: none; border-radius: 10px; background: var(--accent);
           color: #fff; font-size: 15px; font-weight: 600; cursor: pointer; }
  button:disabled { opacity: .4; cursor: default; }
</style>
</head>
<body>
<header>
  <div>
    <h1>Agente Estudiantil — Facultad de Ciencias, UNAM</h1>
    <span>Horarios · Profesores · Progreso académico · Roadmaps</span>
  </div>
</header>
<div id="log"><div class="sys">¡Hola! Soy tu agente académico. Puedo ayudarte a planear tu horario, investigar profesores y revisar tu progreso. ¿En qué te ayudo?</div></div>
<form id="f">
  <input id="box" placeholder="Escribe tu pregunta…" autocomplete="off" autofocus>
  <button id="send">Enviar</button>
</form>
<script>
"use strict";
const log = document.getElementById("log"), box = document.getElementById("box"),
      send = document.getElementById("send");
const sessionId = crypto.randomUUID();

function add(cls, text) {
  const d = document.createElement("div");
  d.className = "msg " + cls;
  d.textContent = text;
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
  return d;
}

async function ask(message) {
  send.disabled = true;
  let current = null;
  try {
    const res = await fetch("chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, sessionId }),
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const m = JSON.parse(line);
        if (m.type === "token") {
          if (!current) current = add("agent", "");
          current.textContent += m.text;
          log.scrollTop = log.scrollHeight;
        } else if (m.type === "tool") {
          current = null;
          add("tool", "🔧 usando herramienta: " + m.name);
        } else if (m.type === "error") {
          current = null;
          add("error", "⚠ " + m.text);
        }
      }
    }
  } catch (err) {
    add("error", "⚠ Error: " + err.message);
  }
  send.disabled = false;
  box.focus();
}

document.getElementById("f").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = box.value.trim();
  if (!text || send.disabled) return;
  add("user", text);
  box.value = "";
  ask(text);
});
</script>
</body>
</html>`;
