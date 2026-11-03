// Which reference building definition the preserved manual prices under which name.
// Shared by the generator in scripts/manual-construction.ts and the faction rules
// profiles, so the mapping exists once.
export const RACES = ['roman', 'egyptian', 'asian', 'amazon'] as const
export type Race = typeof RACES[number]
export type Cost = [wood: number, stone: number]

/** Reference definition file to the manual's common building name. */
export const COMMON: Record<string, string> = {
  baker: 'Bakery', barrack: 'Barracks', big_livinghouse: 'Large Residence', big_tower: 'Large Guard Tower', castle: 'Castle', coalmine: 'Coal Mine', dockyard: 'Shipyard',
  farm: 'Grain Farm', fisher: "Fisherman's Hut", forester: "Forester's Hut", goldmelt: 'Gold Smelting Works', goldmine: 'Gold Mine', harbor: 'Landing Dock', hospital: "Healer's Hut",
  ironmelt: 'Iron Smelting Works', ironmine: 'Iron Mine', lookout_tower: 'Lookout Tower', lumberjack: "Woodcutter's Hut", market_place: 'Marketplace', medium_livinghouse: 'Medium Residence',
  mill: 'Grain Mill', pig_farm: 'Pig Farm', sawmill: 'Sawmill', slaughterhouse: 'Slaughterhouse', small_livinghouse: 'Small Residence', stock: 'Storage Area', stonecutter: "Stonecutter's Hut",
  toolsmith: "Tool Smith's Works", tower: 'Small Guard Tower', waterworks: 'Waterworks', weaponsmith: "Weapon Smith's Works",
}
/** Reference definition file to the manual's name for the buildings only one civilization has. */
export const SPECIFIC: Record<Race, Record<string, string>> = {
  roman: { big_temple: 'Large Temple', temple: 'Small Temple', winegrower: 'Winery', charcoal_burner: "Charcoal Maker's Hut" },
  egyptian: { big_temple: 'Pyramid', temple: 'Sphinx', brewery: 'Brewery', gemsmine: 'Gem Mine' },
  asian: { big_temple: 'Large Pagoda', temple: 'Small Pagoda', distillery: 'Distillery', rice_farm: 'Rice Farm', sulfurmine: 'Sulfur Mine' },
  amazon: { big_temple: 'Large Temple', temple: 'Small Temple', beekeeping: "Beekeeper's Hut", mead_brewery: 'Mead Maker\'s Works', laboratory: "Alchemist's Den", gemsmine: 'Gem Mine', sulfurmine: 'Sulfur Mine' },
}

