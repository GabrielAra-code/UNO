(function (global) {
const databaseCarte = window.databaseCarte || [];
const {
    isAdminUid,
    BAN_DURATION_OPTIONS,
    LOBBY_CLOSED_BY_ADMIN_MESSAGE,
    calcolaLivelloDaXp,
    calcolaProgressoXp,
    applicaGuadagnoXp
} = window.AdminConfig || {};

let ctx = null;
let adminInitialized = false;
let unsubLobbies = null;
let unsubUsers = null;
let unsubBans = null;
let unsubSecurity = null;
let unsubAnnunci = null;
let cacheLobbies = [];
let cacheUsers = [];
let cacheBans = [];
let cacheSecurityEvents = [];
let cacheAnnunci = [];
let selectedLobbyId = null;
let selectedGiveUserId = null;
let selectedBanUserId = null;
let selectedBanViewId = null;
let banPickMode = null;

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function assertAdmin() {
    const uid = ctx?.auth?.currentUser?.uid || global.currentUserUid;
    if (!isAdminUid(uid)) {
        throw new Error('Accesso amministratore negato.');
    }
}

function adminDb() {
    assertAdmin();
    return ctx.db;
}

function isCurrentUserAdmin() {
    const uid = ctx?.auth?.currentUser?.uid || global.currentUserUid;
    return isAdminUid(uid);
}

function updateAdminButtonVisibility() {
    const btn = document.getElementById('btn-admin-panel');
    if (!btn) return;
    const isAdmin = isCurrentUserAdmin();
    btn.classList.toggle('hidden', !isAdmin);
    const hint = document.getElementById('admin-uid-hint');
    if (hint) {
        const uid = ctx?.auth?.currentUser?.uid || global.currentUserUid || '';
        hint.textContent = isAdmin
            ? ''
            : (uid ? `UID account: ${uid}` : '');
        hint.classList.toggle('hidden', isAdmin || !uid);
    }
}

function getAdminProfile() {
    const user = ctx.auth.currentUser;
    const stored = JSON.parse(localStorage.getItem('unoCurrentUser') || '{}');
    return {
        uid: user.uid,
        nickname: stored.nickname || 'Admin',
        email: user.email || stored.email || ''
    };
}

function lobbyAperta(lobby) {
    if (!lobby?.id) return false;
    const status = String(lobby?.status || 'waiting').toLowerCase();
    const closed = ['closed', 'closed_by_admin', 'deleted', 'destroyed', 'eliminated', 'finished'];
    if (closed.includes(status)) return false;
    const n = Array.isArray(lobby?.players)
        ? lobby.players.filter(p => p && (p.nickname || p.uid)).length
        : 0;
    if (n === 0) return false;
    const joinable = ['waiting', 'open', 'playing', 'started', 'in_game'];
    return joinable.includes(status) || status === '';
}

function filtraLobby(list, query) {
    const q = query.trim().toLowerCase();
    return list.filter(lobby => {
        if (!lobbyAperta(lobby)) return false;
        if (!q) return true;
        return String(lobby.nome || '').toLowerCase().includes(q)
            || String(lobby.id || '').toLowerCase().includes(q);
    });
}

function filtraUtenti(list, query) {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(user =>
        String(user.nickname || '').toLowerCase().includes(q)
        || String(user.uid || '').toLowerCase().includes(q)
        || String(user.email || '').toLowerCase().includes(q)
    );
}

function filtraBan(list, query) {
    return filtraUtenti(list, query);
}

function normalizeLobbyId(id) {
    return String(id || '').trim();
}

function lobbyFromSnap(docSnap) {
    if (window.LobbyList?.lobbyFromFirestoreDoc) {
        return window.LobbyList.lobbyFromFirestoreDoc(docSnap);
    }
    const data = docSnap.data?.() || {};
    return { ...data, id: docSnap.id || data.id };
}

function findLobbyInCache(lobbyId) {
    const key = normalizeLobbyId(lobbyId);
    if (!key) return null;
    return cacheLobbies.find(item => normalizeLobbyId(item.id) === key) || null;
}

function removeLobbyFromLocalStorage(lobbyId) {
    const key = normalizeLobbyId(lobbyId);
    if (!key) return;
    const list = JSON.parse(localStorage.getItem('unoLobbyList') || '[]')
        .filter(room => normalizeLobbyId(room.id) !== key);
    localStorage.setItem('unoLobbyList', JSON.stringify(list));
}

function renderAdminLobbies() {
    const container = document.getElementById('admin-lobbies-list');
    const search = document.getElementById('admin-lobbies-search')?.value || '';
    if (!container) return;

    const lobbies = filtraLobby(cacheLobbies, search);
    if (!lobbies.length) {
        container.innerHTML = `
            <div class="bg-black/40 border border-slate-900 rounded-2xl p-4 text-center text-slate-400 text-sm font-bold">
                Nessuna lobby aperta
            </div>`;
        return;
    }

    container.innerHTML = lobbies.map(lobby => {
        const players = Array.isArray(lobby.players) ? lobby.players.length : 0;
        const max = parseInt(lobby.maxPlayers, 10) || 6;
        const privata = lobby.locked ? 'Privata 🔒' : 'Pubblica';
        const stato = String(lobby.status || 'waiting');
        const lid = String(lobby.id || '');
        return `
            <button type="button" data-admin-open-lobby="${escapeHtml(lid)}"
                class="admin-lobby-row w-full text-left bg-black/40 border border-red-900/40 rounded-2xl p-3 hover:border-red-500 hover:bg-red-950/30 transition-colors cursor-pointer touch-manipulation">
                <div class="text-sm font-black text-white uppercase">${escapeHtml(lobby.nome || 'Lobby')}</div>
                <div class="text-[10px] text-slate-500 font-bold uppercase mt-1">
                    Codice: ${escapeHtml(lid)} • ${players}/${max} • ${privata} • ${escapeHtml(stato)}
                </div>
            </button>`;
    }).join('');
}

function renderAdminUsers() {
    const container = document.getElementById('admin-gives-list');
    const search = document.getElementById('admin-gives-search')?.value || '';
    if (!container) return;

    const users = filtraUtenti(cacheUsers, search);
    if (!users.length) {
        container.innerHTML = `<div class="text-center text-slate-500 text-sm font-bold p-4">Nessun utente trovato</div>`;
        return;
    }

    container.innerHTML = users.map(user => {
        const xp = user.xp ?? 0;
        const prog = calcolaProgressoXp ? calcolaProgressoXp(xp) : { livello: user.livello ?? 1, xpCorrente: xp, xpRichiesto: 100 };
        return `
            <button type="button" data-admin-open-give="${escapeHtml(user.uid)}"
                class="w-full text-left bg-black/40 border border-slate-800 rounded-2xl p-3 hover:border-amber-500/40 cursor-pointer">
                <div class="font-black text-white text-sm">${escapeHtml(user.nickname || 'Giocatore')}</div>
                <div class="text-[10px] text-slate-500 font-bold uppercase mt-1">
                    UID ${escapeHtml(user.uid)} • LIV ${prog.livello} • ${prog.xpCorrente}/${prog.xpRichiesto} XP (${xp} tot.)
                </div>
            </button>`;
    }).join('');

    container.querySelectorAll('[data-admin-open-give]').forEach(btn => {
        btn.addEventListener('click', () => openAdminGiveUser(btn.getAttribute('data-admin-open-give')));
    });
}

function renderAdminBanList() {
    const container = document.getElementById('admin-ban-list');
    const search = document.getElementById('admin-ban-search')?.value || '';
    if (!container) return;

    const bans = filtraBan(cacheBans, search);
    if (!bans.length) {
        container.innerHTML = `<div class="text-center text-slate-500 text-sm font-bold p-4">Nessun ban attivo</div>`;
        return;
    }

    container.innerHTML = bans.map(ban => `
        <button type="button" data-admin-open-ban="${escapeHtml(ban.uid)}"
            class="w-full text-left bg-black/40 border border-red-950 rounded-2xl p-3 hover:border-red-500/50 cursor-pointer">
            <div class="font-black text-red-300 text-sm">${escapeHtml(ban.nickname || 'Utente')}</div>
            <div class="text-[10px] text-slate-500 font-bold uppercase mt-1">${escapeHtml(ban.email || '')}</div>
            <div class="text-[10px] text-slate-400 mt-1">${escapeHtml(ban.reason || '—')}</div>
            <div class="text-[10px] text-amber-400 font-bold mt-1">Residuo: ${ban.permanent ? 'Permanente' : escapeHtml(ban.remainingLabel)}</div>
        </button>
    `).join('');

    container.querySelectorAll('[data-admin-open-ban]').forEach(btn => {
        btn.addEventListener('click', () => openAdminBanDetail(btn.getAttribute('data-admin-open-ban')));
    });
}

function renderBanPickList() {
    const container = document.getElementById('admin-ban-pick-list');
    const search = document.getElementById('admin-ban-pick-search')?.value || '';
    if (!container) return;

    const users = filtraUtenti(cacheUsers, search);
    container.innerHTML = users.map(user => `
        <button type="button" data-admin-pick-ban="${escapeHtml(user.uid)}"
            class="w-full text-left bg-black/40 border border-slate-800 rounded-2xl p-3 hover:border-red-500/40 cursor-pointer">
            <div class="font-black text-white text-sm">${escapeHtml(user.nickname || 'Giocatore')}</div>
            <div class="text-[10px] text-slate-500 font-bold uppercase">${escapeHtml(user.email || '')} • ${escapeHtml(user.uid)}</div>
        </button>
    `).join('') || `<div class="text-slate-500 text-sm font-bold p-3 text-center">Nessun utente</div>`;

    container.querySelectorAll('[data-admin-pick-ban]').forEach(btn => {
        btn.addEventListener('click', () => openAdminBanForm(btn.getAttribute('data-admin-pick-ban')));
    });
}

let adminTabCorrente = null;

function adminSectionId(tab) {
    return `admin-section-${tab}`;
}

function updateAdminTabButtons(tab) {
    document.querySelectorAll('[data-admin-tab]').forEach(btn => {
        const active = btn.getAttribute('data-admin-tab') === tab;
        btn.classList.toggle('bg-red-600', active);
        btn.classList.toggle('text-white', active);
        btn.classList.toggle('bg-slate-800', !active);
        btn.classList.toggle('text-slate-400', !active);
    });
}

function switchAdminTab(tab, options = {}) {
    const { animate = true } = options;
    const UI = globalThis.UITransitions;
    const viewport = document.getElementById('admin-pages-viewport');
    const run = async () => {
        const toEl = document.getElementById(adminSectionId(tab));
        const fromEl = adminTabCorrente ? document.getElementById(adminSectionId(adminTabCorrente)) : null;

        updateAdminTabButtons(tab);

        if (!toEl) return;

        if (!animate || !fromEl || fromEl === toEl || adminTabCorrente === null) {
            ['lobbies', 'gives', 'ban', 'security', 'annunci'].forEach(name => {
                document.getElementById(adminSectionId(name))?.classList.toggle('hidden', name !== tab);
            });
        } else if (UI) {
            await UI.sequentialPageSwap(viewport, fromEl, toEl, { direction: 'forward' });
        } else {
            fromEl.classList.add('hidden');
            toEl.classList.remove('hidden');
        }

        adminTabCorrente = tab;
    };

    if (UI && animate) UI.withLock(run);
    else run();
}

async function openAdminLobbyDetail(lobbyId) {
    const key = normalizeLobbyId(lobbyId);
    if (!key) return;
    selectedLobbyId = key;

    let lobby = findLobbyInCache(key);

    if (!lobby && ctx.getDoc) {
        try {
            const snap = await ctx.getDoc(ctx.doc(adminDb(), 'lobbies', key));
            if (snap.exists()) {
                lobby = lobbyFromSnap(snap);
                const idx = cacheLobbies.findIndex(item => normalizeLobbyId(item.id) === key);
                if (idx >= 0) cacheLobbies[idx] = lobby;
                else cacheLobbies.push(lobby);
            }
        } catch (err) {
            console.error('openAdminLobbyDetail getDoc:', err);
        }
    }

    if (!lobby) {
        cacheLobbies = cacheLobbies.filter(item => normalizeLobbyId(item.id) !== key);
        removeLobbyFromLocalStorage(key);
        renderAdminLobbies();
        if (window.LobbyNotice?.showLobbyNotFound) {
            window.LobbyNotice.showLobbyNotFound({
                message: 'Questa lobby non esiste più su Firestore (probabilmente dati obsoleti).',
                buttonLabel: 'OK'
            });
        } else {
            alert('Lobby non trovata.');
        }
        selectedLobbyId = null;
        return;
    }

    const title = document.getElementById('admin-lobby-detail-title');
    const body = document.getElementById('admin-lobby-detail-body');
    const joinBtn = document.getElementById('admin-btn-join-lobby');
    const delBtn = document.getElementById('admin-btn-delete-lobby');
    if (!title || !body) return;

    title.innerText = lobby.nome || 'Lobby';
    body.innerHTML = `
        <div class="space-y-2 text-sm">
            <div><span class="text-slate-500 font-bold">Codice:</span> <span class="text-amber-300 font-black">${escapeHtml(lobby.id)}</span></div>
            <div><span class="text-slate-500 font-bold">Giocatori:</span> ${(lobby.players || []).length}/${lobby.maxPlayers || 6}</div>
            <div><span class="text-slate-500 font-bold">Tipo:</span> ${lobby.locked ? 'Privata (password ignorata per admin)' : 'Pubblica'}</div>
            <div><span class="text-slate-500 font-bold">Stato:</span> ${escapeHtml(lobby.status || 'waiting')}</div>
        </div>`;
    if (joinBtn) joinBtn.textContent = 'Entra';
    if (delBtn) delBtn.textContent = 'Elimina';
    ctx.openModal('modal-admin-lobby-detail');
}

async function adminDeleteLobby() {
    assertAdmin();
    if (!selectedLobbyId) return;
    if (!confirm('Eliminare questa lobby? Tutti i giocatori verranno espulsi.')) return;

    const lobbyId = normalizeLobbyId(selectedLobbyId);
    const lobbyRef = ctx.doc(adminDb(), 'lobbies', lobbyId);
    const gameRef = ctx.doc(adminDb(), 'games', lobbyId);

    try {
        const snap = await ctx.getDoc(lobbyRef);
        if (!snap.exists()) {
            cacheLobbies = cacheLobbies.filter(item => normalizeLobbyId(item.id) !== lobbyId);
            removeLobbyFromLocalStorage(lobbyId);
            selectedLobbyId = null;
            renderAdminLobbies();
            ctx.closeModal();
            if (window.LobbyNotice?.showLobbyNotFound) {
                window.LobbyNotice.showLobbyNotFound({
                    message: 'La lobby era già stata eliminata. Lista aggiornata.',
                    buttonLabel: 'OK'
                });
            }
            return;
        }

        try {
            await ctx.updateDoc(lobbyRef, {
                status: 'closed_by_admin',
                adminCloseMessage: LOBBY_CLOSED_BY_ADMIN_MESSAGE,
                closedAt: new Date().toISOString(),
                players: []
            });
        } catch (updateErr) {
            console.warn('Chiusura soft lobby fallita, elimino direttamente:', updateErr);
        }

        try {
            await ctx.deleteDoc(gameRef);
        } catch (gameErr) {
            console.warn('Partita associata non eliminata (può essere assente):', gameErr);
        }

        await ctx.deleteDoc(lobbyRef);

        cacheLobbies = cacheLobbies.filter(item => normalizeLobbyId(item.id) !== lobbyId);
        selectedLobbyId = null;
        removeLobbyFromLocalStorage(lobbyId);
        renderAdminLobbies();

        ctx.playSynth?.('bloop');
        ctx.closeModal();
        alert('Lobby eliminata.');
    } catch (error) {
        console.error('adminDeleteLobby:', error);
        alert('Errore eliminazione lobby: ' + error.message);
    }
}

async function adminJoinLobby() {
    assertAdmin();
    if (!selectedLobbyId || !ctx.entraInLobbyForzato) return;
    ctx.closeModal();
    await ctx.entraInLobbyForzato(selectedLobbyId);
}

function openAdminGiveUser(uid) {
    selectedGiveUserId = uid;
    const user = cacheUsers.find(item => item.uid === uid);
    if (!user) return;

    const xp = user.xp ?? 0;
    const liv = user.livello ?? calcolaLivelloDaXp(xp);
    document.getElementById('admin-give-title').innerText = user.nickname || 'Utente';
    document.getElementById('admin-give-meta').innerText = `UID ${user.uid} • LIV ${liv} • ${xp} XP`;

    const grid = document.getElementById('admin-give-cards-grid');
    const carte = user.carteSbloccate || [];
    grid.innerHTML = databaseCarte.map(carta => {
        const owned = carte.includes(carta.id);
        return `
            <div class="rounded-2xl border p-3 ${owned ? 'border-emerald-600/50 bg-emerald-950/20' : 'border-slate-800 bg-black/40'}">
                <div class="text-xs font-black text-white mb-1">${escapeHtml(carta.nome)}</div>
                <div class="text-[9px] text-slate-500 mb-2">${escapeHtml(carta.id)}</div>
                <button type="button" data-admin-toggle-card="${escapeHtml(carta.id)}"
                    class="btn-chunky ${owned ? 'btn-red' : 'btn-emerald'} w-full py-2 text-[10px]">
                    ${owned ? 'Rimuovi' : 'Assegna'}
                </button>
            </div>`;
    }).join('');

    grid.querySelectorAll('[data-admin-toggle-card]').forEach(btn => {
        btn.addEventListener('click', () => toggleUserCard(uid, btn.getAttribute('data-admin-toggle-card')));
    });

    document.getElementById('admin-give-xp-input').value = '100';
    ctx.openModal('modal-admin-give-user');
}

async function adminGiveXp() {
    assertAdmin();
    const amount = parseInt(document.getElementById('admin-give-xp-input')?.value, 10);
    if (!selectedGiveUserId || Number.isNaN(amount) || amount <= 0) {
        alert('Inserisci una quantità XP valida.');
        return;
    }

    const user = cacheUsers.find(item => item.uid === selectedGiveUserId);
    const progresso = applicaGuadagnoXp
        ? applicaGuadagnoXp(user?.xp ?? 0, amount)
        : { xp: (user?.xp ?? 0) + amount, livello: calcolaLivelloDaXp((user?.xp ?? 0) + amount) };
    const nuovoXp = progresso.xp;
    const nuovoLivello = progresso.livello;
    const admin = getAdminProfile();

    try {
        await ctx.updateDoc(ctx.doc(adminDb(), 'utenti', selectedGiveUserId), {
            xp: nuovoXp,
            livello: nuovoLivello
        });
        await ctx.addDoc(ctx.collection(adminDb(), 'rewards'), {
            type: 'xp',
            targetUid: selectedGiveUserId,
            amount,
            adminUid: admin.uid,
            adminNickname: admin.nickname,
            createdAt: new Date().toISOString()
        });
        ctx.playSynth?.('bloop');
        alert(`Aggiunti ${amount} XP. Nuovo totale: ${nuovoXp} (LIV ${nuovoLivello})`);
        openAdminGiveUser(selectedGiveUserId);
    } catch (error) {
        alert('Errore assegnazione XP: ' + error.message);
    }
}

async function toggleUserCard(uid, cardId) {
    assertAdmin();
    const user = cacheUsers.find(item => item.uid === uid);
    if (!user) return;

    const carte = [...(user.carteSbloccate || [])];
    const index = carte.indexOf(cardId);
    const adding = index === -1;
    if (adding) carte.push(cardId);
    else carte.splice(index, 1);

    const admin = getAdminProfile();
    try {
        await ctx.updateDoc(ctx.doc(adminDb(), 'utenti', uid), { carteSbloccate: carte });
        await ctx.addDoc(ctx.collection(adminDb(), 'rewards'), {
            type: adding ? 'card_grant' : 'card_revoke',
            targetUid: uid,
            cardId,
            adminUid: admin.uid,
            adminNickname: admin.nickname,
            createdAt: new Date().toISOString()
        });
        user.carteSbloccate = carte;
        openAdminGiveUser(uid);
    } catch (error) {
        alert('Errore aggiornamento carte: ' + error.message);
    }
}

function openAdminBanForm(uid) {
    selectedBanUserId = uid;
    const user = cacheUsers.find(item => item.uid === uid);
    if (!user) return;

    document.getElementById('admin-ban-form-title').innerText = `Ban: ${user.nickname || uid}`;
    document.getElementById('admin-ban-reason').value = '';
    const select = document.getElementById('admin-ban-duration');
    select.innerHTML = BAN_DURATION_OPTIONS.map(opt =>
        `<option value="${opt.id}">${opt.label}</option>`
    ).join('');

    document.getElementById('modal-admin-ban-pick')?.classList.add('hidden');
    ctx.openModal('modal-admin-ban-form');
}

async function adminExecuteBan() {
    assertAdmin();
    const reason = document.getElementById('admin-ban-reason')?.value?.trim();
    if (!selectedBanUserId) return;
    if (!reason) {
        alert('Il motivo del ban è obbligatorio.');
        return;
    }

    const durationId = document.getElementById('admin-ban-duration')?.value;
    const duration = BAN_DURATION_OPTIONS.find(item => item.id === durationId);
    const user = cacheUsers.find(item => item.uid === selectedBanUserId);
    const admin = getAdminProfile();
    const bannedAt = new Date().toISOString();
    const expiresAt = duration?.ms == null
        ? null
        : new Date(Date.now() + duration.ms).toISOString();

    try {
        await ctx.setDoc(ctx.doc(adminDb(), 'bans', selectedBanUserId), {
            uid: selectedBanUserId,
            nickname: user?.nickname || 'Giocatore',
            email: user?.email || '',
            reason,
            bannedAt,
            expiresAt,
            adminUid: admin.uid,
            adminNickname: admin.nickname
        });
        await ctx.addDoc(ctx.collection(adminDb(), 'admin'), {
            action: 'ban',
            targetUid: selectedBanUserId,
            reason,
            expiresAt,
            adminUid: admin.uid,
            createdAt: bannedAt
        });
        ctx.playSynth?.('error');
        ctx.closeModal();
        alert('Utente bannato.');
        switchAdminTab('ban');
    } catch (error) {
        alert('Errore ban: ' + error.message);
    }
}

function openAdminBanDetail(uid) {
    selectedBanViewId = uid;
    const ban = cacheBans.find(item => item.uid === uid);
    if (!ban) return;

    document.getElementById('admin-ban-detail-body').innerHTML = `
        <div class="space-y-2 text-sm text-slate-300">
            <div><span class="text-slate-500 font-bold">Nickname:</span> ${escapeHtml(ban.nickname)}</div>
            <div><span class="text-slate-500 font-bold">Email:</span> ${escapeHtml(ban.email)}</div>
            <div><span class="text-slate-500 font-bold">UID:</span> ${escapeHtml(ban.uid)}</div>
            <div><span class="text-slate-500 font-bold">Motivo:</span> ${escapeHtml(ban.reason)}</div>
            <div><span class="text-slate-500 font-bold">Data ban:</span> ${escapeHtml(new Date(ban.bannedAt).toLocaleString('it-IT'))}</div>
            <div><span class="text-slate-500 font-bold">Scadenza:</span> ${ban.permanent ? 'Permanente' : escapeHtml(new Date(ban.expiresAt).toLocaleString('it-IT'))}</div>
            <div><span class="text-slate-500 font-bold">Tempo residuo:</span> ${ban.permanent ? 'Permanente' : escapeHtml(ban.remainingLabel)}</div>
            <div><span class="text-slate-500 font-bold">Admin:</span> ${escapeHtml(ban.adminNickname || ban.adminUid || '—')}</div>
        </div>`;
    ctx.openModal('modal-admin-ban-detail');
}

async function adminUnban() {
    assertAdmin();
    if (!selectedBanViewId) return;
    if (!confirm('Rimuovere il ban per questo utente?')) return;

    try {
        await ctx.deleteDoc(ctx.doc(adminDb(), 'bans', selectedBanViewId));
        await ctx.addDoc(ctx.collection(adminDb(), 'admin'), {
            action: 'unban',
            targetUid: selectedBanViewId,
            adminUid: ctx.auth.currentUser.uid,
            createdAt: new Date().toISOString()
        });
        ctx.closeModal();
        alert('Ban rimosso.');
    } catch (error) {
        alert('Errore sban: ' + error.message);
    }
}

function startRealtimeListeners() {
    stopRealtimeListeners();
    assertAdmin();

    unsubLobbies = ctx.onSnapshot(ctx.collection(adminDb(), 'lobbies'), snapshot => {
        cacheLobbies = snapshot.docs.map(docSnap => lobbyFromSnap(docSnap));
        renderAdminLobbies();
    });

    unsubUsers = ctx.onSnapshot(ctx.collection(adminDb(), 'utenti'), snapshot => {
        cacheUsers = snapshot.docs.map(docSnap => ({ uid: docSnap.id, ...docSnap.data() }));
        renderAdminUsers();
        if (!document.getElementById('modal-admin-ban-pick')?.classList.contains('hidden')) {
            renderBanPickList();
        }
    });

    unsubBans = ctx.onSnapshot(ctx.collection(adminDb(), 'bans'), snapshot => {
        cacheBans = snapshot.docs.map(docSnap => {
            const data = docSnap.data();
            const permanent = data.expiresAt == null;
            return {
                uid: docSnap.id,
                ...data,
                permanent,
                remainingLabel: permanent ? 'Permanente' : formatRemaining(data.expiresAt)
            };
        });
        renderAdminBanList();
    });

    unsubSecurity = ctx.onSnapshot(ctx.collection(adminDb(), 'security_events'), snapshot => {
        cacheSecurityEvents = snapshot.docs
            .map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
            .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        renderAdminSecurityEvents();
    });

    if (typeof ctx.query === 'function' && typeof ctx.orderBy === 'function') {
        unsubAnnunci = ctx.onSnapshot(
            ctx.query(ctx.collection(adminDb(), 'annunci'), ctx.orderBy('createdAt', 'desc')),
            snapshot => {
                cacheAnnunci = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
                renderAdminAnnunci();
            },
            err => {
                console.error('[ADMIN] annunci listener:', err);
                cacheAnnunci = [];
                renderAdminAnnunci();
            }
        );
    } else {
        console.warn('[ADMIN] query/orderBy non disponibili — tab Annunci senza sync live.');
    }
}

function formatRemaining(expiresAt) {
    const diff = new Date(expiresAt).getTime() - Date.now();
    if (diff <= 0) return 'Scaduto';
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return h >= 24 ? `${Math.floor(h / 24)}g ${h % 24}h` : `${h}h ${m}m`;
}

function renderAdminAnnunci() {
    const container = document.getElementById('admin-annunci-list');
    if (!container) return;

    if (!cacheAnnunci.length) {
        container.innerHTML = `<div class="text-center text-slate-500 text-sm font-bold p-4">Nessun annuncio pubblicato</div>`;
        return;
    }

    const UI = global.AnnouncementsUI;
    container.innerHTML = cacheAnnunci.map(ann => `
        <div class="bg-black/40 border border-amber-900/35 rounded-2xl p-3">
            <div class="flex items-start justify-between gap-2">
                <div class="min-w-0 flex-1">
                    <div class="font-black text-amber-300 text-sm truncate">${escapeHtml(ann.title || '—')}</div>
                    <div class="text-[10px] text-slate-500 font-bold uppercase mt-1">
                        v${escapeHtml(ann.gameVersion || UI?.defaultGameVersion?.() || '1.0.0')}
                        • ${escapeHtml(UI?.formatDate?.(ann.createdAt) || '—')}
                        • ${ann.bold ? 'Grassetto' : 'Normale'}
                        • ${escapeHtml(ann.fontSize || 'md')}
                    </div>
                    <p class="text-[11px] text-slate-400 mt-2 line-clamp-3 whitespace-pre-wrap">${escapeHtml(ann.content || '')}</p>
                </div>
                <button type="button" data-admin-delete-ann="${escapeHtml(ann.id)}"
                    class="btn-chunky btn-red px-3 py-1.5 text-[10px] shrink-0" data-sound="error">Elimina</button>
            </div>
        </div>
    `).join('');

    container.querySelectorAll('[data-admin-delete-ann]').forEach(btn => {
        btn.addEventListener('click', () => adminDeleteAnnuncio(btn.getAttribute('data-admin-delete-ann')));
    });
}

async function adminPublishAnnuncio() {
    assertAdmin();
    const title = document.getElementById('admin-ann-title')?.value?.trim();
    const content = document.getElementById('admin-ann-content')?.value?.trim();
    const gameVersion = document.getElementById('admin-ann-version')?.value?.trim()
        || global.AnnouncementsUI?.defaultGameVersion?.()
        || global.AdminConfig?.GAME_VERSION
        || '1.0.0';
    const bold = !!document.getElementById('admin-ann-bold')?.checked;
    const fontSize = document.getElementById('admin-ann-size')?.value || 'md';

    if (!title || !content) {
        alert('Titolo e contenuto sono obbligatori.');
        return;
    }

    try {
        await ctx.addDoc(ctx.collection(adminDb(), 'annunci'), {
            title,
            content,
            gameVersion,
            bold,
            fontSize: ['sm', 'md', 'lg'].includes(fontSize) ? fontSize : 'md',
            createdAt: new Date().toISOString(),
            authorUid: ctx.auth.currentUser.uid
        });
        document.getElementById('admin-ann-title').value = '';
        document.getElementById('admin-ann-content').value = '';
        document.getElementById('admin-ann-bold').checked = false;
        document.getElementById('admin-ann-size').value = 'md';
        ctx.playSynth?.('bloop');
        ctx.showSuccessAnnouncePopup?.('Annuncio pubblicato con successo');
    } catch (error) {
        alert('Errore pubblicazione: ' + error.message);
    }
}

async function adminDeleteAnnuncio(annuncioId) {
    assertAdmin();
    if (!annuncioId) return;

    const confirmed = await ctx.showConfirmAnnouncePopup?.('Eliminare questo annuncio?');
    if (!confirmed) return;

    try {
        await ctx.deleteDoc(ctx.doc(adminDb(), 'annunci', annuncioId));
        ctx.playSynth?.('pop');
        ctx.showSuccessAnnouncePopup?.('Annuncio eliminato con successo');
    } catch (error) {
        alert('Errore eliminazione: ' + error.message);
    }
}

function renderAdminSecurityEvents() {
    const container = document.getElementById('admin-security-list');
    const search = (document.getElementById('admin-security-search')?.value || '').trim().toLowerCase();
    if (!container) return;

    const events = cacheSecurityEvents.filter(ev => {
        if (!search) return true;
        const blob = `${ev.uid} ${ev.nickname} ${ev.type} ${ev.message} ${ev.severity}`.toLowerCase();
        return blob.includes(search);
    });

    if (!events.length) {
        container.innerHTML = `<div class="text-center text-slate-500 text-sm font-bold p-4">Nessun evento sospetto</div>`;
        return;
    }

    container.innerHTML = events.slice(0, 80).map(ev => {
        const colore = ev.severity === 'high' ? 'text-red-400 border-red-900/50'
            : ev.severity === 'medium' ? 'text-amber-300 border-amber-900/40'
                : 'text-slate-400 border-slate-800';
        return `
            <div class="bg-black/40 border rounded-2xl p-3 ${colore}">
                <div class="text-xs font-black uppercase">${escapeHtml(ev.type || 'evento')} • ${escapeHtml(ev.severity || 'low')}</div>
                <div class="text-[10px] text-slate-500 mt-1">${escapeHtml(ev.nickname || '')} • ${escapeHtml(ev.uid || '')}</div>
                <div class="text-[11px] mt-2">${escapeHtml(ev.message || '')}</div>
                <div class="text-[9px] text-slate-600 mt-1">${escapeHtml(new Date(ev.createdAt || Date.now()).toLocaleString('it-IT'))}</div>
            </div>`;
    }).join('');
}

function stopRealtimeListeners() {
    unsubLobbies?.();
    unsubUsers?.();
    unsubBans?.();
    unsubSecurity?.();
    unsubAnnunci?.();
    unsubLobbies = unsubUsers = unsubBans = unsubSecurity = unsubAnnunci = null;
}

function openAdminPanel() {
    if (!isCurrentUserAdmin()) {
        alert('Accesso negato.');
        return;
    }
    if (!ctx?.openModal) {
        alert('Pannello admin non inizializzato. Ricarica la pagina.');
        return;
    }
    const versionInput = document.getElementById('admin-ann-version');
    if (versionInput && !versionInput.value) {
        versionInput.placeholder = global.AnnouncementsUI?.defaultGameVersion?.()
            || global.AdminConfig?.GAME_VERSION
            || '1.0.0';
    }
    switchAdminTab('lobbies', { animate: false });
    try {
        ctx.openModal('modal-admin-panel');
    } catch (err) {
        console.error('[ADMIN] openModal:', err);
        alert('Impossibile aprire il pannello admin.');
        return;
    }
    try {
        startRealtimeListeners();
    } catch (err) {
        console.error('[ADMIN] listeners:', err);
        alert('Pannello aperto, ma alcuni dati live non si sono caricati. Controlla la console.');
    }
}

function closeAdminPanel() {
    stopRealtimeListeners();
}

function initAdminPanel(context) {
    ctx = context;
    updateAdminButtonVisibility();

    if (adminInitialized) {
        return;
    }
    adminInitialized = true;

    document.getElementById('btn-admin-panel')?.addEventListener('click', () => {
        if (!isCurrentUserAdmin()) {
            alert('Accesso negato.');
            return;
        }
        openAdminPanel();
    });

    document.querySelectorAll('[data-admin-tab]').forEach(btn => {
        btn.addEventListener('click', () => switchAdminTab(btn.getAttribute('data-admin-tab')));
    });

    document.getElementById('admin-lobbies-search')?.addEventListener('input', renderAdminLobbies);
    document.getElementById('admin-gives-search')?.addEventListener('input', renderAdminUsers);
    document.getElementById('admin-ban-search')?.addEventListener('input', renderAdminBanList);
    document.getElementById('admin-ban-pick-search')?.addEventListener('input', renderBanPickList);
    document.getElementById('admin-security-search')?.addEventListener('input', renderAdminSecurityEvents);

    document.getElementById('admin-lobbies-list')?.addEventListener('click', (e) => {
        const row = e.target.closest('[data-admin-open-lobby]');
        if (!row) return;
        e.preventDefault();
        e.stopPropagation();
        openAdminLobbyDetail(row.getAttribute('data-admin-open-lobby'));
    });

    document.getElementById('admin-btn-delete-lobby')?.addEventListener('click', adminDeleteLobby);
    document.getElementById('admin-btn-join-lobby')?.addEventListener('click', adminJoinLobby);
    document.getElementById('admin-btn-give-xp')?.addEventListener('click', adminGiveXp);

    document.getElementById('admin-btn-ban-user')?.addEventListener('click', () => {
        renderBanPickList();
        ctx.openModal('modal-admin-ban-pick');
    });

    document.getElementById('admin-btn-confirm-ban')?.addEventListener('click', adminExecuteBan);
    document.getElementById('admin-btn-unban')?.addEventListener('click', adminUnban);
    document.getElementById('admin-btn-publish-ann')?.addEventListener('click', adminPublishAnnuncio);
}

global.AdminPanel = {
    initAdminPanel,
    updateAdminButtonVisibility,
    closeAdminPanel,
    isCurrentUserAdmin
};
})(window);
