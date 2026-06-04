// js/lobby.js
import { databaseCarte } from './carte.js';

let sfxVolume = parseFloat(localStorage.getItem('sfxVolume') ?? '1.0');
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

// Mappatura per tracciare le quantità modificate del mazzo all'interno della lobby corrente
let quantitaMazzoLobby = {};

// Tipo di stanza selezionata nel form di creazione ('pubblica' o 'privata')
let tipoLobbySelezionata = 'pubblica';

// Stato locale simulato della Sala d'Attesa Multiplayer
let lobbyCorrente = null;
let partecipantiStanza = [];

export function inizializzaInterfacciaLobby() {
    const slider = document.getElementById('sfx-slider');
    const volTesto = document.getElementById('vol-sfx-val');
    
    if (slider) slider.value = sfxVolume * 100;
    if (volTesto) volTesto.innerText = Math.round(sfxVolume * 100) + '%';
    
    // Inizializza i valori base nel dizionario delle quantità prendendole da carte.js
    databaseCarte.forEach(c => {
        let qDefault = parseInt(c.quantita) || 4;
        if(c.id === 'c_0_9') qDefault = 20; 
        quantitaMazzoLobby[c.id] = qDefault;
    });

    // Seleziona la tab Giocatore di default senza bug visivi
    switchStatsTab('mie');
    setTimeout(inizializzaAscoltatoriSuoni, 500);
}

function playSynth(type) {
    if (sfxVolume <= 0) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    const now = audioCtx.currentTime;
    const volumeEffettivo = 0.2 * sfxVolume;

    if (type === 'pop') {
        osc.type = 'sine'; 
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.exponentialRampToValueAtTime(800, now + 0.1);
        gainNode.gain.setValueAtTime(volumeEffettivo, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
        osc.start(now); osc.stop(now + 0.1);
    } else if (type === 'bloop') {
        osc.type = 'sine'; 
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.exponentialRampToValueAtTime(550, now + 0.15);
        gainNode.gain.setValueAtTime(volumeEffettivo, now);
        gainNode.gain.linearRampToValueAtTime(0.01, now + 0.15);
        osc.start(now); osc.stop(now + 0.15);
    } else if (type === 'click') {
        osc.type = 'triangle'; 
        osc.frequency.setValueAtTime(750, now);
        gainNode.gain.setValueAtTime(volumeEffettivo * 0.3, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.04);
        osc.start(now); osc.stop(now + 0.04);
    }
}

export function cambiaVolumeSFX(valore) {
    sfxVolume = parseInt(valore) / 100;
    localStorage.setItem('sfxVolume', sfxVolume);
    const volTesto = document.getElementById('vol-sfx-val');
    if (volTesto) volTesto.innerText = valore + '%';
    playSynth('click');
}

function inizializzaAscoltatoriSuoni() {
    document.querySelectorAll('button, [data-sound]').forEach(el => {
        el.addEventListener('mouseenter', () => playSynth('click'));
    });
}

const overlay = document.getElementById('modal-overlay');
let modalAttiva = null;

export function openModal(id) {
    if (!overlay) return;
    playSynth('bloop');
    
    // Gestione ed elisione liste stanze mockate al volo
    if(id === 'modal-public-lobbies') {
        caricaElencoLobbyDisponibili();
    }

    if (modalAttiva) {
        const vecchiaModal = document.getElementById(modalAttiva);
        if (vecchiaModal) vecchiaModal.classList.add('hidden');
    }
    
    overlay.classList.remove('hidden');
    const target = document.getElementById(id);
    if (target) target.classList.remove('hidden');
    modalAttiva = id;
}

export function closeModal() {
    if (!modalAttiva || !overlay) return;
    playSynth('pop');
    const target = document.getElementById(modalAttiva);
    if (target) target.classList.add('hidden');
    overlay.classList.add('hidden');
    modalAttiva = null;
}

/**
 * RISOLUZIONE PUNTO 1: Gestione dello stato dei pulsanti delle tab statistiche.
 * Il pulsante della scheda attiva rimane stabilmente ancorato in basso con il relativo glow cromatico.
 */
export function switchStatsTab(tab) {
    playSynth('click');
    const btnMie = document.getElementById('btn-tab-mie-stats');
    const btnGlobal = document.getElementById('btn-tab-classifica');
    const panelMie = document.getElementById('sub-panel-mie-stats');
    const panelGlobal = document.getElementById('sub-panel-classifica');

    if (!btnMie || !btnGlobal || !panelMie || !panelGlobal) return;

    if (tab === 'mie') {
        // Abbassato con glow rosa attivo
        btnMie.className = "flex-1 py-3 text-sm font-black rounded-2xl uppercase tracking-wider bg-pink-600 text-white translate-y-[4px] shadow-none ring-4 ring-pink-500/40 transition-all";
        // Rialzato classico ardesia
        btnGlobal.className = "flex-1 py-3 text-sm font-black rounded-2xl uppercase tracking-wider bg-slate-700 text-slate-300 shadow-[0_4px_0_#1e293b] hover:translate-y-[-2px] transition-all cursor-pointer";
        
        panelMie.classList.remove('hidden');
        panelGlobal.classList.add('hidden');
    } else {
        // Abbassato con glow ciano attivo
        btnGlobal.className = "flex-1 py-3 text-sm font-black rounded-2xl uppercase tracking-wider bg-cyan-600 text-white translate-y-[4px] shadow-none ring-4 ring-cyan-500/40 transition-all";
        // Rialzato classico ardesia
        btnMie.className = "flex-1 py-3 text-sm font-black rounded-2xl uppercase tracking-wider bg-slate-700 text-slate-300 shadow-[0_4px_0_#1e293b] hover:translate-y-[-2px] transition-all cursor-pointer";
        
        panelMie.classList.add('hidden');
        panelGlobal.classList.remove('hidden');
        caricaDatabaseCarteIndex();
    }
}

export function caricaDatabaseCarteIndex(testoFiltro = "") {
    const container = document.getElementById('leaderboard-list');
    if (!container) return;
    container.innerHTML = "";
    
    const sbloccate = window.carteSbloccateUtente || [];
    const queryNorm = testoFiltro.toLowerCase().trim();

    databaseCarte.forEach(carta => {
        const corrisponde = carta.nome.toLowerCase().includes(queryNorm) || carta.cat.toLowerCase().includes(queryNorm);
        if (testoFiltro && !corrisponde) return;

        const isTrovata = sbloccate.includes(carta.id) || true; // Forza visibilità per comodità di sviluppo

        container.innerHTML += `
            <div class="bg-slate-900/60 border border-slate-800 rounded-2xl p-3 flex flex-col gap-1">
                <div class="flex justify-between items-center">
                    <span class="text-xs font-black tracking-wide text-amber-400 uppercase">${carta.nome}</span>
                    <span class="text-[9px] bg-slate-950 text-slate-400 px-2 py-0.5 rounded-md font-mono font-bold">REGISTRATA</span>
                </div>
                <div class="text-[10px] text-slate-400 font-bold leading-relaxed">${carta.effetto}</div>
                <div class="text-[9px] text-cyan-400 font-black uppercase tracking-wider mt-0.5">${carta.cat}</div>
            </div>
        `;
    });
}

/**
 * RISOLUZIONE PUNTO 2: Selezione tipologia lobby e configurazione campi condizionali
 */
export function selezionaTipoLobby(tipo) {
    playSynth('click');
    tipoLobbySelezionata = tipo;
    const btnPub = document.getElementById('btn-choice-pub');
    const btnPriv = document.getElementById('btn-choice-priv');
    const passWrapper = document.getElementById('wrapper-create-password');

    if(tipo === 'pubblica') {
        btnPub.className = "room-action-btn btn-chunky btn-cyan py-3 px-3 text-xs cursor-pointer flex flex-col items-center gap-1 translate-y-[4px] shadow-none";
        btnPriv.className = "room-action-btn btn-chunky btn-slate py-3 px-3 text-xs cursor-pointer flex flex-col items-center gap-1 shadow-[0_4px_0_#1e293b]";
        if(passWrapper) passWrapper.classList.add('hidden');
    } else {
        btnPriv.className = "room-action-btn btn-chunky btn-yellow py-3 px-3 text-xs cursor-pointer flex flex-col items-center gap-1 translate-y-[4px] shadow-none";
        btnPub.className = "room-action-btn btn-chunky btn-slate py-3 px-3 text-xs cursor-pointer flex flex-col items-center gap-1 shadow-[0_4px_0_#1e293b]";
        if(passWrapper) passWrapper.classList.remove('hidden');
    }
}

/**
 * RISOLUZIONE PUNTO 3 & 4: Generazione e attivazione della Schermata Sala d'Attesa dedicata
 */
export function creaLobbyDefinitiva() {
    const nomeInput = document.getElementById('create-room-name').value.trim() || "STANZA REVOLUTION";
    const maxGiocatori = parseInt(document.getElementById('create-room-max').value) || 8;
    const passwordInput = document.getElementById('create-room-pass').value.trim();

    if(maxGiocatori < 2 || maxGiocatori > 15) {
        alert("Il numero massimo di giocatori deve essere compreso tra 2 e 15.");
        return;
    }

    playSynth('bloop');
    closeModal();

    // Setup stato stanza
    const mioNick = window.datiUtenteConnesso?.nickname || "MIO_NICKNAME";
    lobbyCorrente = {
        id: "#" + Math.floor(10000 + Math.random() * 90000),
        nome: nomeInput.toUpperCase(),
        maxGiocatori: maxGiocatori,
        tipo: tipoLobbySelezionata,
        password: passwordInput,
        owner: mioNick,
        isHost: true // L'utente corrente è il creatore
    };

    // Popolamento lista partecipanti mockata
    partecipantiStanza = [
        { uid: window.currentUserUid, nickname: mioNick, avatar: "👑", livello: window.datiUtenteConnesso?.livello || 1, isHost: true },
        { uid: "mock_2", nickname: "SNAKE_99", avatar: "🦊", livello: 14, isHost: false },
        { uid: "mock_3", nickname: "BRAINROT_CEO", avatar: "🤡", livello: 32, isHost: false }
    ];

    // Transizione Viste (Sostituzione dell'Hub con la schermata dedicata)
    document.getElementById('hub-main-view').classList.add('hidden');
    document.getElementById('waiting-room-view').classList.remove('hidden');

    renderizzaSalaAttesa();
}

export function renderizzaSalaAttesa() {
    if(!lobbyCorrente) return;

    // Aggiornamento Header
    document.getElementById('wait-lobby-title').innerText = lobbyCorrente.nome;
    document.getElementById('wait-lobby-id-span').innerText = lobbyCorrente.id + " • HOST: " + lobbyCorrente.owner.toUpperCase();
    document.getElementById('wait-badge-status').innerText = lobbyCorrente.tipo === 'privata' ? "🔒 STANZA PRIVATA" : "🌍 STANZA PUBBLICA";

    // Contatori
    const counterStr = `${partecipantiStanza.length}/${lobbyCorrente.maxGiocatori}`;
    document.getElementById('wait-player-counter').innerText = counterStr;

    // Disgiunzione dei pannelli Destri in base ai privilegi (Host vs Guest)
    const panelHost = document.getElementById('panel-host-controls');
    const panelGuest = document.getElementById('panel-guest-waiting');

    if(lobbyCorrente.isHost) {
        panelHost.classList.remove('hidden');
        panelGuest.classList.add('hidden');

        // Compila specchietto riassuntivo
        document.getElementById('host-conf-name').innerText = lobbyCorrente.nome;
        document.getElementById('host-conf-type').innerText = lobbyCorrente.tipo;
        document.getElementById('host-conf-max').innerText = lobbyCorrente.maxGiocatori;
        document.getElementById('host-conf-current').innerText = partecipantiStanza.length;
    } else {
        panelHost.classList.add('hidden');
        panelGuest.classList.remove('hidden');
    }

    // Renderizzazione della lista dei giocatori (Colonna Sinistra)
    const listContainer = document.getElementById('waiting-players-list');
    listContainer.innerHTML = "";

    partecipantiStanza.forEach(p => {
        const iconaHost = p.isHost ? "👑 " : "";
        const isMe = p.uid === window.currentUserUid;
        
        // Creazione riga del giocatore con gestione condizionale del menu dei tre puntini
        let menuTrePuntiniHTML = "";
        if(lobbyCorrente.isHost && !isMe) {
            menuTrePuntiniHTML = `
                <div class="relative">
                    <button onclick="toggleHostDropdown('${p.uid}')" class="menu-trigger opacity-60 hover:opacity-100 font-black text-slate-400 text-lg px-2 cursor-pointer select-none">⋮</button>
                    <div id="dropdown-${p.uid}" class="host-dropdown min-w-[140px] py-1">
                        <button onclick="eseguiAzioneHost('profilo', '${p.uid}')" class="w-full text-left px-3 py-1.5 text-[11px] font-black hover:bg-slate-800 text-white block uppercase">Visualizza Profilo</button>
                        <button onclick="eseguiAzioneHost('espelli', '${p.uid}')" class="w-full text-left px-3 py-1.5 text-[11px] font-black hover:bg-red-950 text-red-400 block uppercase">Espelli</button>
                        <button onclick="eseguiAzioneHost('banna', '${p.uid}')" class="w-full text-left px-3 py-1.5 text-[11px] font-black hover:bg-red-950 text-red-500 block uppercase">Banna</button>
                        <button onclick="eseguiAzioneHost('nomina', '${p.uid}')" class="w-full text-left px-3 py-1.5 text-[11px] font-black hover:bg-amber-950 text-amber-400 block uppercase">Nomina Host</button>
                    </div>
                </div>
            `;
        }

        const row = document.createElement('div');
        row.className = 'player-row bg-black/40 border border-slate-900 rounded-2xl p-2.5 flex items-center justify-between relative';

        const left = document.createElement('div');
        left.className = 'flex items-center gap-3';

        const av = document.createElement('div');
        av.className = 'w-9 h-9 bg-slate-950 rounded-xl overflow-hidden flex items-center justify-center border border-slate-800 shadow-inner';
        if (globalThis.AvatarUI) {
            globalThis.AvatarUI.mountAvatar(av, p.avatar, { imgClass: 'w-full h-full object-cover' });
        } else {
            av.textContent = p.avatar || '🦊';
        }

        const meta = document.createElement('div');
        meta.innerHTML = `
            <div class="text-xs font-black text-white uppercase tracking-wide">${iconaHost}${p.nickname} ${isMe ? '<span class="text-[9px] text-pink-400 lowercase">(tu)</span>' : ''}</div>
            <div class="text-[10px] text-slate-500 font-bold uppercase">Livello ${p.livello}</div>
        `;
        left.appendChild(av);
        left.appendChild(meta);
        row.appendChild(left);
        if (menuTrePuntiniHTML) {
            const menuWrap = document.createElement('div');
            menuWrap.innerHTML = menuTrePuntiniHTML;
            row.appendChild(menuWrap.firstElementChild || menuWrap);
        }
        listContainer.appendChild(row);
    });
}

export function toggleHostDropdown(uid) {
    playSynth('click');
    const target = document.getElementById(`dropdown-${uid}`);
    const giaAperto = target && !target.classList.contains('hidden') && target.style.display === 'block';
    
    // Chiudi tutti i dropdown aperti prima
    document.querySelectorAll('.host-dropdown').forEach(d => {
        d.style.display = 'none';
    });

    if(target && !giaAperto) {
        target.style.display = 'block';
    }
}

/**
 * Gestione delle azioni avanzate dell'Host sui partecipanti
 */
export function eseguiAzioneHost(azione, uid) {
    playSynth('click');
    const player = partecipantiStanza.find(p => p.uid === uid);
    if(!player) return;

    if(azione === 'profilo') {
        alert(`Profilo di ${player.nickname} \nLivello: ${player.livello}\nStato: Connesso`);
    } else if(azione === 'espelli') {
        if(confirm(`Vuoi espellere ${player.nickname} dalla lobby?`)) {
            partecipantiStanza = partecipantiStanza.filter(p => p.uid !== uid);
            renderizzaSalaAttesa();
        }
    } else if(azione === 'banna') {
        if(confirm(`Vuoi bannare definitivamente ${player.nickname}?`)) {
            partecipantiStanza = partecipantiStanza.filter(p => p.uid !== uid);
            renderizzaSalaAttesa();
        }
    } else if(azione === 'nomina') {
        if(confirm(`Vuoi trasferire i poteri di Host a ${player.nickname}?`)) {
            // Riassegnazione privilegi
            partecipantiStanza.forEach(p => {
                if(p.uid === uid) { p.isHost = true; p.avatar = "👑"; }
                if(p.uid === window.currentUserUid) { p.isHost = false; p.avatar = "🦊"; }
            });
            lobbyCorrente.owner = player.nickname;
            lobbyCorrente.isHost = false; 
            renderizzaSalaAttesa();
        }
    }
}

export function abbandonaSalaAttesa() {
    playSynth('pop');
    lobbyCorrente = null;
    partecipantiStanza = [];
    document.getElementById('waiting-room-view').classList.add('hidden');
    document.getElementById('hub-main-view').classList.remove('hidden');
}

/**
 * RISOLUZIONE PUNTO 5: Finestra di Riepilogo delle Carte (Formato Verticale e Proporzionato)
 */
export function apriRiepilogoCarte() {
    openModal('modal-card-summary');
    filtraMazzoRiepilogo();
}

export function chiudiRiepilogoCarte() {
    closeModal();
}

export function filtraMazzoRiepilogo(testo = "") {
    const grid = document.getElementById('summary-cards-grid');
    if(!grid) return;
    grid.innerHTML = "";

    const queryNorm = testo.toLowerCase().trim();

    databaseCarte.forEach(carta => {
        if(testo && !carta.nome.toLowerCase().includes(queryNorm)) return;

        const qAttuale = quantitaMazzoLobby[carta.id] ?? 0;
        const isDisabilitata = qAttuale === 0;

        // Struttura visuale verticale proporzionata (Aspect Ratio 2/3) coerente con UNO?
        grid.innerHTML += `
            <div class="relative rounded-2xl p-3 flex flex-col justify-between items-center text-center transition-all border shadow-lg aspect-[2/3] select-none group
                ${isDisabilitata 
                    ? 'bg-black/80 border-dashed border-slate-800 opacity-30 scale-95' 
                    : 'bg-gradient-to-b from-slate-900 to-slate-950 border-slate-800 hover:border-pink-500/50 hover:shadow-pink-500/5'}"
            >
                <div class="absolute top-2 right-2 text-[10px] font-black px-1.5 py-0.5 rounded bg-black/60 text-pink-400 font-mono">
                    x${qAttuale}
                </div>

                <div class="text-[8px] tracking-widest uppercase font-black text-slate-500 mt-1 truncate max-w-full">
                    ${carta.cat}
                </div>

                <div class="text-xs font-black text-white uppercase tracking-tight px-1 leading-tight my-auto drop-shadow-sm">
                    ${carta.nome}
                </div>

                <div class="w-full flex items-center justify-between bg-black/40 rounded-xl p-1 gap-1 border border-slate-900 mt-auto">
                    <button onclick="modificaQuantitaCarta('${carta.id}', -1)" class="w-6 h-6 bg-slate-800 hover:bg-red-600 rounded-lg text-xs font-black flex items-center justify-center text-white transition-colors cursor-pointer">-</button>
                    <span class="text-xs font-black font-mono text-amber-400">${qAttuale}</span>
                    <button onclick="modificaQuantitaCarta('${carta.id}', 1)" class="w-6 h-6 bg-slate-800 hover:bg-emerald-600 rounded-lg text-xs font-black flex items-center justify-center text-white transition-colors cursor-pointer">+</button>
                </div>
            </div>
        `;
    });
}

export function modificaQuantitaCarta(id, offset) {
    playSynth('click');
    let q = quantitaMazzoLobby[id] ?? 0;
    q += offset;
    if(q < 0) q = 0;
    
    quantitaMazzoLobby[id] = q;
    
    // Rinfresca istantaneamente la vista filtrata mantenendo la ricerca
    const ricercaVal = document.getElementById('summary-search-input').value;
    filtraMazzoRiepilogo(ricercaVal);
}

/**
 * RISOLUZIONE PUNTO 6: Gestione opzioni e regole complementari
 */
export function toggleOpzioneAvanzata(idOpzione) {
    playSynth('click');
    if(idOpzione === 'brainrot') {
        const b = document.getElementById('badge-brainrot');
        if(b.innerText === 'DISATTIVA') {
            b.innerText = 'ATTIVA'; b.className = "bg-purple-600 text-white px-2 py-0.5 rounded-md font-mono text-[10px] font-black uppercase shadow-[0_0_10px_rgba(168,85,247,0.4)]";
        } else {
            b.innerText = 'DISATTIVA'; b.className = "bg-slate-800 text-slate-400 px-2 py-0.5 rounded-md font-mono text-[10px] font-black uppercase";
        }
    } else if(idOpzione === 'casual') {
        const b = document.getElementById('badge-casual');
        if(b.innerText === 'CASUAL') {
            b.innerText = 'COMPETITIVA'; b.className = "bg-red-600 text-white px-2 py-0.5 rounded-md font-mono text-[10px] font-black uppercase shadow-[0_0_10px_rgba(239,68,68,0.4)]";
        } else {
            b.innerText = 'CASUAL'; b.className = "bg-pink-600 text-white px-2 py-0.5 rounded-md font-mono text-[10px] font-black uppercase";
        }
    }
}

/**
 * RISOLUZIONE PUNTO 7: Unisciti ad una stanza della lista con popup password se protetta
 */
let lobbySelezionataPerAccesso = null;

function caricaElencoLobbyDisponibili() {
    const container = document.getElementById('lobbies-list-container');
    if(!container) return;
    container.innerHTML = "";

    // Array di lobby mockate per simulare lo scenario di accoppiamento
    const listatoMock = [
        { id: "48392", nome: "Lobby Italia", host: "Marco", attuali: 4, max: 15, ping: "32ms", locked: true, pass: "1234" },
        { id: "10943", nome: "Brainrot Arena", host: "GamerPro", attuali: 2, max: 8, ping: "45ms", locked: false, pass: "" },
        { id: "94821", nome: "Tavolo Sghembo", host: "ZioPino", attuali: 14, max: 15, ping: "18ms", locked: true, pass: "0000" }
    ];

    listatoMock.forEach(l => {
        container.innerHTML += `
            <button onclick="mostraPopupPassword('${l.id}', ${l.locked}, '${l.pass}', '${l.nome}', ${l.max}, '${l.host}')" 
                class="room-action-btn w-full bg-black/40 border ${l.locked ? 'border-amber-500/40' : 'border-cyan-500/30'} rounded-2xl p-3 text-left cursor-pointer shadow-inner flex items-center justify-between gap-3 hover:scale-[1.01] transition-transform"
            >
                <div class="font-black text-xs text-white uppercase tracking-wide">
                    ${l.nome} | <span class="text-slate-500 font-mono">#${l.id}</span> | <span class="text-pink-400">Host: ${l.host}</span> | <span class="text-cyan-400 font-mono">${l.attuali}/${l.max}</span> | <span class="text-emerald-400 font-mono">${l.ping}</span> | ${l.locked ? '🔒' : '🌍'}
                </div>
                <span class="text-slate-500 font-black text-sm">➔</span>
            </button>
        `;
    });
}

export function mostraPopupPassword(id, locked, passVerifica, nome, max, host) {
    playSynth('click');
    lobbySelezionataPerAccesso = { id, locked, passVerifica, nome, max, host };

    if(!locked) {
        // Entra direttamente senza password
        eseguiConnessioneEffettivaStanza();
    } else {
        // Richiede input password tramite popup
        document.getElementById('error-gate-pass').classList.add('hidden');
        document.getElementById('input-gate-pass').value = "";
        openModal('modal-gate-password');
    }
}

export function inoltraAccessoLobbyPrivata() {
    const digitata = document.getElementById('input-gate-pass').value.trim();
    if(digitata === lobbySelezionataPerAccesso.passVerifica) {
        playSynth('bloop');
        closeModal();
        eseguiConnessioneEffettivaStanza();
    } else {
        playSynth('pop');
        document.getElementById('error-gate-pass').classList.remove('hidden');
    }
}

function eseguiConnessioneEffettivaStanza() {
    closeModal();
    
    // Configura la lobby corrente come Ospite (Guest)
    lobbyCorrente = {
        id: "#" + lobbySelezionataPerAccesso.id,
        nome: lobbySelezionataPerAccesso.nome.toUpperCase(),
        maxGiocatori: lobbySelezionataPerAccesso.max,
        tipo: lobbySelezionataPerAccesso.locked ? 'privata' : 'pubblica',
        owner: lobbySelezionataPerAccesso.host,
        isHost: false // L'utente corrente è un ospite normale
    };

    const mioNick = window.datiUtenteConnesso?.nickname || "MIO_NICKNAME";
    partecipantiStanza = [
        { uid: "host_uid", nickname: lobbySelezionataPerAccesso.host, avatar: "👑", livello: 12, isHost: true },
        { uid: window.currentUserUid, nickname: mioNick, avatar: "🦊", livello: window.datiUtenteConnesso?.livello || 1, isHost: false },
        { uid: "mock_user", nickname: "GUEST_ALPHA", avatar: "🤖", livello: 4, isHost: false }
    ];

    // Nasconde l'hub e lancia lo specchio della stanza
    document.getElementById('hub-main-view').classList.add('hidden');
    document.getElementById('waiting-room-view').classList.remove('hidden');

    renderizzaSalaAttesa();
}