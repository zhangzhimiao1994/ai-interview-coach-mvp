UPDATE "AiModelConfig"
SET "isDefault" = 0
WHERE "isDefault" = 1
  AND "enabled" = 0;

UPDATE "AiModelConfig"
SET "isDefault" = 0
WHERE "isDefault" = 1
  AND "id" NOT IN (
    SELECT MIN("id")
    FROM "AiModelConfig"
    WHERE "isDefault" = 1
    GROUP BY "capability"
  );

CREATE UNIQUE INDEX "AiModelConfig_one_default_per_capability"
ON "AiModelConfig"("capability")
WHERE "isDefault" = 1;
