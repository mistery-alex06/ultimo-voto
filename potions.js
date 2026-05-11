export const POTIONS = [
    {
        name: "Caffè Forte",
        description: "Aumenta moderatamente l'attacco",
        effect: (player, game) => { player.atk += 100; return "Aumenta Attacco"; }
    },
    {
        name: "Camomilla",
        description: "Aumenta significativamente la difesa",
        effect: (player, game) => { player.def += 150; return "Aumenta Difesa"; }
    },
    {
        name: "Energy Drink",
        description: "Permette di giocare una carta extra nel turno",
        effect: (player, game) => { player.status.extraPlays = (player.status.extraPlays || 0) + 1; return "Azione Extra"; }
    },
    {
        name: "Shot di Ansia",
        description: "Aumenta molto l'attacco ma riduce la difesa",
        effect: (player, game) => { player.atk += 200; player.def = Math.max(0, player.def - 100); return "Alto Rischio"; }
    },
    {
        name: "Multivitaminico",
        description: "Aumenta attacco e difesa in modo bilanciato",
        effect: (player, game) => { player.atk += 100; player.def += 100; return "Bilanciato"; }
    },
    {
        name: "Pozione di Recupero",
        description: "Cura una quantità media di vita",
        effect: (player, game) => { player.hp = Math.min(3500, player.hp + 300); return "Cura 300 HP"; }
    },
    {
        name: "Focus Totale",
        description: "Potenzia il prossimo attacco",
        effect: (player, game) => { player.status.nextAtkMultiplier *= 2; return "x2 Prossimo Attacco"; }
    },
    {
        name: "Difesa Reattiva",
        description: "Aumenta difesa e riflette parte del prossimo danno",
        effect: (player, game) => { player.def += 100; player.status.reflectDamage = true; return "Difesa e Rifletti"; }
    },
    {
        name: "Scommessa",
        description: "Grande bonus attacco oppure perdita di vita (casuale)",
        effect: (player, game) => {
            if (Math.random() < 0.5) { player.atk += 300; return "Successo! +300 ATK"; }
            else { player.hp -= 200; return "Fallimento! -200 HP"; }
        }
    },
    {
        name: "Reset Mentale",
        description: "Rimuove penalità o effetti negativi attivi",
        effect: (player, game) => {
            player.status.stunned = 0;
            if (player.status.nextAtkMultiplier < 1) player.status.nextAtkMultiplier = 1;
            if (player.status.damageReduction > 1) player.status.damageReduction = 1;
            return "Debuff Rimossi";
        }
    },
    {
        name: "Adrenalina",
        description: "Forte bonus attacco solo se la vita è bassa",
        effect: (player, game) => {
            if (player.hp <= 300) { player.atk += 250; return "Adrenalina Attiva! +250 ATK"; }
            return "Nessun effetto (Vita troppo alta)";
        }
    },
    {
        name: "Scudo Temporaneo",
        description: "Riduce i danni subiti per un turno",
        effect: (player, game) => { player.status.damageReduction = 0.5; return "Danni Dimezzati"; }
    },
    {
        name: "Copia Effetto",
        description: "Ripete l'ultimo effetto utilizzato in partita",
        effect: (player, game) => {
            if (game.lastCardPlayed) {
                game.applyEffect(player, game.getDefaultTarget(player, game.lastCardPlayed), game.lastCardPlayed, 1);
                return `Copiato: ${game.lastCardPlayed.name}`;
            }
            return "Nessuna carta da copiare";
        }
    },
    {
        name: "Contromossa",
        description: "Blocca il prossimo attacco ricevuto",
        effect: (player, game) => { player.status.immunity = 1; return "Immunità al prossimo attacco"; }
    },
    {
        name: "Boost Equilibrato",
        description: "Aumenta attacco e difesa ma costa un po’ di vita",
        effect: (player, game) => { player.hp -= 100; player.atk += 150; player.def += 150; return "-100 HP, +150 ATK/DEF"; }
    },
    {
        name: "Recupero Lento",
        description: "Cura gradualmente per più turni",
        effect: (player, game) => { player.status.regen = 3; return "Rigenerazione Attivata"; }
    },
    {
        name: "Colpo Mirato",
        description: "Il prossimo attacco ignora la difesa",
        effect: (player, game) => { player.status.ignoreDefense = true; return "Prossimo attacco Ignota Difesa"; }
    },
    {
        name: "Stabilità",
        description: "Aumenta la difesa e protegge da debuff",
        effect: (player, game) => { player.def += 150; player.status.debuffImmunity = true; return "+150 DEF, Immunità Debuff"; }
    },
    {
        name: "Rischio Calcolato",
        description: "Aumenta attacco e leggermente il moltiplicatore del prossimo colpo",
        effect: (player, game) => { player.atk += 100; player.status.nextAtkMultiplier *= 1.5; return "+100 ATK, x1.5 Danno"; }
    },
    {
        name: "Ultima Chance",
        description: "Se la vita è molto bassa, cura in modo significativo",
        effect: (player, game) => {
            if (player.hp <= 200) { player.hp = Math.min(3500, player.hp + 500); return "Cura Critica! +500 HP"; }
            return "Nessun effetto (Vita non critica)";
        }
    }
];

