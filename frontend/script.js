// ==============================
// CONFIGURACIÓN
// ==============================
const API_BASE_URL = "https://donut-clash-rho.vercel.app/api";
const BOT_IGN = "rCrux"; // nombre real del bot dentro de Minecraft
const MIN_DEPOSIT = 10000;
const MIN_WITHDRAWAL = 10000;

// Convierte texto como "10k", "2.5M", "1B" (o un número normal) a donuts.
// Acepta mayúsculas/minúsculas y un punto decimal opcional antes del
// sufijo. Devuelve NaN si el texto no se puede interpretar, igual que
// Number() haría con cualquier otro texto inválido.
function parseShorthandAmount(raw) {
  const text = String(raw || "").trim();
  if (!text) return NaN;
  const match = text.match(/^([0-9]+(?:\.[0-9]+)?)\s*([kKmMbB])?$/);
  if (!match) return NaN;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return NaN;
  const suffix = (match[2] || "").toLowerCase();
  if (suffix === "k") return value * 1000;
  if (suffix === "m") return value * 1000000;
  if (suffix === "b") return value * 1000000000;
  return value;
}

// Inverso de parseShorthandAmount: convierte un número de donuts a su forma
// corta (50000000 -> "50M") para mostrarlo en el comando /pay que el
// usuario copia. Solo abrevia cuando el redondeo no pierde precisión
// (round-trip exacto); si no, muestra el número completo tal cual.
function formatShorthand(amount) {
  const units = [
    { suffix: "B", value: 1000000000 },
    { suffix: "M", value: 1000000 },
    { suffix: "K", value: 1000 },
  ];
  for (const { suffix, value } of units) {
    if (Math.abs(amount) >= value) {
      const scaled = Math.round((amount / value) * 100) / 100;
      if (scaled * value === amount) {
        return `${scaled}${suffix}`;
      }
    }
  }
  return String(amount);
}

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
const navAvatarBtn = document.getElementById("navAvatarBtn");
const navAvatarImg = document.getElementById("navAvatarImg");
const langSelect = document.getElementById("langSelect");

const walletBtn = document.getElementById("walletBtn");
const walletView = document.getElementById("walletView");
const walletAccountAvatar = document.getElementById("walletAccountAvatar");
const walletAccountUsername = document.getElementById("walletAccountUsername");
const walletBalanceValue = document.getElementById("walletBalanceValue");
const walletTabDeposit = document.getElementById("walletTabDeposit");
const walletTabWithdraw = document.getElementById("walletTabWithdraw");
const walletPanelDeposit = document.getElementById("walletPanelDeposit");
const walletPanelWithdraw = document.getElementById("walletPanelWithdraw");

const authModal = document.getElementById("authModal");
const modalClose = document.getElementById("modalClose");
const modalStep1 = document.getElementById("modalStep1");
const modalStep2 = document.getElementById("modalStep2");
const modalAlreadyLinked = document.getElementById("modalAlreadyLinked");
const modalAlreadyCloseBtn = document.getElementById("modalAlreadyCloseBtn");
const accountAvatarImg = document.getElementById("accountAvatarImg");
const accountUsername = document.getElementById("accountUsername");
const accountBalanceValue = document.getElementById("accountBalanceValue");
const logoutBtn = document.getElementById("logoutBtn");

const mcUsername = document.getElementById("mcUsername");
const generateBtn = document.getElementById("generateBtn");
const cancelLinkBtn = document.getElementById("cancelLinkBtn");
const payCommand = document.getElementById("payCommand");
const linkError = document.getElementById("linkError");
const skinPreview = document.getElementById("skinPreview");
const skinPreviewImg = document.getElementById("skinPreviewImg");
const skinPreviewName = document.getElementById("skinPreviewName");

const depositFromAvatar = document.getElementById("depositFromAvatar");
const depositFromName = document.getElementById("depositFromName");
const depositBotAvatar = document.getElementById("depositBotAvatar");
const depositBotName = document.getElementById("depositBotName");
const depositAmount = document.getElementById("depositAmount");
const depositContinueBtn = document.getElementById("depositContinueBtn");
const depositCommandBox = document.getElementById("depositCommandBox");
const depositPayCommand = document.getElementById("depositPayCommand");

const withdrawBotAvatar = document.getElementById("withdrawBotAvatar");
const withdrawBotName = document.getElementById("withdrawBotName");
const withdrawToAvatar = document.getElementById("withdrawToAvatar");
const withdrawToName = document.getElementById("withdrawToName");
const withdrawAmount = document.getElementById("withdrawAmount");
const withdrawMaxBtn = document.getElementById("withdrawMaxBtn");
const withdrawError = document.getElementById("withdrawError");
const withdrawPendingNotice = document.getElementById("withdrawPendingNotice");
const withdrawRequestBtn = document.getElementById("withdrawRequestBtn");

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
  if (accountBalanceValue) accountBalanceValue.textContent = state.balance;
  if (walletBalanceValue) walletBalanceValue.textContent = state.balance;
}

// Cambia Sign In / Register por la cabeza de Minecraft del jugador
// en cuanto hay una sesión vinculada, y muestra/oculta la carterita.
function updateAuthUI(){
  const linked = !!(state.sessionToken && state.username);
  signInBtn.classList.toggle("hidden", linked);
  registerBtn.classList.toggle("hidden", linked);
  navAvatarBtn.classList.toggle("hidden", !linked);
  walletBtn.classList.toggle("hidden", !linked);
  if (!linked && state.view === "wallet") navigate("home");
  if (linked) {
    navAvatarImg.src = `https://mc-heads.net/avatar/${encodeURIComponent(state.username)}/64`;
    navAvatarImg.alt = state.username;
    navAvatarBtn.title = state.username;
  }
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
    accountAvatarImg.src = `https://mc-heads.net/avatar/${encodeURIComponent(state.username)}/48`;
    accountUsername.textContent = state.username;
    accountBalanceValue.textContent = state.balance;
  } else {
    modalAlreadyLinked.classList.add("hidden");
    modalStep2.classList.add("hidden");
    modalStep1.classList.remove("hidden");
  }
}
function closeModal(){
  authModal.classList.add("hidden");
  mcUsername.value = "";
  hideSkinPreview();
}

signInBtn.addEventListener("click", openModal);
registerBtn.addEventListener("click", openModal);
navAvatarBtn.addEventListener("click", openModal);
modalClose.addEventListener("click", closeModal);
modalAlreadyCloseBtn.addEventListener("click", closeModal);
authModal.addEventListener("click", (e) => { if (e.target === authModal) closeModal(); });

logoutBtn.addEventListener("click", () => {
  state.username = null;
  state.sessionToken = null;
  state.balance = 0;
  stopBalanceLoop();
  try { localStorage.removeItem("dc_session"); } catch (e) {}
  updateBalanceDisplay();
  updateAuthUI();
  closeModal();
});

// ==============================
// CARTERITA (ahora abre la página de Wallet en vez de un desplegable)
// ==============================
walletBtn.addEventListener("click", () => {
  if (!requireSession()) return;
  navigate("wallet");
});

// ==============================
// WALLET VIEW: pestañas Deposit / Withdraw
// ==============================
function selectWalletTab(tab){
  walletTabDeposit.classList.toggle("active", tab === "deposit");
  walletTabWithdraw.classList.toggle("active", tab === "withdraw");
  walletPanelDeposit.classList.toggle("hidden", tab !== "deposit");
  walletPanelWithdraw.classList.toggle("hidden", tab !== "withdraw");
}
walletTabDeposit.addEventListener("click", () => selectWalletTab("deposit"));
walletTabWithdraw.addEventListener("click", () => selectWalletTab("withdraw"));

// Prepara (o refresca) toda la vista de Wallet: la tarjeta de cuenta y los
// dos paneles (Deposit/Withdraw) — se llama cada vez que se navega a ella.
async function renderWalletView(){
  walletAccountAvatar.src = `https://mc-heads.net/avatar/${encodeURIComponent(state.username)}/48`;
  walletAccountUsername.textContent = state.username;
  updateBalanceDisplay();
  selectWalletTab("deposit");

  // --- Deposit panel ---
  depositFromAvatar.src = `https://mc-heads.net/avatar/${encodeURIComponent(state.username)}/48`;
  depositFromName.textContent = state.username;
  depositBotAvatar.src = `https://mc-heads.net/avatar/${BOT_IGN}/48`;
  depositBotName.textContent = BOT_IGN;
  depositAmount.value = "";
  depositContinueBtn.disabled = true;
  depositCommandBox.classList.add("hidden");

  // --- Withdraw panel ---
  withdrawBotAvatar.src = `https://mc-heads.net/avatar/${BOT_IGN}/48`;
  withdrawBotName.textContent = BOT_IGN;
  withdrawToAvatar.src = `https://mc-heads.net/avatar/${encodeURIComponent(state.username)}/48`;
  withdrawToName.textContent = state.username;
  withdrawAmount.value = "";
  withdrawError.classList.add("hidden");
  withdrawPendingNotice.classList.add("hidden");
  withdrawRequestBtn.disabled = false;

  try {
    const data = await apiFetch(`/user-${encodeURIComponent(state.username)}`);
    if (data.has_pending_withdrawal) {
      withdrawPendingNotice.classList.remove("hidden");
      withdrawRequestBtn.disabled = true;
    }
  } catch (e) { /* no bloquea la vista si falla la consulta */ }
}

// ==============================
// DEPOSIT
// ==============================
depositAmount.addEventListener("input", () => {
  depositContinueBtn.disabled = !(Math.floor(parseShorthandAmount(depositAmount.value)) >= MIN_DEPOSIT);
  depositCommandBox.classList.add("hidden");
});
document.querySelectorAll(".amount-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    depositAmount.value = chip.dataset.amount;
    depositContinueBtn.disabled = false;
    depositCommandBox.classList.add("hidden");
  });
});
depositContinueBtn.addEventListener("click", () => {
  const amt = Math.floor(parseShorthandAmount(depositAmount.value));
  if (!(amt >= MIN_DEPOSIT)) return;
  depositPayCommand.textContent = `/pay ${BOT_IGN} ${formatShorthand(amt)}`;
  depositCommandBox.classList.remove("hidden");
});

// ==============================
// WITHDRAW
// ==============================
withdrawMaxBtn.addEventListener("click", () => {
  withdrawAmount.value = Math.max(0, Math.floor(state.balance));
});

withdrawRequestBtn.addEventListener("click", async () => {
  const amt = Math.floor(parseShorthandAmount(withdrawAmount.value));
  withdrawError.classList.add("hidden");
  if (!(amt >= MIN_WITHDRAWAL)) {
    withdrawError.textContent = t("withdraw.errorMin");
    withdrawError.classList.remove("hidden");
    return;
  }
  if (amt > state.balance) {
    withdrawError.textContent = t("withdraw.errorBalance");
    withdrawError.classList.remove("hidden");
    return;
  }
  withdrawRequestBtn.disabled = true;
  try {
    const data = await apiFetch("/account-withdraw-request", {
      method: "POST",
      body: JSON.stringify({ minecraft_username: state.username, session_token: state.sessionToken, amount: amt }),
    });
    setBalance(data.balance);
    showToast(t("withdraw.success"), { type: "info" });
    withdrawAmount.value = "";
  } catch (e) {
    withdrawError.textContent = e.message;
    withdrawError.classList.remove("hidden");
    withdrawRequestBtn.disabled = false;
  }
});

// ==============================
// VISTA PREVIA DE LA SKIN DE MINECRAFT
// (solo cosmético: no verifica que la cuenta exista ni que sea del jugador,
// simplemente consulta un servicio público de skins por nombre de usuario)
// ==============================
let skinPreviewTimer = null;

function hideSkinPreview(){
  skinPreview.classList.add("hidden");
  skinPreviewImg.src = "";
}

function showSkinPreview(username){
  skinPreviewImg.src = `https://mc-heads.net/avatar/${encodeURIComponent(username)}/96`;
  skinPreviewName.textContent = username;
  skinPreview.classList.remove("hidden");
}

mcUsername.addEventListener("input", () => {
  clearTimeout(skinPreviewTimer);
  const username = mcUsername.value.trim();
  if (username.length < 3) {
    hideSkinPreview();
    return;
  }
  skinPreviewTimer = setTimeout(() => showSkinPreview(username), 350);
});

skinPreviewImg.addEventListener("error", hideSkinPreview);

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
    const data = await apiFetch("/account-generate-code", {
      method: "POST",
      body: JSON.stringify({ minecraft_username: username }),
    });

    state.username = username;
    payCommand.textContent = `/pay ${BOT_IGN} ${data.code}`;

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
    const data = await apiFetch(`/user-${encodeURIComponent(state.username)}`);
    if (data.status === "linked") {
      stopPolling();
      try {
        const session = await apiFetch("/account-claim-session", {
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
      updateAuthUI();
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
    const data = await apiFetch(`/user-${encodeURIComponent(state.username)}`);
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
function stopBalanceLoop(){
  if (state.balanceLoop) {
    clearInterval(state.balanceLoop);
    state.balanceLoop = null;
  }
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
  walletView.classList.toggle("hidden", name !== "wallet");
  gameView.classList.toggle("hidden", name === "home" || name === "wallet");
  if (name === "wallet") { renderWalletView(); applyTranslations(); }
  else if (name !== "home") { GAMES[name](); applyTranslations(); }
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
      const d = await call("/games-bet-coinflip", { bet_amount: bet, choice, client_seed: getOrCreateClientSeed() });
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
    const d = await call("/games-mines-start", { bet_amount: bet, bombs_count: Number($("bombs").value) || 0, client_seed: getOrCreateClientSeed() });
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
    const d = await call("/games-mines-reveal", { game_id: state.mines.id, tile_index: i });
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
    const d = await call("/games-mines-cashout", { game_id: state.mines.id });
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
    const d = await call("/games-crash-start", { bet_amount: bet, client_seed: getOrCreateClientSeed() });
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
    const d = await call("/games-crash-cashout", { game_id: c.id });
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
    updateAuthUI();
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
    const stats = await apiFetch("/admin-stats", {
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
