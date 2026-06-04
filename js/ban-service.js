(function (global) {
    async function fetchBanForUser(db, doc, getDoc, uid) {
        if (!uid || !db || !doc || !getDoc) {
            return { banned: false };
        }

        try {
            const snap = await getDoc(doc(db, 'bans', uid));
            if (!snap.exists()) {
                return { banned: false };
            }

            const data = snap.data();
            const now = Date.now();
            const expiresAt = data.expiresAt ?? null;

            if (expiresAt === null) {
                return { banned: true, permanent: true, data };
            }

            const scadenza = new Date(expiresAt).getTime();
            if (Number.isNaN(scadenza) || scadenza > now) {
                return { banned: true, permanent: false, data, expiresAtMs: scadenza };
            }

            return { banned: false, expired: true, data };
        } catch (error) {
            console.warn('Lettura ban non disponibile:', error);
            return { banned: false, error };
        }
    }

    function formatBanMessage(banResult) {
        if (!banResult?.banned || !banResult.data) {
            return '';
        }

        const { reason, expiresAt } = banResult.data;
        const motivo = reason ? `Motivo: ${reason}` : 'Motivo: non specificato';

        if (banResult.permanent) {
            return `Il tuo account è stato sospeso.\n\n${motivo}\n\nBan permanente.`;
        }

        const fine = expiresAt
            ? new Date(expiresAt).toLocaleString('it-IT')
            : '—';

        return `Il tuo account è stato sospeso.\n\n${motivo}\n\nFine ban: ${fine}`;
    }

    function formatRemainingBanTime(expiresAt) {
        if (!expiresAt) return 'Permanente';
        const diff = new Date(expiresAt).getTime() - Date.now();
        if (diff <= 0) return 'Scaduto';
        const ore = Math.floor(diff / (1000 * 60 * 60));
        const min = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        if (ore >= 24) {
            const giorni = Math.floor(ore / 24);
            return `${giorni}g ${ore % 24}h`;
        }
        return `${ore}h ${min}m`;
    }

    global.BanService = {
        fetchBanForUser,
        formatBanMessage,
        formatRemainingBanTime
    };
})(window);
