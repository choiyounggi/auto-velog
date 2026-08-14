import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isAlreadyPublished, publishedCountToday } from "../scripts/lib/publish-log.mjs";

const tmp = () => mkdtempSync(join(tmpdir(), "auto-velog-log-"));

function logFile(entries) {
  const p = join(tmp(), "publish-log.jsonl");
  writeFileSync(p, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return p;
}

test("로그에 같은 제목이 있으면 발행된 것으로 판정한다", () => {
  const p = logFile([{ ts: "2026-08-14T01:00:00Z", title: "삽질기", url: "u" }]);
  assert.equal(isAlreadyPublished("삽질기", p), true);
  assert.equal(isAlreadyPublished("다른 글", p), false);
});

test("로그 파일이 없으면 미발행으로 판정한다", () => {
  assert.equal(isAlreadyPublished("아무거나", join(tmp(), "nope.jsonl")), false);
});

test("깨진 로그 줄은 무시한다", () => {
  const p = join(tmp(), "publish-log.jsonl");
  writeFileSync(p, '{broken\n' + JSON.stringify({ ts: "2026-08-14T01:00:00Z", title: "정상" }) + "\n");
  assert.equal(isAlreadyPublished("정상", p), true);
});

test("오늘 발행 수를 로컬 날짜 기준으로 센다", () => {
  const now = new Date("2026-08-14T12:00:00");
  const p = logFile([
    { ts: new Date("2026-08-14T09:00:00").toISOString(), title: "오늘1" },
    { ts: new Date("2026-08-13T09:00:00").toISOString(), title: "어제" },
    { ts: "invalid-date", title: "깨짐" },
  ]);
  assert.equal(publishedCountToday(now, p), 1);
});

test("빈 로그는 0을 반환한다", () => {
  assert.equal(publishedCountToday(new Date(), join(tmp(), "nope.jsonl")), 0);
});
