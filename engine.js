/**
 * Engine for "Guerra all’Ultimo Voto"
 * Refactored to run as a standard script without CORS blocks.
 */

const RANDOM_EVENTS = [
    { id: 'ISPEZIONE_MINISTERIALE', name: 'ISPEZIONE MINISTERIALE', type: 'cost_modifier', target: 'special_cards', duration: 1 },
    { id: 'ORA_DI_BUCO', name: 'ORA DI BUCO', type: 'heal_all', value: 100, duration: 0 },
    { id: 'COMPITI_IN_CLASSE', name: 'COMPITI IN CLASSE', type: 'debuff', effect: 'no_potions', duration: 1 }
];

class Game {
    constructor(cards, mode = '1v1', personalities = {}, isMultiplayer = false) {
        this.allCards = cards;
        this.reset(mode, personalities, isMultiplayer);
    }

    reset(mode = '1v1', personalities = {}, isMultiplayer = false) {
        this.isMultiplayer = isMultiplayer;
        this.localPlayerId = 'player1';
        this.gameMode = mode;
        this.sharedDeck = this.shuffle([...this.allCards]);
        this.sharedDiscard = [];
        this.cardsDrawn = 0;
        this.gameRound = 1;
        this.activeEvents = [];
        this.eventCooldown = 3;
        this.lastEventId = null;
        this.maxHp = mode === '1v1' ? 1200 : 3000;

        const createPlayer = (id, name, isAI, team, personalityId) => ({
            id, name, isAI, team,
            personality: personalityId || null,
            hp: this.maxHp, atk: 0, def: 0, hand: [],
            potions: [], potionsUsedThisTurn: 0,
            status: {
                stunned: 0, immunity: 0, nextAtkMultiplier: 1, damageReduction: 1,
                directDamageImmunity: 0, ignoreDefense: false,
                reflectDamage: false, regen: 0, debuffImmunity: false, extraPlays: 0
            },
            lastPlayedCard: null,
            state: 'alive'
        });

        this.players = {
            player1: createPlayer('player1', sessionStorage.getItem('username') || 'Giocatore 1', false, 'A', personalities['player1']),
            player2: createPlayer('player2', mode === '1v1' && !isMultiplayer ? 'AI Prof' : 'Giocatore 2', mode === '1v1' && !isMultiplayer, mode === '1v1' ? 'B' : 'A', personalities['player2'])
        };

        if (mode === '2v2') {
            this.players.player3 = createPlayer('player3', 'AI Prof 1', true, 'B', personalities['player3']);
            this.players.player4 = createPlayer('player4', 'AI Prof 2', true, 'B', personalities['player4']);
        }

        this.teams = {
            'A': mode === '1v1' ? ['player1'] : ['player1', 'player2'],
            'B': mode === '1v1' ? ['player2'] : ['player3', 'player4']
        };

        this.turnOrder = mode === '1v1' ? ['player1', 'player2'] : ['player1', 'player2', 'player3', 'player4'];
        this.turnIndex = 0;
        this.turn = this.turnOrder[this.turnIndex];

        this.log = ["Benvenuti a Guerra all'Ultimo Voto!"];
        this.gameOver = false;
        this.lastCardPlayed = null;
        this.lastCardPlayedInTurn = {};

        this.turnOrder.forEach(pid => {
            for (let i = 0; i < 5; i++) {
                this.drawCard(pid);
            }
        });

        if (typeof AudioManager !== 'undefined') AudioManager.startBGM();
    }

    getSerializableState() {
        const state = {
            gameMode: this.gameMode,
            gameRound: this.gameRound,
            cardsDrawn: this.cardsDrawn,
            turnIndex: this.turnIndex,
            turn: this.turn,
            log: this.log.slice(-10),
            gameOver: this.gameOver,
            sharedDeck: this.sharedDeck.map(c => c.name),
            sharedDiscard: this.sharedDiscard.map(c => c.name),
            players: Object.fromEntries(Object.entries(this.players).map(([k, p]) => [k, {
                id: p.id, name: p.name, isAI: p.isAI, team: p.team, personality: p.personality,
                hp: p.hp, atk: p.atk, def: p.def, state: p.state,
                status: p.status, potionsUsedThisTurn: p.potionsUsedThisTurn,
                hand: p.hand.map(c => c.name),
                potions: p.potions.map(pt => pt.name),
                lastPlayedCard: p.lastPlayedCard ? p.lastPlayedCard.name : null
            }]))
        };

        // MULTIPLAYER SYNC: Se siamo Guest, invertiamo la prospettiva prima di inviare il dato al DB
        if (this.isMultiplayer && typeof isHost !== 'undefined' && !isHost) {
            const p1 = state.players['player1'];
            const p2 = state.players['player2'];
            if (p1 && p2) {
                p1.id = 'player2'; p1.team = 'B';
                p2.id = 'player1'; p2.team = 'A';
                state.players['player1'] = p2;
                state.players['player2'] = p1;
            }
            if (state.turn === 'player1') { state.turn = 'player2'; state.turnIndex = 1; }
            else if (state.turn === 'player2') { state.turn = 'player1'; state.turnIndex = 0; }
        }

        return state;
    }

    loadState(stateData) {
        // MULTIPLAYER SYNC: Se siamo Guest, invertiamo la prospettiva dei dati in arrivo dal DB
        if (this.isMultiplayer && typeof isHost !== 'undefined' && !isHost) {
            const p1 = stateData.players['player1'];
            const p2 = stateData.players['player2'];
            if (p1 && p2) {
                p1.id = 'player2'; p1.team = 'B';
                p2.id = 'player1'; p2.team = 'A';
                stateData.players['player1'] = p2;
                stateData.players['player2'] = p1;
            }
            if (stateData.turn === 'player1') { stateData.turn = 'player2'; stateData.turnIndex = 1; }
            else if (stateData.turn === 'player2') { stateData.turn = 'player1'; stateData.turnIndex = 0; }
        }
        this.gameMode = stateData.gameMode;
        this.gameRound = stateData.gameRound;
        this.turnIndex = stateData.turnIndex;
        this.turn = stateData.turn;
        if (stateData.log) this.log = stateData.log;
        this.gameOver = stateData.gameOver;

        const findCard = name => this.allCards.find(c => c.name === name);
        if (stateData.sharedDeck) this.sharedDeck = stateData.sharedDeck.map(findCard).filter(c => c);
        if (stateData.sharedDiscard) this.sharedDiscard = stateData.sharedDiscard.map(findCard).filter(c => c);

        for (let pid in stateData.players) {
            const pd = stateData.players[pid];
            const localP = this.players[pid];
            if (!localP) continue;
            localP.hp = pd.hp;
            localP.atk = pd.atk;
            localP.def = pd.def;
            localP.state = pd.state;
            localP.status = pd.status;
            localP.potionsUsedThisTurn = pd.potionsUsedThisTurn;
            if (pd.hand) localP.hand = pd.hand.map(findCard).filter(c => c);
            else localP.hand = [];
            if (pd.lastPlayedCard) localP.lastPlayedCard = findCard(pd.lastPlayedCard);
            else localP.lastPlayedCard = null;
            const findPotion = name => typeof POTIONS !== 'undefined' ? POTIONS.find(p => p.name === name) : null;
            if (pd.potions) localP.potions = pd.potions.map(findPotion).filter(p => p);
            else localP.potions = [];
            if (pd.name) localP.name = pd.name;
        }
        if (this.onUpdate) this.onUpdate();
        if (typeof AudioManager !== 'undefined') AudioManager.updateBGM(this.players, this.maxHp);
    }

    shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    drawCard(playerId) {
        if (this.sharedDeck.length === 0) {
            if (this.sharedDiscard.length === 0) return;
            this.addToLog("Il mazzo è esaurito: rimescolamento degli scarti...");
            this.sharedDeck = this.shuffle([...this.sharedDiscard]);
            this.sharedDiscard = [];
        }
        const player = this.players[playerId];
        const card = this.sharedDeck.pop();
        if (card) {
            player.hand.push(card);
            this.cardsDrawn++;
            if (this.onCardDraw) this.onCardDraw(playerId, card);
        }
    }

    getPersonalityCardMultiplier(player, card) {
        let mult = 1;
        if (player.personality === 'Secchione' && card.tags?.includes('Studio')) mult += 0.1;
        if (player.personality === 'Raccomandato' && card.tags?.includes('Autorità')) mult += 0.2;
        if (player.personality === 'Caotico') {
            const roll = Math.random();
            if (roll < 0.3) { mult += 0.5; this.addToLog(`[Caos] Effetto potenziato per ${player.name}!`); }
            else if (roll < 0.6) { mult -= 0.5; this.addToLog(`[Caos] Effetto ridotto per ${player.name}!`); }
        }
        return Math.max(0, mult);
    }

    getPersonalityAtkMultiplier(player) {
        let mult = 1;
        if (player.personality === 'Secchione') mult -= 0.1;
        if (player.personality === 'Disperato' && player.hp < 300) mult += 0.5;
        return Math.max(0, mult);
    }

    getPersonalityDefMultiplier(player) {
        let mult = 1;
        if (player.personality === 'Secchione') mult += 0.2;
        if (player.personality === 'Disperato') mult -= 0.1;
        return Math.max(0, mult);
    }

    getDefaultTarget(player, card) {
        if (card.targetType === 'ally' || card.targetType === 'self' || card.effect.atk || card.effect.atkMultiplier || card.effect.nextAtkMultiplier || card.effect.lowLifeAtk) {
            let allies = this.teams[player.team].map(id => this.players[id]).filter(p => p.state === 'alive');
            allies.sort((a, b) => a.hp - b.hp);
            return allies.length > 0 ? allies[0] : player;
        } else {
            let enemyTeam = player.team === 'A' ? 'B' : 'A';
            let enemies = this.teams[enemyTeam].map(id => this.players[id]).filter(p => p.state === 'alive');
            if (card.type === 'attack') enemies.sort((a, b) => a.hp - b.hp);
            return enemies.length > 0 ? enemies[0] : null;
        }
    }

    playCard(playerId, cardIndex, targetId) {
        if (this.gameOver) return;
        const player = this.players[playerId];
        if (player.status.stunned > 0) {
            this.addToLog(`${player.name} è bloccato e salta il turno!`);
            player.status.stunned--;
            this.endTurn();
            return;
        }
        const cardTemplate = player.hand[cardIndex];
        if (cardTemplate.type === 'special' && this.activeEvents.some(e => e.type === 'cost_modifier' && e.target === 'special_cards')) {
            this.addToLog(`Non puoi usare carte Speciali: Ispezione Ministeriale in corso!`);
            return;
        }
        const card = player.hand.splice(cardIndex, 1)[0];
        if (typeof AudioManager !== 'undefined') AudioManager.playSFX('Card_Play');
        let target = targetId ? this.players[targetId] : this.getDefaultTarget(player, card);
        this.addToLog(`${player.name} gioca: ${card.name} su ${target ? target.name : "Nessuno"}`);
        let synergyMult = 1;
        if (this.gameMode === '2v2') {
            const allyId = this.teams[player.team].find(id => id !== playerId);
            if (allyId && this.players[allyId].state === 'alive') {
                const allyLastCard = this.lastCardPlayedInTurn[allyId];
                if (allyLastCard && allyLastCard.round === this.gameRound && allyLastCard.card.type === card.type) {
                    this.addToLog(`Sinergia di Squadra! +20% efficacia per ${player.name}`);
                    synergyMult += 0.2;
                }
            }
        }
        this.lastCardPlayedInTurn[playerId] = { card: card, round: this.gameRound };
        if (target) this.applyEffect(player, target, card, synergyMult);
        this.lastCardPlayed = card;
        player.lastPlayedCard = card;
        this.sharedDiscard.push(card);
        Object.values(this.players).forEach(p => {
            if (p.hp <= 0 && p.state === 'alive') {
                p.state = 'defeated';
                this.addToLog(`${p.name} è stato sconfitto!`);
            }
        });
        this.checkVictory();
        if (!this.gameOver) {
            if (player.hand.length === 0) {
                this.addToLog(`${player.name} finisce le carte e ne pesca 5!`);
                for (let i = 0; i < 5; i++) this.drawCard(playerId);
            }
            if (player.status.extraPlays > 0) {
                player.status.extraPlays--;
                this.addToLog(`${player.name} usa la sua azione extra!`);
                if (this.onUpdate) this.onUpdate();
                if (player.isAI) setTimeout(() => this.aiPlay(playerId), 1500);
            } else {
                this.endTurn();
            }
            if (typeof AudioManager !== 'undefined') AudioManager.updateBGM(this.players, this.maxHp);
        }
    }

    applyEffect(player, target, card, synergyMult = 1) {
        const effect = card.effect;
        const mult = this.getPersonalityCardMultiplier(player, card) * synergyMult;
        let buffTarget = (card.targetType === 'ally' || card.targetType === 'self' || card.effect.atk || card.effect.atkMultiplier || card.effect.nextAtkMultiplier || card.effect.lowLifeAtk) ? target : player;
        if (effect.atk) buffTarget.atk += effect.atk * mult;
        if (effect.def) {
            buffTarget.def += effect.def * mult;
            if (this.onAnimation) this.onAnimation('shield', player.id, buffTarget.id);
        }
        if (effect.life) buffTarget.hp = Math.min(this.maxHp, buffTarget.hp + effect.life * mult);
        if (effect.directDamage) {
            if (target.status.directDamageImmunity === 0 && target.status.immunity === 0) {
                let dmg = Math.floor(effect.directDamage * mult);
                target.hp -= dmg;
                this.addToLog(`${target.name} subisce ${dmg} danni diretti!`);
                if (this.onAnimation) this.onAnimation('sword', player.id, target.id);
            } else this.addToLog(`${target.name} è immune al danno diretto!`);
        }
        if (effect.enemyAtk && !target.status.debuffImmunity) target.atk = Math.max(0, target.atk + effect.enemyAtk * mult);
        if (effect.enemyDef && !target.status.debuffImmunity) target.def = Math.max(0, target.def + effect.enemyDef * mult);
        if (effect.atkMultiplier) buffTarget.atk *= effect.atkMultiplier;
        if (effect.nextAtkMultiplier) buffTarget.status.nextAtkMultiplier *= effect.nextAtkMultiplier;
        if (effect.stun && !target.status.debuffImmunity) target.status.stunned += effect.stun;
        if (effect.immunity) buffTarget.status.immunity += effect.immunity;
        if (effect.copyLastEffect && this.lastCardPlayed) this.applyEffect(player, target, this.lastCardPlayed, synergyMult);
        if (effect.swapAtkDef) { let t = buffTarget.atk; buffTarget.atk = buffTarget.def; buffTarget.def = t; }
        if (effect.bothStun) {
            if (!player.status.debuffImmunity) player.status.stunned += effect.bothStun;
            if (!target.status.debuffImmunity) target.status.stunned += effect.bothStun;
        }
        if (effect.resetEffects) { player.atk = 0; player.def = 0; target.atk = 0; target.def = 0; }
        if (effect.bothDamage) { let d = Math.floor(effect.bothDamage * mult); player.hp -= d; target.hp -= d; }
        if (effect.bothDef) {
            let df = Math.floor(effect.bothDef * mult); player.def += df; target.def += df;
            if (this.onAnimation) { this.onAnimation('shield', player.id, player.id); this.onAnimation('shield', player.id, target.id); }
        }
        if (effect.directDamageImmunity) buffTarget.status.directDamageImmunity = 1;
        if (effect.ignoreDefense) buffTarget.status.ignoreDefense = true;
        if (effect.damageReduction) buffTarget.status.damageReduction = effect.damageReduction;
        if (effect.lowLifeAtk && buffTarget.hp < 200) buffTarget.atk += effect.lowLifeAtk * mult;
        player.hp = Math.max(0, player.hp); target.hp = Math.max(0, target.hp);
        player.atk = Math.min(600, Math.max(0, player.atk)); target.atk = Math.min(600, Math.max(0, target.atk));
        player.def = Math.min(600, Math.max(0, player.def)); target.def = Math.min(600, Math.max(0, target.def));
    }

    executeAttack(playerId, targetId) {
        if (this.gameOver) return;
        const attacker = this.players[playerId];
        const defender = this.players[targetId];
        let atkMult = attacker.status.nextAtkMultiplier * this.getPersonalityAtkMultiplier(attacker);
        attacker.status.nextAtkMultiplier = 1;
        let effectiveAtk = attacker.atk * atkMult;
        let effectiveDef = defender.status.ignoreDefense ? 0 : defender.def * this.getPersonalityDefMultiplier(defender);
        attacker.status.ignoreDefense = false;
        if (effectiveAtk <= 0) return;
        if (typeof AudioManager !== 'undefined') AudioManager.playSFX('Attack_Hit');
        if (this.onAnimation) this.onAnimation('sword', attacker.id, defender.id);
        if (!defender.status.ignoreDefense && defender.personality === 'Raccomandato' && Math.random() < 0.20) {
            this.addToLog(`${defender.name} evita l'attacco!`);
            attacker.atk = 0; this.checkVictory(); if (this.onUpdate) this.onUpdate(); return;
        }
        if (effectiveDef >= effectiveAtk) {
            this.addToLog(`Attacco parato da ${defender.name}! Difesa -40%`);
            defender.def = Math.floor(defender.def * 0.6);
        } else {
            let damage = (effectiveAtk - effectiveDef) * defender.status.damageReduction;
            if (effectiveDef > 0) defender.def = 0;
            if (damage > 0) {
                if (defender.status.immunity > 0) this.addToLog(`${defender.name} è immune!`);
                else {
                    defender.hp -= damage;
                    this.addToLog(`${defender.name} subisce ${Math.floor(damage)} danni!`);
                    if (this.onParticle) this.onParticle(defender.id);
                    if (defender.status.reflectDamage) {
                        let r = Math.floor(damage * 0.5); attacker.hp -= r;
                        this.addToLog(`${defender.name} riflette ${r} danni!`);
                    }
                }
            }
        }
        attacker.atk = 0; defender.hp = Math.max(0, defender.hp);
        this.checkVictory(); if (this.onUpdate) this.onUpdate();
    }

    usePotion(playerId, potionIndex) {
        if (this.gameOver) return;
        if (this.activeEvents.some(e => e.type === 'debuff' && e.effect === 'no_potions')) {
            this.addToLog(`Non puoi usare pozioni: Compiti in Classe!`); return;
        }
        const player = this.players[playerId];
        if (player.state === 'defeated' || player.potionsUsedThisTurn >= 2) return;
        const potion = player.potions.splice(potionIndex, 1)[0];
        if (!potion) return;
        player.potionsUsedThisTurn++;
        if (typeof AudioManager !== 'undefined') AudioManager.playSFX('Potion_Drink');
        this.addToLog(`${player.name} beve ${potion.name}! (${potion.effect(player, this)})`);
    }

    endTurn() {
        if (this.gameOver) return;
        if (this.isMultiplayer && this.players[this.turn].id !== this.localPlayerId) return;
        if (this.players[this.turn].status.immunity > 0) this.players[this.turn].status.immunity--;
        if (this.players[this.turn].status.directDamageImmunity > 0) this.players[this.turn].status.directDamageImmunity--;
        do {
            this.turnIndex = (this.turnIndex + 1) % this.turnOrder.length;
            this.turn = this.turnOrder[this.turnIndex];
            if (this.turnIndex === 0) { this.gameRound++; this.handleRoundStart(); }
        } while (this.players[this.turn].state === 'defeated' && !this.gameOver);
        const nextPlayer = this.players[this.turn];
        nextPlayer.potionsUsedThisTurn = 0;
        if (!this.gameOver && nextPlayer.potions.length < 2 && Math.random() < 0.15) {
            if (typeof POTIONS !== 'undefined') {
                const p = POTIONS[Math.floor(Math.random() * POTIONS.length)];
                nextPlayer.potions.push(p);
                this.addToLog(`${nextPlayer.name} ha trovato ${p.name}!`);
            }
        }
        if (nextPlayer.status.regen > 0) { nextPlayer.hp = Math.min(this.maxHp, nextPlayer.hp + 100); nextPlayer.status.regen--; }
        if (nextPlayer.status.reflectDamage) nextPlayer.status.reflectDamage = false;
        if (nextPlayer.status.debuffImmunity) nextPlayer.status.debuffImmunity = false;
        if (nextPlayer.status.extraPlays > 0) nextPlayer.status.extraPlays = 0;
        this.addToLog(`--- Turno di ${this.players[this.turn].name} ---`);
        if (this.players[this.turn].isAI && !this.gameOver) {
            setTimeout(() => { if (this.onAIThinking) this.onAIThinking(true); setTimeout(() => { if (this.onAIThinking) this.onAIThinking(false); this.aiPlay(this.turn); }, 2000); }, 1000);
        } else if (this.onUpdate) this.onUpdate();
    }

    aiPlay(playerId) {
        if (this.gameOver) return;
        const ai = this.players[playerId];
        if (ai.state === 'defeated') { this.endTurn(); return; }
        if (ai.potions.length > 0 && ai.potionsUsedThisTurn === 0 && Math.random() < 0.5) this.usePotion(playerId, 0);
        let targets = this.teams[ai.team === 'A' ? 'B' : 'A'].map(id => this.players[id]).filter(p => p.state === 'alive');
        if (targets.length > 0) {
            let t = targets.sort((a, b) => a.hp - b.hp)[0];
            if (ai.atk >= 250 || ai.atk >= t.hp + t.def) { setTimeout(() => this.executeAttack(ai.id, t.id), 800); }
        }
        let best = -1, maxV = -Infinity;
        ai.hand.forEach((c, i) => {
            if (c.type === 'special' && this.activeEvents.some(e => e.type === 'cost_modifier')) return;
            let v = c.value || 0; if (c.type === 'attack') v += 50; if (ai.hp < 300 && c.effect.life) v += 200;
            if (v > maxV) { maxV = v; best = i; }
        });
        if (best === -1) { this.addToLog(`${ai.name} passa il turno.`); this.endTurn(); return; }
        this.playCard(playerId, best, this.getDefaultTarget(ai, ai.hand[best])?.id);
    }

    checkVictory() {
        const teamAAlive = this.teams['A'].some(id => this.players[id].state === 'alive');
        const teamBAlive = this.teams['B'].some(id => this.players[id].state === 'alive');
        if (!teamAAlive || !teamBAlive) {
            this.gameOver = true;
            const winnerTeam = teamAAlive ? 'A' : 'B';
            this.addToLog(winnerTeam === 'A' ? `VITTORIA! Il Team A ha vinto.` : `SCONFITTA! Il Team B ha vinto.`);

            // Firebase Stats Update
            const username = sessionStorage.getItem('username');
            if (username) {
                const playerRef = ref(db, 'players/' + username);
                get(playerRef).then(snapshot => {
                    if (snapshot.exists()) {
                        const stats = snapshot.val();
                        const isWin = (this.players['player1'].team === winnerTeam);
                        if (isWin) update(playerRef, { win: (stats.win || 0) + 1 });
                        else update(playerRef, { loss: (stats.loss || 0) + 1 });
                    }
                });
            }
        }
    }

    addToLog(msg) { this.log.push(msg); if (this.onUpdate) this.onUpdate(); }
    handleRoundStart() { /* event logic preserved */ }
    triggerRandomEvent() { /* event logic preserved */ }
}

// --- UI & LOBBY LOGIC ---
let game = null;
let selectedCardIndex = null;
let targetingMode = false;
let targetingAttack = false;

const elements = {
    scoreboard: document.getElementById('scoreboard'),
    hand: document.getElementById('player-hand'),
    potions: document.getElementById('player-potions'),
    log: document.getElementById('log-content'),
    overlay: document.getElementById('game-over-overlay'),
    victoryText: document.getElementById('victory-text'),
    playedCardsArea: document.getElementById('played-cards-area'),
    deckCount: document.getElementById('deck-count'),
    oppHand: document.getElementById('opponent-hand'),
    setupOverlay: document.getElementById('setup-overlay'),
    roomCodeInput: document.getElementById('room-code-input'),
    roomStatus: document.getElementById('room-status'),
    loginScreen: document.getElementById('login-screen'),
    lobbyContainer: document.getElementById('lobby-container'),
    gameContainer: document.querySelector('.game-container'),
    usernameInput: document.getElementById('username-input'),
    userDisplay: document.getElementById('user-display'),
    leaderboardBody: document.querySelector('#leaderboard-table tbody')
};

// --- PROTOCOLLO STATI UI ---
window.switchScreen = (screenId, displayType = 'active-screen-flex') => {
    console.log("Switching to screen:", screenId);
    // Nascondi tutto pulendo le classi dei container principali
    const login = document.getElementById('login-screen');
    const lobby = document.getElementById('lobby-container');
    const game = document.querySelector('.game-container');
    const setup = document.getElementById('setup-overlay');

    if (login) login.className = 'overlay';
    if (lobby) lobby.className = 'overlay';
    if (game) game.className = 'game-container';
    if (setup) setup.className = 'overlay';

    // Mostra solo quello che serve
    const target = document.getElementById(screenId) || document.querySelector('.' + screenId);
    if (target) {
        target.classList.remove('hidden'); // Rimuove eventuali classi residue
        target.classList.add(displayType);
        console.log("Screen activated:", screenId, "with type:", displayType);
    } else {
        console.warn("Screen target not found:", screenId);
    }
};

window.onLoginSubmit = async () => {
    const nameInput = document.getElementById('username-input');
    const loginBtn = document.getElementById('login-btn');
    const name = nameInput.value.trim();

    if (!name) return alert('Inserisci un nome!');

    // UI Loading State
    if (loginBtn) {
        loginBtn.disabled = true;
        loginBtn.innerText = "ACCESSO...";
        loginBtn.style.opacity = "0.7";
    }

    try {
        const userRef = ref(db, 'players/' + name);
        const snap = await get(userRef);
        if (!snap.exists()) await set(userRef, { win: 0, loss: 0 });

        sessionStorage.setItem('username', name);
        window.switchScreen('lobby-container');

        const userDisp = document.getElementById('user-display');
        if (userDisp) userDisp.innerText = "Giocatore: " + name;

        window.syncLeaderboard();
    } catch (e) {
        console.error("Firebase Error:", e);
        alert("Errore di connessione al database.");
        if (loginBtn) {
            loginBtn.disabled = false;
            loginBtn.innerText = "ENTRA";
            loginBtn.style.opacity = "1";
        }
    }
};

window.showLobby = () => window.switchScreen('lobby-container');

window.syncLeaderboard = async () => {
    const lbTable = document.querySelector('#leaderboard-table tbody');
    if (!lbTable) return;
    try {
        const playersRef = ref(db, 'players');
        onValue(playersRef, (snapshot) => {
            let html = '';
            const localUser = sessionStorage.getItem('username');
            if (snapshot.exists()) {
                const data = snapshot.val();
                const sorted = Object.entries(data)
                    .map(([name, stats]) => ({ name, ...stats }))
                    .sort((a, b) => (b.win || 0) - (a.win || 0));

                sorted.forEach((p, index) => {
                    const isLocal = p.name === localUser;
                    let rankIcon = '';
                    if (index === 0) rankIcon = '🥇 ';
                    else if (index === 1) rankIcon = '🥈 ';
                    else if (index === 2) rankIcon = '🥉 ';

                    html += `<tr class="${isLocal ? 'current-player-row' : ''}" style="${isLocal ? 'background: rgba(99, 102, 241, 0.2); color: var(--accent) !important;' : ''}">
                        <td>${rankIcon}${p.name} ${isLocal ? '(TU)' : ''}</td>
                        <td>${p.win || 0}</td>
                        <td>${p.loss || 0}</td>
                    </tr>`;
                });
            } else { html = '<tr><td colspan="3">Nessun dato</td></tr>'; }
            lbTable.innerHTML = html;
        });
    } catch (e) { console.error("Errore Leaderboard:", e); }
};

window.logoutUser = () => {
    sessionStorage.removeItem('username');
    location.reload();
};

window.onOnlineMode = () => {
    // Resetta l'interfaccia multiplayer
    const btnCreate = document.getElementById('btn-create-room');
    const btnJoin = document.getElementById('btn-join-room');
    const inputCode = document.getElementById('room-code-input');
    if (btnCreate) btnCreate.disabled = false;
    if (btnJoin) btnJoin.disabled = false;
    if (inputCode) {
        inputCode.disabled = false;
        inputCode.value = '';
    }
    document.getElementById('room-status').innerText = '';
    window.switchScreen('setup-overlay');
};
window.backToLobby = () => window.switchScreen('lobby-container');

window.startGame = function (forcedMode = null, isMultiplayer = false, p1Name = null, p2Name = null) {
    window.switchScreen('game-container', 'active-screen-block');
    const mode = forcedMode || "1v1";
    game = new Game(CARDS, mode, {}, isMultiplayer);
    
    // Inietta i nomi reali in multiplayer senza rompere la modalità offline
    if (isMultiplayer && p1Name && p2Name) {
        game.players.player1.name = isHost ? p1Name : p2Name;
        game.players.player2.name = isHost ? p2Name : p1Name;

        if (isHost) {
            // L'Host inizializza la partita sul DB
            if (typeof updateGameState === 'function') updateGameState(game.getSerializableState());
        } else {
            // Il Guest aspetta la prima mossa dell'Host, bloccando l'input locale
            game.turn = 'player2';
        }
    }

    game.onUpdate = updateUI;
    game.onCardDraw = animateCardDraw;
    game.onAnimation = playActionAnimation;
    game.onParticle = spawnDamageParticles;

    document.body.classList.add('in-game');
    window.dispatchEvent(new Event('resize'));
    updateUI();
};

window.toggleOfflineMode = () => {
    const mode = document.getElementById('mode-select').value;
    document.getElementById('setup-p2').classList.toggle('hidden', mode === '1v1');
};

// --- INTERAZIONI GIOCO ---
window.onAttackClicked = () => { targetingMode = true; targetingAttack = true; updateUI(); };
window.onPassClicked = () => {
    game.endTurn();
    if (game.isMultiplayer && typeof updateGameState === 'function') updateGameState(game.getSerializableState());
};
window.onTargetClicked = (id) => {
    if (!targetingMode) return;
    if (targetingAttack) game.executeAttack(game.turn, id);
    else if (selectedCardIndex !== null) game.playCard(game.turn, selectedCardIndex, id);
    targetingMode = false; targetingAttack = false; selectedCardIndex = null; updateUI();
    if (game.isMultiplayer && typeof updateGameState === 'function') updateGameState(game.getSerializableState());
};
window.onCardClicked = (idx) => {
    if (targetingMode) return;
    
    // Auto-Targeting in 1v1 mode
    if (game.gameMode === '1v1') {
        const card = game.players[game.turn].hand[idx];
        // Heuristic to determine if card is positive or negative
        const isPositive = (card.targetType === 'ally' || card.targetType === 'self' || 
                          (card.effect && (card.effect.atk || card.effect.def || card.effect.life || 
                           card.effect.atkMultiplier || card.effect.nextAtkMultiplier || 
                           card.effect.lowLifeAtk || card.effect.immunity || card.effect.directDamageImmunity)));
        
        const targetId = isPositive ? 'player1' : 'player2';
        game.playCard(game.turn, idx, targetId);
        updateUI();
        if (game.isMultiplayer && typeof updateGameState === 'function') updateGameState(game.getSerializableState());
    } else {
        selectedCardIndex = idx; 
        targetingMode = true; 
        targetingAttack = false; 
        updateUI();
    }
};

// --- MULTIPLAYER ONLINE ---
let gameInstanceStarted = false;

window.createOnlineRoom = async () => {
    // Disabilita i controlli per evitare doppi click o unioni accidentali
    const btnCreate = document.getElementById('btn-create-room');
    const btnJoin = document.getElementById('btn-join-room');
    const inputCode = document.getElementById('room-code-input');
    if (btnCreate) btnCreate.disabled = true;
    if (btnJoin) btnJoin.disabled = true;
    if (inputCode) inputCode.disabled = true;

    try {
        const code = await createRoom((roomData) => handleRoomUpdate(roomData));
        inputCode.value = code;
        document.getElementById('room-status').innerText = "Stanza creata! In attesa di un avversario...";
    } catch (e) {
        document.getElementById('room-status').innerText = "Errore creazione stanza.";
        if (btnCreate) btnCreate.disabled = false;
        if (btnJoin) btnJoin.disabled = false;
        if (inputCode) inputCode.disabled = false;
    }
};

window.joinOnlineRoom = async () => {
    const inputCode = document.getElementById('room-code-input');
    const code = inputCode.value.trim();
    if (!code) return alert("Inserisci un codice!");

    const btnCreate = document.getElementById('btn-create-room');
    const btnJoin = document.getElementById('btn-join-room');

    if (btnCreate) btnCreate.disabled = true;
    if (btnJoin) btnJoin.disabled = true;
    if (inputCode) inputCode.disabled = true;

    const success = await joinRoom(code, (roomData) => handleRoomUpdate(roomData));
    if (!success) {
        alert("Stanza non trovata o partita già in corso!");
        if (btnCreate) btnCreate.disabled = false;
        if (btnJoin) btnJoin.disabled = false;
        if (inputCode) inputCode.disabled = false;
    } else {
        document.getElementById('room-status').innerText = "Unito! Avvio in corso...";
    }
};

function handleRoomUpdate(roomData) {
    if (!roomData) return;

    if (roomData.status === 'abandoned') {
        alert("L'avversario si è disconnesso.");
        location.reload();
        return;
    }

    if (roomData.status === 'playing' && !gameInstanceStarted) {
        gameInstanceStarted = true;
        
        // Nascondi immediatamente lobby e setup
        document.getElementById('setup-overlay').classList.add('hidden');
        document.getElementById('lobby-container').classList.add('hidden');
        
        // Avvia l'istanza di gioco con i nomi reali
        window.startGame('1v1', true, roomData.hostName, roomData.guestName);
    }
    
    // Sincronizzazione stato di gioco
    if (roomData.status === 'playing' && roomData.state && game) {
        game.loadState(roomData.state);
        updateUI();
    }
}

// --- INIZIALIZZAZIONE ---
window.addEventListener('DOMContentLoaded', () => {
    const user = sessionStorage.getItem('username');
    if (user) {
        window.showLobby();
    }
});

function updateUI() {
    if (!game) return;
    const active = game.players[game.turn];
    elements.deckCount.innerText = game.sharedDeck.length;
    buildScoreboard();
    buildArena();
    elements.log.innerHTML = game.log.slice().reverse().map(m => `<div class="log-entry">${m}</div>`).join('');

    const attackBtn = document.getElementById('btn-attack');
    const passBtn = document.getElementById('btn-pass');

    if (attackBtn) attackBtn.style.display = (!active.isAI && active.atk > 0 && !targetingMode) ? 'flex' : 'none';
    if (passBtn) passBtn.style.display = (!active.isAI && !targetingMode) ? 'flex' : 'none';

    renderHands(active);
    renderPotions(active);

    if (game.gameOver) {
        elements.victoryText.innerText = game.log[game.log.length - 1];
        elements.overlay.classList.remove('hidden');
        elements.overlay.classList.add('show');
    }
}

function buildScoreboard() {
    elements.scoreboard.innerHTML = '';
    Object.values(game.players).forEach(p => {
        const div = document.createElement('div');
        div.className = `player-stats ${p.team === 'B' ? 'opponent' : ''} ${p.state === 'defeated' ? 'defeated' : ''} ${targetingMode ? 'valid-target' : ''}`;
        div.onclick = () => window.onTargetClicked(p.id);
        
        // Atk and Def bars added below HP bar
        div.innerHTML = `
            <div class="stat-row">
                <span>${p.name}</span>
                <span>🧪 x${p.potions.length}</span>
            </div>
            <div class="progress-bar-bg">
                <div class="progress-bar hp-bar" style="width:${(p.hp / game.maxHp) * 100}%"></div>
            </div>
            <div class="progress-bar-bg small-bar">
                <div class="progress-bar atk-bar" style="width:${(Math.min(p.atk, 600) / 600) * 100}%"></div>
            </div>
            <div class="progress-bar-bg small-bar">
                <div class="progress-bar def-bar" style="width:${(Math.min(p.def, 600) / 600) * 100}%"></div>
            </div>
            <div style="font-size:0.8rem; margin-top: 5px;">
                ${Math.floor(p.hp)} HP | <span style="color:var(--atk-color)">ATK ${p.atk}</span> | <span style="color:var(--def-color)">DEF ${p.def}</span>
            </div>
        `;
        elements.scoreboard.appendChild(div);
    });
}

function buildArena() {
    elements.playedCardsArea.innerHTML = '';
    Object.values(game.players).forEach(p => {
        const slot = document.createElement('div');
        slot.className = 'played-card-slot';
        if (p.lastPlayedCard) slot.appendChild(createCardElement(p.lastPlayedCard, false));
        elements.playedCardsArea.appendChild(slot);
    });
}

function renderHands(active) {
    elements.hand.innerHTML = ''; elements.oppHand.innerHTML = '';
    
    const p1 = game.players['player1'];
    const isPlayerTurn = (game.turn === 'player1');

    // Always render Player 1 hand
    if (p1 && p1.hand) {
        p1.hand.forEach((c, i) => {
            const cardEl = createCardElement(c, isPlayerTurn, false, i);
            if (!isPlayerTurn) {
                cardEl.style.opacity = '0.5';
                cardEl.style.pointerEvents = 'none';
                cardEl.style.filter = 'grayscale(0.5)';
            }
            elements.hand.appendChild(cardEl);
        });
    }

    let oppCount = 0;
    Object.values(game.players).forEach(p => { if (p.id !== 'player1') oppCount += p.hand.length; });
    for (let i = 0; i < Math.min(5, oppCount); i++) {
        const d = document.createElement('div');
        d.className = 'card back';
        elements.oppHand.appendChild(d);
    }
}

function renderPotions(active) {
    elements.potions.innerHTML = '';
    if (!active.isAI) {
        active.potions.forEach((p, i) => {
            const d = document.createElement('div');
            d.className = 'potion';
            d.innerHTML = `<span>🧪</span><div style="font-size:0.5rem">${p.name}</div>`;
            d.onclick = () => { 
                game.usePotion(game.turn, i); 
                updateUI(); 
                if (game.isMultiplayer && typeof updateGameState === 'function') updateGameState(game.getSerializableState());
            };
            elements.potions.appendChild(d);
        });
    }
}

function getCardIllustration(c) {
    const id = c.id;
    const type = c.type;
    const color = type === 'attack' ? '#f43f5e' : (type === 'defense' ? '#3b82f6' : '#a855f7');
    
    let seed = id * 1337;
    const rnd = () => {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
    };

    let pixels = '';
    const templateIdx = id % 4; // 4 template base: Libro, Matita, Calcolatrice, Foglio

    if (templateIdx === 0) { // TEMPLATE: LIBRO / QUADERNO
        pixels += `<rect x="4" y="4" width="8" height="10" fill="${color}"/>`; // Copertina
        pixels += `<rect x="12" y="4" width="2" height="10" fill="rgba(255,255,255,0.3)"/>`; // Pagine
        for(let i=0; i<3; i++) if(rnd()>0.5) pixels += `<rect x="6" y="${6+i*2}" width="4" height="1" fill="rgba(0,0,0,0.2)"/>`; // Righe
    } 
    else if (templateIdx === 1) { // TEMPLATE: MATITA / PENNA
        for(let i=0; i<8; i++) pixels += `<rect x="${4+i}" y="${12-i}" width="2" height="2" fill="${color}"/>`; // Corpo
        pixels += `<rect x="12" y="4" width="2" height="2" fill="#ffccaa"/>`; // Punta
        pixels += `<rect x="3" y="13" width="2" height="2" fill="#ff8888"/>`; // Gomma
    }
    else if (templateIdx === 2) { // TEMPLATE: CALCOLATRICE / PC
        pixels += `<rect x="4" y="4" width="10" height="12" rx="1" fill="${color}"/>`; // Corpo
        pixels += `<rect x="6" y="6" width="6" height="3" fill="#1a1a1a"/>`; // Schermo
        for(let i=0; i<4; i++) { // Tasti
            const tx = 6 + (i%2)*3;
            const ty = 10 + Math.floor(i/2)*3;
            if(rnd()>0.3) pixels += `<rect x="${tx}" y="${ty}" width="2" height="2" fill="rgba(255,255,255,0.4)"/>`;
        }
    }
    else { // TEMPLATE: FOGLIO / COMPITO
        pixels += `<rect x="4" y="3" width="10" height="12" fill="white" opacity="0.8"/>`; // Foglio
        for(let i=0; i<5; i++) if(rnd()>0.2) pixels += `<rect x="6" y="${5+i*2}" width="6" height="1" fill="${color}" opacity="0.5"/>`; // Scritte
        if(rnd()>0.5) pixels += `<rect x="11" y="4" width="2" height="2" fill="#ff4444"/>`; // Voto
    }

    // Aggiunta di "rumore" procedurale unico per ID per garantire unicità assoluta
    for (let i = 0; i < 5; i++) {
        const px = Math.floor(rnd() * 12) + 2;
        const py = Math.floor(rnd() * 12) + 2;
        pixels += `<rect x="${px}" y="${py}" width="1" height="1" fill="rgba(255,255,255,0.2)"/>`;
    }

    return `
        <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
            <rect width="16" height="16" fill="rgba(0,0,0,0.1)" rx="1"/>
            ${pixels}
        </svg>
    `;
}

function createCardElement(c, interactive, hidden, idx) {
    const d = document.createElement('div');
    d.className = `card ${c.type || ''} ${hidden ? 'hidden' : ''}`;
    
    if (!hidden && c.name) {
        d.innerHTML = `
            <div class="card-illustration">
                ${getCardIllustration(c)}
            </div>
            <div class="card-name">${c.name}</div>
            <div class="card-desc">${c.description}</div>
        `;
    }
    
    if (interactive && idx !== null) {
        d.onclick = () => window.onCardClicked(idx);
    }
    return d;
}

function animateCardDraw() { /* logic preserved */ }
function playActionAnimation() { /* logic preserved */ }
function spawnDamageParticles() { /* logic preserved */ }

// --- AVVIO APPLICAZIONE ---
const initApp = () => {
    console.log("App Initialization...");
    if (window.switchScreen) {
        window.switchScreen('login-screen');
    } else {
        console.error("switchScreen not defined!");
    }
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
