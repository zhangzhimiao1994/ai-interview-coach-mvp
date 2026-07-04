import Link from "next/link";
import type { Route } from "next";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-12">
      <p className="text-sm font-medium text-brand">AI Interview Coach MVP</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-normal text-ink">
        AI 数字人面试训练辅导平台
      </h1>
      <p className="mt-4 max-w-2xl text-base leading-7 text-muted">
        面向服务方的面试训练交付平台：创建求职者档案，配置训练任务，生成练习链接，并沉淀 AI 复盘报告。
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white" href={"/admin" as Route}>
          进入服务后台
        </Link>
      </div>
    </main>
  );
}
