'use strict';
/* ============================================================
   仙途挂机 · game.js
   v1 核心放置循环：状态 / 数字格式化 / 打坐 / 主循环 / 自动存档
   ============================================================ */

const SAVE_KEY = 'xiuxian_idle_save_v1';
const $ = (id) => document.getElementById(id);

/* ---------------- 状态 ---------------- */
const state = {
  qi: 0,            // 当前灵气
  totalRun: 0,      // 本世累计灵气
  totalAll: 0,      // 历世累计灵气
  realm: 0,         // 境界索引（0 = 炼气期）
  gens: {},         // 弟子等级 { id: level }
  ups: {},          // 已购功法 { id: true }
  daoyun: 0,        // 道韵（轮回永久货币）
  runs: 0,          // 轮回次数
  lastSave: Date.now(),
};

/* ---------------- 数字格式化 ---------------- */
function trimNum(x) {
  if (x >= 100) return String(Math.floor(x));
  if (x >= 10) return x.toFixed(1);
  return x.toFixed(2);
}
function fmt(n) {
  if (!isFinite(n)) return '∞';
  if (n < 0) return '-' + fmt(-n);
  if (n < 1e4) return String(Math.floor(n));
  if (n < 1e8) return trimNum(n / 1e4) + '万';
  if (n < 1e12) return trimNum(n / 1e8) + '亿';
  if (n < 1e16) return trimNum(n / 1e12) + '兆';
  if (n < 1e20) return trimNum(n / 1e16) + '京';
  return n.toExponential(2).replace('e+', 'e');
}

/* ---------------- 数值计算 ----------------
   天地灵气：基础的自动产出，境界与道韵会放大它；
   门人弟子的产出在功法页开放后叠加。 */
function realmMult() { return Math.pow(3, state.realm); }
function daoyunMult() { return 1 + 0.02 * state.daoyun; }
function qps() { return 0.2 * realmMult() * daoyunMult(); }
function tapPower() { return 1 * realmMult() * daoyunMult(); }

/* ---------------- 境界 ---------------- */
const REALMS = ['炼气期', '筑基期', '金丹期', '元婴期', '化神期',
                '炼虚期', '合体期', '大乘期', '渡劫期', '仙人'];
function breakCost() { return 200 * Math.pow(10, state.realm); }

/* ---------------- 存档 ---------------- */
function defaultState() {
  return {
    qi: 0, totalRun: 0, totalAll: 0, realm: 0,
    gens: {}, ups: {}, daoyun: 0, runs: 0,
    lastSave: Date.now(),
  };
}
function saveState() {
  state.lastSave = Date.now();
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
}
function loadState() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    Object.assign(state, defaultState(), data);
  } catch (e) { /* 存档损坏则重新开始 */ }
}

/* ---------------- 渲染 ---------------- */
const el = {};
function cacheEls() {
  ['qiNum', 'qiRate', 'realmName', 'realmBar', 'realmBarText',
   'btnBreak', 'btnMeditate', 'heroArea', 'dyCount', 'dyMult', 'dyRuns',
   'btnPrestige', 'prestigeReq', 'statTotal', 'statRuns', 'statDaoyun',
   'offGain'].forEach((k) => { el[k] = $(k); });
  el.genList = $('genList');
  el.upList = $('upList');
}

function renderRealm() {
  el.realmName.textContent = REALMS[state.realm];
  if (state.realm >= REALMS.length - 1) {
    el.realmBar.style.width = '100%';
    el.realmBarText.textContent = '已证仙人之道，大道圆满';
    el.btnBreak.disabled = true;
    el.btnBreak.textContent = '飞升圆满';
    el.btnBreak.classList.remove('ready');
    return;
  }
  const cost = breakCost();
  el.realmBar.style.width = Math.min(100, (state.qi / cost) * 100) + '%';
  el.realmBarText.textContent = fmt(Math.min(state.qi, cost)) + ' / ' + fmt(cost);
  el.btnBreak.textContent = '突破 · ' + REALMS[state.realm + 1];
  const ready = state.qi >= cost;
  el.btnBreak.disabled = !ready;
  el.btnBreak.classList.toggle('ready', ready);
}

function renderMain() {
  el.qiNum.textContent = fmt(state.qi);
  const rate = qps();
  el.qiRate.textContent = '+' + fmt(rate) + ' / 秒';
  renderRealm();
  el.dyCount.textContent = fmt(state.daoyun);
  el.dyMult.textContent = '×' + daoyunMult().toFixed(2);
  el.dyRuns.textContent = String(state.runs);
  el.statTotal.textContent = fmt(state.totalAll);
  el.statRuns.textContent = String(state.runs);
  el.statDaoyun.textContent = fmt(state.daoyun);
}

/* ---------------- 打坐 ---------------- */
let floatCount = 0;
function spawnFloat(x, y, text) {
  if (floatCount >= 12) return;
  floatCount++;
  const s = document.createElement('span');
  s.className = 'float-qi';
  s.textContent = text;
  const area = el.heroArea.getBoundingClientRect();
  s.style.left = (x - area.left - 14) + 'px';
  s.style.top = (y - area.top - 10) + 'px';
  el.heroArea.appendChild(s);
  setTimeout(() => { s.remove(); floatCount--; }, 900);
}
function meditate(x, y) {
  const gain = tapPower();
  state.qi += gain;
  state.totalRun += gain;
  state.totalAll += gain;
  if (x !== undefined) spawnFloat(x, y, '+' + fmt(gain));
  renderMain();
}

/* ---------------- 境界突破 ---------------- */
function doBreakthrough() {
  const cost = breakCost();
  if (state.qi < cost || state.realm >= REALMS.length - 1) return;
  state.qi -= cost;
  state.realm++;
  const fx = $('breakFx');
  $('breakText').textContent = '突破！' + REALMS[state.realm];
  fx.classList.remove('hidden');
  fx.style.animation = 'none';
  void fx.offsetWidth; // 重启动画
  fx.style.animation = '';
  setTimeout(() => fx.classList.add('hidden'), 1800);
  saveState();
  renderMain();
}

/* ---------------- 离线收益 ---------------- */
const OFFLINE_CAP = 8 * 3600;   // 8 小时
const OFFLINE_RATE = 0.5;       // 离线效率 50%
function fmtDur(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return h + ' 小时 ' + m + ' 分';
  if (m > 0) return m + ' 分钟';
  return Math.floor(sec) + ' 秒';
}
function applyOffline() {
  const elapsed = Math.min((Date.now() - state.lastSave) / 1000, OFFLINE_CAP);
  if (elapsed < 60) return; // 1 分钟内不算闭关
  const gain = qps() * elapsed * OFFLINE_RATE;
  if (gain <= 0) return;
  state.qi += gain;
  state.totalRun += gain;
  state.totalAll += gain;
  el.offGain.textContent = '+' + fmt(gain);
  document.querySelector('#modalOffline .modal-text').innerHTML =
    '小修士匆匆跑来：<br>「师尊闭关 <b>' + fmtDur(elapsed) +
    '</b>，门下弟子共汇聚灵气——」';
  setTimeout(() => openModal('modalOffline'), 400);
}

/* ---------------- 主循环 ---------------- */
let lastTick = performance.now();
function tick(now) {
  const dt = Math.min((now - lastTick) / 1000, 1); // 秒，切后台回来不会暴涨
  lastTick = now;
  const gain = qps() * dt;
  if (gain > 0) {
    state.qi += gain;
    state.totalRun += gain;
    state.totalAll += gain;
  }
  renderMain();
  requestAnimationFrame(tick);
}

/* ---------------- 弹窗 / 页签 ---------------- */
function openModal(id) { $(id).classList.remove('hidden'); }
function closeModal(id) { $(id).classList.add('hidden'); }

function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
  $('tab-' + name).classList.add('active');
  document.querySelector('.tab-btn[data-tab="' + name + '"]').classList.add('active');
}

function bindUI() {
  el.btnMeditate.addEventListener('click', (e) => meditate(e.clientX, e.clientY));
  el.heroArea.addEventListener('pointerdown', (e) => meditate(e.clientX, e.clientY));

  document.querySelectorAll('.tab-btn').forEach((b) =>
    b.addEventListener('click', () => switchTab(b.dataset.tab)));

  $('btnSettings').addEventListener('click', () => openModal('modalSettings'));
  $('btnSettingsClose').addEventListener('click', () => closeModal('modalSettings'));
  $('btnOffOk').addEventListener('click', () => closeModal('modalOffline'));
  document.querySelectorAll('.modal').forEach((m) =>
    m.addEventListener('click', (e) => { if (e.target === m) closeModal(m.id); }));

  // v3 将接入真实导出/导入/重置
  $('btnExport').addEventListener('click', () => alert('导出功能将在下个版本开放'));
  $('btnImport').addEventListener('click', () => alert('导入功能将在下个版本开放'));
  $('btnReset').addEventListener('click', () => alert('重置功能将在下个版本开放'));
  $('btnPrestige').addEventListener('click', () => alert('轮回功能将在下个版本开放'));
  el.btnBreak.addEventListener('click', doBreakthrough);
}

/* ---------------- 启动 ---------------- */
function init() {
  cacheEls();
  loadState();
  bindUI();
  applyOffline();
  renderMain();
  el.btnPrestige.disabled = true;
  el.prestigeReq.textContent = '轮回之法将在下个版本开放';
  requestAnimationFrame(tick);

  setInterval(saveState, 5000);
  window.addEventListener('beforeunload', saveState);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveState();
  });
}

init();
