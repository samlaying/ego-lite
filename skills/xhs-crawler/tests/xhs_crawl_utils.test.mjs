import assert from "node:assert/strict";
import test from "node:test";

import {
  auditStoredNotes,
  canonicalNoteId,
  hasUsableCardLayout,
  validateCapture,
} from "../scripts/xhs_crawl_utils.mjs";

const NOTE_A = "6a3ca3f70000000011006f49";
const NOTE_B = "697e212200000000280212d3";
const SEARCH_URL = "https://www.xiaohongshu.com/search_result?keyword=test";

test("canonicalNoteId extracts a note id only from an explore URL", () => {
  assert.equal(
    canonicalNoteId(
      `https://www.xiaohongshu.com/explore/${NOTE_A}?xsec_token=secret`,
    ),
    NOTE_A,
  );
  assert.equal(canonicalNoteId(SEARCH_URL), "");
  assert.equal(canonicalNoteId("not a url"), "");
});

test("hasUsableCardLayout accepts clickable cards even when their container height is zero", () => {
  assert.equal(
    hasUsableCardLayout([
      { id: NOTE_A, x: 196, y: 217, width: 223, height: 381, hit: true },
      { id: NOTE_B, x: 451, y: 217, width: 223, height: 367, hit: true },
    ]),
    true,
  );
});

test("hasUsableCardLayout rejects collapsed cards stacked at one coordinate", () => {
  assert.equal(
    hasUsableCardLayout([
      { id: NOTE_A, x: 24, y: 144, width: 223, height: 300, hit: false },
      { id: NOTE_B, x: 24, y: 144, width: 223, height: 300, hit: false },
    ]),
    false,
  );
});

test("validateCapture rejects a stale detail that never changed after clicking", () => {
  const stale = {
    url: `https://www.xiaohongshu.com/explore/${NOTE_A}`,
    title: "上一篇残留标题",
    author: "作者",
    desc: "残留正文",
    engageNums: [10, 20, 30],
  };

  assert.deepEqual(
    validateCapture({
      expectedId: NOTE_A,
      before: stale,
      current: { ...stale },
      detailVisible: true,
    }),
    { ok: false, reason: "stale-detail" },
  );
});

test("validateCapture rejects content from a different real note id", () => {
  const result = validateCapture({
    expectedId: NOTE_B,
    before: { url: SEARCH_URL, title: "" },
    current: {
      url: `https://www.xiaohongshu.com/explore/${NOTE_A}`,
      title: "打开了错误的笔记",
      author: "作者",
      desc: "正文",
    },
    detailVisible: true,
  });

  assert.deepEqual(result, {
    ok: false,
    reason: "actual-id-mismatch",
    actualId: NOTE_A,
  });
});

test("validateCapture accepts a changed modal detail when the URL stays on search", () => {
  const result = validateCapture({
    expectedId: NOTE_B,
    before: { url: SEARCH_URL, title: "" },
    current: {
      url: SEARCH_URL,
      title: "新打开的笔记",
      author: "新作者",
      desc: "新正文",
      engageNums: [1, 2, 3],
    },
    detailVisible: true,
  });

  assert.deepEqual(result, { ok: true, actualId: NOTE_B });
});

test("validateCapture does not accept content without a visible detail surface", () => {
  const result = validateCapture({
    expectedId: NOTE_B,
    before: { url: SEARCH_URL, title: "" },
    current: { url: SEARCH_URL, title: "搜索页上的普通标题" },
    detailVisible: false,
  });

  assert.deepEqual(result, { ok: false, reason: "detail-not-open" });
});

test("auditStoredNotes rejects id mismatches and exact duplicate content", () => {
  const audit = auditStoredNotes([
    {
      filenameId: NOTE_A,
      note: {
        id: NOTE_A,
        url: `https://www.xiaohongshu.com/explore/${NOTE_A}`,
        title: "同一标题",
        author: "同一作者",
        desc: "同一正文",
        images: ["https://img.example/a.jpg"],
      },
    },
    {
      filenameId: NOTE_B,
      note: {
        id: NOTE_B,
        url: `https://www.xiaohongshu.com/explore/${NOTE_A}`,
        title: "错误内容",
      },
    },
    {
      filenameId: NOTE_B,
      note: {
        id: NOTE_B,
        url: `https://www.xiaohongshu.com/explore/${NOTE_B}`,
        title: "同一标题",
        author: "同一作者",
        desc: "同一正文",
        images: ["https://img.example/a.jpg"],
      },
    },
  ]);

  assert.deepEqual(audit.validIds, [NOTE_A]);
  assert.deepEqual(
    audit.invalid.map((item) => item.reason),
    ["actual-id-mismatch"],
  );
  assert.deepEqual(
    audit.duplicates.map((item) => item.reason),
    ["duplicate-content"],
  );
});
