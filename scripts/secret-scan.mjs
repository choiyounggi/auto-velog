#!/usr/bin/env node
/*
 * auto-velog 시크릿/PII 1차 스캐너 (정규식 패스).
 * 발행 전 블로킹 게이트 — draft 스킬이 CLI로 호출한다.
 * 2차 문맥 판단(회사 내부 정보 등)은 draft 스킬의 LLM 패스가 담당한다.
 *
 * CLI: node secret-scan.mjs <file>
 *   exit 0 = clean, 1 = findings(stdout에 JSON), 2 = error
 *   ~/.auto-velog/config.json 의 secretScan.denyPatterns 를 자동 로드.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./lib/config.mjs";

const PATTERNS = [
  ["aws-key", /AKIA[0-9A-Z]{16}/g],
  ["api-token", /sk-[A-Za-z0-9_-]{20,}/g],
  ["github-token", /gh[pousr]_[A-Za-z0-9]{36,}/g],
  ["slack-token", /xox[baprs]-[A-Za-z0-9-]{10,}/g],
  ["jwt", /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g],
  ["private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ["url-creds", /[a-zA-Z][\w+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/g],
  ["private-ip", /\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/g],
  ["email", /[\w.+-]+@[\w-]+\.[\w.]+/g],
  ["assignment", /(?:password|passwd|secret|api[_-]?key|token)\s*[=:]\s*['"][^'"\s]{8,}['"]/gi],
];

function mask(s) {
  return s.slice(0, 4) + "…" + `(${s.length}자)`;
}

export function scanText(text, extraPatterns = []) {
  const findings = [];
  const lines = text.split("\n");
  const all = [
    ...PATTERNS,
    ...extraPatterns.map((p) => ["custom", new RegExp(p, "g")]),
  ];
  lines.forEach((line, i) => {
    for (const [type, re] of all) {
      const fresh = new RegExp(re.source, re.flags);
      let m;
      while ((m = fresh.exec(line)) !== null) {
        findings.push({ type, line: i + 1, masked: mask(m[0]) });
        if (fresh.lastIndex === m.index) fresh.lastIndex++; // 무한루프 방지
      }
    }
  });
  return findings;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const file = process.argv[2];
  if (!file || !fs.existsSync(file)) {
    console.error(`파일을 찾을 수 없습니다: ${file || "(인자 없음)"}`);
    process.exit(2);
  }
  let deny = [];
  try {
    deny = loadConfig().secretScan.denyPatterns || [];
  } catch {
    // config가 깨져도 기본 패턴만으로 스캔은 계속한다
  }
  let text;
  try {
    text = fs.readFileSync(file, "utf-8");
  } catch (e) {
    console.error(`읽기 실패: ${e.message}`);
    process.exit(2);
  }
  const findings = scanText(text, deny);
  if (findings.length) {
    process.stdout.write(JSON.stringify(findings, null, 2) + "\n");
    process.exit(1);
  }
  process.exit(0);
}
