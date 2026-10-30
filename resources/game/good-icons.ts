/**
 * An icon and a readable name for every good the simulation carries, so the
 * resource bar and the inventory read at a glance instead of as bare keys.
 * Icons are Iconify classes from the Hugeicons set the rest of the interface
 * uses.
 */
const ICONS: Record<string, string> = {
  log: 'i-hugeicons-pine-tree', plank: 'i-hugeicons-layers-01', stone: 'i-hugeicons-stone',
  grain: 'i-hugeicons-wheat', flour: 'i-hugeicons-package-01', water: 'i-hugeicons-glass-water',
  bread: 'i-hugeicons-bread-01', pig: 'i-hugeicons-piggy-bank', meat: 'i-hugeicons-cooking-pot', fish: 'i-hugeicons-fish',
  coal: 'i-hugeicons-fire', ironore: 'i-hugeicons-mountain', goldore: 'i-hugeicons-gold', iron: 'i-hugeicons-anvil', gold: 'i-hugeicons-gold-ingots',
  hammer: 'i-hugeicons-hammer', shovel: 'i-hugeicons-shovel', axe: 'i-hugeicons-axe', saw: 'i-hugeicons-tools', pickaxe: 'i-hugeicons-pickaxe',
  scythe: 'i-hugeicons-scissors', fishingrod: 'i-hugeicons-fishing-rod', sword: 'i-hugeicons-sword-01', spear: 'i-hugeicons-arrow-up-right-01',
  bow: 'i-hugeicons-bow-arrow', wine: 'i-hugeicons-bottle-wine',
}

const NAMES: Record<string, string> = { ironore: 'iron ore', goldore: 'gold ore', fishingrod: 'fishing rod' }

export const goodIcon = (key: string): string => ICONS[key] ?? 'i-hugeicons-package-01'
export const goodName = (key: string): string => NAMES[key] ?? key
