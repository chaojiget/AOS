import { NextPage } from "next";

const HomePage: NextPage = () => {
  return (
    <div style={{ padding: "2rem" }}>
      <h1>Agent OS (AOS)</h1>
      <p>Welcome to Agent Operating System</p>
      <div>
        <h2>Project Features</h2>
        <ul>
          <li>最小可信闭环：围绕感知、计划、执行、评审与产出的 RunLoop</li>
          <li>Episode 事件日志：以追加写 JSONL 记录所有事件</li>
          <li>可回放与审计工具链：支持离线回放、审计与故障排查</li>
          <li>工具/MCP 兼容层：统一封装 LLM 与工具调用</li>
          <li>TypeScript 一体化：前后端、CLI 与脚本共享类型定义</li>
        </ul>
      </div>
      <div>
        <h2>Available Scripts</h2>
        <ul>
          <li>
            <code>pnpm dev</code> - 启动开发服务器
          </li>
          <li>
            <code>pnpm test</code> - 运行单元测试
          </li>
          <li>
            <code>pnpm lint</code> - 运行代码检查
          </li>
          <li>
            <code>pnpm typecheck</code> - 执行类型检查
          </li>
          <li>
            <code>pnpm smoke</code> - 执行端到端冒烟测试
          </li>
          <li>
            <code>pnpm replay</code> - 重放最近任务轨迹
          </li>
        </ul>
      </div>
    </div>
  );
};

export default HomePage;
