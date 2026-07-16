UPDATE "AiModelConfig"
SET
  "displayName" = '阿里百炼 非实时语音合成',
  "modelName" = 'qwen3-tts-instruct-flash',
  "settingsJson" = '{"voice":"Cherry","instructions":"语气专业、自然、清晰。"}',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" LIKE 'alibaba-media-%-text-to-speech'
  AND "displayName" = '阿里百炼 实时语音合成'
  AND "modelName" = 'qwen3-tts-instruct-flash-realtime'
  AND "settingsJson" = '{"voice":"Cherry","sampleRate":24000,"format":"pcm"}';
