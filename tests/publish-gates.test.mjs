/*
 * publish.mjs 안전 게이트 통합 테스트.
 * 가장 높은 스테이크의 동작(시크릿 차단·중복 발행 방지)을 실제 CLI로 검증한다.
 * paths.mjs가 os.homedir()($HOME)로 경로를 만들므로, HOME을 테스트 스크래치로
 * 리다이렉트해 실제 ~/.auto-velog를 건드리지 않는다. 게이트는 전부 브라우저
 * 실행 전에 평가되므로 Playwright 브라우저는 뜨지 않는다.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { tmpFactory, runNodeCli } from "./helpers.mjs";

const tmp = tmpFactory("auto-velog-gates-");
const REAL_LOG = join(homedir(), ".auto-velog", "publish-log.jsonl");
const readRealLog = () => (existsSync(REAL_LOG) ? readFileSync(REAL_LOG, "utf8") : null);
const REAL_LOG_BEFORE = readRealLog();
const CLI = new URL("../scripts/adapters/velog/publish.mjs", import.meta.url).pathname;

const runPublish = (draftPath, home, extraArgs = []) =>
  runNodeCli(CLI, [draftPath, ...extraArgs], { env: { ...process.env, HOME: home } });

function draft(home, name, body, title = name) {
  const p = join(home, `${name}.md`);
  writeFileSync(p, `---\ntitle: ${title}\ntags: test\n---\n${body}\n`);
  return p;
}

test("시크릿이 있으면 exit 3 + STATUS:BLOCKED (브라우저·로그인 전 차단)", () => {
  const home = tmp();
  const p = draft(home, "leaky", "배포 키 AKIAIOSFODNN7EXAMPLE 를 썼다");
  const { code, stdout } = runPublish(p, home);
  assert.equal(code, 3);
  assert.match(stdout, /STATUS:BLOCKED/);
});

test("--force 로도 시크릿 차단은 우회되지 않는다", () => {
  const home = tmp();
  const p = draft(home, "leaky-force", "토큰 ghp_abcdefghijklmnopqrstuvwxyz0123456789");
  const { code, stdout } = runPublish(p, home, ["--force"]);
  assert.equal(code, 3);
  assert.match(stdout, /STATUS:BLOCKED/);
});

test("publish-log에 같은 제목이 있으면 exit 0 + STATUS:ALREADY_PUBLISHED", () => {
  const home = tmp();
  mkdirSync(join(home, ".auto-velog"), { recursive: true });
  writeFileSync(
    join(home, ".auto-velog", "publish-log.jsonl"),
    JSON.stringify({ ts: "2026-08-14T01:00:00Z", title: "중복 글", url: "u" }) + "\n"
  );
  const p = draft(home, "dup", "깨끗한 본문입니다", "중복 글");
  const { code, stdout } = runPublish(p, home);
  assert.equal(code, 0);
  assert.match(stdout, /STATUS:ALREADY_PUBLISHED/);
});

test("frontmatter status:published 인 draft도 재발행하지 않는다", () => {
  const home = tmp();
  const p = join(home, "done.md");
  writeFileSync(p, "---\ntitle: 끝난 글\ntags: t\nstatus: published\n---\n본문");
  const { code, stdout } = runPublish(p, home);
  assert.equal(code, 0);
  assert.match(stdout, /STATUS:ALREADY_PUBLISHED/);
});

test("클린 + 미발행 + 쿠키 없음이면 exit 2 + STATUS:LOGIN_REQUIRED", () => {
  const home = tmp();
  const p = draft(home, "clean", "깨끗한 본문입니다");
  const { code, stdout } = runPublish(p, home);
  assert.equal(code, 2);
  assert.match(stdout, /STATUS:LOGIN_REQUIRED/);
});

test("HOME 리다이렉트 확인: 실제 홈의 발행 로그가 변하지 않는다", () => {
  // 위 테스트들이 진짜 ~/.auto-velog에 기록했다면 격리 실패.
  // 실사용 머신에는 로그가 원래 존재할 수 있으므로 "부재"가 아니라 "불변"을 검증한다.
  assert.deepEqual(readRealLog(), REAL_LOG_BEFORE);
});

// --- 상태 가드 / 일일 상한 (무인 배수 경로 때문에 코드로 내려온 게이트) --------

function draftWithStatus(home, name, status) {
  const p = join(home, `${name}.md`);
  writeFileSync(p, `---\ntitle: ${name}\ntags: test\nstatus: ${status}\n---\n평범한 본문입니다.\n`);
  return p;
}

function withConfig(home, publish) {
  mkdirSync(join(home, ".auto-velog"), { recursive: true });
  writeFileSync(join(home, ".auto-velog", "config.json"), JSON.stringify({ publish }));
}

function logPublishedToday(home, n) {
  mkdirSync(join(home, ".auto-velog"), { recursive: true });
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push(JSON.stringify({ title: `기존 글 ${i}`, ts: new Date().toISOString(), url: "u" }));
  }
  writeFileSync(join(home, ".auto-velog", "publish-log.jsonl"), rows.join("\n") + "\n");
}

test("blocked 초안은 exit 4 + STATUS:NOT_ELIGIBLE", () => {
  const home = tmp();
  const { code, stdout } = runPublish(draftWithStatus(home, "blocked-one", "blocked"), home);
  assert.equal(code, 4);
  assert.match(stdout, /STATUS:NOT_ELIGIBLE/);
});

test("failed 초안도 발행되지 않는다", () => {
  const home = tmp();
  const { code } = runPublish(draftWithStatus(home, "failed-one", "failed"), home);
  assert.equal(code, 4);
});

test("deferred 초안은 상태 가드를 통과한다 (상한 전까지)", () => {
  const home = tmp();
  withConfig(home, { mode: "auto", dailyCap: 5, defaultTags: [] });
  const { code, stdout } = runPublish(draftWithStatus(home, "deferred-one", "deferred"), home);
  assert.notEqual(code, 4);
  assert.doesNotMatch(stdout, /STATUS:NOT_ELIGIBLE/);
});

test("--force 는 상태 가드를 우회한다", () => {
  const home = tmp();
  withConfig(home, { mode: "auto", dailyCap: 5, defaultTags: [] });
  const { code } = runPublish(draftWithStatus(home, "blocked-forced", "blocked"), home, ["--force"]);
  assert.notEqual(code, 4);
});

test("오늘 상한을 채웠으면 exit 5 + STATUS:CAP_REACHED", () => {
  const home = tmp();
  withConfig(home, { mode: "auto", dailyCap: 1, defaultTags: [] });
  logPublishedToday(home, 1);
  const { code, stdout } = runPublish(draftWithStatus(home, "over-cap", "deferred"), home);
  assert.equal(code, 5);
  assert.match(stdout, /STATUS:CAP_REACHED/);
});

test("상한에 여유가 있으면 상한 가드는 통과한다", () => {
  const home = tmp();
  withConfig(home, { mode: "auto", dailyCap: 3, defaultTags: [] });
  logPublishedToday(home, 1);
  const { code, stdout } = runPublish(draftWithStatus(home, "under-cap", "deferred"), home);
  assert.notEqual(code, 5);
  assert.doesNotMatch(stdout, /STATUS:CAP_REACHED/);
});

test("--ignore-cap 은 상한을 우회한다", () => {
  const home = tmp();
  withConfig(home, { mode: "auto", dailyCap: 1, defaultTags: [] });
  logPublishedToday(home, 5);
  const { code } = runPublish(draftWithStatus(home, "cap-ignored", "deferred"), home, ["--ignore-cap"]);
  assert.notEqual(code, 5);
});

test("--private 테스트 발행은 상한에서 제외된다 (setup 스킬이 막히지 않도록)", () => {
  const home = tmp();
  withConfig(home, { mode: "auto", dailyCap: 1, defaultTags: [] });
  logPublishedToday(home, 3);
  const { code } = runPublish(draftWithStatus(home, "private-test", "pending"), home, ["--private"]);
  assert.notEqual(code, 5);
});

test("상한 가드는 시크릿 차단보다 뒤에 있지 않다 — 시크릿이 있으면 상한과 무관하게 exit 3", () => {
  const home = tmp();
  withConfig(home, { mode: "auto", dailyCap: 9, defaultTags: [] });
  const p = join(home, "leaky-deferred.md");
  writeFileSync(p, `---\ntitle: leaky-deferred\ntags: test\nstatus: deferred\n---\n키 AKIAIOSFODNN7EXAMPLE 노출\n`);
  const { code, stdout } = runPublish(p, home);
  assert.equal(code, 3);
  assert.match(stdout, /STATUS:BLOCKED/);
});

// --- --auto: 무인 세션의 "사용자가 이미 승인했다"는 주장을 코드로 확인 ---------------
// 헤드리스 발행 명령은 jev-gate 허용 목록에 올라 모델 판단을 건너뛴다. 그 대가로 이 명령
// 자체가 자동 발행 설정(mode)과 점수 기준을 확인하고, 안전 게이트를 끄는 플래그를 거부한다.

// --auto 초안은 초안 폴더(~/.auto-velog/drafts) 안에 있어야 하므로 리다이렉트된 HOME의 그 폴더에 쓴다.
function scoredDraft(home, name, score, dir = join(home, ".auto-velog", "drafts")) {
  mkdirSync(dir, { recursive: true });
  const p = join(dir, `${name}.md`);
  const scoreLine = score === null ? "" : `score: ${score}\n`;
  writeFileSync(p, `---\ntitle: ${name}\ntags: test\nstatus: deferred\n${scoreLine}---\n평범한 본문입니다.\n`);
  return p;
}
const AUTO_CFG = { mode: "auto", dailyCap: 5, minScore: 7, defaultTags: [] };

test("--auto 는 mode=auto 이고 점수가 기준 이상이면 게이트를 통과한다 (로그인 단계까지 간다)", () => {
  const home = tmp();
  withConfig(home, AUTO_CFG);
  const { code, stdout } = runPublish(scoredDraft(home, "auto-ok", 8), home, ["--auto"]);
  assert.equal(code, 2);
  assert.match(stdout, /STATUS:LOGIN_REQUIRED/);
});

test("--auto 는 approve 모드에서 exit 4 + STATUS:NOT_ELIGIBLE", () => {
  const home = tmp();
  withConfig(home, { ...AUTO_CFG, mode: "approve" });
  const { code, stdout } = runPublish(scoredDraft(home, "auto-approve-mode", 9), home, ["--auto"]);
  assert.equal(code, 4);
  assert.match(stdout, /STATUS:NOT_ELIGIBLE/);
  assert.match(stdout, /mode/);
});

test("--auto 는 config가 없으면(기본 approve) 거부한다", () => {
  const home = tmp();
  const { code } = runPublish(scoredDraft(home, "auto-no-config", 9), home, ["--auto"]);
  assert.equal(code, 4);
});

test("--auto 는 점수가 없거나 숫자가 아니면 거부한다", () => {
  const home = tmp();
  withConfig(home, AUTO_CFG);
  assert.equal(runPublish(scoredDraft(home, "auto-no-score", null), home, ["--auto"]).code, 4);
  assert.equal(runPublish(scoredDraft(home, "auto-bad-score", "높음"), home, ["--auto"]).code, 4);
});

test("--auto 점수 경계: minScore 미만은 거부, 같으면 통과", () => {
  const home = tmp();
  withConfig(home, AUTO_CFG);
  assert.equal(runPublish(scoredDraft(home, "auto-six", 6.9), home, ["--auto"]).code, 4);
  assert.equal(runPublish(scoredDraft(home, "auto-seven", 7), home, ["--auto"]).code, 2);
});

for (const flag of ["--force", "--ignore-cap", "--private"]) {
  test(`--auto 는 ${flag} 와 함께 쓰면 거부한다`, () => {
    const home = tmp();
    withConfig(home, AUTO_CFG);
    const { code, stdout } = runPublish(scoredDraft(home, `auto-with${flag}`, 9), home, ["--auto", flag]);
    assert.equal(code, 4);
    assert.match(stdout, /STATUS:NOT_ELIGIBLE/);
  });
}

test("--auto 없이는 mode·점수를 보지 않는다 (사용자가 직접 요청한 수동 발행)", () => {
  const home = tmp();
  withConfig(home, { ...AUTO_CFG, mode: "approve" });
  const { code } = runPublish(scoredDraft(home, "manual-approve", null), home);
  assert.equal(code, 2);
});

test("--auto 는 초안 폴더 밖의 .md 를 거부한다 (세션이 방금 쓴 임의 파일 발행 방지)", () => {
  const home = tmp();
  withConfig(home, AUTO_CFG);
  const outside = scoredDraft(home, "auto-outside", 9, join(home, "elsewhere"));
  const { code, stdout } = runPublish(outside, home, ["--auto"]);
  assert.equal(code, 4);
  assert.match(stdout, /STATUS:NOT_ELIGIBLE/);
});

test("--auto 는 ../ 로 초안 폴더를 빠져나간 경로도 실제 위치로 판단해 거부한다", () => {
  const home = tmp();
  withConfig(home, AUTO_CFG);
  scoredDraft(home, "auto-climb", 9, join(home, "elsewhere"));
  mkdirSync(join(home, ".auto-velog", "drafts"), { recursive: true });
  const climbing = join(home, ".auto-velog", "drafts", "..", "..", "elsewhere", "auto-climb.md");
  assert.equal(runPublish(climbing, home, ["--auto"]).code, 4);
});

test("--auto 는 초안 폴더 밖의 커버도 거부한다", () => {
  const home = tmp();
  withConfig(home, AUTO_CFG);
  const p = scoredDraft(home, "auto-cover-outside", 9);
  const cover = join(home, "leak.png");
  writeFileSync(cover, "x");
  assert.equal(runPublish(p, home, [cover, "--auto"]).code, 4);
});

test("--auto 로도 상한은 그대로다", () => {
  const home = tmp();
  withConfig(home, { ...AUTO_CFG, dailyCap: 1 });
  logPublishedToday(home, 1);
  const { code, stdout } = runPublish(scoredDraft(home, "auto-over-cap", 9), home, ["--auto"]);
  assert.equal(code, 5);
  assert.match(stdout, /STATUS:CAP_REACHED/);
});
