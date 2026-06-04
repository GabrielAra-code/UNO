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
    let unsubLobby = null;
    const ADMIN_LOBBY_MSG = 'Questa lobby è stata chiusa da un amministratore.';
    let returnTimer = null;
    let lastRouletteAnimatedAt = null;
    let rouletteHideTimer = null;
    let counterResolveTimer = null;
    let counterTickTimer = null;
    let counterWindowKey = null;
    let playSelection = null;
    const AvatarUI = global.AvatarUI;

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
        if (Deck.isBrainrotCard?.(card)) {
            const pt = card.pt != null ? ` ${card.pt}PT` : '';
            return `${card.label || '—'}${pt}`;
        }
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

        if (newPending && Engine.isPendingTimedWindow(newPending)
            && (!oldPending || oldPending.startedAt !== newPending.startedAt || oldPending.type !== newPending.type)) {
            playSound('turn');
            schedulePendingWindow(newPending);
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

    function pendingWindowKey(pending) {
        return `${pending.type}-${pending.startedAt}`;
    }

    function resolvePendingWindowAction(pending) {
        switch (pending.type) {
            case 'counterWindow':
                return Engine.resolveCounterWindow(gameState, myPlayerId);
            case 'brainrotBattle':
                return Engine.resolveBrainrotBattle(gameState, myPlayerId);
            case 'drawStackWindow':
                return Engine.resolveDrawStackWindow(gameState, myPlayerId);
            case 'brainrotDiscard':
                return Engine.resolveBrainrotDiscard(gameState, pending.winnerId, []);
            default:
                return { ok: false, error: 'Finestra sconosciuta.' };
        }
    }

    function schedulePendingWindow(pending) {
        const key = pendingWindowKey(pending);
        if (counterWindowKey === key && counterResolveTimer) {
            renderPendingOverlay(pending);
            return;
        }
        clearCounterTimers();
        counterWindowKey = key;
        renderPendingOverlay(pending);

        const tick = () => {
            const cur = gameState?.pendingAction;
            if (!cur || cur.type !== pending.type || cur.startedAt !== pending.startedAt) {
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
            const cur = gameState?.pendingAction;
            if (!cur || pendingWindowKey(cur) !== key) return;
            if (cur.type === 'brainrotDiscard' && cur.winnerId === myPlayerId && playSelection?.mode === 'brainrotDiscard') {
                const ids = playSelection.ids || [];
                await commitAction(() => Engine.resolveBrainrotDiscard(gameState, myPlayerId, ids), { quiet: true });
            } else {
                await commitAction(() => resolvePendingWindowAction(cur), { quiet: true });
            }
            clearCounterTimers();
            hideCounterOverlay();
            clearPlaySelection();
        }, delay);
    }

    function scheduleCounterWindow(pending) {
        schedulePendingWindow(pending);
    }

    function hideCounterOverlayTick() {
        const el = $('counter-timer');
        if (el) el.textContent = '0';
    }

    function hideCounterOverlay() {
        $('counter-overlay')?.classList.add('hidden');
        $('btn-contrast')?.classList.add('hidden');
    }

    function renderPendingOverlay(pending) {
        const overlay = $('counter-overlay');
        const btn = $('btn-contrast');
        const title = overlay?.querySelector('p');
        if (!overlay) return;
        overlay.classList.remove('hidden');

        let canAct = false;
        let label = 'Attesa risposte…';
        if (pending.type === 'counterWindow') {
            label = 'Contrasto — 5 secondi';
            canAct = pending.sourcePlayerId !== myPlayerId && !!firstCounterCard();
        } else if (pending.type === 'brainrotBattle') {
            label = 'Brainrot Battle — gioca un Brainrot (5s)';
            canAct = Engine.canPlayBrainrotResponse(gameState, myPlayerId);
        } else if (pending.type === 'drawStackWindow') {
            label = `Stack +${pending.drawStack} — rispondi (5s)`;
            canAct = Engine.canPlayDrawStackResponse(gameState, myPlayerId, { probe: true });
        } else if (pending.type === 'brainrotDiscard') {
            label = `Scarta fino a ${pending.maxDiscard} carte numero (5s)`;
            canAct = pending.winnerId === myPlayerId;
        }
        if (title) title.textContent = label;
        if (btn) {
            btn.classList.toggle('hidden', !canAct || pending.type !== 'counterWindow');
            btn.disabled = !canAct || pending.type !== 'counterWindow';
            if (pending.type === 'brainrotDiscard' && pending.winnerId === myPlayerId) {
                btn.classList.remove('hidden');
                btn.textContent = 'Conferma scarto';
                btn.disabled = false;
            } else {
                btn.textContent = 'Contrasta';
            }
        }
    }

    function renderCounterOverlay(pending) {
        renderPendingOverlay(pending);
    }

    function firstBrainrotCard() {
        return myHand().find(c => Engine.isBrainrotCard(c) && Engine.canPlayBrainrotResponse(gameState, myPlayerId));
    }

    function firstDrawStackCard() {
        return myHand().find(c => Engine.canPlayDrawStackResponse(gameState, myPlayerId, c));
    }

    function buildWheelSegments(segments) {
        const wheel = $('roulette-wheel');
        if (!wheel) return;
        const n = segments.length;
        if (!n) return;
        const colors = ['#dc2626', '#2563eb', '#16a34a', '#ca8a04', '#9333ea', '#0891b2', '#ea580c', '#4f46e5'];
        wheel.style.background = 'transparent';
        wheel.style.transform = 'rotate(0deg)';
        wheel.innerHTML = '';

        segments.forEach((seg, i) => {
            const slice = document.createElement('div');
            slice.className = 'roulette-slice';
            slice.style.setProperty('--i', String(i));
            slice.style.setProperty('--total', String(n));
            slice.style.background = colors[i % colors.length];

            const label = document.createElement('div');
            label.className = 'roulette-slice-label';
            label.textContent = seg.nickname || seg.id;
            slice.appendChild(label);
            wheel.appendChild(slice);
        });

        const hub = document.createElement('div');
        hub.className = 'roulette-hub';
        wheel.appendChild(hub);
    }

    function seatRadiusForCount(n) {
        if (n <= 2) return 'min(34vmin, 150px)';
        if (n <= 4) return 'min(32vmin, 168px)';
        return 'min(30vmin, 178px)';
    }

    function seatAngleForPlayer(indexInOrder, total, myIndex) {
        const rel = (indexInOrder - myIndex + total) % total;
        return 90 + (rel * 360) / total;
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

        wheel.getAnimations().forEach(a => a.cancel());
        wheel.style.transform = 'rotate(0deg)';

        const anim = wheel.animate(
            [{ transform: 'rotate(0deg)' }, { transform: `rotate(${lr.spinDeg}deg)` }],
            { duration: 5600, easing: 'cubic-bezier(0.12, 0.82, 0.12, 1)', fill: 'forwards' }
        );
        playSound('roulette');

        const hitName = gameState?.players?.[lr.hitId]?.nickname || lr.hitId;
        if (result) result.textContent = '';

        anim.onfinish = () => {
            wheel.style.transform = `rotate(${lr.spinDeg}deg)`;
            if (result) result.textContent = `💥 Colpito: ${hitName}!`;
            playSound('shot');
            clearTimeout(rouletteHideTimer);
            rouletteHideTimer = setTimeout(() => {
                overlay.classList.remove('active');
                setTimeout(() => overlay.classList.add('hidden'), 500);
            }, 2400);
        };
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
        if (!n) return;
        const current = Engine.currentPlayerId(gameState);
        const found = order.indexOf(myPlayerId);
        const myIndex = found >= 0 ? found : 0;
        const radius = seatRadiusForCount(n);

        order.forEach((id, i) => {
            const p = gameState.players[id] || {};
            const angle = seatAngleForPlayer(i, n, myIndex);
            const seat = document.createElement('div');
            seat.className = 'table-seat';
            seat.style.setProperty('--angle', `${angle}deg`);
            seat.style.setProperty('--radius', radius);
            const isMe = id === myPlayerId;
            const isTurn = id === current && gameState.status === 'playing';

            const inner = document.createElement('div');
            inner.className = `seat-inner ${isTurn ? 'seat-turn' : ''} ${p.eliminated ? 'seat-out' : ''}`;

            const av = document.createElement('div');
            av.className = 'seat-avatar';
            if (AvatarUI) AvatarUI.mountAvatar(av, p.avatar);
            else av.textContent = p.avatar || '🦊';

            const name = document.createElement('div');
            name.className = 'seat-name';
            name.textContent = isMe ? 'Tu' : (p.nickname || id);

            const meta = document.createElement('div');
            meta.className = 'seat-meta';
            meta.textContent = `${p.handCount ?? 0} carte${p.eliminated ? ' · OUT' : ''}`;

            inner.appendChild(av);
            inner.appendChild(name);
            inner.appendChild(meta);
            if (gameState.settings?.pistolHp) {
                const hp = document.createElement('div');
                hp.className = 'seat-hp';
                hp.textContent = `💥 ${p.pistolHp ?? 0}/${p.maxPistolHp ?? 3}`;
                inner.appendChild(hp);
            }
            seat.appendChild(inner);
            container.appendChild(seat);
        });
    }

    function renderPlayersSidebar() {
        const list = $('game-players-list');
        if (!list || !gameState) return;
        list.innerHTML = '';
        const order = gameState.turnOrder || [];
        const current = Engine.currentPlayerId(gameState);

        order.forEach(id => {
            const p = gameState.players[id] || {};
            const row = document.createElement('div');
            row.className = `sidebar-player ${id === current && gameState.status === 'playing' ? 'sidebar-turn' : ''} ${p.eliminated ? 'opacity-50' : ''}`;

            const av = document.createElement('div');
            av.className = 'sidebar-player-avatar';
            if (AvatarUI) AvatarUI.mountAvatar(av, p.avatar);
            else av.textContent = p.avatar || '🦊';

            const info = document.createElement('div');
            const name = document.createElement('div');
            name.className = 'sidebar-player-name';
            name.textContent = id === myPlayerId ? 'Tu' : (p.nickname || id);
            const meta = document.createElement('div');
            meta.className = 'sidebar-player-meta';
            meta.textContent = `${p.handCount ?? 0} carte${p.eliminated ? ' · OUT' : ''}`;
            info.appendChild(name);
            info.appendChild(meta);

            row.appendChild(av);
            row.appendChild(info);
            list.appendChild(row);
        });
    }

    function renderDrawPile() {
        const pile = $('deck-draw');
        if (!pile || !gameState) return;
        const can = Engine.canDraw(gameState, myPlayerId);
        pile.classList.toggle('pile-draw-disabled', !can);
        pile.title = can ? 'Pesca' : 'Non puoi pescare ora';
    }

    function clearPlaySelection() {
        playSelection = null;
        $('play-selection-bar')?.classList.add('hidden');
        renderHand();
    }

    function updatePlaySelectionBar() {
        const bar = $('play-selection-bar');
        const label = $('play-selection-label');
        if (!bar || !playSelection) return;
        bar.classList.remove('hidden');
        const nums = playSelection.cards.map(c => c.value).join(' → ');
        if (label) {
            label.textContent = `Scala da 0: ${nums} (${playSelection.cards.length} carte)`;
        }
    }

    function startLadderSelection(cards) {
        playSelection = {
            mode: 'ladder',
            ids: cards.map(c => c.instanceId),
            cards
        };
        updatePlaySelectionBar();
        renderHand();
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
        if (colorHint && Engine.getDisplayColorInfo) {
            const info = Engine.getDisplayColorInfo(gameState);
            colorHint.textContent = info.label;
            colorHint.className = `color-hint color-${info.cssColor || 'slate'}`;
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

    function syncHandDockHeight() {
        if (window.innerWidth > 768) {
            document.documentElement.style.removeProperty('--game-hand-dock');
            return;
        }
        const section = document.querySelector('.uno-game .hand-section');
        if (!section) return;
        const h = Math.ceil(section.getBoundingClientRect().height);
        if (h > 0) {
            document.documentElement.style.setProperty('--game-hand-dock', `${h}px`);
        }
    }

    function applyHandLayoutSizing() {
        const handEl = $('my-hand');
        if (!handEl) return;
        const n = myHand().length;
        handEl.dataset.count = String(n);
        handEl.classList.remove('hand-size-normal', 'hand-size-many', 'hand-size-crowded');
        if (n > 14) handEl.classList.add('hand-size-crowded');
        else if (n > 9) handEl.classList.add('hand-size-many');
        else handEl.classList.add('hand-size-normal');
    }

    function renderHand() {
        const handEl = $('my-hand');
        if (!handEl) return;
        handEl.innerHTML = '';
        applyHandLayoutSizing();
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
        const brainrotBattle = Engine.isBrainrotBattle(gameState);
        const drawStackWin = Engine.isDrawStackWindow(gameState);
        const brainrotDiscard = Engine.isBrainrotDiscardPhase(gameState);
        const brainrotDiscardMine = brainrotDiscard && gameState.pendingAction?.winnerId === myPlayerId;
        const mariActive = gameState.pendingAction?.type === 'mariGreen';
        const mariMyTurn = mariActive && gameState.pendingAction?.currentId === myPlayerId;

        const selIds = new Set(playSelection?.ids || []);
        const ladderHintIds = playSelection?.mode === 'ladder'
            ? new Set(playSelection.ids)
            : null;

        if (!hand.length && gameState) {
            const empty = document.createElement('p');
            empty.className = 'hand-empty-msg';
            empty.textContent = gameState.hands?.[myPlayerId]
                ? 'Nessuna carta in mano'
                : 'In attesa della mano…';
            handEl.appendChild(empty);
        }

        hand.forEach(card => {
            const btn = document.createElement('button');
            const playableMari = mariMyTurn && Engine.canPlayMariGreen(gameState, myPlayerId, card);
            const playableTurn = canPlay
                && Engine.canPlayCardThisTurn(gameState, myPlayerId, card)
                && Engine.isMyTurn(gameState, myPlayerId)
                && !mariActive && !brainrotBattle && !drawStackWin && !brainrotDiscard;
            const playableCounter = canCounter && Engine.canPlayCounter(gameState, myPlayerId, card);
            const playableBrainrot = brainrotBattle && Engine.canPlayBrainrotResponse(gameState, myPlayerId)
                && Engine.isBrainrotCard(card);
            const playableStack = drawStackWin && Engine.canPlayDrawStackResponse(gameState, myPlayerId, card);
            const playableBrainrotDiscard = brainrotDiscardMine && Engine.canBrainrotDiscardCard(gameState, myPlayerId, card);
            const playable = playableTurn || playableCounter || playableMari || playableBrainrot
                || playableStack || playableBrainrotDiscard;
            const showBattleColor = (brainrotBattle || brainrotDiscard) && card.battleColor;
            const stackSize = card.kind === 'number' ? (stackCounts[String(card.value)] || 1) : 1;
            const showStack = playableTurn && stackSize > 1 && card.kind === 'number' && !playSelection;
            const lbl = cardLabel(card);

            btn.type = 'button';
            btn.className = `hand-card ${Deck.colorStyle(card, { battleColor: showBattleColor })} ${playable ? '' : 'hand-card-disabled'}`;
            if (playableCounter || playableBrainrot || playableStack) btn.classList.add('hand-card-counter');
            if (playableMari) btn.classList.add('hand-card-mari');
            if (selIds.has(card.instanceId)) btn.classList.add('hand-card-selected');
            else if (ladderHintIds?.has(card.instanceId)) btn.classList.add('hand-card-ladder-hint');
            btn.innerHTML = `<span class="hand-label">${lbl}${showStack ? `<small class="block text-[9px] opacity-80">×${stackSize}</small>` : ''}</span>`;
            if (playableBrainrotDiscard) {
                btn.addEventListener('click', () => onToggleBrainrotDiscard(card.instanceId));
            } else if (playableBrainrot) {
                btn.addEventListener('click', () => onPlayBrainrotResponse(card.instanceId));
            } else if (playableStack) {
                btn.addEventListener('click', () => onPlayDrawStackResponse(card.instanceId));
            } else if ((playableTurn || playableMari) && !playSelection) {
                btn.addEventListener('click', () => onPlayCard(card.instanceId));
            } else if (playableCounter) {
                btn.addEventListener('click', () => onPlayCounter(card.instanceId));
            }
            handEl.appendChild(btn);
        });
        requestAnimationFrame(() => {
            const el = $('my-hand');
            if (el && el.scrollWidth > el.clientWidth) {
                el.scrollLeft = el.scrollWidth - el.clientWidth;
            }
            syncHandDockHeight();
        });
    }

    async function onPlayCounter(instanceId) {
        playSound('click');
        await commitAction(() => Engine.playCounterCard(gameState, myPlayerId, instanceId));
    }

    async function onPlayBrainrotResponse(instanceId) {
        playSound('click');
        await commitAction(() => Engine.playBrainrotResponse(gameState, myPlayerId, instanceId));
    }

    async function onPlayDrawStackResponse(instanceId) {
        playSound('click');
        await commitAction(() => Engine.playDrawStackResponse(gameState, myPlayerId, instanceId));
    }

    function startBrainrotDiscardSelection(maxDiscard) {
        playSelection = { mode: 'brainrotDiscard', ids: [], maxDiscard };
        const bar = $('play-selection-bar');
        if (bar) bar.classList.remove('hidden');
        updateBrainrotDiscardLabel();
    }

    function updateBrainrotDiscardLabel() {
        const label = $('play-selection-label');
        if (label && playSelection?.mode === 'brainrotDiscard') {
            label.textContent = `Scarto Brainrot: ${playSelection.ids.length}/${playSelection.maxDiscard} (solo numeri)`;
        }
    }

    function onToggleBrainrotDiscard(instanceId) {
        if (!playSelection || playSelection.mode !== 'brainrotDiscard') return;
        const idx = playSelection.ids.indexOf(instanceId);
        if (idx >= 0) {
            playSelection.ids.splice(idx, 1);
        } else if (playSelection.ids.length < playSelection.maxDiscard) {
            playSelection.ids.push(instanceId);
        }
        updateBrainrotDiscardLabel();
        renderHand();
    }

    async function confirmBrainrotDiscard() {
        if (!playSelection || playSelection.mode !== 'brainrotDiscard') return;
        const ids = [...playSelection.ids];
        clearPlaySelection();
        playSound('cards');
        await commitAction(() => Engine.resolveBrainrotDiscard(gameState, myPlayerId, ids));
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
        if (pending?.type === 'brainrotBattle') {
            el.classList.remove('hidden');
            el.textContent = Engine.canPlayBrainrotResponse(gameState, myPlayerId)
                ? 'Brainrot Battle: gioca un Brainrot!'
                : 'Brainrot Battle in corso…';
            el.classList.toggle('animate-pulse', Engine.canPlayBrainrotResponse(gameState, myPlayerId));
            return;
        }
        if (pending?.type === 'drawStackWindow') {
            el.classList.remove('hidden');
            const def = gameState.players[pending.defenderId]?.nickname || '—';
            el.textContent = pending.defenderId === myPlayerId
                ? `Devi rispondere allo stack +${pending.drawStack}!`
                : `Stack +${pending.drawStack} su ${def}`;
            el.classList.toggle('animate-pulse', Engine.canPlayDrawStackResponse(gameState, myPlayerId, { probe: true }));
            return;
        }
        if (pending?.type === 'brainrotDiscard') {
            el.classList.remove('hidden');
            el.textContent = pending.winnerId === myPlayerId
                ? `Vittoria Brainrot: scarta fino a ${pending.maxDiscard} carte numero`
                : 'Scarto premio Brainrot…';
            el.classList.toggle('animate-pulse', pending.winnerId === myPlayerId);
            return;
        }
        if (pending?.type === 'mariGreen') {
            el.classList.remove('hidden');
            el.textContent = pending.currentId === myPlayerId
                ? 'Marijuana: gioca una carta Verde o pesca'
                : 'Marijuana: in attesa degli altri…';
            el.classList.toggle('animate-pulse', pending.currentId === myPlayerId);
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
        renderPlayersSidebar();
        renderCenter();
        renderDrawPile();
        renderHand();
        renderEndTurnButton();
        renderUnoButton();
        renderTurnBanner();
        const pa = gameState?.pendingAction;
        if (pa && Engine.isPendingTimedWindow(pa)) {
            renderPendingOverlay(pa);
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
            clearPlaySelection();
            renderAll();
            handlePending(result.state);
        } catch (err) {
            console.error(err);
            playSound('error');
            showToast('Errore salvataggio mossa');
        }
    }

    function handlePending(state) {
        if (state.pendingAction && Engine.isPendingTimedWindow(state.pendingAction)) {
            schedulePendingWindow(state.pendingAction);
        }
        if (state.pendingAction?.type === 'brainrotDiscard' && state.pendingAction.winnerId === myPlayerId) {
            startBrainrotDiscardSelection(state.pendingAction.maxDiscard);
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

    async function onPlayMariCard(instanceId) {
        playSound('click');
        await commitAction(() => Engine.playMariGreenCard(gameState, myPlayerId, instanceId));
    }

    async function onPlayCard(instanceId) {
        const hand = myHand();
        const card = hand.find(c => c.instanceId === instanceId);
        if (!card) return;

        playSound('click');

        if (gameState.pendingAction?.type === 'mariGreen') {
            await onPlayMariCard(instanceId);
            return;
        }

        const ladder = Engine.getLadderPlay(gameState, myPlayerId, instanceId);
        if (ladder.length > 1 && Engine.isValidLadder(ladder)) {
            startLadderSelection(ladder);
            return;
        }

        const instanceIds = [instanceId];

        if (card.value === 'wild' || card.value === 'wild4') {
            showColorModal(instanceId);
            return;
        }
        if (card.value === 'heart') {
            if (!Engine.eliminatedPlayerIds(gameState).length) {
                playSound('error');
                showToast('Nessun giocatore eliminato da rianimare');
                return;
            }
            showTargetModal(instanceId, 'heart');
            return;
        }
        if (['death', 'swap', 'gift', 'communism', 'blobby'].includes(card.value)) {
            showTargetModal(instanceId, card.value);
            return;
        }

        await commitAction(() => Engine.playCards(gameState, myPlayerId, instanceIds, {}));
    }

    async function confirmLadderPlay() {
        if (!playSelection || playSelection.mode !== 'ladder') return;
        const ids = playSelection.ids;
        clearPlaySelection();
        playSound('cards');
        await commitAction(() => Engine.playCards(gameState, myPlayerId, ids, {}));
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
        const isHeart = effect === 'heart';
        $('modal-title').textContent = isHeart ? 'Cuore — Rianima' : 'Scegli bersaglio';
        $('modal-description').textContent = isHeart
            ? 'Scegli un giocatore eliminato da riportare in partita'
            : 'Seleziona un giocatore';
        content.innerHTML = '';

        const targets = [];
        (gameState.turnOrder || []).forEach(id => {
            const p = gameState.players[id];
            if (isHeart) {
                if (!p?.eliminated) return;
            } else {
                if (id === myPlayerId) return;
                if (p?.eliminated) return;
            }
            targets.push({ id, nickname: p?.nickname || id });
        });

        if (!targets.length) {
            const empty = document.createElement('p');
            empty.className = 'text-sm text-slate-400 text-center py-2';
            empty.textContent = isHeart
                ? 'Nessun giocatore eliminato da rianimare.'
                : 'Nessun bersaglio disponibile.';
            content.appendChild(empty);
            const close = document.createElement('button');
            close.type = 'button';
            close.className = 'modal-target-btn';
            close.textContent = 'Chiudi';
            close.onclick = () => modal.classList.add('hidden');
            content.appendChild(close);
            modal.classList.remove('hidden');
            return;
        }

        targets.forEach(({ id, nickname }) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'modal-target-btn';
            if (isHeart) b.classList.add('modal-target-revive');
            b.textContent = isHeart ? `${nickname} (eliminato)` : nickname;
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
        const onResizeHandDock = () => syncHandDockHeight();
        window.addEventListener('resize', onResizeHandDock);
        window.addEventListener('orientationchange', () => setTimeout(onResizeHandDock, 150));

        $('deck-draw')?.addEventListener('click', async () => {
            if (!Engine.canDraw(gameState, myPlayerId)) {
                playSound('error');
                showToast('Non puoi pescare ora');
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
        $('btn-confirm-play')?.addEventListener('click', () => {
            if (playSelection?.mode === 'brainrotDiscard') confirmBrainrotDiscard();
            else confirmLadderPlay();
        });
        $('btn-cancel-play')?.addEventListener('click', () => {
            playSound('click');
            clearPlaySelection();
        });
        $('btn-contrast')?.addEventListener('click', async () => {
            const pending = gameState?.pendingAction;
            if (pending?.type === 'brainrotDiscard' && pending.winnerId === myPlayerId) {
                await confirmBrainrotDiscard();
                return;
            }
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

    function kickToMainMenu(message) {
        clearCounterTimers();
        if (unsubGame) {
            unsubGame();
            unsubGame = null;
        }
        if (unsubLobby) {
            unsubLobby();
            unsubLobby = null;
        }
        const list = JSON.parse(localStorage.getItem('unoLobbyList') || '[]')
            .filter(r => r.id !== lobbyId);
        localStorage.setItem('unoLobbyList', JSON.stringify(list));
        alert(message || ADMIN_LOBBY_MSG);
        window.location.href = 'Menu_principale.html';
    }

    function listenLobbyAdminClose() {
        if (!window.db || !window.doc || !window.onSnapshot || !lobbyId) return;
        const ref = window.doc(window.db, 'lobbies', lobbyId);
        unsubLobby = window.onSnapshot(ref, snap => {
            if (!snap.exists()) {
                kickToMainMenu(ADMIN_LOBBY_MSG);
                return;
            }
            const data = snap.data();
            if (String(data.status || '').toLowerCase() === 'closed_by_admin') {
                kickToMainMenu(data.adminCloseMessage || ADMIN_LOBBY_MSG);
            }
        }, err => console.error('Listener lobby:', err));
    }

    async function leaveGameToWaiting() {
        sessionStorage.setItem(leftGameKey(lobbyId), '1');
        clearCounterTimers();
        if (unsubGame) {
            unsubGame();
            unsubGame = null;
        }
        if (unsubLobby) {
            unsubLobby();
            unsubLobby = null;
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
        listenLobbyAdminClose();

        unsubGame = FS.subscribeGame(lobbyId, pub => {
            if (!pub) {
                kickToMainMenu(ADMIN_LOBBY_MSG);
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
