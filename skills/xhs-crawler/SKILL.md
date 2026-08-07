---
name: xhs-crawler
description: Batch-crawl Xiaohongshu (小红书/RedNote) search results by keyword — extracts title, body, comments, tags, images, engagement per note — and exports to Excel. Built on the ego-browser skill runs many keywords in PARALLEL across isolated task spaces, with per-note resume, anti-detection handling (clicks cards for xsec_token, stays on the SPA search page, filters ad cards), and automatic login-state reuse from ego lite. Use whenever the user wants to scrape/crawl 小红书 posts, 小红书评论, XHS search results, or batch-collect 小红书数据/选题素材. Requires ego-browser installed and 小红书 logged in. Triggers: 爬取小红书, 小红书评论, XHS 搜索, 批量爬取小红书, 小红书数据采集, 小红书选题.
metadata:
  version: "1.0.0"
  date: "2026-08-06"
---

# xhs-crawler (ego-browser)

批量爬取小红书搜索结果(标题 / 正文 / 评论 / 图片 / 互动),基于 [`ego-browser`](../ego-browser/)。多关键词**并行**、**断点续爬**、反爬处理、Excel 导出。登录态直接复用 ego lite(无需另传 cookie)。

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

## 多关键词并行(推荐)
每个关键词一个后台进程、一个独立 task space,真并行(后台进程才真并行,前台调用会被串行化):
```bash
mkdir -p xhs_data
for kw in "需求分析:需求分析" "竞品分析:竞品分析" "用户调研:用户调研"; do
  K="${kw%:*}"; S="${kw#*:}"
  sh skills/xhs-crawler/scripts/xhs_run.sh "产品经理 $K" "$S" 15 &
done; wait
```
> 经验:**5~6 路并行较稳;10 路以上容易触发小红书限流**,建议分波(如 5+5)。监控进度直接看各目录的 `state.json`/`crawl.log`(后台 stdout 有缓冲,task 输出会延迟)。

## 导出汇总 Excel
```bash
python3 skills/xhs-crawler/scripts/xhs_combined_export.py 需求分析 竞品分析 用户调研
# 可选环境变量:XHS_DATA_DIR(默认 ./xhs_data)、XHS_DATE(默认今天)、XHS_FOLDERTAG(默认 xhs)、XHS_OUTTAG
```
一行一篇、多话题合一、不嵌图,适合跨话题分析。

## 反爬要点(已内置)
- **必须 click 卡片**进笔记——直接 `goto /explore/{id}` 会 404(缺 xsec_token)。
- **留在搜索页操作**,不重新导航(SPA 重新导航会导致卡片不渲染)。
- **过滤广告卡**:真实笔记 id 是 24 位 hex;UUID 格式的 `data-note-id` 是广告/推荐卡,自动跳过。
- **笔记间随机停顿**(3~8s + 15% 概率长停顿)防封。
- **断点续爬**:每篇成功即写 JSON + 更新 state;中断重跑(同参数)自动跳过已完成。

## 限流 / 验证码
连续 `no-title` 失败通常是限流或网络波动(不是登录态丢失)。脚本连续 4 次失败会自动中止该关键词;稍后重跑 `xhs_run.sh`(同参数)即可续爬。若全部关键词同时开始失败,大概率是账号被风控,建议暂停一段时间或降并发。

## 文件
- `scripts/xhs_run.sh` — 单关键词启动器(参数化,路径自动相对脚本目录)
- `scripts/xhs_crawl_body.mjs` — 爬虫主体(被 xhs_run.sh 调用,**勿单独跑**)
- `scripts/xhs_combined_export.py` — 轻量汇总 Excel

## 已知限制
- **视频**:blob URL,无法下载 mp4(只取封面图)。
- **评论**:滚动加载 top 评论(默认 3 轮),不展开全部楼中楼回复。
- **互动数**:`engageNums` 为原始数字数组(未标注赞/藏/评顺序,经验上末位≈评论总数)。
