/** UID amministratore — verificare sempre l'UID, non solo l'email. */
(function (global) {
    const ADMIN_UID = 'e8pMV4UWA6dJrYMfYYUIc3scTZJ2';

    function isAdminUid(uid) {
        return typeof uid === 'string' && uid === ADMIN_UID;
    }

    function isAdminUser(user) {
        return isAdminUid(user?.uid);
    }

    const BAN_DURATION_OPTIONS = [
        { id: '1h', label: '1 ora', ms: 60 * 60 * 1000 },
        { id: '6h', label: '6 ore', ms: 6 * 60 * 60 * 1000 },
        { id: '12h', label: '12 ore', ms: 12 * 60 * 60 * 1000 },
        { id: '1d', label: '1 giorno', ms: 24 * 60 * 60 * 1000 },
        { id: '3d', label: '3 giorni', ms: 3 * 24 * 60 * 60 * 1000 },
        { id: '7d', label: '7 giorni', ms: 7 * 24 * 60 * 60 * 1000 },
        { id: '30d', label: '30 giorni', ms: 30 * 24 * 60 * 60 * 1000 },
        { id: 'permanent', label: 'Permanente', ms: null }
    ];

    const LOBBY_CLOSED_BY_ADMIN_MESSAGE = 'Questa lobby è stata chiusa da un amministratore.';

    function calcolaLivelloDaXp(xp) {
        const xpVal = Math.max(0, parseInt(xp, 10) || 0);
        let livello = 1;
        while (xpVal >= livello * 100) {
            livello += 1;
            if (livello > 500) break;
        }
        return livello;
    }

    global.AdminConfig = {
        ADMIN_UID,
        isAdminUid,
        isAdminUser,
        BAN_DURATION_OPTIONS,
        LOBBY_CLOSED_BY_ADMIN_MESSAGE,
        calcolaLivelloDaXp
    };
})(window);
