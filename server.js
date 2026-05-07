const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;

const wss = new WebSocket.Server({ port: PORT });

console.log("Server çalışıyor:", PORT);

let rooms = {};

wss.on("connection", (ws) => {
    console.log("Bir oyuncu bağlandı");

    ws.on("message", (message) => {
        try {
            const data = JSON.parse(message);

            console.log("Mesaj geldi:", data);

            if (data.type === "create_room") {
                rooms[data.room] = [ws];
                ws.room = data.room;

                ws.send(JSON.stringify({
                    type: "room_created",
                    room: data.room
                }));
            }

            else if (data.type === "join_room") {

                if (!rooms[data.room]) {
                    rooms[data.room] = [];
                }

                rooms[data.room].push(ws);
                ws.room = data.room;

                rooms[data.room].forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            type: "player_count",
                            count: rooms[data.room].length
                        }));
                    }
                });
            }

            else {

                if (ws.room && rooms[ws.room]) {

                    rooms[ws.room].forEach(client => {

                        if (
                            client !== ws &&
                            client.readyState === WebSocket.OPEN
                        ) {
                            client.send(message.toString());
                        }

                    });

                }

            }

        } catch (err) {
            console.log("Hata:", err);
        }
    });

    ws.on("close", () => {

        if (ws.room && rooms[ws.room]) {

            rooms[ws.room] =
                rooms[ws.room].filter(client => client !== ws);

            console.log("Oyuncu ayrıldı");
        }

    });

});

console.log("WebSocket server aktif");
