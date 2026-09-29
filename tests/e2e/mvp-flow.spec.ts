import { expect, test, type Page } from "@playwright/test";

const username = process.env.ADMIN_USERNAME || "admin";
const password = process.env.ADMIN_PASSWORD || "e2e-admin-password";
const adminHeaders = {
  Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
};

async function createCandidate(page: Page, candidateName: string) {
  await page.goto("/admin/candidates");
  await page.getByLabel("姓名").fill(candidateName);
  await page.getByLabel("邮箱").fill(`candidate-${Date.now()}@example.com`);
  await page.getByLabel("目标公司").fill("示例科技公司");
  await page.getByLabel("目标岗位").fill("产品经理");
  await Promise.all([
    page.waitForResponse((response) => response.url().includes("/api/candidates") && response.request().method() === "POST", {
      timeout: 30000
    }),
    page.getByRole("button", { name: "创建求职者" }).click()
  ]);
  await expect(page.getByRole("heading", { name: candidateName })).toBeVisible({ timeout: 30000 });
}

test("creates a candidate through the MVP service backend flow", async ({ page }) => {
  await page.setExtraHTTPHeaders(adminHeaders);
  await page.goto("/");
  await Promise.all([
    page.waitForURL("**/admin", { timeout: 30000 }),
    page.getByRole("link", { name: "进入服务后台" }).click()
  ]);
  await expect(page.getByRole("heading", { name: "运营控制台" })).toBeVisible({ timeout: 30000 });

  await createCandidate(page, `测试求职者-${Date.now()}`);
});

test("runs a candidate interview from the practice link to the report", async ({ browser, page }) => {
  test.setTimeout(120000);
  const candidateName = `练习求职者-${Date.now()}`;

  await page.setExtraHTTPHeaders(adminHeaders);
  await createCandidate(page, candidateName);
  await page.goto("/admin/tasks/new");
  await page.getByLabel("Candidate").selectOption({ label: candidateName });
  await page.getByLabel("Training title").fill("端到端模拟面试");
  await page.getByLabel("Target company").fill("示例科技公司");
  await page.getByLabel("Target role").fill("产品经理");
  await page.getByRole("button", { name: "Create training task" }).click();
  await page.waitForURL(/\/admin\/tasks\/(?!new)[^/]+$/, { timeout: 30000 });
  const practicePath = new URL(page.url()).pathname.replace("/admin/tasks/", "/practice/");

  // The candidate has no admin credentials: any API the room calls must accept the candidate cookie.
  const candidate = await browser.newContext();
  const room = await candidate.newPage();
  await room.goto(practicePath);
  await room.getByRole("button", { name: "进入视频面试" }).click();
  await room.waitForURL("**/room", { timeout: 30000 });

  const progress = room.getByText(/已完成 \d+ \/ \d+ 题/);
  await expect(progress).toBeVisible({ timeout: 30000 });
  const total = Number((await progress.innerText()).match(/\/ (\d+)/)?.[1]);

  for (let turn = 0; turn < total * 2; turn += 1) {
    const answer = room.getByLabel("Candidate answer");
    if (!(await answer.isVisible())) break;
    await answer.fill("我负责过电商增长项目，先用漏斗定位问题，再做 A/B 实验，把下单转化率提升了 12%。");
    await Promise.all([
      room.waitForResponse((response) => response.url().endsWith("/answer") && response.status() === 201, { timeout: 30000 }),
      room.getByRole("button", { name: /提交/ }).click()
    ]);
    await expect(room.getByRole("button", { name: /保存中/ })).toHaveCount(0, { timeout: 30000 });
  }

  await expect(room.getByText(`已完成 ${total} / ${total} 题`)).toBeVisible();
  await room.getByRole("button", { name: "完成面试并生成报告" }).click();
  await room.waitForURL("**/report", { timeout: 30000 });
  await expect(room.getByText("综合评分")).toBeVisible({ timeout: 30000 });
  await candidate.close();
});
