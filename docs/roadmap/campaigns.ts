// Planning slots, not decoded original identifiers or completed observations.
// Reconcile every slot against licensed original data in S3-006 before implementation.
const groups = [
  { issue: 'S3-076', prefix: 'base-roman', name: 'Base Roman', count: 8 },
  { issue: 'S3-077', prefix: 'base-egyptian', name: 'Base Egyptian', count: 8 },
  { issue: 'S3-078', prefix: 'base-asian', name: 'Base Asian', count: 8 },
  { issue: 'S3-079', prefix: 'mission-roman', name: 'Mission CD Roman', count: 8 },
  { issue: 'S3-079', prefix: 'mission-egyptian', name: 'Mission CD Egyptian', count: 8 },
  { issue: 'S3-079', prefix: 'mission-asian', name: 'Mission CD Asian', count: 8 },
  { issue: 'S3-080', prefix: 'amazons', name: 'Amazons path', count: 12 },
  { issue: 'S3-080', prefix: 'three-gods', name: 'Three Gods path', count: 12 },
]

export function campaignAcceptanceTable(issue: string): string {
  if (!['S3-076', 'S3-077', 'S3-078', 'S3-079', 'S3-080', 'S3-082'].includes(issue)) return ''
  const slots = groups.filter(group => issue === 'S3-082' || group.issue === issue)
    .flatMap(group => Array.from({ length: group.count }, (_, index) => `${group.prefix}-${(index + 1).toString().padStart(2, '0')} (${group.name} ${index + 1})`))
  if (issue === 'S3-076' || issue === 'S3-082') slots.unshift('tutorial (expand if the verified edition contains additional tutorials)')
  return `## Per-mission acceptance ledger

These are planning slots. Original file identifiers, revisions, names, starting conditions, objectives, timings, and evidence are unverified until S3-002/006/007 establish them. Reconcile counts and add any missing original missions before closing this issue. Do not convert an unchecked cell into a passing result without a retained fixture and receipt.

The [preserved original manual](https://settlers.jakelee.co.uk/en/in_prep/prepare.htm) identifies the tutorial, base factions, Mission CD, Amazons and Three Gods paths. The [campaign index](https://strategywiki.org/wiki/The_Settlers_III/Table_of_Contents) supplies the provisional eight-mission and twelve-mission slot counts; it is secondary evidence, not authority for mission behavior.

For every row, record the original map ID/hash and rules revision; starting players, terrain, goods and units; exact objectives/triggers and failure conditions; briefing, voice/cinematic and localization; checkpoint restoration mid-trigger; victory, unlocks/branches and ending; and links to original observation plus browser/native captures.

| Planning slot | Original ID/hash and start | Objectives/triggers/failure | Media/localization | Save/restore | Victory/progression and evidence |
|---|---|---|---|---|---|
${slots.map(slot => `| ${slot} | [ ] unverified | [ ] unverified | [ ] unverified | [ ] unverified | [ ] unverified |`).join('\n')}

`
}
