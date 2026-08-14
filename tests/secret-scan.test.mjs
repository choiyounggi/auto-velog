import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { scanText } from "../scripts/secret-scan.mjs";

const tmp = () => mkdtempSync(join(tmpdir(), "auto-velog-scan-"));
const CLI = new URL("../scripts/secret-scan.mjs", import.meta.url).pathname;

function runCli(args) {
  try {
    const stdout = execFileSync("node", [CLI, ...args], { encoding: "utf-8" });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status, stdout: e.stdout || "" };
  }
}

test("클린 텍스트는 빈 배열을 반환한다", () => {
  assert.deepEqual(scanText("pf 규칙을 launchd plist로 영속화했다. pfctl -f /etc/pf.conf"), []);
});

test("유형별 시크릿을 탐지한다", () => {
  const cases = [
    ["aws-key", "key=AKIAIOSFODNN7EXAMPLE"],
    ["api-token", "OPENAI_KEY=sk-proj-abcdefghijklmnopqrstuvwx"],
    ["github-token", "ghp_abcdefghijklmnopqrstuvwxyz0123456789"],
    ["jwt", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9P"],
    ["private-key", "-----BEGIN RSA PRIVATE KEY-----"],
    ["private-ip", "서버는 192.168.0.42 에 있다"],
    ["email", "관리자 dch020223@gmail.com 에게"],
    ["assignment", 'password = "hunter2hunter2"'],
  ];
  for (const [type, text] of cases) {
    const found = scanText(text);
    assert.ok(found.some((f) => f.type === type), `${type} 미탐지: ${JSON.stringify(found)}`);
  }
});

test("masked에 원문 전체가 노출되지 않는다", () => {
  const [f] = scanText("token: ghp_abcdefghijklmnopqrstuvwxyz0123456789");
  assert.ok(!f.masked.includes("abcdefghijklmnopqrstuvwxyz0123456789"));
  assert.ok(f.masked.length < 20);
});

test("커스텀 denyPattern을 탐지한다", () => {
  const found = scanText("접속: my-internal-host.corp", ["[\\w-]+\\.corp"]);
  assert.ok(found.some((f) => f.type === "custom"));
});

test("CLI: 빈 파일은 exit 0", () => {
  const p = join(tmp(), "empty.md");
  writeFileSync(p, "");
  assert.equal(runCli([p]).code, 0);
});

test("CLI: 시크릿 있는 파일은 exit 1 + findings JSON", () => {
  const p = join(tmp(), "leaky.md");
  writeFileSync(p, "배포 키는 AKIAIOSFODNN7EXAMPLE 였다");
  const { code, stdout } = runCli([p]);
  assert.equal(code, 1);
  const findings = JSON.parse(stdout);
  assert.equal(findings[0].type, "aws-key");
  assert.equal(findings[0].line, 1);
});

test("CLI: 파일 없으면 exit 2", () => {
  assert.equal(runCli([join(tmp(), "nope.md")]).code, 2);
});
