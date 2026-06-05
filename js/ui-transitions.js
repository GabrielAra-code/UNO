/** Animazioni UI condivise: apertura/chiusura modali e navigazione tra pannelli. */
(function (global) {
    const MODAL_DURATION = 150;
    const MODAL_EASING = 'cubic-bezier(0.16, 1, 0.3, 1)';

    const PAGE_EXIT_MS = 70;
    const PAGE_ENTER_MS = 70;
    const PAGE_HEIGHT_MS = 55;
    const PAGE_EASING = 'ease-out';
    const PAGE_SLIDE = '30%';
    const VERTICAL_SWAP_MS = 165;
    const VERTICAL_SLIDE = '22%';

    let locked = false;

    function reducedMotion() {
        return global.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
    }

    function animate(el, keyframes, options = {}) {
        if (!el) return Promise.resolve();
        if (reducedMotion()) return Promise.resolve();
        return el.animate(keyframes, {
            duration: MODAL_DURATION,
            easing: MODAL_EASING,
            fill: 'forwards',
            ...options
        }).finished.catch(() => {});
    }

    function clearStyles(el) {
        if (!el) return;
        el.style.opacity = '';
        el.style.transform = '';
        el.style.pointerEvents = '';
    }

    function resetPanelBox(el) {
        if (!el) return;
        el.style.position = '';
        el.style.top = '';
        el.style.left = '';
        el.style.right = '';
        el.style.width = '';
        el.style.visibility = '';
        el.style.zIndex = '';
        clearStyles(el);
    }

    function measureHiddenPanel(el) {
        if (!el) return 0;
        const wasHidden = el.classList.contains('hidden');
        el.classList.remove('hidden');
        el.style.visibility = 'hidden';
        el.style.position = 'absolute';
        el.style.top = '0';
        el.style.left = '0';
        el.style.right = '0';
        el.style.width = '100%';
        el.style.pointerEvents = 'none';
        const height = el.offsetHeight;
        if (wasHidden) el.classList.add('hidden');
        resetPanelBox(el);
        return height;
    }

    function pinPanelForAnim(el) {
        if (!el) return;
        el.style.position = 'absolute';
        el.style.top = '0';
        el.style.left = '0';
        el.style.right = '0';
        el.style.width = '100%';
    }

    async function animateViewportHeight(viewport, fromH, toH) {
        if (!viewport || fromH === toH) return;
        if (reducedMotion()) {
            viewport.style.height = `${toH}px`;
            return;
        }
        viewport.style.overflow = 'hidden';
        viewport.style.height = `${fromH}px`;
        await viewport.animate(
            [{ height: `${fromH}px` }, { height: `${toH}px` }],
            { duration: PAGE_HEIGHT_MS, easing: PAGE_EASING, fill: 'forwards' }
        ).finished.catch(() => {});
        viewport.style.height = `${toH}px`;
    }

    async function open(el) {
        if (!el) return;
        el.classList.remove('hidden');
        el.style.pointerEvents = 'none';
        if (reducedMotion()) {
            clearStyles(el);
            return;
        }
        await animate(el, [
            { opacity: 0, transform: 'scale(0.9)' },
            { opacity: 1, transform: 'scale(1)' }
        ], { duration: MODAL_DURATION, easing: MODAL_EASING });
        clearStyles(el);
    }

    async function close(el) {
        if (!el || el.classList.contains('hidden')) return;
        el.style.pointerEvents = 'none';
        if (reducedMotion()) {
            el.classList.add('hidden');
            clearStyles(el);
            return;
        }
        await animate(el, [
            { opacity: 1, transform: 'scale(1)' },
            { opacity: 0, transform: 'scale(0.9)' }
        ], { duration: MODAL_DURATION, easing: MODAL_EASING });
        el.classList.add('hidden');
        clearStyles(el);
    }

    async function fadeOverlay(overlay, visible) {
        if (!overlay) return;
        if (visible) {
            overlay.classList.remove('hidden');
            if (reducedMotion()) return;
            overlay.style.pointerEvents = 'none';
            await animate(overlay, [{ opacity: 0 }, { opacity: 1 }], {
                duration: MODAL_DURATION,
                easing: MODAL_EASING
            });
            overlay.style.opacity = '';
            overlay.style.pointerEvents = '';
            return;
        }
        if (overlay.classList.contains('hidden')) return;
        overlay.style.pointerEvents = 'none';
        if (reducedMotion()) {
            overlay.classList.add('hidden');
            overlay.style.pointerEvents = '';
            return;
        }
        await animate(overlay, [{ opacity: 1 }, { opacity: 0 }], {
            duration: MODAL_DURATION,
            easing: MODAL_EASING
        });
        overlay.classList.add('hidden');
        overlay.style.opacity = '';
        overlay.style.pointerEvents = '';
    }

    /**
     * Transizione pagina sequenziale: esce la corrente, poi entra la nuova (mai sovrapposte).
     * forward: esce a sinistra, entra da destra. back: viceversa.
     */
    async function sequentialPageSwap(viewport, fromEl, toEl, { direction = 'forward' } = {}) {
        if (!toEl) return;

        if (!fromEl || fromEl === toEl || reducedMotion()) {
            if (fromEl && fromEl !== toEl) {
                fromEl.classList.add('hidden');
                resetPanelBox(fromEl);
            }
            toEl.classList.remove('hidden');
            resetPanelBox(toEl);
            if (viewport) {
                viewport.style.height = '';
                viewport.style.overflow = '';
            }
            return;
        }

        const isForward = direction === 'forward';
        const outX = isForward ? `-${PAGE_SLIDE}` : PAGE_SLIDE;
        const inFromX = isForward ? PAGE_SLIDE : `-${PAGE_SLIDE}`;

        const fromH = fromEl.offsetHeight;
        const toH = measureHiddenPanel(toEl);

        if (viewport) {
            viewport.style.overflow = 'hidden';
            viewport.style.height = `${fromH}px`;
        }

        pinPanelForAnim(fromEl);
        fromEl.style.pointerEvents = 'none';
        toEl.classList.add('hidden');

        await animate(fromEl, [
            { opacity: 1, transform: 'translateX(0)' },
            { opacity: 0, transform: `translateX(${outX})` }
        ], { duration: PAGE_EXIT_MS, easing: PAGE_EASING });

        fromEl.classList.add('hidden');
        resetPanelBox(fromEl);

        if (viewport) await animateViewportHeight(viewport, fromH, toH);

        toEl.classList.remove('hidden');
        pinPanelForAnim(toEl);
        toEl.style.pointerEvents = 'none';
        toEl.style.opacity = '0';
        toEl.style.transform = `translateX(${inFromX})`;

        await animate(toEl, [
            { opacity: 0, transform: `translateX(${inFromX})` },
            { opacity: 1, transform: 'translateX(0)' }
        ], { duration: PAGE_ENTER_MS, easing: PAGE_EASING });

        resetPanelBox(toEl);

        if (viewport) {
            viewport.style.height = '';
            viewport.style.overflow = '';
        }
    }

    /**
     * Scorrimento verticale simultaneo (es. Giocatore ↔ Index).
     * forward: corrente esce in alto, nuova entra dal basso.
     * back: corrente esce in basso, nuova entra dall'alto.
     */
    async function verticalPageSwap(viewport, fromEl, toEl, { direction = 'forward' } = {}) {
        if (!toEl) return;

        if (!fromEl || fromEl === toEl || reducedMotion()) {
            if (fromEl && fromEl !== toEl) {
                fromEl.classList.add('hidden');
                resetPanelBox(fromEl);
            }
            toEl.classList.remove('hidden');
            resetPanelBox(toEl);
            if (viewport) {
                viewport.style.height = '';
                viewport.style.overflow = '';
            }
            return;
        }

        const isForward = direction === 'forward';
        const fromOutY = isForward ? `-${VERTICAL_SLIDE}` : VERTICAL_SLIDE;
        const toInFromY = isForward ? VERTICAL_SLIDE : `-${VERTICAL_SLIDE}`;

        const fromH = fromEl.offsetHeight;
        const toH = measureHiddenPanel(toEl);

        if (viewport) {
            viewport.style.overflow = 'hidden';
            viewport.style.height = `${fromH}px`;
        }

        pinPanelForAnim(fromEl);
        pinPanelForAnim(toEl);
        fromEl.style.zIndex = '1';
        toEl.style.zIndex = '2';
        fromEl.style.pointerEvents = 'none';
        toEl.style.pointerEvents = 'none';

        toEl.classList.remove('hidden');
        toEl.style.opacity = '0';
        toEl.style.transform = `translateY(${toInFromY})`;

        const heightAnim = (fromH !== toH && viewport)
            ? viewport.animate(
                [{ height: `${fromH}px` }, { height: `${toH}px` }],
                { duration: VERTICAL_SWAP_MS, easing: PAGE_EASING, fill: 'forwards' }
            ).finished.catch(() => {})
            : Promise.resolve();

        await Promise.all([
            animate(fromEl, [
                { opacity: 1, transform: 'translateY(0)' },
                { opacity: 0, transform: `translateY(${fromOutY})` }
            ], { duration: VERTICAL_SWAP_MS, easing: PAGE_EASING }),
            animate(toEl, [
                { opacity: 0, transform: `translateY(${toInFromY})` },
                { opacity: 1, transform: 'translateY(0)' }
            ], { duration: VERTICAL_SWAP_MS, easing: PAGE_EASING }),
            heightAnim
        ]);

        fromEl.classList.add('hidden');
        resetPanelBox(fromEl);
        resetPanelBox(toEl);

        if (viewport) {
            viewport.style.height = '';
            viewport.style.overflow = '';
        }
    }

    async function swapPanels(fromEl, toEl, options = {}) {
        const viewport = options.viewport || fromEl?.parentElement;
        return sequentialPageSwap(viewport, fromEl, toEl, options);
    }

    async function pulseStage(stageEl, direction, mutate) {
        if (!stageEl) {
            mutate?.();
            return;
        }
        const isBack = direction === 'back';
        const outX = isBack ? PAGE_SLIDE : `-${PAGE_SLIDE}`;
        const inFromX = isBack ? `-${PAGE_SLIDE}` : PAGE_SLIDE;

        stageEl.style.pointerEvents = 'none';
        stageEl.style.overflow = 'hidden';

        if (!reducedMotion()) {
            await animate(stageEl, [
                { opacity: 1, transform: 'translateX(0)' },
                { opacity: 0, transform: `translateX(${outX})` }
            ], { duration: PAGE_EXIT_MS, easing: PAGE_EASING });
        }

        mutate?.();

        if (!reducedMotion()) {
            stageEl.style.opacity = '0';
            stageEl.style.transform = `translateX(${inFromX})`;
            await animate(stageEl, [
                { opacity: 0, transform: `translateX(${inFromX})` },
                { opacity: 1, transform: 'translateX(0)' }
            ], { duration: PAGE_ENTER_MS, easing: PAGE_EASING });
        }

        stageEl.style.overflow = '';
        clearStyles(stageEl);
    }

    async function openOverlayModal(overlayEl, panelEl) {
        if (!overlayEl) return;
        overlayEl.classList.remove('hidden');
        overlayEl.style.pointerEvents = 'none';
        if (panelEl) panelEl.style.pointerEvents = 'none';
        if (reducedMotion()) {
            clearStyles(overlayEl);
            clearStyles(panelEl);
            return;
        }
        await Promise.all([
            animate(overlayEl, [{ opacity: 0 }, { opacity: 1 }], {
                duration: MODAL_DURATION,
                easing: MODAL_EASING
            }),
            panelEl ? animate(panelEl, [
                { opacity: 0, transform: 'scale(0.9)' },
                { opacity: 1, transform: 'scale(1)' }
            ], { duration: MODAL_DURATION, easing: MODAL_EASING }) : Promise.resolve()
        ]);
        clearStyles(overlayEl);
        clearStyles(panelEl);
    }

    async function closeOverlayModal(overlayEl, panelEl) {
        if (!overlayEl || overlayEl.classList.contains('hidden')) return;
        overlayEl.style.pointerEvents = 'none';
        if (panelEl) panelEl.style.pointerEvents = 'none';
        if (reducedMotion()) {
            overlayEl.classList.add('hidden');
            clearStyles(overlayEl);
            clearStyles(panelEl);
            return;
        }
        await Promise.all([
            panelEl ? animate(panelEl, [
                { opacity: 1, transform: 'scale(1)' },
                { opacity: 0, transform: 'scale(0.9)' }
            ], { duration: MODAL_DURATION, easing: MODAL_EASING }) : Promise.resolve(),
            animate(overlayEl, [{ opacity: 1 }, { opacity: 0 }], {
                duration: MODAL_DURATION,
                easing: MODAL_EASING
            })
        ]);
        overlayEl.classList.add('hidden');
        clearStyles(overlayEl);
        clearStyles(panelEl);
    }

    async function withLock(fn) {
        if (locked) return;
        locked = true;
        try {
            await fn();
        } finally {
            locked = false;
        }
    }

    global.UITransitions = {
        MODAL_DURATION,
        PAGE_EXIT_MS,
        PAGE_ENTER_MS,
        VERTICAL_SWAP_MS,
        MODAL_EASING,
        PAGE_EASING,
        open,
        close,
        fadeOverlay,
        openOverlayModal,
        closeOverlayModal,
        sequentialPageSwap,
        verticalPageSwap,
        swapPanels,
        pulseStage,
        withLock,
        isReducedMotion: reducedMotion
    };
})(typeof window !== 'undefined' ? window : globalThis);
