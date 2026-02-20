/* English Reader SPA v3 — Firebase Auth + Quiz System */
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
  let pendingSentIdx = null;

  // Firebase state
  let firebaseUser = null;
  let firestoreDb = null;
  let firebaseReady = false;

  // Test state
  let testQuestions = null;
  let testCurrentIdx = 0;
  let testAnswers = [];
  let testDayData = null;
  let testCat = null;
  let testNum = null;
  let testAnswered = false;

  const VOCAB_STORE_KEY = 'english-reader-vocabulary';
  const TEST_RESULTS_KEY = 'english-reader-test-results';
  const WRONG_NOTES_KEY = 'english-reader-wrong-notes';
  let testMode = 'normal'; // 'normal' or 'review'

  /* ── Vocabulary Store (localStorage + Firestore sync) ── */

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
    if (store.words.some(w => w.word === word)) return false;
    store.words.push({ word, pos, meaning, ipa, source, addedAt: new Date().toISOString() });
    vocabSave(store);
    syncToFirestore();
    return true;
  }

  function vocabComplete(word, source) {
    const store = vocabStore();
    const idx = store.words.findIndex(w => w.word === word && w.source === source);
    if (idx === -1) return;
    const item = store.words.splice(idx, 1)[0];
    store.completed.push({ ...item, completedAt: new Date().toISOString() });
    vocabSave(store);
    syncToFirestore();
  }

  function vocabUncomplete(word, source) {
    const store = vocabStore();
    const idx = store.completed.findIndex(w => w.word === word && w.source === source);
    if (idx === -1) return;
    const item = store.completed.splice(idx, 1)[0];
    delete item.completedAt;
    store.words.push(item);
    vocabSave(store);
    syncToFirestore();
  }

  function vocabIsAdded(word, source) {
    const store = vocabStore();
    if (!source) return store.words.some(w => w.word === word);
    return store.words.some(w => w.word === word && w.source === source);
  }

  /* ── Test Results Store (localStorage + Firestore) ── */

  function testResultsStore() {
    try {
      return JSON.parse(localStorage.getItem(TEST_RESULTS_KEY)) || [];
    } catch { return []; }
  }

  function testResultsSave(results) {
    localStorage.setItem(TEST_RESULTS_KEY, JSON.stringify(results));
  }

  /* ── Wrong Notes Store ── */

  function wrongNotesStore() {
    try {
      return JSON.parse(localStorage.getItem(WRONG_NOTES_KEY)) || [];
    } catch { return []; }
  }

  function wrongNotesSave(notes) {
    localStorage.setItem(WRONG_NOTES_KEY, JSON.stringify(notes));
    syncWrongNotesToFirestore();
  }

  function wrongNoteId(q) {
    return `${q.lessonId || ''}_${q.type}_${q.subtype || ''}_${q.answer}`;
  }

  function addToWrongNotes(q, lessonId) {
    const notes = wrongNotesStore();
    const id = wrongNoteId({ ...q, lessonId });
    const existing = notes.find(n => n.id === id);
    if (existing) {
      existing.wrongCount = (existing.wrongCount || 1) + 1;
      existing.lastWrongAt = new Date().toISOString();
    } else {
      notes.push({
        id,
        lessonId,
        type: q.type,
        subtype: q.subtype || '',
        question: q.question,
        answer: q.answer,
        pos: q.pos || '',
        hint: q.hint || '',
        ipa: q.ipa || '',
        hintText: q.hintText || '',
        choices: q.choices || null,
        explanation: q.explanation || '',
        exampleSentence: q.exampleSentence || '',
        wrongCount: 1,
        addedAt: new Date().toISOString(),
        lastWrongAt: new Date().toISOString()
      });
    }
    wrongNotesSave(notes);
  }

  function removeFromWrongNotes(noteId) {
    const notes = wrongNotesStore().filter(n => n.id !== noteId);
    wrongNotesSave(notes);
  }

  async function syncWrongNotesToFirestore() {
    if (!firebaseUser || !firestoreDb) return;
    try {
      await firestoreDb.collection('users').doc(firebaseUser.uid)
        .collection('data').doc('wrongNotes').set({ items: wrongNotesStore() });
    } catch (e) { console.error('Wrong notes sync error:', e); }
  }

  async function syncWrongNotesFromFirestore() {
    if (!firebaseUser || !firestoreDb) return;
    try {
      const doc = await firestoreDb.collection('users').doc(firebaseUser.uid)
        .collection('data').doc('wrongNotes').get();
      if (doc.exists) {
        const data = doc.data();
        if (data.items?.length) {
          localStorage.setItem(WRONG_NOTES_KEY, JSON.stringify(data.items));
        }
      }
    } catch (e) { console.error('Wrong notes sync error:', e); }
  }

  /* ── Firebase Init & Auth ── */

  function initFirebase() {
    if (typeof firebase === 'undefined' || !window.firebaseConfig) return;
    if (window.firebaseConfig.apiKey === 'YOUR_API_KEY') return;
    try {
      firebase.initializeApp(window.firebaseConfig);
      firestoreDb = firebase.firestore();
      firebaseReady = true;

      let redirectChecked = false;

      firebase.auth().getRedirectResult()
        .catch(e => {
          console.error('Redirect login error:', e);
          show('#btn-login-main');
          hide('#login-loading');
        })
        .then(() => {
          redirectChecked = true;
          if (!firebaseUser) showLoginScreen();
        });

      firebase.auth().onAuthStateChanged(async user => {
        firebaseUser = user;
        updateAuthUI();
        if (user) {
          hideLoginScreen();
          if (!indexData) await loadAppData();
          saveUserProfile(user);
          syncFromFirestore();
        } else if (redirectChecked) {
          showLoginScreen();
        }
      });
    } catch (e) {
      console.error('Firebase init error:', e);
    }
  }

  function showLoginScreen() {
    show('#btn-login-main');
    hide('#login-loading');
    const screen = $('#login-screen');
    if (screen) {
      screen.classList.remove('fade-out');
      show(screen);
    }
    hide('#app');
  }

  function hideLoginScreen() {
    const screen = $('#login-screen');
    if (screen && !screen.classList.contains('hidden')) {
      screen.classList.add('fade-out');
      setTimeout(() => hide(screen), 300);
    }
    show('#app');
  }

  function authLogin() {
    if (!firebaseReady) return;
    const provider = new firebase.auth.GoogleAuthProvider();
    firebase.auth().signInWithPopup(provider).catch(error => {
      if (error.code === 'auth/popup-blocked' ||
          error.code === 'auth/popup-closed-by-user' ||
          error.code === 'auth/cancelled-popup-request') {
        firebase.auth().signInWithRedirect(provider);
      } else {
        console.error('Login error:', error);
        show('#btn-login-main');
        hide('#login-loading');
      }
      });
  }

  function authLogout() {
    if (!firebaseReady) return;
    firebase.auth().signOut().then(() => {
      location.hash = '#/';
    });
  }

  function updateAuthUI() {
    const authBtn = $('#btn-auth');
    const menuInfo = $('#auth-menu-info');
    const loginBtn = $('#btn-google-login');
    const logoutBtn = $('#btn-logout');
    const resultsBtn = $('#btn-results');
    const wrongNotesBtn = $('#btn-wrong-notes');

    if (firebaseUser) {
      // Show avatar in header button
      authBtn.classList.add('logged-in');
      if (firebaseUser.photoURL) {
        authBtn.innerHTML = `<img src="${firebaseUser.photoURL}" alt="">`;
      } else {
        authBtn.innerHTML = '&#128100;';
      }
      // Update menu
      show(menuInfo);
      const avatar = $('#auth-menu-avatar');
      if (firebaseUser.photoURL) avatar.src = firebaseUser.photoURL;
      $('#auth-menu-name').textContent = firebaseUser.displayName || '';
      $('#auth-menu-email').textContent = firebaseUser.email || '';
      hide(loginBtn);
      show(logoutBtn);
      show(resultsBtn);
      show(wrongNotesBtn);
    } else {
      authBtn.classList.remove('logged-in');
      authBtn.innerHTML = '&#128100;';
      hide(menuInfo);
      show(loginBtn);
      hide(logoutBtn);
      hide(resultsBtn);
      hide(wrongNotesBtn);
    }
  }

  function saveUserProfile(user) {
    if (!firestoreDb || !user) return;
    firestoreDb.collection('users').doc(user.uid).set({
      displayName: user.displayName || '',
      photoURL: user.photoURL || '',
      email: user.email || '',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true }).catch(() => {});
  }

  /* ── Firestore Sync ── */

  async function syncFromFirestore() {
    if (!firebaseUser || !firestoreDb) return;
    try {
      const doc = await firestoreDb.collection('users').doc(firebaseUser.uid)
        .collection('data').doc('vocab').get();
      if (doc.exists) {
        const data = doc.data();
        const remoteStore = { words: data.words || [], completed: data.completed || [] };
        const localStore = vocabStore();

        // If local has data and remote is empty, offer migration
        if (remoteStore.words.length === 0 && remoteStore.completed.length === 0 &&
            (localStore.words.length > 0 || localStore.completed.length > 0)) {
          showMigrateDialog(localStore);
          return;
        }

        // Remote takes precedence
        vocabSave(remoteStore);
        if (location.hash === '#/vocabulary') renderMyVocabList();
      } else {
        // No remote data exists
        const localStore = vocabStore();
        if (localStore.words.length > 0 || localStore.completed.length > 0) {
          showMigrateDialog(localStore);
        }
      }

      // Sync test results and wrong notes from Firestore
      await syncTestResultsFromFirestore();
      await syncWrongNotesFromFirestore();
    } catch (e) {
      console.error('Firestore sync error:', e);
    }
  }

  async function syncToFirestore() {
    if (!firebaseUser || !firestoreDb) return;
    try {
      const store = vocabStore();
      await firestoreDb.collection('users').doc(firebaseUser.uid)
        .collection('data').doc('vocab').set(store);
    } catch (e) {
      console.error('Firestore save error:', e);
    }
  }

  function showMigrateDialog(localStore) {
    const count = localStore.words.length + localStore.completed.length;
    const overlay = document.createElement('div');
    overlay.className = 'migrate-overlay';
    overlay.innerHTML = `
      <div class="migrate-dialog">
        <p><span class="badge">${count}개</span></p>
        <p>기존 단어장 데이터를 계정에 가져올까요?</p>
        <div class="migrate-actions">
          <button class="migrate-yes">가져오기</button>
          <button class="migrate-no">건너뛰기</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector('.migrate-yes').onclick = async () => {
      overlay.remove();
      await syncToFirestore();
    };
    overlay.querySelector('.migrate-no').onclick = () => {
      overlay.remove();
    };
  }

  async function saveTestResultToFirestore(result) {
    if (!firebaseUser || !firestoreDb) return;
    try {
      await firestoreDb.collection('users').doc(firebaseUser.uid)
        .collection('testResults').add({
          ...result,
          date: firebase.firestore.FieldValue.serverTimestamp()
        });
    } catch (e) {
      console.error('Firestore test result save error:', e);
    }
  }

  async function syncTestResultsFromFirestore() {
    if (!firebaseUser || !firestoreDb) return;
    try {
      const snap = await firestoreDb.collection('users').doc(firebaseUser.uid)
        .collection('testResults').orderBy('date', 'desc').limit(100).get();
      if (snap.empty) return;
      const results = [];
      snap.forEach(doc => {
        const data = doc.data();
        results.push({
          ...data,
          id: doc.id,
          date: data.date?.toDate?.()?.toISOString() || new Date().toISOString()
        });
      });
      testResultsSave(results);
    } catch (e) {
      console.error('Firestore test results sync error:', e);
    }
  }

  /* ── Bootstrap ── */

  async function init() {
    try {
      initFirebase();
      setupPopupListeners();
      setupVocabTabs();
      setupMyVocabPage();
      setupAuthListeners();
      setupLoginScreen();
    } catch (e) {
      console.error('[ER] init error:', e);
    }

    // If Firebase is ready, wait for auth state (login screen handles flow)
    // If Firebase is not configured, skip login and load normally
    if (!firebaseReady) {
      await loadAppData();
    }
  }

  function setupLoginScreen() {
    const loginBtn = $('#btn-login-main');
    if (loginBtn) {
      loginBtn.addEventListener('click', () => {
        if (!firebaseReady) return;
        hide(loginBtn);
        show('#login-loading');
        authLogin();
      });
    }
  }

  async function loadAppData() {
    if (firebaseReady && !firebaseUser) return;
    show('#loading');
    try {
      const res = await fetch('index.json');
      indexData = res.ok ? await res.json() : { levels: {} };
    } catch { indexData = { levels: {} }; }
    hide('#loading');
    route();
    if (!window._hashListenerAdded) {
      window.addEventListener('hashchange', route);
      window._hashListenerAdded = true;
    }
  }

  function route() {
    // Auth guard: must be logged in
    if (firebaseReady && !firebaseUser) {
      showLoginScreen();
      return;
    }

    const hash = location.hash || '#/';

    // #/test-all/L1 (comprehensive test)
    if (hash.startsWith('#/test-all/')) {
      const cat = hash.split('/')[2];
      startComprehensiveTest(cat);
      return;
    }

    // #/test/L1/0001
    const testMatch = hash.match(/#\/test\/([^/]+)\/(\d{4})/);
    if (testMatch) {
      startTest(testMatch[1], testMatch[2]);
      return;
    }

    // #/results
    if (hash === '#/results') {
      showResultsPage();
      return;
    }

    // #/wrong-notes
    if (hash === '#/wrong-notes') {
      showWrongNotesPage();
      return;
    }

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
    hide('#test-page');
    hide('#results-page');
    hide('#wrong-notes-page');
    show('#home');
    updateHeaderForHome();
    renderHome();
  }

  function updateHeaderForHome() {
    $('#header-title').textContent = 'English Reader';
    hide('#btn-home');
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

      const compBtn = document.createElement('button');
      compBtn.className = 'comp-test-btn';
      compBtn.textContent = '종합 시험';
      compBtn.addEventListener('click', () => { location.hash = `#/test-all/${cat}`; });
      section.appendChild(compBtn);

      container.appendChild(section);
    });
  }

  /* ── Content View ── */

  async function loadContent(cat, num) {
    currentCat = cat;
    currentNum = num;
    hide('#home');
    hide('#vocabulary-page');
    hide('#test-page');
    hide('#results-page');
    hide('#wrong-notes-page');
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
  }

  function updateHeaderForContent() {
    show('#btn-home');
    const catLabel = currentCat === 'custom' ? 'Custom' : `Level ${currentCat.slice(1)}`;
    $('#header-title').textContent = `${catLabel} #${currentNum}`;
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

    // Test CTA
    const testBtn = $('#btn-start-test');
    testBtn.onclick = () => {
      location.hash = `#/test/${currentCat}/${currentNum}`;
    };

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

  /* ── Quiz (basic reading quiz) ── */

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

  /* ══════════════════════════════════════════════
     ██ QUIZ GENERATION & TEST SYSTEM
     ══════════════════════════════════════════════ */

  function shuffleArray(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function generateQuiz(data) {
    if (!data) return [];
    const words = data.words || {};
    const keyVocab = data.keyVocab || [];
    const grammar = data.grammar || {};

    // Split keyVocab between spelling and listening
    const shuffledKey = shuffleArray([...keyVocab]);
    const half = Math.ceil(shuffledKey.length / 2);
    const spellingWords = shuffledKey.slice(0, half);
    const listeningWords = shuffledKey.slice(half);

    let qs = [
      ...generateSpellingQ(words, spellingWords),
      ...generateListeningQ(words, listeningWords),
      ...generateMeaningQ(words, keyVocab),
      ...generateGrammarQ(grammar, words)
    ];

    // Wrong-note prioritization for normal tests
    if (testMode === 'normal' && data.category && data.num) {
      const lessonId = `${data.category}-${data.num}`;
      const notes = wrongNotesStore();
      const lessonNotes = notes.filter(n => n.lessonId === lessonId);

      if (lessonNotes.length > 0) {
        const wrongAnswers = new Set(lessonNotes.map(n => n.answer.toLowerCase()));
        const prioritized = [];
        const rest = [];

        qs.forEach(q => {
          if (wrongAnswers.has(q.answer.toLowerCase())) {
            prioritized.push(q);
          } else {
            rest.push(q);
          }
        });

        qs = [...shuffleArray(prioritized), ...shuffleArray(rest)];
      } else {
        qs = shuffleArray(qs);
      }
    } else {
      qs = shuffleArray(qs);
    }

    return qs;
  }

  function generateSpellingQ(words, keyVocab) {
    if (!keyVocab?.length || !words) return [];
    const qs = [];

    keyVocab.forEach(word => {
      const wordKey = word.toLowerCase().replace(/['\u2019']/g, "'");
      const info = words[wordKey] || words[word] || {};
      const primary = (info.meanings || []).find(m => m.primary) || (info.meanings || [])[0];
      if (!primary?.ko) return;

      qs.push({
        type: 'spelling',
        question: primary.ko,
        pos: info.pos || '',
        hint: wordKey[0] + '_'.repeat(Math.max(0, wordKey.length - 1)),
        answer: wordKey,
        ipa: info.ipa || '',
        hintText: `발음: ${info.ipa || '?'} · ${wordKey.length}글자`
      });
    });

    return qs;
  }

  function generateListeningQ(words, keyVocab) {
    if (!keyVocab?.length || !words) return [];
    const qs = [];

    keyVocab.forEach(word => {
      const wordKey = word.toLowerCase().replace(/['\u2019']/g, "'");
      const info = words[wordKey] || words[word] || {};
      const primary = (info.meanings || []).find(m => m.primary) || (info.meanings || [])[0];
      if (!primary?.ko) return;

      qs.push({
        type: 'listening',
        question: '\uD83D\uDD0A',
        answer: wordKey,
        pos: info.pos || '',
        ipa: info.ipa || '',
        hintText: `${wordKey.length}글자 · 품사: ${(info.pos || '').split(' ')[0] || '?'}`
      });
    });

    return qs;
  }

  function generateMeaningQ(words, keyVocab) {
    if (!words) return [];
    const qs = [];
    const skipPos = ['article', 'determiner', 'conjunction', 'preposition', 'pronoun', 'interjection'];
    const keySet = new Set((keyVocab || []).map(w => w.toLowerCase()));

    // Collect valid words with Korean meanings
    const validEntries = Object.entries(words).filter(([word, info]) => {
      const pos = (info.pos || '').toLowerCase();
      if (skipPos.some(s => pos.includes(s))) return false;
      const primary = (info.meanings || []).find(m => m.primary) || (info.meanings || [])[0];
      return primary?.ko;
    });

    if (validEntries.length < 2) return [];

    // All Korean meanings for distractor pool
    const allMeanings = validEntries.map(([w, info]) => {
      const p = (info.meanings || []).find(m => m.primary) || (info.meanings || [])[0];
      return { word: w, ko: p.ko };
    });

    validEntries.forEach(([word, info]) => {
      // Skip words that are already in spelling questions (keyVocab)
      if (keySet.has(word)) return;

      const primary = (info.meanings || []).find(m => m.primary) || (info.meanings || [])[0];
      const correctAnswer = primary.ko;

      // Get distractors: other Korean meanings from the same lesson
      const distractorPool = allMeanings
        .filter(m => m.word !== word && m.ko !== correctAnswer)
        .map(m => m.ko);
      const uniqueDistractors = [...new Set(distractorPool)];
      const selectedDistractors = shuffleArray(uniqueDistractors).slice(0, 3);

      // Pad with filler if needed
      while (selectedDistractors.length < 3) {
        const fillers = ['해당 없음', '알 수 없음', '기타'];
        for (const f of fillers) {
          if (!selectedDistractors.includes(f) && f !== correctAnswer) {
            selectedDistractors.push(f);
            if (selectedDistractors.length >= 3) break;
          }
        }
        break;
      }

      const choices = shuffleArray([correctAnswer, ...selectedDistractors.slice(0, 3)]);

      // Pick an example sentence (if available)
      const examples = info.examples || [];
      let exampleSentence = '';
      if (examples.length > 0) {
        const ex = examples[0];
        // Replace the target word with ___ for context
        const regex = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        exampleSentence = (ex.en || '').replace(regex, '___');
      }

      const meaningHint = primary.en ? `영어 뜻: ${primary.en}` : `${(info.pos || '').split(' ')[0] || '?'}`;
      qs.push({
        type: 'meaning',
        question: word,
        ipa: info.ipa || '',
        pos: info.pos || '',
        answer: correctAnswer,
        choices: choices,
        exampleSentence: exampleSentence,
        hintText: meaningHint
      });
    });

    return qs;
  }

  function generateGrammarQ(grammar, words) {
    if (!grammar?.sentences?.length) return [];
    const qs = [];
    const allPatterns = ['S+V', 'S+V+O', 'S+V+C', 'S+V+O+O', 'S+V+O+C', 'S+V+A'];

    grammar.sentences.forEach((sent, idx) => {
      const structure = sent.structure || {};

      // Fill-in-blank: prefer verb, then complement, then object
      const targetKey = structure.verb ? 'verb' :
                        structure.complement ? 'complement' :
                        structure.object ? 'object' : null;

      if (targetKey && structure[targetKey]?.text) {
        const blankTarget = structure[targetKey];
        const blanked = sent.text.replace(blankTarget.text, '___');

        // Build distractors from other sentences or common words
        const distractors = new Set();

        // Other sentences' same component
        grammar.sentences.forEach((s, i) => {
          if (i === idx) return;
          const comp = (s.structure || {})[targetKey];
          if (comp?.text && comp.text !== blankTarget.text) {
            distractors.add(comp.text);
          }
        });

        // Common verbs as fallback
        if (targetKey === 'verb' && distractors.size < 3) {
          ['is', 'was', 'were', 'are', 'has', 'had', 'did', 'will', 'can', 'could',
           'went', 'came', 'saw', 'got', 'made', 'said', 'told', 'gave', 'took']
            .forEach(v => {
              if (v !== blankTarget.text.toLowerCase()) distractors.add(v);
            });
        }

        // General fallback
        if (distractors.size < 3) {
          ['it', 'them', 'there', 'very much', 'quickly', 'slowly', 'together', 'always', 'never']
            .forEach(f => {
              if (f !== blankTarget.text) distractors.add(f);
            });
        }

        const distArr = shuffleArray([...distractors]).slice(0, 3);
        const choices = shuffleArray([blankTarget.text, ...distArr]);

        const roleLabels = { verb: '동사', complement: '보어', object: '목적어', subject: '주어', adverbial: '부사' };
        qs.push({
          type: 'grammar',
          subtype: 'fillblank',
          question: blanked,
          answer: blankTarget.text,
          choices: choices,
          explanation: sent.explanation || '',
          hintText: `빈칸 역할: ${roleLabels[targetKey] || targetKey} · 첫 글자: ${blankTarget.text[0]}`
        });
      }

      // Pattern matching
      if (sent.pattern?.name) {
        const correctPattern = sent.pattern.name;
        const wrongPatterns = allPatterns.filter(p => p !== correctPattern);
        const selectedWrong = shuffleArray(wrongPatterns).slice(0, 3);
        const choices = shuffleArray([correctPattern, ...selectedWrong]);

        const components = Object.keys(structure).filter(k => structure[k]);
        qs.push({
          type: 'grammar',
          subtype: 'pattern',
          question: sent.text,
          patternNote: sent.pattern.note || '',
          answer: correctPattern,
          choices: choices,
          explanation: sent.explanation || '',
          hintText: `구성요소 ${components.length}개: ${components.join(', ')}`
        });
      }
    });

    return qs;
  }

  /* ── Test Page ── */

  async function startTest(cat, num) {
    testCat = cat;
    testNum = num;
    testMode = 'normal';
    hide('#home');
    hide('#day-view');
    hide('#vocabulary-page');
    hide('#results-page');
    hide('#wrong-notes-page');
    show('#loading');

    // Load day data if not already loaded
    const prefix = `${cat}-${num}`;
    try {
      const res = await fetch(`days/${prefix}.json`);
      if (!res.ok) throw new Error('not found');
      testDayData = await res.json();
    } catch {
      hide('#loading');
      showHome();
      return;
    }

    hide('#loading');

    // Generate quiz
    testQuestions = generateQuiz(testDayData);
    if (testQuestions.length === 0) {
      showHome();
      return;
    }

    testCurrentIdx = 0;
    testAnswers = new Array(testQuestions.length).fill(null);
    testAnswered = false;

    // Update header
    show('#btn-home');

    show('#test-page');
    hide('#test-result-card');
    show('#test-question-card');
    show('#test-nav');

    const catLabel = testDayData.category === 'custom' ? 'Custom' : `Level ${testDayData.category.slice(1)}`;
    $('#header-title').textContent = `${catLabel} #${testDayData.num} 시험`;
    $('#test-lesson-label').textContent = `${catLabel} #${testDayData.num} 시험`;

    showTestQuestion(0);
  }

  async function startComprehensiveTest(cat) {
    testCat = cat;
    testNum = 'all';
    testMode = 'comprehensive';
    testDayData = null;

    hide('#home');
    hide('#day-view');
    hide('#vocabulary-page');
    hide('#results-page');
    hide('#wrong-notes-page');
    show('#loading');

    const entries = (indexData.levels || {})[cat] || [];
    if (entries.length === 0) {
      hide('#loading');
      showHome();
      return;
    }

    // Load all day JSONs in parallel
    const allDayData = await Promise.all(
      entries.map(e =>
        fetch(`days/${cat}-${e.num}.json`).then(r => r.json()).catch(() => null)
      )
    );

    // Generate questions from each day
    let allQuestions = [];
    const prevTestMode = testMode;
    testMode = 'comprehensive'; // skip wrong-note prioritization during generation
    allDayData.filter(Boolean).forEach(d => {
      allQuestions.push(...generateQuiz(d));
    });
    testMode = prevTestMode;

    hide('#loading');

    if (allQuestions.length === 0) {
      showHome();
      return;
    }

    // Shuffle and limit to 25 questions
    testQuestions = shuffleArray(allQuestions).slice(0, 25);
    testCurrentIdx = 0;
    testAnswers = new Array(testQuestions.length).fill(null);
    testAnswered = false;

    // Update header
    show('#btn-home');

    show('#test-page');
    hide('#test-result-card');
    show('#test-question-card');
    show('#test-nav');

    const catLabel = cat === 'custom' ? 'Custom' : `Level ${cat.slice(1)}`;
    $('#header-title').textContent = `${catLabel} 종합 시험`;
    $('#test-lesson-label').textContent = `${catLabel} 종합 시험`;

    showTestQuestion(0);
  }

  function showTestQuestion(idx) {
    testCurrentIdx = idx;
    testAnswered = false;
    const q = testQuestions[idx];
    const total = testQuestions.length;

    // Progress
    $('#test-progress-text').textContent = `${idx + 1} / ${total}`;
    $('#test-progress-fill').style.width = `${((idx + 1) / total) * 100}%`;

    // Type badge
    const typeBadge = $('#test-q-type');
    const typeLabels = { spelling: '스펠링', meaning: '뜻 맞추기', grammar: '문법', listening: '듣기' };
    typeBadge.textContent = typeLabels[q.type] || q.type;
    typeBadge.className = 'test-type-badge ' + q.type;

    // Question body
    const body = $('#test-q-body');
    body.innerHTML = '';

    // Input area
    const inputArea = $('#test-q-input');
    inputArea.innerHTML = '';

    // Feedback
    const feedback = $('#test-feedback');
    feedback.className = 'test-feedback hidden';
    feedback.innerHTML = '';

    // Hint — 버튼을 cloneNode로 교체하여 이전 이벤트 완전 제거
    const hintArea = $('#test-hint-area');
    hintArea.textContent = '';
    hintArea.removeAttribute('class');
    hintArea.removeAttribute('style');
    hintArea.setAttribute('class', 'test-hint-area');
    hintArea.style.display = 'none';

    const oldHintBtn = $('#btn-test-hint');
    const hintBtn = oldHintBtn.cloneNode(false);
    oldHintBtn.parentNode.replaceChild(hintBtn, oldHintBtn);
    hintBtn.setAttribute('class', 'test-hint-btn');
    hintBtn.removeAttribute('style');

    if (q.hintText) {
      hintBtn.textContent = '힌트 보기';
      let hintOpen = false;
      hintBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        hintOpen = !hintOpen;
        if (hintOpen) {
          hintArea.textContent = q.hintText;
          hintArea.style.display = 'block';
          hintBtn.textContent = '힌트 숨기기';
        } else {
          hintArea.style.display = 'none';
          hintBtn.textContent = '힌트 보기';
        }
      });
    } else {
      hintBtn.style.display = 'none';
    }

    // Buttons
    const submitBtn = $('#btn-test-submit');
    const nextBtn = $('#btn-test-next');
    submitBtn.disabled = true;
    show(submitBtn);
    hide(nextBtn);

    if (q.type === 'spelling') {
      body.innerHTML = `
        <div class="test-q-main">${esc(q.question)}</div>
        <div class="test-q-sub">${esc(q.pos)}</div>
        <div class="test-q-hint">${esc(q.hint)}</div>`;

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'test-spelling-input';
      input.placeholder = '영어 단어를 입력하세요';
      input.autocomplete = 'off';
      input.autocapitalize = 'none';
      input.spellcheck = false;
      input.addEventListener('input', () => {
        submitBtn.disabled = input.value.trim() === '';
      });
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !submitBtn.disabled) {
          if (!testAnswered) submitBtn.click();
          else nextBtn.click();
        }
      });
      inputArea.appendChild(input);
      setTimeout(() => input.focus(), 100);

      submitBtn.onclick = () => checkSpellingAnswer(idx, input);
      nextBtn.onclick = () => advanceTest();

    } else if (q.type === 'meaning') {
      body.innerHTML = `
        <div class="test-q-main">${esc(q.question)}</div>
        <div class="test-q-sub">${esc(q.ipa)}${q.pos ? ' — ' + esc(q.pos) : ''}</div>
        ${q.exampleSentence ? `<div class="test-q-example">${esc(q.exampleSentence)}</div>` : ''}`;

      const choicesDiv = document.createElement('div');
      choicesDiv.className = 'test-choices';
      q.choices.forEach((choice, ci) => {
        const choiceEl = document.createElement('div');
        choiceEl.className = 'test-choice';
        choiceEl.dataset.value = choice;
        choiceEl.innerHTML = `<span class="choice-marker"></span><span>${esc(choice)}</span>`;
        choiceEl.addEventListener('click', () => {
          if (testAnswered) return;
          $$('.test-choice', choicesDiv).forEach(c => c.classList.remove('selected'));
          choiceEl.classList.add('selected');
          submitBtn.disabled = false;
        });
        choicesDiv.appendChild(choiceEl);
      });
      inputArea.appendChild(choicesDiv);

      submitBtn.onclick = () => checkChoiceAnswer(idx, choicesDiv);
      nextBtn.onclick = () => advanceTest();

    } else if (q.type === 'listening') {
      const listenBtn = document.createElement('button');
      listenBtn.className = 'test-listen-btn';
      listenBtn.innerHTML = '&#128264;';
      listenBtn.addEventListener('click', () => speakWord(q.answer));
      body.appendChild(listenBtn);
      body.insertAdjacentHTML('beforeend', `<div class="test-q-sub" style="text-align:center;margin-top:0.5rem">발음을 듣고 단어를 입력하세요</div>`);

      // Auto-play on question show
      setTimeout(() => speakWord(q.answer), 300);

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'test-spelling-input';
      input.placeholder = '영어 단어를 입력하세요';
      input.autocomplete = 'off';
      input.autocapitalize = 'none';
      input.spellcheck = false;
      input.addEventListener('input', () => {
        submitBtn.disabled = input.value.trim() === '';
      });
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !submitBtn.disabled) {
          if (!testAnswered) submitBtn.click();
          else nextBtn.click();
        }
      });
      inputArea.appendChild(input);
      setTimeout(() => input.focus(), 100);

      submitBtn.onclick = () => checkSpellingAnswer(idx, input);
      nextBtn.onclick = () => advanceTest();

    } else if (q.type === 'grammar') {
      if (q.subtype === 'fillblank') {
        body.innerHTML = `<div class="test-q-main">${esc(q.question)}</div>`;
      } else {
        body.innerHTML = `
          <div class="test-q-sub">이 문장의 문형은?</div>
          <div class="test-q-main">${esc(q.question)}</div>`;
      }

      const choicesDiv = document.createElement('div');
      choicesDiv.className = 'test-choices';
      q.choices.forEach((choice, ci) => {
        const choiceEl = document.createElement('div');
        choiceEl.className = 'test-choice';
        choiceEl.dataset.value = choice;
        choiceEl.innerHTML = `<span class="choice-marker"></span><span>${esc(choice)}</span>`;
        choiceEl.addEventListener('click', () => {
          if (testAnswered) return;
          $$('.test-choice', choicesDiv).forEach(c => c.classList.remove('selected'));
          choiceEl.classList.add('selected');
          submitBtn.disabled = false;
        });
        choicesDiv.appendChild(choiceEl);
      });
      inputArea.appendChild(choicesDiv);

      submitBtn.onclick = () => checkChoiceAnswer(idx, choicesDiv);
      nextBtn.onclick = () => advanceTest();
    }
  }

  function checkSpellingAnswer(idx, input) {
    const q = testQuestions[idx];
    const userAnswer = input.value.trim().toLowerCase();
    const correct = userAnswer === q.answer.toLowerCase();

    testAnswers[idx] = {
      type: q.type,
      question: q.question,
      answer: q.answer,
      userAnswer: input.value.trim(),
      correct: correct
    };

    testAnswered = true;
    input.readOnly = true;
    input.classList.add(correct ? 'correct' : 'wrong');

    const feedback = $('#test-feedback');
    feedback.className = 'test-feedback ' + (correct ? 'correct' : 'wrong');
    if (correct) {
      feedback.innerHTML = '정답!';
    } else {
      feedback.innerHTML = `오답<div class="correct-answer">정답: ${esc(q.answer)}</div>`;
      // 틀린 즉시 오답노트 등록
      const lessonId = q._reviewLessonId || `${testCat}-${testNum}`;
      addToWrongNotes(q, lessonId);
    }
    show(feedback);

    if (correct && testMode === 'review') {
      const lessonId = q._reviewLessonId || `${testCat}-${testNum}`;
      removeFromWrongNotes(wrongNoteId({ ...q, lessonId }));
    }

    hide($('#btn-test-submit'));
    show($('#btn-test-next'));

    if (idx === testQuestions.length - 1) {
      $('#btn-test-next').textContent = '결과 보기';
    } else {
      $('#btn-test-next').textContent = '다음';
    }
  }

  function checkChoiceAnswer(idx, choicesDiv) {
    const q = testQuestions[idx];
    const selected = $('.test-choice.selected', choicesDiv);
    if (!selected) return;

    const userAnswer = selected.dataset.value;
    const correct = userAnswer === q.answer;

    testAnswers[idx] = {
      type: q.type,
      subtype: q.subtype || '',
      question: q.type === 'grammar' && q.subtype === 'pattern' ? q.question : q.question,
      answer: q.answer,
      userAnswer: userAnswer,
      correct: correct
    };

    testAnswered = true;

    // Highlight correct/wrong
    $$('.test-choice', choicesDiv).forEach(c => {
      if (c.dataset.value === q.answer) {
        c.classList.add('correct');
      } else if (c === selected && !correct) {
        c.classList.add('wrong');
      }
    });

    const feedback = $('#test-feedback');
    feedback.className = 'test-feedback ' + (correct ? 'correct' : 'wrong');
    if (correct) {
      feedback.innerHTML = '정답!';
    } else {
      feedback.innerHTML = `오답<div class="correct-answer">정답: ${esc(q.answer)}</div>`;
      // 틀린 즉시 오답노트 등록
      const lessonId = q._reviewLessonId || `${testCat}-${testNum}`;
      addToWrongNotes(q, lessonId);
    }
    if (q.explanation) {
      feedback.innerHTML += `<div style="margin-top:0.3rem;font-size:0.8rem;opacity:0.8">${esc(q.explanation)}</div>`;
    }
    show(feedback);

    if (correct && testMode === 'review') {
      const lessonId = q._reviewLessonId || `${testCat}-${testNum}`;
      removeFromWrongNotes(wrongNoteId({ ...q, lessonId }));
    }

    hide($('#btn-test-submit'));
    show($('#btn-test-next'));

    if (idx === testQuestions.length - 1) {
      $('#btn-test-next').textContent = '결과 보기';
    } else {
      $('#btn-test-next').textContent = '다음';
    }
  }

  function advanceTest() {
    if (testCurrentIdx >= testQuestions.length - 1) {
      finishTest();
    } else {
      showTestQuestion(testCurrentIdx + 1);
    }
  }

  function finishTest() {
    hide('#test-question-card');
    hide('#test-nav');
    show('#test-result-card');

    const total = testQuestions.length;
    const correctCount = testAnswers.filter(a => a?.correct).length;
    const pct = Math.round((correctCount / total) * 100);

    // Title
    const title = $('#test-result-title');
    title.textContent = `${correctCount} / ${total} (${pct}%)`;

    // Score bar
    const bar = $('#test-result-bar');
    bar.style.width = '0';
    const barColor = pct >= 80 ? 'var(--green)' : pct >= 50 ? 'var(--yellow)' : 'var(--red)';
    bar.style.background = barColor;
    requestAnimationFrame(() => {
      bar.style.width = `${pct}%`;
    });

    // Details
    const details = $('#test-result-details');
    details.innerHTML = '';
    testAnswers.forEach((a, i) => {
      if (!a) return;
      const item = document.createElement('div');
      item.className = 'test-detail-item';
      const icon = a.correct ? '&#10003;' : '&#10007;';
      const iconColor = a.correct ? 'var(--green)' : 'var(--red)';
      const typeLabel = { spelling: '스펠링', meaning: '뜻', grammar: '문법', listening: '듣기' }[a.type] || '';

      let qDisplay = a.question;
      if (qDisplay.length > 40) qDisplay = qDisplay.substring(0, 40) + '...';

      item.innerHTML = `
        <span class="test-detail-icon" style="color:${iconColor}">${icon}</span>
        <span class="test-detail-q">${esc(qDisplay)}</span>
        <span class="test-detail-a">${a.correct ? esc(a.answer) : esc(a.userAnswer)}</span>
        ${!a.correct ? `<span class="test-detail-correct">${esc(a.answer)}</span>` : ''}`;
      details.appendChild(item);
    });

    // Save result
    const lessonId = `${testCat}-${testNum}`;
    const catLabel = testCat === 'custom' ? 'Custom' : (testCat === 'review' ? '' : `Level ${testCat.slice(1)}`);
    const result = {
      lessonId: testMode === 'comprehensive' ? `${testCat}-종합` : lessonId,
      lessonTitle: testMode === 'review' ? '오답노트 복습' : testMode === 'comprehensive' ? `${catLabel} 종합 시험` : (testDayData?.source?.title || ''),
      score: correctCount,
      total: total,
      percentage: pct,
      date: new Date().toISOString(),
      details: testAnswers.filter(a => a)
    };

    // Save to localStorage
    const results = testResultsStore();
    results.unshift(result);
    if (results.length > 200) results.length = 200;
    testResultsSave(results);

    // Save to Firestore
    saveTestResultToFirestore(result);

    // Retry button
    $('#btn-test-retry').onclick = () => {
      if (testMode === 'review') {
        startWrongNotesReview();
      } else if (testMode === 'comprehensive') {
        location.hash = `#/test-all/${testCat}`;
      } else {
        location.hash = `#/test/${testCat}/${testNum}`;
      }
    };

    // Back button
    $('#btn-test-back').onclick = () => {
      if (testMode === 'review') {
        location.hash = '#/wrong-notes';
      } else if (testMode === 'comprehensive') {
        location.hash = '#/';
        showHome();
      } else {
        location.hash = `#/${testCat}/${testNum}`;
      }
    };
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

    // Collapsible sections
    document.addEventListener('click', e => {
      const header = e.target.closest('.collapsible-header');
      if (!header) return;
      const body = header.closest('.collapsible')?.querySelector('.collapsible-body');
      const chevron = header.querySelector('.chevron');
      if (!body) return;
      body.classList.toggle('hidden');
      if (chevron) chevron.innerHTML = body.classList.contains('hidden') ? '&#9654;' : '&#9660;';
    });

    // Home button
    $('#btn-home').addEventListener('click', () => {
      if (location.hash === '#/' || location.hash === '' || location.hash === '#') {
        showHome();
      } else {
        location.hash = '#/';
      }
    });

    // My Vocabulary button
    $('#btn-vocab').addEventListener('click', () => { location.hash = '#/vocabulary'; });

    // Results button
    $('#btn-results').addEventListener('click', () => { location.hash = '#/results'; });

    // Wrong notes button
    $('#btn-wrong-notes').addEventListener('click', () => { location.hash = '#/wrong-notes'; });
  }

  /* ── Auth UI Listeners ── */

  function setupAuthListeners() {
    const authBtn = $('#btn-auth');
    const authMenu = $('#auth-menu');

    authBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (!firebaseReady) {
        // Firebase not configured — no action
        return;
      }
      if (!firebaseUser) {
        // Not logged in — direct login
        authLogin();
      } else {
        // Logged in — toggle menu
        authMenu.classList.toggle('hidden');
      }
    });

    // Close menu on outside click
    document.addEventListener('click', () => {
      authMenu.classList.add('hidden');
    });
    authMenu.addEventListener('click', e => e.stopPropagation());

    $('#btn-google-login').addEventListener('click', () => {
      authMenu.classList.add('hidden');
      authLogin();
    });

    $('#btn-logout').addEventListener('click', () => {
      authMenu.classList.add('hidden');
      authLogout();
    });
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

    $('#btn-vocab-reset').addEventListener('click', async () => {
      if (!confirm('단어장을 초기화하시겠습니까? 모든 단어가 삭제됩니다.')) return;
      vocabSave({ words: [], completed: [] });
      await syncToFirestore();
      renderMyVocabList();
    });
  }

  function showVocabularyPage() {
    currentCat = null;
    currentNum = null;
    dayData = null;
    hide('#home');
    hide('#day-view');
    hide('#test-page');
    hide('#results-page');
    hide('#wrong-notes-page');
    show('#vocabulary-page');
    show('#btn-home');

    $('#header-title').textContent = '단어장';

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

  /* ── Results History Page ── */

  function showResultsPage() {
    hide('#home');
    hide('#day-view');
    hide('#vocabulary-page');
    hide('#test-page');
    hide('#wrong-notes-page');
    show('#results-page');
    show('#btn-home');

    $('#header-title').textContent = '시험 이력';

    renderResultsHistory();
  }

  function renderResultsHistory() {
    const results = testResultsStore();
    const container = $('#results-list');
    container.innerHTML = '';
    $('#results-total-badge').textContent = results.length;

    // Wrong words analysis
    const wrongMap = {};
    results.forEach(r => {
      (r.details || []).forEach(d => {
        if (!d.correct && d.type === 'spelling') {
          wrongMap[d.answer] = (wrongMap[d.answer] || 0) + 1;
        } else if (!d.correct && d.type === 'meaning') {
          wrongMap[d.question] = (wrongMap[d.question] || 0) + 1;
        }
      });
    });

    const wrongSection = $('#wrong-words-section');
    const wrongList = $('#wrong-words-list');
    wrongList.innerHTML = '';
    const sortedWrong = Object.entries(wrongMap).sort((a, b) => b[1] - a[1]).slice(0, 15);
    if (sortedWrong.length > 0) {
      show(wrongSection);
      sortedWrong.forEach(([word, count]) => {
        const tag = document.createElement('span');
        tag.className = 'wrong-word-tag';
        tag.innerHTML = `${esc(word)} <span class="wrong-word-count">x${count}</span>`;
        wrongList.appendChild(tag);
      });
    } else {
      hide(wrongSection);
    }

    if (results.length === 0) {
      container.innerHTML = '<div class="no-results-msg">아직 시험 이력이 없습니다</div>';
      return;
    }

    results.forEach(r => {
      const card = document.createElement('div');
      card.className = 'result-card';

      const pct = r.percentage || Math.round((r.score / r.total) * 100);
      const scoreClass = pct >= 80 ? 'high' : pct >= 50 ? 'mid' : 'low';
      const barColor = pct >= 80 ? 'var(--green)' : pct >= 50 ? 'var(--yellow)' : 'var(--red)';
      const dateStr = r.date ? new Date(r.date).toLocaleDateString('ko-KR', {
        month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric'
      }) : '';

      card.innerHTML = `
        <div class="result-card-top">
          <span class="result-lesson">${esc(r.lessonId || '')}</span>
          <span class="result-score ${scoreClass}">${r.score}/${r.total} (${pct}%)</span>
        </div>
        <div class="result-card-bottom">
          <span>${esc(r.lessonTitle || '')}</span>
          <div class="result-bar-mini"><div class="result-bar-mini-fill" style="width:${pct}%;background:${barColor}"></div></div>
          <span class="result-date">${dateStr}</span>
        </div>`;

      card.addEventListener('click', () => {
        // Navigate to that lesson's test
        const parts = (r.lessonId || '').split('-');
        if (parts.length >= 2) {
          location.hash = `#/${parts[0]}/${parts.slice(1).join('-')}`;
        }
      });

      container.appendChild(card);
    });
  }

  /* ── Wrong Notes Page ── */

  function showWrongNotesPage() {
    hide('#home');
    hide('#day-view');
    hide('#vocabulary-page');
    hide('#test-page');
    hide('#results-page');
    show('#wrong-notes-page');
    show('#btn-home');

    $('#header-title').textContent = '오답노트';

    renderWrongNotes();
  }

  function renderWrongNotes() {
    const notes = wrongNotesStore();
    const container = $('#wrong-notes-list');
    container.innerHTML = '';
    $('#wrong-notes-count').textContent = notes.length;

    const reviewBtn = $('#btn-review-wrong');
    const emptyMsg = $('#wrong-notes-empty');

    if (notes.length === 0) {
      reviewBtn.disabled = true;
      show(emptyMsg);
      return;
    }

    reviewBtn.disabled = false;
    hide(emptyMsg);

    // Sort by wrongCount desc, then lastWrongAt desc
    const sorted = [...notes].sort((a, b) => {
      if (b.wrongCount !== a.wrongCount) return b.wrongCount - a.wrongCount;
      return (b.lastWrongAt || '').localeCompare(a.lastWrongAt || '');
    });

    sorted.forEach(note => {
      const card = document.createElement('div');
      card.className = 'wn-card';

      const typeLabels = { spelling: '스펠링', meaning: '뜻', grammar: '문법', listening: '듣기' };
      const typeLabel = typeLabels[note.type] || note.type;

      let questionDisplay = note.question || '';
      if (questionDisplay.length > 50) questionDisplay = questionDisplay.substring(0, 50) + '...';

      const dateStr = note.lastWrongAt ? new Date(note.lastWrongAt).toLocaleDateString('ko-KR', {
        month: 'numeric', day: 'numeric'
      }) : '';

      // Build detail section based on type
      let detailHtml = '';
      if (note.type === 'spelling' || note.type === 'listening') {
        detailHtml = `
          <div class="wn-detail-row">${note.ipa ? `<span class="wn-detail-label">발음</span><span>${esc(note.ipa)}</span>` : ''}</div>
          ${note.pos ? `<div class="wn-detail-row"><span class="wn-detail-label">품사</span><span>${esc(note.pos)}</span></div>` : ''}
          ${note.hintText ? `<div class="wn-detail-row"><span class="wn-detail-label">힌트</span><span>${esc(note.hintText)}</span></div>` : ''}
          <button class="wn-speak-btn" data-word="${esc(note.answer)}">&#128264; 발음 듣기</button>`;
      } else if (note.type === 'meaning') {
        detailHtml = `
          ${note.ipa ? `<div class="wn-detail-row"><span class="wn-detail-label">발음</span><span>${esc(note.ipa)}</span></div>` : ''}
          ${note.pos ? `<div class="wn-detail-row"><span class="wn-detail-label">품사</span><span>${esc(note.pos)}</span></div>` : ''}
          ${note.exampleSentence ? `<div class="wn-detail-row"><span class="wn-detail-label">예문</span><span class="wn-detail-example">${esc(note.exampleSentence)}</span></div>` : ''}
          <button class="wn-speak-btn" data-word="${esc(note.question)}">&#128264; 발음 듣기</button>`;
      } else if (note.type === 'grammar') {
        detailHtml = `
          ${note.explanation ? `<div class="wn-detail-row"><span class="wn-detail-label">설명</span><span>${esc(note.explanation)}</span></div>` : ''}
          ${note.hintText ? `<div class="wn-detail-row"><span class="wn-detail-label">힌트</span><span>${esc(note.hintText)}</span></div>` : ''}`;
      }

      card.innerHTML = `
        <div class="wn-card-top">
          <span class="wn-type ${note.type}">${typeLabel}</span>
          <span class="wn-lesson">${esc(note.lessonId || '')}</span>
          <span class="wn-count">x${note.wrongCount || 1}</span>
        </div>
        <div class="wn-card-body">
          <span class="wn-question">${esc(questionDisplay)}</span>
          <span class="wn-answer">${esc(note.answer || '')}</span>
        </div>
        <div class="wn-card-footer">
          <span class="wn-date">${dateStr}</span>
          <span class="wn-expand-icon">&#9654;</span>
          <button class="wn-delete-btn" title="삭제">&#10005;</button>
        </div>
        <div class="wn-detail hidden">${detailHtml}</div>`;

      // Toggle detail on card click
      card.addEventListener('click', e => {
        if (e.target.closest('.wn-delete-btn') || e.target.closest('.wn-speak-btn')) return;
        const detail = card.querySelector('.wn-detail');
        const expandIcon = card.querySelector('.wn-expand-icon');
        detail.classList.toggle('hidden');
        expandIcon.innerHTML = detail.classList.contains('hidden') ? '&#9654;' : '&#9660;';
      });

      // Speak button
      const speakBtn = card.querySelector('.wn-speak-btn');
      if (speakBtn) {
        speakBtn.addEventListener('click', e => {
          e.stopPropagation();
          speakWord(speakBtn.dataset.word);
        });
      }

      // Delete individual note
      card.querySelector('.wn-delete-btn').addEventListener('click', e => {
        e.stopPropagation();
        removeFromWrongNotes(note.id);
        renderWrongNotes();
      });

      container.appendChild(card);
    });

    // Review button handler
    reviewBtn.onclick = () => {
      startWrongNotesReview();
    };
  }

  function startWrongNotesReview() {
    const notes = wrongNotesStore();
    if (notes.length === 0) return;

    testMode = 'review';
    testCat = 'review';
    testNum = '0000';
    testDayData = null;

    // Convert wrong notes back to quiz questions
    testQuestions = notes.map(note => {
      const q = {
        type: note.type,
        subtype: note.subtype || '',
        question: note.question,
        answer: note.answer,
        pos: note.pos || '',
        hint: note.hint || '',
        ipa: note.ipa || '',
        hintText: note.hintText || '',
        choices: note.choices || null,
        explanation: note.explanation || '',
        _reviewLessonId: note.lessonId
      };
      // Regenerate choices for meaning/grammar if missing
      if ((q.type === 'meaning' || q.type === 'grammar') && !q.choices) {
        q.choices = [q.answer];
      }
      return q;
    });

    // Fisher-Yates shuffle
    for (let i = testQuestions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [testQuestions[i], testQuestions[j]] = [testQuestions[j], testQuestions[i]];
    }

    testCurrentIdx = 0;
    testAnswers = new Array(testQuestions.length).fill(null);
    testAnswered = false;

    // Update header
    show('#btn-home');
    $('#header-title').textContent = '오답노트 복습';

    hide('#home');
    hide('#day-view');
    hide('#vocabulary-page');
    hide('#results-page');
    hide('#wrong-notes-page');
    show('#test-page');
    hide('#test-result-card');
    show('#test-question-card');
    show('#test-nav');

    $('#test-lesson-label').textContent = '오답노트 복습 시험';

    showTestQuestion(0);
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
