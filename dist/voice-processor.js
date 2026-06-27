class VoiceProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = [];
    this.recording = false;
    this.totalSamples = 0;
    this.port.onmessage = (event) => {
      if (event.data.type === 'start') {
        this.buffer = [];
        this.recording = true;
        this.totalSamples = 0;
        this.port.postMessage({ type: 'debug', msg: 'started' });
      } else if (event.data.type === 'stop') {
        this.recording = false;
        this.port.postMessage({ type: 'debug', msg: 'stopped', totalSamples: this.totalSamples });
        if (this.totalSamples === 0) {
          this.port.postMessage({ type: 'data', samples: new Float32Array(0) });
          return;
        }
        const total = this.buffer.reduce((s, a) => s + a.length, 0);
        const merged = new Float32Array(total);
        let off = 0;
        for (const chunk of this.buffer) {
          merged.set(chunk, off);
          off += chunk.length;
        }
        this.port.postMessage({ type: 'data', samples: merged });
        this.buffer = [];
      }
    };
  }

  process(inputs) {
    if (this.recording && inputs[0] && inputs[0][0]) {
      const input = inputs[0][0];
      if (input.length > 0) {
        this.buffer.push(input.slice());
        this.totalSamples += input.length;
      }
    }
    return true;
  }
}

registerProcessor('voice-processor', VoiceProcessor);
