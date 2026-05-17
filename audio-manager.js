/**
 * AudioManager for "Guerra all’Ultimo Voto"
 * Gestione centralizzata audio con sblocco per Mac/Chrome/Mobile
 */

const AudioManager = {
    chill: new Audio('../chill.mp3?v=1.1'),
    epic: new Audio('../epic.mp3?v=1.1'),
    isUnlocked: false,
    isEpic: false,

    init() {
        this.chill.loop = true;
        this.epic.loop = true;
        this.chill.volume = 0.5;
        this.epic.volume = 0; // Parte silente

        // Global listeners per lo sblocco immediato
        const sblocca = () => this.unblock();
        window.addEventListener('mousedown', sblocca, { once: true });
        window.addEventListener('touchstart', sblocca, { once: true });

        console.log("AUDIOPROF: Manager inizializzato. In attesa di interazione...");
    },

    unblock() {
        if (this.isUnlocked) return;

        // "Benedizione" dei canali per Apple/Chrome
        Promise.all([
            this.chill.play().then(() => {
                if (!this.isEpic) this.chill.volume = 0.5;
                else this.chill.pause();
            }),
            this.epic.play().then(() => {
                this.epic.pause();
                this.epic.volume = 0;
            })
        ]).then(() => {
            this.isUnlocked = true;
            console.log("AUDIOPROF: Canali audio sbloccati con successo! 🎸");
        }).catch(err => {
            console.warn("AUDIOPROF: Sblocco fallito o in attesa di interazione valida.", err);
        });
    },

    switchToEpic() {
        if (this.isEpic) return;
        this.isEpic = true;
        console.log("AUDIOPROF: Avvio transizione Epica (1.5s)... 🔥");

        const fadeDuration = 2000; // 2 secondi per maggiore fluidità
        const steps = 40;
        const interval = fadeDuration / steps;
        const targetVolume = 0.5;
        const volumeStep = targetVolume / steps;

        // Assicuriamoci che epic sia in play (silenzioso) prima del fade
        this.epic.currentTime = 0;
        this.epic.volume = 0;
        this.epic.play().catch(e => console.warn("AUDIOPROF: Errore riproduzione Epic", e));

        const crossFade = setInterval(() => {
            // Chill fade out
            if (this.chill.volume > 0) {
                this.chill.volume = Math.max(0, this.chill.volume - volumeStep);
            } else {
                this.chill.pause();
            }

            // Epic fade in
            if (this.epic.volume < targetVolume) {
                this.epic.volume = Math.min(targetVolume, this.epic.volume + volumeStep);
            }

            if (this.chill.volume === 0 && this.epic.volume === targetVolume) {
                clearInterval(crossFade);
                console.log("AUDIOPROF: Transizione Epica completata.");
            }
        }, interval);
    },

    startBGM() {
        console.log("AUDIOPROF: Richiesto avvio BGM.");
        if (this.isUnlocked) {
            if (!this.isEpic) {
                this.chill.play().catch(e => console.warn("AUDIOPROF: Errore play chill", e));
                this.chill.volume = 0.5;
            } else {
                this.epic.play().catch(e => console.warn("AUDIOPROF: Errore play epic", e));
                this.epic.volume = 0.5;
            }
        }
    },

    updateBGM(players, maxHp) {
        if (this.isEpic || !this.isUnlocked) return;

        const threshold = maxHp * 0.3;
        let shouldBeEpic = false;

        Object.values(players).forEach(p => {
            if (p.hp > 0 && p.hp <= threshold) {
                shouldBeEpic = true;
            }
        });

        if (shouldBeEpic) {
            this.switchToEpic();
        }
    },

    playSFX(name) {
        // SFX ignorati come richiesto, ma pronti per espansioni future
    }
};

// Inizializzazione immediata all'importazione
AudioManager.init();
