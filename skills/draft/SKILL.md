---
name: draft
description: 큐에 쌓인 ★ BlogWorthy 글감을 심사하고, 세션 트랜스크립트를 분석해 사람이 쓴 듯한 블로그 초안을 집필한 뒤 시크릿 스캔을 거쳐 (설정에 따라) 발행까지 진행. Stop 훅이 headless로 자동 실행하며, "블로그 초안", "blog draft" 등으로 수동 실행도 가능.
---

# blog-loop 초안 파이프라인

플러그인 루트를 `$PLUGIN`, 데이터 디렉토리를 `~/.blog-loop`이라 한다.

## 0. 사전 체크

- `~/.blog-loop/PAUSE` 파일이 존재하면 아무것도 하지 않고 종료한다.
- `~/.blog-loop/config.json`을 읽는다 (없으면 "먼저 /blog-loop:setup 실행 필요" 로그 후 종료).
- `~/.blog-loop/queue/*.jsonl`에서 `"status":"pending"` row를 모은다 (`.processed.jsonl` 제외).
  없으면 종료.

## 1. 글감 심사 (worthiness gate)

각 pending row에 대해 10점 척도로 채점한다:

| 항목 | 배점 | 기준 |
|------|------|------|
| 완결성 | 4 | row의 story와 트랜스크립트에 문제 → 과정 → 해결이 모두 있는가. 하나라도 없으면 0점 |
| 독자 가치 | 3 | 같은 문제를 검색할 사람이 있을 주제인가. 지나치게 개인적·자명한 내용은 감점 |
| 소스 예시 | 2 | 트랜스크립트에서 실제 실행된 코드·명령어·에러 메시지를 인용할 수 있는가 |
| 비중복 | 1 | `~/.blog-loop/publish-log.jsonl`의 기존 발행 제목과 주제가 겹치지 않는가 |

점수와 근거 한 줄을 draft frontmatter에 기록한다. **완결성 0점이면 즉시 skip**
(status: skipped로 처리하고 다음 row로).

## 2. 세션 분석

row의 `transcriptPath`를 Read하여 (200줄 초과 시 Grep으로 위치 파악 후 범위 Read):
- 문제의 최초 증상 (에러 메시지, 이상 동작 — 원문 인용할 것)
- 시도한 것들 — **실패한 시도 포함** (삽질 과정이 글의 진정성을 만든다)
- 결정적 해결 (실제 실행한 코드/명령어와 그 출력)
- 배운 점 / 일반화 가능한 교훈

`code-refs`가 가리키는 파일이 로컬에 있으면 해당 부분을 읽어 소스 예시로 쓴다.

## 3. 집필 (스타일 프로필)

`config.style.referencePosts`에 URL이 있으면 WebFetch로 말투·구성을 분석해
few-shot으로 쓴다. 없으면 아래 기본 프로필을 따른다:

**기본 스타일 프로필:**
- 구어체 존댓말 혼합. 개인 경험·고민으로 도입한다
  (예: "저도 정확히 그 지점에서 헷갈렸습니다", "선발되면 열심히 해보고, 안 되면 …까지 생각했다")
- 핵심 결론을 앞에 제시한다 ("먼저 결론부터 봅시다")
- 소제목은 질문형·관찰형 ("린트 규칙은 어디까지 잡아야 할까")
- 시행착오와 심리를 구체적으로 기록한다 ("별것 아닌 내용이어도 긴장됐다")
- 세션에서 **실제 실행한** 코드·명령어·출력을 코드블록으로 인용한다
- 마무리는 배운 점 + 다음 목표/독자 제안

**금지:** AI 공문체("~에 대해 알아보겠습니다", "~하는 것이 중요합니다"),
서론/본론/결론 명시, 과한 밈체, 세션에 없던 사실 지어내기.

**분량:** `config.style.targetLength` (기본 3000자) 내외, 소제목 4~6개.

`~/.blog-loop/drafts/YYYY-MM-DD-<slug>.md`로 저장 (slug는 topic의 영문/한글 케밥):

```markdown
---
title: <제목>
tags: <태그1>, <태그2>, <태그3>
session: <row.sessionId>
score: <심사 점수>
status: pending
---
<본문 — H1 없이 바로 시작>
```

## 4. 시크릿/PII 스캔 (블로킹 — 발행 전 필수)

```bash
node "$PLUGIN/scripts/secret-scan.mjs" ~/.blog-loop/drafts/<파일>.md
```

- exit 1 (탐지): findings의 각 항목을 보고, 글이 성립하는 선에서 레드액션
  (`192.168.0.42` → `192.168.x.x`, 키 → `sk-...` 마스킹, 이메일 → 제거)한 뒤
  **재스캔한다.** 레드액션이 불가능하면 frontmatter `status: blocked`로 바꾸고
  발행하지 않는다.
- exit 0이어도 **LLM 패스를 한 번 수행한다**: 회사 내부 정보, 미공개 프로젝트명,
  타인의 개인정보, 보안 사고의 미공개 세부사항이 본문에 없는지 스스로 검토하고,
  있으면 제거하거나 blocked 처리한다.

## 5. 발행 결정

다음을 **모두** 만족할 때만 발행한다:
- `config.publish.mode == "auto"`
- `score >= config.publish.minScore`
- 오늘 발행 수(`publish-log.jsonl`에서 오늘 날짜 카운트) < `config.publish.dailyCap`

발행: `skills/publish/SKILL.md`의 절차를 따른다 (로그인 체크 → 발행 → 재시도 1회).
발행하면 frontmatter `status: published`, 상한 초과면 `status: deferred`,
approve 모드면 `status: pending` 유지.

## 6. 마무리 (row마다)

- 처리한 row를 원본 큐 파일에서 제거하고, status를 갱신해
  `~/.blog-loop/queue/.processed.jsonl`에 append한다 (dedup 시드로 쓰이므로 필수).
- `~/.blog-loop/log.jsonl`에 `{ts, event, session, draft, score, status, url?}` append.
- macOS 알림 (best-effort, 실패 무시):
  ```bash
  osascript -e 'display notification "<제목> — <status>" with title "blog-loop"' 2>/dev/null || true
  ```
