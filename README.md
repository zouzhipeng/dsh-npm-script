# dsh-npm-script

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web 界面添加一个**悬浮按钮**，点击后按项目分组列出当前工作区下的所有 npm 命令，并可以直接运行、停止、查看输出。

> A floating button for the DeepSeek Harness Web UI that lists every npm script in the current workspace, grouped by project, and runs them with live status and captured output.

## 功能

- **悬浮按钮** — 常驻界面右下角，不占用任何面板空间。
- **按项目分组** — 一个工作区可以有多个项目（monorepo、多个子目录），自动扫描每个 `package.json` 并按项目分组展示脚本。
- **运行状态可见** — 每个命令显示当前状态：**执行中** / **可执行** / **停止中**。常驻命令（如前端 `npm run dev`）会一直保持"执行中"，可以随时停止。
- **输出记录** — 查看命令执行时捕获的 stdout / stderr，运行中可实时轮询刷新。
- **网址可点击** — 输出中出现的 `http://` / `https://` 地址会自动变成链接，点击在浏览器新建标签页打开；面板顶部还会把本次运行出现过的所有地址汇总成一行快捷入口。前端 `npm run dev` 打印的调试地址可以直接点开。
- **中英双语** — 跟随 Harness 的界面语言。

## 安装

需要已安装并运行 DeepSeek Harness。以下两种方式任选其一。

### 方式一：Web 界面

1. 打开 Harness Web 界面，进入侧边栏的 **Plugins**（插件）页面。
2. 在安装输入框中填入：

   ```
   github:zouzhipeng/dsh-npm-script
   ```

3. 确认安装，并确保该 bundle 处于**启用**状态。
4. 刷新页面。

### 方式二：命令行

```sh
dsh plugin --profile web add github:zouzhipeng/dsh-npm-script
```

安装完成后，在 Web 界面的 Plugins 页面启用 **dsh-npm-script** bundle，然后刷新页面。

### 更新

重新执行一次安装即可拉取最新版本：

```sh
dsh plugin --profile web add github:zouzhipeng/dsh-npm-script
```

### 卸载

在 Plugins 页面移除，或执行：

```sh
dsh plugin --profile web remove @zouzhipeng/dsh-npm-script
```

## 使用

1. 点击界面右下角的悬浮按钮，打开命令面板。
2. 面板按项目分组列出所有 `package.json` 中的 `scripts`。
3. 点击命令名开始执行；执行中的命令会显示停止按钮。
4. 点击命令查看它的输出记录。输出里的网址可以直接点击打开。

按 `Esc` 关闭面板；如果正在查看输出，第一次按 `Esc` 会先退回命令列表。

## 工作方式

插件由两半组成：

- **Host 半**（`index.js`）通过 Harness 的 `workspaceRegistry` 解析当前工作区，扫描其中的 `package.json`，并通过 `subprocess` 服务启动脚本。所有 HTTP 路由都限制为仅本机回环访问。
- **Client 半**（`client.js`）通过 `shell.overlay` 插槽渲染悬浮按钮和面板，从 Host 的同源 JSON 路由获取数据。

执行脚本时会注入 `NO_COLOR=1`、`TERM=dumb`、`PAGER=cat`、`GIT_PAGER=cat`，让工具输出纯文本，这样打印出来的地址才能被完整识别为链接。客户端另外会剥离 ANSI 转义序列作为兜底。

## 配置

插件支持以下可选项（在 profile 的 `cordis.yml` 中通过 `config` 覆盖）：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `scanDepth` | `3` | 扫描 `package.json` 的最大目录深度。 |
| `maxOutputBytes` | `262144` | 每个输出流在内存中保留的最大字节数（保留末尾）。 |
| `maxSpillBytes` | `8388608` | 溢出到磁盘的最大字节数。 |
| `graceMs` | `5000` | 停止命令时，等待进程优雅退出的毫秒数，超时后强制终止。 |
| `historyLimit` | `20` | 保留的历史运行记录条数。 |
| `scanCacheMs` | `5000` | 项目扫描结果的缓存毫秒数。 |

## 环境要求

- DeepSeek Harness，profile 为 `web`。
- 仅支持 macOS / Linux / Windows 上 Harness 本身支持的平台。
- 命令来源仅限 `package.json` 的 `scripts` 字段。

## 已知限制

- 输出中仅 `http://` 与 `https://` 地址会被识别为链接（`ws://` 不识别，因为它无法在浏览器中直接打开）。
- 命令列表来自 `package.json` 的 `scripts`，不包含任意 npm 子命令。
- Host 半的代码改动需要重启 `dsh web` 才能生效（Harness 默认不对 Host 侧模块做热加载）；Client 半的改动刷新页面即可。

## 许可

[MIT](LICENSE)
