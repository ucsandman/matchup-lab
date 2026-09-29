// Rakdos Midrange heuristics for the greedy agent (PLAN.md section 8, Phase 2; section 3 card
// notes). Hand-written rules of thumb, not solved play:
//  - hold up instant removal when the opponent has threats on the board or cards to deploy;
//  - Thoughtseize and Duress early (own turns 1 to 3), and take the most dangerous card;
//  - Fable of the Mirror-Breaker and Sheoldred first when they can be cast;
//  - Blood Crypt: pay 2 life only when the untapped land casts something this turn;
//  - do not chump block with Bloodtithe Harvester unless the damage would be lethal.
import type { CardTables, MoveCtx, Profile } from '../evaluate.js';
import { other, ownTurns, summarize } from '../evaluate.js';
import { characteristics, TYPE } from '../../engine/statics.js';
import { getDef } from '../../cards/index.js';
import { parseMana, manaValueOf } from '../../engine/cost.js';
import { applyMove } from '../../engine/apply.js';
import { legalMoves } from '../../engine/moves.js';
import type { DefId, GameState, ObjId, PlayerId } from '../../engine/types.js';

export const RAKDOS_CARDS: CardTables = {
  permanent: {
    'sheoldred-the-apocalypse': 5,
    'fable-of-the-mirror-breaker': 3.5,
    'fable-of-the-mirror-breaker#1': 3,
    'token-goblin-shaman': 0.5,
    'token-blood': 0.5,
    'token-treasure': 0.8,
    'bloodtithe-harvester': 0.5,
    'graveyard-trespasser': 0.8,
    'unholy-annex': 1.5,
    'reckoner-bankbuster': 1.5,
    'mutavault': 0.3,
    'castle-locthwain': 0.4,
    'hive-of-the-eye-tyrant': 0.3,
    'takenuma-abandoned-mire': 0.2,
    'kalitas-traitor-of-ghet': 1.5,
    'token-zombie': 0,
    'token-demon': 1,
  },
  hand: {
    'thoughtseize': 1.2, 'duress': 1.0, 'fatal-push': 2.2, 'go-for-the-throat': 2.4, 'bitter-triumph': 2.2,
    'abrade': 2.0, 'bloodtithe-harvester': 2.2, 'sheoldred-the-apocalypse': 3.5, 'fable-of-the-mirror-breaker': 3.5,
    'gifted-aetherborn': 2.0, 'graveyard-trespasser': 2.2, 'fear-of-missing-out': 1.8, 'bonecrusher-giant': 2.4,
    'unholy-annex': 2.0, 'liliana-of-the-veil': 2.5, 'kalitas-traitor-of-ghet': 2.6, 'invoke-despair': 2.4,
    'extinction-event': 2.2, 'go-blank': 1.6, 'hidetsugu-consumes-all': 2.2, 'reckoner-bankbuster': 2.0,
    'ray-of-enfeeblement': 1.6, 'torch-the-tower': 1.8, 'unlicensed-hearse': 1.6,
  },
  // Discard targets in the Mono-Red list (and its sideboard).
  threat: {
    'screaming-nemesis': 4, 'emberheart-challenger': 3.5, 'sunspine-lynx': 3, 'kumano-faces-kakkazan': 3,
    'the-legend-of-roku': 3, 'reckless-rage': 2.8, 'monstrous-rage': 2.5, 'burst-lightning': 2.5,
    'soul-scar-mage': 2.5, 'monastery-swiftspear': 2.5, 'magebane-lizard': 2.5, 'pyroclasm': 3, 'redcap-melee': 2,
    'flowstone-infusion': 2, 'scorching-shot': 2.2, 'weathered-runestone': 1.5,
  },
};

const REMOVAL: ReadonlySet<DefId> = new Set(['fatal-push', 'go-for-the-throat', 'bitter-triumph', 'abrade']);
const DISCARD: ReadonlySet<DefId> = new Set(['thoughtseize', 'duress']);

function cheapestHeldRemoval(state: GameState, me: PlayerId): number {
  let best = Infinity;
  for (const id of state.zones.hand[me]) {
    const o = state.objects[id];
    if (!o || !REMOVAL.has(o.defId)) continue;
    best = Math.min(best, manaValueOf(parseMana(getDef(o.defId).faces[0]?.cost ?? null)));
  }
  return best;
}

function opponentHasThreats(state: GameState, me: PlayerId): boolean {
  const opp = other(me);
  if (state.zones.hand[opp].length >= 2) return true;
  return state.zones.battlefield.some((id) => {
    const o = state.objects[id];
    return o !== undefined && o.controller === opp && (characteristics(state, id).types & TYPE.Creature) !== 0;
  });
}

function defOf(state: GameState, id: ObjId): DefId | undefined {
  return state.objects[id]?.defId;
}

export const RAKDOS: Profile = {
  name: 'rakdos',
  lifeSelf: 1.0,
  lifeOpp: 0.6,
  race: 0.5,
  signature: ['thoughtseize', 'fatal-push', 'bloodtithe-harvester', 'fable-of-the-mirror-breaker', 'sheoldred-the-apocalypse', 'blood-crypt'],
  cards: RAKDOS_CARDS,

  reserve(state, me) {
    const c = cheapestHeldRemoval(state, me);
    return Number.isFinite(c) && opponentHasThreats(state, me) ? c : 0;
  },

  stateBonus(state, me) {
    // Holding up removal: instant removal in hand, the mana to cast it, and something to kill.
    const c = cheapestHeldRemoval(state, me);
    if (!Number.isFinite(c)) return 0;
    const sum = summarize(state, RAKDOS_CARDS);
    return sum.untappedLands[me] >= c && opponentHasThreats(state, me) ? 1.2 : 0;
  },

  moveBonus(ctx: MoveCtx) {
    const { before, move, me } = ctx;
    const opp = other(me);
    let b = 0;
    if (move.type === 'cast') {
      const d = defOf(before, move.objId);
      // The card taken is worth about a threat-table entry (2.5 on average) beyond the card count.
      // Thoughtseize also costs 2 life, which matters against Mono-Red.
      if (d && DISCARD.has(d)) {
        const early = d === 'thoughtseize' ? 2 : 3;
        b += ownTurns(before, me) <= 3 && before.zones.hand[opp].length >= 2 ? early : before.zones.hand[opp].length <= 1 ? -1 : 1;
      }
      if (d === 'fable-of-the-mirror-breaker') b += 1.5;
      if (d === 'sheoldred-the-apocalypse') b += 2.5;
    }
    if (move.type === 'playLand' && defOf(before, move.objId) === 'blood-crypt' && move.pay) {
      // Pay only when the untapped Crypt lets something be cast now (a play this turn, or removal
      // held up) that no other land play would.
      const life = before.players[me].life;
      const castable = (st: GameState): Set<ObjId> => new Set(
        legalMoves(st, me).flatMap((m) => (m.type === 'cast' ? [m.objId] : [])),
      );
      // Compared with every land play that costs no life (the tapped Crypt, and an untapped
      // Blackcleave Cliffs or Swamp from the same hand), so the 2 life is paid only when no other
      // land drop casts the same thing.
      const withPay = castable(applyMove(before, move));
      const without = new Set<ObjId>();
      for (const m of ctx.moves) {
        if (m.type !== 'playLand' || m.pay) continue;
        for (const id of castable(applyMove(before, m))) without.add(id);
      }
      const needs = [...withPay].some((id) => !without.has(id));
      b += needs ? (life > 6 ? 2.5 : life > 2 ? 0.5 : -5) : -2.5;
    }
    if (move.type === 'declareBlockers') {
      // No chump blocks with Harvester unless the unblocked damage would be lethal.
      const life = before.players[me].life;
      let incoming = 0;
      for (const id of before.zones.battlefield) {
        const o = before.objects[id];
        if (o?.attacking && o.controller === opp) incoming += Math.max(0, characteristics(before, id).power);
      }
      for (const [blocker, attacker] of move.assignments) {
        if (defOf(before, blocker) !== 'bloodtithe-harvester') continue;
        const a = characteristics(before, attacker);
        const h = characteristics(before, blocker);
        const chump = a.power >= h.toughness && a.toughness > h.power;
        if (chump && incoming < life) b -= 3;
      }
    }
    return b;
  },
};
