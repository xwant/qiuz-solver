document.addEventListener('DOMContentLoaded', () => {

  let currentMode = 'show';

  chrome.storage.local.get(['apiKey', 'mode'], (data) => {
    if (data.apiKey) {
      document.getElementById('apiKey').value = data.apiKey;
      setStatus('ready', 'API ключ загружен ✓');
    }
    if (data.mode) setMode(data.mode);
  });

  document.getElementById('saveKey').addEventListener('click', () => {
    const key = document.getElementById('apiKey').value.trim();
    if (!key) { alert('Введи API ключ!'); return; }
    chrome.storage.local.set({ apiKey: key }, () => setStatus('ready', 'Сохранено ✓'));
  });

  document.getElementById('modeShow').addEventListener('click', () => setMode('show'));
  document.getElementById('modeAuto').addEventListener('click', () => setMode('auto'));
  document.getElementById('scanBtn').addEventListener('click', () => scanPage());
  document.getElementById('scanScreenBtn').addEventListener('click', () => scanScreen());

  function setMode(mode) {
    currentMode = mode;
    document.getElementById('modeShow').classList.toggle('active', mode === 'show');
    document.getElementById('modeAuto').classList.toggle('active', mode === 'auto');
    chrome.storage.local.set({ mode });
  }

  function setStatus(state, text) {
    const dot = document.getElementById('statusDot');
    dot.className = 'status-dot ' + ({ ready: 'dot-green', waiting: 'dot-gray', thinking: 'dot-orange' }[state] || 'dot-gray');
    document.getElementById('statusText').textContent = text;
  }

  function showResult(letter, correctText, explanation) {
    document.getElementById('resultSection').style.display = 'block';
    document.getElementById('resultLetter').textContent = 'Ответ: ' + letter;
    document.getElementById('resultCorrect').textContent = correctText;
    document.getElementById('resultExplain').textContent = explanation;
  }

  async function getApiKey() {
    return new Promise(resolve => chrome.storage.local.get('apiKey', d => resolve(d.apiKey || '')));
  }

  // Extract JSON from messy text - handles markdown, extra text, etc.
  function extractJSON(text) {
    // Try direct parse first
    try { return JSON.parse(text.trim()); } catch(e) {}
    // Remove markdown code blocks
    let clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    try { return JSON.parse(clean); } catch(e) {}
    // Find first { ... } block
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      try { return JSON.parse(clean.slice(start, end + 1)); } catch(e) {}
    }
    // Extract fields manually with regex
    const answer = (text.match(/"answer"\s*:\s*"([ABCD])"/i) || [])[1];
    const correct = (text.match(/"correct_text"\s*:\s*"([^"]+)"/i) || [])[1];
    const explain = (text.match(/"explanation_ru"\s*:\s*"([^"]+)"/i) || [])[1];
    if (answer) return { answer, correct_text: correct || '', explanation_ru: explain || '' };
    // Last resort: find letter A/B/C/D mentioned as answer
    const letterMatch = text.match(/answer["\s:]+([ABCD])/i);
    if (letterMatch) return { answer: letterMatch[1], correct_text: '', explanation_ru: text.slice(0, 200) };
    throw new Error('Не удалось распарсить ответ: ' + text.slice(0, 100));
  }

  async function callGemini(prompt) {
    const apiKey = await getApiKey();
    if (!apiKey) return { error: 'Нет API ключа!' };

    try {
      const res = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 500, responseMimeType: 'application/json' }
          })
        }
      );
      if (!res.ok) { const e = await res.json(); return { error: (e.error && e.error.message) || 'HTTP ' + res.status }; }
      const json = await res.json();
      const text = json.candidates[0].content.parts[0].text;
      return { data: extractJSON(text) };
    } catch(e) { return { error: e.message }; }
  }

  async function callGeminiWithImage(base64) {
    const apiKey = await getApiKey();
    if (!apiKey) return { error: 'Нет API ключа!' };

    try {
      const res = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { inline_data: { mime_type: 'image/png', data: base64 } },
                { text: 'На скриншоте польский тест по мехатронике/робототехнике/электронике/PLC. Найди вопрос и варианты A/B/C/D. Определи правильный ответ. Верни ТОЛЬКО JSON: {"answer":"A","correct_text":"текст","explanation_ru":"объяснение"}' }
              ]
            }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 500, responseMimeType: 'application/json' }
          })
        }
      );
      if (!res.ok) { const e = await res.json(); return { error: (e.error && e.error.message) || 'HTTP ' + res.status }; }
      const json = await res.json();
      const text = json.candidates[0].content.parts[0].text;
      return { data: extractJSON(text) };
    } catch(e) { return { error: e.message }; }
  }

  function injectHighlight(letter, mode) {
    if (!document.getElementById('qs-style')) {
      const s = document.createElement('style');
      s.id = 'qs-style';
      s.textContent = '.qs-hl{outline:3px solid #22c55e!important;box-shadow:0 0 15px #22c55e66!important;border-radius:8px!important}.qs-badge{position:fixed;top:16px;right:16px;background:#0f1117;border:2px solid #22c55e;border-radius:12px;padding:12px 18px;color:#22c55e;font:700 22px sans-serif;z-index:2147483647}';
      document.head.appendChild(s);
    }
    document.querySelectorAll('.qs-hl').forEach(e => e.classList.remove('qs-hl'));
    const letters = ['A','B','C','D'];
    const optEls = document.querySelectorAll('[class*="option"],[class*="answer"],[class*="choice"],[class*="variant"]');
    optEls.forEach((el, i) => {
      if (letters[i] === letter) {
        el.classList.add('qs-hl');
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (mode === 'auto') el.click();
      }
    });
    document.querySelectorAll('.qs-badge').forEach(b => b.remove());
    const badge = document.createElement('div');
    badge.className = 'qs-badge';
    badge.textContent = '✓ ' + letter;
    document.body.appendChild(badge);
    setTimeout(() => badge.remove(), 5000);
  }

  async function scanPage() {
    const btn = document.getElementById('scanBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Читаю...';
    setStatus('thinking', 'Читаю страницу...');

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const r = { question: '', options: {} };
          const letters = ['A','B','C','D'];
          const qSels = ['strong','b','h2','h3','.question','[class*="question"]','[class*="Question"]'];
          for (const s of qSels) {
            const el = document.querySelector(s);
            if (el && el.textContent.trim().length > 20) { r.question = el.textContent.trim(); break; }
          }
          const oSels = ['[class*="option"]','[class*="answer"]','[class*="choice"]','[class*="variant"]','li'];
          for (const s of oSels) {
            const els = document.querySelectorAll(s);
            if (els.length >= 4) {
              els.forEach((el, i) => { if (i < 4) r.options[letters[i]] = el.textContent.trim().replace(/^[ABCD][).\s]+/,'').trim(); });
              if (Object.keys(r.options).length >= 4) break;
            }
          }
          return r;
        }
      });

      const quizData = results[0].result;
      if (!quizData.question) {
        setStatus('waiting', 'Вопрос не найден — попробуй «Скриншот»');
        btn.disabled = false; btn.innerHTML = '🔍 Найти вопрос на странице';
        return;
      }

      setStatus('thinking', 'Спрашиваю Gemini...');
      btn.innerHTML = '<span class="spinner"></span>Думаю...';

      const optLines = Object.entries(quizData.options).map(([k,v]) => k + ') ' + v).join('\n');
      const prompt = 'Ты эксперт по мехатронике, робототехнике, электронике, пневматике, PLC. Вопрос из польского профессионального теста.\n\nВопрос: ' + quizData.question + '\n\nВарианты:\n' + optLines + '\n\nВерни ТОЛЬКО JSON без пояснений:\n{"answer":"A","correct_text":"текст варианта","explanation_ru":"объяснение 1-2 предложения"}';

      const { data, error } = await callGemini(prompt);
      if (error) { setStatus('waiting', '❌ ' + error); btn.disabled = false; btn.innerHTML = '🔍 Найти вопрос на странице'; return; }

      showResult(data.answer, data.correct_text || '', data.explanation_ru || '');
      setStatus('ready', '✓ Ответ: ' + data.answer);
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: injectHighlight, args: [data.answer, currentMode] });

    } catch(e) { setStatus('waiting', '❌ ' + e.message); }
    btn.disabled = false;
    btn.innerHTML = '🔍 Найти вопрос на странице';
  }

  async function scanScreen() {
    const btn = document.getElementById('scanScreenBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Скриншот...';
    setStatus('thinking', 'Делаю скриншот...');

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      const base64 = dataUrl.split(',')[1];

      setStatus('thinking', 'Gemini анализирует...');
      btn.innerHTML = '<span class="spinner"></span>Думаю...';

      const { data, error } = await callGeminiWithImage(base64);
      if (error) { setStatus('waiting', '❌ ' + error); btn.disabled = false; btn.innerHTML = '📷 Скриншот + распознать'; return; }

      showResult(data.answer, data.correct_text || '', data.explanation_ru || '');
      setStatus('ready', '✓ Ответ: ' + data.answer);
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: injectHighlight, args: [data.answer, currentMode] });

    } catch(e) { setStatus('waiting', '❌ ' + e.message); }
    btn.disabled = false;
    btn.innerHTML = '📷 Скриншот + распознать';
  }

});
