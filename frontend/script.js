// ==============================
// CONFIGURACIÓN
// ==============================
// Cambia esto por la URL real de tu despliegue en Vercel, por ejemplo:
// const API_BASE_URL = "https://donut-clash-api.vercel.app/api";
const API_BASE_URL = "https://TU-PROYECTO.vercel.app/api";

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
const linkScreen   = document.getElementById("linkScreen");
const gamesScreen  = document.getElementById("gamesScreen");
const step1        = document.getElementById("step1");
const step2        = document.getElementById("step2");
const mcUsername   = document.getElementById("mcUsername");
const generateBtn  = document.getElementById("generateBtn");
const cancelLinkBtn= document.getElementById("cancelLinkBtn");
const payCommand   = document.getElementById("payCommand");
const codeValue    = document.getElementById("codeValue");
const linkError    = document.getElementById("linkError");
const balanceBox   = document.getElementById("balanceBox");
const balanceValue = document.getElementById("balanceValue");
const welcomeUser  = document.getElementById("welcomeUser");
const gameArea     = document.getElementById("gameArea");

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
  if (!res.ok) throw new Error(data.error || "Error de red");
  return data;
}

// ==============================
// PASO 1: GENERAR CÓDIGO
// ==============================
generateBtn.addEventListener("click", async () => {
  const username = mcUsername.value.trim();
  clearError();

  if (!username) {
    showError("Introduce un nombre de usuario válido.");
    return;
  }

  generateBtn.disabled = true;
  generateBtn.textContent = "Generando...";

  try {
    const data = await apiFetch("/generate-code", {
      method: "POST",
      body: JSON.stringify({ minecraft_username: username }),
    });

    state.username = username;
    codeValue.textContent = data.code;
    payCommand.textContent = `/pay Donaciones ${data.code}`;

    step1.classList.add("hidden");
    step2.classList.remove("hidden");

    startPolling();
  } catch (err) {
    showError(err.message);
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = "Generar código";
  }
});

cancelLinkBtn.addEventListener("click", () => {
  stopPolling();
  step2.classList.add("hidden");
  step1.classList.remove("hidden");
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
        // Si la sesión ya fue reclamada antes (recarga de página, etc.),
        // igual dejamos ver el saldo, pero sin poder apostar hasta re-vincular.
        console.error("No se pudo reclamar la sesión:", err.message);
      }
      enterGamesScreen(data);
    }
  } catch (err) {
    // Silencioso: el usuario aún no ha completado el pago, seguimos esperando.
  }
}

// ==============================
// PANTALLA DE JUEGOS
// ==============================
function enterGamesScreen(userData){
  state.balance = userData.balance || 0;

  linkScreen.classList.add("hidden");
  gamesScreen.classList.remove("hidden");
  balanceBox.classList.remove("hidden");

  welcomeUser.textContent = state.username;
  updateBalanceDisplay();

  document.querySelectorAll(".game-card").forEach(card => {
    card.addEventListener("click", () => openGame(card.dataset.game));
  });

  // Refrescamos el saldo real desde la API cada 5s también en esta pantalla
  setInterval(refreshBalance, 5000);
}

async function refreshBalance(){
  try {
    const data = await apiFetch(`/user/${encodeURIComponent(state.username)}`);
    state.balance = data.balance;
    updateBalanceDisplay();
  } catch (err) {
    console.error("No se pudo refrescar el saldo:", err.message);
  }
}

function updateBalanceDisplay(){
  balanceValue.textContent = state.balance;
}

// ==============================
// JUEGOS (conectados al backend real — el resultado siempre lo decide
// el servidor con lógica provably-fair; el cliente nunca determina quién
// gana, solo muestra lo que la API responde).
// ==============================

function requireSession(){
  if (!state.sessionToken) {
    alert("Tu sesión no es válida. Recarga la página y vuelve a vincular tu cuenta.");
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
    <h2>🪙 Coinflip</h2>
    <p class="muted small">Moneda real 50/50 · pago x1.4 (margen de la casa incluido).</p>
    <input type="number" class="bet-input" id="coinBet" placeholder="Apuesta" min="1" value="10">
    <div>
      <button class="btn-secondary" id="pickHeads">Cara</button>
      <button class="btn-secondary" id="pickTails">Cruz</button>
    </div>
    <div class="coin" id="coinDisplay">🪙</div>
    <p id="coinResult" class="muted small"></p>
  `;

  const flip = async (choice) => {
    if (!requireSession()) return;
    const bet = Number(document.getElementById("coinBet").value) || 0;
    document.getElementById("coinResult").textContent = "Lanzando...";
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
        ? `¡Ganaste! +${data.payout} donuts.`
        : `Perdiste ${bet} donuts.`;
      state.balance = data.balance;
      updateBalanceDisplay();
    } catch (err) {
      document.getElementById("coinResult").textContent = `Error: ${err.message}`;
    }
  };

  document.getElementById("pickHeads").addEventListener("click", () => flip("heads"));
  document.getElementById("pickTails").addEventListener("click", () => flip("tails"));
}

// ---------- MINES ----------
function renderMines(){
  gameArea.innerHTML = `
    <h2>💣 Mines</h2>
    <p class="muted small">Elige cuántas bombas quieres arriesgar y empieza la partida.</p>
    <input type="number" class="bet-input" id="minesBet" placeholder="Apuesta" min="1" value="10">
    <input type="number" class="bet-input" id="minesBombs" placeholder="Bombas (1-24)" min="1" max="24" value="3">
    <button class="btn-primary" id="minesStartBtn">Empezar partida</button>
    <div class="mines-grid hidden" id="minesGrid"></div>
    <button class="btn-secondary hidden" id="minesCashoutBtn">Retirar</button>
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
    resultEl.textContent = `Error: ${err.message}`;
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
      resultEl.textContent = "¡Boom! Perdiste la apuesta.";
      finishMinesUI(data.bomb_positions);
    } else {
      tileEl.classList.add("revealed-safe");
      tileEl.textContent = "💎";
      resultEl.textContent = `Multiplicador actual: ${data.current_multiplier.toFixed(2)}x`;
      if (data.board_fully_cleared) {
        resultEl.textContent += " · ¡Tablero completo! Retira ahora.";
      }
    }
  } catch (err) {
    resultEl.textContent = `Error: ${err.message}`;
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
    resultEl.textContent = `Retiraste en ${data.multiplier.toFixed(2)}x. Ganaste ${data.payout} donuts.`;
    state.balance = data.balance;
    updateBalanceDisplay();
    finishMinesUI(data.bomb_positions);
  } catch (err) {
    resultEl.textContent = `Error: ${err.message}`;
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
    <h2>📈 Crash</h2>
    <p class="muted small">El punto de choque ya está decidido (provably-fair) y oculto. Retira antes de que reviente.</p>
    <input type="number" class="bet-input" id="crashBet" placeholder="Apuesta" min="1" value="10">
    <div class="crash-display" id="crashMultiplier">1.00x</div>
    <button class="btn-primary" id="crashStart">Apostar</button>
    <button class="btn-secondary hidden" id="crashCashout">Retirar</button>
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
    resultEl.textContent = `Error: ${err.message}`;
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
      resultEl.textContent = "💥 Se estrelló antes de que retiraras. Perdiste la apuesta.";
    } else {
      document.getElementById("crashMultiplier").textContent = data.multiplier.toFixed(2) + "x";
      resultEl.textContent = `Retiraste en ${data.multiplier.toFixed(2)}x. Ganaste ${data.payout} donuts.`;
      state.balance = data.balance;
      updateBalanceDisplay();
    }
  } catch (err) {
    resultEl.textContent = `Error: ${err.message}`;
  } finally {
    state.activeCrashGameId = null;
    cashoutBtn.classList.add("hidden");
    startBtn.classList.remove("hidden");
  }
}
