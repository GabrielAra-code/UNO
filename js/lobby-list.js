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

    global.LobbyList = {
        CLOSED_STATUSES,
        countPlayers,
        isLobbyJoinable,
        pruneLobbyList
    };
})(window);
