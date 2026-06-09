/**
 * Capture-feedback overlay. Pure DOM (no React) for minimal latency.
 * This window is transparent, click-through, and content-protected so none of
 * these effects ever appear in the saved screenshot — they are user feedback only.
 */

const style = document.createElement('style')
style.textContent = `
  #fx-flash {
    position: fixed; inset: 0; background: #ffffff; opacity: 0;
  }
  #fx-flash.on { animation: fx-flash 320ms ease-out; }
  @keyframes fx-flash { 0% { opacity: 0; } 18% { opacity: .55; } 100% { opacity: 0; } }

  #fx-frame {
    position: fixed; inset: 0; box-sizing: border-box;
    border: 0 solid #ff3b30; opacity: 0;
  }
  #fx-frame.on { animation: fx-frame 600ms ease-out; }
  @keyframes fx-frame {
    0% { opacity: 0; border-width: 0; }
    20% { opacity: 1; border-width: 8px; }
    100% { opacity: 0; border-width: 8px; }
  }

  #fx-toast {
    position: fixed; top: 28px; left: 50%; transform: translateX(-50%) translateY(-12px);
    display: flex; align-items: center; gap: 8px;
    padding: 10px 16px; border-radius: 999px;
    background: rgba(20,20,22,.82); color: #fff;
    font: 600 14px/1.2 'Segoe UI', system-ui, sans-serif;
    box-shadow: 0 6px 24px rgba(0,0,0,.35); opacity: 0;
  }
  #fx-toast .dot { width: 9px; height: 9px; border-radius: 50%; background: #ff3b30; }
  #fx-toast.on { animation: fx-toast 1100ms ease-out; }
  @keyframes fx-toast {
    0% { opacity: 0; transform: translateX(-50%) translateY(-12px); }
    14% { opacity: 1; transform: translateX(-50%) translateY(0); }
    78% { opacity: 1; transform: translateX(-50%) translateY(0); }
    100% { opacity: 0; transform: translateX(-50%) translateY(-12px); }
  }
`
document.head.appendChild(style)

const root = document.getElementById('overlay-root') as HTMLDivElement

const flash = document.createElement('div')
flash.id = 'fx-flash'
const frame = document.createElement('div')
frame.id = 'fx-frame'
const toast = document.createElement('div')
toast.id = 'fx-toast'
toast.innerHTML = `<span class="dot"></span><span>Captured</span>`

root.append(frame, flash, toast)

function replay(el: HTMLElement): void {
  el.classList.remove('on')
  // force reflow so the animation restarts on rapid consecutive captures
  void el.offsetWidth
  el.classList.add('on')
}

window.overlay.onFlash(({ flash: doFlash, style: fxStyle, toast: doToast }) => {
  if (doFlash) {
    if (fxStyle === 'frame') replay(frame)
    else replay(flash)
  }
  if (doToast) replay(toast)
})
