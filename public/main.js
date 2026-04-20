console.log("Main file loaded")

function showToast(message) {
  const container = document.getElementById("toastContainer");

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerText = message;

  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3000);
}


const socket = io();

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

canvas.width = 800;
canvas.height = 500;

/* ---------------- STATE ---------------- */

let drawing = false;
let isDrawer = false;
let lastPoint = null;

let color = "#000000";
let brushSize = 3;
let isEraser = false;

/* ---------------- LOBBY JOIN ---------------- */

let playerName = "";

const lobby = document.getElementById("lobby");
const joinBtn = document.getElementById("joinBtn");

joinBtn.onclick = () => {
  const input = document.getElementById("nameInput");
  playerName = input.value.trim();

  if (!playerName) return;

  socket.emit("joinGame", playerName);

  lobby.style.display = "none";

  showToast("Welcome " + playerName + "!");
};

/* ---------------- CONTROLS ---------------- */

const colorPicker = document.getElementById("colorPicker");
const brushInput = document.getElementById("brushSize");
const eraserBtn = document.getElementById("eraserBtn");
const clearBtn = document.getElementById("clearBtn");
const skipBtn = document.getElementById("skipBtn");

function setRole(text, type = "") {
  const role = document.getElementById("role");
  role.innerText = text;
  role.className = type;
}

/* ---------------- CHOOSE POKEMON ---------------- */

socket.on("choosePokemon", (options) => {
  const overlay = document.getElementById("choosePokemon");
  const optionsDiv = document.getElementById("pokemonOptions");

  console.log("choosePokemon event received", options);
  showToast("Choose a Pokémon to draw!");

  optionsDiv.innerHTML = "";

  options.forEach(option => {
    const div = document.createElement("div");
    div.className = "pokemonOption";

    if (option.image) {
      const img = document.createElement("img");
      img.src = option.image;
      img.alt = option.name;
      div.appendChild(img);
    }

    const p = document.createElement("p");
    p.innerText = option.name.charAt(0).toUpperCase() + option.name.slice(1);
    div.appendChild(p);

    div.onclick = () => {
      socket.emit("selectPokemon", option.name);
      overlay.classList.remove("visible");
    };

    optionsDiv.appendChild(div);
  });

  overlay.classList.add("visible");
  overlay.style.zIndex = "2147483647";
});

/* ---------------- DRAWING ---------------- */

colorPicker.oninput = (e) => {
  color = e.target.value;
  isEraser = false;
};

const quickColors = document.querySelectorAll(".colorSwatch");

quickColors.forEach((swatch) => {
  swatch.addEventListener("click", () => {
    const selectedColor = swatch.dataset.color;

    color = selectedColor;
    isEraser = false;

    document.getElementById("colorPicker").value = selectedColor;
  });
});

brushInput.oninput = (e) => {
  brushSize = parseInt(e.target.value);
};

eraserBtn.onclick = () => {
  isEraser = true;
};

clearBtn.onclick = () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  socket.emit("clearCanvas");
};

canvas.addEventListener("mousedown", (e) => {
  if (!isDrawer) return;

  drawing = true;
  lastPoint = getPoint(e);
});

canvas.addEventListener("mouseup", () => {
  drawing = false;
  lastPoint = null;
});

let canSend = true;

canvas.addEventListener("mousemove", (e) => {
  if (!drawing || !isDrawer || !canSend) return;

  canSend = false;
  setTimeout(() => (canSend = true), 10);

  const currentPoint = getPoint(e);

  const drawData = {
    from: lastPoint,
    to: currentPoint,
    color: isEraser ? "#ffffff" : color,
    size: brushSize
  };

  socket.emit("draw", drawData);
  drawLine(drawData);

  lastPoint = currentPoint;
});

/* ---------------- HELPERS ---------------- */

function getPoint(e) {
  const rect = canvas.getBoundingClientRect();

  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY
  };
}

function drawLine(data) {
  if (!data.from || !data.to) return;

  ctx.strokeStyle = data.color;
  ctx.lineWidth = data.size;
  ctx.lineCap = "round";

  ctx.beginPath();
  ctx.moveTo(data.from.x, data.from.y);
  ctx.lineTo(data.to.x, data.to.y);
  ctx.stroke();
}

/* ---------------- SOCKET ---------------- */

socket.on("connect", () => {
  console.log("Connected:", socket.id);
});

socket.on("draw", drawLine);

socket.on("clearCanvas", () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  canvas.style.transform = "scale(0.98)";
  setTimeout(() => (canvas.style.transform = "scale(1)"), 80);
});

socket.on("yourTurn", () => {
  showToast("Choose a Pokémon to draw!");
});

/* ---------------- GAME ---------------- */

/* ROUND START = SINGLE SOURCE OF TRUTH FOR ROLE UI */
socket.on("roundStart", ({ drawer }) => {
  isDrawer = socket.id === drawer;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  setRole(
    isDrawer ? "You are drawing!" : "Guess the Pokémon!",
    isDrawer ? "drawer" : "guesser"
  );
  showToast("New round started!");
  document.getElementById("pokemon").innerText = "";

  if (skipBtn) skipBtn.style.display = isDrawer ? "block" : "none";
});

/* ONLY DRAWER sees Pokémon */
socket.on("yourPokemon", (name) => {
  const pokemon = document.getElementById("pokemon");
  pokemon.innerText = name;

  pokemon.style.transform = "scale(1.05)";
  setTimeout(() => (pokemon.style.transform = "scale(1)"), 120);
});

/* TIMER */
socket.on("timer", (t) => {
  const timer = document.getElementById("timer");
  timer.innerText = `Time: ${t}`;

  if (t <= 10) {
    timer.style.color = "#ff4d4d";
    timer.style.transform = "scale(1.1)";
  } else {
    timer.style.color = "white";
    timer.style.transform = "scale(1)";
  }
});

/* ROUND END */
socket.on("roundEnd", () => {
  isDrawer = false;

  setRole("Round ended!");

  document.getElementById("pokemon").innerText = "";

  if (skipBtn) skipBtn.style.display = "none";
});

/* CORRECT GUESS */
socket.on("correctGuess", ({ playerId, name, pokemon }) => {
  console.log("Correct guess by:", playerId);
  showToast(`🎉 ${name} guessed ${pokemon}!`);

  // Reveal the Pokémon to everyone
  document.getElementById("pokemon").innerText = pokemon;

  // DO NOT overwrite role text (fixes your bug)
  // instead just flash effect
  const role = document.getElementById("role");
  role.style.transform = "scale(1.08)";
  setTimeout(() => (role.style.transform = "scale(1)"), 150);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
});

/* ---------------- SCOREBOARD ---------------- */

socket.on("scoreboardUpdate", (players) => {
  const board = document.getElementById("scoreboard");
  if (!board) return;

  const sorted = Object.values(players)
    .sort((a, b) => b.score - a.score);

  board.innerHTML = sorted.map((p, i) => `
    <div>
      <span>${i === 0 ? "👑 " : ""}${p.name}</span>
      <b>${p.score}</b>
    </div>
  `).join("");
});

/* ---------------- INPUT ---------------- */

document.getElementById("guessBox").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    socket.emit("guess", e.target.value);
    e.target.value = "";
  }
});

/* ---------------- SKIP ---------------- */

if (skipBtn) {
  skipBtn.onclick = () => {
    socket.emit("skipPokemon");
    showToast("Pokemon skipped!");
  };
}

/* ---------------- START ---------------- */

document.getElementById("startBtn").onclick = () => {
  console.log("Starting game...");
  socket.emit("startGame");
};
