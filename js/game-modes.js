/**
 * Modalità offline: Storia, Tutorial, Allenamento (vs bot su GiocoPreview.html)
 */
(function (global) {
    const STORAGE_STORY = 'unoStoryProgress';
    const STORAGE_TUTORIAL = 'unoTutorialProgress';

    const STORY_LEVELS = [
        { level: 1, name: 'Primo tavolo', subtitle: '1 bot · facile', bots: 1, diff: 'easy', stack: false, brainrot: false },
        { level: 2, name: 'Doppia sfida', subtitle: '2 bot · facile', bots: 2, diff: 'easy', stack: false, brainrot: false },
        { level: 3, name: 'Cambio ritmo', subtitle: '2 bot · classico+', bots: 2, diff: 'easy', stack: true, brainrot: false },
        { level: 4, name: 'Terzetto', subtitle: '3 bot · medio', bots: 3, diff: 'medium', stack: true, brainrot: false },
        { level: 5, name: 'Pressione', subtitle: '3 bot · medio', bots: 3, diff: 'medium', stack: true, brainrot: false },
        { level: 6, name: 'Brainrot!', subtitle: '3 bot · brainrot ON', bots: 3, diff: 'medium', stack: true, brainrot: true },
        { level: 7, name: 'Quartetto', subtitle: '4 bot · difficile', bots: 4, diff: 'hard', stack: true, brainrot: true },
        { level: 8, name: 'Resistenza', subtitle: '5 bot · difficile', bots: 5, diff: 'hard', stack: true, brainrot: true },
        { level: 9, name: 'Caos totale', subtitle: '6 bot · difficile', bots: 6, diff: 'hard', stack: true, brainrot: true },
        { level: 10, name: 'Boss finale', subtitle: '7 bot · boss', bots: 7, diff: 'hard', stack: true, brainrot: true, hp: 4 }
    ];

    const TUTORIAL_STEPS = [
        {
            step: 1,
            title: 'Carte classiche',
            icon: '🎴',
            summary: 'Numeri, +2, Salta turno e Cambio giro',
            body: 'Impara le basi: abbina colore o numero, usa +2 per far pescare, Salta turno e Cambio giro per controllare il flusso.',
            packs: ['c_0_9', 'c_piu2', 'c_rev', 'c_bloc']
        },
        {
            step: 2,
            title: 'Jolly & +4',
            icon: '🌈',
            summary: 'Cambio colore e penalità +4',
            body: 'Le carte incolore Cambio Colore e +4 ti permettono di cambiare il colore attivo e passare una grossa penalità al successivo.',
            packs: ['c_0_9', 'c_piu2', 'c_rev', 'c_bloc', 'c_cc', 'c_piu4']
        },
        {
            step: 3,
            title: 'Numeri incolori',
            icon: '⚪',
            summary: '0–9 neri senza colore',
            body: 'I numeri incolori si giocano solo sullo stesso numero o sopra speciali incolori. Nessun effetto, ma utili per svuotare la mano.',
            packs: ['c_0_9', 'c_cc', 'c_piu4', 'c_scudo']
        },
        {
            step: 4,
            title: 'Scala & SixSeven',
            icon: '🪜',
            summary: 'Combo avanzate da tavolo',
            body: 'La Scala parte dallo 0 e sale di numero in numero. SixSeven permette di giocare 6 e 7 insieme (anche copie multiple).',
            packs: ['c_0_9', 'c_piu2', 'c_rev', 'c_bloc', 'c_cc', 'c_piu4']
        },
        {
            step: 5,
            title: 'Scudo & contrasti',
            icon: '🛡️',
            summary: 'Difesa e annullamento',
            body: 'Lo Scudo blocca effetti come Blobby. Annulla e altre risposte chiudono la finestra da 5 secondi degli effetti speciali.',
            packs: ['c_0_9', 'c_scudo', 'c_blobby', 'c_death']
        },
        {
            step: 6,
            title: 'Proiettile & HP',
            icon: '🔫',
            summary: 'Roulette e punti vita',
            body: 'Il Proiettile avvia la roulette: un bersaglio casuale perde HP. Con 0 HP sei eliminato (a meno di Scudo al momento giusto).',
            packs: ['c_0_9', 'c_proiettile', 'c_scudo']
        },
        {
            step: 7,
            title: 'Brainrot Battle',
            icon: '🧠',
            summary: 'Sfide PT e scarto premio',
            body: 'Gioca un Brainrot per aprire la battaglia: tutti possono rispondere in 5s. Vince il PT più alto e scarta carte numero come premio.',
            packs: ['c_0_9', 'c_piu2', 'c_br_influen']
        },
        {
            step: 8,
            title: 'Vittorie speciali',
            icon: '👑',
            summary: 'Death, Blobby, Piani…',
            body: 'Alcune carte possono chiudere la partita in modo spettacolare: Death Note, Blobby+Scudo, o i 4 Piani di Proiezione collezionati.',
            packs: ['c_0_9', 'c_death', 'c_blobby', 'c_scudo', 'c_piani']
        }
    ];

    const TUTORIAL_PACK_IDS = {
        c_br_influen: true
    };

    function getStoryProgress() {
        const n = parseInt(localStorage.getItem(STORAGE_STORY) || '1', 10);
        return Number.isNaN(n) ? 1 : Math.min(STORY_LEVELS.length, Math.max(1, n));
    }

    function setStoryProgress(level) {
        const next = Math.min(STORY_LEVELS.length, Math.max(1, level));
        localStorage.setItem(STORAGE_STORY, String(next));
        return next;
    }

    function getTutorialProgress() {
        const n = parseInt(localStorage.getItem(STORAGE_TUTORIAL) || '1', 10);
        return Number.isNaN(n) ? 1 : Math.min(TUTORIAL_STEPS.length, Math.max(1, n));
    }

    function setTutorialProgress(step) {
        const next = Math.min(TUTORIAL_STEPS.length, Math.max(1, step));
        localStorage.setItem(STORAGE_TUTORIAL, String(next));
        return next;
    }

    function getStoryLevel(level) {
        return STORY_LEVELS.find(l => l.level === level) || STORY_LEVELS[0];
    }

    function getTutorialStep(step) {
        return TUTORIAL_STEPS.find(s => s.step === step) || TUTORIAL_STEPS[0];
    }

    function buildPreviewUrl(params) {
        const q = new URLSearchParams(params);
        return `GiocoPreview.html?${q.toString()}`;
    }

    function launchStoryLevel(level) {
        const cfg = getStoryLevel(level);
        if (level > getStoryProgress()) return;
        window.location.href = buildPreviewUrl({
            mode: 'story',
            level: String(cfg.level),
            bots: String(cfg.bots),
            diff: cfg.diff,
            stack: cfg.stack ? '1' : '0',
            brainrot: cfg.brainrot ? '1' : '0',
            hp: String(cfg.hp || 3)
        });
    }

    function launchTutorialStep(step) {
        const cfg = getTutorialStep(step);
        if (step > getTutorialProgress()) return;
        const hasStackCards = cfg.packs.some(p =>
            p === 'c_piu2' || p === 'c_piu4' || p === 'c_piu10' || p === 'c_piu16'
        );
        window.location.href = buildPreviewUrl({
            mode: 'tutorial',
            step: String(cfg.step),
            bots: '1',
            diff: 'easy',
            stack: hasStackCards ? '1' : '0',
            brainrot: cfg.packs.some(p => p.startsWith('c_br')) ? '1' : '0'
        });
    }

    function launchTraining(cfg) {
        const bots = Math.min(14, Math.max(1, parseInt(cfg.bots, 10) || 2));
        window.location.href = buildPreviewUrl({
            mode: 'training',
            bots: String(bots),
            diff: cfg.diff || 'medium',
            stack: cfg.stack ? '1' : '0',
            brainrot: cfg.brainrot ? '1' : '0',
            hp: String(cfg.hp || 3)
        });
    }

    function renderStoryMap() {
        const host = document.getElementById('story-map-nodes');
        if (!host) return;
        const unlocked = getStoryProgress();
        host.innerHTML = '';
        STORY_LEVELS.forEach((lvl, idx) => {
            const isUnlocked = lvl.level <= unlocked;
            const isDone = lvl.level < unlocked;
            const side = idx % 2 === 0 ? 'left' : 'right';
            const row = document.createElement('div');
            row.className = `story-map-row story-map-row--${side}`;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = [
                'story-map-node',
                isUnlocked ? 'is-unlocked' : 'is-locked',
                isDone ? 'is-done' : '',
                lvl.level === unlocked ? 'is-current' : ''
            ].filter(Boolean).join(' ');
            btn.disabled = !isUnlocked;
            btn.innerHTML = `
                <span class="story-map-node-num">${lvl.level}</span>
                <span class="story-map-node-info">
                    <span class="story-map-node-name">${lvl.name}</span>
                    <span class="story-map-node-sub">${lvl.subtitle}</span>
                </span>
                <span class="story-map-node-badge">${isDone ? '✓' : isUnlocked ? '▶' : '🔒'}</span>
            `;
            if (isUnlocked) {
                btn.addEventListener('click', () => launchStoryLevel(lvl.level));
            }
            row.appendChild(btn);
            host.appendChild(row);
        });
        const prog = document.getElementById('story-map-progress');
        if (prog) {
            prog.textContent = `Progresso: ${Math.max(0, unlocked - 1)} / ${STORY_LEVELS.length} completati`;
        }
    }

    function renderTutorialList() {
        const host = document.getElementById('tutorial-steps-list');
        if (!host) return;
        const unlocked = getTutorialProgress();
        host.innerHTML = '';
        TUTORIAL_STEPS.forEach(step => {
            const isUnlocked = step.step <= unlocked;
            const isDone = step.step < unlocked;
            const card = document.createElement('button');
            card.type = 'button';
            card.className = `tutorial-step-card ${isUnlocked ? '' : 'is-locked'} ${isDone ? 'is-done' : ''}`;
            card.disabled = !isUnlocked;
            card.innerHTML = `
                <span class="tutorial-step-icon">${step.icon}</span>
                <span class="tutorial-step-body">
                    <span class="tutorial-step-title">${step.step}. ${step.title}</span>
                    <span class="tutorial-step-summary">${step.summary}</span>
                </span>
                <span class="tutorial-step-go">${isDone ? '✓' : '▶'}</span>
            `;
            if (isUnlocked) {
                card.addEventListener('click', () => launchTutorialStep(step.step));
            }
            host.appendChild(card);
        });
    }

    function initTrainingForm() {
        const botsInput = document.getElementById('training-bots');
        const botsVal = document.getElementById('training-bots-val');
        const diffSelect = document.getElementById('training-diff');
        const stackCb = document.getElementById('training-stack');
        const brainrotCb = document.getElementById('training-brainrot');
        const startBtn = document.getElementById('training-start-btn');

        if (botsInput && botsVal) {
            const sync = () => { botsVal.textContent = botsInput.value; };
            botsInput.addEventListener('input', sync);
            sync();
        }

        startBtn?.addEventListener('click', () => {
            launchTraining({
                bots: botsInput?.value || '2',
                diff: diffSelect?.value || 'medium',
                stack: stackCb?.checked !== false,
                brainrot: brainrotCb?.checked !== false
            });
        });
    }

    function initMenu() {
        initTrainingForm();
    }

    let previewWinHandled = false;

    function handlePreviewWin(state, humanId) {
        if (!state || state.status !== 'finished' || previewWinHandled) return;
        if (state.winnerId !== humanId) return;

        const params = new URLSearchParams(window.location.search);
        const mode = params.get('mode');
        previewWinHandled = true;

        if (mode === 'story') {
            const level = parseInt(params.get('level') || '1', 10);
            const next = setStoryProgress(level + 1);
            const title = document.getElementById('end-title');
            const hint = document.querySelector('.end-overlay-hint');
            if (title) {
                title.textContent = level >= STORY_LEVELS.length
                    ? 'Storia completata!'
                    : `Livello ${level} completato!`;
            }
            if (hint) {
                hint.innerHTML = level >= STORY_LEVELS.length
                    ? '<a href="Menu_principale.html" class="text-amber-300 underline font-black">Torna al menu</a>'
                    : `Sbloccato livello ${Math.min(next, STORY_LEVELS.length)}! <a href="Menu_principale.html" class="text-amber-300 underline font-black">Mappa storia</a>`;
            }
            return;
        }

        if (mode === 'tutorial') {
            const step = parseInt(params.get('step') || '1', 10);
            setTutorialProgress(step + 1);
            const title = document.getElementById('end-title');
            const hint = document.querySelector('.end-overlay-hint');
            if (title) title.textContent = `Tutorial ${step} completato!`;
            if (hint) {
                hint.innerHTML = step >= TUTORIAL_STEPS.length
                    ? '<a href="Menu_principale.html" class="text-amber-300 underline font-black">Torna al menu</a>'
                    : `<a href="Menu_principale.html" class="text-amber-300 underline font-black">Prossima lezione</a>`;
            }
        }
    }

    function resetPreviewWinFlag() {
        previewWinHandled = false;
    }

    function getTutorialCardQuantities(step, baseBuilder) {
        const cfg = getTutorialStep(step);
        const allowed = new Set(cfg.packs || []);
        const full = baseBuilder();
        const q = { c_0_9: 12 };
        Object.keys(full).forEach(id => {
            if (allowed.has(id)) q[id] = full[id];
        });
        Object.keys(global.GameDeck?.BRAINROT_DEFS || {}).forEach(id => {
            if (allowed.has(id)) q[id] = 1;
        });
        return q;
    }

    function getModeLabel(params) {
        const mode = params.get('mode') || 'training';
        if (mode === 'story') {
            const lvl = getStoryLevel(parseInt(params.get('level') || '1', 10));
            return `Storia · ${lvl.name} (${lvl.bots} bot)`;
        }
        if (mode === 'tutorial') {
            const step = getTutorialStep(parseInt(params.get('step') || '1', 10));
            return `Tutorial · ${step.title}`;
        }
        const bots = params.get('bots') || '2';
        const diff = params.get('diff') || 'medium';
        return `Allenamento · ${bots} bot · ${diff}`;
    }

    function getTutorialIntroHtml(step) {
        const cfg = getTutorialStep(step);
        return `<strong>${cfg.icon} ${cfg.title}</strong><p class="mt-2 text-sm text-slate-300">${cfg.body}</p>`;
    }

    global.GameModes = {
        STORY_LEVELS,
        TUTORIAL_STEPS,
        getStoryProgress,
        getTutorialProgress,
        getStoryLevel,
        getTutorialStep,
        launchStoryLevel,
        launchTutorialStep,
        launchTraining,
        renderStoryMap,
        renderTutorialList,
        initMenu,
        handlePreviewWin,
        resetPreviewWinFlag,
        getTutorialCardQuantities,
        getModeLabel,
        getTutorialIntroHtml,
        DIFFICULTY: {
            easy: { brainrot: 0.22, counter: 0.2, stack: 0.5 },
            medium: { brainrot: 0.4, counter: 0.38, stack: 0.72 },
            hard: { brainrot: 0.58, counter: 0.55, stack: 0.9 }
        }
    };

})(typeof window !== 'undefined' ? window : globalThis);
