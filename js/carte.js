// js/carte.js
export const databaseCarte = [
    { id: "c_0_9", nome: "Carte Numeriche (0-9)", quantita: "2 per numero", effetto: "Nessuno. Giocabili solo se l'ultimo numero coincide o su carte speciali incolori.", cat: "⚪ Incolore" },
    { id: "c_piu2", nome: "Classico: +2", quantita: "2 per colore", effetto: "Il bersaglio pesca 2 carte e salta il turno corrente.", cat: "🟥🟨🟩🟦 Classico" },
    { id: "c_rev", nome: "Classico: Reverse", quantita: "2 per colore", effetto: "Inverte istantaneamente la direzione dei turni di gioco.", cat: "🟥🟨🟩🟦 Classico" },
    { id: "c_bloc", nome: "Classico: Blocco", quantita: "2 per colore", effetto: "Salto del turno immediato per il giocatore successivo.", cat: "🟥🟨🟩🟦 Classico" },
    { id: "c_cc", nome: "Nero: Cambio Colore", quantita: "4", effetto: "Scegli il colore dominante del tavolo di gioco.", cat: "⚫ Nero" },
    { id: "c_piu4", nome: "Nero: +4", quantita: "4", effetto: "Il malcapitato subisce la pesca di 4 carte e perde il proprio turno.", cat: "⚫ Nero" },
    { id: "c_jack", nome: "Jack Sparrow", quantita: "1", effetto: "Copia sul momento l'effetto di un +2, +4, Cambio Colore o Reverse.", cat: "⭐ Speciale UNO?" },
    { id: "c_piu10", nome: "Speciale: +10", quantita: "Da definire", effetto: "Il malcapitato subisce la pesca di 10 carte e perde il turno.", cat: "⭐ Speciale UNO?" },
    { id: "c_piu16", nome: "Speciale: +16", quantita: "Da definire", effetto: "Il malcapitato subisce la pesca di 16 carte e perde il turno.", cat: "⭐ Speciale UNO?" },
    { id: "c_scudo", nome: "Scudo", quantita: "4", effetto: "Protegge solo da Blobby e Proiettile. Si consuma quando salva il giocatore.", cat: "⭐ Speciale UNO?" },
    { id: "c_death", nome: "Death Note", quantita: "1", MD: true, effetto: "Eliminazione immediata di un giocatore a scelta.", cat: "⭐ Speciale UNO?" },
    { id: "c_blobby", nome: "Blobby", quantita: "1", effetto: "Vittoria istantanea. Se il bersaglio ha Scudo, lo Scudo si consuma e il bersaglio sopravvive.", cat: "⭐ Speciale UNO?" },
    { id: "c_righello", nome: "Righello o X?", quantita: "4", effetto: "Giocabile fuori dal turno. Annulla interamente l'ultima mossa.", cat: "⭐ Speciale UNO?" },
    { id: "c_donna", nome: "Donna di Mazze", quantita: "1", effetto: "Resetta e annulla tutte le catene ed effetti attivi globali sul tavolo.", cat: "⭐ Speciale UNO?" },
    { id: "c_imprevisti", nome: "Imprevisti", quantita: "1", effetto: "Appena entra in mano si gioca da sola. Tutti pescano una carta.", cat: "⚪ Speciale Incolore" },
    { id: "c_scambio", nome: "Scambio", quantita: "2", effetto: "Scambia l'intera mano di carte con un giocatore bersaglio.", cat: "⭐ Speciale UNO?" },
    { id: "c_vaff", nome: "Vaffanculo", quantita: "2", effetto: "Annulla l'effetto e la streak attiva. Le carte tornano in mano.", cat: "🌍 Evento (Giallo)" },
    { id: "c_mari", nome: "Mariguana", quantita: "1", effetto: "Obbliga tutti a giocare Verde o pescare finché non lo si trova.", cat: "🌍 Evento (Verde)" },
    { id: "c_onde", nome: "Le ONDE", quantita: "2", effetto: "Tutti tranne chi la usa si scambiano le mani in modo casuale.", cat: "🌍 Evento (Blu)" },
    { id: "c_cuore", nome: "Cuore", quantita: "2", effetto: "Effettua la resurrezione immediata di un player precedentemente eliminato.", cat: "🌍 Evento (Verde)" },
    { id: "c_comunismo", nome: "Comunismo", quantita: "1", defect: "Ruba e guarda le carte. Se intercetta Blobby attiva lo scontro 1vs1.", cat: "🌍 Evento (Rosso)" },
    { id: "c_nazismo", nome: "Nazismo", quantita: "1", effetto: "Seleziona una carta dalla tua mano e cedila forzatamente a un altro.", cat: "🌍 Evento (Rosso)" },
    { id: "c_proiettile", nome: "Proiettile", quantita: "6", effetto: "Parte una roulette russa: chi viene colpito perde 1 PistolHP (Max 2).", cat: "🔫 Sistema Proiettile" },
    { id: "c_quagruppo", nome: "QUA GRUPPO!", quantita: "1", effetto: "La metà esatta dei giocatori pesca una carta (arrotondato per eccesso).", cat: "🎯 Cutruzzolà Move" },
    { id: "c_messa", nome: "La Messa è Finita", quantita: "1", effetto: "Prende tutti i rifiuti e gli scarti accumulati e li rimescola nel deck.", cat: "🎯 Cutruzzolà Move" },
    { id: "c_piani", nome: "Piani di Proiezione (P.V/P.L/P.O/L.T)", quantita: "1 per tipo", effetto: "Chi unisce tutti e 4 i pezzi sblocca la vittoria suprema.", cat: "📐 Piani di Proiezione" },
    { id: "c_brainrot", nome: "Brainrot Battle", quantita: "Da definire", effetto: "Inizia una sfida Brainrot globale. Il punteggio PT più alto vince.", cat: "🧠 Brainrot" },
    { id: "c_specchio", nome: "Specchio", quantita: "Da definire", effetto: "Riflette l'effetto scagliato contro l'utilizzatore al mittente.", cat: "❓ Non Definita" }
];

export const effettiBloccatiDaScudo = new Set(["blobby", "proiettile"]);

export function scudoBloccaEffetto(tipoEffetto) {
    return effettiBloccatiDaScudo.has(String(tipoEffetto).toLowerCase());
}

export function consumaScudoDaMano(mano = []) {
    const indiceScudo = mano.findIndex(carta => carta?.id === "c_scudo");
    if (indiceScudo === -1) {
        return { mano, consumato: false };
    }

    const nuovaMano = [...mano];
    nuovaMano.splice(indiceScudo, 1);
    return { mano: nuovaMano, consumato: true };
}

export function risolviScudo({ tipoEffetto, mano = [] }) {
    if (!scudoBloccaEffetto(tipoEffetto)) {
        return { protetto: false, scudoConsumato: false, mano };
    }

    const risultatoConsumo = consumaScudoDaMano(mano);
    return {
        protetto: risultatoConsumo.consumato,
        scudoConsumato: risultatoConsumo.consumato,
        mano: risultatoConsumo.mano
    };
}
