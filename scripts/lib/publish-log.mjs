/*
 * publish-log.jsonl 조회 유틸.
 * 중복 발행 가드: draft 파이프라인이 크래시로 frontmatter를 못 고쳤어도
 * publish.mjs 자신이 남긴 로그로 재발행을 막는다 (코드 레벨 백스톱).
 */
import { readFileSync, existsSync } from "node:fs";
import { PUBLISH_LOG } from "./paths.mjs";

function rows(logPath) {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    })
    .filter(Boolean);
}

export function isAlreadyPublished(title, logPath = PUBLISH_LOG) {
  return rows(logPath).some((r) => r.title === title);
}

export function publishedCountToday(now = new Date(), logPath = PUBLISH_LOG) {
  const today = now.toLocaleDateString("sv"); // YYYY-MM-DD (로컬)
  return rows(logPath).filter((r) => {
    const d = new Date(r.ts);
    return !Number.isNaN(d.getTime()) && d.toLocaleDateString("sv") === today;
  }).length;
}
