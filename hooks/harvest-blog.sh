#!/usr/bin/env bash
# auto-velog — Stop hook: ★ BlogWorthy 블록을 큐로 수확하고, 새 글감이 있으면
# detached headless claude 로 draft 파이프라인을 spawn 한다. 새 글감이 없어도
# 밀린 초안(deferred)이 있고 오늘 발행 상한에 여유가 있으면 배수를 위해 spawn
# 한다 — 그러지 않으면 상한에 걸린 초안은 아무도 다시 보지 않는다.
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
DRAIN_MJS="$HOOK_DIR/../scripts/drain-check.mjs"

INPUT="$(cat 2>/dev/null)"
# 재진입 Stop 이벤트(예: 다른 훅의 재프롬프트)는 skip — 진짜 세션 종료에만 수확
printf '%s' "$INPUT" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true' && exit 0

command -v node >/dev/null 2>&1 || exit 0
[ -f "$HARVEST_MJS" ] || exit 0

DIR="$HOME/.auto-velog"
mkdir -p "$DIR" 2>/dev/null

# --- 수확 (동기: 트랜스크립트 파싱뿐이라 빠름) ---------------------------
ADDED="$(printf '%s' "$INPUT" | node "$HARVEST_MJS" 2>/dev/null | sed -n 's/^ADDED://p')"

# 새 글감이 있으면 draft, 없으면 밀린 초안 배수를 시도한다. 배수 판정은 node로
# 빼서(scripts/drain-check.mjs) 훅은 프롬프트만 고른다 — 판정은 단위 테스트가
# 검증하고, 판정이 실패해도 여기서는 조용히 종료한다.
MODE="draft"
if [ -z "$ADDED" ] || ! [ "$ADDED" -gt 0 ] 2>/dev/null; then
  [ -f "$DRAIN_MJS" ] || exit 0
  DRAIN_OUT="$(node "$DRAIN_MJS" 2>/dev/null)"
  [ "$(printf '%s' "$DRAIN_OUT" | sed -n 's/^DRAIN://p')" = "yes" ] || exit 0
  # 대상 파일은 drain-check가 확정한다. 경로가 없으면 배수하지 않는다 —
  # 헤드리스 세션이 스스로 고르게 두면 그게 곧 프롬프트 문장뿐인 보장이 된다.
  DRAIN_DRAFT="$(printf '%s' "$DRAIN_OUT" | sed -n 's/^DRAFT://p')"
  [ -f "$DRAIN_DRAFT" ] || exit 0
  MODE="publish"
fi

# --- draft spawn 가드 ------------------------------------------------------
# 킬 스위치: 0/off/false 모두 인식 (빈 값은 "설정 안 함"으로 취급)
case "${AUTO_VELOG_AUTODRAFT:-1}" in
  0|off|false) exit 0 ;;
esac
[ -f "$DIR/PAUSE" ] && exit 0
command -v claude >/dev/null 2>&1 || exit 0

# rate limit
STAMP="$DIR/.last-autodraft"
INTERVAL_SEC="${AUTO_VELOG_AUTODRAFT_INTERVAL:-1800}"
INTERVAL_MIN=$(( INTERVAL_SEC / 60 )); [ "$INTERVAL_MIN" -lt 1 ] && INTERVAL_MIN=1
if [ -f "$STAMP" ] && [ -n "$(find "$STAMP" -mmin "-$INTERVAL_MIN" 2>/dev/null)" ]; then
  exit 0
fi

# single-flight lock (mkdir 원자성). 실행 중인 프로세스가 60초마다 lock을
# touch(heartbeat)하므로, mtime이 5분 이상 오래됐을 때만 죽은 lock으로 회수한다.
# (draft 실행이 30분을 넘어도 heartbeat가 살아 있으면 절대 동시 spawn되지 않음)
LOCK="$DIR/.autodraft.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  [ -n "$(find "$LOCK" -maxdepth 0 -mmin -5 2>/dev/null)" ] && exit 0
  rmdir "$LOCK" 2>/dev/null; mkdir "$LOCK" 2>/dev/null || exit 0
fi
touch "$STAMP" 2>/dev/null

CLAUDE_BIN="$(command -v claude)"
if [ "$MODE" = "publish" ]; then
  # 대상은 이미 정해져 있다. 프롬프트는 그 파일 하나를 지목할 뿐이고, 발행 자격
  # (상태·일일 상한·시크릿)은 publish.mjs가 코드로 다시 강제한다.
  PROMPT="Run the auto-velog:publish skill now for EXACTLY this one file and nothing else: ${DRAIN_DRAFT}. No new candidate was harvested; this run exists only to drain one backlogged draft. Do not choose a different draft, do not scan the drafts directory for others, do not write a new draft, and do not touch the queue. Generate its cover if the skill's procedure calls for it, then publish that single file; publish.mjs enforces the secret scan, the draft status and the daily cap itself and will refuse the publish if any of them fails — report its STATUS line as the result. Publish at most once in this run."
else
  PROMPT='Run the auto-velog:draft skill now. Process every pending row in ~/.auto-velog/queue: score the candidate against the worthiness rubric, read its session transcript, write a styled draft, run the blocking secret scan, and publish only if config allows (mode=auto, score>=minScore, daily cap). Move processed rows to .processed.jsonl. If the queue is empty, do nothing.'
fi

# 최소 권한: 트랜스크립트에 섞인 임의 콘텐츠(프롬프트 인젝션 가능성)를 읽는
# 무인 세션이므로 bypassPermissions 대신 필요한 도구만 허용한다.
ALLOWED='Read Write Edit Glob Grep WebFetch WebSearch Skill Bash(node:*) Bash(osascript:*) Bash(mkdir:*)'
# 배수 세션은 이미 쓰인 초안 하나를 발행할 뿐이라 웹 접근이 필요 없다. 최소 권한을
# 말로만 두지 않기 위해 이 경로에서는 실제로 좁힌다.
[ "$MODE" = "publish" ] && ALLOWED='Read Edit Glob Grep Skill Bash(node:*) Bash(osascript:*) Bash(mkdir:*)'

# stdin은 명시적으로 분리한다: BSD(macOS) nohup은 GNU와 달리 stdin을 건드리지
# 않고, 훅의 fd 0은 Stop 페이로드 파이프라서 프롬프트 가능 CLI가 잡고 있으면
# hang의 원인이 된다. -p 플래그는 정책이고 리다이렉트가 보증이다.
# 런타임 상한(기본 120분): hang한 headless 세션이 heartbeat로 락을 영원히
# 쥐는 것을 막는다 (macOS엔 GNU timeout이 없어 watchdog 루프로 구현).
MAX_MIN="${AUTO_VELOG_DRAFT_MAX_MIN:-120}"
(
  AUTO_VELOG_DRAFTING=1 nohup "$CLAUDE_BIN" -p "$PROMPT" \
    --allowedTools "$ALLOWED" \
    < /dev/null > "$DIR/autodraft.log" 2>&1 &
  CPID=$!
  ELAPSED=0
  KILLED=""
  # 락 해제는 프로세스 사망이 kill -0으로 확인된 뒤에만 한다 — TERM을 무시하고
  # 살아남은 프로세스가 있는 채로 락을 풀면 동시 spawn 금지 보장이 깨진다.
  while kill -0 "$CPID" 2>/dev/null; do
    if [ "$ELAPSED" -ge "$MAX_MIN" ]; then
      if [ -z "$KILLED" ]; then
        kill "$CPID" 2>/dev/null; KILLED="term"
        echo "[watchdog] draft run exceeded ${MAX_MIN}min — SIGTERM" >> "$DIR/autodraft.log"
      else
        kill -9 "$CPID" 2>/dev/null
        echo "[watchdog] still alive after SIGTERM — SIGKILL" >> "$DIR/autodraft.log"
      fi
      touch "$LOCK" 2>/dev/null
      sleep 10
      continue
    fi
    touch "$LOCK" 2>/dev/null
    sleep 60
    ELAPSED=$((ELAPSED + 1))
  done
  rmdir "$LOCK" 2>/dev/null
) &
disown 2>/dev/null

exit 0
