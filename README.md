# dsh-skill-loader

Per-conversation skill catalog picker for [DeepSeek Harness (dsh)](https://deepseek-harness.github.io/deepseek-harness/): on the new-conversation page, choose which skills get their catalog entries (name + description) **loaded into this conversation** (载入技能清单). Unselected skills are unavailable in that conversation.

每个对话可以选择要**载入的技能清单**（name + description）。

## 功能

- 新建对话的开始页，「工作目录」「agent 预设」chip 旁新增「技能清单」chip；对话开始后自动消失。
- 勾选的 skill 会把其清单条目载入本对话：模型看到的技能目录（`<available_skills>`）只包含勾选的技能。
- 未勾选的 skill 在本对话**不可用**（模型目录、`/名称` 手势与 `skill` 工具都会拒绝）。
- 没有做过选择的对话保持 dsh 默认行为（全部载入）。
- 选择状态存储在 dsh settings（`skill-loader` 命名空间，`$DSH_HOME/settings.yaml`），刷新/重启后依然准确。

> 位置说明：开始页那一行是内置 UI 里硬编码的 JSX，只声明了两个 single 槽位（均被内置选择器占用），插件无法在其中声明第三个槽位。本插件因此在该行内**追加自己的 chip 节点**并用 react-dom 渲染（锚点：`[data-phase="hero"]` 内的 `button[aria-haspopup="menu"]`，由 MutationObserver 在 React 重挂载后自动恢复），仅当当前会话处于 blank（未开始对话）时出现。

## 命令

| 命令 | 说明 |
|---|---|
| `/skill-select <name1,name2,...>` | 将本对话的技能清单设为这些技能（逗号分隔；无参数=清空） |

## 实现要点

- 目录接管：宿主 `agent/pre-step` 监听器在 dsh-tool-skill 之后运行，丢弃其未过滤目录并发布自己的过滤目录（沿用 `skill-catalog` 来源与 `source.entries` 格式，保证 dsh 自带的历史/摘要逻辑一致，避免每轮重发）。
- 拦截：`tools/pre-execute` 瀑布拒绝未选技能的 `skill` 调用；手势注入按选择过滤。
- 选择状态写入 dsh settings（`$DSH_HOME/settings.yaml`），不写自定义会话事件类型——该 dsh 版本会因未知事件类型拒绝加载会话日志（`SessionFormatUnsupportedError`）。

## 安装

> `<profile>` 是占位符：换成你的 profile 名（Web 界面默认是 `web`；可用 `dsh --profile <name>` 启动指定 profile）。

从 GitHub 安装（推荐）：

```sh
dsh plugin --profile web add https://github.com/kezboardpj/dsh-skill-loader.git
```

或从本地目录安装：

```sh
dsh plugin --profile web add ./dsh-skill-loader
```

安装后重启该 profile 的 dsh（已安装插件不做热加载）。

（注：`dsh plugin add` 不能处理含空格的路径；路径含空格时请直接编辑 profile 的 package.json 依赖 + `dsh.profile.bundles` 后运行 `pnpm install`。）

## 从 0.1 升级

全新安装的用户直接执行上面的安装命令即可，装到的就是 0.2.0。已安装 0.1 的用户按以下顺序升级（全程 dsh 保持停止）：

1. 运行修复脚本，让被 0.1 写坏的历史会话日志恢复可读（原文件自动备份为 `.bak`；脚本是幂等的，没有受影响日志时直接输出 nothing to repair。从未在 0.1 里勾选过技能、没有产生过 `skill-loader/selection` 事件的用户可以跳过这一步，其余用户跳过会导致旧会话升级后仍然打不开）：

   ```sh
   node scripts/repair-v01-logs.mjs
   ```

2. 更新插件本身（git 依赖更新到最新提交，自动装上新依赖）：

   ```sh
   cd <你的 profile 目录>
   pnpm update dsh-skill-loader
   ```

3. 重启 dsh。

注意：0.1 是用本地目录（link）安装的用户需要改为 Git 安装（0.2 的宿主端有依赖，link 安装的裸目录无法解析）；另外修复后的旧会话中 0.1 时期的选择不再生效，会回到默认「全部载入」，重新勾选即可。

## 更新日志

### 0.2.0（2026-08-15）

**问题**：勾选技能后重启 dsh，再打开该会话报 `SessionFormatUnsupportedError`（历史加载失败）。原因是 0.1 把选择状态写成了自定义会话事件 `skill-loader/selection`，而 dsh 的日志加载器不认识未知事件类型（当前版本也未提供第三方插件注册自定义事件的接口），于是拒绝解析整份会话日志。

**解决**：选择状态改存 dsh 官方 settings（`$DSH_HOME/settings.yaml` 的 `skill-loader` 命名空间），不再写任何自定义日志事件；宿主端新增 `@deepseek-ai/dsh-settings`、`@deepseek-ai/schemastery` 依赖，安装方式推荐从 GitHub 安装。受 v0.1 影响的旧会话日志可用仓库内的修复脚本 [`scripts/repair-v01-logs.mjs`](scripts/repair-v01-logs.mjs) 恢复（dsh 停止后运行，给旧事件补 `ignorable` 标记，原文件自动备份为 `.bak`）。

## License

[MIT](./LICENSE)
