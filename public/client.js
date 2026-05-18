// public/client.js
const socket = io(window.location.hostname === 'localhost' ? 'http://localhost:3000' : window.location.origin);

let miCodigo = "";
let miTurno = false;
let colorPincel = "#" + Math.floor(Math.random() * 16777215).toString(16); // Color aleatorio para cada pintor

const canvas = document.getElementById('pizarra');
const ctx = canvas.getContext('2d');
let dibujando = false;
let xAnterior = 0, yAnterior = 0;

// Lógica para detectar clicks y movimientos en el lienzo
canvas.addEventListener('mousedown', (e) => { if(!miTurno) return; dibujando = true; [xAnterior, yAnterior] = obtenerCoordenadas(e); });
canvas.addEventListener('mousemove', dibujar);
window.addEventListener('mouseup', () => dibujando = false);

// Soporte para celulares (Touch)
canvas.addEventListener('touchstart', (e) => { if(!miTurno) return; dibujando = true; const t = e.touches[0]; [xAnterior, yAnterior] = obtenerCoordenadas(t); });
canvas.addEventListener('touchmove', (e) => { if(e.touches.length > 0) dibujar(e.touches[0]); });
window.addEventListener('touchend', () => dibujando = false);

function obtenerCoordenadas(e) {
    const rect = canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
}

function dibujar(e) {
    if (!dibujando || !miTurno) return;
    const [x, y] = obtenerCoordenadas(e);

    dibujarLinea(x, y, xAnterior, yAnterior, colorPincel);
    // Mandarle las coordenadas al servidor en tiempo real
    socket.emit('dibujando', { codigo: miCodigo, x, y, xAnterior, yAnterior, color: colorPincel });
    [xAnterior, yAnterior] = [x, y];
}

function dibujarLinea(x, y, xAn, yAn, color) {
    ctx.beginPath();
    ctx.moveTo(xAn, yAn);
    ctx.lineTo(x, y);
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.closePath();
}

// Escuchar los trazos que hacen los OTROS jugadores desde el servidor
socket.on('dibujarFronte', ({ x, y, xAnterior, yAnterior, color }) => {
    dibujarLinea(x, y, xAnterior, yAnterior, color);
});

// --- Manejo de pantallas del menú (Igual al anterior) ---
const pInicio = document.getElementById('pantalla-inicio');
const pLobby = document.getElementById('pantalla-lobby');
const pJuego = document.getElementById('pantalla-juego');

document.getElementById('btn-crear').addEventListener('click', () => {
    const n = document.getElementById('input-nombre').value.trim();
    if(n) socket.emit('crearSala', n);
});

document.getElementById('btn-unirse').addEventListener('click', () => {
    const n = document.getElementById('input-nombre').value.trim();
    const c = document.getElementById('input-codigo').value.trim().toUpperCase();
    if(n && c) socket.emit('unirseSala', { codigo: c, nombre: n });
});

document.getElementById('btn-comenzar').addEventListener('click', () => { socket.emit('iniciarPartida', miCodigo); });
document.getElementById('btn-terminar-trazo').addEventListener('click', () => { socket.emit('siguienteTurno', miCodigo); });

socket.on('salaCreada', ({ codigo, jugadores }) => {
    miCodigo = codigo;
    document.getElementById('codigo-display').innerText = codigo;
    document.getElementById('btn-comenzar').style.display = 'block';
    actualizarLobby(jugadores);
    pInicio.style.display = 'none'; pLobby.style.display = 'block';
});

socket.on('actualizarJugadores', (jugadores) => {
    if (pInicio.style.display !== 'none') {
        miCodigo = document.getElementById('input-codigo').value.trim().toUpperCase();
        document.getElementById('codigo-display').innerText = miCodigo;
        pInicio.style.display = 'none'; pLobby.style.display = 'block';
    }
    actualizarLobby(jugadores);
});

function actualizarLobby(jugadores) {
    const l = document.getElementById('lista-jugadores'); l.innerHTML = "";
    jugadores.forEach(j => { l.innerHTML += `<li>👤 ${j.nombre}</li>`; });
}

socket.on('tuRol', ({ palabra, esImpostor }) => {
    const bloque = document.getElementById('info-palabra');
    if(esImpostor) {
        bloque.innerText = "¡SOS EL IMPOSTOR! No sabés la palabra. Dibujá algo para camuflarte.";
        bloque.style.borderLeftColor = "#ff5555";
    } else {
        bloque.innerText = `Palabra Secreta: ${palabra}. ¡Dibujala sin ser obvio!`;
        bloque.style.borderLeftColor = "#00ff66";
    }
});

socket.on('partidaIniciada', ({ turnoDe, nombreTurno }) => {
    pLobby.style.display = 'none'; pJuego.style.display = 'block';
    manejarTurno(turnoDe, nombreTurno);
});

socket.on('cambioTurno', ({ turnoDe, nombreTurno }) => { manejarTurno(turnoDe, nombreTurno); });

function manejarTurno(turnoDe, nombreTurno) {
    miTurno = (turnoDe === socket.id);
    document.getElementById('indicador-turno').innerText = miTurno ? "¡ES TU TURNO DE DIBUJAR!" : `Dibuja: ${nombreTurno}`;
    document.getElementById('btn-terminar-trazo').style.display = miTurno ? 'block' : 'none';
}

socket.on('finDelDibujo', () => {
    miTurno = false;
    document.getElementById('indicador-turno').innerText = "¡FIN DEL TIEMPO! Discutan y voten quién es el Impostor.";
    document.getElementById('btn-terminar-trazo').style.display = 'none';
});

socket.on('errorConexion', (m) => alert(m));