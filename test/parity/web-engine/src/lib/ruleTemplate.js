// Check rules per engagement: the firm's template applies live, and an engagement stores only its
// overrides (ruleOverrides: { ruleId: { on, tol, tolKind } }). Engagements saved before this keep a full
// copy in `rules`; that copy is used as-is and becomes overrides (its differences) on the next save.
export const sameRule = (a, b) => !!a?.on === !!b?.on && Number(a?.tol ?? NaN) === Number(b?.tol ?? NaN) && (a?.tolKind || '') === (b?.tolKind || '')
  || (!!a?.on === !!b?.on && a?.tol == null && b?.tol == null && (a?.tolKind || '') === (b?.tolKind || ''));
export function effectiveRules(eng, template) {
  if (eng?.ruleOverrides) return { ...template, ...Object.fromEntries(Object.entries(eng.ruleOverrides).map(([id, o]) => [id, { ...(template[id] || {}), ...o }])) };
  if (eng?.rules) return { ...template, ...eng.rules };
  return { ...template };
}
// The client's (entity's) overrides applied to the firm template: the base a fund starts from.
export const withOverrides = (template, overrides) => ({ ...template, ...Object.fromEntries(Object.entries(overrides || {}).map(([id, o]) => [id, { ...(template[id] || {}), ...o }])) });
export const overridesOf = (rules, template) => Object.fromEntries(Object.entries(rules || {})
  .filter(([id, r]) => !sameRule(r, template[id])).map(([id, r]) => [id, { on: !!r.on, tol: r.tol, tolKind: r.tolKind }]));
