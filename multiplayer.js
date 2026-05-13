// Nessun import: usa i CDN Firebase Compat da index.html

const firebaseConfig = {
    apiKey: "AIzaSyAdP4M4btGlOg6RG60jz_3GwvwC0l3aIx8",
    authDomain: "ultimo-voto.firebaseapp.com",
    databaseURL: "https://ultimo-voto-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "ultimo-voto",
    storageBucket: "ultimo-voto.firebasestorage.app",
    messagingSenderId: "197133115066",
    appId: "1:197133115066:web:959aec9c47f3cfeb5b6c83",
    measurementId: "G-5MRFFSSTSX"
};

// Inizializza Firebase Compat
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// Wrapper per mantenere compatibilità con lo stile modulare in engine.js
const ref = (dbInstance, path) => dbInstance.ref(path);
const set = (refInstance, data) => refInstance.set(data);
const onValue = (refInstance, callback) => refInstance.on('value', callback);
const get = (refInstance) => refInstance.once('value');
const update = (refInstance, data) => refInstance.update(data);

let currentRoom = null;
let isHost = false;

async function createRoom(gameState, callback) {
    const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    currentRoom = roomCode;
    isHost = true;

    const roomRef = ref(db, 'rooms/' + roomCode);

    try {
        await set(roomRef, {
            state: gameState,
            status: 'waiting',
            lastUpdate: Date.now()
        });
        console.log("Stanza creata nel DB:", roomCode);

        onValue(roomRef, (snapshot) => {
            if (snapshot.exists() && callback) {
                callback(snapshot.val().state);
            }
        });

        return roomCode;
    } catch (e) {
        console.error("ERRORE DI SCRITTURA:", e);
        alert("Errore Firebase: impossibile creare la stanza.");
        throw e;
    }
}

async function joinRoom(roomCode, callback) {
    const roomRef = ref(db, 'rooms/' + roomCode);
    try {
        const snapshot = await get(roomRef);
        if (snapshot.exists()) {
            currentRoom = roomCode;
            isHost = false;

            await update(roomRef, { status: 'playing' });
            console.log("Unito alla stanza:", roomCode);

            onValue(roomRef, (snapshot) => {
                if (snapshot.exists() && callback) {
                    callback(snapshot.val().state);
                }
            });
            return true;
        } else {
            alert("Stanza non trovata!");
            return false;
        }
    } catch (e) {
        console.error("ERRORE DI LETTURA:", e);
        alert("Errore Firebase: impossibile unirsi alla stanza.");
        return false;
    }
}

async function updateGameState(gameState) {
    if (!currentRoom) return;
    try {
        const roomRef = ref(db, 'rooms/' + currentRoom);
        await update(roomRef, {
            state: gameState,
            lastUpdate: Date.now()
        });
    } catch (e) {
        console.error("Errore durante l'aggiornamento dello stato:", e);
    }
}