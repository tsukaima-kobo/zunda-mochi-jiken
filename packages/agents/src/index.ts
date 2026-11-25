export { Agent, MeetingAgent } from './agent.ts';
export type { ActHooks, ActResult, AgentOptions, AttemptRecord, MeetingAgentOptions } from './agent.ts';
export { CallLimitError, limitCalls, patientBrains, QuotaExhaustedError, watchedBrains } from './brain.ts';
export type { Brain, BrainRequest, BrainResult } from './brain.ts';
export { checkIntent, checkRoamIntent, feedbackFor, knownWolves, normalizeSuspicion, privateDataProblems, SOFT_PROBLEMS, trimSay } from './guard.ts';
export type { RoamDecision } from './guard.ts';
export { AgentMemory, clockLabel } from './memory.ts';
export { AFTER_HEADER, renderRoamUser, renderUser, RULES } from './prompt.ts';
export { scriptedIntent, scriptedRoamIntent } from './scripted.ts';

// この公開版には、AI（Claude Code・Codex などの CLI）につなぐ部分は入れていない。
// 頭脳（Brain）の口は brain.ts にあり、つなげば AI どうしで遊べる。つながない席は台本ボットが動かす。
