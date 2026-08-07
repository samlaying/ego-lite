#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""轻量汇总 Excel:多话题合一,一行一篇,不嵌图,适合跨话题分析。
用法:
  python3 xhs_combined_export.py <slug1> <slug2> ...
环境变量(均可选):
  XHS_DATA_DIR   输出根目录(默认 ./xhs_data)
  XHS_DATE       日期标签(默认今天, YYYYMMDD)
  XHS_FOLDERTAG  目录标签(默认 xhs)  ->  读 <DATA_DIR>/<DATE>_<FOLDERTAG>_<slug>/
  XHS_OUTTAG     输出文件名标签(默认按 slug 数自动:_全 或 _<slug>)
依赖:openpyxl  (pip install openpyxl)
"""
import json, os, glob, re, sys, datetime
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

BASE = os.environ.get("XHS_DATA_DIR", os.path.join(os.getcwd(), "xhs_data"))
DATE = os.environ.get("XHS_DATE", datetime.date.today().strftime("%Y%m%d"))
FOLDERTAG = os.environ.get("XHS_FOLDERTAG", "xhs")
SLUGS = sys.argv[1:]
if not SLUGS:
    print("用法: python3 xhs_combined_export.py <slug1> <slug2> ...")
    sys.exit(1)
ILLEGAL = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f]')
def clean(v): return ILLEGAL.sub('', v) if isinstance(v, str) else v

wb = Workbook()
ws0 = wb.active; ws0.title = "汇总"
ws0.append(["话题", "篇数", "评论数", "图片数", "均互动(数1/数2/数3)"])
for c in range(1, 6): ws0.cell(row=1, column=c).font = Font(bold=True)

ws = wb.create_sheet("全部帖子")
headers = ["话题", "序号", "note_id", "标题", "作者", "日期", "正文", "标签",
           "互动", "评论数", "评论(前8)", "图片数", "链接"]
ws.append(headers)
for c in range(1, len(headers) + 1):
    ws.cell(row=1, column=c).font = Font(bold=True)
    ws.cell(row=1, column=c).fill = PatternFill(start_color="D6EAF8", end_color="D6EAF8", fill_type="solid")
widths = [10, 5, 26, 32, 14, 12, 60, 22, 16, 7, 50, 7, 14]
for i, w in enumerate(widths, 1):
    ws.column_dimensions[chr(64 + i) if i <= 26 else "M"].width = w
thin = Border(bottom=Side(style='thin', color='DDDDDD'))

total_posts = total_cmts = total_imgs = 0
for slug in SLUGS:
    d = os.path.join(BASE, DATE + "_" + FOLDERTAG + "_" + slug)
    files = [f for f in glob.glob(os.path.join(d, "*.json")) if os.path.basename(f) != "state.json"]
    cmts_n = imgs_n = 0
    eng = [0, 0, 0]; eng_n = 0
    for idx, fp in enumerate(sorted(files), 1):
        with open(fp, encoding="utf-8") as f:
            j = json.load(f)
        e = j.get("engageNums") or []
        cmts = j.get("comments") or []
        cmts_n += len(cmts); imgs_n += len(j.get("images") or [])
        if len(e) >= 3:
            eng[0] += e[0]; eng[1] += e[1]; eng[2] += e[2]; eng_n += 1
        top_cmts = " | ".join(f"{(c.get('name') or '').strip()}:{clean(c.get('content') or '').strip()[:60]}"
                               for c in cmts[:8])
        row = [slug, idx, j.get("id", ""), clean(j.get("title", "")), clean(j.get("author", "")),
               clean(j.get("date", "")), clean(j.get("desc", "")),
               clean(" ".join(j.get("tags") or [])),
               "/".join(str(x) for x in e[:4]), len(cmts), clean(top_cmts),
               len(j.get("images") or []), j.get("url", "")]
        ws.append(row)
        r = ws.max_row
        for c in range(1, len(headers) + 1):
            ws.cell(row=r, column=c).border = thin
            ws.cell(row=r, column=c).alignment = Alignment(vertical="top", wrap_text=(c in (4, 7, 8, 11)))
    avg = [eng[0]//eng_n, eng[1]//eng_n, eng[2]//eng_n] if eng_n else [0,0,0]
    ws0.append([slug, len(files), cmts_n, imgs_n, f"{avg[0]}/{avg[1]}/{avg[2]}"])
    total_posts += len(files); total_cmts += cmts_n; total_imgs += imgs_n

ws0.append(["合计", total_posts, total_cmts, total_imgs, ""])
for c in range(1, 6):
    ws0.cell(row=ws0.max_row, column=c).font = Font(bold=True)
ws.freeze_panes = "A2"

_tag = os.environ.get("XHS_OUTTAG")
if _tag is None:
    _tag = "_全" if len(SLUGS) > 6 else "_" + "_".join(SLUGS)
os.makedirs(BASE, exist_ok=True)
out = os.path.join(BASE, DATE + "_" + FOLDERTAG + "_汇总" + _tag + ".xlsx")
wb.save(out)
print(f"✅ 汇总: {total_posts} 篇 / {total_cmts} 评论 / {total_imgs} 图 → {out}")
print(f"   大小: {os.path.getsize(out)//1024} KB")
