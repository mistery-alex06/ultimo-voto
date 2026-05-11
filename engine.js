/**
 * Engine for "Guerra all’Ultimo Voto"
 */

import { POTIONS } from './potions.js';
import { CARDS } from './cards.js';
import { createRoom, joinRoom, updateGameState, isHost, currentRoom, db, ref, set, onValue, get, update } from './multiplayer.js';

import { AudioManager } from './audio-manager.js';

const RANDOM_EVENTS = [
    { id: 'ISPEZIONE_MINISTERIALE', name: 'ISPEZIONE MINISTERIALE', type: 'cost_modifier', target: 'special_cards', duration: 1 },
    { id: 'ORA_DI_BUCO', name: 'ORA DI BUCO', type: 'heal_all', value: 100, duration: 0 },
    { id: 'COMPITI_IN_CLASSE', name: 'COMPITI IN CLASSE', type: 'debuff', effect: 'no_potions', duration: 1 }
];

export class Game {
    constructor(cards, mode = '1v1', personalities = {}, isMultiplayer = false) {
        this.allCards = cards;
        this.reset(mode, personalities, isMultiplayer);
    }

    reset(mode = '1v1', personalities = {}, isMultiplayer = false) {
        this.isMultiplayer = isMultiplayer;
        this.localPlayerId = 'player1'; // Default, overridden in index.html
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
            player1: createPlayer('player1', 'Giocatore 1', false, 'A', personalities['player1']),
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

        // Initial draw
        this.turnOrder.forEach(pid => {
            for (let i = 0; i < 5; i++) {
                this.drawCard(pid);
            }
        });

        if (typeof AudioManager !== 'undefined') AudioManager.startBGM();
    }

    getSerializableState() {
        return {
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
    }

    loadState(stateData) {
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
            this.playAudio('Card_Play');
            if (this.onCardDraw) this.onCardDraw(playerId, card);
        }
    }

    playAudio(sfx) {
        if (this.onAudio) this.onAudio(sfx);
        else if (typeof AudioManager !== 'undefined' && AudioManager.playSFX) AudioManager.playSFX(sfx);
    }

    getPersonalityCardMultiplier(player, card) {
        let mult = 1;
        if (player.personality === 'Secchione' && card.tags?.includes('Studio')) {
            mult += 0.1;
        }
        if (player.personality === 'Raccomandato' && card.tags?.includes('Autorità')) {
            mult += 0.2;
        }
        if (player.personality === 'Caotico') {
            const roll = Math.random();
            if (roll < 0.3) {
                mult += 0.5;
                this.addToLog(`[Caos] Effetto potenziato per ${player.name}!`);
            } else if (roll < 0.6) {
                mult -= 0.5;
                this.addToLog(`[Caos] Effetto ridotto per ${player.name}!`);
            }
        }
        return Math.max(0, mult); // Prevent negative total multipliers
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
            // For buffs, we might want to prioritize someone specific, but lowest HP is a decent default support logic
            allies.sort((a, b) => a.hp - b.hp);
            return allies.length > 0 ? allies[0] : player;
        } else {
            let enemyTeam = player.team === 'A' ? 'B' : 'A';
            let enemies = this.teams[enemyTeam].map(id => this.players[id]).filter(p => p.state === 'alive');
            if (card.type === 'attack') {
                enemies.sort((a, b) => a.hp - b.hp); // attack lowest hp enemy
            }
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
            if (this.onUpdate) this.onUpdate();
            return;
        }

        const card = player.hand.splice(cardIndex, 1)[0];
        this.playAudio('Card_Play');
        let target = targetId ? this.players[targetId] : this.getDefaultTarget(player, card);
        let targetName = target ? target.name : "Nessuno";
        this.addToLog(`${player.name} gioca: ${card.name} su ${targetName}`);

        // Scambio effetti / Sinergia team
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

        if (target) {
            this.applyEffect(player, target, card, synergyMult);
        }

        this.lastCardPlayed = card;
        player.lastPlayedCard = card;
        this.sharedDiscard.push(card);

        // Controlla sconfitte
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
                for (let i = 0; i < 5; i++) {
                    this.drawCard(playerId);
                }
            }
            if (player.status.extraPlays > 0) {
                player.status.extraPlays--;
                this.addToLog(`${player.name} usa la sua azione extra per giocare ancora!`);
                if (this.onUpdate) this.onUpdate();
                if (player.isAI) {
                    setTimeout(() => this.aiPlay(playerId), 1500);
                }
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

        // Stats
        if (effect.atk) buffTarget.atk += effect.atk * mult;
        if (effect.def) {
            buffTarget.def += effect.def * mult;
            this.playAudio('Defense_Buff');
            if (this.onAnimation) this.onAnimation('shield', player.id, buffTarget.id);
        }
        if (effect.life) {
            buffTarget.hp = Math.min(this.maxHp, buffTarget.hp + effect.life * mult);
        }
        if (effect.directDamage) {
            if (target.status.directDamageImmunity === 0 && target.status.immunity === 0) {
                let dmg = Math.floor(effect.directDamage * mult);
                target.hp -= dmg;
                if (typeof AudioManager !== 'undefined') AudioManager.updateBGM(this.players, this.maxHp);
                this.addToLog(`${target.name} subisce ${dmg} danni diretti!`);
                if (this.onAnimation) this.onAnimation('sword', player.id, target.id);
            } else {
                this.addToLog(`${target.name} è immune al danno diretto!`);
            }
        }

        // Enemy Reductions
        if (effect.enemyAtk) {
            if (!target.status.debuffImmunity) target.atk = Math.max(0, target.atk + effect.enemyAtk * mult);
            else this.addToLog(`${target.name} è immune al debuff!`);
        }
        if (effect.enemyDef) {
            if (!target.status.debuffImmunity) target.def = Math.max(0, target.def + effect.enemyDef * mult);
            else this.addToLog(`${target.name} è immune al debuff!`);
        }

        // Multipliers
        if (effect.atkMultiplier) buffTarget.atk *= effect.atkMultiplier;
        if (effect.nextAtkMultiplier) buffTarget.status.nextAtkMultiplier *= effect.nextAtkMultiplier;

        // Special Mechanics
        if (effect.stun) {
            if (!target.status.debuffImmunity) target.status.stunned += effect.stun;
            else this.addToLog(`${target.name} è immune allo stordimento!`);
        }
        if (effect.immunity) buffTarget.status.immunity += effect.immunity;
        if (effect.cancelLastAttack) {
            this.addToLog(`L'ultimo attacco è stato annullato!`);
        }
        if (effect.endEnemyTurn) {
            target.status.stunned = 1;
        }
        if (effect.copyLastEffect && this.lastCardPlayed) {
            this.addToLog(`Copia l'effetto di ${this.lastCardPlayed.name}`);
            this.applyEffect(player, target, this.lastCardPlayed, synergyMult);
        }
        if (effect.swapAtkDef) {
            let temp = buffTarget.atk;
            buffTarget.atk = buffTarget.def;
            buffTarget.def = temp;
        }
        if (effect.bothStun) {
            if (!player.status.debuffImmunity) player.status.stunned += effect.bothStun;
            if (!target.status.debuffImmunity) target.status.stunned += effect.bothStun;
        }
        if (effect.resetEffects) {
            player.atk = 0;
            player.def = 0;
            target.atk = 0;
            target.def = 0;
        }
        if (effect.setLife) buffTarget.hp = effect.setLife;
        if (effect.bothDamage) {
            let dmg = Math.floor(effect.bothDamage * mult);
            player.hp -= dmg;
            target.hp -= dmg;
            if (typeof AudioManager !== 'undefined') AudioManager.updateBGM(this.players, this.maxHp);
        }
        if (effect.bothDef) {
            let df = Math.floor(effect.bothDef * mult);
            player.def += df;
            target.def += df;
            if (this.onAnimation) {
                this.onAnimation('shield', player.id, player.id);
                this.onAnimation('shield', player.id, target.id);
            }
        }
        if (effect.directDamageImmunity) buffTarget.status.directDamageImmunity = 1;
        if (effect.ignoreDefense) buffTarget.status.ignoreDefense = true;
        if (effect.damageReduction) buffTarget.status.damageReduction = effect.damageReduction;
        if (effect.lowLifeAtk && buffTarget.hp < 200) buffTarget.atk += effect.lowLifeAtk * mult;

        // Boundary checks
        player.hp = Math.max(0, player.hp);
        target.hp = Math.max(0, target.hp);
        player.atk = Math.min(600, Math.max(0, player.atk));
        player.def = Math.min(600, Math.max(0, player.def));
        target.atk = Math.min(600, Math.max(0, target.atk));
        target.def = Math.min(600, Math.max(0, target.def));
    }

    executeAttack(playerId, targetId) {
        if (this.gameOver) return;
        const attacker = this.players[playerId];
        const defender = this.players[targetId];

        let atkMult = attacker.status.nextAtkMultiplier * this.getPersonalityAtkMultiplier(attacker);
        attacker.status.nextAtkMultiplier = 1;

        let effectiveAtk = attacker.atk * atkMult;
        let defMult = this.getPersonalityDefMultiplier(defender);
        let effectiveDef = defender.status.ignoreDefense ? 0 : defender.def * defMult;
        attacker.status.ignoreDefense = false;

        if (effectiveAtk <= 0) return;

        this.playAudio('Attack_Hit');
        if (this.onAnimation) this.onAnimation('sword', attacker.id, defender.id);

        // Raccomandato check
        if (!defender.status.ignoreDefense && defender.personality === 'Raccomandato') {
            if (Math.random() < 0.20) {
                this.addToLog(`${defender.name} (Raccomandato) ha evitato l'attacco!`);
                attacker.atk = 0;
                this.checkVictory();
                if (this.onUpdate) this.onUpdate();
                return;
            }
        }

        if (effectiveDef >= effectiveAtk) {
            this.addToLog(`L'attacco di ${attacker.name} è stato completamente parato da ${defender.name}!`);
            defender.def = Math.floor(defender.def * 0.6); // diminuisce del 40%
            this.addToLog(`La Difesa di ${defender.name} scende del 40%`);
        } else {
            let damage = (effectiveAtk - effectiveDef) * defender.status.damageReduction;
            if (effectiveDef > 0) {
                this.addToLog(`La difesa di ${defender.name} ha parato parte dell'attacco ma è stata distrutta!`);
                defender.def = 0;
            }

            if (damage > 0) {
                if (defender.status.immunity > 0) {
                    this.addToLog(`${defender.name} è immune ai danni!`);
                } else {
                    defender.hp -= damage;
                    if (typeof AudioManager !== 'undefined') AudioManager.updateBGM(this.players, this.maxHp);
                    this.addToLog(`${defender.name} subisce ${Math.floor(damage)} danni!`);
                    if (this.onParticle) this.onParticle(defender.id);
                    if (defender.status.reflectDamage) {
                        let reflect = Math.floor(damage * 0.5);
                        attacker.hp -= reflect;
                        if (typeof AudioManager !== 'undefined') AudioManager.updateBGM(this.players, this.maxHp);
                        this.addToLog(`${defender.name} riflette ${reflect} danni a ${attacker.name}!`);
                    }
                }
            }
        }

        attacker.atk = 0; // Azzera la statistica attacco
        defender.hp = Math.max(0, defender.hp);
        this.checkVictory();
        if (this.onUpdate) this.onUpdate();
    }

    usePotion(playerId, potionIndex) {
        if (this.gameOver) return;
        if (this.activeEvents.some(e => e.type === 'debuff' && e.effect === 'no_potions')) {
            this.addToLog(`Non puoi usare pozioni: Compiti in Classe in corso!`);
            if (this.onUpdate) this.onUpdate();
            return;
        }

        const player = this.players[playerId];
        if (player.state === 'defeated' || player.potionsUsedThisTurn >= 2) return;
        const potion = player.potions[potionIndex];
        if (!potion) return;

        player.potions.splice(potionIndex, 1);
        player.potionsUsedThisTurn++;

        this.playAudio('Potion_Drink');
        let effectMsg = potion.effect(player, this);
        this.addToLog(`${player.name} beve ${potion.name}! (${effectMsg})`);
        if (typeof AudioManager !== 'undefined') AudioManager.updateBGM(this.players, this.maxHp);
    }

    handleRoundStart() {
        // Decrease duration of active events
        this.activeEvents = this.activeEvents.filter(e => {
            e.duration--;
            if (e.duration <= 0) {
                this.addToLog(`L'evento ${e.name} è terminato.`);
                return false;
            }
            return true;
        });

        // Event generation check
        if (this.eventCooldown > 0) {
            this.eventCooldown--;
        } else {
            // 10% chance to start a new event when cooldown is 0
            if (Math.random() < 0.1) {
                this.triggerRandomEvent();
            }
        }
    }

    triggerRandomEvent() {
        let eventData;
        do {
            eventData = RANDOM_EVENTS[Math.floor(Math.random() * RANDOM_EVENTS.length)];
        } while (eventData.id === this.lastEventId && RANDOM_EVENTS.length > 1);

        this.lastEventId = eventData.id;
        this.eventCooldown = 3; // Reset cooldown

        const eventInst = { ...eventData };

        this.addToLog(`FLASH NEWS: ${eventInst.name}!`);

        // Immediate effects
        if (eventInst.type === 'heal_all') {
            this.addToLog(`Tutti recuperano ${eventInst.value} HP!`);
            Object.values(this.players).forEach(p => {
                if (p.state === 'alive') p.hp = Math.min(this.maxHp, p.hp + eventInst.value);
            });
        } else if (eventInst.duration > 0) {
            // Check if already active to not duplicate, or just push
            const existing = this.activeEvents.find(e => e.id === eventInst.id);
            if (!existing) {
                this.activeEvents.push(eventInst);
            } else {
                existing.duration = eventInst.duration; // Reset duration
            }
        }

        if (this.onFlashNews) this.onFlashNews(eventInst);
    }

    endTurn() {
        if (this.gameOver) return;

        if (this.isMultiplayer) {
            // Se è il turno di un giocatore che non è controllato dal client locale, ignora eventuali pass
            // In multiplayer, isHost === true corrisponde a player1, isHost === false corrisponde a player2
            if (this.players[this.turn].id !== this.localPlayerId) {
                console.log(`DEBUG: Turno di ${this.players[this.turn].name}, ma localPlayerId è ${this.localPlayerId}. In attesa.`);
            }
        }

        if (this.players[this.turn].status.immunity > 0) this.players[this.turn].status.immunity--;
        if (this.players[this.turn].status.directDamageImmunity > 0) this.players[this.turn].status.directDamageImmunity--;

        // Find next alive player
        do {
            this.turnIndex = (this.turnIndex + 1) % this.turnOrder.length;
            this.turn = this.turnOrder[this.turnIndex];
            if (this.turnIndex === 0) {
                this.gameRound++;
                this.handleRoundStart();
            }
        } while (this.players[this.turn].state === 'defeated' && !this.gameOver);

        const nextPlayer = this.players[this.turn];
        nextPlayer.potionsUsedThisTurn = 0;

        if (!this.gameOver && nextPlayer.potions.length < 2) {
            if (Math.random() < 0.15) {
                if (typeof POTIONS !== 'undefined') {
                    const randPotion = POTIONS[Math.floor(Math.random() * POTIONS.length)];
                    nextPlayer.potions.push(randPotion);
                    this.addToLog(`${nextPlayer.name} ha trovato una pozione: ${randPotion.name}!`);
                }
            }
        }

        if (nextPlayer.status.regen > 0) {
            nextPlayer.hp = Math.min(this.maxHp, nextPlayer.hp + 100);
            nextPlayer.status.regen--;
            this.addToLog(`${nextPlayer.name} recupera 100 HP dalla rigenerazione!`);
        }
        if (nextPlayer.status.reflectDamage) nextPlayer.status.reflectDamage = false;
        if (nextPlayer.status.debuffImmunity) nextPlayer.status.debuffImmunity = false;
        if (nextPlayer.status.extraPlays > 0) nextPlayer.status.extraPlays = 0;

        this.addToLog(`--- Turno di ${this.players[this.turn].name} ---`);

        if (this.players[this.turn].isAI && !this.gameOver) {
            setTimeout(() => {
                if (this.onAIThinking) this.onAIThinking(true);
                setTimeout(() => {
                    if (this.onAIThinking) this.onAIThinking(false);
                    this.aiPlay(this.turn);
                }, 2500);
            }, 1000);
        } else {
            if (this.onUpdate) this.onUpdate();
        }
    }

    aiPlay(playerId) {
        if (this.gameOver) return;
        const aiPlayer = this.players[playerId];
        if (aiPlayer.state === 'defeated') {
            this.endTurn();
            return;
        }

        if (aiPlayer.potions.length > 0 && aiPlayer.potionsUsedThisTurn === 0) {
            if (Math.random() < 0.5) {
                this.usePotion(playerId, 0);
            }
        }

        let potentialTargets = this.teams[aiPlayer.team === 'A' ? 'B' : 'A']
            .map(id => this.players[id])
            .filter(p => p.state === 'alive');

        if (potentialTargets.length > 0) {
            let target = potentialTargets.sort((a, b) => a.hp - b.hp)[0];
            if (aiPlayer.atk >= 250 || (aiPlayer.atk >= target.hp + target.def)) {
                setTimeout(() => {
                    this.executeAttack(aiPlayer.id, target.id);
                }, 800);
            }
        }

        let bestIndex = 0;
        let maxVal = -Infinity;

        aiPlayer.hand.forEach((card, index) => {
            // Discard unplayable special cards evaluation
            if (card.type === 'special' && this.activeEvents.some(e => e.type === 'cost_modifier' && e.target === 'special_cards')) {
                return; // skip evaluation
            }

            let val = card.value || 0;
            if (card.type === 'attack') val += 50;
            if (aiPlayer.hp < 300 && card.effect.life) val += 200;
            if (val > maxVal) {
                maxVal = val;
                bestIndex = index;
            }
        });

        if (maxVal === -Infinity) {
            // All cards are unplayable for AI -> Pass Turn
            this.addToLog(`${aiPlayer.name} non può giocare nessuna carta e passa il turno!`);
            this.endTurn();
            return;
        }

        let card = aiPlayer.hand[bestIndex];
        let targetId = this.getDefaultTarget(aiPlayer, card)?.id;
        this.playCard(playerId, bestIndex, targetId);
    }

    checkVictory() {
        const teamAAlive = this.teams['A'].some(id => this.players[id].state === 'alive');
        const teamBAlive = this.teams['B'].some(id => this.players[id].state === 'alive');

        if (!teamAAlive) {
            this.addToLog(`SCONFITTA! Il Team B ha vinto.`);
            this.gameOver = true;
        } else if (!teamBAlive) {
            this.addToLog(`VITTORIA! Il Team A ha vinto.`);
            this.gameOver = true;
        }
    }

    addToLog(msg) {
        this.log.push(msg);
        console.log(msg);
        if (this.onUpdate) this.onUpdate();
    }
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
    indicator: document.getElementById('turn-indicator'),
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

// --- CLOUD LOBBY FUNCTIONS ---
window.onLoginSubmit = function() {
    const name = elements.usernameInput.value.trim();
    if (!name) return alert("Inserisci un nome!");
    if (name.length < 3) return alert("Nome troppo corto!");
    window.loginUser(name);
};

window.loginUser = async function(name) {
    const playerRef = ref(db, 'players/' + name);
    try {
        const snapshot = await get(playerRef);
        if (!snapshot.exists()) {
            await set(playerRef, { win: 0, loss: 0 });
        }
        sessionStorage.setItem('username', name);
        elements.userDisplay.innerText = "Benvenuto, " + name;
        elements.loginScreen.classList.add('hidden');
        elements.lobbyContainer.classList.remove('hidden');
        window.syncLeaderboard();
    } catch (e) {
        console.error("Errore login:", e);
        alert("Errore di connessione al Cloud.");
    }
};

window.syncLeaderboard = function() {
    const playersRef = ref(db, 'players');
    onValue(playersRef, (snapshot) => {
        if (snapshot.exists()) {
            const players = snapshot.val();
            const sorted = Object.entries(players)
                .map(([name, stats]) => ({ name, ...stats }))
                .sort((a, b) => b.win - a.win);
            
            elements.leaderboardBody.innerHTML = sorted.map(p => `
                <tr>
                    <td>${p.name}</td>
                    <td style="color: var(--primary)">${p.win}</td>
                    <td style="color: var(--hp-color)">${p.loss}</td>
                </tr>
            `).join('');
        }
    });
};

window.logoutUser = function() {
    sessionStorage.removeItem('username');
    location.reload();
};

window.openOfflineSetup = function() {
    elements.lobbyContainer.classList.add('hidden');
    elements.setupOverlay.classList.add('show');
    window.showOfflineMenu();
};

window.openOnlineSetup = function() {
    elements.lobbyContainer.classList.add('hidden');
    elements.setupOverlay.classList.add('show');
    window.showOnlineMenu();
};

// Override startGame to show game container
const originalStartGame = window.startGame;
window.startGame = function(forcedMode = null) {
    elements.setupOverlay.classList.remove('show');
    elements.lobbyContainer.classList.add('hidden');
    elements.gameContainer.classList.remove('hidden');
    originalStartGame(forcedMode);
};

// Check session on start
window.addEventListener('load', () => {
    const savedName = sessionStorage.getItem('username');
    if (savedName) {
        window.loginUser(savedName);
    }
});

window.showLevel1 = function () {
    document.getElementById('level-1-menu').classList.remove('hidden');
    document.getElementById('level-2-menu').classList.add('hidden');
};

window.showOfflineMenu = function () {
    document.getElementById('level-1-menu').classList.add('hidden');
    document.getElementById('level-2-menu').classList.remove('hidden');
    document.getElementById('offline-setup').classList.remove('hidden');
    document.getElementById('online-setup').classList.add('hidden');
    document.getElementById('common-setup').classList.remove('hidden');
    document.getElementById('btn-start-offline').classList.remove('hidden');
    document.getElementById('mode-select').value = '1v1';
    window.toggleOfflineMode();
};

window.showOnlineMenu = function () {
    document.getElementById('level-1-menu').classList.add('hidden');
    document.getElementById('level-2-menu').classList.remove('hidden');
    document.getElementById('offline-setup').classList.add('hidden');
    document.getElementById('online-setup').classList.remove('hidden');
    document.getElementById('common-setup').classList.remove('hidden');
    document.getElementById('setup-p2').classList.add('hidden');
    document.getElementById('btn-start-offline').classList.add('hidden');
};

window.toggleOfflineMode = function () {
    const mode = document.getElementById('mode-select').value;
    if (mode === '2v2') {
        document.getElementById('setup-p2').classList.remove('hidden');
    } else {
        document.getElementById('setup-p2').classList.add('hidden');
    }
};

const randomPers = () => {
    const p = ["Secchione", "Disperato", "Caotico", "Raccomandato", ""];
    return p[Math.floor(Math.random() * p.length)];
};

window.onCreateRoom = async function () {
    if (typeof AudioManager !== 'undefined') AudioManager.unblock();
    elements.roomStatus.innerText = "Creazione stanza...";

    const p1Pers = document.getElementById('p1-pers').value;
    const personalities = { player1: p1Pers, player2: randomPers() };

    game = new Game(CARDS, '1v1', personalities, true);
    game.localPlayerId = 'player1';

    const roomCode = await createRoom(game.getSerializableState(), (newState) => {
        game.loadState(newState);
        updateUI();
        if (newState.players.player2.name !== 'Giocatore 2') {
            elements.roomStatus.innerText = "Avversario connesso! Inizio...";
            setTimeout(() => startGame('multiplayer'), 1000);
        }
    });

    elements.roomCodeInput.value = roomCode;
    elements.roomStatus.innerText = "Stanza creata! Attendi l'avversario...";
}

window.onJoinRoom = async function () {
    if (typeof AudioManager !== 'undefined') AudioManager.unblock();
    const code = elements.roomCodeInput.value.trim().toUpperCase();
    if (!code) return;

    elements.roomStatus.innerText = "Connessione...";

    const p2Pers = document.getElementById('p1-pers').value;
    game = new Game(CARDS, '1v1', {}, true);
    game.localPlayerId = 'player2';

    const success = await joinRoom(code, (newState) => {
        game.loadState(newState);
        updateUI();
    });

    if (success) {
        // Update our personality
        game.players.player2.name = "Sfidante";
        game.players.player2.personality = p2Pers;
        await updateGameState(game.getSerializableState());

        elements.roomStatus.innerText = "Connesso!";
        setTimeout(() => startGame('multiplayer'), 1000);
    } else {
        elements.roomStatus.innerText = "Stanza non trovata!";
    }
}

window.startGame = function (forcedMode = null) {
    // SBLOCCO AUDIO (MODULO DEDICATO)
    if (typeof AudioManager !== 'undefined') AudioManager.unblock();

    const mode = forcedMode || document.getElementById('mode-select').value;

    if (mode !== 'multiplayer' && !game) {
        const p1Pers = document.getElementById('p1-pers').value;
        const p2Pers = document.getElementById('p2-pers').value;

        const personalities = {
            player1: p1Pers,
            player2: mode === '1v1' ? randomPers() : p2Pers,
            player3: randomPers(),
            player4: randomPers()
        };
        game = new Game(CARDS, mode, personalities, false);
    }

    document.body.classList.remove('mode-1v1', 'mode-2v2');
    document.body.classList.add(mode === 'multiplayer' ? 'mode-1v1' : 'mode-' + mode);

    if (window.AudioManager) {
        window.AudioManager.startBGM();
    }

    game.onUpdate = updateUI;
    game.onCardDraw = animateCardDraw;
    game.onAnimation = playActionAnimation;
    game.onParticle = spawnDamageParticles;
    game.onFlashNews = (evt) => {
        const banner = document.getElementById('flash-news-banner');
        banner.innerText = `FLASH NEWS: ${evt.name}`;
        banner.classList.add('show');
        applyShake(8);
        setTimeout(() => banner.classList.remove('show'), 2500);
    };
    game.onAIThinking = (isThinking) => {
    };

    elements.setupOverlay.classList.remove('show');
    updateUI();
}

function buildScoreboard() {
    elements.scoreboard.innerHTML = '';

    // For 1v1: P1 left, P2 right
    // For 2v2: P1, P2 left, P3, P4 right
    const teamAdiv = document.createElement('div');
    teamAdiv.className = 'team-stats team-a';
    const teamBdiv = document.createElement('div');
    teamBdiv.className = 'team-stats team-b';

    Object.values(game.players).forEach(p => {
        const isTargetable = targetingMode && p.state === 'alive';
        let validTarget = false;

        if (targetingMode && !game.players[game.turn].isAI) {
            const activePlayer = game.players[game.turn];
            if (typeof targetingAttack !== 'undefined' && targetingAttack) {
                validTarget = p.team !== activePlayer.team;
            } else if (selectedCardIndex !== null) {
                const card = activePlayer.hand[selectedCardIndex];
                if (card) {
                    if (card.targetType === 'ally' || card.targetType === 'self' || card.effect.atk || card.effect.atkMultiplier || card.effect.nextAtkMultiplier || card.effect.lowLifeAtk) validTarget = p.team === activePlayer.team;
                    else if (card.targetType === 'enemy') validTarget = p.team !== activePlayer.team;
                    else validTarget = true;
                }
            }
        }

        let debuffClasses = '';
        if (p.status.stunned > 0 || (game.activeEvents && game.activeEvents.some(e => e.type === 'cost_modifier'))) debuffClasses += ' status-stunned';
        // Anxiety applies when nextAtk > 1 or def is broken and hp low
        if (p.status.nextAtkMultiplier > 1 || (p.def <= 0 && p.hp < 300)) debuffClasses += ' status-anxiety';
        if (p.status.immunity > 0) debuffClasses += ' status-immune';

        let stunIcon = p.status.stunned > 0 ? '💫 ' : '';

        const str = `
                    <div class="player-stats ${p.team === 'B' ? 'opponent' : ''} ${p.state === 'defeated' ? 'defeated' : ''} ${validTarget ? 'valid-target' : ''}${debuffClasses}" 
                         id="stats-${p.id}" onclick="onTargetClicked('${p.id}')">
                        <div class="stat-row" style="display: flex; justify-content: space-between; align-items: center; gap: 5px;">
                            <span class="label" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${p.name} ${p.personality ? '(' + p.personality + ')' : ''}">${stunIcon}${p.name} ${p.personality ? '(' + p.personality + ')' : ''}</span>
                            <span class="label" style="white-space: nowrap; flex-shrink: 0;">🧪 x${p.potions ? p.potions.length : 0}</span>
                        </div>
                        <div class="stat-row">
                            <div class="value">${Math.max(0, Math.floor(p.hp))} HP</div>
                            <div class="progress-bar-bg">
                                <div class="progress-bar hp-bar" style="width: ${(Math.max(0, p.hp) / game.maxHp) * 100}%"></div>
                            </div>
                        </div>
                        <div style="display: flex; gap: 20px; margin-top: 10px;">
                            ${p.team === 'A' ? `
                            <div style="flex: 1"><span class="label">ATK</span><div class="value">${Math.floor(p.atk)}</div><div class="progress-bar-bg"><div class="progress-bar atk-bar" style="width: ${Math.min(100, (p.atk / 500) * 100)}%"></div></div></div>
                            <div style="flex: 1"><span class="label">DEF</span><div class="value">${Math.floor(p.def)}</div><div class="progress-bar-bg"><div class="progress-bar def-bar" style="width: ${Math.min(100, (p.def / 500) * 100)}%"></div></div></div>
                            ` : `
                            <div style="flex: 1"><span class="label">DEF</span><div class="value">${Math.floor(p.def)}</div><div class="progress-bar-bg"><div class="progress-bar def-bar" style="width: ${Math.min(100, (p.def / 500) * 100)}%"></div></div></div>
                            <div style="flex: 1"><span class="label">ATK</span><div class="value">${Math.floor(p.atk)}</div><div class="progress-bar-bg"><div class="progress-bar atk-bar" style="width: ${Math.min(100, (p.atk / 500) * 100)}%"></div></div></div>
                            `}
                        </div>
                    </div>
                `;

        if (p.team === 'A') teamAdiv.innerHTML += str;
        else teamBdiv.innerHTML += str;
    });

    elements.scoreboard.appendChild(teamAdiv);
    elements.scoreboard.appendChild(teamBdiv);
}

function buildArena() {
    elements.playedCardsArea.innerHTML = '';

    // Team A cards
    game.teams['A'].forEach(id => {
        const p = game.players[id];
        if (p.lastPlayedCard) {
            const el = createCardElement(p.lastPlayedCard, false, false);
            el.classList.add('played-card-slot');
            elements.playedCardsArea.appendChild(el);
        } else {
            const el = document.createElement('div');
            el.className = 'played-card-slot';
            elements.playedCardsArea.appendChild(el);
        }
    });

    const vs = document.createElement('div');
    vs.className = "vs-divider";
    vs.innerText = "VS";
    elements.playedCardsArea.appendChild(vs);

    // Team B cards
    game.teams['B'].forEach(id => {
        const p = game.players[id];
        if (p.lastPlayedCard) {
            const el = createCardElement(p.lastPlayedCard, false, false);
            el.classList.add('played-card-slot');
            elements.playedCardsArea.appendChild(el);
        } else {
            const el = document.createElement('div');
            el.className = 'played-card-slot';
            elements.playedCardsArea.appendChild(el);
        }
    });
}

function updateUI() {
    if (!game) return;
    const activePlayer = game.players[game.turn];

    if (window.AudioManager) {
        window.AudioManager.updateBGM(game.players, game.maxHp);
    }

    elements.deckCount.innerText = game.sharedDeck.length;

    buildScoreboard();
    buildArena();

    // Setup Indicator
    if (targetingMode) {
        elements.indicator.innerText = "Seleziona Bersaglio!";
        elements.indicator.style.color = "var(--accent)";
    } else {
        if (game.isMultiplayer) {
            if (game.turn !== game.localPlayerId) {
                elements.indicator.innerText = `Turno dell'Avversario (${activePlayer.name})`;
                elements.indicator.style.color = 'var(--secondary)';
            } else {
                elements.indicator.innerText = `Tuo Turno (${activePlayer.name})`;
                elements.indicator.style.color = 'var(--primary)';
            }
        } else {
            elements.indicator.innerText = activePlayer.isAI ? `Turno di ${activePlayer.name}` : `Tuo Turno (${activePlayer.name})`;
            elements.indicator.style.color = activePlayer.isAI ? 'var(--secondary)' : 'var(--primary)';
        }
    }

    // Log
    elements.log.innerHTML = game.log.slice().reverse().map(msg => `<div class="log-entry">${msg}</div>`).join('');

    // Attack button
    const btnAttack = document.getElementById('btn-attack');
    if (btnAttack) {
        if (!activePlayer.isAI && activePlayer.atk > 0 && !targetingMode && (!game.isMultiplayer || game.turn === game.localPlayerId)) {
            btnAttack.style.display = 'flex';
        } else {
            btnAttack.style.display = 'none';
        }
    }

    // Pass button
    const btnPass = document.getElementById('btn-pass');
    if (btnPass) {
        if (!activePlayer.isAI && !targetingMode && (!game.isMultiplayer || game.turn === game.localPlayerId)) {
            btnPass.style.display = 'flex';
        } else {
            btnPass.style.display = 'none';
        }
    }

    // Hands
    renderHands(activePlayer);
    renderPotions(activePlayer);

    // Victory
    if (game.gameOver) {
        elements.victoryText.innerHTML = game.teams['A'].some(id => game.players[id].hp > 0)
            ? `VITTORIA DEL TEAM A!`
            : `VITTORIA DEL TEAM B!`;
        elements.overlay.classList.add('show');
    }
}

function createCardElement(card, interactive = true, hidden = false, index = null) {
    const div = document.createElement('div');
    div.className = `card ${card.type || ''} ${hidden ? 'hidden' : ''} ${selectedCardIndex === index ? 'selected' : ''}`;

    if (!hidden && card.name) {
        const icon = card.type === 'attack' ? '⚔' : (card.type === 'defense' ? '🛡' : '🎲');
        const encodedName = encodeURIComponent(card.name);
        const imageUrl = `https://api.dicebear.com/7.x/bottts/svg?seed=${encodedName}&backgroundColor=transparent`;

        div.innerHTML = `
                    <div class="card-image-container"><img src="${imageUrl}" alt="" class="card-image"></div>
                    <div class="card-name">${card.name}</div>
                    <div class="card-desc">${card.description}</div>
                    <div class="card-type-icon">${icon}</div>
                `;
    }

    if (interactive && !hidden && index !== null) {
        div.onclick = () => onCardClicked(index);
        const rot = (Math.random() * 6) - 3;
        div.style.transform = `rotate(${rot}deg)`;
    }

    return div;
}

function renderHands(activePlayer) {
    elements.hand.innerHTML = '';
    elements.oppHand.innerHTML = '';

    // Only show hand if it's a human's turn. Otherwise show generic back cards for P1 to look at while waiting
    if (!activePlayer.isAI) {
        activePlayer.hand.forEach((card, index) => {
            elements.hand.appendChild(createCardElement(card, true, false, index));
        });
    } else {
        game.players.player1.hand.forEach((card) => {
            elements.hand.appendChild(createCardElement(card, false, false, null));
        });
    }

    // Opponent Hand visually (carte coperte con classe 'back')
    let aiHandCount = 0;
    game.teams['B'].forEach(id => aiHandCount += game.players[id].hand.length);
    for (let i = 0; i < Math.min(5, aiHandCount); i++) {
        const div = document.createElement('div');
        div.className = 'card back';
        elements.oppHand.appendChild(div);
    }
}

function createPotionElement(potion, index, interactive = true) {
    const div = document.createElement('div');
    div.className = `potion`;
    div.innerHTML = `
                <div class="potion-image">🧪</div>
                <div class="potion-name">${potion.name}</div>
                <div class="potion-desc">${potion.description}</div>
            `;
    if (interactive && index !== null) {
        div.onclick = () => onPotionClicked(index);
    }
    return div;
}

function renderPotions(activePlayer) {
    if (!elements.potions) return;
    elements.potions.innerHTML = '';

    if (!activePlayer.isAI) {
        if (activePlayer.potionsUsedThisTurn >= 2) {
            const msg = document.createElement('div');
            msg.style = "color: var(--accent); font-size: 0.7rem; font-weight: 800; margin-bottom: 5px; text-transform: uppercase;";
            msg.innerText = "⚠️ Limite pozioni raggiunto";
            elements.potions.appendChild(msg);
        }

        activePlayer.potions.forEach((potion, index) => {
            const interactive = activePlayer.potionsUsedThisTurn < 2;
            const el = createPotionElement(potion, index, interactive);
            if (!interactive) el.classList.add('disabled-potion');
            elements.potions.appendChild(el);
        });
    }
}

window.onPotionClicked = function (index) {
    if (game.gameOver || game.players[game.turn].isAI) return;
    if (game.isMultiplayer && game.turn !== game.localPlayerId) return;

    game.usePotion(game.turn, index);
    if (game.isMultiplayer) updateGameState(game.getSerializableState());
    updateUI();
}

window.onCardClicked = function (index) {
    const activePlayer = game.players[game.turn];
    if (activePlayer.isAI || game.gameOver) return;
    if (game.isMultiplayer && game.turn !== game.localPlayerId) return;

    const card = activePlayer.hand[index];
    if (card && card.type === 'special' && game.activeEvents.some(e => e.type === 'cost_modifier' && e.target === 'special_cards')) {
        const conf = confirm(`Costo aumentato (Ispezione Ministeriale): Non puoi giocare ${card.name}. Vuoi confermare e passare il turno rinunciando a questa carta?`);
        if (conf) {
            game.addToLog(`${activePlayer.name} dichiara impossibilità e passa il turno!`);
            game.endTurn();
            if (game.isMultiplayer) updateGameState(game.getSerializableState());
            updateUI();
        }
        return;
    }

    if (targetingMode) {
        if (targetingAttack) {
            targetingMode = false;
            targetingAttack = false;
            updateUI();
            return;
        }
        if (selectedCardIndex === index) {
            targetingMode = false;
            selectedCardIndex = null;
            updateUI();
            return;
        }
    }

    if (game.gameMode === '2v2') {
        selectedCardIndex = index;
        targetingMode = true;
        updateUI();
    } else {
        game.playCard(game.turn, index);
        if (game.isMultiplayer) updateGameState(game.getSerializableState());
    }
}

window.onAttackClicked = function () {
    if (game.gameOver || game.players[game.turn].isAI) return;
    if (game.isMultiplayer && game.turn !== game.localPlayerId) return;
    const activePlayer = game.players[game.turn];
    if (activePlayer.atk <= 0) return;

    if (game.gameMode === '1v1' || game.isMultiplayer) {
        const targetId = game.teams['B'][0]; // in 1v1 it's just the other
        // If localPlayer is B, the other is A
        const actualTargetId = game.localPlayerId === 'player1' ? game.teams['B'][0] : game.teams['A'][0];
        game.executeAttack(game.turn, actualTargetId);
        if (game.isMultiplayer) updateGameState(game.getSerializableState());
    } else {
        targetingMode = true;
        targetingAttack = true;
        updateUI();
    }
}

window.onPassClicked = function () {
    if (game.gameOver || game.players[game.turn].isAI) return;
    if (game.isMultiplayer && game.turn !== game.localPlayerId) return;
    const activePlayer = game.players[game.turn];
    game.addToLog(`${activePlayer.name} dichiara che non può giocare carte e passa il turno!`);

    targetingMode = false;
    targetingAttack = false;
    game.endTurn();
    if (game.isMultiplayer) updateGameState(game.getSerializableState());
    updateUI();
}

window.onTargetClicked = function (targetId) {
    if (!targetingMode) return;
    const activePlayer = game.players[game.turn];
    if (game.players[targetId].state === 'defeated') return;

    if (typeof targetingAttack !== 'undefined' && targetingAttack) {
        if (game.players[targetId].team === activePlayer.team) {
            document.getElementById(`stats-${targetId}`).style.animation = "shake 0.3s";
            setTimeout(() => document.getElementById(`stats-${targetId}`).style.animation = "", 300);
            return;
        }
        targetingMode = false;
        targetingAttack = false;
        game.executeAttack(game.turn, targetId);
        return;
    }

    if (selectedCardIndex === null) return;
    const card = activePlayer.hand[selectedCardIndex];

    if (game.players[targetId].state === 'defeated') return;

    let valid = false;
    if (card.targetType === 'ally' || card.targetType === 'self' || card.effect.atk || card.effect.atkMultiplier || card.effect.nextAtkMultiplier || card.effect.lowLifeAtk) {
        valid = game.players[targetId].team === activePlayer.team;
    } else if (card.targetType === 'enemy') {
        valid = game.players[targetId].team !== activePlayer.team;
    } else {
        valid = true; // 'any'
    }

    if (valid) {
        let cardIndexToPlay = selectedCardIndex;
        targetingMode = false;
        selectedCardIndex = null;
        game.playCard(game.turn, cardIndexToPlay, targetId);
    } else {
        document.getElementById(`stats-${targetId}`).style.animation = "shake 0.3s";
        setTimeout(() => document.getElementById(`stats-${targetId}`).style.animation = "", 300);
    }
}

let drawQueueOffset = 0;
let drawTimeout = null;
function animateCardDraw(playerId, card) {
    const tempCard = document.createElement('div');
    tempCard.className = 'temp-draw-card';
    if (drawQueueOffset > 0) tempCard.style.visibility = 'hidden';
    document.querySelector('.arena').appendChild(tempCard);

    const isTeamA = game.players[playerId].team === 'A';
    const animName = isTeamA ? 'draw-to-p1' : 'draw-to-p2';

    setTimeout(() => {
        if (document.body.contains(tempCard)) {
            tempCard.style.visibility = 'visible';
            tempCard.style.animation = `${animName} 0.8s cubic-bezier(0.19, 1, 0.22, 1) forwards`;
        }
    }, drawQueueOffset);

    setTimeout(() => {
        if (document.body.contains(tempCard)) tempCard.remove();
        if (game) updateUI();
    }, 800 + drawQueueOffset);

    drawQueueOffset += 150;
    clearTimeout(drawTimeout);
    drawTimeout = setTimeout(() => { drawQueueOffset = 0; }, 200);
}

function playActionAnimation(type, sourceId, targetId) {
    const startX = window.innerWidth / 2;
    const startY = window.innerHeight / 2;
    const targetEl = document.getElementById(`stats-${targetId}`);
    if (!targetEl) return;

    const tRect = targetEl.getBoundingClientRect();
    const endX = tRect.left + tRect.width / 2;
    const endY = tRect.top + tRect.height / 2;

    const icon = document.createElement('div');
    icon.className = 'floating-icon';
    icon.innerHTML = type === 'sword' ? '🗡️' : '🛡️';
    icon.style.left = `${startX}px`;
    icon.style.top = `${startY}px`;

    const dx = endX - startX;
    const dy = endY - startY;

    let angle = type === 'sword' ? Math.atan2(dy, dx) * 180 / Math.PI + 45 : 0;
    document.body.appendChild(icon);

    icon.animate([
        { transform: `translate(-50%, -50%) scale(0.1) rotate(${angle}deg)`, opacity: 0, offset: 0 },
        { transform: `translate(-50%, -50%) scale(1.5) rotate(${angle}deg)`, opacity: 1, offset: 0.2 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1.2) rotate(${angle}deg)`, opacity: 1, offset: 0.8 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.1) rotate(${angle}deg)`, opacity: 0, offset: 1 }
    ], { duration: 700, easing: 'ease-in-out' }).onfinish = () => icon.remove();
}

function applyShake(intensity) {
    const container = document.querySelector('.game-container');
    if (container) {
        container.classList.remove('shake-effect');
        void container.offsetWidth; // trigger reflow
        container.classList.add('shake-effect');
        setTimeout(() => container.classList.remove('shake-effect'), 500);
    }
}

function spawnDamageParticles(targetId) {
    const targetEl = document.getElementById(`stats-${targetId}`);
    if (!targetEl) return;
    applyShake(10);
    const rect = targetEl.getBoundingClientRect();
    // Limit explicitly to 12 particles
    for (let i = 0; i < 12; i++) {
        const p = document.createElement('div');
        p.className = 'frammento';
        p.style.left = rect.left + rect.width / 2 + 'px';
        p.style.top = rect.top + rect.height / 2 + 'px';
        document.body.appendChild(p);

        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 80 + 20;
        const tx = Math.cos(angle) * speed;
        const ty = Math.sin(angle) * speed;

        p.animate([
            { transform: `translate(-50%, -50%)`, opacity: 1 },
            { transform: `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) rotate(${Math.random() * 360}deg)`, opacity: 0 }
        ], { duration: 500, easing: 'ease-out' }).onfinish = () => p.remove();
    }
}
