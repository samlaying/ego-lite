---
name: xhs-crawler
description: Batch-crawl Xiaohongshu (小红书/RedNote) search results by keyword — extracts title, body, comments, tags, images, engagement per note — and exports validated, deduplicated data to Excel. Built on ego-browser with per-note resume, real-note identity checks, stale-detail rejection, navigation-drift recovery, and automatic login-state reuse from ego lite. Use whenever the user wants to scrape/crawl 小红书 posts, 小红书评论, XHS search results, or batch-collect 小红书数据/选题素材. Requires ego-browser installed and 小红书 logged in. Triggers: 爬取小红书, 小红书评论, XHS 搜索, 批量爬取小红书, 小红书数据采集, 小红书选题.
metadata:
  version: "1.1.0"
  date: "2026-08-07"
---

# xhs-crawler (ego-browser)

批量爬取小红书搜索结果(标题 / 正文 / 评论 / 图片 / 互动),基于 [`ego-browser`](../ego-browser/)。支持多关键词并行、断点续爬、笔记身份校验、重复内容拦截和带质量报告的 Excel 导出。登录态直接复用 ego lite(无需另传 cookie)。

## 前置

1. 已装 ego lite 并完成 onboarding(导入 Chrome 登录态)→ 见 [../ego-browser/references/install.md](../ego-browser/references/install.md)
2. 小红书在 ego lite 里**已登录**(脚本靠继承的登录态访问,不传 cookie)
3. `node`、`python3`、`openpyxl`(`pip install openpyxl`)

## 单关键词

```bash
sh skills/xhs-crawler/scripts/xhs_run.sh "产品经理 需求分析" "需求分析" 15
```

- 参数:`<关键词> <slug> [篇数=20] [folderTag=xhs]`
- 产物:`./xhs_data/<日期>_<folderTag>_<slug>/` 下每篇一个 `<note_id>.json` + `state.json`(断点续爬)+ `crawl.log`
- 每篇 JSON 同时保存 `id` 和经过验证的 `actualId`;若 URL 中出现另一个真实 ID，文件会被拒绝而不是标记完成

## 多关键词并行

每个关键词一个后台进程、一个独立 task space。建议每波 2~3 个关键词，先确认各目录标题和 URL 正常再扩大批次:

```bash
mkdir -p xhs_data
for kw in "需求分析:需求分析" "竞品分析:竞品分析" "用户调研:用户调研"; do
  K="${kw%:*}"; S="${kw#*:}"
  sh skills/xhs-crawler/scripts/xhs_run.sh "产品经理 $K" "$S" 15 &
done; wait
```

> 并发越高越容易触发限流，也越难人工发现异常。监控时不要只看文件数：`crawl.log` 末尾必须出现 `VALIDATION ... invalid=0 duplicate=0`，并抽查不同文件的 `actualId`、标题和 URL。

## 导出汇总 Excel

```bash
python3 skills/xhs-crawler/scripts/xhs_combined_export.py 需求分析 竞品分析 用户调研
# 可选环境变量:XHS_DATA_DIR(默认 ./xhs_data)、XHS_DATE(默认今天)、XHS_FOLDERTAG(默认 xhs)、XHS_OUTTAG
```

一行一篇、多话题合一、不嵌图,适合跨话题分析。导出前会跨话题按真实笔记 ID和强内容指纹去重；ID错配、无标题、重复数据不会进入“全部帖子”，而会写入“质量报告” sheet。

## 数据完整性门禁

- 点击前后详情指纹必须变化，已有的旧 `#detail-title` 不能作为成功信号。
- URL 为 `/explore/<id>` 时，`<id>` 必须与当前卡片 ID完全一致。
- URL 保持在搜索页时，必须检测到可见详情浮层并确认内容发生变化。
- 同时处理 `.preview-modal` 和所有可见 `.note-detail-mask`;关闭失败会重试，不会继续写旧内容。
- 点击导致整页跳转或离开搜索页时，下一次操作会新开搜索页并重新定位虚拟滚动卡片。
- AI 搜索页若出现“DOM 有卡片但全部堆在同一坐标”的惰性布局，会触发一次内存截图完成合成，再验证卡片确实分散且可点击。
- 启动和结束都会审计已有 JSON；旧的 ID错配或重复文件不计入 `done`，可在后续运行中重新抓取。

## 反爬要点(已内置)

- **必须 click 卡片**进笔记——直接 `goto /explore/{id}` 会 404(缺 xsec_token)。
- **优先留在搜索页操作**;检测到 SPA 漂移或卡片未渲染时新开搜索页恢复，不在坏状态上继续点击。
- **过滤广告卡**:真实笔记 id 是 24 位 hex;UUID 格式的 `data-note-id` 是广告/推荐卡,自动跳过。
- **笔记间随机停顿**(3~8s + 15% 概率长停顿)防封。
- **断点续爬**:每篇成功即写 JSON + 更新 state;中断重跑(同参数)自动跳过已完成。

## 限流 / 验证码

连续 `no-title`、`stale-detail` 或 `search-not-ready` 失败通常表示限流、网络波动或页面结构变化。单篇最多重试 3 次；脚本连续 10 篇失败会中止该关键词。稍后用相同参数重跑即可续爬，已验证的文件会跳过，未通过审计的文件不会算作完成。

## 文件

- `scripts/xhs_run.sh` — 单关键词启动器(参数化,路径自动相对脚本目录)
- `scripts/xhs_crawl_body.mjs` — 爬虫主体(被 xhs_run.sh 调用,**勿单独跑**)
- `scripts/xhs_crawl_utils.mjs` — 可测试的数据身份、指纹和磁盘审计逻辑
- `scripts/xhs_combined_export.py` — 轻量汇总 Excel
- `scripts/xhs_export_utils.py` — 导出前的身份校验与跨话题去重逻辑
- `tests/` — 残留详情、ID错配与导出去重回归测试

## 本地自检

```bash
node --test skills/xhs-crawler/tests/xhs_crawl_utils.test.mjs
python3 -m unittest skills/xhs-crawler/tests/test_xhs_export_utils.py
node --check skills/xhs-crawler/scripts/xhs_crawl_body.mjs
```

GitHub Actions 的 `CI` workflow 也会执行这些门禁，防止后续发布重新引入残留详情或去重回归。

## 已知限制

- **视频**:blob URL,无法下载 mp4(只取封面图)。
- **评论**:滚动加载 top 评论(默认 3 轮),不展开全部楼中楼回复。
- **互动数**:`engageNums` 为原始数字数组(未标注赞/藏/评顺序,经验上末位≈评论总数)。
