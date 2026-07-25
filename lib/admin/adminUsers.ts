import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const passwordHashPrefix = "scrypt";
const keyLength = 64;

export type AdminUserRecord = {
  id: string;
  username: string;
  displayName: string | null;
  passwordHash: string;
  role: string;
  enabled: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AdminUserClient = {
  adminUser: {
    findUnique(args: { where: { username: string } }): Promise<AdminUserRecord | null>;
    update(args: { where: { id: string }; data: { lastLoginAt: Date } }): Promise<unknown>;
  };
};

function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

export async function hashAdminPassword(password: string, salt = randomBytes(16).toString("base64")) {
  const key = await scrypt(password, salt, keyLength) as Buffer;

  return `${passwordHashPrefix}$${salt}$${key.toString("base64")}`;
}

export async function verifyAdminPassword(password: string, hash: string) {
  const [prefix, salt, expected] = hash.split("$");

  if (prefix !== passwordHashPrefix || !salt || !expected) {
    return false;
  }

  const actual = await scrypt(password, salt, keyLength) as Buffer;
  const expectedBuffer = Buffer.from(expected, "base64");

  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
}

export function serializeAdminUser(user: AdminUserRecord) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    enabled: user.enabled,
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString()
  };
}

export async function authenticateAdminUser(
  prisma: AdminUserClient,
  username: string,
  password: string
) {
  const user = await prisma.adminUser.findUnique({
    where: { username: normalizeUsername(username) }
  });

  if (!user) {
    return { ok: false as const, reason: "NOT_FOUND" as const };
  }

  if (!user.enabled) {
    return { ok: false as const, reason: "DISABLED" as const };
  }

  if (!await verifyAdminPassword(password, user.passwordHash)) {
    return { ok: false as const, reason: "INVALID_PASSWORD" as const };
  }

  await prisma.adminUser.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() }
  });

  return { ok: true as const, user };
}

export function sanitizeNewAdminUserInput(input: unknown) {
  const values = input !== null && typeof input === "object" ? input as Record<string, unknown> : {};
  const username = typeof values.username === "string" ? normalizeUsername(values.username) : "";
  const displayName = typeof values.displayName === "string" && values.displayName.trim()
    ? values.displayName.trim()
    : null;
  const password = typeof values.password === "string" ? values.password : "";
  const role = values.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "ADMIN";

  if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
    throw new Error("USERNAME_INVALID");
  }

  if (password.length < 8) {
    throw new Error("PASSWORD_TOO_SHORT");
  }

  return { username, displayName, password, role };
}
