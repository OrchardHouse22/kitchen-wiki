// POST /api/extract
// body: { url?: string, text?: string, images?: [{ mime: string, data: base64 }] }
// header: x-app-key (must match APP_PASSWORD when that env var is set)
// Returns the recipe JSON, or { error } with a non-200 status.

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const PROMPT = `너는 요리 레시피 정리 도우미야. 주어진 자료(유튜브 영상, SNS 캡션, 영상 설명란, 캡쳐 이미지 등)에서 레시피를 뽑아 정리해.
영상이 주어지면 화면 자막, 말로 하는 설명, 화면에 보이는 재료와 동작을 모두 참고해.
반드시 JSON 객체 하나만 답해. 형식:
{"title":"요리 이름","servings":1,"tags":["메인 재료나 분류, 최대 4개"],
 "ingredients":[{"name":"대패삼겹살","qty":150,"unit":"g","note":"","group":""}],
 "steps":["{0}을 팬에 굽는다"],
 "tips":"원문에 있는 팁이나 주의점 (없으면 빈 문자열)"}
규칙:
- servings: 원문이 말하는 기준 인분 숫자. 명시가 없으면 재료 양을 보고 추정하고, 모르겠으면 1.
- qty는 숫자만 (1/2 → 0.5, 1과1/2 → 1.5). "약간", "적당량"처럼 숫자가 없으면 qty는 null, note에 그 표현을 넣어.
- unit은 원문 단위를 그대로 (g, ml, 큰술, 작은술, T, t, 컵, 개, 줌, 대 등).
- group: 원문이 "양념", "소스"처럼 재료를 묶었으면 그 이름, 아니면 빈 문자열. 같은 group은 연속되게 배치.
- steps: 짧고 명확한 한 문장씩, 순서대로. 재료를 넣거나 쓰는 지점에는 그 재료를 {재료 인덱스}로 표시해 (0부터). 예: "팬에 {3}를 두르고 {0}을 볶는다". 표시된 자리에는 '재료명 + 분량'이 들어가니 재료명을 따로 또 쓰지 마.
- 시간이 있으면 "5분", "30초"처럼 숫자+단위로 적어.
- 자료에 없는 재료나 단계를 지어내지 마. 다른 언어여도 한국어로 정리해.
- 레시피를 찾을 수 없으면 {"error":"이유 한 줄"} 만 답해.`;

function youtubeUrl(u) {
  try {
    const url = new URL(u);
    const host = url.hostname.replace(/^(www\.|m\.)/, "");
    let id = null;
    if (host === "youtu.be") id = url.pathname.slice(1).split("/")[0];
    else if (host === "youtube.com" || host === "music.youtube.com") {
      if (url.pathname === "/watch") id = url.searchParams.get("v");
      else {
        const m = url.pathname.match(/^\/(shorts|live|embed)\/([^/?#]+)/);
        if (m) id = m[2];
      }
    }
    return id && /^[\w-]{6,20}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : null;
  } catch { return null; }
}

function send(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "POST만 받아요." });

  const pw = process.env.APP_PASSWORD;
  if (pw && req.headers["x-app-key"] !== pw) return send(res, 401, { error: "앱 비밀번호가 맞지 않아요." });
  if (!process.env.GEMINI_API_KEY) return send(res, 500, { error: "서버에 GEMINI_API_KEY가 설정되지 않았어요." });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const url = String(body.url || "").trim();
  const text = String(body.text || "").slice(0, 20000);
  const images = Array.isArray(body.images) ? body.images.slice(0, 6) : [];
  const yt = youtubeUrl(url);

  if (!yt && !text.trim() && !images.length) {
    return send(res, 400, {
      error: url ? "이 링크는 내용을 직접 읽을 수 없어요. 캡션을 붙여넣거나 캡쳐본을 올려 주세요." : "링크, 글, 캡쳐본 중 하나는 넣어 주세요.",
    });
  }

  const parts = [];
  if (yt) parts.push({ file_data: { file_uri: yt } });
  for (const im of images) {
    if (im && typeof im.data === "string" && /^image\//.test(im.mime || "")) {
      parts.push({ inline_data: { mime_type: im.mime, data: im.data } });
    }
  }
  parts.push({
    text: PROMPT +
      `\n\n원본 링크: ${url || "(없음)"}` +
      (yt ? "\n위 유튜브 영상이 레시피 원본이야." : "") +
      (images.length ? `\n첨부 이미지 ${images.length}장은 레시피 게시물/영상의 캡쳐본이야.` : "") +
      `\n\n--- 사용자가 붙여넣은 글 ---\n${text || "(없음)"}`,
  });

  let r;
  try {
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
      }),
    });
  } catch (e) {
    return send(res, 502, { error: "Gemini에 연결하지 못했어요. 잠시 후 다시 시도해 주세요." });
  }

  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data?.error?.message || `HTTP ${r.status}`;
    const status = r.status === 429 ? 429 : 502;
    return send(res, status, {
      error: r.status === 429 ? "Gemini 사용량 한도에 걸렸어요. 잠시 후 다시 시도해 주세요." : `Gemini 오류: ${msg}`,
    });
  }

  const raw = (data?.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("");
  let out;
  try {
    out = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    try { out = m ? JSON.parse(m[0]) : null; } catch { out = null; }
  }
  if (!out) return send(res, 502, { error: "정리 결과를 읽지 못했어요. 한 번 더 시도해 주세요." });
  if (out.error) return send(res, 422, { error: `레시피를 찾지 못했어요: ${out.error}` });

  return send(res, 200, {
    title: String(out.title || "이름 없는 요리").slice(0, 80),
    servings: Number(out.servings) > 0 ? Number(out.servings) : 1,
    tags: Array.isArray(out.tags) ? out.tags.map(String).slice(0, 6) : [],
    ingredients: (Array.isArray(out.ingredients) ? out.ingredients : []).map(i => ({
      name: String(i?.name || ""),
      qty: i?.qty == null || isNaN(Number(i.qty)) ? null : Number(i.qty),
      unit: String(i?.unit || ""),
      note: String(i?.note || ""),
      group: String(i?.group || ""),
    })).filter(i => i.name),
    steps: (Array.isArray(out.steps) ? out.steps : []).map(String).filter(Boolean),
    tips: String(out.tips || ""),
  });
}
