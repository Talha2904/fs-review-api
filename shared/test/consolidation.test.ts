import { describe, expect, it } from 'vitest';

import {
  aiInput,
  amountIn,
  applyAiAnswer,
  compareLink,
  consolidate,
  groupCommonPoints,
  groupKeyOf,
  memberNames,
  type AnalysisResult,
  type Doc,
  type GroupMember,
  type LinkCandidate,
  type MemberPoint
} from '../src/analysis/index.js';

// A draft with a balance sheet and an optional related-party note, as the readers produce them.
const draft = (bs: [string, number][], liabilities: [string, number][], note?: { rows?: [string, number][]; text?: string }): Doc => ({
  title: 'Draft',
  blocks: [
    { k: 'head', title: 'Statement of financial position' },
    { k: 'table', cols: ['2025', '2024'], rows: [...bs.map(([l, v]) => ({ l, v: [v, 0] })), { l: 'Total assets', v: [0, 0], b: true }] },
    { k: 'table', cols: ['2025', '2024'], label: 'Liabilities', rows: liabilities.map(([l, v]) => ({ l, v: [v, 0] })) },
    ...(note
      ? [
          { k: 'head', title: 'Note 13 — Related-party transactions' },
          ...(note.rows ? [{ k: 'table', cols: ['GBP'], rows: note.rows.map(([l, v]) => ({ l, v: [v] })) }] : []),
          ...(note.text ? [{ k: 'para', text: note.text }] : [])
        ]
      : [])
  ]
});
const run = (cy: Doc): AnalysisResult => ({ docs: { cy }, K: {}, points: [], varNotes: {}, version: 1, priorResolved: [], demo: false });
const member = (id: string, fund: string, entity: string, cy: Doc | null, extra: Partial<GroupMember> = {}): GroupMember => ({
  engagementId: id,
  fundName: fund,
  entityName: entity,
  currency: 'GBP',
  result: cy ? run(cy) : null,
  aiAllowed: true,
  ...extra
});

describe('grouping and names', () => {
  it('groups by Client name, else the entity name, ignoring case and spacing', () => {
    expect(groupKeyOf(' Alderwick  Group ', 'Alderwick Direct Lending I, L.P.')).toBe('alderwick group');
    expect(groupKeyOf('', 'Cedar Quay Ltd')).toBe('cedar quay ltd');
  });

  it('tells members apart by the words they do not share (the group name says nothing)', () => {
    const n = memberNames([
      { engagementId: 'dl', fundName: 'Alderwick DL', entityName: 'Alderwick Direct Lending I, L.P.' },
      { engagementId: 'pe', fundName: 'Alderwick PE', entityName: 'Alderwick Private Equity II, L.P.' },
      { engagementId: 'im', fundName: 'Alderwick IM', entityName: 'Alderwick Investment Management Limited' }
    ]);
    expect(n.get('dl')).toContainEqual(['direct', 'lending']);
    expect(n.get('im')).toContainEqual(['investment', 'management']);
    expect(n.get('pe')!.flat()).not.toContain('alderwick');
  });
});

describe('inter-entity balances', () => {
  const members = [
    member(
      'dl',
      'Direct Lending I',
      'Alderwick Direct Lending I, L.P.',
      draft([['Loans to portfolio companies', 900]], [['Amount due to Alderwick Private Equity II', 5000]])
    ),
    member(
      'pe',
      'Private Equity II',
      'Alderwick Private Equity II, L.P.',
      draft([['Amount due from Alderwick Direct Lending I', 4200]], [['Trade payables', 30]])
    )
  ];

  it('pairs a receivable naming B with B’s payable naming A, and shows the difference', () => {
    const r = consolidate(members, []);
    expect(r.links).toHaveLength(1);
    const [l] = r.links;
    expect(new Set([l!.a.engagementId, l!.b.engagementId])).toEqual(new Set(['dl', 'pe']));
    expect(l!.status).toBe('differs');
    expect(Math.abs(l!.difference!)).toBe(800);
    expect(l!.matchedBy).toBe('app');
  });

  it('agrees within the tolerance, and never compares different currencies', () => {
    const a = {
      id: 'a',
      engagementId: 'x',
      fundName: 'X',
      where: '',
      label: '',
      amount: 1000,
      currency: 'GBP',
      side: 'receivable',
      mentions: []
    } as LinkCandidate;
    expect(compareLink(a, { ...a, id: 'b', engagementId: 'y', amount: -1000.5 }).status).toBe('agrees');
    expect(compareLink(a, { ...a, id: 'b', engagementId: 'y', currency: 'EUR' })).toEqual({
      status: 'different-currency',
      difference: null
    });
    expect(compareLink(a, { ...a, id: 'b', engagementId: 'y', amount: null })).toEqual({ status: 'no-amount', difference: null });
  });

  it('keeps a line that names another member but has no partner as unmatched, and ignores ordinary lines', () => {
    const r = consolidate(
      [
        members[0]!,
        member('pe', 'Private Equity II', 'Alderwick Private Equity II, L.P.', draft([['Cash', 10]], [['Trade payables', 30]]))
      ],
      []
    );
    expect(r.links).toHaveLength(0);
    expect(r.unmatched.map((c) => c.label)).toEqual(['Amount due to Alderwick Private Equity II']);
  });

  it('finds related-party note lines and amounts written in the note, even when named only by role', () => {
    const r = consolidate(
      [
        member(
          'dl',
          'Direct Lending I',
          'Alderwick Direct Lending I, L.P.',
          draft([['Cash', 10]], [['Trade payables', 30]], {
            rows: [
              ['Management fee charged by connected manager', 1687500],
              ['Outstanding manager fee', 421875]
            ]
          })
        ),
        member(
          'im',
          'Investment Management',
          'Alderwick Investment Management Limited',
          draft([['Fees receivable from managed funds', 421875]], [['Accruals', 10]])
        )
      ],
      []
    );
    const labels = r.unmatched.map((c) => `${c.engagementId}:${c.label}:${c.side}`);
    expect(labels).toContain('dl:Outstanding manager fee:payable');
    expect(labels).toContain('dl:Management fee charged by connected manager:flow');
    expect(labels).toContain('im:Fees receivable from managed funds:receivable');
  });

  it('a fund not yet analysed is listed but contributes nothing', () => {
    const r = consolidate([...members, member('nx', 'New Fund', 'Alderwick New Fund LP', null)], []);
    expect(r.members.find((m) => m.engagementId === 'nx')).toMatchObject({ analysed: false });
    expect(r.candidates.some((c) => c.engagementId === 'nx')).toBe(false);
  });
});

describe('common review points', () => {
  const pts: MemberPoint[] = [
    { engagementId: 'a', ref: 'RP-01', title: 'Casting — difference of £1,200', rule: 'CHK-03', status: 'open' },
    { engagementId: 'b', ref: 'RP-04', title: 'Casting — difference of £50', rule: 'CHK-03', status: 'responded' },
    { engagementId: 'a', ref: 'RP-02', title: 'Borrowings classified as non-current although due within 12 months', status: 'open' },
    { engagementId: 'b', ref: 'RP-07', title: 'Borrowings classified as non-current although due within 12 months', status: 'open' },
    { engagementId: 'c', ref: 'RP-01', title: 'Borrowings classified as non-current although due within 12 months', status: 'cleared' },
    { engagementId: 'a', ref: 'RP-03', title: 'Director who resigned is still listed', status: 'open' }
  ];
  it('groups the same check, and the same title across funds; cleared points and one-fund matters are left out', () => {
    const { groups, rest } = groupCommonPoints(pts, (id) => id.toUpperCase());
    expect(groups.map((g) => [g.key, g.points.map((p) => `${p.engagementId}:${p.ref}`)])).toEqual([
      ['rule:CHK-03', ['a:RP-01', 'b:RP-04']],
      ['title:borrowings classified as non current although due within months', ['a:RP-02', 'b:RP-07']]
    ]);
    expect(rest.map((p) => p.ref)).toEqual(['RP-03']);
  });
});

describe('the AI step: what it is given and how its answer is checked', () => {
  const cands: LinkCandidate[] = [
    {
      id: 'dl#1',
      engagementId: 'dl',
      fundName: 'DL',
      where: 'Note 13',
      label: 'Outstanding manager fee',
      amount: 421875,
      currency: 'GBP',
      side: 'payable',
      mentions: []
    },
    {
      id: 'im#1',
      engagementId: 'im',
      fundName: 'IM',
      where: 'Balance sheet',
      label: 'Fees receivable from managed funds',
      amount: 400000,
      currency: 'GBP',
      side: 'receivable',
      mentions: []
    },
    {
      id: 'no#1',
      engagementId: 'no',
      fundName: 'NO',
      where: 'Balance sheet',
      label: 'Due to manager',
      amount: 5,
      currency: 'GBP',
      side: 'payable',
      mentions: []
    }
  ];
  const rest: MemberPoint[] = [
    { engagementId: 'dl', ref: 'RP-02', title: 'Management fee accrual understated', status: 'open' },
    { engagementId: 'im', ref: 'RP-05', title: 'Fee income from funds overstated', status: 'open' }
  ];

  it('sends only funds whose client permits AI', () => {
    const members = [
      member('dl', 'DL', 'A DL', null),
      member('im', 'IM', 'A IM', null),
      member('no', 'NO', 'A NO', null, { aiAllowed: false })
    ];
    const input = aiInput(members, cands, rest);
    expect(input.members.map((m) => m.id)).toEqual(['dl', 'im']);
    expect(input.lines.map((l) => l.id)).toEqual(['dl#1', 'im#1']);
  });

  it('uses only real, unused lines and points from two funds, and works out the difference itself', () => {
    const out = applyAiAnswer(
      {
        pairs: [
          { a: 'dl#1', b: 'im#1', relationship: 'Management fee', note: 'Same balance from each side', difference: 999 },
          { a: 'dl#1', b: 'no#1' },
          { a: 'ghost', b: 'im#1' },
          { a: 'im#1', b: 'im#1' }
        ] as never,
        groups: [
          {
            title: 'Management fee cut-off',
            points: [
              { fund: 'dl', ref: 'RP-02' },
              { fund: 'im', ref: 'RP-05' },
              { fund: 'dl', ref: 'RP-99' }
            ]
          }
        ],
        summary: 'One fee balance differs by 21,875.'
      },
      cands,
      rest,
      (id) => id
    );
    expect(out.links).toHaveLength(1);
    expect(out.links[0]).toMatchObject({ status: 'differs', difference: 21875, matchedBy: 'ai', relationship: 'Management fee' });
    expect(out.groups).toHaveLength(1);
    expect(out.groups[0]!.points.map((p) => p.ref)).toEqual(['RP-02', 'RP-05']);
    expect(out.summary).toBe('One fee balance differs by 21,875.');
  });

  it('ignores a malformed answer', () => {
    expect(applyAiAnswer({ pairs: 'x' as never, groups: [{}] as never }, cands, rest, (id) => id)).toEqual({
      links: [],
      groups: [],
      summary: ''
    });
  });
});

describe('a member named only by the group’s shared words', () => {
  it('is still recognised by its full name ("ABC Fund" among ABC entities)', () => {
    const n = memberNames([
      { engagementId: 'f', fundName: 'ABC Fund', entityName: 'ABC Funds ICAV' },
      { engagementId: 'l', fundName: 'ABC Lending', entityName: 'ABC Lending LP' }
    ]);
    expect(n.get('f')).toEqual([['abc'], ['abc']]);
    expect(n.get('l')).toContainEqual(['lending']);
  });
});

describe('audit fixes', () => {
  it('tells numbered funds apart, but does not need the number when the name alone is unique', () => {
    const n = memberNames([
      { engagementId: 'f1', fundName: 'ABC Fund I', entityName: 'ABC Fund I LP' },
      { engagementId: 'f2', fundName: 'ABC Fund II', entityName: 'ABC Fund II LP' },
      { engagementId: 'f3', fundName: 'ABC Fund III', entityName: 'ABC Fund III LP' }
    ]);
    expect(n.get('f1')).toContainEqual(['abc', 'i']);
    expect(n.get('f2')).toContainEqual(['abc', 'ii']);
    const cy = draft([['Amount due from ABC Fund II', 500]], [['Amount due to ABC Fund III', 300]]);
    const members = [
      member('f1', 'ABC Fund I', 'ABC Fund I LP', cy),
      member('f2', 'ABC Fund II', 'ABC Fund II LP', draft([], [])),
      member('f3', 'ABC Fund III', 'ABC Fund III LP', draft([], []))
    ];
    const c = consolidate(members, []).candidates;
    expect(c.find((x) => x.label.includes('II') && !x.label.includes('III'))!.mentions).toEqual(['f2']);
    expect(c.find((x) => x.label.includes('III'))!.mentions).toEqual(['f3']);
  });

  it('a member known only by the shared words loses to one named precisely', () => {
    const members = [
      member('f', 'ABC Fund', 'ABC Fund LP', draft([['Amount due from ABC Holdings', 100]], [])),
      member('p', 'ABC Property', 'ABC Property Ltd', draft([], [['Amount due to ABC Holdings', 70]])),
      member('h', 'ABC Holdings', 'ABC Holdings Ltd', draft([], [['Amounts due to ABC Property', 70]]))
    ];
    const r = consolidate(members, []);
    // Holdings' payable is owed to Property, so it pairs with Property, never with ABC Fund
    const holdingsLine = r.candidates.find((x) => x.engagementId === 'h')!;
    expect(holdingsLine.mentions).toEqual(['p']);
    expect(r.links.some((l) => [l.a.engagementId, l.b.engagementId].sort().join() === 'f,h')).toBe(false);
  });

  it('reads amounts, not years, from note sentences', () => {
    expect(amountIn('At 31 December 2024 the company owed ABC Holdings 50,000.')).toBe(50000);
    expect(amountIn('In 2025 a fee of £4,200 was charged.')).toBe(4200);
    expect(amountIn('A loan of 125000 was advanced.')).toBe(125000);
    expect(amountIn('Since 2019 nothing was owed.')).toBeNull();
  });

  it('never compares a prior-year figure, and reads accrued income as owed to the fund', () => {
    const cy: Doc = {
      title: 'Draft',
      blocks: [
        { k: 'head', title: 'Note 9 — Related party transactions' },
        {
          k: 'table',
          cols: ['2025', '2024'],
          rows: [
            { l: 'Loan to ABC Property', v: [null, 40000] },
            { l: 'Accrued income from ABC Property', v: [900, 0] }
          ]
        }
      ]
    };
    const r = consolidate([member('f', 'ABC Fund', 'ABC Fund LP', cy), member('p', 'ABC Property', 'ABC Property Ltd', draft([], []))], []);
    expect(r.candidates.find((x) => x.label.startsWith('Loan'))!.amount).toBeNull();
    expect(r.candidates.find((x) => x.label.startsWith('Accrued'))!.side).toBe('receivable');
  });
});
