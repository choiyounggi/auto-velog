#!/usr/bin/env bash
# blog-loop — SessionStart: ★ BlogWorthy 블록 발현 지침 주입.
#
# 블록 구분선(U+2500)과 필드명은 scripts/harvest.mjs 의 BLOCK_RE/FIELD_KEYS 와
# 정확히 동기화되어야 한다.
set +e

# 재귀 방지: headless draft 세션이거나 blog-loop 데이터 디렉토리 안이면 skip
[ -n "${BLOG_LOOP_DRAFTING:-}" ] && exit 0
case "${CLAUDE_PROJECT_DIR:-$PWD}" in
  "$HOME/.blog-loop"*) exit 0 ;;
esac

cat <<'EOF'
# blog-loop — 블로그 글감 포착 (standing instruction)

이 세션에서 **블로그에 쓸 만한 개발 경험**이 완결됐을 때 — 이슈를 겪고 해결한
복기, 새로운 발견이나 개발 방법론, 최적화 성과 등 — 아래 형식의 블록을 응답에
포함하라 (세션당 0~1개; 정말 글감이 될 때만):

★ BlogWorthy ────────────────────────
topic: <글 제목이 될 만한 한 줄>
angle: 복기 | 발견 | 방법론 | 최적화
story: <문제 상황 → 삽질 → 해결의 한 문단 요약>
code-refs: <세션에서 다룬 파일:라인 또는 명령어 — 소스 예시 출처>
why-worth: <독자가 얻어갈 것>
─────────────────────────────────────

규칙:
- `topic`과 `story`는 필수. 누락된 블록은 버려진다.
- 문제 → 과정 → 해결이 완결된 이야기일 때만 발현하라. 진행 중인 작업은 아직 글감이 아니다.
- 이 블록은 아무것도 발행하지 않는다 — 세션 종료 후 별도 파이프라인이
  글감 심사·집필·시크릿 스캔을 거친 뒤에만 발행된다.
EOF
exit 0
