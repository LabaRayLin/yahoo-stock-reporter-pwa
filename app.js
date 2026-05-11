// ── Default Stock List ───────────────────────────────────────────
const DEFAULT_STOCKS = [
  { id: "1216",  name: "統一" },
  { id: "1227",  name: "佳格" },
  { id: "2330",  name: "台積電" },
  { id: "2801",  name: "彰銀" },
  { id: "2836",  name: "高雄銀" },
  { id: "2912",  name: "統一超" },
  { id: "3130",  name: "一零四" },
  { id: "6951",  name: "青新-創" },
  { id: "8462",  name: "柏文" },
  { id: "00757", name: "統一FANG+" },
  { id: "1264",  name: "德麥" },
  { id: "3218",  name: "大學光" },
  { id: "4205",  name: "中華食" },
  { id: "5287",  name: "數字" },
  { id: "5903",  name: "全家" },
  { id: "5904",  name: "寶雅" },
  { id: "9917",  name: "中保科" },
  { id: "6803",  name: "崑鼎" },
  { id: "1788",  name: "杏昌" },
  { id: "1232",  name: "大統益" },
  { id: "9911",  name: "櫻花" },
  { id: "4506",  name: "崇友" }
];

// ── Storage Keys ─────────────────────────────────────────────────
const KEY_STOCKS      = 'YSR_stocks';
const KEY_REPORT      = 'YSR_report';
const KEY_LAST_UPDATED= 'YSR_lastUpdated';
const KEY_INVENTORY   = 'YSR_inventory';
const KEY_ENGINE_MEMO = 'YSR_engineMemo';
const KEY_NOTES_OPEN  = 'YSR_notesOpen';
const KEY_AUTO_UPDATE = 'YSR_autoUpdate';
const CACHE_PREFIX    = 'YSR_FM_';

// ── Dynamic Stock List ───────────────────────────────────────────
let stocks = [];

function loadStocks() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY_STOCKS));
    if (Array.isArray(saved) && saved.length > 0) return saved;
  } catch (_) {}
  return [...DEFAULT_STOCKS];
}

function saveStocks() {
  localStorage.setItem(KEY_STOCKS, JSON.stringify(stocks));
}

// Fetch Chinese name from FinMind TaiwanStockInfo
async function fetchStockName(id) {
  const cacheKey = `YSR_INFO_${id}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) return cached;
  try {
    const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInfo&data_id=${id}`;
    const res = await fetch(url);
    const json = await res.json();
    if (json.msg === 'success' && json.data && json.data.length > 0) {
      const row = json.data[0];
      const name = row.stock_name || row.company_name || id;
      localStorage.setItem(cacheKey, name);
      return name;
    }
  } catch (e) {
    console.error('fetchStockName error:', e);
  }
  return id;
}

async function addStock(rawId) {
  const id = rawId.trim().replace(/\s+/g, '');
  if (!id) return { error: '請輸入股票代碼' };
  if (stocks.find(s => s.id === id)) return { error: `${id} 已在清單中` };

  const name = await fetchStockName(id);
  stocks.push({ id, name });
  saveStocks();
  buildStockList();
  return { success: true, name };
}

function removeStock(id) {
  stocks = stocks.filter(s => s.id !== id);
  saveStocks();
  buildStockList();
}

// ── Helpers ──────────────────────────────────────────────────────
function getFormattedDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatNumber(num) {
  if (num === '-' || num === null || num === undefined || isNaN(num)) return '-';
  return Number(num).toLocaleString('en-US');
}

function calculateMA(closes, period) {
  if (!closes || closes.length < period) return '-';
  const slice = closes.slice(-period).filter(v => v != null);
  if (slice.length === 0) return '-';
  return (slice.reduce((a, b) => a + b, 0) / slice.length).toFixed(2);
}

function getCacheResetTime() {
  const now = new Date();
  const t = new Date(now);
  t.setHours(17, 0, 0, 0);
  if (now < t) t.setDate(t.getDate() - 1);
  return t.getTime();
}

// ── FinMind Fetch with localStorage Cache ────────────────────────
async function fetchFinMind(dataset, dataId, startDate) {
  const key = `${CACHE_PREFIX}${dataset}_${dataId}`;
  const resetTime = getCacheResetTime();
  try {
    const cached = JSON.parse(localStorage.getItem(key));
    if (cached && cached.ts > resetTime) return cached.data;
  } catch (_) {}
  try {
    const url = `https://api.finmindtrade.com/api/v4/data?dataset=${dataset}&data_id=${dataId}&start_date=${startDate}`;
    const res = await fetch(url);
    const json = await res.json();
    if (json.msg === 'success' && json.data) {
      localStorage.setItem(key, JSON.stringify({ data: json.data, ts: Date.now() }));
      return json.data;
    }
  } catch (e) {
    console.error(`FinMind error [${dataset}][${dataId}]:`, e);
  }
  try {
    const cached = JSON.parse(localStorage.getItem(key));
    if (cached) return cached.data;
  } catch (_) {}
  return null;
}

// ── Process Single Stock ─────────────────────────────────────────
async function processStock(stock) {
  const today = new Date();
  const d350 = new Date(today); d350.setDate(d350.getDate() - 350);
  const d30  = new Date(today); d30.setDate(d30.getDate() - 30);
  const d1y  = new Date(today); d1y.setFullYear(d1y.getFullYear() - 1);
  const d2y  = new Date(today); d2y.setFullYear(d2y.getFullYear() - 2);

  // Fetch price data: try TSE first, fall back to OTC (mirrors .TW → .TWO logic)
  let priceData = await fetchFinMind('TaiwanStockPrice', stock.id, getFormattedDate(d350));
  let market = 'TSE';
  if (!priceData || priceData.length === 0) {
    priceData = await fetchFinMind('TaiwanStockOTCPrice', stock.id, getFormattedDate(d350));
    market = 'OTC';
  }

  const [perData, instData, marginData, revData, finData] = await Promise.all([
    fetchFinMind('TaiwanStockPER',                           stock.id, getFormattedDate(d30)),
    fetchFinMind('TaiwanStockInstitutionalInvestorsBuySell', stock.id, getFormattedDate(d30)),
    fetchFinMind('TaiwanStockMarginPurchaseShortSale',       stock.id, getFormattedDate(d30)),
    fetchFinMind('TaiwanStockMonthRevenue',                  stock.id, getFormattedDate(d2y)),
    fetchFinMind('TaiwanStockFinancialStatements',           stock.id, getFormattedDate(d1y))
  ]);

  let price = '-', volume = '-', avgVol5 = '-', ma60 = '-', ma120 = '-', ma200 = '-';
  if (priceData && priceData.length > 0) {
    const sorted = [...priceData].sort((a, b) => a.date.localeCompare(b.date));
    const latest = sorted[sorted.length - 1];
    price  = latest.close;
    volume = formatNumber(latest.Trading_Volume);
    const closes  = sorted.map(d => d.close);
    const volumes = sorted.map(d => d.Trading_Volume);
    const last5   = volumes.slice(-5).filter(v => v != null);
    if (last5.length > 0) avgVol5 = formatNumber(Math.round(last5.reduce((a, b) => a + b, 0) / last5.length));
    ma60  = calculateMA(closes, 60);
    ma120 = calculateMA(closes, 120);
    ma200 = calculateMA(closes, 200);
  }

  let pe = '-', pb = '-', yieldVal = '-';
  if (perData && perData.length > 0) {
    const l = perData[perData.length - 1];
    if (l.PER            != null) pe       = l.PER.toFixed(2);
    if (l.PBR            != null) pb       = l.PBR.toFixed(2);
    if (l.dividend_yield != null) yieldVal = l.dividend_yield.toFixed(2) + '%';
  }

  let instNetBuy = '-', foreignNetBuy = '-', trustNetBuy = '-';
  if (instData && instData.length > 0) {
    const ld = instData[instData.length - 1].date;
    let fNet = 0, tNet = 0, dNet = 0;
    instData.filter(d => d.date === ld).forEach(r => {
      const net = r.buy - r.sell;
      if (r.name.includes('Foreign_Investor')) fNet += net;
      if (r.name.includes('Investment_Trust')) tNet += net;
      if (r.name.includes('Dealer'))           dNet += net;
    });
    foreignNetBuy = formatNumber(fNet);
    trustNetBuy   = formatNumber(tNet);
    instNetBuy    = formatNumber(fNet + tNet + dNet);
  }

  let marginBalance = '-';
  if (marginData && marginData.length > 0) {
    const ld  = marginData[marginData.length - 1].date;
    const row = marginData.find(d => d.date === ld && d.name === 'MarginPurchase');
    if (row) marginBalance = formatNumber(row.balance);
  }

  let revYoY = '-', revMoM = '-';
  if (revData && revData.length > 0) {
    const sorted = [...revData].sort((a, b) => a.date.localeCompare(b.date));
    const latest = sorted[sorted.length - 1];
    if (sorted.length >= 2) {
      const prev = sorted[sorted.length - 2];
      if (prev.revenue > 0) revMoM = (((latest.revenue - prev.revenue) / prev.revenue) * 100).toFixed(2) + '%';
    }
    const lyDate = new Date(latest.date);
    lyDate.setFullYear(lyDate.getFullYear() - 1);
    const lyStr = getFormattedDate(lyDate).substring(0, 7);
    const lyRow = sorted.find(r => r.date.startsWith(lyStr));
    if (lyRow && lyRow.revenue > 0) revYoY = (((latest.revenue - lyRow.revenue) / lyRow.revenue) * 100).toFixed(2) + '%';
  }

  let grossMargin = '-', operatingMargin = '-', netMargin = '-', eps = '-', inventoryDays = '-';
  if (finData && finData.length > 0) {
    const dates = [...new Set(finData.map(d => d.date))].sort((a, b) => b.localeCompare(a)).slice(0, 2);
    const qResults = dates.map(date => {
      const rows   = finData.filter(d => d.date === date);
      const getVal = type => { const f = rows.find(d => d.type === type); return f ? f.value : null; };
      const revenue = getVal('Revenue');
      const gp = getVal('GrossProfit'), oi = getVal('OperatingIncome');
      const ni = getVal('IncomeFromContinuingOperations'), epsV = getVal('EPS');
      const inv = getVal('TotalInventory'), cogs = getVal('CostOfGoodsSold');
      let gm = '-', om = '-', nm = '-', e = '-', id = '-';
      if (revenue && revenue > 0) {
        if (gp != null) gm = ((gp / revenue) * 100).toFixed(2) + '%';
        if (oi != null) om = ((oi / revenue) * 100).toFixed(2) + '%';
        if (ni != null) nm = ((ni / revenue) * 100).toFixed(2) + '%';
      }
      if (epsV != null) e = epsV.toFixed(2);
      if (inv && cogs && cogs > 0) id = (90 / (cogs / inv)).toFixed(2);
      return { gm, om, nm, e, id };
    });
    const q1 = qResults[0] || {}, q2 = qResults[1] || null;
    grossMargin     = q2 ? `${q1.gm} / ${q2.gm}` : q1.gm;
    operatingMargin = q2 ? `${q1.om} / ${q2.om}` : q1.om;
    netMargin       = q2 ? `${q1.nm} / ${q2.nm}` : q1.nm;
    eps             = q2 ? `${q1.e}  / ${q2.e}`  : q1.e;
    inventoryDays   = q1.id;
  }

  return {
    id: stock.id, name: stock.name, market,
    price, volume, avgVol5, ma60, ma120, ma200,
    pe, pb, yield: yieldVal,
    instNetBuy, foreignNetBuy, trustNetBuy,
    marginBalance, revYoY, revMoM,
    grossMargin, operatingMargin, netMargin, eps, inventoryDays
  };
}

// ── Format Report Block ──────────────────────────────────────────
function formatStockData(d) {
  const marketTag = d.market === 'OTC' ? ' ｜上櫃' : ' ｜上市';
  return `### 標的：${d.id} ${d.name}${marketTag}
- **最新收盤價**：$${d.price}
- **當日成交量**：${d.volume}
- **5日均量**：${d.avgVol5}
- **均線 (60MA/120MA/200MA)**：${d.ma60} / ${d.ma120} / ${d.ma200}
- **滾動本益比**：${d.pe}
- **股價淨值比**：${d.pb}
- **現金殖利率**：${d.yield}
- **三大法人買賣超**：${d.instNetBuy}
- **外資買賣超**：${d.foreignNetBuy}
- **投信買賣超**：${d.trustNetBuy}
- **融資餘額**：${d.marginBalance}
- **單月營收年增率**：${d.revYoY}
- **單月營收月增率**：${d.revMoM}
- **毛利率（近2季）**：${d.grossMargin}
- **營業利益率（近2季）**：${d.operatingMargin}
- **稅後淨利率（近2季）**：${d.netMargin}
- **單季每股盈餘（近2季）**：${d.eps}
- **存貨週轉天數**：${d.inventoryDays}`;
}

// ── Main Update Logic ────────────────────────────────────────────
let isUpdating = false;

async function updateAllStocks() {
  if (isUpdating) return;
  isUpdating = true;

  const btn          = document.getElementById('manual-update-btn');
  const reportText   = document.getElementById('report-text');
  const progressWrap = document.getElementById('progress-wrap');
  const progressFill = document.getElementById('progress-fill');
  const progressLabel= document.getElementById('progress-label');
  const mainContent  = document.querySelector('.main-content');

  btn.disabled = true;
  btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="spin"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg> 更新中...`;
  mainContent.classList.add('is-loading');
  reportText.value = '資料擷取中，請稍候...';
  progressWrap.classList.add('visible');
  stocks.forEach(s => setStockStatus(s.id, ''));

  const results = [];
  const total   = stocks.length;

  for (let i = 0; i < total; i++) {
    const stock = stocks[i];
    setStockStatus(stock.id, 'loading');
    progressLabel.textContent = `處理中 (${i + 1}/${total}) ${stock.name}`;
    progressFill.style.setProperty('--pct', `${Math.round(((i + 1) / total) * 100)}%`);
    try {
      results.push(formatStockData(await processStock(stock)));
      setStockStatus(stock.id, 'done');
    } catch (e) {
      console.error(`Error processing ${stock.id}:`, e);
      results.push(`### 標的：${stock.id} ${stock.name}\n- **[資料擷取失敗]**`);
      setStockStatus(stock.id, 'error');
    }
    await new Promise(r => setTimeout(r, 200));
  }

  const report  = results.join('\n\n');
  const timeStr = new Date().toLocaleString('zh-TW', { hour12: false });
  localStorage.setItem(KEY_REPORT, report);
  localStorage.setItem(KEY_LAST_UPDATED, timeStr);

  reportText.value = report;
  document.getElementById('last-updated').textContent = `最後更新：${timeStr}`;
  mainContent.classList.remove('is-loading');
  progressWrap.classList.remove('visible');
  progressFill.style.setProperty('--pct', '0%');

  btn.disabled = false;
  btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg> 手動更新`;
  isUpdating = false;
}

// ── Stock List Sidebar ───────────────────────────────────────────
function buildStockList() {
  const ul = document.getElementById('stock-list');
  ul.innerHTML = '';
  stocks.forEach(s => {
    const li = document.createElement('li');
    li.id = `sl-${s.id}`;
    li.setAttribute('role', 'listitem');
    li.innerHTML = `
      <span class="stock-id">${s.id}</span>
      <span class="stock-name">${s.name}</span>
      <div class="stock-item-right">
        <span class="stock-status"></span>
        <button class="remove-btn" title="移除 ${s.name}" aria-label="移除 ${s.name}">×</button>
      </div>`;
    li.querySelector('.stock-id').addEventListener('click', () => scrollToStock(s.id, s.name));
    li.querySelector('.stock-name').addEventListener('click', () => scrollToStock(s.id, s.name));
    li.querySelector('.remove-btn').addEventListener('click', e => {
      e.stopPropagation();
      removeStock(s.id);
    });
    ul.appendChild(li);
  });
}

function setStockStatus(id, status) {
  const li = document.getElementById(`sl-${id}`);
  if (li) li.className = status;
}

function scrollToStock(id, name) {
  const ta   = document.getElementById('report-text');
  const text = ta.value;
  const marker = `### 標的：${id} ${name}`;
  const idx  = text.indexOf(marker);
  if (idx === -1) return;
  const lines = text.substring(0, idx).split('\n').length - 1;
  ta.scrollTop = lines * 22;
  ta.focus();
  ta.setSelectionRange(idx, idx + marker.length);
}

// ── Auto-Update ──────────────────────────────────────────────────
let autoUpdateTimer = null;
const AUTO_INTERVAL_MS = 10 * 60 * 1000;

function startAutoUpdate() {
  stopAutoUpdate();
  autoUpdateTimer = setInterval(() => {
    const now = new Date();
    const day = now.getDay(), hour = now.getHours();
    if (day >= 1 && day <= 5 && hour >= 9 && hour <= 13) updateAllStocks();
  }, AUTO_INTERVAL_MS);
}

function stopAutoUpdate() {
  if (autoUpdateTimer) { clearInterval(autoUpdateTimer); autoUpdateTimer = null; }
}

// ── Clipboard ────────────────────────────────────────────────────
async function copyToClipboard(text, statusEl, message) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy');
    document.body.removeChild(ta);
  }
  showStatus(statusEl, message, 3000);
}

function showStatus(el, msg, duration) {
  el.textContent = msg; el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.classList.remove('show'); el.textContent = ''; }, duration);
}

// ── PWA Install ──────────────────────────────────────────────────
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstallPrompt = e;
});
document.getElementById('install-btn').addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  if (outcome === 'accepted') deferredInstallPrompt = null;
});

// ── DOM Ready ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Load stocks
  stocks = loadStocks();
  buildStockList();

  // Restore state
  const savedReport = localStorage.getItem(KEY_REPORT);
  const savedTime   = localStorage.getItem(KEY_LAST_UPDATED);
  if (savedReport) document.getElementById('report-text').value = savedReport;
  if (savedTime)   document.getElementById('last-updated').textContent = `最後更新：${savedTime}`;

  const inventory  = localStorage.getItem(KEY_INVENTORY);
  const engineMemo = localStorage.getItem(KEY_ENGINE_MEMO);
  if (inventory)  document.getElementById('inventoryInput').value  = inventory;
  if (engineMemo) document.getElementById('engineMemoInput').value = engineMemo;

  // Notes panel state
  const notesToggle = document.getElementById('notes-toggle');
  const notesBody   = document.getElementById('notes-body');
  if (localStorage.getItem(KEY_NOTES_OPEN) === 'true') {
    notesBody.classList.add('open');
    notesToggle.setAttribute('aria-expanded', 'true');
  }
  notesToggle.addEventListener('click', () => {
    const expanded = notesBody.classList.toggle('open');
    notesToggle.setAttribute('aria-expanded', String(expanded));
    localStorage.setItem(KEY_NOTES_OPEN, String(expanded));
  });

  // Auto-update toggle
  const autoCheck = document.getElementById('auto-update-check');
  const autoEnabled = localStorage.getItem(KEY_AUTO_UPDATE) !== 'false';
  autoCheck.checked = autoEnabled;
  if (autoEnabled) startAutoUpdate();
  autoCheck.addEventListener('change', () => {
    localStorage.setItem(KEY_AUTO_UPDATE, String(autoCheck.checked));
    autoCheck.checked ? startAutoUpdate() : stopAutoUpdate();
  });

  // Save notes
  document.getElementById('saveNotesBtn').addEventListener('click', () => {
    localStorage.setItem(KEY_INVENTORY,   document.getElementById('inventoryInput').value);
    localStorage.setItem(KEY_ENGINE_MEMO, document.getElementById('engineMemoInput').value);
    showStatus(document.getElementById('save-status'), '✅ 已儲存', 2500);
  });

  // --- Field Utils (Clear & Paste) ---
  const setupUtilButtons = (textareaId, clearId, pasteId, storageKey) => {
    const ta = document.getElementById(textareaId);
    const clearBtn = document.getElementById(clearId);
    const pasteBtn = document.getElementById(pasteId);

    clearBtn.addEventListener('click', () => {
      if (ta.value && confirm('確定要清空嗎？')) {
        ta.value = '';
        localStorage.setItem(storageKey, '');
        showStatus(document.getElementById('save-status'), '🗑️ 已清空', 1500);
      }
    });

    pasteBtn.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          ta.value = text;
          localStorage.setItem(storageKey, text);
          showStatus(document.getElementById('save-status'), '📋 已貼上並暫存', 1500);
        }
      } catch (err) {
        console.error('貼上失敗:', err);
        alert('無法讀取剪貼簿，請檢查權限。');
      }
    });
  };

  setupUtilButtons('inventoryInput', 'clear-inventory', 'paste-inventory', KEY_INVENTORY);
  setupUtilButtons('engineMemoInput', 'clear-memo', 'paste-memo', KEY_ENGINE_MEMO);

  // Manual update
  document.getElementById('manual-update-btn').addEventListener('click', () => updateAllStocks());

  // ── Add Stock ────────────────────────────────────────────────
  const stockInput    = document.getElementById('stock-id-input');
  const addBtn        = document.getElementById('add-stock-btn');
  const addStatusEl   = document.getElementById('add-stock-status');

  async function handleAddStock() {
    const id = stockInput.value.trim();
    if (!id) return;
    addBtn.disabled = true;
    addBtn.textContent = '…';
    showStatus(addStatusEl, '查詢中...', 60000);

    const result = await addStock(id);
    if (result.error) {
      showStatus(addStatusEl, `❌ ${result.error}`, 3000);
    } else {
      showStatus(addStatusEl, `✅ 已新增：${result.name}`, 3000);
      stockInput.value = '';
    }
    addBtn.disabled = false;
    addBtn.textContent = '＋';
  }

  addBtn.addEventListener('click', handleAddStock);
  stockInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleAddStock(); });

  // Copy report
  document.getElementById('copy-btn').addEventListener('click', () => {
    const report = document.getElementById('report-text').value;
    if (!report) return;
    copyToClipboard(report, document.getElementById('copy-status'), '✅ 已複製報表！');
  });

  // Copy Gemini prompt
  document.getElementById('copy-gemini-btn').addEventListener('click', () => {
    const report    = document.getElementById('report-text').value;
    const inventory = document.getElementById('inventoryInput').value || localStorage.getItem(KEY_INVENTORY) || '（未填寫）';
    const memo      = document.getElementById('engineMemoInput').value || localStorage.getItem(KEY_ENGINE_MEMO) || '（未填寫）';
    const now = new Date().toLocaleString('zh-TW', { hour12: false });
    const prompt = `請根據以下提供的資訊，協助我進行投資分析與策略決策：\n\n## 1. 庫存現況\n${inventory}\n\n## 2. 系統最新市場數據（自動擷取 · ${now}）\n${report || '目前無數據，請先執行更新'}\n\n---\n## 3. 引擎二專用備忘錄\n${memo}`;
    copyToClipboard(prompt, document.getElementById('copy-status'), '📋 已複製完整 Prompt！');
  });

  // ── Mobile Tab Switching ─────────────────────────────────────
  const tabStocks = document.getElementById('tab-stocks');
  const tabNotes  = document.getElementById('tab-notes');
  const tabReport = document.getElementById('tab-report');
  const sidebar   = document.querySelector('.sidebar');
  const mainContent = document.querySelector('.main-content');

  function isMobile() {
    return window.innerWidth <= 680;
  }

  function setActiveTab(tab) {
    [tabStocks, tabNotes, tabReport].forEach(t => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    tab.classList.add('active');
    tab.setAttribute('aria-selected', 'true');

    if (!isMobile()) return;

    // Show/hide sidebar and main content
    if (tab === tabReport) {
      sidebar.classList.add('tab-hidden');
      mainContent.style.display = '';
    } else {
      sidebar.classList.remove('tab-hidden');
      mainContent.style.display = 'none';
    }

    // Show/hide which sidebar section
    if (tab === tabStocks) {
      sidebar.classList.add('stocks-active');
      sidebar.classList.remove('notes-active');
    } else if (tab === tabNotes) {
      sidebar.classList.add('notes-active');
      sidebar.classList.remove('stocks-active');
    }
  }

  if (tabStocks) {
    tabStocks.addEventListener('click', () => setActiveTab(tabStocks));
    tabNotes.addEventListener('click',  () => setActiveTab(tabNotes));
    tabReport.addEventListener('click', () => setActiveTab(tabReport));

    // Initialize mobile state
    if (isMobile()) setActiveTab(tabStocks);

    // Reset on resize (e.g. rotate phone)
    window.addEventListener('resize', () => {
      if (!isMobile()) {
        // Restore desktop layout
        sidebar.classList.remove('tab-hidden', 'stocks-active', 'notes-active');
        mainContent.style.display = '';
      }
    });
  }

  // Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW reg failed:', err));
  }
});
