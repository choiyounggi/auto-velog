/*
 * publish 스킬의 발행 명령이 jev-gate override 마커를 달고 있는지 지킨다.
 *
 * 마커가 빠지면 헤드리스 배수 세션의 발행이 다시 조용히 거부된다(2026-09-29: 하루 17건).
 * 마커가 실제로 하는 일(헤드리스 claude -p 세션에서 게이트가 모델 판단을 건너뛰고 명령이
 * 실행됨)은 jev-gate 훅과 로컬 판단 모델이 있어야 재현되므로 PR에 기록한 실측으로 검증했다.
 * 이 테스트는 그 동작을 떠받치는 문구가 사라지거나 번지지 않게 하는 트립와이어다.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const SKILLS = new URL("../skills/", import.meta.url);
const MARKER_AT_END = /#[ \t]*jev-gate:[ \t]*override[ \t]*$/;

// 스킬 문서의 ```bash 블록 안 줄만 모은다 (산문 속 설명은 명령이 아니다).
function bashLines(skill) {
  const md = readFileSync(new URL(`${skill}/SKILL.md`, SKILLS), "utf-8");
  const lines = [];
  let inBash = false;
  for (const line of md.split("\n")) {
    if (/^```bash\s*$/.test(line)) { inBash = true; continue; }
    if (/^```\s*$/.test(line)) { inBash = false; continue; }
    if (inBash) lines.push(line);
  }
  return lines;
}

test("publish 스킬의 publish.mjs 명령은 줄 끝에 override 마커를 단다", () => {
  const publishLines = bashLines("publish").filter((l) => l.includes("publish.mjs"));
  assert.equal(publishLines.length, 1, "발행 명령 줄이 정확히 하나여야 한다");
  // jev-gate는 명령의 마지막 줄 끝에 있는 마커만 인정한다.
  assert.match(publishLines[0], MARKER_AT_END);
});

test("마커는 발행 명령 한 줄에만 있다 — 다른 명령에 번지지 않는다", () => {
  const skills = readdirSync(SKILLS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  assert.ok(skills.length > 0, "스킬 디렉토리를 찾지 못했다");
  const marked = skills.flatMap((s) =>
    bashLines(s).filter((l) => /jev-gate:[ \t]*override/.test(l)).map((l) => `${s}: ${l.trim()}`),
  );
  assert.equal(marked.length, 1, `마커가 달린 명령: ${JSON.stringify(marked)}`);
  assert.match(marked[0], /^publish: node .*publish\.mjs/);
});

test("사용자가 곁에 있는 setup 테스트 발행에는 마커가 없다 (경계)", () => {
  const setupPublish = bashLines("setup").filter((l) => l.includes("publish.mjs"));
  assert.ok(setupPublish.length >= 1, "setup 스킬의 테스트 발행 명령을 찾지 못했다");
  for (const l of setupPublish) assert.doesNotMatch(l, /jev-gate/);
});
