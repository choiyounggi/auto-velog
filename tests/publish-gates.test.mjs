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
