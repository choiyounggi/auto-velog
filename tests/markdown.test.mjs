import test from "node:test";
import assert from "node:assert/strict";
import { parseMarkdown } from "../scripts/lib/markdown.mjs";

test("frontmatter가 있으면 title/tags/meta를 우선 사용한다", () => {
  const md = [
    "---",
    "title: pf 방화벽이 재부팅마다 사라졌던 이유",
    "tags: macOS, 방화벽, 삽질",
    "session: sess-1",
    "score: 8",
    "---",
    "",
    "본문 시작.",
  ].join("\n");
  const { title, body, tags, meta } = parseMarkdown(md);
  assert.equal(title, "pf 방화벽이 재부팅마다 사라졌던 이유");
  assert.deepEqual(tags, ["macOS", "방화벽", "삽질"]);
  assert.equal(meta.session, "sess-1");
  assert.equal(meta.score, "8");
  assert.equal(body, "본문 시작.");
});

test("frontmatter 없으면 H1을 제목으로 쓰고 본문에서 제거한다", () => {
  const md = "# 제목입니다\n\n본문.\n\n**태그**: a, b";
  const { title, body, tags } = parseMarkdown(md);
  assert.equal(title, "제목입니다");
  assert.deepEqual(tags, ["a", "b"]);
  assert.ok(!body.includes("# 제목입니다"));
  assert.ok(!body.includes("**태그**"));
});

test("제목이 전혀 없으면 title은 빈 문자열이다", () => {
  const { title } = parseMarkdown("그냥 본문뿐.");
  assert.equal(title, "");
});

test("빈 입력은 빈 결과를 낸다 (defaultTags 적용)", () => {
  const { title, body, tags } = parseMarkdown("", ["기본"]);
  assert.equal(title, "");
  assert.equal(body, "");
  assert.deepEqual(tags, ["기본"]);
});

test("frontmatter tags의 브래킷 리스트 형식도 파싱한다", () => {
  const { tags } = parseMarkdown("---\ntitle: T\ntags: [a, b, c]\n---\n본문");
  assert.deepEqual(tags, ["a", "b", "c"]);
});

test("CRLF frontmatter도 파싱하고 본문에 \\r을 남기지 않는다", () => {
  const { title, tags, body } = parseMarkdown("---\r\ntitle: 윈도우 줄바꿈\r\ntags: a, b\r\n---\r\n첫 줄\r\n둘째 줄");
  assert.equal(title, "윈도우 줄바꿈");
  assert.deepEqual(tags, ["a", "b"]);
  assert.equal(body, "첫 줄\n둘째 줄");
  assert.ok(!body.includes("\r"));
});

test("본문 중간의 ## 소제목은 제목으로 오인하지 않는다", () => {
  const md = "---\ntitle: T\n---\n## 소제목\n내용";
  const { body } = parseMarkdown(md);
  assert.ok(body.includes("## 소제목"));
});
