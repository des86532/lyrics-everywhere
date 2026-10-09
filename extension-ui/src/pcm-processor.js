class PcmProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channels = inputs[0];
    if (!channels || channels.length === 0 || channels[0].length === 0) return true;
    const mono = new Float32Array(channels[0].length);
    if (channels.length === 1) {
      mono.set(channels[0]);
    } else {
      for (let channel = 0; channel < channels.length; channel += 1) {
        const source = channels[channel];
        for (let sample = 0; sample < mono.length; sample += 1) mono[sample] += source[sample] / channels.length;
      }
    }
    this.port.postMessage(mono, [mono.buffer]);
    return true;
  }
}
registerProcessor("pcm-processor", PcmProcessor);
