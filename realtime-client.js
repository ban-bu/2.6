// 实时通信客户端模块
// 这个文件用于集成到现有的 app.js 中，实现WebSocket实时通信功能

class RealtimeClient {
    constructor() {
        this.socket = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        this.serverUrl = this.getServerUrl();
        this.currentRoomId = null;
        this.currentUserId = null;
        this.currentUsername = null;
        
        // 事件回调
        this.onMessageReceived = null;
        this.onParticipantsUpdate = null;
        this.onUserJoined = null;
        this.onUserLeft = null;
        this.onConnectionChange = null;
        this.onError = null;
        this.onRoomData = null;
        this.onUserTyping = null;
        // 语音/转写
        this.onVoiceUsers = null;
        this.onVoiceUserJoined = null;
        this.onVoiceUserLeft = null;
        this.onWebrtcOffer = null;
        this.onWebrtcAnswer = null;
        this.onWebrtcIceCandidate = null;
        this.onTranscript = null;
        
        // 检测运行环境
        this.isHuggingFace = window.location.hostname.includes('huggingface.co');
        this.isRailway = window.location.hostname.includes('railway.app') || window.location.hostname.includes('up.railway.app');
        
        this.init();
    }
    
    getServerUrl() {
        // 根据部署环境自动检测服务器地址
        const hostname = window.location.hostname;
        const protocol = window.location.protocol;
        const port = window.location.port;
        
        if (hostname === 'localhost' || hostname === '127.0.0.1') {
            // 本地开发环境
            if (port === '8080' || port === '3000') {
                // 如果前端运行在8080或3000端口，后端运行在3001
                return 'http://localhost:3001';
            } else {
                // 如果是统一部署，使用当前域名
                return `${protocol}//${hostname}${port ? ':' + port : ''}`;
            }
        } else if (hostname.includes('railway.app') || hostname.includes('up.railway.app')) {
            // Railway环境 - 使用当前域名，因为前后端部署在同一个服务
            return `${protocol}//${hostname}`;
        } else if (hostname.includes('huggingface.co')) {
            // Hugging Face环境 - 需要用户配置或使用公共服务器
            return localStorage.getItem('vibe_server_url') || 'wss://your-deployed-server.com';
        } else {
            // 其他生产环境
            // 首先尝试使用当前域名（适用于统一部署）
            const currentOrigin = `${protocol}//${hostname}${port ? ':' + port : ''}`;
            return localStorage.getItem('vibe_server_url') || currentOrigin;
        }
    }
    
    init() {
        if (this.isHuggingFace) {
            // 在Hugging Face环境中显示服务器配置提示
            this.showServerConfigModal();
        } else if (this.isRailway) {
            // Railway环境直接连接
            console.log('检测到Railway环境，使用统一部署模式');
            this.connect();
        } else {
            this.connect();
        }
    }
    
    showServerConfigModal() {
        const savedUrl = localStorage.getItem('vibe_server_url');
        if (savedUrl) {
            this.serverUrl = savedUrl;
            this.connect();
            return;
        }
        
        // 显示服务器配置模态框
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.style.display = 'block';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>配置实时服务器</h3>
                </div>
                <div class="modal-body">
                    <p>为了实现多端实时聊天，请配置您的WebSocket服务器地址：</p>
                    <div class="input-group">
                        <label for="serverUrlInput">服务器地址</label>
                        <input 
                            type="url" 
                            id="serverUrlInput" 
                            placeholder="wss://your-server.com 或 ws://localhost:3001"
                            value=""
                        />
                        <small>可以使用Railway、Vercel、Heroku等平台部署后端服务</small>
                    </div>
                    <div class="server-options">
                        <button class="btn-secondary" onclick="window.realtimeClient.useLocalMode()">
                            暂时使用本地模式
                        </button>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn-primary" onclick="window.realtimeClient.saveServerConfig()">
                        连接服务器
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
    }
    
    saveServerConfig() {
        const input = document.getElementById('serverUrlInput');
        const url = input.value.trim();
        
        if (!url) {
            alert('请输入服务器地址');
            return;
        }
        
        // 验证URL格式
        try {
            new URL(url);
        } catch {
            alert('服务器地址格式不正确');
            return;
        }
        
        localStorage.setItem('vibe_server_url', url);
        this.serverUrl = url;
        
        // 关闭模态框
        const modal = document.querySelector('.modal');
        modal.remove();
        
        // 连接服务器
        this.connect();
    }
    
    useLocalMode() {
        // 关闭模态框，继续使用本地存储模式
        const modal = document.querySelector('.modal');
        modal.remove();
        
        showToast('已切换到本地模式，无法实现多端实时同步', 'warning');
        
        // 设置标记，表示使用本地模式
        this.localMode = true;
        
        if (this.onConnectionChange) {
            this.onConnectionChange(false);
        }
    }
    
    connect() {
        if (this.localMode) return;
        
        try {
            // 尝试加载Socket.IO客户端
            if (typeof io === 'undefined') {
                this.loadSocketIOClient(() => this.establishConnection());
            } else {
                this.establishConnection();
            }
        } catch (error) {
            console.error('连接失败:', error);
            this.handleConnectionError(error);
        }
    }
    
    loadSocketIOClient(callback) {
        const script = document.createElement('script');
        script.src = 'https://cdn.socket.io/4.7.4/socket.io.min.js';
        script.onload = callback;
        script.onerror = () => {
            console.error('无法加载Socket.IO客户端');
            this.handleConnectionError(new Error('无法加载Socket.IO客户端'));
        };
        document.head.appendChild(script);
    }
    
    establishConnection() {
        this.socket = io(this.serverUrl, {
            transports: ['websocket', 'polling'],
            timeout: 10000,
            reconnection: true,
            reconnectionAttempts: this.maxReconnectAttempts,
            reconnectionDelay: this.reconnectDelay
        });
        
        this.setupSocketEvents();
    }
    
    setupSocketEvents() {
        this.socket.on('connect', () => {
            console.log('WebSocket连接成功');
            this.isConnected = true;
            this.reconnectAttempts = 0;
            
            if (this.onConnectionChange) {
                this.onConnectionChange(true);
            }
            
            showToast('实时连接已建立', 'success');
            
            // 如果已经有房间信息，重新加入
            if (this.currentRoomId && this.currentUserId && this.currentUsername) {
                this.joinRoom(this.currentRoomId, this.currentUserId, this.currentUsername);
            }
        });
        
        this.socket.on('disconnect', () => {
            console.log('WebSocket连接断开');
            this.isConnected = false;
            
            if (this.onConnectionChange) {
                this.onConnectionChange(false);
            }
            
            showToast('实时连接已断开，尝试重连中...', 'warning');
        });
        
        this.socket.on('connect_error', (error) => {
            console.error('连接错误:', error);
            this.handleConnectionError(error);
        });
        
        this.socket.on('reconnect', (attemptNumber) => {
            console.log(`重连成功，尝试次数: ${attemptNumber}`);
            showToast('连接已恢复', 'success');
        });
        
        this.socket.on('reconnect_error', (error) => {
            console.error('重连失败:', error);
            this.reconnectAttempts++;
            
            if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                showToast('连接失败，已切换到本地模式', 'error');
                this.localMode = true;
            }
        });
        
        // 业务事件
        this.socket.on('roomData', (data) => {
            if (this.onRoomData) {
                this.onRoomData(data);
            }
        });
        
        this.socket.on('newMessage', (message) => {
            if (this.onMessageReceived) {
                this.onMessageReceived(message);
            }
        });
        
        this.socket.on('participantsUpdate', (participants) => {
            if (this.onParticipantsUpdate) {
                this.onParticipantsUpdate(participants);
            }
        });
        
        this.socket.on('userJoined', (user) => {
            if (this.onUserJoined) {
                this.onUserJoined(user);
            }
        });
        
        this.socket.on('userLeft', (data) => {
            if (this.onUserLeft) {
                this.onUserLeft(data);
            }
        });
        
        this.socket.on('userTyping', (data) => {
            if (this.onUserTyping) {
                this.onUserTyping(data);
            }
        });
        
        this.socket.on('error', (error) => {
            console.error('服务器错误:', error);
            if (this.onError) {
                this.onError(error);
            }
            showToast(error.message || '服务器错误', 'error');
        });
        
        // 会议结束事件
        this.socket.on('meetingEnded', (data) => {
            if (this.onMeetingEnded) {
                this.onMeetingEnded(data);
            }
        });
        
        // 会议结束成功事件
        this.socket.on('endMeetingSuccess', (data) => {
            if (this.onEndMeetingSuccess) {
                this.onEndMeetingSuccess(data);
            }
        });

        // ========= 语音 & WebRTC =========
        this.socket.on('voice-users', (users) => this.onVoiceUsers && this.onVoiceUsers(users));
        this.socket.on('voice-user-joined', (data) => this.onVoiceUserJoined && this.onVoiceUserJoined(data));
        this.socket.on('voice-user-left', (data) => this.onVoiceUserLeft && this.onVoiceUserLeft(data));
        this.socket.on('webrtc-offer', (payload) => this.onWebrtcOffer && this.onWebrtcOffer(payload));
        this.socket.on('webrtc-answer', (payload) => this.onWebrtcAnswer && this.onWebrtcAnswer(payload));
        this.socket.on('webrtc-ice-candidate', (payload) => this.onWebrtcIceCandidate && this.onWebrtcIceCandidate(payload));
        this.socket.on('transcript', (payload) => this.onTranscript && this.onTranscript(payload));
    }
    
    handleConnectionError(error) {
        console.error('连接处理错误:', error);
        
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            showToast('无法连接到服务器，已切换到本地模式', 'error');
            this.localMode = true;
            
            if (this.onConnectionChange) {
                this.onConnectionChange(false);
            }
        }
    }
    
    // 公共API方法
    joinRoom(roomId, userId, username) {
        this.currentRoomId = roomId;
        this.currentUserId = userId;
        this.currentUsername = username;
        
        if (this.isConnected && this.socket) {
            this.socket.emit('joinRoom', { roomId, userId, username });
        }
    }
    
    leaveRoom() {
        if (this.isConnected && this.socket && this.currentRoomId && this.currentUserId) {
            this.socket.emit('leaveRoom', { 
                roomId: this.currentRoomId, 
                userId: this.currentUserId 
            });
        }
        
        this.currentRoomId = null;
        this.currentUserId = null;
        this.currentUsername = null;
    }
    
    sendMessage(messageData) {
        if (this.isConnected && this.socket) {
            this.socket.emit('sendMessage', {
                ...messageData,
                roomId: this.currentRoomId
            });
            return true; // 消息通过WebSocket发送
        }
        return false; // 消息需要通过本地存储发送
    }
    
    sendTypingIndicator(isTyping) {
        if (this.isConnected && this.socket && this.currentRoomId) {
            this.socket.emit('typing', {
                roomId: this.currentRoomId,
                userId: this.currentUserId,
                username: this.currentUsername,
                isTyping
            });
        }
    }
    
    // 结束会议（仅创建者可调用）
    endMeeting(roomId, userId) {
        if (this.socket && this.isConnected) {
            this.socket.emit('endMeeting', {
                roomId,
                userId
            });
            return true;
        }
        return false;
    }
    
    // 配置回调函数
    setEventHandlers(handlers) {
        this.onMessageReceived = handlers.onMessageReceived;
        this.onParticipantsUpdate = handlers.onParticipantsUpdate;
        this.onUserJoined = handlers.onUserJoined;
        this.onUserLeft = handlers.onUserLeft;
        this.onConnectionChange = handlers.onConnectionChange;
        this.onError = handlers.onError;
        this.onRoomData = handlers.onRoomData;
        this.onUserTyping = handlers.onUserTyping;
        this.onMeetingEnded = handlers.onMeetingEnded;
        this.onEndMeetingSuccess = handlers.onEndMeetingSuccess;
        // 语音/转写
        this.onVoiceUsers = handlers.onVoiceUsers;
        this.onVoiceUserJoined = handlers.onVoiceUserJoined;
        this.onVoiceUserLeft = handlers.onVoiceUserLeft;
        this.onWebrtcOffer = handlers.onWebrtcOffer;
        this.onWebrtcAnswer = handlers.onWebrtcAnswer;
        this.onWebrtcIceCandidate = handlers.onWebrtcIceCandidate;
        this.onTranscript = handlers.onTranscript;
    }
    
    // 状态查询
    isOnline() {
        return this.isConnected && !this.localMode;
    }
    
    getConnectionStatus() {
        if (this.localMode) return 'local';
        if (this.isConnected) return 'online';
        return 'offline';
    }
    
    // 清理资源
    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
        this.isConnected = false;
        this.currentRoomId = null;
        this.currentUserId = null;
        this.currentUsername = null;
    }

    // ========= 语音 & 转写 API =========
    voiceJoin(roomId, userId) {
        if (this.isConnected && this.socket) {
            this.socket.emit('voice-join', { roomId, userId });
        }
    }

    voiceLeave(roomId, userId) {
        if (this.isConnected && this.socket) {
            this.socket.emit('voice-leave', { roomId, userId });
        }
    }

    sendOffer(roomId, fromUserId, toUserId, sdp) {
        if (this.isConnected && this.socket) {
            this.socket.emit('webrtc-offer', { roomId, fromUserId, toUserId, sdp });
        }
    }

    sendAnswer(roomId, fromUserId, toUserId, sdp) {
        if (this.isConnected && this.socket) {
            this.socket.emit('webrtc-answer', { roomId, fromUserId, toUserId, sdp });
        }
    }

    sendIceCandidate(roomId, fromUserId, toUserId, candidate) {
        if (this.isConnected && this.socket) {
            this.socket.emit('webrtc-ice-candidate', { roomId, fromUserId, toUserId, candidate });
        }
    }

    asrStart(roomId) {
        if (this.isConnected && this.socket) {
            this.socket.emit('asr-start', { roomId });
        }
    }

    sendAudioChunk(roomId, base64Data, isLast) {
        if (this.isConnected && this.socket) {
            this.socket.emit('audio-chunk', { roomId, chunkBase64: base64Data, isLast: !!isLast });
        }
    }

    asrStop(roomId) {
        if (this.isConnected && this.socket) {
            this.socket.emit('asr-stop', { roomId });
        }
    }
}

// 初始化实时客户端
window.realtimeClient = new RealtimeClient();