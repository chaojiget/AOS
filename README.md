# AOS - AI Chat Assistant

一个使用 Next.js、LangGraph 和 OpenTelemetry 构建的AI聊天应用，具有实时监控和追踪功能。

## 🚀 特性

- **AI聊天助手**: 基于 LangGraph 构建的智能对话系统
- **实时监控**: 使用 OpenTelemetry 收集遥测数据
- **数据存储**: SQLite 数据库存储日志、追踪和指标
- **现代UI**: 使用 shadcn/ui 组件构建的响应式界面
- **前后端分离**: Next.js 前端 + Node.js 后端

## 🛠️ 技术栈

### 前端
- **Next.js 15**: React 框架
- **TypeScript**: 类型安全
- **Tailwind CSS**: 样式框架
- **shadcn/ui**: UI 组件库
- **Lucide React**: 图标库

### 后端
- **Node.js**: 运行时环境
- **Express**: Web 框架
- **LangGraph**: AI Agent 框架
- **OpenTelemetry**: 可观测性
- **SQLite**: 数据存储
- **TypeScript**: 类型安全

## 📦 安装

### 1. 安装依赖
```bash
npm run install:all
```

### 2. 环境配置
```bash
# 复制环境变量模板
cp backend/.env.example backend/.env

# 编辑环境变量，设置你的 OpenAI API Key
nano backend/.env
```

### 3. 配置 OpenAI API Key
在 `backend/.env` 文件中设置：
```env
OPENAI_API_KEY=your_openai_api_key_here
```

## 🚀 运行

### 开发模式
```bash
# 同时启动前端和后端
npm run dev

# 或者分别启动
npm run dev:frontend  # 前端: http://localhost:3000
npm run dev:backend   # 后端: http://localhost:3001
```

### 生产模式
```bash
# 构建项目
npm run build

# 启动服务
npm start
```

## 📱 使用

1. **聊天界面**: 访问 `http://localhost:3000` 开始与AI助手对话
2. **监控仪表板**: 访问 `http://localhost:3000/telemetry` 查看遥测数据

## 🔧 API 端点

### 聊天 API
- `POST /api/chat` - 发送消息给AI助手
- `POST /api/chat/stream` - 流式响应

### 遥测 API
- `GET /api/telemetry/traces` - 获取追踪数据
- `GET /api/telemetry/logs` - 获取日志数据
- `GET /api/telemetry/metrics` - 获取指标数据
- `GET /api/telemetry/stats` - 获取统计信息

## 📊 监控功能

- **实时追踪**: 每个请求都有唯一的trace ID
- **性能监控**: 响应时间、错误率等指标
- **日志聚合**: 结构化日志存储和查询
- **可视化仪表板**: 实时数据展示

## 🔍 数据库结构

SQLite 数据库包含以下表：
- `traces`: 存储OpenTelemetry追踪数据
- `logs`: 存储应用日志
- `metrics`: 存储性能指标

## 🛡️ 安全性

- CORS 配置
- Helmet 安全中间件
- 输入验证
- 错误处理

## 📝 开发说明

### 项目结构
```
AOS/
├── app/                    # Next.js 应用目录
│   ├── page.tsx           # 聊天页面
│   ├── telemetry/         # 遥测页面
│   └── api/               # API 路由
├── backend/               # Node.js 后端
│   ├── src/
│   │   ├── agents/        # LangGraph agents
│   │   ├── telemetry/     # OpenTelemetry 配置
│   │   └── routes/        # API 路由
├── components/            # React 组件
└── lib/                  # 工具函数
```

### 添加新功能

1. **新的AI工具**: 在 `backend/src/agents/chat-agent.ts` 中添加
2. **新的API端点**: 在 `backend/src/routes/` 中创建
3. **新的UI组件**: 在 `components/` 中添加

## 🐛 故障排除

### 常见问题

1. **后端连接失败**
   - 确保后端服务运行在 3001 端口
   - 检查 CORS 配置

2. **OpenAI API 错误**
   - 验证 API Key 是否正确
   - 检查 API 额度

3. **数据库错误**
   - 确保有写入权限
   - 检查 SQLite 文件路径

## 📄 许可证

MIT License

## 🤝 贡献

欢迎提交 issues 和 pull requests！
