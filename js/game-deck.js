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
            colors: COLORS,
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
        c_nazismo: { value: 'nazism', kind: 'special', label: 'Naz.', colors: ['red'], count: 1 },
        c_proiettile: { value: 'bullet', kind: 'special', label: '🔫', colors: COLORS, count: 6 },
        c_quagruppo: { value: 'halfdraw', kind: 'special', label: 'Gruppo', colors: ['black'], count: 1 },
        c_messa: { value: 'reshuffle', kind: 'special', label: 'Messa', colors: ['black'], count: 1 },
        c_piani: { value: 'plan', kind: 'special', label: 'Piano', colors: ['black'], count: 3, variants: ['PV', 'PL', 'PO'] },
        c_specchio: { value: 'mirror', kind: 'special', label: 'Specchio', colors: ['black'], count: 1 }
    };

    /** Carte brainrot: incolore in mano; battleColor solo durante lo scontro. */
    const BRAINROT_DEFS = {
        c_br_ladro: { nome: 'Ladro delle Mezze CAPPELLE', pt: 165, battleColor: 'yellow', label: 'Ladro', count: 1 },
        c_br_pothot: { nome: 'Pot HotSborr', pt: 100, battleColor: 'yellow', label: 'PotHot', count: 1 },
        c_br_influen: { nome: 'Influensborrella', pt: 50, battleColor: 'yellow', label: 'Influen', count: 1 },
        c_br_frocettini: { nome: 'FRR FRR FROCETTINI', pt: 70, battleColor: 'pink', label: 'Frocettini', count: 1 },
        c_br_popp: { nome: 'POPP SkibidiPOPP', pt: 65, battleColor: 'pink', label: 'POPP', count: 1 },
        c_br_papero: { nome: 'PaperoSborratico', pt: 125, battleColor: 'pink', label: 'Papero', count: 1 },
        c_br_budinaccio: { nome: 'Budinaccio dello spaccio', pt: 120, battleColor: 'blue', label: 'Budina', count: 1 },
        c_br_giraffa: { nome: 'Giraffa Celeste', pt: 75, battleColor: 'blue', label: 'Giraffa', count: 1 },
        c_br_bobrini: { nome: 'Bobrini cactus merdini', pt: 90, battleColor: 'blue', label: 'Bobrini', count: 1 },
        c_br_centralucci: { nome: 'Centralucci Sborralucci', pt: 55, battleColor: 'blue', label: 'Central', count: 1 },
        c_br_baccala: { nome: "BACCALA' MAGGIOSBORR", pt: 75, battleColor: 'white', label: 'Baccalà', count: 1 }
    };

    const BRAINROT_BATTLE_COLOR_LABEL = {
        yellow: 'Giallo',
        white: 'Bianco',
        pink: 'Rosa',
        blue: 'Blu'
    };

    let instanceCounter = 0;

    function nextInstanceId() {
        instanceCounter += 1;
        return `inst_${Date.now()}_${instanceCounter}_${Math.random().toString(36).slice(2, 7)}`;
    }

    function colorAtIndex(def, index = 0) {
        if (!def?.colors?.length) return 'black';
        return def.colors[index % def.colors.length] || 'black';
    }

    function righelloDisplayLabel(color) {
        const name = COLOR_LABEL[color];
        return name ? `Righello ${name}` : 'Righello';
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
                const copiesPerColor = Math.min(def.perColor, qty);
                def.colors.forEach(color => {
                    for (let i = 0; i < copiesPerColor; i += 1) {
                        cards.push(makeCard(defId, color, def.value, def.kind, def.label));
                    }
                });
                return;
            }

            const variantCap = def.variants ? def.variants.length : null;
            const countCap = def.count ?? variantCap;
            const total = countCap != null ? Math.min(qty, countCap) : qty;

            for (let i = 0; i < total; i += 1) {
                const color = colorAtIndex(def, i);
                const extra = {};
                if (def.variants) {
                    const variantLabel = def.variants[i % def.variants.length];
                    if (defId === 'c_righello') {
                        extra.righelloLabel = righelloDisplayLabel(color);
                        extra.righelloVariantIndex = i % def.variants.length;
                    } else if (defId === 'c_piani') {
                        extra.planPart = variantLabel;
                    }
                } else if (defId === 'c_proiettile') {
                    extra.bulletColorIndex = i % COLORS.length;
                }
                const displayLabel = extra.righelloLabel || def.label;
                cards.push(makeCard(defId, color, def.value, def.kind, displayLabel, extra));
            }
        });

        Object.entries(BRAINROT_DEFS).forEach(([defId, def]) => {
            const qty = parseInt(cardQuantities[defId], 10);
            if (Number.isNaN(qty) || qty <= 0) return;
            const total = Math.min(qty, def.count || 1);
            for (let i = 0; i < total; i += 1) {
                cards.push(makeCard(defId, 'black', 'brainrot', 'brainrot', def.label, {
                    brainrotId: defId,
                    brainrotName: def.nome,
                    pt: def.pt,
                    battleColor: def.battleColor
                }));
            }
        });

        const legacyQty = parseInt(cardQuantities.c_brainrot, 10);
        if (!Number.isNaN(legacyQty) && legacyQty > 0) {
            cards.push(makeCard('c_br_influen', 'black', 'brainrot', 'brainrot', 'Influen', {
                brainrotId: 'c_br_influen',
                brainrotName: BRAINROT_DEFS.c_br_influen.nome,
                pt: 50,
                battleColor: 'yellow'
            }));
        }

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

    function isBrainrotCard(card) {
        return card?.kind === 'brainrot' || card?.value === 'brainrot';
    }

    /** Classi CSS statiche (gioco.html) — non dipendono da Tailwind JIT. */
    function colorStyle(card, opts = {}) {
        if (opts.battleColor && card?.battleColor) {
            const battleMap = {
                yellow: 'card-battle-yellow',
                white: 'card-battle-white',
                pink: 'card-battle-pink',
                blue: 'card-battle-blue'
            };
            return battleMap[card.battleColor] || 'card-brainrot';
        }
        if (isBrainrotCard(card)) {
            return 'card-brainrot';
        }
        const map = {
            red: 'card-red',
            yellow: 'card-yellow',
            green: 'card-green',
            blue: 'card-blue',
            black: 'card-black',
            wild: 'card-wild'
        };
        return map[card?.color] || 'card-default';
    }

    function cardDisplayName(card) {
        if (!card) return '—';
        if (isBrainrotCard(card)) {
            const name = card.brainrotName || card.label;
            const pt = card.pt != null ? ` ${card.pt}PT` : '';
            return `${name}${pt}`;
        }
        const label = card.righelloLabel || card.label;
        if (card.kind === 'number') return `${COLOR_LABEL[card.color] || card.color} ${label}`;
        return `${label} (${COLOR_LABEL[card.color] || card.color})`;
    }

    /** Crea una singola carta per il pannello test Preview (non mescola il mazzo). */
    function spawnPreviewCard(spec = {}) {
        if (spec.type === 'number' || spec.number != null) {
            const color = spec.color || 'red';
            const value = Number(spec.value ?? spec.number);
            if (!COLORS.includes(color) || Number.isNaN(value) || value < 0 || value > 9) return null;
            return makeCard('c_0_9', color, value, 'number', String(value));
        }

        const defId = spec.defId;
        if (!defId) return null;

        const def = SPECIAL_DEFS[defId];
        if (def) {
            const extra = {};
            let label = def.label;
            const copyIndex = spec.copyIndex ?? spec.variantIndex ?? 0;
            const color = spec.color || colorAtIndex(def, copyIndex);
            if (defId === 'c_righello' && def.variants) {
                const vi = spec.variantIndex ?? copyIndex;
                extra.righelloVariantIndex = vi % def.variants.length;
                extra.righelloLabel = righelloDisplayLabel(color);
                label = extra.righelloLabel;
            } else if (defId === 'c_piani' && def.variants) {
                const vi = spec.variantIndex ?? copyIndex;
                extra.planPart = def.variants[vi % def.variants.length];
                label = `${def.label} ${extra.planPart}`.trim();
            } else if (defId === 'c_proiettile') {
                extra.bulletColorIndex = copyIndex % COLORS.length;
            }
            return makeCard(defId, color, def.value, def.kind, label, extra);
        }

        const br = BRAINROT_DEFS[defId];
        if (br) {
            return makeCard(defId, 'black', 'brainrot', 'brainrot', br.label, {
                brainrotId: defId,
                brainrotName: br.nome,
                pt: br.pt,
                battleColor: br.battleColor
            });
        }

        return null;
    }

    global.GameDeck = {
        COLORS,
        COLOR_LABEL,
        colorAtIndex,
        righelloDisplayLabel,
        SPECIAL_DEFS,
        BRAINROT_DEFS,
        BRAINROT_BATTLE_COLOR_LABEL,
        buildFromQuantities,
        shuffle,
        cardDisplayName,
        colorStyle,
        isBrainrotCard,
        makeCard,
        spawnPreviewCard
    };
})(window);
