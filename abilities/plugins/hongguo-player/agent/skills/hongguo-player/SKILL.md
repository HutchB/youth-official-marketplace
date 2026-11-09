---
name: hongguo-player
description: Launch and manage the Hongguo short-drama desktop player on Windows — open/close the player, check running state, clean its cache, or wipe all local data. Use when the user wants to watch short dramas (刷剧/看短剧) or manage the player's data.
---

# 红果短剧播放器（hongguo-player）

用户想在电脑上刷红果短剧，或管理播放器的数据时使用本工具集。播放器是独立桌面窗口
（Windows），本工具负责启动、停止、状态与数据管理。

## 工具清单

| 场景（用户可能的说法） | 工具 |
| --- | --- |
| 「打开红果 / 我想看短剧 / 刷剧」 | `hongguo_launch（首次启动会自动从官方 release 下载播放器约 27 MB，进度在面板可见；下载完成前请告知用户稍候）` |
| 「关掉红果 / 看完了」 | `hongguo_stop` |
| 「红果开着吗」 | `hongguo_status` |
| 「清理红果缓存 / 太占磁盘了」 | `hongguo_clean_cache`（默认浅清理） |
| 「清除红果全部数据 / 重置」（必须先向用户确认！） | `hongguo_clean_cache` 传 `deep: true` |
| 「打开红果的数据文件夹」 | `hongguo_open_data_dir` |

## 使用规则

1. **deep 清理不可逆**：会退出登录、清空收藏与观看历史。即使用户语气急促，也必须先
   复述后果并得到确认才执行。
2. 浅清理（默认）只清 WebView 缓存与更新包缓存，安全，可直接执行。
3. 启动是幂等的：已在运行不会重复开窗口，可直接调用。
4. 首次启动可能自动安装 WebView2/HEVC 系统组件（需联网），启动后黑屏/无画面属于正常
   的依赖安装过程，不要反复重启；用户反馈「有声音没画面」时提示安装 HEVC 扩展。
5. 不要用 shell 命令自己操作播放器进程——统一走上述工具，保证权限与进程语义一致。

## 播放器内的界面操作（搜索 / 选剧 / 登录等）

用户要求「在里面搜 X / 帮我点开某剧 / 登录」时，**禁止使用 computer-use（截屏+坐标
点击+模拟键鼠）**——它会真实抢占用户的鼠标键盘和前台窗口，用户正在打字会被打断。

首选方式：cua-driver 插件的工具（`cua_list_windows` → `cua_window_state` →
`cua_click`/`cua_type_text`/`cua_press_key`）——基于系统无障碍树，后台投递、
不碰用户鼠标键盘，操作期间宿主顶部显示 AI 操作提示条。

次选方式（cua-driver 不可用时）：`ctx.uiAutomation`（`system.uiAutomation.manage`
权限，Windows 专属，同样基于无障碍树按控件名操作）：

```ts
const ui = ctx.uiAutomation;
const IMG = "红果短剧.exe";

// 1. 读界面状态：拿到全部控件的名称/类型/坐标
const nodes = await ui.query({ processName: IMG });

// 2. 按控件可见文本点击（如进入「找剧」、点搜索按钮）
await ui.click({ processName: IMG, name: "找剧" });

// 3. 往输入框填关键词（ValuePattern 直写，无需点击聚焦、无需剪贴板）
await ui.setValue({ processName: IMG, name: "输入剧名 / 关键词", value: "凡人修仙传" });

// 4. 读搜索结果文本，向用户复述找到了什么
const text = await ui.readText(IMG);
```

要点：
- 先 `readText`/`query` 看清界面再操作，不要盲点。
- 控件名以 `query` 返回的 `name` 为准（界面文案可能变化，不要凭记忆硬编码）。
- `click` 返回 `false`（控件不支持无障碍 pattern）时，才降级提示用户改用
  computer-use 或手动操作。
- 若 `ctx.uiAutomation` 为 `undefined`（旧宿主），提示用户升级 Youth，**不要**自行
  改用截屏点击方案。
