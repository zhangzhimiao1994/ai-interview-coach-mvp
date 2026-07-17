const WAV_HEADER_BYTES = 44;

export class Pcm16LeDecoder {
  private pendingByte: number | null = null;

  push(chunk: Uint8Array): Int16Array {
    const byteLength = chunk.byteLength + (this.pendingByte === null ? 0 : 1);
    const sampleCount = Math.floor(byteLength / 2);
    const samples = new Int16Array(sampleCount);
    let chunkIndex = 0;
    let sampleIndex = 0;

    if (this.pendingByte !== null && chunk.byteLength > 0) {
      samples[sampleIndex] = signedSample(this.pendingByte, chunk[chunkIndex]);
      sampleIndex += 1;
      chunkIndex += 1;
      this.pendingByte = null;
    }

    while (chunkIndex + 1 < chunk.byteLength) {
      samples[sampleIndex] = signedSample(
        chunk[chunkIndex],
        chunk[chunkIndex + 1]
      );
      sampleIndex += 1;
      chunkIndex += 2;
    }

    if (chunkIndex < chunk.byteLength) {
      this.pendingByte = chunk[chunkIndex];
    }

    return samples;
  }

  finish(): void {
    if (this.pendingByte !== null) {
      throw new Error("PCM16_STREAM_ODD_BYTE");
    }
  }
}

function signedSample(low: number, high: number) {
  const value = low | (high << 8);
  return value >= 0x8000 ? value - 0x1_0000 : value;
}

function writeAscii(bytes: Uint8Array, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    bytes[offset + index] = value.charCodeAt(index);
  }
}

export function pcm16LeToWavBlob(
  bytes: Uint8Array,
  sampleRate: 48000 = 48_000
): Blob {
  if (bytes.byteLength % 2 !== 0) {
    throw new Error("PCM16_STREAM_ODD_BYTE");
  }

  const wav = new Uint8Array(WAV_HEADER_BYTES + bytes.byteLength);
  const view = new DataView(wav.buffer);
  const channels = 1;
  const bitsPerSample = 16;
  const blockAlign = channels * (bitsPerSample / 8);

  writeAscii(wav, 0, "RIFF");
  view.setUint32(4, 36 + bytes.byteLength, true);
  writeAscii(wav, 8, "WAVE");
  writeAscii(wav, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(wav, 36, "data");
  view.setUint32(40, bytes.byteLength, true);
  wav.set(bytes, WAV_HEADER_BYTES);

  return new Blob([wav], { type: "audio/wav" });
}
