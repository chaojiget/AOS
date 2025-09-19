# API Config 注入修复（2025-02-19）

## 背景
- `pnpm dev:api` 期间报错 `Cannot read properties of undefined (reading 'databasePath')`，导致 Nest API 退回内存数据库模式。
- 问题源于开发态运行时 `ApiConfigService` 注入未生效，`DatabaseService` 构造函数获取到 `undefined`。

## 处置
- 在 `DatabaseService`、`RunsService`、`ApiKeyGuard` 中显式使用 `@Inject(ApiConfigService)` 确保依赖解析。
- `DatabaseModule` 增加对 `ApiConfigModule` 的导入，避免装配顺序导致的跨模块可见性问题。
- 通过 `pnpm lint`、`pnpm typecheck` 验证变更未破坏现有检查。

## 遗留与风险
- `pnpm build:api` 仍因 NodeNext/路径扩展配置报错，属于既有技术债务，需要后续修复。
- 需评估其他 Service/Guard 是否存在类似注入隐患，建议后续补充集成测试覆盖。

