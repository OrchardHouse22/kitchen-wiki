(() => {
"use strict";
const $app = document.getElementById("app");
const $cook = document.getElementById("cook");

/* ---------- storage (this phone only) ---------- */
const KEY = "kw.recipes", PW = "kw.appkey";
const load = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
let recipes = load(KEY, null);
if (recipes == null) { recipes = [EXAMPLE()]; save(KEY, recipes); }
const persist = () => { if (!save(KEY, recipes)) toast("저장 공간이 부족해서 저장하지 못했어요."); };
try { navigator.storage?.persist?.(); } catch {}

function EXAMPLE(){ return {
  id: "example", example: true, createdAt: 1, sourceUrl: "", title: "대패삼겹 숙주볶음", servings: 1, tags: ["돼지고기", "숙주", "한그릇"],
  ingredients: [
    { name: "대패삼겹살", qty: 150, unit: "g", note: "", group: "" }, { name: "숙주", qty: 1, unit: "줌", note: "", group: "" },
    { name: "대파", qty: 0.5, unit: "대", note: "", group: "" }, { name: "간장", qty: 1, unit: "큰술", note: "", group: "양념" },
    { name: "굴소스", qty: 0.5, unit: "큰술", note: "", group: "양념" }, { name: "설탕", qty: 0.5, unit: "작은술", note: "", group: "양념" },
    { name: "후추", qty: null, unit: "", note: "약간", group: "양념" }],
  steps: ["{2}를 송송 썬다", "달군 팬에 {0}을 넣고 중불에서 3분 굽는다", "썰어둔 대파를 넣고 1분 볶아 파기름을 낸다",
    "{3}, {4}, {5}을 넣고 고기에 양념이 배게 볶는다", "{1}를 넣고 센불에서 30초만 빠르게 볶는다", "{6}를 뿌려 마무리한다"],
  tips: "숙주는 오래 볶으면 물이 생기니 마지막에 센불로 짧게. (사용법을 보여주는 예시예요. 정보 수정·삭제에서 지울 수 있어요.)",
}; }

let query = "";
const servingsFor = {};
const draft = { url: "", text: "", images: [] };
let busy = false, addErr = "", ctl = null;

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function toast(msg){
  const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}

/* ---------- quantities ---------- */
const FR = [[0, ""], [0.25, "¼"], [1 / 3, "⅓"], [0.5, "½"], [2 / 3, "⅔"], [0.75, "¾"], [1, ""]];
function fmtQty(q, unit){
  if (q == null || q === "" || isNaN(q)) return "";
  q = Number(q);
  if (/^(g|ml|mL|cc|kg|L|l)$/.test(unit || "")) {
    if (q >= 100) return String(Math.round(q / 5) * 5);
    if (q >= 10) return String(Math.round(q));
    return String(Math.round(q * 10) / 10);
  }
  if (q >= 10) return String(Math.round(q));
  let whole = Math.floor(q), frac = q - whole, best = FR[0];
  for (const f of FR) if (Math.abs(frac - f[0]) < Math.abs(frac - best[0])) best = f;
  if (best[0] === 1) { whole += 1; best = FR[0]; }
  if (whole === 0 && !best[1]) return "조금";
  return (whole ? String(whole) : "") + best[1];
}
function ingAmount(ing, ratio){
  const n = fmtQty(ing.qty == null ? null : Number(ing.qty) * ratio, ing.unit);
  if (!n) return ing.note || ing.unit || "";
  return n + (ing.unit || "") + (ing.note ? ` (${ing.note})` : "");
}
const ratioOf = r => (servingsFor[r.id] ?? r.servings ?? 1) / (r.servings || 1);
function stepHtml(text, r, ratio){
  return esc(text).replace(/\{(\d+)\}/g, (m, i) => {
    const ing = (r.ingredients || [])[+i];
    if (!ing) return "";
    const amt = ingAmount(ing, ratio);
    return `<b class="ing">${esc(ing.name)}${amt ? " " + esc(amt) : ""}</b>`;
  });
}
const stepIngs = (text, r) => [...new Set([...String(text).matchAll(/\{(\d+)\}/g)].map(m => +m[1]))]
  .map(i => (r.ingredients || [])[i]).filter(Boolean);
const stepPlain = (text, r) => String(text).replace(/\{(\d+)\}/g, (m, i) => (r.ingredients || [])[+i]?.name || "");

const isYouTube = u => /(^|\/\/)(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i.test(u || "");
function sourceLabel(url){
  if (!url) return "";
  if (/instagram\.com/i.test(url)) return "Instagram";
  if (isYouTube(url)) return "YouTube";
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "링크"; }
}

/* ---------- routing ---------- */
function route(){
  const h = location.hash.slice(1);
  if (h === "add") return renderAdd();
  if (h === "settings") return renderSettings();
  if (h.startsWith("r-")) return renderRecipe(h.slice(2));
  renderList();
}
window.addEventListener("hashchange", () => { window.scrollTo(0, 0); route(); });

/* ---------- list ---------- */
function renderList(){
  const q = query.trim().toLowerCase();
  const sorted = [...recipes].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const rows = sorted.filter(r => !q || [r.title, ...(r.tags || []), ...(r.ingredients || []).map(i => i.name)]
    .join(" ").toLowerCase().includes(q));
  let body;
  if (!recipes.length) body = `<div class="empty">아직 저장된 레시피가 없어요.<br>아래 <b>레시피 추가</b>에서 유튜브 링크를 넣어보세요.</div>`;
  else if (!rows.length) body = `<div class="empty">'${esc(query)}'이(가) 들어간 레시피가 없어요.</div>`;
  else body = rows.map(r => `
    <a class="item" href="#r-${esc(r.id)}">
      <h2>${esc(r.title)} ${r.example ? '<span class="badge">예시</span>' : ""}</h2>
      <div class="meta"><span>${esc(r.servings || 1)}인분 기준</span><span>·</span><span>재료 ${(r.ingredients || []).length}가지</span>
        ${r.sourceUrl ? `<span class="src">${esc(sourceLabel(r.sourceUrl))}</span>` : ""}</div>
      ${(r.tags || []).length ? `<div class="meta">${r.tags.slice(0, 4).map(t => `<span class="chip">${esc(t)}</span>`).join("")}</div>` : ""}
    </a>`).join("");
  $app.innerHTML = `
    <div class="top"><h1>부엌 위키</h1><a class="iconbtn right" href="#settings">설정</a></div>
    <input class="search" id="q" type="search" placeholder="요리 이름이나 재료로 찾기 (예: 숙주)" value="${esc(query)}">
    <div class="list">${body}</div>
    <a class="fab" href="#add">＋ 레시피 추가</a>`;
  document.getElementById("q").addEventListener("input", e => {
    query = e.target.value; const pos = e.target.selectionStart; renderList();
    const n = document.getElementById("q"); n.focus(); n.setSelectionRange(pos, pos);
  });
}

/* ---------- recipe page ---------- */
function renderRecipe(id){
  const r = recipes.find(x => x.id === id);
  if (!r) { $app.innerHTML = `<div class="top"><a class="iconbtn" href="#">← 목록</a></div><div class="empty">이 레시피를 찾을 수 없어요. 삭제되었을 수 있어요.</div>`; return; }
  const base = r.servings || 1, cur = servingsFor[r.id] ?? base, ratio = cur / base;
  let lastGroup = "";
  const ings = (r.ingredients || []).map(i => {
    let g = "";
    if ((i.group || "") !== lastGroup) { lastGroup = i.group || ""; if (i.group) g = `</ul><div class="group">${esc(i.group)}</div><ul class="ings">`; }
    return g + `<li><span>${esc(i.name)}</span><span class="q ${ratio !== 1 && i.qty != null ? "changed" : ""}">${esc(ingAmount(i, ratio))}</span></li>`;
  }).join("");
  $app.innerHTML = `
    <div class="top"><a class="iconbtn" href="#">← 목록</a></div>
    <div class="meta">${(r.tags || []).map(t => `<span class="chip">${esc(t)}</span>`).join("")} ${r.example ? '<span class="badge">예시</span>' : ""}</div>
    <h1 class="title">${esc(r.title)}</h1>
    ${r.sourceUrl ? `<div class="meta" style="margin-top:6px">출처 <a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener">${esc(sourceLabel(r.sourceUrl))}에서 보기 ↗</a></div>` : ""}
    <div class="scaler">
      <div><div style="font-weight:700">몇 인분 만들까요?</div><div class="note">원본 ${esc(base)}인분 기준</div></div>
      <div class="stepper">
        <button id="minus" aria-label="인분 줄이기">−</button>
        <output id="cur">${fmtQty(cur) || cur}인분</output>
        <button id="plus" aria-label="인분 늘리기">＋</button>
      </div>
    </div>
    <div class="section"><h3>재료</h3><ul class="ings">${ings}</ul></div>
    <div class="section"><h3>조리 순서</h3><ol class="steps">${(r.steps || []).map(s => `<li><div>${stepHtml(s, r, ratio)}</div></li>`).join("")}</ol></div>
    ${r.tips ? `<div class="section"><h3>팁</h3><div class="tips">${esc(r.tips)}</div></div>` : ""}
    <div class="section"><button class="btn" id="startCook" ${(r.steps || []).length ? "" : "disabled"}>요리 시작 (한 단계씩 보기)</button></div>
    <div class="section">
      <details><summary>정보 수정 · 삭제</summary>
        <div class="stack" style="margin-top:12px">
          <label class="field"><span class="label">요리 이름</span><input id="eTitle" value="${esc(r.title)}"></label>
          <label class="field"><span class="label">원본 레시피 기준 인분</span><input id="eBase" type="number" min="0.5" step="0.5" inputmode="decimal" value="${esc(base)}"></label>
          <label class="field"><span class="label">원본 링크</span><input id="eUrl" type="url" value="${esc(r.sourceUrl || "")}" placeholder="https://"></label>
          <button class="btn ghost" id="eSave">수정 저장</button>
          <div id="delArea"><button class="btn danger" id="del">이 레시피 삭제</button></div>
          <div class="err" id="eErr"></div>
        </div>
      </details>
    </div>`;
  const step = d => { servingsFor[r.id] = Math.max(0.5, Math.round(((servingsFor[r.id] ?? base) + d) * 2) / 2); renderRecipe(id); };
  document.getElementById("minus").onclick = () => step((servingsFor[r.id] ?? base) <= 1 ? -0.5 : -1);
  document.getElementById("plus").onclick = () => step((servingsFor[r.id] ?? base) < 1 ? 0.5 : 1);
  document.getElementById("startCook").onclick = () => openCook(r);
  document.getElementById("eSave").onclick = () => {
    const title = document.getElementById("eTitle").value.trim();
    const sv = parseFloat(document.getElementById("eBase").value);
    if (!title || !(sv > 0)) { document.getElementById("eErr").textContent = "요리 이름과 인분 수를 확인해 주세요."; return; }
    Object.assign(r, { title, servings: sv, sourceUrl: document.getElementById("eUrl").value.trim() });
    delete servingsFor[r.id]; persist(); renderRecipe(id); toast("저장했어요");
  };
  document.getElementById("del").onclick = () => {
    document.getElementById("delArea").innerHTML = `<div class="row"><button class="btn ghost" id="delNo">취소</button><button class="btn danger" id="delYes">정말 삭제</button></div>`;
    document.getElementById("delNo").onclick = () => renderRecipe(id);
    document.getElementById("delYes").onclick = () => { recipes = recipes.filter(x => x.id !== id); persist(); location.hash = ""; toast("삭제했어요"); };
  };
}

/* ---------- cook mode ---------- */
let cook = null, wake = null, tick = null;
function openCook(r){
  cook = { r, i: 0, ratio: ratioOf(r), timer: null };
  $cook.hidden = false; document.body.style.overflow = "hidden";
  try { navigator.wakeLock?.request("screen").then(w => wake = w).catch(() => {}); } catch {}
  drawCook();
}
document.addEventListener("visibilitychange", () => {
  if (cook && document.visibilityState === "visible") { try { navigator.wakeLock?.request("screen").then(w => wake = w).catch(() => {}); } catch {} }
});
function closeCook(){
  $cook.hidden = true; document.body.style.overflow = ""; cook = null;
  clearInterval(tick); tick = null;
  try { wake?.release(); } catch {} wake = null;
}
function beep(){
  try { const a = new (window.AudioContext || window.webkitAudioContext)();
    [0, .35, .7].forEach(t => { const o = a.createOscillator(), g = a.createGain(); o.frequency.value = 880;
      o.connect(g); g.connect(a.destination); g.gain.setValueAtTime(.2, a.currentTime + t); o.start(a.currentTime + t); o.stop(a.currentTime + t + .2); });
  } catch {}
  try { navigator.vibrate?.([300, 150, 300]); } catch {}
}
function timerSecs(text){ const m = String(text).match(/(\d+)\s*(분|초)/); return m ? (+m[1]) * (m[2] === "분" ? 60 : 1) : 0; }
const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
function drawCook(){
  const { r, i, ratio } = cook, steps = r.steps || [], s = steps[i], n = steps.length;
  const ings = stepIngs(s, r), secs = timerSecs(stepPlain(s, r)), t = cook.timer;
  const timerLabel = t ? (t.left > 0 ? `⏱ ${mmss(t.left)} 남음 · 멈추기` : "⏱ 시간 됐어요!") : `⏱ ${mmss(secs)} 타이머`;
  const sv = (r.servings || 1) * ratio;
  $cook.innerHTML = `
    <div style="max-width:560px;width:100%;margin:0 auto">
      <div class="cook-top"><span class="muted" style="font-size:14px">${esc(r.title)} · ${fmtQty(sv) || sv}인분</span>
        <button class="iconbtn" id="cClose" style="margin:0 -8px 0 0">닫기 ✕</button></div>
      <div class="bar"><i style="width:${((i + 1) / n) * 100}%"></i></div>
    </div>
    <div class="cook-body">
      <div class="cook-num">${i + 1} / ${n}</div>
      <div class="cook-text">${stepHtml(s, r, ratio)}</div>
      ${ings.length ? `<div class="cook-ings"><span class="label">이 단계 재료</span>${ings.map(g => `<div><span>${esc(g.name)}</span><b>${esc(ingAmount(g, ratio))}</b></div>`).join("")}</div>` : ""}
      ${secs ? `<button class="timer ${t && t.left > 0 ? "run" : ""}" id="cTimer">${timerLabel}</button>` : ""}
    </div>
    <div class="cook-nav">
      <button class="btn ghost" id="cPrev" ${i === 0 ? "disabled" : ""}>이전</button>
      <button class="btn" id="cNext">${i === n - 1 ? "완성! 닫기" : "다음 단계"}</button>
    </div>`;
  document.getElementById("cClose").onclick = closeCook;
  document.getElementById("cPrev").onclick = () => { cook.i--; stopTimer(); drawCook(); };
  document.getElementById("cNext").onclick = () => { if (cook.i === n - 1) return closeCook(); cook.i++; stopTimer(); drawCook(); };
  const tb = document.getElementById("cTimer");
  if (tb) tb.onclick = () => {
    if (cook.timer) { stopTimer(); drawCook(); return; }
    cook.timer = { left: secs };
    tick = setInterval(() => {
      if (!cook?.timer) return;
      cook.timer.left--;
      if (cook.timer.left <= 0) { clearInterval(tick); tick = null; beep(); }
      drawCook();
    }, 1000);
    drawCook();
  };
}
function stopTimer(){ clearInterval(tick); tick = null; if (cook) cook.timer = null; }

/* ---------- add / ingest ---------- */
function renderAdd(){
  const yt = isYouTube(draft.url.trim());
  $app.innerHTML = `
    <div class="top"><a class="iconbtn" href="#">← 목록</a></div>
    <h1 class="title">레시피 추가</h1>
    <p class="note" style="margin:6px 0 0">유튜브는 링크만 넣으면 영상을 보고 정리해요. 인스타는 캡션을 붙여넣거나 캡쳐본을 올려 주세요.</p>
    <div class="stack" style="gap:18px;margin-top:20px">
      <label class="field"><span class="label">원본 링크 (유튜브 · 인스타)</span>
        <input id="aUrl" type="url" inputmode="url" placeholder="https://youtube.com/shorts/…" value="${esc(draft.url)}"></label>
      <div class="yt" id="ytNote" ${yt ? "" : "hidden"}>✓ 유튜브 링크예요. 링크만으로 정리할 수 있어요.</div>
      <label class="field"><span class="label">캡션 · 설명란 · 메모 (선택)</span>
        <textarea id="aText" placeholder="인스타 캡션이나 레시피 글을 붙여넣으세요.">${esc(draft.text)}</textarea></label>
      <div class="field"><span class="label">캡쳐본 (선택)</span>
        <label class="drop" for="aImg">캡쳐 이미지 선택 (최대 6장)</label>
        <input id="aImg" type="file" accept="image/*" multiple hidden>
        <div class="thumbs" id="thumbs"></div>
      </div>
      <div class="err" id="aErr">${esc(addErr)}</div>
      ${busy
        ? `<div class="status"><div class="spin"></div><span>${yt ? "영상을 보고 정리하는 중이에요. 길면 1분쯤 걸려요." : "재료와 순서를 정리하고 있어요."}</span></div>
           <button class="btn ghost" id="aStop">그만두기</button>`
        : `<button class="btn" id="aGo">레시피로 정리하기</button>`}
    </div>`;
  const $u = document.getElementById("aUrl");
  $u.oninput = e => { draft.url = e.target.value; document.getElementById("ytNote").hidden = !isYouTube(draft.url.trim()); };
  document.getElementById("aText").oninput = e => draft.text = e.target.value;
  document.getElementById("aImg").onchange = e => { addImages([...e.target.files]); e.target.value = ""; };
  drawThumbs();
  if (busy) document.getElementById("aStop").onclick = () => ctl?.abort();
  else document.getElementById("aGo").onclick = ingest;
}
function addImages(files){
  for (const f of files) if (f.type.startsWith("image/") && draft.images.length < 6) draft.images.push(f);
  drawThumbs();
}
function drawThumbs(){
  const el = document.getElementById("thumbs"); if (!el) return;
  el.innerHTML = "";
  draft.images.forEach((f, k) => {
    const d = document.createElement("div"), img = document.createElement("img"), x = document.createElement("button");
    img.src = URL.createObjectURL(f); img.alt = "캡쳐 " + (k + 1);
    x.textContent = "✕"; x.setAttribute("aria-label", "이미지 빼기");
    x.onclick = () => { draft.images.splice(k, 1); drawThumbs(); };
    d.append(img, x); el.append(d);
  });
}
document.addEventListener("paste", e => {
  if (location.hash !== "#add") return;
  const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith("image/"));
  if (files.length) { e.preventDefault(); addImages(files); }
});

// Shrink a photo to ≤1280px JPEG so uploads stay small.
function shrink(file){
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, 1280 / Math.max(img.width, img.height));
      const c = document.createElement("canvas"); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      resolve({ mime: "image/jpeg", data: c.toDataURL("image/jpeg", 0.85).split(",")[1] });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("이미지를 읽지 못했어요.")); };
    img.src = url;
  });
}

async function ingest(){
  const url = draft.url.trim(), text = draft.text.trim();
  addErr = "";
  if (!isYouTube(url) && !text && !draft.images.length) {
    addErr = url ? "이 링크는 직접 읽을 수 없어요. 캡션을 붙여넣거나 캡쳐본을 올려 주세요." : "유튜브 링크, 글, 캡쳐본 중 하나는 넣어 주세요.";
    return renderAdd();
  }
  busy = true; ctl = new AbortController(); renderAdd();
  try {
    const images = await Promise.all(draft.images.map(shrink));
    const res = await fetch("/api/extract", {
      method: "POST", signal: ctl.signal,
      headers: { "Content-Type": "application/json", "x-app-key": load(PW, "") },
      body: JSON.stringify({ url, text, images }),
    });
    const out = await res.json().catch(() => ({ error: "서버 응답을 읽지 못했어요." }));
    if (!res.ok || out.error) {
      if (res.status === 401) { addErr = "앱 비밀번호가 필요해요. 설정에서 입력해 주세요."; }
      else addErr = out.error || `오류가 났어요 (${res.status})`;
      throw null;
    }
    const r = { ...out, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), sourceUrl: url, createdAt: Date.now() };
    recipes.push(r); persist();
    draft.url = ""; draft.text = ""; draft.images = [];
    busy = false;
    location.hash = "r-" + r.id;
  } catch (e) {
    busy = false;
    if (e?.name === "AbortError") addErr = "";
    else if (e) addErr = navigator.onLine ? (e.message || "정리하지 못했어요.") : "인터넷에 연결되어 있지 않아요.";
    renderAdd();
  }
}

/* ---------- settings ---------- */
function renderSettings(){
  $app.innerHTML = `
    <div class="top"><a class="iconbtn" href="#">← 목록</a></div>
    <h1 class="title">설정</h1>
    <div class="section"><h3>앱 비밀번호</h3>
      <p class="note" style="margin:0">서버에 정한 APP_PASSWORD와 같은 값을 넣어요. 다른 사람이 내 Gemini 사용량을 쓰지 못하게 막아줘요.</p>
      <label class="field"><span class="label">비밀번호</span><input id="sPw" type="password" value="${esc(load(PW, ""))}" autocomplete="current-password"></label>
      <button class="btn ghost" id="sPwSave">저장</button>
    </div>
    <div class="section"><h3>백업</h3>
      <p class="note" style="margin:0">레시피는 이 휴대폰에만 저장돼요. 휴대폰을 바꾸거나 앱을 지우기 전에 백업 파일을 받아두세요. 지금 ${recipes.length}개 저장되어 있어요.</p>
      <button class="btn ghost" id="sExport">백업 파일 받기</button>
      <label class="btn ghost" for="sImport" style="text-align:center;box-sizing:border-box">백업 파일 불러오기</label>
      <input id="sImport" type="file" accept="application/json,.json" hidden>
    </div>`;
  document.getElementById("sPwSave").onclick = () => { save(PW, document.getElementById("sPw").value); toast("비밀번호를 저장했어요"); };
  document.getElementById("sExport").onclick = () => {
    const blob = new Blob([JSON.stringify({ app: "kitchen-wiki", version: 1, recipes }, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `부엌위키-백업-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  document.getElementById("sImport").onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const list = Array.isArray(data) ? data : data.recipes;
      if (!Array.isArray(list)) throw 0;
      const have = new Set(recipes.map(r => r.id)); let n = 0;
      for (const r of list) if (r && r.id && r.title && !have.has(r.id)) { recipes.push(r); n++; }
      persist(); toast(`${n}개를 불러왔어요`); renderSettings();
    } catch { toast("백업 파일을 읽지 못했어요"); }
  };
}

/* ---------- boot ---------- */
// Shared from another app (Android share sheet) or opened with ?url=
(() => {
  const p = new URLSearchParams(location.search);
  const shared = [p.get("url"), p.get("text"), p.get("title")].filter(Boolean).join(" ");
  if (!shared) return;
  const m = shared.match(/https?:\/\/\S+/);
  draft.url = m ? m[0] : "";
  const rest = shared.replace(m ? m[0] : "", "").trim();
  if (!isYouTube(draft.url) && rest) draft.text = rest;
  history.replaceState(null, "", "/#add");
  if (isYouTube(draft.url)) setTimeout(ingest, 0);
})();
route();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
})();
