UPDATE "AiModelConfig"
SET
  "displayName" = '阿里百炼 Qwen-Audio-TTS 情绪语音合成',
  "modelName" = 'qwen-audio-3.0-tts-flash',
  "settingsJson" = '{"voice":"longanhuan_v3.6","format":"pcm","sampleRate":48000,"channels":1,"instruction":"像专业面试官一样自然、清晰地表达；可根据文本中的 [whisper]、[laughs]、[angry] 等标签添加情绪。"}',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" LIKE 'alibaba-media-%-text-to-speech'
  AND "displayName" = '阿里百炼 CosyVoice 语音合成'
  AND "modelName" = 'cosyvoice-v3-flash'
  AND "settingsJson" = '{"voice":"longanhuan","format":"pcm","sampleRate":48000,"channels":1,"instruction":"你说话的情感是 neutral."}';
