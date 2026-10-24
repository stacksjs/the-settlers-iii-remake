// The Control Center (manual: Menus in the Game, The Control Center). Three main
// buttons open the Buildings, Goods and Settlers menus; each holds the sub-menus
// the manual lists. The control center remembers the last sub-menu of each main
// menu, so switching back returns where the player left it.

export const MENUS = {
  buildings: ['resources', 'food', 'military', 'misc'],
  goods: ['inventory', 'tools', 'distribution', 'transport'],
  settlers: ['statistics', 'occupations', 'military', 'production'],
} as const
export type Main = keyof typeof MENUS
export type Sub<M extends Main = Main> = (typeof MENUS)[M][number]
export interface MenuState { main: Main, sub: string, last: Partial<Record<Main, string>> }

export const LABELS: Record<string, string> = {
  buildings: 'Buildings', goods: 'Goods', settlers: 'Settlers',
  resources: 'Resources', food: 'Food', military: 'Military', misc: 'Misc.',
  inventory: 'Inventory', tools: 'Tools and weapons', distribution: 'Distribution', transport: 'Transport',
  statistics: 'Statistics', occupations: 'Occupations', production: 'Production statistics',
}

// MainPanel.java at the pinned remake revision maps these menu meanings to
// original GUI images. Keep application menu names separate from image names.
const MAIN_IMAGES: Record<string, string> = { buildings: 'build', goods: 'goods', settlers: 'settlers' }
const SUB_IMAGES: Record<Main, Record<string, string>> = {
  buildings: { resources: 'build-resources', food: 'build-food', military: 'build-military', misc: 'build-social' },
  goods: { inventory: 'goods-stock', tools: 'goods-tools', distribution: 'goods-distribution', transport: 'goods-transport' },
  settlers: { statistics: 'settlers-statistics', occupations: 'settlers-professions', military: 'settlers-warriors', production: 'settlers-production' },
}

/** Original active/inactive art follows the same menu state as its controls. */
export function menuImage(main: string, sub: string | null, active: boolean): string {
  const key = sub === null ? MAIN_IMAGES[main] : SUB_IMAGES[main as Main]?.[sub]
  if (!key) throw new Error(`Unknown control center image: ${main}/${sub}`)
  return `/assets/settlers-original/ui/${key}-${active ? 'active' : 'inactive'}.png`
}

export const initialMenu = (): MenuState => ({ main: 'buildings', sub: 'resources', last: {} })

/** Opens a main menu at the sub-menu the player last used there. Unknown menus leave the state as it was. */
export function openMenu(state: MenuState, main: string): MenuState {
  if (!(main in MENUS)) return state
  const m = main as Main, subs = MENUS[m] as readonly string[]
  const sub = state.last[m] && subs.includes(state.last[m]!) ? state.last[m]! : subs[0]!
  return { main: m, sub, last: { ...state.last, [state.main]: state.sub } }
}

/** Chooses a sub-menu of the open main menu. Sub-menus of another menu are refused. */
export function chooseMenu(state: MenuState, sub: string): MenuState {
  if (!(MENUS[state.main] as readonly string[]).includes(sub)) return state
  return { ...state, sub, last: { ...state.last, [state.main]: sub } }
}

/**
 * Which Buildings sub-menu lists each building. The manual names the contents:
 * resources hold the woodcutter, stonecutter, mines, smelting works and tool
 * smith; food holds farms, mills, bakeries, waterworks and slaughterhouses;
 * military holds barracks, the weapon smith, castles and towers; misc holds
 * religious and residential buildings, the storage area, marketplace and dock.
 */
export const BUILDING_MENU: Record<string, Sub<'buildings'>> = {
  'woodcutter': 'resources', 'forester': 'resources', 'stonecutter': 'resources', 'sawmill': 'resources', 'coal-mine': 'resources', 'iron-mine': 'resources', 'gold-mine': 'resources',
  'iron-smelter': 'resources', 'gold-smelter': 'resources', 'toolsmith': 'resources', 'charcoal-maker': 'resources',
  'fisher': 'food', 'grain-farm': 'food', 'waterworks': 'food', 'mill': 'food', 'bakery': 'food', 'pig-farm': 'food', 'slaughterhouse': 'food', 'winery': 'food',
  'barracks': 'military', 'weaponsmith': 'military', 'castle': 'military', 'small-tower': 'military', 'large-tower': 'military', 'lookout-tower': 'military', 'healers-hut': 'military',
  'storage': 'misc', 'small-residence': 'misc', 'medium-residence': 'misc', 'large-residence': 'misc', 'small-temple': 'misc', 'large-temple': 'misc',
}
