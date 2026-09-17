import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { drainDecision, backlogCount } from "../scripts/drain-check.mjs";
import { tmpFactory, runNodeCli } from "./helpers.mjs";

const tmp = tmpFactory("auto-velog-drain-");
const CLI = new URL("../scripts/drain-check.mjs", import.meta.url).pathname;

// 초안 하나를 status만 바꿔가며 찍어내는 헬퍼.
function drafts(...statuses) {
  const dir = tmp();
  statuses.forEach((status, i) => {
    const fm = status === null ? "" : `status: ${status}\n`;
    writeFileSync(
      join(dir, `2026-09-0${i + 1}-post-${i}.md`),
      `---\ntitle: 글 ${i}\n${fm}---\n\n본문\n`,
    );
  });
  return dir;
}

const AUTO = { publish: { mode: "auto", dailyCap: 1 } };

test("배수 대상이 있고 상한에 여유가 있으면 배수한다", () => {
  const d = drainDecision({
    draftsDir: drafts("deferred", "published"),
    config: AUTO,
    publishedToday: 0,
  });
  assert.equal(d.drain, true);
  assert.equal(d.backlog, 1);
  assert.equal(d.room, 1);
});

test("오늘 상한을 이미 채웠으면 배수하지 않는다", () => {
  const d = drainDecision({
    draftsDir: drafts("deferred", "deferred"),
    config: AUTO,
    publishedToday: 1,
  });
  assert.equal(d.drain, false);
  assert.equal(d.room, 0);
  assert.match(d.reason, /상한 소진/);
});

test("밀린 초안이 없으면 배수하지 않는다", () => {
  const d = drainDecision({
    draftsDir: drafts("published", "published"),
    config: AUTO,
    publishedToday: 0,
  });
  assert.equal(d.drain, false);
  assert.equal(d.backlog, 0);
  assert.match(d.reason, /밀린 초안 없음/);
});

test("mode가 auto가 아니면 배수하지 않는다", () => {
  const d = drainDecision({
    draftsDir: drafts("deferred"),
    config: { publish: { mode: "approve", dailyCap: 5 } },
    publishedToday: 0,
  });
  assert.equal(d.drain, false);
  assert.match(d.reason, /mode=approve/);
});

test("dailyCap이 0이거나 숫자가 아니면 배수하지 않는다", () => {
  for (const cap of [0, -1, "많이", null, undefined]) {
    const d = drainDecision({
      draftsDir: drafts("deferred"),
      config: { publish: { mode: "auto", dailyCap: cap } },
      publishedToday: 0,
    });
    assert.equal(d.drain, false, `cap=${cap}`);
  }
});

test("사람이 봐야 하는 상태(blocked/failed)는 배수 대상이 아니다", () => {
  const d = drainDecision({
    draftsDir: drafts("blocked", "failed"),
    config: AUTO,
    publishedToday: 0,
  });
  assert.equal(d.backlog, 0);
  assert.equal(d.drain, false);
});

test("pending 초안은 배수 대상이 아니다 — 발행 판정을 거친 적이 없다", () => {
  const d = drainDecision({ draftsDir: drafts("pending"), config: AUTO, publishedToday: 0 });
  assert.equal(d.backlog, 0);
  assert.equal(d.drain, false);
});

test("deferred와 pending이 섞여 있으면 deferred만 센다", () => {
  const d = drainDecision({
    draftsDir: drafts("deferred", "pending", "pending"),
    config: AUTO,
    publishedToday: 0,
  });
  assert.equal(d.backlog, 1);
  assert.equal(d.drain, true);
});

test("status가 없는 초안은 세지 않는다", () => {
  assert.equal(backlogCount(drafts(null, null)), 0);
});

test("여유가 2건이면 room이 2로 보고된다", () => {
  const d = drainDecision({
    draftsDir: drafts("deferred", "deferred", "deferred"),
    config: { publish: { mode: "auto", dailyCap: 3 } },
    publishedToday: 1,
  });
  assert.equal(d.drain, true);
  assert.equal(d.backlog, 3);
  assert.equal(d.room, 2);
});

test(".md가 아닌 파일과 없는 디렉토리는 무시한다", () => {
  const dir = drafts("deferred");
  writeFileSync(join(dir, "notes.txt"), "status: deferred\n");
  mkdirSync(join(dir, "archive"));
  assert.equal(backlogCount(dir), 1);
  assert.equal(backlogCount(join(dir, "does-not-exist")), 0);
});

test("깨진 마크다운이 있어도 크래시하지 않는다", () => {
  const dir = drafts("deferred");
  writeFileSync(join(dir, "broken.md"), "---\nstatus: [unclosed\n본문만 있고 종료 구분자 없음");
  assert.equal(backlogCount(dir), 1);
});

test("CLI는 계약대로 4줄을 출력하고 항상 0으로 끝난다", () => {
  const { code, stdout } = runNodeCli(CLI, [], { env: { ...process.env, HOME: tmp() } });
  assert.equal(code, 0);
  assert.match(stdout, /^DRAIN:(yes|no)$/m);
  assert.match(stdout, /^REASON:.+$/m);
  assert.match(stdout, /^BACKLOG:\d+$/m);
  assert.match(stdout, /^ROOM:-?\d+$/m);
});

test("설정이 아예 없는 HOME에서도 조용히 배수 안 함으로 떨어진다", () => {
  const { code, stdout } = runNodeCli(CLI, [], { env: { ...process.env, HOME: tmp() } });
  assert.equal(code, 0);
  assert.match(stdout, /^DRAIN:no$/m);
});

// --- 대상 파일 확정 (선택을 코드가 한다) ----------------------------------

test("배수할 때 가장 오래된 deferred 초안의 절대 경로를 돌려준다", () => {
  const dir = tmp();
  for (const [name, status] of [
    ["2026-09-05-newer.md", "deferred"],
    ["2026-08-14-oldest.md", "deferred"],
    ["2026-08-01-published-older.md", "published"],
    ["2026-07-01-pending-older.md", "pending"],
  ]) {
    writeFileSync(join(dir, name), `---\ntitle: ${name}\nstatus: ${status}\n---\n\n본문\n`);
  }
  const d = drainDecision({ draftsDir: dir, config: AUTO, publishedToday: 0 });
  assert.equal(d.drain, true);
  assert.equal(d.draft, join(dir, "2026-08-14-oldest.md"));
  assert.match(d.reason, /2026-08-14-oldest\.md/);
});

test("날짜 접두사가 없는 초안은 뒤로 밀린다", () => {
  const dir = tmp();
  writeFileSync(join(dir, "untitled.md"), "---\ntitle: u\nstatus: deferred\n---\n\n본문\n");
  writeFileSync(join(dir, "2026-09-01-dated.md"), "---\ntitle: d\nstatus: deferred\n---\n\n본문\n");
  const d = drainDecision({ draftsDir: dir, config: AUTO, publishedToday: 0 });
  assert.equal(d.draft, join(dir, "2026-09-01-dated.md"));
});

test("배수하지 않을 때는 DRAFT 줄을 내지 않는다", () => {
  const { stdout } = runNodeCli(CLI, [], { env: { ...process.env, HOME: tmp() } });
  assert.match(stdout, /^DRAIN:no$/m);
  assert.doesNotMatch(stdout, /^DRAFT:/m);
});
