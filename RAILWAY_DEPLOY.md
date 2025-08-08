# Railway 部署指南

这个指南将帮助你将 Vibe Meeting 应用部署到 Railway 平台，实现多用户实时互动功能。

## 🚀 部署步骤

### 1. 准备工作

1. 注册 [Railway](https://railway.app/) 账号
2. 安装 Railway CLI（可选）：
   ```bash
   npm install -g @railway/cli
   ```

### 2. 部署方式

#### 方式 A：通过 GitHub（推荐）

1. 将代码推送到 GitHub 仓库
2. 在 Railway 创建新项目
3. 选择 "Deploy from GitHub repo"
4. 选择你的仓库
5. Railway 会自动检测到 Node.js 项目并开始部署

#### 方式 B：通过 Railway CLI

1. 在项目根目录运行：
   ```bash
   railway login
   railway init
   railway up
   ```

### 3. 环境变量配置

在 Railway 项目设置中添加以下环境变量：

#### 必需变量：
- `NODE_ENV`: `production`
- `PORT`: `3000`（Railway 会自动设置）

#### 可选变量：
- `MONGODB_URI`: MongoDB 连接字符串（不设置则使用内存存储）
- `ALLOWED_ORIGINS`: 允许的CORS域名，如 `https://your-app.railway.app`

### 4. 数据库配置（可选）

#### MongoDB Atlas（推荐）
1. 创建 [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) 免费账号
2. 创建集群和数据库
3. 获取连接字符串
4. 在 Railway 环境变量中设置 `MONGODB_URI`

#### 内存存储
如果不配置数据库，应用会自动使用内存存储，重启后数据会丢失。

### 5. 部署验证

1. 部署完成后，Railway 会提供一个 URL
2. 访问该 URL 应该能看到 Vibe Meeting 界面
3. 测试实时聊天功能确保 WebSocket 连接正常

### 6. 自定义域名（可选）

1. 在 Railway 项目设置中添加自定义域名
2. 配置 DNS 记录指向 Railway
3. 更新 `ALLOWED_ORIGINS` 环境变量

## 🔧 技术架构

- **前端**: 静态文件（HTML/CSS/JS）
- **后端**: Node.js + Express + Socket.IO
- **数据库**: MongoDB（可选）+ 内存存储降级
- **实时通信**: WebSocket (Socket.IO)

## 📱 功能特性

✅ 多用户实时聊天
✅ 文件上传分享
✅ 用户状态管理
✅ 自动重连机制
✅ 跨平台支持
✅ 响应式设计

## 🛠️ 故障排除

### WebSocket 连接失败
- 检查 CORS 配置
- 确认域名在 `ALLOWED_ORIGINS` 中
- 查看浏览器控制台错误信息

### 数据库连接问题
- 验证 `MONGODB_URI` 格式
- 检查 MongoDB Atlas IP 白名单
- 确认数据库用户权限

### 部署失败
- 检查 `package.json` 中的 engines 版本
- 查看 Railway 构建日志
- 确认所有依赖都在 dependencies 中

## 📞 支持

如果遇到问题：
1. 查看 Railway 部署日志
2. 检查浏览器控制台
3. 确认环境变量配置
4. 测试本地开发环境

## 🔄 更新部署

连接 GitHub 仓库后，每次推送到主分支都会自动触发重新部署。

---

部署成功后，你的应用将支持：
- ✨ 多用户同时在线聊天
- 🔄 实时消息同步
- 📱 跨设备访问
- 🔒 安全的 WebSocket 连接
- 💾 可选的数据持久化