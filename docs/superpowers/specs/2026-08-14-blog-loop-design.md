# auto-velog — 세션 기반 블로그 자동 발행 파이프라인 설계

- 날짜: 2026-08-14
- 상태: 승인됨 (완전 자동 발행 / 세션 종료 시 자동 초안 / Claude Code 플러그인)

## 목적

Claude Code 세션에서 개발 중 겪은 이슈 복기·발견·방법론·최적화가 나올 때마다
"블로그감"으로 포착하고, 세션 종료 시 해당 세션 대화를 분석해 사람이 쓴 것 같은
Velog 글로 다듬어 자동 발행한다. 범용 레포로 배포해 다른 사용자는 설정값만 넣으면
쓸 수 있게 한다.

핵심 패턴은 dev-loop의 harvest/promote 분리를 차용한다: 세션 중에는 가볍게 포착만
하고(오프라인·논블로킹), 무거운 집필·발행은 세션 종료 후 분리된 백그라운드
파이프라인이 수행한다.

## 전체 흐름

```
[아무 세션]
  SessionStart 훅 → ★ BlogWorthy 블록 발현 지침 주입 (세션당 0~1개)
       ↓
  Stop 훅(harvest-blog.sh + harvest.js)
       → 트랜스크립트에서 블록 수확 → ~/.auto-velog/queue/<session>.jsonl
       → 새 항목이 있으면 detached headless claude 로 draft 파이프라인 spawn
       ↓
[auto-velog:draft (headless)]
  ① 글감 게이트: 10점 스코어링, minScore 미달 시 skip (draft 보관만)
  ② 세션 분석: 문제 → 시도(실패 포함) → 해결 → 배운 점 + 실제 코드/명령어 추출
  ③ 스타일 프로필로 집필 → ~/.auto-velog/drafts/YYYY-MM-DD-slug.md
  ④ 시크릿/PII 스캔 (블로킹): 통과 못 하면 발행 중단 + 알림
       ↓ (mode=auto && score>=minScore && 일일 상한 미달)
[auto-velog:publish]
  로그인 체크 → 자동 로그인 → GraphQL WritePost 발행 → 로그 + 알림
```

## ★ BlogWorthy 블록 (커스텀 블로그 insight)

dev-loop의 ★ Insight와 **별도 채널**. SessionStart 훅이 주입하는 발현 지침 형식:

```
★ BlogWorthy ────────────────────────
topic: <글 제목이 될 만한 한 줄>
angle: 복기 | 발견 | 방법론 | 최적화
story: <문제 상황 → 삽질 → 해결의 한 문단 요약>
code-refs: <세션에서 다룬 파일:라인 또는 명령어 — 소스 예시 출처>
why-worth: <독자가 얻어갈 것>
─────────────────────────────────────
```

- 필수 필드: `topic`, `story`. 누락 시 드롭.
- 플레이스홀더(`<...>`)가 남은 블록은 드롭 (지침 템플릿 에코 방지).
- 세션 ID + 내용 해시 기반 dedup → 재실행 시 중복 발행 방지.

## 컴포넌트

### hooks/
| 파일 | 이벤트 | 역할 |
|------|--------|------|
| `blog-instruction.sh` | SessionStart(startup) | BlogWorthy 발현 지침 주입. 재귀 방지: `AUTO_VELOG_DRAFTING=1` 또는 cwd가 `~/.auto-velog` 이면 skip |
| `harvest-blog.sh` | Stop | stdin 페이로드를 `harvest.js`에 전달(백그라운드), 수확 결과가 있으면 draft 파이프라인 spawn |
| `harvest.js` | — | 트랜스크립트 파싱 → 블록 추출 → dedup → queue 적재. 세션당 백스톱 캡 3 |

draft spawn 가드 (auto-flush.sh 패턴):
- 킬 스위치: `AUTO_VELOG_AUTODRAFT=0` 환경변수 / `~/.auto-velog/PAUSE` 파일
- 재귀 방지: `AUTO_VELOG_DRAFTING=1`, `stop_hook_active` skip
- single-flight lock (TTL 30분) + rate limit (기본 30분 1회)
- fail-safe: `claude`/`node` 없으면 조용히 no-op

### skills/
| 스킬 | 역할 |
|------|------|
| `auto-velog:setup` | `~/.auto-velog/` 생성, config.example → config 복사 안내, 네이버 쿠키 저장, 비공개 테스트 발행 |
| `auto-velog:draft` | 큐 소비 → 게이트 → 세션 분석 → 집필 → 스캔 → (auto면) publish까지. headless 실행이 기본 |
| `auto-velog:publish` | PAUSE/일일 상한 체크 → 로그인 체크/갱신 → 발행 → publish-log 기록 + 알림 |
| `auto-velog:flush` | 수동: 밀린 큐·미발행 draft 일괄 처리, 여러 세션 글감 묶어 한 편 구성 옵션 |

### scripts/
```
scripts/
├── lib/config.mjs            # ~/.auto-velog/config.json 로드 + 기본값 병합
├── adapters/velog/
│   ├── check-login.mjs       # STATUS:LOGGED_IN|NOT_LOGGED_IN|NAVER_EXPIRED
│   ├── login.mjs             # 네이버 쿠키 → 메일 인증 링크 → velog 쿠키 갱신
│   ├── publish.mjs           # GraphQL WritePost (is_private 지원, exit 2=로그인 필요)
│   └── save-naver-cookies.mjs# 최초 1회 수동 로그인 (headless:false 고정)
└── secret-scan.mjs           # 정규식 1차 스캔. exit 0=clean, 1=findings, 2=error
```

- 어댑터 인터페이스: `check-login / login / publish` 3개 스크립트를 갖춘 디렉토리.
  `config.platform` 으로 선택. velog가 1호, Tistory/dev.to는 동일 인터페이스로 추가.
- 기존 `~/.claude/scripts/*.mjs` 에서 이관하며: 하드코딩 이메일 제거(config),
  쿠키 경로를 `~/.auto-velog/secrets/` 로, headless 기본 true (save-naver-cookies 제외),
  `is_private` 파라미터 추가 (테스트 발행용).

### 시크릿/PII 스캔 (블로킹, 발행 전 필수)

1차 정규식 (`secret-scan.mjs`): AWS 키, `sk-`/`ghp_`/`xox` 계열 토큰, JWT,
PRIVATE KEY 블록, 사설 IP, 이메일 주소, `password=`/`api_key=` 대입문,
config의 `secretScan.denyPatterns` (사용자 커스텀 — 서버 호스트명 등).
2차 LLM 패스 (draft 스킬 내): 회사 내부 정보·개인 식별 정보 문맥 판단.
히트 시: 자동 레드액션 가능(치환해도 글이 성립)하면 치환 후 재스캔, 아니면
발행 중단 + draft에 `status: blocked` 기록 + 알림.

### 글감 게이트 (완전 자동의 품질 방어선)

10점 스코어링, `publish.minScore` (기본 7) 미달이면 발행하지 않고 draft만 보관:
- 완결성: 문제 → 과정 → 해결이 모두 있는가 (없으면 즉시 탈락)
- 독자 가치: 검색해서 올 사람이 있는 주제인가
- 소스 예시: 세션에서 실제 실행된 코드·명령어를 인용할 수 있는가
- 중복: publish-log의 기존 발행 이력과 주제가 겹치지 않는가

### 스타일 프로필

기본 프로필(내장) — 참고글 2편(k-svelte-master, hying)에서 추출:
- 구어체 존댓말 혼합, 개인 경험·고민으로 도입
- "먼저 결론부터 봅시다"식 결론 선행 + 질문형 소제목
- 시행착오·심리 묘사 구체적 기록, 실제 실행한 코드·명령어 인용
- AI 공문체 금지 ("~에 대해 알아보겠습니다" 류), 밈체 지양
- 분량 기본 3000자 내외 (config.style.targetLength)

`config.style.referencePosts` 에 URL을 넣으면 draft 스킬이 WebFetch로 스타일을
추출해 few-shot으로 사용 (기본 프로필 대체).

## 설정과 데이터

```
~/.auto-velog/
├── config.json          # config.example.json 복사 후 수정
├── secrets/             # naver-cookies.json, velog-cookies.json, velog-localstorage.json
├── queue/               # <session>.jsonl (pending) + .processed.jsonl
├── drafts/              # YYYY-MM-DD-slug.md (frontmatter: score, status, session)
├── publish-log.jsonl    # {ts, title, url, session, score}
├── log.jsonl            # 파이프라인 이벤트 로그
└── PAUSE                # 존재하면 전체 파이프라인 정지 (킬 스위치)
```

config.example.json:
```json
{
  "platform": "velog",
  "velog": { "email": "you@example.com", "username": "yourid" },
  "style": { "referencePosts": [], "language": "ko", "targetLength": 3000 },
  "publish": { "mode": "approve", "dailyCap": 1, "minScore": 7, "defaultTags": [] },
  "secretScan": { "denyPatterns": [] },
  "browser": { "headless": true }
}
```

- **범용 기본값은 `publish.mode: "approve"`** (draft + 알림까지만). 영기님 로컬
  config만 `"auto"`. `"grace"` 모드(유예 후 발행)는 비범위 — 필요해지면 추가.
- 알림: macOS `osascript` display notification best-effort + log.jsonl (실패 무시).

## 에러 처리

- 로그인 만료: draft 보존, `NAVER_EXPIRED` 시 "save-naver-cookies 재실행 필요" 알림
- 발행 실패: 1회 재시도 → 실패 시 draft `status: failed` + 알림
- 일일 상한 초과: draft `status: deferred` → 다음 draft/flush 실행 시 발행
- harvest/훅 오류: 절대 세션 종료를 막지 않음 (전부 백그라운드 + try/catch)

## 테스트 전략

- `harvest.js` 파서: 정상 블록 / 필수 필드 누락 / 플레이스홀더 에코 / 빈 트랜스크립트 /
  다중 블록 캡 / dedup — node:test 유닛 테스트
- `secret-scan.mjs`: 클린 파일 / 각 시크릿 유형 / 빈 파일 / 파일 없음(exit 2) /
  커스텀 denyPattern — node:test 유닛 테스트
- velog 어댑터: `is_private: true` 비공개 글 스모크 테스트 (setup 스킬의 마지막 단계)

## 비범위

- 기존 `velog-blog-writer` / `velog-autopublish` (트렌드 기반)는 수정하지 않음.
  스크립트만 이 레포로 이관·개선하며 원본은 그대로 둔다.
- Tistory 등 추가 어댑터, grace 모드, 썸네일 자동 생성은 v2.
