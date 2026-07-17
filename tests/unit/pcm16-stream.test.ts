import { describe, expect, it } from "vitest";
import { Pcm16LeDecoder, pcm16LeToWavBlob } from "@/lib/client/pcm16";

describe("Pcm16LeDecoder", () => {
  it("preserves a split little-endian sample across network chunks", () => {
    const decoder = new Pcm16LeDecoder();

    expect(Array.from(decoder.push(Uint8Array.from([0x34])))).toEqual([]);
    expect(
      Array.from(decoder.push(Uint8Array.from([0x12, 0xfe, 0xff])))
    ).toEqual([0x1234, -2]);
    expect(() => decoder.finish()).not.toThrow();
  });

  it("rejects a trailing single byte with a safe error", () => {
    const decoder = new Pcm16LeDecoder();

    decoder.push(Uint8Array.from([0x01]));

    expect(() => decoder.finish()).toThrow("PCM16_STREAM_ODD_BYTE");
  });
});

describe("pcm16LeToWavBlob", () => {
  it("writes a mono 16-bit 48 kHz RIFF/WAVE header and preserves PCM data", async () => {
    const pcm = Uint8Array.from([0x34, 0x12, 0xfe, 0xff]);

    const wav = pcm16LeToWavBlob(pcm);
    const bytes = new Uint8Array(await wav.arrayBuffer());
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const ascii = (offset: number, length: number) =>
      String.fromCharCode(...bytes.slice(offset, offset + length));

    expect(wav.type).toBe("audio/wav");
    expect(ascii(0, 4)).toBe("RIFF");
    expect(view.getUint32(4, true)).toBe(36 + pcm.byteLength);
    expect(ascii(8, 4)).toBe("WAVE");
    expect(ascii(12, 4)).toBe("fmt ");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(48_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(ascii(36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(pcm.byteLength);
    expect(Array.from(bytes.slice(44))).toEqual(Array.from(pcm));
  });
});
