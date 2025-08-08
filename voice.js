// 群語音通話與UI控制
(function () {
  const state = {
    roomId: null,
    userId: null,
    username: null,
    localStream: null,
    peers: new Map(), // userId -> RTCPeerConnection
    isVoiceOn: false,
    isTranscribing: false,
    transcriptLines: [],
  };

  const ui = {
    btnToggleVoice: document.getElementById('btnToggleVoice'),
    btnToggleTranscribe: document.getElementById('btnToggleTranscribe'),
    btnDownloadTranscript: document.getElementById('btnDownloadTranscript'),
    transcriptContainer: document.getElementById('transcriptContainer'),
    transcriptContent: document.getElementById('transcriptContent'),
  };

  function updateIdentityFromApp() {
    try {
      // 從全域 app 狀態讀取
      state.roomId = window.currentRoomId || (window.realtimeClient && window.realtimeClient.currentRoomId);
      state.userId = window.currentUserId || (window.realtimeClient && window.realtimeClient.currentUserId);
      state.username = window.currentUsername || (window.realtimeClient && window.realtimeClient.currentUsername);
    } catch {}
  }

  async function getLocalMicStream() {
    if (state.localStream) return state.localStream;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    state.localStream = stream;
    return stream;
  }

  function createPeerConnection(remoteUserId) {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    // 推送本地音頻
    if (state.localStream) {
      state.localStream.getTracks().forEach((track) => pc.addTrack(track, state.localStream));
    }

    // 當收到遠端音軌，播放
    pc.addEventListener('track', (event) => {
      const [remoteStream] = event.streams;
      attachOrUpdateRemoteAudio(remoteUserId, remoteStream);
    });

    pc.addEventListener('icecandidate', (event) => {
      if (event.candidate) {
        window.realtimeClient.emitWebRTCSignal('ice', {
          roomId: state.roomId,
          fromUserId: state.userId,
          toUserId: remoteUserId,
          candidate: event.candidate,
        });
      }
    });

    return pc;
  }

  function attachOrUpdateRemoteAudio(userId, stream) {
    let audio = document.querySelector(`audio[data-user="${userId}"]`);
    if (!audio) {
      audio = document.createElement('audio');
      audio.setAttribute('data-user', userId);
      audio.autoplay = true;
      audio.playsInline = true;
      document.body.appendChild(audio);
    }
    audio.srcObject = stream;
  }

  async function callUser(remoteUserId) {
    if (!state.peers.has(remoteUserId)) {
      state.peers.set(remoteUserId, createPeerConnection(remoteUserId));
    }
    const pc = state.peers.get(remoteUserId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    window.realtimeClient.emitWebRTCSignal('offer', {
      roomId: state.roomId,
      fromUserId: state.userId,
      toUserId: remoteUserId,
      sdp: offer,
    });
  }

  async function handleWebRTCSignal(type, data) {
    const { fromUserId } = data;
    if (fromUserId === state.userId) return;
    if (!state.peers.has(fromUserId)) {
      state.peers.set(fromUserId, createPeerConnection(fromUserId));
    }
    const pc = state.peers.get(fromUserId);

    if (type === 'offer') {
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      window.realtimeClient.emitWebRTCSignal('answer', {
        roomId: state.roomId,
        fromUserId: state.userId,
        toUserId: fromUserId,
        sdp: answer,
      });
    } else if (type === 'answer') {
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    } else if (type === 'ice') {
      if (data.candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (e) {}
      }
    }
  }

  function onParticipantsUpdate(participants) {
    // 自動撥號給目前在語音中的所有人
  }

  function renderTranscriptLine({ userId, username, text, final }) {
    const line = document.createElement('div');
    line.style.padding = '4px 0';
    line.innerHTML = `<strong>${username || userId}：</strong> ${text}${final ? '' : ' <span style="opacity:0.6">(…)</span>'}`;
    ui.transcriptContent.appendChild(line);
    ui.transcriptContent.scrollTop = ui.transcriptContent.scrollHeight;
  }

  function renderTranscriptHistory(lines = []) {
    ui.transcriptContent.innerHTML = '';
    lines.forEach((l) => renderTranscriptLine(l));
  }

  // ===== 轉寫：科大訊飛 =====
  let rtasr = null;
  async function ensureRtasr() {
    if (!rtasr) {
      rtasr = createXFYunRTASR({
        fetchSign: async () => {
          const r = await fetch('/api/xfyun/sign');
          return r.json();
        },
        onText: (payload) => {
          // 本地顯示
          renderTranscriptLine(payload);
          // 同步到房間
          window.realtimeClient.emitTranscriptUpdate({
            roomId: state.roomId,
            ...payload,
          });
        },
      });
    }
    return rtasr;
  }

  function onTranscriptUpdateFromRemote(data) {
    // 若未顯示，首次收到也自動打開字幕區
    if (ui.transcriptContainer.style.display === 'none') {
      ui.transcriptContainer.style.display = 'block';
    }
    renderTranscriptLine(data);
  }

  async function startTranscribe() {
    if (!state.isVoiceOn) await startVoice();
    const asr = await ensureRtasr();
    await asr.start();
    const source = state.localStream;
    asr.attachMediaStream(source);
    state.isTranscribing = true;
    ui.btnToggleTranscribe.classList.add('active');
    ui.transcriptContainer.style.display = 'block';
  }

  async function stopTranscribe() {
    if (rtasr) await rtasr.stop();
    state.isTranscribing = false;
    ui.btnToggleTranscribe.classList.remove('active');
  }

  async function startVoice() {
    updateIdentityFromApp();
    if (!state.roomId || !state.userId) return;
    const stream = await getLocalMicStream();
    // 新來的人撥號給當前語音列表（等待從 server 拿列表後進行呼叫）
    window.realtimeClient.emitVoiceJoin(state.roomId, state.userId);
    state.isVoiceOn = true;
    ui.btnToggleVoice.classList.add('active');
  }

  async function stopVoice() {
    window.realtimeClient.emitVoiceLeave(state.roomId, state.userId);
    for (const [, pc] of state.peers) pc.close();
    state.peers.clear();
    if (state.localStream) {
      state.localStream.getTracks().forEach((t) => t.stop());
      state.localStream = null;
    }
    state.isVoiceOn = false;
    ui.btnToggleVoice.classList.remove('active');
  }

  function onVoiceParticipants({ roomId, userIds }) {
    if (roomId !== state.roomId) return;
    // 與列表中的其他人建立/保持連線
    userIds.filter((id) => id !== state.userId).forEach((id) => callUser(id));
    // 清理不在列表中的連線
    for (const [peerId, pc] of state.peers) {
      if (!userIds.includes(peerId)) {
        pc.close();
        state.peers.delete(peerId);
      }
    }
  }

  // 綁定前端UI
  ui.btnToggleVoice?.addEventListener('click', async () => {
    if (state.isVoiceOn) await stopVoice();
    else await startVoice();
  });

  ui.btnToggleTranscribe?.addEventListener('click', async () => {
    if (state.isTranscribing) await stopTranscribe();
    else await startTranscribe();
  });

  // 下載字幕
  function downloadTranscript() {
    const text = Array.from(ui.transcriptContent.children)
      .map((el) => el.textContent)
      .join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const room = state.roomId || 'room';
    a.download = `${room}-transcript.txt`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 0);
  }

  ui.btnDownloadTranscript?.addEventListener('click', () => {
    if (state.roomId) {
      // 直接使用後端端點，確保抓到完整歷史
      const a = document.createElement('a');
      a.href = `/api/rooms/${state.roomId}/transcript.txt`;
      a.download = `${state.roomId}-transcript.txt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } else {
      downloadTranscript();
    }
  });

  // 與實時通訊層銜接
  // 將 setEventHandlers 包一層，確保任何後續註冊都會保留語音/字幕處理
  if (window.realtimeClient && !window.realtimeClient._voicePatched) {
    const client = window.realtimeClient;
    const original = client.setEventHandlers.bind(client);
    client.setEventHandlers = function (handlers) {
      // 先讓外部註冊
      original(handlers);
      // 取得當前 onRoomData，包裝一次
      const prevOnRoomData = this._handlers.onRoomData;
      original({
        onWebRTCSignal: handleWebRTCSignal,
        onVoiceParticipants,
        onTranscriptUpdate: onTranscriptUpdateFromRemote,
        onRoomData: (data) => {
          if (data?.transcript && data.transcript.length) {
            ui.transcriptContainer.style.display = 'block';
            renderTranscriptHistory(data.transcript);
          }
          prevOnRoomData && prevOnRoomData(data);
        },
      });
    };
    client._voicePatched = true;
  }
})();


