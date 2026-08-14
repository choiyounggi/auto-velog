# auto-velog

Claude Code 세션에서 겪은 **실제 개발 경험**(이슈 해결 복기, 발견, 방법론, 최적화)을
자동으로 포착해, 사람이 쓴 것 같은 블로그 글로 다듬어 Velog에 발행하는
Claude Code 플러그인입니다.

트렌드 리서치로 글을 지어내는 방식이 아니라 — **당신이 오늘 실제로 한 삽질과
해결 과정**이 소재입니다. 실행한 명령어, 에러 메시지, 코드가 그대로 소스 예시가 됩니다.

## 동작 방식

```
[아무 Claude Code 세션]
  SessionStart 훅 → "★ BlogWorthy 블록을 발현하라" 지침 주입
       ↓  개발 경험이 완결되면 모델이 블록 발현 (topic/angle/story/code-refs)
  Stop 훅 → 트랜스크립트에서 블록 수확 → ~/.auto-velog/queue/
       ↓  detached headless claude 로 draft 파이프라인 spawn (세션 종료 안 막음)
[draft 파이프라인]
  ① 글감 심사 (10점 척도, minScore 미달 시 발행 안 함)
  ② 세션 트랜스크립트 분석 (문제 → 삽질 → 해결 + 실제 코드 인용)
  ③ 스타일 프로필로 집필 (구어체 존댓말, 결론 선행, 시행착오 기록)
  ④ 시크릿/PII 스캔 — 블로킹. 통과 못 하면 발행 중단
       ↓  mode=auto && score ≥ minScore && 일일 상한 미달일 때만
[발행] 로그인 체크 → 자동 로그인 → GraphQL 발행 → 알림
```

수집(harvest)과 발행(promote)을 분리한 [dev-loop](https://github.com/choiyounggi/dev-loop)
패턴을 따릅니다: 세션 중에는 오프라인 포착만, 무거운 작업은 전부 세션 종료 후 백그라운드.

## 설치

```bash
# 1. 플러그인 설치 (marketplace 또는 git)
git clone https://github.com/choiyounggi/auto-velog.git
# Claude Code 플러그인으로 등록 (~/.claude/settings.json 또는 marketplace)

# 2. 의존성
cd auto-velog && npm i && npx playwright install chromium

# 3. 최초 설정 — Claude Code에서
/auto-velog:setup
```

setup 스킬이 데이터 디렉토리 생성, config 작성, Velog 로그인(네이버 쿠키 기반),
비공개 테스트 발행까지 안내합니다.

## 설정 (`~/.auto-velog/config.json`)

| 키 | 기본값 | 설명 |
|----|--------|------|
| `platform` | `"velog"` | 발행 어댑터 선택 |
| `velog.email` | — | Velog 로그인 이메일 (네이버 메일) |
| `velog.username` | — | Velog 아이디 |
| `style.referencePosts` | `[]` | 말투를 따라 할 블로그 글 URL (few-shot) |
| `style.targetLength` | `3000` | 목표 분량 (자) |
| `publish.mode` | `"approve"` | `approve`: 초안+알림까지 / `auto`: 무인 발행 |
| `publish.dailyCap` | `1` | 일일 발행 상한 (스팸 감지 방지) |
| `publish.minScore` | `7` | 이 점수 미만 글감은 발행하지 않음 |
| `secretScan.denyPatterns` | `[]` | 절대 공개 금지 문자열 정규식 (서버명 등) — **설정 권장** |
| `browser.headless` | `true` | Playwright headless 여부 |

> **`publish.mode`의 기본값은 `approve`입니다.** 사람 검토 없이 공개 발행되는
> `auto`는 의미를 이해하고 명시적으로 켜세요.

## 스킬

| 스킬 | 용도 |
|------|------|
| `/auto-velog:setup` | 최초 설정 (config, 로그인, 테스트 발행) |
| `/auto-velog:draft` | 큐 글감 → 초안 (Stop 훅이 자동 실행; 수동 실행도 가능) |
| `/auto-velog:publish` | 초안 발행 (approve 모드에서 검토 후 사용) |
| `/auto-velog:flush` | 밀린 글감·초안 일괄 처리, 여러 글감 묶어 한 편 만들기 |

## 안전장치

- **시크릿/PII 스캔 (블로킹)**: 세션 트랜스크립트가 소재이므로 API 키·토큰·JWT·
  사설 IP·이메일·`password=` 대입문 + 커스텀 denyPatterns를 발행 전 2중
  (draft 시 + 발행 직전) 스캔. 탐지 시 레드액션 또는 발행 차단
- **글감 심사**: 문제→과정→해결 완결성이 없으면 발행하지 않음
- **일일 상한**: 기본 1건/일, 초과분은 다음 날로 이월
- **일시 정지**: `touch ~/.auto-velog/PAUSE` (재개는 `rm`)
- **완전 비활성화**: 환경변수 `AUTO_VELOG_AUTODRAFT=0`
- 쿠키·시크릿은 전부 `~/.auto-velog/secrets/` 로컬 보관 — 레포에 절대 커밋되지 않음

## 다른 플랫폼 어댑터 추가

`scripts/adapters/<플랫폼>/`에 세 스크립트를 같은 계약으로 구현하면 됩니다:

| 스크립트 | 계약 |
|----------|------|
| `check-login.mjs` | stdout `STATUS:LOGGED_IN` \| `NOT_LOGGED_IN` \| `NAVER_EXPIRED`(재인증 필요) |
| `login.mjs` | 성공 시 `STATUS:LOGGED_IN`, 실패 exit 1 |
| `publish.mjs <draft.md> [--private]` | 성공 `STATUS:PUBLISHED` + `URL:<url>` / exit 2 로그인 필요 / exit 1 실패 |

`config.platform`을 해당 디렉토리명으로 바꾸면 스킬이 그 어댑터를 사용합니다.

## 개발

```bash
npm test   # node:test — harvest 파서, 시크릿 스캐너, config, 마크다운 파서
```

## 라이선스

MIT
