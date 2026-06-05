/** Rendering carte partita — stile Index / UNO classico (forma reale, bordo bianco, rialzo). */
(function (global) {
    const Deck = global.GameDeck;

    const COLOR_LABEL = Deck?.COLOR_LABEL || {
        red: 'Rosso', yellow: 'Giallo', green: 'Verde', blue: 'Blu', black: 'Nero', wild: 'Jolly'
    };

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

        return `
            ${badges}
            <span class="gc-card-center">${escapeHtml(parts.label)}</span>
            <span class="gc-card-sub">${escapeHtml(parts.subtitle)}</span>
        `;
    }

    function applyCardFace(el, card, opts = {}) {
        if (!el) return;
        const colorOpts = opts.battleColor ? { battleColor: true } : {};
        el.className = [opts.baseClass || 'gc-card', colorClass(card, colorOpts), opts.extraClass || '']
            .filter(Boolean)
            .join(' ');
        el.innerHTML = buildInnerHTML(card, opts);
        if (card) {
            el.title = Deck?.cardDisplayName?.(card) || card.label || '';
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
        colorClass,
        displayParts,
        buildInnerHTML,
        applyCardFace,
        createCardButton
    };
})(window);
