import { describe, expect, it } from "vitest";
import {
  buildJobDescriptionContext,
  extractJobPostingFromHtml,
  isBlockedJobPostingHtml,
  isSafePublicJobPostingUrl
} from "@/lib/domain/jobPostingImporter";

describe("job posting importer", () => {
  it("extracts public job title, company and requirements from recruitment HTML", () => {
    const html = `
      <!doctype html>
      <html>
        <head>
          <title>高级前端工程师 - 星河科技</title>
          <meta property="og:site_name" content="Example Jobs" />
        </head>
        <body>
          <nav>登录 注册 首页</nav>
          <main>
            <h1>高级前端工程师</h1>
            <section>
              <h2>职位描述</h2>
              <p>负责开发 AI 面试产品的候选人端和后台配置能力。</p>
              <p>需要熟悉 React、TypeScript、WebSocket 和性能优化。</p>
              <p>加分项：有音视频、数字人或招聘平台产品经验。</p>
            </section>
          </main>
          <script>window.__SECRET__ = "not content";</script>
        </body>
      </html>
    `;

    const result = extractJobPostingFromHtml(html, "https://jobs.example.com/job/123");

    expect(result.title).toBe("高级前端工程师");
    expect(result.company).toBe("Example Jobs");
    expect(result.description).toContain("负责开发 AI 面试产品");
    expect(result.description).toContain("React、TypeScript、WebSocket");
    expect(result.requirements).toEqual(
      expect.arrayContaining([
        "需要熟悉 React、TypeScript、WebSocket 和性能优化。",
        "加分项：有音视频、数字人或招聘平台产品经验。"
      ])
    );
    expect(result.description).not.toContain("window.__SECRET__");
    expect(result.sourceUrl).toBe("https://jobs.example.com/job/123");
  });

  it("extracts English requirements from global ATS job pages", () => {
    const html = `
      <html>
        <head>
          <title>Senior Product Manager, AI Interviewing - Northstar Labs</title>
          <meta name="description" content="Northstar Labs is hiring a Senior Product Manager." />
        </head>
        <body>
          <article>
            <h1>Senior Product Manager, AI Interviewing</h1>
            <div class="company-name">Northstar Labs</div>
            <h2>About the role</h2>
            <p>You will own the roadmap for real-time AI interview coaching across web and mobile.</p>
            <h2>Responsibilities</h2>
            <ul>
              <li>Define product strategy for multimodal interview simulations.</li>
              <li>Partner with design, engineering, data science, and go-to-market teams.</li>
            </ul>
            <h2>Requirements</h2>
            <ul>
              <li>5+ years of product management experience in SaaS or AI products.</li>
              <li>Experience with speech, video, or real-time collaboration products is preferred.</li>
            </ul>
          </article>
        </body>
      </html>
    `;

    const result = extractJobPostingFromHtml(html, "https://boards.greenhouse.io/northstar/jobs/456");

    expect(result.title).toBe("Senior Product Manager, AI Interviewing");
    expect(result.company).toBe("Northstar Labs");
    expect(result.description).toContain("real-time AI interview coaching");
    expect(result.requirements).toEqual(
      expect.arrayContaining([
        "Define product strategy for multimodal interview simulations.",
        "5+ years of product management experience in SaaS or AI products.",
        "Experience with speech, video, or real-time collaboration products is preferred."
      ])
    );
  });

  it("detects pages that need login or anti-bot verification instead of pretending to import them", () => {
    expect(isBlockedJobPostingHtml("<html><body>请先登录后查看职位详情</body></html>")).toBe(true);
    expect(isBlockedJobPostingHtml("<html><body>安全验证 请完成滑块验证</body></html>")).toBe(true);
    expect(isBlockedJobPostingHtml("<html><body><h1>产品经理</h1><p>岗位职责...</p></body></html>")).toBe(false);
  });

  it("combines imported JD text and manual notes into the context used by the interviewer", () => {
    expect(
      buildJobDescriptionContext({
        importedDescription: "岗位职责：负责增长策略。",
        manualNotes: "补充：候选人重点准备 B 端 SaaS 商业化。"
      })
    ).toBe("岗位职责：负责增长策略。\n\n人工补充：\n补充：候选人重点准备 B 端 SaaS 商业化。");
  });

  it("rejects private or local URLs before server-side fetching", () => {
    expect(isSafePublicJobPostingUrl("https://www.zhipin.com/job_detail/abc")).toBe(true);
    expect(isSafePublicJobPostingUrl("https://www.linkedin.com/jobs/view/123")).toBe(true);
    expect(isSafePublicJobPostingUrl("https://www.indeed.com/viewjob?jk=abc")).toBe(true);
    expect(isSafePublicJobPostingUrl("https://boards.greenhouse.io/acme/jobs/123")).toBe(true);
    expect(isSafePublicJobPostingUrl("https://jobs.lever.co/acme/123")).toBe(true);
    expect(isSafePublicJobPostingUrl("https://jobs.ashbyhq.com/acme/123")).toBe(true);
    expect(isSafePublicJobPostingUrl("https://acme.wd1.myworkdayjobs.com/jobs/job/123")).toBe(true);
    expect(isSafePublicJobPostingUrl("http://localhost:3000/admin")).toBe(false);
    expect(isSafePublicJobPostingUrl("http://127.0.0.1:3000/admin")).toBe(false);
    expect(isSafePublicJobPostingUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isSafePublicJobPostingUrl("ftp://jobs.example.com/job/1")).toBe(false);
  });
});
