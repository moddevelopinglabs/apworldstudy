/* AP World History study site: shared behavior for chapter pages and the hub.
   A chapter page sets <body data-chapter="ch7"> and loads assets/ch7-data.js first.
   The hub sets <body data-page="hub"> and loads every chapter's data file. */
(function(){
'use strict';

const store = {
  get(k, d){ try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch(e){ return d; } },
  set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} }
};
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
const el = (tag, attrs={}, text) => { const e = document.createElement(tag); for (const [k,v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else e.setAttribute(k, v); } if (text !== undefined) e.textContent = text; return e; };
function shuffle(a){ a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function norm(s){ return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
function hash(s){ let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
const DATA = window.CHAPTER_DATA || {};
const qid = (ch, q) => ch + ':' + hash(q.q);

/* ---------- theme toggle ---------- */
function initTheme(){
  const btn = $('.theme-btn'); if (!btn) return;
  const root = document.documentElement;
  const sysDark = () => window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
  const current = () => root.dataset.theme || (sysDark() ? 'dark' : 'light');
  const paint = () => { const dark = current() === 'dark'; btn.textContent = dark ? 'Light mode' : 'Dark mode'; btn.setAttribute('aria-pressed', dark); };
  btn.addEventListener('click', () => { root.dataset.theme = current() === 'dark' ? 'light' : 'dark'; store.set('apw.theme', root.dataset.theme); paint(); });
  paint();
}

/* ---------- missed questions, shared across every chapter ---------- */
const missedStore = {
  all(){ return new Set(store.get('apw.missed', [])); },
  mark(id, wrong){ const s = this.all(); wrong ? s.add(id) : s.delete(id); store.set('apw.missed', [...s]); }
};

/* ---------- Blooket export ----------
   Turns the questions picked in the quiz setup into Blooket's spreadsheet
   import format: a title row, a header row, then one question per row with up
   to four answers, a time limit, and the number of the correct answer.
   Blooket only has multiple choice in this format, so typed questions get
   three wrong answers borrowed from other typed answers in the same section
   (then the same chapter). */
const BLOOKET_HEAD = ['Question #', 'Question Text', 'Answer 1', 'Answer 2', 'Answer 3 \n(Optional)', 'Answer 4 \n(Optional)', 'Time Limit (sec) \n(Max: 300 Seconds)', 'Correct Answer(s) \n(Only Include Answer #)'];
const JSZIP_URL = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
const JSZIP_SRI = 'sha384-+mbV2IY1Zk/X1p/nWllGySJSUN8uMs+gUAN10Or95UBH0fpj6GfKgPmgC5EXieXG';

function blooketRows(items, all, seconds){
  const typedPool = all.filter(q => q.type !== 'mc');
  return items.map((q, i) => {
    let wrong = q.wrong;
    if (q.type !== 'mc') {
      // Prefer answers to questions of the same kind ("Who..." answers are people),
      // then the same section, then anything else in the chapter.
      const taken = new Set([norm(q.answer)]), picks = [];
      const kind = x => norm(x.q).split(' ')[0];
      const rank = o => (kind(o) === kind(q) ? 0 : 2) + (o.section === q.section ? 0 : 1);
      const cands = shuffle(typedPool.filter(o => o._ch === q._ch && o !== q)).sort((a, b) => rank(a) - rank(b));
      for (const o of cands) {
        const k = norm(o.answer);
        if (taken.has(k)) continue;
        taken.add(k); picks.push(o.answer);
        if (picks.length === 3) break;
      }
      wrong = picks;
    }
    const answers = shuffle([q.answer, ...wrong]);
    while (answers.length < 4) answers.push('');
    return [i + 1, q.q, ...answers, seconds, answers.indexOf(q.answer) + 1];
  });
}
function csvCell(v){ const s = String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function blooketCSV(rows){
  const lines = [['Blooket\nImport Template', '', '', '', '', '', '', ''], BLOOKET_HEAD, ...rows];
  return lines.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
function saveFile(name, blob){
  const url = URL.createObjectURL(blob);
  const a = el('a', {href: url, download: name});
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function loadJSZip(){
  if (window.JSZip) return Promise.resolve(window.JSZip);
  return new Promise((ok, fail) => {
    const s = el('script', {src: JSZIP_URL, integrity: JSZIP_SRI, crossorigin: 'anonymous'});
    s.onload = () => ok(window.JSZip); s.onerror = () => fail(new Error('Could not load the spreadsheet library.'));
    document.head.append(s);
  });
}
const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/* Fill a copy of Blooket's own Excel template (kept in assets/) so the logo and formatting survive. */
async function blooketXLSX(rows){
  const JSZip = await loadJSZip();
  const res = await fetch('assets/blooket-template.xlsx');
  if (!res.ok) throw new Error('Could not load the Blooket template.');
  const zip = await JSZip.loadAsync(await res.arrayBuffer());
  const path = 'xl/worksheets/sheet1.xml';
  let xml = await zip.file(path).async('string');
  const STYLE = ['11', '12', '12', '12', '12', '12', '14', '14'];
  const cell = (ref, s, v) => v === '' ? `<c r="${ref}" s="${s}"/>`
    : typeof v === 'number' ? `<c r="${ref}" s="${s}"><v>${v}</v></c>`
    : `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
  const rowXml = (r, vals) => `<row r="${r}" spans="1:12">` + vals.map((v, k) => cell('ABCDEFGH'[k] + r, STYLE[k], v)).join('')
    + `<c r="I${r}" s="4"/><c r="J${r}" s="4"/><c r="K${r}" s="4"/><c r="L${r}" s="5"/></row>`;
  const mine = new Map(rows.map((vals, i) => [i + 3, rowXml(i + 3, vals)]));
  let last = 0;
  xml = xml.replace(/<sheetData>([\s\S]*)<\/sheetData>/, (_, body) => {
    const kept = [];
    body.replace(/<row r="(\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g, (m, r) => {
      r = Number(r); last = Math.max(last, r);
      kept.push(mine.has(r) ? mine.get(r) : m); mine.delete(r); return '';
    });
    mine.forEach(x => kept.push(x));
    return '<sheetData>' + kept.join('') + '</sheetData>';
  });
  xml = xml.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:L${Math.max(last, rows.length + 2)}"/>`);
  zip.file(path, xml);
  return zip.generateAsync({type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
async function copyText(text){
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    const t = el('textarea', {style: 'position:fixed;opacity:0'}); t.value = text; document.body.append(t); t.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (e2) {} t.remove(); return ok;
  }
}
function initBlooket(opts, pool){
  const setup = $('#q-setup'); if (!setup) return null;
  const box = el('details', {class: 'export'});
  const sum = el('summary', {}, 'Export to Blooket');
  const intro = el('p', {}, 'Turn the topics you picked above into a Blooket question set. Typed-answer questions are included only if "Include typed answers" is checked; they become multiple choice, using other answers from the chapter as the wrong choices.');
  const timeLab = el('label', {}, 'Time per question ');
  const time = el('select', {id: 'bk-time'});
  [10, 20, 30, 45, 60, 90].forEach(s => { const o = el('option', {value: s}, s + ' seconds'); if (s === 20) o.selected = true; time.append(o); });
  timeLab.append(time);
  const row = el('div', {class: 'row'});
  const bCSV = el('button', {type: 'button', class: 'btn small'}, 'Download CSV for Blooket');
  const bXLSX = el('button', {type: 'button', class: 'btn ghost small'}, 'Download Excel template');
  const bCopy = el('button', {type: 'button', class: 'btn ghost small'}, 'Copy rows');
  row.append(bCSV, bXLSX, bCopy);
  const status = el('p', {class: 'note', 'aria-live': 'polite'});
  const steps = el('ol', {class: 'formula note'});
  ['In Blooket, choose Create a set, then CSV Import (or Spreadsheet Import on a set you are editing).',
   'Upload the CSV you downloaded here. Check the questions, then save the set.',
   'Want to edit first? Open the Excel template, make changes, then save or download it as .csv and upload that. To use your own copy of the template instead, choose Copy rows and paste into cell A3.'
  ].forEach(t => steps.append(el('li', {}, t)));
  const timeRow = el('div', {class: 'row'}); timeRow.append(timeLab);
  box.append(sum, intro, timeRow, row, status, steps);
  setup.append(box);

  const base = opts.exportName || 'apworld';
  const rows = () => {
    const items = pool();
    return blooketRows(items, opts.questions, Number(time.value));
  };
  const say = t => { status.textContent = t; };
  const empty = () => { say('Pick at least one topic first.'); };
  bCSV.addEventListener('click', () => {
    const r = rows(); if (!r.length) return empty();
    saveFile(base + '-blooket.csv', new Blob([blooketCSV(r)], {type: 'text/csv;charset=utf-8'}));
    say('Downloaded ' + base + '-blooket.csv with ' + r.length + ' questions.');
  });
  bXLSX.addEventListener('click', async () => {
    const r = rows(); if (!r.length) return empty();
    bXLSX.disabled = true; say('Building the spreadsheet…');
    try { saveFile(base + '-blooket.xlsx', await blooketXLSX(r)); say('Downloaded ' + base + '-blooket.xlsx with ' + r.length + ' questions. Save it as .csv before uploading to Blooket.'); }
    catch (e) { say(e.message + ' Use the CSV download instead.'); }
    finally { bXLSX.disabled = false; }
  });
  bCopy.addEventListener('click', async () => {
    const r = rows(); if (!r.length) return empty();
    const ok = await copyText(r.map(x => x.join('\t')).join('\n'));
    say(ok ? 'Copied ' + r.length + ' rows. Paste them into cell A3 of the Blooket template.' : 'Your browser blocked copying. Use a download instead.');
  });
  return { update(n){ [bCSV, bXLSX, bCopy].forEach(b => b.disabled = n === 0); say(''); } };
}

/* ---------- quiz ---------- */
/* opts.questions: [{...q, _id, _ch}]
   opts.groups:    [{name, chips:[{value, label}]}]  (name may be empty)
   opts.chipOf(q): chip value a question belongs to
   opts.topicOf(q): {label, href} used for the "review" links
   opts.bestKey:   storage key for the best score
   opts.exportName: file name prefix for Blooket exports */
function initQuiz(opts){
  const vSetup = $('#q-setup'), vPlay = $('#q-play'), vDone = $('#q-done');
  if (!vSetup) return;
  const chipBox = $('#q-topics');
  const counts = {};
  opts.questions.forEach(q => { const k = opts.chipOf(q); counts[k] = (counts[k] || 0) + 1; });
  opts.groups.forEach(g => {
    const wrap = g.name ? el('div', {class: 'chip-group'}) : null;
    if (wrap) wrap.append(el('p', {class: 'chip-group-name'}, g.name));
    const box = el('div', {class: 'chips'});
    g.chips.forEach(c => {
      const lab = el('label', {class: 'chip'});
      const input = el('input', {type: 'checkbox', value: c.value}); input.checked = true;
      lab.append(input, el('span', {}, c.label + ' (' + (counts[c.value] || 0) + ')'));
      box.append(lab);
    });
    if (wrap) { wrap.append(box); chipBox.append(wrap); } else chipBox.append(...box.childNodes);
  });
  if (opts.groups.some(g => g.name)) chipBox.classList.remove('chips');
  const topicBoxes = $$('input[type=checkbox]', chipBox);

  // "practice what you missed" button lives next to Start
  const startBtn = $('#q-start');
  const missBtn = el('button', {type: 'button', class: 'btn ghost', id: 'q-missed-start'});
  startBtn.after(missBtn);

  $('#q-all').addEventListener('click', () => { topicBoxes.forEach(b => b.checked = true); updatePool(); });
  $('#q-none').addEventListener('click', () => { topicBoxes.forEach(b => b.checked = false); updatePool(); });
  topicBoxes.forEach(b => b.addEventListener('change', updatePool));
  $('#q-typed').addEventListener('change', updatePool);

  function poolFromSetup(){
    const keys = new Set(topicBoxes.filter(b => b.checked).map(b => b.value));
    const typed = $('#q-typed').checked;
    return opts.questions.filter(q => keys.has(opts.chipOf(q)) && (typed || q.type === 'mc'));
  }
  function missedPool(){ const m = missedStore.all(); return poolFromSetup().filter(q => m.has(q._id)); }
  function updatePool(){
    const n = poolFromSetup().length, m = missedPool().length;
    $('#q-available').textContent = n ? n + ' questions available' : 'Pick at least one topic to start.';
    startBtn.disabled = n === 0;
    missBtn.textContent = 'Practice missed (' + m + ')';
    missBtn.hidden = m === 0;
    if (exporter) exporter.update(n);
  }
  const exporter = initBlooket(opts, poolFromSetup);
  updatePool();
  function showBest(){ const b = store.get(opts.bestKey, null); $('#q-best').textContent = b === null ? '' : 'Your best score so far: ' + b + '%'; }
  showBest();

  let S = null;
  function startQuiz(items){
    S = { items, i: 0, score: 0, log: [] };
    vSetup.hidden = true; vDone.hidden = true; vPlay.hidden = false;
    renderQ();
    $('#quiz').scrollIntoView({block: 'start'});
  }
  startBtn.addEventListener('click', () => {
    const pool = shuffle(poolFromSetup()); const count = $('#q-count').value;
    startQuiz(count === 'all' ? pool : pool.slice(0, Number(count)));
  });
  missBtn.addEventListener('click', () => startQuiz(shuffle(missedPool())));

  function renderQ(){
    const q = S.items[S.i], t = opts.topicOf(q);
    $('#q-pos').textContent = 'Question ' + (S.i + 1) + ' of ' + S.items.length;
    $('#q-score').textContent = 'Score: ' + S.score;
    $('#q-bar').style.width = (S.i / S.items.length * 100) + '%';
    const topic = $('#q-topic'); topic.textContent = t.label; topic.href = t.href;
    $('#q-text').textContent = q.q;
    const area = $('#q-answer'); area.textContent = '';
    $('#q-hint').hidden = true; $('#q-hint').textContent = q.hint || '';
    $('#q-hint-btn').hidden = !q.hint; $('#q-hint-btn').disabled = false;
    const fb = $('#q-feedback'); fb.textContent = ''; fb.className = 'feedback';
    $('#q-next').hidden = true;
    S.answered = false; S.hintUsed = false;
    if (q.type === 'mc') {
      const box = el('div', {class: 'options', role: 'group', 'aria-label': 'Answer choices'});
      shuffle([q.answer, ...q.wrong]).forEach((text, k) => {
        const b = el('button', {type: 'button', class: 'opt'});
        b.append(el('span', {class: 'k'}, String(k + 1)), el('span', {}, text));
        b.dataset.value = text;
        b.addEventListener('click', () => gradeMC(b));
        box.append(b);
      });
      area.append(box, el('p', {class: 'note'}, 'Tip: press 1 to 4 to choose.'));
    } else {
      const wrap = el('div', {class: 'typed'});
      const inp = el('input', {type: 'text', id: 'q-input', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Your answer', placeholder: 'Type your answer'});
      const go = el('button', {type: 'button', class: 'btn'}, 'Check answer');
      go.addEventListener('click', gradeTyped);
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); gradeTyped(); } });
      wrap.append(inp, go); area.append(wrap);
      area.append(el('p', {class: 'note'}, q.type === 'exact' ? 'Type the exact term. Capital letters and accents don’t matter.' : 'Your answer needs to include the key words.'));
      inp.focus({preventScroll: true});
    }
  }
  function finishQ(correct, given){
    S.answered = true;
    if (correct) S.score++;
    const q = S.items[S.i];
    S.log.push({ q, correct, given, hint: S.hintUsed });
    missedStore.mark(q._id, !correct);
    $('#q-score').textContent = 'Score: ' + S.score;
    $('#q-hint-btn').disabled = true;
    const fb = $('#q-feedback'); fb.className = 'feedback ' + (correct ? 'right' : 'wrong');
    fb.append(el('p', {}, correct ? 'Correct.' : 'Not quite. The answer is: ' + q.answer));
    if (!correct && q.type !== 'mc' && q.accepted.length > 1) fb.append(el('p', {}, 'Also accepted: ' + q.accepted.slice(1).join(', ')));
    const next = $('#q-next'); next.hidden = false;
    next.textContent = S.i + 1 < S.items.length ? 'Next question' : 'See results';
    next.focus({preventScroll: true});
  }
  function gradeMC(btn){
    if (S.answered) return;
    const q = S.items[S.i]; const ok = btn.dataset.value === q.answer;
    $$('.opt').forEach(b => { b.disabled = true; if (b.dataset.value === q.answer) b.classList.add('right'); });
    if (!ok) btn.classList.add('wrong');
    finishQ(ok, btn.dataset.value);
  }
  function gradeTyped(){
    if (S.answered) return;
    const q = S.items[S.i], inp = $('#q-input'), val = norm(inp.value);
    if (!val) { const fb = $('#q-feedback'); fb.className = 'feedback'; fb.textContent = ''; inp.focus(); inp.placeholder = 'Type an answer first'; return; }
    const ok = q.accepted.some(a => { const n = norm(a); return q.type === 'exact' ? val === n : (' ' + val + ' ').includes(' ' + n + ' '); });
    inp.disabled = true; inp.classList.add(ok ? 'right' : 'wrong');
    inp.parentElement.querySelector('button').disabled = true;
    finishQ(ok, inp.value);
  }
  $('#q-hint-btn').addEventListener('click', () => { S.hintUsed = true; $('#q-hint').hidden = false; $('#q-hint-btn').disabled = true; });
  $('#q-next').addEventListener('click', () => { S.i++; S.i < S.items.length ? renderQ() : showDone(); });
  $('#q-quit').addEventListener('click', () => { S.log.length ? showDone() : backToSetup(); });
  document.addEventListener('keydown', e => {
    if (vPlay.hidden || !S || S.answered || e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const n = Number(e.key); const opts2 = $$('.opt');
    if (n >= 1 && n <= opts2.length) { e.preventDefault(); gradeMC(opts2[n - 1]); }
  });
  function showDone(){
    vPlay.hidden = true; vDone.hidden = false;
    const total = S.log.length, pct = total ? Math.round(S.score / total * 100) : 0;
    $('#q-final').textContent = pct + '%';
    $('#q-final-detail').textContent = S.score + ' of ' + total + ' correct' + (total < S.items.length ? ' (you stopped after ' + total + ' questions)' : '');
    const best = store.get(opts.bestKey, null);
    if (total >= 5 && (best === null || pct > best)) store.set(opts.bestKey, pct);
    showBest();
    $('#q-best-done').textContent = $('#q-best').textContent;
    const missed = S.log.filter(r => !r.correct);
    const list = $('#q-missed'); list.textContent = '';
    $('#q-missed-head').textContent = missed.length ? 'Review what you missed' : 'You got every question right.';
    missed.forEach(r => {
      const t = opts.topicOf(r.q);
      const li = el('li');
      li.append(el('p', {}, r.q.q));
      const a = el('p'); a.append(el('span', {class: 'a'}, r.q.answer));
      if (r.given) a.append(document.createTextNode('  (you answered: ' + r.given + ')'));
      li.append(a, el('a', {href: t.href}, 'Review: ' + t.label)); list.append(li);
    });
    $('#q-retry').hidden = !missed.length;
    S.missed = missed.map(r => r.q);
    $('#quiz').scrollIntoView({block: 'start'});
  }
  function backToSetup(){ vPlay.hidden = true; vDone.hidden = true; vSetup.hidden = false; updatePool(); }
  $('#q-retry').addEventListener('click', () => startQuiz(shuffle(S.missed)));
  $('#q-new').addEventListener('click', backToSetup);
}

/* ---------- key terms: searchable list + flashcards ---------- */
function initTerms(ch, TERMS){
  const termList = $('#term-list'), termCount = $('#term-count'), termSearch = $('#term-search');
  if (!termList) return;
  function renderTerms(){
    const q = norm(termSearch.value); termList.textContent = '';
    const hits = TERMS.filter(([t, d]) => !q || norm(t + ' ' + d).includes(q));
    hits.forEach(([t, d]) => { const w = el('div'); w.append(el('dt', {}, t), el('dd', {}, d)); termList.append(w); });
    termCount.textContent = hits.length ? (q ? hits.length + ' of ' + TERMS.length + ' terms match' : TERMS.length + ' terms') : 'No terms match "' + termSearch.value + '". Try a shorter word.';
  }
  termSearch.addEventListener('input', renderTerms); renderTerms();

  // view switch
  const listView = [termSearch, termCount, termList, $('label[for="term-search"]')].filter(Boolean);
  const seg = el('div', {class: 'seg', role: 'group', 'aria-label': 'Key terms view'});
  const bList = el('button', {type: 'button', 'aria-pressed': 'true'}, 'List');
  const bCards = el('button', {type: 'button', 'aria-pressed': 'false'}, 'Flashcards');
  seg.append(bList, bCards);
  const flash = el('div', {class: 'flash', hidden: ''});
  termSearch.parentElement.insertBefore(seg, $('label[for="term-search"]') || termSearch);
  termList.after(flash);

  const knownKey = ch + '.known';
  let known = new Set(store.get(knownKey, []));
  let onlyLearning = false, order = TERMS.map((_, i) => i), deck = [], pos = 0, flipped = false;

  const meta = el('div', {class: 'flash-meta'});
  const posTxt = el('span'), knownTxt = el('span');
  meta.append(posTxt, knownTxt);
  const card = el('button', {type: 'button', class: 'flash-card', 'aria-live': 'polite'});
  const empty = el('div', {class: 'flash-empty', hidden: ''});
  const row1 = el('div', {class: 'flash-row'});
  const prev = el('button', {type: 'button', class: 'btn ghost small'}, '← Back');
  const learning = el('button', {type: 'button', class: 'btn warn small'}, 'Still learning');
  const got = el('button', {type: 'button', class: 'btn good small'}, 'Got it');
  const next = el('button', {type: 'button', class: 'btn ghost small'}, 'Next →');
  row1.append(prev, learning, got, next);
  const row2 = el('div', {class: 'flash-row'});
  const shuf = el('button', {type: 'button', class: 'btn ghost small'}, 'Shuffle');
  const onlyLab = el('label', {class: 'note', style: 'margin:0'});
  const onlyBox = el('input', {type: 'checkbox'});
  onlyLab.append(onlyBox, document.createTextNode(' Only cards I’m still learning'));
  const reset = el('button', {type: 'button', class: 'btn ghost small'}, 'Reset progress');
  row2.append(shuf, onlyLab, reset);
  const tip = el('p', {class: 'note', style: 'text-align:center;margin-top:.75rem'}, 'Click the card or press Space to flip. Arrow keys move between cards.');
  flash.append(meta, card, empty, row1, row2, tip);

  function build(){ deck = order.filter(i => !onlyLearning || !known.has(TERMS[i][0])); if (pos >= deck.length) pos = 0; flipped = false; paint(); }
  function paint(){
    knownTxt.textContent = known.size + ' of ' + TERMS.length + ' marked "got it"';
    const none = deck.length === 0;
    card.hidden = none; empty.hidden = !none; row1.hidden = none;
    if (none) { empty.textContent = 'You’ve marked every card "got it". Uncheck the filter or reset to go again.'; posTxt.textContent = ''; return; }
    const [t, d] = TERMS[deck[pos]];
    posTxt.textContent = 'Card ' + (pos + 1) + ' of ' + deck.length;
    card.textContent = '';
    card.className = 'flash-card' + (flipped ? ' back' : '') + (known.has(t) ? ' known' : '');
    card.append(el('span', {class: 'side'}, flipped ? 'Definition' : 'Term'), el('span', {class: 'face'}, flipped ? d : t));
    if (flipped) card.append(el('span', {class: 'tap'}, t));
    else card.append(el('span', {class: 'tap'}, 'Tap to see the definition'));
    prev.disabled = pos === 0;
  }
  function go(step){ if (!deck.length) return; pos = (pos + step + deck.length) % deck.length; flipped = false; paint(); }
  function mark(isKnown){
    if (!deck.length) return;
    const t = TERMS[deck[pos]][0];
    isKnown ? known.add(t) : known.delete(t); store.set(knownKey, [...known]);
    if (onlyLearning && isKnown) { deck.splice(pos, 1); if (pos >= deck.length) pos = 0; flipped = false; paint(); }
    else go(1);
  }
  card.addEventListener('click', () => { flipped = !flipped; paint(); });
  prev.addEventListener('click', () => go(-1));
  next.addEventListener('click', () => go(1));
  got.addEventListener('click', () => mark(true));
  learning.addEventListener('click', () => mark(false));
  shuf.addEventListener('click', () => { order = shuffle(order); pos = 0; build(); });
  onlyBox.addEventListener('change', () => { onlyLearning = onlyBox.checked; pos = 0; build(); });
  reset.addEventListener('click', () => { known = new Set(); store.set(knownKey, []); build(); });
  document.addEventListener('keydown', e => {
    if (flash.hidden || e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const r = flash.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    else if (e.key === ' ' && e.target !== card && e.target.tagName !== 'BUTTON') { e.preventDefault(); flipped = !flipped; paint(); }
  });

  function setView(cards){
    bList.setAttribute('aria-pressed', !cards); bCards.setAttribute('aria-pressed', cards);
    listView.forEach(n => n.hidden = cards); flash.hidden = !cards;
    store.set(ch + '.termsView', cards ? 'cards' : 'list');
    if (cards) build();
  }
  bList.addEventListener('click', () => setView(false));
  bCards.addEventListener('click', () => setView(true));
  if (store.get(ch + '.termsView', 'list') === 'cards') setView(true);
}

/* ---------- chapter page ---------- */
function initChapter(ch){
  const data = DATA[ch]; if (!data) return;

  // mobile menu
  const sidebar = $('.sidebar'), menuBtn = $('.menu-btn');
  if (menuBtn) {
    menuBtn.addEventListener('click', () => { const open = sidebar.classList.toggle('open'); menuBtn.setAttribute('aria-expanded', open); });
    $$('.toc-group a').forEach(a => a.addEventListener('click', () => { sidebar.classList.remove('open'); menuBtn.setAttribute('aria-expanded', 'false'); }));
  }

  // reviewed sections
  const reviewed = new Set(store.get(ch + '.reviewed', []));
  const reviewBtns = $$('[data-review]');
  function paintReviewed(){
    reviewBtns.forEach(b => { const on = reviewed.has(b.dataset.review); b.setAttribute('aria-pressed', on); b.textContent = on ? 'Reviewed' : 'Mark as reviewed'; });
    $$('.toc-group a').forEach(a => a.classList.toggle('done', reviewed.has(a.dataset.id)));
    const n = reviewBtns.filter(b => reviewed.has(b.dataset.review)).length;
    $('#progress').textContent = n + ' of ' + reviewBtns.length + ' sections reviewed';
  }
  reviewBtns.forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.review; reviewed.has(id) ? reviewed.delete(id) : reviewed.add(id);
    store.set(ch + '.reviewed', [...reviewed]); paintReviewed();
  }));
  paintReviewed();

  // highlight the section in view
  const links = new Map($$('.toc-group a').map(a => [a.dataset.id, a]));
  if ('IntersectionObserver' in window) {
    const spy = new IntersectionObserver(entries => {
      entries.forEach(en => { if (en.isIntersecting) { links.forEach(a => a.classList.remove('current')); const a = links.get(en.target.id); if (a) a.classList.add('current'); } });
    }, { rootMargin: '-35% 0px -60% 0px' });
    links.forEach((a, id) => { const t = document.getElementById(id); if (t) spy.observe(t); });
  }

  // written practice saves
  $$('textarea[data-write]').forEach(t => {
    const key = ch + '.write.' + t.dataset.write;
    t.value = store.get(key, '');
    t.addEventListener('input', () => store.set(key, t.value));
  });

  initTerms(ch, data.terms);

  const topicByKey = new Map(data.topics.map(t => [t[0], t]));
  initQuiz({
    questions: data.quiz.map(q => Object.assign({}, q, {_id: qid(ch, q), _ch: ch})),
    groups: [{name: '', chips: data.topics.map(([key, label]) => ({value: key, label}))}],
    chipOf: q => q.section,
    topicOf: q => { const t = topicByKey.get(q.section); return {label: t[1], href: '#' + t[2]}; },
    bestKey: ch + '.best',
    exportName: 'apworld-' + ch
  });
}

/* ---------- hub ---------- */
function initHub(){
  const chapters = Object.entries(DATA).sort((a, b) => a[1].meta.num - b[1].meta.num);
  const missed = missedStore.all();
  // progress on each chapter card
  $$('[data-card]').forEach(card => {
    const ch = card.dataset.card, d = DATA[ch]; if (!d) return;
    const total = d.meta.sections.length;
    const done = store.get(ch + '.reviewed', []).filter(id => d.meta.sections.includes(id)).length;
    const best = store.get(ch + '.best', null);
    const known = store.get(ch + '.known', []).length;
    const miss = d.quiz.filter(q => missed.has(qid(ch, q))).length;
    $('.meter span', card).style.width = (total ? done / total * 100 : 0) + '%';
    const stats = $('.stats', card); stats.textContent = '';
    const stat = (strong, rest) => { const s = el('span'); s.append(el('strong', {}, strong), document.createTextNode(' ' + rest)); stats.append(s); };
    stat(done + '/' + total, 'sections reviewed');
    stat(best === null ? '—' : best + '%', 'best quiz');
    stat(known + '/' + d.terms.length, 'terms learned');
    if (miss) stat(String(miss), 'missed questions to retry');
  });

  const questions = [], groups = [], topicMap = new Map();
  chapters.forEach(([ch, d]) => {
    const chips = d.topics.map(([key, label, anchor]) => { const v = ch + '|' + key; topicMap.set(v, {label: 'Ch ' + d.meta.num + ': ' + label, href: d.meta.href + '#' + anchor}); return {value: v, label}; });
    groups.push({name: 'Chapter ' + d.meta.num + ': ' + d.meta.title, chips});
    d.quiz.forEach(q => questions.push(Object.assign({}, q, {_id: qid(ch, q), _ch: ch})));
  });
  initQuiz({
    questions, groups,
    chipOf: q => q._ch + '|' + q.section,
    topicOf: q => topicMap.get(q._ch + '|' + q.section),
    bestKey: 'hub.best',
    exportName: 'apworld-cumulative'
  });
}

initTheme();
const ch = document.body.dataset.chapter;
if (ch) initChapter(ch);
else if (document.body.dataset.page === 'hub') initHub();
})();
