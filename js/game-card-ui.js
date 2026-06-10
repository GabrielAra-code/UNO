/** Rendering carte partita — stile Index / UNO classico (forma reale, bordo bianco, rialzo). */
(function (global) {
    const Deck = global.GameDeck;

    const COLOR_LABEL = Deck?.COLOR_LABEL || {
        red: 'Rosso', yellow: 'Giallo', green: 'Verde', blue: 'Blu', black: 'Nero', wild: 'Jolly'
    };

    /** Carte con artwork dedicato (percorso relativo alla root del progetto). */
    const CARD_ART = {
        c_death: 'carte/DeathNote.png',
        c_blobby: 'carte/Blobby.png',
        c_donna: 'carte/Donna.png',
        c_comunismo: 'carte/Comunismo.png',
        c_cuore: 'carte/Cuore.png',
        c_mari: 'carte/Marijuana.png',
        c_nazismo: 'carte/Nazismo.png',
        c_onde: 'carte/Onde.png',
        c_vaff: 'carte/Vaffanculo.png'
    };

    const VALUE_ART = {
        death: CARD_ART.c_death,
        blobby: CARD_ART.c_blobby,
        reset: CARD_ART.c_donna,
        communism: CARD_ART.c_comunismo,
        heart: CARD_ART.c_cuore,
        mari: CARD_ART.c_mari,
        nazism: CARD_ART.c_nazismo,
        waves: CARD_ART.c_onde,
        vaff: CARD_ART.c_vaff
    };

    const ART_LABELS = {
        death: 'Death Note',
        blobby: 'Blobby',
        reset: 'Donna di Mazze',
        communism: 'Comunismo',
        heart: 'Cuore',
        mari: 'Mariguana',
        nazism: 'Nazismo',
        waves: 'Le ONDE',
        vaff: 'Vaffanculo'
    };

    const RIGHELLO_ART = {
        red: 'carte/RighelloRosso.png',
        yellow: 'carte/RighelloGiallo.png',
        green: 'carte/RighelloVerde.png',
        blue: 'carte/RighelloBlu.png'
    };

    function isRighelloCard(card) {
        return !!card && (card.value === 'cancel' || card.defId === 'c_righello' || card.defId?.startsWith('c_righello_'));
    }

    function resolveCardArt(card) {
        if (!card) return null;
        if (isRighelloCard(card) && RIGHELLO_ART[card.color]) return RIGHELLO_ART[card.color];
        if (card.defId && CARD_ART[card.defId]) return CARD_ART[card.defId];
        if (card.value && VALUE_ART[card.value]) return VALUE_ART[card.value];
        return null;
    }

    /** Artwork per voce catalogo INDEX (id / packId / colorHint). */
    function resolveCatalogArt(carta) {
        if (!carta) return null;
        const packId = carta.packId || '';
        const id = carta.id || '';
        const hint = carta.colorHint;

        if (packId === 'c_righello' || id.startsWith('c_righello_')) {
            const color = hint || id.replace('c_righello_', '');
            if (RIGHELLO_ART[color]) return RIGHELLO_ART[color];
        }

        if (CARD_ART[packId]) return CARD_ART[packId];
        if (CARD_ART[id]) return CARD_ART[id];

        const preview = global.CarteCatalog?.spawnFromCatalogEntry?.(carta);
        if (preview) return resolveCardArt(preview);

        return null;
    }

    function mountArtFace(el, artUrl, alt = 'Carta') {
        if (!el || !artUrl) return false;
        el.classList.add('gc-card-art');
        el.style.backgroundImage = '';
        el.innerHTML = `<img class="gc-card-art-img" src="${escapeHtml(artUrl)}" alt="${escapeHtml(alt)}" draggable="false" loading="lazy">`;
        return true;
    }

    const SPECIAL_CAT = {
        draw10: '⬛ Carte Nere',
        draw16: '⬛ Carte Nere',
        death: '⬛ Carte Nere',
        blobby: '⭐ Speciale UNO?',
        mirror: '⭐ Speciale UNO?',
        shield: '🛡️ Difesa',
        cancel: '⭐ Contrasto',
        jack: '⬛ Carte Nere',
        reset: '⬛ Carte Nere',
        swap: '⬛ Carte Nere',
        bullet: '⬛ Carte Nere',
        plan: '⬛ Carte Nere',
        mari: '🟢 Eventi',
        heart: '🟢 Eventi',
        nazism: '🔴 Eventi',
        communism: '🔴 Eventi',
        vaff: '🟡 Eventi',
        waves: '🔵 Eventi',
        surprise: '🃏 Jolly',
        halfdraw: '⬛ Carte Nere',
        reshuffle: '⬛ Carte Nere'
    };

    function escapeHtml(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function colorClass(card, opts = {}) {
        if (opts.battleColor && card?.battleColor && Deck?.isBrainrotCard?.(card)) {
            const m = {
                yellow: 'gc-card-battle-yellow',
                white: 'gc-card-battle-white',
                pink: 'gc-card-battle-pink',
                blue: 'gc-card-battle-blue'
            };
            return m[card.battleColor] || 'gc-card-brainrot';
        }
        if (Deck?.isBrainrotCard?.(card)) return 'gc-card-brainrot';
        const map = {
            red: 'gc-card-red',
            yellow: 'gc-card-yellow',
            green: 'gc-card-green',
            blue: 'gc-card-blue',
            black: 'gc-card-black',
            wild: 'gc-card-wild'
        };
        return map[card?.color] || 'gc-card-black';
    }

    function displayParts(card) {
        if (!card) return { mode: 'empty', label: '—', subtitle: '' };

        const artUrl = resolveCardArt(card);
        if (artUrl) {
            const label = isRighelloCard(card)
                ? (card.righelloLabel || 'Righello')
                : (ART_LABELS[card.value] || card.label || 'Carta');
            const subtitle = isRighelloCard(card)
                ? `${SPECIAL_CAT.cancel || '⭐ Contrasto'} · ${COLOR_LABEL[card.color] || card.color}`
                : (SPECIAL_CAT[card.value] || '⬛ Carte Nere');
            return { mode: 'art', artUrl, label, subtitle };
        }

        if (Deck?.isBrainrotCard?.(card)) {
            const name = card.brainrotName || card.label || 'Brainrot';
            const pt = card.pt != null ? `${card.pt}PT` : '';
            return { mode: 'brainrot', name, pt };
        }

        if (card.kind === 'number') {
            const n = String(card.label ?? card.value);
            return {
                mode: 'uno',
                label: n,
                corner: n,
                subtitle: COLOR_LABEL[card.color] || card.color
            };
        }

        if (card.righelloLabel) {
            return {
                mode: 'classic',
                label: card.righelloLabel,
                subtitle: SPECIAL_CAT.cancel || '⭐ Contrasto'
            };
        }

        if (card.value === 'wild' || card.value === 'wild4') {
            const lbl = card.label || (card.value === 'wild4' ? '+4' : 'Colore');
            return {
                mode: 'classic',
                label: lbl,
                subtitle: card.value === 'wild4' ? '🃏 Jolly' : '🃏 Jolly'
            };
        }

        if (card.kind === 'action') {
            return {
                mode: 'classic',
                label: card.label || String(card.value),
                subtitle: `🎨 ${COLOR_LABEL[card.color] || 'Azione'}`
            };
        }

        let label = card.label || String(card.value || '—');
        if (label.length > 8) label = `${label.slice(0, 7)}…`;
        const subtitle = SPECIAL_CAT[card.value] || (card.color === 'wild' ? '🃏 Jolly' : '⬛ Speciale');
        if (card.planPart) {
            return { mode: 'classic', label: `${label} ${card.planPart}`.trim(), subtitle };
        }
        return { mode: 'classic', label, subtitle };
    }

    function buildInnerHTML(card, opts = {}) {
        const parts = displayParts(card);
        const badges = opts.badges || '';

        if (parts.mode === 'brainrot') {
            const pt = parts.pt
                ? `<span class="gc-card-pt">${escapeHtml(parts.pt)}</span>`
                : '';
            return `${badges}<span class="gc-card-brainrot-name">${escapeHtml(parts.name)}</span>${pt}`;
        }

        if (parts.mode === 'uno') {
            const c = escapeHtml(parts.corner || parts.label);
            return `
                ${badges}
                <span class="gc-corner gc-corner-tl">${c}</span>
                <span class="gc-corner gc-corner-br">${c}</span>
                <span class="gc-card-center">${escapeHtml(parts.label)}</span>
                <span class="gc-card-sub">${escapeHtml(parts.subtitle)}</span>
            `;
        }

        if (parts.mode === 'art') {
            const alt = escapeHtml(parts.label || 'Carta');
            return `
                ${badges}
                <img class="gc-card-art-img" src="${escapeHtml(parts.artUrl)}" alt="${alt}" draggable="false" loading="lazy">
            `;
        }

        return `
            ${badges}
            <span class="gc-card-center">${escapeHtml(parts.label)}</span>
            <span class="gc-card-sub">${escapeHtml(parts.subtitle)}</span>
        `;
    }

    function applyCardFace(el, card, opts = {}) {
        if (!el) return;
        const parts = displayParts(card);
        const colorOpts = opts.battleColor ? { battleColor: true } : {};
        const isArt = parts.mode === 'art';
        el.className = [
            opts.baseClass || 'gc-card',
            isArt ? '' : colorClass(card, colorOpts),
            isArt ? 'gc-card-art' : '',
            opts.extraClass || ''
        ].filter(Boolean).join(' ');
        el.style.backgroundImage = '';
        el.innerHTML = buildInnerHTML(card, opts);
        if (card && opts.showNativeTitle !== false) {
            el.title = Deck?.cardDisplayName?.(card) || card.label || '';
        } else {
            el.removeAttribute('title');
        }
    }

    function createCardButton(card, opts = {}) {
        const btn = document.createElement('button');
        btn.type = 'button';
        applyCardFace(btn, card, {
            baseClass: 'gc-card gc-card-hand',
            extraClass: opts.extraClass || '',
            badges: opts.badges || ''
        });
        return btn;
    }

    global.GameCardUI = {
        CARD_ART,
        RIGHELLO_ART,
        resolveCardArt,
        resolveCatalogArt,
        mountArtFace,
        colorClass,
        displayParts,
        buildInnerHTML,
        applyCardFace,
        createCardButton
    };
})(window);
