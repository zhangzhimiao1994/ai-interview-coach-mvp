"use client";

import { useState } from "react";

type AdminLoginFormProps = {
  mode: "login" | "setup";
  nextPath?: string;
};

export function AdminLoginForm({ mode, nextPath = "/admin" }: AdminLoginFormProps) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(formData: FormData) {
    setLoading(true);
    setError("");

    const response = await fetch(mode === "setup" ? "/api/auth/setup" : "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: formData.get("username"),
        displayName: formData.get("displayName"),
        password: formData.get("password")
      })
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(String(payload.message || payload.error || "操作失败"));
      setLoading(false);
      return;
    }

    window.location.href = nextPath.startsWith("/") ? nextPath : "/admin";
  }

  return (
    <form action={submit} className="grid gap-4 rounded-lg border border-line bg-white p-6 shadow-sm">
      <label className="grid gap-2 text-sm">
        <span className="font-medium text-ink">用户名</span>
        <input className="rounded-md border border-line px-3 py-2" name="username" required minLength={3} />
      </label>
      {mode === "setup" ? (
        <label className="grid gap-2 text-sm">
          <span className="font-medium text-ink">显示名</span>
          <input className="rounded-md border border-line px-3 py-2" name="displayName" />
        </label>
      ) : null}
      <label className="grid gap-2 text-sm">
        <span className="font-medium text-ink">密码</span>
        <input className="rounded-md border border-line px-3 py-2" name="password" type="password" required minLength={8} />
      </label>
      {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      <button
        className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        disabled={loading}
        type="submit"
      >
        {loading ? "处理中..." : mode === "setup" ? "创建超级管理员" : "登录"}
      </button>
    </form>
  );
}
