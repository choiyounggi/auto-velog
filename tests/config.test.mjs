import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULTS, loadConfig } from "../scripts/lib/config.mjs";
import { tmpFactory } from "./helpers.mjs";

const tmp = tmpFactory("auto-velog-config-");

test("파일이 없으면 DEFAULTS 사본을 반환한다", () => {
  const cfg = loadConfig(join(tmp(), "nope.json"));
  assert.deepEqual(cfg, DEFAULTS);
  cfg.publish.mode = "mutated";
  assert.equal(DEFAULTS.publish.mode, "approve"); // 사본이어야 함
});

test("부분 설정은 깊은 병합된다", () => {
  const dir = tmp();
  const p = join(dir, "config.json");
  writeFileSync(p, JSON.stringify({ publish: { mode: "auto" }, velog: { email: "a@b.c" } }));
  const cfg = loadConfig(p);
  assert.equal(cfg.publish.mode, "auto");
  assert.equal(cfg.publish.dailyCap, 1); // 기본값 유지
  assert.equal(cfg.velog.email, "a@b.c");
  assert.equal(cfg.browser.headless, true);
});

test("빈 객체 설정 파일이면 DEFAULTS와 동일하다", () => {
  const p = join(tmp(), "config.json");
  writeFileSync(p, "{}");
  assert.deepEqual(loadConfig(p), DEFAULTS);
});

test("깨진 JSON이면 throw 한다", () => {
  const dir = tmp();
  const p = join(dir, "config.json");
  writeFileSync(p, "{not json");
  assert.throws(() => loadConfig(p));
});
