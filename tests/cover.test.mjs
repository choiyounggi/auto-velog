import test from "node:test";
import assert from "node:assert/strict";
import { renderCoverHtml, pickAccent, extractCodeSnippet } from "../scripts/cover.mjs";
import { runNodeCli } from "./helpers.mjs";

const COVER = new URL("../scripts/cover.mjs", import.meta.url).pathname;

test("auto variant: 코드 블록이 있으면 terminal, 없으면 light", () => {
  const withCode = renderCoverHtml({ title: "제목", body: "글\n```js\nconst a = 1;\n```\n" });
  assert.equal(withCode.variant, "terminal");
  const noCode = renderCoverHtml({ title: "제목", body: "코드 없는 글" });
  assert.equal(noCode.variant, "light");
});

test("제목·태그가 HTML 이스케이프되어 렌더링된다", () => {
  const { html } = renderCoverHtml({
    title: "<script>alert(1)</script> & 제목",
    tags: ["<b>x</b>"],
    variant: "light",
  });
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("&lt;b&gt;x&lt;/b&gt;"));
});

test("빈 제목이면 throw, 알 수 없는 variant면 throw", () => {
  assert.throws(() => renderCoverHtml({ title: "   " }), /제목/);
  assert.throws(() => renderCoverHtml({ title: "t", variant: "gradient" }), /variant/);
});

test("태그가 없어도 렌더링되고, 3개 초과 태그는 3개까지만 들어간다", () => {
  const { html } = renderCoverHtml({ title: "t", tags: [], variant: "light" });
  assert.ok(html.includes("t"));
  const many = renderCoverHtml({ title: "t", tags: ["a", "b", "c", "d"], variant: "light" });
  assert.ok(many.html.includes(">c<"));
  assert.ok(!many.html.includes(">d<"));
});

test("pickAccent는 같은 입력에 항상 같은 색, 유효한 hex를 반환한다", () => {
  const c1 = pickAccent(["velog"], "제목");
  assert.equal(c1, pickAccent(["velog"], "다른 제목")); // 첫 태그가 시드
  assert.match(c1, /^#[0-9a-f]{6}$/);
  assert.match(pickAccent([], ""), /^#[0-9a-f]{6}$/); // 태그·제목 모두 없어도 동작
});

test("extractCodeSnippet: 첫 코드 블록을 maxLines로 자르고, 없으면 null", () => {
  const body = "```bash\n" + Array.from({ length: 15 }, (_, i) => `line${i}`).join("\n") + "\n```";
  const snip = extractCodeSnippet(body, 10);
  assert.equal(snip.lang, "bash");
  assert.equal(snip.code.split("\n").length, 11); // 10줄 + "…"
  assert.ok(snip.code.endsWith("…"));
  assert.equal(extractCodeSnippet("코드 없음"), null);
  assert.equal(extractCodeSnippet("```js\n\n```"), null); // 빈 블록
});

test("CLI: 파일 인자가 없거나 존재하지 않으면 exit 2", () => {
  assert.equal(runNodeCli(COVER, []).code, 2);
  assert.equal(runNodeCli(COVER, ["/nonexistent/draft.md"]).code, 2);
});
