import { useEffect, useState } from 'react'

/** Load an image source into an HTMLImageElement for use with react-konva. */
export function useImage(src: string | null): HTMLImageElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  useEffect(() => {
    if (!src) {
      setImage(null)
      return
    }
    const img = new window.Image()
    img.src = src
    const onLoad = (): void => setImage(img)
    img.addEventListener('load', onLoad)
    return () => img.removeEventListener('load', onLoad)
  }, [src])
  return image
}
