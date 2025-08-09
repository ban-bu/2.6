const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const mongoose = require('mongoose');
const { RateLimiterMemory } = require('rate-limiter-flexible');
const WebSocket = require('ws');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// 速率限制器
const rateLimiter = new RateLimiterMemory({
    keyPrefix: 'middleware',
    points: 100, // 允许的请求次数
    duration: 900, // 15分钟
});

// 中间件配置
app.use(helmet({
    contentSecurityPolicy: false // 允许内联脚本，适配前端需求
}));
app.use(compression());

// 动态CORS配置，支持Railway部署
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
    'http://localhost:3000',
    'http://localhost:8080',
    'https://*.railway.app',
    'https://*.up.railway.app'
];

app.use(cors({
    origin: (origin, callback) => {
        // 允许没有origin的请求（如移动应用）
        if (!origin) return callback(null, true);
        
        // 如果设置为*，允许所有来源
        if (allowedOrigins.includes('*')) {
            return callback(null, true);
        }
        
        // 检查是否在允许列表中
        const isAllowed = allowedOrigins.some(allowedOrigin => {
            if (allowedOrigin.includes('*')) {
                const regex = new RegExp(allowedOrigin.replace(/\*/g, '.*'));
                return regex.test(origin);
            }
            return allowedOrigin === origin;
        });
        
        if (isAllowed || process.env.NODE_ENV === 'development') {
            callback(null, true);
        } else {
            console.log('CORS blocked origin:', origin, 'Allowed origins:', allowedOrigins);
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST'],
    credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 静态文件服务 - 为Railway部署提供前端文件
app.use(express.static('./', {
    index: 'index.html',
    setHeaders: (res, path) => {
        // 设置缓存头
        if (path.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache');
        } else if (path.endsWith('.js') || path.endsWith('.css')) {
            res.setHeader('Cache-Control', 'public, max-age=86400'); // 1天
        }
    }
}));

// Socket.IO配置
const io = socketIo(server, {
    cors: {
        origin: (origin, callback) => {
            // 允许没有origin的请求
            if (!origin) return callback(null, true);
            
            const isAllowed = allowedOrigins.some(allowedOrigin => {
                if (allowedOrigin.includes('*')) {
                    const regex = new RegExp(allowedOrigin.replace('*', '.*'));
                    return regex.test(origin);
                }
                return allowedOrigin === origin;
            });
            
            if (isAllowed || process.env.NODE_ENV === 'development') {
                callback(null, true);
            } else {
                callback(new Error('Not allowed by CORS'));
            }
        },
        methods: ['GET', 'POST'],
        credentials: true
    },
    maxHttpBufferSize: 1e7, // 10MB
    transports: ['websocket', 'polling'], // 支持多种传输方式
    allowEIO3: true // 向后兼容
});

// ============== 语音通话与转写（内存态） ==============
const voiceRooms = new Map(); // roomId -> Set<userId>
const asrSessions = new Map(); // IAT: roomId -> { ws, isReady, queue: Buffer[], disabled?: boolean }
const rtasrSessions = new Map(); // RTASR: roomId -> { ws, started, queue: Buffer[] }

function getVoiceSet(roomId) {
    if (!voiceRooms.has(roomId)) {
        voiceRooms.set(roomId, new Set());
    }
    return voiceRooms.get(roomId);
}

// 科大讯飞配置
const IFLYTEK_APPID = process.env.IFLYTEK_APPID || '84959f16';
const IFLYTEK_API_KEY = process.env.IFLYTEK_API_KEY || '065eee5163baa4692717b923323e6853';
const IFLYTEK_API_SECRET = process.env.IFLYTEK_API_SECRET || process.env.XFY_API_SECRET || '';
const IFLYTEK_MODE = (process.env.IFLYTEK_MODE || 'rtasr').toLowerCase(); // 'rtasr' | 'iat'

function buildIatAuthUrl() {
    const host = 'iat-api.xfyun.cn';
    const path = '/v2/iat';
    const date = new Date().toGMTString();
    const signatureOrigin = `host: ${host}\ndate: ${date}\nGET ${path} HTTP/1.1`;
    const signatureSha = crypto.createHmac('sha256', IFLYTEK_API_SECRET).update(signatureOrigin).digest('base64');
    const authorizationOrigin = `api_key=${IFLYTEK_API_KEY}, algorithm=hmac-sha256, headers=host date request-line, signature=${signatureSha}`;
    const authorization = Buffer.from(authorizationOrigin).toString('base64');
    const url = `wss://${host}${path}?authorization=${authorization}&date=${encodeURIComponent(date)}&host=${host}`;
    return url;
}

function ensureAsrSession(roomId) {
    if (asrSessions.has(roomId)) return asrSessions.get(roomId);
    if (!IFLYTEK_API_SECRET) {
        console.warn('IFLYTEK_API_SECRET 未配置，禁用实时转写');
        const disabled = { ws: null, isReady: false, disabled: true, queue: [] };
        asrSessions.set(roomId, disabled);
        return disabled;
    }

    const url = buildIatAuthUrl();
    const ws = new WebSocket(url);
    const session = { ws, isReady: false, queue: [] };
    asrSessions.set(roomId, session);

    ws.on('open', () => {
        session.isReady = true;
        const frame = {
            common: { app_id: IFLYTEK_APPID },
            business: {
                language: 'zh_cn',
                domain: 'iat',
                accent: 'mandarin',
                dwa: 'wpgs',
                vad_eos: 3000,
                ptt: 0
            },
            data: {
                status: 0,
                format: 'audio/L16;rate=16000',
                encoding: 'raw',
                audio: ''
            }
        };
        ws.send(JSON.stringify(frame));
        while (session.queue.length) {
            const chunk = session.queue.shift();
            sendAudioChunk(ws, chunk, 1);
        }
    });

    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg.toString());
            if (data && data.code === 0 && data.data && data.data.result) {
                const wpgs = data.data.result.ws || [];
                const text = wpgs.map(w => w.cw.map(c => c.w).join('')).join('');
                if (text) {
                    io.to(roomId).emit('transcript', { text, isFinal: data.data.status === 2 });
                }
            } else if (data && data.code !== 0) {
                console.error('讯飞ASR错误:', data.code, data.message);
            }
        } catch (e) {
            // ignore
        }
    });

    ws.on('close', () => {
        asrSessions.delete(roomId);
    });

    ws.on('error', (err) => {
        console.error('讯飞ASR连接错误:', err.message);
    });

    return session;
}

function sendAudioChunk(ws, rawPcmBuffer, status) {
    const frame = {
        data: {
            status,
            format: 'audio/L16;rate=16000',
            encoding: 'raw',
            audio: rawPcmBuffer.toString('base64')
        }
    };
    ws.send(JSON.stringify(frame));
}

// ============== RTASR（rtasr.xfyun.cn） ==============
function md5Hex(input) {
    return crypto.createHash('md5').update(input, 'utf8').digest('hex');
}

function buildRtasrAuthUrl() {
    const host = 'rtasr.xfyun.cn';
    const path = '/v1/ws';
    const ts = Math.floor(Date.now() / 1000).toString();
    const signaRaw = md5Hex(IFLYTEK_APPID + ts);
    const signa = crypto.createHmac('sha1', IFLYTEK_API_SECRET).update(signaRaw).digest('base64');
    const qs = `?appid=${encodeURIComponent(IFLYTEK_APPID)}&ts=${encodeURIComponent(ts)}&signa=${encodeURIComponent(signa)}`;
    const url = `wss://${host}${path}${qs}`;
    return { url, host };
}

function ensureRtasrSession(roomId) {
    if (rtasrSessions.has(roomId)) return rtasrSessions.get(roomId);
    if (!IFLYTEK_API_SECRET) {
        console.warn('IFLYTEK_API_SECRET 未配置，禁用RTASR转写');
        const disabled = { ws: null, started: false, disabled: true, queue: [] };
        rtasrSessions.set(roomId, disabled);
        return disabled;
    }

    const { url, host } = buildRtasrAuthUrl();
    const ws = new WebSocket(url, { headers: { Origin: `https://${host}` } });
    const session = { ws, started: false, queue: [] };
    rtasrSessions.set(roomId, session);

    ws.on('open', () => {
        // 等待服务端返回 started 后再发送队列
    });

    ws.on('message', (msg) => {
        let text;
        if (Buffer.isBuffer(msg)) {
            try { text = msg.toString('utf8'); } catch { return; }
        } else {
            text = String(msg);
        }
        try {
            const data = JSON.parse(text);
            const action = data.action;
            if (action === 'started') {
                session.started = true;
                // 发送缓存的音频
                while (session.queue.length) {
                    const chunk = session.queue.shift();
                    try { ws.send(chunk); } catch {}
                }
            } else if (action === 'result') {
                // 提取文本
                const content = extractRtasrText(data.data);
                if (content) {
                    io.to(roomId).emit('transcript', { text: content, isFinal: false });
                }
            } else if (action === 'error') {
                console.error('RTASR错误:', data);
            }
        } catch {
            // 非JSON忽略
        }
    });

    ws.on('close', () => {
        rtasrSessions.delete(roomId);
    });

    ws.on('error', (err) => {
        console.error('RTASR连接错误:', err.message);
    });

    return session;
}

function extractRtasrText(messageStr) {
    try {
        const messageObj = typeof messageStr === 'string' ? JSON.parse(messageStr) : messageStr;
        const cn = messageObj.cn;
        const st = cn && cn.st;
        const rtArr = (st && st.rt) || [];
        let result = '';
        for (const rt of rtArr) {
            const wsArr = rt.ws || [];
            for (const wsItem of wsArr) {
                const cwArr = wsItem.cw || [];
                for (const cw of cwArr) {
                    result += cw.w || '';
                }
            }
        }
        return result;
    } catch (e) {
        return '';
    }
}

// MongoDB连接
const connectDB = async () => {
    try {
        if (process.env.MONGODB_URI) {
            await mongoose.connect(process.env.MONGODB_URI);
            console.log('MongoDB 连接成功');
        } else {
            console.log('未配置数据库，使用内存存储');
        }
    } catch (error) {
        console.error('MongoDB 连接失败:', error);
        console.log('降级到内存存储模式');
    }
};

// 数据模型
const messageSchema = new mongoose.Schema({
    roomId: { type: String, required: true, index: true },
    type: { type: String, required: true },
    text: String,
    author: { type: String, required: true },
    userId: { type: String, required: true },
    time: { type: String, required: true },
    file: {
        name: String,
        size: String,
        type: String,
        url: String
    },
    originalFile: String,
    isAIQuestion: { type: Boolean, default: false }, // AI问题标记
    originUserId: String, // AI回复的触发用户ID
    timestamp: { type: Date, default: Date.now, expires: '30d' } // 30天后自动删除
});

const participantSchema = new mongoose.Schema({
    roomId: { type: String, required: true, index: true },
    userId: { type: String, required: true },
    name: { type: String, required: true },
    status: { type: String, default: 'online' },
    joinTime: { type: Date, default: Date.now },
    lastSeen: { type: Date, default: Date.now },
    socketId: String
});

const roomSchema = new mongoose.Schema({
    roomId: { type: String, required: true, unique: true },
    createdAt: { type: Date, default: Date.now },
    lastActivity: { type: Date, default: Date.now },
    participantCount: { type: Number, default: 0 },
    creatorId: { type: String, required: true }, // 房间创建者ID
    creatorName: { type: String, required: true }, // 房间创建者姓名
    settings: {
        maxParticipants: { type: Number, default: 50 },
        allowFileUpload: { type: Boolean, default: true },
        aiEnabled: { type: Boolean, default: true }
    }
});

// 创建索引以提高查询性能
messageSchema.index({ roomId: 1, timestamp: -1 });
participantSchema.index({ roomId: 1, userId: 1 }, { unique: true });

const Message = mongoose.models.Message || mongoose.model('Message', messageSchema);
const Participant = mongoose.models.Participant || mongoose.model('Participant', participantSchema);
const Room = mongoose.models.Room || mongoose.model('Room', roomSchema);

// 内存存储（数据库不可用时的降级方案）
const memoryStorage = {
    rooms: new Map(), // roomId -> { messages: [], participants: Map(), roomInfo: {} }
    
    getRoom(roomId) {
        if (!this.rooms.has(roomId)) {
            this.rooms.set(roomId, {
                messages: [],
                participants: new Map(),
                roomInfo: null // 房间信息（包含创建者）
            });
        }
        return this.rooms.get(roomId);
    },
    
    setRoomInfo(roomId, roomInfo) {
        const room = this.getRoom(roomId);
        room.roomInfo = roomInfo;
    },
    
    getRoomInfo(roomId) {
        const room = this.getRoom(roomId);
        return room.roomInfo;
    },
    
    addMessage(roomId, message) {
        const room = this.getRoom(roomId);
        room.messages.push(message);
        // 限制消息数量，避免内存溢出
        if (room.messages.length > 1000) {
            room.messages = room.messages.slice(-800);
        }
        return message;
    },
    
    getMessages(roomId, limit = 50) {
        const room = this.getRoom(roomId);
        return room.messages.slice(-limit);
    },
    
    addParticipant(roomId, participant) {
        const room = this.getRoom(roomId);
        room.participants.set(participant.userId, participant);
        return participant;
    },
    
    updateParticipant(roomId, userId, updates) {
        const room = this.getRoom(roomId);
        const participant = room.participants.get(userId);
        if (participant) {
            Object.assign(participant, updates);
        }
        return participant;
    },
    
    removeParticipant(roomId, userId) {
        const room = this.getRoom(roomId);
        return room.participants.delete(userId);
    },
    
    getParticipants(roomId) {
        const room = this.getRoom(roomId);
        return Array.from(room.participants.values());
    },
    
    findParticipantBySocketId(socketId) {
        for (const [roomId, room] of this.rooms) {
            for (const [userId, participant] of room.participants) {
                if (participant.socketId === socketId) {
                    return { ...participant, roomId };
                }
            }
        }
        return null;
    }
};

// 数据访问层
const dataService = {
    async saveMessage(messageData) {
        try {
            if (mongoose.connection.readyState === 1) {
                const message = new Message(messageData);
                await message.save();
                return message.toObject();
            } else {
                return memoryStorage.addMessage(messageData.roomId, messageData);
            }
        } catch (error) {
            console.error('保存消息失败:', error);
            return memoryStorage.addMessage(messageData.roomId, messageData);
        }
    },
    
    async getMessages(roomId, limit = 50) {
        try {
            if (mongoose.connection.readyState === 1) {
                const messages = await Message
                    .find({ roomId })
                    .sort({ timestamp: -1 })
                    .limit(limit)
                    .lean();
                return messages.reverse();
            } else {
                return memoryStorage.getMessages(roomId, limit);
            }
        } catch (error) {
            console.error('获取消息失败:', error);
            return memoryStorage.getMessages(roomId, limit);
        }
    },
    
    async saveParticipant(participantData) {
        try {
            if (mongoose.connection.readyState === 1) {
                const participant = await Participant.findOneAndUpdate(
                    { roomId: participantData.roomId, userId: participantData.userId },
                    participantData,
                    { upsert: true, new: true }
                );
                return participant.toObject();
            } else {
                return memoryStorage.addParticipant(participantData.roomId, participantData);
            }
        } catch (error) {
            console.error('保存参与者失败:', error);
            return memoryStorage.addParticipant(participantData.roomId, participantData);
        }
    },
    
    async updateParticipant(roomId, userId, updates) {
        try {
            if (mongoose.connection.readyState === 1) {
                const participant = await Participant.findOneAndUpdate(
                    { roomId, userId },
                    { ...updates, lastSeen: new Date() },
                    { new: true }
                );
                return participant?.toObject();
            } else {
                return memoryStorage.updateParticipant(roomId, userId, { ...updates, lastSeen: new Date() });
            }
        } catch (error) {
            console.error('更新参与者失败:', error);
            return memoryStorage.updateParticipant(roomId, userId, { ...updates, lastSeen: new Date() });
        }
    },
    
    async getParticipants(roomId) {
        try {
            if (mongoose.connection.readyState === 1) {
                const participants = await Participant
                    .find({ roomId })
                    .sort({ joinTime: 1 })
                    .lean();
                return participants;
            } else {
                return memoryStorage.getParticipants(roomId);
            }
        } catch (error) {
            console.error('获取参与者失败:', error);
            return memoryStorage.getParticipants(roomId);
        }
    },
    
    async findParticipantBySocketId(socketId) {
        try {
            if (mongoose.connection.readyState === 1) {
                const participant = await Participant.findOne({ socketId }).lean();
                return participant;
            } else {
                return memoryStorage.findParticipantBySocketId(socketId);
            }
        } catch (error) {
            console.error('查找参与者失败:', error);
            return memoryStorage.findParticipantBySocketId(socketId);
        }
    },
    
    async removeParticipant(roomId, userId) {
        try {
            if (mongoose.connection.readyState === 1) {
                await Participant.deleteOne({ roomId, userId });
            } else {
                memoryStorage.removeParticipant(roomId, userId);
            }
        } catch (error) {
            console.error('删除参与者失败:', error);
            memoryStorage.removeParticipant(roomId, userId);
        }
    }
};

// Socket.IO事件处理
io.on('connection', (socket) => {
    console.log('新用户连接:', socket.id);
    
    // 速率限制中间件
    socket.use(async (packet, next) => {
        try {
            await rateLimiter.consume(socket.handshake.address);
            next();
        } catch (rejRes) {
            socket.emit('error', '请求频率过高，请稍后重试');
            socket.disconnect();
        }
    });
    
    // 加入房间
    socket.on('joinRoom', async (data) => {
        try {
            const { roomId, userId, username } = data;
            
            if (!roomId || !userId || !username) {
                socket.emit('error', '缺少必要参数');
                return;
            }
            
            // 离开之前的房间
            const rooms = Array.from(socket.rooms);
            rooms.forEach(room => {
                if (room !== socket.id) {
                    socket.leave(room);
                }
            });
            
            // 加入新房间
            socket.join(roomId);
            
            // 检查是否已有相同用户名但不同socketId的用户，将其标记为离线
            const existingParticipants = await dataService.getParticipants(roomId);
            const sameNameUsers = existingParticipants.filter(p => p.name === username && p.userId !== userId);
            
            // 将同名但不同ID的用户标记为离线
            for (const sameNameUser of sameNameUsers) {
                await dataService.updateParticipant(roomId, sameNameUser.userId, {
                    status: 'offline',
                    socketId: null
                });
            }
            
            // 检查房间是否已存在，确定是否是创建者
            let isCreator = false;
            let existingRoom = null;
            
            try {
                if (mongoose.connection.readyState === 1) {
                    existingRoom = await Room.findOne({ roomId });
                } else {
                    // 内存存储模式
                    existingRoom = memoryStorage.getRoomInfo(roomId);
                }
            } catch (error) {
                console.error('查询房间信息失败:', error);
            }
            
            if (!existingRoom) {
                // 房间不存在，当前用户是创建者
                isCreator = true;
                const newRoomInfo = {
                    roomId,
                    creatorId: userId,
                    creatorName: username,
                    createdAt: new Date(),
                    lastActivity: new Date()
                };
                
                try {
                    if (mongoose.connection.readyState === 1) {
                        await Room.create(newRoomInfo);
                        existingRoom = newRoomInfo;
                    } else {
                        // 内存存储模式
                        memoryStorage.setRoomInfo(roomId, newRoomInfo);
                        existingRoom = newRoomInfo;
                    }
                    console.log(`🏠 房间 ${roomId} 创建，创建者: ${username} (${userId})`);
                } catch (error) {
                    console.error('创建房间记录失败:', error);
                }
            } else {
                // 房间已存在，检查当前用户是否是原创建者
                isCreator = existingRoom.creatorId === userId;
                if (isCreator) {
                    console.log(`🔄 创建者 ${username} (${userId}) 重新加入房间 ${roomId}`);
                } else {
                    console.log(`👥 用户 ${username} (${userId}) 加入房间 ${roomId}，创建者: ${existingRoom.creatorName} (${existingRoom.creatorId})`);
                }
                
                // 更新房间活动时间
                try {
                    if (mongoose.connection.readyState === 1) {
                        await Room.updateOne({ roomId }, { lastActivity: new Date() });
                    } else {
                        // 内存存储模式，更新房间信息
                        existingRoom.lastActivity = new Date();
                    }
                } catch (error) {
                    console.error('更新房间活动时间失败:', error);
                }
            }
            
            // 保存参与者信息
            const participantData = {
                roomId,
                userId,
                name: username,
                status: 'online',
                joinTime: new Date(),
                lastSeen: new Date(),
                socketId: socket.id
            };
            
            const participant = await dataService.saveParticipant(participantData);
            
            // 获取房间历史消息和参与者
            const [messages, participants] = await Promise.all([
                dataService.getMessages(roomId, 50),
                dataService.getParticipants(roomId)
            ]);
            
            // 发送房间数据给用户（使用已获取的房间信息）
            socket.emit('roomData', {
                messages,
                participants: participants.map(p => ({
                    ...p,
                    status: p.socketId ? 'online' : 'offline'
                })),
                roomInfo: existingRoom ? {
                    creatorId: existingRoom.creatorId,
                    creatorName: existingRoom.creatorName,
                    createdAt: existingRoom.createdAt
                } : (isCreator ? {
                    creatorId: userId,
                    creatorName: username,
                    createdAt: new Date()
                } : null),
                isCreator
            });
            
            // 通知房间其他用户新用户加入
            socket.to(roomId).emit('userJoined', participant);
            
            // 更新参与者列表
            const updatedParticipants = await dataService.getParticipants(roomId);
            io.to(roomId).emit('participantsUpdate', updatedParticipants);
            
            console.log(`用户 ${username} 加入房间 ${roomId}`);
            
        } catch (error) {
            console.error('用户加入房间失败:', error);
            socket.emit('error', '加入房间失败，请重试');
        }
    });
    
    // 发送消息
    socket.on('sendMessage', async (messageData) => {
        try {
            const { roomId, type, text, author, userId, file, isAIQuestion, originUserId } = messageData;
            
            if (!roomId || !author || !userId) {
                socket.emit('error', '消息格式错误');
                return;
            }
            
            const message = {
                roomId,
                type: type || 'user',
                text: text || '',
                author,
                userId,
                time: messageData.time || new Date().toLocaleTimeString('zh-CN', { 
                    hour: '2-digit', 
                    minute: '2-digit' 
                }),
                timestamp: messageData.timestamp ? new Date(messageData.timestamp) : new Date(),
                file: file || null,
                isAIQuestion: isAIQuestion || false, // 保留isAIQuestion属性
                originUserId: originUserId || null, // 保留originUserId属性
            };
            
            // 保存消息
            const savedMessage = await dataService.saveMessage(message);
            
            // 广播消息到房间所有用户
            io.to(roomId).emit('newMessage', savedMessage);
            
            // 更新参与者最后活跃时间
            await dataService.updateParticipant(roomId, userId, { lastSeen: new Date() });
            
            console.log(`房间 ${roomId} 收到新消息:`, message.text?.substring(0, 50) + '...');
            
        } catch (error) {
            console.error('发送消息失败:', error);
            socket.emit('error', '发送消息失败，请重试');
        }
    });
    
    // 用户正在输入
    socket.on('typing', (data) => {
        socket.to(data.roomId).emit('userTyping', {
            userId: data.userId,
            username: data.username,
            isTyping: data.isTyping
        });
    });
    
    // 用户离开
    socket.on('leaveRoom', async (data) => {
        try {
            const { roomId, userId } = data;
            
            socket.leave(roomId);
            
            // 更新用户状态为离线
            await dataService.updateParticipant(roomId, userId, { 
                status: 'offline',
                socketId: null 
            });
            
            // 通知房间其他用户
            socket.to(roomId).emit('userLeft', { userId });
            
            // 更新参与者列表
            const participants = await dataService.getParticipants(roomId);
            io.to(roomId).emit('participantsUpdate', participants);
            
        } catch (error) {
            console.error('用户离开房间失败:', error);
        }
    });
    
    // 断开连接
    socket.on('disconnect', async () => {
        try {
            console.log('用户断开连接:', socket.id);
            
            // 查找该socket对应的参与者并更新状态
            const participant = await dataService.findParticipantBySocketId(socket.id);
            if (participant) {
                await dataService.updateParticipant(
                    participant.roomId, 
                    participant.userId, 
                    { status: 'offline', socketId: null }
                );
                
                // 通知房间其他用户
                socket.to(participant.roomId).emit('userLeft', { userId: participant.userId });
                
                // 更新参与者列表
                const participants = await dataService.getParticipants(participant.roomId);
                io.to(participant.roomId).emit('participantsUpdate', participants);
            }
        } catch (error) {
            console.error('处理断开连接失败:', error);
        }
    });
    
    // ============ 语音通话信令与状态 ============
    socket.on('voice-join', async ({ roomId, userId }) => {
        try {
            const set = getVoiceSet(roomId);
            set.add(userId);
            socket.emit('voice-users', Array.from(set));
            socket.to(roomId).emit('voice-user-joined', { userId });
        } catch (e) {
            console.error('voice-join失败:', e);
        }
    });

    socket.on('voice-leave', ({ roomId, userId }) => {
        try {
            const set = getVoiceSet(roomId);
            set.delete(userId);
            socket.to(roomId).emit('voice-user-left', { userId });
        } catch (e) {
            console.error('voice-leave失败:', e);
        }
    });

    // WebRTC 信令转发
    async function forwardToTarget(roomId, toUserId, event, payload) {
        try {
            const participants = await dataService.getParticipants(roomId);
            const target = participants.find(p => p.userId === toUserId);
            if (target && target.socketId) {
                io.to(target.socketId).emit(event, payload);
            }
        } catch (e) {
            console.error('信令转发失败:', e);
        }
    }

    socket.on('webrtc-offer', ({ roomId, fromUserId, toUserId, sdp }) => {
        forwardToTarget(roomId, toUserId, 'webrtc-offer', { roomId, fromUserId, sdp });
    });

    socket.on('webrtc-answer', ({ roomId, fromUserId, toUserId, sdp }) => {
        forwardToTarget(roomId, toUserId, 'webrtc-answer', { roomId, fromUserId, sdp });
    });

    socket.on('webrtc-ice-candidate', ({ roomId, fromUserId, toUserId, candidate }) => {
        forwardToTarget(roomId, toUserId, 'webrtc-ice-candidate', { roomId, fromUserId, candidate });
    });

    // ============ 科大讯飞 实时转写 ============
    socket.on('asr-start', ({ roomId }) => {
        if (IFLYTEK_MODE === 'rtasr') {
            ensureRtasrSession(roomId);
        } else {
            ensureAsrSession(roomId);
        }
    });

    socket.on('audio-chunk', ({ roomId, chunkBase64, isLast }) => {
        if (IFLYTEK_MODE === 'rtasr') {
            const session = ensureRtasrSession(roomId);
            if (!session || session.disabled) return;
            const buf = Buffer.from(chunkBase64, 'base64');
            if (session.ws) {
                if (session.started) {
                    try { session.ws.send(buf); } catch {}
                } else {
                    session.queue.push(buf);
                }
            }
            if (isLast && session.ws) {
                try { session.ws.send(Buffer.from('{"end": true}', 'utf8')); } catch {}
            }
        } else {
            const session = ensureAsrSession(roomId);
            if (!session || session.disabled) return;
            const buf = Buffer.from(chunkBase64, 'base64');
            if (session.ws && session.isReady) {
                sendAudioChunk(session.ws, buf, isLast ? 2 : 1);
            } else {
                session.queue.push(buf);
            }
        }
    });

    socket.on('asr-stop', ({ roomId }) => {
        if (IFLYTEK_MODE === 'rtasr') {
            const session = rtasrSessions.get(roomId);
            if (session && session.ws) {
                try { session.ws.close(); } catch {}
            }
            rtasrSessions.delete(roomId);
        } else {
            const session = asrSessions.get(roomId);
            if (session && session.ws) {
                try { session.ws.close(); } catch {}
            }
            asrSessions.delete(roomId);
        }
    });
    // 结束会议（仅创建者可操作）
    socket.on('endMeeting', async (data) => {
        try {
            const { roomId, userId } = data;
            
            if (!roomId || !userId) {
                socket.emit('error', '缺少必要参数');
                return;
            }
            
            // 验证是否是房间创建者
            let isCreator = false;
            if (mongoose.connection.readyState === 1) {
                const room = await Room.findOne({ roomId });
                isCreator = room && room.creatorId === userId;
            } else {
                // 内存存储模式下，检查房间信息中的创建者
                const roomInfo = memoryStorage.getRoomInfo(roomId);
                isCreator = roomInfo && roomInfo.creatorId === userId;
            }
            
            if (!isCreator) {
                socket.emit('error', '只有会议创建者可以结束会议');
                return;
            }
            
            // 清理房间数据
            let deletedMessages = 0;
            let deletedParticipants = 0;
            
            if (mongoose.connection.readyState === 1) {
                // MongoDB环境：删除数据库中的数据
                const messageResult = await Message.deleteMany({ roomId });
                const participantResult = await Participant.deleteMany({ roomId });
                await Room.deleteOne({ roomId });
                
                deletedMessages = messageResult.deletedCount;
                deletedParticipants = participantResult.deletedCount;
            } else {
                // 内存存储环境：清理内存数据
                if (memoryStorage.rooms.has(roomId)) {
                    const room = memoryStorage.rooms.get(roomId);
                    deletedMessages = room.messages.length;
                    deletedParticipants = room.participants.size;
                    memoryStorage.rooms.delete(roomId);
                }
            }
            
            console.log(`🏁 会议 ${roomId} 已结束: 清理了 ${deletedMessages} 条消息, ${deletedParticipants} 个参与者`);
            
            // 通知房间所有用户会议已结束
            io.to(roomId).emit('meetingEnded', {
                message: '会议已被创建者结束，房间数据已清理',
                deletedMessages,
                deletedParticipants
            });
            
            // 让所有用户离开房间
            const roomSockets = await io.in(roomId).fetchSockets();
            for (const roomSocket of roomSockets) {
                roomSocket.leave(roomId);
            }
            
            socket.emit('endMeetingSuccess', {
                message: '会议已成功结束',
                deletedMessages,
                deletedParticipants
            });
            
        } catch (error) {
            console.error('结束会议失败:', error);
            socket.emit('error', '结束会议失败: ' + error.message);
        }
    });
});

// API路由
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
    });
});

app.get('/api/rooms/:roomId/messages', async (req, res) => {
    try {
        const { roomId } = req.params;
        const limit = parseInt(req.query.limit) || 50;
        
        const messages = await dataService.getMessages(roomId, limit);
        res.json({ messages });
    } catch (error) {
        console.error('获取消息失败:', error);
        res.status(500).json({ error: '获取消息失败' });
    }
});

app.get('/api/rooms/:roomId/participants', async (req, res) => {
    try {
        const { roomId } = req.params;
        const participants = await dataService.getParticipants(roomId);
        res.json({ participants });
    } catch (error) {
        console.error('获取参与者失败:', error);
        res.status(500).json({ error: '获取参与者失败' });
    }
});

// 错误处理
app.use((err, req, res, next) => {
    console.error('服务器错误:', err);
    res.status(500).json({ error: '服务器内部错误' });
});

// 404处理
app.use((req, res) => {
    res.status(404).json({ error: '接口不存在' });
});

// 定期清理离线用户（每5分钟）
setInterval(async () => {
    try {
        if (mongoose.connection.readyState === 1) {
            const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
            await Participant.updateMany(
                { 
                    lastSeen: { $lt: fiveMinutesAgo },
                    status: 'online'
                },
                { status: 'offline', socketId: null }
            );
        }
    } catch (error) {
        console.error('清理离线用户失败:', error);
    }
}, 5 * 60 * 1000);

// Railway环境检测和静态文件路由
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/../index.html');
});

// 启动服务器
const PORT = process.env.PORT || 3001;

const startServer = async () => {
    await connectDB();
    
    server.listen(PORT, () => {
        console.log(`🚀 Vibe Meeting 服务器运行在端口 ${PORT}`);
        console.log(`📡 Socket.IO 服务已启动`);
        console.log(`💾 数据库状态: ${mongoose.connection.readyState === 1 ? '已连接' : '使用内存存储'}`);
        console.log(`🌍 环境: ${process.env.NODE_ENV || 'development'}`);
    });
};

startServer().catch(console.error);

// 优雅关闭
process.on('SIGTERM', async () => {
    console.log('收到SIGTERM信号，正在关闭服务器...');
    server.close(() => {
        mongoose.connection.close();
        process.exit(0);
    });
});

process.on('SIGINT', async () => {
    console.log('收到SIGINT信号，正在关闭服务器...');
    server.close(() => {
        mongoose.connection.close();
        process.exit(0);
    });
});