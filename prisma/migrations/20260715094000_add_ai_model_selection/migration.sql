ALTER TABLE "AiModelConfig"
ADD COLUMN "isSelected" BOOLEAN NOT NULL DEFAULT false;

-- Preserve the model that was used before runtime selection became independent.
UPDATE "AiModelConfig"
SET "isSelected" = "isDefault"
WHERE "enabled" = 1
  AND "providerId" IN (
    SELECT "id"
    FROM "AiServiceProvider"
    WHERE "enabled" = 1
  );

UPDATE "AiModelConfig"
SET "isSelected" = 0
WHERE "isSelected" = 1
  AND "enabled" = 0;

UPDATE "AiModelConfig"
SET "isSelected" = 0
WHERE "isSelected" = 1
  AND "id" NOT IN (
    SELECT MIN("id")
    FROM "AiModelConfig"
    WHERE "isSelected" = 1
    GROUP BY "capability"
  );

CREATE INDEX "AiModelConfig_isSelected_idx"
ON "AiModelConfig"("isSelected");

DROP INDEX IF EXISTS "AiModelConfig_one_default_per_capability";

CREATE UNIQUE INDEX "AiModelConfig_one_selected_per_capability"
ON "AiModelConfig"("capability")
WHERE "isSelected" = 1;
