import type { RulesProfile } from './rules'
import roman020 from './profiles/roman-engineering-0.2.0.json'
import roman030 from './profiles/roman-engineering-0.3.0.json'
import roman040 from './profiles/roman-engineering-0.4.0.json'
import roman050 from './profiles/roman-engineering-0.5.0.json'
import roman060 from './profiles/roman-engineering-0.6.0.json'
import roman070 from './profiles/roman-engineering-0.7.0.json'
import roman080 from './profiles/roman-engineering-0.8.0.json'
import roman090 from './profiles/roman-engineering-0.9.0.json'
import roman0100 from './profiles/roman-engineering-0.10.0.json'
import { ROMAN_ENGINEERING, rulesIdentity, validateRules } from './rules'

/**
 * Every rules profile this build can play. Saves and replays name the profile
 * they were made with; earlier published profiles stay here, frozen as data, so
 * those games keep their rules instead of being refused or reinterpreted.
 */
export const PUBLISHED_RULES: readonly RulesProfile[] = [validateRules(roman020 as unknown as RulesProfile), validateRules(roman030 as unknown as RulesProfile), validateRules(roman040 as unknown as RulesProfile), validateRules(roman050 as unknown as RulesProfile), validateRules(roman060 as unknown as RulesProfile), validateRules(roman070 as unknown as RulesProfile), validateRules(roman080 as unknown as RulesProfile), validateRules(roman090 as unknown as RulesProfile), validateRules(roman0100 as unknown as RulesProfile), ROMAN_ENGINEERING]

export function rulesFor(identity: { id: string, version: string, digest: string }): RulesProfile | null {
  return PUBLISHED_RULES.find(rules => { const own = rulesIdentity(rules); return own.id === identity.id && own.version === identity.version && own.digest === identity.digest }) ?? null
}
