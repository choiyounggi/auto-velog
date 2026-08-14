/*
 * 테스트 임시 디렉토리 팩토리.
 * after() 훅에 정리를 등록해 테스트가 실패해도 시스템 temp에 산출물이
 * 누적되지 않게 한다 (마지막 줄 rm은 실패 시 건너뛰어지므로 훅으로).
 */
import { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

// node CLI 실행 + {code, stdout} 캡처 (exit≠0에서도 출력 보존)
export function runNodeCli(scriptPath, args = [], opts = {}) {
  try {
    const stdout = execFileSync("node", [scriptPath, ...args], { encoding: "utf-8", ...opts });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status, stdout: (e.stdout || "") + (e.stderr || "") };
  }
}

export function tmpFactory(prefix) {
  const dirs = [];
  after(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  return () => {
    const d = mkdtempSync(join(tmpdir(), prefix));
    dirs.push(d);
    return d;
  };
}
