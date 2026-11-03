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
import roman0110 from './profiles/roman-engineering-0.11.0.json'
import roman0120 from './profiles/roman-engineering-0.12.0.json'
import roman0130 from './profiles/roman-engineering-0.13.0.json'
import roman0140 from './profiles/roman-engineering-0.14.0.json'
import roman0150 from './profiles/roman-engineering-0.15.0.json'
import roman0160 from './profiles/roman-engineering-0.16.0.json'
import roman0170 from './profiles/roman-engineering-0.17.0.json'
import roman0180 from './profiles/roman-engineering-0.18.0.json'
import amazon010 from './profiles/amazon-engineering-0.1.0.json'
import asian010 from './profiles/asian-engineering-0.1.0.json'
import egyptian010 from './profiles/egyptian-engineering-0.1.0.json'
import { ROMAN_ENGINEERING, rulesIdentity, validateRules } from './rules'

/**
 * Every rules profile this build can play. Saves and replays name the profile
 * they were made with; earlier published profiles stay here, frozen as data, so
 * those games keep their rules instead of being refused or reinterpreted.
 */
export const PUBLISHED_RULES: readonly RulesProfile[] = [validateRules(roman020 as unknown as RulesProfile), validateRules(roman030 as unknown as RulesProfile), validateRules(roman040 as unknown as RulesProfile), validateRules(roman050 as unknown as RulesProfile), validateRules(roman060 as unknown as RulesProfile), validateRules(roman070 as unknown as RulesProfile), validateRules(roman080 as unknown as RulesProfile), validateRules(roman090 as unknown as RulesProfile), validateRules(roman0100 as unknown as RulesProfile), validateRules(roman0110 as unknown as RulesProfile), validateRules(roman0120 as unknown as RulesProfile), validateRules(roman0130 as unknown as RulesProfile), validateRules(roman0140 as unknown as RulesProfile), validateRules(roman0150 as unknown as RulesProfile), validateRules(roman0160 as unknown as RulesProfile), validateRules(roman0170 as unknown as RulesProfile), validateRules(roman0180 as unknown as RulesProfile), ROMAN_ENGINEERING, validateRules(egyptian010 as unknown as RulesProfile), validateRules(asian010 as unknown as RulesProfile), validateRules(amazon010 as unknown as RulesProfile)]

export function rulesFor(identity: { id: string, version: string, digest: string }): RulesProfile | null {
  return PUBLISHED_RULES.find(rules => { const own = rulesIdentity(rules); return own.id === identity.id && own.version === identity.version && own.digest === identity.digest }) ?? null
}

/** The Egyptian engineering profile: manual costs and reference geometry for the Egyptians, Roman placeholders elsewhere. */
const published = (id: string): RulesProfile => PUBLISHED_RULES.find(rules => rules.id === id && rules.version === '0.1.0')!
export const EGYPTIAN_ENGINEERING: RulesProfile = published('egyptian-engineering')
/** The Asian engineering profile: rice and liquor, a sulfur mine, the small and large pagoda. */
export const ASIAN_ENGINEERING: RulesProfile = published('asian-engineering')
/** The Amazon engineering profile: honey and mead, an alchemist's den, gem and sulfur mines. */
export const AMAZON_ENGINEERING: RulesProfile = published('amazon-engineering')
