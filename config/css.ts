import type { CssOptions } from '@stacksjs/ts-css/engine'

/**
 * ts-css (utility CSS) — content globs for STX views.
 *
 * `satisfies` rather than a bare object: this was the one config file checked
 * against nothing, so a misspelled key sat here doing nothing at all. `minify`
 * in particular is read by the dev server and decides whether generated CSS is
 * whitespace-formatted, which is not something you notice by looking.
 *
 * @see https://github.com/stacksjs/ts-css
 */
export default {
  content: [
    './resources/views/**/*.{stx,html}',
    './resources/**/*.{stx,html}',
    './storage/framework/defaults/resources/views/**/*.{stx,html}',
    './storage/framework/defaults/resources/components/**/*.{stx,html}',
    './node_modules/@stacksjs/error-handling/dist/views/**/*.{stx,html}',
  ],
  /*
   * No `preflight` key. There was one - `preflight: true` - and the engine has
   * never had such an option: the real one is `preflights`, and it takes an
   * array of Preflight objects rather than a boolean. So it did nothing, in
   * both spellings, for as long as it was here.
   *
   * Nothing is lost by dropping it. The base reset ships in the `cw-base`
   * layer of the generated CSS either way, which is what the key was reaching
   * for.
   */
  minify: false,

  /*
   * The Stacks dashboard and auth components are written against the `blue`
   * palette as their accent. This game's brand is the warm amber of the Roman
   * castle, so `blue` is mapped to amber here once, in the theme, and every
   * default component (sign-in, sign-up, buttons, focus rings, links) follows
   * without a fork. The 500 and 600 steps are the darker ambers so white button
   * text keeps AA contrast.
   */
  theme: {
    colors: {
      blue: {
        50: '#fffbeb', 100: '#fef3c7', 200: '#fde68a', 300: '#fcd34d', 400: '#fbbf24',
        500: '#b45309', 600: '#92400e', 700: '#78350f', 800: '#5c2a0c', 900: '#451a03', 950: '#2a1002',
      },
    },
  },
} satisfies CssOptions
