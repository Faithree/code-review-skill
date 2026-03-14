# Code Review Skill for Cursor

让 Cursor AI Agent 按照你的团队规范执行结构化 Code Review。

支持审查本地 git diff 和远程 GitHub PR，输出带严重等级标签的逐文件反馈，并可由 Agent 自动修复。

## 特性

- **7 步审查流程**：获取变更 → 变更摘要 → 影响点评估 → 架构评估 → 逐文件审查 → 格式化输出 → 自动修复
- **严重等级标签**：`[Required]` / `[Optional]` / `[Question]` / `[FYI]`，清晰区分阻断项和建议项
- **代码定位**：每条反馈附带文件路径和行号，可在 IDE 中直接点击跳转
- **自动修复**：审查完成后 Agent 可根据用户选择自动实施代码修改
- **知识积累**：通过辅助脚本拉取团队历史 Review 评论，让 AI 学习团队审查风格
- **可定制**：规则、Blocking 清单、自查清单均可按团队需要自行调整

## 目录结构

```
code-review/
├── README.md          # 操作手册
├── SKILL.md           # Skill 定义 — Agent 的审查工作流和输出格式
├── RULES.md           # 审查规则 — 9 大分类的适用场景
├── review-log.md      # 审查日志 — 脚本拉取的历史评论（AI 学习素材）
└── scripts/
    └── fetch-pr-comments.mjs  # 辅助脚本 — 拉取 GitHub PR Review 评论
```

## 安装

将本目录复制到你项目的 `.cursor/skills/code-review/` 下：

```bash
cp -r code-review/ <你的项目>/.cursor/skills/code-review/
```

确保最终结构为：

```
<你的项目>/
└── .cursor/
    └── skills/
        └── code-review/
            ├── SKILL.md
            ├── RULES.md
            ├── review-log.md
            └── scripts/
                └── fetch-pr-comments.mjs
```

## 使用方法

### 触发审查

在 Cursor 对话中输入类似指令，Agent 会自动识别并执行：

```
帮我 review 一下当前的代码改动
```

```
review 这个 PR：https://github.com/owner/repo/pull/123
```

```
审查一下 feat/xxx 分支相对于 main 的变更
```

### 前置条件

**本地 diff**：无额外要求，Agent 直接通过 `git diff` 读取。

**远程 PR**：需启用 GitHub MCP Server（Cursor Settings → MCP → 添加 GitHub MCP Server）。

### 审查输出

Agent 按以下结构输出审查结果：

1. **变更摘要** — 目标、核心改动、动机、波及面
2. **影响点评估** — 对已有系统的影响范围和回归风险
3. **架构评估** — 整体设计是否合理
4. **逐文件反馈** — 带等级标签、代码定位、三段式描述（问题 → 原因 → 建议）
5. **Next Steps** — 选择修复方案（全部修复 / 仅 Required / 指定修复 / 仅审查）

选择修复方案后，Agent 自动实施代码修改并运行检查。

### 严重等级

| 标签 | 含义 | 是否阻断合并 |
|------|------|-------------|
| `[Required]` | 必须修改 | 是 |
| `[Optional]` | 建议改进 | 否 |
| `[Question]` | 需要澄清 | 澄清后可能升级 |
| `[FYI]` | 信息同步 | 否 |

## 定制

### RULES.md — 审查规则

包含 9 个分类的适用场景描述，按需修改以匹配你的项目：

1. 类型安全
2. 模块与边界
3. 组件与交互
4. 请求与状态
5. 样式与主题
6. 命名与结构
7. 错误处理与安全
8. 数据展示
9. 测试

你可以为每个分类补充具体的 Do's / Don'ts 规则，或删除不适用的分类。

### SKILL.md — 审查流程

定义了 7 步工作流和输出格式。可调整的部分：

- **约束** — 填写你团队的硬性限制
- **Blocking 清单** — 定义哪些问题始终阻断合并
- **作者自查清单** — 定义 PR 提交前的检查项
- **输出模板** — 调整审查结果的展示结构

## 辅助脚本：拉取历史评论

### 作用

`fetch-pr-comments.mjs` 从 GitHub 拉取指定仓库的 PR Review 评论，写入 `review-log.md`。

AI Agent 审查时可参考这些历史评论，学习团队的关注点和常见问题模式。积累越多，审查质量越贴近团队标准。

### 运行

```bash
GITHUB_TOKEN=ghp_xxxxxxxxxxxx node .cursor/skills/code-review/scripts/fetch-pr-comments.mjs \
  --owner <组织或用户名> \
  --repo <仓库名>
```

### 参数

| 参数 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `--owner` | 是 | — | GitHub 组织或用户名 |
| `--repo` | 是 | — | 仓库名 |
| `--since` | 否 | 6 个月前 | 起始日期（YYYY-MM-DD） |
| `--until` | 否 | 今天 | 截止日期（YYYY-MM-DD） |
| `--output` | 否 | `./review-log.md` | 输出文件路径 |
| `--delay` | 否 | `250` | 请求间隔毫秒数 |
| `--help` | — | — | 显示帮助信息 |

### 示例

```bash
# 默认拉取最近 6 个月
GITHUB_TOKEN=ghp_xxx node scripts/fetch-pr-comments.mjs --owner my-org --repo my-repo

# 指定日期范围
GITHUB_TOKEN=ghp_xxx node scripts/fetch-pr-comments.mjs \
  --owner my-org --repo my-repo \
  --since 2025-01-01 --until 2025-06-30

# 指定输出路径
GITHUB_TOKEN=ghp_xxx node scripts/fetch-pr-comments.mjs \
  --owner my-org --repo my-repo \
  --output ./my-review-log.md
```

### 建议

- **定期运行**：每月或每个迭代结束后运行一次，保持日志时效性
- **敏感信息**：如日志含敏感内容，加入 `.gitignore`
- **Rate Limit**：PR 数量多（> 200）时，增大 `--delay` 到 500ms

## FAQ

**Agent 没有自动识别到 Skill？**
确认 `SKILL.md` 在 `.cursor/skills/code-review/SKILL.md` 路径下，Cursor 根据 `description` 字段自动匹配。

**远程 PR 审查报错？**
检查是否已启用 GitHub MCP Server。无 MCP 时 Agent 无法读取远程 PR。

**review-log.md 太大？**
缩小日期范围，或将旧日志归档为 `review-log-archive.md`。

**脚本报 401 / 403？**
401 = Token 无效或过期；403 = 触发 Rate Limit，增大 `--delay` 或等待重置。

## License

MIT
