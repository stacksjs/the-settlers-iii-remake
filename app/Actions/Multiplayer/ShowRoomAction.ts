import { Action } from '@stacksjs/actions'
import { answer, playerOf } from '../../Multiplayer/Http'
import { RoomError } from '../../Multiplayer/Room'
import { rooms } from '../../Multiplayer/Rooms'

export default new Action({
  name: 'Show Match',
  description: 'The lobby state of a match you are seated in',
  method: 'GET',
  async handle(request) {
    return answer(async () => {
      const player = await playerOf(request)
      const room = rooms.get(String(request.getParam('code') ?? ''))
      const seat = room.seatOf(player.id)
      if (!seat) throw new RoomError('You are not in this match.', 403)
      return { ...room.describe(), you: seat.player }
    })
  },
})
