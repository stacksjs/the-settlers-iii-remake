import type { ContentPack, EditionId, FidelityContract } from '../../resources/game/fidelity'
import { tickets } from '../roadmap/catalog'

const manualRevision = '8426388935b436e65b0697ac401c4247ab097364'
const specificationRevision = '200c429d04a1fb503542643f7415fcba1e73049a'
const missingRevisionEvidence = ['distribution', 'locale', 'displayedVersion', 'executableSha256', 'contentManifestSha256', 'patchLineage']

function edition(id: EditionId, label: string, contentPacks: ContentPack[]) {
  return { id, label, contentPacks, revision: { status: 'unverified' as const, missing: [...missingRevisionEvidence] } }
}

export const fidelityContract: FidelityContract = {
  schemaVersion: 1,
  version: '1.0.0',
  sources: [
    {
      id: 'manual-changes', kind: 'manual', revision: manualRevision, path: 'en/changes/changes.htm',
      sha256: '4f9f74e5ca6b57f9af15c23769daa9639307b657a6dee17c4147e65705ae3a74',
      url: `https://github.com/JakeSteam/settlers/blob/${manualRevision}/en/changes/changes.htm`,
    },
    {
      id: 'manual-preparation', kind: 'manual', revision: manualRevision, path: 'en/in_prep/prepare.htm',
      sha256: 'a817e89d071e8daa146f52225d3d4dd5f7566ae92c5cb2731902cff5c2b61462',
      url: `https://github.com/JakeSteam/settlers/blob/${manualRevision}/en/in_prep/prepare.htm`,
    },
    {
      id: 'manual-expansion-changes', kind: 'manual', revision: manualRevision, path: 'tips/main.htm',
      sha256: 'ef7568b47e16897c0d4a80422650d4b1e4dc8c98391654f30ab7e1599e970a17',
      url: `https://github.com/JakeSteam/settlers/blob/${manualRevision}/tips/main.htm`,
    },
    {
      id: 'approved-specification', kind: 'engineering-decision', revision: specificationRevision, path: 'docs/roadmap/specification.md',
      sha256: '7ba46d18b80db42c47e16fab181b558ff1a9ca95f9dec0e23c9a49ea0f051494',
      url: `https://github.com/stacksjs/the-settlers-iii-remake/blob/${specificationRevision}/docs/roadmap/specification.md`,
    },
    {
      id: 'approved-system-catalog', kind: 'engineering-decision', revision: specificationRevision, path: 'docs/roadmap/catalog.ts',
      sha256: '3c33105aae10e057b00f3ac4a0bb5d8798bd27fb59d354a88aa6e79b5a3bdcb5',
      url: `https://github.com/stacksjs/the-settlers-iii-remake/blob/${specificationRevision}/docs/roadmap/catalog.ts`,
    },
  ],
  editions: [
    edition('base', 'Original base game', ['base']),
    edition('mission-cd', 'Mission CD content profile', ['base', 'mission-cd']),
    edition('amazons', 'Amazons content profile', ['base', 'amazons']),
    edition('gold', 'Remake Gold content target', ['base', 'mission-cd', 'amazons']),
  ],
  features: [
    {
      id: 'base-campaigns', summary: 'Roman, Egyptian and Asian campaign choices.',
      evidence: { source: 'manual-preparation', section: 'Campaign' },
      applicability: { base: 'documented', 'mission-cd': 'unverified', amazons: 'unverified', gold: 'product-target' },
    },
    {
      id: 'mission-campaigns', summary: 'A separate campaign set for the three original peoples.',
      evidence: { source: 'manual-expansion-changes', section: '1-001-0' },
      applicability: { base: 'unverified', 'mission-cd': 'documented', amazons: 'unverified', gold: 'product-target' },
    },
    {
      id: 'amazon-campaigns', summary: 'Amazon and allied Three Gods campaign paths.',
      evidence: { source: 'manual-preparation', section: '3. Campaign' },
      applicability: { base: 'unverified', 'mission-cd': 'unverified', amazons: 'documented', gold: 'product-target' },
    },
    {
      id: 'level-editor', summary: 'Editor access from the Mission CD and Amazon CD menus.',
      evidence: { source: 'manual-preparation', section: 'SETTLERS III Level Editor' },
      applicability: { base: 'unverified', 'mission-cd': 'documented', amazons: 'documented', gold: 'product-target' },
    },
    ...[
      ['mission-clock', 'Mission clock and its keyboard toggle.', '5-001-0'],
      ['expanded-unit-inspection', 'Expanded selected-unit type and rank counts.', '5-002-0'],
      ['multiplayer-saves', 'Multiplayer saving and resumed-game entry.', '5-003-0'],
      ['campaign-autosaves', 'Campaign progress autosave after mission statistics.', '5-003-1'],
      ['chat-commands', 'Additional whisper and ignore commands.', '5-004-0'],
      ['economic-mode', 'Goods-oriented victory mode with reduced offensive strength.', '5-005-0'],
    ].map(([id, summary, section]) => ({
      id: id!, summary: summary!, evidence: { source: 'manual-expansion-changes', section: section! },
      applicability: { base: 'unverified' as const, 'mission-cd': 'documented' as const, amazons: 'documented' as const, gold: 'product-target' as const },
    })),
  ],
  systems: tickets.map(ticket => ({ id: ticket.key, title: ticket.title, source: 'approved-system-catalog', status: 'required' })),
  targets: ['browser', 'macos', 'windows', 'linux', 'ios', 'android'],
  originalObservations: [],
}
