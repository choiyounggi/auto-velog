---
name: publish
description: 심사·스캔을 통과한 draft를 Velog에 발행. 로그인 체크→자동 로그인→발행→로그·알림까지. "블로그 발행해줘", "blog publish", "draft 발행" 등에 트리거. draft 스킬이 auto 모드에서 내부적으로도 사용.
---

# blog-loop 발행

플러그인 루트를 `$PLUGIN`이라 한다. 인자로 draft 파일 경로를 받거나, 없으면
`~/.blog-loop/drafts/`에서 `status: deferred` → `pending` 순으로 오래된 것부터 고른다.

## 0. 사전 체크

- `~/.blog-loop/PAUSE` 존재 시 중단.
- **시크릿 스캔 재확인** (발행 직전 최종 방어선 — draft 스킬이 이미 돌렸어도 다시):
  ```bash
  node "$PLUGIN/scripts/secret-scan.mjs" <draft.md>
  ```
  exit 1이면 발행 중단, `status: blocked` 처리 후 사용자에게 보고.
- 일일 상한: `~/.blog-loop/publish-log.jsonl`에서 오늘(로컬 날짜) 발행 수가
  `config.publish.dailyCap` 이상이면 `status: deferred`로 두고 중단.
  (수동 실행에서 사용자가 명시적으로 "지금 발행해"라고 하면 상한을 무시할 수 있다 — 그 사실을 알린다.)

## 1. 로그인 체크

```bash
node "$PLUGIN/scripts/adapters/velog/check-login.mjs"
```

| STATUS | 다음 액션 |
|--------|-----------|
| `LOGGED_IN` | 2단계로 |
| `NOT_LOGGED_IN` | `node "$PLUGIN/scripts/adapters/velog/login.mjs"` 실행 후 재확인 |
| `NAVER_EXPIRED` | 발행 중단, draft 보존. "네이버 쿠키 만료 — save-naver-cookies.mjs 수동 실행 필요" 알림 |

## 2. 발행

```bash
node "$PLUGIN/scripts/adapters/velog/publish.mjs" <draft.md>
```

- exit 0 + `URL:` → 성공. frontmatter `status: published`로 갱신.
- exit 2 (로그인 필요) → login.mjs 실행 후 **1회만** 재시도.
- 그 외 실패 → **1회만** 재시도. 그래도 실패면 `status: failed` + 에러 내용 보존.

(발행 스크립트가 publish-log.jsonl 기록을 담당하므로 여기서 중복 기록하지 않는다.)

## 3. 결과 보고

- `~/.blog-loop/log.jsonl`에 이벤트 append.
- macOS 알림 (best-effort): 성공 시 제목+URL, 실패 시 사유.
- 대화형 세션이면 사용자에게 URL 또는 실패 사유를 보고한다.
