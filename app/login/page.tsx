import { redirect } from "next/navigation";
import { AdminLoginForm } from "@/components/admin/AdminLoginForm";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

type LoginPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function readNextPath(value: string | string[] | undefined) {
  const nextPath = Array.isArray(value) ? value[0] : value;

  return nextPath?.startsWith("/") ? nextPath : "/admin";
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const nextPath = readNextPath(params?.next);
  const adminCount = await prisma.adminUser.count();

  if (adminCount === 0) {
    redirect(`/setup?next=${encodeURIComponent(nextPath)}`);
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-12">
      <section className="mx-auto max-w-md">
        <p className="text-sm font-medium text-brand">后台登录</p>
        <h1 className="mt-2 text-3xl font-semibold text-ink">登录开发面试数字人</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          使用已启用的管理员账号登录。被禁用的账号将无法进入后台和调试房间。
        </p>
        <div className="mt-6">
          <AdminLoginForm mode="login" nextPath={nextPath} />
        </div>
      </section>
    </main>
  );
}
