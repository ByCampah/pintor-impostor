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
            rondaActual: 1,
            enDesempate: false
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
        sala.enDesempate = false;
        sala.palabra = PALABRAS[Math.floor(Math.random() * PALABRAS.length)];
        
        // Resetear por completo a todos los jugadores
        sala.jugadores.forEach(j => { j.vivo = true; j.esImpostor = false; j.votosRecibidos = 0; });
        sala.votosEmitidos = 0;

        // Elegir Impostor al azar
        let indiceImpostor = Math.floor(Math.random() * sala.jugadores.length);
        sala.jugadores[indiceImpostor].esImpostor = true;

        // Armar turnos mezclados asegurando que incluyan a todos los IDs actuales
        sala.ordenTurnos = mezclarArray(sala.jugadores.map(j => j.id));
        sala.indiceTurnoActual = 0;

        // Mandar roles
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

        // Buscar el próximo jugador que califique para dibujar y esté VIVO
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

        // Si ya no quedan más turnos disponibles en esta ronda, pasamos a votar
        if (!encontrado) {
            sala.votosEmitidos = 0;
            sala.jugadores.forEach(j => j.votosRecibidos = 0);
            let vivos = sala.jugadores.filter(j => j.vivo);
            io.to(codigo).emit('faseVotacion', vivos);
        } else {
            let idTurno = sala.ordenTurnos[sala.indiceTurnoActual];
            let nombreTurno = sala.jugadores.find(j => j.id === idTurno).nombre;
            io.to(codigo).emit('cambioTurno', { turnoDe: idTurno, nombreTurno });
        }
    });

    // 6. Procesamiento de Votos con Regla de Desempate
    socket.on('votarJugador', ({ codigo, idVotado }) => {
        let sala = salas[codigo];
        if (!sala) return;

        let jugadorVotado = sala.jugadores.find(j => j.id === idVotado);
        if (jugadorVotado) jugadorVotado.votosRecibidos++;
        
        sala.votosEmitidos++;
        let totalVivos = sala.jugadores.filter(j => j.vivo).length;

        if (sala.votosEmitidos >= totalVivos) {
            let vivos = sala.jugadores.filter(j => j.vivo);
            
            // Buscar la cantidad máxima de votos que alguien recibió
            let maxVotos = Math.max(...vivos.map(j => j.votosRecibidos));
            // Filtrar todos los jugadores que tengan esa cantidad máxima de votos
            let empatados = vivos.filter(j => j.votosRecibidos === maxVotos);

            // ¡HAY EMPATE! (Y hay más de un jugador con el máximo de votos)
            if (empatados.length > 1) {
                sala.enDesempate = true;
                sala.votosEmitidos = 0;
                // La nueva ronda de dibujo solo incluirá a los que empataron
                sala.ordenTurnos = empatados.map(j => j.id);
                sala.indiceTurnoActual = 0;

                let idTurno = sala.ordenTurnos[0];
                let nombreTurno = sala.jugadores.find(j => j.id === idTurno).nombre;

                io.to(codigo).emit('nuevaRondaDibujo', {
                    ronda: sala.rondaActual,
                    turnoDe: idTurno,
                    nombreTurno: nombreTurno,
                    txtAlerta: `¡Hubo un empate en los votos! Ronda de desempate entre: ${empatados.map(e => e.nombre).join(' y ')}. ¡A dibujar de nuevo!`
                });
                return;
            }

            // Si NO hay empate, procedemos a expulsar al único más votado
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
                // Siguiente ronda normal si sobrevive el impostor
                sala.rondaActual++;
                sala.enDesempate = false;
                sala.ordenTurnos = mezclarArray(sala.jugadores.filter(j => j.vivo).map(j => j.id));
                sala.indiceTurnoActual = 0;
                
                let idTurno = sala.ordenTurnos[0];
                let nombreTurno = sala.jugadores.find(j => j.id === idTurno).nombre;

                io.to(codigo).emit('nuevaRondaDibujo', {
                    ronda: sala.rondaActual,
                    turnoDe: idTurno,
                    nombreTurno: nombreTurno,
                    txtAlerta: `¡Expulsaron a ${expulsado.nombre}! No era el impostor. Empieza la ronda ${sala.rondaActual}.`
                });
            }
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