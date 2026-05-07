const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const wss = new WebSocket.Server({ port: PORT });

let rooms = {};

function makeRoomCode() {
	const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
	let code = "";

	for (let i = 0; i < 6; i++) {
		code += chars[Math.floor(Math.random() * chars.length)];
	}

	return code;
}

function send(ws, data) {
	if (ws && ws.readyState === WebSocket.OPEN) {
		ws.send(JSON.stringify(data));
	}
}

function broadcast(roomCode, data) {
	if (!rooms[roomCode]) return;

	for (const player of rooms[roomCode].players) {
		send(player.ws, data);
	}
}

function sendRoomUpdate(roomCode) {
	if (!rooms[roomCode]) return;

	const room = rooms[roomCode];

	broadcast(roomCode, {
		type: "room_update",
		room: roomCode,
		player_count: room.players.length,
		players: room.players.map(p => ({
			id: p.id,
			name: p.name,
			player_index: p.player_index
		}))
	});
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
			const roomCode = String(data.room || makeRoomCode()).trim().toUpperCase();

			rooms[roomCode] = {
				code: roomCode,
				players: []
			};

			const player = {
				name: data.name || "Host",
				player_index: 0,
				ws: ws
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
			const roomCode = String(data.room || "").trim().toUpperCase();

			if (!rooms[roomCode]) {
				send(ws, {
					type: "join_failed",
					reason: "Oda bulunamadı"
				});
				return;
			}

			const room = rooms[roomCode];

			if (room.players.length >= 4) {
				send(ws, {
					type: "join_failed",
					reason: "Oda dolu"
				});
				return;
			}

			const playerIndex = room.players.length;

			const player = {
				name: data.name || ("Oyuncu " + (playerIndex + 1)),
				player_index: playerIndex,
				ws: ws
			};

			room.players.push(player);

			ws.roomCode = roomCode;
			ws.playerIndex = playerIndex;
			ws.playerName = player.name;

			send(ws, {
				type: "room_joined",
				room: roomCode,
				player_index: playerIndex
			});

			sendRoomUpdate(roomCode);

			console.log("Odaya katıldı:", roomCode, "Oyuncu:", playerIndex);
			return;
		}

		if (data.type === "game_join") {
			const roomCode = String(data.room || "").trim().toUpperCase();
			const playerIndex = parseInt(data.player_index || 0);

			if (!rooms[roomCode]) {
				console.log("Game join oda yok:", roomCode);
				return;
			}

			for (const p of rooms[roomCode].players) {
				if (p.player_index === playerIndex) {
					p.ws = ws;
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

			broadcast(roomCode, {
				type: "start_game",
				room: roomCode
			});

			console.log("Oyun başlatıldı:", roomCode);
			return;
		}

		if (
			data.type === "spawn" ||
			data.type === "move" ||
			data.type === "state" ||
			data.type === "turn_update"
		) {
			const roomCode = ws.roomCode || data.room;

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
			if (p.ws === ws) {
				p.ws = null;
			}
		}
	});
});

console.log("Server çalışıyor. Port:", PORT);
