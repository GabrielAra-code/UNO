/** Catalogo Index: una voce per tipo di carta, con conteggio copie nel mazzo. */
(function (global) {
    const COLORS = ['red', 'yellow', 'green', 'blue'];
    const COLOR_LABEL = { red: 'Rosso', yellow: 'Giallo', green: 'Verde', blue: 'Blu' };

    const EXPAND_PACK_IDS = new Set([
        'c_0_9', 'c_piu2', 'c_rev', 'c_bloc', 'c_cc', 'c_piu4',
        'c_scudo', 'c_righello', 'c_piani', 'c_proiettile',
        'c_scambio', 'c_vaff', 'c_cuore', 'c_onde'
    ]);

    function entry(pack, overrides) {
        const deckCount = overrides.deckCount ?? parseInt(overrides.quantita, 10) || 1;
        return {
            packId: pack.id,
            quantita: String(deckCount),
            deckCount,
            ...pack,
            ...overrides
        };
    }

    function expandNumbers(pack) {
        const out = [];
        COLORS.forEach(color => {
            out.push(entry(pack, {
                id: `c_num_0_${color}`,
                nome: `0 ${COLOR_LABEL[color]}`,
                deckCount: 1,
                colorHint: color,
                cat: '🔢 Carte Numeriche'
            }));
            for (let n = 1; n <= 9; n += 1) {
                out.push(entry(pack, {
                    id: `c_num_${n}_${color}`,
                    nome: `${n} ${COLOR_LABEL[color]}`,
                    deckCount: 2,
                    colorHint: color,
                    cat: '🔢 Carte Numeriche'
                }));
            }
        });
        return out;
    }

    function expandPerColorUnique(pack, label, catSuffix) {
        return COLORS.map(color => entry(pack, {
            id: `${pack.id}_${color}`,
            nome: `${label} ${COLOR_LABEL[color]}`,
            deckCount: 2,
            colorHint: color,
            cat: pack.cat || catSuffix
        }));
    }

    function expandSingleWithCount(pack, count, nomeOverride) {
        return [entry(pack, {
            id: pack.id,
            nome: nomeOverride || pack.nome,
            deckCount: count
        })];
    }

    function brainrotColorHint(effetto) {
        const testo = String(effetto || '');
        if (testo.includes('Giallo')) return 'battle-yellow';
        if (testo.includes('Rosa')) return 'battle-pink';
        if (testo.includes('Blu')) return 'battle-blue';
        if (testo.includes('Bianco')) return 'battle-white';
        return 'brainrot';
    }

    function eventColorHint(cat) {
        const testo = String(cat || '');
        if (testo.includes('Rosso')) return 'red';
        if (testo.includes('Giallo')) return 'yellow';
        if (testo.includes('Verde')) return 'green';
        if (testo.includes('Blu')) return 'blue';
        return 'black';
    }

    const EXPANDERS = {
        c_0_9: expandNumbers,
        c_piu2: (pack) => expandPerColorUnique(pack, '+2', '🟥🟨🟩🟦 Classico'),
        c_rev: (pack) => expandPerColorUnique(pack, '↺', '🟥🟨🟩🟦 Classico'),
        c_bloc: (pack) => expandPerColorUnique(pack, 'Stop', '🟥🟨🟩🟦 Classico'),
        c_cc: (pack) => expandSingleWithCount(pack, 4, 'Cambio Colore'),
        c_piu4: (pack) => expandSingleWithCount(pack, 4, '+4'),
        c_scudo: (pack) => expandSingleWithCount(pack, 4, 'Scudo'),
        c_righello: (pack) => COLORS.map(color => entry(pack, {
            id: `c_righello_${color}`,
            nome: `Righello ${COLOR_LABEL[color]}`,
            deckCount: 1,
            colorHint: color
        })),
        c_piani: (pack) => {
            const parts = [
                { code: 'PV', nome: 'Piano P.V.', short: 'P.V.' },
                { code: 'PL', nome: 'Piano P.L.', short: 'P.L.' },
                { code: 'PO', nome: 'Piano P.O.', short: 'P.O.' }
            ];
            return parts.map(part => entry(pack, {
                id: `c_piani_${part.code.toLowerCase()}`,
                nome: part.nome,
                displayLabel: part.short,
                deckCount: 1,
                colorHint: 'black',
                cat: '📐 Piani di Proiezione'
            }));
        },
        c_proiettile: (pack) => {
            const perColor = [2, 2, 1, 1];
            return COLORS.map((color, i) => entry(pack, {
                id: `c_proiettile_${color}`,
                nome: `Proiettile ${COLOR_LABEL[color]}`,
                deckCount: perColor[i],
                colorHint: color
            }));
        },
        c_scambio: (pack) => expandSingleWithCount(pack, 2, 'Scambio'),
        c_vaff: (pack) => expandSingleWithCount(pack, 2, 'Vaffanculo'),
        c_cuore: (pack) => expandSingleWithCount(pack, 2, 'Cuore'),
        c_onde: (pack) => expandSingleWithCount(pack, 2, 'Le ONDE')
    };

    function enrichSinglePack(pack) {
        const extra = { packId: pack.packId || pack.id, deckCount: parseInt(pack.quantita, 10) || 1 };
        if (pack.cat?.includes('Brainrot')) {
            extra.colorHint = brainrotColorHint(pack.effetto);
        } else if (pack.cat?.includes('Evento')) {
            extra.colorHint = eventColorHint(pack.cat);
        } else if (pack.cat?.includes('Nero') || pack.cat?.includes('Speciale UNO')) {
            extra.colorHint = 'black';
        } else if (pack.cat?.includes('Incolore')) {
            extra.colorHint = 'wild';
        }
        return { ...pack, ...extra };
    }

    function buildCatalogoIndex() {
        const base = global.databaseCarte || [];
        const out = [];

        base.forEach(pack => {
            const expand = EXPANDERS[pack.id];
            if (expand) {
                out.push(...expand(pack));
                return;
            }
            out.push(enrichSinglePack(pack));
        });

        return out;
    }

    /** Crea una carta di anteprima per la griglia INDEX dal record catalogo. */
    function spawnFromCatalogEntry(carta) {
        const Deck = global.GameDeck;
        if (!carta || !Deck) return null;

        const id = String(carta.id || '');
        const packId = carta.packId || id;

        const numMatch = id.match(/^c_num_(\d+)_(red|yellow|green|blue)$/);
        if (numMatch) {
            return Deck.spawnPreviewCard({
                type: 'number',
                color: numMatch[2],
                value: Number(numMatch[1])
            });
        }

        const colorSuffix = id.match(/^(c_[a-z0-9]+)_(red|yellow|green|blue)$/);
        if (colorSuffix && Deck.SPECIAL_DEFS?.[colorSuffix[1]]) {
            const defId = colorSuffix[1];
            const color = colorSuffix[2];
            if (defId === 'c_righello') {
                const vi = COLORS.indexOf(color);
                return Deck.spawnPreviewCard({ defId, variantIndex: vi >= 0 ? vi : 0 });
            }
            if (defId === 'c_proiettile') {
                const ci = COLORS.indexOf(color);
                return Deck.spawnPreviewCard({ defId, copyIndex: ci >= 0 ? ci : 0 });
            }
            return Deck.spawnPreviewCard({ defId, color });
        }

        const pianoMatch = id.match(/^c_piani_(pv|pl|po)$/i);
        if (pianoMatch) {
            const idx = { pv: 0, pl: 1, po: 2 }[pianoMatch[1].toLowerCase()];
            return Deck.spawnPreviewCard({ defId: 'c_piani', variantIndex: idx ?? 0 });
        }

        if (id.startsWith('c_br_') && Deck.BRAINROT_DEFS?.[id]) {
            return Deck.spawnPreviewCard({ defId: id });
        }

        if (Deck.SPECIAL_DEFS?.[packId]) {
            const hint = carta.colorHint;
            const playableColors = new Set([...COLORS, 'black', 'wild']);
            const color = playableColors.has(hint) ? hint : undefined;
            return Deck.spawnPreviewCard({ defId: packId, color });
        }

        return null;
    }

    let cached = null;

    global.CarteCatalog = {
        buildCatalogoIndex,
        getCatalogoIndex() {
            if (!cached) cached = buildCatalogoIndex();
            return cached;
        },
        spawnFromCatalogEntry,
        isPackExpanded(packId) {
            return EXPAND_PACK_IDS.has(packId);
        },
        invalidateCache() {
            cached = null;
        }
    };
})(typeof window !== 'undefined' ? window : globalThis);
