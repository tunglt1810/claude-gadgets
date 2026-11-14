import type { Register } from 'claude-code'
import { sceneSvg } from '../src/scene'

const SCENE = 'glyph-tide'

// One seed per load, so each session gets its own field and waves.
const seed = Math.floor(Math.random() * 2 ** 32)
// Only a backdrop this mod set is cleared: `theme.clear` clears any plugin's theme.
let isShown = false

export const register: Register = (on, options) => {
  const motion = options.motion !== false
  const hideAfterPrompt = options.hideAfterPrompt === true
  const svg = sceneSvg({ seed, motion })

  on('session.start', async ($, e, next) => {
    const res = await next(e)
    if (hideAfterPrompt && (await $.session.messages()).length > 0) return res
    await $.theme.set({ backdrop: { scene: SCENE } })
    isShown = true
    return res
  })

  on('prompt.submit', async ($, e, next) => {
    if (hideAfterPrompt && isShown) {
      isShown = false
      await $.theme.clear()
    }
    return next(e)
  })

  on('ui.render', { component: 'Backdrop' }, ($, e, next) => {
    if (e.props.plugin !== SCENE || e.props.scene !== SCENE) return next(e)
    if (e.surface !== 'desktop' && e.surface !== 'mobile') return next(e)
    const { Svg } = $.ui.resolve(e)
    // A desktop draws an Svg without isInteractive as an image, and its animation does not run.
    return <Svg source={svg} alt="Code glyphs crossed by slow waves of light" isInteractive />
  })
}
