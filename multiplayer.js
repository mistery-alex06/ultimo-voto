import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getDatabase, ref, set, onValue, get, update } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-database.js";

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

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

export { db, ref, set, onValue, get, update };

export let currentRoom = null;
export let isHost = false;

export async function createRoom(gameState, callback) {
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

export async function joinRoom(roomCode, callback) {
    const roomRef = ref(db, 'rooms/' + roomCode);
    
    try {
        const snapshot = await get(roomRef);

        if (snapshot.exists()) {
            currentRoom = roomCode;
            isHost = false;
            console.log("DEBUG: Unito alla stanza", roomCode);

            await update(ref(db, 'rooms/' + roomCode), { status: 'playing', lastUpdate: Date.now() });

            onValue(roomRef, (snapshot) => {
                if (snapshot.exists() && callback) {
                    callback(snapshot.val().state);
                }
            });

            return true;
        }
        console.log("DEBUG: Stanza", roomCode, "non trovata!");
        return false;
    } catch (e) {
        console.error("ERRORE DI LETTURA:", e);
        return false;
    }
}

export async function updateGameState(gameState) {
    if (currentRoom) {
        try {
            await update(ref(db, 'rooms/' + currentRoom), { state: gameState, lastUpdate: Date.now() });
        } catch (e) {
            console.error("Errore durante l'aggiornamento dello stato:", e);
        }
    }
}