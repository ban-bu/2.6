---
title: Vibe Meeting
emoji: 🧠
colorFrom: blue
colorTo: indigo
sdk: static
sdk_version: "1.0.0"
app_file: index.html
pinned: false
---

# Vibe Meeting - AI赋能的智能组会讨论平台

一个美观简洁的虚拟会议文字聊天平台，集成AI智能记录和问答功能，让AI赋能组会讨论。

## 🌟 核心功能

### 💬 实时多端聊天
- **跨设备同步**: 手机、电脑、平板实时同步聊天
- **在线状态**: 实时显示谁在线，谁在输入
- **自动重连**: 网络断开自动重新连接
- **智能降级**: 服务器不可用时自动切换本地模式

### 🤖 AI智能助手
- **智能问答**: 讨论中遇到不懂的问题，随时询问AI获得专业解答
- **自动总结**: 一键生成结构化会议总结，包括讨论要点、共识、待解决问题和行动计划
- **文件智能处理**: OCR文字识别、文档翻译、内容总结、关键词提取

### 📁 文件协作
- **多格式支持**: PDF、Word、Excel、PPT、图片等多种格式
- **AI工具箱**: 一键处理文档，提取信息
- **实时分享**: 文件上传后所有用户实时可见

### 💾 数据安全
- **云端存储**: 数据永久保存，不会丢失
- **房间系统**: 通过房间号加入和恢复会议
- **导出功能**: 支持导出完整的会议记录和AI总结

## 🎨 界面特色

- **现代化设计**: 采用渐变色彩和毛玻璃效果，视觉体验优秀
- **响应式布局**: 完美适配桌面端和移动端
- **流畅动画**: 优雅的过渡动画和交互反馈
- **简洁直观**: 零学习成本，上手即用

## 🚀 技术实现

- **前端**: 纯HTML5 + CSS3 + JavaScript + WebSocket客户端
- **后端**: Node.js + Express + Socket.IO + MongoDB
- **AI集成**: 集成Deepbricks AI API (gemini-2.5-flash模型)
- **实时通信**: WebSocket实现多端同步
- **数据存储**: 云端数据库 + 本地存储备份
- **部署**: 支持多种云平台部署

## 📱 使用方法

1. **加入会议**: 自动分配房间号，可邀请团队成员使用相同房间号加入
2. **开始讨论**: 在聊天框输入消息，按Enter发送
3. **AI记录**: AI自动记录讨论要点，实时显示在聊天记录中
4. **询问AI**: 点击"询问AI"按钮，输入问题获得专业解答
5. **生成总结**: 讨论结束后点击"生成总结"获得完整会议总结
6. **导出记录**: 点击"导出总结"下载会议记录和总结

## 🎯 使用场景

- **技术团队会议**: 架构讨论、代码审查、需求分析
- **产品讨论**: 功能规划、用户体验优化、市场策略
- **学习小组**: 知识分享、问题讨论、学习总结
- **远程协作**: 跨地域团队的高效沟通

## 🔧 快速开始

### 方式一：仅前端体验
```bash
# 克隆项目
git clone [repository-url]
cd vibe-meeting

# 直接打开index.html即可使用（本地模式）
open index.html
```

### 方式二：完整实时功能
1. **部署前端到 Hugging Face Space**
   - Fork本项目到GitHub
   - 在Hugging Face创建新的Space
   - 连接GitHub仓库并选择"Static"类型部署

2. **部署后端到云服务器**
   ```bash
   cd server
   npm install
   
   # 配置环境变量（见 .env.example）
   cp .env.example .env
   
   # 本地开发
   npm run dev
   
   # 或部署到云平台（Railway/Vercel/Render）
   npm start
   ```

3. **配置连接**
   - 前端会自动提示配置后端服务器地址
   - 输入部署后的服务器URL即可启用实时功能

📚 **详细教程**: 
- [📖 完整部署指南](DEPLOYMENT.md) - 从零到完整部署
- [🔄 功能迁移指南](MIGRATION.md) - 现有用户升级指南

## 🤝 贡献指南

欢迎提交Issue和Pull Request来改进这个项目！

## 📄 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件

## 🙏 致谢

- Deepbricks AI 提供强大的AI能力支持
- Google Fonts 提供优美的字体资源
- Font Awesome 提供精美的图标

## 🆕 版本更新

### v2.0 - 多端实时聊天版本
- ✅ 新增多设备实时同步聊天
- ✅ 实时在线状态和输入提示
- ✅ 自动重连和智能降级机制
- ✅ 云端数据持久化存储
- ✅ 完全向后兼容，保留所有原有功能

### v1.0 - AI赋能基础版本
- ✅ AI智能问答和会议总结
- ✅ 文件上传和AI工具箱
- ✅ 美观的UI界面设计
- ✅ 本地存储和房间系统

## 🏗️ 项目架构

```
vibe-meeting/
├── index.html              # 主页面
├── app.js                  # 核心业务逻辑
├── realtime-client.js      # WebSocket客户端
├── styles.css              # 基础样式
├── styles-realtime.css     # 实时功能样式
├── loading.css             # 加载动画
├── sw.js                   # Service Worker
├── server/                 # 后端服务
│   ├── server.js          # 服务器入口
│   ├── package.json       # 依赖配置
│   └── .env.example       # 环境变量模板
├── DEPLOYMENT.md           # 部署指南
├── MIGRATION.md            # 迁移指南
└── README.md              # 项目说明
```

## 📞 技术支持

如果在部署或使用过程中遇到问题：

1. 📖 查看 [部署指南](DEPLOYMENT.md) 和 [迁移指南](MIGRATION.md)
2. 🐛 检查浏览器开发者工具的控制台错误
3. 🔍 确认环境变量和网络配置
4. 💬 在项目Issues中提问

## 🤝 贡献指南

欢迎提交Issue和Pull Request来改进这个项目！

### 开发指南
```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 运行测试
npm test
```

---

**Vibe Meeting v2.0** - 让每一次组会都充满智慧的碰撞，现在支持多端实时协作！ ✨🌐