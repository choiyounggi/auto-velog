---
name: setup
description: blog-loop 최초 설정. 데이터 디렉토리 생성, config 작성, 플랫폼 로그인(쿠키 저장), 비공개 테스트 발행까지 안내. "blog-loop 설정", "blog-loop setup", "블로그 자동화 설정" 등에 트리거.
---

# blog-loop 최초 설정

플러그인 루트(이 스킬 기준 `../..`)를 `$PLUGIN`이라 한다. 순서대로 진행한다.

## 1. 데이터 디렉토리 + config

```bash
mkdir -p ~/.blog-loop/{queue,drafts,secrets}
[ -f ~/.blog-loop/config.json ] || cp "$PLUGIN/config.example.json" ~/.blog-loop/config.json
```

사용자에게 물어 `~/.blog-loop/config.json`을 채운다:
- `velog.email` — Velog 로그인 이메일 (네이버 메일 주소)
- `velog.username` — Velog 아이디 (@아이디)
- `publish.mode` — `approve`(초안+알림까지, 기본) / `auto`(무인 발행). **auto의 의미
  (사람 검토 없이 공개 발행됨)를 설명하고 명시적으로 선택받는다.**
- `style.referencePosts` — 말투를 따라 하고 싶은 블로그 글 URL (선택)
- `secretScan.denyPatterns` — 절대 공개되면 안 되는 문자열 정규식 (서버 호스트명,
  회사 도메인 등). **최소 1개 이상 넣기를 권장한다.**

## 2. 의존성

```bash
cd "$PLUGIN" && npm i --no-fund --no-audit && npx playwright install chromium
```

## 3. 플랫폼 로그인 (velog 어댑터)

기존 `~/.claude/scripts/naver-cookies.json`, `velog-cookies.json`이 있으면
`~/.blog-loop/secrets/`로 복사해 재사용한다 (재로그인 불필요). 없으면:

1. `node "$PLUGIN/scripts/adapters/velog/save-naver-cookies.mjs"` — 브라우저가
   열리면 사용자가 직접 네이버 로그인 + 2FA 후 메일함까지 이동 (최초 1회)
2. `node "$PLUGIN/scripts/adapters/velog/login.mjs"` — 자동 로그인
3. `node "$PLUGIN/scripts/adapters/velog/check-login.mjs"` — `STATUS:LOGGED_IN` 확인

## 4. 비공개 테스트 발행

파이프라인 전체를 검증한다:

```bash
cat > ~/.blog-loop/drafts/setup-test.md <<'MD'
---
title: blog-loop 설정 테스트 (비공개)
tags: test
---
blog-loop 파이프라인 테스트 글입니다. 보이면 성공.
MD
node "$PLUGIN/scripts/secret-scan.mjs" ~/.blog-loop/drafts/setup-test.md \
  && node "$PLUGIN/scripts/adapters/velog/publish.mjs" ~/.blog-loop/drafts/setup-test.md --private
```

`STATUS:PUBLISHED`와 URL이 나오면 성공. 사용자에게 Velog에서 비공개 글을 확인하고
지워도 된다고 안내한다.

## 5. 운영 안내

마지막으로 다음을 알려준다:
- 이제 아무 세션에서나 글감이 완결되면 자동으로 포착 → 세션 종료 시 초안
  파이프라인이 돈다 (`~/.blog-loop/autodraft.log`)
- 일시 정지: `touch ~/.blog-loop/PAUSE` / 재개: `rm ~/.blog-loop/PAUSE`
- 완전 비활성화: 환경변수 `BLOG_LOOP_AUTODRAFT=0`
- 밀린 글감 수동 처리: `/blog-loop:flush`
