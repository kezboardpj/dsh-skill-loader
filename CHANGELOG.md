# 更新日志

## 0.2.0（2026-08-15）

**问题**：勾选技能后重启 dsh，再打开该会话报 `SessionFormatUnsupportedError`（历史加载失败）。原因是 0.1 把选择状态写成了自定义会话事件 `skill-loader/selection`，而 dsh 的日志加载器不认识未知事件类型（当前版本也未提供第三方插件注册自定义事件的接口），于是拒绝解析整份会话日志。

**解决**：选择状态改存 dsh 官方 settings（`$DSH_HOME/settings.yaml` 的 `skill-loader` 命名空间），不再写任何自定义日志事件；宿主端新增 `@deepseek-ai/dsh-settings`、`@deepseek-ai/schemastery` 依赖，安装方式推荐从 GitHub 安装。受影响的旧会话日志可用修复脚本给旧事件补上 `ignorable` 标记后恢复读取。

## 0.1.0（2026-08-14）

首个版本：新建对话开始页的「技能清单」chip，按对话选择载入的技能目录（name + description）；未选中的技能在该对话不可用（模型目录、`/名称` 手势、`skill` 工具三层拦截）。

期间修复的小问题：

- 勾选时报 `cannot get property "remote.commands" without inject` → 客户端 `inject` 补上 `remote.commands`；
- 连续勾选在对话里产生多条记录 → 勾选合并为一条命令、结果文案缩短；
- 面板滚轮下滑时自动缩回 → 移除滚动关闭逻辑；
- chip 样式与内置 chip 不一致（有描边、悬停高亮偏大）→ 样式对齐内置 chip。
