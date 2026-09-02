#!/bin/sh
# Launch one XHS keyword crawl via ego-browser (stdin mode).
# Usage: sh xhs_run.sh "<keyword>" "<slug>" [target] [folderTag]
#   target    默认 20     每个关键词爬多少篇
#   folderTag 默认 xhs    输出目录标签 -> xhs_data/<日期>_<folderTag>_<slug>/
# Env:
#   XHS_DATA_DIR     输出根目录(默认 ./xhs_data)
#   XHS_DATE         日期标签(默认今天, YYYYMMDD)
#   XHS_SEARCH_PATH  搜索路径(默认 search_result; AI 搜索页用 search_result_ai)
# Requires: ego-browser installed + ego lite logged into 小红书.
#
# 为什么用 stdin 模式 + 拼接:ego-browser 会过滤自定义环境变量(process.env 读不到),
# 且 `ego-browser nodejs <file>` 文件模式会挂起;所以用 node 生成一行 const 参数声明,
# 拼上 body,再管道喂给 `ego-browser nodejs`(stdin 模式才可靠)。
KW="$1"; SLUG="$2"; TARGET="${3:-20}"; FT="${4:-xhs}"
SEARCH_PATH="${XHS_SEARCH_PATH:-search_result}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BODY="${SCRIPT_DIR}/xhs_crawl_body.mjs"
UTIL="${SCRIPT_DIR}/xhs_crawl_utils.mjs"
BASE="${XHS_DATA_DIR:-$PWD/xhs_data}"
DATE="${XHS_DATE:-$(date +%Y%m%d)}"
PL="/tmp/_xhs_pl_$$.js"
case "$TARGET" in
  ''|*[!0-9]*|0)
    echo 'Usage: xhs_run.sh "<keyword>" "<slug>" [positive-target] [folderTag]' >&2
    exit 2
    ;;
esac
if [ -z "$KW" ] || [ -z "$SLUG" ]; then
  echo 'Usage: xhs_run.sh "<keyword>" "<slug>" [positive-target] [folderTag]' >&2
  exit 2
fi
trap 'rm -f "$PL"' EXIT HUP INT TERM
node -e 'process.stdout.write(`const KW=${JSON.stringify(process.argv[1])}, SLUG=${JSON.stringify(process.argv[2])}, TARGET=${process.argv[3]|0}, BASE=${JSON.stringify(process.argv[4])}, DATE=${JSON.stringify(process.argv[5])}, FOLDERTAG=${JSON.stringify(process.argv[6])}, UTIL=${JSON.stringify(process.argv[7])}, SEARCH_PATH=${JSON.stringify(process.argv[8])};\n`)' \
  "$KW" "$SLUG" "$TARGET" "$BASE" "$DATE" "$FT" "$UTIL" "$SEARCH_PATH" > "$PL"
cat "$PL" "$BODY" | ego-browser nodejs
rc=$?
exit $rc
