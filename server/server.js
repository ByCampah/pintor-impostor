// server/server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, '../public')));

const PALABRAS = ["Perro", "Gato", "Auto", "Mate", "Pelota de Fútbol", "Hamburguesa", "Helado", "Computadora"];
let salas = {};

io.on('connection', (socket) => {

    // Crear Sala
    socket.on('crearSala', (nombre) => {
        let codigo = Math.random().toString(36).substring(2, 6).toUpperCase();
        salas[codigo] = {
            id: codigo,
            jugadores: [{ id: socket.id, nombre, rol: "" }],
            enJuego: false,
            palabra: "",
            turnoActual: 0
        };
        socket.join(codigo);
        socket.emit('salaCreada', { codigo, jugadores: salas[codigo].jugadores });
    });

    // Unirse a Sala
    socket.on('unirseSala', ({ codigo, nombre }) => {
        codigo = codigo.toUpperCase();
        if (salas[codigo] && !salas[codigo].enJuego) {
            salas[codigo].jugadores.push({ id: socket.id, nombre, rol: "" });
            socket.join(codigo);
            io.to(codigo).emit('actualizarJugadores', salas[codigo].jugadores);
        } else {
            socket.emit('errorConexion', 'Sala no encontrada o ya inició.');
        }
    });

    // Iniciar Partida
    socket.on('iniciarPartida', (codigo) => {
        let sala = salas[codigo];
        if (!sala) return;

        sala.enJuego = true;
        sala.palabra = PALABRAS[Math.floor(Math.random() * PALABRAS.length)];
        let indiceImpostor = Math.floor(Math.random() * sala.jugadores.length);
        sala.turnoActual = 0;

        sala.jugadores.forEach((jugador, index) => {
            if (index === indiceImpostor) {
                io.to(jugador.id).emit('tuRol', { palabra: "???", esImpostor: true });
            } else {
                io.to(jugador.id).emit('tuRol', { palabra: sala.palabra, esImpostor: false });
            }
        });

        io.to(codigo).emit('partidaIniciada', { 
            turnoDe: sala.jugadores[sala.turnoActual].id,
            nombreTurno: sala.jugadores[sala.turnoActual].nombre 
        });
    });

    // TRANSMISIÓN DEL DIBUJO: Captura el trazo de un jugador y se lo manda al resto
    socket.on('dibujando', ({ codigo, x, y, xAnterior, yAnterior, color }) => {
        socket.to(codigo).emit('dibujarFronte', { x, y, xAnterior, yAnterior, color });
    });

    // Pasar el turno al siguiente pintor
    socket.on('siguienteTurno', (codigo) => {
        let sala = salas[codigo];
        if (!sala) return;

        sala.turnoActual++;
        if (sala.turnoActual >= sala.jugadores.length) {
            io.to(codigo).emit('finDelDibujo'); // Se terminaron los turnos, hora de votar
        } else {
            io.to(codigo).emit('cambioTurno', { 
                turnoDe: sala.jugadores[sala.turnoActual].id,
                nombreTurno: sala.jugadores[sala.turnoActual].nombre 
            });
        }
    });

    socket.on('disconnect', () => {
        for (let codigo in salas) {
            salas[codigo].jugadores = salas[codigo].jugadores.filter(j => j.id !== socket.id);
            if (salas[codigo].jugadores.length === 0) delete salas[codigo];
            else io.to(codigo).emit('actualizarJugadores', salas[codigo].jugadores);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor de Pintura en puerto ${PORT}`));