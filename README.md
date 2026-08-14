# dsh-skill-loader

Per-conversation skill catalog picker for [DeepSeek Harness (dsh)](https://deepseek-harness.github.io/deepseek-harness/): on the new-conversation page, choose which skills get their catalog entries (name + description) **loaded into this conversation** (载入技能清单). Unselected skills are unavailable in that conversation.

每个对话可以选择要**载入的技能清单**（name + description）。

## 功能

- 新建对话的开始页，「工作目录」「agent 预设」chip 旁新增「技能清单」chip；对话开始后自动消失。
- 勾选的 skill 会把其清单条目载入本对话：模型看到的技能目录（`<available_skills>`）只包含勾选的技能。
- 未勾选的 skill 在本对话**不可用**：
- 没有做过选择的对话保持 dsh 默认行为（全部载入）。
- 选择状态以 `skill-loader/selection` 日志事件持久化，刷新/重启后依然准确。

> 位置说明：开始页那一行是内置 UI 里硬编码的 JSX，只声明了两个 single 槽位（均被内置选择器占用），插件无法在其中声明第三个槽位。本插件因此在该行内**追加自己的 chip 节点**并用 react-dom 渲染（锚点：`[data-phase="hero"]` 内的 `button[aria-haspopup="menu"]`，由 MutationObserver 在 React 重挂载后自动恢复），仅当当前会话处于 blank（未开始对话）时出现。

## 命令

| 命令 | 说明 |
|---|---|
| `/skill-select <name1,name2,...>` | 将本对话的技能清单设为这些技能（逗号分隔；无参数=清空） |

## 实现要点

- 宿主端零依赖（仅 `node:crypto`），`link:` 安装可直接启动。
- 目录接管：宿主 `agent/pre-step` 监听器在 dsh-tool-skill 之后运行，丢弃其未过滤目录并发布自己的过滤目录（沿用 `skill-catalog` 来源与 `source.entries` 格式，保证 dsh 自带的历史/摘要逻辑一致，避免每轮重发）。
- 拦截：`tools/pre-execute` 瀑布拒绝未选技能的 `skill` 调用；手势注入按选择过滤。

## 安装

从 GitHub 安装（推荐）：

```sh
dsh plugin --profile <profile> add https://github.com/<user>/dsh-skill-loader.git
```

或从本地目录安装：

```sh
dsh plugin --profile <profile> add ./dsh-skill-loader
```

安装后重启该 profile 的 dsh（已安装插件不做热加载）。

（注：`dsh plugin add` 不能处理含空格的路径；路径含空格时请直接编辑 profile 的 package.json 依赖 + `dsh.profile.bundles` 后运行 `pnpm install`。）

## License

[MIT](./LICENSE)
