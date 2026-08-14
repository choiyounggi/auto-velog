/*
 * Velog 로그인 상태 체크.
 * stdout: STATUS:LOGGED_IN | NOT_LOGGED_IN | NAVER_EXPIRED (+ REASON:)
 */
import { chromium } from "playwright";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SECRETS_DIR } from "../../lib/paths.mjs";
import { loadConfig } from "../../lib/config.mjs";

const VELOG_COOKIE_PATH = join(SECRETS_DIR, "velog-cookies.json");
const NAVER_COOKIE_PATH = join(SECRETS_DIR, "naver-cookies.json");

async function main() {
  if (!existsSync(VELOG_COOKIE_PATH)) {
    console.log("STATUS:NOT_LOGGED_IN");
    console.log("REASON:velog-cookies.json 파일 없음");
    process.exit(0);
  }
  if (!existsSync(NAVER_COOKIE_PATH)) {
    console.log("STATUS:NAVER_EXPIRED");
    console.log("REASON:naver-cookies.json 파일 없음 (save-naver-cookies.mjs 수동 실행 필요)");
    process.exit(0);
  }

  const cookies = JSON.parse(readFileSync(VELOG_COOKIE_PATH, "utf-8"));
  const velogCookies = cookies.filter((c) => c.domain && c.domain.includes("velog.io"));
  if (velogCookies.length === 0) {
    console.log("STATUS:NOT_LOGGED_IN");
    console.log("REASON:velog.io 쿠키 없음");
    process.exit(0);
  }

  const config = loadConfig();
  const browser = await chromium.launch({ headless: config.browser.headless });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });
  await context.addCookies(cookies);
  const page = await context.newPage();

  try {
    await page.goto("https://velog.io/write", { waitUntil: "domcontentloaded", timeout: 15000 });
    await new Promise((r) => setTimeout(r, 3000));
    const url = page.url();
    if (url.includes("/write")) {
      console.log("STATUS:LOGGED_IN");
      console.log("REASON:글쓰기 페이지 접근 성공");
    } else {
      console.log("STATUS:NOT_LOGGED_IN");
      console.log("REASON:글쓰기 페이지 접근 실패 (리다이렉트됨: " + url + ")");
    }
  } catch (err) {
    console.log("STATUS:NOT_LOGGED_IN");
    console.log("REASON:" + err.message);
  } finally {
    await browser.close();
  }
}

main();
