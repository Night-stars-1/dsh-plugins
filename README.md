# dsh-plugins

第三方 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）插件集合。插件通过 dsh 的 profile 机制加载：`dsh plugin --profile web add <package>` 安装，`~/.dsh/profiles/web/cordis.patch.yml` 挂载，无需修改 dsh 本体。

| 插件 | 说明 |
|---|---|
| [`dsh-auth/`](dsh-auth/README.zh.md) | Web GUI 访问密钥门禁：`/login` 密钥登录、`/api` 会话门禁、多密钥管理（备注 + 最后使用时间）、设置面板管理界面 |

每个插件目录自带构建与测试（`pnpm install && pnpm run build && pnpm test`），依赖全部来自 npm registry，不需要本地的 deepseek-harness 检出。
