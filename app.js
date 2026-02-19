/* English Reader - SPA */
(function () {
  'use strict';

  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $$ = (sel, ctx) => [...(ctx || document).querySelectorAll(sel)];

  let indexData = null;
  let currentDay = null;
  let dayData = null;
  let audio = null;
  let grammarVisible = false;
  let sentTtsRate = 1;

  /* ── Bootstrap ── */

  async function init() {
    show('#loading');
    try {
      const res = await fetch('index.json');
      if (res.ok) {
        indexData = await res.json();
      } else {
        indexData = { days: [] };
      }
    } catch {
      indexData = { days: [] };
    }
    hide('#loading');
    route();
    window.addEventListener('hashchange', route);
    setupPopupListeners();
  }

  function route() {
    const hash = location.hash || '#/';
    const dayMatch = hash.match(/#\/day\/(\d+)/);
    if (dayMatch) {
      loadDay(parseInt(dayMatch[1], 10));
    } else {
      showHome();
    }
  }

  /* ── Home ── */

  function showHome() {
    currentDay = null;
    dayData = null;
    hide('#day-view');
    show('#home');
    $('#day-info').textContent = '';
    $('#btn-prev').disabled = true;
    $('#btn-next').disabled = true;
    renderDayList();
  }

  function renderDayList() {
    const list = $('#day-list');
    list.innerHTML = '';
    if (!indexData || indexData.days.length === 0) {
      show('#empty-msg');
      return;
    }
    hide('#empty-msg');
    const sorted = [...indexData.days].sort((a, b) => b.day - a.day);
    sorted.forEach(d => {
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="day-num">Day ${d.day}</span>
        <span class="day-title">${d.title} - ${d.author}</span>
        <span class="day-level">Lv.${d.level}</span>
      `;
      li.addEventListener('click', () => {
        location.hash = `#/day/${String(d.day).padStart(3, '0')}`;
      });
      list.appendChild(li);
    });
  }

  /* ── Day View ── */

  async function loadDay(dayNum) {
    currentDay = dayNum;
    hide('#home');
    show('#loading');

    const padded = String(dayNum).padStart(3, '0');
    try {
      const res = await fetch(`days/day-${padded}.json`);
      if (!res.ok) throw new Error('not found');
      dayData = await res.json();
    } catch {
      dayData = null;
      hide('#loading');
      show('#home');
      return;
    }

    hide('#loading');
    show('#day-view');
    renderDay();
    updateNav();
  }

  function renderDay() {
    const d = dayData;

    // Header info
    $('#day-info').textContent = `Day ${d.day} · Level ${d.level}`;

    // Source
    $('#source-title').textContent = d.source.title;
    $('#source-author').textContent = `by ${d.source.author}`;
    $('#source-level').textContent = `Level ${d.level}`;

    // Audio
    setupAudio(d);

    // Passage
    renderPassage(d.passage, d.words);

    // Grammar
    grammarVisible = false;
    hide('#grammar-view');
    $('#btn-grammar').classList.remove('active');
    $('#btn-grammar').textContent = 'Show Grammar';
    renderGrammar(d.grammar);

    // Translation
    hide('#translation-view');
    $('#btn-translation').classList.remove('active');
    $('#btn-translation').textContent = 'Show Translation';
    renderTranslation(d.translation);

    // Vocab
    renderVocab(d.keyVocab, d.words, d.audio);

    // Quiz
    renderQuiz(d.quiz);

    // Toggle listeners
    $('#btn-grammar').onclick = toggleGrammar;
    $('#btn-translation').onclick = toggleTranslation;
    $('#btn-answer').onclick = toggleAnswer;
  }

  /* ── Passage Rendering ── */

  function renderPassage(text, words) {
    const container = $('#passage-text');
    container.innerHTML = '';

    let sentIdx = 0;
    const tokens = text.split(/(\s+)/);
    tokens.forEach(token => {
      if (/^\s+$/.test(token)) {
        container.appendChild(document.createTextNode(token));
        return;
      }
      // Handle punctuation attached to words
      const match = token.match(/^([^a-zA-Z''-]*)([a-zA-Z''-]+)([^a-zA-Z''-]*)$/);
      if (match) {
        if (match[1]) container.appendChild(document.createTextNode(match[1]));
        const span = document.createElement('span');
        span.className = 'word';
        span.textContent = match[2];
        span.dataset.word = match[2].toLowerCase().replace(/['']/g, "'");
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

    // Legend
    const legend = document.createElement('div');
    legend.className = 'grammar-legend';
    const labels = [
      ['subject', 'Subject'],
      ['verb', 'Verb'],
      ['object', 'Object'],
      ['complement', 'Complement'],
      ['adverbial', 'Adverbial'],
    ];
    labels.forEach(([cls, label]) => {
      legend.innerHTML += `<span class="legend-item"><span class="legend-dot ${cls}"></span>${label}</span>`;
    });
    container.appendChild(legend);

    // Sentences
    grammar.sentences.forEach(s => {
      const div = document.createElement('div');
      div.className = 'grammar-sentence';

      let sentenceHtml = `<div class="sentence-text">${escapeHtml(s.text)}</div>`;
      sentenceHtml += '<div class="grammar-components">';

      const structure = s.structure || {};
      const componentOrder = ['subject', 'verb', 'object', 'complement', 'adverbial'];
      const colorMap = {
        subject: 'var(--g-subject)',
        verb: 'var(--g-verb)',
        object: 'var(--g-object)',
        complement: 'var(--g-complement)',
        adverbial: 'var(--g-adverbial)',
      };

      componentOrder.forEach(key => {
        const comp = structure[key];
        if (!comp) return;
        const color = colorMap[key] || 'var(--surface2)';
        sentenceHtml += `
          <span class="grammar-component">
            <span class="g-text" style="background:${color}22;color:${color};border:1px solid ${color}44">${escapeHtml(comp.text)}</span>
            <span class="g-label">${escapeHtml(comp.label || key)}</span>
          </span>
        `;
      });

      sentenceHtml += '</div>';

      if (s.pattern) {
        sentenceHtml += `<div class="grammar-pattern"><span class="pattern-name">${escapeHtml(s.pattern.name)}</span> — ${escapeHtml(s.pattern.note || '')}</div>`;
      }

      div.innerHTML = sentenceHtml;
      container.appendChild(div);
    });
  }

  function toggleGrammar() {
    grammarVisible = !grammarVisible;
    const btn = $('#btn-grammar');
    const view = $('#grammar-view');
    if (grammarVisible) {
      show('#grammar-view');
      btn.classList.add('active');
      btn.textContent = 'Hide Grammar';
      applyGrammarHighlights();
    } else {
      hide('#grammar-view');
      btn.classList.remove('active');
      btn.textContent = 'Show Grammar';
      removeGrammarHighlights();
    }
  }

  function applyGrammarHighlights() {
    if (!dayData || !dayData.grammar || !dayData.grammar.sentences) return;
    removeGrammarHighlights();

    const wordSpans = $$('.word', $('#passage-text'));
    const componentMap = {
      subject: 'g-subject',
      verb: 'g-verb',
      object: 'g-object',
      complement: 'g-complement',
      adverbial: 'g-adverbial',
    };

    dayData.grammar.sentences.forEach(s => {
      const structure = s.structure || {};
      Object.entries(structure).forEach(([key, comp]) => {
        if (!comp || !comp.text) return;
        const cls = componentMap[key];
        if (!cls) return;
        const compWords = comp.text.toLowerCase().split(/\s+/).map(w => w.replace(/[^a-z''-]/g, ''));
        wordSpans.forEach(span => {
          const w = span.dataset.word;
          if (compWords.includes(w)) {
            span.classList.add(cls);
          }
        });
      });
    });
  }

  function removeGrammarHighlights() {
    $$('.word', $('#passage-text')).forEach(span => {
      span.classList.remove('g-subject', 'g-verb', 'g-object', 'g-complement', 'g-adverbial');
    });
  }

  /* ── Translation Sentence Mapping ── */

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

      if (idx < sentences.length - 1) {
        container.appendChild(document.createTextNode(' '));
      }
    });
  }

  function toggleSentenceHighlight(sentIdx) {
    // If sentence popup already showing this sentence, close it
    const popup = $('#sent-popup');
    if (!popup.classList.contains('hidden') && popup.dataset.sent === String(sentIdx)) {
      hideSentencePopup();
      return;
    }

    clearSentenceHighlight();

    // Highlight passage words with matching sentence index
    $$('.word', $('#passage-text')).forEach(span => {
      if (parseInt(span.dataset.sent) === sentIdx) {
        span.classList.add('sent-highlight');
      }
    });

    // Highlight translation sentence
    const tSent = $(`.t-sent[data-sent="${sentIdx}"]`, $('#translation-text'));
    if (tSent) tSent.classList.add('active');

    // Show sentence popup
    showSentencePopup(sentIdx);
  }

  function highlightSentenceFromWord(sentIdx) {
    clearSentenceHighlight();
    // Highlight passage words
    $$('.word', $('#passage-text')).forEach(s => {
      if (parseInt(s.dataset.sent) === sentIdx) s.classList.add('sent-highlight');
    });
    // Highlight translation sentence if visible
    if (!$('#translation-view').classList.contains('hidden')) {
      const tSent = $(`.t-sent[data-sent="${sentIdx}"]`, $('#translation-text'));
      if (tSent) {
        tSent.classList.add('active');
        tSent.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }

  function showSentencePopup(sentIdx) {
    const popup = $('#sent-popup');
    popup.dataset.sent = String(sentIdx);

    // Get English & Korean sentences
    const enSentences = dayData.passage.match(/[^.!?]*[.!?]+/g) || [dayData.passage];
    const koSentences = (dayData.translation || '').match(/[^.!?]+[.!?]+\s*/g) || [];
    const enText = (enSentences[sentIdx] || '').trim();
    const koText = (koSentences[sentIdx] || '').trim();

    $('#sent-en').textContent = enText;
    $('#sent-ko').textContent = koText;

    // Play button
    $('#sent-play-btn').onclick = () => speakSentence(enText);

    // Word list — words in sentence order (no duplicates)
    const wordList = $('#sent-word-list');
    wordList.innerHTML = '';
    const wordSpans = $$('.word', $('#passage-text')).filter(
      s => parseInt(s.dataset.sent) === sentIdx
    );
    const seen = new Set();
    wordSpans.forEach(s => {
      const w = s.dataset.word;
      if (seen.has(w)) return;
      seen.add(w);

      const info = dayData.words[w] || {};
      const primary = (info.meanings || []).find(m => m.primary) || (info.meanings || [])[0] || {};

      const row = document.createElement('div');
      row.className = 'sent-word-row';
      row.innerHTML = `
        <span class="sent-word-en">${escapeHtml(w)}</span>
        <span class="sent-word-pos">${escapeHtml(info.pos || '')}</span>
        <span class="sent-word-ko">${escapeHtml(primary.ko || '')}</span>
      `;
      row.addEventListener('click', () => {
        hideSentencePopup();
        setTimeout(() => showWordPopup(w, dayData.words), 350);
      });
      wordList.appendChild(row);
    });

    // Grammar
    const grammarSection = $('#sent-grammar-section');
    const grammarEl = $('#sent-grammar');
    grammarEl.innerHTML = '';

    const gMatch = findGrammarForSentence(enText);
    if (gMatch) {
      show('#sent-grammar-section');
      let html = '';

      // Pattern
      if (gMatch.pattern) {
        html += `<div class="sent-grammar-pattern"><span class="pattern-name">${escapeHtml(gMatch.pattern.name)}</span> — ${escapeHtml(gMatch.pattern.note || '')}</div>`;
      }

      // Structure components
      const structure = gMatch.structure || {};
      const order = ['subject', 'verb', 'object', 'complement', 'adverbial'];
      order.forEach(key => {
        const comp = structure[key];
        if (!comp) return;
        html += `<div class="sent-grammar-comp"><span class="sgc-label ${key}">${escapeHtml(comp.label || key)}</span><span class="sgc-text">${escapeHtml(comp.text)}</span></div>`;
      });

      // Explanation
      if (gMatch.explanation) {
        html += `<div class="sent-grammar-explain">${escapeHtml(gMatch.explanation)}</div>`;
      }

      // Grammar points
      if (gMatch.grammarPoints && gMatch.grammarPoints.length) {
        html += '<div class="sent-grammar-points">';
        gMatch.grammarPoints.forEach(pt => {
          html += `<span class="grammar-point-tag">${escapeHtml(pt)}</span>`;
        });
        html += '</div>';
      }

      // Examples
      if (gMatch.examples && gMatch.examples.length) {
        html += '<div class="sent-grammar-examples"><div class="sent-section-label">Examples</div>';
        gMatch.examples.forEach(ex => {
          html += `<div class="grammar-example"><div class="ex-en">${escapeHtml(ex.en)}</div><div class="ex-ko">${escapeHtml(ex.ko)}</div></div>`;
        });
        html += '</div>';
      }

      grammarEl.innerHTML = html;
    } else {
      hide('#sent-grammar-section');
    }

    // Show popup
    show('#sent-overlay');
    show('#sent-popup');
    requestAnimationFrame(() => popup.classList.add('show'));
  }

  function findGrammarForSentence(sentText) {
    if (!dayData || !dayData.grammar || !dayData.grammar.sentences) return null;
    const normalized = sentText.trim().toLowerCase();
    return dayData.grammar.sentences.find(g =>
      g.text.trim().toLowerCase() === normalized
    );
  }

  function hideSentencePopup() {
    const popup = $('#sent-popup');
    popup.classList.remove('show');
    setTimeout(() => {
      hide('#sent-popup');
      hide('#sent-overlay');
    }, 300);
    clearSentenceHighlight();
  }

  function clearSentenceHighlight() {
    $$('.word.sent-highlight', $('#passage-text')).forEach(s => s.classList.remove('sent-highlight'));
    $$('.t-sent.active', $('#translation-text')).forEach(s => s.classList.remove('active'));
  }

  function toggleTranslation() {
    const view = $('#translation-view');
    const btn = $('#btn-translation');
    if (view.classList.contains('hidden')) {
      show('#translation-view');
      btn.classList.add('active');
      btn.textContent = 'Hide Translation';
    } else {
      hide('#translation-view');
      btn.classList.remove('active');
      btn.textContent = 'Show Translation';
      clearSentenceHighlight();
    }
  }

  /* ── Audio ── */

  function setupAudio(d) {
    if (audio) {
      audio.pause();
      audio = null;
    }

    const playerEl = $('#audio-player');
    if (!d.audio || !d.audio.passage) {
      hide('#audio-player');
      return;
    }

    show('#audio-player');
    audio = new Audio(d.audio.passage);
    audio.preload = 'metadata';

    const playBtn = $('#btn-play');
    const progressEl = $('#audio-progress');
    const timeEl = $('#audio-time');

    playBtn.innerHTML = '&#9654;';

    playBtn.onclick = () => {
      if (audio.paused) {
        audio.play();
        playBtn.innerHTML = '&#10074;&#10074;';
      } else {
        audio.pause();
        playBtn.innerHTML = '&#9654;';
      }
    };

    audio.addEventListener('timeupdate', () => {
      if (audio.duration) {
        progressEl.value = (audio.currentTime / audio.duration) * 100;
        timeEl.textContent = formatTime(audio.currentTime);
      }
    });

    audio.addEventListener('ended', () => {
      playBtn.innerHTML = '&#9654;';
      progressEl.value = 0;
    });

    progressEl.addEventListener('input', () => {
      if (audio.duration) {
        audio.currentTime = (progressEl.value / 100) * audio.duration;
      }
    });

    // Speed controls
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

  /* ── Vocab ── */

  function renderVocab(keyVocab, words, audioData) {
    const container = $('#vocab-list');
    container.innerHTML = '';

    if (!keyVocab || keyVocab.length === 0) return;

    keyVocab.forEach(word => {
      const info = words[word.toLowerCase()] || words[word] || {};
      const div = document.createElement('div');
      div.className = 'vocab-item';

      const primaryMeaning = (info.meanings || []).find(m => m.primary) || (info.meanings || [])[0] || {};

      div.innerHTML = `
        <div>
          <div class="vocab-word">${escapeHtml(word)}</div>
          <div class="vocab-ipa">${escapeHtml(info.ipa || '')}</div>
        </div>
        <div class="vocab-meaning">${escapeHtml(primaryMeaning.ko || '')}</div>
      `;

      div.addEventListener('click', () => showWordPopup(word.toLowerCase(), words));
      container.appendChild(div);
    });
  }

  /* ── Quiz ── */

  function renderQuiz(quiz) {
    if (!quiz || !quiz.question) {
      hide('#quiz-section');
      return;
    }
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
    if (el.classList.contains('hidden')) {
      show('#quiz-answer');
      btn.classList.add('active');
      btn.textContent = 'Hide Answer';
    } else {
      hide('#quiz-answer');
      btn.classList.remove('active');
      btn.textContent = 'Show Answer';
    }
  }

  /* ── Word Popup ── */

  function showWordPopup(wordKey, words) {
    const info = words[wordKey] || words[wordKey.toLowerCase()];
    if (!info) return;

    $('#popup-word').textContent = wordKey;
    $('#popup-ipa').textContent = info.ipa || '';
    $('#popup-pos').textContent = info.pos || '';

    // Meanings
    const meaningsEl = $('#popup-meanings');
    meaningsEl.innerHTML = '';
    (info.meanings || []).forEach(m => {
      const div = document.createElement('div');
      div.className = 'meaning-item' + (m.primary ? ' primary' : '');
      div.innerHTML = `
        <span class="m-ko">${escapeHtml(m.ko || '')}</span>
        <span class="m-en">${escapeHtml(m.en || '')}</span>
        ${m.primary ? '<span class="m-badge">here</span>' : ''}
      `;
      meaningsEl.appendChild(div);
    });

    // Forms (verb tenses, noun plural, etc.)
    const formsEl = $('#popup-forms');
    if (info.forms && (info.forms.base || info.forms.tense || (info.forms.related && info.forms.related.length))) {
      let formsHtml = '';
      if (info.forms.base) formsHtml += `<span class="form-tag">원형: ${escapeHtml(info.forms.base)}</span>`;
      if (info.forms.tense) formsHtml += `<span class="form-tag">${escapeHtml(info.forms.tense)}</span>`;
      if (info.forms.related && info.forms.related.length) {
        formsHtml += info.forms.related.map(r => `<span class="form-tag">${escapeHtml(r)}</span>`).join('');
      }
      formsEl.innerHTML = formsHtml;
      formsEl.style.display = 'flex';
    } else {
      formsEl.style.display = 'none';
    }

    // Context meaning
    const contextEl = $('#popup-context');
    const contextText = info.contextMeaning || info.contextNote || '';
    if (contextText) {
      contextEl.textContent = contextText;
      contextEl.style.display = 'block';
    } else {
      contextEl.style.display = 'none';
    }

    // Audio button - TTS MP3 우선, 없으면 Web Speech API
    const audioBtn = $('#popup-audio-btn');
    const wordAudio = dayData && dayData.audio && dayData.audio.words && dayData.audio.words[wordKey];
    show('#popup-audio-btn');
    audioBtn.onclick = () => {
      if (wordAudio) {
        const a = new Audio(wordAudio);
        a.play();
      } else {
        speakWord(wordKey);
      }
    };

    // Highlight word
    $$('.word.active', $('#passage-text')).forEach(s => s.classList.remove('active'));
    const match = $$('.word', $('#passage-text')).find(s => s.dataset.word === wordKey);
    if (match) match.classList.add('active');

    // Show popup
    show('#word-overlay');
    show('#word-popup');
    requestAnimationFrame(() => {
      $('#word-popup').classList.add('show');
    });
  }

  function hideWordPopup() {
    const popup = $('#word-popup');
    popup.classList.remove('show');
    setTimeout(() => {
      hide('#word-popup');
      hide('#word-overlay');
    }, 300);
    $$('.word.active', $('#passage-text')).forEach(s => s.classList.remove('active'));
    clearSentenceHighlight();
  }

  function setupPopupListeners() {
    // Word popup
    $('#word-overlay').addEventListener('click', hideWordPopup);
    let startY = 0;
    const popup = $('#word-popup');
    popup.addEventListener('touchstart', e => {
      startY = e.touches[0].clientY;
    }, { passive: true });
    popup.addEventListener('touchmove', e => {
      const dy = e.touches[0].clientY - startY;
      if (dy > 80) hideWordPopup();
    }, { passive: true });

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
    sentPopup.addEventListener('touchstart', e => {
      sentStartY = e.touches[0].clientY;
    }, { passive: true });
    sentPopup.addEventListener('touchmove', e => {
      const dy = e.touches[0].clientY - sentStartY;
      if (dy > 80) hideSentencePopup();
    }, { passive: true });
  }

  /* ── Navigation ── */

  function updateNav() {
    if (!indexData) return;
    const days = indexData.days.map(d => d.day).sort((a, b) => a - b);
    const idx = days.indexOf(currentDay);

    const prevBtn = $('#btn-prev');
    const nextBtn = $('#btn-next');

    if (idx > 0) {
      prevBtn.disabled = false;
      prevBtn.onclick = () => {
        location.hash = `#/day/${String(days[idx - 1]).padStart(3, '0')}`;
      };
    } else {
      prevBtn.disabled = true;
      prevBtn.onclick = () => { location.hash = '#/'; };
    }

    if (idx < days.length - 1) {
      nextBtn.disabled = false;
      nextBtn.onclick = () => {
        location.hash = `#/day/${String(days[idx + 1]).padStart(3, '0')}`;
      };
    } else {
      nextBtn.disabled = true;
    }
  }

  /* ── Helpers ── */

  function show(sel) {
    const el = typeof sel === 'string' ? $(sel) : sel;
    if (el) el.classList.remove('hidden');
  }

  function hide(sel) {
    const el = typeof sel === 'string' ? $(sel) : sel;
    if (el) el.classList.add('hidden');
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function speakWord(word) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(word);
    utter.lang = 'en-US';
    utter.rate = 0.8;
    window.speechSynthesis.speak(utter);
  }

  function speakSentence(text) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'en-US';
    utter.rate = sentTtsRate;
    window.speechSynthesis.speak(utter);
  }

  /* ── Service Worker Registration ── */

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  /* ── Start ── */
  document.addEventListener('DOMContentLoaded', init);
})();
