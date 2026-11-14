import type { Register } from 'claude-code'
import { sceneSvg } from '../src/scene'

const SCENE = 'glyph-tide'
// A desktop's default glass (0.6, 16) leaves the waves too faint; the chat still reads through this one.
const GLASS = { opacity: 0.35, blur: 8 }

// One seed per load, so each session gets its own field and waves.
const seed = Math.floor(Math.random() * 2 ** 32)
// Only a backdrop this mod set is cleared: `theme.clear` clears any plugin's theme.
let isShown = false

export const register: Register = (on, options) => {
  const motion = options.motion !== false
  const hideAfterPrompt = options.hideAfterPrompt === true
  const wavesPerMinute = typeof options.wavesPerMinute === 'number' ? options.wavesPerMinute : 20
  const svg = sceneSvg({ seed, motion, wavesPerMinute })

  on('session.start', async ($, e, next) => {
    const res = await next(e)
    if (hideAfterPrompt && (await $.session.messages()).length > 0) return res
    await $.theme.set({ backdrop: { scene: SCENE, glass: GLASS } })
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
