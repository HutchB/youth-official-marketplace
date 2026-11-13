# Vendored plugin SDK

`hongguo-player` 固定使用这里的两份 tgz，而不是 npm registry 上的 `@vetta-org/plugin-sdk`。

## 为什么

- 插件声明 `pluginApiVersion: ^2.11.0`，`src/controller.ts` 使用 `ctx.env.platform`、`ctx.env.paths` 与
  `ctx.processes`（plugin API 2.11.0+）。npm 上 `@vetta-org/plugin-sdk` 最新为 `0.3.12`、
  `@vetta-org/capability-sdk` 最新为 `0.1.3`（2026-11-13 核对），都没有这些类型。
- 本仓库是 Youth 二开仓库，不拥有 `@vetta-org` npm scope，不能代上游发布 0.4.0。因此在它正式发布前，
  依赖以仓库内 tgz 固定，保证本地与 CI 的 `npm ci` 可复现，不依赖私有 registry 或本地路径。

## 文件

| 文件 | 包 | sha256 |
| --- | --- | --- |
| `vetta-org-plugin-sdk-0.4.0.tgz` | `@vetta-org/plugin-sdk@0.4.0` | `71e7d0bfa9d7f6274cc02273fbe78beff1d66f1086679d5e501b777c53bad830` |
| `vetta-org-capability-sdk-0.2.0.tgz` | `@vetta-org/capability-sdk@0.2.0` | `1e561a8f122aba87749544a6718f08e71e94724d9d20f2cdbd59662b9d4a4d5d` |

`tests/marketplace.test.mjs` 的 “Hongguo Player pins its unpublished SDK tarballs to the locked bytes”
会核对 `package.json` 的 `file:` 声明、`package-lock.json` 的版本/路径与 tarball 的 sha512。
替换 tgz 必须同时更新锁文件，否则测试失败。

## 上游发布 0.4.0 后怎么迁回 registry

1. `cd abilities/plugins/hongguo-player`
2. `package.json` 的 `@vetta-org/plugin-sdk` 改为 `^0.4.0`（或更高的稳定版），
   `overrides` 里的 `@vetta-org/capability-sdk` 改为对应 registry 版本。
3. 把 `@vetta-org/plugin-vite` 升到接受 `plugin-sdk@0.4.x` 的版本。0.2.4 的 peer 是
   `>=0.3.7 <0.4.0`，升级前仍需保留 `overrides` 里的 `$@vetta-org/plugin-sdk`；
   升级并确认后删除该 peer 覆盖。
4. 删除本目录，`npm install` 重新生成锁文件，确认
   `npm ls @vetta-org/plugin-sdk @vetta-org/capability-sdk` 不再出现 `file:`。
5. 运行 `npm run check && npm test && npm run build`。根目录测试会在依赖改为 registry 后
   自动跳过 tarball 校验，并要求对应的 vendor 文件已删除。

不要重新打包已安装的 0.4.0 来替换这里的 tgz：锁文件与测试固定的是当前字节，
已发布的 `hongguo-player@0.1.3` 与源码必须保持一致。
