import { Action } from '@stacksjs/actions'
import { answer, playerOf } from '../../Multiplayer/Http'
import { RoomError } from '../../Multiplayer/Room'
import { rooms } from '../../Multiplayer/Rooms'

export default new Action({
  name: 'Match Snapshot',
  description: 'The whole world at the current turn, to start from or to recover after missed turns',
  method: 'GET',
  async handle(request) {
    return answer(async () => {
      const player = await playerOf(request)
      const room = rooms.get(String(request.getParam('code') ?? ''))
      if (!room.seatOf(player.id)) throw new RoomError('You are not in this match.', 403)
      return { ...room.snapshot(), you: room.seatOf(player.id)!.player }
    })
  },
})
