# 浏览器验证范围

整体 UX 调整后，新增 `verify-ux-flow.mjs`，在 Chromium、Firefox 与 Windows WebKit 中验证可见入口、练习、页面内命名、保存取消与失败重试、完成保存、分享关闭后的焦点与画面、Escape 逐层返回及四语尺寸。本地总验证入口为 38 组；详细证据见 `UX_REVIEW.md`。这一结果继续与真实 iOS/Android 设备分开记录。

2026-11-05 复查：Firefox 157 与 Windows WebKit 26 的作品海报均已实际下载并验证为 1200 × 1500 PNG，关闭分享保留作品详情。Firefox 带配乐视频曾因 WebM 仅声明视频编码而失败，本轮加入 Opus 编码候选后，720 × 1280 视频已实际生成、解码并检测画面变化。系统原生分享使用 Chromium API 替身验证，未声称真机分享面板通过。

本轮使用 Windows 无头浏览器和本机 HTTP 站点验证，跨引擎输入采用鼠标。390 像素视口用于检查布局；主验证另含 Chromium 合成触摸手势。手机触感、发热、浏览器工具栏与 Safari/iOS、Android 真机仍待验证。

| 测试引擎 | 驱动 | 落糖与拖动、撤销重做 | PNG、草稿恢复、作品簿与成品 | 竖屏视频 |
| --- | --- | --- | --- | --- |
| Chromium 145.0.7632.6 | 主项目 Playwright 1.58.2 | 通过 | 通过 | 720 × 1280 解码及画面变化通过 |
| Firefox 157.0 | 独立工具 Playwright 1.64.1 | 通过 | 通过 | 720 × 1280 解码及画面变化通过 |
| Playwright WebKit 26.0（Windows 构建） | 主项目 Playwright 1.58.2 | 通过 | 通过 | 该构建未提供录制接口；保留画作和图片回退提示通过 |

WebKit 这一行记录的是 Windows 测试构建，Safari 与 iOS 单独列为待验证。原配套 Firefox 146.0.1 在当前宿主启动时退出，未进入应用页面；没有据此给出该版本的应用兼容结论。补充 Firefox 验证使用独立工具目录，主项目的依赖保持原版本。

## 复现

基础构建与 38 组验证沿用主项目依赖。补充浏览器验证需要 Node.js 20 或更新版本：

```sh
npm ci
npx playwright install chromium webkit
npm run compat:setup
node tools/compat/node_modules/playwright/cli.js install firefox
npm run build
npm run verify:compat
```

也可分别运行：

```sh
npm run verify:browser -- chromium
npm run verify:browser -- firefox --compat-driver
npm run verify:browser -- webkit
```

启动器使用已配置缓存中的配套浏览器；缺失时查找项目 `.cache/browsers`。下载使用项目内的测试目录。测试结果、截图、导出图片和视频写入 `artifacts/compat-*`，测试资料与浏览器缓存均不纳入 Git。

当前宿主上 Firefox/WebKit 的测试需在代理沙箱外运行；测试页面只访问本机临时 HTTP 站点。测试构建与真实设备的结论分别保留。

真机入口与操作记录见 `PHONE-TESTING.md`；预览服务本身的检查不代表真机验收完成。
