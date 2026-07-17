UPDATE "AiModelConfig"
SET
  "displayName" = '阿里百炼 CosyVoice 语音合成',
  "modelName" = 'cosyvoice-v3-flash',
  "settingsJson" = '{"voice":"longanhuan","format":"pcm","sampleRate":48000,"channels":1,"instruction":"你说话的情感是 neutral."}'
WHERE "id" LIKE 'alibaba-media-%-text-to-speech'
  AND "modelName" = 'qwen3-tts-instruct-flash'
  AND "settingsJson" = '{"voice":"Cherry","instructions":"语气专业、自然、清晰。"}';

UPDATE "AiModelConfig"
SET "enabled" = 0, "isDefault" = 0, "isSelected" = 0
WHERE "id" LIKE 'alibaba-media-%-digital-human-realtime'
  AND "modelName" = 'avatar-dialog'
  AND "settingsJson" = '{"avatarId":"","voiceId":"","rtcMode":"web"}';
