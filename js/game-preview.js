/**
 * Partita locale con bot per test (GiocoPreview.html).
 * Sostituisce Firestore con stato in memoria e guida i bot.
 */
(function (global) {
    const Engine = global.GameEngine;
    const Deck = global.GameDeck;

    const HUMAN_ID = 'preview-human';
    const BOT_AVATARS = ['🤖', '👾', '🎮', '🦊', '🐯', '🐸', '🐙', '🦄', '👻', '🎲', '🔥', '⭐', '🃏', '💀'];
    const PLAY_COLORS = ['red', 'yellow', 'green', 'blue'];

    let botIds = ['bot-1', 'bot-2'];
    let applyStateFn = null;
    let botLoopRunning = false;
    let settings = { stack: true, brainrot: true, pistolHp: 3 };
    let previewMode = 'training';
    let previewDifficulty = 'medium';
    let previewStoryLevel = 1;
    let previewTutorialStep = 1;

    function sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }

    function botDifficultyProfile() {
        return global.GameModes?.DIFFICULTY?.[previewDifficulty]
            || { brainrot: 0.4, counter: 0.38, stack: 0.72 };
    }

    function botShouldRespond(kind) {
        const p = botDifficultyProfile();
        const chance = p[kind] ?? 0.45;
        return Math.random() < chance;
    }

    function parsePreviewOptions() {
        const params = new URLSearchParams(window.location.search);
        previewMode = params.get('mode') || 'training';
        previewDifficulty = params.get('diff') || 'medium';
        previewStoryLevel = parseInt(params.get('level') || '1', 10) || 1;
        previewTutorialStep = parseInt(params.get('step') || '1', 10) || 1;

        if (previewMode === 'story') {
            const cfg = global.GameModes?.getStoryLevel?.(previewStoryLevel);
            if (cfg) {
                previewDifficulty = cfg.diff;
                settings = {
                    stack: !!cfg.stack,
                    brainrot: !!cfg.brainrot,
                    pistolHp: Math.min(5, Math.max(1, cfg.hp || 3))
                };
                botIds = Array.from({ length: cfg.bots }, (_, i) => `bot-${i + 1}`);
                return;
            }
        }

        const bots = Math.min(14, Math.max(1, parseInt(params.get('bots') || '2', 10) || 2));
        botIds = Array.from({ length: bots }, (_, i) => `bot-${i + 1}`);
        settings = {
            stack: params.get('stack') !== '0',
            brainrot: params.get('brainrot') !== '0',
            pistolHp: Math.min(5, Math.max(1, parseInt(params.get('hp') || '3', 10) || 3))
        };
    }

    const PREVIEW_SINGLE_COPY = new Set([
        'c_death', 'c_blobby', 'c_donna', 'c_imprevisti', 'c_mari', 'c_comunismo',
        'c_nazismo', 'c_quagruppo', 'c_messa', 'c_specchio', 'c_jack', 'c_piu10', 'c_piu16'
    ]);

    function defaultCardQuantities() {
        if (previewMode === 'tutorial' && global.GameModes?.getTutorialCardQuantities) {
            return global.GameModes.getTutorialCardQuantities(
                previewTutorialStep,
                () => defaultCardQuantitiesFull()
            );
        }
        return defaultCardQuantitiesFull();
    }

    function defaultCardQuantitiesFull() {
        const q = { c_0_9: 20 };
        const specials = [
            'c_piu2', 'c_rev', 'c_bloc', 'c_cc', 'c_piu4', 'c_scudo', 'c_righello',
            'c_death', 'c_blobby', 'c_donna', 'c_imprevisti', 'c_scambio', 'c_vaff',
            'c_mari', 'c_onde', 'c_cuore', 'c_comunismo', 'c_nazismo', 'c_proiettile',
            'c_quagruppo', 'c_messa', 'c_piani', 'c_specchio', 'c_jack', 'c_piu10', 'c_piu16'
        ];
        specials.forEach(id => {
            q[id] = PREVIEW_SINGLE_COPY.has(id) ? 1 : 2;
        });
        if (settings.brainrot) {
            Object.keys(Deck.BRAINROT_DEFS || {}).forEach(id => { q[id] = 1; });
        }
        return q;
    }

    function buildPreviewLobby() {
        const user = JSON.parse(localStorage.getItem('unoCurrentUser') || '{"nickname":"Tester","avatar":"🦊"}');
        const players = [
            {
                uid: HUMAN_ID,
                nickname: user.nickname || 'Tester',
                avatar: user.avatar || '🦊'
            },
            ...botIds.map((id, i) => ({
                uid: id,
                nickname: `Bot ${i + 1}`,
                avatar: BOT_AVATARS[i % BOT_AVATARS.length]
            }))
        ];
        return {
            id: 'preview-local',
            players,
            settings,
            cardQuantities: defaultCardQuantities()
        };
    }

    function isBot(id) {
        return botIds.includes(id);
    }

    function pickBotColor(state, botId) {
        const hand = state.hands[botId] || [];
        const counts = { red: 0, yellow: 0, green: 0, blue: 0 };
        hand.forEach(c => {
            if (counts[c.color] != null) counts[c.color] += 1;
        });
        return PLAY_COLORS.slice().sort((a, b) => counts[b] - counts[a])[0] || 'red';
    }

    function pickBotTarget(state, botId, effect) {
        const order = state.turnOrder || [];
        if (effect === 'heart') {
            const elim = Engine.eliminatedPlayerIds(state);
            return elim[0] || order.find(id => id !== botId) || order[0];
        }
        const candidates = order.filter(id => id !== botId && !state.players[id]?.eliminated);
        return candidates[Math.floor(Math.random() * candidates.length)] || order[0];
    }

    function pendingResolverId(state) {
        const pending = state.pendingAction;
        const order = state.turnOrder || [];
        if (!pending) return null;
        let preferred = null;
        switch (pending.type) {
            case 'brainrotDiscard':
                preferred = pending.winnerId;
                break;
            case 'drawStackWindow':
                preferred = pending.defenderId;
                break;
            case 'brainrotBattle':
                preferred = pending.initiatorId;
                break;
            case 'counterWindow':
                preferred = pending.sourcePlayerId;
                break;
            default:
                break;
        }
        const fallbacks = [
            preferred,
            pending.winnerId,
            pending.defenderId,
            pending.initiatorId,
            pending.sourcePlayerId
        ].filter((id, idx, arr) => id && order.includes(id) && arr.indexOf(id) === idx);
        return fallbacks[0] || order[0];
    }

    function humanMustAct(state) {
        const pending = state.pendingAction;

        if (pending?.type === 'chooseColor' && pending.playerId === HUMAN_ID) return true;
        if (state.pendingColor && pending?.playerId === HUMAN_ID) return true;
        if (pending?.type === 'chooseTarget' && pending.playerId === HUMAN_ID) return true;
        if (pending?.type === 'brainrotDiscard' && pending.winnerId === HUMAN_ID) return true;
        if (pending?.type === 'bulletRoulette' && pending.shooterId === HUMAN_ID && !pending.spun) return true;

        if (pending?.type === 'drawStackWindow' && pending.defenderId === HUMAN_ID
            && Engine.canPlayDrawStackResponse(state, HUMAN_ID, { probe: true })) return true;
        if (pending?.type === 'brainrotBattle' && Engine.canPlayBrainrotResponse(state, HUMAN_ID)) return true;
        if (pending?.type === 'mariGreen' && pending.currentId === HUMAN_ID) return true;

        if (Engine.currentPlayerId(state) === HUMAN_ID && Engine.isMyTurn(state, HUMAN_ID)) {
            if (!pending || pending.type === 'bulletRoulette') return true;
        }

        return false;
    }

    function botPickPlay(state, botId) {
        const hand = state.hands[botId] || [];

        for (const card of hand) {
            const batch = Engine.getDuplicateBatch(state, botId, card.instanceId);
            if (batch.length > 1 && Engine.canPlayDuplicateBatch(state, botId, batch)) {
                return { fn: () => Engine.playCards(state, botId, batch.map(c => c.instanceId)) };
            }
        }

        for (const card of hand) {
            if (!Engine.canPlayCardThisTurn(state, botId, card)) continue;

            if (card.value === 'wild' || card.value === 'wild4') {
                const color = pickBotColor(state, botId);
                return { fn: () => Engine.playCards(state, botId, [card.instanceId], { chosenColor: color }) };
            }

            if (card.value === 'nazism') {
                const targetId = pickBotTarget(state, botId, card.value);
                const giveCandidates = (state.hands[botId] || []).filter(c => c.instanceId !== card.instanceId);
                const giftCard = giveCandidates[Math.floor(Math.random() * giveCandidates.length)];
                if (!giftCard) return null;
                return {
                    fn: () => Engine.playCards(state, botId, [card.instanceId], {
                        targetId,
                        giftCardId: giftCard.instanceId
                    })
                };
            }
            if (card.value === 'communism') {
                const targetId = pickBotTarget(state, botId, card.value);
                const oppHand = state.hands[targetId] || [];
                const stolen = oppHand[Math.floor(Math.random() * oppHand.length)];
                if (!stolen) return null;
                return {
                    fn: () => Engine.playCards(state, botId, [card.instanceId], {
                        targetId,
                        stolenCardId: stolen.instanceId
                    })
                };
            }
            if (['death', 'swap', 'heart'].includes(card.value)) {
                const targetId = pickBotTarget(state, botId, card.value);
                return { fn: () => Engine.playCards(state, botId, [card.instanceId], { targetId }) };
            }

            return { fn: () => Engine.playCards(state, botId, [card.instanceId]) };
        }

        return null;
    }

    function tryBotStep(state) {
        if (state.status !== 'playing') return null;

        const pending = state.pendingAction;

        if (pending?.type === 'chooseColor' && isBot(pending.playerId)) {
            return Engine.chooseColor(state, pending.playerId, pickBotColor(state, pending.playerId));
        }
        if (state.pendingColor && pending?.playerId && isBot(pending.playerId)) {
            return Engine.chooseColor(state, pending.playerId, pickBotColor(state, pending.playerId));
        }
        if (pending?.type === 'chooseTarget' && isBot(pending.playerId)) {
            return Engine.chooseTarget(state, pending.playerId, pickBotTarget(state, pending.playerId, pending.effect));
        }
        if (pending?.type === 'bulletRoulette' && isBot(pending.shooterId) && !pending.spun) {
            return Engine.spinBulletRoulette(state, pending.shooterId);
        }
        if (pending?.type === 'brainrotDiscard' && isBot(pending.winnerId)) {
            return Engine.resolveBrainrotDiscard(state, pending.winnerId, [], { force: true });
        }
        if (pending?.type === 'mariGreen' && pending.currentId && isBot(pending.currentId)) {
            const botId = pending.currentId;
            const green = (state.hands[botId] || []).find(c => Engine.canPlayMariGreen(state, botId, c));
            if (green) {
                return Engine.playMariGreenCard(state, botId, green.instanceId);
            }
            return Engine.drawCard(state, botId);
        }

        if (pending && Engine.isPendingTimedWindow(pending)) {
            for (const botId of botIds) {
                if (pending.type === 'brainrotBattle' && Engine.canPlayBrainrotResponse(state, botId)) {
                    const br = (state.hands[botId] || []).find(c => Engine.isBrainrotCard(c));
                    if (br && botShouldRespond('brainrot')) {
                        return Engine.playBrainrotResponse(state, botId, br.instanceId);
                    }
                }
                if (pending.type === 'drawStackWindow' && pending.defenderId === botId) {
                    const card = (state.hands[botId] || []).find(c => Engine.canPlayDrawStackResponse(state, botId, c));
                    if (card) {
                        return Engine.playDrawStackResponse(state, botId, card.instanceId);
                    }
                }
                if (pending.type === 'counterWindow' && pending.sourcePlayerId !== botId) {
                    const counter = (state.hands[botId] || []).find(c => Engine.canPlayCounter(state, botId, c));
                    if (counter && botShouldRespond('counter')) {
                        return Engine.playCounterCard(state, botId, counter.instanceId);
                    }
                }
            }

            const resolver = pendingResolverId(state);
            const timerExpired = Date.now() >= (Number(pending.resolvesAt) || 0) - 150;
            if (timerExpired && pending.type === 'brainrotBattle' && Engine.brainrotBattleCanClose?.(state)) {
                return Engine.resolveBrainrotBattle(state, resolver, { force: true });
            }
            if (isBot(resolver) && timerExpired) {
                if (pending.type === 'counterWindow') {
                    return Engine.resolveCounterWindow(state, resolver, { force: true });
                }
                if (pending.type === 'drawStackWindow') {
                    const def = pending.defenderId;
                    const stackCard = (state.hands[def] || []).find(c => Engine.canPlayDrawStackResponse(state, def, c));
                    if (stackCard) {
                        return Engine.playDrawStackResponse(state, def, stackCard.instanceId);
                    }
                    return Engine.resolveDrawStackWindow(state, resolver, { force: true });
                }
            }
            return null;
        }

        if (Engine.currentPlayerId(state) !== botIdLoop(state)) return null;
        const botId = Engine.currentPlayerId(state);
        if (!isBot(botId)) return null;

        if (state.stackPassPending && state.stackSourcePlayerId === botId) {
            const hand = state.hands[botId] || [];
            for (const card of hand) {
                if (Engine.canPlayCardThisTurn(state, botId, card)) {
                    return { fn: () => Engine.playCards(state, botId, [card.instanceId]) };
                }
            }
            if (Engine.canEndTurn(state, botId)) {
                return { fn: () => Engine.endTurn(state, botId) };
            }
        }

        const play = botPickPlay(state, botId);
        if (play) return play.fn();

        if (Engine.canDraw(state, botId)) {
            const drawn = Engine.drawCard(state, botId);
            if (!drawn.ok) return drawn;
            if (Engine.canEndTurn(drawn.state, botId)) {
                return Engine.endTurn(drawn.state, botId);
            }
            return drawn;
        }

        if (Engine.canEndTurn(state, botId)) {
            return Engine.endTurn(state, botId);
        }

        return null;
    }

    function botIdLoop(state) {
        return Engine.currentPlayerId(state);
    }

    function applyBotResult(prevState, result) {
        if (!result?.ok || !result.state) return false;
        const nextVersion = (prevState?.version || global.__previewCurrentState__?.version || 0) + 1;
        result.state.version = nextVersion;
        global.__previewCurrentState__ = result.state;
        if (applyStateFn) applyStateFn(result.state, prevState);
        return true;
    }

    async function runBotLoop() {
        if (botLoopRunning || !applyStateFn) return;
        botLoopRunning = true;
        try {
            let guard = 0;
            while (guard < 48) {
                guard += 1;
                const state = global.__previewCurrentState__;
                if (!state || state.status !== 'playing') break;
                if (humanMustAct(state)) break;

                let result;
                try {
                    result = tryBotStep(state);
                } catch (err) {
                    console.error('[PREVIEW BOT] tryBotStep:', err);
                    break;
                }

                if (!result?.ok) {
                    const cur = Engine.currentPlayerId(state);
                    if (isBot(cur) && !humanMustAct(state)) {
                        if (Engine.canDraw(state, cur)) {
                            result = Engine.drawCard(state, cur);
                        } else if (Engine.canEndTurn(state, cur)) {
                            result = Engine.endTurn(state, cur);
                        }
                    }
                }
                if (!result?.ok) break;
                if (!result.state) {
                    console.warn('[PREVIEW BOT] mossa senza stato:', result);
                    break;
                }

                const prev = state;
                if (!applyBotResult(prev, result)) break;
                await sleep(420);
            }
        } catch (err) {
            console.error('[PREVIEW BOT] loop:', err);
        } finally {
            botLoopRunning = false;
        }
    }

    async function persistState(_lobbyId, state, expectedVersion) {
        const version = (expectedVersion || 0) + 1;
        state.version = version;
        global.__previewCurrentState__ = state;
        return version;
    }

    async function start(applyState) {
        parsePreviewOptions();
        global.GameModes?.resetPreviewWinFlag?.();
        applyStateFn = applyState;
        updatePreviewBar();
        showModeIntro();
        const lobby = buildPreviewLobby();
        const state = Engine.createInitialState(lobby);
        state.version = 1;
        global.__previewCurrentState__ = state;
        applyState(state, null);
        await sleep(400);
        await runBotLoop();
    }

    function restart() {
        document.getElementById('end-overlay')?.classList.add('hidden');
        global.GameModes?.resetPreviewWinFlag?.();
        if (applyStateFn) {
            start(applyStateFn);
        } else {
            window.location.reload();
        }
    }

    function updatePreviewBar() {
        const label = document.getElementById('preview-bar-label');
        if (!label) return;
        const params = new URLSearchParams(window.location.search);
        label.textContent = global.GameModes?.getModeLabel?.(params)
            || `Test locale · ${botIds.length} bot`;
        const cheatBtn = document.getElementById('btn-preview-cheat');
        const hideCheat = previewMode === 'story' || previewMode === 'tutorial';
        if (cheatBtn) cheatBtn.classList.toggle('hidden', hideCheat);
    }

    function showModeIntro() {
        const overlay = document.getElementById('mode-intro-overlay');
        if (!overlay) return;
        const title = document.getElementById('mode-intro-title');
        const body = document.getElementById('mode-intro-body');
        const params = new URLSearchParams(window.location.search);
        const mode = params.get('mode');
        if (!mode || mode === 'training') {
            overlay.classList.add('hidden');
            return;
        }
        if (mode === 'story') {
            const cfg = global.GameModes?.getStoryLevel?.(previewStoryLevel);
            if (title) title.textContent = `Storia — Livello ${cfg?.level || 1}`;
            if (body) body.textContent = cfg ? `${cfg.name}: ${cfg.subtitle}` : '';
        } else if (mode === 'tutorial') {
            if (title) title.textContent = 'Tutorial';
            if (body) body.innerHTML = global.GameModes?.getTutorialIntroHtml?.(previewTutorialStep) || '';
        }
        overlay.classList.remove('hidden');
        document.getElementById('mode-intro-dismiss')?.addEventListener('click', () => {
            overlay.classList.add('hidden');
        }, { once: true });
    }

    function patchFirestore() {
        const FS = global.GameFirestore;
        if (!FS) return;

        class SaveConflictError extends Error {
            constructor(serverState) {
                super('CONFLICT');
                this.name = 'SaveConflictError';
                this.serverState = serverState;
            }
        }

        FS.waitForFirebase = async () => true;
        FS.persistState = persistState;
        FS.subscribeGame = () => () => {};
        FS.returnLobbyToWaiting = async () => {};
        FS.leaveGameParticipant = async () => null;
        FS.fetchGameState = async () => global.__previewCurrentState__ || null;
        FS.createGameFromLobby = async (lobby) => {
            const state = Engine.createInitialState(lobby);
            state.version = 1;
            return state;
        };
        FS.SaveConflictError = SaveConflictError;
        FS.mapPersistError = (err) => {
            const msg = err?.message || String(err || '');
            return msg && msg !== 'CONFLICT'
                ? `Errore preview: ${msg}`
                : 'Errore salvataggio preview.';
        };
    }

    patchFirestore();

    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('btn-preview-restart')?.addEventListener('click', () => {
            global.GameSounds?.play?.('click');
            restart();
        });
        updatePreviewBar();
    });

    function clonePreviewState(state) {
        return state ? JSON.parse(JSON.stringify(state)) : null;
    }

    function pushPreviewState(state, prev) {
        global.__previewCurrentState__ = state;
        if (applyStateFn) applyStateFn(state, prev ?? null);
    }

    function giveHumanCards(cards) {
        const prev = global.__previewCurrentState__;
        if (!prev || !cards?.length) return false;
        const state = clonePreviewState(prev);
        if (!state.hands[HUMAN_ID]) state.hands[HUMAN_ID] = [];
        cards.forEach(card => {
            if (card) state.hands[HUMAN_ID].push(card);
        });
        if (state.players[HUMAN_ID]) {
            state.players[HUMAN_ID].handCount = state.hands[HUMAN_ID].length;
        }
        state.version = (prev.version || 0) + 1;
        pushPreviewState(state, prev);
        return true;
    }

    function giveHumanCard(card) {
        return giveHumanCards(card ? [card] : []);
    }

    function clearHumanHand() {
        const prev = global.__previewCurrentState__;
        if (!prev) return false;
        const state = clonePreviewState(prev);
        state.hands[HUMAN_ID] = [];
        if (state.players[HUMAN_ID]) {
            state.players[HUMAN_ID].handCount = 0;
            state.players[HUMAN_ID].saidUno = false;
            state.players[HUMAN_ID].unoRequired = false;
        }
        state.version = (prev.version || 0) + 1;
        pushPreviewState(state, prev);
        return true;
    }

    function setTopCard(card) {
        const prev = global.__previewCurrentState__;
        if (!prev || !card) return false;
        const state = clonePreviewState(prev);
        state.topCard = card;
        state.discardPile = [...(state.discardPile || []), card];
        if (card.color && card.color !== 'black' && card.color !== 'wild') {
            state.activeColor = card.color;
        } else if (card.value === 'wild' || card.value === 'wild4') {
            state.pendingColor = false;
            state.pendingAction = null;
        }
        state.version = (prev.version || 0) + 1;
        pushPreviewState(state, prev);
        return true;
    }

    function getState() {
        return global.__previewCurrentState__ || null;
    }

    global.GamePreview = {
        start,
        restart,
        runBotLoop,
        getHumanId: () => HUMAN_ID,
        getBotIds: () => [...botIds],
        getSettings: () => ({ ...settings }),
        getMode: () => previewMode,
        getDifficulty: () => previewDifficulty,
        getState,
        giveHumanCard,
        giveHumanCards,
        clearHumanHand,
        setTopCard,
        pushPreviewState,
        isPreview: true
    };
})(window);
