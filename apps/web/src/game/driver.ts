// What the Phaser scene and the match HUD need from a match, local or online.
import type { MatchStatistics } from './matchStatistics';
import type { World } from 'koota';
import type { MatchState, PlayerInfo, ShotRejection, Side } from '@flickkick/rules';
import type { FlickSim } from '@flickkick/sim';
import type { Emitter } from './emitter';
import type { ControllerEvents } from './MatchController';

export interface MatchDriver {
  /** True for server-authoritative matches (no pause, server results). */
  readonly online: boolean;
  readonly world: World;
  readonly bus: Emitter<ControllerEvents>;
  readonly current: MatchState;
  readonly statistics?: MatchStatistics;
  readonly trailIds?: Partial<Record<Side, string>>;
  readonly sim: FlickSim;
  canAim(): boolean;
  isHuman(side: Side): boolean;
  requestShot(discIndex: number, angle: number, power: number): ShotRejection | null;
  /** Called by the scene when a shot's playback has finished. */
  completeShot(): void;
  start(): void;
  pause(): void;
  resume(): void;
  forfeit(side: Side): void;
  playerOf(side: Side): PlayerInfo;
  dispose(): void;
}
