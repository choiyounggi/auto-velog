#!/usr/bin/env node
/*
 * 밀린 초안 배수 판정.
 *
 * Stop 훅은 "이번 세션에서 새 글감이 수확됐을 때"만 draft 파이프라인을 띄운다.
 * 그런데 dailyCap에 걸려 deferred가 된 초안은 그 순간 pending이 아니게 되고,
 * 아무도 다시 보지 않는다 — 그래서 새 글감이 없는 날에는 밀린 초안이 하나도
 * 빠지지 않는다. 실제로 그렇게 25건이 쌓였다(2026-09-17).
 *
 * 이 스크립트는 "지금 밀린 걸 한 건 빼도 되는가"만 답한다. 발행 자체는 하지
 * 않는다 — 판정과 실행을 분리해 두면 훅은 셸 로직 없이 프롬프트만 고르면 되고,
 * 판정은 node --test로 검증할 수 있다.
 *
 * stdout 계약 (훅이 sed로 읽는다):
 *   DRAIN:yes|no
 *   DRAFT:<발행할 초안의 절대 경로>   (DRAIN:yes일 때만)
 *   REASON:<한 줄>
 *   BACKLOG:<밀린 초안 수>
 *   ROOM:<오늘 남은 발행 가능 수>
 *
 * 대상 파일을 여기서 확정하는 이유: 배수를 실행하는 헤드리스 세션은 그 초안을 쓴
 * 세션이 아니라 컨텍스트가 없다. "deferred 중 가장 오래된 하나"를 그 세션이
 * 디렉토리를 뒤져 고르게 하면 그 약속은 프롬프트 문장일 뿐이고, 초안 본문에 섞인
 * 임의 텍스트에 흔들릴 수도 있다. 선택은 코드가 한다.
 * 종료 코드는 항상 0 — 판정 실패가 세션 종료를 막아서는 안 된다(fail open).
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DRAFTS_DIR } from "./lib/paths.mjs";
import { loadConfig } from "./lib/config.mjs";
import { publishedCountToday } from "./lib/publish-log.mjs";
import { parseMarkdown } from "./lib/markdown.mjs";

// 배수 대상은 deferred 하나뿐이다. deferred는 "심사·스캔을 통과했는데 그날 상한
// 때문에 중단된 것"이라 배수는 그 중단의 재개일 뿐이다. pending은 발행 판정을 아직
// 한 번도 거치지 않은 초안이고(수동으로 쓴 글, 묶음 작업의 결과물 등), blocked와
// failed는 사람이 봐야 하는 상태다 — 셋 다 자동 발행 대상이 아니다.
const DRAINABLE = new Set(["deferred"]);

// 배수 대상 초안의 파일명 목록 (오래된 순). 파일명이 YYYY-MM-DD- 로 시작하므로
// 사전순 정렬이 곧 날짜순이고, 날짜 접두사가 없는 파일은 뒤로 보낸다.
export function drainableDrafts(draftsDir = DRAFTS_DIR) {
  if (!existsSync(draftsDir)) return [];
  const hits = [];
  for (const f of readdirSync(draftsDir)) {
    if (!f.endsWith(".md")) continue;
    let meta;
    try {
      ({ meta } = parseMarkdown(readFileSync(join(draftsDir, f), "utf-8")));
    } catch {
      continue;
    }
    if (DRAINABLE.has((meta?.status || "").trim())) hits.push(f);
  }
  const dated = (f) => (/^\d{4}-\d{2}-\d{2}-/.test(f) ? 0 : 1);
  return hits.sort((a, b) => dated(a) - dated(b) || a.localeCompare(b));
}

export function backlogCount(draftsDir = DRAFTS_DIR) {
  return drainableDrafts(draftsDir).length;
}

export function drainDecision({
  draftsDir = DRAFTS_DIR,
  config = loadConfig(),
  publishedToday = publishedCountToday(),
} = {}) {
  const mode = config?.publish?.mode;
  if (mode !== "auto") {
    return { drain: false, reason: `publish.mode=${mode} — 자동 발행이 아님`, backlog: 0, room: 0 };
  }

  const cap = Number(config?.publish?.dailyCap);
  if (!Number.isFinite(cap) || cap <= 0) {
    return { drain: false, reason: `dailyCap=${config?.publish?.dailyCap} — 발행 상한 없음/0`, backlog: 0, room: 0 };
  }

  const room = cap - publishedToday;
  const queue = drainableDrafts(draftsDir);
  const backlog = queue.length;

  if (backlog === 0) return { drain: false, reason: "밀린 초안 없음", backlog, room };
  if (room <= 0) return { drain: false, reason: `오늘 ${publishedToday}/${cap} — 상한 소진`, backlog, room: 0 };

  return {
    drain: true,
    draft: join(draftsDir, queue[0]),
    reason: `밀린 초안 ${backlog}건, 오늘 ${room}건 여유 — 가장 오래된 ${queue[0]}`,
    backlog,
    room,
  };
}

function main() {
  let d;
  try {
    d = drainDecision();
  } catch (e) {
    // 설정/로그가 깨져 있어도 조용히 "배수 안 함"으로 떨어진다.
    d = { drain: false, reason: `판정 실패: ${e?.message || e}`, backlog: 0, room: 0 };
  }
  const lines = [`DRAIN:${d.drain ? "yes" : "no"}`];
  if (d.drain && d.draft) lines.push(`DRAFT:${d.draft}`);
  lines.push(`REASON:${d.reason}`, `BACKLOG:${d.backlog}`, `ROOM:${d.room}`);
  process.stdout.write(lines.join("\n") + "\n");
}

if (import.meta.url === `file://${process.argv[1]}`) main();
