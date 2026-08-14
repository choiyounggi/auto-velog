/*
 * Velog 자동 로그인 (원본: ~/.claude/scripts/velog-login.mjs).
 * 저장된 네이버 쿠키로 Velog 이메일 로그인 링크를 메일함에서 찾아 클릭한다.
 * 변경점: 쿠키 경로 → ~/.auto-velog/secrets, 이메일 → config.velog.email,
 *         headless → config.browser.headless (백그라운드 파이프라인용).
 * 성공 시 stdout STATUS:LOGGED_IN, 실패 시 exit 1.
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { SECRETS_DIR } from "../../lib/paths.mjs";
import { loadConfig } from "../../lib/config.mjs";

const NAVER_COOKIE_PATH = join(SECRETS_DIR, "naver-cookies.json");
const VELOG_COOKIE_PATH = join(SECRETS_DIR, "velog-cookies.json");
const VELOG_LS_PATH = join(SECRETS_DIR, "velog-localstorage.json");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const config = loadConfig();
  const email = config.velog.email;
  if (!email) {
    console.error("config.velog.email 이 비어 있습니다. ~/.auto-velog/config.json 을 설정하세요.");
    process.exit(1);
  }
  if (!existsSync(NAVER_COOKIE_PATH)) {
    console.error("네이버 쿠키 파일이 없습니다. node save-naver-cookies.mjs 실행 필요");
    process.exit(1);
  }

  const naverCookies = JSON.parse(readFileSync(NAVER_COOKIE_PATH, "utf-8"));
  console.log(`네이버 쿠키 ${naverCookies.length}개 로드됨.`);

  const browser = await chromium.launch({ headless: config.browser.headless, slowMo: 150 });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });
  await context.addCookies(naverCookies);
  const page = await context.newPage();

  try {
    // === Step 1: Velog 로그인 이메일 발송 ===
    console.log("[1/5] Velog 접속...");
    await page.goto("https://velog.io", { waitUntil: "domcontentloaded" });
    await sleep(2000);

    console.log("[1/5] 로그인 버튼 클릭...");
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const loginBtn = btns.find((b) => b.textContent.trim() === "로그인");
      if (loginBtn) loginBtn.click();
    });
    await sleep(2000);

    console.log("[1/5] 이메일 입력...");
    const emailInput = page
      .locator('input[type="email"], input[placeholder*="이메일"], input[placeholder*="email"]')
      .first();
    await emailInput.waitFor({ state: "visible", timeout: 15000 });
    await emailInput.fill(email);
    await sleep(500);

    console.log("[1/5] 로그인 링크 발송...");
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const submitBtn = btns.find((b) => {
        const text = b.textContent.trim();
        const rect = b.getBoundingClientRect();
        return text.includes("로그인") && rect.top > 100;
      });
      if (submitBtn) submitBtn.click();
    });
    await sleep(5000);
    console.log("[1/5] Velog 로그인 메일 발송 완료!");

    // === Step 2: 네이버 메일함 접속 ===
    const naverPage = await context.newPage();
    console.log("[2/5] 네이버 메일함 접속...");
    await naverPage.goto("https://mail.naver.com", { waitUntil: "domcontentloaded" });
    await sleep(4000);

    const currentUrl = naverPage.url();
    if (currentUrl.includes("nid.naver.com") || currentUrl.includes("login")) {
      console.error("네이버 쿠키가 만료됐습니다. node save-naver-cookies.mjs 실행 필요");
      await browser.close();
      process.exit(1);
    }
    console.log("[2/5] 네이버 메일함 접속 성공!");

    // === Step 3: 검색으로 Velog 이메일 찾기 ===
    let authLink = null;

    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt > 0) {
        console.log(`[3/5] 재시도 ${attempt}/5 (15초 대기)...`);
        await sleep(15000);
      }

      try {
        const searchSelectors = [
          'input[placeholder*="검색"]',
          'input[name="query"]',
          'input[type="search"]',
          ".mail_search input",
        ];
        let searchInput = null;
        for (const sel of searchSelectors) {
          const count = await naverPage.locator(sel).count();
          if (count > 0) {
            searchInput = naverPage.locator(sel).first();
            break;
          }
        }
        if (searchInput) {
          await searchInput.click();
          await sleep(300);
          await searchInput.fill("velog");
          await naverPage.keyboard.press("Enter");
          await sleep(3000);
          console.log("[3/5] 검색 실행 완료");
        } else {
          console.log("[3/5] 검색창 없음 — URL로 검색...");
          await naverPage.goto("https://mail.naver.com/?query=velog", { waitUntil: "domcontentloaded" });
          await sleep(4000);
        }
      } catch (err) {
        console.log("[3/5] 검색 실패:", err.message);
      }

      try {
        const mailItems = await naverPage
          .locator("tr[data-eid], tr.mail_item, .mail_item, [class*='MailItem']")
          .all();
        console.log(`[3/5] 메일 항목 수: ${mailItems.length} (첫 번째=최신 선택)`);

        if (mailItems.length > 0) {
          await mailItems[0].click();
          await sleep(4000);

          const frames = naverPage.frames();
          for (const frame of frames) {
            try {
              const emailLoginLinks = await frame.locator('a[href*="email-login"]').all();
              for (const link of emailLoginLinks) {
                const href = await link.getAttribute("href");
                if (href) {
                  authLink = href;
                  console.log("[3/5] email-login 링크 발견:", href.substring(0, 100));
                  break;
                }
              }
              if (authLink) break;

              const tokenLinks = await frame.locator('a[href*="velog.io"]').all();
              for (const link of tokenLinks) {
                const href = await link.getAttribute("href");
                if (href && (href.includes("code=") || href.includes("token="))) {
                  authLink = href;
                  console.log("[3/5] 토큰 링크 발견:", href.substring(0, 100));
                  break;
                }
              }
              if (authLink) break;
            } catch {
              continue;
            }
          }
          if (authLink) break;
        }

        if (!authLink && attempt < 4) {
          await naverPage.goto("https://mail.naver.com", { waitUntil: "domcontentloaded" });
          await sleep(3000);
        }
      } catch (err) {
        console.log("[3/5] 메일 읽기 실패:", err.message);
      }

      if (authLink) break;
    }

    // === Step 4: 로그인 링크로 이동 ===
    if (!authLink) {
      console.log("[실패] 인증 링크를 찾지 못했습니다. 네이버 메일함에서 Velog 이메일을 직접 확인해주세요.");
      await browser.close();
      process.exit(1);
    }

    console.log("[4/5] 로그인 링크로 이동:", authLink.substring(0, 100));
    await page.goto(authLink, { waitUntil: "networkidle", timeout: 30000 });
    await sleep(8000); // 쿠키 설정 완료 추가 대기
    console.log("[4/5] 이동 후 URL:", page.url());

    // === Step 5: 쿠키 저장 + 로그인 검증 ===
    const allCookies = await context.cookies();
    const authCookies = allCookies.filter((c) => ["access_token", "refresh_token"].includes(c.name));
    if (authCookies.length === 0) {
      console.log("[경고] 인증 쿠키(access_token/refresh_token)가 없습니다!");
    } else {
      console.log("[5/5] 인증 쿠키 저장:", authCookies.map((c) => c.name).join(", "));
    }

    mkdirSync(SECRETS_DIR, { recursive: true });
    writeFileSync(VELOG_COOKIE_PATH, JSON.stringify(allCookies, null, 2));
    console.log(`[5/5] 쿠키 저장 완료: ${VELOG_COOKIE_PATH}`);

    const ls = await page.evaluate(() => {
      const data = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        data[k] = localStorage.getItem(k);
      }
      return data;
    });
    writeFileSync(VELOG_LS_PATH, JSON.stringify(ls, null, 2));

    // GraphQL로 로그인 검증
    const authCheck = await page.evaluate(async () => {
      try {
        const res = await fetch("https://v3.velog.io/graphql", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            operationName: "currentUser",
            query: "query currentUser { currentUser { id username email } }",
            variables: {},
          }),
        });
        return res.json();
      } catch (e) {
        return { error: e.message };
      }
    });

    if (authCheck?.data?.currentUser?.id) {
      console.log("Velog 로그인 성공! 사용자:", authCheck.data.currentUser.username);
      console.log("STATUS:LOGGED_IN");
    } else {
      console.log("경고: GraphQL 인증 실패 — 쿠키는 저장됐지만 로그인 상태 불확실");
      process.exitCode = 1;
    }
  } catch (err) {
    console.error("오류 발생:", err.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
