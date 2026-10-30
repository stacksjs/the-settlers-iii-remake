/**
 * Route Registry
 *
 * The framework's default registry plus this game's own route file. Online
 * matches live in `routes/multiplayer.ts`, behind the auth middleware.
 *
 * @see https://docs.stacksjs.com/routing
 */
import defaults from '@stacksjs/defaults/app/Routes.ts'

export * from '@stacksjs/defaults/app/Routes.ts'
export default {
  ...defaults,
  multiplayer: { path: 'multiplayer', prefix: '/api/multiplayer', middleware: ['auth'] },
}
