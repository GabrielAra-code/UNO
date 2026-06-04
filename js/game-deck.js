(function (global) {
    const COLORS = ['red', 'yellow', 'green', 'blue'];
    const COLOR_LABEL = { red: 'Rosso', yellow: 'Giallo', green: 'Verde', blue: 'Blu', black: 'Nero', wild: 'Jolly' };

    const SPECIAL_DEFS = {
        c_piu2: { value: 'draw2', kind: 'action', label: '+2', colors: COLORS, perColor: 2 },
        c_rev: { value: 'reverse', kind: 'action', label: '↺', colors: COLORS, perColor: 2 },
        c_bloc: { value: 'skip', kind: 'action', label: 'Stop', colors: COLORS, perColor: 2 },
        c_cc: { value: 'wild', kind: 'wild', label: 'Colore', colors: ['black'], perColor: 4 },
        c_piu4: { value: 'wild4', kind: 'wild', label: '+4', colors: ['black'], perColor: 4 },
        c_jack: { value: 'jack', kind: 'special', label: 'Jack', colors: ['black'], count: 1 },
        c_piu10: { value: 'draw10', kind: 'special', label: '+10', colors: ['black'], count: 1 },
        c_piu16: { value: 'draw16', kind: 'special', label: '+16', colors: ['black'], count: 1 },
        c_scudo: { value: 'shield', kind: 'special', label: 'Scudo', colors: ['black'], count: 4 },
        c_death: { value: 'death', kind: 'special', label: 'Death', colors: ['black'], count: 1 },
        c_blobby: { value: 'blobby', kind: 'special', label: 'Blobby', colors: ['black'], count: 1 },
        c_righello: {
            value: 'cancel',
            kind: 'special',
            label: 'Righello',
            colors: ['black'],
            count: 4,
            variants: ['Tavolo?', 'Cane?', 'Centrale nucleare?', 'X?']
        },
        c_donna: { value: 'reset', kind: 'special', label: 'Donna', colors: ['black'], count: 1 },
        c_imprevisti: { value: 'surprise', kind: 'special', label: 'Imprev.', colors: ['wild'], count: 1 },
        c_scambio: { value: 'swap', kind: 'special', label: 'Scambio', colors: ['black'], count: 2 },
        c_vaff: { value: 'vaff', kind: 'special', label: 'Vaff.', colors: ['yellow'], count: 2 },
        c_mari: { value: 'mari', kind: 'special', label: 'Mari', colors: ['green'], count: 1 },
        c_onde: { value: 'waves', kind: 'special', label: 'Onde', colors: ['blue'], count: 2 },
        c_cuore: { value: 'heart', kind: 'special', label: 'Cuore', colors: ['green'], count: 2 },
        c_comunismo: { value: 'communism', kind: 'special', label: 'Comun.', colors: ['red'], count: 1 },
        c_nazismo: { value: 'gift', kind: 'special', label: 'Cedi', colors: ['red'], count: 1 },
        c_proiettile: { value: 'bullet', kind: 'special', label: '🔫', colors: ['black'], count: 6 },
        c_quagruppo: { value: 'halfdraw', kind: 'special', label: 'Gruppo', colors: ['black'], count: 1 },
        c_messa: { value: 'reshuffle', kind: 'special', label: 'Messa', colors: ['black'], count: 1 },
        c_piani: { value: 'plan', kind: 'special', label: 'Piano', colors: ['black'], count: 4, variants: ['PV', 'PL', 'PO', 'LT'] },
        c_brainrot: { value: 'brainrot', kind: 'special', label: 'Brain', colors: ['black'], count: 1 },
        c_specchio: { value: 'mirror', kind: 'special', label: 'Specchio', colors: ['black'], count: 1 }
    };

    let instanceCounter = 0;

    function nextInstanceId() {
        instanceCounter += 1;
        return `inst_${Date.now()}_${instanceCounter}_${Math.random().toString(36).slice(2, 7)}`;
    }

    function makeCard(defId, color, value, kind, label, extra = {}) {
        return {
            instanceId: nextInstanceId(),
            defId,
            color,
            value,
            kind,
            label: label || String(value),
            ...extra
        };
    }

    function buildStandardNumbers(quantities) {
        const cards = [];
        const enabled = (quantities?.c_0_9 ?? 20) > 0;
        if (!enabled) return cards;

        COLORS.forEach(color => {
            cards.push(makeCard('c_0_9', color, 0, 'number', '0'));
            for (let n = 1; n <= 9; n += 1) {
                cards.push(makeCard('c_0_9', color, n, 'number', String(n)));
                cards.push(makeCard('c_0_9', color, n, 'number', String(n)));
            }
        });
        return cards;
    }

    function buildFromQuantities(cardQuantities = {}) {
        instanceCounter = 0;
        const cards = [...buildStandardNumbers(cardQuantities)];

        Object.entries(SPECIAL_DEFS).forEach(([defId, def]) => {
            const qty = parseInt(cardQuantities[defId], 10);
            if (Number.isNaN(qty) || qty <= 0) return;

            if (def.perColor) {
                def.colors.forEach(color => {
                    for (let i = 0; i < def.perColor && i < qty; i += 1) {
                        if (cards.length >= qty * def.colors.length) break;
                        cards.push(makeCard(defId, color, def.value, def.kind, def.label));
                    }
                });
                return;
            }

            const total = def.variants
                ? Math.min(qty, def.variants.length)
                : qty;

            for (let i = 0; i < total; i += 1) {
                const color = def.colors[i % def.colors.length] || 'black';
                const extra = {};
                if (def.variants) {
                    const variantLabel = def.variants[i % def.variants.length];
                    if (defId === 'c_righello') {
                        extra.righelloLabel = `Righello o ${variantLabel}`;
                    } else if (defId === 'c_piani') {
                        extra.planPart = variantLabel;
                    }
                }
                const displayLabel = extra.righelloLabel || def.label;
                cards.push(makeCard(defId, color, def.value, def.kind, displayLabel, extra));
            }
        });

        return shuffle(cards);
    }

    function shuffle(arr) {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    function cardDisplayName(card) {
        if (!card) return '—';
        const label = card.righelloLabel || card.label;
        if (card.kind === 'number') return `${COLOR_LABEL[card.color] || card.color} ${label}`;
        return `${label} (${COLOR_LABEL[card.color] || card.color})`;
    }

    function colorStyle(card) {
        const map = {
            red: 'bg-red-600',
            yellow: 'bg-yellow-500 text-slate-900',
            green: 'bg-emerald-600',
            blue: 'bg-blue-600',
            black: 'bg-slate-900 border-amber-500',
            wild: 'bg-gradient-to-br from-purple-600 to-pink-600'
        };
        return map[card?.color] || 'bg-slate-700';
    }

    global.GameDeck = {
        COLORS,
        COLOR_LABEL,
        buildFromQuantities,
        shuffle,
        cardDisplayName,
        colorStyle,
        makeCard
    };
})(window);
