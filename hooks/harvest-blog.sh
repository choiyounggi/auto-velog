#!/usr/bin/env bash
# auto-velog — Stop hook: ★ BlogWorthy 블록을 큐로 수확하고, 새 글감이 있으면
# detached headless claude 로 draft 파이프라인을 spawn 한다.
#
# 가드 (auto-flush.sh 패턴):
#   - 킬 스위치:  AUTO_VELOG_AUTODRAFT=0 또는 ~/.auto-velog/PAUSE 파일
#   - 재귀 방지:  AUTO_VELOG_DRAFTING=1 (headless draft 세션), stop_hook_active
#   - rate limit: AUTO_VELOG_AUTODRAFT_INTERVAL 초당 1회 (기본 1800)
#   - 단일 실행:  TTL 30분 lock 디렉토리
#   - fail-safe:  node/claude 없으면 조용히 no-op; 수확 실패는 세션 종료를 막지 않음
set +e

[ -n "${AUTO_VELOG_DRAFTING:-}" ] && exit 0

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HARVEST_MJS="$HOOK_DIR/../scripts/harvest.mjs"

INPUT="$(cat 2>/dev/null)"
# 재진입 Stop 이벤트(예: 다른 훅의 재프롬프트)는 skip — 진짜 세션 종료에만 수확
printf '%s' "$INPUT" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true' && exit 0

command -v node >/dev/null 2>&1 || exit 0
[ -f "$HARVEST_MJS" ] || exit 0

DIR="$HOME/.auto-velog"
mkdir -p "$DIR" 2>/dev/null

# --- 수확 (동기: 트랜스크립트 파싱뿐이라 빠름) ---------------------------
ADDED="$(printf '%s' "$INPUT" | node "$HARVEST_MJS" 2>/dev/null | sed -n 's/^ADDED://p')"
[ -n "$ADDED" ] && [ "$ADDED" -gt 0 ] 2>/dev/null || exit 0

# --- draft spawn 가드 ------------------------------------------------------
[ "${AUTO_VELOG_AUTODRAFT:-1}" = "0" ] && exit 0
[ -f "$DIR/PAUSE" ] && exit 0
command -v claude >/dev/null 2>&1 || exit 0

# rate limit
STAMP="$DIR/.last-autodraft"
INTERVAL_SEC="${AUTO_VELOG_AUTODRAFT_INTERVAL:-1800}"
INTERVAL_MIN=$(( INTERVAL_SEC / 60 )); [ "$INTERVAL_MIN" -lt 1 ] && INTERVAL_MIN=1
if [ -f "$STAMP" ] && [ -n "$(find "$STAMP" -mmin "-$INTERVAL_MIN" 2>/dev/null)" ]; then
  exit 0
fi

# single-flight lock (mkdir 원자성, TTL 30분)
LOCK="$DIR/.autodraft.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  [ -n "$(find "$LOCK" -mmin -30 2>/dev/null)" ] && exit 0
  rmdir "$LOCK" 2>/dev/null; mkdir "$LOCK" 2>/dev/null || exit 0
fi
touch "$STAMP" 2>/dev/null

CLAUDE_BIN="$(command -v claude)"
PROMPT='Run the auto-velog:draft skill now. Process every pending row in ~/.auto-velog/queue: score the candidate against the worthiness rubric, read its session transcript, write a styled draft, run the blocking secret scan, and publish only if config allows (mode=auto, score>=minScore, daily cap). Move processed rows to .processed.jsonl. If the queue is empty, do nothing.'

(
  AUTO_VELOG_DRAFTING=1 nohup "$CLAUDE_BIN" -p "$PROMPT" \
    --permission-mode bypassPermissions \
    > "$DIR/autodraft.log" 2>&1
  rmdir "$LOCK" 2>/dev/null
) &
disown 2>/dev/null

exit 0
