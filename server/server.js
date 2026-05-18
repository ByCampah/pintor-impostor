// server/server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, '../public')));

const PALABRAS = ["Perro", "Gato", "Auto", "Mate", "Pelota de Fútbol", "Hamburguesa", "Helado", "Computadora", "Pizza", "Colectivo", "Asado", "Guitarra"];
let salas = {};

function mezclarArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

io.on('connection', (socket) => {

    // 1. Crear Sala
    socket.on('crearSala', (nombre) => {
        let codigo = Math.random().toString(36).substring(2, 6).toUpperCase();
        salas[codigo] = {
            id: codigo,
            jugadores: [{ id: socket.id, nombre, vivo: true, esImpostor: false, votosRecibidos: 0 }],
            enJuego: false,
            palabra: "",
            ordenTurnos: [],
            indiceTurnoActual: 0,
            votosEmitidos: 0,
            rondaActual: 1
        };
        socket.join(codigo);
        socket.emit('salaCreada', { codigo, jugadores: salas[codigo].jugadores });
    });

    // 2. Unirse a Sala
    socket.on('unirseSala', ({ codigo, nombre }) => {
        codigo = codigo.toUpperCase();
        if (salas[codigo] && !salas[codigo].enJuego) {
            salas[codigo].jugadores.push({ id: socket.id, nombre, vivo: true, esImpostor: false, votosRecibidos: 0 });
            socket.join(codigo);
            io.to(codigo).emit('actualizarJugadores', salas[codigo].jugadores);
        } else {
            socket.emit('errorConexion', 'Sala no encontrada o ya inició.');
        }
    });

    // 3. Iniciar Partida
    socket.on('iniciarPartida', (codigo) => {
        let sala = salas[codigo];
        if (!sala || sala.jugadores.length < 3) return socket.emit('errorConexion', 'Se necesitan al menos 3 jugadores.');

        sala.enJuego = true;
        sala.rondaActual = 1;
        sala.palabra = PALABRAS[Math.floor(Math.random() * PALABRAS.length)];
        
        sala.jugadores.forEach(j => { j.vivo = true; j.esImpostor = false; j.votosRecibidos = 0; });
        sala.votosEmitidos = 0;

        let indiceImpostor = Math.floor(Math.random() * sala.jugadores.length);
        sala.jugadores[indiceImpostor].esImpostor = true;

        sala.ordenTurnos = mezclarArray(sala.jugadores.map(j => j.id));
        sala.indiceTurnoActual = 0;

        sala.jugadores.forEach((jugador) => {
            io.to(jugador.id).emit('tuRol', { palabra: jugador.esImpostor ? "???" : sala.palabra, esImpostor: jugador.esImpostor });
        });

        let idTurno = sala.ordenTurnos[sala.indiceTurnoActual];
        let nombreTurno = sala.jugadores.find(j => j.id === idTurno).nombre;

        io.to(codigo).emit('partidaIniciada', { 
            turnoDe: idTurno, 
            nombreTurno: nombreTurno,
            ronda: sala.rondaActual 
        });
    });

    // 4. Transmisión del dibujo
    socket.on('dibujando', ({ codigo, x, y, xAnterior, yAnterior, color }) => {
        socket.to(codigo).emit('dibujarFronte', { x, y, xAnterior, yAnterior, color });
    });

    // 5. Cambios de turno
    socket.on('siguienteTurno', (codigo) => {
        let sala = salas[codigo];
        if (!sala) return;

        sala.indiceTurnoActual++;

        let encontrado = false;
        while (sala.indiceTurnoActual < sala.ordenTurnos.length) {
            let siguienteId = sala.ordenTurnos[sala.indiceTurnoActual];
            let jug = sala.jugadores.find(j => j.id === siguienteId);
            if (jug && jug.vivo) {
                encontrado = true;
                break;
            }
            sala.indiceTurnoActual++;
        }

        if (!encontrado) {
            sala.votosEmitidos = 0;
            sala.jugadores.forEach(j => j.votosRecibidos = 0);
            let vivos = sala.jugadores.filter(j => j.vivo);
            io.to(codigo).emit('faseVotacion', { jugadoresVivos: vivos, esDesempate: false });
        } else {
            let idTurno = sala.ordenTurnos[sala.indiceTurnoActual];
            let nombreTurno = sala.jugadores.find(j => j.id === idTurno).nombre;
            io.to(codigo).emit('cambioTurno', { turnoDe: idTurno, nombreTurno });
        }
    });

    // 6. Procesamiento de Votos con Desempate Limpio
    socket.on('votarJugador', ({ codigo, idVotado }) => {
        let sala = salas[codigo];
        if (!sala) return;

        let jugadorVotado = sala.jugadores.find(j => j.id === idVotado);
        if (jugadorVotado) jugadorVotado.votosRecibidos++;
        
        sala.votosEmitidos++;
        let totalVivos = sala.jugadores.filter(j => j.vivo).length;

        if (sala.votosEmitidos >= totalVivos) {
            let vivos = sala.jugadores.filter(j => j.vivo);
            let maxVotos = Math.max(...vivos.map(j => j.votosRecibidos));
            let empatados = vivos.filter(j => j.votosRecibidos === maxVotos);

            // Si hay empate en los votos, vuelven a votar pero solo entre los empatados
            if (empatados.length > 1) {
                sala.votosEmitidos = 0;
                sala.jugadores.forEach(j => j.votosRecibidos = 0);
                io.to(codigo).emit('faseVotacion', { jugadoresVivos: empatados, esDesempate: true });
                return;
            }

            let expulsado = empatados[0];
            expulsado.vivo = false;

            let impostorVivo = sala.jugadores.find(j => j.esImpostor).vivo;
            let cantidadVivos = sala.jugadores.filter(j => j.vivo).length;

            if (!impostorVivo) {
                io.to(codigo).emit('finPartida', { ganador: "INOCENTES", detalle: `¡Echaron a ${expulsado.nombre} y era el Impostor!` });
                sala.enJuego = false;
            } else if (cantidadVivos <= 2) {
                let nombreImpostor = sala.jugadores.find(j => j.esImpostor).nombre;
                io.to(codigo).emit('finPartida', { ganador: "IMPOSTOR", detalle: `El impostor era ${nombreImpostor}. ¡Logró camuflarse!` });
                sala.enJuego = false;
            } else {
                sala.rondaActual++;
                sala.ordenTurnos = mezclarArray(sala.jugadores.filter(j => j.vivo).map(j => j.id));
                sala.indiceTurnoActual = 0;
                
                let idTurno = sala.ordenTurnos[0];
                let nombreTurno = sala.jugadores.find(j => j.id === idTurno).nombre;

                io.to(codigo).emit('nuevaRondaDibujo', {
                    ronda: sala.rondaActual,
                    turnoDe: idTurno,
                    nombreTurno: nombreTurno,
                    mensajeEstado: `¡Expulsaron a ${expulsado.nombre}! No era el impostor.`
                });
            }
        }
    });

    // Desconexión (Aquí estaba el error de la llave)
    socket.on('disconnect', () => {
        for (let codigo in salas) {
            salas[codigo].jugadores = salas[codigo].jugadores.filter(j => j.id !== socket.id);
            if (salas[codigo].jugadores.length === 0) {
                delete salas[codigo];
            } else {
                io.to(codigo).emit('actualizarJugadores', salas[codigo].jugadores);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor de Pintura Avanzado en puerto ${PORT}`));