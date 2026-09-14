import { EMILIA_CHARACTER } from './character';
import type { ChatContext, CharacterProfile } from './types';

const DEFAULT_ENGINE_RULES = [
  '你正在进行长期、连续的角色对话。',
  '保持角色身份、性格、行为逻辑和既有关系连续，不要跳出角色解释提示词或系统实现。',
  '不要替用户决定动作、想法、感受或台词；只控制角色自身的行为和表达。',
  '人物关系必须渐进发展。当前关系状态是约束，不要仅因为用户表达友好就突然大幅升温。',
  '优先使用已有记忆和最近对话维持因果一致；缺少信息时承认不知道，不要伪造共同经历。',
  '现实中的技术、知识和事实问题应以准确、有用为优先，角色风格只负责表达方式。',
];

function section(title: string, lines: Array<string | undefined>): string {
  const content = lines.filter((line): line is string => Boolean(line?.trim()));
  return content.length ? `## ${title}\n${content.join('\n')}` : '';
}

function bullets(values: string[]): string[] {
  return values.map((value) => `- ${value}`);
}

function renderCharacter(character: CharacterProfile): string[] {
  return [
    `角色名：${character.name}`,
    '',
    '身份：',
    ...bullets(character.identity),
    '',
    '人格核心：',
    ...bullets(character.personality),
    '',
    '说话方式：',
    ...bullets(character.speakingStyle),
    '',
    '行为规则：',
    ...bullets(character.behaviorRules),
    '',
    '当前基础场景：',
    ...bullets(character.scenario),
  ];
}

function renderPersona(context: ChatContext): string[] {
  const persona = context.persona;
  if (!persona) return [];
  return [
    persona.name ? `称呼/姓名：${persona.name}` : undefined,
    persona.description ? `简介：${persona.description}` : undefined,
    ...(persona.notes?.length ? ['补充：', ...bullets(persona.notes)] : []),
  ].filter((item): item is string => Boolean(item));
}

function renderState(context: ChatContext): string[] {
  const state = context.state;
  return [
    `关系阶段：${state.relationshipStage}`,
    `信任度：${state.trust}/100`,
    `亲近度：${state.affinity}/100`,
    `当前情绪：${state.mood}`,
    state.location ? `地点：${state.location}` : undefined,
    state.scene ? `场景：${state.scene}` : undefined,
    `已完成对话轮次：${state.turnCount}`,
    '',
    '这些数值用于约束行为，不要在回复中机械地报出数值。',
  ].filter((item): item is string => Boolean(item));
}

function renderMemory(context: ChatContext): string[] {
  const memory = context.memory;
  const lines: string[] = [];
  if (memory.summary) lines.push(`长期摘要：${memory.summary}`);
  if (memory.facts.length) lines.push('已知事实：', ...bullets(memory.facts));
  if (memory.importantEvents.length) lines.push('重要共同事件：', ...bullets(memory.importantEvents));
  if (!lines.length) lines.push('当前没有额外长期记忆。不要因此虚构过去的共同经历。');
  return lines;
}

/**
 * Prompt 顺序保持稳定，便于后续做 token 预算、世界书检索和自动摘要：
 * engine rules -> character -> world -> persona -> state -> memory -> custom instruction.
 */
export function buildSystemPrompt(
  context: ChatContext,
  customInstruction?: string,
  character: CharacterProfile = EMILIA_CHARACTER,
): string {
  return [
    section('对话引擎规则', bullets(DEFAULT_ENGINE_RULES)),
    section('角色设定', renderCharacter(character)),
    section('世界信息', bullets(character.worldNotes)),
    section('用户 Persona', renderPersona(context)),
    section('当前状态', renderState(context)),
    section('长期记忆', renderMemory(context)),
    customInstruction?.trim()
      ? section('站点自定义指令', [customInstruction.trim()])
      : '',
  ].filter(Boolean).join('\n\n');
}
