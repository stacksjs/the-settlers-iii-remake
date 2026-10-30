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

/**
 * Safe application cloud defaults.
 *
 * Set APP_DOMAIN and provider credentials before the first deploy. Set
 * CLOUD_ATTACH_TO (not a literal here) when this app is intentionally joining
 * a server owned by another ts-cloud project.
 *
 * Only the marketing page in `resources/views/marketing` is deployed. The game itself
 * embeds original media whose redistribution rights are unverified
 * (`bun run publication:check --channel web`), so no game server site is
 * declared until a reviewed grant exists.
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
    // The stx marketing page in resources/views/marketing, built on its own so
    // the playable game and its original media never enter the output. The
    // public folder is a dedicated one for the same reason.
    main: {
      deploy: 'server',
      root: 'dist/marketing',
      path: '/',
      domain: APP_DOMAIN,
      build: 'bunx --bun @stacksjs/stx build --pages resources/views/marketing --out dist/marketing --public resources/marketing/public',
      pathRewriteStyle: 'directory',
    },
  },
}

const config: CloudConfig = {}

export default config
