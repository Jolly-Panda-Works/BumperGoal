// Physics preview for the admin panel: runs the game's own deterministic sim
// with the live values and with the edited values, and replays both on one pitch.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PhysicsConfig } from '@flickkick/config';
import { num, tr } from './adminText';
import { FlickSim, TIME_STEP_SECONDS, toF32Bodies, type BodyState, type ShotResult } from '@flickkick/sim';

export type Scenario = 'ball' | 'disc' | 'arena' | 'shot';

interface Setup {
  bodies: BodyState[];
  /** Shooting disc, direction (radians) and share of maxImpulse. */
  shot: { index: number; angle: number; power: number };
}

const SETUPS: Record<Scenario, Setup> = {
  ball: {
    bodies: [
      { kind: 'disc', x: -3.2, y: 0.25 },
      { kind: 'ball', x: -1.6, y: 0 },
    ],
    shot: { index: 0, angle: -0.08, power: 0.75 },
  },
  disc: {
    bodies: [
      { kind: 'disc', x: -4, y: -0.2 },
      { kind: 'disc', x: -1.5, y: 0 },
      { kind: 'ball', x: 3.5, y: 2.5 },
    ],
    shot: { index: 0, angle: 0.04, power: 0.7 },
  },
  arena: {
    bodies: [
      { kind: 'disc', x: -2.2, y: -2.6 },
      { kind: 'ball', x: -1.2, y: -1.6 },
    ],
    shot: { index: 0, angle: Math.PI / 4, power: 1 },
  },
  shot: {
    bodies: [
      { kind: 'disc', x: -6.2, y: 0 },
      { kind: 'ball', x: 5.5, y: 3.5 },
    ],
    shot: { index: 0, angle: 0.12, power: 1 },
  },
};

interface Run {
  result: ShotResult;
  n: number;
}

async function simulate(config: PhysicsConfig, setup: Setup): Promise<Run> {
  const sim = await FlickSim.create(config);
  const bodies = toF32Bodies(setup.bodies);
  const power = setup.shot.power * config.maxImpulse;
  const result = sim.simulateShot(
    bodies,
    {
      bodyIndex: setup.shot.index,
      ix: Math.fround(Math.cos(setup.shot.angle) * power),
      iy: Math.fround(Math.sin(setup.shot.angle) * power),
    },
    { recordFrames: true },
  );
  return { result, n: bodies.length };
}

function at(run: Run, frame: number, body: number): [number, number] {
  const frames = run.result.frames!;
  const last = Math.floor(frames.length / (run.n * 2)) - 1;
  const f = Math.min(frame, last) * run.n * 2 + body * 2;
  return [frames[f]!, frames[f + 1]!];
}

function trail(run: Run, body: number): string {
  const total = Math.floor(run.result.frames!.length / (run.n * 2));
  const pts: string[] = [];
  for (let f = 0; f < total; f += 3) {
    const [x, y] = at(run, f, body);
    pts.push(`${x.toFixed(2)},${(-y).toFixed(2)}`);
  }
  return pts.join(' ');
}

function stats(run: Run, setup: Setup) {
  const ball = setup.bodies.findIndex((b) => b.kind === 'ball');
  const moved = (i: number) => {
    const [x0, y0] = at(run, 0, i);
    const [x1, y1] = at(run, Number.MAX_SAFE_INTEGER, i);
    return Math.hypot(x1 - x0, y1 - y0);
  };
  return {
    seconds: run.result.ticks * TIME_STEP_SECONDS,
    ball: ball >= 0 ? moved(ball) : 0,
    shooter: moved(setup.shot.index),
    goal: run.result.outcome.startsWith('goal'),
  };
}

export function PhysicsPreview({
  before,
  after,
  scenario,
}: {
  before: PhysicsConfig;
  after: PhysicsConfig;
  scenario: Scenario;
}) {
  const setup = SETUPS[scenario];
  const [runs, setRuns] = useState<{ before: Run; after: Run } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [frame, setFrame] = useState(0);
  const [replay, setReplay] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(true);
  const frameRef = useRef(0);
  frameRef.current = frame;
  const raf = useRef(0);
  const key = JSON.stringify([before, after, scenario]);

  useEffect(() => {
    let cancelled = false;
    const t = window.setTimeout(() => {
      Promise.all([simulate(before, setup), simulate(after, setup)]).then(
        ([b, a]) => {
          if (cancelled) return;
          setRuns({ before: b, after: a });
          setError(null);
          frameRef.current = 0;
          setFrame(0);
          setPlaying(true);
          setReplay((r) => r + 1);
        },
        (err: unknown) => !cancelled && setError(err instanceof Error ? err.message : String(err)),
      );
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key covers the configs
  }, [key]);

  useEffect(() => {
    if (!runs || !playing) return;
    // Plays from the current frame at the chosen speed; stops at the end.
    const total = Math.max(runs.before.result.ticks, runs.after.result.ticks);
    const from = frameRef.current >= total ? 0 : frameRef.current;
    const start = performance.now();
    const tick = (now: number) => {
      const f = Math.min(total, from + Math.floor(((now - start) * speed) / (TIME_STEP_SECONDS * 1000)));
      setFrame(f);
      if (f < total) raf.current = requestAnimationFrame(tick);
      else setPlaying(false);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [runs, replay, playing, speed]);

  const changed = useMemo(() => JSON.stringify(before) !== JSON.stringify(after), [before, after]);
  const a = after.arena;
  const pad = a.goalDepth + 0.3;
  const sb = runs && stats(runs.before, setup);
  const sa = runs && stats(runs.after, setup);

  const bodiesAt = (run: Run, cfg: PhysicsConfig, cls: string) =>
    setup.bodies.map((b, i) => {
      const [x, y] = at(run, frame, i);
      const r = b.kind === 'ball' ? cfg.ball.radius : cfg.disc.radius;
      return <circle key={`${cls}${i}`} cx={x} cy={-y} r={r} className={`ad-sim__${b.kind} ${cls}`} />;
    });

  return (
    <div className="ad-sim">
      <div className="ad-sim__head">
        <b>{tr(`sim.${scenario}`)}</b>
        <span className="ad-sim__legend">
          <i className="is-before" /> {tr('sim.before')} <i className="is-after" /> {tr('sim.after')}
        </span>
      </div>
      <div className="ad-sim__controls">
        <button
          type="button"
          className="admin__btn admin__btn--small"
          onClick={() => setPlaying((p) => !p)}
          aria-label={tr(playing ? 'sim.pause' : 'sim.play')}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <button
          type="button"
          className="admin__btn admin__btn--small"
          onClick={() => {
            setFrame(0);
            frameRef.current = 0;
            setPlaying(true);
            setReplay((r) => r + 1);
          }}
        >
          ↺ {tr('action.replay')}
        </button>
        <input
          className="ad-sim__scrub"
          type="range"
          min={0}
          max={runs ? Math.max(runs.before.result.ticks, runs.after.result.ticks) : 0}
          value={frame}
          aria-label={tr('sim.time')}
          onChange={(e) => {
            setPlaying(false);
            setFrame(Number(e.target.value));
          }}
        />
        <span className="ad-sim__speed" role="radiogroup" aria-label={tr('sim.speed')}>
          {[0.25, 0.5, 1, 2].map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={speed === s}
              className={speed === s ? 'is-active' : ''}
              onClick={() => setSpeed(s)}
            >
              {num(s)}×
            </button>
          ))}
        </span>
        <span className="ad-sim__clock" dir="ltr">
          {(frame * TIME_STEP_SECONDS).toFixed(2)} s
        </span>
      </div>
      <svg
        className="ad-sim__pitch"
        viewBox={`${-a.halfWidth - pad} ${-a.halfHeight - 0.3} ${(a.halfWidth + pad) * 2} ${(a.halfHeight + 0.3) * 2}`}
        role="img"
        aria-label="Physics preview"
      >
        <rect
          x={-a.halfWidth}
          y={-a.halfHeight}
          width={a.halfWidth * 2}
          height={a.halfHeight * 2}
          className="ad-sim__turf"
        />
        {changed && before.arena.goalHalfWidth !== a.goalHalfWidth && (
          <>
            <rect
              x={-a.halfWidth - before.arena.goalDepth}
              y={-before.arena.goalHalfWidth}
              width={before.arena.goalDepth}
              height={before.arena.goalHalfWidth * 2}
              className="ad-sim__goal is-before"
            />
            <rect
              x={a.halfWidth}
              y={-before.arena.goalHalfWidth}
              width={before.arena.goalDepth}
              height={before.arena.goalHalfWidth * 2}
              className="ad-sim__goal is-before"
            />
          </>
        )}
        <rect
          x={-a.halfWidth - a.goalDepth}
          y={-a.goalHalfWidth}
          width={a.goalDepth}
          height={a.goalHalfWidth * 2}
          className="ad-sim__goal"
        />
        <rect
          x={a.halfWidth}
          y={-a.goalHalfWidth}
          width={a.goalDepth}
          height={a.goalHalfWidth * 2}
          className="ad-sim__goal"
        />
        <line x1={0} y1={-a.halfHeight} x2={0} y2={a.halfHeight} className="ad-sim__line" />
        <circle cx={0} cy={0} r={1.4} className="ad-sim__line" fill="none" />
        {runs && (
          <>
            {changed &&
              setup.bodies.map((_, i) => (
                <polyline key={`tb${i}`} points={trail(runs.before, i)} className="ad-sim__trail is-before" />
              ))}
            {setup.bodies.map((_, i) => (
              <polyline key={`ta${i}`} points={trail(runs.after, i)} className="ad-sim__trail is-after" />
            ))}
            {changed && bodiesAt(runs.before, before, 'is-before')}
            {bodiesAt(runs.after, after, 'is-after')}
          </>
        )}
      </svg>
      {error && <p className="admin__error">{error}</p>}
      {sb && sa && (
        <table className="ad-sim__stats">
          <thead>
            <tr>
              <th />
              <th>{tr('sim.colBefore')}</th>
              <th>{tr('sim.colAfter')}</th>
            </tr>
          </thead>
          <tbody>
            <StatRow
              label={tr('sim.time')}
              b={tr('sim.seconds', { n: num(+sb.seconds.toFixed(2)) })}
              a={tr('sim.seconds', { n: num(+sa.seconds.toFixed(2)) })}
            />
            <StatRow label={tr('sim.ballTravel')} b={num(+sb.ball.toFixed(2))} a={num(+sa.ball.toFixed(2))} />
            <StatRow label={tr('sim.discTravel')} b={num(+sb.shooter.toFixed(2))} a={num(+sa.shooter.toFixed(2))} />
            <StatRow
              label={tr('sim.goal')}
              b={tr(sb.goal ? 'sim.yes' : 'sim.no')}
              a={tr(sa.goal ? 'sim.yes' : 'sim.no')}
            />
          </tbody>
        </table>
      )}
      {!changed && <p className="admin__note">{tr('sim.noChange')}</p>}
    </div>
  );
}

function StatRow({ label, b, a }: { label: string; b: string; a: string }) {
  return (
    <tr className={a !== b ? 'is-different' : ''}>
      <th scope="row">{label}</th>
      <td>{b}</td>
      <td>{a}</td>
    </tr>
  );
}
