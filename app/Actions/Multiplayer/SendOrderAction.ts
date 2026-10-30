import { Action } from '@stacksjs/actions'
import { answer, playerOf } from '../../Multiplayer/Http'
import { rooms } from '../../Multiplayer/Rooms'

export default new Action({
  name: 'Send Order',
  description: 'Queue an order for the next turn. The server stamps whose it is.',
  method: 'POST',
  async handle(request) {
    return answer(async () => {
      const player = await playerOf(request)
      const room = rooms.get(String(request.getParam('code') ?? ''))
      room.submit(player.id, request.get('type'), request.get('fields'))
      return { queued: true }
    })
  },
})
