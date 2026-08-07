// Shared crawler body. Requires KW, SLUG, TARGET, BASE, DATE to be defined
// in a prepended const-line (baked in per keyword), since ego-browser strips
// custom env vars and rejects argv alongside a source file.
const fs = await import('node:fs')
const path = await import('node:path')
const DIR = path.join(BASE, DATE + '_' + FOLDERTAG + '_' + SLUG)
fs.mkdirSync(DIR, { recursive: true })
const LOGF = path.join(DIR, 'crawl.log')
const SP = path.join(DIR, 'state.json')
const log = (m) => { const l = '[' + SLUG + '] ' + m; cliLog(l); try { fs.appendFileSync(LOGF, l + '\n') } catch (e) {} }
let st = { done: [], failed: [] }
try { st = Object.assign(st, JSON.parse(fs.readFileSync(SP, 'utf8'))) } catch (e) {}
log('START kw="' + KW + '" have=' + st.done.length + ' target=' + TARGET)

await useOrCreateTaskSpace('xhs-' + SLUG)

async function maskDisplay() { return js(`(()=>{const m=document.querySelector('.note-detail-mask');return m?getComputedStyle(m).display:'none';})()`) }
async function ensureClosed() {
  for (let i = 0; i < 3; i++) { if (await maskDisplay() === 'none') return true; await js(`(()=>{const a=document.activeElement; if(a&&a.blur)a.blur();})()`); await pressKey('Escape'); await wait(0.5) }
  await js(`(()=>{const b=document.querySelector('.close-circle, .note-detail-mask .close, button.close'); if(b)b.click();})()`); await wait(0.6)
  return (await maskDisplay()) === 'none'
}
async function cardCenter(id) { return js(`(() => { const el=document.querySelector('.note-item[data-note-id="${id}"]'); if(!el) return {id:'${id}',missing:true}; const r=el.getBoundingClientRect(); if(r.width<50) return {id:'${id}',missing:true}; const cx=Math.round(r.x+r.width/2), cy=Math.round(r.y+r.height/2); const hit=document.elementFromPoint(cx,cy); return {id:'${id}',cx,cy,top:Math.round(r.top),isCard:!!(hit&&hit.closest('.note-item'))}; })()`) }
async function loadComments(n) { for (let i=0;i<n;i++){ await js(`(()=>{const c=[...document.querySelectorAll('*')].filter(e=>{const s=getComputedStyle(e);return(s.overflowY==='auto'||s.overflowY==='scroll')&&e.scrollHeight>e.clientHeight+100&&e.clientHeight>120});c.sort((a,b)=>(b.scrollHeight-b.clientHeight)-(a.scrollHeight-a.clientHeight));if(c[0])c[0].scrollBy(0,Math.floor(c[0].clientHeight*0.8));})()`); await wait(1.1) } }
async function extract() { return js(`(()=>{const t=(s)=>{const el=document.querySelector(s);return el?el.innerText.trim():''};const title=t('#detail-title');const desc=t('#detail-desc')||t('.desc');const er=t('.engage-bar');const nums=(er.match(/\\d+/g)||[]).map(Number);const author=(document.querySelector('.author-wrapper .name, .username, .author .name'))?.innerText?.trim()||'';const date=(document.querySelector('.date, .bottom-container .date, .note-content .date'))?.innerText?.trim()||'';const tags=[...new Set([...document.querySelectorAll('#detail-desc .topic, .note-text .topic, a.topic, .tag')].map(e=>e.innerText.trim()).filter(Boolean))].slice(0,20);const comments=[...document.querySelectorAll('.comment-item')].map(c=>{const nm=(c.querySelector('.name,.author,.user-name'))?.innerText?.trim()||'';const ct=(c.querySelector('.note-text'))?.innerText?.trim()||'';return{name:nm,content:ct.slice(0,300)}}).filter(x=>x.name||x.content);const images=[...new Set([...document.querySelectorAll('.swiper-slide img, .media-container img, .note-slider img')].map(i=>i.src).filter(s=>s&&!s.startsWith('data:')))];return{title,desc,engageNums:nums,author,date,tags,comments,images,url:location.href};})()`) }

await ensureClosed()
let cardCount = await js(`document.querySelectorAll('.note-item').length`)
if (cardCount === 0) {
  log('no cards, navigate to search')
  await gotoAndWait('https://www.xiaohongshu.com/search_result?keyword=' + encodeURIComponent(KW) + '&source=web_explore_feed', { timeout: 30 }); await wait(3)
  for (let i = 0; i < 6; i++) { const n = await js(`document.querySelectorAll('.note-item').length`); if (n > 0) break; await wait(1.5) }
}
for (let i = 0; i < 8; i++) { await js(`window.scrollBy(0,1400)`); await wait(1.0) }
const ids = await js(`(()=>{return [...document.querySelectorAll('.note-item')].map(e=>e.getAttribute('data-note-id')).filter(Boolean)})()`)
const uniq = [...new Set(ids)].filter(id => /^[0-9a-f]{24}$/.test(id))
log('valid cards=' + uniq.length)

const existing = st.done.length
const need = Math.max(0, TARGET - existing)
let done = 0, cf = 0
for (const id of uniq) {
  if (done >= need) break
  if (cf >= 4) { log('4 fails, abort'); break }
  if (st.done.includes(id) || fs.existsSync(path.join(DIR, id + '.json'))) continue
  if (!(await ensureClosed())) { await wait(2); continue }
  let c = await cardCenter(id)
  if (!c || c.missing || !c.isCard || c.top > 680) { await js(`(()=>{const e=document.querySelector('.note-item[data-note-id="${id}"]'); if(e) e.scrollIntoView({block:'center'});})()`); await wait(0.9); c = await cardCenter(id) }
  if (!c || c.missing || !c.isCard) { st.failed.push({ id, reason: 'no-valid-card' }); fs.writeFileSync(SP, JSON.stringify(st, null, 2)); cf++; continue }
  await click([c.cx, c.cy], { label: 'open ' + id }); await wait(2.5)
  try { await waitForElement('#detail-title', { timeout: 8 }) } catch (e) {}
  await loadComments(3)
  const d = await extract()
  if (!d || !d.title) { st.failed.push({ id, reason: 'no-title' }); fs.writeFileSync(SP, JSON.stringify(st, null, 2)); await ensureClosed(); cf++; log('no-title (captcha?) cf='+cf); continue }
  cf = 0
  fs.writeFileSync(path.join(DIR, id + '.json'), JSON.stringify({ id, keyword: KW, url: d.url, title: d.title, author: d.author, date: d.date, desc: d.desc, engageNums: d.engageNums, tags: d.tags, comments: d.comments, images: d.images }, null, 2))
  st.done.push(id); fs.writeFileSync(SP, JSON.stringify(st, null, 2))
  done++
  log((existing + done) + '/' + TARGET + ' ' + id + ' | ' + d.title.slice(0, 26) + ' | cmts=' + d.comments.length + ' imgs=' + d.images.length + ' ' + JSON.stringify(d.engageNums))
  await ensureClosed()
  await wait(3 + Math.floor(Math.random() * 5) + (Math.random() < 0.15 ? 5 + Math.floor(Math.random() * 5) : 0))
}
log('FINISHED +' + done + ' (total ' + (existing + done) + '/' + TARGET + ') failed=' + st.failed.length)
