import { expect, test } from "@playwright/test";

test("creates a candidate through the MVP service backend flow", async ({ page }) => {
  const candidateName = `测试求职者-${Date.now()}`;
  const candidateEmail = `candidate-${Date.now()}@example.com`;

  await page.goto("/");
  await Promise.all([
    page.waitForURL("**/admin", { timeout: 30000 }),
    page.getByRole("link", { name: "进入服务后台" }).click()
  ]);
  await expect(page.getByRole("heading", { name: "服务后台" })).toBeVisible({ timeout: 30000 });

  await page.getByRole("link", { name: "求职者档案" }).click();
  await page.getByLabel("姓名").fill(candidateName);
  await page.getByLabel("邮箱").fill(candidateEmail);
  await page.getByLabel("目标公司").fill("示例科技公司");
  await page.getByLabel("目标岗位").fill("产品经理");
  await Promise.all([
    page.waitForResponse((response) => response.url().includes("/api/candidates") && response.request().method() === "POST", {
      timeout: 30000
    }),
    page.getByRole("button", { name: "创建求职者" }).click()
  ]);

  await expect(page.getByRole("heading", { name: candidateName })).toBeVisible({ timeout: 30000 });
});
