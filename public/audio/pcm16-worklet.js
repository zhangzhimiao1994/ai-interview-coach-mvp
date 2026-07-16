class Pcm16WorkletProcessor extends AudioWorkletProcessor {
  constructor(options = {}) {
    super();

    const requestedRate = options.processorOptions?.targetSampleRate;
    this.targetSampleRate =
      Number.isFinite(requestedRate) &&
      requestedRate > 0 &&
      requestedRate <= sampleRate
        ? requestedRate
        : 16000;
    this.position = 0;
    this.pending = new Float32Array(0);
    this.outputSamples = [];
    this.chunkSize = Math.max(1, Math.round(this.targetSampleRate * 0.02));
  }

  process(inputs) {
    const input = inputs[0]?.[0];

    if (!input || input.length === 0) {
      return true;
    }

    const combined = new Float32Array(this.pending.length + input.length);
    combined.set(this.pending);
    combined.set(input, this.pending.length);

    const ratio = sampleRate / this.targetSampleRate;
    const output = [];
    let position = this.position;

    while (position + ratio <= combined.length) {
      const start = Math.floor(position);
      const end = Math.min(combined.length, Math.ceil(position + ratio));
      let sum = 0;
      for (let index = start; index < end; index += 1) {
        sum += combined[index] ?? 0;
      }
      output.push(sum / Math.max(1, end - start));
      position += ratio;
    }

    const consumed = Math.min(combined.length, Math.floor(position));
    this.pending = combined.slice(consumed);
    this.position = position - consumed;

    this.outputSamples.push(...output);

    while (this.outputSamples.length >= this.chunkSize) {
      const chunk = this.outputSamples.splice(0, this.chunkSize);
      const pcmBuffer = new ArrayBuffer(chunk.length * 2);
      const view = new DataView(pcmBuffer);

      chunk.forEach((sample, index) => {
        const clamped = Math.max(-1, Math.min(1, sample));
        const value =
          clamped < 0
            ? Math.round(clamped * 0x8000)
            : Math.round(clamped * 0x7fff);
        view.setInt16(index * 2, value, true);
      });

      this.port.postMessage(pcmBuffer, [pcmBuffer]);
    }
    return true;
  }
}

registerProcessor("pcm16-worklet", Pcm16WorkletProcessor);
