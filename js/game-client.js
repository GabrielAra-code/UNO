(function (global) {
    const Engine = global.GameEngine;
    const Deck = global.GameDeck;
    const FS = global.GameFirestore;
    const Sounds = global.GameSounds;
    const CardUI = global.GameCardUI;
    const CardInfo = global.CardInfo;
    const IS_PREVIEW = !!global.__UNO_PREVIEW__;

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
    let brainrotBattleCloseInFlight = false;
    let playSelection = null;
    let cardPickFlow = null;
    let targetPickFlow = null;
    let colorPickFlow = null;
    let dirFlipTimer = null;
    let saveInFlight = false;
    let commitChain = Promise.resolve();
    let unwiredCardInfo = null;
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

    function gameModalElements() {
        const modal = $('game-modal');
        return { modal, panel: modal?.querySelector(':scope > div') };
    }

    function isGameModalOpen() {
        const modal = $('game-modal');
        return !!modal && !modal.classList.contains('hidden');
    }

    let gameModalLock = Promise.resolve();
    let modalOpId = 0;
    let targetModalActivating = false;

    function withGameModalLock(fn) {
        const run = gameModalLock.then(() => fn());
        gameModalLock = run.catch(() => {});
        return run;
    }

    function clearTargetPickFlow() {
        targetPickFlow = null;
        targetModalActivating = false;
    }

    function targetFlowKey(pendingCardId, effect) {
        return `${effect || 'pick'}:${pendingCardId || 'post'}`;
    }

    function isTargetPickFlowActive() {
        return !!targetPickFlow;
    }

    function isProtectedGameModalFlow() {
        return isTargetPickFlowActive()
            || colorPickFlow?.type === 'pre'
            || !!cardPickFlow;
    }

    function ensureGameModalInteractive() {
        const { modal, panel } = gameModalElements();
        if (!modal) return;
        modal.getAnimations?.().forEach(anim => anim.cancel());
        panel?.getAnimations?.().forEach(anim => anim.cancel());
        modal.style.pointerEvents = 'auto';
        if (panel) panel.style.pointerEvents = 'auto';
        modal.style.opacity = '';
        if (panel) {
            panel.style.opacity = '';
            panel.style.transform = '';
        }
    }

    async function revealGameModal() {
        const myOp = ++modalOpId;
        await withGameModalLock(async () => {
            if (myOp !== modalOpId) return;
            const { modal, panel } = gameModalElements();
            if (!modal) return;
            if (!modal.classList.contains('hidden')) {
                ensureGameModalInteractive();
                return;
            }
            const UI = global.UITransitions;
            if (UI) await UI.openOverlayModal(modal, panel);
            else modal.classList.remove('hidden');
            ensureGameModalInteractive();
        });
    }

    async function hideGameModal(opts = {}) {
        if (!opts.force && isProtectedGameModalFlow()) return;
        const myOp = ++modalOpId;
        await withGameModalLock(async () => {
            if (myOp !== modalOpId) return;
            const { modal, panel } = gameModalElements();
            if (!modal || modal.classList.contains('hidden')) return;
            const UI = global.UITransitions;
            if (UI) await UI.closeOverlayModal(modal, panel);
            else modal.classList.add('hidden');
            cardPickFlow = null;
            if (!opts.keepTargetFlow) clearTargetPickFlow();
        });
    }

    function replaceGameModalContent({ title, description, buildContent }) {
        $('modal-title').textContent = title;
        $('modal-description').textContent = description;
        const content = $('modal-content');
        content.innerHTML = '';
        buildContent(content);
        if (!isGameModalOpen()) {
            revealGameModal();
        } else {
            ensureGameModalInteractive();
        }
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
            const prevLevel = window.AdminConfig?.calcolaLivelloDaXp
                ? window.AdminConfig.calcolaLivelloDaXp(data.xp || 0)
                : (data.livello || 1);
            const progresso = window.AdminConfig?.applicaGuadagnoXp
                ? window.AdminConfig.applicaGuadagnoXp(data.xp || 0, xpGain)
                : { xp: (data.xp || 0) + xpGain, livello: prevLevel };
            await window.updateDoc(ref, {
                xp: progresso.xp,
                livello: progresso.livello,
                vittorie: (data.vittorie || 0) + 1,
                partiteGiocate: (data.partiteGiocate || 0) + 1
            });
            const el = $('end-rewards');
            const levelUp = progresso.livello > prevLevel;
            if (el) {
                el.textContent = levelUp
                    ? `+${xpGain} XP · LIV. ${progresso.livello}!`
                    : `+${xpGain} XP · Vittoria registrata`;
            }
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
            && (!oldPending || pendingWindowKey(oldPending) !== pendingWindowKey(newPending))) {
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

    function pendingWindowResolverId(pending) {
        const order = gameState?.turnOrder || [];
        if (!order.length) return myPlayerId;
        let preferred = null;
        switch (pending?.type) {
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
            pending?.winnerId,
            pending?.defenderId,
            pending?.initiatorId,
            pending?.sourcePlayerId
        ].filter((id, idx, arr) => id && order.includes(id) && arr.indexOf(id) === idx);
        return fallbacks[0] || order[0];
    }

    function resolvePendingWindowAction(pending, options = {}) {
        const resolverId = pendingWindowResolverId(pending);
        switch (pending.type) {
            case 'counterWindow':
                return Engine.resolveCounterWindow(gameState, resolverId, options);
            case 'brainrotBattle':
                return Engine.resolveBrainrotBattle(gameState, resolverId, options);
            case 'drawStackWindow':
                return Engine.resolveDrawStackWindow(gameState, resolverId, options);
            case 'brainrotDiscard':
                return Engine.resolveBrainrotDiscard(gameState, pending.winnerId, [], { force: true, ...options });
            default:
                return { ok: false, error: 'Finestra sconosciuta.' };
        }
    }

    function schedulePendingWindow(pending) {
        if (!pending || !Engine.isPendingTimedWindow(pending)) return;

        const key = pendingWindowKey(pending);
        clearCounterTimers();
        counterWindowKey = key;
        console.log('[COUNTER TIMER START]', {
            type: pending.type,
            key,
            resolvesAt: pending.resolvesAt,
            drawStack: pending.drawStack,
            drawStackType: pending.drawStackType
        });
        renderPendingOverlay(pending);

        const tick = () => {
            const cur = gameState?.pendingAction;
            if (!cur || !Engine.isPendingTimedWindow(cur) || pendingWindowKey(cur) !== key) {
                hideCounterOverlay();
                return;
            }
            const resolvesAt = Number(cur.resolvesAt) || 0;
            const left = Math.min(5, Math.max(0, Math.ceil((resolvesAt - Date.now()) / 1000)));
            updateTimerRing(left, true);
            if (left <= 0) hideCounterOverlayTick();
        };
        tick();
        counterTickTimer = setInterval(tick, 200);

        const resolvesAt = Number(pending.resolvesAt) || Date.now() + 5000;
        const delay = Math.max(0, resolvesAt - Date.now() + 80);
        counterResolveTimer = setTimeout(async () => {
            if (counterWindowKey !== key) return;
            const cur = gameState?.pendingAction;
            if (!cur || pendingWindowKey(cur) !== key) return;

            console.log('[COUNTER TIMER END]', { type: cur.type, key });

            const resolverId = pendingWindowResolverId(cur);
            const expired = Date.now() >= (Number(cur.resolvesAt) || 0) - 80;
            if (resolverId !== myPlayerId && !expired) {
                console.log('[COUNTER TIMER END] skipped — resolver:', resolverId);
                clearCounterTimers();
                hideCounterOverlay();
                return;
            }

            const responseCount = cur.responses ? Object.keys(cur.responses).length : 0;
            if (responseCount === 0) {
                console.log('[NO COUNTER PLAYED]', {
                    type: cur.type,
                    drawStack: cur.drawStack,
                    drawStackType: cur.drawStackType
                });
            }

            await commitAction(() => resolvePendingWindowAction(cur, { force: true }), { quiet: true });
            clearCounterTimers();
            hideCounterOverlay();
            const pa = gameState?.pendingAction;
            if (pa?.type === 'brainrotDiscard' && pa.winnerId === myPlayerId) {
                ensureBrainrotDiscardUi();
            } else {
                clearPlaySelection();
            }
        }, delay);
    }

    function scheduleCounterWindow(pending) {
        schedulePendingWindow(pending);
    }

    function updateTimerRing(secondsLeft, visible = true) {
        const ring = $('timer-ring');
        const el = $('counter-timer');
        if (!ring || !el) return;
        if (!visible) {
            ring.classList.add('hidden');
            return;
        }
        ring.classList.remove('hidden');
        const left = Math.min(5, Math.max(0, secondsLeft));
        el.textContent = String(left).padStart(2, '0');
        ring.style.setProperty('--timer-pct', String((left / 5) * 100));
    }

    function hideCounterOverlayTick() {
        updateTimerRing(0, true);
    }

    function hideCounterOverlay() {
        $('counter-overlay')?.classList.add('hidden');
        const banner = $('pending-banner');
        if (banner) banner.textContent = '';
        updateTimerRing(0, false);
        renderActionRail();
    }

    function renderPendingOverlay(pending) {
        const banner = $('pending-banner');
        const btn = $('btn-contrast');

        let canAct = false;
        let label = 'Attesa risposte…';
        if (pending.type === 'counterWindow') {
            const effectName = pending.cardValue === 'death' ? 'Death Note'
                : pending.cardValue === 'blobby' ? 'Blobby'
                    : pending.cardValue || 'effetto';
            const src = gameState?.players?.[pending.sourcePlayerId]?.nickname || '—';
            label = pending.sourcePlayerId === myPlayerId
                ? `Attesa contrasti a ${effectName} (5s)`
                : `Contrasto ${effectName} — ${src} (5s)`;
            canAct = pending.sourcePlayerId !== myPlayerId && !!firstCounterCard();
        } else if (pending.type === 'brainrotBattle') {
            const init = gameState?.players?.[pending.initiatorId]?.nickname || '—';
            label = `Brainrot Battle — ${init} (5s)`;
            canAct = Engine.canPlayBrainrotResponse(gameState, myPlayerId);
        } else if (pending.type === 'drawStackWindow') {
            const stackLabel = pending.drawStackType === 'draw10' ? '+10'
                : pending.drawStackType === 'draw16' ? '+16'
                    : pending.drawStackType === 'wild4' ? '+4' : '+2';
            const def = gameState?.players?.[pending.defenderId]?.nickname || '—';
            label = pending.defenderId === myPlayerId
                ? `Rispondi stack ${stackLabel} (${pending.drawStack}) — 5s`
                : `Stack ${stackLabel} su ${def} (${pending.drawStack}) — 5s`;
            canAct = pending.defenderId === myPlayerId
                && Engine.canPlayDrawStackResponse(gameState, myPlayerId, { probe: true });
        } else if (pending.type === 'brainrotDiscard') {
            if (banner) {
                banner.textContent = pending.winnerId === myPlayerId
                    ? `Tocca le carte numero in mano, poi «Scarta» o «Fine scarto»`
                    : 'Scarto premio Brainrot…';
            }
            updateTimerRing(0, false);
            if (btn) {
                btn.disabled = true;
                btn.classList.remove('is-active');
            }
            renderActionRail();
            return;
        }
        if (banner) banner.textContent = '';
        updateTimerRing(5, true);
        if (btn) {
            btn.disabled = !canAct;
            btn.classList.toggle('is-active', canAct);
        }
        renderActionRail();
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
        const cx = 50;
        const cy = 50;
        const r = 48;
        const sliceRad = (Math.PI * 2) / n;

        const escXml = (s) => String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
        const labelSize = n > 6 ? 3.2 : n > 4 ? 3.8 : 4.5;

        let paths = '';
        let labels = '';
        for (let i = 0; i < n; i += 1) {
            const a0 = -Math.PI / 2 + sliceRad * i;
            const a1 = -Math.PI / 2 + sliceRad * (i + 1);
            const x0 = cx + r * Math.cos(a0);
            const y0 = cy + r * Math.sin(a0);
            const x1 = cx + r * Math.cos(a1);
            const y1 = cy + r * Math.sin(a1);
            const large = sliceRad > Math.PI ? 1 : 0;
            const fill = colors[i % colors.length];
            paths += `<path d="M ${cx} ${cy} L ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z" fill="${fill}" stroke="#0f172a" stroke-width="0.35"/>`;

            const midRad = -Math.PI / 2 + sliceRad * (i + 0.5);
            const tx = cx + Math.cos(midRad) * 30;
            const ty = cy + Math.sin(midRad) * 30;
            const midDeg = (midRad * 180) / Math.PI + 90;
            const seg = segments[i] || {};
            const name = escXml((seg.nickname || seg.id || '?').slice(0, 10));
            labels += `<text x="${tx.toFixed(2)}" y="${ty.toFixed(2)}" fill="#fff" font-size="${labelSize}" font-weight="700" text-anchor="middle" dominant-baseline="middle" transform="rotate(${midDeg.toFixed(1)} ${tx.toFixed(2)} ${ty.toFixed(2)})" style="paint-order:stroke" stroke="#0f172a" stroke-width="0.35">${name}</text>`;
        }

        wheel.style.background = 'transparent';
        wheel.style.transform = 'rotate(0deg)';
        wheel.innerHTML = `
            <svg class="roulette-svg" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <circle cx="50" cy="50" r="49" fill="#1e293b"/>
                ${paths}
                ${labels}
            </svg>`;

        const hub = document.createElement('div');
        hub.className = 'roulette-hub';
        wheel.appendChild(hub);
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
        if (!lr?.at) return;
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
            if (result) {
                result.textContent = lr.shieldBlocked
                    ? `🛡️ ${hitName} si para con lo Scudo!`
                    : `💥 Colpito: ${hitName}!`;
            }
            playSound(lr.shieldBlocked ? 'click' : 'shot');
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

    const OPP_SLOTS = {
        2: [{ left: '22%', top: '4%' }, { left: '78%', top: '4%' }],
        3: [{ left: '16%', top: '3%' }, { left: '50%', top: '0%' }, { left: '84%', top: '3%' }],
        4: [{ left: '10%', top: '5%' }, { left: '32%', top: '1%' }, { left: '68%', top: '1%' }, { left: '90%', top: '5%' }],
        5: [{ left: '8%', top: '6%' }, { left: '28%', top: '2%' }, { left: '50%', top: '0%' }, { left: '72%', top: '2%' }, { left: '92%', top: '6%' }]
    };

    function opponentSlot(index, total) {
        const key = total <= 2 ? 2 : total <= 3 ? 3 : total <= 4 ? 4 : 5;
        const slots = OPP_SLOTS[key];
        return slots[Math.min(index, slots.length - 1)];
    }

    function renderDirection() {
        const dir = typeof gameState?.direction === 'number' ? gameState.direction : 1;
        const isClockwise = dir > 0;
        const label = isClockwise ? 'Oraria' : 'Antioraria';
        const symbol = isClockwise ? '↻' : '↺';

        const el = $('game-direction');
        if (el) el.textContent = label;

        const ringLabel = $('dir-ring-label');
        if (ringLabel) ringLabel.textContent = `${symbol} ${label}`;

        const ring = $('dir-ring');
        if (ring) {
            const wasCcw = ring.classList.contains('dir-ccw');
            const isCcw = !isClockwise;
            ring.classList.toggle('dir-ccw', isCcw);
            ring.setAttribute('aria-label', `Direzione ${label.toLowerCase()}`);
            if (prevGameState && typeof prevGameState.direction === 'number' && prevGameState.direction !== dir) {
                ring.classList.remove('dir-flip');
                void ring.offsetWidth;
                ring.classList.add('dir-flip');
                clearTimeout(dirFlipTimer);
                dirFlipTimer = setTimeout(() => ring.classList.remove('dir-flip'), 550);
            } else if (wasCcw !== isCcw) {
                ring.classList.remove('dir-flip');
                void ring.offsetWidth;
                ring.classList.add('dir-flip');
                clearTimeout(dirFlipTimer);
                dirFlipTimer = setTimeout(() => ring.classList.remove('dir-flip'), 550);
            }
        }
    }

    function renderGameMode() {
        const el = $('game-mode');
        if (!el || !gameState?.settings) return;
        const parts = [];
        if (gameState.settings.stack) parts.push('STACK');
        if (gameState.settings.brainrot) parts.push('BRAINROT');
        el.textContent = parts.length ? parts.join(' · ') : 'CLASSICA';
    }

    function renderOpponentsArena() {
        const container = $('opponents-arena');
        if (!container || !gameState) return;
        container.innerHTML = '';
        const order = gameState.turnOrder || [];
        const current = Engine.currentPlayerId(gameState);
        const opponents = order.filter(id => id !== myPlayerId);

        opponents.forEach((id, index) => {
            const p = gameState.players[id] || {};
            const slot = opponentSlot(index, opponents.length);
            const seat = document.createElement('div');
            const isTurn = id === current && gameState.status === 'playing';
            seat.className = `opp-seat ${isTurn ? 'opp-turn' : ''} ${p.eliminated ? 'opp-out' : ''}`;
            seat.style.left = slot.left;
            seat.style.top = slot.top;

            const fan = document.createElement('div');
            fan.className = 'opp-mini-fan';
            for (let i = 0; i < 3; i += 1) {
                const mc = document.createElement('span');
                mc.className = 'opp-mini-card';
                fan.appendChild(mc);
            }

            const dossier = document.createElement('div');
            dossier.className = 'opp-dossier';

            const av = document.createElement('div');
            av.className = 'opp-avatar';
            if (AvatarUI) AvatarUI.mountAvatar(av, p.avatar);
            else av.textContent = p.avatar || '🦊';

            const name = document.createElement('div');
            name.className = 'opp-name';
            name.textContent = p.nickname || id;

            const badges = document.createElement('div');
            badges.className = 'opp-badges';
            badges.innerHTML = `
                <span class="opp-badge opp-badge--star">★ 0</span>
                <span class="opp-badge opp-badge--cards">${p.handCount ?? 0} 🃏</span>
            `;

            dossier.appendChild(av);
            dossier.appendChild(name);
            dossier.appendChild(badges);
            seat.appendChild(fan);
            seat.appendChild(dossier);
            container.appendChild(seat);
        });
    }

    function renderMyDossier() {
        const dossier = $('my-dossier');
        const nameEl = $('my-player-label');
        const metaEl = $('my-player-meta');
        const avEl = $('my-dossier-avatar');
        if (!gameState) return;
        const me = gameState.players?.[myPlayerId];
        const count = me?.handCount ?? myHand().length;
        const myTurn = Engine.isMyTurn(gameState, myPlayerId) && gameState.status === 'playing';

        dossier?.classList.toggle('my-turn', myTurn);
        if (nameEl) nameEl.textContent = me?.nickname || 'Tu';
        const handLen = myHand().length;
        if (metaEl) metaEl.textContent = `${handLen > 0 ? handLen : count} 🃏`;
        if (avEl) {
            avEl.innerHTML = '';
            if (AvatarUI) AvatarUI.mountAvatar(avEl, me?.avatar);
            else avEl.textContent = me?.avatar || '🦊';
        }
    }

    function renderActionRail() {
        const pesca = $('btn-pesca');
        const contrast = $('btn-contrast');
        if (!gameState) return;

        if (pesca) {
            pesca.disabled = !Engine.canDraw(gameState, myPlayerId);
        }

        if (contrast) {
            const pending = gameState.pendingAction;
            let canAct = false;
            if (pending?.type === 'counterWindow') {
                canAct = pending.sourcePlayerId !== myPlayerId && !!firstCounterCard();
            } else if (pending?.type === 'drawStackWindow') {
                canAct = pending.defenderId === myPlayerId
                    && Engine.canPlayDrawStackResponse(gameState, myPlayerId, { probe: true });
            } else if (pending?.type === 'brainrotBattle') {
                canAct = Engine.canPlayBrainrotResponse(gameState, myPlayerId);
            } else if (pending?.type === 'brainrotDiscard') {
                canAct = false;
            }
            const pendingTimed = pending && Engine.isPendingTimedWindow(pending);
            contrast.disabled = !canAct;
            contrast.classList.toggle('is-active', canAct && pendingTimed);
            if (pending?.type === 'brainrotDiscard') {
                contrast.disabled = true;
                contrast.classList.remove('is-active');
            }
        }
    }

    function defaultHandOverlapPx(handEl, cardW) {
        if (handEl.classList.contains('hand-size-crowded')) return cardW * 0.5;
        if (handEl.classList.contains('hand-size-many')) return cardW * 0.42;
        return cardW * 0.35;
    }

    function handFanSpreadDeg(n) {
        if (n <= 1) return 0;
        if (n >= 12) return Math.min(16, 4 + n * 0.22);
        return Math.min(n > 16 ? 72 : 56, 8 + n * (n > 16 ? 2.2 : 2.8));
    }

    function applySlotOverlap(slots, overlapPx) {
        slots.forEach((slot, i) => {
            slot.style.marginLeft = i > 0 ? `-${Math.round(overlapPx)}px` : '';
        });
    }

    function isMobileHandLayout() {
        return window.matchMedia('(max-width: 768px)').matches;
    }

    function centerHandInWrap(wrap) {
        if (!wrap) return;
        const overflow = wrap.scrollWidth - wrap.clientWidth;
        wrap.scrollLeft = overflow > 0 ? overflow / 2 : 0;
    }

    function setHandScrollState(handEl, wrap, needsScroll) {
        handEl.classList.toggle('hand-fan-scroll', needsScroll);
        wrap?.classList.toggle('hand-fan-wrap--scroll', needsScroll);
        wrap?.classList.toggle('no-scrollbar', !needsScroll);
    }

    function fitHandToWrap(handEl, slots) {
        const wrap = handEl?.closest('.hand-fan-wrap');
        if (!wrap || slots.length < 2) return;

        const cardEl = slots[0].querySelector('.gc-card-hand');
        const cardW = cardEl?.offsetWidth || 80;
        let overlap = defaultHandOverlapPx(handEl, cardW);

        if (isMobileHandLayout()) {
            applySlotOverlap(slots, overlap);
            const needsScroll = handEl.scrollWidth > wrap.clientWidth - 4;
            setHandScrollState(handEl, wrap, needsScroll);
            if (needsScroll) {
                centerHandInWrap(wrap);
            } else {
                wrap.scrollLeft = 0;
            }
            return;
        }

        const maxOverlap = cardW * 0.52;
        applySlotOverlap(slots, overlap);
        let guard = 0;
        while (handEl.scrollWidth > wrap.clientWidth - 4 && overlap < maxOverlap && guard < 24) {
            overlap += 2;
            applySlotOverlap(slots, overlap);
            guard += 1;
        }

        const needsScroll = handEl.scrollWidth > wrap.clientWidth - 4;
        setHandScrollState(handEl, wrap, needsScroll);
        if (needsScroll) {
            centerHandInWrap(wrap);
        } else {
            wrap.scrollLeft = 0;
        }
    }

    function applyHandFan(handEl) {
        if (!handEl) return;
        const slots = [...handEl.querySelectorAll('.hand-card-slot')];
        const n = slots.length;
        const wrap = handEl.closest('.hand-fan-wrap');
        handEl.classList.remove('hand-fan-scroll');
        wrap?.classList.remove('hand-fan-wrap--scroll');
        wrap?.classList.add('no-scrollbar');
        if (n <= 1) {
            slots.forEach(slot => {
                slot.style.transform = '';
                slot.style.zIndex = '';
                slot.style.marginLeft = '';
            });
            wrap && (wrap.scrollLeft = 0);
            return;
        }
        const maxSpread = handFanSpreadDeg(n);
        slots.forEach((slot, i) => {
            const rot = -maxSpread / 2 + (maxSpread * i) / (n - 1);
            const lift = Math.abs(rot) * 0.12;
            slot.style.transform = `rotate(${rot}deg) translateY(${-lift}px)`;
            slot.style.zIndex = String(i + 1);
        });
        requestAnimationFrame(() => fitHandToWrap(handEl, slots));
    }

    function renderDrawPile() {
        const pile = $('deck-draw');
        if (!pile || !gameState) return;
        const can = Engine.canDraw(gameState, myPlayerId);
        pile.classList.toggle('pile-draw-disabled', !can);
        pile.title = can ? 'Pesca dal mazzo' : 'Non puoi pescare ora';
    }

    function clearPlaySelection() {
        playSelection = null;
        $('play-selection-bar')?.classList.add('hidden');
        $('btn-play-all-dup')?.classList.add('hidden');
        renderHand();
    }

    function updatePlaySelectionBar() {
        const bar = $('play-selection-bar');
        const label = $('play-selection-label');
        const btn = $('btn-confirm-play');
        if (!bar || !playSelection) return;
        bar.classList.remove('hidden');
        $('btn-play-all-dup')?.classList.add('hidden');
        $('btn-play-ladder-alt')?.classList.add('hidden');

        if (playSelection.mode === 'ladder') {
            const nums = formatLadderLabel(playSelection.cards);
            const n = playSelection.cards.length;
            const clickedId = playSelection.cards[0]?.instanceId;
            const fullLadder = clickedId
                ? Engine.getLadderPlay?.(gameState, myPlayerId, clickedId)
                : null;
            const canFullScala = fullLadder?.length > 1;
            if (label) {
                label.textContent = n === 1 && canFullScala
                    ? `Singola o scala? «Gioca ${playSelection.cards[0].value}» = 1 carta · Scala completa o tocca le altre in sequenza`
                    : n === 1
                        ? `Scala: ${nums} — tocca altre copie (↔) o il prossimo numero, oppure gioca singola`
                        : `Scala ${nums} (${n} carte) — tocca le altre copie (↔) per aggiungerle, poi il numero successivo`;
            }
            if (btn) btn.textContent = n === 1 ? `Gioca ${playSelection.cards[0].value}` : 'Gioca scala';
            const hand = myHand();
            const anchor = playSelection.cards[playSelection.cards.length - 1];
            const maxLadder = (canFullScala && n === 1 ? fullLadder : null)
                || (anchor && Engine.buildMaxPlayableLadderFromHand?.(
                    gameState, myPlayerId, hand, anchor
                ));
            if (maxLadder && maxLadder.length > n) {
                const altBtn = $('btn-play-ladder-alt');
                altBtn?.classList.remove('hidden');
                if (altBtn) altBtn.textContent = `Scala completa (${maxLadder.length})`;
                playSelection.maxLadder = maxLadder;
            }
        } else if (playSelection.mode === 'duplicate') {
            const sample = playSelection.cards[0];
            const lbl = duplicateSelectionLabel(sample);
            const total = playSelection.batchSize || playSelection.batch?.length || playSelection.cards.length;
            const n = playSelection.ids.length;
            if (label) {
                label.textContent = `${lbl} — ${n} di ${total} (clic = +1 copia)`;
            }
            if (btn) btn.textContent = n === 1 ? 'Gioca 1' : `Gioca ${n}`;
            const allBtn = $('btn-play-all-dup');
            if (allBtn && total > 1) {
                allBtn.classList.remove('hidden');
                allBtn.textContent = `Gioca tutte (${total})`;
            }
            if (playSelection.altLadder?.length > 1) {
                $('btn-play-ladder-alt')?.classList.remove('hidden');
            }
        } else if (playSelection.mode === 'brainrotDiscard') {
            if (label) {
                label.textContent = `Vittoria Brainrot — seleziona fino a ${playSelection.maxDiscard} carte numero (${playSelection.ids.length} selezionate)`;
            }
            if (btn) {
                btn.textContent = playSelection.ids.length ? `Scarta ${playSelection.ids.length}` : 'Fine scarto';
            }
            $('btn-cancel-play')?.classList.remove('hidden');
        } else if (playSelection.mode === 'sixseven') {
            if (label) {
                label.textContent = `SixSeven: 6+7 (${playSelection.cards.length} carte)`;
            }
            if (btn) btn.textContent = 'Gioca 6+7';
        }
    }

    function duplicateSelectionLabel(card) {
        if (!card) return '—';
        if (card.kind === 'number') {
            return `${card.value} (stesso numero, colori diversi)`;
        }
        if (card.kind === 'action' && ['skip', 'reverse', 'draw2'].includes(card.value)) {
            return `${cardLabel(card)} (stesso tipo, colori diversi)`;
        }
        return `${cardLabel(card)} ×${Engine.getDuplicateBatch(gameState, myPlayerId, card.instanceId).length || 1}`;
    }

    function setDuplicateSelectionCount(count) {
        if (!playSelection?.batch?.length) return;
        const max = playSelection.batch.length;
        const n = Math.max(1, Math.min(max, count));
        startDuplicateSelection(playSelection.batch, n);
    }

    function resolveLadderCardsFromHand(cards) {
        const hand = myHand();
        const resolved = (cards || []).map(c => hand.find(h => h.instanceId === c.instanceId) || c);
        return resolved.filter(c => hand.some(h => h.instanceId === c.instanceId));
    }

    function formatLadderLabel(cards) {
        const parts = [];
        let i = 0;
        while (i < cards.length) {
            const v = cards[i].value;
            let count = 1;
            while (i + count < cards.length && cards[i + count].value === v) count += 1;
            parts.push(count > 1 ? `${v}×${count}` : String(v));
            i += count;
        }
        return parts.join(' → ');
    }

    function startLadderSelection(cards) {
        const resolved = resolveLadderCardsFromHand(cards);
        if (!resolved.length) return;
        playSelection = {
            mode: 'ladder',
            ids: resolved.map(c => c.instanceId),
            cards: resolved
        };
        updatePlaySelectionBar();
        renderHand();
    }

    function startDuplicateSelection(batch, count) {
        const slice = batch.slice(0, count);
        const sample = batch[0];
        const altLadder = sample?.kind === 'number'
            && Engine.hasLadderOption?.(gameState, myPlayerId, sample.instanceId)
            ? Engine.getLadderPlay(gameState, myPlayerId, sample.instanceId)
            : null;
        playSelection = {
            mode: 'duplicate',
            key: Engine.cardDuplicateKey(batch[0]),
            ids: slice.map(c => c.instanceId),
            cards: slice,
            batchSize: batch.length,
            batch,
            altLadder: altLadder?.length > 1 ? altLadder : null
        };
        updatePlaySelectionBar();
        renderHand();
    }

    function cycleDuplicateSelection(batch, card) {
        const key = Engine.cardDuplicateKey(card);
        const fresh = Engine.getDuplicateBatch(gameState, myPlayerId, card.instanceId);
        const pool = fresh.length ? fresh : batch;
        if (playSelection?.mode === 'duplicate' && playSelection.key === key) {
            const max = pool.length;
            const next = (playSelection.ids.length % max) + 1;
            startDuplicateSelection(pool, next);
            return;
        }
        startDuplicateSelection(pool, 1);
    }

    function onLadderCardClick(instanceId) {
        if (!playSelection || playSelection.mode !== 'ladder') return;
        const hand = myHand();
        const card = hand.find(c => c.instanceId === instanceId);
        if (!card || card.kind !== 'number') return;

        const next = Engine.tryIntegrateLadderCard?.(
            gameState, myPlayerId, hand, playSelection.cards, card
        );
        if (next) {
            playSound('click');
            startLadderSelection(next);
            return;
        }

        playSound('error');
        showToast('Tocca un\'altra copia (↔) per inserirla nella scala, o il prossimo numero');
    }

    function onLadderBadgeClick(instanceId) {
        if (!Engine.hasLadderOption?.(gameState, myPlayerId, instanceId)) return;
        const hand = myHand();
        const card = hand.find(c => c.instanceId === instanceId);
        if (!card) return;
        const initial = Engine.getInitialLadderFromCard?.(hand, card);
        if (!initial?.length) return;
        playSound('click');
        startLadderSelection(initial);
    }

    function renderCenter() {
        const top = gameState?.topCard;
        const discard = $('deck-discard');
        const count = $('draw-count');
        if (count) count.textContent = String(gameState?.drawPile?.length ?? 0);
        if (discard && top && CardUI) {
            CardUI.applyCardFace(discard, top, {
                baseClass: 'gc-card gc-card-pile',
                extraClass: ''
            });
            discard.style.transform = 'rotate(5deg)';
        } else if (discard) {
            discard.className = 'gc-card gc-card-pile gc-card-blue';
            discard.innerHTML = '<span class="gc-card-center">—</span>';
        }
        const colorDot = $('active-color-dot');
        if (colorDot && Engine.getDisplayColorInfo) {
            const info = Engine.getDisplayColorInfo(gameState);
            colorDot.title = info.label;
            colorDot.className = `color-${info.cssColor || 'slate'}`;
        }
        const stackEl = $('stack-alert');
        if (stackEl) {
            stackEl.classList.add('hidden');
            stackEl.textContent = '';
        }
    }

    function syncHandDockHeight() {
        const section = document.querySelector('.uno-game .player-stage');
        if (!section) return;
        const h = Math.ceil(section.getBoundingClientRect().height);
        if (h > 0) {
            document.documentElement.style.setProperty('--game-hand-dock', `${h}px`);
            document.documentElement.style.setProperty('--player-dock-h', `${h}px`);
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
        const duplicateCounts = {};
        hand.forEach(card => {
            const k = Engine.cardDuplicateKey(card);
            duplicateCounts[k] = (duplicateCounts[k] || 0) + 1;
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
        const ladderHintIds = playSelection?.mode === 'ladder' && playSelection.cards?.length
            ? (() => {
                const hints = new Set(playSelection.ids);
                const counts = {};
                playSelection.cards.forEach(c => {
                    const r = Number(c.value);
                    counts[r] = (counts[r] || 0) + 1;
                });
                const nextRank = Engine.nextLadderAppendRank?.(playSelection.cards, hand)
                    ?? playSelection.cards.length;
                const dupRanks = new Set(
                    Engine.unusedLadderDuplicateRanks?.(playSelection.cards, hand) || []
                );
                hand.forEach(c => {
                    if (c.kind !== 'number') return;
                    const r = Number(c.value);
                    if (r === nextRank || dupRanks.has(r)) hints.add(c.instanceId);
                });
                return hints;
            })()
            : null;
        const duplicateKey = playSelection?.mode === 'duplicate' ? playSelection.key : null;

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
            const myTurnPlay = canPlay
                && Engine.isMyTurn(gameState, myPlayerId)
                && !mariActive && !brainrotBattle && !drawStackWin && !brainrotDiscard;
            const multiBatchSize = myTurnPlay && Engine.allowsMultiDuplicatePlay?.(card)
                ? Engine.getDuplicateBatch(gameState, myPlayerId, card.instanceId).length
                : 0;
            const hasLadderOption = myTurnPlay && Engine.hasLadderOption?.(gameState, myPlayerId, card.instanceId);
            const inLadderSel = playSelection?.mode === 'ladder' && selIds.has(card.instanceId);
            const playableTurn = myTurnPlay && (
                Engine.canPlayCardThisTurn(gameState, myPlayerId, card)
                || multiBatchSize > 1
                || hasLadderOption
            );
            const playableCounter = canCounter && Engine.canPlayCounter(gameState, myPlayerId, card);
            const playableBrainrot = brainrotBattle && Engine.canPlayBrainrotResponse(gameState, myPlayerId)
                && Engine.isBrainrotCard(card);
            const playableStack = drawStackWin && Engine.canPlayDrawStackResponse(gameState, myPlayerId, card);
            const playableBrainrotDiscard = brainrotDiscardMine
                && Engine.isDiscardableNumberCard?.(card);
            const ladderInteractive = playSelection?.mode === 'ladder' && card.kind === 'number';
            const playable = playableTurn || playableCounter || playableMari || playableBrainrot
                || playableStack || playableBrainrotDiscard || ladderInteractive;
            const showBattleColor = (brainrotBattle || brainrotDiscard) && card.battleColor;
            const dupKey = Engine.cardDuplicateKey(card);
            const dupSize = duplicateCounts[dupKey] || 0;
            const canDupPlay = Engine.allowsMultiDuplicatePlay?.(card);
            const playableDupSize = playableTurn && canDupPlay
                ? Engine.getDuplicateBatch(gameState, myPlayerId, card.instanceId).length
                : 0;
            const dupHintSize = playableTurn && canDupPlay ? dupSize : 0;
            const showDupBadge = playableTurn && canDupPlay && playableDupSize > 1 && !playSelection;
            const showLadderBadge = hasLadderOption && !playSelection;
            const dupCountSelected = duplicateKey === dupKey ? selIds.size : 0;
            const showSelBadge = duplicateKey === dupKey && dupCountSelected > 0;
            const effectiveDupSize = playableDupSize > 1 ? playableDupSize : dupHintSize;
            const lbl = cardLabel(card);
            const fmtDup = n => (n > 9 ? '9+' : String(n));

            const extra = [
                playable ? '' : 'gc-card-disabled',
                playableCounter || playableBrainrot || playableStack ? 'gc-card-counter' : '',
                playableMari ? 'gc-card-mari' : '',
                playableBrainrotDiscard ? 'gc-card-brainrot-pick' : '',
                selIds.has(card.instanceId) ? 'gc-card-selected' : '',
                ladderHintIds?.has(card.instanceId) ? 'gc-card-ladder-hint' : '',
                duplicateKey === dupKey && !selIds.has(card.instanceId) && dupSize > 1 ? 'gc-card-dup-group' : ''
            ].filter(Boolean).join(' ');

            const dupBadge = showDupBadge
                ? `<span class="gc-dup-badge">×${fmtDup(playableDupSize)}</span>`
                : (dupHintSize > 1 && !playSelection
                    ? `<span class="gc-dup-badge" style="opacity:0.65">×${fmtDup(dupHintSize)}</span>`
                    : '');
            const ladderRankCopies = playSelection?.mode === 'ladder' && card.kind === 'number'
                ? hand.filter(c => c.kind === 'number' && Number(c.value) === Number(card.value)).length
                : 0;
            const ladderRankUsed = playSelection?.mode === 'ladder' && card.kind === 'number'
                ? playSelection.cards.filter(c => Number(c.value) === Number(card.value)).length
                : 0;
            const showLadderDupHint = playSelection?.mode === 'ladder'
                && ladderRankCopies > 1
                && ladderHintIds?.has(card.instanceId)
                && (!selIds.has(card.instanceId) || ladderRankUsed < ladderRankCopies);
            const ladderBadge = showLadderBadge
                ? '<span class="gc-ladder-badge" role="button" tabindex="-1">Scala</span>'
                : '';
            const ladderDupHint = showLadderDupHint
                ? '<span class="gc-ladder-dup-hint">↔</span>'
                : '';
            const brainrotSelBadge = playSelection?.mode === 'brainrotDiscard' && selIds.has(card.instanceId)
                ? `<span class="gc-dup-sel">${playSelection.ids.indexOf(card.instanceId) + 1}/${playSelection.maxDiscard}</span>`
                : '';
            const selBadge = brainrotSelBadge || (showSelBadge
                ? `<span class="gc-dup-sel">${dupCountSelected}/${effectiveDupSize}</span>`
                : '');

            btn.dataset.cardId = card.instanceId;
            if (CardUI) {
                btn.type = 'button';
                CardUI.applyCardFace(btn, card, {
                    baseClass: 'gc-card gc-card-hand',
                    extraClass: extra,
                    badges: `${dupBadge}${ladderBadge}${ladderDupHint}${selBadge}`,
                    battleColor: showBattleColor,
                    showNativeTitle: false
                });
            } else {
                btn.type = 'button';
                btn.className = `gc-card gc-card-hand ${Deck.colorStyle(card, { battleColor: showBattleColor })} ${extra}`;
                btn.innerHTML = `<span class="gc-card-center">${lbl}</span>`;
            }
            if (playableBrainrotDiscard) {
                btn.addEventListener('click', () => onToggleBrainrotDiscard(card.instanceId));
            } else if (playableBrainrot) {
                btn.addEventListener('click', () => onPlayBrainrotResponse(card.instanceId));
            } else if (playableStack) {
                btn.addEventListener('click', () => onPlayDrawStackResponse(card.instanceId));
            } else if (playableCounter) {
                btn.addEventListener('click', () => onPlayCounter(card.instanceId));
            } else if (playSelection?.mode === 'ladder' && card.kind === 'number') {
                btn.addEventListener('click', () => onLadderCardClick(card.instanceId));
            } else if (playSelection?.mode === 'duplicate' && duplicateKey === dupKey && playableTurn) {
                btn.addEventListener('click', () => {
                    playSound('click');
                    cycleDuplicateSelection(playSelection.batch, card);
                });
            } else if ((playableTurn || playableMari) && !playSelection) {
                btn.addEventListener('click', () => onPlayCard(card.instanceId));
            }
            btn.querySelector('.gc-ladder-badge')?.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                onLadderBadgeClick(card.instanceId);
            });
            const slot = document.createElement('div');
            slot.className = 'hand-card-slot';
            slot.appendChild(btn);
            handEl.appendChild(slot);
        });
        requestAnimationFrame(() => {
            applyHandFan(handEl);
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

    function brainrotDiscardPhaseKey(pending) {
        if (!pending || pending.type !== 'brainrotDiscard') return null;
        return `${pending.winnerId}-${pending.startedAt}`;
    }

    function startBrainrotDiscardSelection(maxDiscard, phaseKey) {
        playSelection = {
            mode: 'brainrotDiscard',
            ids: [],
            maxDiscard,
            discardKey: phaseKey || brainrotDiscardPhaseKey(gameState?.pendingAction)
        };
        updatePlaySelectionBar();
        renderHand();
    }

    function ensureBrainrotDiscardUi() {
        const pending = gameState?.pendingAction;
        if (pending?.type !== 'brainrotDiscard' || pending.winnerId !== myPlayerId) return;
        const phaseKey = brainrotDiscardPhaseKey(pending);
        if (!playSelection || playSelection.mode !== 'brainrotDiscard' || playSelection.discardKey !== phaseKey) {
            startBrainrotDiscardSelection(pending.maxDiscard, phaseKey);
        }
    }

    function startSixSevenSelection(cards) {
        playSelection = {
            mode: 'sixseven',
            ids: cards.map(c => c.instanceId),
            cards
        };
        updatePlaySelectionBar();
        renderHand();
    }

    function onToggleBrainrotDiscard(instanceId) {
        ensureBrainrotDiscardUi();
        if (!playSelection || playSelection.mode !== 'brainrotDiscard') return;
        const card = myHand().find(c => c.instanceId === instanceId);
        if (!card || !Engine.canBrainrotDiscardCard(gameState, myPlayerId, card)) {
            playSound('error');
            showToast('Puoi scartare solo carte numeriche');
            return;
        }
        const idx = playSelection.ids.indexOf(instanceId);
        if (idx >= 0) {
            playSelection.ids.splice(idx, 1);
        } else if (playSelection.ids.length < playSelection.maxDiscard) {
            playSelection.ids.push(instanceId);
        } else {
            playSound('error');
            showToast(`Puoi scartare al massimo ${playSelection.maxDiscard} carte`);
            return;
        }
        playSound('click');
        updatePlaySelectionBar();
        renderHand();
    }

    async function confirmBrainrotDiscard() {
        if (!playSelection || playSelection.mode !== 'brainrotDiscard') return;
        const pending = gameState?.pendingAction;
        if (pending?.type !== 'brainrotDiscard' || pending.winnerId !== myPlayerId) {
            playSound('error');
            showToast('Fase di scarto Brainrot non attiva');
            return;
        }
        const ids = [...playSelection.ids];
        clearPlaySelection();
        clearCounterTimers();
        playSound(ids.length ? 'cards' : 'click');
        await commitAction(() => Engine.resolveBrainrotDiscard(
            gameState, myPlayerId, ids, { force: true }
        ));
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
            if (Engine.canPlayBrainrotResponse(gameState, myPlayerId)) {
                el.textContent = 'Brainrot Battle: gioca un Brainrot per rispondere!';
            } else if (pending.entries?.[myPlayerId]) {
                const myPt = pending.entries[myPlayerId]?.pt ?? 0;
                const maxPt = Math.max(0, ...Object.values(pending.entries || {}).map(e => e.pt || 0));
                el.textContent = myPt >= maxPt
                    ? 'Stai vincendo — altri hanno ancora 5s per rispondere con un Brainrot'
                    : 'Hai giocato — attendi la chiusura della battaglia (5s)…';
            } else {
                el.textContent = 'Brainrot Battle in corso…';
            }
            el.classList.toggle('animate-pulse', Engine.canPlayBrainrotResponse(gameState, myPlayerId));
            return;
        }
        if (pending?.type === 'drawStackWindow') {
            el.classList.remove('hidden');
            const def = gameState.players[pending.defenderId]?.nickname || '—';
            el.textContent = pending.defenderId === myPlayerId
                ? `Devi rispondere allo stack +${pending.drawStack}!`
                : `Stack +${pending.drawStack} su ${def}`;
            el.classList.toggle('animate-pulse', pending.defenderId === myPlayerId
                && Engine.canPlayDrawStackResponse(gameState, myPlayerId, { probe: true }));
            return;
        }
        if (pending?.type === 'brainrotDiscard') {
            el.classList.remove('hidden');
            const colorLabel = Deck.BRAINROT_BATTLE_COLOR_LABEL?.[pending.battleColor] || pending.battleColor || '';
            el.textContent = pending.winnerId === myPlayerId
                ? `Vittoria Brainrot (${colorLabel}): tocca fino a ${pending.maxDiscard} carte numero, poi conferma in basso`
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
        if (gameState.stackPassPending && gameState.stackSourcePlayerId === myPlayerId
            && (gameState.drawStack || 0) > 0) {
            el.classList.remove('hidden');
            el.textContent = `Stack +${gameState.drawStack} in sospeso — solo altre +carte, poi Fine turno`;
            el.classList.add('animate-pulse');
            return;
        }
        el.classList.remove('hidden');
        const cur = Engine.currentPlayerId(gameState);
        const name = cur === myPlayerId ? 'Tu' : (gameState.players[cur]?.nickname || '—');
        el.textContent = Engine.isMyTurn(gameState, myPlayerId) ? 'È il tuo turno!' : `Turno di: ${name}`;
        el.classList.toggle('animate-pulse', cur === myPlayerId);
    }

    let logPanelOpen = false;

    function escapeLogHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function setLogPanelOpen(open) {
        logPanelOpen = !!open;
        const wrap = $('log-panel-wrap');
        const toggle = $('btn-log-toggle');
        const arrow = toggle?.querySelector('.log-toggle-arrow');
        wrap?.classList.toggle('is-open', logPanelOpen);
        wrap?.setAttribute('aria-hidden', logPanelOpen ? 'false' : 'true');
        toggle?.setAttribute('aria-expanded', logPanelOpen ? 'true' : 'false');
        toggle?.setAttribute('title', logPanelOpen ? 'Chiudi log partita' : 'Apri log partita');
        if (arrow) arrow.textContent = logPanelOpen ? '▸' : '◂';
    }

    function renderLog() {
        const scroll = $('game-log-scroll');
        if (!scroll || !gameState?.log) return;
        const entries = gameState.log;
        const recentFrom = Math.max(0, entries.length - 5);
        scroll.innerHTML = entries.map((e, i) => {
            const recent = i >= recentFrom ? ' log-line--recent' : '';
            return `<p class="log-line${recent}">${escapeLogHtml(e.msg)}</p>`;
        }).join('');
        requestAnimationFrame(() => {
            scroll.scrollTop = scroll.scrollHeight;
        });
    }

    function renderEndTurnButton() {
        const btn = $('btn-end-turn');
        if (!btn || !gameState) return;
        const can = Engine.canEndTurn(gameState, myPlayerId);
        const stackWaiting = can
            && gameState.stackPassPending
            && gameState.stackSourcePlayerId === myPlayerId
            && (gameState.drawStack || 0) > 0;
        btn.disabled = !can;
        btn.title = stackWaiting
            ? `Passa lo stack +${gameState.drawStack} — premi Fine turno`
            : (can ? 'Termina il tuo turno' : 'Non puoi terminare il turno ora');
        btn.classList.toggle('animate-pulse', stackWaiting);
    }

    function renderUnoButton() {
        const btn = $('btn-uno');
        if (!btn || !gameState) return;
        const count = myHand().length;
        const p = gameState.players?.[myPlayerId];
        const said = !!p?.saidUno;
        const mustCall = count === 1 && p?.unoRequired && !said;
        btn.classList.toggle('uno-flash', mustCall);
        btn.classList.toggle('uno-said', count === 1 && said);
        btn.disabled = count !== 1 || said;
        btn.textContent = said ? 'UNO ✓' : 'UNO!';
        btn.title = count === 1
            ? (said ? 'UNO! già detto' : 'Premi prima di giocare l\'ultima carta!')
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
        if (!IS_PREVIEW) {
            grantWinRewards();
        }
        if (returnTimer) clearTimeout(returnTimer);
        if (IS_PREVIEW) {
            global.GameModes?.handlePreviewWin?.(gameState, myPlayerId);
            const hint = document.querySelector('.end-overlay-hint');
            if (hint && !hint.querySelector('a')) {
                hint.textContent = 'Usa «Nuova partita» nella barra in alto o ricarica la pagina.';
            }
            return;
        }
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

    function ensureColorModalOpen() {
        if (!gameState || colorPickFlow?.type === 'pre') return;
        const pending = gameState.pendingAction;
        if (pending?.type === 'chooseColor'
            && pending.playerId === myPlayerId
            && !isGameModalOpen()) {
            showColorModal(null);
        }
    }

    function ensureTargetModalOpen() {
        if (!gameState || colorPickFlow?.type === 'pre') return;
        if (isGameModalOpen()) {
            ensureGameModalInteractive();
            if (isTargetPickFlowActive()) {
                void activateTargetModalButtons();
            }
            return;
        }
        const pending = gameState.pendingAction;
        if (pending?.type === 'chooseTarget' && pending.playerId === myPlayerId) {
            showTargetModal(null, pending.effect);
            return;
        }
        if (targetPickFlow?.type === 'pre' && targetPickFlow.cardId) {
            showTargetModal(targetPickFlow.cardId, targetPickFlow.effect);
        } else if (targetPickFlow?.type === 'post' && targetPickFlow.effect) {
            showTargetModal(null, targetPickFlow.effect);
        }
    }

    async function activateTargetModalButtons() {
        if (!isTargetPickFlowActive()) return;
        await revealGameModal();
        await new Promise(resolve => setTimeout(resolve, 160));
        if (!isTargetPickFlowActive()) return;
        contentDisableTargetButtons(false);
        ensureGameModalInteractive();
    }

    function renderAll() {
        renderDirection();
        renderGameMode();
        renderOpponentsArena();
        renderMyDossier();
        renderCenter();
        renderDrawPile();
        renderActionRail();
        renderHand();
        renderEndTurnButton();
        renderUnoButton();
        renderTurnBanner();
        const pa = gameState?.pendingAction;
        if (pa?.type === 'brainrotDiscard') {
            updateTimerRing(0, false);
            const contrast = $('btn-contrast');
            if (contrast) {
                contrast.disabled = true;
                contrast.classList.remove('is-active');
            }
        } else if (pa && Engine.isPendingTimedWindow(pa)) {
            renderPendingOverlay(pa);
        } else if (!counterResolveTimer) {
            hideCounterOverlay();
        }
        renderLog();
        renderEndScreen();
        ensureColorModalOpen();
        ensureTargetModalOpen();
        ensureBrainrotDiscardUi();
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

    function commitAction(fn, opts = {}) {
        if (!gameState) return Promise.resolve();
        const run = commitChain.then(() => commitActionCore(fn, opts));
        commitChain = run.catch(() => {});
        return run;
    }

    async function commitActionCore(fn, opts = {}) {
        if (!gameState) return;

        const baseVersion = typeof gameState.version === 'number' ? gameState.version : 0;
        const snapshotState = gameState;
        const result = fn();
        if (!result.ok) {
            if (!opts.quiet) {
                playSound('error');
                showToast(result.error || 'Mossa non valida');
            } else {
                console.log('[COUNTER TIMER END] resolve skipped:', result.error);
            }
            return;
        }

        saveInFlight = true;
        try {
            if (IS_PREVIEW) {
                console.log('[PREVIEW SAVE]', {
                    expectedVersion: baseVersion,
                    pendingType: result.state.pendingAction?.type || null
                });
            } else {
                console.log('[FIREBASE SAVE]', {
                    lobbyId,
                    expectedVersion: baseVersion,
                    pendingType: result.state.pendingAction?.type || null,
                    drawStack: result.state.drawStack
                });
            }
            const newVersion = await FS.persistState(lobbyId, result.state, baseVersion);
            result.state.version = newVersion;
            prevGameState = snapshotState;
            gameState = result.state;
            reactToStateChanges(snapshotState, result.state);
            if (!snapshotState?.pendingAction && result.state.pendingAction) {
                /* pending opened */
            } else if (snapshotState?.pendingAction && !result.state.pendingAction) {
                console.log('[NEXT TURN] pending window resolved', {
                    currentPlayer: result.state.turnOrder?.[result.state.currentTurnIndex],
                    turnAdvanceSteps: result.state.turnAdvanceSteps
                });
            }
            if (!opts.quiet) playResultSound(result);
            const rouletteSpin = result.state?.lastRoulette;
            if (rouletteSpin?.at != null && rouletteSpin.at !== lastRouletteAnimatedAt) {
                animateBulletRouletteSpin(rouletteSpin);
            }
            const discardMine = result.state.pendingAction?.type === 'brainrotDiscard'
                && result.state.pendingAction?.winnerId === myPlayerId;
            const keepBrainrotSel = discardMine && playSelection?.mode === 'brainrotDiscard'
                && (
                    snapshotState?.pendingAction?.type === 'brainrotDiscard'
                    || snapshotState?.pendingAction?.type === 'brainrotBattle'
                );
            if (!keepBrainrotSel) {
                clearPlaySelection();
            }
            renderAll();
            handlePending(result.state);
            if (discardMine && (!playSelection || playSelection.mode !== 'brainrotDiscard')) {
                ensureBrainrotDiscardUi();
            }
            if (IS_PREVIEW) {
                await global.GamePreview?.runBotLoop?.();
            }
        } catch (err) {
            console.error(IS_PREVIEW ? '[PREVIEW ERROR]' : '[FIREBASE ERROR]', err);
            console.error('Salvataggio mossa fallito:', err);
            playSound('error');
            if (err instanceof FS.SaveConflictError && err.serverState) {
                prevGameState = gameState;
                gameState = err.serverState;
                renderAll();
                handlePending(err.serverState);
            }
            showToast(FS.mapPersistError(err));
        } finally {
            saveInFlight = false;
        }
    }

    function maybeCloseBrainrotBattle() {
        const pending = gameState?.pendingAction;
        if (!pending || pending.type !== 'brainrotBattle') return;
        if (!Engine.brainrotBattleCanClose?.(gameState)) return;
        if (brainrotBattleCloseInFlight || saveInFlight) return;
        if (counterResolveTimer && counterWindowKey === pendingWindowKey(pending)) return;
        brainrotBattleCloseInFlight = true;
        void commitAction(() => Engine.finishBrainrotBattleIfReady(gameState), { quiet: true })
            .finally(() => { brainrotBattleCloseInFlight = false; });
    }

    function handlePending(state) {
        const pending = state.pendingAction;

        if (pending && Engine.isPendingTimedWindow(pending)) {
            const key = pendingWindowKey(pending);
            if (counterWindowKey !== key) {
                schedulePendingWindow(pending);
            }
            if (pending.type === 'brainrotBattle' && Engine.brainrotBattleCanClose?.(state)) {
                maybeCloseBrainrotBattle();
            }
        } else if (pending?.type === 'brainrotDiscard') {
            clearCounterTimers();
            counterWindowKey = null;
            updateTimerRing(0, false);
        } else if (pending?.type === 'brainrotBattle' && Engine.brainrotBattleCanClose?.(state)) {
            maybeCloseBrainrotBattle();
        }

        if (pending?.type === 'brainrotDiscard' && pending.winnerId === myPlayerId) {
            const phaseKey = brainrotDiscardPhaseKey(pending);
            const samePhase = playSelection?.mode === 'brainrotDiscard'
                && playSelection.discardKey === phaseKey;
            if (!samePhase) {
                startBrainrotDiscardSelection(pending.maxDiscard, phaseKey);
            } else if (playSelection.maxDiscard !== pending.maxDiscard) {
                playSelection.maxDiscard = pending.maxDiscard;
                updatePlaySelectionBar();
            }
        } else if (playSelection?.mode === 'brainrotDiscard') {
            clearPlaySelection();
        }

        if (cardPickFlow || targetPickFlow) return;
        if (colorPickFlow?.type === 'pre') return;
        if (state.pendingAction?.type === 'chooseColor' && state.pendingAction.playerId === myPlayerId) {
            if (!isGameModalOpen()) showColorModal(null);
        }
        if (state.pendingAction?.type === 'chooseTarget' && state.pendingAction.playerId === myPlayerId) {
            if (!isGameModalOpen()) showTargetModal(null, state.pendingAction.effect);
        }
        if (state.pendingAction?.type === 'bulletRoulette' && !state.pendingAction.spun) {
            showBulletRouletteWaiting(state.pendingAction);
        }
    }

    async function onPlayMariCard(instanceId) {
        playSound('click');
        await commitAction(() => Engine.playMariGreenCard(gameState, myPlayerId, instanceId));
    }

    async function playCardsImmediate(instanceIds, options = {}) {
        await commitAction(() => Engine.playCards(gameState, myPlayerId, instanceIds, options));
    }

    async function onPlayCard(instanceId) {
        const hand = myHand();
        const card = hand.find(c => c.instanceId === instanceId);
        if (!card) return;

        playSound('click');

        const pending = gameState.pendingAction;
        if (pending?.type === 'brainrotDiscard' && pending.winnerId === myPlayerId) {
            ensureBrainrotDiscardUi();
            onToggleBrainrotDiscard(instanceId);
            return;
        }
        if (pending?.type === 'brainrotBattle') {
            if (Engine.canPlayBrainrotResponse(gameState, myPlayerId) && Engine.isBrainrotCard(card)) {
                await onPlayBrainrotResponse(instanceId);
                return;
            }
            playSound('error');
            showToast(pending.entries?.[myPlayerId]
                ? 'Battaglia in corso — attendi lo scarto premio'
                : 'Gioca un Brainrot per rispondere, oppure attendi');
            return;
        }

        if (gameState.pendingAction?.type === 'mariGreen') {
            await onPlayMariCard(instanceId);
            return;
        }

        const sixSeven = Engine.getSixSevenBatch(gameState, myPlayerId, instanceId);
        const hasSixSeven = sixSeven.length > 1 && Engine.isValidSixSeven(sixSeven);
        if (hasSixSeven) {
            startSixSevenSelection(sixSeven);
            return;
        }

        if (Engine.hasLadderOption?.(gameState, myPlayerId, instanceId)) {
            startLadderSelection([card]);
            return;
        }

        const batch = Engine.getDuplicateBatch(gameState, myPlayerId, instanceId);
        if (batch.length > 1) {
            cycleDuplicateSelection(batch, card);
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
        if (['death', 'swap', 'nazism', 'communism'].includes(card.value)) {
            showTargetModal(instanceId, card.value);
            return;
        }

        await playCardsImmediate(instanceIds);
    }

    async function confirmLadderPlay() {
        if (!playSelection || playSelection.mode !== 'ladder') return;
        const ids = [...playSelection.ids];
        const cards = [...playSelection.cards];
        if (cards.length > 1
            && (!Engine.isValidLadder?.(cards)
                || !Engine.isValidPlayGroup(gameState, myPlayerId, cards))) {
            playSound('error');
            showToast('Scala non valida');
            return;
        }
        clearPlaySelection();
        playSound('cards');
        await playCardsImmediate(ids);
    }

    async function confirmSixSevenPlay() {
        if (!playSelection || playSelection.mode !== 'sixseven') return;
        const ids = [...playSelection.ids];
        clearPlaySelection();
        playSound('cards');
        await playCardsImmediate(ids);
    }

    async function confirmDuplicatePlay() {
        if (!playSelection || playSelection.mode !== 'duplicate') return;
        const ids = [...playSelection.ids];
        const cards = playSelection.cards;
        const card = cards[0];
        clearPlaySelection();
        playSound('cards');

        if (card.value === 'wild' || card.value === 'wild4') {
            showColorModal(ids.length === 1 ? ids[0] : ids);
            return;
        }
        if (card.value === 'heart') {
            if (!Engine.eliminatedPlayerIds(gameState).length) {
                playSound('error');
                showToast('Nessun giocatore eliminato da rianimare');
                return;
            }
            showTargetModal(ids[0], 'heart');
            return;
        }
        if (['death', 'swap', 'nazism', 'communism'].includes(card.value)) {
            showTargetModal(ids[0], card.value);
            return;
        }

        await playCardsImmediate(ids);
    }

    function showCardPickModal({ title, description, cards, onPick, flowKey }) {
        if (flowKey) cardPickFlow = flowKey;

        replaceGameModalContent({
            title,
            description,
            buildContent: (content) => {
                const list = document.createElement('div');
                list.className = 'modal-card-pick-list no-scrollbar';

                if (!cards.length) {
                    const empty = document.createElement('p');
                    empty.className = 'modal-card-pick-empty';
                    empty.textContent = 'Nessuna carta disponibile.';
                    list.appendChild(empty);
                } else {
                    cards.forEach(card => {
                        const btn = document.createElement('button');
                        btn.type = 'button';
                        btn.className = 'modal-card-pick-btn';
                        if (CardUI) {
                            const cardFace = document.createElement('span');
                            cardFace.className = 'modal-card-pick-face';
                            CardUI.applyCardFace(cardFace, card, {
                                baseClass: 'gc-card gc-card-modal-pick',
                                extraClass: ''
                            });
                            btn.appendChild(cardFace);
                        } else {
                            btn.textContent = cardLabel(card);
                        }
                        btn.addEventListener('click', async (event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            playSound('click');
                            cardPickFlow = null;
                            await hideGameModal({ force: true });
                            await onPick(card);
                        });
                        list.appendChild(btn);
                    });
                }

                content.appendChild(list);
            }
        });
    }

    function showNazismGiveModal(playedCardId, targetId) {
        const targetName = gameState?.players?.[targetId]?.nickname || '—';
        const cards = myHand().filter(c => c.instanceId !== playedCardId);
        showCardPickModal({
            title: 'Nazismo — Carta da cedere',
            description: `Scegli una carta dalla tua mano da dare a ${targetName}.`,
            cards,
            flowKey: `nazism:${playedCardId}:${targetId}`,
            onPick: card => playCardsImmediate([playedCardId], {
                targetId,
                giftCardId: card.instanceId
            })
        });
    }

    function showCommunismStealModal(playedCardId, targetId) {
        const targetName = gameState?.players?.[targetId]?.nickname || '—';
        const cards = [...(gameState.hands[targetId] || [])];
        showCardPickModal({
            title: 'Comunismo — Carta da rubare',
            description: `Scegli una carta da prendere da ${targetName}.`,
            cards,
            flowKey: `communism:${playedCardId}:${targetId}`,
            onPick: card => playCardsImmediate([playedCardId], {
                targetId,
                stolenCardId: card.instanceId
            })
        });
    }

    async function onColorModalPick(event, btn, color, ids) {
        event.preventDefault();
        event.stopPropagation();
        if (btn.disabled) return;
        const content = $('modal-content');
        content?.querySelectorAll('.modal-color-btn').forEach(el => { el.disabled = true; });
        colorPickFlow = null;
        playSound('click');
        await hideGameModal({ force: true });
        if (ids.length) {
            await playCardsImmediate(ids, { chosenColor: color });
        } else {
            await commitAction(() => Engine.chooseColor(gameState, myPlayerId, color));
        }
    }

    function showColorModal(pendingCardIdOrIds) {
        const ids = Array.isArray(pendingCardIdOrIds)
            ? pendingCardIdOrIds
            : (pendingCardIdOrIds ? [pendingCardIdOrIds] : []);
        colorPickFlow = ids.length ? { type: 'pre', ids: [...ids] } : { type: 'post' };

        replaceGameModalContent({
            title: 'Scegli colore',
            description: 'Quale colore vuoi imporre?',
            buildContent: (content) => {
                Deck.COLORS.forEach(color => {
                    const b = document.createElement('button');
                    b.type = 'button';
                    b.className = `modal-color-btn color-${color}`;
                    b.textContent = Deck.COLOR_LABEL[color];
                    b.disabled = true;
                    b.addEventListener('click', (event) => onColorModalPick(event, b, color, ids), { once: true });
                    content.appendChild(b);
                });
            }
        });

        (async () => {
            await revealGameModal();
            await new Promise(resolve => setTimeout(resolve, 160));
            if (!colorPickFlow) return;
            const content = $('modal-content');
            content?.querySelectorAll('.modal-color-btn').forEach(el => { el.disabled = false; });
            ensureGameModalInteractive();
        })();
    }

    async function onTargetModalPick(pendingCardId, effect, targetId, btn) {
        if (btn?.disabled) return;
        if (btn) btn.disabled = true;
        contentDisableTargetButtons(true);
        playSound('click');
        try {
            if (pendingCardId && effect === 'nazism') {
                clearTargetPickFlow();
                await hideGameModal({ force: true });
                showNazismGiveModal(pendingCardId, targetId);
                return;
            }
            if (pendingCardId && effect === 'communism') {
                clearTargetPickFlow();
                await hideGameModal({ force: true });
                showCommunismStealModal(pendingCardId, targetId);
                return;
            }
            clearTargetPickFlow();
            await hideGameModal({ force: true });
            if (pendingCardId) {
                await commitAction(() => Engine.playCards(
                    gameState, myPlayerId, [pendingCardId], { targetId }
                ));
            } else {
                await commitAction(() => Engine.chooseTarget(gameState, myPlayerId, targetId));
            }
        } catch (err) {
            console.error('onTargetModalPick:', err);
            if (btn) btn.disabled = false;
            contentDisableTargetButtons(false);
            targetModalActivating = true;
            targetPickFlow = pendingCardId
                ? {
                    type: 'pre',
                    cardId: pendingCardId,
                    effect,
                    flowKey: targetFlowKey(pendingCardId, effect)
                }
                : { type: 'post', effect, flowKey: targetFlowKey(null, effect) };
            showToast('Errore selezione bersaglio. Riprova.');
            ensureTargetModalOpen();
        }
    }

    function contentDisableTargetButtons(disabled) {
        $('modal-content')?.querySelectorAll('.modal-target-btn').forEach(el => {
            el.disabled = disabled;
        });
    }

    function showTargetModal(pendingCardId, effect) {
        const pickEffect = effect || 'pick';
        const flowKey = targetFlowKey(pendingCardId, pickEffect);
        if (targetPickFlow?.flowKey === flowKey && (isGameModalOpen() || targetModalActivating)) {
            ensureGameModalInteractive();
            void activateTargetModalButtons();
            return;
        }

        targetModalActivating = true;
        targetPickFlow = pendingCardId
            ? { type: 'pre', cardId: pendingCardId, effect: pickEffect, flowKey }
            : { type: 'post', effect: pickEffect, flowKey };

        const isHeart = pickEffect === 'heart';
        const isSwap = pickEffect === 'swap';
        const isDeath = pickEffect === 'death';
        const isNazism = pickEffect === 'nazism';
        const isCommunism = pickEffect === 'communism';
        const title = isHeart
            ? 'Cuore — Rianima'
            : isSwap
                ? 'Scambio — Bersaglio'
                : isDeath
                    ? 'Death Note — Bersaglio'
                    : isNazism
                        ? 'Nazismo — Bersaglio'
                        : isCommunism
                            ? 'Comunismo — Bersaglio'
                            : 'Scegli bersaglio';
        const description = isHeart
            ? 'Scegli un giocatore eliminato da riportare in partita'
            : isSwap
                ? 'Scegli con chi vuoi scambiare la mano'
                : isDeath
                    ? 'Scegli il giocatore da eliminare'
                    : isNazism
                        ? 'A chi vuoi cedere una carta?'
                        : isCommunism
                            ? 'Da quale avversario vuoi rubare una carta?'
                            : 'Seleziona un giocatore';

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

        replaceGameModalContent({
            title,
            description,
            buildContent: (content) => {
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
                    close.addEventListener('click', async (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        clearTargetPickFlow();
                        await hideGameModal({ force: true });
                    });
                    content.appendChild(close);
                    return;
                }

                targets.forEach(({ id, nickname }) => {
                    const b = document.createElement('button');
                    b.type = 'button';
                    b.className = 'modal-target-btn';
                    if (isHeart) b.classList.add('modal-target-revive');
                    b.textContent = isHeart ? `${nickname} (eliminato)` : nickname;
                    b.disabled = true;
                    b.addEventListener('click', (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onTargetModalPick(pendingCardId, pickEffect, id, b);
                    }, { once: true });
                    content.appendChild(b);
                });

                if (pendingCardId) {
                    const cancel = document.createElement('button');
                    cancel.type = 'button';
                    cancel.className = 'modal-target-btn modal-target-cancel';
                    cancel.textContent = 'Annulla';
                    cancel.addEventListener('click', async (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        clearTargetPickFlow();
                        await hideGameModal({ force: true });
                    });
                    content.appendChild(cancel);
                }
            }
        });

        void activateTargetModalButtons();
    }

    function cardByInstanceId(instanceId) {
        if (!instanceId) return null;
        return myHand().find(c => c.instanceId === instanceId) || null;
    }

    function wireCardInfoHandlers() {
        if (unwiredCardInfo) {
            unwiredCardInfo();
            unwiredCardInfo = null;
        }
        const handEl = $('my-hand');
        if (!handEl || !CardInfo?.wireHandCardInfo) return;
        unwiredCardInfo = CardInfo.wireHandCardInfo(handEl, { getCard: cardByInstanceId });
    }

    function wireControls() {
        wireCardInfoHandlers();
        let handReflowTimer;
        const reflowHandLayout = () => {
            const handEl = $('my-hand');
            if (handEl?.querySelector('.hand-card-slot')) {
                applyHandFan(handEl);
            } else {
                syncHandDockHeight();
            }
        };
        const onResizeHandDock = () => {
            syncHandDockHeight();
            clearTimeout(handReflowTimer);
            handReflowTimer = setTimeout(reflowHandLayout, 120);
        };
        window.addEventListener('resize', onResizeHandDock);
        window.addEventListener('orientationchange', () => setTimeout(onResizeHandDock, 150));

        async function onDrawClick() {
            if (!Engine.canDraw(gameState, myPlayerId)) {
                playSound('error');
                showToast('Non puoi pescare ora');
                return;
            }
            await commitAction(() => Engine.drawCard(gameState, myPlayerId));
        }
        $('deck-draw')?.addEventListener('click', onDrawClick);
        $('btn-pesca')?.addEventListener('click', onDrawClick);
        $('btn-uno')?.addEventListener('click', async () => {
            const p = gameState?.players?.[myPlayerId];
            if (myHand().length !== 1 || p?.saidUno) return;
            await commitAction(() => Engine.declareUno(gameState, myPlayerId));
        });
        $('btn-log-toggle')?.addEventListener('click', () => {
            playSound('click');
            setLogPanelOpen(!logPanelOpen);
        });
        $('btn-end-turn')?.addEventListener('click', async () => {
            if (!Engine.canEndTurn(gameState, myPlayerId)) {
                playSound('error');
                showToast('Non puoi terminare il turno ora');
                return;
            }
            await commitAction(() => Engine.endTurn(gameState, myPlayerId));
        });
        $('btn-confirm-play')?.addEventListener('click', () => {
            if (playSelection?.mode === 'brainrotDiscard') confirmBrainrotDiscard();
            else if (playSelection?.mode === 'sixseven') confirmSixSevenPlay();
            else if (playSelection?.mode === 'duplicate') confirmDuplicatePlay();
            else confirmLadderPlay();
        });
        $('btn-play-all-dup')?.addEventListener('click', () => {
            if (playSelection?.mode !== 'duplicate' || !playSelection.batch?.length) return;
            playSound('click');
            setDuplicateSelectionCount(playSelection.batch.length);
            confirmDuplicatePlay();
        });
        $('btn-play-ladder-alt')?.addEventListener('click', () => {
            if (playSelection?.mode === 'ladder' && playSelection.maxLadder?.length > 1) {
                playSound('click');
                startLadderSelection(playSelection.maxLadder);
                return;
            }
            if (!playSelection?.altLadder?.length) return;
            playSound('click');
            startLadderSelection(playSelection.altLadder);
        });
        $('btn-cancel-play')?.addEventListener('click', () => {
            if (playSelection?.mode === 'brainrotDiscard') {
                playSelection.ids = [];
                updatePlaySelectionBar();
                renderHand();
                return;
            }
            clearPlaySelection();
        });
        $('btn-contrast')?.addEventListener('click', async () => {
            const pending = gameState?.pendingAction;
            if (pending?.type === 'brainrotDiscard') {
                playSound('error');
                showToast('Usa la barra in basso: tocca i numeri e premi Scarta');
                return;
            }
            if (pending?.type === 'brainrotBattle') {
                const br = firstBrainrotCard();
                if (!br) {
                    playSound('error');
                    showToast('Nessun Brainrot giocabile');
                    return;
                }
                await onPlayBrainrotResponse(br.instanceId);
                return;
            }
            if (pending?.type === 'drawStackWindow') {
                const stackCard = firstDrawStackCard();
                if (!stackCard) {
                    playSound('error');
                    showToast('Nessuna risposta allo stack');
                    return;
                }
                await onPlayDrawStackResponse(stackCard.instanceId);
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
            if (IS_PREVIEW) {
                window.location.href = 'Menu_principale.html';
                return;
            }
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
        if (global.LobbyNotice?.showLobbyClosedByAdmin) {
            global.LobbyNotice.showLobbyClosedByAdmin({ message: message || ADMIN_LOBBY_MSG });
        } else {
            alert(message || ADMIN_LOBBY_MSG);
            window.location.href = 'Menu_principale.html';
        }
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

    function applyIncomingState(pub, prev) {
        reactToStateChanges(prev, pub);
        prevGameState = prev;
        gameState = pub;
        if (IS_PREVIEW) {
            global.__previewCurrentState__ = pub;
        }
        renderAll();
        handlePending(pub);
        if (pub.pendingAction?.type === 'bulletRoulette' && !pub.pendingAction.spun) {
            showBulletRouletteWaiting(pub.pendingAction);
        }
        hideBulletRouletteIfIdle();
        if (IS_PREVIEW) {
            queueMicrotask(() => global.GamePreview?.runBotLoop?.());
        }
    }

    async function init() {
        if (IS_PREVIEW) {
            lobbyId = 'preview-local';
            myPlayerId = global.GamePreview?.getHumanId?.() || 'preview-human';
            wireControls();
            Sounds?.bindDataSoundListeners?.();
            const ok = await FS.waitForFirebase();
            if (!ok) {
                alert('Preview non pronta. Ricarica la pagina.');
                return;
            }
            await global.GamePreview?.start?.((state, prev) => {
                applyIncomingState(state, prev);
            });
            return;
        }

        const params = new URLSearchParams(window.location.search);
        lobbyId = params.get('stanzaId');
        if (!lobbyId) {
            if (global.LobbyNotice?.showLobbyNotFound) {
                global.LobbyNotice.showLobbyNotFound({ message: 'Stanza non valida o link errato.' });
            } else {
                alert('Stanza non valida.');
                window.location.href = 'Menu_principale.html';
            }
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
        Sounds?.bindDataSoundListeners?.();
        listenLobbyAdminClose();

        unsubGame = FS.subscribeGame(lobbyId, pub => {
            if (!pub) {
                kickToMainMenu(ADMIN_LOBBY_MSG);
                return;
            }
            const incomingVersion = pub.version || 0;
            const localVersion = gameState?.version || 0;
            if (saveInFlight && incomingVersion <= localVersion) {
                return;
            }
            if (!saveInFlight && incomingVersion < localVersion) {
                return;
            }
            applyIncomingState(pub, gameState);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => init());
    } else {
        init();
    }
})(window);
