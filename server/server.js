const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const fs = require('fs');
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

let palabras = [];
// Leer el archivo palabras.txt
try {
    const data = fs.readFileSync(path.join(__dirname, 'palabras.txt'), 'utf8');
    palabras = data.split(/[\n,]+/).map(p => p.trim()).filter(p => p.length > 0);
    console.log(`📌 Se cargaron ${palabras.length} palabras para el Pintor Impostor.`);
} catch (err) {
    console.log("⚠️ No se encontró palabras.txt, usando lista por defecto.");
    palabras = ["Fútbol", "Computadora", "Perro", "Pizza", "Castillo", "Auto", "Mate", "Helado"];
}

// Estructura adaptada para controlar múltiples salas por código
let salas = {}; 

function enviarEstado(codigoSala) {
    const sala = salas[codigoSala];
    if (!sala) return;

    // Actualizar lista global de jugadores de la sala
    io.to(codigoSala).emit('actualizarJugadores', Object.values(sala.jugadores));
    
    for (const id in sala.jugadores) {
        let copiaEstado = { ...sala.estadoJuego };
        
        // Ocultar palabra al impostor si no es fase FINAL
        if (id === sala.estadoJuego.impostorId && sala.estadoJuego.fase !== 'FINAL') {
            copiaEstado.palabraActual = '¡SOS EL IMPOSTOR! No sabés qué se dibuja. ¡Camuflate!';
        }
        
        // Calcular quiénes faltan votar dinámicamente
        if (sala.estadoJuego.fase === 'VOTACION') {
            copiaEstado.faltanVotar = Object.values(sala.jugadores)
                .filter(j => !sala.estadoJuego.quienVoto.includes(j.id))
                .map(j => j.nombre);
        }

        io.to(id).emit('estado-juego-adaptado', copiaEstado);
    }
}

io.on('connection', (socket) => {
    console.log(`🔌 Conectado: ${socket.id}`);

    // Crear Sala
    socket.on('crearSala', (nombre) => {
        const codigo = Math.random().toString(30).substring(2, 6).toUpperCase();
        salas[codigo] = {
            jugadores: {},
            estadoJuego: {
                fase: 'LOBBY',
                palabraActual: '',
                impostorId: null,
                turnoActualIdx: 0,
                ordenTurnos: [],
                ronda: 1,
                votos: {}, 
                quienVoto: [] 
            }
        };
        
        socket.join(codigo);
        socket.salaCodigo = codigo;
        salas[codigo].jugadores[socket.id] = { id: socket.id, nombre: nombre };
        
        socket.emit('salaCreada', { codigo, jugadores: Object.values(salas[codigo].jugadores) });
    });

    // Unirse a Sala
    socket.on('unirseSala', ({ codigo, nombre }) => {
        const sala = salas[codigo];
        if (!sala) return socket.emit('errorConexion', 'La sala no existe.');
        if (sala.estadoJuego.fase !== 'LOBBY') return socket.emit('errorConexion', 'La partida ya empezó.');

        socket.join(codigo);
        socket.salaCodigo = codigo;
        sala.jugadores[socket.id] = { id: socket.id, nombre: nombre };

        io.to(codigo).emit('nuevo-mensaje-chat', { id: 'sistema', texto: `🐾 <strong>${nombre}</strong> se unió a la sala.` });
        enviarEstado(codigo);
    });

    // --- LÓGICA DEL CHAT DE SALA ---
    socket.on('enviar-mensaje-chat', (texto) => {
        const codigo = socket.salaCodigo;
        if (!codigo || !salas[codigo]) return;
        const jugador = salas[codigo].jugadores[socket.id];
        if (jugador) {
            io.to(codigo).emit('nuevo-mensaje-chat', {
                id: socket.id,
                nombre: jugador.nombre,
                texto: texto
            });
        }
    });

    // Iniciar Partida
    socket.on('iniciarPartida', (codigo) => {
        const sala = salas[codigo];
        if (!sala) return;
        const ids = Object.keys(sala.jugadores);
        if (ids.length < 3) return socket.emit('errorConexion', 'Se necesitan mínimo 3 jugadores.');

        sala.estadoJuego.fase = 'JUEGO';
        sala.estadoJuego.votos = {};
        sala.estadoJuego.quienVoto = [];
        sala.estadoJuego.ronda = 1;
        
        sala.estadoJuego.palabraActual = palabras[Math.floor(Math.random() * palabras.length)];
        sala.estadoJuego.impostorId = ids[Math.floor(Math.random() * ids.length)];
        
        // 2 rondas de dibujo por jugador
        sala.estadoJuego.ordenTurnos = [...ids, ...ids]; 
        sala.estadoJuego.turnoActualIdx = 0;

        io.to(codigo).emit('limpiarPizarraCompleta');
        
        // Enviar roles iniciales de forma privada
        ids.forEach(id => {
            const esImpostor = (id === sala.estadoJuego.impostorId);
            io.to(id).emit('tuRol', { palabra: sala.estadoJuego.palabraActual, esImpostor });
        });

        io.to(codigo).emit('partidaIniciada', {
            turnoDe: sala.estadoJuego.ordenTurnos[0],
            nombreTurno: sala.jugadores[sala.estadoJuego.ordenTurnos[0]].nombre,
            ronda: 1
        });
        
        enviarEstado(codigo);
    });

    // Dibujo en tiempo real
    socket.on('dibujando', ({ codigo, x, y, xAnterior, yAnterior, color }) => {
        socket.to(codigo).emit('dibujarFronte', { x, y, xAnterior, yAnterior, color });
    });

    // Cambios de turno
    socket.on('siguienteTurno', (codigo) => {
        const sala = salas[codigo];
        if (!sala) return;
        
        sala.estadoJuego.turnoActualIdx++;
        const totalTurnos = sala.estadoJuego.ordenTurnos.length;

        if (sala.estadoJuego.turnoActualIdx < totalTurnos) {
            // Controlar si pasamos a la segunda ronda intermedia
            if (sala.estadoJuego.turnoActualIdx === Math.floor(totalTurnos / 2)) {
                sala.estadoJuego.ronda = 2;
            }
            
            const sigId = sala.estadoJuego.ordenTurnos[sala.estadoJuego.turnoActualIdx];
            io.to(codigo).emit('cambioTurno', {
                turnoDe: sigId,
                nombreTurno: sala.jugadores[sigId].nombre,
                ronda: sala.estadoJuego.ronda
            });
        } else {
            // Pasamos a votación
            sala.estadoJuego.fase = 'VOTACION';
            const vivos = Object.values(sala.jugadores);
            io.to(codigo).emit('faseVotacion', { jugadoresVivos: vivos, esDesempate: false });
        }
        enviarEstado(codigo);
    });

    // Votación inteligente
    socket.on('votarJugador', ({ codigo, idVotado }) => {
        const sala = salas[codigo];
        if (!sala || sala.estadoJuego.fase !== 'VOTACION') return;
        if (sala.estadoJuego.quienVoto.includes(socket.id)) return;

        sala.estadoJuego.quienVoto.push(socket.id);
        sala.estadoJuego.votos[idVotado] = (sala.estadoJuego.votos[idVotado] || 0) + 1;

        if (sala.estadoJuego.quienVoto.length === Object.keys(sala.jugadores).length) {
            sala.estadoJuego.fase = 'FINAL';
            
            let maxVotos = -1;
            let masVotadoId = null;
            for (const id in sala.estadoJuego.votos) {
                if (sala.estadoJuego.votos[id] > maxVotos) {
                    maxVotos = sala.estadoJuego.votos[id];
                    masVotadoId = id;
                }
            }

            const ganoPintores = (masVotadoId === sala.estadoJuego.impostorId);
            const nombreImpostor = sala.jugadores[sala.estadoJuego.impostorId].nombre;
            
            let detalleStr = ganoPintores 
                ? `¡Descubrieron a ${nombreImpostor}! El lienzo se salvó.`
                : `Echaron a la persona equivocada. El impostor real era ${nombreImpostor}.`;

            io.to(codigo).emit('finPartida', {
                ganador: ganoPintores ? "PINTORES" : "IMPOSTOR",
                detalle: detalleStr,
                palabraRevelada: sala.estadoJuego.palabraActual // ENVIAMOS LA PALABRA AQUÍ
            });
        } else {
            enviarEstado(codigo);
        }
    });

    socket.on('disconnect', () => {
        console.log(`❌ Desconectado: ${socket.id}`);
        const codigo = socket.salaCodigo;
        if (codigo && salas[codigo]) {
            const jugador = salas[codigo].jugadores[socket.id];
            if (jugador) {
                io.to(codigo).emit('nuevo-mensaje-chat', { id: 'sistema', texto: `❌ <strong>${jugador.nombre}</strong> abandonó la sala.` });
                delete salas[codigo].jugadores[socket.id];
            }
            if (Object.keys(salas[codigo].jugadores).length === 0) {
                delete salas[codigo];
                console.log(`🏠 Sala ${codigo} vaciada y removida.`);
            } else {
                enviarEstado(codigo);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`🎮 Servidor corriendo en puerto ${PORT}`));