// Shared crawler body. xhs_run.sh prepends KW, SLUG, TARGET, BASE, DATE,
// FOLDERTAG and UTIL because ego-browser intentionally filters custom env vars.
const fs = await import("node:fs");
const path = await import("node:path");
const { pathToFileURL } = await import("node:url");
const {
  auditStoredNotes,
  contentFingerprint,
  hasUsableCardLayout,
  validateCapture,
} = await import(pathToFileURL(UTIL).href);

const DIR = path.join(BASE, DATE + "_" + FOLDERTAG + "_" + SLUG);
const LOGF = path.join(DIR, "crawl.log");
const SP = path.join(DIR, "state.json");
const SEARCH_URL =
  "https://www.xiaohongshu.com/" +
  SEARCH_PATH +
  "?keyword=" +
  encodeURIComponent(KW) +
  "&source=web_explore_feed";
const SPACE_NAME = "xhs-" + SLUG;
const NOTE_FILE_RE = /^([0-9a-f]{24})\.json$/i;

fs.mkdirSync(DIR, { recursive: true });

function log(message) {
  const line = "[" + SLUG + "] " + message;
  cliLog(line);
  try {
    fs.appendFileSync(LOGF, line + "\n");
  } catch {}
}

function atomicJson(file, value) {
  const temp = file + ".tmp-" + process.pid;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  fs.renameSync(temp, file);
}

let st = { keyword: KW, target: TARGET, done: [], failed: [] };
try {
  st = { ...st, ...JSON.parse(fs.readFileSync(SP, "utf8")) };
} catch {}
st.done = Array.isArray(st.done) ? st.done : [];
st.failed = Array.isArray(st.failed) ? st.failed : [];

function readStoredRecords() {
  const records = [];
  for (const name of fs.readdirSync(DIR)) {
    const match = name.match(NOTE_FILE_RE);
    if (!match) continue;
    try {
      records.push({
        filenameId: match[1].toLowerCase(),
        note: JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8")),
      });
    } catch {
      records.push({ filenameId: match[1].toLowerCase(), note: {} });
    }
  }
  return records;
}

function auditDisk() {
  return auditStoredNotes(readStoredRecords());
}

function saveState() {
  st.keyword = KW;
  st.target = TARGET;
  atomicJson(SP, st);
}

function recordFailure(id, reason, attempts, actualId = "") {
  st.failed = st.failed.filter((item) => item.id !== id);
  st.failed.push({ id, reason, attempts, ...(actualId ? { actualId } : {}) });
  saveState();
}

async function pageState() {
  return js(`(() => {
    const visible = (element) => {
      if (!element) return false
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }
    const masks = [...document.querySelectorAll('.note-detail-mask')]
    const previews = [...document.querySelectorAll('.preview-modal')]
    const pathname = location.pathname || ''
    return {
      href: location.href,
      pathname,
      cards: document.querySelectorAll('.note-item[data-note-id]').length,
      maskVisible: masks.some(visible),
      previewVisible: previews.some(visible),
      detailVisible: masks.some(visible) || previews.some(visible) || pathname.includes('/explore/'),
    }
  })()`);
}

async function ensureClosed() {
  for (let attempt = 0; attempt < 5; attempt++) {
    const state = await pageState();
    if (!state.maskVisible && !state.previewVisible) return true;
    await js(`(() => {
      const active = document.activeElement
      if (active && active.blur) active.blur()
    })()`);
    await pressKey("Escape");
    await wait(0.6);
  }

  await js(`(() => {
    const visible = (element) => {
      if (!element) return false
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }
    const roots = [...document.querySelectorAll('.preview-modal, .note-detail-mask')].filter(visible)
    for (const root of roots) {
      const close = root.querySelector('.close-circle, .close, button[aria-label*="关闭"], button.close')
      if (close) close.click()
    }
  })()`);
  await wait(0.8);
  const state = await pageState();
  return !state.maskVisible && !state.previewVisible;
}

async function waitForSearchCards() {
  let compositorKicked = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const state = await pageState();
    const layout = await js(`(() => {
      return [...document.querySelectorAll('.note-item[data-note-id]')]
        .slice(0, 20)
        .map((element) => {
          const rect = element.getBoundingClientRect()
          const x = Math.round(rect.left)
          const y = Math.round(rect.top)
          const centerX = Math.round(rect.left + rect.width / 2)
          const centerY = Math.round(rect.top + rect.height / 2)
          const hit = document.elementFromPoint(centerX, centerY)
          return {
            id: element.getAttribute('data-note-id') || '',
            x,
            y,
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            hit: Boolean(hit && hit.closest('.note-item') === element),
          }
        })
    })()`);
    if (
      state.pathname.includes("/search_result") &&
      hasUsableCardLayout(layout)
    ) {
      return true;
    }
    if (
      !compositorKicked &&
      attempt >= 4 &&
      state.pathname.includes("/search_result") &&
      state.cards > 0
    ) {
      // XHS AI search can create all cards at one coordinate until Chromium performs
      // a compositor readback. Capture a tiny in-memory JPEG to force that layout pass.
      await cdp("Page.captureScreenshot", {
        format: "jpeg",
        quality: 1,
        fromSurface: true,
        captureBeyondViewport: false,
      });
      compositorKicked = true;
    }
    await wait(0.5);
  }
  return false;
}

async function openFreshSearch(reason) {
  const previous = await currentTab().catch(() => null);
  const freshUrl = SEARCH_URL + "&ego_run=" + Date.now();
  log("open fresh search (" + reason + ")");
  const opened = await openOrReuseTab(freshUrl, { match: "exact", wait: true });
  await wait(2);
  const ready = await waitForSearchCards();

  if (
    ready &&
    previous &&
    opened &&
    previous.targetId &&
    opened.targetId !== previous.targetId &&
    String(previous.url || "").includes("xiaohongshu.com")
  ) {
    try {
      await closeTab(previous.targetId);
    } catch {}
  }
  return ready;
}

async function ensureSearchPage(reason) {
  await ensureClosed();
  const state = await pageState();
  if (state.pathname.includes("/search_result") && state.cards > 0) return true;
  return openFreshSearch(reason);
}

async function collectCards() {
  const positions = new Map();
  const order = [];
  const seen = new Set();

  async function mergeVisible() {
    const cards = await js(`(() => {
      const scrollY = window.scrollY || 0
      return [...document.querySelectorAll('.note-item[data-note-id]')].map((element) => {
        const rect = element.getBoundingClientRect()
        return {
          id: element.getAttribute('data-note-id') || '',
          y: Math.round(rect.top + scrollY),
          x: Math.round(rect.left),
          top: Math.round(rect.top),
        }
      })
    })()`);
    const sorted = (cards || []).sort((left, right) => {
      if (Math.abs(left.top - right.top) < 100) return left.x - right.x;
      return left.top - right.top;
    });
    for (const card of sorted) {
      const id = String(card.id || "").toLowerCase();
      if (!/^[0-9a-f]{24}$/.test(id)) continue;
      positions.set(id, card.y);
      if (!seen.has(id)) {
        seen.add(id);
        order.push(id);
      }
    }
  }

  await js("window.scrollTo(0, 0)");
  await wait(0.6);
  await mergeVisible();
  for (
    let round = 0;
    round < 12 && order.length < Math.max(TARGET * 2, TARGET + 10);
    round++
  ) {
    await js("window.scrollBy(0, 1000)");
    await wait(0.8);
    await mergeVisible();
  }
  await js("window.scrollTo(0, 0)");
  return { order, positions };
}

async function cardCenter(id, estimatedY) {
  let result = await js(`(() => {
    const element = document.querySelector('.note-item[data-note-id="${id}"]')
    if (!element) return null
    element.scrollIntoView({ block: 'center' })
    return true
  })()`);
  if (!result && Number.isFinite(estimatedY)) {
    await js(
      `window.scrollTo(0, Math.max(0, ${Math.round(estimatedY)} - 600))`,
    );
  }
  await wait(0.7);
  return js(`(() => {
    const element = document.querySelector('.note-item[data-note-id="${id}"]')
    if (!element) return { missing: true }
    const rect = element.getBoundingClientRect()
    if (rect.width < 50 || rect.height < 50) return { missing: true }
    const cx = Math.round(rect.left + rect.width / 2)
    const cy = Math.round(rect.top + rect.height / 2)
    const hit = document.elementFromPoint(cx, cy)
    return {
      cx,
      cy,
      isCard: Boolean(hit && hit.closest('.note-item[data-note-id="${id}"]')),
    }
  })()`);
}

async function loadComments(rounds) {
  for (let round = 0; round < rounds; round++) {
    await js(`(() => {
      const candidates = [...document.querySelectorAll('*')].filter((element) => {
        const style = getComputedStyle(element)
        return (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
          element.scrollHeight > element.clientHeight + 100 && element.clientHeight > 120
      })
      candidates.sort((left, right) =>
        (right.scrollHeight - right.clientHeight) - (left.scrollHeight - left.clientHeight))
      if (candidates[0]) candidates[0].scrollBy(0, Math.floor(candidates[0].clientHeight * 0.8))
    })()`);
    await wait(1.1);
  }
}

async function extract() {
  return js(`(() => {
    const text = (selector) => {
      const element = document.querySelector(selector)
      return element ? element.innerText.trim() : ''
    }
    const engageText = text('.engage-bar')
    const engageNums = (engageText.match(/\\d+/g) || []).map(Number)
    const author = document.querySelector('.author-wrapper .name, .username, .author .name')
      ?.innerText?.trim() || ''
    const date = document.querySelector('.date, .bottom-container .date, .note-content .date')
      ?.innerText?.trim() || ''
    const tags = [...new Set(
      [...document.querySelectorAll('#detail-desc .topic, .note-text .topic, a.topic, .tag')]
        .map((element) => element.innerText.trim())
        .filter(Boolean),
    )].slice(0, 20)
    const comments = [...document.querySelectorAll('.comment-item')]
      .map((comment) => ({
        name: comment.querySelector('.name,.author,.user-name')?.innerText?.trim() || '',
        content: (comment.querySelector('.note-text')?.innerText?.trim() || '').slice(0, 300),
      }))
      .filter((comment) => comment.name || comment.content)
    const images = [...new Set(
      [...document.querySelectorAll('.swiper-slide img, .media-container img, .note-slider img')]
        .map((image) => image.src)
        .filter((src) => src && !src.startsWith('data:')),
    )]
    return {
      title: text('#detail-title'),
      desc: text('#detail-desc') || text('.desc'),
      engageNums,
      author,
      date,
      tags,
      comments,
      images,
      url: location.href,
    }
  })()`);
}

async function captureExpectedNote(id, estimatedY) {
  let lastFailure = { ok: false, reason: "unknown" };

  for (let attempt = 1; attempt <= 3; attempt++) {
    if (!(await ensureSearchPage("before " + id + " attempt " + attempt))) {
      lastFailure = { ok: false, reason: "search-not-ready" };
      continue;
    }

    const center = await cardCenter(id, estimatedY);
    if (!center || center.missing || !center.isCard) {
      lastFailure = { ok: false, reason: "no-valid-card" };
      log(id + " attempt=" + attempt + " no-valid-card");
      await openFreshSearch("card recovery");
      continue;
    }

    const before = await extract();
    await click([center.cx, center.cy], { label: "open " + id });

    const deadline = Date.now() + 10000;
    let current = null;
    while (Date.now() < deadline) {
      await wait(0.5);
      current = await extract();
      const state = await pageState();
      lastFailure = validateCapture({
        expectedId: id,
        before,
        current,
        detailVisible: state.detailVisible,
      });
      if (lastFailure.ok) break;
    }

    if (!lastFailure.ok) {
      log(
        id +
          " attempt=" +
          attempt +
          " rejected=" +
          lastFailure.reason +
          (lastFailure.actualId ? " actual=" + lastFailure.actualId : ""),
      );
      await ensureClosed();
      continue;
    }

    await loadComments(3);
    current = await extract();
    const finalState = await pageState();
    const finalCheck = validateCapture({
      expectedId: id,
      before,
      current,
      detailVisible: finalState.detailVisible,
    });
    if (finalCheck.ok) {
      return {
        ok: true,
        actualId: finalCheck.actualId,
        data: current,
        attempts: attempt,
      };
    }
    lastFailure = finalCheck;
    await ensureClosed();
  }

  return { ...lastFailure, attempts: 3 };
}

log('START kw="' + KW + '" target=' + TARGET);
await useOrCreateTaskSpace(SPACE_NAME);

const initialAudit = auditDisk();
const initialValid = new Set(initialAudit.validIds);
st.done = [...initialValid];
st.failed = st.failed.filter((failure) => !initialValid.has(failure.id));
saveState();
log(
  "AUDIT existing valid=" +
    initialAudit.validIds.length +
    " invalid=" +
    initialAudit.invalid.length +
    " duplicate=" +
    initialAudit.duplicates.length,
);

if (!(await openFreshSearch("startup"))) {
  throw new Error("XHS search page did not render usable cards");
}

const cards = await collectCards();
log("valid cards=" + cards.order.length);
if (cards.order.length === 0) throw new Error("No valid XHS note cards found");

const seenActualIds = new Set(initialAudit.actualIds);
const seenContent = new Set(initialAudit.contentFingerprints);
let completedThisRun = 0;
let consecutiveFailures = 0;

for (const id of cards.order) {
  if (st.done.length >= TARGET) break;
  if (consecutiveFailures >= 10) {
    log("10 consecutive failures, abort");
    break;
  }
  if (st.done.includes(id)) continue;

  const captured = await captureExpectedNote(id, cards.positions.get(id));
  if (!captured.ok) {
    consecutiveFailures++;
    recordFailure(id, captured.reason, captured.attempts, captured.actualId);
    continue;
  }

  const fingerprint = contentFingerprint(captured.data);
  if (seenActualIds.has(captured.actualId)) {
    consecutiveFailures++;
    recordFailure(
      id,
      "duplicate-note-id",
      captured.attempts,
      captured.actualId,
    );
    await ensureClosed();
    continue;
  }
  if (fingerprint && seenContent.has(fingerprint)) {
    consecutiveFailures++;
    recordFailure(
      id,
      "duplicate-content",
      captured.attempts,
      captured.actualId,
    );
    await ensureClosed();
    continue;
  }

  const output = {
    id,
    actualId: captured.actualId,
    keyword: KW,
    url: captured.data.url,
    title: captured.data.title,
    author: captured.data.author,
    date: captured.data.date,
    desc: captured.data.desc,
    engageNums: captured.data.engageNums,
    tags: captured.data.tags,
    comments: captured.data.comments,
    images: captured.data.images,
  };
  atomicJson(path.join(DIR, id + ".json"), output);
  seenActualIds.add(captured.actualId);
  if (fingerprint) seenContent.add(fingerprint);
  st.done.push(id);
  st.failed = st.failed.filter((failure) => failure.id !== id);
  saveState();

  completedThisRun++;
  consecutiveFailures = 0;
  log(
    st.done.length +
      "/" +
      TARGET +
      " " +
      id +
      " | " +
      captured.data.title.slice(0, 26) +
      " | cmts=" +
      captured.data.comments.length +
      " imgs=" +
      captured.data.images.length,
  );
  await ensureClosed();
  await wait(
    3 +
      Math.floor(Math.random() * 5) +
      (Math.random() < 0.15 ? 5 + Math.floor(Math.random() * 5) : 0),
  );
}

const finalAudit = auditDisk();
st.done = finalAudit.validIds;
saveState();
log(
  "VALIDATION valid=" +
    finalAudit.validIds.length +
    " invalid=" +
    finalAudit.invalid.length +
    " duplicate=" +
    finalAudit.duplicates.length,
);
log(
  "FINISHED +" +
    completedThisRun +
    " (total " +
    finalAudit.validIds.length +
    "/" +
    TARGET +
    ") failed=" +
    st.failed.length,
);

// Keyword done: drop this search tab and close the task space so the next
// keyword starts on a new page instead of stacking XHS search tabs.
try {
  const tabs = await listTabs();
  for (const tab of tabs || []) {
    const url = String(tab.url || "");
    if (!url.includes("xiaohongshu.com")) continue;
    try {
      await closeTab(tab.targetId || tab);
      log("closed tab " + url.slice(0, 80));
    } catch {}
  }
} catch {
  try {
    await closeTab();
    log("closed current tab");
  } catch {}
}
try {
  await completeTaskSpace(SPACE_NAME, { keep: false });
  log("closed task space " + SPACE_NAME);
} catch (err) {
  log(
    "close task space skipped: " +
      (err && err.message ? err.message : String(err)),
  );
}
