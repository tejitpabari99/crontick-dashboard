import { lstatSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { installSkill } from '../../src/skill/install.js';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'skill-install-'));
  const skillPath = join(root, 'SKILL.md');
  writeFileSync(skillPath, '# v1\n');
  const skillsDir = join(root, 'skills');
  const dest = join(skillsDir, 'crontick-dashboard', 'SKILL.md');
  return { skillPath, skillsDir, dest, version: '1.0.0' };
}

describe('installSkill', () => {
  it('installs a regular file, then reports up-to-date', () => {
    const s = setup();
    expect(installSkill(s)).toEqual({ status: 'installed', dest: s.dest });
    expect(readFileSync(s.dest, 'utf8')).toBe('# v1\n');
    expect(lstatSync(s.dest).isSymbolicLink()).toBe(false);
    expect(installSkill(s).status).toBe('up-to-date');
  });
  it('a differing install throws without force and is overwritten with it, leaving no tmp file', () => {
    const s = setup();
    installSkill(s);
    writeFileSync(s.dest, 'edited');
    expect(() => installSkill(s)).toThrowError(expect.objectContaining({ code: 'SKILL_DIFFERS' }));
    expect(readFileSync(s.dest, 'utf8')).toBe('edited');
    expect(installSkill({ ...s, force: true }).status).toBe('installed');
    expect(readFileSync(s.dest, 'utf8')).toBe('# v1\n');
    expect(readdirSync(join(s.skillsDir, 'crontick-dashboard'))).toEqual(['SKILL.md']);
  });
  it('missing packaged skill throws not-found', () => {
    const s = setup();
    expect(() => installSkill({ ...s, skillPath: join(s.skillsDir, 'nope.md') })).toThrowError(expect.objectContaining({ code: 'SKILL_NOT_FOUND' }));
  });
});
