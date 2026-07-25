import { redirect } from "next/navigation";
import { AdminLoginForm } from "@/components/admin/AdminLoginForm";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

type SetupPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function readNextPath(value: string | string[] | undefined) {
  const nextPath = Array.isArray(value) ? value[0] : value;

  return nextPath?.startsWith("/") ? nextPath : "/admin";
}

export default async function SetupPage({ searchParams }: SetupPageProps) {
  const params = await searchParams;
  const nextPath = readNextPath(params?.next);
  const adminCount = await prisma.adminUser.count();

  if (adminCount > 0) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-12">
      <section className="mx-auto max-w-md">
        <p className="text-sm font-medium text-brand">首次运行初始化</p>
        <h1 className="mt-2 text-3xl font-semibold text-ink">创建超级管理员</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          这是开发面试数字人的第一次启动，请先设置超级管理员账号和密码。创建成功后会自动进入后台。
        </p>
        <div className="mt-6">
          <AdminLoginForm mode="setup" nextPath={nextPath} />
        </div>
      </section>
    </main>
  );
}
