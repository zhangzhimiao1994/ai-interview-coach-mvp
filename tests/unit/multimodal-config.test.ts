import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { basename, join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  decryptCredentialMap,
  encryptCredentialMap,
  encryptSecret,
  previewCredentialMap
} from "@/lib/domain/aiServices";
import {
  parseAiModelConfigInput,
  parseAiServiceProviderInput
} from "@/lib/validators/aiServices";

const root = process.cwd();
const prismaDirectory = join(root, "prisma");
const prismaCliPath = join(root, "node_modules/prisma/build/index.js");
const migrationPath = join(
  root,
  "prisma/migrations/20260715090000_add_multimodal_config/migration.sql"
);
const preMigrationSql = `
PRAGMA foreign_keys = ON;

CREATE TABLE "AiServiceProvider" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "displayName" TEXT NOT NULL,
  "providerType" TEXT NOT NULL
);

CREATE TABLE "AiModelConfig" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "providerId" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "modelName" TEXT NOT NULL,
  "capability" TEXT NOT NULL,
  FOREIGN KEY ("providerId") REFERENCES "AiServiceProvider" ("id")
);

INSERT INTO "AiServiceProvider" ("id", "displayName", "providerType")
VALUES ('existing-provider', 'Existing Provider', 'OPENAI_COMPATIBLE');

INSERT INTO "AiModelConfig" (
  "id", "providerId", "displayName", "modelName", "capability"
) VALUES (
  'existing-model', 'existing-provider', 'Existing Model', 'existing-model', 'CHAT'
);
`;

function readWorkspaceFile(path: string) {
  return readFileSync(join(root, path), "utf8");
}

function modelFields(schema: string, modelName: string) {
  const model = schema.match(new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`));

  expect(model, `Expected ${modelName} model in Prisma schema`).not.toBeNull();

  return model![1]
    .split("\n")
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter(Boolean);
}

function migrationSql() {
  return existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
}

function migrationStatements() {
  return migrationSql()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--.*$/gm, "")
    .split(";")
    .map((statement) => statement.trim().replace(/\s+/g, " "))
    .filter(Boolean);
}

type MigrationVerification = {
  provider: {
    id: string;
    displayName: string;
    providerType: string;
    credentialsCiphertext: string | null;
    credentialsIv: string | null;
    credentialsTag: string | null;
    credentialsPreviewJson: string | null;
    settingsJson: string;
  };
  model: {
    id: string;
    providerId: string;
    displayName: string;
    modelName: string;
    capability: string;
    settingsJson: string;
  };
  providerColumns: Record<string, { notNull: number; defaultValue: string | null }>;
  modelColumns: Record<string, { notNull: number; defaultValue: string | null }>;
};

type SqliteColumn = {
  name: string;
  notnull: number | bigint;
  dflt_value: string | null;
};

function executeSqlFile(file: string, databaseUrl: string) {
  execFileSync(
    process.execPath,
    [prismaCliPath, "db", "execute", "--file", file, "--url", databaseUrl],
    {
      cwd: prismaDirectory,
      stdio: "pipe"
    }
  );
}

function columnMetadata(columns: SqliteColumn[]) {
  return Object.fromEntries(
    columns.map((column) => [
      column.name,
      {
        notNull: Number(column.notnull),
        defaultValue: column.dflt_value
      }
    ])
  );
}

async function migrateRepresentativeData(): Promise<MigrationVerification> {
  const temporaryDirectory = mkdtempSync(
    join(prismaDirectory, ".multimodal-config-")
  );
  const setupPath = join(temporaryDirectory, "setup.sql");
  const databaseUrl = `file:./${basename(temporaryDirectory)}/migration.db`;
  let prisma: PrismaClient | undefined;

  try {
    writeFileSync(setupPath, preMigrationSql, "utf8");
    executeSqlFile(setupPath, databaseUrl);
    executeSqlFile(migrationPath, databaseUrl);

    prisma = new PrismaClient({ datasourceUrl: databaseUrl });

    const providers = await prisma.$queryRawUnsafe<
      MigrationVerification["provider"][]
    >(`
      SELECT id, displayName, providerType, credentialsCiphertext,
             credentialsIv, credentialsTag, credentialsPreviewJson, settingsJson
      FROM AiServiceProvider
    `);
    const models = await prisma.$queryRawUnsafe<MigrationVerification["model"][]>(`
      SELECT id, providerId, displayName, modelName, capability, settingsJson
      FROM AiModelConfig
    `);
    const providerColumns = await prisma.$queryRawUnsafe<SqliteColumn[]>(
      `PRAGMA table_info("AiServiceProvider")`
    );
    const modelColumns = await prisma.$queryRawUnsafe<SqliteColumn[]>(
      `PRAGMA table_info("AiModelConfig")`
    );

    if (!providers[0] || !models[0]) {
      throw new Error("Migration removed representative configuration rows");
    }

    return {
      provider: providers[0],
      model: models[0],
      providerColumns: columnMetadata(providerColumns),
      modelColumns: columnMetadata(modelColumns)
    };
  } finally {
    try {
      await prisma?.$disconnect();
    } finally {
      rmSync(temporaryDirectory, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 50
      });
    }
  }
}

describe("multimodal configuration columns", () => {
  it("declares additive provider credentials and settings fields in the Prisma schema", () => {
    const schema = readWorkspaceFile("prisma/schema.prisma");

    expect(modelFields(schema, "AiServiceProvider")).toEqual(
      expect.arrayContaining([
        "credentialsCiphertext String?",
        "credentialsIv String?",
        "credentialsTag String?",
        "credentialsPreviewJson String?",
        'settingsJson String @default("{}")'
      ])
    );
    expect(modelFields(schema, "AiModelConfig")).toContain(
      'settingsJson String @default("{}")'
    );
  });

  it("contains only the required additive ALTER TABLE statements", () => {
    expect(migrationStatements()).toEqual([
      'ALTER TABLE "AiServiceProvider" ADD COLUMN "credentialsCiphertext" TEXT',
      'ALTER TABLE "AiServiceProvider" ADD COLUMN "credentialsIv" TEXT',
      'ALTER TABLE "AiServiceProvider" ADD COLUMN "credentialsTag" TEXT',
      'ALTER TABLE "AiServiceProvider" ADD COLUMN "credentialsPreviewJson" TEXT',
      `ALTER TABLE "AiServiceProvider" ADD COLUMN "settingsJson" TEXT NOT NULL DEFAULT '{}'`,
      `ALTER TABLE "AiModelConfig" ADD COLUMN "settingsJson" TEXT NOT NULL DEFAULT '{}'`
    ]);
  });

  it("does not use destructive DROP statements", () => {
    expect(migrationStatements().join("; ")).not.toMatch(/\bDROP\b/i);
  });

  it("preserves existing provider and model data when the migration executes", async () => {
    const result = await migrateRepresentativeData();

    expect(result.provider).toEqual({
      id: "existing-provider",
      displayName: "Existing Provider",
      providerType: "OPENAI_COMPATIBLE",
      credentialsCiphertext: null,
      credentialsIv: null,
      credentialsTag: null,
      credentialsPreviewJson: null,
      settingsJson: "{}"
    });
    expect(result.model).toEqual({
      id: "existing-model",
      providerId: "existing-provider",
      displayName: "Existing Model",
      modelName: "existing-model",
      capability: "CHAT",
      settingsJson: "{}"
    });

    for (const column of [
      "credentialsCiphertext",
      "credentialsIv",
      "credentialsTag",
      "credentialsPreviewJson"
    ]) {
      expect(result.providerColumns[column]).toMatchObject({ notNull: 0 });
    }
    expect(result.providerColumns.settingsJson).toEqual({
      notNull: 1,
      defaultValue: "'{}'"
    });
    expect(result.modelColumns.settingsJson).toEqual({
      notNull: 1,
      defaultValue: "'{}'"
    });
  });
});

describe("structured provider credentials", () => {
  const configSecret = "multimodal-config-test-secret";

  it("encrypts and decrypts a credential map", () => {
    const credentials = {
      apiKey: "sk-structured-secret",
      organization: "org-private-value"
    };

    const encrypted = encryptCredentialMap(credentials, configSecret);

    expect(encrypted.ciphertext).not.toContain(credentials.apiKey);
    expect(decryptCredentialMap(encrypted, configSecret)).toEqual(credentials);
  });

  it("previews every credential without exposing plaintext values", () => {
    const credentials = {
      apiKey: "sk-structured-secret",
      organization: "org-private-value"
    };

    const preview = previewCredentialMap(credentials);
    const serializedPreview = JSON.stringify(preview);

    expect(Object.keys(preview)).toEqual(Object.keys(credentials));
    expect(serializedPreview).not.toContain(credentials.apiKey);
    expect(serializedPreview).not.toContain(credentials.organization);
  });

  it.each([[1, "a"], [2, "ab"], [3, "abc"], [4, "abcd"]])(
    "fully masks a %i-character credential value",
    (_length, secret) => {
      expect(previewCredentialMap({ secret })).toEqual({ secret: "****" });
    }
  );

  it.each([null, [], "secret", 42, true])(
    "rejects invalid decrypted credential payload %j",
    (payload) => {
      const encrypted = encryptSecret(JSON.stringify(payload), configSecret);

      expect(() => decryptCredentialMap(encrypted, configSecret)).toThrow(
        "Stored credentials are invalid"
      );
    }
  );

  it("rejects malformed decrypted credential JSON", () => {
    const encrypted = encryptSecret("not-json", configSecret);

    expect(() => decryptCredentialMap(encrypted, configSecret)).toThrowError(
      /^Stored credentials are invalid$/
    );
  });

  it.each([
    [
      "envelope validation",
      () =>
        decryptCredentialMap(
          { ...encryptCredentialMap({ apiKey: "secret" }, configSecret), iv: "YQ" },
          configSecret
        )
    ],
    [
      "decryption",
      () =>
        decryptCredentialMap(
          encryptCredentialMap({ apiKey: "secret" }, configSecret),
          "wrong-config-secret"
        )
    ]
  ])("normalizes %s failures", (_case, decrypt) => {
    expect(decrypt).toThrowError(/^Stored credentials are invalid$/);
  });

  it("drops non-string values from decrypted credential objects", () => {
    const encrypted = encryptSecret(
      JSON.stringify({ apiKey: "kept", expiresAt: 123, enabled: true, note: null }),
      configSecret
    );

    expect(decryptCredentialMap(encrypted, configSecret)).toEqual({ apiKey: "kept" });
  });
});

describe("multimodal provider and model validation", () => {
  const providerInput = {
    displayName: "Alibaba Cloud",
    providerType: "OPENAI_COMPATIBLE" as const
  };
  const modelInput = {
    providerId: "provider-1",
    displayName: "Qwen VL Max",
    modelName: "qwen-vl-max",
    capability: "VISION_BEHAVIOR_ANALYSIS" as const
  };

  it("accepts provider credentials, public settings, and the legacy apiKey", () => {
    const result = parseAiServiceProviderInput({
      ...providerInput,
      apiKey: "legacy-api-key",
      credentials: {
        apiKey: "structured-api-key",
        workspace: " workspace-id "
      },
      settings: {
        region: "cn-beijing",
        retryCount: 3,
        useResponsesApi: true
      }
    });

    expect(result.apiKey).toBe("legacy-api-key");
    expect(result.credentials).toEqual({
      apiKey: "structured-api-key",
      workspace: "workspace-id"
    });
    expect(result.settings).toEqual({
      region: "cn-beijing",
      retryCount: 3,
      useResponsesApi: true
    });
  });

  it("accepts primitive model settings", () => {
    const result = parseAiModelConfigInput({
      ...modelInput,
      settings: {
        responseFormat: "json",
        topK: 20,
        enableThinking: false
      }
    });

    expect(result.settings).toEqual({
      responseFormat: "json",
      topK: 20,
      enableThinking: false
    });
  });

  it.each([Infinity, -Infinity, NaN])(
    "rejects non-finite provider setting %s",
    (value) => {
      expect(() =>
        parseAiServiceProviderInput({
          ...providerInput,
          settings: { retryCount: value }
        })
      ).toThrow();
    }
  );

  it.each([Infinity, -Infinity, NaN])(
    "rejects non-finite model setting %s",
    (value) => {
      expect(() =>
        parseAiModelConfigInput({
          ...modelInput,
          settings: { topK: value }
        })
      ).toThrow();
    }
  );

  it.each(["", "   ", "__proto__", "prototype", "constructor"])(
    "rejects unsafe provider credential key %j",
    (key) => {
      expect(() =>
        parseAiServiceProviderInput({
          ...providerInput,
          credentials: Object.fromEntries([[key, "secret"]])
        })
      ).toThrow();
    }
  );

  it.each(["", "   ", "__proto__", "prototype", "constructor"])(
    "rejects unsafe provider setting key %j",
    (key) => {
      expect(() =>
        parseAiServiceProviderInput({
          ...providerInput,
          settings: Object.fromEntries([[key, true]])
        })
      ).toThrow();
    }
  );

  it.each(["", "   ", "__proto__", "prototype", "constructor"])(
    "rejects unsafe model setting key %j",
    (key) => {
      expect(() =>
        parseAiModelConfigInput({
          ...modelInput,
          settings: Object.fromEntries([[key, true]])
        })
      ).toThrow();
    }
  );

  it.each([
    ["provider", () => parseAiServiceProviderInput({
      ...providerInput,
      settings: { nested: { unsupported: true } }
    })],
    ["model", () => parseAiModelConfigInput({
      ...modelInput,
      settings: { nested: ["unsupported"] }
    })]
  ])("rejects nested non-primitive %s settings", (_kind, parse) => {
    expect(parse).toThrow();
  });

  it.each([
    ["provider", () => parseAiServiceProviderInput({
      ...providerInput,
      unexpected: "field"
    })],
    ["model", () => parseAiModelConfigInput({
      ...modelInput,
      unexpected: "field"
    })]
  ])("keeps %s validation strict at the top level", (_kind, parse) => {
    expect(parse).toThrow();
  });

  it("defaults omitted credential and settings maps to empty objects", () => {
    expect(parseAiServiceProviderInput(providerInput)).toMatchObject({
      credentials: {},
      settings: {}
    });
    expect(parseAiModelConfigInput(modelInput)).toMatchObject({ settings: {} });
  });
});
