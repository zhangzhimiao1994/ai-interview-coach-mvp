import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

describe("PCM16 AudioWorklet", () => {
  it("downsamples microphone floats and posts transferable little-endian PCM16", () => {
    const source = readFileSync(
      resolve(process.cwd(), "public/audio/pcm16-worklet.js"),
      "utf8"
    );
    const postMessage = vi.fn();
    let Processor: (new (options: unknown) => {
      process(inputs: Float32Array[][]): boolean;
    }) | undefined;

    class AudioWorkletProcessorStub {
      port = { postMessage };
    }

    new Function("AudioWorkletProcessor", "registerProcessor", "sampleRate", source)(
      AudioWorkletProcessorStub,
      (name: string, constructor: typeof Processor) => {
        expect(name).toBe("pcm16-worklet");
        Processor = constructor;
      },
      48_000
    );

    expect(Processor).toBeDefined();
    const processor = new Processor!({
      processorOptions: { targetSampleRate: 16_000 }
    });
    const input = new Float32Array(128).fill(0.5);

    for (let index = 0; index < 8; index += 1) {
      expect(processor.process([[input]])).toBe(true);
    }
    expect(postMessage).toHaveBeenCalledTimes(1);
    const [buffer, transfer] = postMessage.mock.calls[0] as [
      ArrayBuffer,
      ArrayBuffer[]
    ];
    expect(buffer.byteLength).toBe(320 * 2);
    expect(transfer).toEqual([buffer]);
    const samples = new Int16Array(buffer);
    expect([...samples]).toEqual(new Array(320).fill(16_384));
  });
});
