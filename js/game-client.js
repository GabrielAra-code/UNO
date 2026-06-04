(function (global) {
    const Engine = global.GameEngine;
    const Deck = global.GameDeck;
    const FS = global.GameFirestore;
    const Sounds = global.GameSounds;

    let lobbyId = null;
    let myPlayerId = null;
    let gameState = null;
    let prevGameState = null;
    let unsubGame = null;
    let returnTimer = null;
    let lastRouletteAnimatedAt = null;
    let rouletteHideTimer = null;

    const currentUser = JSON.parse(localStorage.getItem('unoCurrentUser') || '{"nickname":"Giocatore","avatar":"🦊"}');

    function $(id) {
        return document.getElementById(id);
    }

    function playSound(type) {
        Sounds?.play?.(type);
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

    function reactToStateChanges(oldState, newState) {
        if (!oldState || !newState) return;

        const oldLog = oldState.log?.length || 0;
        const newLog = newState.log?.length || 0;
        if (newLog > oldLog) {
            const msg = newState.log[newLog - 1]?.msg || '';
            if (msg.includes('UNO!')) playSound('uno');
            else if (msg.includes('non ha detto UNO')) playSound('penalty');
            else if (msg.includes('Proiettile colpisce')) playSound('shot');
            else if (msg.includes('pesca')) playSound('draw');
            else if (msg.includes('gioca')) playSound(msg.includes('×') ? 'cards' : 'card');
            else if (msg.includes('vinto')) playSound('win');
        }

        const oldTurn = Engine.currentPlayerId(oldState);
        const newTurn = Engine.currentPlayerId(newState);
        if (oldTurn !== newTurn && newState.status === 'playing' && newTurn === myPlayerId) {
            playSound('turn');
        }

        const oldPending = oldState.pendingAction;
        const newPending = newState.pendingAction;
        if (newPending?.type === 'bulletRoulette' && !newPending.spun
            && (!oldPending || oldPending.type !== 'bulletRoulette')) {
            playSound('roulette');
            showBulletRouletteWaiting(newPending);
        }

        const lr = newState.lastRoulette;
        if (lr?.at && lr.at !== lastRouletteAnimatedAt) {
            animateBulletRouletteSpin(lr);
        }
    }

    function buildWheelSegments(segments) {
        const wheel = $('roulette-wheel');
        const labels = $('roulette-labels');
        if (!wheel || !labels) return;
        const n = segments.length;
        if (!n) return;
        const colors = ['#dc2626', '#2563eb', '#16a34a', '#ca8a04', '#9333ea', '#0891b2'];
        const stops = segments.map((seg, i) => {
            const c = colors[i % colors.length];
            const start = (i / n) * 100;
            const end = ((i + 1) / n) * 100;
            return `${c} ${start}% ${end}%`;
        }).join(', ');
        wheel.style.background = `conic-gradient(from -90deg, ${stops})`;
        wheel.style.transform = 'rotate(0deg)';
        labels.innerHTML = '';
        segments.forEach((seg, i) => {
            const angle = (i / n) * 360 + 360 / n / 2 - 90;
            const el = document.createElement('span');
            el.className = 'roulette-label';
            el.textContent = seg.nickname || seg.id;
            el.style.transform = `rotate(${angle}deg) translateY(-95px) rotate(${-angle}deg)`;
            labels.appendChild(el);
        });
    }

    function showBulletRouletteWaiting(pending) {
        const overlay = $('bullet-roulette-overlay');
        const btn = $('roulette-spin-btn');
        const hint = $('roulette-hint');
        const result = $('roulette-result');
        if (!overlay) return;

        buildWheelSegments(pending.segments || []);
        if (result) result.textContent = '';
        const canSpin = pending.shooterId === myPlayerId;
        if (btn) {
            btn.disabled = !canSpin;
            btn.textContent = canSpin ? 'Gira la ruota' : 'In attesa del tiratore…';
        }
        if (hint) {
            const shooter = gameState?.players?.[pending.shooterId]?.nickname || '—';
            hint.textContent = canSpin
                ? 'Clicca per girare la roulette!'
                : `${shooter} deve girare la ruota`;
        }

        overlay.classList.remove('hidden');
        requestAnimationFrame(() => overlay.classList.add('active'));

        if (!btn?.dataset.wired) {
            btn.dataset.wired = '1';
            btn.addEventListener('click', async () => {
                if (!gameState?.pendingAction || gameState.pendingAction.type !== 'bulletRoulette') return;
                if (gameState.pendingAction.shooterId !== myPlayerId) return;
                playSound('click');
                btn.disabled = true;
                await commitAction(() => Engine.spinBulletRoulette(gameState, myPlayerId));
            });
        }
    }

    function animateBulletRouletteSpin(lr) {
        lastRouletteAnimatedAt = lr.at;
        const overlay = $('bullet-roulette-overlay');
        const wheel = $('roulette-wheel');
        const btn = $('roulette-spin-btn');
        const result = $('roulette-result');
        if (!overlay || !wheel) return;

        buildWheelSegments(lr.segments || []);
        overlay.classList.remove('hidden');
        overlay.classList.add('active');
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Gira…';
        }

        wheel.style.transition = 'none';
        wheel.style.transform = 'rotate(0deg)';
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                wheel.style.transition = 'transform 4.5s cubic-bezier(0.12, 0.8, 0.2, 1)';
                wheel.style.transform = `rotate(${lr.spinDeg}deg)`;
                playSound('roulette');
            });
        });

        const hitName = gameState?.players?.[lr.hitId]?.nickname || lr.hitId;
        if (result) result.textContent = '';

        clearTimeout(rouletteHideTimer);
        rouletteHideTimer = setTimeout(() => {
            if (result) result.textContent = `💥 Colpito: ${hitName}!`;
            playSound('shot');
            rouletteHideTimer = setTimeout(() => {
                overlay.classList.remove('active');
                setTimeout(() => overlay.classList.add('hidden'), 500);
            }, 2200);
        }, 4600);
    }

    function hideBulletRouletteIfIdle() {
        const pending = gameState?.pendingAction;
        if (pending?.type === 'bulletRoulette' && !pending.spun) return;
        if (gameState?.lastRoulette?.at === lastRouletteAnimatedAt) return;
        $('bullet-roulette-overlay')?.classList.remove('active');
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
        const stackCounts = {};

        hand.forEach(card => {
            if (Engine.canPlayCard(gameState, card) && card.kind === 'number') {
                const k = Engine.cardStackKey(card);
                stackCounts[k] = (stackCounts[k] || 0) + 1;
            }
        });

        hand.forEach(card => {
            const btn = document.createElement('button');
            const playable = canPlay && Engine.canPlayCard(gameState, card) && Engine.isMyTurn(gameState, myPlayerId);
            const key = Engine.cardStackKey(card);
            const stackSize = stackCounts[key] || 1;
            const showStack = playable && stackSize > 1 && card.kind === 'number';

            btn.type = 'button';
            btn.className = `hand-card ${Deck.colorStyle(card)} ${playable ? '' : 'hand-card-disabled'}`;
            btn.innerHTML = `<span class="hand-label">${card.label}${showStack ? `<small class="block text-[9px] opacity-80">×${stackSize}</small>` : ''}</span>`;
            if (playable) {
                btn.addEventListener('click', () => onPlayCard(card.instanceId));
            }
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
        const pending = gameState.pendingAction;
        if (pending?.type === 'bulletRoulette' && !pending.spun) {
            el.classList.remove('hidden');
            el.textContent = pending.shooterId === myPlayerId
                ? 'Gira la roulette!'
                : 'Roulette in corso…';
            el.classList.toggle('animate-pulse', pending.shooterId === myPlayerId);
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

    function playResultSound(result) {
        const lastMsg = result.state?.log?.[result.state.log.length - 1]?.msg || '';
        if (result.outcome === 'win') playSound('win');
        else if (result.outcome === 'penalty') playSound('penalty');
        else if (lastMsg.includes('UNO!')) playSound('uno');
        else if (lastMsg.includes('pesca')) playSound('draw');
        else if (result.cardsPlayed > 1) playSound('cards');
        else if (lastMsg.includes('gioca')) playSound('card');
    }

    async function commitAction(fn, opts = {}) {
        if (!gameState) return;
        const result = fn();
        if (!result.ok) {
            playSound('error');
            showToast(result.error || 'Mossa non valida');
            return;
        }
        try {
            await FS.persistState(lobbyId, result.state);
            prevGameState = gameState;
            gameState = result.state;
            if (!opts.quiet) playResultSound(result);
            if (result.state.lastRoulette?.at !== lastRouletteAnimatedAt) {
                animateBulletRouletteSpin(result.state.lastRoulette);
            }
            renderAll();
            handlePending(result.state);
        } catch (err) {
            console.error(err);
            playSound('error');
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
        if (state.pendingAction?.type === 'bulletRoulette' && !state.pendingAction.spun) {
            showBulletRouletteWaiting(state.pendingAction);
        }
    }

    async function onPlayCard(instanceId) {
        const matching = Engine.getMatchingPlayableCards(gameState, myPlayerId, instanceId);
        const instanceIds = matching.map(c => c.instanceId);
        const card = matching[0];
        if (!card) return;

        playSound('click');

        if (card.value === 'wild' || card.value === 'wild4') {
            showColorModal(instanceIds[0]);
            return;
        }
        if (['death', 'swap', 'gift', 'heart', 'communism', 'blobby'].includes(card.value)) {
            showTargetModal(instanceIds[0], card.value);
            return;
        }
        if (card.value === 'bullet') {
            await commitAction(() => Engine.playCards(gameState, myPlayerId, instanceIds, {}));
            return;
        }

        await commitAction(() => Engine.playCards(gameState, myPlayerId, instanceIds, {}));
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
                playSound('click');
                if (pendingCardId) {
                    await commitAction(() =>
                        Engine.playCards(gameState, myPlayerId, [pendingCardId], { chosenColor: color })
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
                playSound('click');
                if (pendingCardId) {
                    await commitAction(() => Engine.playCards(gameState, myPlayerId, [pendingCardId], { targetId: id }));
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
                playSound('error');
                showToast('Non è il tuo turno');
                return;
            }
            playSound('click');
            await commitAction(() => Engine.drawCard(gameState, myPlayerId));
        });
        $('btn-uno')?.addEventListener('click', async () => {
            playSound('click');
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
            reactToStateChanges(gameState, pub);
            prevGameState = gameState;
            gameState = pub;
            renderAll();
            if (pub.pendingAction?.playerId === myPlayerId) {
                handlePending(pub);
            }
            if (pub.pendingAction?.type === 'bulletRoulette' && !pub.pendingAction.spun) {
                showBulletRouletteWaiting(pub.pendingAction);
            }
            hideBulletRouletteIfIdle();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => init());
    } else {
        init();
    }
})(window);
