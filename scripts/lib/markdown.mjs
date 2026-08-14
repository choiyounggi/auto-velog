/*
 * draft 마크다운 파서.
 * YAML frontmatter(title/tags/session/score 등) 우선, 없으면 첫 H1을 제목으로,
 * 말미 `**태그**:` 줄을 태그로 파싱한다 (기존 velog-publish.mjs 형식 호환).
 */

function parseTags(raw) {
  return raw
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((t) => t.trim().replace(/^#/, "").replace(/["'`]/g, ""))
    .filter(Boolean);
}

export function parseMarkdown(content, defaultTags = []) {
  let title = "";
  let tags = [];
  const meta = {};
  let body = content;

  // 1) YAML frontmatter 우선
  const fm = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fm) {
    for (const line of fm[1].split("\n")) {
      const m = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
      if (!m) continue;
      const [, key, val] = m;
      if (key === "title") title = val.trim().replace(/^["']|["']$/g, "");
      else if (key === "tags") tags = parseTags(val);
      else meta[key] = val.trim();
    }
    body = content.slice(fm[0].length);
  }

  const lines = body.split("\n");

  // 2) H1 fallback — 문서 첫머리의 H1은 제목으로 쓰고 본문에서 제거
  let bodyStartIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("# ") && !lines[i].startsWith("## ")) {
      if (!title) title = lines[i].replace(/^#\s+/, "").trim();
      bodyStartIdx = i + 1;
      break;
    }
    if (lines[i].trim()) break; // 첫 비어있지 않은 줄이 H1이 아니면 제목 탐색 중단
  }

  // 3) 말미 **태그**: 줄 (frontmatter tags 없을 때)
  const bodyLines = lines.slice(bodyStartIdx);
  const lastTagIdx = bodyLines.findLastIndex((l) => /^\*\*(?:태그|tags?)\*?\*?:/.test(l));
  if (lastTagIdx >= 0 && tags.length === 0) {
    const tagMatch =
      bodyLines[lastTagIdx].match(/\*\*(?:태그|tags?)\*\*:\s*(.+)/i) ||
      bodyLines[lastTagIdx].match(/\*\*(?:태그|tags?)\s*:\*\*\s*(.+)/i);
    if (tagMatch) tags = parseTags(tagMatch[1]);
  }
  const finalBody = (lastTagIdx >= 0 ? bodyLines.slice(0, lastTagIdx) : bodyLines).join("\n").trim();

  if (tags.length === 0) tags = [...defaultTags];
  return { title, body: finalBody, tags, meta };
}
