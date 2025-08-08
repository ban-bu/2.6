# 🚀 Vibe Meeting 云端部署指南

本指南将帮助你将 Vibe Meeting 部署到云端，实现真正的多端实时聊天功能。

## 📋 部署架构

```mermaid
graph TB
    A[前端 - Hugging Face Space] --> B[后端 - 云服务器]
    B --> C[数据库 - MongoDB]
    B --> D[WebSocket 服务]
    
    E[用户1 - 浏览器] --> A
    F[用户2 - 手机] --> A
    G[用户3 - 平板] --> A
    
    A --> H[实时同步]
    H --> E
    H --> F
    H --> G
```

## 🎯 推荐部署方案

### 方案1：Railway + MongoDB Atlas（推荐）
- **前端**: 继续使用 Hugging Face Space
- **后端**: Railway 部署
- **数据库**: MongoDB Atlas 免费版
- **成本**: 免费

### 方案2：Vercel + PlanetScale
- **前端**: Hugging Face Space
- **后端**: Vercel Serverless
- **数据库**: PlanetScale MySQL
- **成本**: 免费

### 方案3：Render + Railway
- **前端**: Hugging Face Space
- **后端**: Render 或 Railway
- **数据库**: Railway PostgreSQL
- **成本**: 免费-$5/月

## 🛠️ 详细部署步骤

### 步骤1：准备数据库

#### 选项A：MongoDB Atlas (推荐)
1. 访问 [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. 创建免费账户
3. 创建新集群（选择免费版 M0）
4. 创建数据库用户
5. 设置网络访问（允许所有IP: 0.0.0.0/0）
6. 获取连接字符串：
   ```
   mongodb+srv://username:password@cluster.mongodb.net/vibe-meeting
   ```
mongodb+srv://zhangaa802:oRjMpJq8zb16ZDkx@cluster0.twgfyce.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0


const { MongoClient, ServerApiVersion } = require('mongodb');
const uri = "mongodb+srv://zhangaa802:oRjMpJq8zb16ZDkx@cluster0.twgfyce.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    await client.close();
  }
}
run().catch(console.dir);

   zhangaa802, oRjMpJq8zb16ZDkx

#### 选项B：Railway PostgreSQL
1. 访问 [Railway](https://railway.app)
2. 创建新项目
3. 添加 PostgreSQL 数据库
4. 获取连接字符串

### 步骤2：部署后端服务

#### 使用 Railway 部署

1. **创建 Railway 项目**
   ```bash
   # 安装 Railway CLI
   npm install -g @railway/cli
   
   # 登录
   railway login
   
   # 在 server 目录下创建项目
   cd server
   railway init
   ```

2. **配置环境变量**
   在 Railway 仪表板中设置：
   ```env
   PORT=3001
   NODE_ENV=production
   MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/vibe-meeting
   ALLOWED_ORIGINS=https://your-huggingface-space.hf.space
   JWT_SECRET=your-super-secret-jwt-key
   SESSION_SECRET=your-session-secret
   ```

3. **部署**
   ```bash
   railway deploy
   ```

4. **获取部署URL**
   ```bash
   railway domain
   ```

#### 使用 Vercel 部署

1. **准备 Vercel 配置**
   在 `server` 目录创建 `vercel.json`：
   ```json
   {
     "version": 2,
     "builds": [
       {
         "src": "server.js",
         "use": "@vercel/node"
       }
     ],
     "routes": [
       {
         "src": "/(.*)",
         "dest": "/server.js"
       }
     ],
     "env": {
       "NODE_ENV": "production"
     }
   }
   ```

2. **部署到 Vercel**
   ```bash
   # 安装 Vercel CLI
   npm install -g vercel
   
   # 在 server 目录下部署
   cd server
   vercel
   ```

3. **配置环境变量**
   在 Vercel 仪表板中设置相同的环境变量

#### 使用 Render 部署

1. 访问 [Render](https://render.com)
2. 连接 GitHub 仓库
3. 创建新的 Web Service
4. 配置：
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Environment**: Node
5. 设置环境变量（同上）

### 步骤3：配置前端

1. **获取后端URL**
   部署完成后，获得类似以下的URL：
   - Railway: `https://vibe-meeting-production.up.railway.app`
   - Vercel: `https://vibe-meeting-server.vercel.app`
   - Render: `https://vibe-meeting-server.onrender.com`

2. **测试后端连接**
   访问 `https://your-backend-url/api/health` 检查是否正常

3. **更新前端配置**
   前端会自动检测并提示配置服务器地址

### 步骤4：配置CORS

确保后端的 `ALLOWED_ORIGINS` 包含你的 Hugging Face Space URL：
```env
ALLOWED_ORIGINS=https://your-username-vibe-meeting.hf.space,http://localhost:3000
```

## 🔧 环境变量完整配置

### 后端环境变量
```env
# 基本配置
PORT=3001
NODE_ENV=production

# 数据库配置
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/vibe-meeting

# 安全配置
JWT_SECRET=your-super-secret-jwt-key-minimum-32-characters
SESSION_SECRET=your-session-secret-minimum-32-characters

# CORS配置
ALLOWED_ORIGINS=https://your-huggingface-space.hf.space,http://localhost:3000

# 速率限制
RATE_LIMIT_WINDOW=15
RATE_LIMIT_MAX=100

# AI配置（可选）
DEEPBRICKS_API_KEY=your-deepbricks-api-key
DEEPBRICKS_API_URL=https://api.deepbricks.ai/v1/chat/completions
```

## 🧪 测试部署

### 1. 后端健康检查
```bash
curl https://your-backend-url/api/health
```
期望响应：
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "database": "connected"
}
```

### 2. WebSocket连接测试
使用浏览器开发者工具检查 WebSocket 连接：
```javascript
// 在浏览器控制台运行
const socket = io('https://your-backend-url');
socket.on('connect', () => console.log('Connected!'));
```

### 3. 多端测试
1. 在不同设备上打开相同的会议链接
2. 测试实时消息同步
3. 测试用户加入/离开提示
4. 测试输入状态提示

## 🚨 常见问题

### 1. CORS错误
**问题**: 前端无法连接后端
**解决**: 检查 `ALLOWED_ORIGINS` 是否包含正确的前端域名

### 2. WebSocket连接失败
**问题**: 连接状态显示"本地模式"
**解决**: 
- 检查后端URL是否正确
- 确保后端服务正在运行
- 检查防火墙设置

### 3. 数据库连接失败
**问题**: 后端启动失败
**解决**:
- 检查 `MONGODB_URI` 格式
- 确保数据库用户权限正确
- 检查网络访问白名单

### 4. 消息不同步
**问题**: 消息只在本地显示
**解决**:
- 检查 WebSocket 连接状态
- 查看浏览器开发者工具的网络面板
- 确认后端日志没有错误

## 🔄 自动部署（可选）

### GitHub Actions 自动部署
创建 `.github/workflows/deploy.yml`：
```yaml
name: Deploy to Railway

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Use Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          
      - name: Install Railway CLI
        run: npm install -g @railway/cli
        
      - name: Deploy to Railway
        run: railway deploy --service=your-service-id
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
```

## 📊 监控和维护

### 1. 日志监控
- Railway: 内置日志查看
- Vercel: Function 日志
- Render: 实时日志

### 2. 性能监控
```javascript
// 在后端添加性能监控
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.path} - ${duration}ms`);
  });
  next();
});
```

### 3. 错误追踪
考虑集成 Sentry 或其他错误追踪服务

## 🎉 部署完成

恭喜！你现在拥有一个支持多端实时聊天的 Vibe Meeting 系统：

✅ **多端同步**: 不同设备实时同步消息和状态  
✅ **自动重连**: 网络断开后自动重新连接  
✅ **输入提示**: 实时显示其他用户输入状态  
✅ **数据持久化**: 消息和参与者信息永久保存  
✅ **可扩展性**: 支持更多用户和功能扩展  

## 📞 技术支持

如果遇到部署问题，请：
1. 检查本指南的常见问题部分
2. 查看后端日志获取详细错误信息
3. 确认所有环境变量配置正确
4. 测试网络连接和防火墙设置

祝你部署成功！🎊