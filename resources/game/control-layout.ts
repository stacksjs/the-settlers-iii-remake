// Geometry translated from ControlPanelLayoutProperties and
// MiniMapLayoutProperties at the pinned JSettlers revision. MIT notice:
// third-party/settlers-remake-LICENSE.txt. This describes reference UI geometry,
// not measured Gold Edition behavior. Coordinates below use a top-left origin.
export type ControlProfile = 480 | 600 | 768

interface Profile {
  width: number
  panelHeight: number
  miniHeight: number
  miniRight: number
  miniTop: number
  miniBottom: number
  cornerTop: number
  cornerLeft: number
  cornerRight: number
  cornerOuter: number
  primary: [number, number, number, number, number, number]
  secondary: [number, number, number, number, number]
  content: [number, number, number, number]
}

const profiles: Record<ControlProfile, Profile> = {
  480: { width: 136, panelHeight: 338, miniHeight: 142, miniRight: 71, miniTop: 10, miniBottom: 4, cornerTop: 68, cornerLeft: 4, cornerRight: 4, cornerOuter: 11,
    primary: [9, 14, 32, 32, 10, 33], secondary: [10, 46, 27, 24, 2], content: [9, 77, 118, 216] },
  600: { width: 176, panelHeight: 430, miniHeight: 170, miniRight: 84, miniTop: 5, miniBottom: 5, cornerTop: 88, cornerLeft: 8, cornerRight: 8, cornerOuter: 12,
    primary: [9, 5, 43, 44, 13, 44], secondary: [9, 49, 36, 32, 4], content: [10, 91, 157, 288] },
  768: { width: 216, panelHeight: 544, miniHeight: 224, miniRight: 117, miniTop: 8, miniBottom: 8, cornerTop: 108, cornerLeft: 4, cornerRight: 2, cornerOuter: 15,
    primary: [10, 9, 53, 55, 17, 55], secondary: [10, 64, 45, 40, 4], content: [10, 116, 197, 360] },
}

/** Reference proportions, including the two independently stretched minimap edges. */
export function controlLayout(profile: ControlProfile): { profile: ControlProfile, style: string } {
  const p = profiles[profile]
  const stride = (p.width - p.cornerLeft - p.cornerRight) / 2
  const leftStretch = stride / (p.cornerTop - p.cornerLeft)
  const rightStretch = stride / (p.cornerRight * leftStretch + p.miniRight - p.cornerOuter)
  const denominator = p.width + p.miniRight * rightStretch / leftStretch
  const miniAspect = (p.width * leftStretch + p.miniRight * rightStretch) / p.miniHeight
  const leftShare = p.width / denominator
  const width = profile / (1 / miniAspect + leftShare * p.panelHeight / p.width)
  const panelWidth = width * leftShare
  const panelHeight = panelWidth * p.panelHeight / p.width
  const miniHeight = profile - panelHeight
  const sx = panelWidth / p.width, sy = panelHeight / p.panelHeight
  const values: Record<string, number> = {
    'hud-profile': profile, 'hud-width': width, 'panel-width': panelWidth, 'panel-height': panelHeight,
    'mini-height': miniHeight, 'mini-right-width': width - panelWidth, 'panel-edge': 8 * sx,
    'primary-left': p.primary[0] * sx, 'primary-top': p.primary[1] * sy,
    'primary-width': p.primary[2] * sx, 'primary-height': p.primary[3] * sy,
    'primary-gap': p.primary[4] * sx, 'primary-image': p.primary[5] * sx,
    'secondary-left': p.secondary[0] * sx, 'secondary-top': p.secondary[1] * sy,
    'secondary-width': p.secondary[2] * sx, 'secondary-height': p.secondary[3] * sy, 'secondary-gap': p.secondary[4] * sx,
    'content-left': p.content[0] * sx, 'content-top': p.content[1] * sy,
    'content-width': p.content[2] * sx, 'content-height': p.content[3] * sy,
    'mini-map-left': p.cornerLeft / denominator * width,
    'mini-map-top': p.miniTop / p.miniHeight * miniHeight,
    'mini-map-width': (p.width - p.cornerLeft - p.cornerRight) / denominator * width * 1.5,
    'mini-map-height': (p.miniHeight - p.miniTop - p.miniBottom) / p.miniHeight * miniHeight,
  }
  const dimensions = Object.entries(values).map(([key, value]) => `--${key}:${value}`).join(';')
  const images = ['panel', 'panel-right', 'minimap', 'minimap-right'].map(key => `--${key}-image:url('/assets/settlers-original/ui/${key}-${profile}.png')`).join(';')
  return { profile, style: `${dimensions};${images}` }
}
