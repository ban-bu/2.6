# 🚀 Railway MongoDB 配置指南

## 📋 当前状态
✅ MongoDB服务已成功部署到Railway  
✅ 服务状态：运行中  
✅ 部署时间：15秒前  

## 🔧 下一步操作

### 1. 获取MongoDB连接信息

在Railway仪表板中：

1. **进入项目**：点击您的"athletic-essence"项目
2. **找到MongoDB服务**：在Architecture视图中找到MongoDB卡片
3. **查看变量**：点击MongoDB服务，进入"Variables"标签页
4. **复制连接字符串**：找到`MONGODB_URI`变量并复制其值

### 2. 配置后端服务

在您的后端服务中设置环境变量：

```bash
# 在Railway仪表板的后端服务中设置以下环境变量：

MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/vibe-meeting
PORT=3001
NODE_ENV=production
ALLOWED_ORIGINS=https://your-huggingface-space.hf.space,http://localhost:3000
JWT_SECRET=your-super-secret-jwt-key-minimum-32-characters
SESSION_SECRET=your-session-secret-minimum-32-characters
```

### 3. 测试MongoDB连接

运行测试脚本验证连接：

```bash
# 设置环境变量
export MONGODB_URI="你的MongoDB连接字符串"

# 运行测试
node test-mongodb.js
```

### 4. 部署后端服务

确保后端服务也部署到Railway：

```bash
# 在项目根目录
railway login
railway link
railway up
```

## 🔍 验证部署

### 健康检查
访问您的后端API端点：
```
https://your-backend-url.railway.app/api/health
```

期望响应：
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "database": "connected"
}
```

### 数据库状态检查
在浏览器控制台测试WebSocket连接：
```javascript
const socket = io('https://your-backend-url.railway.app');
socket.on('connect', () => console.log('✅ 连接成功!'));
socket.on('disconnect', () => console.log('❌ 连接断开'));
```

## 🛠️ 故障排除

### 常见问题

1. **连接失败**
   - 检查`MONGODB_URI`格式是否正确
   - 确认用户名和密码正确
   - 检查网络访问设置

2. **CORS错误**
   - 确保`ALLOWED_ORIGINS`包含正确的前端域名
   - 检查前端URL是否在允许列表中

3. **WebSocket连接失败**
   - 确认后端服务正在运行
   - 检查防火墙设置
   - 验证URL格式

### 日志查看
在Railway仪表板中：
1. 点击您的服务
2. 进入"Logs"标签页
3. 查看实时日志输出

## 📊 监控和维护

### 数据库监控
- 在MongoDB服务页面查看连接状态
- 监控数据库使用量
- 定期检查日志

### 性能优化
- 设置适当的索引
- 监控查询性能
- 定期清理过期数据

## 🎉 完成检查清单

- [ ] MongoDB服务已部署
- [ ] 获取了连接字符串
- [ ] 配置了环境变量
- [ ] 测试了数据库连接
- [ ] 部署了后端服务
- [ ] 验证了API端点
- [ ] 测试了WebSocket连接
- [ ] 检查了日志输出

## 📞 技术支持

如果遇到问题：
1. 检查Railway仪表板的日志
2. 验证环境变量配置
3. 测试网络连接
4. 查看MongoDB服务状态

祝您部署成功！🎊 