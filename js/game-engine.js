(function (global) {
    const Deck = global.GameDeck;

    function playerKey(p) {
        return p.uid || p.nickname;
    }

    function clone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }

    function nowIso() {
        return new Date().toISOString();
    }

    function createEmptyPlayerPublic(p, pistolHp) {
        return {
            nickname: p.nickname,
            avatar: p.avatar || '🦊',
            handCount: 0,
            pistolHp,
            maxPistolHp: pistolHp,
            eliminated: false,
            saidUno: false,
            planParts: []
        };
    }

    function createInitialState(lobby) {
        const settings = {
            stack: !!lobby.settings?.stack,
            brainrot: !!lobby.settings?.brainrot,
            pistolHp: lobby.settings?.pistolHp || 3
        };
        const order = (lobby.players || []).map(playerKey);
        const deck = Deck.buildFromQuantities(lobby.cardQuantities || {});
        const hands = {};
        order.forEach(id => {
            hands[id] = [];
        });

        let drawPile = [...deck];
        while (drawPile.length > 0) {
            const top = drawPile[drawPile.length - 1];
            if (top.kind === 'number') break;
            const idx = drawPile.findIndex(c => c.kind === 'number');
            if (idx === -1) break;
            const swap = drawPile.length - 1;
            [drawPile[idx], drawPile[swap]] = [drawPile[swap], drawPile[idx]];
        }

        const deal = 7;
        order.forEach(id => {
            for (let i = 0; i < deal; i += 1) {
                if (drawPile.length) hands[id].push(drawPile.pop());
            }
        });

        let topCard = drawPile.pop();
        const discardPile = [topCard];
        let direction = 1;
        let currentTurnIndex = 0;
        let activeColor = topCard.color === 'black' ? 'red' : topCard.color;

        if (topCard.value === 'reverse' && order.length === 2) {
            direction = -1;
        } else if (topCard.value === 'reverse') {
            direction = -1;
            currentTurnIndex = advanceIndex(currentTurnIndex, direction, order.length);
        } else if (topCard.value === 'skip') {
            currentTurnIndex = advanceIndex(currentTurnIndex, direction, order.length);
        }

        const players = {};
        order.forEach(id => {
            const src = lobby.players.find(p => playerKey(p) === id);
            players[id] = createEmptyPlayerPublic(src || { nickname: id }, settings.pistolHp);
            players[id].handCount = hands[id].length;
        });

        return {
            lobbyId: lobby.id,
            status: 'playing',
            direction,
            turnOrder: order,
            currentTurnIndex,
            startedAt: nowIso(),
            endedAt: null,
            durationMs: null,
            winnerId: null,
            winnerName: null,
            settings,
            drawPile,
            discardPile,
            topCard,
            activeColor,
            pendingColor: false,
            drawStack: 0,
            drawStackType: null,
            forcedColor: null,
            log: [{ at: nowIso(), msg: 'Partita iniziata.' }],
            players,
            pendingAction: null,
            hands
        };
    }

    function advanceIndex(idx, dir, len) {
        return (idx + dir + len * 4) % len;
    }

    function currentPlayerId(state) {
        return state.turnOrder[state.currentTurnIndex];
    }

    function isMyTurn(state, myId) {
        if (state.status !== 'playing') return false;
        const pending = state.pendingAction;
        if (pending?.type === 'bulletRoulette' && !pending.spun && pending.shooterId === myId) {
            return true;
        }
        if (pending?.type === 'bulletRoulette') return false;
        if (pending?.playerId === myId) {
            if (pending.type === 'chooseColor' || pending.type === 'chooseTarget') return true;
        }
        if (pending && pending.type !== 'bulletRoulette') return false;
        if (state.drawStack > 0) return currentPlayerId(state) === myId;
        return currentPlayerId(state) === myId;
    }

    function topMatches(card, state) {
        const top = state.topCard;
        if (!top || !card) return false;
        if (card.kind === 'wild' || card.value === 'wild' || card.value === 'wild4') return true;
        if (state.forcedColor) return card.color === state.forcedColor;
        if (card.color === 'black' && card.kind === 'special') {
            return card.color === state.activeColor || true;
        }
        return card.color === state.activeColor
            || card.color === top.color
            || card.value === top.value
            || (top.color === 'black' && card.color === state.activeColor);
    }

    function canPlayCard(state, card) {
        if (state.status !== 'playing') return false;
        if (state.drawStack > 0) {
            if (!state.settings.stack) return false;
            if (state.drawStackType === 'draw2' && card.value === 'draw2') return true;
            if (state.drawStackType === 'wild4' && card.value === 'wild4') return true;
            return false;
        }
        if (state.pendingColor) return false;
        return topMatches(card, state);
    }

    function removeFromHand(hands, playerId, instanceId) {
        const hand = hands[playerId] || [];
        const idx = hand.findIndex(c => c.instanceId === instanceId);
        if (idx === -1) return null;
        const [card] = hand.splice(idx, 1);
        return card;
    }

    function drawFromPile(state, count) {
        const drawn = [];
        for (let i = 0; i < count; i += 1) {
            if (!state.drawPile.length && state.discardPile.length > 1) {
                const top = state.discardPile.pop();
                state.drawPile = Deck.shuffle(state.discardPile);
                state.discardPile = [top];
                state.topCard = top;
            }
            if (state.drawPile.length) {
                drawn.push(state.drawPile.pop());
            }
        }
        return drawn;
    }

    function addLog(state, msg) {
        state.log = (state.log || []).slice(-40);
        state.log.push({ at: nowIso(), msg });
    }

    function syncHandCounts(state) {
        Object.keys(state.hands || {}).forEach(id => {
            if (state.players[id]) {
                state.players[id].handCount = state.hands[id].length;
            }
        });
    }

    function applyDrawToPlayer(state, playerId, count) {
        const cards = drawFromPile(state, count);
        state.hands[playerId] = state.hands[playerId] || [];
        cards.forEach(c => {
            state.hands[playerId].push(c);
            if (c.value === 'surprise') {
                applySurpriseDraw(state);
            }
        });
        if (state.players[playerId]) {
            state.players[playerId].handCount = state.hands[playerId].length;
            state.players[playerId].saidUno = false;
        }
        return cards.length;
    }

    function applySurpriseDraw(state) {
        addLog(state, 'Imprevisti! Tutti pescano 1.');
        state.turnOrder.forEach(id => {
            if (!state.players[id]?.eliminated) applyDrawToPlayer(state, id, 1);
        });
    }

    function nextTurn(state, steps = 1) {
        const len = state.turnOrder.length;
        let idx = state.currentTurnIndex;
        for (let i = 0; i < steps; i += 1) {
            idx = advanceIndex(idx, state.direction, len);
            let guard = 0;
            while (state.players[state.turnOrder[idx]]?.eliminated && guard < len) {
                idx = advanceIndex(idx, state.direction, len);
                guard += 1;
            }
        }
        state.currentTurnIndex = idx;
    }

    function cardStackKey(card) {
        if (!card) return '';
        if (card.kind === 'number') return `num:${card.color}:${card.value}`;
        return `card:${card.color}:${card.value}:${card.defId || card.label}`;
    }

    function canStackTogether(card) {
        return card.kind === 'number';
    }

    function getMatchingPlayableCards(state, playerId, instanceId) {
        const hand = state.hands[playerId] || [];
        const card = hand.find(c => c.instanceId === instanceId);
        if (!card || !canPlayCard(state, card) || !canStackTogether(card)) {
            return card ? [card] : [];
        }
        const key = cardStackKey(card);
        return hand.filter(c => cardStackKey(c) === key && canPlayCard(state, c));
    }

    function checkWinner(state, playerId) {
        const count = state.hands[playerId]?.length || 0;
        if (count === 0 && state.status === 'playing') {
            state.status = 'finished';
            state.winnerId = playerId;
            state.winnerName = state.players[playerId]?.nickname || playerId;
            state.endedAt = nowIso();
            const start = new Date(state.startedAt).getTime();
            state.durationMs = Date.now() - start;
            addLog(state, `${state.winnerName} ha vinto!`);
        }
    }

    /** @returns {'win'|'penalty'|null} */
    function checkWinOrUnoPenalty(state, playerId) {
        const count = state.hands[playerId]?.length || 0;
        if (count !== 0 || state.status !== 'playing') return null;
        if (!state.players[playerId]?.saidUno) {
            applyDrawToPlayer(state, playerId, 2);
            if (state.players[playerId]) state.players[playerId].saidUno = false;
            addLog(state, `${state.players[playerId]?.nickname} non ha detto UNO! Pesca 2.`);
            return 'penalty';
        }
        checkWinner(state, playerId);
        return state.status === 'finished' ? 'win' : null;
    }

    function startBulletRoulette(state, shooterId) {
        const alive = state.turnOrder.filter(id => !state.players[id]?.eliminated);
        if (!alive.length) return;
        const hitId = alive[Math.floor(Math.random() * alive.length)];
        const n = alive.length;
        const hitIndex = alive.indexOf(hitId);
        const slice = 360 / n;
        const spinDeg = 360 * 6 + (360 - hitIndex * slice - slice / 2);

        state.pendingAction = {
            type: 'bulletRoulette',
            shooterId,
            hitId,
            segments: alive.map(id => ({
                id,
                nickname: state.players[id]?.nickname || id
            })),
            spun: false,
            spinDeg
        };
        addLog(state, '🔫 Roulette: in attesa del giro...');
    }

    function applyBulletHit(state, hitId) {
        const p = state.players[hitId];
        if (!p || p.eliminated) return;
        p.pistolHp -= 1;
        addLog(state, `Proiettile colpisce ${p.nickname}! (${p.pistolHp} HP)`);
        if (p.pistolHp <= 0) {
            eliminatePlayer(state, hitId);
            addLog(state, `${p.nickname} eliminato.`);
        }
    }

    function spinBulletRoulette(state, playerId) {
        const s = clone(state);
        const pending = s.pendingAction;
        if (!pending || pending.type !== 'bulletRoulette') {
            return { ok: false, error: 'Nessuna roulette attiva.' };
        }
        if (pending.shooterId !== playerId) {
            return { ok: false, error: 'Solo chi ha giocato il proiettile può girare.' };
        }
        if (pending.spun) {
            return { ok: false, error: 'Roulette già girata.' };
        }
        pending.spun = true;
        s.lastRoulette = {
            hitId: pending.hitId,
            spinDeg: pending.spinDeg,
            segments: pending.segments,
            shooterId: pending.shooterId,
            at: Date.now()
        };
        applyBulletHit(s, pending.hitId);
        s.pendingAction = null;
        nextTurn(s, 1);
        return { ok: true, state: s };
    }

    function playCard(state, playerId, instanceId, options = {}) {
        const ids = options.instanceIds || [instanceId];
        return playCards(state, playerId, ids, options);
    }

    function playCards(state, playerId, instanceIds, options = {}) {
        const s = clone(state);
        if (!isMyTurn(s, playerId)) {
            return { ok: false, error: 'Non è il tuo turno.' };
        }
        if (!instanceIds?.length) {
            return { ok: false, error: 'Nessuna carta selezionata.' };
        }

        const hand = s.hands[playerId] || [];
        const cards = instanceIds.map(id => hand.find(c => c.instanceId === id)).filter(Boolean);
        if (cards.length !== instanceIds.length) {
            return { ok: false, error: 'Carta non in mano.' };
        }

        const first = cards[0];
        if (!canPlayCard(s, first)) {
            return { ok: false, error: 'Carta non giocabile.' };
        }

        if (cards.length > 1) {
            if (!cards.every(c => canStackTogether(c) && cardStackKey(c) === cardStackKey(first))) {
                return { ok: false, error: 'Puoi giocare insieme solo carte numero uguali.' };
            }
        }

        if (cards.length > 1 && !canStackTogether(first)) {
            return { ok: false, error: 'Solo i numeri si possono giocare in gruppo.' };
        }

        const wildOrTarget = cards.some(c =>
            ['wild', 'wild4'].includes(c.value)
            || ['death', 'swap', 'gift', 'heart', 'communism', 'blobby', 'bullet'].includes(c.value)
        );
        if (cards.length > 1 && wildOrTarget) {
            return { ok: false, error: 'Una sola carta speciale per volta.' };
        }

        cards.forEach(c => removeFromHand(s.hands, playerId, c.instanceId));
        cards.forEach(c => s.discardPile.push(c));
        const card = cards[cards.length - 1];
        s.topCard = card;
        if (options.chosenColor) {
            s.activeColor = options.chosenColor;
            s.pendingColor = false;
            s.pendingAction = null;
        } else if (card.color !== 'black' && card.color !== 'wild') {
            s.activeColor = card.color;
        } else if (card.kind === 'number') {
            s.activeColor = card.color;
        }

        const stacking = s.drawStack > 0 && s.settings.stack
            && (card.value === 'draw2' || card.value === 'wild4');
        if (!stacking) {
            s.drawStack = 0;
            s.drawStackType = null;
        }
        const playLabel = cards.length > 1
            ? `${cards.length}× ${Deck.cardDisplayName(card)}`
            : Deck.cardDisplayName(card);
        addLog(s, `${s.players[playerId]?.nickname} gioca ${playLabel}`);
        syncHandCounts(s);
        if (s.players[playerId] && (s.hands[playerId]?.length || 0) > 1) {
            s.players[playerId].saidUno = false;
        }

        const effect = resolveCardEffect(s, playerId, card, options);
        if (!effect.ok) {
            return effect;
        }

        const outcome = checkWinOrUnoPenalty(s, playerId);
        if (outcome === 'win' || s.status === 'finished') {
            return { ok: true, state: s, outcome };
        }
        if (outcome === 'penalty') {
            if (!s.pendingAction && !s.pendingColor) nextTurn(s, 1);
            syncHandCounts(s);
            return { ok: true, state: s, outcome: 'penalty' };
        }

        if (!s.pendingAction && !s.pendingColor) {
            if (effect.skipAdvance) {
                /* turn already moved */
            } else if (s.drawStack > 0) {
                /* wait for stack */
            } else {
                nextTurn(s, 1);
            }
        }

        syncHandCounts(s);
        return { ok: true, state: s, cardsPlayed: cards.length };
    }

    function resolveCardEffect(state, playerId, card, options) {
        const v = card.value;
        const settings = state.settings;

        switch (v) {
            case 'skip':
                addLog(state, 'Salta il prossimo giocatore.');
                nextTurn(state, 1);
                return { ok: true, skipAdvance: true };
            case 'reverse':
                state.direction *= -1;
                addLog(state, `Direzione ${state.direction > 0 ? 'oraria' : 'antioraria'}.`);
                if (state.turnOrder.length === 2) nextTurn(state, 1);
                return { ok: true };
            case 'draw2':
                if (settings.stack && (state.drawStackType === 'draw2' || state.drawStack === 0)) {
                    state.drawStack += 2;
                    state.drawStackType = 'draw2';
                    addLog(state, `Stack +2 (totale ${state.drawStack}).`);
                } else {
                    applyDrawToPlayer(state, nextPlayerId(state), 2);
                    nextTurn(state, 2);
                    return { ok: true, skipAdvance: true };
                }
                return { ok: true };
            case 'wild':
                if (!options.chosenColor) {
                    state.pendingColor = true;
                    state.pendingAction = { type: 'chooseColor', playerId };
                }
                return { ok: true };
            case 'wild4':
                if (settings.stack && (state.drawStackType === 'wild4' || state.drawStack === 0)) {
                    state.drawStack += 4;
                    state.drawStackType = 'wild4';
                    addLog(state, `Stack +4 (totale ${state.drawStack}).`);
                } else if (!options.chosenColor) {
                    applyDrawToPlayer(state, nextPlayerId(state), 4);
                    state.pendingColor = true;
                    state.pendingAction = { type: 'chooseColor', playerId };
                } else {
                    applyDrawToPlayer(state, nextPlayerId(state), 4);
                }
                return { ok: true };
            case 'draw10':
                applyDrawToPlayer(state, nextPlayerId(state), 10);
                nextTurn(state, 2);
                return { ok: true, skipAdvance: true };
            case 'draw16':
                applyDrawToPlayer(state, nextPlayerId(state), 16);
                nextTurn(state, 2);
                return { ok: true, skipAdvance: true };
            case 'death': {
                const target = options.targetId || nextPlayerId(state);
                eliminatePlayer(state, target);
                addLog(state, `Death Note elimina ${state.players[target]?.nickname}.`);
                return { ok: true };
            }
            case 'blobby': {
                const target = options.targetId || nextPlayerId(state);
                if (hasShield(state, target)) {
                    consumeShield(state, target);
                    addLog(state, 'Blobby bloccato dallo Scudo!');
                } else {
                    state.status = 'finished';
                    state.winnerId = playerId;
                    state.winnerName = state.players[playerId]?.nickname;
                    state.endedAt = nowIso();
                    state.durationMs = Date.now() - new Date(state.startedAt).getTime();
                    addLog(state, 'Blobby! Vittoria immediata.');
                }
                return { ok: true };
            }
            case 'swap': {
                const target = options.targetId;
                if (!target) {
                    state.pendingAction = { type: 'chooseTarget', playerId, effect: 'swap' };
                    return { ok: true };
                }
                const a = state.hands[playerId];
                state.hands[playerId] = state.hands[target];
                state.hands[target] = a;
                syncHandCounts(state);
                addLog(state, 'Mani scambiate!');
                return { ok: true };
            }
            case 'waves': {
                const order = state.turnOrder;
                const hands = order.map(id => state.hands[id]);
                for (let i = 0; i < order.length; i += 1) {
                    const next = order[(i + state.direction + order.length) % order.length];
                    state.hands[next] = hands[i];
                }
                syncHandCounts(state);
                addLog(state, 'Onde gravitazionali! Mani ruotate.');
                return { ok: true };
            }
            case 'vaff':
                state.drawStack = 0;
                state.drawStackType = null;
                state.forcedColor = null;
                addLog(state, 'Vaffanculo! Stack e vincoli annullati.');
                return { ok: true };
            case 'mari':
                state.forcedColor = 'green';
                state.activeColor = 'green';
                addLog(state, 'Marihuana: solo Verde fino alla prossima verde.');
                return { ok: true };
            case 'bullet':
                startBulletRoulette(state, playerId);
                return { ok: true, skipAdvance: true };
            case 'halfdraw': {
                const active = state.turnOrder.filter(id => !state.players[id]?.eliminated);
                const n = Math.ceil(active.length / 2);
                for (let i = 0; i < n; i += 1) {
                    applyDrawToPlayer(state, active[i], 1);
                }
                addLog(state, `QUA GRUPPO! ${n} giocatori pescano.`);
                return { ok: true };
            }
            case 'reshuffle': {
                if (state.discardPile.length > 1) {
                    const top = state.discardPile.pop();
                    state.drawPile = Deck.shuffle([...state.discardPile, ...state.drawPile]);
                    state.discardPile = [top];
                    state.topCard = top;
                    addLog(state, 'La Messa è Finita: mazzo rimescolato.');
                }
                return { ok: true };
            }
            case 'cancel': {
                if (state.discardPile.length > 1) {
                    state.discardPile.pop();
                    const prev = state.discardPile[state.discardPile.length - 1];
                    state.topCard = prev;
                    state.activeColor = prev.color === 'black' ? state.activeColor : prev.color;
                    state.hands[playerId].push(prev);
                    syncHandCounts(state);
                    addLog(state, 'Righello: ultima carta annullata.');
                }
                return { ok: true };
            }
            case 'reset':
                Object.keys(state.hands).forEach(id => {
                    state.hands[id] = [];
                });
                const fresh = Deck.buildFromQuantities({});
                state.drawPile = fresh;
                state.discardPile = [];
                state.turnOrder.forEach(id => {
                    for (let i = 0; i < 7; i += 1) state.hands[id].push(state.drawPile.pop());
                });
                syncHandCounts(state);
                addLog(state, 'Donna: reset totale!');
                return { ok: true };
            case 'gift': {
                const target = options.targetId;
                if (!target) {
                    state.pendingAction = { type: 'chooseTarget', playerId, effect: 'gift', cardInstanceId: card.instanceId };
                    return { ok: true };
                }
                const idx = state.hands[playerId].findIndex(c => c.instanceId === options.giftCardId);
                if (idx !== -1) {
                    const gifted = state.hands[playerId].splice(idx, 1)[0];
                    state.hands[target].push(gifted);
                    syncHandCounts(state);
                }
                return { ok: true };
            }
            case 'communism': {
                const target = options.targetId || nextPlayerId(state);
                const stolen = (state.hands[target] || []).slice(0, 2);
                state.hands[playerId].push(...stolen);
                state.hands[target] = state.hands[target].slice(2);
                syncHandCounts(state);
                addLog(state, 'Comunismo: carte rubate.');
                return { ok: true };
            }
            case 'heart': {
                const target = options.targetId;
                if (target && state.players[target]?.eliminated) {
                    state.players[target].eliminated = false;
                    state.players[target].pistolHp = state.settings.pistolHp;
                    addLog(state, `${state.players[target].nickname} resuscitato!`);
                }
                return { ok: true };
            }
            case 'brainrot':
                if (settings.brainrot) {
                    state.pendingAction = { type: 'brainrot', playerId, scores: {} };
                    addLog(state, 'Brainrot Battle!');
                }
                return { ok: true };
            case 'mirror':
                addLog(state, 'Specchio: effetto riflesso (semplificato).');
                nextTurn(state, 0);
                return { ok: true };
            case 'jack':
                addLog(state, 'Jack: copia ultima azione.');
                return { ok: true };
            case 'plan':
                if (card.planPart && state.players[playerId]) {
                    const parts = state.players[playerId].planParts || [];
                    if (!parts.includes(card.planPart)) parts.push(card.planPart);
                    state.players[playerId].planParts = parts;
                    if (parts.length >= 4) {
                        state.status = 'finished';
                        state.winnerId = playerId;
                        state.winnerName = state.players[playerId].nickname;
                        state.endedAt = nowIso();
                        state.durationMs = Date.now() - new Date(state.startedAt).getTime();
                        addLog(state, 'Piani di Proiezione completati! Vittoria!');
                    }
                }
                return { ok: true };
            default:
                if (card.kind === 'number' && state.forcedColor && card.color === 'green') {
                    state.forcedColor = null;
                }
                return { ok: true };
        }
    }

    function nextPlayerId(state) {
        const len = state.turnOrder.length;
        let idx = advanceIndex(state.currentTurnIndex, state.direction, len);
        let guard = 0;
        while (state.players[state.turnOrder[idx]]?.eliminated && guard < len) {
            idx = advanceIndex(idx, state.direction, len);
            guard += 1;
        }
        return state.turnOrder[idx];
    }

    function hasShield(state, playerId) {
        return (state.hands[playerId] || []).some(c => c.value === 'shield');
    }

    function consumeShield(state, playerId) {
        const hand = state.hands[playerId] || [];
        const idx = hand.findIndex(c => c.value === 'shield');
        if (idx !== -1) hand.splice(idx, 1);
        syncHandCounts(state);
    }

    function eliminatePlayer(state, playerId) {
        if (!state.players[playerId]) return;
        state.players[playerId].eliminated = true;
        state.hands[playerId] = [];
        state.players[playerId].handCount = 0;
    }

    function drawCard(state, playerId) {
        const s = clone(state);
        if (currentPlayerId(s) !== playerId) {
            return { ok: false, error: 'Non è il tuo turno.' };
        }

        if (s.drawStack > 0) {
            const n = applyDrawToPlayer(s, playerId, s.drawStack);
            addLog(s, `${s.players[playerId]?.nickname} pesca ${n} (stack).`);
            s.drawStack = 0;
            s.drawStackType = null;
            nextTurn(s, 1);
            syncHandCounts(s);
            return { ok: true, state: s };
        }

        const n = applyDrawToPlayer(s, playerId, 1);
        if (n === 0) return { ok: false, error: 'Mazzo vuoto.' };
        addLog(s, `${s.players[playerId]?.nickname} pesca 1.`);
        nextTurn(s, 1);
        syncHandCounts(s);
        return { ok: true, state: s };
    }

    function chooseColor(state, playerId, color) {
        const s = clone(state);
        if (!s.pendingColor || s.pendingAction?.playerId !== playerId) {
            return { ok: false, error: 'Nessuna scelta colore richiesta.' };
        }
        s.activeColor = color;
        s.pendingColor = false;
        s.pendingAction = null;
        addLog(s, `Colore scelto: ${Deck.COLOR_LABEL[color] || color}`);
        if (s.drawStack > 0) {
            const target = nextPlayerId(s);
            applyDrawToPlayer(s, target, s.drawStack);
            s.drawStack = 0;
            s.drawStackType = null;
            nextTurn(s, 2);
        } else {
            nextTurn(s, 1);
        }
        return { ok: true, state: s };
    }

    function chooseTarget(state, playerId, targetId) {
        const s = clone(state);
        const pending = s.pendingAction;
        if (!pending || pending.playerId !== playerId) {
            return { ok: false, error: 'Nessun bersaglio richiesto.' };
        }
        s.pendingAction = null;
        if (pending.effect === 'swap') {
            resolveCardEffect(s, playerId, { value: 'swap' }, { targetId });
        } else if (pending.effect === 'gift') {
            resolveCardEffect(s, playerId, { value: 'gift' }, { targetId, giftCardId: pending.cardInstanceId });
        } else {
            resolveCardEffect(s, playerId, s.topCard, { targetId });
        }
        if (!s.pendingAction) nextTurn(s, 1);
        return { ok: true, state: s };
    }

    function declareUno(state, playerId) {
        const s = clone(state);
        const count = s.hands[playerId]?.length || 0;
        if (count !== 1) {
            return { ok: false, error: 'Puoi dire UNO! solo con 1 carta in mano.' };
        }
        if (s.players[playerId]) s.players[playerId].saidUno = true;
        addLog(s, `${s.players[playerId]?.nickname} dice UNO!`);
        return { ok: true, state: s };
    }

    function stripForFirestore(state) {
        return clone(state);
    }

    global.GameEngine = {
        playerKey,
        createInitialState,
        currentPlayerId,
        isMyTurn,
        canPlayCard,
        cardStackKey,
        getMatchingPlayableCards,
        playCard,
        playCards,
        drawCard,
        chooseColor,
        chooseTarget,
        declareUno,
        spinBulletRoulette,
        stripForFirestore,
        topMatches
    };
})(window);
