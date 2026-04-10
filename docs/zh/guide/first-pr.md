# 给第一次给开源提 PR 的你：从 nexu 的 Good First Issue 开始

如果你用过 **nexu**，或者对「IM + 桌面客户端 + 数字分身」这类产品好奇，欢迎来 GitHub 上，从 **第一个 PR** 开始。

我们正在持续寻找 **Good First Issue 贡献者**。

Good First Issue 不是什么黑话。你可以把它理解成：维护者帮你拆好的一道小题，范围清楚、最好只动一个方向，比如界面、文案、文档，做完能自测、能验收。

## 为什么值得试一次

- **门槛更低**：先从单点、小范围、易验证的问题开始，不需要一上来就理解整套架构。
- **反馈更快**：这类题通常更容易被 review，也更容易拿到第一次正反馈。
- **价值真实**：修一个按钮、改一句提示、补一段教程，都是用户真实会遇到的体验问题。

## 我们在寻找什么样的贡献者

如果你符合下面任意一种情况，都很适合从 `good-first-issue` 开始：

- 想做第一次开源贡献，但还没有提过 PR
- 对产品体验、i18n、文档、前端交互更敏感
- 愿意先从小题切入，边做边熟悉项目
- 愿意公开记录你的自测过程，并与 Reviewer 协作修改

直接查看题目池：

- [Good First Issue 列表](https://github.com/nexu-io/nexu/labels/good-first-issue)
- [GitHub Issues](https://github.com/nexu-io/nexu/issues)
- [贡献指南](/zh/guide/contributing)

## 贡献之后你能获得什么

如果你的贡献被合入，我们会尽量把这件事做成一个完整闭环，而不是只停留在 “PR merge 完了”：

- 你的贡献会进入公开展示与排行榜
- 你的投入会按规则记录积分
- 第一次贡献者会拿到后续参与建议

具体奖励、展示位置和我们会提供的支持，见：

- [贡献奖励与支持](/zh/guide/contributor-rewards)

## 三步，从围观到提交

### 1. 挑题

打开 [Good First Issue 列表](https://github.com/nexu-io/nexu/labels/good-first-issue)，选一条你感兴趣的题目，在 Issue 下留言认领，避免多人撞车。

建议优先挑：

- 文案 / i18n 修正
- 小范围 UI / 交互问题
- 文档补充
- 复现明确、验收清晰的小 Bug

### 2. 读指南、搭环境

正式开发前，先看一遍 [贡献指南](/zh/guide/contributing)。

最少需要：

```bash
git clone https://github.com/nexu-io/nexu.git
cd nexu
pnpm install
```

如果你改的是代码，建议至少跑：

```bash
pnpm lint
pnpm typecheck
pnpm test
```

如果你改的是文档，建议本地预览：

```bash
cd docs
pnpm install
pnpm dev
```

### 3. 提 PR

Fork 仓库，开一个清晰的分支名，在 PR 描述里写清：

- 关联的 Issue 编号
- 改了什么
- 怎么验证
- 如果是 UI 改动，附截图或录屏

合并通过后，就进入致谢、积分和排行榜的后续流程。

## 几个高频小问题

### 我不是资深工程师，可以吗？

可以。Good First Issue 本来就是为了让第一次贡献更顺利而准备的入口。

### 英语不好怎么办？

Issue / PR 中英文团队都会尽量看；文档也有中文版，先把贡献指南读一遍就够。

### 可以用 AI 辅助写代码吗？

可以。建议在 PR 里简单说明是否使用了 AI 辅助，以及你自己做了哪些验证。

### 提了 PR 会没人理吗？

我们会尽量按公开节奏 review；通常 Good First Issue 的反馈会更快，但仍以当时维护者人力为准。

## 写在最后

开源最有意思的一点，是你的改动会留在版本历史里，也会真正被用户用到。

如果你准备好了，就从一条 [Good First Issue](https://github.com/nexu-io/nexu/labels/good-first-issue) 开始。

## Related

- [参与贡献](/zh/guide/contributing) — 正式贡献指南
- [贡献奖励与支持](/zh/guide/contributor-rewards) — 积分、展示位置与支持方式
- [给我们一颗 Star](/zh/guide/star) — 贡献入口的另一个轻量动作
- [GitHub Issues](https://github.com/nexu-io/nexu/issues) — 查看开放问题
- [贡献者激励与积分体系](https://github.com/refly-ai/agent-digital-cowork/blob/main/clone/artifacts/reports/2026-04-09-nexu-contributor-recognition-system.md) — 当前奖励口径来源
