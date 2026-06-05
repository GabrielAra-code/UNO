(function (global) {
    const Deck = global.GameDeck;
    const COUNTER_WINDOW_MS = 5000;
    const COUNTER_RULES = {
        blobby: { allowed: ['cancel', 'shield'] },
        death: { allowed: ['cancel'] }
    };

    const BRAINROT_DISCARD_BY_COLOR = { yellow: 2, white: 4, pink: 3, blue: 1 };
    const PLAY_COLORS = ['red', 'yellow', 'green', 'blue'];

    function isValidPlayColor(color) {
        return PLAY_COLORS.includes(color);
    }

    function isBrainrotCard(card) {
        return Deck.isBrainrotCard ? Deck.isBrainrotCard(card) : (card?.kind === 'brainrot' || card?.value === 'brainrot');
    }

    function isPendingTimedWindow(pending) {
        return pending && ['counterWindow', 'brainrotBattle', 'drawStackWindow'].includes(pending.type)
            && typeof pending.resolvesAt === 'number';
    }

    function brainrotEntryFromCard(playerId, card) {
        return {
            playerId,
            instanceId: card.instanceId,
            defId: card.brainrotId || card.defId,
            pt: card.pt || 0,
            battleColor: card.battleColor || 'blue',
            nome: card.brainrotName || card.label,
            label: card.label
        };
    }

    function isBrainrotBattle(state) {
        return state.pendingAction?.type === 'brainrotBattle';
    }

    function isDrawStackWindow(state) {
        return state.pendingAction?.type === 'drawStackWindow';
    }

    function isBrainrotDiscardPhase(state) {
        return state.pendingAction?.type === 'brainrotDiscard';
    }

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
            stackPassPending: false,
            stackDefenderId: null,
            stackSourcePlayerId: null,
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

    function isRighelloCard(card) {
        return !!card && (card.value === 'cancel' || card.defId === 'c_righello');
    }

    function canPlayCounter(state, playerId, card) {
        const pending = state.pendingAction;
        if (!pending || pending.type !== 'counterWindow') return false;
        if (playerId === pending.sourcePlayerId) return false;
        if (pending.responses?.[playerId]) return false;
        const rules = COUNTER_RULES[pending.cardValue];
        if (!rules) return false;
        if (isRighelloCard(card)) return true;
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
        if (pending?.type === 'brainrotBattle') return canPlayBrainrotResponse(state, myId);
        if (pending?.type === 'brainrotDiscard') return pending.winnerId === myId;
        if (pending?.type === 'drawStackWindow') return canPlayDrawStackResponse(state, myId, { probe: true });
        if (pending?.playerId === myId) {
            if (pending.type === 'chooseColor' || pending.type === 'chooseTarget') return true;
        }
        if (pending && pending.type !== 'bulletRoulette') return false;
        if (state.stackPassPending && state.stackSourcePlayerId === myId && !isDrawStackWindow(state)) {
            return true;
        }
        if (state.drawStack > 0 && !isDrawStackWindow(state) && !state.stackPassPending) {
            return currentPlayerId(state) === myId;
        }
        return currentPlayerId(state) === myId;
    }

    function canEndTurn(state, playerId) {
        if (state.status !== 'playing' || currentPlayerId(state) !== playerId) return false;
        if (isCounterWindow(state) || isBrainrotBattle(state) || isBrainrotDiscardPhase(state) || isDrawStackWindow(state)) {
            return false;
        }
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

    function openBrainrotBattle(state, initiatorId, starterCard) {
        const entry = brainrotEntryFromCard(initiatorId, starterCard);
        state.pendingAction = {
            type: 'brainrotBattle',
            initiatorId,
            startedAt: Date.now(),
            resolvesAt: Date.now() + COUNTER_WINDOW_MS,
            entries: { [initiatorId]: entry }
        };
        addLog(state, `Brainrot Battle! ${entry.nome} (${entry.pt}PT) — 5s per rispondere.`);
    }

    function canPlayBrainrotResponse(state, playerId) {
        const pending = state.pendingAction;
        if (!pending || pending.type !== 'brainrotBattle') return false;
        if (pending.entries?.[playerId]) return false;
        if (state.players[playerId]?.eliminated) return false;
        return (state.hands[playerId] || []).some(c => isBrainrotCard(c));
    }

    function pickBrainrotWinner(pending) {
        const entries = Object.values(pending.entries || {});
        if (!entries.length) return pending.initiatorId;
        const maxPt = Math.max(...entries.map(e => e.pt));
        const top = entries.filter(e => e.pt === maxPt);
        const init = top.find(e => e.playerId === pending.initiatorId);
        return (init || top[0]).playerId;
    }

    function brainrotBattleCanClose(state) {
        const pending = state.pendingAction;
        if (!pending || pending.type !== 'brainrotBattle') return false;

        const timerExpired = !!(pending.resolvesAt && Date.now() >= pending.resolvesAt - 150);
        const otherActive = activePlayers(state).filter(id => id !== pending.initiatorId);

        // Con altri giocatori in campo: finestra fissa 5s (come contrasto/stack), anche se nessuno ha Brainrot
        if (otherActive.length > 0) return timerExpired;

        // Solo iniziatore rimasto attivo: nessuna risposta possibile
        return true;
    }

    function finishBrainrotBattleIfReady(state) {
        const pending = state.pendingAction;
        if (!pending || pending.type !== 'brainrotBattle') {
            return { ok: false, state };
        }
        if (!brainrotBattleCanClose(state)) {
            return { ok: false, state };
        }
        return resolveBrainrotBattle(state, pending.initiatorId, { force: true });
    }

    function startBrainrotDiscardPhase(state, winnerId, battleColor) {
        const maxDiscard = BRAINROT_DISCARD_BY_COLOR[battleColor] || 1;
        const winnerEntry = state.pendingAction?.entries?.[winnerId];
        const colorLabel = Deck.BRAINROT_BATTLE_COLOR_LABEL?.[battleColor] || battleColor;
        state.pendingAction = {
            type: 'brainrotDiscard',
            winnerId,
            battleColor,
            maxDiscard,
            startedAt: Date.now(),
            winningPt: winnerEntry?.pt,
            winningName: winnerEntry?.nome
        };
        addLog(state, `${state.players[winnerId]?.nickname} vince Brainrot (${colorLabel}): scarta fino a ${maxDiscard} carte (solo numeri).`);
    }

    function resolveBrainrotBattle(state, playerId, options = {}) {
        const s = clone(state);
        const pending = s.pendingAction;
        if (!pending || pending.type !== 'brainrotBattle') {
            return { ok: false, error: 'Nessuna battaglia Brainrot attiva.' };
        }
        const graceMs = options.force ? 150 : 0;
        const expired = Date.now() >= pending.resolvesAt - graceMs;
        if (!expired && !options.force && playerId !== pending.initiatorId) {
            return { ok: false, error: 'Attendi la fine del countdown Brainrot.' };
        }

        const winnerId = pickBrainrotWinner(pending);
        const winnerEntry = pending.entries[winnerId];
        const battleColor = winnerEntry?.battleColor || 'blue';
        addLog(s, `${s.players[winnerId]?.nickname} vince con ${winnerEntry?.nome || 'Brainrot'} (${winnerEntry?.pt || 0}PT).`);

        startBrainrotDiscardPhase(s, winnerId, battleColor);
        return { ok: true, state: s };
    }

    function playBrainrotResponse(state, playerId, instanceId) {
        const s = clone(state);
        const pending = s.pendingAction;
        if (!pending || pending.type !== 'brainrotBattle') {
            return { ok: false, error: 'Nessuna battaglia Brainrot attiva.' };
        }
        if (pending.entries?.[playerId]) {
            return { ok: false, error: 'Hai già giocato un Brainrot in questo scontro.' };
        }
        const card = removeFromHand(s.hands, playerId, instanceId);
        if (!card || !isBrainrotCard(card)) {
            if (card) s.hands[playerId].push(card);
            return { ok: false, error: 'Carta Brainrot non valida.' };
        }

        s.discardPile.push(card);
        s.topCard = card;
        pending.entries[playerId] = brainrotEntryFromCard(playerId, card);
        syncHandCounts(s);
        addLog(s, `${s.players[playerId]?.nickname} risponde con ${card.brainrotName || card.label} (${card.pt}PT).`);
        const finished = finishBrainrotBattleIfReady(s);
        return finished.ok ? finished : { ok: true, state: s };
    }

    function isDiscardableNumberCard(card) {
        if (!card) return false;
        if (card.kind === 'number') return true;
        const n = Number(card.value);
        return !Number.isNaN(n) && n >= 0 && n <= 9 && card.kind !== 'brainrot' && card.kind !== 'action';
    }

    function canBrainrotDiscardCard(state, playerId, card) {
        const pending = state.pendingAction;
        if (!pending || pending.type !== 'brainrotDiscard') return false;
        if (pending.winnerId !== playerId) return false;
        return isDiscardableNumberCard(card);
    }

    function resolveBrainrotDiscard(state, playerId, instanceIds = [], options = {}) {
        const s = clone(state);
        const pending = s.pendingAction;
        if (!pending || pending.type !== 'brainrotDiscard') {
            return { ok: false, error: 'Nessuna fase di scarto Brainrot.' };
        }
        if (playerId !== pending.winnerId) {
            return { ok: false, error: 'Solo il vincitore può scartare.' };
        }
        const ids = Array.isArray(instanceIds) ? instanceIds : [];

        const hand = s.hands[playerId] || [];
        const toDiscard = [];
        ids.forEach(id => {
            const c = hand.find(x => x.instanceId === id);
            if (c && canBrainrotDiscardCard(s, playerId, c)) toDiscard.push(c);
        });
        if (ids.length > 0 && toDiscard.length !== ids.length) {
            return { ok: false, error: 'Puoi scartare solo carte numeriche senza effetti.' };
        }
        if (toDiscard.length > pending.maxDiscard) {
            return { ok: false, error: `Puoi scartare al massimo ${pending.maxDiscard} carte.` };
        }

        toDiscard.forEach(c => {
            removeFromHand(s.hands, playerId, c.instanceId);
            s.discardPile.push(c);
        });
        if (toDiscard.length) {
            s.topCard = toDiscard[toDiscard.length - 1];
            if (s.topCard.color && s.topCard.color !== 'black') s.activeColor = s.topCard.color;
        }
        syncHandCounts(s);
        addLog(s, `${s.players[playerId]?.nickname} scarta ${toDiscard.length} carta/e (Brainrot).`);

        const count = s.hands[playerId]?.length || 0;
        s.pendingAction = null;
        if (count === 0) {
            declareWinner(s, playerId);
            return { ok: true, state: s, outcome: 'win' };
        }

        return { ok: true, state: s };
    }

    function isStackDrawValue(value) {
        return value === 'draw2' || value === 'wild4' || value === 'draw10' || value === 'draw16';
    }

    function clearStackPassState(state) {
        state.stackPassPending = false;
        state.stackDefenderId = null;
        state.stackSourcePlayerId = null;
        state.drawStack = 0;
        state.drawStackType = null;
    }

    /** Applica penalità stack e avanza il turno (salta chi ha pescato). */
    function resolveStackPenaltyAndAdvance(state, defenderId, amount, options = {}) {
        if (amount > 0 && defenderId && state.players[defenderId]) {
            const n = applyDrawToPlayer(state, defenderId, amount);
            if (options.hadMirror) {
                addLog(state, `Specchio: ${state.players[defenderId]?.nickname} pesca ${n} (stack risolto).`);
            } else {
                addLog(state, `${state.players[defenderId]?.nickname} pesca ${n} (stack risolto).`);
            }
            state.turnAdvanceSteps = (state.turnAdvanceSteps || 0) + 1;
        }
        clearStackPassState(state);
        state.pendingAction = null;
        const steps = Math.max(1, state.turnAdvanceSteps || 0);
        state.turnAdvanceSteps = 0;
        if (state.status === 'playing') {
            nextTurn(state, steps);
        }
    }

    /** Senza modalità stack: +2/+4 si risolvono subito dopo la giocata (niente Fine turno / 5s). */
    function tryAutoResolveStackPass(state) {
        if (state.settings?.stack) return false;
        if (!state.stackPassPending || state.drawStack <= 0) return false;
        if (state.pendingColor) return false;
        const blocking = state.pendingAction?.type;
        if (blocking && blocking !== 'bulletRoulette') return false;

        const defender = state.stackDefenderId || nextPlayerId(state);
        const amount = state.drawStack;
        clearStackPassState(state);
        if (amount > 0) {
            const n = applyDrawToPlayer(state, defender, amount);
            addLog(state, `${state.players[defender]?.nickname} pesca ${n} (penalità).`);
        }
        if (state.status === 'playing') {
            nextTurn(state, 2);
        }
        return true;
    }

    /** Accumula +2/+4/+10/+16 in attesa di Fine turno (non apre subito la finestra 5s). */
    function addToStackPass(state, playerId, amount, stackType) {
        const defender = nextPlayerId(state);
        if (state.stackPassPending && state.stackSourcePlayerId === playerId && state.settings?.stack) {
            state.drawStack += amount;
            state.drawStackType = stackType;
            addLog(state, `Stack +${amount} (totale ${state.drawStack}).`);
        } else {
            state.drawStack = amount;
            state.drawStackType = stackType;
            state.stackPassPending = true;
            state.stackDefenderId = defender;
            state.stackSourcePlayerId = playerId;
            addLog(state, `Stack +${amount} — premi Fine turno per passarlo.`);
        }
    }

    /** Durante accumulo stack nel proprio turno: solo altre +2/+4/+10/+16. */
    function canStackOnOwnTurn(state, playerId, card) {
        if (!state.settings?.stack || !state.stackPassPending) return false;
        if (state.stackSourcePlayerId !== playerId) return false;
        return isStackDrawValue(card?.value);
    }

    function openDrawStackWindow(state, defenderId, sourcePlayerId) {
        if (state.drawStack <= 0) return;
        if (!state.settings?.stack) {
            resolveStackPenaltyAndAdvance(state, defenderId, state.drawStack);
            return;
        }
        state.stackPassPending = false;
        state.stackDefenderId = null;
        state.stackSourcePlayerId = null;
        state.pendingAction = {
            type: 'drawStackWindow',
            defenderId,
            sourcePlayerId,
            drawStack: state.drawStack,
            drawStackType: state.drawStackType,
            startedAt: Date.now(),
            resolvesAt: Date.now() + COUNTER_WINDOW_MS,
            responses: {}
        };
        addLog(state, `Stack +${state.drawStack}: ${state.players[defenderId]?.nickname} ha 5s (Specchio / +2 / +4 / +10 / +16).`);
    }

    function isTimedWindowOpen(pending, graceMs = 0) {
        if (!pending?.resolvesAt) return true;
        return Date.now() < pending.resolvesAt - graceMs;
    }

    function canPlayDrawStackResponse(state, playerId, cardOrProbe) {
        const pending = state.pendingAction;
        if (!pending || pending.type !== 'drawStackWindow') return false;
        if (!isTimedWindowOpen(pending)) return false;
        if (!state.settings?.stack) return false;
        if (state.players[playerId]?.eliminated) return false;
        if (pending.responses?.[playerId]) return false;
        if (playerId !== pending.defenderId) return false;

        const card = cardOrProbe?.probe ? null : cardOrProbe;
        const canMirror = (c) => c?.value === 'mirror';
        const canStackOnDraw = (c) => {
            if (!c) return false;
            if (c.value === 'wild4' || c.value === 'draw10' || c.value === 'draw16') return true;
            if (c.value === 'draw2' && pending.drawStackType === 'draw2') return true;
            return false;
        };

        if (cardOrProbe?.probe) {
            const hand = state.hands[playerId] || [];
            return hand.some(c => canMirror(c) || canStackOnDraw(c));
        }
        if (!card) return false;
        if (canMirror(card) || canStackOnDraw(card)) return true;
        return false;
    }

    function playDrawStackResponse(state, playerId, instanceId) {
        const s = clone(state);
        const pending = s.pendingAction;
        if (!pending || pending.type !== 'drawStackWindow') {
            return { ok: false, error: 'Nessuna finestra stack attiva.' };
        }
        if (!isTimedWindowOpen(pending)) {
            return { ok: false, error: 'Tempo per contrastare scaduto.' };
        }
        if (pending.responses?.[playerId]) {
            return { ok: false, error: 'Hai già risposto allo stack.' };
        }
        if (playerId !== pending.defenderId) {
            return { ok: false, error: 'Solo chi subisce lo stack può rispondere.' };
        }

        const card = removeFromHand(s.hands, playerId, instanceId);
        if (!card || !canPlayDrawStackResponse(s, playerId, card)) {
            if (card) s.hands[playerId].push(card);
            return { ok: false, error: 'Carta non valida per rispondere allo stack.' };
        }

        s.discardPile.push(card);
        s.topCard = card;
        if (!pending.responses) pending.responses = {};

        if (card.value === 'mirror') {
            const oldDef = pending.defenderId;
            pending.defenderId = pending.sourcePlayerId;
            pending.sourcePlayerId = oldDef;
            s.direction *= -1;
            pending.responses = { [playerId]: { action: 'mirror', cardValue: 'mirror' } };
            addLog(
                s,
                `${s.players[playerId]?.nickname} usa Specchio: stack su ${s.players[pending.defenderId]?.nickname}! Direzione invertita.`
            );
            pending.startedAt = Date.now();
            pending.resolvesAt = Date.now() + COUNTER_WINDOW_MS;
        } else if (card.value === 'draw2') {
            pending.drawStack += 2;
            pending.defenderId = nextPlayerId(s, pending.defenderId);
            pending.sourcePlayerId = playerId;
            s.drawStack = pending.drawStack;
            pending.responses[playerId] = { action: 'stack', addAmount: 2, cardValue: 'draw2' };
            addLog(s, `Stack +2 (totale ${pending.drawStack}).`);
        } else if (card.value === 'wild4') {
            pending.drawStack += 4;
            pending.defenderId = nextPlayerId(s, pending.defenderId);
            pending.sourcePlayerId = playerId;
            s.drawStack = pending.drawStack;
            s.drawStackType = 'wild4';
            pending.drawStackType = 'wild4';
            pending.responses[playerId] = { action: 'stack', addAmount: 4, cardValue: 'wild4' };
            addLog(s, `Stack +4 (totale ${pending.drawStack}).`);
        } else if (card.value === 'draw10') {
            pending.drawStack += 10;
            pending.defenderId = nextPlayerId(s, pending.defenderId);
            pending.sourcePlayerId = playerId;
            s.drawStack = pending.drawStack;
            s.drawStackType = 'draw10';
            pending.drawStackType = 'draw10';
            pending.responses[playerId] = { action: 'stack', addAmount: 10, cardValue: 'draw10' };
            addLog(s, `Stack +10 (totale ${pending.drawStack}).`);
        } else if (card.value === 'draw16') {
            pending.drawStack += 16;
            pending.defenderId = nextPlayerId(s, pending.defenderId);
            pending.sourcePlayerId = playerId;
            s.drawStack = pending.drawStack;
            s.drawStackType = 'draw16';
            pending.drawStackType = 'draw16';
            pending.responses[playerId] = { action: 'stack', addAmount: 16, cardValue: 'draw16' };
            addLog(s, `Stack +16 (totale ${pending.drawStack}).`);
        }

        pending.startedAt = Date.now();
        pending.resolvesAt = Date.now() + COUNTER_WINDOW_MS;

        syncHandCounts(s);
        return { ok: true, state: s };
    }

    function resolveDrawStackWindow(state, playerId, options = {}) {
        const s = clone(state);
        const pending = s.pendingAction;
        if (!pending || pending.type !== 'drawStackWindow') {
            if (options.force) return { ok: true, state: s };
            return { ok: false, error: 'Nessuna finestra stack attiva.' };
        }
        const graceMs = options.force ? 150 : 0;
        const expired = Date.now() >= pending.resolvesAt - graceMs;
        if (!expired && !options.force) {
            return { ok: false, error: 'Attendi la fine del countdown stack.' };
        }

        const defenderId = pending.defenderId;
        const amount = pending.drawStack;
        const drawStackType = pending.drawStackType;
        const responses = pending.responses || {};
        const hadMirror = Object.values(responses).some(r => r.action === 'mirror');

        console.log('[RESOLVING CARD EFFECT]', {
            type: 'drawStackWindow',
            drawStackType,
            amount,
            defenderId,
            hadMirror,
            responses: Object.keys(responses).length
        });

        if (amount > 0) {
            console.log(`[DRAWING ${amount} CARDS]`, defenderId);
        }
        resolveStackPenaltyAndAdvance(s, defenderId, amount, { hadMirror });

        syncHandCounts(s);
        return { ok: true, state: s };
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

    function resolveCounterWindow(state, playerId, options = {}) {
        const s = clone(state);
        const pending = s.pendingAction;
        if (!pending || pending.type !== 'counterWindow') {
            return { ok: false, error: 'Nessuna finestra di contrasto attiva.' };
        }
        const expired = Date.now() >= pending.resolvesAt;
        const force = options.force === true;
        if (!force && !expired && playerId !== pending.sourcePlayerId) {
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

        const rules = COUNTER_RULES[pending.cardValue];
        const instantCancel = isRighelloCard(card)
            || (card.value === 'shield' && rules?.allowed?.includes('shield'));
        if (instantCancel) {
            return resolveCounterWindow(s, playerId, { force: true });
        }

        return { ok: true, state: s };
    }

    function endTurn(state, playerId) {
        const s = clone(state);
        if (!canEndTurn(s, playerId)) {
            return { ok: false, error: 'Non puoi terminare il turno ora.' };
        }
        applyUnoPenaltyIfNeeded(s, playerId);

        if (s.stackPassPending && s.drawStack > 0) {
            const defender = s.stackDefenderId || nextPlayerId(s);
            const source = s.stackSourcePlayerId || playerId;
            openDrawStackWindow(s, defender, source);
            s.turnAdvanceSteps = (s.turnAdvanceSteps || 0) + 1;
            addLog(
                s,
                `${s.players[playerId]?.nickname} passa lo stack +${s.drawStack} a ${s.players[defender]?.nickname}.`
            );
            return { ok: true, state: s, defer: true };
        }

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

    function topRequiresChosenColor(top) {
        if (!top) return false;
        return top.value === 'wild' || top.value === 'wild4'
            || top.color === 'black' || top.kind === 'wild' || top.color === 'wild';
    }

    function effectiveTopColor(state) {
        const top = state.topCard;
        if (!top) {
            return isValidPlayColor(state.activeColor) ? state.activeColor : null;
        }
        if (topRequiresChosenColor(top)) {
            return isValidPlayColor(state.activeColor) ? state.activeColor : null;
        }
        if (isValidPlayColor(top.color)) return top.color;
        return isValidPlayColor(state.activeColor) ? state.activeColor : null;
    }

    function getDisplayColorInfo(state) {
        if (!state) return { label: '—', cssColor: 'slate' };
        if (state.pendingAction?.type === 'mariGreen' && state.forcedColor) {
            const lbl = Deck.COLOR_LABEL[state.forcedColor] || state.forcedColor;
            return { label: `Vincolo: ${lbl}`, cssColor: state.forcedColor };
        }
        if (state.pendingColor) {
            return { label: 'Scegli colore', cssColor: 'slate' };
        }
        const eff = effectiveTopColor(state);
        if (eff) {
            return { label: `Colore: ${Deck.COLOR_LABEL[eff] || eff}`, cssColor: eff };
        }
        if (topRequiresChosenColor(state.topCard)) {
            return { label: 'Colore: da scegliere', cssColor: 'slate' };
        }
        return { label: 'Colore: —', cssColor: 'slate' };
    }

    /** Jolly, +4 e speciali nere/incolore: giocabili sul mazzo in tavola (salvo stack +2/+4). */
    function isFreePlayCard(card) {
        if (!card) return false;
        if (card.value === 'mirror') return false;
        if (isBrainrotCard(card)) return true;
        if (card.value === 'wild' || card.value === 'wild4') return true;
        if (card.kind === 'wild') return true;
        if (card.kind === 'special' && card.color === 'black') return true;
        return false;
    }

    /** Carta speciale incolore/jolly sul mazzo: le numeriche possono esserci giocate sopra. */
    function isIncolorSpecialTop(top) {
        if (!top) return false;
        if (top.color === 'wild' || top.kind === 'wild') return true;
        if (top.value === 'surprise') return true;
        if (top.kind === 'special' && (top.color === 'black' || top.color === 'wild')) return true;
        return false;
    }

    /** Gioco singolo di una numerica (stesso numero, stesso colore attivo, o mazzo incolore/speciale). */
    function numberCardMatchesTop(state, card) {
        const top = state.topCard;
        if (!top || card?.kind !== 'number') return false;
        if (String(card.value) === String(top.value)) return true;
        const effectiveColor = effectiveTopColor(state);
        if (effectiveColor && isValidPlayColor(card.color) && card.color === effectiveColor) {
            return true;
        }
        if (isIncolorSpecialTop(top)) return true;
        return false;
    }

    /** Ultima carta della scala: stesso numero, colore attivo, o mazzo incolore/speciale. */
    function ladderAnchorMatchesTop(state, anchor) {
        const top = state.topCard;
        if (!top || anchor?.kind !== 'number') return false;
        if (String(anchor.value) === String(top.value)) return true;
        if (isIncolorSpecialTop(top)) return true;
        const effectiveColor = effectiveTopColor(state);
        if (effectiveColor && isValidPlayColor(anchor.color) && anchor.color === effectiveColor) {
            return true;
        }
        return false;
    }

    function topMatches(card, state) {
        const top = state.topCard;
        if (!top || !card) return false;

        if (isFreePlayCard(card)) return true;

        if (state.pendingAction?.type === 'mariGreen' && state.forcedColor) {
            return card.color === state.forcedColor || isFreePlayCard(card);
        }

        if (card.kind === 'number') {
            return numberCardMatchesTop(state, card);
        }

        if (String(card.value) === String(top.value)) return true;

        const effectiveColor = effectiveTopColor(state);
        if (effectiveColor && isValidPlayColor(card.color) && card.color === effectiveColor) {
            return true;
        }

        return false;
    }

    function hasPlayableCard(state, playerId) {
        const hand = state.hands[playerId] || [];
        return hand.some(c => canPlayCard(state, c, playerId));
    }

    function syncTurnFlags(state) {
        const pid = currentPlayerId(state);
        if (!state.turnFlags || state.turnFlags.playerId !== pid) {
            state.turnFlags = { playerId: pid, drawn: false, played: false };
        }
    }

    /** Solo le carte numeriche possono svuotare la mano e chiudere la partita. */
    function isWinningFinishCard(card) {
        return card?.kind === 'number';
    }

    function handSizeAfterPlay(state, playerId, cards) {
        const handLen = (state.hands[playerId] || []).length;
        let removed = cards.length;
        if (cards.some(c => c.value === 'blobby') && hasShield(state, playerId)) {
            removed += 1;
        }
        return handLen - removed;
    }

    function blocksFinishingPlay(state, playerId, cards) {
        if (!cards?.length) return false;
        if (handSizeAfterPlay(state, playerId, cards) !== 0) return false;
        return !cards.every(isWinningFinishCard);
    }

    function canPlayCard(state, card, playerId) {
        if (state.status !== 'playing') return false;
        if (card?.value === 'mirror' && state.pendingAction?.type !== 'drawStackWindow') return false;
        const pending = state.pendingAction;
        const pid = playerId || currentPlayerId(state);
        if (pending?.type === 'counterWindow') {
            return canPlayCounter(state, pid, card);
        }
        if (pending?.type === 'brainrotBattle') {
            return isBrainrotCard(card) && canPlayBrainrotResponse(state, pid);
        }
        if (pending?.type === 'drawStackWindow') {
            return canPlayDrawStackResponse(state, pid, card);
        }
        if (pending?.type === 'mariGreen') {
            return canPlayMariGreen(state, pid, card);
        }
        if (state.stackPassPending && state.stackSourcePlayerId === pid && !isDrawStackWindow(state)) {
            return canStackOnOwnTurn(state, pid, card);
        }
        if (state.drawStack > 0 && pending?.type !== 'drawStackWindow' && !state.stackPassPending) {
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
        if (state.pendingAction?.type === 'counterWindow') {
            return canPlayCounter(state, playerId, card);
        }
        if (state.pendingAction?.type === 'mariGreen') {
            return canPlayMariGreen(state, playerId, card);
        }
        if (isBrainrotBattle(state)) {
            return canPlayBrainrotResponse(state, playerId) && isBrainrotCard(card);
        }
        if (isDrawStackWindow(state)) {
            return canPlayDrawStackResponse(state, playerId, card);
        }
        if (isBrainrotDiscardPhase(state)) return false;
        if (currentPlayerId(state) !== playerId) return false;
        if (!canPlayCard(state, card)) return false;
        syncTurnFlags(state);
        if (state.turnFlags.played && !canStackOnOwnTurn(state, playerId, card)) return false;
        if (card.value === 'blobby' && !hasShield(state, playerId)) return false;
        if (blocksFinishingPlay(state, playerId, [card])) return false;
        return true;
    }

    function hasPlayableCardThisTurn(state, playerId) {
        const hand = state.hands[playerId] || [];
        return hand.some(c => canPlayCardThisTurn(state, playerId, c));
    }

    function canDraw(state, playerId) {
        if (state.status !== 'playing') return false;
        const pending = state.pendingAction;
        if (pending?.type === 'mariGreen') {
            return pending.currentId === playerId;
        }
        if (currentPlayerId(state) !== playerId) return false;
        if (pending?.type === 'counterWindow' || pending?.type === 'bulletRoulette') return false;
        if (isBrainrotBattle(state) || isBrainrotDiscardPhase(state) || isDrawStackWindow(state)) return false;
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
        if (!state.pendingAction || state.pendingAction.type !== 'drawStackWindow') {
            state.stackPassPending = false;
            state.stackDefenderId = null;
            state.stackSourcePlayerId = null;
        }
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
        if (!card || state.players[playerId]?.eliminated) return false;
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

    /** Identità per copie giocabili insieme (numeri: stesso valore; azioni: colore+tipo; speciali: variante). */
    function cardDuplicateKey(card) {
        if (!card) return '';
        if (card.kind === 'number') {
            return `numVal:${card.value}`;
        }
        if (card.kind === 'action') {
            return `act:${card.color}:${card.value}`;
        }
        const variant = card.righelloLabel || card.planPart || '';
        return `spec:${card.defId || ''}:${card.value}:${variant}`;
    }

    /** Raggruppamento multi-gioco: stesso valore anche con colori diversi (numeri e +2/salta/inverti). */
    function cardMultiPlayKey(card) {
        if (!card) return '';
        if (card.kind === 'number') {
            return `numVal:${card.value}`;
        }
        if (card.kind === 'action' && ['skip', 'reverse', 'draw2'].includes(card.value)) {
            return `actVal:${card.value}`;
        }
        return cardDuplicateKey(card);
    }

    function isSixSevenValue(card) {
        if (!card || card.kind !== 'number') return false;
        const n = Number(card.value);
        return n === 6 || n === 7;
    }

    function getSixSevenBatch(state, playerId, instanceId) {
        const hand = state.hands[playerId] || [];
        const card = hand.find(c => c.instanceId === instanceId);
        if (!isSixSevenValue(card)) return card ? [card] : [];
        if (currentPlayerId(state) !== playerId) return [card];
        syncTurnFlags(state);
        if (state.turnFlags.played) return [card];

        const sixes = hand.filter(c => Number(c.value) === 6 && canPlayCard(state, c, playerId));
        const sevens = hand.filter(c => Number(c.value) === 7 && canPlayCard(state, c, playerId));
        if (!sixes.length || !sevens.length) return [card];

        return [...sixes, ...sevens];
    }

    function isValidSixSeven(cards) {
        if (!cards?.length || cards.length < 2) return false;
        const has6 = cards.some(c => Number(c.value) === 6);
        const has7 = cards.some(c => Number(c.value) === 7);
        if (!has6 || !has7) return false;
        return cards.every(c => c.kind === 'number' && (Number(c.value) === 6 || Number(c.value) === 7));
    }

    function canPlaySixSevenBatch(state, playerId, cards) {
        if (!isValidSixSeven(cards)) return false;
        if (currentPlayerId(state) !== playerId) return false;
        syncTurnFlags(state);
        if (state.turnFlags.played) return false;
        return cards.every(c => canPlayCard(state, c, playerId));
    }

    function allowsMultiDuplicatePlay(card) {
        if (!card) return false;
        if (card.kind === 'number') return true;
        const v = card.value;
        if (v === 'cancel') return true;
        if (['skip', 'reverse', 'draw2'].includes(v) && card.kind === 'action') return true;
        if (['reset', 'vaff', 'waves', 'halfdraw', 'reshuffle', 'draw10', 'draw16', 'jack'].includes(v)) {
            return true;
        }
        return false;
    }

    function groupsMultiColorByValue(card) {
        if (!card) return false;
        if (card.kind === 'number') return true;
        return card.kind === 'action' && ['skip', 'reverse', 'draw2'].includes(card.value);
    }

    function getDuplicateBatch(state, playerId, instanceId) {
        const hand = state.hands[playerId] || [];
        const card = hand.find(c => c.instanceId === instanceId);
        if (!card || !allowsMultiDuplicatePlay(card)) return card ? [card] : [];
        if (currentPlayerId(state) !== playerId) return [card];
        syncTurnFlags(state);
        if (state.turnFlags.played) {
            if (isStackDrawValue(card.value)) {
                const key = cardMultiPlayKey(card);
                const stackBatch = hand.filter(c =>
                    cardMultiPlayKey(c) === key
                    && isStackDrawValue(c.value)
                    && canStackOnOwnTurn(state, playerId, c)
                );
                return stackBatch.length ? stackBatch : [card];
            }
            return [card];
        }

        const key = cardMultiPlayKey(card);
        const candidates = hand.filter(c =>
            cardMultiPlayKey(c) === key
            && allowsMultiDuplicatePlay(c)
        );

        if (groupsMultiColorByValue(card)) {
            const playable = candidates.filter(c => canPlayCard(state, c, playerId));
            if (!playable.length) return [card];
            const rest = candidates.filter(c => !playable.some(p => p.instanceId === c.instanceId));
            return [...playable, ...rest];
        }

        const batch = candidates.filter(c => canPlayCard(state, c, playerId));
        return batch.length ? batch : [card];
    }

    function numberRank(card) {
        return Number(card?.value);
    }

    /** Scala 0→1→2… con eventuali copie multiple dello stesso numero (es. 4→5→5→6). */
    function isValidLadder(cards) {
        if (!cards?.length || cards.length < 2) return false;
        if (numberRank(cards[0]) !== 0 || cards[0].kind !== 'number') return false;

        const rankCounts = { 0: 1 };
        let maxRank = 0;

        for (let i = 1; i < cards.length; i += 1) {
            const c = cards[i];
            if (!c || c.kind !== 'number') return false;
            const r = numberRank(c);
            const prev = numberRank(cards[i - 1]);
            if (r < 0 || r > 9) return false;

            if (r === prev) {
                rankCounts[r] = (rankCounts[r] || 0) + 1;
            } else if (r === prev + 1) {
                maxRank = r;
                rankCounts[r] = (rankCounts[r] || 0) + 1;
            } else {
                return false;
            }
        }

        for (let r = 0; r <= maxRank; r += 1) {
            if (!rankCounts[r]) return false;
        }
        return true;
    }

    function ladderRankCounts(cards) {
        const counts = {};
        (cards || []).forEach(c => {
            const r = numberRank(c);
            counts[r] = (counts[r] || 0) + 1;
        });
        return counts;
    }

    function maxRankInLadder(cards) {
        if (!cards?.length) return -1;
        return Math.max(...cards.map(numberRank));
    }

    /** Prossimo valore aggiungibile: altra copia al vertice o il numero successivo. */
    function nextLadderAppendRank(cards, hand) {
        if (!cards?.length) return 0;
        const frontier = maxRankInLadder(cards);
        const counts = ladderRankCounts(cards);
        const inHand = ladderCardsAtRank(hand, frontier).length;
        const inLadder = counts[frontier] || 0;
        if (inLadder < inHand) return frontier;
        for (let r = frontier + 1; r <= 9; r += 1) {
            if (ladderCardsAtRank(hand, r).length) return r;
        }
        return frontier + 1;
    }

    function sortLadderPlayOrder(cards) {
        return [...cards].sort((a, b) => {
            const diff = numberRank(a) - numberRank(b);
            return diff !== 0 ? diff : String(a.instanceId).localeCompare(String(b.instanceId));
        });
    }

    function ladderCardsAtRank(hand, rank) {
        return (hand || []).filter(c => c.kind === 'number' && numberRank(c) === rank);
    }

    /** Catena più lunga 0→1→2… presente in mano (colori misti ammessi sulle numeriche). */
    function maxConsecutiveLadderRank(hand) {
        if (!ladderCardsAtRank(hand, 0).length) return -1;
        let max = 0;
        while (ladderCardsAtRank(hand, max + 1).length) max += 1;
        return max;
    }

    function buildLadderCards(hand, endRank, clickedCard) {
        if (!ladderCardsAtRank(hand, 0).length || endRank < 1) return null;
        const clickedRank = numberRank(clickedCard);
        const ladder = [];
        for (let v = 0; v <= endRank; v += 1) {
            const options = ladderCardsAtRank(hand, v);
            if (!options.length) return null;
            if (v === clickedRank) {
                const clicked = options.find(c => c.instanceId === clickedCard.instanceId) || clickedCard;
                const rest = options.filter(c => c.instanceId !== clicked.instanceId);
                ladder.push(clicked, ...rest);
            } else {
                ladder.push(...options);
            }
        }
        return ladder;
    }

    function buildMaxLadderFromHand(hand, clickedCard, endRank) {
        const maxRank = endRank ?? maxConsecutiveLadderRank(hand);
        const rank = numberRank(clickedCard);
        if (maxRank < 1 || rank < 0 || rank > maxRank) return null;
        return buildLadderCards(hand, maxRank, clickedCard);
    }

    /** Selezione iniziale scala: solo la carta cliccata se è 0, altrimenti 0→… fino al suo valore. */
    function getInitialLadderFromCard(hand, clickedCard) {
        const rank = numberRank(clickedCard);
        if (rank === 0) return [clickedCard];
        if (rank < 1) return null;
        return buildLadderCards(hand, rank, clickedCard);
    }

    /** Scala 0→… più lunga in mano che si può ancora giocare sul tavolo. */
    function buildMaxPlayableLadderFromHand(state, playerId, hand, clickedCard) {
        const maxRank = maxConsecutiveLadderRank(hand);
        const rank = numberRank(clickedCard);
        if (maxRank < 1 || rank < 0 || rank > maxRank) return null;
        for (let end = maxRank; end >= 1; end -= 1) {
            const ladder = buildLadderCards(hand, end, clickedCard);
            if (ladder
                && ladder.length >= 2
                && isValidLadder(ladder)
                && canPlayLadder(state, playerId, ladder)) {
                return ladder;
            }
        }
        return null;
    }

    /** La scala si ancora al tavolo con l'ultima carta giocata (es. 0→1 su un 3 blu: vale il 1 blu). */
    function canPlayLadder(state, playerId, cards) {
        if (!isValidLadder(cards)) return false;
        if (currentPlayerId(state) !== playerId) return false;
        syncTurnFlags(state);
        if (state.turnFlags.played) return false;
        if (blocksFinishingPlay(state, playerId, cards)) return false;
        const anchor = cards[cards.length - 1];
        return ladderAnchorMatchesTop(state, anchor);
    }

    function hasLadderOption(state, playerId, instanceId) {
        const ladder = getLadderPlay(state, playerId, instanceId);
        return ladder.length > 1 && isValidLadder(ladder);
    }

    function getLadderPlay(state, playerId, instanceId) {
        const hand = state.hands[playerId] || [];
        const card = hand.find(c => c.instanceId === instanceId);
        if (!card || card.kind !== 'number') return card ? [card] : [];
        if (currentPlayerId(state) !== playerId) return [card];
        syncTurnFlags(state);
        if (state.turnFlags.played) return [card];

        const rank = numberRank(card);
        const maxRank = maxConsecutiveLadderRank(hand);
        if (maxRank < 1 || rank < 0 || rank > maxRank) return [card];

        const ladder = buildMaxPlayableLadderFromHand(state, playerId, hand, card);
        if (!ladder) return [card];
        return ladder;
    }

    function ladderRankOptions(hand, rank) {
        return (hand || []).filter(c => c.kind === 'number' && numberRank(c) === rank);
    }

    function lastIndexOfLadderRank(cards, rank) {
        for (let i = cards.length - 1; i >= 0; i -= 1) {
            if (numberRank(cards[i]) === rank) return i;
        }
        return -1;
    }

    /** Inserisce un'altra copia dello stesso valore subito dopo l'ultima già in scala (es. 0→1→2 + 1 → 0→1→1→2). */
    function tryInsertLadderDuplicate(cards, hand, card) {
        if (!isValidLadder(cards) || !card || card.kind !== 'number') return null;
        if (cards.some(c => c.instanceId === card.instanceId)) return null;

        const rank = numberRank(card);
        const counts = ladderRankCounts(cards);
        if (!counts[rank]) return null;

        const inHand = ladderCardsAtRank(hand, rank).length;
        const inLadder = counts[rank] || 0;
        if (inLadder >= inHand) return null;

        const lastIdx = lastIndexOfLadderRank(cards, rank);
        if (lastIdx < 0) return null;

        const next = [...cards];
        next.splice(lastIdx + 1, 0, card);
        return isValidLadder(next) ? next : null;
    }

    function unusedLadderDuplicateRanks(cards, hand) {
        const counts = ladderRankCounts(cards);
        const ranks = [];
        Object.keys(counts).forEach(key => {
            const r = Number(key);
            const inHand = ladderCardsAtRank(hand, r).length;
            const inLadder = counts[r] || 0;
            if (inLadder > 0 && inLadder < inHand) ranks.push(r);
        });
        return ranks;
    }

    function tryAppendLadderCard(state, playerId, cards, card, hand) {
        if (!cards?.length || !card || card.kind !== 'number') return null;
        if (cards.length === 1 && !isValidLadder(cards) && numberRank(cards[0]) === 0 && numberRank(card) === 1) {
            const next = [...cards, card];
            return isValidLadder(next) ? next : null;
        }
        if (!isValidLadder(cards)) return null;
        if (cards.some(c => c.instanceId === card.instanceId)) return null;
        const targetRank = nextLadderAppendRank(cards, hand || []);
        if (numberRank(card) !== targetRank) return null;
        const next = [...cards, card];
        if (!isValidLadder(next)) return null;
        if (next.length >= 2 && !canPlayLadder(state, playerId, next)) return null;
        return next;
    }

    function cycleLadderRankCard(cards, hand, card) {
        if (!isValidLadder(cards) || !card || card.kind !== 'number') return null;
        const idx = cards.findIndex(c => c.instanceId === card.instanceId);
        if (idx < 0) return null;
        const rank = numberRank(card);
        const options = ladderRankOptions(hand, rank);
        if (options.length <= 1) return null;
        const current = cards[idx];
        const curIdx = options.findIndex(c => c.instanceId === current.instanceId);
        const pick = options[(curIdx + 1) % options.length];
        const next = [...cards];
        next[idx] = pick;
        return isValidLadder(next) ? next : null;
    }

    function trySwapLadderRankCard(cards, card, hand) {
        if (!cards?.length || !isValidLadder(cards) || !card || card.kind !== 'number') return null;
        const rank = numberRank(card);
        if (cards.some(c => c.instanceId === card.instanceId)) {
            return cycleLadderRankCard(cards, hand, card);
        }

        const inserted = tryInsertLadderDuplicate(cards, hand, card);
        if (inserted) return inserted;

        const idx = cards.findIndex(c => numberRank(c) === rank);
        if (idx < 0) return null;
        const next = [...cards];
        next[idx] = card;
        return isValidLadder(next) ? next : null;
    }

    /** Aggiunge uno 0 davanti se la selezione partiva da 1, 2… */
    function tryPrependLadderCard(cards, card) {
        if (!card || card.kind !== 'number' || numberRank(card) !== 0) return null;
        if (!cards?.length) return [card];
        const minRank = Math.min(...cards.map(c => numberRank(c)));
        if (minRank === 0) return null;
        const next = [card, ...cards].sort((a, b) => numberRank(a) - numberRank(b));
        return isValidLadder(next) ? next : null;
    }

    /** Tocca carte in sequenza: cambia copia, aggiungi 0, allunga o scala massima. */
    function tryIntegrateLadderCard(state, playerId, hand, cards, card) {
        if (!card || card.kind !== 'number' || !cards?.length) return null;

        if (cards.length === 1 && !isValidLadder(cards)) {
            const only = cards[0];
            const onlyRank = numberRank(only);
            const rank = numberRank(card);
            if (rank === onlyRank) {
                const options = ladderRankOptions(hand, rank);
                if (options.length > 1) {
                    const curIdx = options.findIndex(c => c.instanceId === only.instanceId);
                    const pick = options[(curIdx + 1) % options.length];
                    return [pick];
                }
            }
            const prepended = tryPrependLadderCard(cards, card);
            if (prepended) return prepended;
        }

        const inserted = tryInsertLadderDuplicate(cards, hand, card);
        if (inserted) return inserted;

        const swapped = trySwapLadderRankCard(cards, card, hand);
        if (swapped) return swapped;

        const prepended = tryPrependLadderCard(cards, card);
        if (prepended) return prepended;

        const extended = tryAppendLadderCard(state, playerId, cards, card, hand);
        if (extended) return extended;

        const maxLadder = buildMaxPlayableLadderFromHand(state, playerId, hand, card);
        if (maxLadder && maxLadder.length > (cards?.length || 0)) return maxLadder;

        if (isValidLadder(cards)) {
            const dupRanks = unusedLadderDuplicateRanks(cards, hand);
            if (dupRanks.includes(numberRank(card))) {
                return tryInsertLadderDuplicate(cards, hand, card);
            }
        }

        return null;
    }

    function getSameNumberBatch(state, playerId, instanceId) {
        return getDuplicateBatch(state, playerId, instanceId).filter(c => c.kind === 'number');
    }

    function canPlayDuplicateBatch(state, playerId, cards) {
        if (!cards?.length) return false;
        if (currentPlayerId(state) !== playerId) return false;
        syncTurnFlags(state);
        if (state.turnFlags.played) {
            return cards.every(c => canStackOnOwnTurn(state, playerId, c));
        }
        const key = cardMultiPlayKey(cards[0]);
        const allMatch = cards.every(c =>
            cardMultiPlayKey(c) === key
            && allowsMultiDuplicatePlay(c)
        );
        if (!allMatch) return false;
        if (groupsMultiColorByValue(cards[0])) {
            if (blocksFinishingPlay(state, playerId, cards)) return false;
            return cards.some(c => canPlayCard(state, c, playerId));
        }
        if (blocksFinishingPlay(state, playerId, cards)) return false;
        return cards.every(c => canPlayCard(state, c, playerId));
    }

    function canPlaySameNumberBatch(state, playerId, cards) {
        if (!cards?.length) return false;
        return cards.every(c => c.kind === 'number') && canPlayDuplicateBatch(state, playerId, cards);
    }

    function isValidPlayGroup(state, playerId, cards) {
        if (!cards?.length) return false;
        if (cards.length === 1) return canPlayCardThisTurn(state, playerId, cards[0]);
        if (isValidSixSeven(cards)) {
            return canPlaySixSevenBatch(state, playerId, cards);
        }
        if (isValidLadder(cards)) {
            return canPlayLadder(state, playerId, cards);
        }
        return canPlayDuplicateBatch(state, playerId, cards);
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
        if (state.pendingAction?.type === 'brainrotDiscard') return null;
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
        if (!p || p.eliminated) return { hit: false, shieldBlocked: false };

        if (hasShield(state, hitId)) {
            const shield = takeShieldFromHand(state, hitId);
            if (shield) {
                state.discardPile.push(shield);
                addLog(state, `🛡️ ${p.nickname} usa Scudo e annulla il colpo del Proiettile!`);
                return { hit: false, shieldBlocked: true };
            }
        }

        p.pistolHp -= 1;
        addLog(state, `Proiettile colpisce ${p.nickname}! (${p.pistolHp} HP)`);
        if (p.pistolHp <= 0) {
            eliminatePlayer(state, hitId);
            addLog(state, `${p.nickname} eliminato.`);
        }
        return { hit: true, shieldBlocked: false };
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
        const hitResult = applyBulletHit(s, pending.hitId);
        s.lastRoulette = {
            hitId: pending.hitId,
            spinDeg: pending.spinDeg,
            segments: pending.segments,
            shooterId: pending.shooterId,
            shieldBlocked: !!hitResult.shieldBlocked,
            at: Date.now()
        };
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
        if (s.pendingAction?.type === 'brainrotBattle' || s.pendingAction?.type === 'drawStackWindow') {
            return { ok: false, error: 'Usa la finestra di risposta (5s) per giocare la carta.' };
        }
        if (s.pendingAction?.type === 'brainrotDiscard') {
            return { ok: false, error: 'Seleziona le carte da scartare (Brainrot).' };
        }
        if (!isMyTurn(s, playerId)) {
            return { ok: false, error: 'Non è il tuo turno.' };
        }
        syncTurnFlags(s);
        if (!instanceIds?.length) {
            return { ok: false, error: 'Nessuna carta selezionata.' };
        }

        const hand = s.hands[playerId] || [];
        const cards = instanceIds.map(id => hand.find(c => c.instanceId === id)).filter(Boolean);
        if (cards.length !== instanceIds.length) {
            return { ok: false, error: 'Carta non in mano.' };
        }

        if (s.turnFlags.played) {
            const canContinueStack = cards.every(c => canStackOnOwnTurn(s, playerId, c));
            if (!canContinueStack) {
                return { ok: false, error: 'Hai già giocato in questo turno. Premi Finisci Turno.' };
            }
        }

        const playingBlobby = cards.some(c => c.value === 'blobby');
        if (playingBlobby && !hasShield(s, playerId)) {
            return { ok: false, error: 'Per giocare Blobby devi avere uno Scudo in mano.' };
        }
        if (cards.some(c => c.value === 'mirror')) {
            return { ok: false, error: 'Specchio si gioca solo per contrastare uno stack entro il tempo.' };
        }
        if (blocksFinishingPlay(s, playerId, cards)) {
            return { ok: false, error: 'Come ultima carta puoi giocare solo carte numeriche.' };
        }

        if (cards.length > 1) {
            if (!isValidPlayGroup(s, playerId, cards)) {
                return { ok: false, error: 'Puoi giocare insieme copie uguali, scala 0→1→2… o SixSeven (6+7).' };
            }
            if (isValidLadder(cards)) {
                const ordered = sortLadderPlayOrder(cards);
                cards.splice(0, cards.length, ...ordered);
            } else if (isValidSixSeven(cards)) {
                cards.sort((a, b) => numberRank(a) - numberRank(b));
            } else {
                if (groupsMultiColorByValue(cards[0])) {
                    const playable = cards.filter(c => canPlayCard(s, c, playerId));
                    const rest = cards.filter(c => !playable.some(p => p.instanceId === c.instanceId));
                    if (playable.length) {
                        cards.splice(0, cards.length, ...playable, ...rest);
                    }
                }
                if (!canPlayDuplicateBatch(s, playerId, cards)) {
                    return { ok: false, error: 'Queste carte non possono essere giocate insieme.' };
                }
            }
        } else {
            const first = cards[0];
            if (!canPlayCardThisTurn(s, playerId, first)) {
                return { ok: false, error: 'Carta non giocabile.' };
            }
        }

        const needsSinglePlay = cards.some(c =>
            ['wild', 'wild4'].includes(c.value)
            || ['death', 'swap', 'nazism', 'heart', 'communism', 'blobby', 'bullet', 'mari', 'brainrot'].includes(c.value)
        );
        if (cards.length > 1 && needsSinglePlay) {
            return { ok: false, error: 'Una sola carta di questo tipo per volta.' };
        }

        if (options.chosenColor && !isValidPlayColor(options.chosenColor)) {
            return { ok: false, error: 'Colore non valido.' };
        }

        cards.forEach(c => removeFromHand(s.hands, playerId, c.instanceId));
        cards.forEach(c => s.discardPile.push(c));
        if (playingBlobby) {
            const shield = takeShieldFromHand(s, playerId);
            if (!shield) {
                return { ok: false, error: 'Scudo richiesto per giocare Blobby.' };
            }
            s.discardPile.push(shield);
            addLog(s, `${s.players[playerId]?.nickname} scarta Scudo insieme a Blobby.`);
        }
        const card = cards[cards.length - 1];
        s.topCard = card;
        if (options.chosenColor) {
            s.activeColor = options.chosenColor;
            s.pendingColor = false;
            s.pendingAction = null;
        } else if (isValidPlayColor(card.color)) {
            s.activeColor = card.color;
        }

        const ownStackBuild = s.stackPassPending && s.stackSourcePlayerId === playerId
            && isStackDrawValue(card.value);
        const defenderStacking = s.drawStack > 0 && s.settings.stack
            && (card.value === 'draw2' || card.value === 'wild4')
            && isDrawStackWindow(s);
        if (!ownStackBuild && !defenderStacking) {
            if (!s.stackPassPending || s.stackSourcePlayerId !== playerId) {
                s.drawStack = 0;
                s.drawStackType = null;
            }
            if (!isStackDrawValue(card.value)) {
                s.stackPassPending = false;
                s.stackDefenderId = null;
                s.stackSourcePlayerId = null;
            }
        }
        const playLabel = cards.length > 1
            ? `${cards.length}× ${Deck.cardDisplayName(card)}`
            : Deck.cardDisplayName(card);
        addLog(s, `${s.players[playerId]?.nickname} gioca ${playLabel}`);
        syncHandCounts(s);
        updateUnoStateAfterPlay(s, playerId);

        s.turnFlags.played = true;

        let effect = { ok: true };
        const isLadder = cards.length > 1 && isValidLadder(cards);
        const isSixSeven = cards.length > 1 && isValidSixSeven(cards);
        const isDuplicateBatch = cards.length > 1 && canPlayDuplicateBatch(s, playerId, cards) && !isLadder && !isSixSeven;
        if (isDuplicateBatch) {
            for (let i = 0; i < cards.length; i += 1) {
                effect = resolveCardEffect(s, playerId, cards[i], options);
                if (!effect.ok) return effect;
                if (s.pendingAction?.type === 'chooseColor'
                    || s.pendingAction?.type === 'chooseTarget'
                    || s.pendingAction?.type === 'defense') {
                    break;
                }
            }
        } else {
            effect = resolveCardEffect(s, playerId, card, options);
        }
        if (!effect.ok) {
            return effect;
        }

        if (s.status === 'finished') {
            return { ok: true, state: s, outcome: 'win' };
        }
        if (s.pendingAction?.type === 'brainrotBattle') {
            const finished = finishBrainrotBattleIfReady(s);
            if (finished.ok) {
                return { ok: true, state: finished.state, defer: true };
            }
            return { ok: true, state: s, defer: true };
        }
        if (['counterWindow', 'drawStackWindow', 'brainrotDiscard', 'mariGreen', 'bulletRoulette', 'chooseColor', 'chooseTarget'].includes(s.pendingAction?.type)) {
            return { ok: true, state: s, defer: true };
        }
        const outcome = checkWinOrUnoPenalty(s, playerId);
        if (outcome === 'win' || s.status === 'finished') {
            return { ok: true, state: s, outcome };
        }
        if (outcome === 'penalty') {
            syncHandCounts(s);
            return { ok: true, state: s, outcome: 'penalty' };
        }

        if (tryAutoResolveStackPass(s)) {
            syncHandCounts(s);
            return { ok: true, state: s, cardsPlayed: cards.length };
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
            case 'draw2': {
                addToStackPass(state, playerId, 2, 'draw2');
                return { ok: true };
            }
            case 'wild':
                if (!options.chosenColor) {
                    state.pendingColor = true;
                    state.pendingAction = { type: 'chooseColor', playerId };
                }
                return { ok: true };
            case 'wild4': {
                if (!options.chosenColor) {
                    state.pendingColor = true;
                    state.pendingAction = { type: 'chooseColor', playerId };
                    return { ok: true };
                }
                addToStackPass(state, playerId, 4, 'wild4');
                return { ok: true };
            }
            case 'draw10': {
                addToStackPass(state, playerId, 10, 'draw10');
                return { ok: true };
            }
            case 'draw16': {
                addToStackPass(state, playerId, 16, 'draw16');
                return { ok: true };
            }
            case 'death': {
                const target = options.targetId || nextPlayerId(state);
                openCounterWindow(state, playerId, card, { targetId: target });
                return { ok: true, defer: true };
            }
            case 'blobby': {
                openCounterWindow(state, playerId, card);
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
                clearStackPassState(state);
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
                clearStackPassState(state);
                state.forcedColor = null;
                state.pendingColor = false;
                if (state.pendingAction?.type !== 'defense') {
                    state.pendingAction = null;
                }
                addLog(state, 'Donna di Mazze: catene ed effetti globali annullati.');
                return { ok: true };
            case 'nazism': {
                const target = options.targetId;
                const giftCardId = options.giftCardId;
                if (!target || !giftCardId) {
                    return { ok: false, error: 'Scegli un giocatore e una carta da cedere.' };
                }
                const hand = state.hands[playerId] || [];
                const idx = hand.findIndex(c => c.instanceId === giftCardId);
                if (idx === -1) {
                    return { ok: false, error: 'La carta scelta non è nella tua mano.' };
                }
                const [gifted] = hand.splice(idx, 1);
                if (!state.hands[target]) state.hands[target] = [];
                state.hands[target].push(gifted);
                syncHandCounts(state);
                addLog(
                    state,
                    `${state.players[playerId]?.nickname} cede ${Deck.cardDisplayName(gifted)} a ${state.players[target]?.nickname}.`
                );
                return { ok: true };
            }
            case 'communism': {
                const target = options.targetId;
                const stolenId = options.stolenCardId;
                if (!target || !stolenId) {
                    return { ok: false, error: 'Scegli un giocatore e una carta da rubare.' };
                }
                const targetHand = state.hands[target] || [];
                const idx = targetHand.findIndex(c => c.instanceId === stolenId);
                if (idx === -1) {
                    return { ok: false, error: 'Carta non trovata nella mano del bersaglio.' };
                }
                const [stolen] = targetHand.splice(idx, 1);
                state.hands[playerId].push(stolen);
                syncHandCounts(state);
                addLog(
                    state,
                    `${state.players[playerId]?.nickname} ruba ${Deck.cardDisplayName(stolen)} a ${state.players[target]?.nickname}.`
                );
                return { ok: true };
            }
            case 'heart': {
                const target = options.targetId;
                if (!target) {
                    state.pendingAction = { type: 'chooseTarget', playerId, effect: 'heart' };
                    return { ok: true };
                }
                const revived = revivePlayer(state, target);
                if (!revived.ok) addLog(state, revived.error || 'Rianimazione fallita.');
                return { ok: revived.ok, error: revived.error };
            }
            case 'brainrot':
                if (settings.brainrot) {
                    openBrainrotBattle(state, playerId, card);
                    return { ok: true, defer: true };
                }
                return { ok: true };
            case 'mirror':
                return { ok: false, error: 'Specchio si usa solo per contrastare uno stack entro il tempo.' };
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
                if (state.forcedColor && card.color === state.forcedColor) {
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

    function takeShieldFromHand(state, playerId) {
        const hand = state.hands[playerId] || [];
        const idx = hand.findIndex(c => c.value === 'shield');
        if (idx === -1) return null;
        const [shield] = hand.splice(idx, 1);
        syncHandCounts(state);
        return shield;
    }

    function consumeShield(state, playerId) {
        takeShieldFromHand(state, playerId);
    }

    function eliminatePlayer(state, playerId) {
        if (!state.players[playerId]) return;
        state.players[playerId].eliminated = true;
        state.hands[playerId] = [];
        state.players[playerId].handCount = 0;
    }

    function eliminatedPlayerIds(state) {
        return (state.turnOrder || []).filter(id => state.players[id]?.eliminated);
    }

    function revivePlayer(state, targetId) {
        const p = state.players[targetId];
        if (!p || !p.eliminated) {
            return { ok: false, error: 'Questo giocatore non è eliminato.' };
        }
        p.eliminated = false;
        p.pistolHp = state.settings.pistolHp;
        p.maxPistolHp = state.settings.pistolHp;
        p.saidUno = false;
        p.unoRequired = false;

        const dealt = drawFromPile(state, 7);
        state.hands[targetId] = dealt;
        syncHandCounts(state);

        if (state.status === 'finished' && activePlayers(state).length > 1) {
            state.status = 'playing';
            state.winnerId = null;
            state.winnerName = null;
            state.endedAt = null;
            state.durationMs = null;
            addLog(state, 'Partita ripresa dopo resurrezione.');
        }

        addLog(state, `${p.nickname} è stato rianimato (${dealt.length} carte).`);
        return { ok: true };
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
        if (!isValidPlayColor(color)) {
            return { ok: false, error: 'Scegli Rosso, Giallo, Verde o Blu.' };
        }
        s.activeColor = color;
        s.pendingColor = false;
        s.pendingAction = null;
        addLog(s, `Colore scelto: ${Deck.COLOR_LABEL[color] || color}`);
        if (s.topCard?.value === 'wild4' && !s.stackPassPending) {
            addToStackPass(s, playerId, 4, 'wild4');
        }
        tryAutoResolveStackPass(s);
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
        } else if (pending.effect === 'heart') {
            const effect = resolveCardEffect(s, playerId, { value: 'heart' }, { targetId });
            if (!effect.ok) return effect;
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
        if (p?.saidUno) {
            return { ok: false, error: 'Hai già detto UNO!' };
        }
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
        isRighelloCard,
        isBrainrotBattle,
        isDrawStackWindow,
        isBrainrotDiscardPhase,
        canPlayBrainrotResponse,
        canPlayDrawStackResponse,
        canBrainrotDiscardCard,
        isBrainrotCard,
        isDiscardableNumberCard,
        brainrotBattleCanClose,
        finishBrainrotBattleIfReady,
        isPendingTimedWindow,
        canPlayCounter,
        canPlayCard,
        canPlayCardThisTurn,
        canDraw,
        hasPlayableCard,
        hasPlayableCardThisTurn,
        cardStackKey,
        cardDuplicateKey,
        cardMultiPlayKey,
        allowsMultiDuplicatePlay,
        getDuplicateBatch,
        canPlayDuplicateBatch,
        getMatchingPlayableCards,
        getSameNumberBatch,
        getSixSevenBatch,
        isValidSixSeven,
        canPlaySixSevenBatch,
        getLadderPlay,
        hasLadderOption,
        tryAppendLadderCard,
        trySwapLadderRankCard,
        tryPrependLadderCard,
        tryIntegrateLadderCard,
        tryInsertLadderDuplicate,
        cycleLadderRankCard,
        ladderRankOptions,
        unusedLadderDuplicateRanks,
        buildMaxLadderFromHand,
        buildMaxPlayableLadderFromHand,
        getInitialLadderFromCard,
        nextLadderAppendRank,
        playMariGreenCard,
        canPlayMariGreen,
        isValidLadder,
        isValidPlayGroup,
        playCard,
        playCards,
        playCounterCard,
        resolveCounterWindow,
        playBrainrotResponse,
        resolveBrainrotBattle,
        resolveBrainrotDiscard,
        playDrawStackResponse,
        resolveDrawStackWindow,
        drawCard,
        chooseColor,
        chooseTarget,
        declareUno,
        endTurn,
        leaveGame,
        respondDefense,
        spinBulletRoulette,
        removePlayerFromGame,
        eliminatedPlayerIds,
        revivePlayer,
        stripForFirestore,
        topMatches,
        effectiveTopColor,
        getDisplayColorInfo,
        isValidPlayColor,
        PLAY_COLORS,
        comboValueKey,
        COUNTER_WINDOW_MS
    };
})(window);
