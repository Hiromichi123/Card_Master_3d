import type { CardDefinition } from '../cards/types';
import type { Rng } from './rng';
import type { BattleState, Command } from './types';
import { inputSideOf } from './turnActions';
import { observeForAi } from './ai/observation';
import { decideAi } from './ai/search';
import { normalizeAiSettings, type AiSettings, type AiModel } from './ai/types';
export { chooseBaselineCommand } from './baselineAi';

/** Synchronous entry for headless callers; browser sessions inject an asynchronous worker driver. */
export function chooseCommand(state:BattleState,rng:Rng,side=inputSideOf(state),settings:Partial<AiSettings>={},
  catalogue:readonly CardDefinition[]=[],model:AiModel|null=null):Command {
  if(state.outcome)return {kind:'endTurn',side};
  return decideAi({observation:observeForAi(state,catalogue,false,side),options:normalizeAiSettings(settings),
    seed:rng.int(0,0xffffffff),model}).command;
}
