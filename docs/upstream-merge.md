# 合并上游市场

本仓库是 Youth 二开仓库，上游为 `openvetta/vetta-official-marketplace`（远端名 `vetta-marketplace`）。
上游新增的能力默认使用 Vetta 品牌；合并后必须完成下面的品牌与 SDK 适配，再提交。

## 1. 同步与合并

```bash
git fetch vetta-marketplace
git merge vetta-marketplace/main
```

冲突通常集中在 `.vetta/marketplace.source.json`：双方都在 `abilities[]` 末尾追加条目。
保留 Youth 已有条目，把上游新增条目追加进去，**不要整体采纳任何一侧**。

## 2. 品牌适配

上游新增能力的以下文件里，面向用户的产品指称必须改为 Youth：

- `ability.json` 的 `name`、`author`、`detail.i18n.*.name/description`
- `detail.json` / `detail.zh.json`
- `locales/en.json` / `locales/zh.json`
- `plugin.json` 的 `author`
- `README.md`、`AGENTS.md` 与插件内 `agent/**/*.md`
- 源码里直接写死的用户可见文案（如默认搜索词、空状态文案）

如果上游能力的 `slug` / `id` 本身含 `vetta`（如 `vetta-memory`），展示名、侧边栏 label 与页面标题
必须带 Youth 品牌（`Youth Memory` / `Youth 记忆`），不能让用户看到 `vetta`；`slug` 与包名仍保持不变。

保持不动的技术标识：`slug`、包名 `@vetta-marketplace/*`、仓库/文档 URL、环境变量、
`install:vetta` 脚本名、User-Agent 等协议标识。

`tests/marketplace.test.mjs` 的品牌测试会扫描索引、`ability.json`、详情页、locales、
`plugin.json` 与能力文档，遗漏会直接失败。测试夹具里模拟外部搜索结果的 `Vetta` 不算展示文案。

## 3. 版本与 SDK

- 新能力首次上架：保持上游版本，不额外递增。
- 已有能力：只有分发内容变化才递增一次版本，并同步 `ability.json` / `plugin.json` /
  `package.json` / 锁文件与索引条目；规则见根 `AGENTS.md`。
- SDK 升级（`@vetta-org/plugin-sdk`、`plugin-cli`、`plugin-vite`）只改 devDependencies
  与锁文件、不改变分发字节时，不递增能力版本。上游同版本制品的 sha256 在 SDK 升级前后保持不变，
  可用作判断依据。
- 上游新增插件若依赖 npm 尚未发布的 SDK，按该插件 `vendor/README.md` 的说明处理；
  `hongguo-player` 的 0.4.0 是当前唯一例外。

## 4. 校验

```bash
node scripts/marketplace.mjs check
node scripts/marketplace.mjs build
node --test tests/*.test.mjs
```

`build` 会对每个插件执行 `npm ci`、类型检查、插件测试与打包；`.marketplace-build/` 已存在时先删除或换
`--output`。Windows 本地若因 `core.autocrlf=true` 触发 `SKILL.md` 的 LF 断言，
按该测试的期望临时转 LF 验证即可，CI 使用 Linux 不受影响。

推送 `main` 后 `Publish ability marketplace` 会自动发布新能力并推进 GitHub 的 `gh-pages`；
Gitee 镜像不会自动更新，按 [Gitee 镜像手动同步](gitee-mirror-sync.md) 单独同步 `main` 与 `gh-pages`。
