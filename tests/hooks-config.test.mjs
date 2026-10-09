import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// 플러그인 설치 경로에 공백이 있어도 훅 명령이 쪼개지지 않는지, hooks.json의
// 명령을 실제 셸로 실행해 확인한다. 공백 경로는 저장소를 가리키는 심링크로 만든다.
const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const HOOKS = JSON.parse(readFileSync(join(ROOT, "hooks/hooks.json"), "utf-8")).hooks;

const scratch = join(ROOT, ".claude/tmp");
mkdirSync(scratch, { recursive: true });
const base = mkdtempSync(join(scratch, "hooks-config-"));
after(() => rmSync(base, { recursive: true, force: true }));
const SPACED_ROOT = join(base, "plugin root");
symlinkSync(ROOT, SPACED_ROOT);

function commandsOf(event) {
  return HOOKS[event].flatMap((m) => m.hooks).map((h) => h.command);
}

// Claude Code처럼 ${CLAUDE_PLUGIN_ROOT}를 문자 그대로 치환한 뒤 셸에 넘긴다.
// AUTO_VELOG_DRAFTING=1이면 두 훅 모두 부수효과 없이 바로 종료한다.
function runHook(command, pluginRoot, env = {}) {
  return spawnSync("sh", ["-c", command.replaceAll("${CLAUDE_PLUGIN_ROOT}", pluginRoot)], {
    encoding: "utf-8",
    input: "{}",
    env: { ...process.env, CLAUDE_PROJECT_DIR: base, ...env },
  });
}

test("hooks.json의 모든 훅 명령이 공백 있는 플러그인 경로에서 실행된다", () => {
  const all = Object.keys(HOOKS).flatMap(commandsOf);
  assert.ok(all.length >= 2, `훅 명령이 ${all.length}개뿐이다`);
  for (const command of all) {
    const r = runHook(command, SPACED_ROOT, { AUTO_VELOG_DRAFTING: "1" });
    assert.equal(r.status, 0, `${command}\n${r.stderr}`);
    assert.equal(r.stderr, "", command);
  }
});

test("SessionStart 훅은 공백 경로에서도 BlogWorthy 지침을 출력한다", () => {
  const [command] = commandsOf("SessionStart");
  const r = runHook(command, SPACED_ROOT, { AUTO_VELOG_DRAFTING: "" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /★ BlogWorthy/);
});

test("플러그인 경로가 없으면 훅 명령은 실패한다 (위 검사가 실패를 잡아낼 수 있음)", () => {
  const [command] = commandsOf("SessionStart");
  const r = runHook(command, join(base, "missing root"), { AUTO_VELOG_DRAFTING: "1" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /No such file/);
});
