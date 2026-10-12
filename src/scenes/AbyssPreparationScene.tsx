import { Html } from '@react-three/drei';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { PerspectiveCamera, Vector3, type Group } from 'three';
import { useSharedBattleSurface } from '../rendering/battle/SharedBattleSurfaceContext';
import type { AbyssGrowthOffer, AbyssGrowthOption, AbyssRun, AbyssEncounter } from '../domain/progression/abyssTypes';
import { abyssEffectGrade, abyssEffectLevel, abyssGrowthAmount, abyssGrowthGrade } from '../domain/progression/abyssGrades';
import { describeTraitFunction } from '../domain/skills/traitDescriptions';
import { withAbyssRarity } from '../domain/progression/abyssRarity';
import { abyssBaseHp, abyssPurchasePrice } from '../domain/progression/abyssRules';
import { useRarityIndex } from '../state/useRarityIndex';
import { useForegroundTimeout } from '../ui/useForegroundTimeout';
import { AbyssCampCrystals } from '../ui/AbyssCampCrystals';
import { AbyssCountdown } from '../ui/AbyssCountdown';
import { AbyssUpgradeGlow, type AbyssUpgradePresentation } from './AbyssUpgradeGlow';
import { BattleCanvas } from '../rendering/battle/BattleCanvas';
import { BattleBoard } from '../rendering/battle/BattleBoard';
import { CardMesh } from '../rendering/cards/CardMesh';
import { useSettingsStore } from '../state/settingsStore';
import { AbyssRunPanel, type AbyssDispatch } from '../ui/AbyssRunPanel';
import { AbyssTraitBody, type AbyssTraitItem } from '../ui/AbyssTraitCards';
import { AbyssDialog } from '../ui/AbyssDialog';
import { abyssTraitTip } from '../ui/abyssTraitTip';
import { hideCardTip, moveCardTip, showCardTip } from '../state/cardTipStore';
import { WebGLGuard } from './WebGLGuard';
import { AbyssChoiceDragController, type AbyssChoiceDrag } from './AbyssChoiceDrag';
import { CHOICE_PARTY_SCALE, choiceNeedsTarget, choiceOptionPosition, choiceOverwrite, choicePartyLayout,
  choiceTargetIds, starterChoiceButton, starterChoicePositions, type ChoicePoint } from './abyssChoiceLayout';
import '../ui/abyssChoice.css';

function FixedChoiceCamera({ draft }: { readonly draft: boolean }) {
  const { camera, size } = useThree();
  const still = useSettingsStore(state => state.reduceMotion);
  const target = useMemo(() => ({ position: new Vector3(), look: new Vector3(), camera: new PerspectiveCamera() }), []);
  useLayoutEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const halfX = 6.4, halfZ = draft ? 6.6 : 7.8, centerZ = draft ? 1 : 2;
    const distance = Math.max(halfZ, halfX / Math.max(.25, aspect)) / Math.tan(Math.PI / 9) * .99;
    target.position.set(0, distance, centerZ + distance * .10);
    target.look.set(0, 0, centerZ); target.camera.position.copy(target.position); target.camera.lookAt(target.look);
  }, [size.width, size.height, draft, target]);
  useFrame((_, delta) => {
    const view = camera as PerspectiveCamera, blend = still ? 1 : 1 - Math.exp(-Math.min(.1, delta) * 5);
    view.position.lerp(target.position, blend); view.quaternion.slerp(target.camera.quaternion, blend);
    view.fov += (40 - view.fov) * blend; view.aspect = size.width / Math.max(1, size.height);
    view.updateProjectionMatrix(); view.updateMatrixWorld(true);
  });
  return null;
}

function ChoiceCard({ item, position, scale = 1.5, selected = false, eligible = true, dragging = false,
  spawn, badge, upgrade, onPick, onDown }: {
  readonly item: AbyssTraitItem; readonly position: ChoicePoint; readonly scale?: number;
  readonly selected?: boolean; readonly eligible?: boolean; readonly dragging?: boolean;
  readonly spawn?: ChoicePoint | undefined; readonly badge?: string | undefined;
  readonly upgrade?: AbyssUpgradePresentation | undefined;
  readonly onPick: () => void; readonly onDown?: ((event: ThreeEvent<PointerEvent>) => void) | undefined;
}) {
  const ref = useRef<Group>(null), [hover, setHover] = useState(false);
  const still = useSettingsStore(state => state.reduceMotion);
  const owner = `abyss-board:${item.id}`;
  useEffect(() => () => hideCardTip(owner), [owner]);
  useFrame((_, delta) => {
    const group = ref.current;
    if (!group) return;
    const blend = dragging || still ? 1 : 1 - Math.exp(-Math.min(.1, delta) * 10);
    group.position.x += (position[0] - group.position.x) * blend;
    group.position.y += (position[1] + (hover && !dragging ? .10 : 0) - group.position.y) * blend;
    group.position.z += (position[2] - group.position.z) * blend;
  });
  const tip = (event: ThreeEvent<PointerEvent>) => {
    if (!dragging) showCardTip(item.card?.cardId ?? item.id, { x: event.clientX, y: event.clientY },
      { ...abyssTraitTip(item), source: '3d', ownerKey: owner, ownerElement: event.nativeEvent.target instanceof Element ? event.nativeEvent.target : undefined });
  };
  return <group ref={ref} name={`choice:${item.id}`} position={spawn ?? position} scale={scale}>
    {item.card ? <CardMesh card={item.card} position={[0, 0, 0]} interactive={false} hoverTip={false}
      selected={selected} dragging={dragging} statLayout="hand" textureTier="battle" holo glow={!upgrade}
      stats={{ atk: item.card.atk, hp: item.card.hp, cd: item.card.cd }} />
      : <group rotation={[-Math.PI / 2, 0, 0]}><AbyssTraitBody item={item} /></group>}
    <mesh name={`hit:${item.id}`} rotation={[-Math.PI / 2, 0, 0]} position={[0, .36, 0]}
      onPointerOver={event => { event.stopPropagation(); setHover(true); tip(event); }}
      onPointerMove={event => { if (!dragging) moveCardTip(event.clientX, event.clientY); }}
      onPointerOut={() => { setHover(false); hideCardTip(owner); }}
      onPointerDown={event => { event.stopPropagation(); if (event.button === 0) onDown?.(event); }}
      onClick={event => { event.stopPropagation(); onPick(); }}>
      <planeGeometry args={[1.07, 1.62]} /><meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
    {(selected || hover) && <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -.03, 0]}>
      <planeGeometry args={[1.13, 1.68]} /><meshBasicMaterial color={eligible ? '#f0ca72' : '#df786e'} transparent opacity={.23} depthWrite={false} />
    </mesh>}
    {upgrade && <AbyssUpgradeGlow key={upgrade.id} upgrade={upgrade} />}
    {badge && <Html position={[0, .28, -.96]} center zIndexRange={[18, 1]}>
      <span className="abyss-party-badge">{badge}</span>
    </Html>}
  </group>;
}

function growthItem(option: AbyssGrowthOption, id: string): AbyssTraitItem {
  return { id, name: option.kind === 'recruit' ? option.card.definition.name : option.label,
    description: option.kind === 'trait' ? describeTraitFunction(option.trait) : option.kind === 'recruit'
      ? option.card.definition.rawTraits.join(' · ') || '无特性' : option.kind === 'crystal' ? '领取1枚深渊结晶' : option.kind === 'remove'
        ? '移除选中的本轮卡牌' : '将本项加成赋予下方己方卡牌',
    icon: option.kind === 'trait' ? option.trait.family ?? 'trait' : option.kind,
    footer: option.kind === 'crystal' ? '点击领取，无需选择目标卡牌' : option.kind === 'trait' ? '保留至本轮结束 · 覆盖已有培养特性需1枚结晶' : '选择加成，再拖动或点击己方目标卡牌',
    tone: 'growth', grade: abyssGrowthGrade(option), level: option.kind === 'trait' ? option.trait.param ?? 1 : abyssGrowthAmount(option) || 1,
    ...(option.kind === 'recruit' ? { card: option.card.definition } : {}) };
}

const encounterName = (battle: AbyssEncounter) => `${{ normal: '普通', hard: '困难', nightmare: 'Boss' }[battle.difficulty]} ${battle.floor}-${battle.encounter}`;
const encounterColor = (battle: AbyssEncounter) => ({ normal: '#edcf94', hard: '#c697f4', nightmare: '#f47185' })[battle.difficulty];
interface EncounterTransition { readonly id: string; readonly revision: number; readonly phase: 'out' | 'await' | 'title'; readonly from: AbyssEncounter; readonly to: AbyssEncounter | null }
interface Confirmation { readonly index: number; readonly targetId: string; readonly offerId: string; readonly revision: number; readonly kind: 'replace' | 'remove' | 'recruit' }

/** Draft, pre-battle boons and post-battle/paid rewards all use the same empty table. */
export function AbyssPreparationScene({ run: savedRun, busy, dispatch, onBattle, onHome, onRules, notice, memory,
  settling = false, ended = false, onRanking, onRewards, pendingPacks = 0, rewardReceipt, onAbandon, children }: {
  readonly run: AbyssRun; readonly busy: boolean; readonly dispatch: AbyssDispatch;
  readonly onBattle: () => void; readonly onHome: () => void; readonly onRules?: (() => void) | undefined;
  readonly onRewards?: (() => void) | undefined; readonly pendingPacks?: number; readonly rewardReceipt?: string | undefined; readonly onAbandon?: (() => void) | undefined;
  readonly notice: string; readonly memory: boolean; readonly settling?: boolean; readonly ended?: boolean; readonly onRanking?: (() => void) | undefined; readonly children?: ReactNode;
}) {
  const sharedSurface = useSharedBattleSurface();
  const run = useMemo(() => ({ ...savedRun, cards: savedRun.cards.map(withAbyssRarity) }), [savedRun]);
  const still = useSettingsStore(state => state.reduceMotion);
  const rarity = useRarityIndex();
  const [visible, setVisible] = useState(() => !document.hidden);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  const stage = run.stage, offer: AbyssGrowthOffer | null = stage.kind === 'camp' ? stage.offer : null;
  const draft = !settling && stage.kind === 'starterDraft', boon = !settling && stage.kind === 'boonChoice';
  const [selected, setSelected] = useState<number | null>(null), [drag, setDrag] = useState<AbyssChoiceDrag | null>(null);
  const [upgrade, setUpgrade] = useState<AbyssUpgradePresentation | null>(null);
  const upgradeActive = useRef(false);
  const [transition, setTransition] = useState<EncounterTransition | null>(null);
  const transitionActive = useRef(false);
  const [deckOpen, setDeckOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [sending, setSending] = useState(false), [message, setMessage] = useState('');
  const lock = useRef(false), alive = useRef(true), ignoreClick = useRef(0), spawns = useRef(new Map<string, ChoicePoint>());
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const scope = settling ? 'settlement' : offer?.id ?? `${stage.kind}:${'battle' in stage ? stage.battle.battleId : run.id}`;
  useEffect(() => { setSelected(null); setDrag(null); setConfirmation(null); setMessage(''); }, [scope]);
  const locked = busy || sending || settling || !!confirmation || !!upgrade || !!transition;
  const ready = !ended && stage.kind === 'camp' && !stage.offer && stage.freeRemaining === 0;
  const camp = stage.kind === 'camp';
  const option = offer && selected !== null ? offer.options[selected] ?? null : null;
  const targets = option ? choiceTargetIds(run, option) : [];
  const party = draft || settling || transition?.phase === 'title' ? [] : choicePartyLayout(run.cards).map(pose =>
    deckOpen && !offer ? { ...pose, position: [pose.position[0], pose.position[1], pose.position[2] - 4] as ChoicePoint } : pose);
  const commit = async (action: Parameters<AbyssDispatch>[0]) => {
    if (lock.current || busy || settling || ended || transitionActive.current && action.kind !== 'next') return false;
    const chosen = action.kind === 'chooseGrowth' && offer?.id === action.offerId ? offer.options[action.index] : null;
    const target = action.kind === 'chooseGrowth' ? run.cards.find(card => card.instanceId === action.targetId) : null;
    const grows = !!chosen && ['atk', 'hp', 'cd', 'trait'].includes(chosen.kind) && !!target;
    if (grows && target) {
      upgradeActive.current = true;
      setUpgrade({ id: `${offer!.id}:${target.instanceId}`, targetId: target.instanceId, from: target.definition.rarity,
        to: target.definition.rarity, revision: run.revision, phase: 'saving' });
    }
    lock.current = true; setSending(true); setMessage(''); hideCardTip();
    try {
      const ok = await dispatch(action);
      if (!ok) { upgradeActive.current = false; if (alive.current) { setUpgrade(null); setMessage('选择未保存，请重试。'); } }
      else if (grows && alive.current) setUpgrade(current => current ? { ...current, phase: 'waiting' } : null);
      return ok;
    } catch {
      upgradeActive.current = false;
      if (alive.current) { setUpgrade(null); setMessage('选择保存失败，请重试。'); }
      return false;
    } finally { if (!upgradeActive.current) lock.current = false; if (alive.current) setSending(false); }
  };
  useEffect(() => {
    if (!upgrade || upgrade.phase !== 'waiting' || run.revision <= upgrade.revision) return;
    const target = run.cards.find(card => card.instanceId === upgrade.targetId);
    if (target) setUpgrade({ ...upgrade, to: target.definition.rarity, phase: 'playing' });
    else { upgradeActive.current = false; lock.current = false; setUpgrade(null); }
  }, [run, upgrade]);
  useForegroundTimeout(upgrade?.phase === 'playing', 2000, () => {
    upgradeActive.current = false; lock.current = false; setUpgrade(null);
  }, upgrade?.id);
  const clearTransition = () => { transitionActive.current = false; setTransition(null); };
  useForegroundTimeout(transition?.phase === 'out', 450, () => {
    void (async () => {
      if (await commit({ kind: 'next' })) setTransition(current => current ? { ...current, phase: 'await' } : null);
      else clearTransition();
    })();
  }, transition?.id);
  useEffect(() => {
    if (!transition || transition.phase !== 'await' || run.revision <= transition.revision) return;
    if (run.stage.kind === 'bossDecision') { transitionActive.current = false; setTransition(null); return; }
    if ('battle' in run.stage) setTransition({ ...transition, phase: 'title', to: run.stage.battle });
  }, [run, transition]);
  useForegroundTimeout(transition?.phase === 'title', 1700, clearTransition, transition?.id);
  const nextRound = () => {
    if (locked || ended || !(ready || stage.kind === 'bossDecision') || !('battle' in stage)) return;
    transitionActive.current = true; setDeckOpen(false); hideCardTip();
    setTransition({ id: `${run.id}:${run.revision}`, revision: run.revision, phase: 'out', from: stage.battle, to: null });
  };
  const saveExit = () => {
    if (locked) return;
    if (ended) { onHome(); return; }
    void (async () => { if (await commit({ kind: 'save' }) && alive.current) onHome(); })();
  };
  const buy = (purchase: 'recruit' | 'trait') => { if (!locked && ready) { setDeckOpen(false); void commit({ kind: 'buy', purchase }); } };
  const apply = (index: number, targetId?: string) => {
    if (locked || ended || upgradeActive.current || transitionActive.current || !offer) return;
    const chosen = offer.options[index];
    if (!chosen) return;
    if (choiceNeedsTarget(chosen, run.cards.length)) {
      if (!targetId || !choiceTargetIds(run, chosen).includes(targetId)) {
        setMessage(chosen.kind === 'trait' && choiceOverwrite(run, chosen, targetId) && (run.crystals ?? 0) < 1
          ? '需要1枚深渊结晶才能覆盖已有培养特性。' : '这张卡不能接受此项加成。'); return;
      }
      const kind = choiceOverwrite(run, chosen, targetId) ? 'replace' : chosen.kind === 'remove' ? 'remove' : chosen.kind === 'recruit' ? 'recruit' : null;
      if (kind) { setConfirmation({ index, targetId, offerId: offer.id, revision: run.revision, kind }); return; }
    }
    void commit({ kind: 'chooseGrowth', offerId: offer.id, index, ...(targetId ? { targetId } : {}) });
  };
  const confirm = () => {
    if (!confirmation || busy || sending) return;
    if (!offer || offer.id !== confirmation.offerId || run.revision !== confirmation.revision) {
      setConfirmation(null); setMessage('候选或卡组已变化，请重新选择。'); return;
    }
    const pending = confirmation; setConfirmation(null);
    void commit({ kind: 'chooseGrowth', offerId: pending.offerId, index: pending.index, targetId: pending.targetId,
      ...(pending.kind === 'replace' ? { confirmReplace: true } : {}) });
  };
  const selectGroup = (index: number) => {
    if (locked || stage.kind !== 'starterDraft') return;
    const choice = stage.choices[index]; if (!choice) return;
    setSelected(index);
    choice.cards.forEach((card, cardIndex) => spawns.current.set(card.instanceId, starterChoicePositions(index)[cardIndex]!));
    void commit({ kind: 'chooseStarter', index });
  };
  const selectOption = (index: number) => {
    if (locked || Date.now() < ignoreClick.current) return;
    setSelected(index); setMessage('');
  };
  const down = (index: number, event: ThreeEvent<PointerEvent>) => {
    if (locked || !offer || !choiceNeedsTarget(offer.options[index]!, run.cards.length)) return;
    event.nativeEvent.preventDefault(); hideCardTip(); setSelected(index); setMessage('');
    setDrag({ index, pointerId: event.pointerId, startClient: [event.clientX, event.clientY],
      position: choiceOptionPosition(index, offer.options.length), targetId: null, moved: false });
  };
  const drop = (active: AbyssChoiceDrag, cancel: boolean) => {
    setDrag(null);
    if (active.moved) ignoreClick.current = Date.now() + 250;
    if (!cancel && active.moved && active.targetId) apply(active.index, active.targetId);
  };
  const title = ended ? '挑战已结束 · 进度已保存' : upgrade ? '培养完成 · 稀有度绽光' : settling ? '战果结算 · 清空盘面' : draft ? '选择本轮起始卡组' : boon ? '选择本战正负契约'
    : stage.kind === 'bossDecision' ? '突破完成 · 结算或继续无尽' : ready ? deckOpen ? `当前卡组 · ${run.cards.length}/12` : '局间整备' : stage.kind === 'battleReady' || stage.kind === 'inBattle' ? '继续本战' : offer?.source === 'recruit' ? '三张实体卡 · 选择一张' : `加成选择${stage.kind === 'camp' && stage.freeRemaining > 0 ? ` · 剩余${stage.freeRemaining}次` : ''}`;
  const hint = boon && selected !== null && stage.kind === 'boonChoice'
    ? stage.battle.boonChoices[selected]!.positive.description + '；' + stage.battle.boonChoices[selected]!.negative.description
    : option ? growthItem(option, 'hint').description : draft ? '上方一组3×2，下方左右各一组2×3；悬停查看简介，再选择整组。'
      : '点击选择卡；需要赋予加成时，拖到下方己方卡，或再点击目标卡。';
  return <div className="abyss-scene abyss-preparation abyss-choice-scene" data-shared={!!sharedSurface} data-stage={stage.kind} data-still={still} data-visible={visible} data-transition={transition?.phase ?? 'none'} aria-label="深渊选择盘面"
    onKeyDown={event => {
      if (event.key !== 'Escape' || confirmation || drag) return;
      event.preventDefault(); event.stopPropagation(); setSelected(null); setMessage('');
    }}>
    <div className="scene-viewport"><WebGLGuard fallback={<div className="abyss-choice-fallback"><p>3D盘面不可用，可使用以下选择入口继续。</p>
      {!settling && !ended && <AbyssRunPanel preparation run={run} busy={locked} dispatch={commit} onBattle={onBattle} onHome={onHome} onRules={onRules} />}</div>}>
      <BattleCanvas themeId="abyss" onPointerMissed={() => { if (!locked && !drag) setSelected(null); }}>
        <BattleBoard cameraRig={false} showSlotMarkers />
        <FixedChoiceCamera draft={draft} />
        <AbyssChoiceDragController drag={drag} layout={party} onMove={setDrag} onDrop={drop} />
        {draft && stage.kind === 'starterDraft' && stage.choices.map((choice, index) => <group key={choice.id}>
          {choice.cards.map((card, cardIndex) => <ChoiceCard key={card.instanceId} item={{ id: card.instanceId, name: card.definition.name,
            description: card.definition.rawTraits.join(' · '), icon: 'card', card: card.definition }}
            position={starterChoicePositions(index)[cardIndex]!} scale={1.15} selected={selected === index}
            onPick={() => { if (!locked) setSelected(index); }} />)}
          <Html position={starterChoiceButton(index)} center zIndexRange={[21, 1]}><button className="abyss-choice-group" type="button"
            disabled={locked} aria-pressed={selected === index} onClick={() => selectGroup(index)}>选择卡组 {index + 1}</button></Html>
        </group>)}
        {!upgrade && !transition && !ended && boon && stage.kind === 'boonChoice' && stage.battle.boonChoices.map((pair, index) => <group key={pair.id}>
          {[pair.positive, pair.negative].map((effect, row) => <ChoiceCard key={effect.id} item={{ id: `${pair.id}:${row}`,
            name: effect.name, description: effect.description, icon: effect.modifier.traits[0]?.family ?? effect.id.split('-')[0]!,
            tone: effect.polarity, grade: abyssEffectGrade(effect), level: abyssEffectLevel(effect) }}
            position={[choiceOptionPosition(index, 3, true)[0], .22, row === 0 ? -2 : .75]} scale={1.45}
            selected={selected === index} onPick={() => selectOption(index)} />)}

        </group>)}
        {!settling && !upgrade && !transition && !ended && offer?.options.map((item, index) => <ChoiceCard key={`${offer.id}:${index}`} item={growthItem(item, `${offer.id}:${index}`)}
          position={drag?.index === index ? drag.position : choiceOptionPosition(index, offer.options.length)} scale={1.55}
          selected={selected === index} dragging={drag?.index === index} onPick={() => selectOption(index)} onDown={event => down(index, event)} />)}
        {party.map((pose, index) => {
          const card = run.cards[index]!;
          return <ChoiceCard key={card.instanceId} item={{ id: card.instanceId, name: card.definition.name, description: '', icon: 'card', card: card.definition }}
            position={pose.position} spawn={spawns.current.get(card.instanceId)} scale={CHOICE_PARTY_SCALE}
            upgrade={upgrade?.phase === 'playing' && upgrade.targetId === card.instanceId ? upgrade : undefined}
            badge={card.addedTraits.map(trait => trait.raw).join(' · ') || undefined}
            selected={drag?.targetId === card.instanceId || !!option && targets.includes(card.instanceId)} eligible={!option || targets.includes(card.instanceId)}
            onPick={() => { if (!locked && selected !== null && Date.now() >= ignoreClick.current) apply(selected, card.instanceId); }} />;
        })}
      </BattleCanvas>
    </WebGLGuard></div>
    <header className="abyss-choice-header"><div><small>深渊 {run.floor}-{run.encounter}</small><h1>{title}</h1></div>
      <div><span>{ended ? '本轮已结算' : '♥'.repeat(Math.max(0, run.lives))} · {run.coins} 币 · {run.crystals ?? 0} 结晶</span>
        {onRules && <button type="button" disabled={locked} onClick={onRules}>规则讲解</button>}
        {onRewards && pendingPacks > 0 && <button type="button" disabled={locked} onClick={onRewards}>奖励卡包（{pendingPacks}）</button>}
        {onAbandon && !ended && !settling && <button type="button" className="abyss-board-abandon" disabled={locked} onClick={onAbandon}>放弃并结算</button>}
        {onRanking && <button type="button" disabled={locked} onClick={onRanking}>深渊排行</button>}
        {(camp || stage.kind === 'bossDecision') && !ended && <button type="button" className="abyss-primary abyss-board-next" disabled={locked || !(ready || stage.kind === 'bossDecision')} onClick={nextRound}>进入下一局</button>}
        {!camp && <button type="button" className="abyss-save-exit" disabled={locked} onClick={saveExit}>保存退出</button>}
      </div>
    </header>
    {rewardReceipt && !transition && <p className="abyss-reward-receipt" role="status">{rewardReceipt}</p>}
    {!ended && !upgrade && !transition && boon && stage.kind === 'boonChoice' && <aside className="abyss-choice-enemy" title={stage.battle.enemyEffect.description}>
      敌方本战增益：{stage.battle.enemyEffect.name} · {stage.battle.enemyEffect.description}
    </aside>}
    {!ended && !upgrade && !settling && !ready && !transition && stage.kind !== 'bossDecision' && stage.kind !== 'battleReady' && stage.kind !== 'inBattle' && <footer className={`abyss-choice-footer${camp ? ' abyss-choice-footer--camp' : ''}`}><p>{hint}</p>
      {boon && stage.kind === 'boonChoice' && <div className="abyss-contract-actions" aria-label="接受本战契约">
        {stage.battle.boonChoices.map((pair, index) => <button key={pair.id} type="button" className="abyss-choice-group" disabled={locked}
          aria-pressed={selected === index} onClick={() => { void (async () => { if (await commit({ kind: 'chooseBoon', index })) onBattle(); })(); }}>接受契约 {index + 1}</button>)}
      </div>}
      {option && !choiceNeedsTarget(option, run.cards.length) && <button type="button" className="abyss-primary" disabled={locked}
        onClick={() => apply(selected!)}>{option.kind === 'crystal' ? '领取深渊结晶' : `加入 ${option.kind === 'recruit' ? option.card.definition.name : option.label}`}</button>}
      {offer && <button type="button" disabled={locked} onClick={() => {
        if (window.confirm(offer.source === 'free' ? '放弃剩余免费加成？' : '放弃本次候选？已支付费用不返还。'))
          void commit(offer.source === 'free' ? { kind: 'skipFree' } : { kind: 'cancelOffer' });
      }}>
        {offer.source === 'free' ? '放弃剩余免费加成' : '放弃候选（不退款）'}</button>}
    </footer>}
    {!draft && !settling && <div className="abyss-board-countdown"><AbyssCountdown /></div>}
    {camp && !settling && !ended && <AbyssCampCrystals still={still} entries={[
      { title: '保存退出', detail: '保存当前状态 · 返回大厅', disabled: locked, action: saveExit },
      { title: deckOpen ? '收起卡组' : '浏览卡组', detail: `${run.cards.length}/12张 · 只读浏览`, disabled: locked || !!offer, pressed: deckOpen,
        action: () => { hideCardTip(); setDeckOpen(value => !value); } },
      { title: '抽取新卡', detail: `${abyssPurchasePrice(run, 'recruit')}深渊币 · 三选一`, disabled: locked || !ready || run.coins < abyssPurchasePrice(run, 'recruit'), action: () => buy('recruit') },
      { title: '抽取特性', detail: `${abyssPurchasePrice(run, 'trait')}深渊币 · 选择加成`, disabled: locked || !ready || run.coins < abyssPurchasePrice(run, 'trait'), action: () => buy('trait') },
    ]} />}
    {ready && !upgrade && <details className="abyss-board-enemy"><summary>本局战果 · {stage.kind === 'camp' && encounterName(stage.battle)} · 查看敌方信息</summary>
      {stage.kind === 'camp' && <><p>{stage.battle.enemyEffect.name}：{stage.battle.enemyEffect.description}</p>
        <p>本体上限：我方 {abyssBaseHp(stage.battle).player} / 敌方 {abyssBaseHp(stage.battle).enemy}</p>
        <p>{stage.battle.enemyCards.map(card => `${card.definition.name}（攻${card.definition.atk} / 血${card.definition.hp}）`).join(' · ')}</p></>}
    </details>}
    {!locked && !ended && (stage.kind === 'battleReady' || stage.kind === 'inBattle') && <div className="abyss-board-resume"><button type="button" onClick={onBattle}>{stage.kind === 'inBattle' ? '继续本战' : '开始战斗'}</button></div>}
    {!locked && !ended && (stage.kind === 'bossDecision' || ready && (run.encounter === 10 || run.floor >= 4)) && <div className="abyss-board-finish">
      <button type="button" onClick={() => { if (window.confirm('结算本轮挑战并保存成绩？按已通关节点发放奖励，每周最多两次；本轮已发奖则不重复发放。')) void commit({ kind: 'finish' }); }}>结算本轮</button>
      {stage.kind === 'bossDecision' && <button type="button" className="abyss-primary" onClick={nextRound}>继续无尽 · {run.floor + 1}-1</button>}
    </div>}
    {ended && <div className="abyss-board-finish"><p>{run.wins} 胜 · {run.losses} 负 · 最终卡组 {run.cards.length} 张</p>
      <button type="button" className="abyss-save-exit" onClick={saveExit}>保存退出</button></div>}
    {upgrade && <div className="abyss-upgrade-status" role="status">{upgrade.phase === 'playing' ? <>
      <strong style={{ color: rarity.colorOf(upgrade.from) }}>{upgrade.from}</strong><span> → </span><strong style={{ color: rarity.colorOf(upgrade.to) }}>{upgrade.to}</strong><p>培养完成</p>
    </> : '正在保存培养结果…'}</div>}
    {transition && <div className="abyss-encounter-banner" data-phase={transition.phase} role="status" style={{ '--encounter-from': encounterColor(transition.from), '--encounter-to': encounterColor(transition.to ?? transition.from) } as CSSProperties}>
      {transition.phase === 'title' && transition.to ? <><span className="abyss-encounter-old">{encounterName(transition.from)}</span>
        <span className="abyss-encounter-arrow">→</span><strong className="abyss-encounter-new">{encounterName(transition.to)}</strong></> : <strong>{encounterName(transition.from)}</strong>}
    </div>}
    {children}
    {(message || notice) && <p className="abyss-choice-message" role="alert">{message || notice}</p>}
    {memory && <p className="abyss-storage-warning" role="status">当前使用内存存档，刷新或关闭会丢失进度。</p>}
    {confirmation && <AbyssDialog title={confirmation.kind === 'replace' ? '覆盖培养特性' : '确认替换或移除卡牌'} className="abyss-dialog--traits abyss-choice-confirm" onClose={() => setConfirmation(null)}>
      <p>{confirmation.kind === 'replace' ? `是否花费1枚深渊水晶（结晶），擦除 ${run.cards.find(card => card.instanceId === confirmation.targetId)?.addedTraits.map(trait => trait.raw).join('、')} 并覆盖为 ${offer?.options[confirmation.index]?.label}？属性强化与原生技能保留。`
        : '所选卡牌将移出本轮卡组，确认继续？'}</p>
      <div><button type="button" disabled={busy || sending} onClick={() => setConfirmation(null)}>取消</button>
        <button type="button" disabled={busy || sending} onClick={confirm}>确认{confirmation.kind === 'replace' ? '消耗1结晶并覆盖' : ''}</button></div>
    </AbyssDialog>}
  </div>;
}
