import { describe, expect, it } from "vitest";
import { pcm16MonoToWav } from "@/lib/media/audio/pcmWav";

describe("pcm16MonoToWav", () => {
  it("wraps 48 kHz mono PCM in a valid 16-bit WAV header", () => {
    const wav = pcm16MonoToWav(Buffer.alloc(96_000), 48_000);

    expect(wav.byteLength).toBe(96_044);
    expect(wav.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(wav.readUInt32LE(4)).toBe(96_036);
    expect(wav.subarray(8, 12).toString("ascii")).toBe("WAVE");
    expect(wav.subarray(12, 16).toString("ascii")).toBe("fmt ");
    expect(wav.readUInt16LE(20)).toBe(1);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(48_000);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.subarray(36, 40).toString("ascii")).toBe("data");
    expect(wav.readUInt32LE(40)).toBe(96_000);
  });

  it("rejects odd-length input that cannot contain PCM16 samples", () => {
    expect(() => pcm16MonoToWav(Buffer.alloc(3), 48_000)).toThrow(
      "PCM16 input must contain whole samples"
    );
  });
});
