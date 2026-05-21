(function() {
'use strict';
console.log('[QuizSolver] content.js loaded on:', window.location.href);

let lastQuestion = '';
let isProcessing = false;
let isRunning = false;

async function getSetting(key) {
  return new Promise(resolve => chrome.storage.local.get(key, d => resolve(d[key] || '')));
}

function extractQuiz() {
  const r = { question: '', options: {}, optionElements: [] };
  const letters = ['A','B','C','D'];
  for (const el of document.querySelectorAll('strong,b,h2,h3,p,[class*="question"]')) {
    const t = el.textContent.trim();
    if (t.length > 30 && t.length < 600) { r.question = t; break; }
  }
  const badges = Array.from(document.querySelectorAll('*')).filter(el =>
    letters.includes(el.textContent.trim()) && el.children.length === 0 && !['SCRIPT','STYLE'].includes(el.tagName)
  );
  if (badges.length >= 4) {
    badges.slice(0,4).forEach((badge,i) => {
      const c = badge.closest('[class*="option"],[class*="answer"],[class*="choice"],li') || badge.parentElement?.parentElement || badge.parentElement;
      if (c) { r.options[letters[i]] = c.textContent.trim().replace(/^[ABCD]\s*/,'').trim(); r.optionElements.push(c); }
    });
  }
  if (r.optionElements.length < 4) {
    r.options = {}; r.optionElements = [];
    for (const s of ['[class*="option"]','[class*="answer"]','[class*="choice"]','[class*="variant"]']) {
      const els = Array.from(document.querySelectorAll(s)).filter(el => { const t=el.textContent.trim(); return t.length>2&&t.length<400; });
      if (els.length >= 4) { els.slice(0,4).forEach((el,i) => { r.options[letters[i]]=el.textContent.trim().replace(/^[ABCD][).\s]+/,'').trim(); r.optionElements.push(el); }); break; }
    }
  }
  return r;
}

function clickNext() {
  for (const el of document.querySelectorAll('button')) {
    const t = el.textContent.trim().toLowerCase();
    if (t.includes('zatwierdź')||t.includes('zatwierdz')||t.includes('dalej')||t.includes('next')) { el.click(); return true; }
  }
  return false;
}

function parseJSON(text) {
  try { return JSON.parse(text.trim()); } catch(e) {}
  let c = text.replace(/```json\s*/gi,'').replace(/```\s*/g,'').trim();
  try { return JSON.parse(c); } catch(e) {}
  const s=c.indexOf('{'),e=c.lastIndexOf('}');
  if (s!==-1&&e>s) { try { return JSON.parse(c.slice(s,e+1)); } catch(e) {} }
  const a=(text.match(/"answer"\s*:\s*"([ABCD])"/i)||[])[1];
  if (a) return { answer:a, correct_text:(text.match(/"correct_text"\s*:\s*"([^"]*?)"/i)||[])[1]||'', explanation_ru:(text.match(/"explanation_ru"\s*:\s*"([^"]*?)"/i)||[])[1]||'' };
  const m=(text.match(/(?:answer|correct)[^\w]*([ABCD])\b/i)||[])[1];
  if (m) return { answer:m.toUpperCase(), correct_text:'', explanation_ru:'' };
  const l=(text.match(/\b([ABCD])\b/)||[])[1];
  if (l) return { answer:l, correct_text:'', explanation_ru:'' };
  return null;
}

function injectStyles() {
  if (document.getElementById('qs-style')) return;
  const s = document.createElement('style');
  s.id = 'qs-style';
  s.textContent = `
    #qs-wrap { position:fixed; bottom:24px; right:24px; z-index:2147483647; display:flex; flex-direction:column; align-items:flex-end; gap:10px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
    #qs-fab { width:52px; height:52px; border-radius:50%; background:#6366f1; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; box-shadow:0 4px 20px rgba(99,102,241,0.4); transition:transform 0.15s; }
    #qs-fab:hover { transform:scale(1.08); }
    #qs-fab svg { width:24px; height:24px; fill:none; stroke:#fff; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
    #qs-card { width:240px; background:#0d0f1a; border-radius:14px; border:1px solid #2d3148; overflow:hidden; box-shadow:0 8px 40px rgba(0,0,0,0.6); }
    #qs-head { padding:10px 14px; display:flex; align-items:center; gap:8px; background:#6366f1; transition:background 0.3s; }
    #qs-head.ok { background:#16a34a; }
    #qs-head.thinking { background:#d97706; }
    #qs-head.err { background:#dc2626; }
    #qs-head-label { font-size:11px; font-weight:700; color:#fff; letter-spacing:1px; flex:1; }
    #qs-head-dot { width:8px; height:8px; border-radius:50%; background:rgba(255,255,255,0.5); }
    #qs-head-dot.pulse { animation:qs-pulse 0.8s infinite; }
    #qs-body { padding:14px; }
    #qs-status { font-size:12px; color:#94a3b8; display:flex; align-items:center; gap:8px; min-height:28px; }
    #qs-spinner { width:14px; height:14px; border:2px solid #d97706; border-top-color:transparent; border-radius:50%; animation:qs-spin 0.6s linear infinite; flex-shrink:0; display:none; }
    #qs-result { display:none; padding-top:12px; border-top:1px solid #1e2235; margin-top:10px; }
    #qs-letter { font-size:52px; font-weight:700; color:#22c55e; line-height:1; }
    #qs-ctext { font-size:12px; font-weight:500; color:#e2e8f0; margin-top:4px; }
    #qs-exp { font-size:11px; color:#64748b; margin-top:4px; line-height:1.5; }
    #qs-btns { display:flex; gap:6px; margin-top:12px; }
    #qs-btn-start, #qs-btn-stop, #qs-btn-once { flex:1; padding:8px; border-radius:8px; font-size:11px; font-weight:600; cursor:pointer; border:none; transition:opacity 0.15s; }
    #qs-btn-start { background:#22c55e; color:#000; }
    #qs-btn-stop  { background:#dc2626; color:#fff; display:none; }
    #qs-btn-once  { background:#1e2235; color:#94a3b8; border:1px solid #2d3148; }
    #qs-modes { display:flex; gap:6px; margin-top:8px; }
    #qs-m-show, #qs-m-auto { flex:1; padding:6px; border-radius:7px; font-size:11px; font-weight:600; cursor:pointer; background:#1e2235; color:#64748b; border:1px solid #2d3148; transition:all 0.15s; }
    #qs-m-auto.on { background:#1a1a3e; color:#a5b4fc; border-color:#6366f1; }
    #qs-m-show.on { background:#14291a; color:#22c55e; border-color:#22c55e; }
    .qs-hl { outline:3px solid #22c55e !important; box-shadow:0 0 18px rgba(34,197,94,0.5) !important; border-radius:8px !important; }
    .qs-dim { opacity:0.3 !important; }
    @keyframes qs-spin { to { transform:rotate(360deg); } }
    @keyframes qs-pulse { 0%,100%{opacity:0.5} 50%{opacity:1} }
  `;
  document.head.appendChild(s);
}

function buildUI() {
  if (document.getElementById('qs-wrap')) return;
  injectStyles();
  const wrap = document.createElement('div');
  wrap.id = 'qs-wrap';
  wrap.innerHTML = `
    <div id="qs-card" style="display:none;">
      <div id="qs-head">
        <span id="qs-head-label">⚡ QUIZ SOLVER</span>
        <div id="qs-head-dot"></div>
      </div>
      <div id="qs-body">
        <div id="qs-status">
          <div id="qs-spinner"></div>
          <span id="qs-status-text">Нажми ▶ Старт</span>
        </div>
        <div id="qs-result">
          <div id="qs-letter">—</div>
          <div id="qs-ctext"></div>
          <div id="qs-exp"></div>
        </div>
        <div id="qs-btns">
          <button id="qs-btn-start">▶ Старт</button>
          <button id="qs-btn-stop">■ Стоп</button>
          <button id="qs-btn-once">🔍 Раз</button>
        </div>
        <div id="qs-modes">
          <button id="qs-m-show" class="on">👁 Показать</button>
          <button id="qs-m-auto">⚡ Авто-клик</button>
        </div>
      </div>
    </div>
    <button id="qs-fab" title="Quiz Solver">
      <svg viewBox="0 0 24 24"><path d="M12 2a9 9 0 0 1 9 9c0 3.5-2 6.5-5 8l-1 3H9l-1-3c-3-1.5-5-4.5-5-8a9 9 0 0 1 9-9z"/><line x1="12" y1="12" x2="12" y2="12.01"/></svg>
    </button>
  `;
  document.body.appendChild(wrap);

  let mode = 'show';
  chrome.storage.local.get('mode', d => { if (d.mode==='auto') setMode('auto'); });

  function setMode(m) {
    mode = m;
    document.getElementById('qs-m-show').className = m==='show' ? 'on' : '';
    document.getElementById('qs-m-auto').className = m==='auto' ? 'on' : '';
    chrome.storage.local.set({ mode: m });
  }

  document.getElementById('qs-fab').onclick = () => {
    const card = document.getElementById('qs-card');
    card.style.display = card.style.display === 'none' ? 'block' : 'none';
  };
  document.getElementById('qs-m-show').onclick = () => setMode('show');
  document.getElementById('qs-m-auto').onclick = () => setMode('auto');

  document.getElementById('qs-btn-start').onclick = () => {
    isRunning = true;
    lastQuestion = '';
    document.getElementById('qs-btn-start').style.display = 'none';
    document.getElementById('qs-btn-stop').style.display = 'block';
    setHead('thinking');
    setStatus('👀 Жду вопрос...', false);
    autoSolve();
  };

  document.getElementById('qs-btn-stop').onclick = () => {
    isRunning = false;
    isProcessing = false;
    document.getElementById('qs-btn-stop').style.display = 'none';
    document.getElementById('qs-btn-start').style.display = 'block';
    setHead('idle');
    setStatus('Остановлено', false);
    clearHL();
  };

  document.getElementById('qs-btn-once').onclick = () => {
    lastQuestion = '';
    autoSolve();
  };
}

function setHead(state) {
  const h = document.getElementById('qs-head');
  const d = document.getElementById('qs-head-dot');
  if (!h) return;
  h.className = state === 'ok' ? 'ok' : state === 'thinking' ? 'thinking' : state === 'err' ? 'err' : '';
  d.className = state === 'thinking' ? 'pulse' : '';
}

function setStatus(msg, spinning) {
  const st = document.getElementById('qs-status-text');
  const sp = document.getElementById('qs-spinner');
  const res = document.getElementById('qs-result');
  if (st) st.textContent = msg;
  if (sp) sp.style.display = spinning ? 'block' : 'none';
  if (res) res.style.display = 'none';
  document.getElementById('qs-status').style.display = 'flex';
}

function showResult(answer, ctext, exp) {
  document.getElementById('qs-status').style.display = 'none';
  const res = document.getElementById('qs-result');
  res.style.display = 'block';
  document.getElementById('qs-letter').textContent = answer;
  document.getElementById('qs-ctext').textContent = ctext;
  document.getElementById('qs-exp').textContent = exp;
}

function clearHL() {
  document.querySelectorAll('.qs-hl,.qs-dim').forEach(el => el.classList.remove('qs-hl','qs-dim'));
}

function applyAnswer(letter, optEls, mode) {
  const letters = ['A','B','C','D'];
  clearHL();
  let target = null;
  optEls.forEach((el,i) => {
    if (letters[i] === letter) { el.classList.add('qs-hl'); el.scrollIntoView({behavior:'smooth',block:'center'}); target = el; }
    else el.classList.add('qs-dim');
  });
  if (mode === 'auto' && target) {
    setTimeout(() => {
      target.click();
      const inner = target.querySelector('input,label,button,span');
      if (inner) inner.click();
      setTimeout(() => clickNext(), 800);
    }, 500);
  }
}

async function autoSolve() {
  if (isProcessing) return;
  const quiz = extractQuiz();
  if (!quiz.question || quiz.question === lastQuestion) return;
  const apiKey = await getSetting('apiKey');
  if (!apiKey) { buildUI(); setHead('err'); setStatus('❌ Нет API ключа!', false); return; }

  isProcessing = true;
  lastQuestion = quiz.question;
  const mode = await getSetting('mode');

  buildUI();
  document.getElementById('qs-card').style.display = 'block';
  setHead('thinking');
  setStatus('📸 Скриншот...', true);

  await new Promise(r => setTimeout(r, 400));
  setStatus('🤖 Думаю...', true);

  const result = await new Promise(resolve => {
    chrome.runtime.sendMessage({ action: 'screenshot' }, async (resp) => {
      if (!resp || !resp.base64) { resolve(null); return; }
      try {
        const res = await fetch(
          'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [
                { inline_data: { mime_type: 'image/png', data: resp.base64 } },
                { text: 'Polish vocational test (mechatronics/PLC/electronics/pneumatics/robotics). Find question and options A B C D. Determine CORRECT answer. Reply ONLY with JSON, no markdown: {"answer":"A","correct_text":"exact option text","explanation_ru":"краткое объяснение"}' }
              ]}],
              generationConfig: { temperature: 0 }
            })
          }
        );
        if (!res.ok) { const e=await res.json(); resolve({_err:(e.error&&e.error.message)||'HTTP '+res.status}); return; }
        const json = await res.json();
        resolve(parseJSON(json.candidates[0].content.parts[0].text));
      } catch(e) { resolve({_err: e.message}); }
    });
  });

  if (result && result._err) {
    setHead('err'); setStatus('❌ ' + result._err, false);
    isProcessing = false; return;
  }

  if (result && result.answer && 'ABCD'.includes(result.answer)) {
    setHead('ok');
    showResult(result.answer, result.correct_text||'', result.explanation_ru||'');
    applyAnswer(result.answer, quiz.optionElements, mode);
    setTimeout(() => { isProcessing = false; }, mode === 'auto' ? 3000 : 0);
  } else {
    // Fallback: text only
    const opts = Object.entries(quiz.options).map(([k,v])=>k+') '+v).join('\n');
    try {
      const res = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey,
        { method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ contents:[{parts:[{text:'Expert: mechatronics/PLC/electronics/pneumatics. Polish test.\nQ: '+quiz.question+'\n'+opts+'\nJSON only: {"answer":"A","correct_text":"text","explanation_ru":"объяснение"}'}]}], generationConfig:{temperature:0} }) }
      );
      if (res.ok) {
        const json = await res.json();
        const data = parseJSON(json.candidates[0].content.parts[0].text);
        if (data && data.answer && 'ABCD'.includes(data.answer)) {
          setHead('ok');
          showResult(data.answer, data.correct_text||'', data.explanation_ru||'');
          applyAnswer(data.answer, quiz.optionElements, mode);
        } else { setHead('err'); setStatus('❌ Не удалось определить ответ', false); }
      } else { setHead('err'); setStatus('❌ Ошибка API', false); }
    } catch(e) { setHead('err'); setStatus('❌ '+e.message, false); }
    isProcessing = false;
  }
}

// Watch DOM for new questions
let debounce = null;
new MutationObserver(() => {
  if (!isRunning) return;
  const quiz = extractQuiz();
  if (quiz.question && quiz.question !== lastQuestion && !isProcessing) {
    clearTimeout(debounce);
    debounce = setTimeout(autoSolve, 1000);
  }
}).observe(document.body, { childList:true, subtree:true });

// Init
buildUI(); console.log("[QuizSolver] buildUI called");;

})();
