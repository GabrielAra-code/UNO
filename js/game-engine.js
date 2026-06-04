(function (global) {
    const Deck = global.GameDeck;
    const COUNTER_WINDOW_MS = 5000;
    const COUNTER_RULES = {
        blobby: { allowed: ['cancel', 'shield'] },
        death: { allowed: ['cancel'] }
    };

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
            unoRequired: false,
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
            turnAdvanceSteps: 0,
            turnFlags: {
                playerId: order[currentTurnIndex],
                drawn: false,
                played: false
            },
            hands
        };
    }

    function advanceIndex(idx, dir, len) {
        return (idx + dir + len * 4) % len;
    }

    function currentPlayerId(state) {
        return state.turnOrder[state.currentTurnIndex];
    }

    function isCounterWindow(state) {
        return state.pendingAction?.type === 'counterWindow';
    }

    function canPlayCounter(state, playerId, card) {
        const pending = state.pendingAction;
        if (!pending || pending.type !== 'counterWindow') return false;
        if (playerId === pending.sourcePlayerId) return false;
        if (pending.responses?.[playerId]) return false;
        const rules = COUNTER_RULES[pending.cardValue];
        if (!rules) return false;
        if (card.value === 'cancel' || card.defId === 'c_righello') return true;
        if (card.value === 'shield' && rules.allowed.includes('shield')) return true;
        return rules.allowed.includes(card.value);
    }

    function isMyTurn(state, myId) {
        if (state.status !== 'playing') return false;
        const pending = state.pendingAction;
        if (pending?.type === 'mariGreen') return pending.currentId === myId;
        if (pending?.type === 'bulletRoulette' && !pending.spun && pending.shooterId === myId) {
            return true;
        }
        if (pending?.type === 'bulletRoulette') return false;
        if (pending?.type === 'counterWindow') return false;
        if (pending?.playerId === myId) {
            if (pending.type === 'chooseColor' || pending.type === 'chooseTarget') return true;
        }
        if (pending && pending.type !== 'bulletRoulette') return false;
        if (state.drawStack > 0) return currentPlayerId(state) === myId;
        return currentPlayerId(state) === myId;
    }

    function canEndTurn(state, playerId) {
        if (state.status !== 'playing' || currentPlayerId(state) !== playerId) return false;
        if (isCounterWindow(state)) return false;
        const pending = state.pendingAction;
        if (pending?.type === 'mariGreen') return false;
        if (state.pendingColor) return false;
        if (pending && pending.type !== 'bulletRoulette') return false;
        syncTurnFlags(state);
        if (!state.turnFlags.drawn && !state.turnFlags.played) return false;
        if (pending?.type === 'bulletRoulette' && !pending.spun) return false;
        return true;
    }

    function leaveGame(state, playerId) {
        const s = clone(state);
        removePlayerFromGame(s, playerId);
        return { ok: true, state: s };
    }

    function openCounterWindow(state, sourcePlayerId, card, options = {}) {
        state.pendingAction = {
            type: 'counterWindow',
            sourcePlayerId,
            cardValue: card.value,
            targetId: options.targetId || null,
            startedAt: Date.now(),
            resolvesAt: Date.now() + COUNTER_WINDOW_MS,
            responses: {}
        };
        addLog(state, 'Attesa risposte... (5s)');
    }

    function executeDeferredEffect(state, sourcePlayerId, effect) {
        const { cardValue, targetId } = effect;
        if (cardValue === 'death') {
            const target = targetId || nextPlayerId(state);
            eliminatePlayer(state, target);
            addLog(state, `Death Note elimina ${state.players[target]?.nickname}.`);
            checkLastPlayerStanding(state, sourcePlayerId);
            return;
        }
        if (cardValue === 'blobby') {
            state.status = 'finished';
            state.winnerId = sourcePlayerId;
            state.winnerName = state.players[sourcePlayerId]?.nickname;
            state.endedAt = nowIso();
            state.durationMs = Date.now() - new Date(state.startedAt).getTime();
            addLog(state, 'Blobby! Vittoria immediata.');
        }
    }

    function resolveCounterWindow(state, playerId) {
        const s = clone(state);
        const pending = s.pendingAction;
        if (!pending || pending.type !== 'counterWindow') {
            return { ok: false, error: 'Nessuna finestra di contrasto attiva.' };
        }
        const expired = Date.now() >= pending.resolvesAt;
        if (!expired && playerId !== pending.sourcePlayerId) {
            return { ok: false, error: 'Attendi la fine del countdown.' };
        }

        const responses = pending.responses || {};
        let cancelled = false;
        Object.entries(responses).forEach(([responderId, r]) => {
            if (r.cardValue === 'cancel') cancelled = true;
            if (r.cardValue === 'shield' && pending.cardValue === 'blobby') cancelled = true;
            const label = r.label || 'Contrasto';
            addLog(s, `${s.players[responderId]?.nickname} contrasta con ${label}!`);
        });

        const deferred = { cardValue: pending.cardValue, targetId: pending.targetId };
        const source = pending.sourcePlayerId;
        s.pendingAction = null;

        if (cancelled) {
            addLog(s, 'Effetto annullato dal contrasto.');
            return { ok: true, state: s };
        }

        executeDeferredEffect(s, source, deferred);
        return { ok: true, state: s };
    }

    function playCounterCard(state, playerId, instanceId) {
        const s = clone(state);
        const pending = s.pendingAction;
        if (!pending || pending.type !== 'counterWindow') {
            return { ok: false, error: 'Nessuna finestra di contrasto attiva.' };
        }
        if (playerId === pending.sourcePlayerId) {
            return { ok: false, error: 'Non puoi contrastare la tua carta.' };
        }
        if (!pending.responses) pending.responses = {};
        if (pending.responses[playerId]) {
            return { ok: false, error: 'Hai già contrastato.' };
        }

        const card = removeFromHand(s.hands, playerId, instanceId);
        if (!card) return { ok: false, error: 'Carta non in mano.' };
        if (!canPlayCounter(s, playerId, card)) {
            s.hands[playerId].push(card);
            return { ok: false, error: 'Carta non valida per contrastare.' };
        }

        s.discardPile.push(card);
        s.topCard = card;
        pending.responses[playerId] = {
            cardValue: card.value,
            label: card.righelloLabel || card.label
        };
        syncHandCounts(s);
        addLog(s, `${s.players[playerId]?.nickname} gioca contrasto: ${Deck.cardDisplayName(card)}`);
        return { ok: true, state: s };
    }

    function endTurn(state, playerId) {
        const s = clone(state);
        if (!canEndTurn(s, playerId)) {
            return { ok: false, error: 'Non puoi terminare il turno ora.' };
        }
        applyUnoPenaltyIfNeeded(s, playerId);
        const steps = 1 + (s.turnAdvanceSteps || 0);
        s.turnAdvanceSteps = 0;
        nextTurn(s, steps);
        addLog(s, `${s.players[playerId]?.nickname} termina il turno.`);
        return { ok: true, state: s };
    }

    function removePlayerFromGame(state, playerId) {
        const nickname = state.players[playerId]?.nickname || playerId;
        const wasCurrent = currentPlayerId(state) === playerId;
        const oldIdx = state.currentTurnIndex;

        delete state.hands[playerId];
        delete state.players[playerId];
        state.turnOrder = state.turnOrder.filter(id => id !== playerId);

        if (state.turnOrder.length === 0) {
            state.status = 'finished';
            addLog(state, `${nickname} ha lasciato la partita.`);
            return;
        }

        if (wasCurrent) {
            state.currentTurnIndex = Math.min(oldIdx, state.turnOrder.length - 1);
        } else {
            const cur = state.turnOrder[oldIdx];
            const newIdx = state.turnOrder.indexOf(cur);
            state.currentTurnIndex = newIdx >= 0 ? newIdx : 0;
        }

        let guard = 0;
        while (state.players[state.turnOrder[state.currentTurnIndex]]?.eliminated && guard < state.turnOrder.length) {
            state.currentTurnIndex = advanceIndex(state.currentTurnIndex, state.direction, state.turnOrder.length);
            guard += 1;
        }

        if (state.pendingAction?.sourcePlayerId === playerId
            || state.pendingAction?.defenderId === playerId
            || state.pendingAction?.shooterId === playerId) {
            state.pendingAction = null;
        }

        addLog(state, `${nickname} ha lasciato la partita.`);
        checkLastPlayerStanding(state, currentPlayerId(state));
    }

    function effectiveTopColor(state) {
        const top = state.topCard;
        if (!top) return state.activeColor;
        if (top.value === 'wild' || top.value === 'wild4' || top.color === 'black' || top.color === 'wild') {
            return state.activeColor;
        }
        return top.color;
    }

    /** Jolly, +4 e speciali nere/incolore: giocabili sul mazzo in tavola (salvo stack +2/+4). */
    function isFreePlayCard(card) {
        if (!card) return false;
        if (card.value === 'wild' || card.value === 'wild4') return true;
        if (card.kind === 'wild') return true;
        if (card.kind === 'special' && (card.color === 'black' || card.color === 'wild')) return true;
        return false;
    }

    function topMatches(card, state) {
        const top = state.topCard;
        if (!top || !card) return false;

        if (isFreePlayCard(card)) return true;

        if (state.forcedColor) {
            return card.color === state.forcedColor || isFreePlayCard(card);
        }

        const topColor = effectiveTopColor(state);
        const topValue = top.value;

        if (String(card.value) === String(topValue)) return true;

        if (card.color && topColor && card.color === topColor) {
            return true;
        }

        if (top.color === 'black' || top.kind === 'special' || top.kind === 'wild') {
            if (card.kind === 'action' && card.color === topColor) return true;
            if (card.kind === 'special' && card.color === topColor) return true;
        }

        return false;
    }

    function hasPlayableCard(state, playerId) {
        const hand = state.hands[playerId] || [];
        return hand.some(c => canPlayCard(state, c));
    }

    function syncTurnFlags(state) {
        const pid = currentPlayerId(state);
        if (!state.turnFlags || state.turnFlags.playerId !== pid) {
            state.turnFlags = { playerId: pid, drawn: false, played: false };
        }
    }

    function canPlayCard(state, card) {
        if (state.status !== 'playing') return false;
        const pending = state.pendingAction;
        if (pending?.type === 'mariGreen') return false;
        if (state.drawStack > 0) {
            if (!state.settings.stack) return false;
            if (state.drawStackType === 'draw2' && card.value === 'draw2') return true;
            if (state.drawStackType === 'wild4' && card.value === 'wild4') return true;
            if (isFreePlayCard(card)) return false;
            return false;
        }
        if (state.pendingColor) return false;
        return topMatches(card, state);
    }

    /** Carta giocabile nel turno corrente (una sola azione di gioco per turno). */
    function canPlayCardThisTurn(state, playerId, card) {
        if (currentPlayerId(state) !== playerId) return false;
        if (!canPlayCard(state, card)) return false;
        syncTurnFlags(state);
        if (state.turnFlags.played) return false;
        return true;
    }

    function hasPlayableCardThisTurn(state, playerId) {
        const hand = state.hands[playerId] || [];
        return hand.some(c => canPlayCardThisTurn(state, playerId, c));
    }

    function canDraw(state, playerId) {
        if (state.status !== 'playing' || currentPlayerId(state) !== playerId) return false;
        const pending = state.pendingAction;
        if (pending?.type === 'mariGreen') {
            return pending.currentId === playerId;
        }
        if (pending?.type === 'counterWindow' || pending?.type === 'bulletRoulette') return false;
        if (state.pendingColor) return false;
        syncTurnFlags(state);
        if (state.turnFlags.played) return false;
        if (state.turnFlags.drawn && state.drawStack === 0) return false;
        if (state.drawStack > 0) return true;
        return !hasPlayableCardThisTurn(state, playerId);
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
        state.turnFlags = {
            playerId: state.turnOrder[state.currentTurnIndex],
            drawn: false,
            played: false
        };
    }

    function isGreenCard(card) {
        return card?.color === 'green';
    }

    function startMariEffect(state, sourcePlayerId) {
        const waiting = state.turnOrder.filter(id =>
            id !== sourcePlayerId && !state.players[id]?.eliminated
        );
        state.forcedColor = 'green';
        state.pendingAction = {
            type: 'mariGreen',
            sourcePlayerId,
            waiting: [...waiting],
            currentId: waiting[0] || null
        };
        addLog(state, 'Marijuana! Ogni giocatore deve giocare una carta Verde.');
    }

    function advanceMariQueue(state) {
        const pending = state.pendingAction;
        if (!pending || pending.type !== 'mariGreen') return;
        if (!pending.waiting.length) {
            state.pendingAction = null;
            state.forcedColor = null;
            addLog(state, 'Effetto Marijuana concluso.');
            return;
        }
        pending.currentId = pending.waiting[0];
    }

    function finishMariPlayer(state, playerId) {
        const pending = state.pendingAction;
        if (!pending || pending.type !== 'mariGreen') return;
        pending.waiting = pending.waiting.filter(id => id !== playerId);
        advanceMariQueue(state);
    }

    function mariDrawUntilGreen(state, playerId) {
        const name = state.players[playerId]?.nickname || playerId;
        let safety = 0;
        while (safety < 50) {
            safety += 1;
            const drawn = drawFromPile(state, 1);
            if (!drawn.length) {
                addLog(state, `${name}: mazzo esaurito durante Marijuana.`);
                break;
            }
            const c = drawn[0];
            if (isGreenCard(c)) {
                state.discardPile.push(c);
                state.topCard = c;
                state.activeColor = 'green';
                addLog(state, `${name} pesca e gioca ${Deck.cardDisplayName(c)}.`);
                return c;
            }
            state.hands[playerId].push(c);
            syncHandCounts(state);
            addLog(state, `${name} pesca ${Deck.cardDisplayName(c)} (in mano).`);
        }
        return null;
    }

    function canPlayMariGreen(state, playerId, card) {
        const pending = state.pendingAction;
        if (!pending || pending.type !== 'mariGreen') return false;
        if (pending.currentId !== playerId) return false;
        return isGreenCard(card);
    }

    function playMariGreenCard(state, playerId, instanceId) {
        const s = clone(state);
        const pending = s.pendingAction;
        if (!pending || pending.type !== 'mariGreen' || pending.currentId !== playerId) {
            return { ok: false, error: 'Non devi rispondere a Marijuana ora.' };
        }
        const card = removeFromHand(s.hands, playerId, instanceId);
        if (!card) return { ok: false, error: 'Carta non in mano.' };
        if (!isGreenCard(card)) {
            s.hands[playerId].push(card);
            return { ok: false, error: 'Devi giocare una carta Verde.' };
        }
        s.discardPile.push(card);
        s.topCard = card;
        s.activeColor = 'green';
        addLog(s, `${s.players[playerId]?.nickname} gioca ${Deck.cardDisplayName(card)} (Marijuana).`);
        syncHandCounts(s);
        finishMariPlayer(s, playerId);
        return { ok: true, state: s };
    }

    function resolveMariByDraw(state, playerId) {
        const s = clone(state);
        const pending = s.pendingAction;
        if (!pending || pending.type !== 'mariGreen' || pending.currentId !== playerId) {
            return { ok: false, error: 'Non devi rispondere a Marijuana ora.' };
        }
        const hand = s.hands[playerId] || [];
        if (hand.some(isGreenCard)) {
            return { ok: false, error: 'Hai una carta Verde: giocala dalla mano.' };
        }
        mariDrawUntilGreen(s, playerId);
        syncHandCounts(s);
        finishMariPlayer(s, playerId);
        return { ok: true, state: s };
    }

    function comboValueKey(card) {
        if (!card || card.kind !== 'number') return '';
        return `val:${card.value}`;
    }

    function cardStackKey(card) {
        return comboValueKey(card) || `card:${card.color}:${card.value}:${card.defId || card.label}`;
    }

    function numberRank(card) {
        return Number(card?.value);
    }

    function isValidLadder(cards) {
        if (!cards?.length) return false;
        const sorted = [...cards].sort((a, b) => numberRank(a) - numberRank(b));
        const color = sorted[0].color;
        if (numberRank(sorted[0]) !== 0) return false;
        for (let i = 0; i < sorted.length; i += 1) {
            const c = sorted[i];
            if (c.kind !== 'number' || c.color !== color || numberRank(c) !== i) return false;
        }
        return true;
    }

    function getLadderPlay(state, playerId, instanceId) {
        const hand = state.hands[playerId] || [];
        const card = hand.find(c => c.instanceId === instanceId);
        if (!card || card.kind !== 'number') return card ? [card] : [];

        const color = card.color;
        const byNum = {};
        hand.filter(c => c.kind === 'number' && c.color === color).forEach(c => {
            byNum[numberRank(c)] = c;
        });
        if (!byNum[0] || !canPlayCard(state, byNum[0])) return [card];

        let maxV = 0;
        while (byNum[maxV + 1]) maxV += 1;
        const full = [];
        for (let v = 0; v <= maxV; v += 1) full.push(byNum[v]);

        const idx = full.findIndex(c => c.instanceId === instanceId);
        if (idx < 0) return [card];
        const ladder = full.slice(0, idx + 1);
        return ladder.length >= 2 ? ladder : [card];
    }

    function getSameNumberBatch(state, playerId, instanceId) {
        const hand = state.hands[playerId] || [];
        const card = hand.find(c => c.instanceId === instanceId);
        if (!card || card.kind !== 'number' || !canPlayCard(state, card)) return card ? [card] : [];
        return hand.filter(c =>
            c.kind === 'number'
            && String(c.value) === String(card.value)
            && canPlayCard(state, c)
        );
    }

    function getSameColorBatch(state, playerId, instanceId) {
        const hand = state.hands[playerId] || [];
        const card = hand.find(c => c.instanceId === instanceId);
        if (!card || !canPlayCard(state, card)) return card ? [card] : [];
        if (!card.color || card.color === 'black' || card.color === 'wild') return [card];
        return hand.filter(c =>
            c.color === card.color
            && canPlayCard(state, c)
        );
    }

    function canPlaySameNumberBatch(state, cards) {
        if (!cards?.length) return false;
        const first = cards[0];
        if (first.kind !== 'number') return false;
        return cards.every(c =>
            c.kind === 'number'
            && String(c.value) === String(first.value)
            && canPlayCard(state, c)
        );
    }

    function canPlaySameColorBatch(state, cards) {
        if (!cards?.length) return false;
        const first = cards[0];
        if (!first.color || first.color === 'black' || first.color === 'wild') return cards.length === 1;
        return cards.every(c => c.color === first.color && canPlayCard(state, c));
    }

    function isValidPlayGroup(state, cards) {
        if (!cards?.length) return false;
        if (cards.length === 1) return canPlayCard(state, cards[0]);
        if (isValidLadder(cards)) return canPlayCard(state, cards[0]);
        return canPlaySameNumberBatch(state, cards);
    }

    function getMatchingPlayableCards(state, playerId, instanceId) {
        return [state.hands[playerId]?.find(c => c.instanceId === instanceId)].filter(Boolean);
    }

    function activePlayers(state) {
        return state.turnOrder.filter(id => !state.players[id]?.eliminated);
    }

    function declareWinner(state, winnerId) {
        if (state.status !== 'playing' || !winnerId) return false;
        state.status = 'finished';
        state.winnerId = winnerId;
        state.winnerName = state.players[winnerId]?.nickname || winnerId;
        state.endedAt = nowIso();
        state.durationMs = Date.now() - new Date(state.startedAt).getTime();
        state.pendingAction = null;
        state.pendingColor = false;
        addLog(state, `${state.winnerName} ha vinto!`);
        return true;
    }

    function checkLastPlayerStanding(state, preferredWinnerId) {
        const alive = activePlayers(state);
        if (alive.length === 1) {
            declareWinner(state, alive[0]);
            return true;
        }
        if (alive.length === 0 && preferredWinnerId) {
            declareWinner(state, preferredWinnerId);
            return true;
        }
        return false;
    }

    function updateUnoStateAfterPlay(state, playerId) {
        const p = state.players[playerId];
        if (!p) return;
        const count = state.hands[playerId]?.length || 0;
        if (count === 1) {
            p.unoRequired = true;
            p.saidUno = false;
        } else if (count > 1) {
            p.unoRequired = false;
            p.saidUno = false;
        }
    }

    function applyUnoPenaltyIfNeeded(state, playerId) {
        const p = state.players[playerId];
        const count = state.hands[playerId]?.length || 0;
        if (!p || count !== 1 || !p.unoRequired || p.saidUno) return false;
        applyDrawToPlayer(state, playerId, 1);
        p.unoRequired = false;
        p.saidUno = false;
        addLog(state, `${p.nickname} non ha detto UNO! Pesca 1.`);
        return true;
    }

    /** @returns {'win'|'penalty'|null} */
    function checkWinOrUnoPenalty(state, playerId) {
        const count = state.hands[playerId]?.length || 0;
        if (count !== 0 || state.status !== 'playing') return null;
        if (!state.players[playerId]?.saidUno) {
            applyDrawToPlayer(state, playerId, 1);
            const p = state.players[playerId];
            if (p) {
                p.saidUno = false;
                p.unoRequired = false;
            }
            addLog(state, `${state.players[playerId]?.nickname} non ha detto UNO! Pesca 1.`);
            return 'penalty';
        }
        declareWinner(state, playerId);
        return state.status === 'finished' ? 'win' : null;
    }

    function hasRighello(state, playerId) {
        return (state.hands[playerId] || []).some(c =>
            c.value === 'cancel' || c.defId === 'c_righello'
        );
    }

    function consumeRighello(state, playerId) {
        const hand = state.hands[playerId] || [];
        const idx = hand.findIndex(c => c.value === 'cancel' || c.defId === 'c_righello');
        if (idx === -1) return null;
        const [card] = hand.splice(idx, 1);
        syncHandCounts(state);
        return card;
    }

    function applyMariDrawLoop(state, playerId) {
        const name = state.players[playerId]?.nickname || playerId;
        let safety = 0;
        while (safety < 40) {
            safety += 1;
            const drawn = drawFromPile(state, 1);
            if (!drawn.length) {
                addLog(state, `${name}: mazzo esaurito durante Marihuana.`);
                break;
            }
            const c = drawn[0];
            if (c.color === 'green') {
                state.discardPile.push(c);
                state.topCard = c;
                state.activeColor = 'green';
                state.forcedColor = null;
                addLog(state, `${name} pesca Verde e la gioca.`);
                break;
            }
            state.hands[playerId].push(c);
            syncHandCounts(state);
            addLog(state, `${name} pesca ${Deck.cardDisplayName(c)} (in mano).`);
        }
    }

    function startBulletRoulette(state, shooterId) {
        const alive = state.turnOrder.filter(id => !state.players[id]?.eliminated);
        if (!alive.length) return;
        const hitId = alive[Math.floor(Math.random() * alive.length)];
        const n = alive.length;
        const hitIndex = alive.indexOf(hitId);
        const slice = 360 / n;
        const spinDeg = 360 * 8 - hitIndex * slice - slice / 2;

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
        return { ok: true, state: s };
    }

    function playCard(state, playerId, instanceId, options = {}) {
        const ids = options.instanceIds || [instanceId];
        return playCards(state, playerId, ids, options);
    }

    function playCards(state, playerId, instanceIds, options = {}) {
        const s = clone(state);
        if (s.pendingAction?.type === 'mariGreen') {
            return { ok: false, error: 'Rispondi all\'effetto Marijuana.' };
        }
        if (!isMyTurn(s, playerId)) {
            return { ok: false, error: 'Non è il tuo turno.' };
        }
        syncTurnFlags(s);
        if (s.turnFlags.played) {
            return { ok: false, error: 'Hai già giocato in questo turno. Premi Finisci Turno.' };
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
        if (!canPlayCardThisTurn(s, playerId, first)) {
            return { ok: false, error: 'Carta non giocabile.' };
        }

        if (cards.length > 1) {
            if (!isValidPlayGroup(s, cards)) {
                return { ok: false, error: 'Puoi giocare insieme solo carte con lo stesso numero o una scala 0→1→2…' };
            }
            if (isValidLadder(cards)) {
                cards.sort((a, b) => numberRank(a) - numberRank(b));
            }
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
        updateUnoStateAfterPlay(s, playerId);

        s.turnFlags.played = true;

        const effect = resolveCardEffect(s, playerId, card, options);
        if (!effect.ok) {
            return effect;
        }

        if (s.status !== 'finished') {
            const outcome = checkWinOrUnoPenalty(s, playerId);
            if (outcome === 'win' || s.status === 'finished') {
                return { ok: true, state: s, outcome };
            }
            if (outcome === 'penalty') {
                syncHandCounts(s);
                return { ok: true, state: s, outcome: 'penalty' };
            }
        } else {
            return { ok: true, state: s, outcome: 'win' };
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
                state.turnAdvanceSteps = (state.turnAdvanceSteps || 0) + 1;
                return { ok: true };
            case 'reverse':
                state.direction *= -1;
                addLog(state, `Direzione ${state.direction > 0 ? 'oraria' : 'antioraria'}.`);
                if (state.turnOrder.length === 2) {
                    state.turnAdvanceSteps = (state.turnAdvanceSteps || 0) + 1;
                }
                return { ok: true };
            case 'draw2':
                if (settings.stack && (state.drawStackType === 'draw2' || state.drawStack === 0)) {
                    state.drawStack += 2;
                    state.drawStackType = 'draw2';
                    addLog(state, `Stack +2 (totale ${state.drawStack}).`);
                } else {
                    applyDrawToPlayer(state, nextPlayerId(state), 2);
                    state.turnAdvanceSteps = (state.turnAdvanceSteps || 0) + 1;
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
                state.turnAdvanceSteps = (state.turnAdvanceSteps || 0) + 1;
                return { ok: true };
            case 'draw16':
                applyDrawToPlayer(state, nextPlayerId(state), 16);
                state.turnAdvanceSteps = (state.turnAdvanceSteps || 0) + 1;
                return { ok: true };
            case 'death': {
                const target = options.targetId || nextPlayerId(state);
                openCounterWindow(state, playerId, card, { targetId: target });
                return { ok: true, defer: true };
            }
            case 'blobby': {
                const target = options.targetId || nextPlayerId(state);
                openCounterWindow(state, playerId, card, { targetId: target });
                return { ok: true, defer: true };
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
                startMariEffect(state, playerId);
                return { ok: true, skipAdvance: true };
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
                    const undone = state.discardPile.pop();
                    if (undone) {
                        state.topCard = state.discardPile[state.discardPile.length - 1] || undone;
                        if (state.topCard.color && state.topCard.color !== 'black') {
                            state.activeColor = state.topCard.color;
                        }
                        addLog(state, `Righello annulla ${Deck.cardDisplayName(undone)}.`);
                    }
                }
                return { ok: true };
            }
            case 'reset':
                state.drawStack = 0;
                state.drawStackType = null;
                state.forcedColor = null;
                state.pendingColor = false;
                if (state.pendingAction?.type !== 'defense') {
                    state.pendingAction = null;
                }
                addLog(state, 'Donna di Mazze: catene ed effetti globali annullati.');
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

        if (s.pendingAction?.type === 'mariGreen') {
            return resolveMariByDraw(s, playerId);
        }

        if (!canDraw(s, playerId)) {
            if (currentPlayerId(s) !== playerId) {
                return { ok: false, error: 'Non è il tuo turno.' };
            }
            syncTurnFlags(s);
            if (s.turnFlags.drawn) {
                return { ok: false, error: 'Hai già pescato in questo turno.' };
            }
            if (hasPlayableCard(s, playerId)) {
                return { ok: false, error: 'Hai carte giocabili: gioca o termina il turno.' };
            }
            return { ok: false, error: 'Non puoi pescare ora.' };
        }

        syncTurnFlags(s);

        if (s.drawStack > 0) {
            const n = applyDrawToPlayer(s, playerId, s.drawStack);
            addLog(s, `${s.players[playerId]?.nickname} pesca ${n} (stack).`);
            s.drawStack = 0;
            s.drawStackType = null;
            s.turnFlags.drawn = true;
            syncHandCounts(s);
            return { ok: true, state: s };
        }

        const n = applyDrawToPlayer(s, playerId, 1);
        if (n === 0) return { ok: false, error: 'Mazzo vuoto.' };
        addLog(s, `${s.players[playerId]?.nickname} pesca 1.`);
        s.turnFlags.drawn = true;
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
            s.turnAdvanceSteps = (s.turnAdvanceSteps || 0) + 1;
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
        if (s.status === 'finished') {
            return { ok: true, state: s };
        }
        return { ok: true, state: s };
    }

    function declareUno(state, playerId) {
        const s = clone(state);
        const count = s.hands[playerId]?.length || 0;
        if (count !== 1) {
            return { ok: false, error: 'Puoi dire UNO! solo con 1 carta in mano.' };
        }
        const p = s.players[playerId];
        if (p) {
            p.saidUno = true;
            p.unoRequired = false;
        }
        addLog(s, `${s.players[playerId]?.nickname} dice UNO!`);
        return { ok: true, state: s };
    }

    function respondDefense(state, defenderId, useRighello) {
        const s = clone(state);
        const pending = s.pendingAction;
        if (!pending || pending.type !== 'defense' || pending.defenderId !== defenderId) {
            return { ok: false, error: 'Nessuna difesa richiesta.' };
        }

        if (useRighello) {
            if (!hasRighello(s, defenderId)) {
                return { ok: false, error: 'Non hai un Righello.' };
            }
            const used = consumeRighello(s, defenderId);
            addLog(s, `${s.players[defenderId]?.nickname} usa ${used?.righelloLabel || used?.label || 'Righello'}: effetto annullato!`);
            s.pendingAction = null;
            nextTurn(s, 1);
            return { ok: true, state: s };
        }

        if (pending.effect === 'death') {
            eliminatePlayer(s, pending.defenderId);
            addLog(s, `Death Note elimina ${s.players[pending.defenderId]?.nickname}.`);
            checkLastPlayerStanding(s, pending.attackerId);
        }
        s.pendingAction = null;
        if (s.status === 'playing') nextTurn(s, 1);
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
        canEndTurn,
        isCounterWindow,
        canPlayCounter,
        canPlayCard,
        canPlayCardThisTurn,
        canDraw,
        hasPlayableCard,
        hasPlayableCardThisTurn,
        cardStackKey,
        getMatchingPlayableCards,
        getSameNumberBatch,
        getSameColorBatch,
        getLadderPlay,
        playMariGreenCard,
        canPlayMariGreen,
        isValidLadder,
        isValidPlayGroup,
        playCard,
        playCards,
        playCounterCard,
        resolveCounterWindow,
        drawCard,
        chooseColor,
        chooseTarget,
        declareUno,
        endTurn,
        leaveGame,
        respondDefense,
        spinBulletRoulette,
        removePlayerFromGame,
        stripForFirestore,
        topMatches,
        comboValueKey,
        COUNTER_WINDOW_MS
    };
})(window);
