// public/client.js
const socket = io(window.location.hostname === 'localhost' ? 'http://localhost:3000' : window.location.origin);

let miCodigo = "";
let miTurno = false;
let colorPincel = "#" + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');

const canvas = document.getElementById('pizarra');
const ctx = canvas.getContext('2d');
let dibujando = false;
let xAnterior = 0, yAnterior = 0;

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

const pantallas = {
    inicio: document.getElementById('pantalla-inicio'),
    lobby: document.getElementById('pantalla-lobby'),
    juego: document.getElementById('pantalla-juego'),
    votacion: document.getElementById('pantalla-votacion'),
    final: document.getElementById('pantalla-final')
};

function mostrarSola(pantallaClave) {
    Object.keys(pantallas).forEach(key => pantallas[key].classList.remove('active'));
    pantallas[pantallaClave].classList.add('active');
}

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

socket.on('partidaIniciada', ({ turnoDe, nombreTurno, ronda }) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    document.getElementById('notificacion-ronda').style.display = 'none';
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

// Fase de Votación Inteligente: Oculta botones a los espectando
socket.on('faseVotacion', ({ jugadoresVivos, esDesempate }) => {
    miTurno = false;
    document.getElementById('alerta-voto-espera').style.display = 'none';
    
    const titulo = document.getElementById('titulo-votacion');
    const sub = document.getElementById('sub-votacion');
    const contenedor = document.getElementById('lista-votacion');
    contenedor.innerHTML = "";

    // Revisar si el cliente local está vivo dentro de la lista que mandó el servidor
    const yoSigoVivo = jugadoresVivos.some(j => j.id === socket.id);

    if (esDesempate) {
        titulo.innerText = "⚡ RONDA DE DESEMPATE";
        titulo.style.color = "#ffaa00";
        sub.innerText = "Hubo un empate exacto. Voten SOLO entre los apuntados:";
    } else {
        titulo.innerText = "🕵️‍♂️ ¿Quién es el Impostor?";
        titulo.style.color = "white";
        sub.innerText = "Discutan y elijan a quién quieren echar de la sala:";
    }

    // SI EL JUGADOR ACTUAL ESTÁ MUERTO: No le generamos botones, solo cartel de espectador
    if (!yoSigoVivo && !esDesempate) {
        sub.innerText = "💀 Fuiste expulsado. Ahora estás en modo ESPECTADOR hasta que termine la partida.";
        sub.style.color = "#ff5555";
        return; 
    }

    // SI ESTÁ VIVO: Genera los botones normalmente (ocultando el suyo propio)
    jugadoresVivos.forEach(j => {
        if (j.id !== socket.id) {
            const btn = document.createElement('button');
            btn.className = "btn-votar";
            btn.innerText = `👤 Votar a ${j.nombre}`;
            btn.addEventListener('click', () => {
                socket.emit('votarJugador', { codigo: miCodigo, idVotado: j.id });
                contenedor.innerHTML = ""; 
                document.getElementById('alerta-voto-espera').style.display = 'block';
            });
            contenedor.appendChild(btn);
        }
    });
    mostrarSola('votacion');
});

socket.on('nuevaRondaDibujo', ({ ronda, turnoDe, nombreTurno, mensajeEstado }) => {
    document.getElementById('ronda-num').innerText = ronda;
    const banner = document.getElementById('notificacion-ronda');
    banner.innerText = mensajeEstado;
    banner.style.display = 'block';
    mostrarSola('juego');
    manejarTurno(turnoDe, nombreTurno);
});

socket.on('finPartida', ({ ganador, detalle }) => {
    document.getElementById('ganador-titulo').innerText = `¡GANAN LOS ${ganador}!`;
    document.getElementById('ganador-titulo').style.color = (ganador === "IMPOSTOR") ? "#ff5555" : "#00ff66";
    document.getElementById('ganador-detalle').innerText = detalle;
    mostrarSola('final');
});

socket.on('errorConexion', (m) => {
    const errorDiv = document.getElementById('error-pantalla');
    errorDiv.innerText = "⚠️ " + m;
    errorDiv.style.display = 'block';
    setTimeout(() => { errorDiv.style.display = 'none'; }, 4000);
});