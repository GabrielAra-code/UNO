/** Metadati carte + tooltip (PC) e scheda dettaglio (mobile long-press). */
(function (global) {
    const Deck = global.GameDeck;
    const CardUI = global.GameCardUI;

    const HOLD_MS = 600;
    const MOVE_CANCEL_PX = 12;

    const COUNTERED_BY_VALUE = {
        blobby: ['Righello', 'Scudo'],
        death: ['Righello'],
        bullet: ['Scudo']
    };

    const CAN_COUNTER_VALUE = {
        cancel: ['Blobby', 'Death Note', 'Effetti attivi (reattivo)'],
        shield: ['Blobby', 'Proiettile'],
        mirror: ['Stack +2, +4, +10, +16 (entro 5s)'],
        draw2: ['Stack +2 (entro 5s, modalità STACK)'],
        wild4: ['Stack attivo (entro 5s, modalità STACK)'],
        draw10: ['Stack attivo (entro 5s, modalità STACK)'],
        draw16: ['Stack attivo (entro 5s, modalità STACK)']
    };

    const VALUE_TO_PACK = {
        draw2: 'c_piu2',
        reverse: 'c_rev',
        skip: 'c_bloc',
        wild: 'c_cc',
        wild4: 'c_piu4',
        jack: 'c_jack',
        draw10: 'c_piu10',
        draw16: 'c_piu16',
        shield: 'c_scudo',
        death: 'c_death',
        blobby: 'c_blobby',
        cancel: 'c_righello',
        reset: 'c_donna',
        surprise: 'c_imprevisti',
        swap: 'c_scambio',
        vaff: 'c_vaff',
        mari: 'c_mari',
        waves: 'c_onde',
        heart: 'c_cuore',
        communism: 'c_comunismo',
        nazism: 'c_nazismo',
        bullet: 'c_proiettile',
        halfdraw: 'c_quagruppo',
        reshuffle: 'c_messa',
        plan: 'c_piani',
        mirror: 'c_specchio',
        brainrot: 'c_br_influen'
    };

    let catalogMap = null;

    function buildCatalogMap() {
        if (catalogMap) return catalogMap;
        catalogMap = new Map();
        (global.databaseCarte || []).forEach(entry => catalogMap.set(entry.id, entry));
        return catalogMap;
    }

    function resolvePackId(card) {
        if (!card) return null;
        if (card.kind === 'brainrot' || card.defId?.startsWith('c_br_')) {
            return card.defId?.startsWith('c_br_') ? card.defId : card.brainrotId;
        }
        if (card.defId === 'c_0_9' || card.kind === 'number') return 'c_0_9';
        if (card.value === 'cancel' || card.defId?.startsWith('c_righello')) return 'c_righello';
        if (card.value === 'plan' || card.defId?.startsWith('c_piani')) return 'c_piani';
        if (card.defId) return card.defId;
        return VALUE_TO_PACK[card.value] || null;
    }

    function simplifyCat(cat) {
        if (!cat) return '';
        return String(cat).replace(/^[^\w\dÀ-ÿ]+/u, '').trim() || cat;
    }

    function formatTipo(card, pack) {
        if (card.kind === 'number') return 'Numerica';
        if (card.kind === 'action') return 'Azione';
        if (card.kind === 'wild') return 'Jolly';
        if (card.kind === 'brainrot') return 'Brainrot';
        if (pack?.cat) return simplifyCat(pack.cat);
        return 'Speciale';
    }

    function formatColore(card) {
        if (Deck?.isBrainrotCard?.(card)) {
            const bc = card.battleColor && Deck.BRAINROT_BATTLE_COLOR_LABEL?.[card.battleColor];
            return bc ? `Incolore (scontro ${bc})` : 'Incolore';
        }
        return Deck?.COLOR_LABEL?.[card.color] || card.color || '—';
    }

    function formatNome(card, pack) {
        if (card.righelloLabel) return card.righelloLabel;
        if (card.kind === 'number') {
            const col = Deck?.COLOR_LABEL?.[card.color] || card.color;
            return `${card.label} ${col}`;
        }
        if (Deck?.isBrainrotCard?.(card)) {
            const name = card.brainrotName || card.label || pack?.nome || 'Brainrot';
            const pt = card.pt != null ? ` (${card.pt}PT)` : '';
            return `${name}${pt}`;
        }
        if (card.planPart && pack?.nome) return `${pack.nome.split('(')[0].trim()} ${card.planPart}`;
        return pack?.nome || card.label || Deck?.cardDisplayName?.(card) || '—';
    }

    function escapeHtml(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function getCardInfo(card) {
        const packId = resolvePackId(card);
        const pack = packId ? buildCatalogMap().get(packId) : null;
        let effetto = pack?.effetto || '';
        if (card.kind === 'number' && !effetto) {
            effetto = 'Giocabile se coincide il numero o il colore attivo sul tavolo.';
        }
        if (card.kind === 'action' && !effetto) {
            effetto = 'Carta azione classica UNO.';
        }
        return {
            nome: formatNome(card, pack),
            tipo: formatTipo(card, pack),
            colore: formatColore(card),
            effetto: effetto || 'Nessuna descrizione disponibile.',
            contrastabileDa: [...(COUNTERED_BY_VALUE[card.value] || [])],
            puoContrastare: [...(CAN_COUNTER_VALUE[card.value] || [])],
            card,
            packId
        };
    }

    function listHtml(items) {
        if (!items?.length) return '';
        return `<ul class="cit-list">${items.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
    }

    function renderTooltipHTML(info) {
        const counters = info.contrastabileDa.length
            ? `<div class="cit-section"><span class="cit-label">Contrastabile da:</span>${listHtml(info.contrastabileDa)}</div>`
            : '';
        return `
            <div class="cit-name">${escapeHtml(info.nome)}</div>
            <div class="cit-row"><span class="cit-label">Tipo:</span> ${escapeHtml(info.tipo)}</div>
            <div class="cit-row"><span class="cit-label">Colore:</span> ${escapeHtml(info.colore)}</div>
            <div class="cit-section"><span class="cit-label">Effetto:</span><p class="cit-effetto">${escapeHtml(info.effetto)}</p></div>
            ${counters}
        `;
    }

    function renderSheetHTML(info) {
        const counters = info.contrastabileDa.length
            ? `<div class="cis-block"><h3>Contrastabile da</h3>${listHtml(info.contrastabileDa)}</div>`
            : '';
        const canCounter = info.puoContrastare.length
            ? `<div class="cis-block"><h3>Può contrastare</h3>${listHtml(info.puoContrastare)}</div>`
            : '';
        return `
            <h2 class="cis-name">${escapeHtml(info.nome)}</h2>
            <div class="cis-meta">
                <span><strong>Tipo:</strong> ${escapeHtml(info.tipo)}</span>
                <span><strong>Colore:</strong> ${escapeHtml(info.colore)}</span>
            </div>
            <div class="cis-block">
                <h3>Effetto</h3>
                <p class="cis-effetto">${escapeHtml(info.effetto)}</p>
            </div>
            ${counters}
            ${canCounter}
        `;
    }

    function isHoverDevice() {
        return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    }

    function isTouchHoldDevice() {
        return !isHoverDevice();
    }

    function wireHandCardInfo(handEl, options = {}) {
        const getCard = options.getCard;
        if (!handEl || typeof getCard !== 'function') return () => {};

        const tooltip = document.getElementById('card-info-tooltip');
        const sheet = document.getElementById('card-info-sheet');
        const sheetBackdrop = sheet?.querySelector('.card-info-sheet-backdrop');
        const sheetClose = sheet?.querySelector('.card-info-sheet-close');
        const sheetPreview = document.getElementById('card-info-sheet-preview');
        const sheetBody = document.getElementById('card-info-sheet-body');

        let hoverSlot = null;
        let holdTimer = null;
        let holdRing = null;
        let holdSlot = null;
        let holdStart = null;
        let holdPointerId = null;
        let suppressClickUntil = 0;
        let sheetOpen = false;

        function findSlot(target) {
            return target?.closest?.('.hand-card-slot');
        }

        function findCardId(slot) {
            return slot?.querySelector?.('.gc-card-hand')?.dataset?.cardId || null;
        }

        function shouldSuppressClick() {
            return Date.now() < suppressClickUntil;
        }

        function hideTooltip() {
            if (!tooltip) return;
            tooltip.classList.add('hidden');
            tooltip.setAttribute('aria-hidden', 'true');
            hoverSlot = null;
        }

        function showTooltip(slot, card) {
            if (!tooltip || !card) return;
            const info = getCardInfo(card);
            tooltip.innerHTML = renderTooltipHTML(info);
            const rect = slot.getBoundingClientRect();
            tooltip.classList.remove('hidden');
            tooltip.setAttribute('aria-hidden', 'false');
            const tipRect = tooltip.getBoundingClientRect();
            let left = rect.left + rect.width / 2 - tipRect.width / 2;
            left = Math.max(8, Math.min(left, window.innerWidth - tipRect.width - 8));
            const top = Math.max(8, rect.top - tipRect.height - 10);
            tooltip.style.left = `${left}px`;
            tooltip.style.top = `${top}px`;
            hoverSlot = slot;
        }

        function openSheet(card) {
            if (!sheet || !card) return;
            const info = getCardInfo(card);
            if (sheetPreview && CardUI?.applyCardFace) {
                sheetPreview.innerHTML = '';
                const previewBtn = document.createElement('div');
                previewBtn.className = 'card-info-sheet-card';
                CardUI.applyCardFace(previewBtn, card, {
                    baseClass: 'gc-card gc-card-sheet-preview',
                    showNativeTitle: false
                });
                sheetPreview.appendChild(previewBtn);
            }
            if (sheetBody) sheetBody.innerHTML = renderSheetHTML(info);
            sheet.classList.remove('hidden');
            sheet.setAttribute('aria-hidden', 'false');
            requestAnimationFrame(() => sheet.classList.add('is-open'));
            sheetOpen = true;
            document.body.classList.add('card-info-sheet-open');
        }

        function closeSheet() {
            if (!sheet || sheet.classList.contains('hidden')) return;
            sheet.classList.remove('is-open');
            sheetOpen = false;
            const onEnd = () => {
                sheet.classList.add('hidden');
                sheet.setAttribute('aria-hidden', 'true');
                document.body.classList.remove('card-info-sheet-open');
                sheet.removeEventListener('transitionend', onEnd);
            };
            sheet.addEventListener('transitionend', onEnd);
            setTimeout(onEnd, 220);
        }

        function clearHold() {
            if (holdTimer) {
                clearTimeout(holdTimer);
                holdTimer = null;
            }
            holdRing?.remove();
            holdRing = null;
            holdSlot = null;
            holdStart = null;
            holdPointerId = null;
        }

        function createHoldRing(slot) {
            holdRing?.remove();
            const ring = document.createElement('div');
            ring.className = 'card-hold-ring';
            ring.innerHTML = `
                <svg viewBox="0 0 44 44" aria-hidden="true">
                    <circle class="card-hold-ring-track" cx="22" cy="22" r="18"></circle>
                    <circle class="card-hold-ring-progress" cx="22" cy="22" r="18"></circle>
                </svg>
            `;
            slot.appendChild(ring);
            holdRing = ring;
            requestAnimationFrame(() => ring.classList.add('is-active'));
        }

        function onPointerOver(e) {
            if (!isHoverDevice() || sheetOpen) return;
            const slot = findSlot(e.target);
            if (!slot || slot === hoverSlot) return;
            const card = getCard(findCardId(slot));
            if (!card) return;
            showTooltip(slot, card);
        }

        function onPointerOut(e) {
            if (!isHoverDevice()) return;
            const slot = findSlot(e.target);
            if (!slot || slot !== hoverSlot) return;
            const related = e.relatedTarget;
            if (related && slot.contains(related)) return;
            hideTooltip();
        }

        function onPointerDown(e) {
            if (!isTouchHoldDevice() || sheetOpen) return;
            if (e.button > 0) return;
            const slot = findSlot(e.target);
            const btn = slot?.querySelector('.gc-card-hand');
            if (!btn) return;
            const card = getCard(findCardId(slot));
            if (!card) return;

            holdSlot = slot;
            holdStart = { x: e.clientX, y: e.clientY };
            holdPointerId = e.pointerId;
            createHoldRing(slot);

            holdTimer = setTimeout(() => {
                holdTimer = null;
                suppressClickUntil = Date.now() + 400;
                if (navigator.vibrate) navigator.vibrate(12);
                clearHold();
                openSheet(card);
            }, HOLD_MS);
        }

        function onPointerMove(e) {
            if (!holdTimer || holdPointerId !== e.pointerId || !holdStart) return;
            const dx = e.clientX - holdStart.x;
            const dy = e.clientY - holdStart.y;
            if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) clearHold();
        }

        function onPointerUp(e) {
            if (holdPointerId !== null && e.pointerId !== holdPointerId) return;
            clearHold();
        }

        function onClickCapture(e) {
            if (!shouldSuppressClick()) return;
            const slot = findSlot(e.target);
            if (!slot) return;
            e.stopPropagation();
            e.preventDefault();
        }

        handEl.addEventListener('pointerover', onPointerOver, true);
        handEl.addEventListener('pointerout', onPointerOut, true);
        handEl.addEventListener('pointerdown', onPointerDown, true);
        handEl.addEventListener('pointermove', onPointerMove, true);
        handEl.addEventListener('pointerup', onPointerUp, true);
        handEl.addEventListener('pointercancel', onPointerUp, true);
        handEl.addEventListener('click', onClickCapture, true);

        sheetClose?.addEventListener('click', () => {
            suppressClickUntil = Date.now() + 300;
            closeSheet();
        });
        sheetBackdrop?.addEventListener('click', () => {
            suppressClickUntil = Date.now() + 300;
            closeSheet();
        });

        window.addEventListener('scroll', hideTooltip, true);
        window.addEventListener('resize', hideTooltip);

        return () => {
            hideTooltip();
            closeSheet();
            clearHold();
            handEl.removeEventListener('pointerover', onPointerOver, true);
            handEl.removeEventListener('pointerout', onPointerOut, true);
            handEl.removeEventListener('pointerdown', onPointerDown, true);
            handEl.removeEventListener('pointermove', onPointerMove, true);
            handEl.removeEventListener('pointerup', onPointerUp, true);
            handEl.removeEventListener('pointercancel', onPointerUp, true);
            handEl.removeEventListener('click', onClickCapture, true);
        };
    }

    global.CardInfo = {
        HOLD_MS,
        getCardInfo,
        renderTooltipHTML,
        renderSheetHTML,
        wireHandCardInfo,
        isHoverDevice,
        isTouchHoldDevice
    };
})(typeof window !== 'undefined' ? window : globalThis);
