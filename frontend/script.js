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
  level: 1,
  xpIntoLevel: 0,
  xpForNextLevel: 52,
  pollingInterval: null,
  view: "home",
  roundActive: false,
  mines: null,
  crash: null,
  cleanupGame: null,
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
const accountLevelValue = document.getElementById("accountLevelValue");
const accountXpInto = document.getElementById("accountXpInto");
const accountXpNext = document.getElementById("accountXpNext");
const accountXpFill = document.getElementById("accountXpFill");

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
// Solo para el saldo del header: 573210 -> "573.21K" (siempre 2 decimales, truncado).
function formatCompactBalance(n) {
  const v = Number(n) || 0;
  const units = [["T", 1e12], ["B", 1e9], ["M", 1e6], ["K", 1e3]];
  for (const [suffix, value] of units) {
    if (Math.abs(v) >= value) {
      return `${(Math.trunc((v / value) * 100) / 100).toFixed(2)}${suffix}`;
    }
  }
  return String(v);
}
function updateBalanceDisplay(){
  balanceValue.textContent = formatCompactBalance(state.balance);
  if (accountBalanceValue) accountBalanceValue.textContent = state.balance;
  if (walletBalanceValue) walletBalanceValue.textContent = state.balance;
}

// Refleja state.level / xpIntoLevel / xpForNextLevel en la barra de XP del
// modal de cuenta (la única pantalla que la muestra por ahora).
function updateXpDisplay(){
  if (!accountLevelValue) return;
  accountLevelValue.textContent = state.level;
  accountXpInto.textContent = state.xpIntoLevel;
  accountXpNext.textContent = state.xpForNextLevel;
  const pct = state.xpForNextLevel > 0 ? Math.min(100, (state.xpIntoLevel / state.xpForNextLevel) * 100) : 0;
  accountXpFill.style.width = `${pct}%`;
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
    updateXpDisplay();
    refreshBalance(); // trae el XP más reciente por si pasó algo desde el último poll
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
  depositSetPending(null);
  depositAmount.value = "";
  depositContinueBtn.disabled = true;
  depositCommandBox.classList.add("hidden");
  depositCheck();

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
    if (depositPending) return;
    depositAmount.value = chip.dataset.amount;
    depositContinueBtn.disabled = false;
    depositCommandBox.classList.add("hidden");
  });
});
let depositTimer = null;
let depositPollTimer = null;
let depositPending = null; // { amount, expires_at(ms) }

function stopDepositWatch() {
  clearInterval(depositTimer); clearInterval(depositPollTimer);
  depositTimer = depositPollTimer = null;
}
function depositRenderTimer() {
  if (!depositPending) return;
  const left = Math.max(0, depositPending.expires_at - Date.now());
  const m = Math.floor(left / 60000), sec = String(Math.floor((left % 60000) / 1000)).padStart(2, "0");
  depositContinueBtn.textContent = `${t("deposit.waiting")} ${m}:${sec}`;
  if (left <= 0) depositCheck();
}
function depositSetPending(p) {
  stopDepositWatch();
  depositPending = p ? { amount: p.amount, expires_at: new Date(p.expires_at).getTime() } : null;
  if (!p) {
    depositContinueBtn.textContent = t("deposit.continue");
    depositContinueBtn.classList.remove("waiting");
    depositAmount.disabled = false;
    depositContinueBtn.disabled = !(Math.floor(parseShorthandAmount(depositAmount.value)) >= MIN_DEPOSIT);
    return;
  }
  depositAmount.value = formatShorthand(p.amount);
  depositAmount.disabled = true;
  depositContinueBtn.disabled = true;
  depositContinueBtn.classList.add("waiting");
  depositPayCommand.textContent = `/pay ${BOT_IGN} ${formatShorthand(p.amount)}`;
  depositCommandBox.classList.remove("hidden");
  depositRenderTimer();
  depositTimer = setInterval(depositRenderTimer, 1000);
  depositPollTimer = setInterval(depositCheck, 3000);
}
async function depositCheck() {
  if (!state.username || !state.sessionToken) return stopDepositWatch();
  try {
    const data = await apiFetch("/account-deposit-status", {
      method: "POST",
      body: JSON.stringify({ minecraft_username: state.username, session_token: state.sessionToken }),
    });
    if (data.pending) {
      if (!depositPending) depositSetPending(data.pending);
      return;
    }
    const wasPending = !!depositPending;
    depositSetPending(null);
    if (wasPending) {
      const before = state.balance;
      await refreshBalance();
      if (state.balance > before) showToast(t("deposit.credited"), { type: "info" });
      else showToast(t("deposit.expired"), { type: "error" });
      depositAmount.value = "";
      depositContinueBtn.disabled = true;
      depositCommandBox.classList.add("hidden");
    }
  } catch (e) { /* reintenta en el siguiente ciclo */ }
}
depositContinueBtn.addEventListener("click", async () => {
  const amt = Math.floor(parseShorthandAmount(depositAmount.value));
  if (!(amt >= MIN_DEPOSIT) || depositPending) return;
  depositContinueBtn.disabled = true;
  try {
    const data = await apiFetch("/account-deposit-request", {
      method: "POST",
      body: JSON.stringify({ minecraft_username: state.username, session_token: state.sessionToken, amount: amt }),
    });
    depositSetPending(data);
  } catch (e) {
    showToast(e.message, { type: "error" });
    depositContinueBtn.disabled = false;
    depositCheck();
  }
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
    if (typeof data.level === "number") {
      state.level = data.level;
      state.xpIntoLevel = data.xp_into_level;
      state.xpForNextLevel = data.xp_for_next_level;
    }
    updateBalanceDisplay();
    updateXpDisplay();
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
  if (state.cleanupGame) { state.cleanupGame(); state.cleanupGame = null; }
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
function layout(stageHTML, extraHTML, actionKey, withDemo = false){
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
        ${withDemo ? `<button id="demoBtn" class="btn-demo btn-lg" data-i18n="bet.demo">Demo</button>` : ""}
        <p id="gameMessage" class="muted small"></p>
      </aside>
    </div>`;
  $("betHalf").onclick = () => { $("betAmount").value = Math.max(1, Math.floor(getBet() / 2)); };
  $("betDouble").onclick = () => { $("betAmount").value = Math.max(1, getBet() * 2); };
  $("betMax").onclick = () => { $("betAmount").value = Math.max(1, Math.floor(state.balance)); };
}
function lockPanel(locked){
  state.roundActive = locked;
  gameView.querySelectorAll(".bet-panel input, .bet-panel .chip, #demoBtn").forEach((e) => { e.disabled = locked; });
}
function setAction(key){
  const b = $("actionBtn");
  b.setAttribute("data-i18n", key);
  b.textContent = t(key);
}

// ---------- COINFLIP ----------
// La moneda es un cilindro 3D (cara = R / cruz = guion) que gira sobre su eje
// vertical. En reposo gira despacio; al lanzar da varias vueltas rápidas y
// aterriza mostrando el resultado (0° = cara, 180° = cruz).
let coinAnim = null;
let coinBusy = false;
// Pago mostrado arriba: el real es 1.85x; el
// Demo es 2x justo. Se muestra el que corresponde al modo en uso.
function setCoinPayout(demo){
  const el = $("coinPayout");
  if (el) el.textContent = demo ? t("bet.demo") : `1.85x ${t("game.coinflip.payoutLabel")}`;
}
// Muestra "You win" / "You lose" (o lo borra con null) bajo la moneda y en el panel.
let coinResultFade = null;
function showCoinResult(won){
  const txt = won === null ? "" : (won ? t("game.coinflip.youWin") : t("game.coinflip.youLose"));
  const el = $("coinResult");
  if (coinResultFade) { coinResultFade.cancel(); coinResultFade = null; }
  if (el) {
    el.textContent = txt; el.className = "coin-result" + (won === null ? "" : won ? " win" : " lose");
    // aparece, se mantiene un momento y se desvanece hasta desaparecer
    if (won !== null && el.animate) {
      coinResultFade = el.animate([{ opacity: 1 }, { opacity: 1, offset: 0.45 }, { opacity: 0 }], { duration: 1400, easing: "ease-out", fill: "forwards" });
    }
  }
}
function formatWonAmount(n) {
  const v = Number(n) || 0;
  return Math.abs(v) < 1000 ? v.toFixed(2) : formatCompactBalance(v);
}
// Anima "+cantidad" apareciendo junto al pago, subiendo con una flecha hasta el
// saldo del header y desapareciendo. Resuelve cuando termina (ahí se suma el saldo).
function flyWinToBalance(amount){
  const from = $("coinPayout"), to = balanceValue;
  if (!from || !to || !document.body.animate) return Promise.resolve();
  const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
  const el = document.createElement("div");
  el.className = "win-fly";
  el.textContent = `+${formatWonAmount(amount)}`;
  document.body.appendChild(el);
  const w = el.offsetWidth, h = el.offsetHeight;
  // Trayecto totalmente vertical: misma X (centro del saldo) de inicio a fin.
  const x = b.left + b.width / 2 - w / 2;
  const y0 = a.top + a.height / 2 - h / 2;
  const y1 = b.top + b.height / 2 - h / 2;
  el.style.left = "0"; el.style.top = "0";
  const T = (y, sc) => `translate(${x}px,${y}px) scale(${sc})`;
  const anim = el.animate([
    { transform: T(y0, 0.6), opacity: 0 },
    { transform: T(y0, 1.12), opacity: 1, offset: 0.16 },
    { transform: T(y0, 1), opacity: 1, offset: 0.26 },
    { transform: T(y0, 1), opacity: 1, offset: 0.36 },
    { transform: T(y1, 0.9), opacity: 1, offset: 0.86 },
    { transform: T(y1, 0.7), opacity: 0 },
  ], { duration: 1000, easing: "ease-in-out", fill: "forwards" });
  return anim.finished.catch(() => {}).then(() => {
    el.remove();
    spawnSparks(b.left + b.width / 2, b.top + b.height / 2);
  });
}
// Chispas verdes discretas al llegar al saldo.
function spawnSparks(cx, cy) {
  if (!document.body.animate) return;
  for (let i = 0; i < 8; i++) {
    const sp = document.createElement("i");
    sp.className = "win-spark";
    sp.style.left = `${cx - 2}px`; sp.style.top = `${cy - 2}px`;
    document.body.appendChild(sp);
    const ang = (Math.PI * 2 * i) / 8, d = 26 + Math.random() * 8;
    sp.animate([
      { transform: "translate(0,0) scale(1)", opacity: 1 },
      { transform: `translate(${Math.cos(ang) * d}px,${Math.sin(ang) * d}px) scale(.3)`, opacity: 0 },
    ], { duration: 420, easing: "ease-out" }).finished.catch(() => {}).then(() => sp.remove());
  }
}
// El saldo del header sube hasta el nuevo valor con un destello verde.
function countUpBalance(to) {
  const from = state.balance, start = performance.now(), dur = 450;
  balanceValue.style.display = "inline-block";
  if (balanceValue.animate) {
    balanceValue.animate([
      { transform: "scale(1)", color: "" },
      { transform: "scale(1.22)", color: "#36d399", offset: 0.35 },
      { transform: "scale(1)", color: "" },
    ], { duration: 600, easing: "ease-out" });
  }
  const step = (now) => {
    const k = Math.min(1, (now - start) / dur);
    state.balance = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
    updateBalanceDisplay();
    if (k < 1) requestAnimationFrame(step); else setBalance(to);
  };
  requestAnimationFrame(step);
}
let coinIdleTimer = null;
function coinIdle(startDeg = 0){
  const el = $("coin");
  if (!el || !el.animate) return;
  if (coinAnim) coinAnim.cancel();
  coinAnim = el.animate([{ transform: `rotateY(${startDeg}deg)` }, { transform: `rotateY(${startDeg + 360}deg)` }], { duration: 6000, iterations: Infinity });
}
function flipCoin(result){
  const el = $("coin");
  if (!el || !el.animate) return Promise.resolve();
  clearTimeout(coinIdleTimer);
  if (coinAnim) coinAnim.cancel();
  const end = (result === "heads" ? 0 : 180) + 360 * 6;
  coinAnim = el.animate(
    [{ transform: "rotateY(0deg) translateY(0)" }, { transform: `rotateY(${end * 0.5}deg) translateY(-26px)`, offset: 0.5 }, { transform: `rotateY(${end}deg) translateY(0)` }],
    { duration: 1700, easing: "cubic-bezier(.2,.7,.25,1)", fill: "forwards" });
  return coinAnim.finished.then(() => {
    el.style.transform = `rotateY(${result === "heads" ? 0 : 180}deg)`;
    coinAnim.cancel(); coinAnim = null;
    // Tras apostar, la moneda vuelve a girar lento (desde la cara en que aterrizó).
    coinIdleTimer = setTimeout(() => coinIdle(result === "heads" ? 0 : 180), 1200);
  }).catch(() => {});
}
function renderCoinflip(){
  layout(
    `<div class="coin-payout" id="coinPayout"></div><div class="coin-result" id="coinResult"></div><div class="coin-stage"><div class="coin3d" id="coin">${"<i class=\"coin-edge\"></i>".repeat(9)}<i class="coin-face coin-front"></i><i class="coin-face coin-back"></i></div></div>`,
    `<label class="bet-label" data-i18n="game.coinflip.pick">Pick a side</label>
     <div class="bet-row">
       <button class="chip side active" data-side="heads" data-i18n="game.coinflip.heads">Heads</button>
       <button class="chip side" data-side="tails" data-i18n="game.coinflip.tails">Tails</button>
     </div>`, "bet.placeBet", true);
  coinIdle();
  setCoinPayout(false);
  const sides = gameView.querySelectorAll(".side");
  sides.forEach((b) => { b.onclick = () => { sides.forEach((x) => x.classList.remove("active")); b.classList.add("active"); }; });
  // Demo: 50/50 realmente justo (pago 2x, sin margen de la casa) y sin
  // apostar nada — todo se resuelve aquí, no toca saldo ni servidor.
  $("demoBtn").onclick = () => {
    const choice = gameView.querySelector(".side.active").dataset.side;
    const r = new Uint32Array(1); crypto.getRandomValues(r);
    const result = r[0] % 2 === 0 ? "heads" : "tails";
    if (coinBusy) return;
    coinBusy = true; $("demoBtn").disabled = true; $("actionBtn").disabled = true;
    showCoinResult(null);
    setCoinPayout(true);
    flipCoin(result).then(() => {
      showCoinResult(result === choice);
      coinBusy = false; $("demoBtn").disabled = false; $("actionBtn").disabled = false;
    });
  };
  $("actionBtn").onclick = async () => {
    const bet = validBet();
    if (bet < 1) return;
    const choice = gameView.querySelector(".side.active").dataset.side;
    if (coinBusy) return;
    coinBusy = true; $("actionBtn").disabled = true; $("demoBtn").disabled = true;
    showCoinResult(null);
    setCoinPayout(false);
    try {
      const d = await call("/games-bet-coinflip", { bet_amount: bet, choice, client_seed: getOrCreateClientSeed() });
      await flipCoin(d.result);
      showCoinResult(d.won);
      if (d.won) {
        const won = Math.max(0, d.balance - state.balance + bet);
        await flyWinToBalance(won);
        countUpBalance(d.balance);
      } else {
        setBalance(d.balance);
      }
    } catch (e) { fail(e); }
    coinBusy = false; $("actionBtn").disabled = false; $("demoBtn").disabled = false;
  };
}

// ---------- MINES ----------
function renderMines(){
  layout(
    `<div class="stage-title">💣 <span data-i18n="game.mines.name">Mines</span></div><div class="mines-grid" id="minesGrid"></div>`,
    `<label class="bet-label" data-i18n="game.mines.bombs">Bombs</label>
     <input type="number" id="bombs" min="1" max="24" value="3">`, "bet.placeBet", true);
  const grid = $("minesGrid");
  for (let i = 0; i < 25; i++){
    const tile = document.createElement("div");
    tile.className = "mine-tile";
    tile.textContent = "?";
    tile.onclick = () => revealTile(i, tile);
    grid.appendChild(tile);
  }
  $("actionBtn").onclick = () => (state.mines ? minesCashout() : minesStart());
  $("demoBtn").onclick = minesDemoStart;
}

// Multiplicador JUSTO de Mines (sin margen de la casa) para el modo demo.
function minesFairMultiplier(revealed, bombs){
  let m = 1;
  for (let i = 0; i < revealed; i++) m *= (25 - i) / (25 - i - bombs);
  return m;
}
function minesDemoStart(){
  const bombs = Math.min(24, Math.max(1, Math.floor(Number($("bombs").value)) || 3));
  const idx = Array.from({ length: 25 }, (_, i) => i);
  const rnd = new Uint32Array(25); crypto.getRandomValues(rnd);
  for (let i = 24; i > 0; i--) { const j = rnd[i] % (i + 1); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  state.mines = { demo: true, bombsCount: bombs, bombs: new Set(idx.slice(0, bombs)), revealed: 0 };
  gameView.querySelectorAll(".mine-tile").forEach((x) => { x.className = "mine-tile"; x.textContent = "?"; });
  lockPanel(true);
  setAction("bet.cashOut");
  say(t("bet.demoTag"));
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
  if (state.mines.demo) {
    if (tile.classList.contains("revealed-safe")) return;
    const m = state.mines;
    if (m.bombs.has(i)) {
      tile.classList.add("revealed-bomb"); tile.textContent = "💣";
      say(`${t("bet.demoTag")} ${t("game.mines.boom")}`);
      endMines([...m.bombs]);
    } else {
      m.revealed += 1;
      tile.classList.add("revealed-safe"); tile.textContent = "💎";
      say(`${t("bet.demoTag")} ${t("game.mines.multiplierPrefix")}${minesFairMultiplier(m.revealed, m.bombsCount).toFixed(2)}x`);
    }
    return;
  }
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
  if (state.mines && state.mines.demo) {
    const m = state.mines;
    if (m.revealed === 0) { say(`${t("bet.demoTag")} ${t("game.mines.revealFirst")}`); return; }
    say(`${t("bet.demoTag")} ${t("game.mines.demoCashed")}${minesFairMultiplier(m.revealed, m.bombsCount).toFixed(2)}x`);
    endMines([...m.bombs]);
    return;
  }
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

// ---------- CRASH (ronda global compartida por todos los jugadores) ----------
// A diferencia de Mines/Coinflip, aquí no hay "mi partida": hay UNA ronda a
// la vez (betting -> running -> crashed) que todos ven igual. El frontend
// sondea /games-crash-state ~1 vez por segundo para mantenerse sincronizado
// con el servidor (que es la única fuente de verdad de los tiempos), y usa
// requestAnimationFrame solo para interpolar el multiplicador entre sondeos
// y que se vea fluido, nunca para decidir nada por sí mismo.
// Dimensiones internas del gráfico (unidades del viewBox, no píxeles reales
// — el SVG escala solo). Dejan espacio a la derecha/abajo para las
// etiquetas de los ejes.
const CRASH_GRAPH = { left: 10, top: 16, right: 54, bottom: 90, width: 1000, height: 480 };

function renderCrash(){
  layout(
    `<div class="stage-title">📈 <span data-i18n="game.crash.name">Crash</span></div>
     <div class="crash-wrap">
       <div class="crash-readout">
         <div class="crash-display" id="crashMult">1.00<sup>x</sup></div>
         <div class="crash-sub" id="crashStatusLine" data-i18n="game.crash.currentPayout">CURRENT PAYOUT</div>
       </div>
       <svg id="crashSvg" class="crash-svg" viewBox="0 0 1000 480" preserveAspectRatio="none">
         <defs>
           <linearGradient id="crashFillGrad" x1="0" y1="0" x2="0" y2="1">
             <stop offset="0%" stop-color="#f6c343" stop-opacity="0.55"/>
             <stop offset="100%" stop-color="#f6c343" stop-opacity="0"/>
           </linearGradient>
         </defs>
         <g id="crashAxisY"></g>
         <path id="crashArea" class="crash-area" d=""></path>
         <path id="crashLine" class="crash-line" d=""></path>
         <g id="crashAxisX"></g>
         <text id="crashRocket" class="crash-rocket" x="0" y="0" style="opacity:0">🚀</text>
       </svg>
     </div>
     <div class="crash-history" id="crashHistory"></div>
     <div class="crash-players muted small" id="crashPlayers"></div>`,
    `<label class="bet-label" data-i18n="bet.autoCashout">Auto Cashout</label>
     <div class="bet-row">
       <input type="number" id="autoAt" min="1.01" step="0.01" placeholder="—">
       <button class="chip" data-at="2">2x</button><button class="chip" data-at="10">10x</button>
     </div>`, "game.crash.join");
  gameView.querySelectorAll("[data-at]").forEach((b) => { b.onclick = () => { $("autoAt").value = b.dataset.at; }; });
  $("actionBtn").onclick = crashAction;

  state.crash = { round: null, joined: false, cashedOut: false, auto: 0, busy: false, raf: null, pollHandle: null };
  state.cleanupGame = crashStop;
  crashRenderAxes(8, 2);
  crashPoll();
  state.crash.pollHandle = setInterval(crashPoll, 1000);
  state.crash.raf = requestAnimationFrame(crashTick);
}

// ---- Gráfico de Crash: curva animada del despegue, SVG dibujado a mano ----
// Redondea a un "paso" de rejilla agradable (1/2/5/10 x 10^n) para que las
// etiquetas de los ejes no muestren números feos al reescalar en vivo.
function crashNiceStep(rough){
  if (!(rough > 0)) return 1;
  const pow10 = Math.pow(10, Math.floor(Math.log10(rough)));
  const frac = rough / pow10;
  let niceFrac;
  if (frac < 1.5) niceFrac = 1;
  else if (frac < 3) niceFrac = 2;
  else if (frac < 7) niceFrac = 5;
  else niceFrac = 10;
  return niceFrac * pow10;
}
function crashYTicks(maxM){
  const range = Math.max(maxM - 1, 0.001);
  const step = crashNiceStep(range / 3);
  const ticks = [];
  for (let v = step; v <= range + step * 0.001 && ticks.length < 4; v += step) ticks.push(1 + v);
  return ticks;
}
function crashXTicks(maxT){
  const step = crashNiceStep(maxT / 3);
  const ticks = [];
  for (let v = step; v <= maxT + step * 0.001 && ticks.length < 4; v += step) ticks.push(v);
  return ticks;
}
function crashBuildPath(points){
  if (!points.length) return "";
  return "M" + points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L");
}
function crashBuildArea(points, baselineY){
  if (!points.length) return "";
  const first = points[0], last = points[points.length - 1];
  return `${crashBuildPath(points)} L${last.x.toFixed(1)},${baselineY} L${first.x.toFixed(1)},${baselineY} Z`;
}

// Redibuja solo las líneas/etiquetas de la rejilla para el rango visible
// actual (se llama en cada frame porque el rango se va "alejando" a medida
// que sube el multiplicador, como en cualquier juego de crash).
function crashRenderAxes(maxT, maxM){
  const g = CRASH_GRAPH;
  const plotW = g.width - g.left - g.right;
  const plotH = g.height - g.top - g.bottom;
  const baselineY = g.top + plotH;

  const yEl = $("crashAxisY");
  if (yEl) {
    yEl.innerHTML = crashYTicks(maxM).map((m) => {
      const y = g.top + (1 - (m - 1) / Math.max(maxM - 1, 0.001)) * plotH;
      return `<line x1="${g.left}" y1="${y.toFixed(1)}" x2="${g.left + plotW}" y2="${y.toFixed(1)}" class="crash-grid"></line>` +
        `<text x="${(g.left + plotW + 8).toFixed(1)}" y="${(y + 4).toFixed(1)}" class="crash-axis-label">${m.toFixed(0)}x</text>`;
    }).join("");
  }
  const xEl = $("crashAxisX");
  if (xEl) {
    xEl.innerHTML = crashXTicks(maxT).map((sVal) => {
      const x = g.left + (sVal / maxT) * plotW;
      return `<text x="${x.toFixed(1)}" y="${(baselineY + 22).toFixed(1)}" class="crash-axis-label" text-anchor="middle">${sVal.toFixed(0)}s</text>`;
    }).join("");
  }
}

// Dibuja la curva de despegue tal como se ve en este instante. status es
// "betting" | "running" | "crashed"; en "running" se recalcula en cada
// requestAnimationFrame con el tiempo transcurrido desde round_start (el
// servidor sigue siendo quien decide cuándo explota de verdad — esto es
// solo la representación visual). En "crashed" se congela exactamente en
// el punto de choque real, calculado a partir de crash_point.
function crashRenderGraph(status, round){
  const svg = $("crashSvg");
  const line = $("crashLine"), area = $("crashArea"), rocket = $("crashRocket");
  if (!svg || !line || !area || !rocket) return;
  const g = CRASH_GRAPH;
  const plotW = g.width - g.left - g.right;
  const plotH = g.height - g.top - g.bottom;
  const baselineY = g.top + plotH;

  if (!round || (status !== "running" && status !== "crashed")) {
    line.setAttribute("d", "");
    area.setAttribute("d", "");
    rocket.style.opacity = "0";
    svg.classList.remove("crashed");
    crashRenderAxes(8, 2);
    return;
  }

  const rate = round.growth_rate;
  const elapsed = status === "crashed"
    ? Math.log(round.crash_point) / rate
    : Math.max(0, (Date.now() - round.round_start) / 1000);
  const currentM = Math.exp(rate * elapsed);
  const maxT = Math.max(elapsed * 1.15, 8);
  const maxM = Math.max(currentM * 1.15, 2);
  crashRenderAxes(maxT, maxM);

  const SAMPLES = 48;
  const points = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const tt = (elapsed * i) / SAMPLES;
    const mm = Math.exp(rate * tt);
    points.push({
      x: g.left + (tt / maxT) * plotW,
      y: g.top + (1 - (mm - 1) / Math.max(maxM - 1, 0.001)) * plotH,
    });
  }
  line.setAttribute("d", crashBuildPath(points));
  area.setAttribute("d", crashBuildArea(points, baselineY));
  svg.classList.toggle("crashed", status === "crashed");

  const last = points[points.length - 1];
  const prev = points[points.length - 2] || points[0];
  if (last) {
    // Orienta la nave con la tangente de la curva en la punta; el emoji
    // 🚀 ya "mira" de por sí hacia arriba a la derecha (~45°), así que solo
    // se le suma la diferencia con el ángulo real de la curva en ese punto.
    const angle = Math.atan2(last.y - prev.y, last.x - prev.x) * (180 / Math.PI);
    rocket.setAttribute("x", last.x.toFixed(1));
    rocket.setAttribute("y", last.y.toFixed(1));
    rocket.setAttribute("transform", `rotate(${(angle + 45).toFixed(1)} ${last.x.toFixed(1)} ${last.y.toFixed(1)})`);
    rocket.textContent = status === "crashed" ? "💥" : "🚀";
    rocket.style.opacity = "1";
  }
}

// Deja de sondear/animar. Se llama al salir de la pantalla de Crash — la
// ronda sigue viva en el servidor, solo dejamos de mirarla desde aquí.
function crashStop(){
  const c = state.crash;
  if (!c) return;
  if (c.pollHandle) { clearInterval(c.pollHandle); c.pollHandle = null; }
  if (c.raf) { cancelAnimationFrame(c.raf); c.raf = null; }
}

// Habilita/deshabilita el formulario de apuesta (no bloquea la navegación:
// la apuesta de Crash vive en el servidor, no se pierde si el jugador se va).
function crashSetFormLocked(locked){
  state.roundActive = false;
  gameView.querySelectorAll(".bet-panel input, .bet-panel .chip").forEach((e) => { e.disabled = locked; });
}

async function crashPoll(){
  if (!state.crash) return;
  try {
    const d = await apiFetch("/games-crash-state", {
      method: "POST",
      body: JSON.stringify({ minecraft_username: state.username }),
    });
    crashApplyState(d);
  } catch (e) {
    // Error de red momentáneo: simplemente se reintenta en el próximo sondeo.
  }
}

function crashApplyState(d){
  const c = state.crash;
  if (!c) return;
  const prevStatus = c.round ? c.round.status : null;
  c.round = d;
  c.joined = !!d.my_bet;
  c.cashedOut = !!(d.my_bet && d.my_bet.cashed_out);

  renderCrashHistory(d.history);
  const playersEl = $("crashPlayers");
  if (playersEl) {
    playersEl.textContent = d.players_count
      ? `${d.players_count} ${t("game.crash.playersInRound")} · ${d.total_wagered} ${t("donuts")}`
      : t("game.crash.noPlayersYet");
  }

  if (d.status === "betting") {
    crashSetFormLocked(c.joined);
    if (c.joined) { setAction("game.crash.waitingRound"); $("actionBtn").disabled = true; }
    else { setAction("game.crash.join"); $("actionBtn").disabled = false; }
  } else if (d.status === "running") {
    crashSetFormLocked(true);
    if (c.joined && !c.cashedOut) { setAction("bet.cashOut"); $("actionBtn").disabled = false; }
    else { setAction(c.cashedOut ? "game.crash.cashedOut" : "game.crash.missedRound"); $("actionBtn").disabled = true; }
  } else if (d.status === "crashed") {
    crashSetFormLocked(true);
    setAction("game.crash.join");
    $("actionBtn").disabled = true;
    if (prevStatus === "running" && c.joined) {
      if (c.cashedOut && d.my_bet.payout) say(wonText(d.my_bet.cashout_multiplier, d.my_bet.payout));
      else say(t("game.crash.crashed"));
    }
  }
}

function renderCrashHistory(history){
  const el = $("crashHistory");
  if (!el) return;
  el.innerHTML = (history || []).map((h) => {
    const cls = h.crash_point >= 2 ? "crash-chip win" : "crash-chip lose";
    return `<span class="${cls}">${h.crash_point.toFixed(2)}x</span>`;
  }).join("");
}

// Bucle visual: interpola el multiplicador entre sondeos del servidor para
// que la animación se vea fluida, sin decidir nada por sí mismo (el
// servidor es quien de verdad define cuándo explota).
function crashTick(){
  const c = state.crash;
  if (!c) return;
  const round = c.round;
  const multEl = $("crashMult");
  if (round && multEl) {
    if (round.status === "betting") {
      const secsLeft = Math.max(0, (round.betting_end - Date.now()) / 1000);
      multEl.innerHTML = `1.00<sup>x</sup>`;
      multEl.classList.remove("crashed");
      $("crashStatusLine").textContent = `${t("game.crash.nextRoundIn")} ${secsLeft.toFixed(1)}s`;
      crashRenderGraph("betting", round);
    } else if (round.status === "running") {
      const elapsed = Math.max(0, (Date.now() - round.round_start) / 1000);
      const m = Math.exp(round.growth_rate * elapsed);
      multEl.innerHTML = `${m.toFixed(2)}<sup>x</sup>`;
      multEl.classList.remove("crashed");
      $("crashStatusLine").textContent = t("game.crash.currentPayout");
      crashRenderGraph("running", round);
      if (c.joined && !c.cashedOut && !c.busy && c.auto && m >= c.auto) {
        crashCashout();
      }
    } else if (round.status === "crashed") {
      multEl.innerHTML = `${round.crash_point.toFixed(2)}<sup>x</sup>`;
      multEl.classList.add("crashed");
      $("crashStatusLine").textContent = t("game.crash.roundCrashed");
      crashRenderGraph("crashed", round);
    }
  }
  c.raf = requestAnimationFrame(crashTick);
}

function crashAction(){
  const c = state.crash;
  if (!c || !c.round) return;
  if (c.round.status === "betting" && !c.joined) crashJoin();
  else if (c.round.status === "running" && c.joined && !c.cashedOut) crashCashout();
}

async function crashJoin(){
  const bet = validBet();
  if (bet < 1) return;
  const c = state.crash;
  c.auto = parseFloat($("autoAt").value) || 0;
  $("actionBtn").disabled = true;
  try {
    const d = await call("/games-crash-join", { bet_amount: bet });
    crashApplyState(d);
    say("");
    refreshBalance();
  } catch (e) {
    fail(e);
    $("actionBtn").disabled = false;
  }
}

async function crashCashout(){
  const c = state.crash;
  if (!c || c.cashedOut || c.busy) return;
  c.busy = true;
  $("actionBtn").disabled = true;
  try {
    const d = await call("/games-crash-cashout", {});
    c.cashedOut = true;
    say(wonText(d.multiplier, d.payout));
    setBalance(d.balance);
    setAction("game.crash.cashedOut");
  } catch (e) {
    fail(e);
    $("actionBtn").disabled = false;
  }
  c.busy = false;
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
  const r = stats.reserves || {};
  const fmt = (n) => (typeof n === "number" ? Math.floor(n).toLocaleString("en-US") : "—");
  const pct = (n) => (typeof n === "number" ? `${(n * 100).toFixed(1)}%` : "—");
  const ratio = r.exposure_ratio;
  const danger = typeof ratio === "number" && r.max_exposure_fraction && ratio >= r.max_exposure_fraction;
  const reported = r.bot_real_balance_reported_at
    ? `${t("admin.reportedAt")}: ${new Date(r.bot_real_balance_reported_at).toLocaleString()}`
    : t("admin.noReport");
  const card = (label, value, sub = "", cls = "") =>
    `<div class="admin-card ${cls}"><div class="admin-card-label">${label}</div><div class="admin-card-value">${value}</div>${sub ? `<div class="admin-card-sub">${sub}</div>` : ""}</div>`;
  adminStatsView.innerHTML = `
    <h2>${t("admin.title")}</h2>
    <div class="admin-cards">
      ${card(t("admin.profit"), fmt(t2.house_profit), `${t("admin.edge")}: ${pct(t2.observed_house_edge)}`, t2.house_profit < 0 ? "bad" : "good")}
      ${card(t("admin.botBalance"), fmt(r.bot_real_balance), reported)}
      ${card(t("admin.circulating"), fmt(r.circulating_donuts_stats_only))}
      ${card(t("admin.exposure"), pct(ratio), `${t("admin.exposureLimit")}: ${pct(r.max_exposure_fraction)}`, danger ? "bad" : "")}
      ${card(t("admin.winRate"), pct(t2.win_rate))}
      ${card(t("admin.forcedRate"), pct(t2.forced_loss_rate))}
      ${card(t("admin.reserveStats"), fmt(stats.house_reserve))}
    </div>
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
  `;
  adminStatsView.classList.remove("hidden");
}
