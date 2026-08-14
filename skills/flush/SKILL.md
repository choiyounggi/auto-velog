---
name: flush
description: 밀린 블로그 글감·초안 일괄 처리. 큐의 pending 글감과 drafts의 pending/deferred/blocked 초안을 목록으로 보여주고 사용자와 함께 처리. 여러 세션의 글감을 한 편으로 묶는 옵션 포함. "블로그 밀린 거 처리", "blog flush", "글감 정리" 등에 트리거.
---

# auto-velog flush (수동 일괄 처리)

대화형 스킬이다 — headless 자동 실행용이 아니다.

## 1. 현황 파악

- `~/.auto-velog/queue/*.jsonl`의 pending row (`.processed.jsonl` 제외)
- `~/.auto-velog/drafts/*.md`의 frontmatter `status`가 pending / deferred / blocked / failed인 것

표로 보여준다: 글감 topic·angle·수확일 | 초안 제목·score·status.

## 2. 사용자와 처리 방향 결정

항목별로 선택지를 제시한다:
- **초안 작성** — pending 글감을 draft 스킬 절차(심사→분석→집필→스캔)로 처리
- **묶어서 한 편** — 주제가 이어지는 여러 글감을 하나의 글로 합친다
  (예: 같은 프로젝트의 연속 삽질기). 합칠 후보를 먼저 제안할 것
- **발행** — pending/deferred 초안을 publish 스킬 절차로 발행
- **blocked 해소** — 시크릿 스캔에 걸린 부분을 보여주고 함께 레드액션 후 재스캔
- **버리기** — 글감/초안을 `.processed.jsonl`(status: dropped)로 이동

## 3. 마무리

처리 결과 요약(발행 URL, 남은 항목)을 보고하고 `~/.auto-velog/log.jsonl`에 기록한다.
