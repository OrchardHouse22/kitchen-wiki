(() => {
"use strict";
const $app = document.getElementById("app");
const $cook = document.getElementById("cook");

/* ---------- storage (this phone only) ---------- */
const KEY = "kw.recipes", PW = "kw.appkey", LOGK = "kw.log", SETK = "kw.settings";
const load = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
let recipes = load(KEY, null);
if (recipes == null) { recipes = [EXAMPLE()]; save(KEY, recipes); }
const persist = () => { if (!save(KEY, recipes)) toast("저장 공간이 부족해서 저장하지 못했어요."); };
let log = load(LOGK, []);              // [{id, date:"YYYY-MM-DD", meal, who, recipeId?, title}]
const persistLog = () => { if (!save(LOGK, log)) toast("저장 공간이 부족해서 저장하지 못했어요."); };
let settings = Object.assign({ coolAdult: 7, coolBaby: 3 }, load(SETK, {}));
const persistSettings = () => save(SETK, settings);
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
let busy = false, addErr = "", ctl = null, needPw = false;
let logDate = null, recOffset = { 어른: 0, 아기: 0 };

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
  if (h === "add") { drawTabs("recipes"); return renderAdd(); }
  if (h === "settings") { drawTabs(""); return renderSettings(); }
  if (h.startsWith("r-")) { drawTabs("recipes"); return renderRecipe(h.slice(2)); }
  if (h === "recipes") return renderList();
  if (h === "log") return renderLog();
  renderToday();
}
window.addEventListener("hashchange", () => { window.scrollTo(0, 0); route(); });

/* ---------- list ---------- */
function renderList(){
  drawTabs("recipes");
  $app.innerHTML = `
    <div class="top"><h1>레시피</h1><a class="iconbtn right" href="#settings">설정</a></div>
    <input class="search" id="q" type="search" placeholder="요리 이름이나 재료로 찾기 (예: 숙주)" value="${esc(query)}">
    <div class="list" id="list"></div>
    <a class="fab" href="#add">＋ 레시피 추가</a>`;
  const $q = document.getElementById("q");
  $q.addEventListener("input", e => { query = e.target.value; drawList(); });
  $q.addEventListener("compositionend", e => { query = e.target.value; drawList(); });
  drawList();
}
function drawList(){
  const el = document.getElementById("list"); if (!el) return;
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
      <div class="meta">${whoChip(r.who)}<span>${esc(r.servings || 1)}인분 기준</span><span>·</span><span>재료 ${(r.ingredients || []).length}가지</span>
        ${r.sourceUrl ? `<span class="src">${esc(sourceLabel(r.sourceUrl))}</span>` : ""}</div>
      ${(r.tags || []).length ? `<div class="meta">${r.tags.slice(0, 4).map(t => `<span class="chip">${esc(t)}</span>`).join("")}</div>` : ""}
    </a>`).join("");
  el.innerHTML = body;
}

/* ---------- recipe page ---------- */
function renderRecipe(id){
  const r = recipes.find(x => x.id === id);
  if (!r) { $app.innerHTML = `<div class="top"><a class="iconbtn" href="#recipes">← 목록</a></div><div class="empty">이 레시피를 찾을 수 없어요. 삭제되었을 수 있어요.</div>`; return; }
  const base = r.servings || 1, cur = servingsFor[r.id] ?? base, ratio = cur / base;
  let lastGroup = "";
  const ings = (r.ingredients || []).map(i => {
    let g = "";
    if ((i.group || "") !== lastGroup) { lastGroup = i.group || ""; if (i.group) g = `</ul><div class="group">${esc(i.group)}</div><ul class="ings">`; }
    return g + `<li><span>${esc(i.name)}</span><span class="q ${ratio !== 1 && i.qty != null ? "changed" : ""}">${esc(ingAmount(i, ratio))}</span></li>`;
  }).join("");
  $app.innerHTML = `
    <div class="top"><button class="iconbtn" id="back">← 뒤로</button></div>
    <div class="meta">${whoChip(r.who)}${(r.tags || []).map(t => `<span class="chip">${esc(t)}</span>`).join("")} ${r.example ? '<span class="badge">예시</span>' : ""}</div>
    <h1 class="title">${esc(r.title)}</h1>
    ${r.sourceUrl ? `<div class="meta" style="margin-top:6px">출처 <a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener">${esc(sourceLabel(r.sourceUrl))}에서 보기 ↗</a></div>` : ""}
    <div class="eaten">
      <div><div style="font-weight:600">${esc(lastEatenText(r))}</div><div class="note">쿨타임 ${coolOf(r)}일${r.cool != null ? "" : " (기본값)"}</div></div>
      <button class="btn small" id="ateBtn">먹었어요</button>
    </div>
    <div id="ateForm"></div>
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
          <label class="field"><span class="label">누가 먹는 음식인가요?</span>${whoSelect("eWho", r.who || "어른", false)}</label>
          <label class="field"><span class="label">쿨타임 (며칠 지나야 다시 추천할지, 비우면 기본값)</span><input id="eCool" type="number" min="0" step="1" inputmode="numeric" value="${esc(r.cool ?? "")}" placeholder="기본 ${esc(defaultCool(r.who))}일"></label>
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
  document.getElementById("back").onclick = () => { if (history.length > 1) history.back(); else location.hash = "recipes"; };
  document.getElementById("ateBtn").onclick = () => openAteForm(r, document.getElementById("ateForm"), () => renderRecipe(id));
  document.getElementById("eSave").onclick = () => {
    const title = document.getElementById("eTitle").value.trim();
    const sv = parseFloat(document.getElementById("eBase").value);
    if (!title || !(sv > 0)) { document.getElementById("eErr").textContent = "요리 이름과 인분 수를 확인해 주세요."; return; }
    const cv = document.getElementById("eCool").value.trim();
    Object.assign(r, { title, servings: sv, sourceUrl: document.getElementById("eUrl").value.trim(),
      who: document.getElementById("eWho").value, cool: cv === "" ? null : Math.max(0, parseInt(cv, 10) || 0) });
    delete servingsFor[r.id]; persist(); renderRecipe(id); toast("저장했어요");
  };
  document.getElementById("del").onclick = () => {
    document.getElementById("delArea").innerHTML = `<div class="row"><button class="btn ghost" id="delNo">취소</button><button class="btn danger" id="delYes">정말 삭제</button></div>`;
    document.getElementById("delNo").onclick = () => renderRecipe(id);
    document.getElementById("delYes").onclick = () => { recipes = recipes.filter(x => x.id !== id); persist(); location.hash = "recipes"; toast("삭제했어요"); };
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
    <div class="top"><a class="iconbtn" href="#recipes">← 목록</a></div>
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
      ${needPw && !busy ? `<label class="field"><span class="label">앱 비밀번호</span>
        <input id="aPw" type="password" placeholder="Vercel에 넣은 APP_PASSWORD" autocomplete="current-password"></label>` : ""}
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
  else document.getElementById("aGo").onclick = () => {
    const pw = document.getElementById("aPw");
    if (pw && pw.value.trim()) { save(PW, pw.value.trim()); needPw = false; }
    ingest();
  };
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
      headers: { "Content-Type": "application/json", "x-app-key": encodeURIComponent(String(load(PW, "")).trim()) },
      body: JSON.stringify({ url, text, images }),
    });
    const out = await res.json().catch(() => ({ error: "서버 응답을 읽지 못했어요." }));
    if (!res.ok || out.error) {
      if (res.status === 401) { needPw = true; addErr = load(PW, "") ? "앱 비밀번호가 맞지 않아요. 아래에 다시 입력하고 정리하기를 눌러 주세요." : "앱 비밀번호가 필요해요. 아래에 입력하고 정리하기를 눌러 주세요."; }
      else addErr = out.error || `오류가 났어요 (${res.status})`;
      throw null;
    }
    const r = { ...out, who: ["어른", "아기", "함께"].includes(out.who) ? out.who : "어른", cool: null, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), sourceUrl: url, createdAt: Date.now() };
    recipes.push(r); persist(); needPw = false;
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

/* ---------- who / dates / cooltime ---------- */
const WHO = ["어른", "아기", "함께"];
const MEALS = ["아침", "점심", "저녁", "간식"];
const whoChip = w => w === "아기" ? '<span class="who baby">아기</span>' : w === "함께" ? '<span class="who both">함께</span>' : "";
const whoSelect = (id, val, withAll) => `<select id="${id}">${(withAll ? WHO : WHO).map(w =>
  `<option value="${w}" ${w === val ? "selected" : ""}>${w === "함께" ? "함께 (어른+아기)" : w}</option>`).join("")}</select>`;
const defaultCool = who => who === "아기" ? settings.coolBaby : settings.coolAdult;
const coolOf = r => r.cool ?? defaultCool(r.who);
const pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const parseYmd = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const daysBetween = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 86400000);
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const dateLabel = s => { const d = parseYmd(s); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${DOW[d.getDay()]})`; };
function mealNow(){ const h = new Date().getHours(); return h < 10 ? "아침" : h < 15 ? "점심" : h < 17 ? "간식" : "저녁"; }
const ateBy = (e, who) => e.who === who || e.who === "함께";

// Last date `who` ate recipe r (null = never). who omitted → anyone.
function lastEaten(r, who){
  let best = null;
  for (const e of log) if (e.recipeId === r.id && (!who || ateBy(e, who)) && (!best || e.date > best)) best = e.date;
  return best;
}
function agoText(d){
  const n = daysBetween(d, today());
  return n <= 0 ? "오늘" : n === 1 ? "어제" : `${n}일 전`;
}
function lastEatenText(r){
  const d = lastEaten(r);
  return d ? `마지막으로 먹은 날 ${dateLabel(d)} · ${agoText(d)}` : "아직 먹은 기록이 없어요";
}

/* "먹었어요" form, shared by the recipe page and the log page */
function openAteForm(r, host, done){
  host.innerHTML = `
    <div class="ateform">
      <div class="row">
        <label class="field" style="flex:1.3"><span class="label">날짜</span><input id="fDate" type="date" value="${today()}" max="${today()}"></label>
        <label class="field" style="flex:1"><span class="label">끼니</span><select id="fMeal">${MEALS.map(m => `<option ${m === mealNow() ? "selected" : ""}>${m}</option>`).join("")}</select></label>
      </div>
      <label class="field"><span class="label">누가</span>${whoSelect("fWho", r.who || "어른", true)}</label>
      <div class="row"><button class="btn ghost" id="fNo">취소</button><button class="btn" id="fYes">기록하기</button></div>
    </div>`;
  host.querySelector("#fNo").onclick = () => { host.innerHTML = ""; };
  host.querySelector("#fYes").onclick = () => {
    const date = host.querySelector("#fDate").value || today();
    log.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), date,
      meal: host.querySelector("#fMeal").value, who: host.querySelector("#fWho").value, recipeId: r.id, title: r.title });
    persistLog(); toast(`${dateLabel(date)} 기록했어요`); done();
  };
}

/* ---------- bottom tabs ---------- */
function drawTabs(active){
  let nav = document.getElementById("tabs");
  if (!nav) { nav = document.createElement("nav"); nav.id = "tabs"; nav.className = "tabs"; document.body.append(nav); }
  const tab = (h, label, key) => `<a href="#${h}" class="${active === key ? "on" : ""}" ${active === key ? 'aria-current="page"' : ""}>${label}</a>`;
  nav.innerHTML = tab("", "오늘", "today") + tab("recipes", "레시피", "recipes") + tab("log", "식단 기록", "log");
}

/* ---------- today: recommendations ---------- */
// Seeded shuffle so picks change day to day but stay put within a day.
function seeded(str){ let h = 2166136261; for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) / 4294967296); }
function recommend(who){
  const t = today(), rnd = seeded(t + who);
  const pool = recipes.filter(r => (r.who || "어른") === who || r.who === "함께");
  const ready = [], cooling = [];
  for (const r of pool) {
    const last = lastEaten(r, who), cool = coolOf(r);
    const days = last ? daysBetween(last, t) : null;
    if (days != null && days < cool) cooling.push({ r, left: cool - days });
    // Never eaten ranks with a long-overdue dish; overdue ratio decides the rest.
    else ready.push({ r, days, score: (days == null ? 2 : days / Math.max(cool, 1)) + rnd() * 0.5 });
  }
  ready.sort((a, b) => b.score - a.score);
  cooling.sort((a, b) => a.left - b.left);
  return { pool, ready, cooling };
}
function recCard(x){
  return `<a class="rec" href="#r-${esc(x.r.id)}">
    <span class="rec-title">${esc(x.r.title)}</span>
    <span class="rec-meta">${x.days == null ? "아직 안 먹어봤어요" : `${x.days}일 전에 먹었어요`}${(x.r.tags || []).length ? " · " + esc(x.r.tags.slice(0, 2).join(", ")) : ""}</span>
  </a>`;
}
function recBlock(who){
  const { pool, ready, cooling } = recommend(who);
  let inner;
  if (!pool.length) inner = `<div class="note">${who === "아기"
    ? "아기용 레시피가 아직 없어요. 레시피의 <b>정보 수정</b>에서 '누가 먹는 음식'을 <b>아기</b>나 <b>함께</b>로 바꾸거나, 이유식 레시피를 추가해 보세요."
    : "레시피를 추가하면 여기서 추천해 드려요."}</div>`;
  else if (!ready.length) inner = `<div class="note">모든 레시피가 쿨타임 중이에요. ${cooling[0] ? `'${esc(cooling[0].r.title)}'이(가) ${cooling[0].left}일 뒤에 풀려요.` : ""}</div>`;
  else {
    const n = ready.length, off = recOffset[who] % n;
    const pick = [...ready.slice(off), ...ready.slice(0, off)].slice(0, Math.min(3, n));
    inner = `<div class="recs">${pick.map(recCard).join("")}</div>
      ${n > 3 ? `<button class="linkbtn" data-more="${who}">다른 추천 보기</button>` : ""}`;
  }
  const coolNote = cooling.length ? `<span class="note">쿨타임 중 ${cooling.length}개</span>` : "";
  return `<div class="section"><h3>${who === "아기" ? "아기" : "어른"} 추천 ${coolNote}</h3>${inner}</div>`;
}
function renderToday(){
  drawTabs("today");
  const t = today(), todays = log.filter(e => e.date === t);
  $app.innerHTML = `
    <div class="top"><h1>오늘 뭐 먹지</h1><a class="iconbtn right" href="#settings">설정</a></div>
    <div class="note">${dateLabel(t)}</div>
    <div class="section"><h3>오늘 먹은 것</h3>
      ${todays.length ? `<div class="daylist">${dayEntries(todays)}</div>` : `<div class="note">아직 기록이 없어요. 레시피에서 <b>먹었어요</b>를 누르거나 <a href="#log">식단 기록</a>에서 추가하세요.</div>`}
    </div>
    ${recBlock("어른")}
    ${recBlock("아기")}`;
  $app.querySelectorAll("[data-more]").forEach(b => b.onclick = () => { recOffset[b.dataset.more] += 3; renderToday(); });
  bindEntryDeletes(renderToday);
}

/* ---------- meal log ---------- */
function dayEntries(entries){
  return MEALS.map(m => {
    const es = entries.filter(e => e.meal === m);
    if (!es.length) return "";
    return `<div class="meal"><span class="meal-name">${m}</span><div class="meal-items">${es.map(e => {
      const r = e.recipeId && recipes.find(x => x.id === e.recipeId);
      const name = r ? `<a href="#r-${esc(r.id)}">${esc(r.title)}</a>` : esc(e.title);
      return `<div class="entry"><span class="who ${e.who === "아기" ? "baby" : e.who === "함께" ? "both" : "adult"}">${esc(e.who)}</span><span class="entry-name">${name}</span>
        <button class="x" data-del="${esc(e.id)}" aria-label="기록 지우기">✕</button></div>`;
    }).join("")}</div></div>`;
  }).join("");
}
function bindEntryDeletes(redraw){
  $app.querySelectorAll("[data-del]").forEach(b => b.onclick = () => {
    if (b.dataset.armed) { log = log.filter(e => e.id !== b.dataset.del); persistLog(); redraw(); return; }
    b.dataset.armed = "1"; b.textContent = "지우기"; b.classList.add("armed");
    setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = "✕"; b.classList.remove("armed"); } }, 3000);
  });
}
function renderLog(){
  drawTabs("log");
  const t = today(); logDate = logDate || t;
  const end = addDays(logDate, 3) > t ? t : addDays(logDate, 3), start = addDays(end, -6);   // never show future days
  const strip = [...Array(7)].map((_, k) => {
    const d = addDays(start, k), n = log.filter(e => e.date === d).length, dd = parseYmd(d);
    return `<button class="day ${d === logDate ? "on" : ""} ${d === t ? "today" : ""}" data-day="${d}" ${d > t ? "disabled" : ""}>
      <span>${DOW[dd.getDay()]}</span><b>${dd.getDate()}</b><i>${n ? "•".repeat(Math.min(n, 3)) : "&nbsp;"}</i></button>`;
  }).join("");
  const entries = log.filter(e => e.date === logDate);
  $app.innerHTML = `
    <div class="top"><h1>식단 기록</h1><a class="iconbtn right" href="#settings">설정</a></div>
    <div class="strip"><button class="arrow" id="prevW" aria-label="이전">‹</button><div class="days">${strip}</div><button class="arrow" id="nextW" aria-label="다음" ${addDays(logDate, 1) > t ? "disabled" : ""}>›</button></div>
    <div class="section"><h3>${dateLabel(logDate)}</h3>
      ${entries.length ? `<div class="daylist">${dayEntries(entries)}</div>` : `<div class="note">이날 기록이 없어요.</div>`}
    </div>
    <div class="section"><h3>기록 추가</h3>
      <div class="stack">
        <label class="field"><span class="label">무엇을 먹었나요?</span>
          <input id="lWhat" placeholder="레시피 이름이나 직접 입력 (예: 외식 짜장면)" autocomplete="off"></label>
        <div class="suggest" id="lSug"></div>
        <div class="row">
          <label class="field" style="flex:1"><span class="label">끼니</span><select id="lMeal">${MEALS.map(m => `<option ${m === (logDate === t ? mealNow() : "저녁") ? "selected" : ""}>${m}</option>`).join("")}</select></label>
          <label class="field" style="flex:1"><span class="label">누가</span>${whoSelect("lWho", "함께", true)}</label>
        </div>
        <button class="btn" id="lAdd">${logDate === t ? "오늘" : dateLabel(logDate)}에 기록하기</button>
      </div>
    </div>`;
  $app.querySelectorAll("[data-day]").forEach(b => b.onclick = () => { logDate = b.dataset.day; renderLog(); });
  document.getElementById("prevW").onclick = () => { logDate = addDays(logDate, -7); renderLog(); };
  document.getElementById("nextW").onclick = () => { const n = addDays(logDate, 7); logDate = n > t ? t : n; renderLog(); };
  bindEntryDeletes(renderLog);

  let picked = null;
  const $w = document.getElementById("lWhat"), $s = document.getElementById("lSug");
  const sug = () => {
    const q = $w.value.trim().toLowerCase();
    if (picked && picked.title !== $w.value) picked = null;
    const hits = q && !picked ? recipes.filter(r => r.title.toLowerCase().includes(q)).slice(0, 5) : [];
    $s.innerHTML = hits.map(r => `<button data-pick="${esc(r.id)}">${esc(r.title)} ${whoChip(r.who)}</button>`).join("");
    $s.querySelectorAll("[data-pick]").forEach(b => b.onclick = () => {
      picked = recipes.find(r => r.id === b.dataset.pick); $w.value = picked.title; $s.innerHTML = "";
      document.getElementById("lWho").value = picked.who || "어른";
    });
  };
  $w.addEventListener("input", sug); $w.addEventListener("compositionend", sug);
  document.getElementById("lAdd").onclick = () => {
    const title = $w.value.trim();
    if (!title) { $w.focus(); toast("무엇을 먹었는지 입력해 주세요"); return; }
    const r = picked || recipes.find(x => x.title === title);
    log.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), date: logDate,
      meal: document.getElementById("lMeal").value, who: document.getElementById("lWho").value, recipeId: r ? r.id : null, title });
    persistLog(); toast("기록했어요"); renderLog();
  };
}


/* ---------- settings ---------- */
function renderSettings(){
  $app.innerHTML = `
    <div class="top"><button class="iconbtn" id="sBack">← 뒤로</button></div>
    <h1 class="title">설정</h1>
    <div class="section"><h3>추천 쿨타임 기본값</h3>
      <p class="note" style="margin:0">한 번 먹은 요리를 며칠 동안 추천에서 뺄지 정해요. 레시피마다 따로 정할 수도 있어요.</p>
      <div class="row">
        <label class="field" style="flex:1"><span class="label">어른 (일)</span><input id="sCoolA" type="number" min="0" inputmode="numeric" value="${esc(settings.coolAdult)}"></label>
        <label class="field" style="flex:1"><span class="label">아기 (일)</span><input id="sCoolB" type="number" min="0" inputmode="numeric" value="${esc(settings.coolBaby)}"></label>
      </div>
      <button class="btn ghost" id="sCoolSave">저장</button>
    </div>
    <div class="section"><h3>앱 비밀번호</h3>
      <p class="note" style="margin:0">서버에 정한 APP_PASSWORD와 같은 값을 넣어요. 다른 사람이 내 Gemini 사용량을 쓰지 못하게 막아줘요.</p>
      <label class="field"><span class="label">비밀번호</span><input id="sPw" type="password" value="${esc(load(PW, ""))}" autocomplete="current-password"></label>
      <button class="btn ghost" id="sPwSave">저장</button>
    </div>
    <div class="section"><h3>백업</h3>
      <p class="note" style="margin:0">레시피와 식단 기록은 이 휴대폰에만 저장돼요. 휴대폰을 바꾸거나 앱을 지우기 전에 백업 파일을 받아두세요. 지금 레시피 ${recipes.length}개, 식단 기록 ${log.length}개가 있어요.</p>
      <button class="btn ghost" id="sExport">백업 파일 받기</button>
      <label class="btn ghost" for="sImport" style="text-align:center;box-sizing:border-box">백업 파일 불러오기</label>
      <input id="sImport" type="file" accept="application/json,.json" hidden>
    </div>`;
  document.getElementById("sBack").onclick = () => { if (history.length > 1) history.back(); else location.hash = ""; };
  document.getElementById("sCoolSave").onclick = () => {
    settings.coolAdult = Math.max(0, parseInt(document.getElementById("sCoolA").value, 10) || 0);
    settings.coolBaby = Math.max(0, parseInt(document.getElementById("sCoolB").value, 10) || 0);
    persistSettings(); toast("쿨타임을 저장했어요");
  };
  document.getElementById("sPwSave").onclick = () => { save(PW, document.getElementById("sPw").value.trim()); toast("비밀번호를 저장했어요"); };
  document.getElementById("sExport").onclick = () => {
    const blob = new Blob([JSON.stringify({ app: "kitchen-wiki", version: 2, recipes, log, settings }, null, 2)], { type: "application/json" });
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
      let m = 0;
      if (Array.isArray(data.log)) { const hl = new Set(log.map(x => x.id)); for (const x of data.log) if (x && x.id && x.date && !hl.has(x.id)) { log.push(x); m++; } }
      persist(); persistLog(); toast(`레시피 ${n}개, 기록 ${m}개를 불러왔어요`); renderSettings();
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
