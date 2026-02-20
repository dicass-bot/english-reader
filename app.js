/* English Reader SPA v2 */
(function () {
  'use strict';

  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $$ = (sel, ctx) => [...(ctx || document).querySelectorAll(sel)];

  let indexData = null;   // {levels: {L1: [...], custom: [...]}}
  let currentCat = null;  // 'L1', 'custom', etc.
  let currentNum = null;  // '0001'
  let dayData = null;
  let audio = null;
  let grammarVisible = false;
  let sentTtsRate = 1;
  let pendingSentIdx = null; // 팝업 스택: 단어 팝업 닫으면 복귀할 문장 인덱스

  const VOCAB_STORE_KEY = 'english-reader-vocabulary';

  /* ── Vocabulary Store (localStorage) ── */

  function vocabStore() {
    try {
      return JSON.parse(localStorage.getItem(VOCAB_STORE_KEY)) || { words: [], completed: [] };
    } catch { return { words: [], completed: [] }; }
  }

  function vocabSave(store) {
    localStorage.setItem(VOCAB_STORE_KEY, JSON.stringify(store));
  }

  function vocabAdd(word, pos, meaning, ipa, source) {
    const store = vocabStore();
    if (store.words.some(w => w.word === word && w.source === source)) return false;
    store.words.push({ word, pos, meaning, ipa, source, addedAt: new Date().toISOString() });
    vocabSave(store);
    return true;
  }

  function vocabComplete(word, source) {
    const store = vocabStore();
    const idx = store.words.findIndex(w => w.word === word && w.source === source);
    if (idx === -1) return;
    const item = store.words.splice(idx, 1)[0];
    store.completed.push({ ...item, completedAt: new Date().toISOString() });
    vocabSave(store);
  }

  function vocabUncomplete(word, source) {
    const store = vocabStore();
    const idx = store.completed.findIndex(w => w.word === word && w.source === source);
    if (idx === -1) return;
    const item = store.completed.splice(idx, 1)[0];
    delete item.completedAt;
    store.words.push(item);
    vocabSave(store);
  }

  function vocabIsAdded(word, source) {
    const store = vocabStore();
    return store.words.some(w => w.word === word && w.source === source);
  }

  /* ── Bootstrap ── */

  async function init() {
    show('#loading');
    try {
      const res = await fetch('index.json');
      indexData = res.ok ? await res.json() : { levels: {} };
    } catch { indexData = { levels: {} }; }
    hide('#loading');
    route();
    window.addEventListener('hashchange', route);
    setupPopupListeners();
    setupVocabTabs();
    setupMyVocabPage();
  }

  function route() {
    const hash = location.hash || '#/';

    // #/L1/0001 or #/custom/0001
    const contentMatch = hash.match(/#\/([^/]+)\/(\d{4})/);
    if (contentMatch) {
      loadContent(contentMatch[1], contentMatch[2]);
      return;
    }
    // #/vocabulary
    if (hash === '#/vocabulary') {
      showVocabularyPage();
      return;
    }
    // Home
    showHome();
  }

  /* ── Home ── */

  function showHome() {
    currentCat = null;
    currentNum = null;
    dayData = null;
    hide('#day-view');
    hide('#vocabulary-page');
    show('#home');
    updateHeaderForHome();
    renderHome();
  }

  function updateHeaderForHome() {
    const sel = $('#sel-category');
    sel.innerHTML = '<option value="">English Reader</option>';
    Object.keys(indexData.levels || {}).forEach(cat => {
      const label = cat === 'custom' ? 'Custom' : `Level ${cat.slice(1)}`;
      sel.innerHTML += `<option value="${cat}">${label}</option>`;
    });
    sel.value = '';
    $('#sel-num').style.display = 'none';
    $('#btn-prev').disabled = true;
    $('#btn-next').disabled = true;
  }

  function renderHome() {
    const container = $('#home-categories');
    container.innerHTML = '';
    const levels = indexData.levels || {};
    const cats = Object.keys(levels);

    if (cats.length === 0) {
      show('#empty-msg');
      return;
    }
    hide('#empty-msg');

    cats.forEach(cat => {
      const label = cat === 'custom' ? 'Custom' : `Level ${cat.slice(1)}`;
      const entries = levels[cat];
      const section = document.createElement('div');
      section.className = 'home-section';
      section.innerHTML = `<h3 class="home-section-title">${label} <span class="badge">${entries.length}</span></h3>`;

      const list = document.createElement('ul');
      list.className = 'home-list';
      [...entries].sort((a, b) => b.num.localeCompare(a.num)).forEach(e => {
        const li = document.createElement('li');
        li.innerHTML = `
          <span class="day-num">#${e.num}</span>
          <span class="day-title">${e.title} - ${e.author}</span>
        `;
        li.addEventListener('click', () => { location.hash = `#/${cat}/${e.num}`; });
        list.appendChild(li);
      });
      section.appendChild(list);
      container.appendChild(section);
    });
  }

  /* ── Content View ── */

  async function loadContent(cat, num) {
    currentCat = cat;
    currentNum = num;
    hide('#home');
    hide('#vocabulary-page');
    show('#loading');

    const prefix = `${cat}-${num}`;
    try {
      const res = await fetch(`days/${prefix}.json`);
      if (!res.ok) throw new Error('not found');
      dayData = await res.json();
    } catch {
      dayData = null;
      hide('#loading');
      showHome();
      return;
    }

    hide('#loading');
    show('#day-view');
    renderDay();
    updateHeaderForContent();
    updateNav();
  }

  function updateHeaderForContent() {
    const sel = $('#sel-category');
    sel.innerHTML = '';
    Object.keys(indexData.levels || {}).forEach(cat => {
      const label = cat === 'custom' ? 'Custom' : `Level ${cat.slice(1)}`;
      sel.innerHTML += `<option value="${cat}">${label}</option>`;
    });
    sel.value = currentCat;

    const numSel = $('#sel-num');
    numSel.style.display = '';
    populateNumSelect(currentCat);
    numSel.value = currentNum;
  }

  function populateNumSelect(cat) {
    const numSel = $('#sel-num');
    numSel.innerHTML = '';
    const entries = (indexData.levels || {})[cat] || [];
    entries.forEach(e => {
      numSel.innerHTML += `<option value="${e.num}">#${e.num}</option>`;
    });
  }

  function renderDay() {
    const d = dayData;
    const catLabel = d.category === 'custom' ? 'Custom' : `Level ${d.category.slice(1)}`;

    $('#source-title').textContent = d.source.title;
    $('#source-author').textContent = `by ${d.source.author}`;
    $('#source-level').textContent = `${catLabel} #${d.num}`;

    setupAudio(d);
    renderPassage(d.passage, d.words);

    grammarVisible = false;
    hide('#grammar-view');
    $('#btn-grammar').classList.remove('active');
    $('#btn-grammar').textContent = 'Show Grammar';
    renderGrammar(d.grammar);

    hide('#translation-view');
    $('#btn-translation').classList.remove('active');
    $('#btn-translation').textContent = 'Show Translation';
    renderTranslation(d.translation);

    renderVocab(d.keyVocab, d.words, d.audio);
    renderAllWords(d);
    renderQuiz(d.quiz);

    $('#btn-grammar').onclick = toggleGrammar;
    $('#btn-translation').onclick = toggleTranslation;
    $('#btn-answer').onclick = toggleAnswer;

    // Reset vocab tabs to Key Words
    $$('.vocab-tab').forEach(t => t.classList.remove('active'));
    $('.vocab-tab[data-tab="key"]').classList.add('active');
    show('#vocab-key');
    hide('#vocab-all');
  }

  /* ── Passage ── */

  function renderPassage(text, words) {
    const container = $('#passage-text');
    container.innerHTML = '';
    let sentIdx = 0;
    text.split(/(\s+)/).forEach(token => {
      if (/^\s+$/.test(token)) {
        container.appendChild(document.createTextNode(token));
        return;
      }
      const match = token.match(/^([^a-zA-Z''\u2019-]*)([a-zA-Z''\u2019-]+)([^a-zA-Z''\u2019-]*)$/);
      if (match) {
        if (match[1]) container.appendChild(document.createTextNode(match[1]));
        const span = document.createElement('span');
        span.className = 'word';
        span.textContent = match[2];
        span.dataset.word = match[2].toLowerCase().replace(/['\u2019']/g, "'");
        span.dataset.sent = String(sentIdx);
        span.addEventListener('click', () => {
          showWordPopup(span.dataset.word, words);
          highlightSentenceFromWord(parseInt(span.dataset.sent));
        });
        container.appendChild(span);
        if (match[3]) {
          container.appendChild(document.createTextNode(match[3]));
          if (/[.!?]/.test(match[3])) sentIdx++;
        }
      } else {
        container.appendChild(document.createTextNode(token));
        if (/[.!?]$/.test(token)) sentIdx++;
      }
    });
  }

  /* ── Grammar ── */

  function renderGrammar(grammar) {
    const container = $('#grammar-content');
    container.innerHTML = '';
    if (!grammar || !grammar.sentences || grammar.sentences.length === 0) return;

    const legend = document.createElement('div');
    legend.className = 'grammar-legend';
    [['subject','Subject'],['verb','Verb'],['object','Object'],['complement','Complement'],['adverbial','Adverbial']]
      .forEach(([cls, label]) => {
        legend.innerHTML += `<span class="legend-item"><span class="legend-dot ${cls}"></span>${label}</span>`;
      });
    container.appendChild(legend);

    grammar.sentences.forEach(s => {
      const div = document.createElement('div');
      div.className = 'grammar-sentence';
      let html = `<div class="sentence-text">${esc(s.text)}</div><div class="grammar-components">`;
      const structure = s.structure || {};
      ['subject','verb','object','complement','adverbial'].forEach(key => {
        const comp = structure[key];
        if (!comp) return;
        const color = `var(--g-${key})`;
        html += `<span class="grammar-component"><span class="g-text" style="background:${color}22;color:${color};border:1px solid ${color}44">${esc(comp.text)}</span><span class="g-label">${esc(comp.label || key)}</span></span>`;
      });
      html += '</div>';
      if (s.pattern) html += `<div class="grammar-pattern"><span class="pattern-name">${esc(s.pattern.name)}</span> — ${esc(s.pattern.note || '')}</div>`;
      div.innerHTML = html;
      container.appendChild(div);
    });
  }

  function toggleGrammar() {
    grammarVisible = !grammarVisible;
    const btn = $('#btn-grammar');
    if (grammarVisible) {
      show('#grammar-view'); btn.classList.add('active'); btn.textContent = 'Hide Grammar';
      applyGrammarHighlights();
    } else {
      hide('#grammar-view'); btn.classList.remove('active'); btn.textContent = 'Show Grammar';
      removeGrammarHighlights();
    }
  }

  function applyGrammarHighlights() {
    if (!dayData?.grammar?.sentences) return;
    removeGrammarHighlights();
    const spans = $$('.word', $('#passage-text'));
    dayData.grammar.sentences.forEach(s => {
      Object.entries(s.structure || {}).forEach(([key, comp]) => {
        if (!comp?.text) return;
        const cls = `g-${key}`;
        const words = comp.text.toLowerCase().split(/\s+/).map(w => w.replace(/[^a-z''-]/g, ''));
        spans.forEach(sp => { if (words.includes(sp.dataset.word)) sp.classList.add(cls); });
      });
    });
  }

  function removeGrammarHighlights() {
    $$('.word', $('#passage-text')).forEach(sp => {
      sp.classList.remove('g-subject','g-verb','g-object','g-complement','g-adverbial');
    });
  }

  /* ── Translation ── */

  function renderTranslation(translation) {
    const container = $('#translation-text');
    container.innerHTML = '';
    if (!translation) return;
    const sentences = translation.match(/[^.!?]+[.!?]+\s*/g) || [translation];
    sentences.forEach((sent, idx) => {
      const span = document.createElement('span');
      span.className = 't-sent';
      span.dataset.sent = String(idx);
      span.textContent = sent.trim();
      span.addEventListener('click', () => toggleSentenceHighlight(idx));
      container.appendChild(span);
      if (idx < sentences.length - 1) container.appendChild(document.createTextNode(' '));
    });
  }

  function toggleTranslation() {
    const view = $('#translation-view');
    const btn = $('#btn-translation');
    if (view.classList.contains('hidden')) {
      show('#translation-view'); btn.classList.add('active'); btn.textContent = 'Hide Translation';
    } else {
      hide('#translation-view'); btn.classList.remove('active'); btn.textContent = 'Show Translation';
      clearSentenceHighlight();
    }
  }

  function toggleSentenceHighlight(sentIdx) {
    const popup = $('#sent-popup');
    if (!popup.classList.contains('hidden') && popup.dataset.sent === String(sentIdx)) {
      hideSentencePopup(); return;
    }
    clearSentenceHighlight();
    $$('.word', $('#passage-text')).forEach(sp => {
      if (parseInt(sp.dataset.sent) === sentIdx) sp.classList.add('sent-highlight');
    });
    const tSent = $(`.t-sent[data-sent="${sentIdx}"]`, $('#translation-text'));
    if (tSent) tSent.classList.add('active');
    showSentencePopup(sentIdx);
  }

  function highlightSentenceFromWord(sentIdx) {
    clearSentenceHighlight();
    $$('.word', $('#passage-text')).forEach(s => {
      if (parseInt(s.dataset.sent) === sentIdx) s.classList.add('sent-highlight');
    });
    if (!$('#translation-view').classList.contains('hidden')) {
      const tSent = $(`.t-sent[data-sent="${sentIdx}"]`, $('#translation-text'));
      if (tSent) { tSent.classList.add('active'); tSent.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
    }
  }

  /* ── Sentence Popup ── */

  function showSentencePopup(sentIdx) {
    const popup = $('#sent-popup');
    popup.dataset.sent = String(sentIdx);

    const enSentences = dayData.passage.match(/[^.!?]*[.!?]+/g) || [dayData.passage];
    const koSentences = (dayData.translation || '').match(/[^.!?]+[.!?]+\s*/g) || [];
    $('#sent-en').textContent = (enSentences[sentIdx] || '').trim();
    $('#sent-ko').textContent = (koSentences[sentIdx] || '').trim();
    $('#sent-play-btn').onclick = () => speakSentence((enSentences[sentIdx] || '').trim());

    const wordList = $('#sent-word-list');
    wordList.innerHTML = '';
    const wordSpans = $$('.word', $('#passage-text')).filter(s => parseInt(s.dataset.sent) === sentIdx);
    const seen = new Set();
    wordSpans.forEach(s => {
      const w = s.dataset.word;
      if (seen.has(w)) return;
      seen.add(w);
      const info = dayData.words[w] || {};
      const primary = (info.meanings || []).find(m => m.primary) || (info.meanings || [])[0] || {};
      const row = document.createElement('div');
      row.className = 'sent-word-row';
      row.innerHTML = `<span class="sent-word-en">${esc(w)}</span><span class="sent-word-pos">${esc(info.pos || '')}</span><span class="sent-word-ko">${esc(primary.ko || '')}</span>`;
      row.addEventListener('click', () => {
        // 팝업 스택: 문장 인덱스 저장 후 단어 팝업 열기
        pendingSentIdx = sentIdx;
        hideSentencePopupQuiet();
        setTimeout(() => showWordPopup(w, dayData.words), 100);
      });
      wordList.appendChild(row);
    });

    // Grammar
    const gMatch = dayData?.grammar?.sentences?.[sentIdx];
    const grammarEl = $('#sent-grammar');
    grammarEl.innerHTML = '';
    if (gMatch) {
      show('#sent-grammar-section');
      let html = '';
      if (gMatch.pattern) html += `<div class="sent-grammar-pattern"><span class="pattern-name">${esc(gMatch.pattern.name)}</span> — ${esc(gMatch.pattern.note || '')}</div>`;
      ['subject','verb','object','complement','adverbial'].forEach(key => {
        const comp = (gMatch.structure || {})[key];
        if (!comp) return;
        html += `<div class="sent-grammar-comp"><span class="sgc-label ${key}">${esc(comp.label || key)}</span><span class="sgc-text">${esc(comp.text)}</span></div>`;
      });
      if (gMatch.explanation) html += `<div class="sent-grammar-explain">${esc(gMatch.explanation)}</div>`;
      if (gMatch.grammarPoints?.length) {
        html += '<div class="sent-grammar-points">';
        gMatch.grammarPoints.forEach(pt => { html += `<span class="grammar-point-tag">${esc(pt)}</span>`; });
        html += '</div>';
      }
      if (gMatch.examples?.length) {
        html += '<div class="sent-grammar-examples"><div class="sent-section-label">Examples</div>';
        gMatch.examples.forEach(ex => { html += `<div class="grammar-example"><div class="ex-en">${esc(ex.en)}</div><div class="ex-ko">${esc(ex.ko)}</div></div>`; });
        html += '</div>';
      }
      grammarEl.innerHTML = html;
    } else {
      hide('#sent-grammar-section');
    }

    show('#sent-overlay');
    show('#sent-popup');
    requestAnimationFrame(() => popup.classList.add('show'));
  }

  function hideSentencePopup() {
    pendingSentIdx = null;
    hideSentencePopupQuiet();
    clearSentenceHighlight();
  }

  function hideSentencePopupQuiet() {
    const popup = $('#sent-popup');
    popup.classList.remove('show');
    setTimeout(() => { hide('#sent-popup'); hide('#sent-overlay'); }, 300);
  }

  function clearSentenceHighlight() {
    $$('.word.sent-highlight', $('#passage-text')).forEach(s => s.classList.remove('sent-highlight'));
    $$('.t-sent.active', $('#translation-text')).forEach(s => s.classList.remove('active'));
  }

  /* ── Audio ── */

  function setupAudio(d) {
    if (audio) { audio.pause(); audio = null; }
    if (!d.audio?.passage) { hide('#audio-player'); return; }
    show('#audio-player');
    audio = new Audio(d.audio.passage);
    audio.preload = 'metadata';
    const playBtn = $('#btn-play');
    const progressEl = $('#audio-progress');
    const timeEl = $('#audio-time');
    playBtn.innerHTML = '&#9654;';
    playBtn.onclick = () => {
      if (audio.paused) { audio.play(); playBtn.innerHTML = '&#10074;&#10074;'; }
      else { audio.pause(); playBtn.innerHTML = '&#9654;'; }
    };
    audio.addEventListener('timeupdate', () => {
      if (audio.duration) { progressEl.value = (audio.currentTime / audio.duration) * 100; timeEl.textContent = fmtTime(audio.currentTime); }
    });
    audio.addEventListener('ended', () => { playBtn.innerHTML = '&#9654;'; progressEl.value = 0; });
    progressEl.addEventListener('input', () => { if (audio.duration) audio.currentTime = (progressEl.value / 100) * audio.duration; });
    $$('.speed-btn').forEach(btn => {
      btn.classList.remove('active');
      if (parseFloat(btn.dataset.speed) === 1) btn.classList.add('active');
      btn.onclick = () => {
        audio.playbackRate = parseFloat(btn.dataset.speed);
        $$('.speed-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      };
    });
  }

  /* ── Key Vocab ── */

  function renderVocab(keyVocab, words, audioData) {
    const container = $('#vocab-list');
    container.innerHTML = '';
    if (!keyVocab?.length) return;
    keyVocab.forEach(word => {
      const info = words[word.toLowerCase()] || words[word] || {};
      const primary = (info.meanings || []).find(m => m.primary) || (info.meanings || [])[0] || {};
      const div = document.createElement('div');
      div.className = 'vocab-item';
      div.innerHTML = `<div><div class="vocab-word">${esc(word)}</div><div class="vocab-ipa">${esc(info.ipa || '')}</div></div><div class="vocab-meaning">${esc(primary.ko || '')}</div>`;
      div.addEventListener('click', () => showWordPopup(word.toLowerCase(), words));
      container.appendChild(div);
    });
  }

  /* ── All Words ── */

  function renderAllWords(d) {
    const container = $('#vocab-all-list');
    container.innerHTML = '';
    if (!d?.words) return;

    const passageWords = d.passage.toLowerCase().replace(/[^a-z'\s-]/g, '').split(/\s+/);
    const sortMode = $('.vsort-btn.active')?.dataset.sort || 'appear';
    const filterMode = $('.vfilter-btn.active')?.dataset.filter || 'all';

    let entries = Object.entries(d.words);

    // Filter
    if (filterMode !== 'all') {
      entries = entries.filter(([, info]) => {
        const pos = (info.pos || '').toLowerCase();
        if (filterMode === 'noun') return pos.includes('noun');
        if (filterMode === 'verb') return pos.includes('verb');
        if (filterMode === 'adj') return pos.includes('adj');
        return !pos.includes('noun') && !pos.includes('verb') && !pos.includes('adj');
      });
    }

    // Sort
    if (sortMode === 'alpha') {
      entries.sort((a, b) => a[0].localeCompare(b[0]));
    } else if (sortMode === 'pos') {
      entries.sort((a, b) => ((a[1].pos || '').localeCompare(b[1].pos || '')) || a[0].localeCompare(b[0]));
    } else {
      // appear order
      entries.sort((a, b) => {
        const ia = passageWords.indexOf(a[0]);
        const ib = passageWords.indexOf(b[0]);
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      });
    }

    entries.forEach(([word, info]) => {
      const primary = (info.meanings || []).find(m => m.primary) || (info.meanings || [])[0] || {};
      const div = document.createElement('div');
      div.className = 'vocab-item';
      div.innerHTML = `
        <div><div class="vocab-word">${esc(word)}</div><div class="vocab-ipa">${esc(info.ipa || '')}</div></div>
        <div class="vocab-pos-badge">${esc((info.pos || '').split(' ')[0])}</div>
        <div class="vocab-meaning">${esc(primary.ko || '')}</div>`;
      div.addEventListener('click', () => showWordPopup(word, d.words));
      container.appendChild(div);
    });
  }

  function setupVocabTabs() {
    $$('.vocab-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        $$('.vocab-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        if (tab.dataset.tab === 'key') { show('#vocab-key'); hide('#vocab-all'); }
        else { hide('#vocab-key'); show('#vocab-all'); if (dayData) renderAllWords(dayData); }
      });
    });

    // Sort/filter buttons
    document.addEventListener('click', e => {
      if (e.target.classList.contains('vsort-btn')) {
        $$('.vsort-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        if (dayData) renderAllWords(dayData);
      }
      if (e.target.classList.contains('vfilter-btn')) {
        $$('.vfilter-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        if (dayData) renderAllWords(dayData);
      }
    });
  }

  /* ── Quiz ── */

  function renderQuiz(quiz) {
    if (!quiz?.question) { hide('#quiz-section'); return; }
    show('#quiz-section');
    $('#quiz-question').textContent = quiz.question;
    $('#quiz-answer').textContent = quiz.answer || '';
    hide('#quiz-answer');
    $('#btn-answer').classList.remove('active');
    $('#btn-answer').textContent = 'Show Answer';
  }

  function toggleAnswer() {
    const el = $('#quiz-answer');
    const btn = $('#btn-answer');
    if (el.classList.contains('hidden')) { show('#quiz-answer'); btn.classList.add('active'); btn.textContent = 'Hide Answer'; }
    else { hide('#quiz-answer'); btn.classList.remove('active'); btn.textContent = 'Show Answer'; }
  }

  /* ── Word Popup (Enhanced) ── */

  function showWordPopup(wordKey, words) {
    const info = words[wordKey] || words[wordKey.toLowerCase()];
    if (!info) return;

    const source = currentCat && currentNum ? `${currentCat}-${currentNum}` : '';

    $('#popup-word').textContent = wordKey;
    $('#popup-ipa').textContent = info.ipa || '';
    $('#popup-pos').textContent = info.pos || '';

    // Register
    const regEl = $('#popup-register');
    if (info.register) { regEl.textContent = info.register; regEl.style.display = ''; }
    else { regEl.style.display = 'none'; }

    // Frequency stars
    const freq = info.frequency || 0;
    $('#popup-frequency').innerHTML = freq ? '★'.repeat(freq) + '☆'.repeat(5 - freq) : '';

    // Meanings
    const meaningsEl = $('#popup-meanings');
    meaningsEl.innerHTML = '';
    (info.meanings || []).forEach(m => {
      const div = document.createElement('div');
      div.className = 'meaning-item' + (m.primary ? ' primary' : '');
      div.innerHTML = `<span class="m-ko">${esc(m.ko || '')}</span><span class="m-en">${esc(m.en || '')}</span>${m.primary ? '<span class="m-badge">here</span>' : ''}`;
      meaningsEl.appendChild(div);
    });

    // Context
    const contextEl = $('#popup-context');
    const ctxText = info.contextMeaning || info.contextNote || '';
    if (ctxText) { contextEl.textContent = ctxText; contextEl.style.display = 'block'; }
    else { contextEl.style.display = 'none'; }

    // Section 1: Forms (always visible)
    const formsEl = $('#popup-forms');
    formsEl.innerHTML = '';
    const forms = info.forms || [];
    if (Array.isArray(forms) && forms.length) {
      forms.forEach(f => {
        formsEl.innerHTML += `<span class="form-tag"><span class="form-label">${esc(f.label)}</span> ${esc(f.form)}</span>`;
      });
      show('#popup-forms-section');
    } else if (forms.base) {
      // Legacy format support
      if (forms.base) formsEl.innerHTML += `<span class="form-tag"><span class="form-label">원형</span> ${esc(forms.base)}</span>`;
      if (forms.tense) formsEl.innerHTML += `<span class="form-tag">${esc(forms.tense)}</span>`;
      (forms.related || []).forEach(r => { formsEl.innerHTML += `<span class="form-tag">${esc(r)}</span>`; });
      show('#popup-forms-section');
    } else {
      hide('#popup-forms-section');
    }

    // Etymology
    const etymEl = $('#popup-etymology');
    etymEl.innerHTML = '';
    if (info.etymology?.parts?.length) {
      let html = '<div class="etym-parts">';
      info.etymology.parts.forEach((p, i) => {
        if (i > 0) html += '<span class="etym-plus">+</span>';
        html += `<span class="etym-part"><span class="etym-word">${esc(p.part)}</span><span class="etym-meaning">${esc(p.meaning)}</span></span>`;
      });
      html += '</div>';
      if (info.etymology.note) html += `<div class="etym-note">${esc(info.etymology.note)}</div>`;
      etymEl.innerHTML = html;
    }

    // Section 2: Related (collapsible)
    const synEl = $('#popup-synonyms');
    const antEl = $('#popup-antonyms');
    const confEl = $('#popup-confusables');
    synEl.innerHTML = '';
    antEl.innerHTML = '';
    confEl.innerHTML = '';
    let hasRelated = false;

    if (info.synonyms?.length) {
      synEl.innerHTML = `<div class="popup-field-label">유의어</div><div class="tag-list">${info.synonyms.map(s => `<span class="rel-tag syn">${esc(s)}</span>`).join('')}</div>`;
      hasRelated = true;
    }
    if (info.antonyms?.length) {
      antEl.innerHTML = `<div class="popup-field-label">반의어</div><div class="tag-list">${info.antonyms.map(a => `<span class="rel-tag ant">${esc(a)}</span>`).join('')}</div>`;
      hasRelated = true;
    }
    if (info.confusables?.length) {
      confEl.innerHTML = `<div class="popup-field-label">혼동 주의</div>${info.confusables.map(c => `<div class="confusable"><span class="conf-word">${esc(c.word)}</span> <span class="conf-note">${esc(c.note)}</span></div>`).join('')}`;
      hasRelated = true;
    }
    if (hasRelated) show('#popup-related-section'); else hide('#popup-related-section');

    // Section 3: Expressions (collapsible)
    const collEl = $('#popup-collocations');
    const idiomEl = $('#popup-idioms');
    const exEl = $('#popup-examples');
    collEl.innerHTML = '';
    idiomEl.innerHTML = '';
    exEl.innerHTML = '';
    let hasExpr = false;

    if (info.collocations?.length) {
      collEl.innerHTML = `<div class="popup-field-label">연어</div><div class="tag-list">${info.collocations.map(c => `<span class="rel-tag coll">${esc(c)}</span>`).join('')}</div>`;
      hasExpr = true;
    }
    if (info.idioms?.length) {
      idiomEl.innerHTML = `<div class="popup-field-label">숙어</div>${info.idioms.map(i => `<div class="idiom-item"><span class="idiom-phrase">${esc(i.phrase)}</span> <span class="idiom-ko">${esc(i.ko || i.meaning || '')}</span></div>`).join('')}`;
      hasExpr = true;
    }
    if (info.examples?.length) {
      exEl.innerHTML = `<div class="popup-field-label">예문</div>${info.examples.map(e => `<div class="example-item"><div class="ex-en">${esc(e.en)}</div><div class="ex-ko">${esc(e.ko)}</div></div>`).join('')}`;
      hasExpr = true;
    }
    if (hasExpr) show('#popup-expressions-section'); else hide('#popup-expressions-section');

    // Section 4: Korean Tips (collapsible)
    const tipsEl = $('#popup-korean-tips');
    tipsEl.innerHTML = '';
    if (info.koreanTips?.length) {
      tipsEl.innerHTML = info.koreanTips.map(t => `<div class="tip-item">${esc(t)}</div>`).join('');
      show('#popup-tips-section');
    } else {
      hide('#popup-tips-section');
    }

    // Reset collapsibles
    $$('#word-popup .collapsible-body').forEach(b => b.classList.add('hidden'));
    $$('#word-popup .chevron').forEach(c => c.innerHTML = '&#9654;');

    // Add to vocab button
    const addBtn = $('#popup-add-vocab');
    if (vocabIsAdded(wordKey, source)) {
      addBtn.textContent = '✓ 단어장에 등록됨';
      addBtn.classList.add('added');
      addBtn.onclick = null;
    } else {
      addBtn.textContent = '+ 단어장에 추가';
      addBtn.classList.remove('added');
      addBtn.onclick = () => {
        const primary = (info.meanings || []).find(m => m.primary) || (info.meanings || [])[0] || {};
        vocabAdd(wordKey, info.pos || '', primary.ko || '', info.ipa || '', source);
        addBtn.textContent = '✓ 단어장에 등록됨';
        addBtn.classList.add('added');
        addBtn.onclick = null;
      };
    }

    // Audio
    show('#popup-audio-btn');
    const wordAudio = dayData?.audio?.words?.[wordKey];
    $('#popup-audio-btn').onclick = () => {
      if (wordAudio) new Audio(wordAudio).play();
      else speakWord(wordKey);
    };

    // Highlight
    $$('.word.active', $('#passage-text')).forEach(s => s.classList.remove('active'));
    const matchSpan = $$('.word', $('#passage-text')).find(s => s.dataset.word === wordKey);
    if (matchSpan) matchSpan.classList.add('active');

    show('#word-overlay');
    show('#word-popup');
    requestAnimationFrame(() => $('#word-popup').classList.add('show'));
  }

  function hideWordPopup() {
    const popup = $('#word-popup');
    popup.classList.remove('show');
    setTimeout(() => {
      hide('#word-popup');
      hide('#word-overlay');
      // 팝업 스택: 문장 팝업으로 복귀
      if (pendingSentIdx !== null) {
        const idx = pendingSentIdx;
        pendingSentIdx = null;
        setTimeout(() => showSentencePopup(idx), 100);
      }
    }, 300);
    $$('.word.active', $('#passage-text')).forEach(s => s.classList.remove('active'));
  }

  function setupPopupListeners() {
    // Word popup
    $('#word-overlay').addEventListener('click', hideWordPopup);
    let startY = 0;
    const popup = $('#word-popup');
    popup.addEventListener('touchstart', e => { startY = e.touches[0].clientY; }, { passive: true });
    popup.addEventListener('touchmove', e => { if (e.touches[0].clientY - startY > 80) hideWordPopup(); }, { passive: true });

    // Sentence popup
    $('#sent-overlay').addEventListener('click', hideSentencePopup);
    $$('.sent-speed-btn').forEach(btn => {
      btn.onclick = () => {
        sentTtsRate = parseFloat(btn.dataset.speed);
        $$('.sent-speed-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      };
    });
    let sentStartY = 0;
    const sentPopup = $('#sent-popup');
    sentPopup.addEventListener('touchstart', e => { sentStartY = e.touches[0].clientY; }, { passive: true });
    sentPopup.addEventListener('touchmove', e => { if (e.touches[0].clientY - sentStartY > 80) hideSentencePopup(); }, { passive: true });

    // Collapsible sections in word popup
    document.addEventListener('click', e => {
      const header = e.target.closest('.collapsible-header');
      if (!header) return;
      const body = header.closest('.collapsible')?.querySelector('.collapsible-body');
      const chevron = header.querySelector('.chevron');
      if (!body) return;
      body.classList.toggle('hidden');
      if (chevron) chevron.innerHTML = body.classList.contains('hidden') ? '&#9654;' : '&#9660;';
    });

    // Header category/num selects
    $('#sel-category').addEventListener('change', e => {
      const cat = e.target.value;
      if (!cat) { location.hash = '#/'; return; }
      const entries = (indexData.levels || {})[cat] || [];
      if (entries.length) {
        location.hash = `#/${cat}/${entries[0].num}`;
      }
    });
    $('#sel-num').addEventListener('change', e => {
      if (currentCat) location.hash = `#/${currentCat}/${e.target.value}`;
    });

    // My Vocabulary button
    $('#btn-vocab').addEventListener('click', () => { location.hash = '#/vocabulary'; });
  }

  /* ── Navigation ── */

  function updateNav() {
    if (!indexData || !currentCat) return;
    const entries = (indexData.levels[currentCat] || []).map(e => e.num).sort();
    const idx = entries.indexOf(currentNum);
    const prevBtn = $('#btn-prev');
    const nextBtn = $('#btn-next');

    if (idx > 0) {
      prevBtn.disabled = false;
      prevBtn.onclick = () => { location.hash = `#/${currentCat}/${entries[idx - 1]}`; };
    } else {
      prevBtn.disabled = true;
      prevBtn.onclick = () => { location.hash = '#/'; };
    }

    if (idx < entries.length - 1) {
      nextBtn.disabled = false;
      nextBtn.onclick = () => { location.hash = `#/${currentCat}/${entries[idx + 1]}`; };
    } else {
      nextBtn.disabled = true;
    }
  }

  /* ── My Vocabulary Page ── */

  function setupMyVocabPage() {
    $$('.mv-sort-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.mv-sort-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderMyVocabList();
      });
    });
    // completed toggle는 generic collapsible handler가 처리 (double toggle 방지)
  }

  function showVocabularyPage() {
    currentCat = null;
    currentNum = null;
    dayData = null;
    hide('#home');
    hide('#day-view');
    show('#vocabulary-page');

    const sel = $('#sel-category');
    sel.innerHTML = '<option value="">My Vocabulary</option>';
    sel.value = '';
    $('#sel-num').style.display = 'none';
    $('#btn-prev').disabled = false;
    $('#btn-prev').onclick = () => { location.hash = '#/'; };
    $('#btn-next').disabled = true;

    renderMyVocabList();
  }

  function renderMyVocabList() {
    const store = vocabStore();
    const container = $('#my-vocab-list');
    container.innerHTML = '';
    $('#vocab-count').textContent = store.words.length;
    $('#completed-count').textContent = store.completed.length;

    let items = [...store.words];
    const sortMode = $('.mv-sort-btn.active')?.dataset.sort || 'recent';

    if (sortMode === 'alpha') items.sort((a, b) => a.word.localeCompare(b.word));
    else if (sortMode === 'level') items.sort((a, b) => (a.source || '').localeCompare(b.source || ''));
    else items.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));

    items.forEach(item => {
      const div = document.createElement('div');
      div.className = 'my-vocab-card';
      div.innerHTML = `
        <div class="mv-top">
          <span class="mv-word">${esc(item.word)}</span>
          <span class="mv-pos badge">${esc(item.pos || '')}</span>
          <span class="mv-meaning">${esc(item.meaning || '')}</span>
        </div>
        <div class="mv-bottom">
          <span class="mv-ipa">${esc(item.ipa || '')}</span>
          <span class="mv-source badge">${esc(item.source || '')}</span>
          <span class="mv-date">${new Date(item.addedAt).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}</span>
          <button class="mv-detail-btn">상세</button>
          <button class="mv-complete-btn">✓ 완료</button>
        </div>`;

      div.querySelector('.mv-detail-btn').addEventListener('click', async () => {
        const src = item.source || '';
        const dashIdx = src.indexOf('-');
        if (dashIdx === -1) return;
        const cat = src.substring(0, dashIdx);
        const num = src.substring(dashIdx + 1);
        try {
          const res = await fetch(`days/${cat}-${num}.json`);
          if (!res.ok) return;
          const data = await res.json();
          showWordPopup(item.word, data.words);
        } catch {}
      });

      div.querySelector('.mv-complete-btn').addEventListener('click', () => {
        vocabComplete(item.word, item.source);
        renderMyVocabList();
      });

      container.appendChild(div);
    });

    // Completed list
    const compList = $('#completed-list');
    compList.innerHTML = '';
    const recent = store.completed.slice(-20).reverse();
    recent.forEach(item => {
      const div = document.createElement('div');
      div.className = 'completed-card';
      div.innerHTML = `
        <span class="cc-word">${esc(item.word)}</span>
        <span class="cc-pos badge">${esc(item.pos || '')}</span>
        <span class="cc-meaning">${esc(item.meaning || '')}</span>
        <span class="cc-date">${item.completedAt ? new Date(item.completedAt).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }) : ''}</span>
        <button class="cc-undo-btn">취소</button>`;
      div.querySelector('.cc-undo-btn').addEventListener('click', () => {
        vocabUncomplete(item.word, item.source);
        renderMyVocabList();
      });
      compList.appendChild(div);
    });
  }

  /* ── Helpers ── */

  function show(sel) { const el = typeof sel === 'string' ? $(sel) : sel; if (el) el.classList.remove('hidden'); }
  function hide(sel) { const el = typeof sel === 'string' ? $(sel) : sel; if (el) el.classList.add('hidden'); }
  function esc(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }
  function fmtTime(sec) { return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`; }

  function speakWord(word) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(word);
    u.lang = 'en-US'; u.rate = 0.8;
    window.speechSynthesis.speak(u);
  }

  function speakSentence(text) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US'; u.rate = sentTtsRate;
    window.speechSynthesis.speak(u);
  }

  /* ── Service Worker ── */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  /* ── Start ── */
  document.addEventListener('DOMContentLoaded', init);
})();
