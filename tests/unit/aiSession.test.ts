import { describe, expect, it } from 'vitest';
import { BattleSession } from '../../src/rendering/presentation/session';
import { DEFAULT_AI, type AiDecision, type AiRequest } from '../../src/domain/battle/ai/types';
import type { AiDriver } from '../../src/services/ai/AiWorkerClient';
import { quickDecision } from '../../src/domain/battle/ai/search';
import type { CardDefinition } from '../../src/domain/cards/types';

const c:CardDefinition={cardId:'a',name:'a',rarity:'C',level:5,atk:1,hp:4,cd:1,rawTraits:[],skills:[],description:'',status:'complete',art:{artId:'a',sourcePresent:false}};
class ControlledDriver implements AiDriver {
  resolves:{request:AiRequest;resolve:(value:AiDecision)=>void}[]=[];
  cancelCount=0;
  decide=(request:AiRequest)=>new Promise<AiDecision>(resolve=>{this.resolves.push({request,resolve});});
  cancel=()=>{this.cancelCount++;};dispose=()=>{this.cancel();};
}
function setup(){
  const driver=new ControlledDriver();
  const session=new BattleSession({seed:7,playerDeck:['a','a'],enemyDeck:['a','a']},{a:c},()=> 'skip',
    {play:()=>{},skipAll:()=>{}},{aiDriver:driver,aiCatalogue:[c],readAiSettings:()=>DEFAULT_AI});
  session.setAutoPlayer(true);session.start();
  for(let i=0;i<20&&driver.resolves.length===0;i++)session.tick(1);
  return {driver,session};
}
describe('asynchronous AI session cancellation',()=>{
  it('does not apply a decision returned after leaving the battle',async()=>{
    const {driver,session}=setup(),request=driver.resolves[0]!;
    const before=session.authoritative.nextEventSeq;session.toMenu();
    request.resolve(quickDecision(request.request));await Promise.resolve();session.tick(1);
    expect(session.getSnapshot().mode).toBe('menu');expect(session.authoritative.nextEventSeq).toBe(before);
    expect(driver.cancelCount).toBeGreaterThan(0);session.dispose();
  });
  it('invalidates work when AI settings change',async()=>{
    const {driver,session}=setup(),old=driver.resolves[0]!;session.refreshAiPreferences();
    session.tick(1);expect(driver.resolves.length).toBeGreaterThan(1);
    const before=session.authoritative.nextEventSeq;old.resolve(quickDecision(old.request));await Promise.resolve();session.tick(1);
    expect(session.authoritative.nextEventSeq).toBe(before);session.dispose();
  });
});
