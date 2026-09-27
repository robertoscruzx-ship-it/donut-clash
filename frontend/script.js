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
  activeMinesGameId: null,
  activeCrashGameId: null,
  crashAnimationFrame: null,
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

const gameArea = document.getElementById("gameArea");

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
  if (!res.ok) throw new Error(data.error || "Network error");
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
      } catch (err) {
        console.error("Could not claim session:", err.message);
      }
      state.balance = data.balance || 0;
      updateBalanceDisplay();
      closeModal();
      setInterval(refreshBalance, 5000);
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
// ACCESO A LOS JUEGOS (bloqueado sin cuenta vinculada)
// ==============================
document.querySelectorAll("[data-game]").forEach((el) => {
  el.addEventListener("click", () => {
    if (!state.sessionToken) {
      openModal();
      return;
    }
    openGame(el.dataset.game);
  });
});

function requireSession(){
  if (!state.sessionToken) {
    alert(t("error.needLink"));
    return false;
  }
  return true;
}

function openGame(game){
  if (game === "mines") renderMines();
  if (game === "crash") renderCrash();
  if (game === "coinflip") renderCoinflip();
  gameArea.classList.remove("hidden");
  gameArea.scrollIntoView({ behavior: "smooth" });
}

// ---------- COINFLIP ----------
function renderCoinflip(){
  gameArea.innerHTML = `
    <h2>🪙 ${t("game.coinflip.name")}</h2>
    <p class="muted small">${t("game.coinflip.info")}</p>
    <input type="number" class="bet-input" id="coinBet" min="1" value="10">
    <div>
      <button class="btn-secondary" id="pickHeads">${t("game.coinflip.heads")}</button>
      <button class="btn-secondary" id="pickTails">${t("game.coinflip.tails")}</button>
    </div>
    <div class="coin" id="coinDisplay">🪙</div>
    <p id="coinResult" class="muted small"></p>
  `;

  const flip = async (choice) => {
    if (!requireSession()) return;
    const bet = Number(document.getElementById("coinBet").value) || 0;
    document.getElementById("coinResult").textContent = "...";
    try {
      const data = await apiFetch("/bet/coinflip", {
        method: "POST",
        body: JSON.stringify({
          minecraft_username: state.username,
          session_token: state.sessionToken,
          bet_amount: bet,
          choice,
          client_seed: getOrCreateClientSeed(),
        }),
      });
      document.getElementById("coinDisplay").textContent = data.result === "heads" ? "😀" : "🌑";
      document.getElementById("coinResult").textContent = data.won
        ? `${t("game.coinflip.won")}${data.payout} ${t("donuts")}.`
        : `${t("game.coinflip.lost")}${bet} ${t("donuts")}.`;
      state.balance = data.balance;
      updateBalanceDisplay();
    } catch (err) {
      document.getElementById("coinResult").textContent = t("error.genericPrefix") + err.message;
    }
  };

  document.getElementById("pickHeads").addEventListener("click", () => flip("heads"));
  document.getElementById("pickTails").addEventListener("click", () => flip("tails"));
}

// ---------- MINES ----------
function renderMines(){
  gameArea.innerHTML = `
    <h2>💣 ${t("game.mines.name")}</h2>
    <input type="number" class="bet-input" id="minesBet" min="1" value="10">
    <input type="number" class="bet-input" id="minesBombs" min="1" max="24" value="3" title="${t('game.mines.bombsLabel')}">
    <button class="btn-primary" id="minesStartBtn">${t("game.common.start")}</button>
    <div class="mines-grid hidden" id="minesGrid"></div>
    <button class="btn-secondary hidden" id="minesCashoutBtn">${t("game.common.cashout")}</button>
    <p id="minesResult" class="muted small"></p>
  `;
  document.getElementById("minesStartBtn").addEventListener("click", startMinesGame);
}

async function startMinesGame(){
  if (!requireSession()) return;
  const bet = Number(document.getElementById("minesBet").value) || 0;
  const bombs = Number(document.getElementById("minesBombs").value) || 0;
  const resultEl = document.getElementById("minesResult");

  try {
    const data = await apiFetch("/mines/start", {
      method: "POST",
      body: JSON.stringify({
        minecraft_username: state.username,
        session_token: state.sessionToken,
        bet_amount: bet,
        bombs_count: bombs,
        client_seed: getOrCreateClientSeed(),
      }),
    });

    state.activeMinesGameId = data.game_id;
    document.getElementById("minesStartBtn").classList.add("hidden");
    document.getElementById("minesBet").disabled = true;
    document.getElementById("minesBombs").disabled = true;
    resultEl.textContent = "";

    const grid = document.getElementById("minesGrid");
    grid.classList.remove("hidden");
    grid.innerHTML = "";

    for (let i = 0; i < data.board_size; i++){
      const tile = document.createElement("div");
      tile.className = "mine-tile";
      tile.textContent = "?";
      tile.addEventListener("click", () => revealMinesTile(i, tile));
      grid.appendChild(tile);
    }

    const cashoutBtn = document.getElementById("minesCashoutBtn");
    cashoutBtn.classList.remove("hidden");
    cashoutBtn.onclick = cashoutMines;
  } catch (err) {
    resultEl.textContent = t("error.genericPrefix") + err.message;
  }
}

async function revealMinesTile(tileIndex, tileEl){
  if (!state.activeMinesGameId) return;
  const resultEl = document.getElementById("minesResult");

  try {
    const data = await apiFetch("/mines/reveal", {
      method: "POST",
      body: JSON.stringify({
        minecraft_username: state.username,
        session_token: state.sessionToken,
        game_id: state.activeMinesGameId,
        tile_index: tileIndex,
      }),
    });

    if (data.result === "bomb"){
      tileEl.classList.add("revealed-bomb");
      tileEl.textContent = "💣";
      resultEl.textContent = t("game.mines.boom");
      finishMinesUI(data.bomb_positions);
    } else {
      tileEl.classList.add("revealed-safe");
      tileEl.textContent = "💎";
      resultEl.textContent = `${t("game.mines.multiplierPrefix")}${data.current_multiplier.toFixed(2)}x`;
      if (data.board_fully_cleared) {
        resultEl.textContent += t("game.mines.boardCleared");
      }
    }
  } catch (err) {
    resultEl.textContent = t("error.genericPrefix") + err.message;
  }
}

async function cashoutMines(){
  if (!state.activeMinesGameId) return;
  const resultEl = document.getElementById("minesResult");

  try {
    const data = await apiFetch("/mines/cashout", {
      method: "POST",
      body: JSON.stringify({
        minecraft_username: state.username,
        session_token: state.sessionToken,
        game_id: state.activeMinesGameId,
      }),
    });
    resultEl.textContent = `${t("game.crash.wonPrefix")}${data.multiplier.toFixed(2)}x. ${t("game.crash.wonMiddle")}${data.payout} ${t("donuts")}.`;
    state.balance = data.balance;
    updateBalanceDisplay();
    finishMinesUI(data.bomb_positions);
  } catch (err) {
    resultEl.textContent = t("error.genericPrefix") + err.message;
  }
}

function finishMinesUI(bombPositions){
  state.activeMinesGameId = null;
  document.getElementById("minesCashoutBtn").classList.add("hidden");
  document.getElementById("minesStartBtn").classList.remove("hidden");
  document.getElementById("minesBet").disabled = false;
  document.getElementById("minesBombs").disabled = false;

  if (bombPositions) {
    const tiles = document.querySelectorAll("#minesGrid .mine-tile");
    bombPositions.forEach((idx) => {
      if (!tiles[idx].classList.contains("revealed-safe") && !tiles[idx].classList.contains("revealed-bomb")) {
        tiles[idx].classList.add("revealed-bomb");
        tiles[idx].textContent = "💣";
      }
    });
  }
}

// ---------- CRASH ----------
function renderCrash(){
  gameArea.innerHTML = `
    <h2>📈 ${t("game.crash.name")}</h2>
    <p class="muted small">${t("game.crash.info")}</p>
    <input type="number" class="bet-input" id="crashBet" min="1" value="10">
    <div class="crash-display" id="crashMultiplier">1.00x</div>
    <button class="btn-primary" id="crashStart">${t("game.common.bet")}</button>
    <button class="btn-secondary hidden" id="crashCashout">${t("game.common.cashout")}</button>
    <p id="crashResult" class="muted small"></p>
  `;
  document.getElementById("crashStart").addEventListener("click", startCrashGame);
}

async function startCrashGame(){
  if (!requireSession()) return;
  const bet = Number(document.getElementById("crashBet").value) || 0;
  const resultEl = document.getElementById("crashResult");
  const startBtn = document.getElementById("crashStart");
  const cashoutBtn = document.getElementById("crashCashout");

  try {
    const data = await apiFetch("/crash/start", {
      method: "POST",
      body: JSON.stringify({
        minecraft_username: state.username,
        session_token: state.sessionToken,
        bet_amount: bet,
        client_seed: getOrCreateClientSeed(),
      }),
    });

    state.activeCrashGameId = data.game_id;
    startBtn.classList.add("hidden");
    cashoutBtn.classList.remove("hidden");
    resultEl.textContent = "";

    const tick = () => {
      const elapsedSeconds = (Date.now() - data.start_time) / 1000;
      const multiplier = Math.exp(data.growth_rate * elapsedSeconds);
      document.getElementById("crashMultiplier").textContent = multiplier.toFixed(2) + "x";
      state.crashAnimationFrame = requestAnimationFrame(tick);
    };
    tick();

    cashoutBtn.onclick = () => cashoutCrash(startBtn, cashoutBtn);
  } catch (err) {
    resultEl.textContent = t("error.genericPrefix") + err.message;
  }
}

async function cashoutCrash(startBtn, cashoutBtn){
  if (!state.activeCrashGameId) return;
  const resultEl = document.getElementById("crashResult");
  cancelAnimationFrame(state.crashAnimationFrame);

  try {
    const data = await apiFetch("/crash/cashout", {
      method: "POST",
      body: JSON.stringify({
        minecraft_username: state.username,
        session_token: state.sessionToken,
        game_id: state.activeCrashGameId,
      }),
    });

    if (data.result === "crashed"){
      document.getElementById("crashMultiplier").textContent = data.crash_point.toFixed(2) + "x";
      resultEl.textContent = t("game.crash.crashed");
    } else {
      document.getElementById("crashMultiplier").textContent = data.multiplier.toFixed(2) + "x";
      resultEl.textContent = `${t("game.crash.wonPrefix")}${data.multiplier.toFixed(2)}x. ${t("game.crash.wonMiddle")}${data.payout} ${t("donuts")}.`;
      state.balance = data.balance;
      updateBalanceDisplay();
    }
  } catch (err) {
    resultEl.textContent = t("error.genericPrefix") + err.message;
  } finally {
    state.activeCrashGameId = null;
    cashoutBtn.classList.add("hidden");
    startBtn.classList.remove("hidden");
  }
}
