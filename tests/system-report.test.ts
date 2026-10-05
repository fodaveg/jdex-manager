import { describe, expect, it } from 'vitest';
import { buildIndex } from '../src/jd/index';
import { staleInboxFindings } from '../src/jd/inbox-stale';
import { previousSystemSnapshot, renderSystemReport } from '../src/jd/system-report';
import { mergeSettings } from '../src/jd/settings';

const index = buildIndex({ systemRoot: '', jdexFolder: 'J', folderPaths: ['20-29 Area', '20-29 Area/21 Cat', '20-29 Area/21 Cat/21.01 Inbox'], notePaths: ['J/21.11 Note.md'] });

describe('system maintenance reports', () => {
  it('renders audit, health and differences using a validated snapshot', () => {
    const prior = renderSystemReport(index, [], [], '2026-10-04', 50, null);
    const report = renderSystemReport(index, [{ kind: 'inbox-stale', paths: ['old.md'], message: 'Old inbox', informative: true }], [], '2026-10-05', 50, prior);
    expect(prior).toContain('Primer informe comparable');
    expect(report).toContain('## Ocupación por categoría');
    expect(report).toContain('| 0 | 1 | +1 |');
    expect(report).not.toContain('NaN');
    expect(previousSystemSnapshot(report)?.findings['inbox-stale']).toBe(1);
  });

  it.each([{}, { findings: null, problems: 0 }, { findings: {}, problems: 0 }, { findings: [], problems: 0, categories: 0, ids: 0, emptyIds: 0, crowdedIds: 0 }, { findings: { unknown: 'x' }, problems: 0, categories: 0, ids: 0, emptyIds: 0, crowdedIds: 0 }])('rejects invalid or edited snapshots %j', (snapshot) => {
    const body = `<!-- jdex-system-snapshot:${encodeURIComponent(JSON.stringify(snapshot))} -->`;
    expect(previousSystemSnapshot(body)).toBeNull();
    expect(renderSystemReport(index, [], [], '2026-10-05', 50, body)).toContain('Primer informe comparable');
  });

  it('uses creation time, only direct inbox children, and a strict configurable age boundary', () => {
    const day = 86400000;
    const now = 100 * day;
    const inbox = '20-29 Area/21 Cat/21.01 Inbox';
    const notes = [
      { path: 'old.pdf', folderPath: inbox, createdAt: now - 31 * day },
      { path: 'exact.md', folderPath: inbox, createdAt: now - 30 * day },
      { path: 'nested.md', folderPath: `${inbox}/nested`, createdAt: day },
      { path: 'future.md', folderPath: inbox, createdAt: now + day },
    ];
    expect(staleInboxFindings(index, notes, 30, now).map((finding) => finding.paths[0])).toEqual(['old.pdf']);
    expect(staleInboxFindings(index, notes, 32, now)).toEqual([]);
    expect(mergeSettings(null).automaticMaintenance).toBe(false);
    expect(mergeSettings({ inboxStaleDays: -1 }).inboxStaleDays).toBe(30);
  });
});
