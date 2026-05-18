// server/server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, '../public')));

const PALABRAS = ["Perro", "Gato", "Auto", "Mate", "Pelota de Fútbol", "Hamburguesa", "Helado", "Computadora", "Pizza", "Colectivo"];
let salas = {};

// Función auxiliar para mezclar un array (Algoritmo Fisher-Yates)
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
            ordenTurnos: [], // Aquí guardamos el orden aleatorio
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

    // 3. Iniciar Partida (Con orden aleatorio)
    socket.on('iniciarPartida', (codigo) => {
        let sala = salas[codigo];
        if (!sala || sala.jugadores.length < 3) return socket.emit('errorConexion', 'Se necesitan al menos 3 jugadores.');

        sala.enJuego = true;
        sala.rondaActual = 1;
        sala.palabra = PALABRAS[Math.floor(Math.random() * PALABRAS.length)];
        
        // Resetear estados por si es un re-partido
        sala.jugadores.forEach(j => { j.vivo = true; j.esImpostor = false; j.votosRecibidos = 0; });
        sala.votosEmitidos = 0;

        // Elegir Impostor
        let indiceImpostor = Math.floor(Math.random() * sala.jugadores.length);
        sala.jugadores[indiceImpostor].esImpostor = true;

        // Generar ORDEN ALEATORIO de turnos basado en los IDs
        sala.ordenTurnos = mezclarArray(sala.jugadores.map(j => j.id));
        sala.indiceTurnoActual = 0;

        // Enviar roles de forma privada
        sala.jugadores.forEach((jugador) => {
            io.to(jugador.id).emit('tuRol', { palabra: jugador.esImpostor ? "???" : sala.palabra, esImpostor: jugador.esImpostor });
        });

        // Avisar a todos que arranca la ronda de dibujo
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

    // 5. Manejo de turnos dentro de la ronda
    socket.on('siguienteTurno', (codigo) => {
        let sala = salas[codigo];
        if (!sala) return;

        // Avanzar el turno buscando al siguiente jugador que esté VIVO
        let encontrado = false;
        while (!encontrado) {
            sala.indiceTurnoActual++;
            // Si ya pasaron todos los de la lista de turnos, se termina la ronda de dibujo y se va a votar
            if (sala.indiceTurnoActual >= sala.ordenTurnos.length) {
                break;
            }
            let siguienteId = sala.ordenTurnos[sala.indiceTurnoActual];
            let jug = sala.jugadores.find(j => j.id === siguienteId);
            if (jug && jug.vivo) {
                encontrado = true;
            }
        }

        // Si terminaron todos los vivos, pasamos a la fase de votación
        if (sala.indiceTurnoActual >= sala.ordenTurnos.length) {
            sala.votosEmitidos = 0;
            sala.jugadores.forEach(j => j.votosRecibidos = 0);
            
            // Enviamos solo la lista de los que siguen VIVOS para que puedan ser votados
            let vivos = sala.jugadores.filter(j => j.vivo);
            io.to(codigo).emit('faseVotacion', vivos);
        } else {
            // Siguiente turno normal
            let idTurno = sala.ordenTurnos[sala.indiceTurnoActual];
            let nombreTurno = sala.jugadores.find(j => j.id === idTurno).nombre;
            io.to(codigo).emit('cambioTurno', { turnoDe: idTurno, nombreTurno });
        }
    });

    // 6. Procesar los votos en tiempo real
    socket.on('votarJugador', ({ codigo, idVotado }) => {
        let sala = salas[codigo];
        if (!sala) return;

        let jugadorVotado = sala.jugadores.find(j => j.id === idVotado);
        if (jugadorVotado) {
            jugadorVotado.votosRecibidos++;
        }
        
        sala.votosEmitidos++;
        let totalVivos = sala.jugadores.filter(j => j.vivo).length;

        // Si ya votaron todos los que están vivos
        if (sala.votosEmitidos >= totalVivos) {
            // Encontrar al que tiene más votos
            let vivos = sala.jugadores.filter(j => j.vivo);
            let expulsado = vivos.reduce((max, j) => j.votosRecibidos > max.votosRecibidos ? j : max, vivos[0]);

            expulsado.vivo = false; // ¡Eliminado!

            // Verificar condiciones de victoria
            let impostorVivo = sala.jugadores.find(j => j.esImpostor).vivo;
            let cantidadVivos = sala.jugadores.filter(j => j.vivo).length;

            if (!impostorVivo) {
                // Ganaron los inocentes porque echaron al impostor
                io.to(codigo).emit('finPartida', { ganador: "INOCENTES", detalle: `Echaron a ${expulsado.nombre} y era el Impostor!` });
                sala.enJuego = false;
            } else if (cantidadVivos <= 2) {
                // Ganó el impostor porque quedan 2 o menos y él sigue vivo
                let nombreImpostor = sala.jugadores.find(j => j.esImpostor).nombre;
                io.to(codigo).emit('finPartida', { ganador: "IMPOSTOR", detalle: `El impostor era ${nombreImpostor}. ¡Logró camuflarse!` });
                sala.enJuego = false;
            } else {
                // El juego continúa: pasamos a la siguiente ronda de dibujo con los sobrevivientes
                sala.rondaActual++;
                sala.indiceTurnoActual = 0;
                
                // Buscar el primer jugador vivo para el nuevo turno
                let primerIdVio = sala.ordenTurnos.find(id => sala.jugadores.find(j => j.id === id).vivo);
                sala.indiceTurnoActual = sala.ordenTurnos.indexOf(primerIdVio);
                let nombreTurno = sala.jugadores.find(j => j.id === primerIdVio).nombre;

                io.to(codigo).emit('nuevaRondaDibujo', {
                    ronda: sala.rondaActual,
                    turnoDe: primerIdVio,
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor de Pintura Avanzado en puerto ${PORT}`));