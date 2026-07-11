import type { Route } from "next";
import Link from "next/link";
import React from "react";
import {
  Activity,
  Bot,
  Brain,
  BriefcaseBusiness,
  ChevronLeft,
  Database,
  LayoutDashboard,
  Settings2,
  UserRound
} from "lucide-react";

type AdminNavKey =
  | "overview"
  | "candidates"
  | "templates"
  | "tasks"
  | "ai-services"
  | "digital-human"
  | "behavior-analysis";

type AdminShellProps = {
  active: AdminNavKey;
  eyebrow: string;
  title: string;
  description?: string;
  backHref?: Route;
  backLabel?: string;
  children: React.ReactNode;
};

const navItems: Array<{
  key: AdminNavKey;
  href: Route;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}> = [
  {
    key: "overview",
    href: "/admin" as Route,
    label: "总览",
    description: "运营控制台",
    icon: LayoutDashboard
  },
  {
    key: "candidates",
    href: "/admin/candidates" as Route,
    label: "候选人",
    description: "档案与服务状态",
    icon: UserRound
  },
  {
    key: "templates",
    href: "/admin/templates" as Route,
    label: "模板库",
    description: "公司/岗位/面试官",
    icon: Database
  },
  {
    key: "tasks",
    href: "/admin/tasks/new" as Route,
    label: "服务交付",
    description: "训练任务创建",
    icon: BriefcaseBusiness
  },
  {
    key: "ai-services",
    href: "/admin/ai-services" as Route,
    label: "AI能力",
    description: "模型与服务商",
    icon: Brain
  },
  {
    key: "digital-human",
    href: "/admin/ai-services#digital-human" as Route,
    label: "数字人",
    description: "语音和形象接口",
    icon: Bot
  },
  {
    key: "behavior-analysis",
    href: "/admin/ai-services#behavior-analysis" as Route,
    label: "行为分析",
    description: "摄像头/麦克风信号",
    icon: Activity
  }
];

export function AdminShell({
  active,
  eyebrow,
  title,
  description,
  backHref,
  backLabel = "返回后台",
  children
}: AdminShellProps) {
  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="rounded-lg border border-line bg-panel p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-brand">{eyebrow}</p>
            <h1 className="mt-1 text-2xl font-semibold text-ink">{title}</h1>
            {description ? <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">{description}</p> : null}
          </div>
          {backHref ? (
            <Link
              className="inline-flex min-h-10 items-center gap-2 rounded-md border border-line bg-white px-3 py-2 text-sm font-medium text-ink transition hover:border-brand hover:text-brand"
              href={backHref}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
              {backLabel}
            </Link>
          ) : (
            <div className="inline-flex min-h-10 items-center gap-2 rounded-md bg-slate-100 px-3 py-2 text-sm text-muted">
              <Settings2 className="h-4 w-4" aria-hidden />
              后台工作区
            </div>
          )}
        </div>

        <nav className="mt-5 grid gap-2 md:grid-cols-4 xl:grid-cols-7" aria-label="后台导航">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = item.key === active;

            return (
              <Link
                key={item.key}
                className={
                  isActive
                    ? "rounded-md border border-brand bg-blue-50 p-3 text-brand"
                    : "rounded-md border border-line bg-white p-3 text-ink transition hover:border-brand hover:text-brand"
                }
                href={item.href}
              >
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4" aria-hidden />
                  <span className="text-sm font-semibold">{item.label}</span>
                </div>
                <p className="mt-1 text-xs text-muted">{item.description}</p>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="mt-6">{children}</div>
    </main>
  );
}
