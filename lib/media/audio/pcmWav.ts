const wavHeaderByteLength = 44;

export function pcm16MonoToWav(pcm: Buffer, sampleRate: number) {
  if (pcm.byteLength % 2 !== 0) {
    throw new Error("PCM16 input must contain whole samples");
  }

  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new Error("PCM16 sample rate must be a positive integer");
  }

  const wav = Buffer.alloc(wavHeaderByteLength + pcm.byteLength);
  const byteRate = sampleRate * 2;

  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(wav.byteLength - 8, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(byteRate, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(pcm.byteLength, 40);
  pcm.copy(wav, wavHeaderByteLength);

  return wav;
}
