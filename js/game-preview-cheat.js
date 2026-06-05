/**
 * Pannello debug Preview: aggiungi carte alla mano (e opzionalmente sul tavolo) in tempo reale.
 */
(function (global) {
    if (!global.__UNO_PREVIEW__) return;

    const Deck = global.GameDeck;
    const Preview = () => global.GamePreview;

    const GROUPS = [
        { id: 'all', label: 'Tutte' },
        { id: 'numeri', label: 'Numeri' },
        { id: 'classico', label: 'Classiche' },
        { id: 'nero', label: 'Nere' },
        { id: 'speciali', label: 'Speciali' },
        { id: 'eventi', label: 'Eventi' },
        { id: 'brainrot', label: 'Brainrot' }
    ];

    const PER_COLOR_IDS = new Set(['c_piu2', 'c_rev', 'c_bloc']);
    const VARIANT_IDS = new Set(['c_righello', 'c_piani']);

    let catalog = [];
    let activeGroup = 'all';
    let searchQuery = '';
    let panelOpen = false;

    function mapGroup(entry) {
        const cat = entry.cat || '';
        if (cat.includes('Brainrot')) return 'brainrot';
        if (cat.includes('Evento')) return 'eventi';
        if (cat.includes('Classico')) return 'classico';
        if (cat.includes('Nero')) return 'nero';
        return 'speciali';
    }

    function buildCatalog() {
        const items = [];

        Deck.COLORS.forEach(color => {
            for (let v = 0; v <= 9; v += 1) {
                items.push({
                    key: `num-${color}-${v}`,
                    group: 'numeri',
                    label: `${Deck.COLOR_LABEL[color]} ${v}`,
                    color,
                    spawn: () => Deck.spawnPreviewCard({ type: 'number', color, value: v })
                });
            }
        });

        const db = global.databaseCarte || [];
        db.forEach(entry => {
            if (entry.id === 'c_0_9') return;
            if (entry.id.startsWith('c_br_')) {
                items.push({
                    key: entry.id,
                    group: 'brainrot',
                    label: entry.nome,
                    color: 'black',
                    spawn: () => Deck.spawnPreviewCard({ defId: entry.id })
                });
                return;
            }

            const def = Deck.SPECIAL_DEFS?.[entry.id];
            if (!def) return;

            const group = mapGroup(entry);

            if (VARIANT_IDS.has(entry.id) && def.variants?.length) {
                def.variants.forEach((variant, i) => {
                    items.push({
                        key: `${entry.id}-${i}`,
                        group,
                        label: `${entry.nome} · ${variant}`,
                        color: def.colors?.[0] || 'black',
                        spawn: () => Deck.spawnPreviewCard({ defId: entry.id, variantIndex: i })
                    });
                });
                return;
            }

            if (PER_COLOR_IDS.has(entry.id)) {
                Deck.COLORS.forEach(color => {
                    items.push({
                        key: `${entry.id}-${color}`,
                        group: 'classico',
                        label: `${entry.nome} (${Deck.COLOR_LABEL[color]})`,
                        color,
                        spawn: () => Deck.spawnPreviewCard({ defId: entry.id, color })
                    });
                });
                return;
            }

            items.push({
                key: entry.id,
                group,
                label: entry.nome,
                color: def.colors?.[0] || 'black',
                spawn: () => Deck.spawnPreviewCard({ defId: entry.id, color: def.colors?.[0] })
            });
        });

        Object.entries(Deck.BRAINROT_DEFS || {}).forEach(([id, def]) => {
            if (items.some(it => it.key === id)) return;
            items.push({
                key: id,
                group: 'brainrot',
                label: def.nome || def.label || id,
                color: 'black',
                spawn: () => Deck.spawnPreviewCard({ defId: id })
            });
        });

        return items;
    }

    function refreshCatalog() {
        catalog = buildCatalog();
        renderList();
    }

    function filteredItems() {
        const q = searchQuery.trim().toLowerCase();
        return catalog.filter(item => {
            if (activeGroup !== 'all' && item.group !== activeGroup) return false;
            if (!q) return true;
            return item.label.toLowerCase().includes(q) || item.key.toLowerCase().includes(q);
        });
    }

    function handCount() {
        const st = Preview()?.getState?.();
        const hid = Preview()?.getHumanId?.();
        if (!st || !hid) return 0;
        return st.hands?.[hid]?.length ?? st.players?.[hid]?.handCount ?? 0;
    }

    function toast(msg) {
        const el = document.getElementById('game-toast');
        if (!el) return;
        el.textContent = msg;
        el.classList.remove('hidden');
        clearTimeout(toast._t);
        toast._t = setTimeout(() => el.classList.add('hidden'), 1600);
    }

    function addToHand(item) {
        const card = item.spawn?.();
        if (!card) {
            toast('Carta non disponibile');
            return;
        }
        if (!Preview()?.giveHumanCard?.(card)) {
            toast('Avvia prima una partita');
            return;
        }
        updateStatus();
        toast(`+ ${item.label}`);
    }

    function setOnTable(item) {
        const card = item.spawn?.();
        if (!card) return;
        if (!Preview()?.setTopCard?.(card)) {
            toast('Avvia prima una partita');
            return;
        }
        toast(`Tavolo: ${item.label}`);
    }

    function colorClass(color) {
        const map = {
            red: 'preview-cheat-dot--red',
            yellow: 'preview-cheat-dot--yellow',
            green: 'preview-cheat-dot--green',
            blue: 'preview-cheat-dot--blue',
            black: 'preview-cheat-dot--black',
            wild: 'preview-cheat-dot--wild'
        };
        return map[color] || 'preview-cheat-dot--black';
    }

    function renderList() {
        const list = document.getElementById('preview-cheat-list');
        if (!list) return;

        const items = filteredItems();
        list.innerHTML = '';

        if (!items.length) {
            list.innerHTML = '<p class="preview-cheat-empty">Nessuna carta trovata</p>';
            return;
        }

        const frag = document.createDocumentFragment();
        items.forEach(item => {
            const row = document.createElement('div');
            row.className = 'preview-cheat-row';
            row.innerHTML = `
                <span class="preview-cheat-dot ${colorClass(item.color)}" aria-hidden="true"></span>
                <span class="preview-cheat-label" title="${item.label}">${item.label}</span>
                <button type="button" class="preview-cheat-btn preview-cheat-btn--hand" title="Aggiungi alla mano">+</button>
                <button type="button" class="preview-cheat-btn preview-cheat-btn--table" title="Imposta come ultima carta sul tavolo">⬆</button>
            `;
            row.querySelector('.preview-cheat-btn--hand').addEventListener('click', () => addToHand(item));
            row.querySelector('.preview-cheat-btn--table').addEventListener('click', () => setOnTable(item));
            frag.appendChild(row);
        });
        list.appendChild(frag);
    }

    function renderFilters() {
        const wrap = document.getElementById('preview-cheat-filters');
        if (!wrap) return;
        wrap.innerHTML = '';
        GROUPS.forEach(g => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'preview-cheat-chip' + (activeGroup === g.id ? ' is-active' : '');
            btn.textContent = g.label;
            btn.addEventListener('click', () => {
                activeGroup = g.id;
                renderFilters();
                renderList();
            });
            wrap.appendChild(btn);
        });
    }

    function updateStatus() {
        const el = document.getElementById('preview-cheat-status');
        if (!el) return;
        const brainrotOn = Preview()?.getSettings?.()?.brainrot !== false;
        const deckNote = brainrotOn ? '' : ' · Brainrot OFF nel mazzo (puoi comunque aggiungerle qui)';
        el.textContent = `Mano: ${handCount()} carte${deckNote}`;
    }

    function setPanelOpen(open) {
        panelOpen = open;
        const panel = document.getElementById('preview-cheat-panel');
        const toggle = document.getElementById('btn-preview-cheat');
        if (panel) panel.classList.toggle('is-open', open);
        if (toggle) toggle.classList.toggle('is-active', open);
        document.body.classList.toggle('preview-cheat-open', open);
        if (open) {
            refreshCatalog();
            updateStatus();
        }
    }

    function init() {
        const toggle = document.getElementById('btn-preview-cheat');
        const close = document.getElementById('preview-cheat-close');
        const search = document.getElementById('preview-cheat-search');
        const clearBtn = document.getElementById('preview-cheat-clear');
        const refreshBtn = document.getElementById('preview-cheat-refresh');

        toggle?.addEventListener('click', () => setPanelOpen(!panelOpen));
        close?.addEventListener('click', () => setPanelOpen(false));

        search?.addEventListener('input', () => {
            searchQuery = search.value;
            renderList();
        });

        clearBtn?.addEventListener('click', () => {
            if (Preview()?.clearHumanHand?.()) {
                updateStatus();
                toast('Mano svuotata');
            }
        });

        refreshBtn?.addEventListener('click', () => {
            refreshCatalog();
            updateStatus();
        });

        renderFilters();

        document.addEventListener('keydown', ev => {
            if (ev.key === 'Escape' && panelOpen) setPanelOpen(false);
        });

        global.GamePreviewCheat = {
            open: () => setPanelOpen(true),
            close: () => setPanelOpen(false),
            refresh: refreshCatalog
        };
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(typeof window !== 'undefined' ? window : globalThis);
