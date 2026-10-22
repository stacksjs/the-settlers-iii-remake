import type { RulesProfile } from './rules'
import roman020 from './profiles/roman-engineering-0.2.0.json'
import roman030 from './profiles/roman-engineering-0.3.0.json'
import { ROMAN_ENGINEERING, rulesIdentity, validateRules } from './rules'

/**
 * Every rules profile this build can play. Saves and replays name the profile
 * they were made with; earlier published profiles stay here, frozen as data, so
 * those games keep their rules instead of being refused or reinterpreted.
 */
export const PUBLISHED_RULES: readonly RulesProfile[] = [validateRules(roman020 as unknown as RulesProfile), validateRules(roman030 as unknown as RulesProfile), ROMAN_ENGINEERING]

export function rulesFor(identity: { id: string, version: string, digest: string }): RulesProfile | null {
  return PUBLISHED_RULES.find(rules => { const own = rulesIdentity(rules); return own.id === identity.id && own.version === identity.version && own.digest === identity.digest }) ?? null
}
