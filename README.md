# dsh-plugins

第三方 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）插件集合。插件通过 dsh 的 profile 机制加载：`dsh plugin --profile web add <package>` 安装，`~/.dsh/profiles/web/cordis.patch.yml` 挂载，无需修改 dsh 本体。

## 一键部署（Docker）

只需要 Docker 和 curl，一行命令拉起带访问密钥门禁的 dsh web：

```sh
curl -fsSL https://raw.githubusercontent.com/Night-stars-1/dsh-plugins/main/deploy.sh | bash
```

启动后会打印访问地址（默认 http://localhost:8080）和自动生成的**访问密钥**。配置在 `~/dsh-web/.env`（把 `DEEPSEEK_API_KEY` 填上才能聊天），改完执行 `bash deploy.sh restart` 生效。

管理命令（把脚本存到本地后执行，或用 `| bash -s -- <子命令>` 形式）：

```sh
bash deploy.sh            # 启动 / 首次部署
bash deploy.sh down       # 停止（数据保留）
bash deploy.sh restart    # 重启（应用 .env 修改）
bash deploy.sh logs       # 查看日志
bash deploy.sh status     # 状态 + 健康检查
bash deploy.sh update     # 更新构建文件并重建
bash deploy.sh destroy    # 移除容器和全部数据
```

构建文件的唯一权威在 [`docker/`](docker/)；`deploy.sh` 运行时从那里下载，dsh 与插件本体从 npm 安装。

## 插件

| 插件 | npm | 说明 |
|---|---|---|
| [`dsh-auth/`](dsh-auth/README.zh.md) | [`@night-stars-1/dsh-host-auth`](https://www.npmjs.com/package/@night-stars-1/dsh-host-auth) | Web GUI 访问密钥门禁：`/login` 密钥登录、`/api` 会话门禁、多密钥管理（备注 + 最后使用时间）、设置面板管理界面 |

每个插件目录自带构建与测试（`pnpm install && pnpm run build && pnpm test`），依赖全部来自 npm registry，不需要本地的 deepseek-harness 检出。

## 鸣谢

[LINUX DO](https://linux.do/)提供的交流社区
