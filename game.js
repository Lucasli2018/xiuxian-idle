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
  achs: {},         // 已解锁成就（道果）{ id: true }
  bestOffline: 0,   // 单次最大闭关收益（成就用）
  pets: {},         // 已结伴灵宠 { id: true }
  tribDone: false,  // 本境界是否已历天劫
  tribWins: 0,      // 渡劫成功次数（降低失败率）
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

/* ---------------- 数值计算 ---------------- */
function realmMult() { return Math.pow(3, state.realm); }
function daoyunMult() { return 1 + 0.02 * state.daoyun; }
function qps() {
  let sum = 0.2; // 天地灵气（基础自动产出）
  for (const g of GENS) {
    const lv = state.gens[g.id] || 0;
    if (lv > 0) sum += lv * g.prod * Math.pow(2, Math.floor(lv / 25)); // 每 25 级产出翻倍
  }
  let upMult = 1;
  if (state.ups.u2) upMult *= 1.5;
  if (state.ups.u3) upMult *= 2;
  if (state.ups.u5) upMult *= 3;
  if (state.ups.u6) upMult *= 3;
  return sum * upMult * realmMult() * daoyunMult() * achMult() * petProdMult();
}
function tapPower() {
  let t = 1;
  if (state.ups.u1) t *= 2;
  if (state.ups.u4) t *= 3;
  return t * realmMult() * daoyunMult() * achMult() * petTapMult();
}

/* ---------------- 境界 ---------------- */
const REALMS = ['炼气期', '筑基期', '金丹期', '元婴期', '化神期',
                '炼虚期', '合体期', '大乘期', '渡劫期', '仙人'];
function breakCost() { return 200 * Math.pow(10, state.realm); }

/* ---------------- 弟子（生成器） ---------------- */
const COST_GROWTH = 1.15;
const GENS = [
  { id: 'servant', name: '杂役弟子', desc: '挑水劈柴，偶得灵气', cost: 15,     prod: 0.5 },
  { id: 'outer',   name: '外门弟子', desc: '晨钟暮鼓，吐纳有序', cost: 120,    prod: 4 },
  { id: 'inner',   name: '内门弟子', desc: '宗门真传，日进斗金', cost: 1500,   prod: 26 },
  { id: 'elder',   name: '真传长老', desc: '一念风雷，坐镇山门', cost: 20000,  prod: 170 },
  { id: 'sect',    name: '一宗之主', desc: '执掌灵脉，言出法随', cost: 260000, prod: 1200 },
];
function genCost(g, n) { // 买 n 名的总价（等比求和）
  const lv = state.gens[g.id] || 0;
  const c0 = g.cost * Math.pow(COST_GROWTH, lv);
  return Math.ceil(c0 * (Math.pow(COST_GROWTH, n) - 1) / (COST_GROWTH - 1));
}
function genUnlocked(g, idx) {
  if (idx === 0) return true;
  const prev = GENS[idx - 1];
  return (state.gens[prev.id] || 0) >= 1 || state.totalAll >= g.cost * 0.4;
}

/* ---------------- 功法法宝（一次性永久强化） ---------------- */
const UPS = [
  { id: 'u1', name: '《吐纳诀》',   desc: '打坐收益 ×2',   cost: 100,     unlock: () => state.totalAll >= 50 },
  { id: 'u2', name: '聚灵阵·残卷', desc: '灵气产出 +50%', cost: 600,     unlock: () => (state.gens.servant || 0) >= 10 },
  { id: 'u3', name: '五行灵根',     desc: '灵气产出 ×2',   cost: 6000,    unlock: () => state.realm >= 1 },
  { id: 'u4', name: '《御风诀》',   desc: '打坐收益 ×3',   cost: 30000,   unlock: () => state.totalAll >= 10000 },
  { id: 'u5', name: '周天星斗大阵', desc: '灵气产出 ×3',   cost: 250000,  unlock: () => state.realm >= 2 },
  { id: 'u6', name: '《大衍诀》',   desc: '灵气产出 ×3',   cost: 3000000, unlock: () => state.realm >= 3 },
];

/* ---------------- 成就 · 道果录 ----------------
   达成即得永久产出加成，加成相互叠加。 */
const ACHS = [
  { id: 'a1', name: '初窥门径', desc: '历世累计灵气达 1万',   bonus: 0.05, cond: () => state.totalAll >= 1e4 },
  { id: 'a2', name: '腰缠万贯', desc: '历世累计灵气达 100万', bonus: 0.05, cond: () => state.totalAll >= 1e6 },
  { id: 'a3', name: '富可敌国', desc: '历世累计灵气达 10亿',  bonus: 0.10, cond: () => state.totalAll >= 1e9 },
  { id: 'a4', name: '破而后立', desc: '首次突破境界',         bonus: 0.05, cond: () => state.realm >= 1 },
  { id: 'a5', name: '金丹大道', desc: '修至金丹期',           bonus: 0.10, cond: () => state.realm >= 2 },
  { id: 'a6', name: '广收门徒', desc: '门下弟子共 50 名',     bonus: 0.10, cond: () => GENS.reduce((s, g) => s + (state.gens[g.id] || 0), 0) >= 50 },
  { id: 'a7', name: '轮回往生', desc: '完成一次转世轮回',     bonus: 0.10, cond: () => state.runs >= 1 },
  { id: 'a8', name: '闭关奇遇', desc: '单次闭关收益达 1万',   bonus: 0.05, cond: () => state.bestOffline >= 1e4 },
];
/* ---------------- 灵宠（结伴仙兽，永久加成） ---------------- */
const PETS = [
  { id: 'fox',  name: '灵狐·赤焰', glyph: '狐', root: '火灵根',   cost: 5000,    eff: '全局灵气产出 +8%',           prod: 0.08 },
  { id: 'luan', name: '青鸾·御风', glyph: '鸾', root: '风灵根',   cost: 30000,   eff: '打坐收益 +15%',              tap: 0.15 },
  { id: 'xuan', name: '玄武·玄水', glyph: '武', root: '水灵根',   cost: 200000,  eff: '离线效率 50% → 75%',         offline: 0.25 },
  { id: 'ze',   name: '白泽·通灵', glyph: '泽', root: '先天灵兽', cost: 2000000, eff: '全局产出 +15% · 道韵 +10%',  prod: 0.15, dy: 0.10 },
];
function petProdMult()  { let m = 1; for (const p of PETS) if (state.pets[p.id] && p.prod)    m += p.prod;    return m; }
function petTapMult()   { let m = 1; for (const p of PETS) if (state.pets[p.id] && p.tap)     m += p.tap;     return m; }
function petOfflineAdd(){ let a = 0; for (const p of PETS) if (state.pets[p.id] && p.offline) a += p.offline; return a; }
function petDyMult()    { let m = 1; for (const p of PETS) if (state.pets[p.id] && p.dy)     m += p.dy;      return m; }

const petRefs = [];
function buyPet(p) {
  if (state.pets[p.id] || state.qi < p.cost) return;
  state.qi -= p.cost;
  state.pets[p.id] = true;
  renderPet();
  renderMain();
}
function renderPet() {
  const list = el.petList;
  if (!list) return;
  list.innerHTML = '';
  petRefs.length = 0;
  PETS.forEach((p) => {
    const owned = !!state.pets[p.id];
    const card = document.createElement('div');
    card.className = 'pet-card' + (owned ? ' owned' : '');
    card.innerHTML =
      '<div class="pet-badge">' + p.glyph + '</div>' +
      '<div class="pet-info">' +
        '<div class="pet-name">' + p.name + '<span class="pet-root">' + p.root + '</span></div>' +
        '<div class="pet-eff">' + p.eff + '</div>' +
      '</div>' +
      (owned
        ? '<button class="pet-buy" disabled>已结伴</button>'
        : '<button class="pet-buy">结伴<small>' + fmt(p.cost) + ' 灵气</small></button>');
    if (!owned) {
      const btn = card.querySelector('.pet-buy');
      btn.addEventListener('click', () => buyPet(p));
      petRefs.push({ p, btn });
    }
    list.appendChild(card);
  });
}
function refreshPetAfford() {
  petRefs.forEach(({ p, btn }) => { btn.disabled = state.qi < p.cost; });
}

function achMult() {
  let m = 1;
  for (const a of ACHS) if (state.achs[a.id]) m += a.bonus;
  return m;
}
function checkAchs(silent) {
  for (const a of ACHS) {
    if (state.achs[a.id] || !a.cond()) continue;
    state.achs[a.id] = true;
    if (!silent) showToast('★ 道果达成 · ' + a.name + '（灵气产出 +' + Math.round(a.bonus * 100) + '%）');
  }
}
let toastTimer = 0;
function showToast(text) {
  const t = $('toast');
  if (!t) return;
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
function renderAchs() {
  const list = $('achList');
  if (!list) return;
  list.innerHTML = '';
  ACHS.forEach((a) => {
    const done = !!state.achs[a.id];
    const item = document.createElement('div');
    item.className = 'ach-item' + (done ? ' done' : '');
    item.innerHTML =
      '<span class="ach-mark">' + (done ? '✓' : '○') + '</span>' +
      '<span class="ach-name">' + a.name + '</span>' +
      '<span class="ach-desc">' + a.desc + '</span>' +
      '<b class="ach-bonus">+' + Math.round(a.bonus * 100) + '%</b>';
    list.appendChild(item);
  });
}

/* ---------------- 存档 ---------------- */
function defaultState() {
  return {
    qi: 0, totalRun: 0, totalAll: 0, realm: 0,
    gens: {}, ups: {}, daoyun: 0, runs: 0,
    achs: {}, bestOffline: 0, pets: {}, tribDone: false, tribWins: 0,
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
  state.tribDone = false; // 突破后重置，本境界可再次历劫
  if (tribModalOpen) { tribModalOpen = false; closeModal('modalTrib'); } // 历劫途中突破，关闭劫面板
}

/* ---------------- 天劫 · 心魔劫 ----------------
   灵气达到「突破所需 2 倍」时触发；迎劫有成功率（随渡劫次数提升），
   成功得灵气与道韵，失败折损灵气四成（心魔劫）。突破后重置。 */
let tribModalOpen = false;
let tribDeferUntil = 0;
function tribProb() { return Math.min(0.4 + 0.1 * state.tribWins, 0.9); }
function maybeTrib() {
  if (state.tribDone || tribModalOpen) return;
  if (state.realm >= REALMS.length - 1) return;        // 已飞升不再有劫
  if (Date.now() < tribDeferUntil) return;             // 暂避冷却中
  if (state.qi >= breakCost() * 2) openTribModal();
}
function openTribModal() {
  const prob = Math.round(tribProb() * 100);
  const qiReward = state.totalRun * 0.1;
  const dyReward = Math.floor(state.totalRun / 1e7);
  $('modalTrib').querySelector('.trib-rows').innerHTML =
    '<b>迎劫成功率　' + prob + '%</b>' +
    '<div>当前灵气：' + fmt(state.qi) + '</div>' +
    '<div>渡劫成功：灵气 +' + fmt(qiReward) + ' · 道韵 +' + fmt(dyReward) + '</div>' +
    '<div>渡劫失败（心魔劫）：灵气折损 40%</div>';
  tribModalOpen = true;
  openModal('modalTrib');
}
function doTribulation() {
  closeModal('modalTrib');
  tribModalOpen = false;
  const success = Math.random() < tribProb();
  state.tribDone = true;
  if (success) {
    const qiReward = state.totalRun * 0.1;
    const dyReward = Math.floor(state.totalRun / 1e7);
    state.qi += qiReward; state.totalRun += qiReward; state.totalAll += qiReward;
    state.daoyun += dyReward; state.tribWins++;
    showToast('⚡ 渡劫成功！灵气 +' + fmt(qiReward) + ' · 道韵 +' + fmt(dyReward));
  } else {
    state.qi *= 0.6;
    showToast('✦ 心魔劫起，灵气折损四成——再修再来');
  }
  renderMain(); saveState();
}
function deferTrib() {
  closeModal('modalTrib');
  tribModalOpen = false;
  tribDeferUntil = Date.now() + 90000; // 暂避 90 秒
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
  const gain = qps() * elapsed * (OFFLINE_RATE + petOfflineAdd());
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

/* ---------------- 功法商店 ---------------- */
let buyMode = 1;
let lastSig = '';
const shopRefs = { gens: [], ups: [] };

function buyGen(g) {
  const cost = genCost(g, buyMode);
  if (state.qi < cost) return;
  state.qi -= cost;
  state.gens[g.id] = (state.gens[g.id] || 0) + buyMode;
  renderShop();
  renderMain();
}
function buyUp(u) {
  if (state.ups[u.id] || state.qi < u.cost) return;
  state.qi -= u.cost;
  state.ups[u.id] = true;
  renderShop();
  renderMain();
}

function renderShop() {
  el.genList.innerHTML = '';
  shopRefs.gens = [];
  GENS.forEach((g, idx) => {
    if (!genUnlocked(g, idx)) return;
    const lv = state.gens[g.id] || 0;
    const card = document.createElement('div');
    card.className = 'gen-card';
    card.innerHTML =
      '<div class="gen-info">' +
        '<div class="gen-name">' + g.name + '<span class="lv">Lv.' + lv + '</span></div>' +
        '<div class="gen-desc">' + g.desc + '</div>' +
        '<div class="gen-prod">每名 +' + fmt(g.prod) + ' 灵气/秒' +
          (lv >= 25 ? '（周天加成已激活）' : '（25 级产出翻倍）') + '</div>' +
      '</div>' +
      '<button class="gen-buy">招募 ×' + buyMode + '<small>' + fmt(genCost(g, buyMode)) + ' 灵气</small></button>';
    card.querySelector('.gen-buy').addEventListener('click', () => buyGen(g));
    el.genList.appendChild(card);
    shopRefs.gens.push({ g, btn: card.querySelector('.gen-buy') });
  });

  el.upList.innerHTML = '';
  shopRefs.ups = [];
  UPS.forEach((u) => {
    const owned = !!state.ups[u.id];
    if (!owned && !u.unlock()) return;
    const card = document.createElement('div');
    card.className = 'up-card' + (owned ? ' owned' : '');
    card.innerHTML =
      '<div class="up-info">' +
        '<div class="up-name">' + u.name + '</div>' +
        '<div class="up-desc">' + u.desc + (owned ? ' · 已修成' : '') + '</div>' +
      '</div>' +
      '<button class="up-buy"' + (owned ? ' disabled' : '') + '>' +
        (owned ? '已 修 成' : '参 悟<small>' + fmt(u.cost) + ' 灵气</small>') +
      '</button>';
    if (!owned) card.querySelector('.up-buy').addEventListener('click', () => buyUp(u));
    el.upList.appendChild(card);
    if (!owned) shopRefs.ups.push({ u, btn: card.querySelector('.up-buy') });
  });
  refreshShopAfford();
}

function refreshShopAfford() {
  shopRefs.gens.forEach(({ g, btn }) => { btn.disabled = state.qi < genCost(g, buyMode); });
  shopRefs.ups.forEach(({ u, btn }) => { btn.disabled = state.qi < u.cost; });
}
function shopSignature() {
  return GENS.map((g, i) => (genUnlocked(g, i) ? '1' : '0')).join('') + '|' +
         UPS.map((u) => (state.ups[u.id] ? '1' : (u.unlock() ? 'v' : '0'))).join('');
}
function tickShop() {
  const sig = shopSignature();
  if (sig !== lastSig) { lastSig = sig; renderShop(); }
  else refreshShopAfford();
}

/* ---------------- 转世轮回 ---------------- */
const PRESTIGE_REQ = 1e6;
function daoyunGain() { return Math.floor(Math.sqrt(state.totalRun / PRESTIGE_REQ) * petDyMult()); }
function renderPrestige() {
  const gain = daoyunGain();
  const can = gain >= 1;
  el.btnPrestige.disabled = !can;
  el.prestigeReq.textContent = can
    ? '轮回可得 ' + fmt(gain) + ' 点道韵'
    : '本世累计 ' + fmt(state.totalRun) + ' / ' + fmt(PRESTIGE_REQ) + ' 灵气后可轮回';
}
function doPrestige() {
  const gain = daoyunGain();
  if (gain < 1) return;
  if (!confirm('转世轮回将散尽修为（灵气 / 弟子 / 功法 / 境界清零），\n换取 ' + gain + ' 点道韵（每点永久 +2% 产出）。\n\n确定转世？')) return;
  state.daoyun += gain;
  state.runs++;
  state.qi = 0; state.totalRun = 0; state.realm = 0;
  state.gens = {}; state.ups = {};
  saveState();
  renderMain(); renderShop(); renderPrestige();
  switchTab('main');
}

/* ---------------- 存档导入导出 ---------------- */
function encodeSave() { return btoa(unescape(encodeURIComponent(JSON.stringify(state)))); }
function decodeSave(str) { return JSON.parse(decodeURIComponent(escape(atob(str)))); }
function resetGame() {
  Object.assign(state, defaultState());
  saveState();
  renderMain(); renderShop(); renderPrestige();
}

/* ---------------- 主循环 ---------------- */
let lastTick = performance.now();
let shopTimer = 0;
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
  if (now - shopTimer > 250) { shopTimer = now; tickShop(); renderPrestige(); }
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

  document.querySelectorAll('.mode-btn').forEach((b) =>
    b.addEventListener('click', () => {
      buyMode = Number(b.dataset.mode);
      document.querySelectorAll('.mode-btn').forEach((x) =>
        x.classList.toggle('active', x === b));
      renderShop();
    }));

  $('btnSettings').addEventListener('click', () => { renderAchs(); openModal('modalSettings'); });
  $('btnSettingsClose').addEventListener('click', () => closeModal('modalSettings'));
  $('btnOffOk').addEventListener('click', () => closeModal('modalOffline'));
  document.querySelectorAll('.modal').forEach((m) =>
    m.addEventListener('click', (e) => { if (e.target === m) { closeModal(m.id); if (m.id === 'modalTrib') tribModalOpen = false; } }));

  el.btnBreak.addEventListener('click', doBreakthrough);
  el.btnPrestige.addEventListener('click', doPrestige);

  $('btnExport').addEventListener('click', () => {
    saveState();
    const code = encodeSave();
    $('importArea').value = code;
    $('importArea').select();
    if (navigator.clipboard) navigator.clipboard.writeText(code).catch(() => {});
    alert('存档码已生成并复制到剪贴板（文本框中同时显示）');
  });
  $('btnImport').addEventListener('click', () => {
    const str = $('importArea').value.trim();
    if (!str) { alert('请先在文本框粘贴存档码'); return; }
    try {
      const data = decodeSave(str);
      if (typeof data.qi !== 'number' || typeof data.realm !== 'number') throw new Error('bad');
      Object.assign(state, defaultState(), data);
      saveState();
      renderMain(); renderShop();
      alert('导入成功，欢迎回到仙途！');
      closeModal('modalSettings');
    } catch (e) { alert('存档码无效，请检查后重试'); }
  });
  $('btnReset').addEventListener('click', () => {
    if (!confirm('确定重置全部修行进度？此操作不可恢复！')) return;
    if (!confirm('再次确认：真的要从炼气期重新开始吗？')) return;
    resetGame();
    alert('大道重开，道友请重新修行～');
    closeModal('modalSettings');
  });
}

/* ---------------- 启动 ---------------- */
function init() {
  cacheEls();
  loadState();
  bindUI();
  applyOffline();
  renderMain();
  lastSig = '';
  tickShop();
  renderPrestige();
  renderPet();
  checkAchs(true); // 老存档已有达标的成就先静默补记，不刷提示
  requestAnimationFrame(tick);

  setInterval(saveState, 5000);
  window.addEventListener('beforeunload', saveState);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveState();
  });
}

init();
