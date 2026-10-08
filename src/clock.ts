/** Injectable time source. All time-dependent server logic takes a Clock. */
export interface Clock {
  now(): Date;
}

export interface FakeClock extends Clock {
  set(to: Date | string | number): void;
  advance(ms: number): void;
}

export const realClock: Clock = { now: () => new Date() };

export function fakeClock(start: Date | string | number = 0): FakeClock {
  let t = new Date(start).getTime();
  return {
    now: () => new Date(t),
    set: (to) => {
      t = new Date(to).getTime();
    },
    advance: (ms) => {
      t += ms;
    },
  };
}
