/* ==========================================
   樂肉家記帳決策儀表板 | 核心邏輯 app.js (全自動時間分類版)
   ========================================== */

// 1. 全域狀態管理 (State)
const state = {
  sheetUrl: '',
  // 記帳模式：
  // 'separate': 收支分開在不同工作分頁 (需要填入兩個 GID：支出 GID & 收入 GID)
  // 'combined': 收支記錄在同一個工作分頁 (僅需一個分頁 GID 加上「收支類型」對應)
  sheetMode: 'separate', 
  
  // 工作表分頁 GID 設定
  expenseGid: '0',
  incomeGid: '',
  singleGid: '0',
  
  rawExpenses: [],      // 分開模式下的原始支出暫存
  rawIncomes: [],       // 分開模式下的原始收入暫存
  rawTransactions: [],  // 合併或單一分頁模式下的原始收支暫存
  mappedTransactions: [], // 標準化後的收支帳目
  
  columns: [], // 資料表的所有欄位
  availableMembers: [], // 資料中偵測到的家庭成員
  
  // 欄位對應關係
  mapping: {
    expense: {
      date: '',
      member: '',
      category: '',
      amount: '',
      remark: ''
    },
    income: {
      date: '',
      member: '',
      category: '',
      source: '',
      amount: '',
      remark: ''
    },
    combined: {
      date: '',
      member: '',
      category: '',
      source: '',
      amount: '',
      remark: '',
      type: ''
    }
  },
  
  // 單一模式下收支類型對應字眼
  matchExpense: '支出',
  matchIncome: '收入',
  
  // 預算與目標
  monthlyBudget: 35000,
  annualSavingsGoal: 200000,
  
  // 篩選與檢討週期
  reviewCycle: 'month', // 'month' (月度檢討) 或 'year' (年度檢討)
  filterPeriod: '',  // 預設為空，由程式在載入資料後自動選取最新有資料的月份
  filterMember: 'all',  // 家庭成員篩選
  
  // 圖表顯示模式：'category' (按類別) 或 'member' (按成員)
  chartDistributionMode: 'category',
  
  // 明細頁分頁與過濾
  pagination: {
    currentPage: 1,
    pageSize: 10
  },
  tableFilters: {
    searchQuery: '',
    type: 'all',
    category: 'all',
    member: 'all'
  },
  
  // 密碼安全鎖相關狀態
  usePassword: false,
  lockPassword: '',
  isLocked: false,
  encryptedConfig: '',
  isAdmin: true
};

// 圖表實例
let trendChartInstance = null;
let categoryChartInstance = null;

// 分類調色盤 (亮麗的 HSL 漸層色系)
const categoryColors = [
  '#6366f1', // 靛藍
  '#f43f5e', // 玫瑰紅
  '#10b981', // 翡翠綠
  '#f59e0b', // 琥珀黃
  '#8b5cf6', // 薰衣草紫
  '#0ea5e9', // 天空藍
  '#ec4899', // 粉紅
  '#14b8a6', // 青綠
  '#f97316', // 橘色
  '#64748b'  // 灰色
];

// 2. 初始化與事件綁定
document.addEventListener('DOMContentLoaded', () => {
  // 先偵測與解析 URL 中的共享參數，若有則會寫入 LocalStorage
  parseSharedUrlConfig();

  lucide.createIcons();
  
  // 從 LocalStorage 載入設定
  loadSettingsFromStorage();
  
  // 產生並填入初始的共享網址
  generateShareLink();

  // 綁定事件
  bindEvents();
  
  // 根據連線狀態載入
  if (state.isLocked) {
    // 若鎖定，則不自動載入，等解鎖後再執行
    return;
  }
  if (state.sheetUrl) {
    fetchSheetData();
  } else {
    loadMockData();
  }
});

// 3. 事件處理與路由
function bindEvents() {
  // 側邊欄 Tab 切換
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const tabId = item.getAttribute('data-tab');
      switchTab(tabId);
    });
  });

  // 連接 Google Sheet Modal 控制
  document.getElementById('btn-open-config').addEventListener('click', openConfigModal);
  document.getElementById('btn-close-modal').addEventListener('click', closeConfigModal);
  document.getElementById('btn-sync-now').addEventListener('click', () => {
    if (state.sheetUrl) {
      fetchSheetData();
    } else {
      alert('請先在設定中輸入 Google Sheet 共用網址與 GID。目前正在使用 Demo 模擬數據。');
      loadMockData();
    }
  });

  // 1. 篩選：切換家庭成員
  document.getElementById('filter-member').addEventListener('change', (e) => {
    state.filterMember = e.target.value;
    processAndRenderData();
  });

  // 2. 篩選：切換檢討週期 (月度/年度)
  document.getElementById('filter-cycle').addEventListener('change', (e) => {
    state.reviewCycle = e.target.value;
    populatePeriodFilter(); // 重建時間下拉選單
    processAndRenderData();
  });

  // 3. 篩選：切換時間區間
  document.getElementById('filter-period').addEventListener('change', (e) => {
    state.filterPeriod = e.target.value;
    processAndRenderData();
  });

  // 圓餅圖 類別、成員與來源切換
  document.getElementById('btn-chart-by-category').addEventListener('click', () => {
    state.chartDistributionMode = 'category';
    document.getElementById('btn-chart-by-category').classList.add('active');
    document.getElementById('btn-chart-by-member').classList.remove('active');
    document.getElementById('btn-chart-by-source').classList.remove('active');
    document.getElementById('distribution-chart-title').innerText = '支出類別佔比';
    renderCategoryChart();
  });

  document.getElementById('btn-chart-by-member').addEventListener('click', () => {
    state.chartDistributionMode = 'member';
    document.getElementById('btn-chart-by-category').classList.remove('active');
    document.getElementById('btn-chart-by-member').classList.add('active');
    document.getElementById('btn-chart-by-source').classList.remove('active');
    document.getElementById('distribution-chart-title').innerText = '家庭成員支出佔比';
    renderCategoryChart();
  });

  document.getElementById('btn-chart-by-source').addEventListener('click', () => {
    state.chartDistributionMode = 'source';
    document.getElementById('btn-chart-by-category').classList.remove('active');
    document.getElementById('btn-chart-by-member').classList.remove('active');
    document.getElementById('btn-chart-by-source').classList.add('active');
    document.getElementById('distribution-chart-title').innerText = '家庭收入來源佔比';
    renderCategoryChart();
  });

  // 表格搜尋與過濾
  document.getElementById('table-search').addEventListener('input', (e) => {
    state.tableFilters.searchQuery = e.target.value.toLowerCase().trim();
    state.pagination.currentPage = 1;
    renderTransactionsTable();
  });

  document.getElementById('filter-table-member').addEventListener('change', (e) => {
    state.tableFilters.member = e.target.value;
    state.pagination.currentPage = 1;
    renderTransactionsTable();
  });

  document.getElementById('filter-table-type').addEventListener('change', (e) => {
    state.tableFilters.type = e.target.value;
    state.pagination.currentPage = 1;
    renderTransactionsTable();
  });

  document.getElementById('filter-table-category').addEventListener('change', (e) => {
    state.tableFilters.category = e.target.value;
    state.pagination.currentPage = 1;
    renderTransactionsTable();
  });

  document.getElementById('btn-export-csv').addEventListener('click', exportToCSV);

  // 表格分頁
  document.getElementById('btn-pag-prev').addEventListener('click', () => {
    if (state.pagination.currentPage > 1) {
      state.pagination.currentPage--;
      renderTransactionsTable();
    }
  });

  document.getElementById('btn-pag-next').addEventListener('click', () => {
    const totalPages = Math.ceil(getFilteredAndSearchedTransactions().length / state.pagination.pageSize);
    if (state.pagination.currentPage < totalPages) {
      state.pagination.currentPage++;
      renderTransactionsTable();
    }
  });

  // 設定頁面：記帳模式切換
  document.querySelectorAll('input[name="setting-sheet-mode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      state.sheetMode = e.target.value;
      updateSettingsFormLayout();
    });
  });

  // Modal 頁面：記帳模式切換
  document.querySelectorAll('input[name="modal-sheet-mode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      updateModalFormLayout(e.target.value);
    });
  });

  // 設定頁面：儲存連線與 GID
  document.getElementById('btn-save-settings').addEventListener('click', saveConnectionSettings);
  document.getElementById('btn-load-mock').addEventListener('click', () => {
    loadMockData();
    switchTab('dashboard');
  });

  // 設定頁面：儲存欄位對應
  document.getElementById('btn-save-mapping').addEventListener('click', saveMappingSettings);
  document.getElementById('btn-save-budget').addEventListener('click', saveBudgetSettings);

  // 複製共享連結按鈕
  document.getElementById('btn-copy-share-link').addEventListener('click', () => {
    const shareLinkInput = document.getElementById('input-share-link');
    if (!shareLinkInput || !shareLinkInput.value) {
      alert('尚無共享連結可供複製！');
      return;
    }
    
    // 使用 modern clipboard API 複製，若失敗或不支援則使用 fallback 做法
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(shareLinkInput.value)
        .then(() => {
          alert('共享連結已複製到剪貼簿，您可以直接傳送給其他家庭成員！');
        })
        .catch(err => {
          console.error('複製失敗', err);
          fallbackCopyText(shareLinkInput);
        });
    } else {
      fallbackCopyText(shareLinkInput);
    }
  });

  // 密碼安全鎖設定勾選切換
  document.getElementById('setting-use-password').addEventListener('change', (e) => {
    const checked = e.target.checked;
    document.getElementById('password-input-group').style.display = checked ? 'block' : 'none';
    state.usePassword = checked;
    saveSettingsToStorage();
  });

  // 密碼輸入框變動
  document.getElementById('setting-lock-password').addEventListener('input', (e) => {
    state.lockPassword = e.target.value;
    saveSettingsToStorage();
  });

  // 解鎖按鈕點擊
  document.getElementById('btn-unlock-dashboard').addEventListener('click', () => {
    const pwdInput = document.getElementById('input-lock-password');
    const pwd = pwdInput ? pwdInput.value.trim() : '';
    if (!pwd) {
      alert('請輸入解鎖密碼！');
      return;
    }
    
    // 呼叫解鎖邏輯
    if (unlockDashboard(pwd)) {
      pwdInput.value = '';
    }
  });

  // 密碼輸入框按 Enter 鍵解鎖
  document.getElementById('input-lock-password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const pwd = e.target.value.trim();
      if (!pwd) return;
      if (unlockDashboard(pwd)) {
        e.target.value = '';
      }
    }
  });

  // 管理員登入點擊
  const adminLoginBtn = document.getElementById('btn-admin-login');
  if (adminLoginBtn) {
    adminLoginBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (!state.usePassword || !state.lockPassword) {
        alert('尚未設定解鎖密碼，請先由管理員在主控裝置設定密碼鎖以啟用管理員登入。');
        return;
      }
      
      const pwd = prompt('請輸入管理員解鎖密碼：');
      if (pwd === null) return; // 使用者按取消
      
      if (pwd === state.lockPassword) {
        state.isAdmin = true;
        saveSettingsToStorage();
        applyAdminAccess();
        alert('管理員登入成功！已開啟資料設定權限。');
      } else {
        alert('密碼錯誤！無法開啟管理權限。');
      }
    });
  }

  // Modal 按鈕
  document.getElementById('modal-btn-demo').addEventListener('click', () => {
    loadMockData();
    closeConfigModal();
  });

  document.getElementById('modal-btn-connect').addEventListener('click', () => {
    const url = document.getElementById('modal-input-url').value.trim();
    if (!url) {
      showModalError('請貼上正確的 Google Sheet 共用網址！');
      return;
    }
    
    // 讀取 Modal 內的使用者輸入，同步回 state
    state.sheetUrl = url;
    
    const modeVal = document.querySelector('input[name="modal-sheet-mode"]:checked').value;
    state.sheetMode = modeVal;
    
    state.expenseGid = document.getElementById('modal-input-expense-gid').value.trim() || '0';
    state.incomeGid = document.getElementById('modal-input-income-gid').value.trim();
    state.singleGid = document.getElementById('modal-input-single-gid').value.trim() || '0';
    
    // 同步到「資料設定」分頁表單以保持一致
    document.getElementById('input-sheet-url').value = state.sheetUrl;
    document.getElementById('input-expense-gid').value = state.expenseGid;
    document.getElementById('input-income-gid').value = state.incomeGid;
    document.getElementById('input-single-gid').value = state.singleGid;
    
    const settingsRadio = document.querySelector(`input[name="setting-sheet-mode"][value="${state.sheetMode}"]`);
    if (settingsRadio) settingsRadio.checked = true;

    updateSettingsFormLayout();
    saveSettingsToStorage();
    
    // 發起抓取，並傳入 fromModal = true
    fetchSheetData(true);
  });
}

// 切換 Tab
function switchTab(tabId) {
  document.querySelectorAll('.nav-item').forEach(item => {
    if (item.getAttribute('data-tab') === tabId) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  document.querySelectorAll('.tab-content').forEach(content => {
    if (content.id === `tab-${tabId}`) {
      content.classList.add('active');
    } else {
      content.classList.remove('active');
    }
  });

  const titles = {
    dashboard: { main: '樂肉家記帳決策儀表板', sub: '實時自動分類，追蹤全年度與月度的家庭收支' },
    transactions: { main: '歷史收支明細', sub: '搜尋、篩選與分析家庭所有的收支帳目' },
    settings: { main: '資料與分頁設定', sub: '管理 Google Sheet 連線、分頁 GID 及設定成員欄位' }
  };

  if (titles[tabId]) {
    document.getElementById('page-title').innerText = titles[tabId].main;
    document.getElementById('page-subtitle').innerText = titles[tabId].sub;
  }
}

// 根據 sheetMode 更新設定介面
function updateSettingsFormLayout() {
  const isSeparate = state.sheetMode === 'separate';
  
  // 更新 GID 輸入框顯示
  document.getElementById('container-expense-gid').style.display = isSeparate ? 'block' : 'none';
  document.getElementById('container-income-gid').style.display = isSeparate ? 'block' : 'none';
  document.getElementById('container-single-gid').style.display = isSeparate ? 'none' : 'block';
  
  // 更新欄位對應欄位區塊顯示
  const separateSection = document.getElementById('mapping-separate-section');
  const combinedSection = document.getElementById('mapping-combined-section');
  if (separateSection) separateSection.style.display = isSeparate ? 'block' : 'none';
  if (combinedSection) combinedSection.style.display = isSeparate ? 'none' : 'block';
}

// 根據模式更新 Modal 內部的 GID 輸入框顯示
function updateModalFormLayout(mode) {
  const isSeparate = mode === 'separate';
  document.getElementById('modal-container-expense-gid').style.display = isSeparate ? 'block' : 'none';
  document.getElementById('modal-container-income-gid').style.display = isSeparate ? 'block' : 'none';
  document.getElementById('modal-container-single-gid').style.display = isSeparate ? 'none' : 'block';
}

// 4. 連線設定與 LocalStorage
function loadSettingsFromStorage() {
  const savedConfig = localStorage.getItem('finance_lerou_auto_config');
  if (savedConfig) {
    try {
      const config = JSON.parse(savedConfig);
      state.sheetUrl = config.sheetUrl || '';
      state.sheetMode = config.sheetMode || 'separate';
      state.expenseGid = config.expenseGid || '0';
      state.incomeGid = config.incomeGid || '';
      state.singleGid = config.singleGid || '0';
      
      if (config.mapping) {
        if (config.mapping.expense && config.mapping.income && config.mapping.combined) {
          state.mapping = config.mapping;
          if (!state.mapping.income.source) state.mapping.income.source = '';
          if (!state.mapping.combined.source) state.mapping.combined.source = '';
        } else {
          // 舊格式相容處理
          const old = config.mapping;
          state.mapping = {
            expense: {
              date: old.date || '',
              member: old.member || '',
              category: old.category || '',
              amount: old.amount || '',
              remark: old.remark || ''
            },
            income: {
              date: old.date || '',
              member: old.member || '',
              category: old.category || '',
              source: '',
              amount: old.amount || '',
              remark: old.remark || ''
            },
            combined: {
              date: old.date || '',
              member: old.member || '',
              category: old.category || '',
              source: '',
              amount: old.amount || '',
              remark: old.remark || '',
              type: old.type || ''
            }
          };
        }
      }
      state.matchExpense = config.matchExpense || '支出';
      state.matchIncome = config.matchIncome || '收入';
      state.monthlyBudget = Number(config.monthlyBudget) || 35000;
      state.annualSavingsGoal = Number(config.annualSavingsGoal) || 200000;
      
      // 載入密碼鎖設定
      state.usePassword = !!config.usePassword;
      state.lockPassword = config.lockPassword || '';
      
      // 載入管理員權限
      state.isAdmin = config.isAdmin !== false;
      
      // 同步 Radio
      const radio = document.querySelector(`input[name="setting-sheet-mode"][value="${state.sheetMode}"]`);
      if (radio) radio.checked = true;

      // 同步輸入框
      document.getElementById('input-sheet-url').value = state.sheetUrl;
      document.getElementById('input-expense-gid').value = state.expenseGid;
      document.getElementById('input-income-gid').value = state.incomeGid;
      document.getElementById('input-single-gid').value = state.singleGid;
      
      document.getElementById('setting-monthly-budget').value = state.monthlyBudget;
      document.getElementById('setting-annual-savings').value = state.annualSavingsGoal;
      document.getElementById('val-match-expense').value = state.matchExpense;
      document.getElementById('val-match-income').value = state.matchIncome;

      // 同步密碼鎖 UI
      const chk = document.getElementById('setting-use-password');
      if (chk) chk.checked = state.usePassword;
      const pwdInput = document.getElementById('setting-lock-password');
      if (pwdInput) pwdInput.value = state.lockPassword;
      const pwdGroup = document.getElementById('password-input-group');
      if (pwdGroup) pwdGroup.style.display = state.usePassword ? 'block' : 'none';

      // 檢查此 Session 是否已解鎖過
      if (state.usePassword && sessionStorage.getItem('dashboard_session_unlocked') !== 'true') {
        state.isLocked = true;
        document.getElementById('password-lock-overlay').style.display = 'flex';
      }

      applyAdminAccess();
      updateSettingsFormLayout();
    } catch (e) {
      console.error('解析儲存的設定失敗', e);
    }
  } else {
    // 預設 Demo 設定
    state.sheetMode = 'separate';
    state.expenseGid = '0';
    state.incomeGid = '112233';
    updateSettingsFormLayout();
  }
}

function saveSettingsToStorage() {
  const config = {
    sheetUrl: state.sheetUrl,
    sheetMode: state.sheetMode,
    expenseGid: state.expenseGid,
    incomeGid: state.incomeGid,
    singleGid: state.singleGid,
    mapping: state.mapping,
    matchExpense: state.matchExpense,
    matchIncome: state.matchIncome,
    monthlyBudget: state.monthlyBudget,
    annualSavingsGoal: state.annualSavingsGoal,
    usePassword: state.usePassword,
    lockPassword: state.lockPassword,
    isAdmin: state.isAdmin
  };
  localStorage.setItem('finance_lerou_auto_config', JSON.stringify(config));
  generateShareLink();
}

function compressConfig(config) {
  const sheetId = extractSpreadsheetId(config.sheetUrl) || config.sheetUrl;
  return {
    u: sheetId,
    m: config.sheetMode === 'separate' ? 's' : 'c',
    eg: config.expenseGid || '0',
    ig: config.incomeGid || '',
    sg: config.singleGid || '0',
    me: config.matchExpense || '支出',
    mi: config.matchIncome || '收入',
    mb: config.monthlyBudget || 35000,
    as: config.annualSavingsGoal || 200000,
    ad: !!config.isAdmin,
    mp: {
      e: config.mapping && config.mapping.expense ? {
        d: config.mapping.expense.date || '',
        m: config.mapping.expense.member || '',
        c: config.mapping.expense.category || '',
        a: config.mapping.expense.amount || '',
        r: config.mapping.expense.remark || ''
      } : {},
      i: config.mapping && config.mapping.income ? {
        d: config.mapping.income.date || '',
        m: config.mapping.income.member || '',
        c: config.mapping.income.category || '',
        s: config.mapping.income.source || '',
        a: config.mapping.income.amount || '',
        r: config.mapping.income.remark || ''
      } : {},
      cb: config.mapping && config.mapping.combined ? {
        d: config.mapping.combined.date || '',
        m: config.mapping.combined.member || '',
        c: config.mapping.combined.category || '',
        s: config.mapping.combined.source || '',
        a: config.mapping.combined.amount || '',
        r: config.mapping.combined.remark || '',
        t: config.mapping.combined.type || ''
      } : {}
    }
  };
}

function decompressConfig(short) {
  let url = short.u || '';
  if (url && url.indexOf('/') === -1 && url.length > 20) {
    url = `https://docs.google.com/spreadsheets/d/${url}/edit`;
  }
  return {
    sheetUrl: url,
    sheetMode: short.m === 's' ? 'separate' : 'combined',
    expenseGid: short.eg || '0',
    incomeGid: short.ig || '',
    singleGid: short.sg || '0',
    matchExpense: short.me || '支出',
    matchIncome: short.mi || '收入',
    monthlyBudget: Number(short.mb) || 35000,
    annualSavingsGoal: Number(short.as) || 200000,
    isAdmin: short.ad !== false,
    mapping: {
      expense: short.mp && short.mp.e ? {
        date: short.mp.e.d || '',
        member: short.mp.e.m || '',
        category: short.mp.e.c || '',
        amount: short.mp.e.a || '',
        remark: short.mp.e.r || ''
      } : {},
      income: short.mp && short.mp.i ? {
        date: short.mp.i.d || '',
        member: short.mp.i.m || '',
        category: short.mp.i.c || '',
        source: short.mp.i.s || '',
        amount: short.mp.i.a || '',
        remark: short.mp.i.r || ''
      } : {},
      combined: short.mp && short.mp.cb ? {
        date: short.mp.cb.d || '',
        member: short.mp.cb.m || '',
        category: short.mp.cb.c || '',
        source: short.mp.cb.s || '',
        amount: short.mp.cb.a || '',
        remark: short.mp.cb.r || '',
        type: short.mp.cb.t || ''
      } : {}
    }
  };
}

function generateShareLink() {
  const config = {
    sheetUrl: state.sheetUrl,
    sheetMode: state.sheetMode,
    expenseGid: state.expenseGid,
    incomeGid: state.incomeGid,
    singleGid: state.singleGid,
    mapping: state.mapping,
    matchExpense: state.matchExpense,
    matchIncome: state.matchIncome,
    monthlyBudget: state.monthlyBudget,
    annualSavingsGoal: state.annualSavingsGoal,
    isAdmin: false // 共享給家人的連結預設為唯讀模式（隱藏資料設定）
  };
  try {
    const compressed = compressConfig(config);
    const jsonStr = JSON.stringify(compressed);
    const baseUrl = window.location.href.split('?')[0].split('#')[0];
    let shareUrl = '';
    
    if (state.usePassword && state.lockPassword) {
      // 使用 CryptoJS AES 加密配置，密碼即為金鑰
      const ciphertext = CryptoJS.AES.encrypt(jsonStr, state.lockPassword).toString();
      shareUrl = `${baseUrl}?encrypted=${encodeURIComponent(ciphertext)}`;
    } else {
      // 未啟用密碼鎖，直接使用相容 UTF-8 的 Base64
      const base64 = btoa(encodeURIComponent(jsonStr).replace(/%([0-9A-F]{2})/g, (match, p1) => String.fromCharCode(parseInt(p1, 16))));
      shareUrl = `${baseUrl}?config=${base64}`;
    }
    
    const input = document.getElementById('input-share-link');
    if (input) {
      input.value = shareUrl;
    }
  } catch (e) {
    console.error('產生分享連結失敗', e);
  }
}

function parseSharedUrlConfig() {
  const urlParams = new URLSearchParams(window.location.search);
  const configParam = urlParams.get('config');
  const encryptedParam = urlParams.get('encrypted');
  const baseUrl = window.location.href.split('?')[0].split('#')[0];

  if (configParam) {
    try {
      // 解碼相容 UTF-8 的 Base64 字串
      const jsonStr = decodeURIComponent(atob(configParam).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
      const short = JSON.parse(jsonStr);
      const config = decompressConfig(short);
      if (config && config.sheetUrl) {
        localStorage.setItem('finance_lerou_auto_config', JSON.stringify(config));
        window.history.replaceState({}, document.title, baseUrl);
        return true;
      }
    } catch (e) {
      console.error('解析共享網址參數失敗', e);
    }
  } else if (encryptedParam) {
    // 偵測到加密的共享設定，先鎖定頁面，儲存密文待使用者輸入密碼後解密
    state.isLocked = true;
    state.encryptedConfig = decodeURIComponent(encryptedParam);
    
    // 顯示密碼鎖定畫面
    const overlay = document.getElementById('password-lock-overlay');
    if (overlay) overlay.style.display = 'flex';
    
    // 清除網址列參數避免重整覆蓋
    window.history.replaceState({}, document.title, baseUrl);
    return true;
  }
  return false;
}

function fallbackCopyText(inputElement) {
  inputElement.select();
  inputElement.setSelectionRange(0, 99999); // 針對行動裝置 (如 iPhone)
  try {
    const successful = document.execCommand('copy');
    if (successful) {
      alert('共享連結已複製到剪貼簿，您可以直接傳送給其他家庭成員！');
    } else {
      alert('複製失敗，請手動複製欄位中的網址。');
    }
  } catch (err) {
    alert('複製失敗，請手動複製欄位中的網址。');
  }
}

function unlockDashboard(password) {
  const errDiv = document.getElementById('lock-error-msg');
  if (errDiv) errDiv.style.display = 'none';

  if (state.encryptedConfig) {
    // 情況 A：開啟帶有加密的共享網址，嘗試解密
    try {
      const bytes = CryptoJS.AES.decrypt(state.encryptedConfig, password);
      const decryptedText = bytes.toString(CryptoJS.enc.Utf8);
      if (!decryptedText) throw new Error('解密失敗，密碼錯誤');
      
      const short = JSON.parse(decryptedText);
      const config = decompressConfig(short);
      if (config && config.sheetUrl) {
        // 解密成功！將配置與密碼寫入本機 LocalStorage，以便下次自動讀取
        config.usePassword = true;
        config.lockPassword = password;
        localStorage.setItem('finance_lerou_auto_config', JSON.stringify(config));
        
        // 標記此 Session 已解鎖
        sessionStorage.setItem('dashboard_session_unlocked', 'true');
        
        state.isLocked = false;
        state.encryptedConfig = '';
        
        // 載入配置並抓取資料
        loadSettingsFromStorage();
        document.getElementById('password-lock-overlay').style.display = 'none';
        
        if (state.sheetUrl) {
          fetchSheetData();
        } else {
          loadMockData();
        }
        return true;
      }
    } catch (e) {
      console.error('解密失敗', e);
      if (errDiv) errDiv.style.display = 'block';
      return false;
    }
  } else {
    // 情況 B：本機已經儲存密碼設定，比對密碼
    if (password === state.lockPassword) {
      // 密碼正確
      sessionStorage.setItem('dashboard_session_unlocked', 'true');
      state.isLocked = false;
      document.getElementById('password-lock-overlay').style.display = 'none';
      
      if (state.sheetUrl) {
        fetchSheetData();
      } else {
        loadMockData();
      }
      return true;
    } else {
      if (errDiv) errDiv.style.display = 'block';
      return false;
    }
  }
}

function applyAdminAccess() {
  const settingsTab = document.querySelector('.nav-item[data-tab="settings"]');
  const connectBtn = document.getElementById('btn-open-config');
  const adminLogin = document.getElementById('btn-admin-login');
  
  if (state.isAdmin) {
    if (settingsTab) settingsTab.style.display = 'flex';
    if (connectBtn) connectBtn.style.display = 'inline-flex';
    if (adminLogin) adminLogin.style.display = 'none';
  } else {
    if (settingsTab) settingsTab.style.display = 'none';
    if (connectBtn) connectBtn.style.display = 'none';
    if (adminLogin) adminLogin.style.display = 'flex';
    
    // 如果當前在設定頁面，強制切換回儀表板
    const activeTab = document.querySelector('.nav-item.active');
    if (activeTab && activeTab.getAttribute('data-tab') === 'settings') {
      switchTab('dashboard');
    }
  }
}

// 5. 抓取 Google Sheet 資料 (Google Sheets Parser)
function fetchSheetData(fromModal = false) {
  const sheetId = extractSpreadsheetId(state.sheetUrl);
  if (!sheetId) {
    updateSyncStatus('offline', '無效的 Sheet 網址');
    if (fromModal) showModalError('試算表網址解析失敗，請確認網址格式！');
    return;
  }

  updateSyncStatus('loading', '同步資料中...');

  // 顯示讀取中狀態於主要數據卡片，讓使用者知道正在自動同步
  const incCard = document.getElementById('stat-total-income');
  const expCard = document.getElementById('stat-total-expense');
  const balCard = document.getElementById('stat-total-balance');
  if (incCard) incCard.innerText = '讀取中...';
  if (expCard) expCard.innerText = '讀取中...';
  if (balCard) balCard.innerText = '讀取中...';

  if (state.sheetMode === 'separate') {
    // 獨立分頁模式：同時拉取支出分頁與收入分頁
    const expenseGid = state.expenseGid || '0';
    const incomeGid = state.incomeGid;

    if (!incomeGid) {
      updateSyncStatus('offline', '請先於資料設定中填入「收入分頁 GID」');
      if (fromModal) showModalError('請確認您已填寫「收入分頁 GID」！');
      return;
    }

    const expenseUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${expenseGid}`;
    const incomeUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${incomeGid}`;

    Promise.all([
      fetch(expenseUrl).then(r => {
        if (!r.ok) throw new Error('支出分頁下載失敗');
        return r.text();
      }),
      fetch(incomeUrl).then(r => {
        if (!r.ok) throw new Error('收入分頁下載失敗');
        return r.text();
      })
    ])
    .then(([expenseCsv, incomeCsv]) => {
      Papa.parse(expenseCsv, {
        header: true,
        skipEmptyLines: true,
        complete: function(expResults) {
          Papa.parse(incomeCsv, {
            header: true,
            skipEmptyLines: true,
            complete: function(incResults) {
              state.rawExpenses = expResults.data;
              state.rawIncomes = incResults.data;
              
              const expCols = Object.keys(expResults.data[0] || {});
              const incCols = Object.keys(incResults.data[0] || {});
              state.columns = Array.from(new Set([...expCols, ...incCols]));
              state.expenseColumns = expCols;
              state.incomeColumns = incCols;

              autoDetectMapping();
              renderMappingSelectors();
              
              document.getElementById('mapping-card').style.display = 'block';
              updateSyncStatus('online', '已連結 Google Sheet');
              
              if (fromModal) {
                closeConfigModal();
                switchTab('settings');
                document.getElementById('mapping-card').scrollIntoView({ behavior: 'smooth' });
              }

              applyMappingAndProcess();
            }
          });
        }
      });
    })
    .catch(error => {
      console.error(error);
      updateSyncStatus('offline', '資料讀取失敗');
      if (fromModal) {
        showModalError('讀取失敗！請確認您的 Google Sheet 已開啟「知道連結的任何人」公開檢視。');
      } else {
        alert('同步失敗，請檢查 GID 是否填寫正確且已公開檢視。已為您先載入 Demo 數據！');
        loadMockData();
      }
    });

  } else {
    // 單一分頁模式：僅拉取單一 GID
    const singleGid = state.singleGid || '0';
    const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${singleGid}`;
    
    fetch(csvUrl)
      .then(response => {
        if (!response.ok) throw new Error('網頁回應錯誤');
        return response.text();
      })
      .then(csvText => {
        Papa.parse(csvText, {
          header: true,
          skipEmptyLines: true,
          complete: function(results) {
            state.rawTransactions = results.data;
            state.columns = Object.keys(results.data[0] || {});
            
            autoDetectMapping();
            renderMappingSelectors();
            
            document.getElementById('mapping-card').style.display = 'block';
            updateSyncStatus('online', '已連結 Google Sheet');
            
            if (fromModal) {
              closeConfigModal();
              switchTab('settings');
              document.getElementById('mapping-card').scrollIntoView({ behavior: 'smooth' });
            }

            applyMappingAndProcess();
          }
        });
      })
      .catch(error => {
        console.error(error);
        updateSyncStatus('offline', '讀取失敗');
        alert('單一分頁模式讀取失敗，請確認已開放公開檢視！已載入 Demo。');
        loadMockData();
      });
  }
}

// 自動偵測對應欄位
function autoDetectMapping() {
  const expCols = state.expenseColumns || state.columns || [];
  const incCols = state.incomeColumns || state.columns || [];
  const combCols = state.columns || [];
  
  const dateKeywords = ['時間', '日期', 'timestamp', 'date', 'time', '時間戳記', '日期戳記', '搓劑'];
  const memberKeywords = ['人員', '成員', '姓名', '填寫人', '記帳人', 'member', 'person', 'name', 'who', 'user', '記帳人員'];
  const typeKeywords = ['收支', '類型', '種類', 'type', '分類', '收支類型', '項目類型'];
  const categoryKeywords = ['類別', '主類別', 'category', '分類', '項目類別', '消費類別', '消費項目'];
  const sourceKeywords = ['來源', '收入來源', '來源類別', 'source', 'from'];
  const amountKeywords = ['金額', '錢', '金額(元)', 'amount', 'price', '數值', '花費'];
  const remarkKeywords = ['備註', '項目', '細項', '備忘', '說明', 'remark', 'details', '名稱'];

  const findMatch = (keywords, colList) => {
    return colList.find(col => {
      const lower = col.toLowerCase();
      return keywords.some(kw => lower.includes(kw));
    }) || colList[0] || '';
  };

  // 1. 偵測支出欄位對應
  ['date', 'member', 'category', 'amount', 'remark'].forEach(field => {
    if (state.mapping.expense[field] && expCols.includes(state.mapping.expense[field])) {
      // 保持原設定
    } else {
      if (field === 'date') state.mapping.expense.date = findMatch(dateKeywords, expCols);
      else if (field === 'member') state.mapping.expense.member = findMatch(memberKeywords, expCols);
      else if (field === 'category') state.mapping.expense.category = findMatch(categoryKeywords, expCols);
      else if (field === 'amount') state.mapping.expense.amount = findMatch(amountKeywords, expCols);
      else if (field === 'remark') state.mapping.expense.remark = findMatch(remarkKeywords, expCols);
    }
  });

  // 2. 偵測收入欄位對應
  ['date', 'member', 'category', 'source', 'amount', 'remark'].forEach(field => {
    if (state.mapping.income[field] && incCols.includes(state.mapping.income[field])) {
      // 保持原設定
    } else {
      if (field === 'date') state.mapping.income.date = findMatch(dateKeywords, incCols);
      else if (field === 'member') state.mapping.income.member = findMatch(memberKeywords, incCols);
      else if (field === 'category') state.mapping.income.category = findMatch(categoryKeywords, incCols);
      else if (field === 'source') state.mapping.income.source = findMatch(sourceKeywords, incCols) || findMatch(categoryKeywords, incCols);
      else if (field === 'amount') state.mapping.income.amount = findMatch(amountKeywords, incCols);
      else if (field === 'remark') state.mapping.income.remark = findMatch(remarkKeywords, incCols);
    }
  });

  // 3. 偵測合併欄位對應
  ['date', 'member', 'category', 'source', 'amount', 'remark', 'type'].forEach(field => {
    if (state.mapping.combined[field] && combCols.includes(state.mapping.combined[field])) {
      // 保持原設定
    } else {
      if (field === 'date') state.mapping.combined.date = findMatch(dateKeywords, combCols);
      else if (field === 'member') state.mapping.combined.member = findMatch(memberKeywords, combCols);
      else if (field === 'category') state.mapping.combined.category = findMatch(categoryKeywords, combCols);
      else if (field === 'source') state.mapping.combined.source = findMatch(sourceKeywords, combCols) || findMatch(categoryKeywords, combCols);
      else if (field === 'amount') state.mapping.combined.amount = findMatch(amountKeywords, combCols);
      else if (field === 'remark') state.mapping.combined.remark = findMatch(remarkKeywords, combCols);
      else if (field === 'type') state.mapping.combined.type = findMatch(typeKeywords, combCols);
    }
  });
}

// 渲染欄位下拉表單
function renderMappingSelectors() {
  const expCols = state.expenseColumns || state.columns || [];
  const incCols = state.incomeColumns || state.columns || [];
  const combCols = state.columns || [];

  const populateSelect = (elementId, columns, selectedValue) => {
    const select = document.getElementById(elementId);
    if (!select) return;
    select.innerHTML = '';
    columns.forEach(col => {
      const opt = document.createElement('option');
      opt.value = col;
      opt.text = col;
      if (col === selectedValue) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });
  };

  // 渲染支出
  populateSelect('map-exp-date', expCols, state.mapping.expense.date);
  populateSelect('map-exp-member', expCols, state.mapping.expense.member);
  populateSelect('map-exp-category', expCols, state.mapping.expense.category);
  populateSelect('map-exp-amount', expCols, state.mapping.expense.amount);
  populateSelect('map-exp-remark', expCols, state.mapping.expense.remark);

  // 渲染收入
  populateSelect('map-inc-date', incCols, state.mapping.income.date);
  populateSelect('map-inc-member', incCols, state.mapping.income.member);
  populateSelect('map-inc-category', incCols, state.mapping.income.category);
  populateSelect('map-inc-source', incCols, state.mapping.income.source);
  populateSelect('map-inc-amount', incCols, state.mapping.income.amount);
  populateSelect('map-inc-remark', incCols, state.mapping.income.remark);

  // 渲染合併
  populateSelect('map-comb-date', combCols, state.mapping.combined.date);
  populateSelect('map-comb-member', combCols, state.mapping.combined.member);
  populateSelect('map-comb-category', combCols, state.mapping.combined.category);
  populateSelect('map-comb-source', combCols, state.mapping.combined.source);
  populateSelect('map-comb-amount', combCols, state.mapping.combined.amount);
  populateSelect('map-comb-remark', combCols, state.mapping.combined.remark);
  populateSelect('map-comb-type', combCols, state.mapping.combined.type);
}

// 6. 資料處理邏輯 (Data Processing)
function applyMappingAndProcess() {
  let mapped = [];

  // 清洗日期格式
  const cleanDateString = (rawDate) => {
    let dStr = String(rawDate).trim();
    if (!dStr) return '';
    
    // 處理 "2026/6/10 下午 3:15:30" 格式，拿前段日期
    if (dStr.includes(' ')) {
      dStr = dStr.split(' ')[0];
    }
    
    // 把斜線 "/" 轉換為 "-"，並補零 (例如 2026/6/5 -> 2026-06-05)
    if (dStr.includes('/')) {
      const parts = dStr.split('/');
      if (parts.length === 3) {
        const y = parts[0];
        const m = parts[1].padStart(2, '0');
        const d = parts[2].padStart(2, '0');
        dStr = `${y}-${m}-${d}`;
      }
    }
    return dStr;
  };

  // 清洗金額
  const cleanAmountValue = (rawAmt) => {
    if (!rawAmt) return 0;
    return Math.abs(parseFloat(String(rawAmt).replace(/[^\d.-]/g, ''))) || 0;
  };

  if (state.sheetMode === 'separate') {
    // 獨立分頁模式下：分別使用各自的對應設定自動標記
    const mappedExpenses = state.rawExpenses.map(raw => {
      return {
        date: cleanDateString(raw[state.mapping.expense.date]),
        member: String(raw[state.mapping.expense.member] || '未指定').trim() || '未指定',
        type: '支出',
        category: String(raw[state.mapping.expense.category] || '其他').trim() || '其他',
        source: '',
        amount: cleanAmountValue(raw[state.mapping.expense.amount]),
        remark: String(raw[state.mapping.expense.remark] || '').trim()
      };
    });

    const mappedIncomes = state.rawIncomes.map(raw => {
      return {
        date: cleanDateString(raw[state.mapping.income.date]),
        member: String(raw[state.mapping.income.member] || '未指定').trim() || '未指定',
        type: '收入',
        category: String(raw[state.mapping.income.category] || '其他').trim() || '其他',
        source: String(raw[state.mapping.income.source] || '').trim() || String(raw[state.mapping.income.category] || '其他').trim(),
        amount: cleanAmountValue(raw[state.mapping.income.amount]),
        remark: String(raw[state.mapping.income.remark] || '').trim()
      };
    });

    mapped = [...mappedExpenses, ...mappedIncomes];

  } else {
    // 單一分頁模式下：根據欄位類型過濾
    mapped = state.rawTransactions.map(raw => {
      const rawType = String(raw[state.mapping.combined.type] || '');
      let type = '支出';
      if (rawType.includes(state.matchIncome) || rawType === '收入' || rawType.toLowerCase() === 'income') {
        type = '收入';
      } else if (rawType.includes(state.matchExpense) || rawType === '支出' || rawType.toLowerCase() === 'expense') {
        type = '支出';
      } else {
        type = rawType.includes('入') ? '收入' : '支出';
      }

      return {
        date: cleanDateString(raw[state.mapping.combined.date]),
        member: String(raw[state.mapping.combined.member] || '未指定').trim() || '未指定',
        type: type,
        category: String(raw[state.mapping.combined.category] || '其他').trim() || '其他',
        source: type === '收入' ? (String(raw[state.mapping.combined.source] || '').trim() || String(raw[state.mapping.combined.category] || '其他').trim()) : '',
        amount: cleanAmountValue(raw[state.mapping.combined.amount]),
        remark: String(raw[state.mapping.combined.remark] || '').trim()
      };
    });
  }

  // 過濾無效資料
  state.mappedTransactions = mapped.filter(t => t.date && !isNaN(t.amount) && t.amount > 0);
  
  // 依時間從新到舊排序
  state.mappedTransactions.sort((a, b) => new Date(b.date) - new Date(a.date));

  // 分析家庭成員
  const membersSet = new Set();
  state.mappedTransactions.forEach(t => {
    if (t.member) membersSet.add(t.member);
  });
  state.availableMembers = Array.from(membersSet).sort();

  // 重置時間篩選器 (從所有合併後的資料中「自動提取」所有出現過的年度與月份)
  populatePeriodFilter();

  processAndRenderData();
}

// 主渲染調度
function processAndRenderData() {
  populateMemberFilters();
  populateCategoryFilter();

  calculateAndRenderStats();
  renderCharts();
  renderInsightsAndBudget();
  renderTransactionsTable();
}

// 獲取篩選後的收支資料
function getFilteredTransactions(ignoreTimeFilter = false, ignoreMemberFilter = false) {
  let list = state.mappedTransactions;

  // 時間篩選
  if (!ignoreTimeFilter && state.filterPeriod !== 'all') {
    list = list.filter(t => {
      if (state.reviewCycle === 'month') {
        return t.date.substring(0, 7) === state.filterPeriod; // 月度 YYYY-MM
      } else {
        return t.date.substring(0, 4) === state.filterPeriod; // 年度 YYYY
      }
    });
  }

  // 成員篩選
  if (!ignoreMemberFilter && state.filterMember !== 'all') {
    list = list.filter(t => t.member === state.filterMember);
  }

  return list;
}

// 7. UI 控制器與元件渲染

// 填充時間區間下拉選單 (支援「月度檢討」與「年度檢討」自動提取分類)
function populatePeriodFilter() {
  const filter = document.getElementById('filter-period');
  const currentVal = filter.value;
  
  const periodsSet = new Set();
  state.mappedTransactions.forEach(t => {
    if (t.date && t.date.length >= 7) {
      if (state.reviewCycle === 'month') {
        periodsSet.add(t.date.substring(0, 7)); // 自動提取月份 YYYY-MM
      } else {
        periodsSet.add(t.date.substring(0, 4)); // 自動提取年度 YYYY
      }
    }
  });

  const periods = Array.from(periodsSet).sort().reverse();
  filter.innerHTML = '';
  
  if (state.reviewCycle === 'month') {
    const optAll = document.createElement('option');
    optAll.value = 'all';
    optAll.text = '所有月份';
    filter.appendChild(optAll);

    periods.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p;
      const parts = p.split('-');
      opt.text = `${parts[0]}年${parts[1]}月`;
      filter.appendChild(opt);
    });
  } else {
    const optAll = document.createElement('option');
    optAll.value = 'all';
    optAll.text = '所有年度';
    filter.appendChild(optAll);

    periods.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p;
      opt.text = `${p}年全年度`;
      filter.appendChild(opt);
    });
  }

  // 嘗試還原先前選取的期間，或預設選取最新一個有資料的區間
  if (state.filterPeriod && (periods.includes(state.filterPeriod) || state.filterPeriod === 'all')) {
    filter.value = state.filterPeriod;
  } else {
    if (periods.length > 0) {
      filter.value = periods[0];
      state.filterPeriod = periods[0];
    } else {
      filter.value = 'all';
      state.filterPeriod = 'all';
    }
  }
}

// 填充所有「家庭成員」篩選清單
function populateMemberFilters() {
  const topFilter = document.getElementById('filter-member');
  const tableFilter = document.getElementById('filter-table-member');
  
  const currentTopVal = topFilter.value;
  const currentTableVal = tableFilter.value;

  // 1. 頂部篩選器
  topFilter.innerHTML = '<option value="all">所有成員</option>';
  state.availableMembers.forEach(mem => {
    const opt = document.createElement('option');
    opt.value = mem;
    opt.text = mem;
    topFilter.appendChild(opt);
  });

  if (state.availableMembers.includes(currentTopVal) || currentTopVal === 'all') {
    topFilter.value = currentTopVal;
  } else {
    state.filterMember = 'all';
  }

  // 2. 表格篩選器
  tableFilter.innerHTML = '<option value="all">所有人員</option>';
  state.availableMembers.forEach(mem => {
    const opt = document.createElement('option');
    opt.value = mem;
    opt.text = mem;
    tableFilter.appendChild(opt);
  });

  if (state.availableMembers.includes(currentTableVal) || currentTableVal === 'all') {
    tableFilter.value = currentTableVal;
  }
}

// 填充歷史明細類別/來源
function populateCategoryFilter() {
  const filter = document.getElementById('filter-table-category');
  const currentVal = filter.value;

  const categories = new Set();
  state.mappedTransactions.forEach(t => {
    if (t.category) categories.add(t.category);
    if (t.source) categories.add(t.source); // 同時加入收入來源
  });

  filter.innerHTML = '<option value="all">所有類別/來源</option>';
  Array.from(categories).sort().forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.text = cat;
    filter.appendChild(opt);
  });

  if (categories.has(currentVal) || currentVal === 'all') {
    filter.value = currentVal;
  }
}

// 計算並渲染三張數據卡片
function calculateAndRenderStats() {
  const filtered = getFilteredTransactions();
  
  let income = 0;
  let expense = 0;

  filtered.forEach(t => {
    if (t.type === '收入') income += t.amount;
    else expense += t.amount;
  });

  const balance = income - expense;
  const savingsRate = income > 0 ? ((balance / income) * 100).toFixed(0) : 0;
  const formatCurrency = (val) => 'NT$ ' + Math.round(val).toLocaleString();

  document.getElementById('stat-total-income').innerText = formatCurrency(income);
  document.getElementById('stat-total-expense').innerText = formatCurrency(expense);
  document.getElementById('stat-total-balance').innerText = formatCurrency(balance);
  document.getElementById('savings-rate-text').innerText = `儲蓄率 ${savingsRate}%`;

  // 動態更新卡片標題
  const isMonth = state.reviewCycle === 'month';
  const labelIncome = document.getElementById('label-total-income');
  const labelExpense = document.getElementById('label-total-expense');
  const labelBalance = document.getElementById('label-total-balance');
  
  if (labelIncome && labelExpense && labelBalance) {
    if (state.filterPeriod === 'all') {
      labelIncome.innerText = isMonth ? '全期總收入' : '歷年總收入';
      labelExpense.innerText = isMonth ? '全期總支出' : '歷年總支出';
      labelBalance.innerText = isMonth ? '淨儲蓄 (全期餘額)' : '淨儲蓄 (歷年餘額)';
    } else {
      labelIncome.innerText = isMonth ? '本月總收入' : '本年總收入';
      labelExpense.innerText = isMonth ? '本月總支出' : '本年總支出';
      labelBalance.innerText = isMonth ? '本月淨儲蓄' : '本年淨儲蓄';
    }
  }

  // 計算較上期的增長/減退 (前一個月或前一個年度)
  if (state.filterPeriod !== 'all') {
    let prevPeriodStr = '';
    
    if (state.reviewCycle === 'month') {
      const parts = state.filterPeriod.split('-');
      let prevYear = parseInt(parts[0]);
      let prevMonth = parseInt(parts[1]) - 1;
      if (prevMonth === 0) {
        prevMonth = 12;
        prevYear--;
      }
      prevPeriodStr = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
    } else {
      prevPeriodStr = String(parseInt(state.filterPeriod) - 1);
    }

    let prevIncome = 0;
    let prevExpense = 0;
    
    state.mappedTransactions.forEach(t => {
      if (state.filterMember !== 'all' && t.member !== state.filterMember) return;
      
      const compStr = state.reviewCycle === 'month' ? t.date.substring(0, 7) : t.date.substring(0, 4);
      if (compStr === prevPeriodStr) {
        if (t.type === '收入') prevIncome += t.amount;
        else prevExpense += t.amount;
      }
    });

    renderTrendComparison('income-change-pct', income, prevIncome);
    renderTrendComparison('expense-change-pct', expense, prevExpense);
  } else {
    // 所有時間模式下，顯示平均值
    const periodCount = document.getElementById('filter-period').options.length - 1 || 1;
    const label = state.reviewCycle === 'month' ? '月均' : '年均';
    
    document.getElementById('income-change-pct').innerHTML = `<i data-lucide="calendar"></i><span>${label} ${formatCurrency(income / periodCount)}</span>`;
    document.getElementById('expense-change-pct').innerHTML = `<i data-lucide="calendar"></i><span>${label} ${formatCurrency(expense / periodCount)}</span>`;
    lucide.createIcons();
  }
}

function renderTrendComparison(elementId, current, previous) {
  const elem = document.getElementById(elementId);
  if (previous === 0) {
    elem.className = 'trend-indicator';
    elem.innerHTML = '<span>前無對照</span>';
    return;
  }

  const diffPct = ((current - previous) / previous * 100).toFixed(0);
  const isUp = current >= previous;
  const cycleText = state.reviewCycle === 'month' ? '月' : '年';
  
  elem.className = `trend-indicator ${isUp ? 'up' : 'down'}`;
  elem.innerHTML = `
    <i data-lucide="${isUp ? 'arrow-up-right' : 'arrow-down-right'}"></i>
    <span>${Math.abs(diffPct)}% 較上${cycleText}${isUp ? '增' : '減'}</span>
  `;
  lucide.createIcons();
}

// 8. 圖表繪製與 Chart.js 配置
function renderCharts() {
  renderTrendChart();
  renderCategoryChart();
}

// 輔助函式：根據家庭成員生成獨立美觀的收支 HSL 漸層顏色對應表
function getMemberColors(members) {
  const incomeColors = {};
  const expenseColors = {};
  const n = members.length;
  if (n === 0) return { incomeColors, expenseColors };
  
  members.forEach((m, idx) => {
    // 收入色系 (Cool colors): HSL 色相自 130 (綠) 到 210 (藍) 漸進
    const incHue = n > 1 ? 130 + (idx * 80 / (n - 1)) : 145;
    const incLight = n > 1 ? 35 + (idx * 25 / (n - 1)) : 45;
    incomeColors[m] = `hsl(${incHue}, 70%, ${incLight}%)`;
    
    // 支出色系 (Warm colors): HSL 色相自 345 (玫瑰紅/粉) 到 25 (橘) 漸進
    const expHue = n > 1 ? 345 + (idx * 40 / (n - 1)) : 355;
    const cleanExpHue = expHue % 360;
    const expLight = n > 1 ? 40 + (idx * 25 / (n - 1)) : 50;
    expenseColors[m] = `hsl(${cleanExpHue}, 75%, ${expLight}%)`;
  });
  return { incomeColors, expenseColors };
}

// 收支趨勢分析柱狀圖 (年度模式下會自動按月份 1~12 月展開繪製，且以家庭成員進行堆疊，區分不同顏色)
function renderTrendChart() {
  const ctx = document.getElementById('trendChart').getContext('2d');
  const monthlyData = {};
  
  // 決定目前要繪製的成員 (若有篩選單一成員，則只看該成員；若無則顯示全體成員進行堆疊)
  const activeMembers = state.filterMember === 'all' ? state.availableMembers : [state.filterMember];
  
  // 生成各成員的固定配色，確保視覺一致性
  const { incomeColors, expenseColors } = getMemberColors(state.availableMembers);

  let months = [];

  if (state.reviewCycle === 'year' && state.filterPeriod !== 'all') {
    // 1. 年度檢討模式：畫出所選年份 1 ~ 12 月
    const targetYear = state.filterPeriod;
    document.getElementById('trend-chart-title').innerText = `${targetYear}年 1~12月家庭收支分佈`;

    for (let m = 1; m <= 12; m++) {
      const ym = `${targetYear}-${String(m).padStart(2, '0')}`;
      months.push(ym);
      monthlyData[ym] = { income: {}, expense: {} };
      activeMembers.forEach(mem => {
        monthlyData[ym].income[mem] = 0;
        monthlyData[ym].expense[mem] = 0;
      });
    }

    state.mappedTransactions.forEach(t => {
      const y = t.date.substring(0, 4);
      const ym = t.date.substring(0, 7);
      if (y === targetYear && monthlyData[ym] && activeMembers.includes(t.member)) {
        if (t.type === '收入') {
          monthlyData[ym].income[t.member] = (monthlyData[ym].income[t.member] || 0) + t.amount;
        } else {
          monthlyData[ym].expense[t.member] = (monthlyData[ym].expense[t.member] || 0) + t.amount;
        }
      }
    });

  } else {
    const isYearCycle = state.reviewCycle === 'year';
    document.getElementById('trend-chart-title').innerText = isYearCycle ? '年度家庭收支趨勢分析' : '月度家庭收支趨勢分析';

    if (isYearCycle) {
      // 收集所有交易資料中出現過的年度
      const allYearsSet = new Set();
      state.mappedTransactions.forEach(t => {
        if (activeMembers.includes(t.member) && t.date && t.date.length >= 4) {
          allYearsSet.add(t.date.substring(0, 4));
        }
      });

      months = Array.from(allYearsSet).sort(); // 這裡的 months 實際裝的是年份

      months.forEach(yr => {
        monthlyData[yr] = { income: {}, expense: {} };
        activeMembers.forEach(mem => {
          monthlyData[yr].income[mem] = 0;
          monthlyData[yr].expense[mem] = 0;
        });
      });

      state.mappedTransactions.forEach(t => {
        const yr = t.date.substring(0, 4);
        if (monthlyData[yr] && activeMembers.includes(t.member)) {
          if (t.type === '收入') {
            monthlyData[yr].income[t.member] = (monthlyData[yr].income[t.member] || 0) + t.amount;
          } else {
            monthlyData[yr].expense[t.member] = (monthlyData[yr].expense[t.member] || 0) + t.amount;
          }
        }
      });

    } else {
      // 收集所有交易資料中出現過的月份
      const allMonthsSet = new Set();
      state.mappedTransactions.forEach(t => {
        if (activeMembers.includes(t.member) && t.date && t.date.length >= 7) {
          allMonthsSet.add(t.date.substring(0, 7));
        }
      });

      months = Array.from(allMonthsSet).sort();
      
      // 如果篩選了特定月份，只顯示該月份 (以便跟年度檢討一致)
      if (state.filterPeriod !== 'all') {
        months = [state.filterPeriod];
      } else {
        months = months.slice(-6); // 預設保留最近6個月
      }

      months.forEach(ym => {
        monthlyData[ym] = { income: {}, expense: {} };
        activeMembers.forEach(mem => {
          monthlyData[ym].income[mem] = 0;
          monthlyData[ym].expense[mem] = 0;
        });
      });

      state.mappedTransactions.forEach(t => {
        const ym = t.date.substring(0, 7);
        if (monthlyData[ym] && activeMembers.includes(t.member)) {
          if (t.type === '收入') {
            monthlyData[ym].income[t.member] = (monthlyData[ym].income[t.member] || 0) + t.amount;
          } else {
            monthlyData[ym].expense[t.member] = (monthlyData[ym].expense[t.member] || 0) + t.amount;
          }
        }
      });
    }
  }

  const formattedLabels = months.map(m => {
    if (m.includes('-')) {
      const p = m.split('-');
      return `${p[0]}/${p[1]}`;
    }
    return `${m}年`;
  });

  // 構造各成員的疊加 Dataset
  const datasets = [];

  // A. 疊加收入
  activeMembers.forEach(mem => {
    const data = months.map(m => monthlyData[m].income[mem] || 0);
    datasets.push({
      label: `${mem} (收入)`,
      data: data,
      backgroundColor: incomeColors[mem] || 'rgba(16, 185, 129, 0.75)',
      borderColor: incomeColors[mem] || '#10b981',
      borderWidth: 1.5,
      borderRadius: 4,
      stack: 'income',
      hoverBackgroundColor: incomeColors[mem] || '#10b981'
    });
  });

  // B. 疊加支出
  activeMembers.forEach(mem => {
    const data = months.map(m => monthlyData[m].expense[mem] || 0);
    datasets.push({
      label: `${mem} (支出)`,
      data: data,
      backgroundColor: expenseColors[mem] || 'rgba(244, 63, 94, 0.75)',
      borderColor: expenseColors[mem] || '#f43f5e',
      borderWidth: 1.5,
      borderRadius: 4,
      stack: 'expense',
      hoverBackgroundColor: expenseColors[mem] || '#f43f5e'
    });
  });

  // 動態更新圖表頂部的家庭成員圖例 (Custom HTML Legend)
  const chartActions = document.querySelector('.chart-actions');
  if (chartActions) {
    chartActions.innerHTML = '';
    chartActions.style.display = 'flex';
    chartActions.style.flexDirection = 'column';
    chartActions.style.alignItems = 'flex-end';
    chartActions.style.gap = '6px';
    
    // 收入組
    const incRow = document.createElement('div');
    incRow.style.display = 'flex';
    incRow.style.gap = '8px';
    incRow.style.alignItems = 'center';
    incRow.style.flexWrap = 'wrap';
    
    const incBadge = document.createElement('span');
    incBadge.className = 'badge badge-income';
    incBadge.innerText = '收入';
    incRow.appendChild(incBadge);
    
    activeMembers.forEach(mem => {
      const dotSpan = document.createElement('span');
      dotSpan.style.display = 'inline-flex';
      dotSpan.style.alignItems = 'center';
      dotSpan.style.gap = '4px';
      dotSpan.style.fontSize = '11px';
      dotSpan.style.color = '#cbd5e1';
      dotSpan.innerHTML = `<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background-color:${incomeColors[mem] || '#10b981'};"></span>${mem}`;
      incRow.appendChild(dotSpan);
    });
    chartActions.appendChild(incRow);
    
    // 支出組
    const expRow = document.createElement('div');
    expRow.style.display = 'flex';
    expRow.style.gap = '8px';
    expRow.style.alignItems = 'center';
    expRow.style.flexWrap = 'wrap';
    
    const expBadge = document.createElement('span');
    expBadge.className = 'badge badge-expense';
    expBadge.innerText = '支出';
    expRow.appendChild(expBadge);
    
    activeMembers.forEach(mem => {
      const dotSpan = document.createElement('span');
      dotSpan.style.display = 'inline-flex';
      dotSpan.style.alignItems = 'center';
      dotSpan.style.gap = '4px';
      dotSpan.style.fontSize = '11px';
      dotSpan.style.color = '#cbd5e1';
      dotSpan.innerHTML = `<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background-color:${expenseColors[mem] || '#f43f5e'};"></span>${mem}`;
      expRow.appendChild(dotSpan);
    });
    chartActions.appendChild(expRow);
  }

  if (trendChartInstance) {
    trendChartInstance.destroy();
  }

  trendChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: formattedLabels,
      datasets: datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(18, 14, 40, 0.95)',
          padding: 12,
          callbacks: {
            label: function(context) {
              return ` ${context.dataset.label}: NT$ ${Math.round(context.raw).toLocaleString()}`;
            }
          }
        }
      },
      scales: {
        x: {
          stacked: true,
          grid: { display: false },
          ticks: { color: '#94a3b8', font: { family: 'Inter', size: 10 } }
        },
        y: {
          stacked: true,
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { 
            color: '#94a3b8',
            font: { family: 'Inter', size: 10 },
            callback: function(value) {
              return value >= 1000 ? (value / 1000) + 'k' : value;
            }
          }
        }
      }
    }
  });
}

// 支出/收入結構佔比圓餅圖
function renderCategoryChart() {
  const ctx = document.getElementById('categoryChart').getContext('2d');
  const filtered = getFilteredTransactions();

  const groupData = {};
  let totalAmount = 0;
  
  filtered.forEach(t => {
    if (state.chartDistributionMode === 'source') {
      // 收入來源
      if (t.type === '收入') {
        const key = t.source || t.category || '其他';
        groupData[key] = (groupData[key] || 0) + t.amount;
        totalAmount += t.amount;
      }
    } else {
      // 支出類別 或 支出成員
      if (t.type === '支出') {
        const key = state.chartDistributionMode === 'category' ? t.category : t.member;
        groupData[key] = (groupData[key] || 0) + t.amount;
        totalAmount += t.amount;
      }
    }
  });

  const sortedKeys = Object.keys(groupData).sort((a, b) => groupData[b] - groupData[a]);
  const dataValues = sortedKeys.map(key => groupData[key]);
  
  if (categoryChartInstance) {
    categoryChartInstance.destroy();
  }

  const noDataLabel = state.chartDistributionMode === 'source' ? '尚無收入資料' : '尚無支出資料';

  if (totalAmount === 0) {
    categoryChartInstance = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: [noDataLabel],
        datasets: [{
          data: [1],
          backgroundColor: ['rgba(255,255,255,0.06)'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '70%',
        plugins: {
          legend: { display: true, position: 'bottom', labels: { color: '#94a3b8' } }
        }
      }
    });
    return;
  }

  categoryChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: sortedKeys,
      datasets: [{
        data: dataValues,
        backgroundColor: categoryColors.slice(0, sortedKeys.length),
        borderWidth: 2,
        borderColor: '#0a071a',
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '70%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#cbd5e1',
            boxWidth: 10,
            padding: 8,
            font: { family: 'Inter', size: 10 }
          }
        },
        tooltip: {
          backgroundColor: 'rgba(18, 14, 40, 0.95)',
          padding: 12,
          callbacks: {
            label: function(context) {
              const val = context.raw;
              const pct = ((val / totalAmount) * 100).toFixed(0);
              return ` ${context.label}: NT$ ${Math.round(val).toLocaleString()} (${pct}%)`;
            }
          }
        }
      }
    }
  });
}

// 9. 智能洞察與預算管理
function renderInsightsAndBudget() {
  const filtered = getFilteredTransactions();
  
  // A. 月度預算指標 (取當前最新月份的家庭總支出)
  let familyMonthExpense = 0;
  const now = new Date();
  const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  state.mappedTransactions.forEach(t => {
    if (t.date.substring(0, 7) === currentMonthStr && t.type === '支出') {
      familyMonthExpense += t.amount;
    }
  });

  const budgetPct = Math.min((familyMonthExpense / state.monthlyBudget) * 100, 100);
  document.getElementById('budget-amount-text').innerText = `已花費 NT$ ${Math.round(familyMonthExpense).toLocaleString()} / NT$ ${state.monthlyBudget.toLocaleString()}`;
  document.getElementById('budget-progress-bar').style.width = `${budgetPct}%`;

  const budgetWarning = document.getElementById('budget-warning-text');
  if (budgetPct >= 100) {
    budgetWarning.innerText = `⚠️ 警告：本月家庭總預算已超支！超過率 ${((familyMonthExpense - state.monthlyBudget) / state.monthlyBudget * 100).toFixed(0)}%`;
    budgetWarning.className = 'metric-info text-expense';
    document.getElementById('budget-progress-bar').style.background = 'linear-gradient(to right, #f43f5e, #be123c)';
  } else if (budgetPct >= 80) {
    budgetWarning.innerText = `💡 提醒：本月預算已使用 ${budgetPct.toFixed(0)}%，請克制家庭非必要消費。`;
    budgetWarning.className = 'metric-info text-warning';
    document.getElementById('budget-progress-bar').style.background = 'linear-gradient(to right, #f59e0b, #d97706)';
  } else {
    budgetWarning.innerText = `✅ 安全：本月剩餘可用預算為 NT$ ${Math.round(state.monthlyBudget - familyMonthExpense).toLocaleString()}`;
    budgetWarning.className = 'metric-info text-muted';
    document.getElementById('budget-progress-bar').style.background = 'linear-gradient(to right, var(--color-primary), #a855f7)';
  }

  // B. 儲蓄目標進度 (全家累計)
  let totalIncome = 0;
  let totalExpense = 0;
  state.mappedTransactions.forEach(t => {
    if (t.type === '收入') totalIncome += t.amount;
    else totalExpense += t.amount;
  });
  
  const totalBalance = Math.max(0, totalIncome - totalExpense);
  const savingsGoalPct = Math.min((totalBalance / state.annualSavingsGoal) * 100, 100);
  
  document.getElementById('savings-progress-text').innerText = `NT$ ${Math.round(totalBalance).toLocaleString()} / NT$ ${state.annualSavingsGoal.toLocaleString()}`;
  document.getElementById('savings-progress-bar').style.width = `${savingsGoalPct}%`;
  document.getElementById('savings-info-text').innerText = `已達成年度儲蓄目標的 ${savingsGoalPct.toFixed(1)}%`;

  // C. 智能家庭洞察分析
  const insights = [];
  
  if (filtered.length === 0) {
    insights.push({
      type: 'info',
      text: '本期尚無任何收支記錄。'
    });
  } else {
    let totalExp = 0;
    let totalInc = 0;
    const categoryData = {};
    const memberData = {};
    const memberIncome = {};

    filtered.forEach(t => {
      if (t.type === '支出') {
        categoryData[t.category] = (categoryData[t.category] || 0) + t.amount;
        memberData[t.member] = (memberData[t.member] || 0) + t.amount;
        totalExp += t.amount;
      } else {
        memberIncome[t.member] = (memberIncome[t.member] || 0) + t.amount;
        totalInc += t.amount;
      }
    });

    // 1. 成員支出洞察
    if (state.filterMember === 'all' && totalExp > 0) {
      const sortedMembers = Object.keys(memberData).sort((a,b) => memberData[b] - memberData[a]);
      const primaryMember = sortedMembers[0];
      const memberPct = ((memberData[primaryMember] / totalExp) * 100).toFixed(0);
      
      insights.push({
        type: 'warning',
        text: `📊 本期花費最高的家庭成員是 <strong>${primaryMember}</strong>，共支出 NT$ ${Math.round(memberData[primaryMember]).toLocaleString()} (佔總支出的 <strong>${memberPct}%</strong>)。`
      });
    }

    // 2. 成員收入貢獻
    if (state.filterMember === 'all' && totalInc > 0) {
      const sortedIncome = Object.keys(memberIncome).sort((a,b) => memberIncome[b] - memberIncome[a]);
      const topEarner = sortedIncome[0];
      insights.push({
        type: 'success',
        text: `💰 本期收入貢獻最大的是 <strong>${topEarner}</strong>，共入帳 NT$ ${Math.round(memberIncome[topEarner]).toLocaleString()}。`
      });
    }

    // 3. 最大支出類別
    if (totalExp > 0) {
      const sortedCats = Object.keys(categoryData).sort((a,b) => categoryData[b] - categoryData[a]);
      const primaryCat = sortedCats[0];
      const primaryCatPct = ((categoryData[primaryCat] / totalExp) * 100).toFixed(0);
      
      insights.push({
        type: 'info',
        text: `🏷️ 本期樂肉家主要的消費是「<strong>${primaryCat}</strong>」，佔總支出的 <strong>${primaryCatPct}%</strong>。`
      });
    }

    // 4. 收支盈餘狀態
    if (totalInc > 0) {
      const rate = ((totalInc - totalExp) / totalInc * 100);
      if (rate <= 0) {
        insights.push({
          type: 'danger',
          text: `🚨 警告：本期家庭收支出現赤字！超支金額達 <strong>NT$ ${Math.round(totalExp - totalInc).toLocaleString()}</strong>，請全家共同克制開銷。`
        });
      }
    }
  }

  // 渲染 Insights
  const container = document.getElementById('insight-container');
  container.innerHTML = '';
  insights.forEach(ins => {
    const item = document.createElement('div');
    item.className = 'insight-item';
    
    let bulletClass = 'bullet-info';
    if (ins.type === 'success') bulletClass = 'bullet-success';
    else if (ins.type === 'warning') bulletClass = 'bullet-warning';
    else if (ins.type === 'danger') bulletClass = 'bullet-danger';

    item.innerHTML = `
      <span class="insight-bullet ${bulletClass}"></span>
      <p>${ins.text}</p>
    `;
    container.appendChild(item);
  });
}

// 10. 明細表格分頁與過濾 (Transactions Table Manager)
function getFilteredAndSearchedTransactions() {
  const filtered = getFilteredTransactions(true); // 交易明細清單不篩選時間，方便使用者查詢全局歷史資料
  
  return filtered.filter(t => {
    // 表格過濾：成員
    if (state.tableFilters.member !== 'all' && t.member !== state.tableFilters.member) {
      return false;
    }

    // 收支類型過濾
    if (state.tableFilters.type !== 'all' && t.type !== state.tableFilters.type) {
      return false;
    }
    
    // 類別/來源過濾
    if (state.tableFilters.category !== 'all' && t.category !== state.tableFilters.category && t.source !== state.tableFilters.category) {
      return false;
    }

    // 關鍵字搜尋 (包含成員、類別、來源、項目/備註、日期)
    if (state.tableFilters.searchQuery) {
      const q = state.tableFilters.searchQuery;
      return t.member.toLowerCase().includes(q) || 
             t.category.toLowerCase().includes(q) || 
             (t.source && t.source.toLowerCase().includes(q)) ||
             t.remark.toLowerCase().includes(q) ||
             t.date.includes(q);
    }

    return true;
  });
}

function renderTransactionsTable() {
  const list = getFilteredAndSearchedTransactions();
  const tbody = document.getElementById('table-body');
  
  const totalItems = list.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / state.pagination.pageSize));
  
  if (state.pagination.currentPage > totalPages) {
    state.pagination.currentPage = totalPages;
  }

  const startIdx = (state.pagination.currentPage - 1) * state.pagination.pageSize;
  const endIdx = Math.min(startIdx + state.pagination.pageSize, totalItems);
  const pageItems = list.slice(startIdx, endIdx);

  document.getElementById('pag-start').innerText = totalItems > 0 ? startIdx + 1 : 0;
  document.getElementById('pag-end').innerText = endIdx;
  document.getElementById('pag-total').innerText = totalItems;
  document.getElementById('pag-current').innerText = `${state.pagination.currentPage} / ${totalPages}`;

  tbody.innerHTML = '';

  if (pageItems.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="text-center py-8 text-muted">
          無符合篩選條件的帳目明細。
        </td>
      </tr>
    `;
    return;
  }

  pageItems.forEach(t => {
    const tr = document.createElement('tr');
    
    const isIncome = t.type === '收入';
    const typeBadge = isIncome ? 'income' : 'expense';
    const amountClass = isIncome ? 'income' : 'expense';
    const amountPrefix = isIncome ? '+' : '-';

    tr.innerHTML = `
      <td>${t.date}</td>
      <td><strong>${t.member}</strong></td>
      <td><span class="badge-row-type ${typeBadge}">${t.type}</span></td>
      <td>${t.type === '收入' ? (t.source || t.category) : t.category}</td>
      <td class="td-amount ${amountClass}">${amountPrefix} NT$ ${Math.round(t.amount).toLocaleString()}</td>
      <td class="text-secondary">${t.remark || '-'}</td>
    `;
    tbody.appendChild(tr);
  });
}

// 匯出 CSV
function exportToCSV() {
  const list = getFilteredAndSearchedTransactions();
  if (list.length === 0) {
    alert('無符合條件的資料可供匯出！');
    return;
  }

  let csvContent = '\uFEFF'; // BOM
  csvContent += '日期,成員,收支類型,類別/來源,金額,項目備註\n';
  
  list.forEach(t => {
    const remark = t.remark ? `"${t.remark.replace(/"/g, '""')}"` : '';
    const catOrSrc = t.type === '收入' ? (t.source || t.category) : t.category;
    csvContent += `${t.date},${t.member},${t.type},${catOrSrc},${t.amount},${remark}\n`;
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `樂肉家收支明細_${new Date().toISOString().slice(0,10)}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// 11. Modal 與設定存檔處理
function openConfigModal() {
  document.getElementById('modal-input-url').value = state.sheetUrl;
  
  // 同步目前狀態到 Modal 內的元件
  const modalRadio = document.querySelector(`input[name="modal-sheet-mode"][value="${state.sheetMode}"]`);
  if (modalRadio) modalRadio.checked = true;

  document.getElementById('modal-input-expense-gid').value = state.expenseGid;
  document.getElementById('modal-input-income-gid').value = state.incomeGid;
  document.getElementById('modal-input-single-gid').value = state.singleGid;

  updateModalFormLayout(state.sheetMode);
  
  document.getElementById('config-modal').classList.add('active');
}

function closeConfigModal() {
  document.getElementById('config-modal').classList.remove('active');
  document.getElementById('modal-error').style.display = 'none';
}

function showModalError(msg) {
  const err = document.getElementById('modal-error');
  err.innerText = msg;
  err.style.display = 'block';
}

function saveConnectionSettings() {
  const url = document.getElementById('input-sheet-url').value.trim();
  
  if (!url) {
    alert('請輸入 Google Sheet 網址！');
    return;
  }

  state.sheetUrl = url;
  
  // 儲存 GID 輸入框的值
  state.expenseGid = document.getElementById('input-expense-gid').value.trim() || '0';
  state.incomeGid = document.getElementById('input-income-gid').value.trim();
  state.singleGid = document.getElementById('input-single-gid').value.trim() || '0';

  saveSettingsToStorage();
  fetchSheetData();
}

// 儲存對應關係
function saveMappingSettings() {
  if (state.sheetMode === 'separate') {
    state.mapping.expense.date = document.getElementById('map-exp-date').value;
    state.mapping.expense.member = document.getElementById('map-exp-member').value;
    state.mapping.expense.category = document.getElementById('map-exp-category').value;
    state.mapping.expense.amount = document.getElementById('map-exp-amount').value;
    state.mapping.expense.remark = document.getElementById('map-exp-remark').value;

    state.mapping.income.date = document.getElementById('map-inc-date').value;
    state.mapping.income.member = document.getElementById('map-inc-member').value;
    state.mapping.income.category = document.getElementById('map-inc-category').value;
    state.mapping.income.source = document.getElementById('map-inc-source').value;
    state.mapping.income.amount = document.getElementById('map-inc-amount').value;
    state.mapping.income.remark = document.getElementById('map-inc-remark').value;
  } else {
    state.mapping.combined.date = document.getElementById('map-comb-date').value;
    state.mapping.combined.member = document.getElementById('map-comb-member').value;
    state.mapping.combined.category = document.getElementById('map-comb-category').value;
    state.mapping.combined.source = document.getElementById('map-comb-source').value;
    state.mapping.combined.amount = document.getElementById('map-comb-amount').value;
    state.mapping.combined.remark = document.getElementById('map-comb-remark').value;
    state.mapping.combined.type = document.getElementById('map-comb-type').value;
    
    state.matchExpense = document.getElementById('val-match-expense').value.trim() || '支出';
    state.matchIncome = document.getElementById('val-match-income').value.trim() || '收入';
  }

  saveSettingsToStorage();
  applyMappingAndProcess();
  
  alert('欄位對應已成功套用！儀表板已依時間戳記完成全自動分類。');
  switchTab('dashboard');
}

// 儲存預算與儲蓄目標設定
function saveBudgetSettings() {
  const budget = Number(document.getElementById('setting-monthly-budget').value) || 0;
  const savings = Number(document.getElementById('setting-annual-savings').value) || 0;

  if (budget <= 0 || savings <= 0) {
    alert('預算與儲蓄目標金額必須大於 0！');
    return;
  }

  state.monthlyBudget = budget;
  state.annualSavingsGoal = savings;

  saveSettingsToStorage();
  processAndRenderData();
  
  alert('預算與儲蓄目標更新成功！');
  switchTab('dashboard');
}

// 解析網址輔助 (加上防呆防止 undefined / null 報錯)
function extractSpreadsheetId(url) {
  if (!url) return null;
  if (url.indexOf('docs.google.com/spreadsheets') !== -1) {
    const matches = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    return matches ? matches[1] : null;
  }
  return url;
}

// 更新同步狀態與指示燈
function updateSyncStatus(status, text) {
  const indicator = document.getElementById('sync-status-indicator');
  const label = document.getElementById('sync-status-text');
  if (indicator && label) {
    indicator.className = 'status-indicator ' + status;
    label.innerText = text;
  }
}

// 12. 載入 Demo 資料 (自動生成跨 2025 與 2026 兩年度的收支)
function loadMockData() {
  updateSyncStatus('online', '使用樂肉家 Demo 數據');
  
  const members = ['爸爸 (樂肉)', '媽媽', '小明 (大兒子)', '小華 (二女兒)'];
  const categoriesExpense = ['餐飲食品', '交通出行', '娛樂消費', '居家水電', '教育學習', '醫療健康', '貓咪生活/飼料'];
  const categoriesIncome = ['薪資入帳', '副業所得', '股票股息', '零用錢'];

  const mockList = [];

  // 生成跨 2025、2026 兩年的大量帳目，展示「自動時間分類」的威力
  const years = [2025, 2026];

  for (let i = 0; i < 150; i++) {
    const member = members[Math.floor(Math.random() * members.length)];
    const type = Math.random() > 0.8 ? '收入' : '支出';
    const targetYear = years[Math.floor(Math.random() * years.length)];
    
    // 生成該年度 1~12 月的隨機日期
    const randomMonth = Math.floor(Math.random() * 12);
    const randomDay = Math.floor(Math.random() * 28) + 1;
    const dateStr = `${targetYear}-${String(randomMonth + 1).padStart(2, '0')}-${String(randomDay).padStart(2, '0')}`;

    let category = '';
    let amount = 0;
    let remark = '';

    if (type === '支出') {
      category = categoriesExpense[Math.floor(Math.random() * categoriesExpense.length)];
      if (category === '餐飲食品') {
        amount = Math.floor(Math.random() * 400) + 100;
        remark = member.includes('爸爸') ? '買全家晚餐' : '點外送披薩';
      } else if (category === '貓咪生活/飼料') {
        amount = Math.floor(Math.random() * 1800) + 300;
        remark = '買貓飼料與貓零食';
      } else if (category === '交通出行') {
        amount = Math.floor(Math.random() * 900) + 100;
        remark = '汽車加油/悠遊卡加值';
      } else if (category === '居家水電') {
        amount = Math.floor(Math.random() * 4500) + 1200;
        remark = '水電瓦斯管理費繳納';
      } else if (category === '娛樂消費') {
        amount = Math.floor(Math.random() * 3000) + 200;
        remark = '看電影/買衣服與玩具';
      } else {
        amount = Math.floor(Math.random() * 800) + 100;
        remark = '日常家庭生活雜項';
      }
    } else {
      category = categoriesIncome[Math.floor(Math.random() * categoriesIncome.length)];
      if (category === '薪資入帳') {
        if (member.includes('爸爸')) {
          amount = 65000;
          remark = '樂肉爸爸月薪水';
        } else if (member === '媽媽') {
          amount = 54000;
          remark = '媽媽月薪水';
        } else {
          amount = 500;
          category = '零用錢';
          remark = '收到家裡零用錢';
        }
      } else if (category === '股票股息') {
        amount = Math.floor(Math.random() * 10000) + 1000;
        remark = '高股息 ETF 配息入帳';
      } else {
        amount = Math.floor(Math.random() * 6000) + 800;
        remark = '接案副業入帳';
      }
    }

    mockList.push({
      date: dateStr,
      member: member,
      type: type,
      category: category,
      source: type === '收入' ? category : '',
      amount: amount,
      remark: remark
    });
  }

  state.mappedTransactions = mockList;
  state.mappedTransactions.sort((a, b) => new Date(b.date) - new Date(a.date));

  state.availableMembers = members;
  
  // 模擬原始 columns，供對應選單使用
  state.columns = ['日期戳記', '記帳人員', '收支類型', '消費項目', '金額', '備註'];
  
  document.getElementById('mapping-card').style.display = 'none';

  processAndRenderData();
}
