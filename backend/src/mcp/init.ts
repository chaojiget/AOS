import { ensureMcpStorage } from './storage';
import { mcpRegistry } from './registry';
import { mcpSandbox } from './sandbox';

export const initMcpSubsystem = async () => {
  await ensureMcpStorage();
  await mcpRegistry.hydrate();
  await mcpSandbox.hydrate();

  const serviceCount = mcpRegistry.list().length;
  const scriptCount = mcpSandbox.list().length;

  console.info(`[MCP] registry 已载入 ${serviceCount} 个服务`);
  console.info(`[MCP] sandbox 已载入 ${scriptCount} 个脚本`);

  if (serviceCount === 0) {
    console.info('[MCP] registry 初始状态为空，可通过 /mcp/registry 注册服务');
  }
  if (scriptCount === 0) {
    console.info('[MCP] sandbox 尚无脚本，可通过 /mcp/sandbox/scripts 注册');
  }
};
