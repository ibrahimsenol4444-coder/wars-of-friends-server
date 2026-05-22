const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const wss = new WebSocket.Server({ port: PORT });

const MAX_PLAYERS = 4;
const DISCONNECT_CLEANUP_MS = 10000;

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

function cleanSkin(value) {
	const skin = String(value || "yeniceri").trim();

	const allowedSkins = [
		"yeniceri",
		"viking",
		"samuray",
		"spartali",
		"kurt_savascisi",
		"barbar",
		"gladyator",
		"ninja",
		"vampir",
		"zirhli_sovalye"
	];

	if (allowedSkins.includes(skin)) {
		return skin;
	}

	return "yeniceri";
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

function sortPlayers(room) {
	room.players.sort((a, b) => a.player_index - b.player_index);
}

function getPublicPlayers(room) {
	sortPlayers(room);

	return room.players.map(p => ({
		id: p.id || "",
		name: p.name,
		player_index: p.player_index,
		skin: p.skin || "yeniceri",
		connected: p.is_bot ? true : p.ws !== null,
		is_bot: !!p.is_bot,
		disconnected: !p.is_bot && p.ws === null
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

function findDisconnectedByName(room, name) {
	const cleanName = String(name || "").trim();

	if (cleanName === "") {
		return null;
	}

	for (const p of room.players) {
		if (!p.is_bot && p.ws === null && p.name === cleanName) {
			return p;
		}
	}

	return null;
}

function findPlayerByIndex(room, playerIndex) {
	for (const p of room.players) {
		if (p.player_index === playerIndex) {
			return p;
		}
	}

	return null;
}

function removePlayer(roomCode, playerIndex, reason) {
	if (!rooms[roomCode]) return;

	const room = rooms[roomCode];
	const beforeCount = room.players.length;

	room.players = room.players.filter(p => p.player_index !== playerIndex);

	if (room.players.length !== beforeCount) {
		console.log("Oyuncu silindi:", roomCode, "Oyuncu:", playerIndex, "Sebep:", reason);
	}

	if (room.players.length <= 0) {
		delete rooms[roomCode];
		console.log("Oda silindi:", roomCode);
		return;
	}

	sortPlayers(room);
	sendRoomUpdate(roomCode);
}

function scheduleDisconnectCleanup(roomCode, playerIndex) {
	setTimeout(() => {
		if (!rooms[roomCode]) return;

		const room = rooms[roomCode];
		const player = findPlayerByIndex(room, playerIndex);

		if (!player) return;
		if (player.is_bot) return;
		if (player.ws !== null) return;

		removePlayer(roomCode, playerIndex, "disconnect_timeout");
	}, DISCONNECT_CLEANUP_MS);
}

function attachRealPlayerToSlot(ws, roomCode, room, slotPlayer, name, skin) {
	slotPlayer.id = "real_" + slotPlayer.player_index + "_" + Date.now();
	slotPlayer.name = name || ("Oyuncu " + (slotPlayer.player_index + 1));
	slotPlayer.skin = cleanSkin(skin);
	slotPlayer.ws = ws;
	slotPlayer.is_bot = false;
	slotPlayer.disconnected_at = null;

	ws.roomCode = roomCode;
	ws.playerIndex = slotPlayer.player_index;
	ws.playerName = slotPlayer.name;

	return slotPlayer.player_index;
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
				skin: cleanSkin(data.skin),
				ws: ws,
				is_bot: false,
				disconnected_at: null
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
			const playerName = data.name || "Oyuncu";
			const playerSkin = cleanSkin(data.skin);

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

			const reconnectPlayer = findDisconnectedByName(room, playerName);

			if (reconnectPlayer !== null) {
				playerIndex = attachRealPlayerToSlot(ws, roomCode, room, reconnectPlayer, playerName, playerSkin);
				console.log("Oyuncu lobiye geri bağlandı:", roomCode, "Oyuncu:", playerIndex);
			} else {
				const botToReplace = findFirstBot(room);

				if (botToReplace !== null) {
					playerIndex = attachRealPlayerToSlot(ws, roomCode, room, botToReplace, playerName, playerSkin);
					console.log("Gerçek oyuncu botun yerine geçti:", roomCode, "Oyuncu:", playerIndex);
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
						name: playerName || ("Oyuncu " + (playerIndex + 1)),
						player_index: playerIndex,
						skin: playerSkin,
						ws: ws,
						is_bot: false,
						disconnected_at: null
					});

					ws.roomCode = roomCode;
					ws.playerIndex = playerIndex;
					ws.playerName = playerName || ("Oyuncu " + (playerIndex + 1));
				}
			}

			sortPlayers(room);

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
				skin: "yeniceri",
				ws: null,
				is_bot: true,
				disconnected_at: null
			});

			sortPlayers(room);
			sendRoomUpdate(roomCode);

			console.log("Bot eklendi:", roomCode, "Bot:", botIndex);
			return;
		}

		if (data.type === "kick_player") {
			const roomCode = ws.roomCode;

			if (!roomCode || !rooms[roomCode]) return;

			const room = rooms[roomCode];
			const targetIndex = parseInt(data.player_index);

			if (ws.playerIndex !== 0) {
				send(ws, {
					type: "kick_failed",
					reason: "Oyuncuyu sadece host çıkarabilir"
				});
				return;
			}

			if (targetIndex === 0) {
				send(ws, {
					type: "kick_failed",
					reason: "Host çıkarılamaz"
				});
				return;
			}

			const target = findPlayerByIndex(room, targetIndex);

			if (!target) {
				send(ws, {
					type: "kick_failed",
					reason: "Oyuncu bulunamadı"
				});
				return;
			}

			if (!target.is_bot) {
				send(target.ws, {
					type: "kicked",
					reason: "Host seni odadan çıkardı"
				});

				if (target.ws && target.ws.readyState === WebSocket.OPEN) {
					target.ws.close();
				}
			}

			removePlayer(roomCode, targetIndex, "host_kick");
			return;
		}

		if (data.type === "leave_room") {
			const roomCode = ws.roomCode;
			const playerIndex = ws.playerIndex;

			if (!roomCode || !rooms[roomCode]) return;

			removePlayer(roomCode, playerIndex, "leave_room");

			ws.roomCode = null;
			ws.playerIndex = null;
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
			const player = findPlayerByIndex(room, playerIndex);

			if (player && !player.is_bot) {
				player.ws = ws;
				player.name = data.name || player.name;
				player.skin = cleanSkin(data.skin || player.skin);
				player.disconnected_at = null;
			}

			ws.roomCode = roomCode;
			ws.playerIndex = playerIndex;
			ws.playerName = data.name || "Oyuncu";

			sendRoomUpdate(roomCode);

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
		const playerIndex = ws.playerIndex;

		console.log("Oyuncu bağlantısı koptu:", roomCode, playerIndex);

		if (!roomCode || !rooms[roomCode]) return;

		const room = rooms[roomCode];
		const player = findPlayerByIndex(room, playerIndex);

		if (!player) return;
		if (player.is_bot) return;

		if (player.ws === ws) {
			player.ws = null;
			player.disconnected_at = Date.now();
		}

		sendRoomUpdate(roomCode);
		scheduleDisconnectCleanup(roomCode, playerIndex);
	});
});

console.log("Server çalışıyor. Port:", PORT);
