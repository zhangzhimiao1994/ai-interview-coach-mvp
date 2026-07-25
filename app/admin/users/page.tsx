import { AdminShell } from "@/components/admin/AdminShell";
import { AdminUserManagementPanel } from "@/components/admin/AdminUserManagementPanel";
import { prisma } from "@/lib/db/prisma";
import { serializeAdminUser } from "@/lib/admin/adminUsers";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const users = await prisma.adminUser.findMany({
    orderBy: [{ role: "desc" }, { createdAt: "asc" }]
  });

  return (
    <AdminShell
      active="users"
      eyebrow="后台安全"
      title="用户管理"
      description="管理谁可以登录后台、进入调试业务和维护系统配置。首次运行创建的账号会作为超级管理员保存在数据库里。"
      backHref="/admin"
    >
      <AdminUserManagementPanel initialUsers={users.map(serializeAdminUser)} />
    </AdminShell>
  );
}
