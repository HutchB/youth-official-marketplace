# 插件面板样式开发规范（必读）

这份文档只讲一件事：**插件 UI 用到的样式，必须由插件自己保证可见**。红果短剧插件曾连续踩坑——确认按钮、主按钮在真实宿主里变成「白底白字」完全不可见，排查了四轮才发现是宿主 CSS 覆盖不了插件用到的类。按本文档写，可以一次避开全部同类问题。

## 一、宿主与插件的样式边界（先理解这个，否则一定踩坑）

| 事实 | 后果 |
| --- | --- |
| 宿主只把自己用到的 Tailwind 类编译进全局 CSS | 宿主没用到过的类（如 `bg-red-600`、`text-orange-600`、任意值类 `text-[#fa5028]`）**在运行时不存在** |
| 插件的 `@import "tailwindcss"` 在当前 MF 构建链路下**不产出 utilities**（只产出 theme 变量） | 不要指望「我自己引了 Tailwind 就有类」 |
| 插件 CSS 被包进以插件根为界的 `@scope` | 插件写 `:root`、`html`、`*` 之类的全局选择器不会生效或会污染宿主 |
| 宿主 `<html data-mode="dark">` 在插件 scope 之外 | Tailwind 的 `dark:` 变体匹配不到，明暗只能靠继承的 CSS 变量 |

**结论**：布局类（`flex`、`gap-4`、`rounded-xl`、`p-4`、`text-sm` …）可以放心用——宿主自己的界面在用它们，一定存在；**颜色、背景、描边色这类「宿主可能没用过」的类必须自己兜底**。

## 二、颜色三原则（按优先级）

### 1. 首选：语义 token（跟随主题明暗）

用宿主注入的 CSS 变量，明暗自动适配：

```tsx
className="bg-card text-foreground border-border"
className="text-muted-foreground bg-accent"
```

可用的 token（与宿主主题一致）：`background / foreground / card / popover / primary / secondary / muted / accent / destructive / border / input / ring`，以及配套的 `*-foreground`。

> 如果你确实需要在自己的 CSS 里定义带主题色的语义类，可参考 build-apple-apps 的 `@theme inline` 映射写法（把宿主变量映射成 `bg-card` 这类工具类）。但**优先直接使用宿主的 token 类**，少写自定义 CSS。

### 2. 其次：内联样式表达固定品牌色/强调色

品牌色、危险色等**不随主题变化**的固定色，直接内联——它不依赖任何 CSS 文件，任何宿主都必然生效：

```tsx
// ✅ 危险操作确认按钮
<button style={{ background: "#dc2626", color: "#fff" }}>全部清除</button>

// ✅ 品牌主按钮（白底品牌字）
<button className="rounded-xl bg-white px-6 py-3" style={{ color: "#fa5028" }}>打开</button>

// ✅ 状态点
<span className="h-2.5 w-2.5 rounded-full" style={{ background: running ? "#4ade80" : "#d4d4d4" }} />
```

### 3. 禁止：依赖「宿主不一定有」的 Tailwind 色类

```tsx
// ❌ bg-red-600 / text-orange-600 / text-[#fa5028] / bg-teal-50 —— 宿主没用到就不存在
<button className="bg-red-600 text-white">全部清除</button>

// ❌ 任意值色类在插件构建里也不保证生成
<span className="text-[#fa5028]">…</span>
```

**判断方法**：写完一个颜色类，问自己「宿主的界面里出现过这个颜色吗？」。不确定就当它不存在，改用 token 或内联样式。

## 三、图标规范

| 场景 | 正确做法 |
| --- | --- |
| 插件品牌图标（面板 hero、侧栏、详情页） | 用 `ctx.plugin.iconUrl`（宿主解析好的 `vetta-plugin://` URL，与侧栏同源）——**不要**用相对资源 `new URL("../icon.png", import.meta.url)`，MF 构建下该 URL 在部分实例解析失败，显示 alt 裂图 |
| `plugin.json#icon` 全彩 logo | 配 `registerWorkspaceView({ iconTint: false })`，否则默认被主题前景色 mask 成黑块 |
| 面板内的通用小图标 | 用 Iconify 类（`icon-[solar--xxx]`），宿主 CSS 内含 Iconify 规则 |

```tsx
// ✅ 面板 hero 的品牌图
{iconUrl ? <img src={iconUrl} alt="官方图标" className="h-[84px] w-[84px] rounded-[22px] object-cover" /> : <FallbackLogo />}

// ❌ 不要这样引用包内相对资源
<img src={new URL("../icon.png", import.meta.url).toString()} />
```

## 四、弹窗与确认交互

| 交互 | 规范 |
| --- | --- |
| 二次确认（删除/清空等破坏性操作） | 用**挂在触发按钮上的 Popconfirm 气泡**（`absolute bottom-full right-0`），不要用全屏模态 |
| 为什么不用模态 | 插件 view 的容器（宿主动画层）可能带 `transform`，会让 `position: fixed` 退化为相对容器定位，弹窗偏移到角落 |
| 必须用模态时 | `createPortal(…, document.body)` 挂到 body，并用 `fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2` 居中 |
| 点击气泡外关闭 | 渲染一层透明遮罩 `fixed inset-0 z-40`（低于气泡 `z-50`） |
| 确认按钮可见性 | 红底危险按钮一定用内联样式（见「颜色三原则 2」），否则可能白底白字 |

## 五、文案与 i18n

- 所有用户可见文案走 `useTranslation()` 的 `t("panel.xxx")`，并在 `locales/<lang>.json` 里成对提供。
- **组件内不要写 `%key%` 占位符**——`%key%` 只对宿主渲染的 manifest 字符串（view label、tool label）生效，组件里会被原样显示成裸键。
- 中英文都必须有；缺译时 `t()` 返回裸键，用户会直接看到 `panel.xxx`。

## 六、自检清单（提交前逐项确认）

在真实宿主里（不是浏览器单开 HTML）验证：

- [ ] 所有按钮的文字与背景色都能看清（尤其危险操作的红底按钮、白底品牌按钮）
- [ ] 面板 hero / 侧栏 / 详情页的图标都正常显示，无 alt 裂图
- [ ] 破坏性操作的确认气泡能弹出、能取消、能确认，且**两个按钮都可见**
- [ ] 气泡/弹窗位置正确（不被容器裁剪或偏移）
- [ ] 深浅主题下文字与背景对比度都够（用 token 的自动适配）
- [ ] 切换语言后没有裸 `panel.xxx` 键出现
- [ ] 断开网络/服务出错时，错误提示文字可见（不要用宿主没有的红色类，用内联 `#dc2626`）

## 七、实现记录（别再重复踩）

| 症状 | 根因 | 修复 |
| --- | --- | --- |
| 确认按钮「消失」 | `bg-red-600` 在宿主 CSS 中不存在；插件 Tailwind 不产出 utilities → 白底白字 | 内联 `background:#dc2626; color:#fff` |
| 主按钮空白一片 | 任意值类 `text-[#fa5028]` 未生成 → 白底白字 | 内联 `color` |
| hero 图标显示 alt 文字 | `new URL("../icon.png", import.meta.url)` 在 MF 构建下解析失败 | 改用 `ctx.plugin.iconUrl` |
| 侧栏图标是黑块 | 图片图标默认被主题前景色 mask | `registerWorkspaceView({ iconTint: false })` |
| 弹窗偏到左下角 | `fixed` 被宿主动画容器的 `transform` 降级为相对定位 | 用 Popconfirm 气泡，或 portal 到 body 并 `left-1/2 top-1/2` 居中 |
| 面板整页显示裸键 | 组件里写了 `%panel.xxx%` | 组件内用 `t("panel.xxx")` |
