(function (global) {
    const Engine = global.GameEngine;
    const Deck = global.GameDeck;
    const FS = global.GameFirestore;

    let lobbyId = null;
    let myPlayerId = null;
    let gameState = null;
    let unsubGame = null;
    let returnTimer = null;

    const currentUser = JSON.parse(localStorage.getItem('unoCurrentUser') || '{"nickname":"Giocatore","avatar":"🦊"}');

    function $(id) {
        return document.getElementById(id);
    }

    function formatDuration(ms) {
        if (!ms || ms < 0) return '—';
        const s = Math.floor(ms / 1000);
        const m = Math.floor(s / 60);
        const r = s % 60;
        return m > 0 ? `${m}m ${r}s` : `${r}s`;
    }

    function myHand() {
        return gameState?.hands?.[myPlayerId] || [];
    }

    function resolveMyPlayerId(lobby) {
        const uid = currentUser.uid || null;
        const players = lobby?.players || [];
        if (uid) {
            const p = players.find(x => x.uid === uid);
            if (p) return Engine.playerKey(p);
        }
        const nick = (currentUser.nickname || '').trim();
        const byNick = players.find(x => x.nickname === nick);
        if (byNick) return Engine.playerKey(byNick);
        return uid || nick || 'local';
    }

    function renderDirection() {
        const dir = gameState?.direction > 0 ? 'Oraria ↻' : 'Antioraria ↺';
        const el = $('game-direction');
        if (el) el.textContent = dir;
        $('table-direction-ring')?.classList.toggle('dir-ccw', gameState?.direction < 0);
    }

    function renderSeats() {
        const container = $('table-seats');
        if (!container || !gameState) return;
        container.innerHTML = '';
        const order = gameState.turnOrder || [];
        const n = order.length;
        const current = Engine.currentPlayerId(gameState);

        order.forEach((id, i) => {
            const p = gameState.players[id] || {};
            const angle = (i / n) * 360 - 90;
            const seat = document.createElement('div');
            seat.className = 'table-seat';
            seat.style.setProperty('--angle', `${angle}deg`);
            const isMe = id === myPlayerId;
            const isTurn = id === current && gameState.status === 'playing';
            seat.innerHTML = `
                <div class="seat-inner ${isTurn ? 'seat-turn' : ''} ${p.eliminated ? 'seat-out' : ''}">
                    <div class="seat-avatar">${p.avatar || '🦊'}</div>
                    <div class="seat-name">${isMe ? 'Tu' : (p.nickname || id)}</div>
                    <div class="seat-meta">${p.handCount ?? 0} carte${p.eliminated ? ' · OUT' : ''}</div>
                    ${gameState.settings?.pistolHp ? `<div class="seat-hp">💥 ${p.pistolHp ?? 0}/${p.maxPistolHp ?? 3}</div>` : ''}
                </div>
            `;
            container.appendChild(seat);
        });
    }

    function renderCenter() {
        const top = gameState?.topCard;
        const discard = $('deck-discard');
        const count = $('draw-count');
        if (count) count.textContent = String(gameState?.drawPile?.length ?? 0);
        if (discard && top) {
            discard.className = `pile-card ${Deck.colorStyle(top)}`;
            discard.innerHTML = `
                <span class="pile-corner">${top.label}</span>
                <span class="pile-center">${top.label}</span>
                <span class="pile-corner br">${top.label}</span>
            `;
        }
        const colorHint = $('active-color-hint');
        if (colorHint) {
            const c = Deck.COLOR_LABEL[gameState?.activeColor] || gameState?.activeColor || '—';
            colorHint.textContent = gameState?.forcedColor ? `Vincolo: ${c}` : `Colore: ${c}`;
            colorHint.className = `color-hint color-${gameState?.activeColor || 'slate'}`;
        }
        const stackEl = $('stack-alert');
        if (stackEl) {
            if (gameState?.drawStack > 0) {
                stackEl.classList.remove('hidden');
                stackEl.textContent = `Stack +${gameState.drawStack} — gioca +2/+4 o pesca`;
            } else {
                stackEl.classList.add('hidden');
            }
        }
    }

    function renderHand() {
        const handEl = $('my-hand');
        if (!handEl) return;
        handEl.innerHTML = '';
        const canPlay = gameState?.status === 'playing';
        const hand = myHand();

        hand.forEach(card => {
            const btn = document.createElement('button');
            const playable = canPlay && Engine.canPlayCard(gameState, card) && Engine.isMyTurn(gameState, myPlayerId);
            btn.type = 'button';
            btn.className = `hand-card ${Deck.colorStyle(card)} ${playable ? '' : 'hand-card-disabled'}`;
            btn.innerHTML = `<span class="hand-label">${card.label}</span>`;
            if (playable) btn.addEventListener('click', () => onPlayCard(card.instanceId));
            handEl.appendChild(btn);
        });
    }

    function renderTurnBanner() {
        const el = $('turn-alert');
        if (!el || !gameState) return;
        if (gameState.status !== 'playing') {
            el.classList.add('hidden');
            return;
        }
        el.classList.remove('hidden');
        const cur = Engine.currentPlayerId(gameState);
        const name = cur === myPlayerId ? 'Tu' : (gameState.players[cur]?.nickname || '—');
        el.textContent = Engine.isMyTurn(gameState, myPlayerId) ? 'È il tuo turno!' : `Turno di: ${name}`;
        el.classList.toggle('animate-pulse', cur === myPlayerId);
    }

    function renderLog() {
        const log = $('game-log-mini');
        if (!log || !gameState?.log) return;
        log.innerHTML = gameState.log.slice(-6).map(e => `<p class="log-line">${e.msg}</p>`).join('');
    }

    function renderEndScreen() {
        if (gameState?.status !== 'finished') {
            $('end-overlay')?.classList.add('hidden');
            return;
        }
        $('end-overlay')?.classList.remove('hidden');
        $('end-title').textContent = gameState.winnerId === myPlayerId
            ? 'Hai vinto!'
            : `${gameState.winnerName || '—'} vince!`;
        $('end-duration').textContent = `Durata partita: ${formatDuration(gameState.durationMs)}`;
        if (returnTimer) clearTimeout(returnTimer);
        returnTimer = setTimeout(async () => {
            try {
                await FS.returnLobbyToWaiting(lobbyId);
            } catch (e) {
                console.error(e);
            }
            const list = JSON.parse(localStorage.getItem('unoLobbyList') || '[]');
            const idx = list.findIndex(r => r.id === lobbyId);
            if (idx !== -1) list[idx].status = 'waiting';
            localStorage.setItem('unoLobbyList', JSON.stringify(list));
            window.location.href = `waiting_room.html?stanzaId=${encodeURIComponent(lobbyId)}`;
        }, 5000);
    }

    function renderAll() {
        renderDirection();
        renderSeats();
        renderCenter();
        renderHand();
        renderTurnBanner();
        renderLog();
        renderEndScreen();
    }

    function showToast(msg) {
        const t = $('game-toast');
        if (!t) return;
        t.textContent = msg;
        t.classList.remove('hidden');
        setTimeout(() => t.classList.add('hidden'), 2800);
    }

    async function commitAction(fn) {
        if (!gameState) return;
        const result = fn();
        if (!result.ok) {
            showToast(result.error || 'Mossa non valida');
            return;
        }
        try {
            await FS.persistState(lobbyId, result.state);
            gameState = result.state;
            renderAll();
            handlePending(result.state);
        } catch (err) {
            console.error(err);
            showToast('Errore salvataggio mossa');
        }
    }

    function handlePending(state) {
        if (state.pendingAction?.type === 'chooseColor' && state.pendingAction.playerId === myPlayerId) {
            showColorModal(null);
        }
        if (state.pendingAction?.type === 'chooseTarget' && state.pendingAction.playerId === myPlayerId) {
            showTargetModal(null, state.pendingAction.effect);
        }
    }

    async function onPlayCard(instanceId) {
        const card = myHand().find(c => c.instanceId === instanceId);
        if (!card) return;

        if (card.value === 'wild' || card.value === 'wild4') {
            showColorModal(instanceId);
            return;
        }
        if (['death', 'swap', 'gift', 'heart', 'communism', 'blobby'].includes(card.value)) {
            showTargetModal(instanceId, card.value);
            return;
        }
        await commitAction(() => Engine.playCard(gameState, myPlayerId, instanceId, {}));
    }

    function showColorModal(pendingCardId) {
        const modal = $('game-modal');
        const content = $('modal-content');
        $('modal-title').textContent = 'Scegli colore';
        $('modal-description').textContent = 'Quale colore vuoi imporre?';
        content.innerHTML = '';
        Deck.COLORS.forEach(color => {
            const b = document.createElement('button');
            b.className = `modal-color-btn color-${color}`;
            b.textContent = Deck.COLOR_LABEL[color];
            b.onclick = async () => {
                modal.classList.add('hidden');
                if (pendingCardId) {
                    await commitAction(() =>
                        Engine.playCard(gameState, myPlayerId, pendingCardId, { chosenColor: color })
                    );
                } else {
                    await commitAction(() => Engine.chooseColor(gameState, myPlayerId, color));
                }
            };
            content.appendChild(b);
        });
        modal.classList.remove('hidden');
    }

    function showTargetModal(pendingCardId, effect) {
        const modal = $('game-modal');
        const content = $('modal-content');
        $('modal-title').textContent = 'Scegli bersaglio';
        $('modal-description').textContent = 'Seleziona un giocatore';
        content.innerHTML = '';
        (gameState.turnOrder || []).forEach(id => {
            if (id === myPlayerId) return;
            const p = gameState.players[id];
            if (p?.eliminated) return;
            const b = document.createElement('button');
            b.className = 'modal-target-btn';
            b.textContent = p.nickname || id;
            b.onclick = async () => {
                modal.classList.add('hidden');
                if (pendingCardId) {
                    await commitAction(() => Engine.playCard(gameState, myPlayerId, pendingCardId, { targetId: id }));
                } else {
                    await commitAction(() => Engine.chooseTarget(gameState, myPlayerId, id));
                }
            };
            content.appendChild(b);
        });
        modal.classList.remove('hidden');
    }

    function wireControls() {
        $('deck-draw')?.addEventListener('click', async () => {
            if (!Engine.isMyTurn(gameState, myPlayerId)) {
                showToast('Non è il tuo turno');
                return;
            }
            await commitAction(() => Engine.drawCard(gameState, myPlayerId));
        });
        $('btn-uno')?.addEventListener('click', async () => {
            await commitAction(() => Engine.declareUno(gameState, myPlayerId));
        });
        $('btn-leave')?.addEventListener('click', () => {
            if (confirm('Uscire dalla partita?')) {
                window.location.href = `waiting_room.html?stanzaId=${encodeURIComponent(lobbyId)}`;
            }
        });
    }

    async function init() {
        const params = new URLSearchParams(window.location.search);
        lobbyId = params.get('stanzaId');
        if (!lobbyId) {
            alert('Stanza non valida.');
            window.location.href = 'Menu_principale.html';
            return;
        }

        const ok = await FS.waitForFirebase();
        if (!ok) {
            alert('Firebase non pronto. Ricarica la pagina.');
            return;
        }

        const lobby = JSON.parse(localStorage.getItem('unoLobbyList') || '[]').find(r => r.id === lobbyId);
        myPlayerId = resolveMyPlayerId(lobby);
        wireControls();

        unsubGame = FS.subscribeGame(lobbyId, pub => {
            if (!pub) {
                showToast('Partita non trovata');
                setTimeout(() => {
                    window.location.href = `waiting_room.html?stanzaId=${encodeURIComponent(lobbyId)}`;
                }, 2000);
                return;
            }
            gameState = pub;
            renderAll();
            if (pub.pendingAction?.playerId === myPlayerId) {
                handlePending(pub);
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => init());
    } else {
        init();
    }
})(window);
