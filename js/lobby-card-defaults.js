/** Quantità predefinite carte in lobby (conteggio copie nel mazzo). */
(function (global) {
    const DEFAULT_QUANTITIES = {
        c_0_9: 20,
        c_piu2: 2,
        c_rev: 2,
        c_bloc: 2,
        c_cc: 4,
        c_piu4: 4,
        c_jack: 1,
        c_piu10: 1,
        c_piu16: 1,
        c_scudo: 4,
        c_death: 1,
        c_blobby: 1,
        c_righello: 4,
        c_donna: 1,
        c_imprevisti: 1,
        c_scambio: 2,
        c_vaff: 2,
        c_mari: 1,
        c_onde: 2,
        c_cuore: 2,
        c_comunismo: 1,
        c_nazismo: 1,
        c_proiettile: 6,
        c_quagruppo: 1,
        c_messa: 1,
        c_piani: 1,
        c_br_ladro: 1,
        c_br_pothot: 1,
        c_br_influen: 1,
        c_br_frocettini: 1,
        c_br_popp: 1,
        c_br_papero: 1,
        c_br_budinaccio: 1,
        c_br_giraffa: 1,
        c_br_bobrini: 1,
        c_br_centralucci: 1,
        c_br_baccala: 1,
        c_specchio: 1
    };

    function getDefaultQuantity(cardId) {
        return DEFAULT_QUANTITIES[cardId] ?? 1;
    }

    function seedCardQuantities(catalog) {
        const out = {};
        (catalog || []).forEach(carta => {
            out[carta.id] = getDefaultQuantity(carta.id);
        });
        return out;
    }

    global.LobbyCardDefaults = {
        DEFAULT_QUANTITIES,
        getDefaultQuantity,
        seedCardQuantities
    };
})(typeof window !== 'undefined' ? window : globalThis);
