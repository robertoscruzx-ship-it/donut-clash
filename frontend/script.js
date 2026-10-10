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
langSelect.addEventListener("change", () => { setLanguage(langSelect.value); if (window.chatRefreshAccess) window.chatRefreshAccess(); });
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
  if (window.chatRefreshAccess) setTimeout(window.chatRefreshAccess, 0);
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
      if (window.chatRefreshAccess) window.chatRefreshAccess();
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
// El texto de estado bajo el panel se eliminó; say() queda como no-op por compatibilidad.
const say = () => {};
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
// Cola de animaciones de premio: se muestran una tras otra; si hay otra esperando
// (o llega mientras corre), la actual va al doble de velocidad. La última, normal.
const winQueue = [];
let winRunning = null; // { anims: [Animation, ...] }
function setWinSpeed(run, rate) { run.anims.forEach((an) => { try { an.updatePlaybackRate(rate); } catch (e) {} }); }
async function runWinQueue() {
  if (winRunning) return;
  while (winQueue.length) {
    const amount = winQueue.shift();
    await playWinBox(amount, winQueue.length > 0 ? 2 : 1);
  }
}
function playWinBox(amount, rate) {
  const from = $("coinPayout") || null, to = balanceValue;
  if (!to || !document.body.animate) return Promise.resolve();
  const b = to.getBoundingClientRect();
  const el = document.createElement("div");
  el.className = "win-fly";
  el.textContent = `+${formatWonAmount(amount)}`;
  document.body.appendChild(el);
  const w = el.offsetWidth;
  // Justo debajo del saldo del header, centrado con él.
  el.style.left = `${b.left + b.width / 2 - w / 2}px`;
  el.style.top = `${b.bottom + 6}px`;
  const boxAnim = el.animate([{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 1, offset: 0.4 }, { opacity: 0 }],
    { duration: 2200, easing: "ease-out", fill: "forwards" });
  if (winFlash) winFlash.cancel();
  winFlash = to.animate([{ color: "" }, { color: "#36d399", offset: 0.12 }, { color: "#36d399", offset: 0.4 }, { color: "" }],
    { duration: 2200, easing: "ease-out" });
  winRunning = { anims: [boxAnim, winFlash] };
  setWinSpeed(winRunning, rate);
  return boxAnim.finished.catch(() => {}).then(() => { el.remove(); winRunning = null; });
}
let winFlash = null;
// Punto único para CUALQUIER ganancia (de cualquier juego, presente o futuro):
// el saldo se actualiza al instante y se encola la animación del premio.
// `payout` = total que te devuelve el juego; `newBalance` = saldo final del servidor.
function applyWin(payout, newBalance) {
  setBalance(newBalance);
  if (!(payout > 0)) return;
  winQueue.push(payout);
  if (winRunning) setWinSpeed(winRunning, 2); // ya hay otra detrás: la actual acelera
  runWinQueue();
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
       <button class="chip side active" data-side="heads" data-i18n="game.coinflip.heads">R</button>
       <button class="chip side" data-side="tails" data-i18n="game.coinflip.tails">-</button>
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
        await applyWin(d.payout, d.balance);
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
    `<div class="stage-title"><span data-i18n="game.mines.name">Mines</span></div><div class="mines-grid" id="minesGrid"></div>`,
    `<label class="bet-label" data-i18n="game.mines.bombs">Bombs</label>
     <input type="number" id="bombs" min="1" max="24" value="3">`, "bet.placeBet", true);
  const grid = $("minesGrid");
  for (let i = 0; i < 25; i++){
    const tile = document.createElement("div");
    tile.className = "mine-tile";
    tile.onclick = () => revealTile(i, tile);
    grid.appendChild(tile);
  }
  // Caja "Current payout" bajo el panel de apuesta.
  const aside = gameView.querySelector(".bet-panel");
  const col = document.createElement("div");
  col.className = "bet-col";
  aside.parentNode.insertBefore(col, aside);
  col.appendChild(aside);
  col.insertAdjacentHTML("beforeend", `<div class="payout-box"><div class="payout-label"><span data-i18n="game.mines.currentPayout">${t("game.mines.currentPayout")}</span> <span class="payout-mult" id="minesPayMult">- 1.00X</span></div><div class="payout-value"><span class="coin-icon"></span><span id="minesPayVal">0</span></div></div>`);
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
  state.mines = { demo: true, bombsCount: bombs, bombs: new Set(idx.slice(0, bombs)), revealed: 0, bet: Math.max(0, Number($("betAmount").value) || 0) };
  minesSetPayout(1, state.mines.bet);
  gameView.querySelectorAll(".mine-tile").forEach((x) => { x.className = "mine-tile"; x.textContent = ""; });
  lockPanel(true);
  setAction("bet.cashOut");
  say(t("bet.demoTag"));
}

async function minesStart(){
  const bet = validBet();
  if (bet < 1) return;
  try {
    const d = await call("/games-mines-start", { bet_amount: bet, bombs_count: Number($("bombs").value) || 0, client_seed: getOrCreateClientSeed() });
    state.mines = { id: d.game_id, bet };
    minesSetPayout(1, bet);
    gameView.querySelectorAll(".mine-tile").forEach((x) => { x.className = "mine-tile"; x.textContent = ""; });
    lockPanel(true);
    setAction("bet.cashOut");
    say("");
    refreshBalance();
  } catch (e) { fail(e); }
}

// Pago actual (apuesta × multiplicador) en la caja bajo el panel.
function minesSetPayout(mult, bet){
  const mEl = $("minesPayMult"), vEl = $("minesPayVal");
  if (!mEl || !vEl) return;
  mEl.textContent = `- ${mult.toFixed(2)}X`;
  const v = bet * mult;
  vEl.textContent = v >= 1000 ? fmtShort(v) : String(parseFloat(v.toFixed(2)));
}

// Muestra el contenido de una casilla: esmeralda (segura) o bomba. Si `boom`, la bomba explota.
function minesShow(tile, kind, boom){
  tile.classList.add(kind === "bomb" ? "revealed-bomb" : "revealed-safe");
  tile.innerHTML = `<img class="mine-img" src="assets/${kind === "bomb" ? "bomb" : "emerald"}.png" alt="" draggable="false">`;
  const img = tile.firstChild;
  if (img.animate && !boom) img.animate([{ transform: "scale(.3)", opacity: 0 }, { transform: "scale(1.15)", opacity: 1, offset: .6 }, { transform: "scale(1)", opacity: 1 }], { duration: 280, easing: "ease-out" });
  if (boom) minesExplode(tile);
}

// Explosión de Mines (distinta a la de Crash): la bomba se infla, destello blanco, fragmentos
// cuadrados tipo pixel-art que salen en todas direcciones, humo gris y la casilla tiembla.
function minesExplode(tile){
  const img = tile.querySelector(".mine-img");
  if (!tile.animate) return;
  if (img) img.animate([{ transform: "scale(1)", filter: "brightness(1)" }, { transform: "scale(1.45)", filter: "brightness(3)", offset: .35 }, { transform: "scale(1.1)", filter: "brightness(1)" }], { duration: 420, easing: "ease-out" });
  tile.animate([{ transform: "translate(0,0)" }, { transform: "translate(-4px,2px)" }, { transform: "translate(4px,-3px)" }, { transform: "translate(-3px,-2px)" }, { transform: "translate(2px,3px)" }, { transform: "translate(0,0)" }], { duration: 380 });
  const mk = (css) => { const el = document.createElement("div"); el.className = "mine-fx"; el.style.cssText = css; tile.appendChild(el); return el; };
  const rm = (el, a) => a.finished.catch(() => {}).then(() => el.remove());
  const flash = mk("inset:0;background:#fff;border-radius:6px;");
  rm(flash, flash.animate([{ opacity: .9 }, { opacity: 0 }], { duration: 300, easing: "ease-out" }));
  const cols = ["#ffffff", "#ffd23f", "#ff8a1f", "#e63b2e", "#3a3a3a"];
  const N = 16;
  for (let i = 0; i < N; i++) {
    const size = 4 + Math.floor(Math.random() * 3) * 2;
    const col = cols[Math.floor(Math.random() * cols.length)];
    const el = mk(`left:50%;top:50%;width:${size}px;height:${size}px;background:${col};`);
    const ang = (i / N) * Math.PI * 2 + Math.random() * .4, dist = 38 + Math.random() * 40;
    rm(el, el.animate([
      { transform: "translate(-50%,-50%) rotate(0deg)", opacity: 1 },
      { transform: `translate(calc(-50% + ${Math.cos(ang) * dist}px), calc(-50% + ${Math.sin(ang) * dist}px)) rotate(${Math.random() * 360}deg)`, opacity: 0 },
    ], { duration: 450 + Math.random() * 300, easing: "cubic-bezier(.1,.7,.3,1)" }));
  }
  for (let i = 0; i < 4; i++) {
    const sz = 18 + Math.random() * 12;
    const el = mk(`left:${35 + Math.random() * 30}%;top:${35 + Math.random() * 30}%;width:${sz}px;height:${sz}px;border-radius:50%;background:rgba(150,150,150,.55);`);
    rm(el, el.animate([
      { transform: "translate(-50%,-50%) scale(.4)", opacity: .8 },
      { transform: `translate(calc(-50% + ${(Math.random() - .5) * 30}px), calc(-50% - ${28 + Math.random() * 22}px)) scale(1.8)`, opacity: 0 },
    ], { duration: 800 + Math.random() * 300, easing: "ease-out", delay: 120 }));
  }
}

async function revealTile(i, tile){
  if (!state.mines) { requireSession(); return; }
  if (state.mines.demo) {
    if (tile.classList.contains("revealed-safe")) return;
    const m = state.mines;
    if (m.bombs.has(i)) {
      minesShow(tile, "bomb", true);
      say(`${t("bet.demoTag")} ${t("game.mines.boom")}`);
      endMines([...m.bombs]);
    } else {
      m.revealed += 1;
      minesShow(tile, "safe");
      minesSetPayout(minesFairMultiplier(m.revealed, m.bombsCount), m.bet);
      say(`${t("bet.demoTag")} ${t("game.mines.multiplierPrefix")}${minesFairMultiplier(m.revealed, m.bombsCount).toFixed(2)}x`);
    }
    return;
  }
  if (tile.dataset.busy || tile.classList.contains("revealed-safe")) return;
  tile.dataset.busy = 1;
  try {
    const d = await call("/games-mines-reveal", { game_id: state.mines.id, tile_index: i });
    if (d.result === "bomb"){
      minesShow(tile, "bomb", true);
      say(t("game.mines.boom"));
      endMines(d.bomb_positions);
    } else {
      minesShow(tile, "safe");
      minesSetPayout(d.current_multiplier, state.mines.bet);
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
    endMines(d.bomb_positions);
    await applyWin(d.payout, d.balance);
  } catch (e) { fail(e); }
}

function endMines(bombs){
  state.mines = null;
  minesSetPayout(1, 0);
  lockPanel(false);
  setAction("bet.placeBet");
  const tiles = gameView.querySelectorAll(".mine-tile");
  (bombs || []).forEach((i) => {
    if (!tiles[i].classList.contains("revealed-bomb")) minesShow(tiles[i], "bomb");
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
const CRASH_GRAPH = { left: 10, top: 16, right: 54, bottom: 40, width: 1000, height: 480 };

function renderCrash(){
  layout(
    `<div class="stage-title">📈 <span data-i18n="game.crash.name">Crash</span></div>
     <div class="crash-wrap" id="crashWrap">
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
       </svg>
       <div class="crash-labels" id="crashLabels"></div>
       <div class="crash-waiting" id="crashWaiting"><div class="cw-text">${t("game.crash.waiting")}</div><div class="cw-timer" id="crashWaitTimer">10.0s</div></div>
       <div class="crash-rocket" id="crashRocket" style="opacity:0"></div>
     </div>
`,
    `<label class="bet-label" data-i18n="bet.autoCashout">Auto Cashout</label>
     <div class="bet-row">
       <input type="number" id="autoAt" min="1.01" step="0.01" placeholder="—">
       <button class="chip" data-at="2">2x</button><button class="chip" data-at="10">10x</button>
     </div>`, "game.crash.join");
  // Franja de historial ENCIMA de todo el juego (más antiguas se desvanecen a la izquierda).
  crashHistLast = null;
  gameView.querySelector(".game-layout").classList.add("crash-layout");
  gameView.querySelector(".game-layout").insertAdjacentHTML("beforeend", `<section class="crash-table" id="crashTable"><div class="ct-head"><span id="ctCount"></span><span id="ctTotal"></span></div><div class="ct-body" id="ctBody"></div></section>`);
  gameView.insertAdjacentHTML("afterbegin", '<div class="crash-history" id="crashHistory"></div>');
  gameView.querySelectorAll("[data-at]").forEach((b) => { b.onclick = () => { $("autoAt").value = b.dataset.at; }; });
  $("actionBtn").onclick = crashAction;

  state.crash = { round: null, joined: false, cashedOut: false, auto: 0, busy: false, raf: null, pollHandle: null };
  state.cleanupGame = crashStop;
  if (window.Crash3D) {
    const cs = state.crash;
    Crash3D.create($("crashWrap")).then((fx) => {
      if (!fx) return;
      if (state.crash !== cs) { fx.destroy(); return; } // ya se salió de Crash
      cs.fx = fx;
    }).catch(() => {});
  }
  crashRenderGraph("betting", null);
  crashPoll();
  state.crash.pollHandle = setInterval(crashPoll, 1000);
  state.crash.raf = requestAnimationFrame(crashTick);
}

// ---- Gráfico de Crash: cuadrícula fija en segundos y multiplicadores ----
// La nave avanza a velocidad constante sobre la cuadrícula (cada celda =
// 2 s en rondas cortas). Cuando se acerca al borde, la vista se amplía por
// escalones (8s -> 16s -> 32s ...) con una transición suave, y la cuadrícula
// cambia de paso (2s, 4s, 8s...) para no saturarse.
// Las etiquetas y la nave son HTML (no texto SVG) para que no se deformen
// con el estiramiento del gráfico.
const CRASH_WINDOWS_T = [8, 16, 32, 64, 128, 256, 512, 1024];
const CRASH_WINDOWS_M = [2, 3, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 100000, 1000000];
const CRASH_X_STEPS = [2, 4, 8, 16, 32, 64, 128, 256];
const CRASH_Y_STEPS = [0.25, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 100000, 1000000];

function crashTargetView(elapsed, currentM){
  const T = CRASH_WINDOWS_T.find((w) => elapsed <= w * 0.85) || CRASH_WINDOWS_T[CRASH_WINDOWS_T.length - 1];
  const M = CRASH_WINDOWS_M.find((w) => currentM - 1 <= (w - 1) * 0.85) || CRASH_WINDOWS_M[CRASH_WINDOWS_M.length - 1];
  return { T, M };
}
function crashFmtMult(m){ return `${Number(m.toFixed(2))}x`; }

function crashBuildPath(points){
  if (!points.length) return "";
  return "M" + points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L");
}
function crashBuildArea(points, baselineY){
  if (!points.length) return "";
  const first = points[0], last = points[points.length - 1];
  return `${crashBuildPath(points)} L${last.x.toFixed(1)},${baselineY} L${first.x.toFixed(1)},${baselineY} Z`;
}

// Dibuja líneas de la cuadrícula (SVG) y etiquetas (HTML) para la vista actual.
function crashRenderAxes(viewT, viewM, targetT, targetM){
  const g = CRASH_GRAPH;
  const plotW = g.width - g.left - g.right;
  const plotH = g.height - g.top - g.bottom;
  const baselineY = g.top + plotH;
  const xStep = CRASH_X_STEPS.find((st) => targetT / st <= 8) || CRASH_X_STEPS[CRASH_X_STEPS.length - 1];
  const yStep = CRASH_Y_STEPS.find((st) => (targetM - 1) / st <= 5) || CRASH_Y_STEPS[CRASH_Y_STEPS.length - 1];
  const pctX = (x) => `${(x / g.width * 100).toFixed(3)}%`;
  const pctY = (y) => `${(y / g.height * 100).toFixed(3)}%`;
  let lines = "", labels = "";

  for (let m = yStep; m <= viewM + 1e-9; m += yStep) {
    if (m <= 1 + 1e-9) continue;
    const y = g.top + (1 - (m - 1) / (viewM - 1)) * plotH;
    if (y < g.top - 1) continue;
    lines += `<line x1="${g.left}" y1="${y.toFixed(1)}" x2="${g.left + plotW}" y2="${y.toFixed(1)}" class="crash-grid"></line>`;
    labels += `<span class="crash-axis-label y" style="left:${pctX(g.left + plotW + 8)};top:${pctY(y)}">${crashFmtMult(m)}</span>`;
  }
  for (let sVal = xStep; sVal <= viewT + 1e-9; sVal += xStep) {
    const x = g.left + (sVal / viewT) * plotW;
    lines += `<line x1="${x.toFixed(1)}" y1="${g.top}" x2="${x.toFixed(1)}" y2="${baselineY}" class="crash-grid"></line>`;
    labels += `<span class="crash-axis-label x" style="left:${pctX(x)};top:${pctY(baselineY + 14)}">${sVal}s</span>`;
  }
  lines += `<line x1="${g.left}" y1="${baselineY}" x2="${g.left + plotW}" y2="${baselineY}" class="crash-grid base"></line>`;
  const gridEl = $("crashAxisY");
  if (gridEl) gridEl.innerHTML = lines;
  const xEl = $("crashAxisX");
  if (xEl) xEl.innerHTML = "";
  const labEl = $("crashLabels");
  if (labEl) labEl.innerHTML = labels;
}

// Explosión al chocar: destello, onda expansiva, chispas y un pequeño temblor del gráfico.
function crashExplode(x, y){
  const wrap = $("crashWrap");
  if (!wrap || !wrap.animate) return;
  const mk = (cls, css) => {
    const el = document.createElement("div");
    el.className = cls;
    el.style.cssText = `left:${x}px;top:${y}px;${css || ""}`;
    wrap.appendChild(el);
    return el;
  };
  const done = (el, anim) => anim.finished.catch(() => {}).then(() => el.remove());
  const flash = mk("boom-flash");
  done(flash, flash.animate([{ transform: "translate(-50%,-50%) scale(.2)", opacity: 1 }, { transform: "translate(-50%,-50%) scale(2.6)", opacity: 0 }], { duration: 420, easing: "ease-out" }));
  const ring = mk("boom-ring");
  done(ring, ring.animate([{ transform: "translate(-50%,-50%) scale(.2)", opacity: 1 }, { transform: "translate(-50%,-50%) scale(4)", opacity: 0 }], { duration: 650, easing: "cubic-bezier(.1,.7,.3,1)" }));
  const colors = ["#fff7c2", "#ffd23f", "#ff9d1a", "#ff6a13", "#ef4444"];
  for (let i = 0; i < 34; i++) {
    const size = 3 + Math.random() * 6;
    const col = colors[Math.floor(Math.random() * colors.length)];
    const sp = mk("boom-spark", `width:${size}px;height:${size}px;background:${col};box-shadow:0 0 ${size * 2}px ${col};`);
    const ang = Math.random() * Math.PI * 2, dist = 45 + Math.random() * 110;
    const dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist + 25 + Math.random() * 35; // cae un poco (gravedad)
    done(sp, sp.animate([
      { transform: "translate(-50%,-50%) scale(1)", opacity: 1 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.2)`, opacity: 0 },
    ], { duration: 550 + Math.random() * 600, easing: "cubic-bezier(.15,.7,.3,1)" }));
  }
  wrap.animate([
    { transform: "translate(0,0)" }, { transform: "translate(-5px,3px)" }, { transform: "translate(4px,-4px)" },
    { transform: "translate(-3px,-2px)" }, { transform: "translate(2px,2px)" }, { transform: "translate(0,0)" },
  ], { duration: 360, easing: "ease-out" });
}

// Color del trazo según el multiplicador: azul (hasta 25x) → rojo (25–60x) → verde (60–80x) → dorado (80x+),
// con transiciones graduales (mezcla en escala logarítmica) para que no cambie de golpe.
const CRASH_COLORS = [
  { from: 1,  rgb: [37, 70, 255] },
  { from: 25, rgb: [235, 50, 60] },
  { from: 60, rgb: [40, 200, 90] },
  { from: 80, rgb: [246, 195, 67] },
];
function crashColor(m){
  let rgb = CRASH_COLORS[0].rgb;
  for (let i = 1; i < CRASH_COLORS.length; i++) {
    const b = CRASH_COLORS[i].from;
    if (m < b) break;
    const k = Math.min(1, Math.log(m / b) / Math.log(1.6));
    const a = CRASH_COLORS[i - 1].rgb, z = CRASH_COLORS[i].rgb;
    rgb = a.map((v, j) => v + (z[j] - v) * k);
  }
  return rgb.map((v) => Math.round(v));
}

function crashRenderGraph(status, round){
  const svg = $("crashSvg");
  const line = $("crashLine"), area = $("crashArea"), rocket = $("crashRocket");
  if (!svg || !line || !area || !rocket) return;
  const c = state.crash || {};
  const g = CRASH_GRAPH;
  const plotW = g.width - g.left - g.right;
  const plotH = g.height - g.top - g.bottom;
  const baselineY = g.top + plotH;
  const now = performance.now();
  const running = round && (status === "running" || status === "crashed");
  const rate = running ? round.growth_rate : 0;
  const elapsed = !running ? 0 : (status === "crashed"
    ? Math.log(round.crash_point) / rate
    : Math.max(0, (Date.now() - round.round_start) / 1000));
  const currentM = running ? Math.exp(rate * elapsed) : 1;

  // Cámara continua (como antes): la vista siempre sigue a la nave con un 15% de margen.
  const viewT = Math.max(elapsed * 1.15, 8);
  const viewM = Math.max(currentM * 1.15, 2);
  crashRenderAxes(viewT, viewM, viewT, viewM);

  if (!running) {
    line.setAttribute("d", "");
    area.setAttribute("d", "");
    rocket.style.opacity = "0";
    svg.classList.remove("crashed");
    if (c.fx) c.fx.hide();
    return;
  }

  const SAMPLES = 60;
  const points = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const tt = (elapsed * i) / SAMPLES;
    const mm = Math.exp(rate * tt);
    points.push({
      x: g.left + (tt / viewT) * plotW,
      y: g.top + (1 - (mm - 1) / (viewM - 1)) * plotH,
    });
  }
  line.setAttribute("d", crashBuildPath(points));
  area.setAttribute("d", crashBuildArea(points, baselineY));
  svg.classList.toggle("crashed", status === "crashed");
  const col = crashColor(currentM);
  const colStr = `rgb(${col[0]},${col[1]},${col[2]})`;
  line.style.stroke = status === "crashed" ? "" : colStr;
  const stops = svg.querySelectorAll("#crashFillGrad stop");
  stops.forEach((st) => st.setAttribute("stop-color", status === "crashed" ? "#ff4d4d" : colStr));
  rocket.style.background = colStr;
  rocket.style.boxShadow = `0 0 12px 3px ${colStr}`;

  const last = points[points.length - 1];
  const prev = points[points.length - 4] || points[0];
  // Ángulo calculado en píxeles reales (el gráfico se estira distinto en x e y).
  const sx = svg.clientWidth / g.width, sy = svg.clientHeight / g.height;
  const angle = Math.atan2((last.y - prev.y) * sy, (last.x - prev.x) * sx) * (180 / Math.PI);
  rocket.style.left = `${(last.x / g.width * 100).toFixed(3)}%`;
  rocket.style.top = `${(last.y / g.height * 100).toFixed(3)}%`;
  rocket.style.transform = "translate(-50%,-50%)";
  if (c.fx) c.fx.hide();
  if (status === "running") {
    rocket.style.opacity = "1";
  } else {
    rocket.style.opacity = "0";
    if (status === "crashed" && c.explodedRound !== round.round_number) {
      c.explodedRound = round.round_number;
      // Solo se anima si el choque es reciente (no al entrar a ver una ronda que ya explotó).
      if (!round.crash_at || Date.now() - round.crash_at < 4000) crashExplode(last.x * sx, last.y * sy);
    }
  }
}

// Deja de sondear/animar. Se llama al salir de la pantalla de Crash — la
// ronda sigue viva en el servidor, solo dejamos de mirarla desde aquí.
function crashStop(){
  const c = state.crash;
  if (!c) return;
  if (c.pollHandle) { clearInterval(c.pollHandle); c.pollHandle = null; }
  if (c.raf) { cancelAnimationFrame(c.raf); c.raf = null; }
  if (c.fx) { c.fx.destroy(); c.fx = null; }
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

// El servidor mantiene la ronda como "crashed" 4s y luego abre 10s de apuestas. El cliente
// retiene la vista del choque hasta crash_at + 4s (coincide con el servidor) para la explosión.
const CRASH_HOLD_MS = 4000;
function crashStartHold(prev){
  const c = state.crash;
  if (!c || (c.hold && c.hold.round.round_number === prev.round_number)) return;
  const secs = Math.max(0, (prev.crash_at - prev.round_start) / 1000);
  const crash_point = Math.floor(Math.exp(prev.growth_rate * secs) * 100) / 100;
  const held = { ...prev, status: "crashed", crash_point: Math.max(1, crash_point) };
  c.hold = { round: held, until: Math.max(Date.now(), prev.crash_at) + CRASH_HOLD_MS };
  if (c.joined && !c.cashedOut) say(t("game.crash.crashed"));
  renderCrashTable(held);
}

function crashApplyState(d){
  const c = state.crash;
  if (!c) return;
  const prevStatus = c.round ? c.round.status : null;
  if (c.round && c.round.status === "running" && d.round_number !== c.round.round_number) crashStartHold(c.round);
  c.round = d;
  c.joined = !!d.my_bet;
  c.cashedOut = !!(d.my_bet && d.my_bet.cashed_out);

  renderCrashHistory(d.history);
  if (c.hold) {
    // Si ya llegó el valor exacto del servidor para la ronda retenida, se usa ese.
    const hh = (d.history || []).find((x) => x.round_number === c.hold.round.round_number);
    if (hh) c.hold.round.crash_point = hh.crash_point;
  }
  if (!c.hold || Date.now() >= c.hold.until) renderCrashTable(d);

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

// Formato corto para la tabla: 5000 -> "5K", 8300 -> "8.3K" (hasta 2 decimales, sin ceros sobrantes).
function fmtShort(n) {
  const v = Number(n) || 0;
  for (const [suf, x] of [["B", 1e9], ["M", 1e6], ["K", 1e3]]) {
    if (Math.abs(v) >= x) return `${parseFloat((Math.trunc((v / x) * 100) / 100).toFixed(2))}${suf}`;
  }
  return String(Math.trunc(v));
}
const escHtml = (x) => String(x).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
// Tabla de jugadores de la ronda actual (se vacía sola al empezar la siguiente ronda).
function renderCrashTable(d) {
  const body = $("ctBody");
  if (!body) return;
  const bets = (d.bets || []).slice().sort((a, b) => b.bet_amount - a.bet_amount);
  $("ctCount").textContent = `${bets.length} ${bets.length === 1 ? t("game.crash.player") : t("game.crash.players")}`;
  $("ctTotal").innerHTML = `${fmtShort(d.total_wagered || 0)} <span class="coin-icon"></span> <span class="ct-ingame">${t("game.crash.inGame")}</span>`;
  body.innerHTML = bets.map((b) => {
    let status;
    if (b.cashed_out) status = `<span class="ct-win">${fmtShort(b.payout)} — ${Number(b.cashout_multiplier).toFixed(2)}x</span>`;
    else if (d.status === "running") status = `<span class="ct-playing">${t("game.crash.playing")}</span>`;
    else if (d.status === "crashed") status = `<span class="ct-loss">-${fmtShort(b.bet_amount)}</span>`;
    else status = `<span class="ct-wait">—</span>`;
    const name = escHtml(b.minecraft_username);
    return `<div class="ct-row"><span class="ct-level">${b.level || 1}</span>
      <img class="ct-avatar" src="https://mc-heads.net/avatar/${encodeURIComponent(b.minecraft_username)}/48" alt="">
      <div class="ct-who"><div class="ct-name">${name}</div><div class="ct-bet">${fmtShort(b.bet_amount)} <span class="coin-icon"></span></div></div>
      <div class="ct-status">${status}</div></div>`;
  }).join("");
}

let crashHistLast = null;
function renderCrashHistory(history){
  const el = $("crashHistory");
  if (!el) return;
  // Más reciente primero (izquierda); las anteriores se corren hacia la derecha.
  const list = (history || []).slice().reverse();
  const newest = list.length ? list[0].round_number : null;
  const isNew = crashHistLast !== null && newest !== null && newest !== crashHistLast;
  el.innerHTML = list.map((h) => {
    const cls = h.crash_point >= 2 ? "crash-chip win" : "crash-chip lose";
    return `<span class="${cls}">${h.crash_point.toFixed(2)}x</span>`;
  }).join("");
  crashHistLast = newest;
  if (isNew && el.firstElementChild && el.animate) {
    const first = el.firstElementChild;
    const shift = first.getBoundingClientRect().width + 6; // ancho de la nueva + gap
    [...el.children].forEach((c, i) => {
      c.animate(i === 0
        ? [{ transform: `translateX(-${shift}px)`, opacity: 0 }, { transform: "translateX(0)", opacity: 1 }]
        : [{ transform: `translateX(-${shift}px)` }, { transform: "translateX(0)" }],
        { duration: 500, easing: "cubic-bezier(.2,.8,.2,1)" });
    });
  }
}

// Bucle visual: interpola el multiplicador entre sondeos del servidor para
// que la animación se vea fluida, sin decidir nada por sí mismo (el
// servidor es quien de verdad define cuándo explota).
function crashTick(){
  const c = state.crash;
  if (!c) return;
  let round = c.round;
  if (round && round.status === "running" && Date.now() >= round.crash_at) {
    crashStartHold(round);
    if (c.hold) round = c.hold.round;
  } else if (c.hold) {
    if (Date.now() < c.hold.until) round = c.hold.round;
    else { c.hold = null; if (round) renderCrashTable(round); }
  }
  const multEl = $("crashMult");
  const wrapEl = $("crashWrap");
  if (wrapEl && round) {
    const waiting = round.status === "betting";
    wrapEl.classList.toggle("waiting", waiting);
    const ttl = wrapEl.previousElementSibling;
    if (ttl && ttl.classList.contains("stage-title")) ttl.style.visibility = waiting ? "hidden" : "";
  }
  if (round && multEl) {
    if (round.status === "betting") {
      const secsLeft = Math.max(0, (round.betting_end - Date.now()) / 1000);
      multEl.innerHTML = `1.00<sup>x</sup>`;
      multEl.classList.remove("crashed");
      $("crashWaitTimer").textContent = `${secsLeft.toFixed(1)}s`;
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
    setAction("game.crash.cashedOut");
    await applyWin(d.payout, d.balance);
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

// ==============================
// CHAT PÚBLICO (lectura abierta; solo nivel 15+ puede escribir)
// ==============================
const CHAT_MIN_LEVEL = 15;
const chatState = { last: null, timer: null, open: true, seen: new Set() };
(function initChat(){
  const panel = $("chatPanel");
  if (!panel) return;
  const list = $("chatList"), form = $("chatForm"), input = $("chatInput"), notice = $("chatNotice");
  try { chatState.open = localStorage.getItem("chatOpen") !== "0"; } catch (e) {}

  function setOpen(v){
    chatState.open = v;
    try { localStorage.setItem("chatOpen", v ? "1" : "0"); } catch (e) {}
    panel.classList.toggle("collapsed", !v);
    $("chatShow").classList.toggle("hidden", v);
    if (v) { chatPoll(true); startTimer(); } else stopTimer();
  }
  function startTimer(){ stopTimer(); chatState.timer = setInterval(() => { if (!document.hidden) chatPoll(); }, 3000); }
  function stopTimer(){ if (chatState.timer) { clearInterval(chatState.timer); chatState.timer = null; } }

  function addMsg(m){
    if (chatState.seen.has(m.id)) return;
    chatState.seen.add(m.id);
    chatState.last = m.id;
    const row = document.createElement("div");
    row.className = "chat-msg";
    const img = document.createElement("img");
    img.src = `https://mc-heads.net/avatar/${encodeURIComponent(m.minecraft_username)}/48`;
    img.alt = "";
    const body = document.createElement("div");
    body.className = "chat-body";
    const lvl = document.createElement("div"); lvl.className = "chat-lvlbox" + (m.level >= CHAT_MIN_LEVEL ? " hi" : ""); lvl.textContent = m.level;
    const name = document.createElement("div"); name.className = "chat-name"; name.textContent = m.minecraft_username;
    const text = document.createElement("div"); text.className = "chat-text"; text.textContent = m.text;
    body.append(name, text);
    row.append(lvl, img, body);
    list.appendChild(row);
  }
  async function chatPoll(initial){
    try {
      const d = await apiFetch(`/chat-messages${chatState.last && !initial ? `?after=${chatState.last}` : ""}`);
      const stick = list.scrollHeight - list.scrollTop - list.clientHeight < 60 || !list.children.length;
      if (initial) { list.innerHTML = ""; chatState.seen.clear(); chatState.last = null; }
      const empty = list.querySelector(".chat-empty"); if (empty) empty.remove();
      d.messages.forEach(addMsg);
      if (typeof d.online === "number") $("chatOnline").textContent = d.online;
      if (!list.children.length) list.innerHTML = `<div class="chat-empty">${t("chat.empty")}</div>`;
      if (stick) list.scrollTop = list.scrollHeight;
    } catch (e) { /* se reintenta en el próximo sondeo */ }
  }
  window.chatRefreshAccess = function(){};  // la caja siempre se ve; el nivel se valida al enviar
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    if (!(state.sessionToken && state.username)) { showToast(t("chat.needLogin"), { type: "error" }); return; }
    if (state.level < CHAT_MIN_LEVEL) { showToast(t("chat.needLevel").replace("{n}", CHAT_MIN_LEVEL), { type: "error" }); return; }
    input.value = "";
    try {
      const d = await call("/chat-send", { text });
      addMsg(d.message);
      list.scrollTop = list.scrollHeight;
    } catch (e) { input.value = text; fail(e); }
  });
  $("chatDiscord").onclick = () => showToast(t("banner.button"), { type: "info" });
  $("chatRules").onclick = () => showToast(t("banner.button"), { type: "info" });
  // Presencia: mientras haya sesión y la pestaña esté visible, avisa al servidor cada 30 s.
  const ping = () => { if (state.sessionToken && state.username && !document.hidden) call("/presence-ping", {}).catch(() => {}); };
  setInterval(ping, 30000);
  setTimeout(ping, 2500);
  $("chatHide").onclick = () => setOpen(false);
  $("chatShow").onclick = () => setOpen(true);
  // En pantallas angostas arranca oculto para no tapar el juego.
  if (window.matchMedia("(max-width:900px)").matches && !localStorage.getItem("chatOpen")) chatState.open = false;
  setOpen(chatState.open);
  chatRefreshAccess();
})();
