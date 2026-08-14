#!/usr/bin/env node
/*
 * auto-velog harvester (dev-loop harvest.js 패턴 이식).
 *
 * Stop 훅 페이로드를 stdin으로 받아 세션 트랜스크립트에서 ★ BlogWorthy 블록을
 * 추출하고, dedup 후 ~/.auto-velog/queue/<session>.jsonl 에 적재한다.
 * 집필·발행은 하지 않는다 — 그것은 auto-velog:draft 스킬의 몫.
 * stdout의 ADDED:<n> 은 harvest-blog.sh 가 draft spawn 여부 판단에 쓴다.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { QUEUE_DIR } from "./lib/paths.mjs";

// 구분선은 U+2500. hooks/blog-instruction.sh 의 지침 텍스트와 정확히 동기화할 것.
const BLOCK_RE = /★\s*BlogWorthy\s*─+\s*\n([\s\S]*?)\n\s*─+/g;
// 세션당 백스톱 캡: 지침은 0~1개를 요구하지만 풍부한 세션의 여지를 남긴다.
const CAP = 3;

const FIELD_KEYS = { topic: "topic", angle: "angle", story: "story", "code-refs": "codeRefs", "why-worth": "whyWorth" };

function safeJson(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

export function assistantTextFromLine(line) {
  const obj = safeJson(line);
  const msg = obj.message || obj;
  if (!msg || msg.role !== "assistant") return "";
  const content = msg.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p && p.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join("\n");
  }
  return "";
}

function parseBlock(body) {
  const fields = { topic: "", angle: "", story: "", codeRefs: "", whyWorth: "" };
  for (const raw of body.split("\n")) {
    const m = raw.match(/^\s*(topic|angle|story|code-refs|why-worth)\s*:\s*(.*)$/i);
    if (m) fields[FIELD_KEYS[m[1].toLowerCase()]] = m[2].trim();
  }
  return fields;
}

function contentHash(body) {
  const norm = body.replace(/\s+/g, " ").trim().toLowerCase();
  return crypto.createHash("sha256").update(norm).digest("hex").slice(0, 16);
}

export function extractBlocks(assistantText) {
  const found = [];
  let m;
  const re = new RegExp(BLOCK_RE.source, "g");
  while ((m = re.exec(assistantText)) !== null) {
    const body = m[1].trim();
    if (body.length < 30) continue; // 글감이 되기엔 너무 얇음
    if (body.length > 10_000) continue; // 폭주/악성 블록 백스톱 (지침은 한 문단 요약)
    const fields = parseBlock(body);
    if (!fields.topic || !fields.story) continue; // 필수 필드
    // 지침 템플릿 에코 방지: 플레이스홀더 <...> 잔존 시 드롭
    if (/<[^>]+>/.test(fields.topic) || /<[^>]+>/.test(fields.story)) continue;
    found.push({ body, fields, hash: contentHash(body) });
  }
  return found;
}

function resolveTranscript(payload) {
  const tp = payload.transcript_path;
  if (tp && fs.existsSync(tp)) return tp;
  const cwd = payload.cwd || process.cwd();
  const encoded = cwd.replace(/[/.]/g, "-");
  const projDir = path.join(os.homedir(), ".claude", "projects", encoded);
  if (!fs.existsSync(projDir)) return null;
  const files = fs
    .readdirSync(projDir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => path.join(projDir, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0] || null;
}

export function harvest(payload, { queueDir = QUEUE_DIR } = {}) {
  const cwd = payload.cwd || process.cwd();
  const transcript = resolveTranscript(payload);
  if (!transcript) return 0;

  let text;
  try { text = fs.readFileSync(transcript, "utf-8"); } catch { return 0; }

  const assistant = text.split("\n").filter(Boolean).map(assistantTextFromLine).filter(Boolean).join("\n\n");
  const found = extractBlocks(assistant);
  if (!found.length) return 0;

  const sessionId = payload.session_id || path.basename(transcript, ".jsonl") || String(Date.now());
  fs.mkdirSync(queueDir, { recursive: true });
  const queueFile = path.join(queueDir, `${sessionId}.jsonl`);
  const processedFile = path.join(queueDir, ".processed.jsonl");

  // dedup: 세션 큐 + 처리 완료 저장소 양쪽의 hash를 시드로 사용
  const seen = new Set();
  for (const src of [queueFile, processedFile]) {
    if (!fs.existsSync(src)) continue;
    for (const line of fs.readFileSync(src, "utf-8").split("\n")) {
      const o = safeJson(line);
      if (o.hash) seen.add(o.hash);
    }
  }

  const existingRows = fs.existsSync(queueFile)
    ? fs.readFileSync(queueFile, "utf-8").split("\n").filter((l) => l.trim()).length
    : 0;

  const rows = [];
  for (const f of found) {
    if (seen.has(f.hash)) continue;
    seen.add(f.hash);
    rows.push(
      JSON.stringify({
        hash: f.hash,
        sessionId,
        repo: path.basename(cwd),
        cwd,
        transcriptPath: transcript,
        topic: f.fields.topic,
        angle: f.fields.angle,
        story: f.fields.story,
        codeRefs: f.fields.codeRefs,
        whyWorth: f.fields.whyWorth,
        content: f.body,
        harvestedAt: new Date().toISOString(),
        status: "pending",
      })
    );
  }

  const budget = Math.max(0, CAP - existingRows);
  const toAppend = rows.slice(0, budget);
  if (toAppend.length) fs.appendFileSync(queueFile, toAppend.join("\n") + "\n");
  return toAppend.length;
}

// CLI: harvest-blog.sh 가 Stop 페이로드를 stdin으로 넘긴다.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const payload = safeJson(fs.readFileSync(0, "utf-8"));
    const added = harvest(payload);
    process.stdout.write(`ADDED:${added}\n`);
  } catch {
    process.stdout.write("ADDED:0\n"); // 수확 실패가 세션 종료를 방해해선 안 됨
  }
}
