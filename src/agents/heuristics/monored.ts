// Mono-Red Aggro heuristics for the greedy agent (PLAN.md section 8, Phase 2; section 3 card
// notes). Hand-written rules of thumb, not solved play:
//  - curve out: deploying creatures on the agent's own turn is worth a little extra;
//  - attack when the race favors it (the agent kills first on the current board);
//  - burn face only when the opponent is within two turns of dying, otherwise burn blockers;
//  - hold Monstrous Rage for a blocked creature, a creature being burned, or lethal;
//  - Kumano Faces Kakkazan on turn 1.
import type { CardTables, MoveCtx, Profile } from '../evaluate.js';
import { expectedDamage, other, ownTurns, summarize } from '../evaluate.js';
import { characteristics } from '../../engine/statics.js';
import { getDef } from '../../cards/index.js';
import type { DefId, GameState, ObjId } from '../../engine/types.js';

export const MONORED_CARDS: CardTables = {
  permanent: {
    'screaming-nemesis': 2,
    'emberheart-challenger': 0.8,
    'soul-scar-mage': 0.3,
    'sunspine-lynx': 0.3,
    'kumano-faces-kakkazan': 1,
    'kumano-faces-kakkazan#1': 0.5,
    'the-legend-of-roku': 1.5,
    'the-legend-of-roku#1': 3,
    'mutavault': 0.3,
    'den-of-the-bugbear': 0.3,
    'ramunap-ruins': 0.3,
    'sokenzan-crucible-of-defiance': 0.3,
    'token-monster-role': 0,
    'token-goblin': 0,
    'token-dragon': 1,
    'magebane-lizard': 0.5,
    'weathered-runestone': 0.5,
  },
  hand: {
    'monastery-swiftspear': 1.8, 'soul-scar-mage': 1.6, 'emberheart-challenger': 2.2, 'sunspine-lynx': 2.0,
    'screaming-nemesis': 3.0, 'kumano-faces-kakkazan': 2.0, 'the-legend-of-roku': 2.0, 'burst-lightning': 1.8,
    'monstrous-rage': 1.6, 'reckless-rage': 2.0, 'magebane-lizard': 1.8, 'pyroclasm': 2.0, 'redcap-melee': 1.4,
    'flowstone-infusion': 1.4, 'scorching-shot': 1.6, 'weathered-runestone': 1.2,
  },
  // Mono-Red has no discard; kept for symmetry (cards of the Rakdos list it would most like gone).
  threat: {
    'sheoldred-the-apocalypse': 5, 'fable-of-the-mirror-breaker': 4, 'fatal-push': 2.5, 'go-for-the-throat': 2.5,
    'bloodtithe-harvester': 3, 'liliana-of-the-veil': 3,
  },
};

function defOf(state: GameState, id: ObjId): DefId | undefined {
  return state.objects[id]?.defId;
}

function isCreatureCard(defId: DefId): boolean {
  return getDef(defId).faces[0]?.types.includes('Creature') ?? false;
}

export const MONORED: Profile = {
  name: 'monored',
  lifeSelf: 0.6,
  lifeOpp: 1.0,
  race: 1.0,
  signature: ['monastery-swiftspear', 'soul-scar-mage', 'burst-lightning', 'monstrous-rage', 'kumano-faces-kakkazan', 'screaming-nemesis'],
  cards: MONORED_CARDS,

  reserve() {
    return 0;
  },

  stateBonus() {
    return 0;
  },

  moveBonus(ctx: MoveCtx) {
    const { before, move, me } = ctx;
    const opp = other(me);
    let b = 0;
    if (move.type === 'cast') {
      const d = defOf(before, move.objId);
      if (!d) return 0;
      // Curve out.
      if (before.activePlayer === me && isCreatureCard(d)) b += 0.5;
      // Kumano on turn 1.
      if (d === 'kumano-faces-kakkazan') b += ownTurns(before, me) <= 1 ? 2.5 : ownTurns(before, me) <= 2 ? 1 : 0;
      // Burn face only when lethal is within two turns.
      if (d === 'burst-lightning' && move.targets[0]?.kind === 'player' && move.targets[0].p === opp) {
        const dmg = move.kicked ? 4 : 2;
        const oppLife = before.players[opp].life;
        const clock = expectedDamage(summarize(before, MONORED_CARDS), me);
        b += oppLife - dmg <= 0 ? 5 : oppLife - dmg <= 2 * clock ? 1.5 : -2;
      }
      // Monstrous Rage: only on a blocked creature, one being burned, or for lethal.
      if (d === 'monstrous-rage') {
        const t = move.targets[0];
        const tid = t?.kind === 'obj' ? t.id : undefined;
        const tgt = tid !== undefined ? before.objects[tid] : undefined;
        let good = false;
        if (tgt && tgt.controller === me) {
          if (tgt.attacking && tgt.blocked) good = true;
          const burned = before.zones.stack.some((s) => s.controller === opp && s.targets.some((x) => x.kind === 'obj' && x.id === tid));
          if (burned) good = true;
          if (tgt.attacking && !tgt.blocked && before.step !== 'declareAttackers') {
            let unblocked = 0;
            for (const id of before.zones.battlefield) {
              const o = before.objects[id];
              if (o?.attacking && !o.blocked && o.controller === me) unblocked += Math.max(0, characteristics(before, id).power);
            }
            if (unblocked + 3 >= before.players[opp].life) good = true;
          }
        }
        b += good ? 1 : -3;
      }
    }
    if (move.type === 'declareAttackers' && move.assignments.length > 0) {
      // Attack when the race favors it: we kill first on the current board.
      const sum = summarize(before, MONORED_CARDS);
      const ttkOpp = before.players[opp].life / Math.max(expectedDamage(sum, me), 0.5);
      const ttkMe = before.players[me].life / Math.max(expectedDamage(sum, opp), 0.5);
      if (ttkOpp <= ttkMe) {
        let atPlayer = 0;
        for (const [id, d] of move.assignments) if (d.kind === 'player') atPlayer += Math.max(0, characteristics(before, id).power);
        b += 0.3 * atPlayer;
      }
    }
    return b;
  },
};

