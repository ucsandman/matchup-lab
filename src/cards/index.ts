// Card registry entry point: registers every real card def and every token def, and re-exports
// the registry API. Engine modules import from here so registration always happens first.
// To add a card: write src/cards/defs/<kebab-name>.ts exporting a CardDef, import it below and
// add it to CARDS (see docs/ENGINE-NOTES.md).
import type { CardDef } from '../engine/types.js';
import { registerCard } from './registry.js';
import { TOKENS } from './tokens.js';
import { Mountain } from './defs/mountain.js';
import { Swamp } from './defs/swamp.js';
import { BloodtitheHarvester } from './defs/bloodtithe-harvester.js';
import { GiftedAetherborn } from './defs/gifted-aetherborn.js';
import { SheoldredTheApocalypse } from './defs/sheoldred-the-apocalypse.js';
import { GraveyardTrespasser } from './defs/graveyard-trespasser.js';
import { KalitasTraitorOfGhet } from './defs/kalitas-traitor-of-ghet.js';
import { FearOfMissingOut } from './defs/fear-of-missing-out.js';
import { BonecrusherGiant } from './defs/bonecrusher-giant.js';
import { MonasterySwiftspear } from './defs/monastery-swiftspear.js';
import { EmberheartChallenger } from './defs/emberheart-challenger.js';
import { SunspineLynx } from './defs/sunspine-lynx.js';
import { WeatheredRunestone } from './defs/weathered-runestone.js';
// family removal-discard
import { Abrade } from './defs/abrade.js';
import { BitterTriumph } from './defs/bitter-triumph.js';
import { Duress } from './defs/duress.js';
import { FatalPush } from './defs/fatal-push.js';
import { GoForTheThroat } from './defs/go-for-the-throat.js';
import { Thoughtseize } from './defs/thoughtseize.js';
import { GoBlank } from './defs/go-blank.js';
import { ExtinctionEvent } from './defs/extinction-event.js';
import { InvokeDespair } from './defs/invoke-despair.js';
import { RayOfEnfeeblement } from './defs/ray-of-enfeeblement.js';
import { TorchTheTower } from './defs/torch-the-tower.js';
const REMOVAL_DISCARD: readonly CardDef[] = [
  Abrade, BitterTriumph, Duress, FatalPush, GoForTheThroat, Thoughtseize, GoBlank, ExtinctionEvent, InvokeDespair, RayOfEnfeeblement, TorchTheTower,
];
// family permanents-misc
import { UnholyAnnex } from './defs/unholy-annex.js';
import { LilianaOfTheVeil } from './defs/liliana-of-the-veil.js';
import { ReckonerBankbuster } from './defs/reckoner-bankbuster.js';
import { UnlicensedHearse } from './defs/unlicensed-hearse.js';
const PERMANENTS_MISC: readonly CardDef[] = [UnholyAnnex, LilianaOfTheVeil, ReckonerBankbuster, UnlicensedHearse];
// family burn-pump
import { BurstLightning } from './defs/burst-lightning.js';
import { MonstrousRage } from './defs/monstrous-rage.js';
import { RecklessRage } from './defs/reckless-rage.js';
import { FlowstoneInfusion } from './defs/flowstone-infusion.js';
import { Pyroclasm } from './defs/pyroclasm.js';
import { RedcapMelee } from './defs/redcap-melee.js';
import { ScorchingShot } from './defs/scorching-shot.js';
import { SoulScarMage } from './defs/soul-scar-mage.js';
import { MagebaneLizard } from './defs/magebane-lizard.js';
import { ScreamingNemesis } from './defs/screaming-nemesis.js';
const BURN_PUMP: readonly CardDef[] = [
  BurstLightning, MonstrousRage, RecklessRage, FlowstoneInfusion, Pyroclasm, RedcapMelee, ScorchingShot, SoulScarMage, MagebaneLizard, ScreamingNemesis,
];
// family sagas
import { FableOfTheMirrorBreaker } from './defs/fable-of-the-mirror-breaker.js';
import { KumanoFacesKakkazan } from './defs/kumano-faces-kakkazan.js';
import { HidetsuguConsumesAll } from './defs/hidetsugu-consumes-all.js';
import { TheLegendOfRoku } from './defs/the-legend-of-roku.js';
const SAGAS: readonly CardDef[] = [FableOfTheMirrorBreaker, KumanoFacesKakkazan, HidetsuguConsumesAll, TheLegendOfRoku];
// family lands
import { BlackcleaveCliffs } from './defs/blackcleave-cliffs.js';
import { BlazemireVerge } from './defs/blazemire-verge.js';
import { BlightstepPathway } from './defs/blightstep-pathway.js';
import { BloodCrypt } from './defs/blood-crypt.js';
import { CastleLocthwain } from './defs/castle-locthwain.js';
import { DenOfTheBugbear, DenOfTheBugbearGranted } from './defs/den-of-the-bugbear.js';
import { HiveOfTheEyeTyrant, HiveOfTheEyeTyrantGranted } from './defs/hive-of-the-eye-tyrant.js';
import { Mutavault } from './defs/mutavault.js';
import { PetrifiedHamlet } from './defs/petrified-hamlet.js';
import { RamunapRuins } from './defs/ramunap-ruins.js';
import { RockfaceVillage } from './defs/rockface-village.js';
import { SokenzanCrucibleOfDefiance } from './defs/sokenzan-crucible-of-defiance.js';
import { TakenumaAbandonedMire } from './defs/takenuma-abandoned-mire.js';
import { UrborgTombOfYawgmoth } from './defs/urborg-tomb-of-yawgmoth.js';
const LANDS: readonly CardDef[] = [
  BlackcleaveCliffs, BlazemireVerge, BlightstepPathway, BloodCrypt, CastleLocthwain, DenOfTheBugbear, HiveOfTheEyeTyrant,
  Mutavault, PetrifiedHamlet, RamunapRuins, RockfaceVillage, SokenzanCrucibleOfDefiance, TakenumaAbandonedMire, UrborgTombOfYawgmoth,
];
/** Hidden defs that hold abilities an animation grants (dsl granted()); never in a deck, not in CARDS. */
const LANDS_GRANTED: readonly CardDef[] = [DenOfTheBugbearGranted, HiveOfTheEyeTyrantGranted];

export const CARDS: readonly CardDef[] = [
  ...LANDS,
  ...SAGAS,
  ...REMOVAL_DISCARD,
  ...PERMANENTS_MISC,
  ...BURN_PUMP,
  Mountain, Swamp, MonasterySwiftspear, EmberheartChallenger, SunspineLynx, WeatheredRunestone,
  BloodtitheHarvester, GiftedAetherborn, SheoldredTheApocalypse, GraveyardTrespasser, KalitasTraitorOfGhet, FearOfMissingOut, BonecrusherGiant];

for (const d of CARDS) registerCard(d);
for (const d of TOKENS) registerCard(d);
for (const d of LANDS_GRANTED) registerCard(d);

export * from './registry.js';
export { TOKEN_IDS } from './tokens.js';
