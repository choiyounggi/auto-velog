import { readFileSync, existsSync } from "node:fs";
import { CONFIG_PATH } from "./paths.mjs";

export const DEFAULTS = {
  platform: "velog",
  velog: { email: "", username: "" },
  style: { referencePosts: [], language: "ko", targetLength: 3000 },
  publish: { mode: "approve", dailyCap: 1, minScore: 7, defaultTags: [] },
  secretScan: { denyPatterns: [] },
  browser: { headless: true },
};

function deepMerge(base, override) {
  const out = { ...base };
  for (const [k, v] of Object.entries(override || {})) {
    if (v && typeof v === "object" && !Array.isArray(v) && typeof base[k] === "object" && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function loadConfig(configPath = CONFIG_PATH) {
  if (!existsSync(configPath)) return structuredClone(DEFAULTS);
  const user = JSON.parse(readFileSync(configPath, "utf-8"));
  return deepMerge(structuredClone(DEFAULTS), user);
}
