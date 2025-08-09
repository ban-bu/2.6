/**
 * 语音通话功能模块 - WebRTC实现
 * 支持多人语音通话、静音控制、音量调节等功能
 */

class VoiceCallManager {
    constructor() {
        this.localStream = null;
        this.peerConnections = new Map(); // userId -> RTCPeerConnection
        this.remoteStreams = new Map(); // userId -> MediaStream
        this.isCallActive = false;
        this.isMuted = false;
        this.isTranscriptionActive = false;
        this.audioContext = null;
        this.audioWorklet = null;
        
        // WebRTC配置
        this.rtcConfig = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' }
            ]
        };
        
        // 音频约束
        this.audioConstraints = {
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 16000 // 科大讯飞推荐的采样率
            },
            video: false
        };
        
        this.initializeEventListeners();
    }
    
    initializeEventListeners() {
        // 监听语音通话相关的Socket事件
        if (typeof socket !== 'undefined') {
            socket.on('voice-call-offer', this.handleOffer.bind(this));
            socket.on('voice-call-answer', this.handleAnswer.bind(this));
            socket.on('voice-call-ice-candidate', this.handleIceCandidate.bind(this));
            socket.on('voice-call-user-joined', this.handleUserJoined.bind(this));
            socket.on('voice-call-user-left', this.handleUserLeft.bind(this));
            socket.on('voice-call-ended', this.handleCallEnded.bind(this));
        }
    }
    
    // 开始语音通话
    async startCall() {
        try {
            console.log('开始语音通话...');
            
            // 获取用户媒体权限
            this.localStream = await navigator.mediaDevices.getUserMedia(this.audioConstraints);
            
            // 初始化音频上下文（用于音量检测和转录）
            await this.initializeAudioContext();
            
            // 通知服务器开始通话
            socket.emit('voice-call-start', {
                roomId: currentRoomId,
                userId: currentUserId,
                username: currentUsername
            });
            
            this.isCallActive = true;
            this.updateUI();
            
            console.log('语音通话已开始');
            
        } catch (error) {
            console.error('开始语音通话失败:', error);
            this.handleCallError(error);
        }
    }
    
    // 结束语音通话
    async endCall() {
        try {
            console.log('结束语音通话...');
            
            // 停止本地媒体流
            if (this.localStream) {
                this.localStream.getTracks().forEach(track => track.stop());
                this.localStream = null;
            }
            
            // 关闭所有peer连接
            this.peerConnections.forEach((pc, userId) => {
                pc.close();
            });
            this.peerConnections.clear();
            this.remoteStreams.clear();
            
            // 清理音频上下文
            if (this.audioContext) {
                await this.audioContext.close();
                this.audioContext = null;
            }
            
            // 通知服务器结束通话
            socket.emit('voice-call-end', {
                roomId: currentRoomId,
                userId: currentUserId
            });
            
            this.isCallActive = false;
            this.updateUI();
            
            console.log('语音通话已结束');
            
        } catch (error) {
            console.error('结束语音通话失败:', error);
        }
    }
    
    // 切换静音状态
    toggleMute() {
        if (!this.localStream) return;
        
        const audioTrack = this.localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            this.isMuted = !audioTrack.enabled;
            
            // 通知其他用户静音状态
            socket.emit('voice-call-mute-status', {
                roomId: currentRoomId,
                userId: currentUserId,
                isMuted: this.isMuted
            });
            
            this.updateUI();
        }
    }
    
    // 创建新的peer连接
    async createPeerConnection(userId) {
        const peerConnection = new RTCPeerConnection(this.rtcConfig);
        
        // 添加本地流
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, this.localStream);
            });
        }
        
        // 处理ICE候选
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('voice-call-ice-candidate', {
                    roomId: currentRoomId,
                    targetUserId: userId,
                    candidate: event.candidate
                });
            }
        };
        
        // 处理远程流
        peerConnection.ontrack = (event) => {
            console.log('收到远程音频流:', userId);
            const remoteStream = event.streams[0];
            this.remoteStreams.set(userId, remoteStream);
            this.playRemoteAudio(userId, remoteStream);
        };
        
        // 连接状态变化
        peerConnection.onconnectionstatechange = () => {
            console.log(`与用户 ${userId} 的连接状态:`, peerConnection.connectionState);
            if (peerConnection.connectionState === 'failed') {
                this.handleConnectionFailure(userId);
            }
        };
        
        this.peerConnections.set(userId, peerConnection);
        return peerConnection;
    }
    
    // 处理接收到的offer
    async handleOffer(data) {
        try {
            const { fromUserId, offer } = data;
            console.log('收到来自用户的offer:', fromUserId);
            
            const peerConnection = await this.createPeerConnection(fromUserId);
            await peerConnection.setRemoteDescription(offer);
            
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            
            socket.emit('voice-call-answer', {
                roomId: currentRoomId,
                targetUserId: fromUserId,
                answer: answer
            });
            
        } catch (error) {
            console.error('处理offer失败:', error);
        }
    }
    
    // 处理接收到的answer
    async handleAnswer(data) {
        try {
            const { fromUserId, answer } = data;
            console.log('收到来自用户的answer:', fromUserId);
            
            const peerConnection = this.peerConnections.get(fromUserId);
            if (peerConnection) {
                await peerConnection.setRemoteDescription(answer);
            }
            
        } catch (error) {
            console.error('处理answer失败:', error);
        }
    }
    
    // 处理ICE候选
    async handleIceCandidate(data) {
        try {
            const { fromUserId, candidate } = data;
            const peerConnection = this.peerConnections.get(fromUserId);
            
            if (peerConnection) {
                await peerConnection.addIceCandidate(candidate);
            }
            
        } catch (error) {
            console.error('处理ICE候选失败:', error);
        }
    }
    
    // 处理用户加入通话
    async handleUserJoined(data) {
        try {
            const { userId, username } = data;
            console.log('用户加入语音通话:', username, userId);
            
            if (userId === currentUserId) return; // 忽略自己
            
            // 创建offer并发送给新用户
            const peerConnection = await this.createPeerConnection(userId);
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            
            socket.emit('voice-call-offer', {
                roomId: currentRoomId,
                targetUserId: userId,
                offer: offer
            });
            
            this.updateCallStatus();
            
        } catch (error) {
            console.error('处理用户加入失败:', error);
        }
    }
    
    // 处理用户离开通话
    handleUserLeft(data) {
        const { userId } = data;
        console.log('用户离开语音通话:', userId);
        
        // 关闭peer连接
        const peerConnection = this.peerConnections.get(userId);
        if (peerConnection) {
            peerConnection.close();
            this.peerConnections.delete(userId);
        }
        
        // 移除远程流
        this.remoteStreams.delete(userId);
        
        // 移除音频元素
        const audioElement = document.getElementById(`remoteAudio_${userId}`);
        if (audioElement) {
            audioElement.remove();
        }
        
        this.updateCallStatus();
    }
    
    // 处理通话结束
    handleCallEnded() {
        console.log('语音通话已被结束');
        this.endCall();
    }
    
    // 播放远程音频
    playRemoteAudio(userId, stream) {
        // 移除已存在的音频元素
        const existingAudio = document.getElementById(`remoteAudio_${userId}`);
        if (existingAudio) {
            existingAudio.remove();
        }
        
        // 创建新的音频元素
        const audioElement = document.createElement('audio');
        audioElement.id = `remoteAudio_${userId}`;
        audioElement.srcObject = stream;
        audioElement.autoplay = true;
        audioElement.style.display = 'none';
        
        document.body.appendChild(audioElement);
        
        // 监听音频级别（用于UI显示）
        this.monitorAudioLevel(userId, stream);
    }
    
    // 监听音频级别
    monitorAudioLevel(userId, stream) {
        if (!this.audioContext) return;
        
        try {
            const source = this.audioContext.createMediaStreamSource(stream);
            const analyser = this.audioContext.createAnalyser();
            analyser.fftSize = 256;
            
            source.connect(analyser);
            
            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            
            const updateLevel = () => {
                if (!this.isCallActive) return;
                
                analyser.getByteFrequencyData(dataArray);
                const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
                const level = (average / 255) * 100;
                
                this.updateAudioLevelDisplay(userId, level);
                requestAnimationFrame(updateLevel);
            };
            
            updateLevel();
            
        } catch (error) {
            console.error('监听音频级别失败:', error);
        }
    }
    
    // 更新音频级别显示
    updateAudioLevelDisplay(userId, level) {
        const levelElement = document.querySelector(`[data-user-id="${userId}"] .audio-level-fill`);
        if (levelElement) {
            levelElement.style.width = `${level}%`;
        }
    }
    
    // 初始化音频上下文
    async initializeAudioContext() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 16000
            });
            
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }
            
        } catch (error) {
            console.error('初始化音频上下文失败:', error);
        }
    }
    
    // 获取音频数据用于转录
    getAudioDataForTranscription() {
        if (!this.localStream || !this.audioContext) return null;
        
        try {
            const source = this.audioContext.createMediaStreamSource(this.localStream);
            const processor = this.audioContext.createScriptProcessor(1024, 1, 1);
            
            source.connect(processor);
            processor.connect(this.audioContext.destination);
            
            return processor;
            
        } catch (error) {
            console.error('获取音频数据失败:', error);
            return null;
        }
    }
    
    // 处理通话错误
    handleCallError(error) {
        let errorMessage = '语音通话出现错误';
        
        if (error.name === 'NotAllowedError') {
            errorMessage = '请允许使用麦克风权限';
        } else if (error.name === 'NotFoundError') {
            errorMessage = '未找到可用的麦克风设备';
        } else if (error.name === 'NotReadableError') {
            errorMessage = '麦克风设备正在被其他应用使用';
        }
        
        console.error('语音通话错误:', error);
        alert(errorMessage);
        
        this.endCall();
    }
    
    // 处理连接失败
    handleConnectionFailure(userId) {
        console.log('与用户连接失败，尝试重新连接:', userId);
        
        // 重新创建连接
        setTimeout(() => {
            if (this.isCallActive) {
                this.handleUserJoined({ userId, username: 'Unknown' });
            }
        }, 3000);
    }
    
    // 更新UI状态
    updateUI() {
        const voiceCallBtn = document.getElementById('voiceCallBtn');
        const voiceCallText = document.getElementById('voiceCallText');
        const voiceControls = document.getElementById('voiceControls');
        const muteBtn = document.getElementById('muteBtn');
        
        if (this.isCallActive) {
            voiceCallBtn.classList.add('active');
            voiceCallText.textContent = '结束通话';
            voiceControls.style.display = 'flex';
            
            muteBtn.classList.toggle('muted', this.isMuted);
            muteBtn.querySelector('i').className = this.isMuted ? 'fas fa-microphone-slash' : 'fas fa-microphone';
            
        } else {
            voiceCallBtn.classList.remove('active');
            voiceCallText.textContent = '语音通话';
            voiceControls.style.display = 'none';
        }
        
        this.updateCallStatus();
    }
    
    // 更新通话状态显示
    updateCallStatus() {
        const participantCount = this.peerConnections.size + (this.isCallActive ? 1 : 0);
        
        // 这里可以添加更详细的状态显示逻辑
        console.log(`当前通话参与者数量: ${participantCount}`);
    }
    
    // 设置音量
    setVolume(volume) {
        this.remoteStreams.forEach((stream, userId) => {
            const audioElement = document.getElementById(`remoteAudio_${userId}`);
            if (audioElement) {
                audioElement.volume = volume / 100;
            }
        });
    }
}

// 语音转录管理器
class VoiceTranscriptionManager {
    constructor(voiceCallManager) {
        this.voiceCallManager = voiceCallManager;
        this.isActive = false;
        this.websocket = null;
        this.audioBuffer = [];
        this.isConnecting = false;
        
        // 科大讯飞配置
        this.xfyunConfig = {
            appId: '84959f16',
            apiKey: '065eee5163baa4692717b923323e6853',
            url: 'wss://rtasr.xfyun.cn/v1/ws',
            language: 'zh_cn',
            format: 'audio/L16;rate=16000'
        };
    }
    
    // 开始转录
    async startTranscription() {
        if (this.isActive || this.isConnecting) return;
        
        try {
            this.isConnecting = true;
            console.log('开始语音转录...');
            
            await this.connectToXfyun();
            this.setupAudioCapture();
            
            this.isActive = true;
            this.isConnecting = false;
            this.updateTranscriptionUI();
            
        } catch (error) {
            console.error('开始转录失败:', error);
            this.isConnecting = false;
            alert('启动语音转录失败，请检查网络连接');
        }
    }
    
    // 停止转录
    stopTranscription() {
        if (!this.isActive) return;
        
        console.log('停止语音转录...');
        
        if (this.websocket) {
            this.websocket.close();
            this.websocket = null;
        }
        
        this.isActive = false;
        this.updateTranscriptionUI();
    }
    
    // 连接到科大讯飞WebSocket
    async connectToXfyun() {
        return new Promise((resolve, reject) => {
            try {
                // 生成认证参数
                const authParams = this.generateAuthParams();
                const wsUrl = `${this.xfyunConfig.url}?${authParams}`;
                
                this.websocket = new WebSocket(wsUrl);
                
                this.websocket.onopen = () => {
                    console.log('科大讯飞WebSocket连接成功');
                    resolve();
                };
                
                this.websocket.onmessage = (event) => {
                    this.handleTranscriptionResult(JSON.parse(event.data));
                };
                
                this.websocket.onerror = (error) => {
                    console.error('科大讯飞WebSocket错误:', error);
                    reject(error);
                };
                
                this.websocket.onclose = () => {
                    console.log('科大讯飞WebSocket连接关闭');
                    this.isActive = false;
                    this.updateTranscriptionUI();
                };
                
            } catch (error) {
                reject(error);
            }
        });
    }
    
    // 生成认证参数
    generateAuthParams() {
        const ts = Math.floor(Date.now() / 1000);
        const signa = this.generateSignature(ts);
        
        return new URLSearchParams({
            appid: this.xfyunConfig.appId,
            ts: ts.toString(),
            signa: signa,
            lang: this.xfyunConfig.language,
            format: this.xfyunConfig.format,
            sample_rate: '16000',
            channels: '1',
            bit: '16',
            speex_size: '60',
            result_type: 'full'
        }).toString();
    }
    
    // 生成签名（简化版，实际项目中应该在后端生成）
    generateSignature(ts) {
        // 注意：在生产环境中，签名应该在后端生成以保护API密钥
        // 这里为了演示目的直接在前端生成
        const baseString = this.xfyunConfig.appId + ts;
        return btoa(baseString); // 简化的签名，实际应使用HMAC-SHA1
    }
    
    // 设置音频捕获
    setupAudioCapture() {
        if (!this.voiceCallManager.localStream || !this.voiceCallManager.audioContext) {
            console.error('音频流或音频上下文未准备好');
            return;
        }
        
        try {
            const source = this.voiceCallManager.audioContext.createMediaStreamSource(
                this.voiceCallManager.localStream
            );
            
            const processor = this.voiceCallManager.audioContext.createScriptProcessor(1024, 1, 1);
            
            processor.onaudioprocess = (event) => {
                if (this.isActive && this.websocket && this.websocket.readyState === WebSocket.OPEN) {
                    const inputData = event.inputBuffer.getChannelData(0);
                    const pcmData = this.convertToPCM16(inputData);
                    this.sendAudioData(pcmData);
                }
            };
            
            source.connect(processor);
            processor.connect(this.voiceCallManager.audioContext.destination);
            
        } catch (error) {
            console.error('设置音频捕获失败:', error);
        }
    }
    
    // 转换音频数据为PCM16格式
    convertToPCM16(floatSamples) {
        const buffer = new ArrayBuffer(floatSamples.length * 2);
        const view = new DataView(buffer);
        
        for (let i = 0; i < floatSamples.length; i++) {
            const sample = Math.max(-1, Math.min(1, floatSamples[i]));
            view.setInt16(i * 2, sample * 0x7FFF, true);
        }
        
        return buffer;
    }
    
    // 发送音频数据
    sendAudioData(audioData) {
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            this.websocket.send(audioData);
        }
    }
    
    // 处理转录结果
    handleTranscriptionResult(data) {
        try {
            if (data.action === 'result') {
                const text = data.data?.result?.ws?.map(w => 
                    w.cw?.map(c => c.w).join('') || ''
                ).join('') || '';
                
                if (text.trim()) {
                    this.displayTranscription(text, data.data?.result?.pgs === 'rpl');
                }
            }
        } catch (error) {
            console.error('处理转录结果失败:', error);
        }
    }
    
    // 显示转录结果
    displayTranscription(text, isReplace = false) {
        const transcriptionContent = document.getElementById('transcriptionContent');
        const placeholder = transcriptionContent.querySelector('.transcription-placeholder');
        
        // 移除占位符
        if (placeholder) {
            placeholder.remove();
        }
        
        // 创建或更新转录项
        let transcriptionItem;
        
        if (isReplace) {
            // 替换最后一条转录
            transcriptionItem = transcriptionContent.lastElementChild;
            if (transcriptionItem && transcriptionItem.classList.contains('transcription-item')) {
                transcriptionItem.querySelector('.transcription-text').textContent = text;
            } else {
                transcriptionItem = this.createTranscriptionItem(text);
                transcriptionContent.appendChild(transcriptionItem);
            }
        } else {
            // 添加新的转录项
            transcriptionItem = this.createTranscriptionItem(text);
            transcriptionContent.appendChild(transcriptionItem);
        }
        
        // 滚动到底部
        transcriptionContent.scrollTop = transcriptionContent.scrollHeight;
        
        // 通过Socket发送转录结果给其他用户
        if (typeof socket !== 'undefined') {
            socket.emit('voice-transcription', {
                roomId: currentRoomId,
                userId: currentUserId,
                username: currentUsername,
                text: text,
                timestamp: new Date().toISOString(),
                isReplace: isReplace
            });
        }
    }
    
    // 创建转录项元素
    createTranscriptionItem(text) {
        const item = document.createElement('div');
        item.className = 'transcription-item';
        
        const time = new Date().toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        
        item.innerHTML = `
            <div class="transcription-speaker">${currentUsername || '我'}</div>
            <div class="transcription-text">${text}</div>
            <div class="transcription-time">${time}</div>
        `;
        
        return item;
    }
    
    // 更新转录UI
    updateTranscriptionUI() {
        const transcriptionBtn = document.getElementById('transcriptionBtn');
        const transcriptionPanel = document.getElementById('transcriptionPanel');
        
        if (this.isActive) {
            transcriptionBtn.classList.add('active');
            transcriptionPanel.style.display = 'block';
        } else {
            transcriptionBtn.classList.remove('active');
        }
    }
    
    // 清空转录
    clearTranscription() {
        const transcriptionContent = document.getElementById('transcriptionContent');
        transcriptionContent.innerHTML = `
            <div class="transcription-placeholder">
                <i class="fas fa-microphone-alt"></i>
                <p>开始语音通话后将显示实时转录...</p>
            </div>
        `;
    }
    
    // 导出转录
    exportTranscription() {
        const items = document.querySelectorAll('.transcription-item');
        let content = `语音转录记录 - ${new Date().toLocaleString()}\n\n`;
        
        items.forEach(item => {
            const speaker = item.querySelector('.transcription-speaker').textContent;
            const text = item.querySelector('.transcription-text').textContent;
            const time = item.querySelector('.transcription-time').textContent;
            content += `[${time}] ${speaker}: ${text}\n`;
        });
        
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `语音转录_${new Date().toISOString().slice(0, 10)}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}

// 全局实例
let voiceCallManager;
let voiceTranscriptionManager;

// 初始化语音功能
function initializeVoiceFeatures() {
    voiceCallManager = new VoiceCallManager();
    voiceTranscriptionManager = new VoiceTranscriptionManager(voiceCallManager);
    
    console.log('语音功能已初始化');
}

// UI控制函数
function toggleVoiceCall() {
    if (!voiceCallManager) {
        console.error('语音通话管理器未初始化');
        return;
    }
    
    if (voiceCallManager.isCallActive) {
        voiceCallManager.endCall();
    } else {
        voiceCallManager.startCall();
    }
}

function toggleMute() {
    if (voiceCallManager) {
        voiceCallManager.toggleMute();
    }
}

function toggleSpeaker() {
    // 切换扬声器状态的逻辑
    const speakerBtn = document.getElementById('speakerBtn');
    speakerBtn.classList.toggle('muted');
    
    const icon = speakerBtn.querySelector('i');
    if (speakerBtn.classList.contains('muted')) {
        icon.className = 'fas fa-volume-mute';
    } else {
        icon.className = 'fas fa-volume-up';
    }
}

function toggleTranscription() {
    if (!voiceTranscriptionManager) {
        console.error('语音转录管理器未初始化');
        return;
    }
    
    if (voiceTranscriptionManager.isActive) {
        voiceTranscriptionManager.stopTranscription();
    } else {
        voiceTranscriptionManager.startTranscription();
    }
}

function hideTranscription() {
    const transcriptionPanel = document.getElementById('transcriptionPanel');
    transcriptionPanel.style.display = 'none';
}

function clearTranscription() {
    if (voiceTranscriptionManager) {
        voiceTranscriptionManager.clearTranscription();
    }
}

function exportTranscription() {
    if (voiceTranscriptionManager) {
        voiceTranscriptionManager.exportTranscription();
    }
}

// 音量控制
document.addEventListener('DOMContentLoaded', function() {
    const volumeSlider = document.getElementById('volumeSlider');
    if (volumeSlider) {
        volumeSlider.addEventListener('input', function() {
            if (voiceCallManager) {
                voiceCallManager.setVolume(this.value);
            }
        });
    }
});

// 监听来自其他用户的转录消息
if (typeof socket !== 'undefined') {
    socket.on('voice-transcription', function(data) {
        const { userId, username, text, timestamp, isReplace } = data;
        
        // 如果是自己发送的，忽略
        if (userId === currentUserId) return;
        
        // 显示其他用户的转录
        displayRemoteTranscription(username, text, timestamp, isReplace);
    });
}

// 显示远程用户的转录
function displayRemoteTranscription(username, text, timestamp, isReplace = false) {
    const transcriptionContent = document.getElementById('transcriptionContent');
    const placeholder = transcriptionContent.querySelector('.transcription-placeholder');
    
    // 移除占位符
    if (placeholder) {
        placeholder.remove();
    }
    
    // 创建转录项
    const item = document.createElement('div');
    item.className = 'transcription-item';
    item.style.borderLeftColor = '#28a745'; // 区分远程用户的颜色
    
    const time = new Date(timestamp).toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    
    item.innerHTML = `
        <div class="transcription-speaker">${username}</div>
        <div class="transcription-text">${text}</div>
        <div class="transcription-time">${time}</div>
    `;
    
    transcriptionContent.appendChild(item);
    
    // 滚动到底部
    transcriptionContent.scrollTop = transcriptionContent.scrollHeight;
    
    // 显示转录面板（如果尚未显示）
    const transcriptionPanel = document.getElementById('transcriptionPanel');
    if (transcriptionPanel.style.display === 'none') {
        transcriptionPanel.style.display = 'block';
    }
}

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', function() {
    // 延迟初始化，确保其他依赖已加载
    setTimeout(initializeVoiceFeatures, 1000);
});
