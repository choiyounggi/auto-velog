/*
 * 네이버 쿠키 저장 (최초 1회, 수동 로그인).
 * 항상 headless:false — 사용자가 직접 로그인 + 2FA를 완료해야 한다.
 */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { SECRETS_DIR } from "../../lib/paths.mjs";

const COOKIE_PATH = join(SECRETS_DIR, "naver-cookies.json");

async function main() {
  console.log("=== 네이버 쿠키 저장 도구 ===");
  console.log("브라우저가 열리면 네이버에 로그인해주세요.");
  console.log("로그인 유지에 반드시 체크해주세요!\n");

  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();
  await page.goto("https://nid.naver.com/nidlogin.login", { waitUntil: "domcontentloaded" });

  console.log("로그인 + 2단계 인증을 완료한 뒤, 메일함(mail.naver.com)까지 이동해주세요.");
  console.log("메일함 도달을 감지하면 자동으로 쿠키를 저장합니다. 대기 중... (최대 5분)");

  try {
    await page.waitForURL(/mail\.naver\.com/, { timeout: 300000 });
    console.log("\n메일함 감지! 쿠키를 저장합니다...");
  } catch {
    console.log("\n타임아웃. 현재 상태의 쿠키를 저장합니다...");
  }

  const cookies = await context.cookies();
  mkdirSync(SECRETS_DIR, { recursive: true });
  writeFileSync(COOKIE_PATH, JSON.stringify(cookies, null, 2));

  const naverCookies = cookies.filter((c) => c.domain.includes("naver.com"));
  console.log(`\n저장 완료: ${COOKIE_PATH}`);
  console.log(`네이버 쿠키 ${naverCookies.length}개 저장됨.`);

  const hasNID = cookies.some((c) => c.name === "NID_AUT" || c.name === "NID_SES");
  if (hasNID) {
    console.log("로그인 쿠키(NID) 확인됨. 이후 자동 로그인에 사용 가능합니다.");
  } else {
    console.log("경고: 로그인 쿠키가 없습니다. 로그인이 완료되지 않았을 수 있습니다.");
  }

  await browser.close();
}

main();
