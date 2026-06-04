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
    let counterResolveTimer = null;
    let counterTickTimer = null;
    let counterWindowKey = null;

    function leftGameKey(id) {
        return `unoLeftGame_${id}`;
    }

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

    function cardLabel(card) {
        return card?.righelloLabel || card?.label || '—';
    }

    let rewardsGranted = false;

    async function grantWinRewards() {
        if (rewardsGranted || gameState?.winnerId !== myPlayerId) return;
        const uid = currentUser.uid;
        if (!uid || !window.db || !window.updateDoc || !window.getDoc || !window.doc) return;
        rewardsGranted = true;
        try {
            const ref = window.doc(window.db, 'utenti', uid);
            const snap = await window.getDoc(ref);
            const data = snap.exists() ? snap.data() : {};
            const xpGain = 50;
            await window.updateDoc(ref, {
                xp: (data.xp || 0) + xpGain,
                vittorie: (data.vittorie || 0) + 1,
                partiteGiocate: (data.partiteGiocate || 0) + 1
            });
            const el = $('end-rewards');
            if (el) el.textContent = `+${xpGain} XP · Vittoria registrata`;
        } catch (err) {
            console.error('Ricompense vittoria:', err);
        }
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

        if (newPending?.type === 'counterWindow'
            && (!oldPending || oldPending.startedAt !== newPending.startedAt)) {
            playSound('turn');
            scheduleCounterWindow(newPending);
        }
    }

    function firstCounterCard() {
        const hand = myHand();
        return hand.find(c => Engine.canPlayCounter(gameState, myPlayerId, c));
    }

    function clearCounterTimers() {
        clearTimeout(counterResolveTimer);
        clearInterval(counterTickTimer);
        counterResolveTimer = null;
        counterTickTimer = null;
        counterWindowKey = null;
    }

    function scheduleCounterWindow(pending) {
        const key = `${pending.startedAt}-${pending.cardValue}`;
        if (counterWindowKey === key && counterResolveTimer) {
            renderCounterOverlay(pending);
            return;
        }
        clearCounterTimers();
        counterWindowKey = key;
        renderCounterOverlay(pending);

        const tick = () => {
            if (!gameState?.pendingAction || gameState.pendingAction.type !== 'counterWindow') {
                hideCounterOverlay();
                return;
            }
            const left = Math.max(0, Math.ceil((pending.resolvesAt - Date.now()) / 1000));
            const el = $('counter-timer');
            if (el) el.textContent = String(left);
            if (left <= 0) hideCounterOverlayTick();
        };
        tick();
        counterTickTimer = setInterval(tick, 200);

        const delay = Math.max(0, pending.resolvesAt - Date.now() + 80);
        counterResolveTimer = setTimeout(async () => {
            if (counterWindowKey !== key) return;
            if (!gameState?.pendingAction || gameState.pendingAction.type !== 'counterWindow') return;
            await commitAction(() => Engine.resolveCounterWindow(gameState, myPlayerId), { quiet: true });
            clearCounterTimers();
            hideCounterOverlay();
        }, delay);
    }

    function hideCounterOverlayTick() {
        const el = $('counter-timer');
        if (el) el.textContent = '0';
    }

    function hideCounterOverlay() {
        $('counter-overlay')?.classList.add('hidden');
        $('btn-contrast')?.classList.add('hidden');
    }

    function renderCounterOverlay(pending) {
        const overlay = $('counter-overlay');
        const btn = $('btn-contrast');
        if (!overlay) return;
        overlay.classList.remove('hidden');
        const canCounter = pending.sourcePlayerId !== myPlayerId && !!firstCounterCard();
        if (btn) {
            btn.classList.toggle('hidden', !canCounter);
            btn.disabled = !canCounter;
        }
    }

    function buildWheelSegments(segments) {
        const wheel = $('roulette-wheel');
        if (!wheel) return;
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
        wheel.innerHTML = '';
        segments.forEach((seg, i) => {
            const angle = (i / n) * 360 + 360 / n / 2 - 90;
            const el = document.createElement('span');
            el.className = 'roulette-label';
            el.textContent = seg.nickname || seg.id;
            el.style.transform = `rotate(${angle}deg) translateY(-95px)`;
            wheel.appendChild(el);
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
            const lbl = cardLabel(top);
            discard.className = `pile-card ${Deck.colorStyle(top)}`;
            discard.innerHTML = `
                <span class="pile-corner">${lbl}</span>
                <span class="pile-center">${lbl}</span>
                <span class="pile-corner br">${lbl}</span>
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
                const k = String(card.value);
                stackCounts[k] = (stackCounts[k] || 0) + 1;
            }
        });

        const counterActive = Engine.isCounterWindow(gameState);
        const canCounter = counterActive && gameState.pendingAction?.sourcePlayerId !== myPlayerId;

        hand.forEach(card => {
            const btn = document.createElement('button');
            const playableTurn = canPlay && Engine.canPlayCard(gameState, card) && Engine.isMyTurn(gameState, myPlayerId);
            const playableCounter = canCounter && Engine.canPlayCounter(gameState, myPlayerId, card);
            const playable = playableTurn || playableCounter;
            const stackSize = card.kind === 'number' ? (stackCounts[String(card.value)] || 1) : 1;
            const showStack = playableTurn && stackSize > 1 && card.kind === 'number';
            const lbl = cardLabel(card);

            btn.type = 'button';
            btn.className = `hand-card ${Deck.colorStyle(card)} ${playable ? '' : 'hand-card-disabled'}`;
            if (playableCounter) btn.classList.add('hand-card-counter');
            btn.innerHTML = `<span class="hand-label">${lbl}${showStack ? `<small class="block text-[9px] opacity-80">×${stackSize}</small>` : ''}</span>`;
            if (playableTurn) {
                btn.addEventListener('click', () => onPlayCard(card.instanceId));
            } else if (playableCounter) {
                btn.addEventListener('click', () => onPlayCounter(card.instanceId));
            }
            handEl.appendChild(btn);
        });
    }

    async function onPlayCounter(instanceId) {
        playSound('click');
        await commitAction(() => Engine.playCounterCard(gameState, myPlayerId, instanceId));
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
        if (pending?.type === 'counterWindow') {
            el.classList.remove('hidden');
            const src = gameState.players[pending.sourcePlayerId]?.nickname || '—';
            el.textContent = pending.sourcePlayerId === myPlayerId
                ? 'Attesa risposte al tuo effetto…'
                : `Attesa risposte… (${src})`;
            el.classList.toggle('animate-pulse', pending.sourcePlayerId !== myPlayerId && !!firstCounterCard());
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

    function renderEndTurnButton() {
        const btn = $('btn-end-turn');
        if (!btn || !gameState) return;
        const can = Engine.canEndTurn(gameState, myPlayerId);
        btn.disabled = !can;
        btn.title = can ? 'Termina il tuo turno' : 'Non puoi terminare il turno ora';
    }

    function renderUnoButton() {
        const btn = $('btn-uno');
        if (!btn || !gameState) return;
        const count = myHand().length;
        const p = gameState.players?.[myPlayerId];
        const mustCall = count === 1 && p?.unoRequired && !p?.saidUno;
        btn.classList.toggle('uno-flash', mustCall);
        btn.classList.toggle('opacity-40', count !== 1);
        btn.disabled = count !== 1;
        btn.title = count === 1
            ? (p?.saidUno ? 'UNO! già detto' : 'Premi prima di giocare l\'ultima carta!')
            : 'Disponibile con 1 carta';
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
        grantWinRewards();
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
        renderEndTurnButton();
        renderUnoButton();
        renderTurnBanner();
        if (gameState?.pendingAction?.type === 'counterWindow') {
            renderCounterOverlay(gameState.pendingAction);
        } else if (!counterResolveTimer) {
            hideCounterOverlay();
        }
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
        if (state.pendingAction?.type === 'counterWindow') {
            scheduleCounterWindow(state.pendingAction);
        }
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
        $('btn-end-turn')?.addEventListener('click', async () => {
            if (!Engine.canEndTurn(gameState, myPlayerId)) {
                playSound('error');
                showToast('Non puoi terminare il turno ora');
                return;
            }
            playSound('click');
            await commitAction(() => Engine.endTurn(gameState, myPlayerId));
        });
        $('btn-contrast')?.addEventListener('click', async () => {
            const card = firstCounterCard();
            if (!card) {
                playSound('error');
                showToast('Nessuna carta di contrasto');
                return;
            }
            await onPlayCounter(card.instanceId);
        });
        $('btn-leave')?.addEventListener('click', async () => {
            if (!confirm('Uscire dalla partita?')) return;
            await leaveGameToWaiting();
        });
    }

    async function leaveGameToWaiting() {
        sessionStorage.setItem(leftGameKey(lobbyId), '1');
        clearCounterTimers();
        if (unsubGame) {
            unsubGame();
            unsubGame = null;
        }
        try {
            if (gameState && myPlayerId) {
                await FS.leaveGameParticipant(lobbyId, myPlayerId);
            }
        } catch (err) {
            console.error('Uscita partita:', err);
        }
        const list = JSON.parse(localStorage.getItem('unoLobbyList') || '[]');
        const idx = list.findIndex(r => r.id === lobbyId);
        if (idx !== -1) {
            list[idx].status = 'waiting';
            localStorage.setItem('unoLobbyList', JSON.stringify(list));
        }
        window.location.href = `waiting_room.html?stanzaId=${encodeURIComponent(lobbyId)}`;
    }

    async function init() {
        const params = new URLSearchParams(window.location.search);
        lobbyId = params.get('stanzaId');
        if (!lobbyId) {
            alert('Stanza non valida.');
            window.location.href = 'Menu_principale.html';
            return;
        }

        if (sessionStorage.getItem(leftGameKey(lobbyId))) {
            window.location.href = `waiting_room.html?stanzaId=${encodeURIComponent(lobbyId)}`;
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
            handlePending(pub);
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
