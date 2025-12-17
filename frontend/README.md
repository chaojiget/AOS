# AOS Frontend (Next.js 14)

一个前后端分离的遥测 UI：Next.js 14 + Tailwind（shadcn 风格）+ lucide-react。

## 运行

### 1) 启动后端（FastAPI）

在仓库根目录：

```bash
uv run uvicorn aos_backend.main:app --reload --port 8080
```

### 2) 启动前端（Next.js）

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

访问：
- `http://localhost:3000` 主页
- `http://localhost:3000/telemetry/neural-stream` 神经流
- `http://localhost:3000/telemetry/trace-chain` Trace Chain（DeepTrace Observer：Tree + Timeline + Ctrl+滚轮缩放 + 搜索跳转）

## 环境变量

- `NEXT_PUBLIC_AOS_BACKEND_URL`：后端地址（默认 `http://localhost:8080`）
