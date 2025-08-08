// 科大訊飛 實時語音轉寫（RTASR）瀏覽器封裝
// 需求：簽名需由服務端提供 /api/xfyun/sign

function createXFYunRTASR(options) {
  const { fetchSign, onText } = options;

  let audioCtx = null;
  let sourceNode = null;
  let processor = null;
  let ws = null;
  let sending = false;

  const sampleRate = 16000;

  async function start() {
    if (ws && ws.readyState === 1) return;
    const { appid, ts, signa } = await fetchSign();
    const url = `wss://rtasr.xfyun.cn/v1/ws?appid=${appid}&ts=${ts}&signa=${encodeURIComponent(signa)}`;
    ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      sending = true;
    };
    ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        if (data?.data) {
          const result = JSON.parse(data.data);
          // 解析簡化：取出所有 w 的串接
          const text = (result?.cn?.st?.rt || [])
            .map((seg) => (seg?.ws || []).map((w) => w.cw?.[0]?.w || '').join(''))
            .join('');
          if (text) {
            onText && onText({
              userId: window.realtimeClient?.currentUserId,
              username: window.realtimeClient?.currentUsername,
              text,
              final: result?.cn?.st?.type === 0 || result?.ls === true,
              ts: Date.now(),
            });
          }
        }
      } catch (e) {}
    };
    ws.onerror = () => {};
    ws.onclose = () => {
      sending = false;
    };
  }

  async function stop() {
    sending = false;
    if (processor) {
      processor.disconnect();
      processor.onaudioprocess = null;
      processor = null;
    }
    if (sourceNode) {
      sourceNode.disconnect();
      sourceNode = null;
    }
    if (audioCtx) {
      try { await audioCtx.close(); } catch {}
      audioCtx = null;
    }
    if (ws) {
      try { ws.close(); } catch {}
      ws = null;
    }
  }

  function floatTo16BitPCM(float32Array) {
    const len = float32Array.length;
    const buffer = new ArrayBuffer(len * 2);
    const view = new DataView(buffer);
    let offset = 0;
    for (let i = 0; i < len; i++, offset += 2) {
      let s = Math.max(-1, Math.min(1, float32Array[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buffer;
  }

  function downsampleBuffer(buffer, inputSampleRate, outputSampleRate) {
    if (outputSampleRate === inputSampleRate) {
      return buffer;
    }
    const sampleRateRatio = inputSampleRate / outputSampleRate;
    const newLength = Math.round(buffer.length / sampleRateRatio);
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;
    while (offsetResult < result.length) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
      let accum = 0, count = 0;
      for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
        accum += buffer[i];
        count++;
      }
      result[offsetResult] = accum / count;
      offsetResult++;
      offsetBuffer = nextOffsetBuffer;
    }
    return result;
  }

  function attachMediaStream(stream) {
    if (!ws || ws.readyState !== 1) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    sourceNode = audioCtx.createMediaStreamSource(stream);
    processor = audioCtx.createScriptProcessor(4096, 1, 1);
    sourceNode.connect(processor);
    processor.connect(audioCtx.destination);
    processor.onaudioprocess = (e) => {
      if (!sending || !ws || ws.readyState !== 1) return;
      const inputData = e.inputBuffer.getChannelData(0);
      const downsampled = downsampleBuffer(inputData, audioCtx.sampleRate, sampleRate);
      const pcm = floatTo16BitPCM(downsampled);
      ws.send(pcm);
    };
  }

  return {
    start,
    stop,
    attachMediaStream,
  };
}


