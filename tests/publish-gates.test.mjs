/*
 * publish.mjs 안전 게이트 통합 테스트.
 * 가장 높은 스테이크의 동작(시크릿 차단·중복 발행 방지)을 실제 CLI로 검증한다.
 * paths.mjs가 os.homedir()($HOME)로 경로를 만들므로, HOME을 테스트 스크래치로
 * 리다이렉트해 실제 ~/.auto-velog를 건드리지 않는다. 게이트는 전부 브라우저
 * 실행 전에 평가되므로 Playwright 브라우저는 뜨지 않는다.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { tmpFactory } from "./helpers.mjs";

const tmp = tmpFactory("auto-velog-gates-");
const CLI = new URL("../scripts/adapters/velog/publish.mjs", import.meta.url).pathname;

function runPublish(draftPath, home, extraArgs = []) {
  try {
    const stdout = execFileSync("node", [CLI, draftPath, ...extraArgs], {
      encoding: "utf-8",
      env: { ...process.env, HOME: home },
    });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status, stdout: (e.stdout || "") + (e.stderr || "") };
  }
}

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

test("HOME 리다이렉트 확인: 실제 홈에는 아무것도 생기지 않는다", () => {
  // 위 테스트들이 진짜 ~/.auto-velog를 만들었다면 격리 실패
  assert.equal(existsSync(join(homedir(), ".auto-velog", "publish-log.jsonl")), false);
});
