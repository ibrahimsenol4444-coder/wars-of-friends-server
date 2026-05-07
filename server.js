const WebSocket = require("ws");

const PORT = 3000;
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
	ws.playerId = null;
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

		// ODA OLUŞTUR
		if (data.type === "create_room") {

			const roomCode = String(
				data.room || makeRoomCode()
			).trim().toUpperCase();

			if (!rooms[roomCode]) {

				rooms[roomCode] = {
					code: roomCode,
					players: []
				};
			}

			const room = rooms[roomCode];

			const player = {
				id: Date.now().toString(),
				name: data.name || "Host",
				player_index: 0,
				ws: ws
			};

			room.players = [player];

			ws.roomCode = roomCode;
			ws.playerId = player.id;
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

		// ODAYA KATIL
		if (data.type === "join_room") {

			const roomCode = String(
				data.room || ""
			).trim().toUpperCase();

			if (!rooms[roomCode]) {

				send(ws, {
					type: "join_failed",
					reason: "Oda bulunamadı"
				});

				return;
			}

			const room = rooms[roomCode];

			const playerIndex = room.players.length;

			const player = {
				id: Date.now().toString(),
				name: data.name || "Oyuncu",
				player_index: playerIndex,
				ws: ws
			};

			room.players.push(player);

			ws.roomCode = roomCode;
			ws.playerId = player.id;
			ws.playerIndex = playerIndex;
			ws.playerName = player.name;

			send(ws, {
				type: "room_joined",
				room: roomCode,
				player_index: playerIndex
			});

			sendRoomUpdate(roomCode);

			console.log(
				"Odaya katıldı:",
				roomCode,
				"Oyuncu:",
				playerIndex
			);

			return;
		}

		// OYUNA GERİ BAĞLAN
		if (data.type === "game_join") {

			const roomCode = String(
				data.room || ""
			).trim().toUpperCase();

			if (!rooms[roomCode]) {
				return;
			}

			const playerIndex = intSafe(data.player_index);

			for (const p of rooms[roomCode].players) {

				if (p.player_index === playerIndex) {

					p.ws = ws;

					ws.roomCode = roomCode;
					ws.playerIndex = playerIndex;

					console.log(
						"Oyun bağlantısı geri geldi:",
						roomCode,
						playerIndex
					);

					break;
				}
			}

			return;
		}

		// OYUN BAŞLAT
		if (data.type === "start_game") {

			const roomCode = ws.roomCode;

			if (!rooms[roomCode]) return;

			broadcast(roomCode, {
				type: "start_game"
			});

			console.log("Oyun başlatıldı:", roomCode);

			return;
		}

		// OYUN VERİLERİ
		if (
			data.type === "spawn" ||
			data.type === "move" ||
			data.type === "state"
		) {

			const roomCode = ws.roomCode;

			if (!rooms[roomCode]) return;

			broadcast(roomCode, data);

			console.log(
				"Oyun mesajı yayıldı:",
				data.type
			);

			return;
		}
	});

	ws.on("close", function close() {

		console.log("Oyuncu ayrıldı:", ws.roomCode);
	});
});

function intSafe(v) {

	const n = parseInt(v);

	if (isNaN(n)) return 0;

	return n;
}

console.log("Server çalışıyor. Port:", PORT);