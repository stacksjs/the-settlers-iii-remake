import type { Session } from './engine'

/** A one-use order for the building shown when confirmation opened. */
export function prepareDemolition(current: () => Session | null, player: number, id: number, send: (id: number) => string | null) {
  const session = current(), building = session?.state.buildings.get(id)
  if (!session || !building || building.owner !== player || building.type === 'castle') return null
  const name = session.rules.buildings.find(rule => rule.id === building.type)!.name
  let answered = false
  return {
    name,
    confirm(): string | null {
      if (answered) return 'This demolition order has already been answered.'
      answered = true
      if (current() !== session || session.state.buildings.get(id) !== building || building.owner !== player) return 'That building is no longer available to tear down.'
      return send(id)
    },
  }
}
