import type { CloudConfig } from '@stacksjs/types'
import type { CloudConfig as TsCloudConfig } from '@stacksjs/ts-cloud'
import process from 'node:process'
import { env } from '@stacksjs/env'

const APP_SLUG = 'the-settlers-iii-remake'
const APP_DOMAIN = env.APP_DOMAIN || undefined
// The server this project joins is named by whoever deploys it, never by the
// repository: set CLOUD_ATTACH_TO in the encrypted production environment or a
// protected CI secret. Provider tokens and hosts stay out of Git the same way.
const ATTACH_TO = process.env.CLOUD_ATTACH_TO || undefined
// Ports are unique on a shared box; the stacks owner's own sites use 3000 and 3008.
const WEB_PORT = 3471
const API_PORT = 3478

/**
 * Safe application cloud defaults.
 *
 * Set APP_DOMAIN and provider credentials before the first deploy. Set
 * CLOUD_ATTACH_TO (not a literal here) when this app is intentionally joining
 * a server owned by another ts-cloud project.
 *
 * The game and its converted media are served on the `web` channel under the
 * owner decision recorded in docs/content/permissions. `buddy deploy` runs
 * `publication:check` first, which fails closed if that decision is revoked.
 */
export const tsCloud: TsCloudConfig = {
  project: {
    name: APP_SLUG,
    slug: APP_SLUG,
    region: 'us-east-1',
  },

  stateDir: 'storage/cloud',

  // Deploy to Hetzner Cloud, or set `provider: 'ssh'` to deploy to a Linux box
  // you already own over SSH (a Raspberry Pi, a NUC, an old laptop):
  //
  //   cloud: { provider: 'ssh' },
  //   ssh: { profile: 'raspberry-pi', hosts: [{ host: 'pi-stacks.local', user: 'pi' }] },
  //
  // See `buddy server:flash`, `server:first-boot`, `server:doctor` and
  // `server:setup` for getting a fresh board to that point.
  cloud: {
    provider: 'hetzner',
    ...(ATTACH_TO ? { attachTo: ATTACH_TO } : {}),
  },

  mode: 'server',

  environments: {
    production: {
      type: 'production',
      deployBranch: 'main',
      region: 'us-east-1',
      variables: {
        APP_ENV: 'production',
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',
      },
    },
  },

  infrastructure: {
    compute: {
      instances: 1,
      size: 'small',
      disk: {
        size: 20,
        type: 'ssd',
        encrypted: true,
      },
      webServer: 'rpx',
      proxy: {
        engine: 'rpx',
        onDemandTls: true,
      },
    },
  },

  sites: {
    // The Stacks views server: marketing pages, the Stacks sign-in and sign-up
    // pages, and the game behind the stx page gate. Mutating verbs are proxied
    // to the API site below.
    main: {
      root: '.',
      path: '/',
      domain: APP_DOMAIN,
      start: 'bun node_modules/@stacksjs/buddy/dist/serve-entry.js',
      port: WEB_PORT,
      preStart: [
        'bun install --frozen-lockfile',
        'bun node_modules/@stacksjs/buddy/dist/cli.js migrate',
      ],
      env: {
        APP_ENV: 'production',
        NODE_ENV: 'production',
        STACKS_DEFAULT_ROUTES: 'auth',
        PORT_API: String(API_PORT),
        API_URL: `http://127.0.0.1:${API_PORT}`,
      },
    },

    api: {
      root: '.',
      start: 'bun node_modules/@stacksjs/actions/dist/serve/api.js',
      port: API_PORT,
      preStart: ['bun install --frozen-lockfile'],
      env: {
        HOST: '127.0.0.1',
        APP_ENV: 'production',
        NODE_ENV: 'production',
        STACKS_DEFAULT_ROUTES: 'auth',
      },
    },
  },
}

const config: CloudConfig = {}

export default config
