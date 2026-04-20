console.log("test")

import express from "express";
import http from "http";
import { Server } from "socket.io";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static("public"));

/* ---------------- GAME STATE ---------------- */

let game = {
  players: {}, // socketId -> { id, name, score }
  order: [],
  currentDrawerIndex: 0,

  currentPokemon: null,

  roundTimeLeft: 120,
  roundTimer: null,

  started: false
};

async function getPokemonNames() {
  // Use a high limit to get all Pokémon at once
  const response = await fetch('https://pokeapi.co/api/v2/pokemon?limit=151');
  const data = await response.json();

  // Extract only the 'name' property from each result
  const names = data.results.map(pokemon => pokemon.name);

  console.log(names); // Example: ["bulbasaur", "ivysaur", "venusaur", ...]
  return names;
}

const pokemonList = await getPokemonNames();

/* ---------------- OAUTH ---------------- */

app.post("/api/token", async (req, res) => {
  const { code } = req.body;

  try {
    const response = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: process.env.REDIRECT_URI
      })
    });

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "OAuth failed" });
  }
});

/* ---------------- HELPERS ---------------- */

function getRandomPokemon() {
  return pokemonList[Math.floor(Math.random() * pokemonList.length)];
}

function emitScoreboard() {
  io.emit("scoreboardUpdate", game.players);
}

/* ---------------- POKEMON SYSTEM ---------------- */

function startNewPokemon(drawerId) {
  game.currentPokemon = getRandomPokemon();

  // ONLY drawer sees answer
  io.to(drawerId).emit("yourPokemon", game.currentPokemon);

  // guessers clear visual state
  io.emit("clearCanvas");

  emitScoreboard();
}

/* ---------------- ROUND SYSTEM ---------------- */

function startRound() {
  if (game.order.length === 0) return;

  const drawerId = game.order[game.currentDrawerIndex];

  game.roundTimeLeft = 120;
  game.currentPokemon = null;

  io.emit("roundStart", { drawer: drawerId });
  io.to(drawerId).emit("yourTurn");

  clearInterval(game.roundTimer);

  startNewPokemon(drawerId);

  game.roundTimer = setInterval(() => {
    game.roundTimeLeft--;

    io.emit("timer", game.roundTimeLeft);

    if (game.roundTimeLeft <= 0) {
      endRound();
    }
  }, 1000);
}

function endRound() {
  clearInterval(game.roundTimer);

  io.emit("roundEnd");

  game.currentDrawerIndex =
    (game.currentDrawerIndex + 1) % game.order.length;

  setTimeout(startRound, 3000);
}

/* ---------------- SOCKET.IO ---------------- */

io.on("connection", (socket) => {
  console.log("CONNECTED:", socket.id);

  /* ---------------- JOIN LOBBY ---------------- */
  socket.on("joinGame", (name) => {
    game.players[socket.id] = {
      id: socket.id,
      name: name || "Anonymous",
      score: 0
    };

    game.order.push(socket.id);

    emitScoreboard();
  });

  /* ---------------- START GAME ---------------- */
  socket.on("startGame", () => {
    if (game.started) return;

    game.started = true;
    game.currentDrawerIndex = 0;

    startRound();

    console.log("Game started");
  });

  /* ---------------- DRAW ---------------- */
  socket.on("draw", (data) => {
    socket.broadcast.emit("draw", data);
  });

  socket.on("clearCanvas", () => {
    io.emit("clearCanvas");
  });

  /* ---------------- SKIP (DRAWER ONLY) ---------------- */
  socket.on("skipPokemon", () => {
    const drawerId = game.order[game.currentDrawerIndex];

    if (socket.id !== drawerId) return;

    io.emit("clearCanvas");
    startNewPokemon(drawerId);
  });

  /* ---------------- GUESS ---------------- */
  socket.on("guess", (guess) => {
    if (!game.currentPokemon) return;

    const cleaned = guess.trim().toLowerCase();
    const target = game.currentPokemon.toLowerCase();

    if (cleaned === target) {
      const player = game.players[socket.id];
      if (!player) return;

      player.score += 1;

      io.emit("correctGuess", {
        playerId: socket.id,
        name: player.name,
        pokemon: game.currentPokemon
      });

      io.emit("clearCanvas");

      emitScoreboard();

      const drawerId = game.order[game.currentDrawerIndex];

      setTimeout(() => {
        startNewPokemon(drawerId);
      }, 300);
    }
  });

  /* ---------------- DISCONNECT ---------------- */
  socket.on("disconnect", () => {
    delete game.players[socket.id];
    game.order = game.order.filter(id => id !== socket.id);

    emitScoreboard();

    if (game.order.length === 0) {
      game.started = false;
      clearInterval(game.roundTimer);
    }
  });
});

/* ---------------- START SERVER ---------------- */

server.listen(25633, () => {
  console.log("Running on http://localhost:25633");
});
