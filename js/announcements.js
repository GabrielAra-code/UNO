/** Annunci / Updates — lettura client e rendering. */
(function (global) {
    const FONT_SIZE_CLASS = {
        sm: 'updates-text-sm',
        md: 'updates-text-md',
        lg: 'updates-text-lg'
    };

    function escapeHtml(value) {
        return String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }

    function formatDate(value) {
        if (!value) return '—';
        const date = value?.toDate ? value.toDate() : new Date(value);
        if (Number.isNaN(date.getTime())) return '—';
        return date.toLocaleString('it-IT', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function defaultGameVersion() {
        return global.AdminConfig?.GAME_VERSION || '1.0.0';
    }

    function renderContentHtml(content) {
        return escapeHtml(content || '').replace(/\n/g, '<br>');
    }

    function renderAnnouncementCard(ann) {
        const bold = ann.bold ? 'updates-body-bold' : 'updates-body-normal';
        const size = FONT_SIZE_CLASS[ann.fontSize] || FONT_SIZE_CLASS.md;
        const version = escapeHtml(ann.gameVersion || defaultGameVersion());
        return `
            <article class="updates-card">
                <header class="updates-card-header">
                    <h3 class="updates-card-title">${escapeHtml(ann.title || 'Annuncio')}</h3>
                    <div class="updates-card-meta">
                        <span class="updates-card-version">v${version}</span>
                        <time class="updates-card-date">${formatDate(ann.createdAt)}</time>
                    </div>
                </header>
                <div class="updates-card-body ${bold} ${size}">${renderContentHtml(ann.content)}</div>
            </article>`;
    }

    function renderAnnouncementsList(announcements, containerEl) {
        if (!containerEl) return;
        const list = Array.isArray(announcements) ? announcements : [];
        if (!list.length) {
            containerEl.innerHTML = `
                <div class="updates-empty">
                    <span class="text-3xl">📭</span>
                    <p>Nessun annuncio al momento.</p>
                </div>`;
            return;
        }
        containerEl.innerHTML = list.map(renderAnnouncementCard).join('');
    }

    global.AnnouncementsUI = {
        FONT_SIZE_CLASS,
        escapeHtml,
        formatDate,
        defaultGameVersion,
        renderAnnouncementCard,
        renderAnnouncementsList
    };
})(window);
