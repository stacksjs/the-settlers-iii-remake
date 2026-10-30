import { Action } from '@stacksjs/actions'
import { answer, playerOf } from '../../Multiplayer/Http'
import { rooms } from '../../Multiplayer/Rooms'

export default new Action({
  name: 'Create Match',
  description: 'Host an online match and take the first seat',
  method: 'POST',
  async handle(request) {
    return answer(async () => {
      const player = await playerOf(request)
      const room = rooms.create(player)
      return { ...room.describe(), you: room.seatOf(player.id)!.player }
    })
  },
})
