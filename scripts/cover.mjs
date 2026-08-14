/*
 * 블로그 커버(썸네일) 생성기 — AI 이미지 생성 없이 HTML/CSS 타이포그래피 카드를
 * Playwright 스크린샷으로 뽑는다 (1200x630 PNG).
 *
 * 사용법: node cover.mjs <draft.md> [--out <png>] [--variant light|terminal|block|auto]
 * - auto(기본): 본문에 fenced code block이 있으면 terminal, 없으면 light
 * - exit 0 성공(STATUS:COVER + 경로 출력), exit 2 사용법/입력 오류
 */
import { readFileSync, existsSync } from "node:fs";
import { chromium } from "playwright";
import { parseMarkdown } from "./lib/markdown.mjs";
import { loadConfig } from "./lib/config.mjs";

const WIDTH = 1200;
const HEIGHT = 630;
const HANDLE = "velog.io/@dch0202";

// 차분한 톤의 큐레이션 팔레트 — 태그 해시로 결정적 선택
const PALETTE = [
  "#2d5f5d", "#3b5b92", "#5b7553", "#7a5c48",
  "#4a6478", "#6b5b95", "#94524a", "#54604f",
];

export function pickAccent(tags, title = "") {
  const seed = (tags[0] || title || "log").toLowerCase();
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function extractCodeSnippet(body, maxLines = 10) {
  const m = body.match(/```(\w*)\n([\s\S]*?)```/);
  if (!m || !m[2].trim()) return null;
  const lines = m[2].replace(/\s+$/, "").split("\n");
  const clipped = lines.slice(0, maxLines);
  if (lines.length > maxLines) clipped.push("…");
  return { lang: m[1] || "", code: clipped.join("\n") };
}

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const BASE_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; }
  body { font-family: "Apple SD Gothic Neo", "Pretendard", sans-serif; }
  .title { font-weight: 800; word-break: keep-all; overflow-wrap: break-word;
    display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3;
    overflow: hidden; }
  .mono { font-family: "SF Mono", Menlo, monospace; }
`;

function chips(tags, style) {
  return tags.slice(0, 3)
    .map((t) => `<span style="${style}">${esc(t)}</span>`)
    .join("");
}

function lightHtml({ title, tags, accent }) {
  const chipStyle = `font-size:22px;padding:8px 18px;border-radius:999px;
    border:1.5px solid #d8d4cc;color:#6b675f;`;
  return `<style>${BASE_CSS}</style>
  <body style="background:#faf9f7;background-image:radial-gradient(#e3dfd7 1.5px, transparent 1.5px);background-size:28px 28px;">
    <div style="position:absolute;left:0;top:0;bottom:0;width:14px;background:${accent};"></div>
    <div style="position:absolute;inset:0;padding:72px 80px 60px 94px;display:flex;flex-direction:column;justify-content:space-between;">
      <div class="mono" style="font-size:24px;color:#8a857b;">${esc(HANDLE)}</div>
      <div class="title" style="font-size:72px;line-height:1.32;color:#22201c;">${esc(title)}</div>
      <div style="display:flex;gap:14px;align-items:center;">${chips(tags, chipStyle)}</div>
    </div>
  </body>`;
}

function terminalHtml({ title, tags, accent, snippet }) {
  const codeHtml = snippet
    ? `<pre class="mono" style="font-size:21px;line-height:1.6;color:#c8ccd4;overflow:hidden;">${esc(snippet.code)}</pre>`
    : `<div class="mono" style="font-size:24px;color:#7d8590;">$ tail -f ~/.auto-velog/autodraft.log</div>`;
  return `<style>${BASE_CSS}</style>
  <body style="background:#191c22;display:flex;align-items:center;justify-content:center;">
    <div style="width:1020px;background:#242830;border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,.5);overflow:hidden;">
      <div style="display:flex;align-items:center;gap:9px;padding:20px 24px;background:#2c313a;">
        <span style="width:15px;height:15px;border-radius:50%;background:#ff5f57;"></span>
        <span style="width:15px;height:15px;border-radius:50%;background:#febc2e;"></span>
        <span style="width:15px;height:15px;border-radius:50%;background:#28c840;"></span>
        <span class="mono" style="margin-left:14px;font-size:19px;color:#7d8590;">${esc(HANDLE)}</span>
      </div>
      <div style="padding:40px 48px 44px;display:flex;flex-direction:column;gap:30px;">
        <div class="title" style="font-size:52px;line-height:1.35;color:#f0f2f5;-webkit-line-clamp:2;">${esc(title)}</div>
        <div style="border-left:4px solid ${accent};padding:18px 0 18px 26px;max-height:230px;overflow:hidden;">${codeHtml}</div>
        <div class="mono" style="font-size:21px;color:#7d8590;">${tags.slice(0, 3).map((t) => "--" + esc(t)).join("  ")}</div>
      </div>
    </div>
  </body>`;
}

function blockHtml({ title, tags, accent }) {
  const chipStyle = `font-size:22px;padding:8px 18px;border-radius:999px;
    background:rgba(255,255,255,.16);color:rgba(255,255,255,.92);`;
  return `<style>${BASE_CSS}</style>
  <body style="background:${accent};">
    <svg style="position:absolute;inset:0;opacity:.06;" width="${WIDTH}" height="${HEIGHT}">
      <filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.8"/></filter>
      <rect width="100%" height="100%" filter="url(#n)"/>
    </svg>
    <div style="position:absolute;right:56px;top:-40px;font-size:340px;font-weight:800;color:rgba(255,255,255,.10);line-height:1;">&ldquo;</div>
    <div style="position:absolute;inset:0;padding:72px 80px 60px;display:flex;flex-direction:column;justify-content:space-between;">
      <div class="mono" style="font-size:24px;color:rgba(255,255,255,.65);">${esc(HANDLE)}</div>
      <div class="title" style="font-size:74px;line-height:1.3;color:#fff;">${esc(title)}</div>
      <div style="display:flex;gap:14px;">${chips(tags, chipStyle)}</div>
    </div>
  </body>`;
}

const RENDERERS = { light: lightHtml, terminal: terminalHtml, block: blockHtml };

export function renderCoverHtml({ title, tags = [], body = "", variant = "auto" }) {
  if (!title || !title.trim()) throw new Error("제목이 비어 있음");
  const snippet = extractCodeSnippet(body);
  if (variant === "auto") variant = snippet ? "terminal" : "light";
  const render = RENDERERS[variant];
  if (!render) throw new Error(`알 수 없는 variant: ${variant}`);
  const accent = pickAccent(tags, title);
  return { html: render({ title: title.trim(), tags, accent, snippet }), variant };
}

export async function generateCover(draftPath, { out, variant = "auto" } = {}) {
  // publish.mjs와 동일하게 defaultTags를 반영해 커버와 발행 글의 태그를 일치시킨다
  const { publish } = loadConfig();
  const { title, tags, body } = parseMarkdown(
    readFileSync(draftPath, "utf8"),
    publish.defaultTags
  );
  const { html, variant: used } = renderCoverHtml({ title, tags, body, variant });
  const outPath = out || draftPath.replace(/\.md$/, "") + ".cover.png";
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: WIDTH, height: HEIGHT },
    });
    await page.setContent(html, { waitUntil: "load" });
    await page.screenshot({ path: outPath });
  } finally {
    await browser.close();
  }
  return { outPath, variant: used };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (isMain) {
  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith("--"));
  const opt = (name) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const draftPath = positional[0];
  if (!draftPath || !existsSync(draftPath)) {
    console.error("사용법: node cover.mjs <draft.md> [--out <png>] [--variant light|terminal|block|auto]");
    process.exit(2);
  }
  try {
    const { outPath, variant } = await generateCover(draftPath, {
      out: opt("out"),
      variant: opt("variant") || "auto",
    });
    console.log(`STATUS:COVER variant=${variant}`);
    console.log(outPath);
  } catch (err) {
    console.error("커버 생성 실패:", err.message);
    process.exit(2);
  }
}
