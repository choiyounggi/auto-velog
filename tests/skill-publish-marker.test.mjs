/*
 * publish 스킬의 발행 명령과 jev-gate override 마커의 관계를 지킨다.
 *
 * - 자동 발행 명령(--auto)만 마커를 달고, 그 모양이 README의 jev-gate 허용 목록 패턴에 맞는다.
 *   마커가 빠지거나 모양이 패턴에서 벗어나면 헤드리스 발행이 다시 조용히 거부된다(2026-09-29: 17건).
 * - 마커는 안전 게이트를 끄는 플래그와 함께 오지 않고, 다른 명령으로 번지지 않는다.
 *
 * 마커가 실제로 하는 일(헤드리스 claude -p 세션에서 게이트가 모델 판단을 건너뛰고 명령이 실행됨)은
 * jev-gate 훅과 로컬 판단 모델이 있어야 재현되므로 PR에 기록한 실측으로 검증했다. 이 테스트는
 * 그 동작을 떠받치는 문구와 패턴이 어긋나지 않게 하는 트립와이어다.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const SKILLS = new URL("skills/", ROOT);
const MARKER = /[ \t]*#[ \t]*jev-gate:[ \t]*override[ \t]*$/;

// 셸 코드 블록(```bash/sh/zsh, 들여쓰기 포함) 안의 줄만 모은다 — 산문 속 설명은 명령이 아니다.
function shellLines(markdown) {
  const lines = [];
  let fence = null;
  for (const line of markdown.split("\n")) {
    const open = line.match(/^(\s*)```(bash|sh|zsh|shell)\s*$/);
    if (!fence && open) { fence = open[1]; continue; }
    if (fence !== null && /^\s*```\s*$/.test(line)) { fence = null; continue; }
    if (fence !== null) lines.push(line.trim());
  }
  return lines;
}
const skillLines = (skill) => shellLines(readFileSync(new URL(`${skill}/SKILL.md`, SKILLS), "utf-8"));

// 스킬의 자리표시를 실제로 실행될 모양으로 채운다. README 예시의 홈(/Users/you)과 맞춘다.
const fill = (line) =>
  line.replaceAll("<HOME>", "/Users/you").replaceAll("<버전>", "0.2.1").replaceAll("<초안>", "2026-09-29-post");

// README의 jev-gate 허용 목록 예시 블록에서 패턴(주석 아닌 줄)을 꺼낸다.
function readmeAllowPattern() {
  const readme = readFileSync(new URL("README.md", ROOT), "utf-8");
  const block = readme.match(/```\n# auto-velog[^\n]*\n([^\n]+)\n```/);
  assert.ok(block, "README에서 jev-gate 허용 목록 예시 블록을 찾지 못했다");
  return new RegExp(`^(${block[1]})$`);
}

test("셸 블록 파서는 들여쓴 블록과 sh 블록도 읽는다 (파서 자체의 경계)", () => {
  const md = "산문 node x.mjs\n- 목록\n  ```bash\n  node a.mjs\n  ```\n```sh\nnode b.mjs\n```\n```js\nnode c\n```\n";
  assert.deepEqual(shellLines(md), ["node a.mjs", "node b.mjs"]);
  assert.deepEqual(shellLines(""), []);
});

test("자동 발행 명령: --auto 를 달고, 마커를 줄 끝에 달고, 안전 게이트를 끄는 플래그는 없다", () => {
  const marked = skillLines("publish").filter((l) => MARKER.test(l));
  assert.equal(marked.length, 1, `마커가 달린 publish 스킬 명령: ${JSON.stringify(marked)}`);
  const cmd = fill(marked[0]);
  assert.match(cmd, /^node \/\S*\/scripts\/adapters\/velog\/publish\.mjs /);
  assert.match(cmd, / --auto(\s|$)/);
  for (const flag of ["--force", "--ignore-cap", "--private"]) assert.ok(!cmd.includes(flag), `${flag}가 자동 발행 명령에 있다`);
  assert.doesNotMatch(cmd.replace(MARKER, ""), /[;&|<>`$\\]/, "허용 목록은 메타문자·변수 없는 한 줄만 받는다");
});

test("README의 jev-gate 허용 목록 패턴은 자동 발행 명령을 받고, 수동·우회 모양은 받지 않는다", () => {
  const allow = readmeAllowPattern();
  const auto = fill(skillLines("publish").find((l) => MARKER.test(l))).replace(MARKER, "");
  assert.match(auto, allow);
  assert.match(auto.replace(/ \S+\.png/, ""), allow, "커버 생성이 실패해 커버 없이 발행해도 맞아야 한다");
  const manualRaw = skillLines("publish").find((l) => l.includes("publish.mjs") && !MARKER.test(l));
  assert.ok(manualRaw, "수동 발행 명령을 찾지 못했다");
  const manual = fill(manualRaw);
  assert.doesNotMatch(manual, allow, "수동 발행 명령이 허용 목록에 걸리면 안 된다");
  assert.doesNotMatch(`${auto} --force`, allow);
  assert.doesNotMatch(auto.replace("--auto", "--ignore-cap --auto"), allow);
  // 리뷰 2라운드: 경로 자리에 옵션이나 초안 폴더 밖 경로가 끼어들 수 없다
  assert.doesNotMatch(auto.replace("node /", "node --import=/Users/you/evil.mjs /"), allow);
  assert.doesNotMatch(auto.replace("/.auto-velog/drafts/2026-09-29-post.md", "/.auto-velog/drafts/../../.ssh/key.md"), allow);
  assert.doesNotMatch(auto.replace("/Users/you/.claude", "/tmp/x/.claude"), allow);
});

test("마커는 모든 스킬을 통틀어 자동 발행 명령 한 줄에만 있다", () => {
  const skills = readdirSync(SKILLS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  assert.ok(skills.length >= 4, `스킬 디렉토리가 너무 적다: ${skills}`);
  const marked = skills.flatMap((s) => skillLines(s).filter((l) => /jev-gate:[ \t]*override/.test(l)).map((l) => `${s}: ${l}`));
  assert.equal(marked.length, 1, `마커가 달린 명령: ${JSON.stringify(marked)}`);
  assert.match(marked[0], /^publish: node .*publish\.mjs .*--auto/);
});

test("사용자가 곁에 있는 setup 테스트 발행에는 마커도 --auto 도 없다 (경계)", () => {
  const setupPublish = skillLines("setup").filter((l) => l.includes("publish.mjs"));
  assert.ok(setupPublish.length >= 1, "setup 스킬의 테스트 발행 명령을 찾지 못했다");
  for (const l of setupPublish) assert.doesNotMatch(l, /jev-gate|--auto/);
});
