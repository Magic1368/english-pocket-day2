(() => {
  const params = new URLSearchParams(location.search);
  const day = Number(params.get('day'));
  const course = (window.COURSES || []).find((item) => item.day === day);
  const content = document.getElementById('content');
  const esc = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const br = (value = '') => esc(value).replace(/\n/g, '<br>');
  const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="#${name}"/></svg>`;
  const storageAvailable = (() => { try { localStorage.setItem('__test', '1'); localStorage.removeItem('__test'); return true; } catch { return false; } })();
  let view = 'study';
  let filter = 'all';
  let quiz = null;
  let rate = 1;
  let activeClip = null;
  let audio = null;
  let video = null;
  let lastQuiz = null;
  const freshState = () => ({ sentence: 0, learned: [], mastered: [], lastQuiz: null });
  const storageKey = `english-pocket-day-${day}-v1`;
  let state = freshState();
  if (storageAvailable) {
    try { state = { ...freshState(), ...JSON.parse(localStorage.getItem(storageKey) || '{}') }; } catch { state = freshState(); }
  }
  const save = () => { if (storageAvailable) { try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch {} } };

  if (!course) {
    document.title = '课程暂不可用 · 英语随身学';
    content.innerHTML = '<div class="card"><h2>没有找到这节课</h2><p class="small">请从课程目录重新选择。</p><a class="primary" href="index.html">返回全部课程</a></div>';
    return;
  }

  const sentences = course.sentences.length ? course.sentences : [course.english || 'The original transcript is not available for this lesson.'];
  state.sentence = Math.max(0, Math.min(sentences.length - 1, Number(state.sentence) || 0));
  lastQuiz = state.lastQuiz;
  document.title = `英语随身学 · Day ${String(day).padStart(2, '0')}`;
  document.getElementById('side-day').textContent = String(day).padStart(2, '0');
  document.getElementById('side-topic').textContent = course.topic || '每日英语练习';
  document.getElementById('day-pill').textContent = `DAY ${String(day).padStart(2, '0')}`;
  document.getElementById('topic-line').textContent = (course.topic || 'DAILY ENGLISH').toUpperCase();
  document.getElementById('lesson-title').textContent = course.title || `英语积累 Day ${day}`;
  document.getElementById('lesson-meta').textContent = [course.author, course.accent, course.topic].filter(Boolean).join(' · ');
  for (const id of ['source-link-side']) document.getElementById(id).href = course.sourceUrl;
  const prev = document.getElementById('prev-day');
  const next = document.getElementById('next-day');
  if (prev) { if (day > 1) prev.href = `lesson.html?day=${day - 1}`; else prev.hidden = true; }
  if (next) { if (day < Math.max(...window.COURSES.map((item) => item.day))) next.href = `lesson.html?day=${day + 1}`; else next.hidden = true; }

  audio = document.createElement('audio');
  audio.id = 'lessonAudio';
  audio.controls = true;
  audio.preload = 'metadata';
  audio.src = course.audioUrl || '';
  audio.playbackRate = rate;
  audio.setAttribute('aria-label', `Day ${day} 原声音频`);
  audio.addEventListener('play', () => video?.pause());
  audio.addEventListener('error', () => toast('原声音频暂时无法播放，可以打开原课程页面查看。'));
  audio.addEventListener('timeupdate', () => {
    if (activeClip && audio.currentTime >= activeClip.end) {
      if (audio.loop) { audio.currentTime = activeClip.start; audio.play().catch(() => {}); }
      else { audio.pause(); audio.currentTime = activeClip.end; activeClip = null; updateClipButton(); }
    }
  });

  function toast(message) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { el.hidden = true; }, 2400);
  }

  function chineseForSentences() {
    let chunks = (course.chinese || '').split(/(?<=[，,。！？；;])/u).map((part) => part.trim()).filter(Boolean);
    for (let i = chunks.length - 2; i >= 0; i--) {
      if ([...chunks[i]].length < 5) { chunks[i] += chunks[i + 1]; chunks.splice(i + 1, 1); }
    }
    while (chunks.length > sentences.length) {
      let at = 0;
      for (let i = 1; i < chunks.length - 1; i++) if ([...chunks[i]].length < [...chunks[at]].length) at = i;
      chunks[at] += chunks[at + 1];
      chunks.splice(at + 1, 1);
    }
    if (!chunks.length) return sentences.map(() => '');
    if (chunks.length === sentences.length) return chunks;
    const output = sentences.map(() => '');
    const wordWeight = (text) => Math.max(1, (text.match(/[A-Za-z0-9]+(?:['’][A-Za-z]+)?/g) || []).length);
    const weights = sentences.map(wordWeight);
    const totalEnglish = weights.reduce((a, b) => a + b, 0);
    const cnWeight = chunks.reduce((sum, item) => sum + [...item].length, 0);
    let used = 0;
    let currentSentence = 0;
    for (const chunk of chunks) {
      const midpoint = used + [...chunk].length / 2;
      while (currentSentence < sentences.length - 1 && midpoint > weights.slice(0, currentSentence + 1).reduce((a, b) => a + b, 0) / totalEnglish * cnWeight) currentSentence++;
      output[currentSentence] = `${output[currentSentence]}${output[currentSentence] ? ' ' : ''}${chunk}`;
      used += [...chunk].length;
    }
    return output;
  }
  const sentenceTranslations = chineseForSentences();

  function clipCues() {
    const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    const weight = (text) => {
      const words = text.match(/[A-Za-z]+(?:['’][A-Za-z]+)?|\d+(?::\d+)?/g) || [];
      const syllables = words.reduce((total, word) => {
        if (/^\d/.test(word)) return total + 1;
        const normalized = word.toLowerCase().replace(/(?:e|es|ed)$/i, '');
        const groups = normalized.match(/[aeiouy]+/g)?.length || 1;
        return total + Math.max(1, groups);
      }, 0);
      const commas = (text.match(/[,，:]/g) || []).length;
      const endings = (text.match(/[.!?;。！？；]/g) || []).length;
      return Math.max(1, syllables + commas * 0.2 + endings * 0.45);
    };
    const weights = sentences.map(weight);
    const total = weights.reduce((sum, item) => sum + item, 0) || sentences.length;
    let elapsed = 0;
    return weights.map((item, index) => {
      const start = duration * elapsed / total;
      elapsed += item;
      const end = duration * elapsed / total;
      return [Math.max(0, start - (index ? 0.12 : 0)), Math.min(duration || end + 0.2, end + 0.18)];
    });
  }

  function updateClipButton() {
    const button = content.querySelector('[data-action="clip"]');
    if (button) { button.setAttribute('aria-pressed', activeClip ? 'true' : 'false'); button.innerHTML = `${icon('headphone')}${activeClip ? '暂停句段' : '播放原声句段'}`; }
  }
  async function playClip() {
    if (activeClip) { audio.pause(); activeClip = null; updateClipButton(); return; }
    if (!Number.isFinite(audio.duration) && audio.readyState < 1) {
      audio.load();
      await new Promise((resolve) => { audio.addEventListener('loadedmetadata', resolve, { once: true }); setTimeout(resolve, 4500); });
    }
    const [start, end] = clipCues()[state.sentence];
    if (!(end > start)) { toast('这段原声还没有加载好，请先播放上方音频。'); return; }
    video?.pause();
    audio.pause();
    audio.currentTime = start;
    activeClip = { start, end };
    updateClipButton();
    try { await audio.play(); } catch { activeClip = null; updateClipButton(); toast('请再点一次原声按钮开始播放。'); }
  }

  function nav(target) {
    if (!['study', 'terms', 'quiz', 'progress'].includes(target)) return;
    if (target !== view) { audio.pause(); video?.pause(); activeClip = null; }
    view = target;
    document.querySelectorAll('[data-view]').forEach((button) => {
      const active = button.dataset.view === view;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
    render();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function renderStudy() {
    const sentence = sentences[state.sentence];
    const index = state.sentence;
    const translation = sentenceTranslations[index];
    const learned = state.learned.includes(index);
    content.innerHTML = `<div class="audio-panel"><div class="audio-header"><div><h3>${icon('headphone')} 本课原声</h3><p>先听整段，再播放当前句的原声片段</p></div><a class="textlink" href="${esc(course.originalVideoUrl || course.sourceUrl)}" target="_blank" rel="noopener">原视频 ↗</a></div><div id="audioSlot"></div><div class="audio-controls"><button data-action="replay">重听全文</button><button data-action="back5">退回 5 秒</button><select id="speed" aria-label="播放速度"><option value="0.75" ${rate === .75 ? 'selected' : ''}>0.75 倍速</option><option value="1" ${rate === 1 ? 'selected' : ''}>1 倍速</option><option value="1.25" ${rate === 1.25 ? 'selected' : ''}>1.25 倍速</option></select><button data-action="loop" aria-pressed="${audio.loop}">循环 ${audio.loop ? '开' : '关'}</button></div></div>
      <div class="sectionrow"><h2>逐句跟读</h2><span class="small">${String(index + 1).padStart(2, '0')} / ${String(sentences.length).padStart(2, '0')}</span></div>
      <article class="card studycard"><div class="cardlabel"><strong>SENTENCE ${String(index + 1).padStart(2, '0')}</strong><span>${learned ? '已学过' : '先听原声，再开口跟读'}</span></div><p class="sentence" lang="en">${esc(sentence)}</p>${translation ? `<p class="translation">${esc(translation)}</p>` : '<p class="hint">中文译文可在下方展开查看。</p>'}<div class="cardtools"><button class="softbutton" data-action="clip" aria-pressed="${activeClip ? 'true' : 'false'}">${icon('headphone')}${activeClip ? '暂停句段' : '播放原声句段'}</button><button class="softbutton" data-action="mark-learned" aria-pressed="${learned}">${icon('check')}${learned ? '已标记学过' : '标记学过'}</button></div></article>
      <div class="studyactions"><button class="primary" data-action="next">${index === sentences.length - 1 ? '完成本课句子' : '下一句'}</button>${index ? '<button class="outline" data-action="previous">上一句</button>' : ''}</div><div class="progressline"><span style="width:${Math.round((index + 1) / sentences.length * 100)}%"></span></div><div class="resume"><span>第 ${index + 1} 句，共 ${sentences.length} 句</span><span>${state.learned.length} 句已学</span></div>
      <div class="info"><strong>原音跟读</strong><p>句段取自课程原音频，依照句长估算切点；不同说话速度下，切点可能略有偏差。</p></div>
      <details class="fulltext"><summary>展开本课中文全文</summary><p>${br(course.chinese || '本课暂无中文全文。')}</p></details>
      <details class="fulltext"><summary>打开原视频和原练习</summary><div class="video-panel">${course.youtubeId ? `<iframe src="https://www.youtube-nocookie.com/embed/${esc(course.youtubeId)}" title="Day ${day} 原视频" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>` : ''}<p><a href="${esc(course.originalVideoUrl || course.sourceUrl)}" target="_blank" rel="noopener">打开原视频或原课程 ↗</a></p></div>${course.exercise ? `<div class="info"><strong>原课程练习</strong><p>${br(course.exercise)}</p></div>` : ''}</details>`;
    document.getElementById('audioSlot').append(audio);
    audio.playbackRate = rate;
    video = content.querySelector('video');
    video?.addEventListener('play', () => { audio.pause(); activeClip = null; updateClipButton(); });
    video?.addEventListener('error', () => toast('原视频暂时无法播放，可以打开原课程观看。'));
  }

  function renderTerms() {
    const words = course.vocabulary.filter((word) => filter === 'all' || (filter === 'review' ? !state.mastered.includes(word.id) : state.mastered.includes(word.id)));
    const cards = words.length ? words.map((word) => {
      const mastered = state.mastered.includes(word.id);
      return `<article class="card termcard ${mastered ? 'mastered' : ''}"><div class="termhead"><div><h3 class="termword" lang="en">${esc(word.english)}</h3>${word.ipa ? `<div class="small">${esc(word.ipa)}</div>` : ''}</div>${mastered ? '<span class="pill">已掌握</span>' : ''}</div>${word.chinese ? `<p class="termmeaning">${esc(word.chinese)}</p>` : ''}${word.usage ? `<p class="termexample">${br(word.usage)}</p>` : ''}<button class="softbutton" data-master="${esc(word.id)}" aria-pressed="${mastered}">${mastered ? '移回待复习' : '标记已掌握'}</button></article>`;
    }).join('') : '<div class="empty">这个筛选下没有词条。</div>';
    content.innerHTML = `<div class="viewintro"><h2>本课地道表达</h2><p>${course.vocabulary.length} 个词条来自原课程词库。点一下即可标记掌握，进度会保存在这台设备上。</p></div><div class="filterrow"><button data-filter="all" class="${filter === 'all' ? 'active' : ''}">全部 ${course.vocabulary.length}</button><button data-filter="review" class="${filter === 'review' ? 'active' : ''}">待复习</button><button data-filter="mastered" class="${filter === 'mastered' ? 'active' : ''}">已掌握</button></div><div class="termgrid">${cards}</div>`;
  }

  function quizQuestions() {
    return course.vocabulary.filter((word) => word.chinese).slice(0, 10).map((word, index, list) => {
      const distractors = list.filter((candidate) => candidate.id !== word.id).map((candidate) => candidate.chinese).filter((meaning, i, all) => meaning && all.indexOf(meaning) === i).slice(0, 3);
      return { id: word.id, english: word.english, chinese: word.chinese, options: [word.chinese, ...distractors].sort((a, b) => (a === word.chinese ? -1 : 0) - (b === word.chinese ? -1 : 0)), index };
    });
  }
  function startQuiz() {
    const questions = quizQuestions();
    if (!questions.length) { toast('本课暂时没有可以练习的词条。'); return; }
    quiz = { questions, cursor: 0, selected: null, checked: false, correct: 0, missed: [] };
    renderQuiz();
  }
  function renderQuiz() {
    if (!quiz) {
      content.innerHTML = `<div class="viewintro"><h2>看看你记住了多少</h2><p>选出词条对应的中文意思，完成后可重练错题。</p></div><div class="card"><div class="questionnumber">${Math.min(10, quizQuestions().length)} QUESTIONS</div><h3 style="margin:17px 0">每题一个表达，随时暂停</h3><p class="small">题目取自本课原词库。你的答案只保存在当前设备。</p><button class="primary" data-action="start-quiz" style="width:100%;margin-top:15px">开始测验</button></div>${lastQuiz ? `<div class="info"><strong>上次测验：${lastQuiz.correct} / ${lastQuiz.total}</strong><p>${esc(lastQuiz.date || '')}</p></div>` : ''}`;
      return;
    }
    if (quiz.cursor >= quiz.questions.length) {
      const total = quiz.questions.length;
      const missedWords = quiz.missed.map((index) => quiz.questions[index]);
      lastQuiz = { correct: quiz.correct, total, date: new Date().toLocaleDateString('zh-CN'), missed: quiz.missed };
      state.lastQuiz = lastQuiz; save();
      content.innerHTML = `<div class="card completion"><div class="questionnumber">PRACTICE COMPLETE</div><div class="score">${quiz.correct}<span style="font-size:24px;color:var(--muted)"> / ${total}</span></div><h2>${quiz.correct === total ? '这些表达都记住了！' : '完成了，再复习一下易错词条'}</h2><p class="small">${missedWords.length ? `有 ${missedWords.length} 个词条可以再练。` : '可以回到原声，试着说出整段内容。'}</p>${missedWords.length ? `<div class="info" style="text-align:left">${missedWords.map((word) => `<p><strong lang="en">${esc(word.english)}</strong><br>${esc(word.chinese)}</p>`).join('')}</div>` : ''}<div class="quizactions"><button class="primary" data-action="restart-quiz">再练一轮</button><button class="outline" data-action="terms">复习表达卡片</button></div></div>`;
      quiz = null;
      return;
    }
    const question = quiz.questions[quiz.cursor];
    const correct = quiz.checked && quiz.selected === question.chinese;
    const options = question.options.map((option) => {
      const right = quiz.checked && option === question.chinese;
      const wrong = quiz.checked && option === quiz.selected && !right;
      return `<button class="option ${quiz.selected === option ? 'selected' : ''} ${right ? 'correct' : ''} ${wrong ? 'wrong' : ''}" data-option="${esc(option)}" ${quiz.checked ? 'disabled' : ''}>${esc(option)}</button>`;
    }).join('');
    content.innerHTML = `<div class="sectionrow"><h2>词义小测</h2><span class="questionnumber">${String(quiz.cursor + 1).padStart(2, '0')} / ${String(quiz.questions.length).padStart(2, '0')}</span></div><div class="card"><div class="questionnumber">CHOOSE THE MEANING</div><p class="questiontext" lang="en">${esc(question.english)}</p><div class="options">${options}</div>${quiz.checked ? `<div class="answer-feedback ${correct ? '' : 'wrong'}"><strong>${correct ? '答对了' : '再记一下'}</strong><p>${esc(question.english)} · ${esc(question.chinese)}</p></div>` : ''}<div class="quizactions">${quiz.checked ? '<button class="primary" data-action="quiz-next">下一题</button>' : '<button class="primary" data-action="quiz-check">检查答案</button>'}<button class="outline" data-action="quiz-cancel">退出测验</button></div></div>`;
  }

  function renderProgress() {
    const countLearned = state.learned.length;
    const countMastered = state.mastered.length;
    const summary = lastQuiz ? `${lastQuiz.correct} / ${lastQuiz.total}` : '—';
    content.innerHTML = `<div class="viewintro"><h2>每次学一点</h2><p>${storageAvailable ? '学习记录保存在当前浏览器，换设备后不会同步。' : '当前浏览器无法保存记录，关闭页面后可能丢失。'}</p></div><div class="progresssummary"><div class="stat"><strong>${countLearned}<span> / ${sentences.length}</span></strong><span>学过的句子</span></div><div class="stat"><strong>${countMastered}<span> / ${course.vocabulary.length}</span></strong><span>掌握的词条</span></div><div class="stat"><strong>${summary}</strong><span>最近测验</span></div></div><div class="card"><h3>继续你的 Day ${String(day).padStart(2, '0')}</h3><p class="small">上次读到第 ${state.sentence + 1} 句。${countLearned === sentences.length ? '本课句子已全部学过。' : '随时回到原声，再跟读一遍。'}</p><button class="primary" data-action="study">继续逐句学习</button></div>${lastQuiz ? `<div class="info"><strong>最近一次测验 · ${esc(lastQuiz.date || '')}</strong><p>答对 ${lastQuiz.correct} / ${lastQuiz.total} 题。</p></div>` : '<div class="info">完成一次测验后，这里会显示最近成绩。</div>'}<div class="footer-note">课程内容整理自 <a href="${esc(course.sourceUrl)}" target="_blank" rel="noopener">原始 Day ${day} 课程</a>。</div><button class="softbutton" data-action="reset" style="margin-top:20px">清除本机学习记录</button>`;
  }

  function render() {
    if (view === 'study') renderStudy();
    else if (view === 'terms') renderTerms();
    else if (view === 'quiz') renderQuiz();
    else renderProgress();
  }

  document.querySelector('.tabs').addEventListener('click', (event) => {
    const button = event.target.closest('[data-view]');
    if (button) nav(button.dataset.view);
  });
  content.addEventListener('change', (event) => {
    if (event.target.id === 'speed') { rate = Number(event.target.value); audio.playbackRate = rate; }
  });
  content.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.filter) { filter = button.dataset.filter; renderTerms(); return; }
    if (button.dataset.master) {
      const index = state.mastered.indexOf(button.dataset.master);
      if (index === -1) state.mastered.push(button.dataset.master); else state.mastered.splice(index, 1);
      save(); renderTerms(); return;
    }
    if (button.dataset.option && quiz && !quiz.checked) { quiz.selected = button.dataset.option; renderQuiz(); return; }
    switch (button.dataset.action) {
      case 'previous': audio.pause(); activeClip = null; state.sentence = Math.max(0, state.sentence - 1); save(); renderStudy(); break;
      case 'next': audio.pause(); activeClip = null; state.learned = [...new Set([...state.learned, state.sentence])]; state.sentence = Math.min(sentences.length - 1, state.sentence + (state.sentence < sentences.length - 1 ? 1 : 0)); save(); renderStudy(); if (state.sentence === sentences.length - 1) toast('本课最后一句已标记，继续复习表达卡片吧。'); break;
      case 'mark-learned': { const index = state.learned.indexOf(state.sentence); if (index === -1) state.learned.push(index === -1 ? state.sentence : index); else state.learned.splice(index, 1); save(); renderStudy(); break; }
      case 'clip': playClip(); break;
      case 'replay': activeClip = null; audio.currentTime = 0; audio.play().catch(() => toast('请点击音频控件开始播放。')); updateClipButton(); break;
      case 'back5': activeClip = null; audio.currentTime = Math.max(0, audio.currentTime - 5); updateClipButton(); break;
      case 'loop': audio.loop = !audio.loop; button.setAttribute('aria-pressed', String(audio.loop)); button.textContent = `循环 ${audio.loop ? '开' : '关'}`; break;
      case 'start-quiz': startQuiz(); break;
      case 'quiz-check': if (!quiz?.selected) { toast('先选一个答案吧。'); break; } quiz.checked = true; if (quiz.selected === quiz.questions[quiz.cursor].chinese) quiz.correct++; else quiz.missed.push(quiz.cursor); renderQuiz(); break;
      case 'quiz-next': quiz.cursor++; quiz.selected = null; quiz.checked = false; renderQuiz(); break;
      case 'quiz-cancel': quiz = null; renderQuiz(); break;
      case 'restart-quiz': startQuiz(); break;
      case 'terms': quiz = null; nav('terms'); break;
      case 'study': quiz = null; nav('study'); break;
      case 'reset': if (confirm('清除当前设备上的句子进度、词条标记和测验成绩？')) { state = freshState(); lastQuiz = null; quiz = null; save(); renderProgress(); toast('本机学习记录已清除'); } break;
    }
  });

  render();
})();
