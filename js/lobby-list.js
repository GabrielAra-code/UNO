(function (global) {
    const CLOSED_STATUSES = new Set([
        'closed',
        'closed_by_admin',
        'deleted',
        'destroyed',
        'eliminated',
        'playing',
        'started',
        'finished',
        'in_game'
    ]);

    function countPlayers(lobby) {
        const players = Array.isArray(lobby?.players) ? lobby.players : [];
        return players.filter(p => p && (p.nickname || p.uid)).length;
    }

    function isLobbyJoinable(lobby) {
        if (!lobby?.id) return false;
        const status = String(lobby.status || 'waiting').toLowerCase();
        if (CLOSED_STATUSES.has(status)) return false;
        const n = countPlayers(lobby);
        if (n === 0) return false;
        const maxPlayers = parseInt(lobby.maxPlayers, 10) || 15;
        return n < maxPlayers;
    }

    function pruneLobbyList(lobbies) {
        if (!Array.isArray(lobbies)) return [];
        return lobbies.filter(isLobbyJoinable);
    }

    /** ID documento Firestore = fonte di verità (il campo id nel body può essere errato o assente). */
    function lobbyFromFirestoreDoc(docSnap) {
        const data = typeof docSnap?.data === 'function' ? (docSnap.data() || {}) : (docSnap || {});
        const docId = docSnap?.id != null ? String(docSnap.id) : '';
        const bodyId = data.id != null ? String(data.id).trim() : '';
        const id = docId || bodyId;
        return { ...data, id };
    }

    global.LobbyList = {
        CLOSED_STATUSES,
        countPlayers,
        isLobbyJoinable,
        pruneLobbyList,
        lobbyFromFirestoreDoc
    };
})(window);
