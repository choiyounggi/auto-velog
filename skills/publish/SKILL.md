---
name: publish
description: 심사·스캔을 통과한 draft를 Velog에 발행. 로그인 체크→자동 로그인→발행→로그·알림까지. "블로그 발행해줘", "blog publish", "draft 발행" 등에 트리거. draft 스킬이 auto 모드에서 내부적으로도 사용.
---

# auto-velog 발행

플러그인 루트를 `$PLUGIN`이라 한다. 인자로 draft 파일 경로를 받거나, 없으면
`~/.auto-velog/drafts/`에서 `status: deferred` → `pending` 순으로 오래된 것부터 고른다.

## 0. 사전 체크

- `~/.auto-velog/PAUSE` 존재 시 중단.
- **시크릿 스캔 재확인** (발행 직전 최종 방어선 — draft 스킬이 이미 돌렸어도 다시):
  ```bash
  node "$PLUGIN/scripts/secret-scan.mjs" <draft.md>
  ```
  exit 1이면 발행 중단, `status: blocked` 처리 후 사용자에게 보고.
- 일일 상한: `~/.auto-velog/publish-log.jsonl`에서 오늘(로컬 날짜) 발행 수가
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

발행 직전에 커버(썸네일)를 생성한다 (best-effort — 커버 생성이 실패해도 발행은 진행):

```bash
node "$PLUGIN/scripts/cover.mjs" <draft.md>   # stdout 2번째 줄 = 생성된 PNG 경로
```

발행 명령은 누가 발행을 결정했는지에 따라 둘 중 하나다. **어느 쪽이든 발행 명령은 다른 명령과
`;`·`&&`·줄바꿈으로 묶지 않은 단독 Bash 호출**로 실행하고, 경로는 `$PLUGIN`·`~` 같은 변수 없이
실제 절대 경로로 풀어 쓴다. 아래 `<HOME>`(홈 디렉토리), `<버전>`(설치된 플러그인 버전), `<초안>`은 자리표시다.

**자동 발행** — draft 스킬의 자동 발행 단계, 또는 밀린 초안 배수 세션(사용자가 이 대화에 없다):

```bash
node <HOME>/.claude/plugins/cache/auto-velog/auto-velog/<버전>/scripts/adapters/velog/publish.mjs <HOME>/.auto-velog/drafts/<초안>.md <HOME>/.auto-velog/drafts/<초안>.cover.png --auto  # jev-gate: override
```

- 초안과 커버는 초안 폴더(`<HOME>/.auto-velog/drafts/`) 안의 파일이어야 한다. 따옴표·`~`·`../` 없이 쓴다.
- `--auto`는 `publish.mode: auto`, frontmatter `score >= minScore`, 초안·커버가 초안 폴더 안인지를 **코드로** 확인하고,
  `--force`·`--ignore-cap`·`--private`와는 같이 쓸 수 없다. 자동 발행에는 이 셋을 절대 붙이지 않는다.
- 줄 끝의 `# jev-gate: override`는 지우지 않는다. jev-gate(≥ 0.3.1)는 **사용자가 허용 목록에 올린
  이 모양 그대로의 명령**일 때만 마커를 보고 판단 모델을 건너뛴다(허용 목록 설정은 README).
  헤드리스 세션에는 모델의 `ask`에 답할 사람이 없어 `ask`가 곧 거부가 되기 때문이다.
  jev-gate가 없으면 그냥 셸 주석이다.
- 마커는 이 명령에만 붙인다. 다른 명령에 붙이거나, 막힌 명령을 문구만 바꿔 재시도하지 않는다.

**수동 발행** — 사용자가 이 대화에서 직접 "발행해줘"라고 했다(flush 스킬 포함):

```bash
node <HOME>/.claude/plugins/cache/auto-velog/auto-velog/<버전>/scripts/adapters/velog/publish.mjs <HOME>/.auto-velog/drafts/<초안>.md <HOME>/.auto-velog/drafts/<초안>.cover.png
```

`--auto`도 마커도 붙이지 않는다. 사용자가 곁에 있으니 게이트가 물으면 사용자가 답한다.

커버는 AI 생성 이미지가 아니라 제목·태그 기반 타이포그래피 카드다. 본문에 코드
블록이 있으면 terminal(코드 카드), 없으면 light 변형이 자동 선택되고, 색상은 태그
해시로 결정된다 (`--variant light|terminal|block`으로 강제 가능).

발행 스크립트는 **스스로도** 시크릿 스캔과 중복 발행 가드를 강제한다 (코드 레벨 백스톱):

- exit 0 + `STATUS:PUBLISHED` + `URL:` → 성공. frontmatter `status: published`로 갱신.
- exit 0 + `STATUS:ALREADY_PUBLISHED` → 같은 제목이 이미 발행됨. frontmatter를
  `status: published`로 맞추고 종료. (사용자가 명시적으로 재발행을 원할 때만 `--force`)
- exit 3 + `STATUS:BLOCKED` → 스크립트 내부 시크릿 스캔에 걸림. `status: blocked`
  처리 후 보고. (`--force`로도 우회 불가 — 레드액션이 유일한 해법)
- exit 2 (로그인 필요) → login.mjs 실행 후 **1회만** 재시도.
- exit 4 + `STATUS:NOT_ELIGIBLE` → 발행 대상이 아니다(blocked/failed 초안, 또는 `--auto` 자격 미달).
  **재시도하지 않고** frontmatter status를 그대로 둔 채 stderr의 사유를 보고한다.
- exit 5 + `STATUS:CAP_REACHED` → 오늘 상한 소진. 재시도하지 않고 `status: deferred`로 둔다.
- 그 외 실패 → **1회만** 재시도. 그래도 실패면 `status: failed` + 에러 내용 보존.

(발행 스크립트가 publish-log.jsonl 기록을 담당하므로 여기서 중복 기록하지 않는다.)

## 3. 결과 보고

- `~/.auto-velog/log.jsonl`에 이벤트 append.
- macOS 알림 (best-effort): 성공 시 제목+URL, 실패 시 사유.
- 대화형 세션이면 사용자에게 URL 또는 실패 사유를 보고한다.
