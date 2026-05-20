const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const wss = new WebSocket.Server({ port: PORT });

const MAX_PLAYERS = 4;
let rooms = {};

function makeRoomCode() {
	let code = "";

	for (let i = 0; i < 6; i++) {
		code += Math.floor(Math.random() * 10).toString();
	}

	return code;
}

function cleanRoomCode(value) {
	return String(value || "").trim().replace(/\D/g, "").slice(0, 6);
}

function send(ws, data) {
	if (ws && ws.readyState === WebSocket.OPEN) {
		ws.send(JSON.stringify(data));
	}
}

function broadcast(roomCode, data) {
	if (!rooms[roomCode]) return;

	for (const player of rooms[roomCode].players) {
		if (!player.is_bot) {
			send(player.ws, data);
		}
	}
}

function getPublicPlayers(room) {
	return room.players.map(p => ({
		id: p.id || "",
		name: p.name,
		player_index: p.player_index,
		connected: p.is_bot ? true : p.ws !== null,
		is_bot: !!p.is_bot
	}));
}

function sendRoomUpdate(roomCode) {
	if (!rooms[roomCode]) return;

	const room = rooms[roomCode];

	broadcast(roomCode, {
		type: "room_update",
		room: roomCode,
		player_count: room.players.length,
		max_players: MAX_PLAYERS,
		players: getPublicPlayers(room)
	});
}

function findFreeIndex(room) {
	for (let i = 0; i < MAX_PLAYERS; i++) {
		const exists = room.players.some(p => p.player_index === i);
		if (!exists) {
			return i;
		}
	}

	return -1;
}

function findFirstBot(room) {
	for (const p of room.players) {
		if (p.is_bot) {
			return p;
		}
	}

	return null;
}

function sortPlayers(room) {
	room.players.sort((a, b) => a.player_index - b.player_index);
}

wss.on("connection", function connection(ws) {
	console.log("Yeni bağlantı geldi");

	ws.roomCode = null;
	ws.playerIndex = null;
	ws.playerName = "Oyuncu";

	ws.on("message", function incoming(message) {
		let data;

		try {
			data = JSON.parse(message);
		} catch (e) {
			console.log("JSON okunamadı");
			return;
		}

		console.log("Mesaj geldi:", data);

		if (data.type === "create_room") {
			let roomCode = cleanRoomCode(data.room);

			if (roomCode.length !== 6) {
				roomCode = makeRoomCode();
			}

			while (rooms[roomCode]) {
				roomCode = makeRoomCode();
			}

			rooms[roomCode] = {
				code: roomCode,
				players: [],
				started: false
			};

			const player = {
				id: "real_0_" + Date.now(),
				name: data.name || "Host",
				player_index: 0,
				ws: ws,
				is_bot: false
			};

			rooms[roomCode].players.push(player);

			ws.roomCode = roomCode;
			ws.playerIndex = 0;
			ws.playerName = player.name;

			send(ws, {
				type: "room_created",
				room: roomCode,
				player_index: 0
			});

			sendRoomUpdate(roomCode);

			console.log("Oda oluşturuldu:", roomCode);
			return;
		}

		if (data.type === "join_room") {
			const roomCode = cleanRoomCode(data.room);

			if (roomCode.length !== 6) {
				send(ws, {
					type: "join_failed",
					reason: "Oda kodu 6 haneli sayı olmalı"
				});
				return;
			}

			if (!rooms[roomCode]) {
				send(ws, {
					type: "join_failed",
					reason: "Oda bulunamadı"
				});
				return;
			}

			const room = rooms[roomCode];

			if (room.started) {
				send(ws, {
					type: "join_failed",
					reason: "Oyun başladı"
				});
				return;
			}

			let playerIndex = -1;
			const botToReplace = findFirstBot(room);

			if (botToReplace !== null) {
				playerIndex = botToReplace.player_index;

				botToReplace.id = "real_" + playerIndex + "_" + Date.now();
				botToReplace.name = data.name || ("Oyuncu " + (playerIndex + 1));
				botToReplace.ws = ws;
				botToReplace.is_bot = false;
			} else {
				if (room.players.length >= MAX_PLAYERS) {
					send(ws, {
						type: "join_failed",
						reason: "Oda dolu"
					});
					return;
				}

				playerIndex = findFreeIndex(room);

				if (playerIndex === -1) {
					send(ws, {
						type: "join_failed",
						reason: "Oda dolu"
					});
					return;
				}

				room.players.push({
					id: "real_" + playerIndex + "_" + Date.now(),
					name: data.name || ("Oyuncu " + (playerIndex + 1)),
					player_index: playerIndex,
					ws: ws,
					is_bot: false
				});
			}

			sortPlayers(room);

			ws.roomCode = roomCode;
			ws.playerIndex = playerIndex;
			ws.playerName = data.name || ("Oyuncu " + (playerIndex + 1));

			send(ws, {
				type: "room_joined",
				room: roomCode,
				player_index: playerIndex
			});

			sendRoomUpdate(roomCode);

			console.log("Odaya katıldı:", roomCode, "Oyuncu:", playerIndex);
			return;
		}

		if (data.type === "add_bot") {
			const roomCode = ws.roomCode;

			if (!roomCode || !rooms[roomCode]) return;

			const room = rooms[roomCode];

			if (ws.playerIndex !== 0) {
				send(ws, {
					type: "add_bot_failed",
					reason: "Botu sadece host ekleyebilir"
				});
				return;
			}

			if (room.started) {
				send(ws, {
					type: "add_bot_failed",
					reason: "Oyun başladı"
				});
				return;
			}

			if (room.players.length >= MAX_PLAYERS) {
				send(ws, {
					type: "add_bot_failed",
					reason: "Oda dolu"
				});
				return;
			}

			const botIndex = findFreeIndex(room);

			if (botIndex === -1) {
				send(ws, {
					type: "add_bot_failed",
					reason: "Boş oyuncu yeri yok"
				});
				return;
			}

			room.players.push({
				id: "bot_" + botIndex + "_" + Date.now(),
				name: "BOT " + (botIndex + 1),
				player_index: botIndex,
				ws: null,
				is_bot: true
			});

			sortPlayers(room);
			sendRoomUpdate(roomCode);

			console.log("Bot eklendi:", roomCode, "Bot:", botIndex);
			return;
		}

		if (data.type === "game_join") {
			const roomCode = cleanRoomCode(data.room);
			const playerIndex = parseInt(data.player_index || 0);

			if (!rooms[roomCode]) {
				console.log("Game join oda yok:", roomCode);
				return;
			}

			const room = rooms[roomCode];

			for (const p of room.players) {
				if (p.player_index === playerIndex && !p.is_bot) {
					p.ws = ws;
					p.name = data.name || p.name;
					break;
				}
			}

			ws.roomCode = roomCode;
			ws.playerIndex = playerIndex;
			ws.playerName = data.name || "Oyuncu";

			console.log("Oyuna geri bağlandı:", roomCode, "Oyuncu:", playerIndex);
			return;
		}

		if (data.type === "start_game") {
			const roomCode = ws.roomCode;

			if (!roomCode || !rooms[roomCode]) return;

			const room = rooms[roomCode];

			if (ws.playerIndex !== 0) {
				send(ws, {
					type: "start_failed",
					reason: "Oyunu sadece host başlatabilir"
				});
				return;
			}

			if (room.players.length < MAX_PLAYERS) {
				send(ws, {
					type: "start_failed",
					reason: "Oyun için 4 oyuncu gerekli"
				});
				return;
			}

			room.started = true;
			sortPlayers(room);

			broadcast(roomCode, {
				type: "start_game",
				room: roomCode,
				players: getPublicPlayers(room)
			});

			console.log("Oyun başlatıldı:", roomCode);
			return;
		}

		if (
			data.type === "spawn" ||
			data.type === "move" ||
			data.type === "state" ||
			data.type === "turn_update" ||
			data.type === "kill"
		) {
			const roomCode = ws.roomCode || cleanRoomCode(data.room);

			if (!roomCode || !rooms[roomCode]) return;

			data.room = roomCode;
			data.player_index = ws.playerIndex;

			broadcast(roomCode, data);

			console.log("Oyun mesajı yayıldı:", data.type, roomCode);
			return;
		}
	});

	ws.on("close", function close() {
		const roomCode = ws.roomCode;

		console.log("Oyuncu ayrıldı:", roomCode);

		if (!roomCode || !rooms[roomCode]) return;

		for (const p of rooms[roomCode].players) {
			if (!p.is_bot && p.ws === ws) {
				p.ws = null;
			}
		}

		sendRoomUpdate(roomCode);
	});
});

console.log("Server çalışıyor. Port:", PORT);
