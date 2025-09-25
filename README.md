# AOS - AI Chat Assistant

一个使用 Next.js、LangGraph 和 OpenTelemetry 构建的AI聊天应用，具有实时监控和追踪功能。

## 📈 项目进度（更新于 2025-03-08）

- ✅ 后端：Express + LangGraph 聊天代理已完成，支持会话上下文、SSE 流式输出与 OpenAI 模型配置。
- ✅ 后端：LangGraph 检查点存储迁移至 PostgreSQL，复用连接池并自动同步 schema 注释。
- ✅ 后端：OpenTelemetry 埋点生效，遥测数据写入 PostgreSQL `pgmq` 队列 `telemetry_events`，并通过 `/api/telemetry/*` API 读取队列中的追踪、日志、指标以及统计信息。
- ✅ 前端：Next.js 聊天工作台上线，具备本地多会话存储、追踪 ID 展示以及实时输入提示，默认连通流式聊天接口。
- ✅ 前端：遥测仪表板页面可视化最近追踪、日志、指标，并可回放本地历史会话、关联 Trace 详情。

## 🚀 特性

- **AI聊天助手**: 基于 LangGraph 构建的智能对话系统
- **实时监控**: 使用 OpenTelemetry 收集遥测数据
- **数据存储**: PostgreSQL 持久化 LangGraph 检查点，遥测写入 `pgmq` 队列
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
- **PostgreSQL**: LangGraph 检查点存储
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

# （可选）为前端创建 `.env.local` 环境变量文件
touch .env.local
```

`backend/.env` 需同时填入数据库连接串，示例：

```env
DATABASE_URL=postgres://aos:aos@localhost:5432/aos
LANGGRAPH_CHECKPOINT_URL=postgres://aos:aos@localhost:5432/aos
```

> 💡 如果使用自建 PostgreSQL 集群，请确保拥有 `CREATE EXTENSION` 权限，并提前安装 `pgmq` 扩展（例如在 `psql` 中执行 `CREATE EXTENSION IF NOT EXISTS pgmq;`），以便遥测队列正常创建。

### 3. 配置 OpenAI API Key

在 `backend/.env` 文件中设置：

```env
OPENAI_API_KEY=your_openai_api_key_here
```

## 🚀 运行

### 开发模式

```bash
# 启动 Postgres（首次运行会初始化 pgvector 扩展）
docker-compose up postgres -d

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

### 前端环境变量

在根目录创建 `.env.local` 文件，配置前端请求后端时使用的基础地址：

```env
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
```

在部署到不同环境时，只需修改该变量，即可让聊天与遥测页面指向新的后端地址。

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

## 🔍 数据存储

- **PostgreSQL**：LangGraph 检查点与写入历史，自动创建 `checkpoints`、`writes`、`schema_annotations` 表。
- **pgmq 队列**：OpenTelemetry 追踪、日志、指标写入 `telemetry_events` 队列，后端通过 `SELECT * FROM pgmq.read('telemetry_events', limit => 100, vt => 0);` 等查询接口按需消费，可结合 `/api/telemetry/*` API 对接前端仪表板。

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
   - 确保本地 Postgres 服务已启动（`docker-compose ps`）
   - 检查 `DATABASE_URL`/`LANGGRAPH_CHECKPOINT_URL` 是否配置正确
   - 若提示找不到 `pgmq`，请确认数据库已安装该扩展并授予项目用户 `USAGE`/`SELECT` 权限，必要时重新执行 `CREATE EXTENSION pgmq;`

## 📄 许可证

MIT License

## 🤝 贡献

欢迎提交 issues 和 pull requests！
