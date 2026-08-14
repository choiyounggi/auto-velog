/*
 * Velog 발행 (원본: ~/.claude/scripts/velog-publish.mjs).
 * 브라우저 컨텍스트 안에서 GraphQL WritePost mutation을 직접 호출한다
 * (httpOnly access_token 쿠키가 credentials:include 로 자동 포함됨).
 *
 * 사용법: node publish.mjs <draft.md> [썸네일.png] [--private] [--force]
 *   exit 0 = 발행 성공 (stdout STATUS:PUBLISHED + URL:) 또는 이미 발행됨 (STATUS:ALREADY_PUBLISHED)
 *   exit 2 = 로그인 필요 (STATUS:LOGIN_REQUIRED)
 *   exit 3 = 시크릿 탐지로 차단 (STATUS:BLOCKED)
 *   exit 1 = 기타 실패
 *
 * 안전 게이트는 이 스크립트 안에서 강제된다 (호출자가 스킬 지시를 건너뛰어도):
 *   - 시크릿 스캔: 발행 직전 본문을 자체 스캔, 탐지 시 무조건 차단 (--force로도 못 끔)
 *   - 중복 발행 가드: frontmatter status:published 또는 publish-log에 같은 제목이
 *     있으면 발행하지 않음 (--force로만 무시 가능)
 *
 * draft.md 는 YAML frontmatter(title/tags/session/score) 우선, 없으면
 * 첫 H1을 제목으로, `**태그**:` 줄을 태그로 파싱한다.
 */
import { readFileSync, existsSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { SECRETS_DIR, PUBLISH_LOG, DATA_DIR } from "../../lib/paths.mjs";
import { loadConfig } from "../../lib/config.mjs";
import { parseMarkdown } from "../../lib/markdown.mjs";
import { isAlreadyPublished } from "../../lib/publish-log.mjs";
import { scanText } from "../../secret-scan.mjs";

const VELOG_COOKIE_PATH = join(SECRETS_DIR, "velog-cookies.json");
const VELOG_LS_PATH = join(SECRETS_DIR, "velog-localstorage.json");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const args = process.argv.slice(2);
  const isPrivate = args.includes("--private");
  const force = args.includes("--force");
  const positional = args.filter((a) => !a.startsWith("--"));
  const mdFilePath = positional[0];
  const thumbnailPath = positional[1] || null;

  if (!mdFilePath) {
    console.error("사용법: node publish.mjs <draft.md> [썸네일.png] [--private]");
    process.exit(1);
  }
  if (!existsSync(mdFilePath)) {
    console.error("파일을 찾을 수 없습니다:", mdFilePath);
    process.exit(1);
  }
  const config = loadConfig();
  const { title, body, tags, meta } = parseMarkdown(
    readFileSync(mdFilePath, "utf-8"),
    config.publish.defaultTags
  );
  console.log("제목:", title);
  console.log("본문 길이:", body.length, "자");
  console.log("태그:", tags.join(", "), isPrivate ? "(비공개)" : "");

  if (!title) {
    console.error("제목(frontmatter title 또는 # H1)을 찾을 수 없습니다.");
    process.exit(1);
  }
  if (!body) {
    console.error("본문이 비어 있습니다.");
    process.exit(1);
  }

  // --- 코드 레벨 안전 게이트 (스킬 지시와 무관하게 항상 실행) ---------------

  // 1) 중복 발행 가드: frontmatter status 또는 publish-log의 같은 제목
  if (!force && (meta.status === "published" || isAlreadyPublished(title))) {
    console.log("이미 발행된 글입니다 (재발행하려면 --force).");
    console.log("STATUS:ALREADY_PUBLISHED");
    process.exit(0);
  }

  // 2) 시크릿 스캔: 탐지 시 무조건 차단 (--force로도 우회 불가)
  const findings = scanText(title + "\n" + body, config.secretScan.denyPatterns || []);
  if (findings.length) {
    console.error("시크릿/PII 탐지 — 발행을 차단합니다:");
    console.error(JSON.stringify(findings, null, 2));
    console.log("STATUS:BLOCKED");
    process.exit(3);
  }

  // 게이트 통과 후에야 로그인 요구 (시크릿 차단은 로그인 여부와 무관해야 함)
  if (!existsSync(VELOG_COOKIE_PATH)) {
    console.error("Velog 쿠키 파일이 없습니다. 먼저 로그인하세요: node login.mjs");
    console.log("STATUS:LOGIN_REQUIRED");
    process.exit(2);
  }

  const cookies = JSON.parse(readFileSync(VELOG_COOKIE_PATH, "utf-8"));
  const velogLocalStorage = existsSync(VELOG_LS_PATH)
    ? JSON.parse(readFileSync(VELOG_LS_PATH, "utf-8"))
    : null;

  // 게이트 통과 후에만 필요하므로 lazy import — 게이트 경로(차단/중복/로그인)는
  // 브라우저 모듈 로드 비용 없이 즉시 종료된다
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: config.browser.headless });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });
  await context.addCookies(cookies);
  const page = await context.newPage();

  try {
    // === Step 1: 세션 준비 (localStorage 복원) ===
    console.log("[1/3] Velog 접속...");
    await page.goto("https://velog.io", { waitUntil: "domcontentloaded" });
    await sleep(1000);

    if (velogLocalStorage) {
      await page.evaluate((ls) => {
        Object.entries(ls).forEach(([k, v]) => {
          try { localStorage.setItem(k, v); } catch { /* ignore */ }
        });
      }, velogLocalStorage);
      await page.reload({ waitUntil: "domcontentloaded" });
      await sleep(2000);
    }

    // 로그인 상태 확인 (write 접근으로)
    await page.goto("https://velog.io/write", { waitUntil: "domcontentloaded" });
    await sleep(3000);
    if (!page.url().includes("/write")) {
      console.error("글쓰기 페이지 접근 실패. 로그인이 필요합니다.");
      console.log("STATUS:LOGIN_REQUIRED");
      await browser.close();
      process.exit(2);
    }
    console.log("[1/3] 로그인 확인 완료");

    // === Step 2: 썸네일 업로드 (선택) ===
    let thumbnailUrl = null;
    if (thumbnailPath && existsSync(thumbnailPath)) {
      console.log("[2/3] 썸네일 업로드 시도...");
      try {
        const publishBtn = page.getByRole("button", { name: "출간하기" }).first();
        await publishBtn.waitFor({ state: "visible", timeout: 10000 });
        await publishBtn.click();
        await sleep(2000);
        const fileInput = page.locator('input[type="file"]');
        if ((await fileInput.count()) > 0) {
          await fileInput.setInputFiles(thumbnailPath);
          for (let i = 0; i < 15; i++) {
            await sleep(1000);
            thumbnailUrl = await page.evaluate(() => {
              const imgs = Array.from(document.querySelectorAll("img"));
              for (const img of imgs) {
                const src = img.src || "";
                if (
                  src.startsWith("https://") &&
                  (src.includes("velcdn.com") || src.includes("velog.io") ||
                    src.includes("amazonaws.com") || src.includes("cdn."))
                ) {
                  return src;
                }
              }
              return null;
            });
            if (thumbnailUrl) break;
          }
        }
        console.log("[2/3] 썸네일:", thumbnailUrl ? "업로드됨" : "미확보 (없이 발행)");
      } catch (err) {
        console.warn("[2/3] 썸네일 업로드 실패 (건너뜀):", err.message);
      }
    }

    // === Step 3: GraphQL WritePost 발행 ===
    const urlSlug = title
      .toLowerCase()
      .replace(/[^a-z0-9가-힣\s]/g, "")
      .replace(/\s+/g, "-")
      .substring(0, 80);
    const description = body.replace(/[#>*`\n]/g, " ").replace(/\s+/g, " ").trim().substring(0, 97) + "...";

    console.log("[3/3] GraphQL API로 발행 중...");
    const publishResult = await page.evaluate(
      async ({ title, body, tags, urlSlug, description, thumbnail, isPrivate }) => {
        const res = await fetch("https://v3.velog.io/graphql", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            operationName: "WritePost",
            query: `mutation WritePost($input: WritePostInput!) {
              writePost(input: $input) {
                id
                url_slug
                user { username }
              }
            }`,
            variables: {
              input: {
                title,
                body,
                tags,
                is_markdown: true,
                is_temp: false,
                is_private: isPrivate,
                url_slug: urlSlug,
                thumbnail: thumbnail || null,
                meta: { short_description: description },
              },
            },
          }),
        });
        return res.json();
      },
      { title, body, tags, urlSlug, description, thumbnail: thumbnailUrl, isPrivate }
    );

    if (publishResult.data?.writePost?.url_slug) {
      const username = publishResult.data.writePost.user?.username || config.velog.username;
      const postUrl = `https://velog.io/@${username}/${publishResult.data.writePost.url_slug}`;
      console.log("Velog 발행 성공!");
      console.log("STATUS:PUBLISHED");
      console.log("URL:" + postUrl);

      try {
        mkdirSync(dirname(PUBLISH_LOG), { recursive: true });
        appendFileSync(
          PUBLISH_LOG,
          JSON.stringify({
            ts: new Date().toISOString(),
            title,
            url: postUrl,
            session: meta.session || "",
            score: meta.score ? Number(meta.score) : null,
            private: isPrivate,
          }) + "\n"
        );
      } catch { /* 로그 실패가 발행 성공을 가리면 안 됨 */ }
    } else if (publishResult.data?.writePost === null) {
      console.log("발행 실패: writePost null (인증 실패 — 다시 로그인 필요)");
      console.log("STATUS:LOGIN_REQUIRED");
      await browser.close();
      process.exit(2);
    } else {
      const errMsg = publishResult.errors?.[0]?.message || JSON.stringify(publishResult).substring(0, 300);
      console.log("발행 실패:", errMsg);
      console.log("STATUS:FAILED");
      process.exitCode = 1;
    }

    // 쿠키 갱신 저장
    const updatedCookies = await context.cookies();
    writeFileSync(VELOG_COOKIE_PATH, JSON.stringify(updatedCookies, null, 2));
  } catch (err) {
    console.error("오류 발생:", err.message);
    console.log("STATUS:ERROR");
    try {
      const screenshotPath = join(DATA_DIR, `publish-error-${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath });
      console.log("에러 스크린샷:", screenshotPath);
    } catch { /* ignore */ }
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

// 테스트에서 parseMarkdown만 import할 수 있게 직접 실행 시에만 main
import { fileURLToPath } from "node:url";
import path from "node:path";
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
