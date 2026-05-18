// public/client.js
const socket = io(window.location.hostname === 'localhost' ? 'http://localhost:3000' : window.location.origin);

let miCodigo = "";
let miTurno = false;
let colorPincel = "#" + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');

const canvas = document.getElementById('pizarra');
const ctx = canvas.getContext('2d');
let dibujando = false;
let xAnterior = 0, yAnterior = 0;

// Captura de trazos
canvas.addEventListener('mousedown', (e) => { if(!miTurno) return; dibujando = true; [xAnterior, yAnterior] = obtenerCoordenadas(e); });
canvas.addEventListener('mousemove', dibujar);
window.addEventListener('mouseup', () => dibujando = false);
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
    socket.emit('dibujando', { codigo: miCodigo, x, y, xAnterior, yAnterior, color: colorPincel });
    [xAnterior, yAnterior] = [x, y];
}

function dibujarLinea(x, y, xAn, yAn, color) {
    ctx.beginPath(); ctx.moveTo(xAn, yAn); ctx.lineTo(x, y);
    ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.stroke(); ctx.closePath();
}

socket.on('dibujarFronte', ({ x, y, xAnterior, yAnterior, color }) => { dibujarLinea(x, y, xAnterior, yAnterior, color); });

// --- Manejo de Pantallas de Flujo de Rondas ---
const pantallas = {
    inicio: document.getElementById('pantalla-inicio'),
    lobby: document.getElementById('pantalla-lobby'),
    juego: document.getElementById('pantalla-juego'),
    votacion: document.getElementById('pantalla-votacion'),
    final: document.getElementById('pantalla-final')
};

function mostrarSola(pantallaClave) {
    Object.keys(pantallas).forEach(key => {
        pantallas[key].classList.remove('active');
    });
    pantallas[pantallaClave].classList.add('active');
}

// Botones menú
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
document.getElementById('btn-reiniciar').addEventListener('click', () => { socket.emit('iniciarPartida', miCodigo); });

// Respuestas básicas
socket.on('salaCreada', ({ codigo, jugadores }) => {
    miCodigo = codigo;
    document.getElementById('codigo-display').innerText = codigo;
    document.getElementById('btn-comenzar').style.display = 'block';
    actualizarLobby(jugadores);
    mostrarSola('lobby');
});

socket.on('actualizarJugadores', (jugadores) => {
    if (pantallas.inicio.classList.contains('active')) {
        miCodigo = document.getElementById('input-codigo').value.trim().toUpperCase();
        document.getElementById('codigo-display').innerText = miCodigo;
        mostrarSola('lobby');
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
        bloque.innerText = "¡SOS EL IMPOSTOR! No sabés qué se dibuja. ¡Camuflate!";
        bloque.style.borderLeftColor = "#ff5555";
    } else {
        bloque.innerText = `Palabra Secreta: ${palabra}. ¡Que no te descubran!`;
        bloque.style.borderLeftColor = "#00ff66";
    }
});

// FLUJO MULTI-RONDA DE DIBUJO Y VOTACIÓN
socket.on('partidaIniciada', ({ turnoDe, nombreTurno, ronda }) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height); // Limpiar pizarra para partida nueva
    document.getElementById('ronda-num').innerText = ronda;
    mostrarSola('juego');
    manejarTurno(turnoDe, nombreTurno);
});

socket.on('cambioTurno', ({ turnoDe, nombreTurno }) => { manejarTurno(turnoDe, nombreTurno); });

function manejarTurno(turnoDe, nombreTurno) {
    miTurno = (turnoDe === socket.id);
    document.getElementById('indicador-turno').innerText = miTurno ? "¡ES TU TURNO DE DIBUJAR!" : `Dibuja: ${nombreTurno}`;
    document.getElementById('btn-terminar-trazo').style.display = miTurno ? 'block' : 'none';
}

// Fase de votación automática al terminar la ronda
socket.on('faseVotacion', (jugadoresVivos) => {
    miTurno = false;
    document.getElementById('alerta-voto-espera').style.display = 'none';
    const contenedor = document.getElementById('lista-votacion');
    contenedor.innerHTML = "";

    jugadoresVivos.forEach(j => {
        const btn = document.createElement('button');
        btn.className = "btn-votar";
        btn.innerText = `👤 Votar a ${j.nombre}`;
        btn.addEventListener('click', () => {
            socket.emit('votarJugador', { codigo: miCodigo, idVotado: j.id });
            contenedor.innerHTML = ""; // Ocultar botones tras votar
            document.getElementById('alerta-voto-espera').style.display = 'block';
        });
        contenedor.appendChild(btn);
    });
    mostrarSola('votacion');
});

// Continúa el juego tras una expulsión fallida
socket.on('nuevaRondaDibujo', ({ ronda, turnoDe, nombreTurno, txtAlerta }) => {
    document.getElementById('ronda-num').innerText = ronda;
    alert(txtAlerta);
    mostrarSola('juego');
    manejarTurno(turnoDe, nombreTurno);
});

// Fin definitivo del partido
socket.on('finPartida', ({ ganador, detalle }) => {
    document.getElementById('ganador-titulo').innerText = `¡GANAN LOS ${ganador}!`;
    document.getElementById('ganador-titulo').style.color = (ganador === "IMPOSTOR") ? "#ff5555" : "#00ff66";
    document.getElementById('ganador-detalle').innerText = detalle;
    mostrarSola('final');
});

socket.on('errorConexion', (m) => alert(m));