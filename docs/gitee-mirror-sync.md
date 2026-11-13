# Gitee 镜像手动同步

本仓库的发布链路是「GitHub 开发 + Actions 发布」，Gitee 仓库是国内客户端的默认能力来源。
GitHub Actions 只把生成索引推到 GitHub 的 `gh-pages`（发布脚本固定 `git push origin`），
**不会同步 Gitee**；Gitee 由维护者在每次发布后按本文手动同步。

## 仓库与分支

| 远端（本仓库本地命名） | 平台 | 作用 |
| --- | --- | --- |
| `youth-origin` | GitHub `HutchB/youth-official-marketplace` | 源码 `main` + Actions 生成的 `gh-pages` |
| `gitee-youth-official-marketplace` | Gitee `ztq772244/youth-official-marketplace` | 国内分发镜像，客户端默认源 |

客户端默认只启用 Gitee 镜像（GitHub 镜像默认停用），所以 Gitee 落后会直接表现为用户看不到新能力
或新版本。推送 `main` 会触发 Actions，但不会自动更新 Gitee。

## 为什么不能直接 push gh-pages

两边的 `gh-pages` 在 `2026.11.09-1`（`0ca161a`）之后分别生成过发布提交，历史已经分叉：
Gitee 的 tip 不是 GitHub tip 的祖先，普通 `git push` 会被 non-fast-forward 拒绝。

本仓库不使用 force push，而是生成「树同步提交」：以 Gitee 当前 tip 为父提交、GitHub `gh-pages`
的树为内容创建一个新提交。对 Gitee 来说这是快进，不丢历史，也不需要强推。

## 每次发布后的同步步骤

前提：本地已配置两个 remote，且对 Gitee 有推送权限。以下命令在 Git Bash 中执行。

```bash
cd <本仓库>
git fetch youth-origin gitee-youth-official-marketplace

# 1) main：源码快进（GitHub 是事实源）
git push gitee-youth-official-marketplace refs/remotes/youth-origin/main:refs/heads/main

# 2) gh-pages：非 force 的树同步
GITEE_TIP=$(git rev-parse gitee-youth-official-marketplace/gh-pages)
TREE=$(git rev-parse youth-origin/gh-pages^{tree})
SYNC=$(git commit-tree "$TREE" -p "$GITEE_TIP" -m "chore(marketplace): 同步 GitHub gh-pages")
git push gitee-youth-official-marketplace "$SYNC:refs/heads/gh-pages"
```

每次 GitHub 发布后重复一遍即可。第 2 步会基于 Gitee 的最新 tip 生成新的同步提交，所以即使两边
历史继续分叉也不需要 force。

## 校验

```bash
git fetch gitee-youth-official-marketplace

# 两边 gh-pages 的树应完全一致
git rev-parse gitee-youth-official-marketplace/gh-pages^{tree}
git rev-parse youth-origin/gh-pages^{tree}

# 索引版本与能力数量
git show gitee-youth-official-marketplace/gh-pages:.vetta/marketplace.json \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j.marketplaceVersion,j.abilities.length)})"
```

客户端已经缓存旧索引时，在「能力来源」里对 Gitee 源手动刷新一次。

## 注意

- 只在 `main` 上开发；`gh-pages` 是生成分支，不要手工改内容，也不要提交 `dist/`、`node_modules/`。
- 同步前先 `git fetch` 两个远端；Gitee tip 变了会影响第 2 步的父提交。
- 不要为了省事 force push。确实需要让提交哈希完全一致时，必须先确认 Gitee 上的分叉内容可以丢弃。
- `main` 同步被拒说明 Gitee 的 `main` 有本地没有的提交，先核对再处理，不要强推。
