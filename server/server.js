const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const mongoose = require('mongoose');
const { RateLimiterMemory } = require('rate-limiter-flexible');
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
    
    // ==================== 语音通话功能 ====================
    
    // 开始语音通话
    socket.on('voice-call-start', async (data) => {
        try {
            const { roomId, userId, username } = data;
            console.log(`用户 ${username} 在房间 ${roomId} 开始语音通话`);
            
            // 加入语音通话房间
            socket.join(`voice-${roomId}`);
            
            // 通知房间内其他用户有新用户加入语音通话
            socket.to(roomId).emit('voice-call-user-joined', {
                userId,
                username,
                socketId: socket.id
            });
            
            // 发送当前房间内所有进行语音通话的用户列表给新加入的用户
            const roomSockets = await io.in(`voice-${roomId}`).fetchSockets();
            const voiceUsers = [];
            
            for (const roomSocket of roomSockets) {
                if (roomSocket.id !== socket.id) {
                    // 获取用户信息
                    const participant = await dataService.findParticipantBySocketId(roomSocket.id);
                    if (participant) {
                        voiceUsers.push({
                            userId: participant.userId,
                            username: participant.name,
                            socketId: roomSocket.id
                        });
                    }
                }
            }
            
            // 发送现有语音用户列表给新用户
            socket.emit('voice-call-existing-users', voiceUsers);
            
        } catch (error) {
            console.error('开始语音通话失败:', error);
            socket.emit('error', '开始语音通话失败');
        }
    });
    
    // 结束语音通话
    socket.on('voice-call-end', async (data) => {
        try {
            const { roomId, userId } = data;
            console.log(`用户 ${userId} 结束语音通话`);
            
            // 离开语音通话房间
            socket.leave(`voice-${roomId}`);
            
            // 通知房间内其他用户该用户离开语音通话
            socket.to(roomId).emit('voice-call-user-left', {
                userId,
                socketId: socket.id
            });
            
        } catch (error) {
            console.error('结束语音通话失败:', error);
        }
    });
    
    // WebRTC信令：发送offer
    socket.on('voice-call-offer', (data) => {
        try {
            const { roomId, targetUserId, offer } = data;
            console.log(`转发offer: ${socket.id} -> ${targetUserId}`);
            
            // 找到目标用户的socket并转发offer
            const participant = dataService.findParticipantBySocketId(socket.id);
            const targetSockets = io.sockets.sockets;
            
            for (const [socketId, targetSocket] of targetSockets) {
                if (targetSocket.rooms.has(roomId)) {
                    const targetParticipant = dataService.findParticipantBySocketId(socketId);
                    if (targetParticipant && targetParticipant.userId === targetUserId) {
                        targetSocket.emit('voice-call-offer', {
                            fromUserId: participant ? participant.userId : socket.id,
                            offer: offer
                        });
                        break;
                    }
                }
            }
            
        } catch (error) {
            console.error('转发offer失败:', error);
        }
    });
    
    // WebRTC信令：发送answer
    socket.on('voice-call-answer', (data) => {
        try {
            const { roomId, targetUserId, answer } = data;
            console.log(`转发answer: ${socket.id} -> ${targetUserId}`);
            
            // 找到目标用户的socket并转发answer
            const participant = dataService.findParticipantBySocketId(socket.id);
            const targetSockets = io.sockets.sockets;
            
            for (const [socketId, targetSocket] of targetSockets) {
                if (targetSocket.rooms.has(roomId)) {
                    const targetParticipant = dataService.findParticipantBySocketId(socketId);
                    if (targetParticipant && targetParticipant.userId === targetUserId) {
                        targetSocket.emit('voice-call-answer', {
                            fromUserId: participant ? participant.userId : socket.id,
                            answer: answer
                        });
                        break;
                    }
                }
            }
            
        } catch (error) {
            console.error('转发answer失败:', error);
        }
    });
    
    // WebRTC信令：发送ICE候选
    socket.on('voice-call-ice-candidate', (data) => {
        try {
            const { roomId, targetUserId, candidate } = data;
            
            // 找到目标用户的socket并转发ICE候选
            const participant = dataService.findParticipantBySocketId(socket.id);
            const targetSockets = io.sockets.sockets;
            
            for (const [socketId, targetSocket] of targetSockets) {
                if (targetSocket.rooms.has(roomId)) {
                    const targetParticipant = dataService.findParticipantBySocketId(socketId);
                    if (targetParticipant && targetParticipant.userId === targetUserId) {
                        targetSocket.emit('voice-call-ice-candidate', {
                            fromUserId: participant ? participant.userId : socket.id,
                            candidate: candidate
                        });
                        break;
                    }
                }
            }
            
        } catch (error) {
            console.error('转发ICE候选失败:', error);
        }
    });
    
    // 语音通话静音状态更新
    socket.on('voice-call-mute-status', (data) => {
        try {
            const { roomId, userId, isMuted } = data;
            
            // 转发静音状态给房间内其他用户
            socket.to(roomId).emit('voice-call-mute-status', {
                userId,
                isMuted
            });
            
        } catch (error) {
            console.error('更新静音状态失败:', error);
        }
    });
    
    // 语音转录消息
    socket.on('voice-transcription', async (data) => {
        try {
            const { roomId, userId, username, text, timestamp, isReplace } = data;
            console.log(`语音转录 [${username}]: ${text.substring(0, 50)}...`);
            
            // 创建转录消息记录
            const transcriptionMessage = {
                roomId,
                type: 'voice-transcription',
                text: `[语音转录] ${text}`,
                author: username,
                userId,
                time: new Date().toLocaleTimeString('zh-CN', { 
                    hour: '2-digit', 
                    minute: '2-digit' 
                }),
                timestamp: new Date(timestamp),
                isTranscription: true,
                originalText: text
            };
            
            // 保存转录消息到数据库
            const savedMessage = await dataService.saveMessage(transcriptionMessage);
            
            // 转发转录消息给房间内所有用户
            io.to(roomId).emit('voice-transcription', {
                userId,
                username,
                text,
                timestamp,
                isReplace,
                message: savedMessage
            });
            
            // 同时作为普通消息广播（可选，根据需求决定）
            // io.to(roomId).emit('newMessage', savedMessage);
            
        } catch (error) {
            console.error('处理语音转录失败:', error);
        }
    });
    
    // 处理断开连接时的语音通话清理
    const originalDisconnectHandler = socket.listeners('disconnect')[0];
    socket.removeAllListeners('disconnect');
    
    socket.on('disconnect', async () => {
        try {
            console.log('用户断开连接:', socket.id);
            
            // 查找该socket对应的参与者
            const participant = await dataService.findParticipantBySocketId(socket.id);
            if (participant) {
                // 清理语音通话相关资源
                const voiceRoomId = `voice-${participant.roomId}`;
                if (socket.rooms.has(voiceRoomId)) {
                    socket.leave(voiceRoomId);
                    
                    // 通知房间内其他用户该用户离开语音通话
                    socket.to(participant.roomId).emit('voice-call-user-left', {
                        userId: participant.userId,
                        socketId: socket.id
                    });
                }
                
                // 执行原有的断开连接处理逻辑
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