(function (global) {
    const DEFAULT_REDIRECT = 'Menu_principale.html';
    const LOBBY_NOT_FOUND_TITLE = 'Lobby non trovata';
    const LOBBY_CLOSED_TITLE = 'Lobby chiusa';

    let modalEl = null;
    let redirectPending = false;

    function ensureModal() {
        if (modalEl) return modalEl;

        modalEl = document.createElement('div');
        modalEl.id = 'modal-lobby-notice';
        modalEl.className = 'hidden fixed inset-0 z-[10000] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4';
        modalEl.innerHTML = `
            <div class="lobby-notice-panel game-panel-dark p-8 rounded-3xl text-center max-w-md w-full shadow-2xl"
                style="background-color:#0b111e;border:2px solid #1e293b;">
                <div id="lobby-notice-emoji" class="text-6xl mb-4 select-none" aria-hidden="true">😢</div>
                <h2 id="lobby-notice-title" class="text-2xl font-black text-rose-400 uppercase tracking-wider"></h2>
                <p id="lobby-notice-message" class="text-slate-400 font-bold mt-3 text-sm leading-relaxed"></p>
                <button type="button" id="lobby-notice-btn"
                    class="mt-6 w-full py-3 rounded-full font-black text-sm uppercase tracking-wider
                    bg-gradient-to-b from-slate-600 to-slate-800 text-white border-2 border-slate-500
                    hover:from-slate-500 hover:to-slate-700 transition-colors cursor-pointer">
                    Torna al menu
                </button>
            </div>`;

        document.body.appendChild(modalEl);

        modalEl.querySelector('#lobby-notice-btn')?.addEventListener('click', () => {
            if (redirectPending) return;
            redirectPending = true;
            const url = modalEl.dataset.redirectUrl || DEFAULT_REDIRECT;
            global.location.href = url;
        });

        return modalEl;
    }

    function hideLoadingIfPresent() {
        document.getElementById('modal-loading-room')?.classList.add('hidden');
        if (typeof global.hideLoadingOverlay === 'function') {
            try { global.hideLoadingOverlay(); } catch (_) { /* ignore */ }
        }
    }

    function showLobbyNotice(options = {}) {
        const {
            title = 'Attenzione',
            message = '',
            emoji = '😢',
            redirectUrl = DEFAULT_REDIRECT,
            buttonLabel = 'Torna al menu'
        } = options;

        redirectPending = false;
        hideLoadingIfPresent();

        const el = ensureModal();
        el.dataset.redirectUrl = redirectUrl;

        const emojiEl = el.querySelector('#lobby-notice-emoji');
        const titleEl = el.querySelector('#lobby-notice-title');
        const msgEl = el.querySelector('#lobby-notice-message');
        const btn = el.querySelector('#lobby-notice-btn');

        if (emojiEl) emojiEl.textContent = emoji;
        if (titleEl) titleEl.textContent = title;
        if (msgEl) msgEl.textContent = message;
        if (btn) btn.textContent = buttonLabel;

        const panel = el.querySelector('.lobby-notice-panel');
        const UI = global.UITransitions;
        if (UI) UI.openOverlayModal(el, panel);
        else el.classList.remove('hidden');
        global.playSynth?.('error');
    }

    function showLobbyNotFound(options = {}) {
        showLobbyNotice({
            title: LOBBY_NOT_FOUND_TITLE,
            message: options.message || 'La stanza non esiste più o non è raggiungibile.',
            emoji: '😢',
            redirectUrl: options.redirectUrl || DEFAULT_REDIRECT,
            buttonLabel: options.buttonLabel || 'Torna al menu'
        });
    }

    function showLobbyClosedByAdmin(options = {}) {
        const defaultMsg = global.AdminConfig?.LOBBY_CLOSED_BY_ADMIN_MESSAGE
            || 'Questa lobby è stata chiusa da un amministratore.';
        showLobbyNotice({
            title: LOBBY_CLOSED_TITLE,
            message: options.message || defaultMsg,
            emoji: '😢',
            redirectUrl: options.redirectUrl || DEFAULT_REDIRECT,
            buttonLabel: options.buttonLabel || 'Torna al menu'
        });
    }

    global.LobbyNotice = {
        show: showLobbyNotice,
        showLobbyNotFound,
        showLobbyClosedByAdmin
    };
})(window);
