// 会議だけを1回、最後まで進める（見回りの無い、短い形）。会議の前の状況は sim が種から作る。

import { CallLimitError, QuotaExhaustedError } from '../../agents/src/index.ts';
import { createWorld, nameOf } from '../../sim/src/index.ts';
import type { MeetingConfig, World } from '../../sim/src/index.ts';
import { conductMeeting, Match } from './match-core.ts';
import type { CommonRunOptions, MatchLog } from './match-core.ts';

export interface MeetingRunOptions extends CommonRunOptions {
  attendees?: number;
  config?: Partial<MeetingConfig>;
  /** テスト用: 会議を始める前に真の状態へ手を入れる。 */
  prepareWorld?: (world: World) => void;
}

export async function runMeeting(options: MeetingRunOptions): Promise<MatchLog> {
  const world = createWorld({ seed: options.seed, attendees: options.attendees, config: options.config });
  options.prepareWorld?.(world);
  const truth = {
    nibbler: nameOf(world, world.truth.nibblerId),
    victim: nameOf(world, world.truth.victimId),
    deedTime: world.truth.deedTime,
    deedRoom: world.truth.deedRoom,
  };
  const match = new Match(world, 'meeting', truth, options);
  try {
    const result = await conductMeeting(world, match, 1);
    // この版では、人狼をクビにすれば従業員の勝ち
    match.log.outcome = { ...result, winner: result.ejectedRole === 'nibbler' ? 'artisan' : 'nibbler' };
  } catch (error) {
    if (!(error instanceof QuotaExhaustedError)) throw error;
    // 利用枠が尽きたら止めて保存する。台本での代用や、有料の経路への切り替えはしない
    match.log.status = error instanceof CallLimitError ? 'stopped_limit' : 'stopped_quota';
    match.log.stopped = error.message;
  }
  return match.close();
}
