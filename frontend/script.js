// ==============================
// CONFIGURACIÓN
// ==============================
const API_BASE_URL = "https://donut-clash-rho.vercel.app/api";

// ==============================
// ESTADO GLOBAL
// ==============================
const state = {
  username: null,
  sessionToken: null,
  clientSeed: null,
  balance: 0,
  pollingInterval: null,
  view: "home",
  roundActive: false,
  mines: null,
  crash: null,
  balanceLoop: null,
};

function getOrCreateClientSeed() {
  if (state.clientSeed) return state.clientSeed;
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  state.clientSeed = Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
  return state.clientSeed;
}

// ==============================
// ELEMENTOS DEL DOM
// ==============================
const balanceValue = document.getElementById("balanceValue");
const signInBtn = document.getElementById("signInBtn");
const registerBtn = document.getElementById("registerBtn");
const langSelect = document.getElementById("langSelect");

const authModal = document.getElementById("authModal");
const modalClose = document.getElementById("modalClose");
const modalStep1 = document.getElementById("modalStep1");
const modalStep2 = document.getElementById("modalStep2");
const modalAlreadyLinked = document.getElementById("modalAlreadyLinked");
const modalAlreadyCloseBtn = document.getElementById("modalAlreadyCloseBtn");

const mcUsername = document.getElementById("mcUsername");
const generateBtn = document.getElementById("generateBtn");
const cancelLinkBtn = document.getElementById("cancelLinkBtn");
const payCommand = document.getElementById("payCommand");
const linkError = document.getElementById("linkError");

const homeView = document.getElementById("homeView");
const gameView = document.getElementById("gameView");
const toastContainer = document.getElementById("toastContainer");

// ==============================
// IDIOMA
// ==============================
langSelect.addEventListener("change", () => setLanguage(langSelect.value));
applyTranslations(); // aplica "en" por defecto al cargar

// ==============================
// UTILIDADES
// ==============================
function showError(msg){
  linkError.textContent = msg;
  linkError.classList.remove("hidden");
}
function clearError(){
  linkError.classList.add("hidden");
  linkError.textContent = "";
}
async function apiFetch(path, options = {}){
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || "Network error"); e.status = res.status; e.data = data; throw e; }
  return data;
}
function updateBalanceDisplay(){
  balanceValue.textContent = state.balance;
}

// ==============================
// MODAL: abrir / cerrar
// ==============================
function openModal(){
  authModal.classList.remove("hidden");
  if (state.sessionToken){
    modalStep1.classList.add("hidden");
    modalStep2.classList.add("hidden");
    modalAlreadyLinked.classList.remove("hidden");
  } else {
    modalAlreadyLinked.classList.add("hidden");
    modalStep2.classList.add("hidden");
    modalStep1.classList.remove("hidden");
  }
}
function closeModal(){
  authModal.classList.add("hidden");
}

signInBtn.addEventListener("click", openModal);
registerBtn.addEventListener("click", openModal);
modalClose.addEventListener("click", closeModal);
modalAlreadyCloseBtn.addEventListener("click", closeModal);
authModal.addEventListener("click", (e) => { if (e.target === authModal) closeModal(); });

// ==============================
// PASO 1: GENERAR CÓDIGO
// ==============================
generateBtn.addEventListener("click", async () => {
  const username = mcUsername.value.trim();
  clearError();

  if (!username) {
    showError(t("error.usernameRequired"));
    return;
  }

  generateBtn.disabled = true;

  try {
    const data = await apiFetch("/generate-code", {
      method: "POST",
      body: JSON.stringify({ minecraft_username: username }),
    });

    state.username = username;
    payCommand.textContent = `/pay Donaciones ${data.code}`;

    modalStep1.classList.add("hidden");
    modalStep2.classList.remove("hidden");

    startPolling();
  } catch (err) {
    showError(t("error.genericPrefix") + err.message);
  } finally {
    generateBtn.disabled = false;
  }
});

cancelLinkBtn.addEventListener("click", () => {
  stopPolling();
  modalStep2.classList.add("hidden");
  modalStep1.classList.remove("hidden");
  state.username = null;
});

// ==============================
// POLLING: COMPROBAR VINCULACIÓN
// ==============================
function startPolling(){
  stopPolling();
  state.pollingInterval = setInterval(checkLinkStatus, 5000);
  checkLinkStatus();
}
function stopPolling(){
  if (state.pollingInterval) {
    clearInterval(state.pollingInterval);
    state.pollingInterval = null;
  }
}

async function checkLinkStatus(){
  if (!state.username) return;
  try {
    const data = await apiFetch(`/user/${encodeURIComponent(state.username)}`);
    if (data.status === "linked") {
      stopPolling();
      try {
        const session = await apiFetch("/claim-session", {
          method: "POST",
          body: JSON.stringify({ minecraft_username: state.username }),
        });
        state.sessionToken = session.session_token;
        try { localStorage.setItem("dc_session", JSON.stringify({ u: state.username, t: state.sessionToken })); } catch (e) {}
      } catch (err) {
        console.error("Could not claim session:", err.message);
      }
      state.balance = data.balance || 0;
      updateBalanceDisplay();
      closeModal();
      startBalanceLoop();
    }
  } catch (err) {
    // Silencioso: el usuario aún no ha completado el pago.
  }
}

async function refreshBalance(){
  if (!state.username) return;
  try {
    const data = await apiFetch(`/user/${encodeURIComponent(state.username)}`);
    state.balance = data.balance;
    updateBalanceDisplay();
  } catch (err) {
    console.error("Could not refresh balance:", err.message);
  }
}

// ==============================
// UTILIDADES DE JUEGO
// ==============================
const $ = (id) => document.getElementById(id);
const getBet = () => Math.floor(Number($("betAmount").value)) || 0;
const say = (txt) => { $("gameMessage").textContent = txt; };
const wonText = (m, p) => `${t("game.crash.wonPrefix")}${m.toFixed(2)}${t("game.crash.wonMiddle")}${p} ${t("donuts")}.`;

function startBalanceLoop(){
  if (!state.balanceLoop) state.balanceLoop = setInterval(refreshBalance, 5000);
}
function setBalance(n){ state.balance = n; updateBalanceDisplay(); }

function showToast(msg, { type = "info", actionKey, onAction } = {}){
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  const span = document.createElement("span");
  span.textContent = msg;
  el.appendChild(span);
  if (actionKey) {
    const b = document.createElement("button");
    b.className = "toast-action";
    b.textContent = t(actionKey);
    b.onclick = () => { onAction(); el.remove(); };
    el.appendChild(b);
  }
  const x = document.createElement("button");
  x.className = "toast-close";
  x.textContent = "×";
  x.onclick = () => el.remove();
  el.appendChild(x);
  toastContainer.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

// Los invitados pueden ver todos los juegos, pero apostar exige sesión.
function requireSession(){
  if (state.sessionToken) return true;
  showToast(t("toast.signInRequired"), { type: "error", actionKey: "nav.signIn", onAction: openModal });
  return false;
}
function validBet(){
  if (!requireSession()) return 0;
  const bet = getBet();
  if (bet < 1) showToast(t("error.invalidBet"), { type: "error" });
  return bet;
}
const call = (path, body) => apiFetch(path, {
  method: "POST",
  body: JSON.stringify({ minecraft_username: state.username, session_token: state.sessionToken, ...body }),
});
const fail = (e) => showToast(e.message, { type: "error" });

// ==============================
// NAVEGACIÓN ENTRE INICIO Y JUEGOS
// ==============================
const GAMES = { mines: renderMines, crash: renderCrash, coinflip: renderCoinflip };

function navigate(name){
  if (name === state.view) return;
  if (state.roundActive) { showToast(t("toast.finishRound"), { type: "error" }); return; }
  state.view = name;
  document.querySelectorAll(".sidebar-item").forEach((b) => b.classList.toggle("active", (b.dataset.game || b.dataset.view) === name));
  homeView.classList.toggle("hidden", name !== "home");
  gameView.classList.toggle("hidden", name === "home");
  if (name !== "home") { GAMES[name](); applyTranslations(); }
}
document.querySelectorAll("[data-game], [data-view]").forEach((el) =>
  el.addEventListener("click", () => navigate(el.dataset.game || el.dataset.view)));
$("logoLink").addEventListener("click", () => navigate("home"));

// ==============================
// LAYOUT: escenario del juego + panel lateral de apuesta
// ==============================
function layout(stageHTML, extraHTML, actionKey){
  gameView.innerHTML = `
    <div class="game-layout">
      <div class="game-stage">${stageHTML}</div>
      <aside class="bet-panel">
        <div class="bet-tabs">
          <button class="bet-tab active" data-i18n="bet.manual">Manual</button>
          <button class="bet-tab" disabled data-i18n="bet.auto">Auto</button>
        </div>
        <label class="bet-label" data-i18n="bet.amount">Bet Amount</label>
        <div class="bet-row">
          <input type="number" id="betAmount" min="1" value="10">
          <button class="chip" id="betHalf">½</button>
          <button class="chip" id="betDouble">2x</button>
          <button class="chip" id="betMax" data-i18n="bet.max">Max</button>
        </div>
        ${extraHTML}
        <button id="actionBtn" class="btn-primary btn-lg" data-i18n="${actionKey}"></button>
        <p id="gameMessage" class="muted small"></p>
      </aside>
    </div>`;
  $("betHalf").onclick = () => { $("betAmount").value = Math.max(1, Math.floor(getBet() / 2)); };
  $("betDouble").onclick = () => { $("betAmount").value = Math.max(1, getBet() * 2); };
  $("betMax").onclick = () => { $("betAmount").value = Math.max(1, Math.floor(state.balance)); };
}
function lockPanel(locked){
  state.roundActive = locked;
  gameView.querySelectorAll(".bet-panel input, .bet-panel .chip").forEach((e) => { e.disabled = locked; });
}
function setAction(key){
  const b = $("actionBtn");
  b.setAttribute("data-i18n", key);
  b.textContent = t(key);
}

// ---------- COINFLIP ----------
function renderCoinflip(){
  layout(
    `<div class="stage-title">🪙 <span data-i18n="game.coinflip.name">Coinflip</span></div><div class="coin" id="coin">🪙</div>`,
    `<label class="bet-label" data-i18n="game.coinflip.pick">Pick a side</label>
     <div class="bet-row">
       <button class="chip side active" data-side="heads" data-i18n="game.coinflip.heads">Heads</button>
       <button class="chip side" data-side="tails" data-i18n="game.coinflip.tails">Tails</button>
     </div>`, "bet.placeBet");
  const sides = gameView.querySelectorAll(".side");
  sides.forEach((b) => { b.onclick = () => { sides.forEach((x) => x.classList.remove("active")); b.classList.add("active"); }; });
  $("actionBtn").onclick = async () => {
    const bet = validBet();
    if (bet < 1) return;
    const choice = gameView.querySelector(".side.active").dataset.side;
    $("actionBtn").disabled = true;
    try {
      const d = await call("/bet/coinflip", { bet_amount: bet, choice, client_seed: getOrCreateClientSeed() });
      $("coin").textContent = d.result === "heads" ? "😀" : "🌑";
      say(d.won ? `${t("game.coinflip.won")}${d.payout} ${t("donuts")}.` : `${t("game.coinflip.lost")}${bet} ${t("donuts")}.`);
      setBalance(d.balance);
    } catch (e) { fail(e); }
    $("actionBtn").disabled = false;
  };
}

// ---------- MINES ----------
function renderMines(){
  layout(
    `<div class="stage-title">💣 <span data-i18n="game.mines.name">Mines</span></div><div class="mines-grid" id="minesGrid"></div>`,
    `<label class="bet-label" data-i18n="game.mines.bombs">Bombs</label>
     <input type="number" id="bombs" min="1" max="24" value="3">`, "bet.placeBet");
  const grid = $("minesGrid");
  for (let i = 0; i < 25; i++){
    const tile = document.createElement("div");
    tile.className = "mine-tile";
    tile.textContent = "?";
    tile.onclick = () => revealTile(i, tile);
    grid.appendChild(tile);
  }
  $("actionBtn").onclick = () => (state.mines ? minesCashout() : minesStart());
}

async function minesStart(){
  const bet = validBet();
  if (bet < 1) return;
  try {
    const d = await call("/mines/start", { bet_amount: bet, bombs_count: Number($("bombs").value) || 0, client_seed: getOrCreateClientSeed() });
    state.mines = { id: d.game_id };
    gameView.querySelectorAll(".mine-tile").forEach((x) => { x.className = "mine-tile"; x.textContent = "?"; });
    lockPanel(true);
    setAction("bet.cashOut");
    say("");
    refreshBalance();
  } catch (e) { fail(e); }
}

async function revealTile(i, tile){
  if (!state.mines) { requireSession(); return; }
  if (tile.dataset.busy || tile.classList.contains("revealed-safe")) return;
  tile.dataset.busy = 1;
  try {
    const d = await call("/mines/reveal", { game_id: state.mines.id, tile_index: i });
    if (d.result === "bomb"){
      tile.classList.add("revealed-bomb");
      tile.textContent = "💣";
      say(t("game.mines.boom"));
      endMines(d.bomb_positions);
    } else {
      tile.classList.add("revealed-safe");
      tile.textContent = "💎";
      say(`${t("game.mines.multiplierPrefix")}${d.current_multiplier.toFixed(2)}x` + (d.board_fully_cleared ? t("game.mines.boardCleared") : ""));
    }
  } catch (e) { fail(e); }
  delete tile.dataset.busy;
}

async function minesCashout(){
  try {
    const d = await call("/mines/cashout", { game_id: state.mines.id });
    say(wonText(d.multiplier, d.payout));
    setBalance(d.balance);
    endMines(d.bomb_positions);
  } catch (e) { fail(e); }
}

function endMines(bombs){
  state.mines = null;
  lockPanel(false);
  setAction("bet.placeBet");
  const tiles = gameView.querySelectorAll(".mine-tile");
  (bombs || []).forEach((i) => {
    if (!tiles[i].classList.contains("revealed-bomb")) { tiles[i].classList.add("revealed-bomb"); tiles[i].textContent = "💣"; }
  });
}

// ---------- CRASH ----------
function renderCrash(){
  layout(
    `<div class="stage-title">📈 <span data-i18n="game.crash.name">Crash</span></div>
     <div class="crash-center"><div class="crash-display" id="crashMult">1.00x</div><div class="muted" data-i18n="game.crash.currentPayout">CURRENT PAYOUT</div></div>`,
    `<label class="bet-label" data-i18n="bet.autoCashout">Auto Cashout</label>
     <div class="bet-row">
       <input type="number" id="autoAt" min="1.01" step="0.01" placeholder="—">
       <button class="chip" data-at="2">2x</button><button class="chip" data-at="10">10x</button>
     </div>`, "bet.placeBet");
  gameView.querySelectorAll("[data-at]").forEach((b) => { b.onclick = () => { $("autoAt").value = b.dataset.at; }; });
  $("actionBtn").onclick = () => (state.crash ? crashCash() : crashStart());
}

async function crashStart(){
  const bet = validBet();
  if (bet < 1) return;
  try {
    const d = await call("/crash/start", { bet_amount: bet, client_seed: getOrCreateClientSeed() });
    state.crash = { id: d.game_id, t0: Date.now(), rate: d.growth_rate, auto: parseFloat($("autoAt").value) || 0 };
    lockPanel(true);
    setAction("bet.cashOut");
    say("");
    refreshBalance();
    crashTick();
  } catch (e) { fail(e); }
}

function crashTick(){
  const c = state.crash;
  if (!c) return;
  const m = Math.exp(c.rate * (Date.now() - c.t0) / 1000);
  $("crashMult").textContent = m.toFixed(2) + "x";
  if (c.auto && m >= c.auto) { crashCash(); return; }
  c.raf = requestAnimationFrame(crashTick);
}

async function crashCash(){
  const c = state.crash;
  if (!c || c.busy) return;
  c.busy = true;
  cancelAnimationFrame(c.raf);
  try {
    const d = await call("/crash/cashout", { game_id: c.id });
    if (d.result === "crashed"){
      $("crashMult").textContent = d.crash_point.toFixed(2) + "x";
      say(t("game.crash.crashed"));
    } else {
      $("crashMult").textContent = d.multiplier.toFixed(2) + "x";
      say(wonText(d.multiplier, d.payout));
      setBalance(d.balance);
    }
    state.crash = null;
    lockPanel(false);
    setAction("bet.placeBet");
  } catch (e) {
    c.busy = false;
    fail(e);
    c.raf = requestAnimationFrame(crashTick);
  }
}

// ==============================
// RESTAURAR SESIÓN GUARDADA
// ==============================
try {
  const saved = JSON.parse(localStorage.getItem("dc_session") || "null");
  if (saved && saved.u && saved.t) {
    state.username = saved.u;
    state.sessionToken = saved.t;
    refreshBalance();
    startBalanceLoop();
  }
} catch (e) {}

// ==============================
// BÚSQUEDA DE JUEGOS + DESBLOQUEO OCULTO DE ESTADÍSTICAS
// ==============================
const gameSearch = document.getElementById("gameSearch");
const searchClear = document.getElementById("searchClear");
const adminStatsView = document.getElementById("adminStatsView");
const gamesGrid = document.querySelector(".games-grid");
let adminCheckTimer = null;

function matchScore(query, card){
  const name = card.querySelector("h3").textContent.toLowerCase();
  const desc = card.querySelector("p").textContent.toLowerCase();
  if (name === query) return 3;
  if (name.startsWith(query)) return 2;
  if (name.includes(query) || desc.includes(query)) return 1;
  return 0;
}

function runGameSearch(raw){
  const query = raw.trim().toLowerCase();
  searchClear.classList.toggle("hidden", !raw);
  const cards = Array.from(gamesGrid.querySelectorAll(".game-card"));
  if (!query){
    cards.forEach((c) => { c.style.order = ""; c.classList.remove("dimmed"); });
    return;
  }
  cards
    .map((c) => ({ c, score: matchScore(query, c) }))
    .sort((a, b) => b.score - a.score)
    .forEach(({ c, score }, i) => {
      c.style.order = i;
      c.classList.toggle("dimmed", score === 0);
    });
}

gameSearch.addEventListener("input", () => {
  const raw = gameSearch.value;
  runGameSearch(raw);
  hideAdminStats();

  clearTimeout(adminCheckTimer);
  adminCheckTimer = setTimeout(() => tryAdminUnlock(raw.trim()), 400);
});

searchClear.addEventListener("click", () => {
  gameSearch.value = "";
  runGameSearch("");
  hideAdminStats();
  gameSearch.focus();
});

async function tryAdminUnlock(candidateKey){
  if (!candidateKey || candidateKey.length < 3) return; // muy corto para intentarlo, evita ruido mientras se escribe
  try {
    const stats = await apiFetch("/admin/stats", {
      method: "POST",
      body: JSON.stringify({ admin_password: candidateKey }),
    });
    renderAdminStats(stats);
  } catch (e) {
    // clave incorrecta: no pasa nada, se queda como búsqueda normal.
  }
}

function hideAdminStats(){
  adminStatsView.classList.add("hidden");
  adminStatsView.innerHTML = "";
  gamesGrid.parentElement.classList.remove("hidden");
}

function renderAdminStats(stats){
  gamesGrid.parentElement.classList.add("hidden");
  const rows = stats.per_game.map((g) => `
    <tr>
      <td>${g._id}</td><td>${g.total_bets}</td><td>${g.total_wagered}</td><td>${g.total_paid_out}</td>
      <td>${g.wins}</td><td>${g.losses}</td><td>${g.forced_losses}</td>
    </tr>`).join("");
  const t2 = stats.totals;
  adminStatsView.innerHTML = `
    <h2>${t("admin.title")}</h2>
    <p class="muted small">${t("admin.reserve")}: <strong>${Math.floor(stats.house_reserve)}</strong> ${t("donuts")}</p>
    <table class="admin-table">
      <thead><tr>
        <th>${t("admin.game")}</th><th>${t("admin.bets")}</th><th>${t("admin.wagered")}</th><th>${t("admin.paid")}</th>
        <th>${t("admin.wins")}</th><th>${t("admin.losses")}</th><th>${t("admin.forced")}</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>
        <td>${t("admin.totals")}</td><td>${t2.total_bets}</td><td>${t2.total_wagered}</td><td>${t2.total_paid_out}</td>
        <td>${t2.wins}</td><td>${t2.losses}</td><td>${t2.forced_losses}</td>
      </tr></tfoot>
    </table>
    <p class="muted small">${t("admin.edge")}: <strong>${(t2.observed_house_edge * 100).toFixed(1)}%</strong></p>
  `;
  adminStatsView.classList.remove("hidden");
}
