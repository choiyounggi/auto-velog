import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { harvest } from "../scripts/harvest.mjs";
import { tmpFactory } from "./helpers.mjs";

const tmp = tmpFactory("auto-velog-harvest-");
const CLI = new URL("../scripts/harvest.mjs", import.meta.url).pathname;

function block({ topic = "pf 방화벽 재부팅 함정", story = "pf 규칙이 재부팅 후 사라져서 삽질하다 launchd로 해결했다", extra = "" } = {}) {
  return [
    "★ BlogWorthy ────────────────────────",
    topic !== null ? `topic: ${topic}` : "",
    "angle: 복기",
    story !== null ? `story: ${story}` : "",
    "code-refs: /etc/pf.conf, pfctl -f",
    "why-worth: macOS 방화벽 영속화의 함정",
    extra,
    "─────────────────────────────────────",
  ].filter(Boolean).join("\n");
}

function transcriptWith(...texts) {
  const dir = tmp();
  const p = join(dir, "session-1.jsonl");
  const lines = texts.map((t) =>
    JSON.stringify({ message: { role: "assistant", content: [{ type: "text", text: t }] } })
  );
  writeFileSync(p, lines.join("\n") + "\n");
  return p;
}

function run(transcriptPath, queueDir, sessionId = "sess-1") {
  return harvest(
    { session_id: sessionId, transcript_path: transcriptPath, cwd: "/tmp/project" },
    { queueDir }
  );
}

test("정상 블록 1개를 파싱해 큐에 적재한다", () => {
  const queueDir = tmp();
  const added = run(transcriptWith(`작업 끝.\n\n${block()}\n\n이상입니다.`), queueDir);
  assert.equal(added, 1);
  const rows = readFileSync(join(queueDir, "sess-1.jsonl"), "utf-8").trim().split("\n").map(JSON.parse);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].topic, "pf 방화벽 재부팅 함정");
  assert.match(rows[0].story, /launchd/);
  assert.equal(rows[0].status, "pending");
  assert.equal(rows[0].transcriptPath.endsWith("session-1.jsonl"), true);
});

test("topic 누락 블록은 드롭한다", () => {
  const queueDir = tmp();
  const added = run(transcriptWith(block({ topic: null })), queueDir);
  assert.equal(added, 0);
  assert.equal(existsSync(join(queueDir, "sess-1.jsonl")), false);
});

test("플레이스홀더가 남은 지침 에코는 드롭한다", () => {
  const queueDir = tmp();
  const added = run(transcriptWith(block({ topic: "<글 제목이 될 만한 한 줄>" })), queueDir);
  assert.equal(added, 0);
});

test("빈 트랜스크립트면 0을 반환한다", () => {
  const queueDir = tmp();
  const dir = tmp();
  const p = join(dir, "empty.jsonl");
  writeFileSync(p, "");
  const added = run(p, queueDir);
  assert.equal(added, 0);
});

test("같은 블록 재수확은 dedup 된다", () => {
  const queueDir = tmp();
  const t = transcriptWith(block());
  assert.equal(run(t, queueDir), 1);
  assert.equal(run(t, queueDir), 0); // 같은 세션 재실행
  const rows = readFileSync(join(queueDir, "sess-1.jsonl"), "utf-8").trim().split("\n");
  assert.equal(rows.length, 1);
});

test("블록 4개면 캡 3까지만 적재한다", () => {
  const queueDir = tmp();
  const texts = [1, 2, 3, 4].map((i) => block({ topic: `주제 ${i}`, story: `이야기 ${i} — 문제를 겪고 해결한 서로 다른 기록` }));
  const added = run(transcriptWith(...texts), queueDir);
  assert.equal(added, 3);
});

test("story 누락 블록은 드롭한다", () => {
  const queueDir = tmp();
  const added = run(transcriptWith(block({ story: null })), queueDir);
  assert.equal(added, 0);
});

test("10000자 초과 폭주 블록은 드롭한다", () => {
  const queueDir = tmp();
  const added = run(transcriptWith(block({ story: "가".repeat(11_000) })), queueDir);
  assert.equal(added, 0);
});

test("30자 미만의 얇은 블록은 드롭한다", () => {
  const queueDir = tmp();
  const thin = "★ BlogWorthy ────────────\ntopic: 짧다\nstory: 응\n────────────";
  const added = run(transcriptWith(thin), queueDir);
  assert.equal(added, 0);
});

test("트랜스크립트 파일이 없으면 0을 반환하고 큐를 만들지 않는다", () => {
  const queueDir = tmp();
  const added = run(join(tmp(), "no-such.jsonl"), queueDir);
  assert.equal(added, 0);
  assert.equal(existsSync(join(queueDir, "sess-1.jsonl")), false);
});

test("CLI: 빈 페이로드 stdin이면 ADDED:0을 출력하고 exit 0", () => {
  const out = execFileSync("node", [CLI], { input: "{}", encoding: "utf-8" });
  assert.equal(out.trim(), "ADDED:0");
});
