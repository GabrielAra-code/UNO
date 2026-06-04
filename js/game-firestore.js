(function (global) {
    const Engine = global.GameEngine;

    async function waitForFirebase(maxMs = 12000) {
        const start = Date.now();
        while (Date.now() - start < maxMs) {
            if (global.db && global.doc && global.setDoc && global.getDoc && global.updateDoc) {
                return true;
            }
            await new Promise(r => setTimeout(r, 80));
        }
        return false;
    }

    function gameRef(lobbyId) {
        return global.doc(global.db, 'games', lobbyId);
    }

    async function createGameFromLobby(lobby) {
        const state = Engine.createInitialState(lobby);
        const payload = Engine.stripForFirestore(state);
        payload.updatedAt = new Date().toISOString();
        payload.version = 1;
        await global.setDoc(gameRef(lobby.id), payload);

        await global.updateDoc(global.doc(global.db, 'lobbies', lobby.id), {
            status: 'playing',
            gameStartedAt: new Date().toISOString()
        });

        return state;
    }

    async function persistState(lobbyId, state) {
        const payload = Engine.stripForFirestore(state);
        payload.updatedAt = new Date().toISOString();
        payload.version = (payload.version || 0) + 1;
        await global.setDoc(gameRef(lobbyId), payload);
    }

    async function returnLobbyToWaiting(lobbyId) {
        await global.updateDoc(global.doc(global.db, 'lobbies', lobbyId), {
            status: 'waiting',
            gameEndedAt: new Date().toISOString()
        });
    }

    function subscribeGame(lobbyId, onChange, onError) {
        return global.onSnapshot(gameRef(lobbyId), snap => {
            onChange(snap.exists() ? snap.data() : null);
        }, onError || console.error);
    }

    global.GameFirestore = {
        waitForFirebase,
        createGameFromLobby,
        persistState,
        returnLobbyToWaiting,
        subscribeGame
    };
})(window);
