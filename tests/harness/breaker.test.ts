import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { apply, CLOSED, decide, mayRun, record, RULES, type Breaker } from '../../src/harness/breaker';

const t0 = new Date('2026-11-16T12:00:00Z');
const later = (min: number) => new Date(t0.getTime() + min * 60_000);
const fail = (failure: string) => ({ ok: false, failure });
const run = (b: Breaker, ...outcomes: { ok: boolean; failure?: string }[]) => outcomes.reduce((s, o) => apply(s, o, t0), b);

describe('circuit breaker (крок 03, шар харнеса)', () => {
  it('квота (429) відкриває одразу, з першої відмови', () => {
    const b = run(CLOSED, fail('quota'));
    expect(b.state).toBe('open');
    expect(b.trip).toContain('квот');
  });

  it(`${RULES.sameFailures} однакові відмови підряд відкривають; різні — ні`, () => {
    expect(run(CLOSED, fail('timeout'), fail('timeout')).state).toBe('closed');
    expect(run(CLOSED, fail('timeout'), fail('timeout'), fail('timeout')).state).toBe('open');
    expect(run(CLOSED, fail('timeout'), fail('agent_failed'), fail('timeout')).state).toBe('closed');
  });

  it(`${RULES.noProgress} задач підряд без прогресу відкривають, навіть різні`, () => {
    const b = run(CLOSED, fail('a'), fail('b'), fail('a'), fail('b'), fail('a'));
    expect(b.state).toBe('open');
    expect(b.trip).toContain('без прогресу');
  });

  it('зелена задача скидає лічильники', () => {
    const b = run(CLOSED, fail('timeout'), fail('timeout'), { ok: true }, fail('timeout'));
    expect(b).toMatchObject({ state: 'closed', sameFails: 1, noProgress: 1 });
  });

  it('open: до кінця перепочинку не пускає; після — рівно одна пробна задача', () => {
    const open = run(CLOSED, fail('quota'));
    expect(decide(open, later(RULES.cooldownMin - 1)).decision.allow).toBe(false);
    const first = decide(open, later(RULES.cooldownMin));
    expect(first.decision).toMatchObject({ allow: true, probe: true });
    expect(first.next.state).toBe('half-open');
    // друга задача, поки проба не повернулась, — ні
    expect(decide(first.next, later(RULES.cooldownMin)).decision.allow).toBe(false);
  });

  it('half-open: зелена проба закриває; червона — open з подвоєним перепочинком', () => {
    const half = decide(run(CLOSED, fail('quota')), later(RULES.cooldownMin)).next;
    expect(apply(half, { ok: true }, t0).state).toBe('closed');
    const reopened = apply(half, fail('quota'), t0);
    expect(reopened).toMatchObject({ state: 'open', cooldownMin: RULES.cooldownMin * 2 });
    expect(reopened.trip).toContain('пробна');
  });

  it('стан живе у файлі: новий «процес» бачить open', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'breaker-')), '.harness', 'breaker.json');
    expect(mayRun(t0, file).allow).toBe(true);
    record(fail('quota'), t0, file);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ state: 'open' });
    expect(mayRun(later(1), file).allow).toBe(false);
    expect(mayRun(later(RULES.cooldownMin), file)).toMatchObject({ allow: true, probe: true });
    expect(mayRun(later(RULES.cooldownMin), file).allow).toBe(false); // друга проба — ні
    expect(record({ ok: true }, later(RULES.cooldownMin + 2), file).state).toBe('closed');
  });
});
