"use client";

import { useMemo, useState } from "react";

type AdminUser = {
  id: string;
  username: string;
  displayName: string | null;
  role: string;
  enabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type AdminUserManagementPanelProps = {
  initialUsers: AdminUser[];
};

type DraftUser = {
  username: string;
  displayName: string;
  password: string;
  role: "ADMIN" | "SUPER_ADMIN";
};

const emptyDraft: DraftUser = {
  username: "",
  displayName: "",
  password: "",
  role: "ADMIN"
};

function formatDate(value: string | null) {
  if (!value) {
    return "从未登录";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

async function readJson(response: Response) {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

export function AdminUserManagementPanel({ initialUsers }: AdminUserManagementPanelProps) {
  const [users, setUsers] = useState(initialUsers);
  const [draft, setDraft] = useState<DraftUser>(emptyDraft);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const enabledCount = useMemo(() => users.filter((user) => user.enabled).length, [users]);

  async function createUser(formData: FormData) {
    setMessage("");
    setError("");

    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: formData.get("username"),
        displayName: formData.get("displayName"),
        password: formData.get("password"),
        role: formData.get("role")
      })
    });
    const payload = await readJson(response);

    if (!response.ok) {
      setError(String(payload.message || payload.error || "创建管理员失败"));
      return;
    }

    setUsers((current) => [...current, payload.user as AdminUser]);
    setDraft(emptyDraft);
    setMessage("管理员账号已创建。");
  }

  async function patchUser(userId: string, patch: Record<string, unknown>) {
    setSavingId(userId);
    setMessage("");
    setError("");

    const response = await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    });
    const payload = await readJson(response);

    setSavingId(null);

    if (!response.ok) {
      setError(String(payload.message || payload.error || "保存失败"));
      return;
    }

    setUsers((current) => current.map((user) => user.id === userId ? payload.user as AdminUser : user));
    setMessage("用户状态已更新。");
  }

  async function resetPassword(user: AdminUser, formData: FormData) {
    const password = String(formData.get("password") || "");

    if (password.length < 8) {
      setError("新密码至少 8 位。");
      return;
    }

    await patchUser(user.id, { password });
    const form = document.getElementById(`password-${user.id}`) as HTMLFormElement | null;
    form?.reset();
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_1fr]">
      <section className="rounded-lg border border-line bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-ink">新增管理员</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          创建后默认启用。用户名仅支持小写字母、数字、点、下划线和短横线，长度 3-32。
        </p>
        <form action={createUser} className="mt-5 grid gap-4">
          <label className="grid gap-2 text-sm">
            <span className="font-medium text-ink">用户名</span>
            <input
              className="rounded-md border border-line px-3 py-2"
              name="username"
              pattern="[a-z0-9._-]{3,32}"
              required
              value={draft.username}
              onChange={(event) => setDraft({ ...draft, username: event.target.value })}
            />
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-medium text-ink">显示名</span>
            <input
              className="rounded-md border border-line px-3 py-2"
              name="displayName"
              value={draft.displayName}
              onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
            />
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-medium text-ink">初始密码</span>
            <input
              className="rounded-md border border-line px-3 py-2"
              minLength={8}
              name="password"
              required
              type="password"
              value={draft.password}
              onChange={(event) => setDraft({ ...draft, password: event.target.value })}
            />
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-medium text-ink">角色</span>
            <select
              className="rounded-md border border-line px-3 py-2"
              name="role"
              value={draft.role}
              onChange={(event) => setDraft({ ...draft, role: event.target.value as DraftUser["role"] })}
            >
              <option value="ADMIN">管理员</option>
              <option value="SUPER_ADMIN">超级管理员</option>
            </select>
          </label>
          <button className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white" type="submit">
            创建账号
          </button>
        </form>
      </section>

      <section className="rounded-lg border border-line bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-ink">登录权限</h2>
            <p className="mt-1 text-sm text-muted">
              共 {users.length} 个管理员，{enabledCount} 个可登录。
            </p>
          </div>
          <button
            className="rounded-md border border-line px-3 py-2 text-sm text-ink hover:border-brand hover:text-brand"
            onClick={logout}
            type="button"
          >
            退出当前后台登录
          </button>
        </div>

        {message ? <p className="mt-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{message}</p> : null}
        {error ? <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

        <div className="mt-5 grid gap-3">
          {users.map((user) => (
            <article key={user.id} className="rounded-lg border border-line p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-ink">{user.displayName || user.username}</h3>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-muted">{user.role}</span>
                    <span className={user.enabled ? "rounded-full bg-green-50 px-2 py-1 text-xs text-green-700" : "rounded-full bg-red-50 px-2 py-1 text-xs text-red-700"}>
                      {user.enabled ? "可登录" : "已禁用"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted">@{user.username} · 最近登录：{formatDate(user.lastLoginAt)}</p>
                </div>
                <button
                  className="rounded-md border border-line px-3 py-2 text-sm font-medium text-ink transition hover:border-brand hover:text-brand disabled:opacity-60"
                  disabled={savingId === user.id}
                  onClick={() => patchUser(user.id, { enabled: !user.enabled })}
                  type="button"
                >
                  {user.enabled ? "禁用登录" : "启用登录"}
                </button>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="grid gap-2 text-sm">
                  <span className="font-medium text-ink">角色</span>
                  <select
                    className="rounded-md border border-line px-3 py-2"
                    defaultValue={user.role}
                    onChange={(event) => patchUser(user.id, { role: event.target.value })}
                  >
                    <option value="ADMIN">管理员</option>
                    <option value="SUPER_ADMIN">超级管理员</option>
                  </select>
                </label>
                <form
                  action={(formData) => resetPassword(user, formData)}
                  className="grid gap-2 text-sm"
                  id={`password-${user.id}`}
                >
                  <span className="font-medium text-ink">重置密码</span>
                  <div className="flex gap-2">
                    <input
                      className="min-w-0 flex-1 rounded-md border border-line px-3 py-2"
                      minLength={8}
                      name="password"
                      placeholder="至少 8 位"
                      type="password"
                    />
                    <button className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white" type="submit">
                      保存
                    </button>
                  </div>
                </form>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
