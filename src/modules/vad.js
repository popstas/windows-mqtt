// Voice activity detection (VAD) using silero-vad 
const portAudio = require('naudiodon2');
const sherpa_onnx = require('sherpa-onnx-node');

module.exports = async (mqtt, config, log) => {

  let modulePaused = false; // optional
  const modelPath = './data/silero_vad.onnx';
  if (!require('fs').existsSync(modelPath)) {
    log(`Please download silero_vad.onnx from https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx to data/silero_vad.onnx`);
    return;
  }

  const vad = createVad();
  let ai = createAudioInput();

  function createVad() {
    // please download silero_vad.onnx from
    // https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx
    const vadConfig = {
      sileroVad: {
        model: modelPath,
        threshold: config.threshold || 0.2, //0.5,
        minSpeechDuration: config.minSpeechDuration || 0.05, //0.25,
        minSilenceDuration: config.minSilenceDuration || 1, //0.5,
        windowSize: config.windowSize || 256, //512,
      },
      sampleRate: config.sampleRate || 16000,
      debug: config.debug || true,
      numThreads: config.numThreads || 1,
    };

    const bufferSizeInSeconds = 60;

    return new sherpa_onnx.Vad(vadConfig, bufferSizeInSeconds);
  }

  function createAudioInput() {
    const bufferSizeInSeconds = 30;
    const buffer = new sherpa_onnx.CircularBuffer(bufferSizeInSeconds * vad.config.sampleRate);

    const ai = new portAudio.AudioIO({
      inOptions: {
        channelCount: 1,
        closeOnError: false,  // Close the stream if an audio error is detected, if
        // set false then just log the error
        deviceId: -1,  // Use -1 or omit the deviceId to select the default device
        sampleFormat: portAudio.SampleFormatFloat32,
        sampleRate: vad.config.sampleRate,
      }
    });

    let printed = false;
    let index = 0;
    ai.on('data', data => {
      const windowSize = vad.config.sileroVad.windowSize;
      buffer.push(new Float32Array(data.buffer));
      while (buffer.size() > windowSize) {
        const samples = buffer.get(buffer.head(), windowSize);
        buffer.pop(windowSize);
        vad.acceptWaveform(samples)
        if (vad.isDetected() && !printed) {
          log(`${index}: Detected speech`)
          mqtt.publish(config.base + '/speech', '1');
          printed = true;
        }

        if (!vad.isDetected()) {
          printed = false;
        }

        while (!vad.isEmpty()) {
          const segment = vad.front();
          vad.pop();
          const filename = `${index}-${new Date()
              .toLocaleTimeString('en-US', { hour12: false })
              .split(' ')[0]}.wav`;
          // sherpa_onnx.writeWave(
          //     filename,
          //     {samples: segment.samples, sampleRate: vad.config.sampleRate});
          const duration = segment.samples.length / vad.config.sampleRate;
          log(`${index} End of speech. Duration: ${duration} seconds`);
          mqtt.publish(config.base + '/speech', '0');
          // log(`Saved to ${filename}`);
          index += 1;
        }
      }
    });

    ai.on('close', () => {
      log('Free resources');
    });
  
    ai.start();
    return ai;
  }


  function onStop() {
    log('vad: stop mic listening')
    ai.quit();
  }
  function onStart() {
    log('vad: start mic listening')
    ai = createAudioInput();
  }

  return {
    subscriptions: [
      {
        topics: [
          config.base + '/start',
        ],
        handler: onStart
      },
      {
        topics: [
          config.base + '/stop',
        ],
        handler: onStop
      },
    ],
    onStop,
    onStart,
  }
}
