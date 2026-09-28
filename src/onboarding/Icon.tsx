import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'

// 2 on desktop, on purpose: at 16px the native 1.5 reads lighter than the text beside it.
export function Icon({ icon, size = 16 }: { icon: IconSvgElement; size?: number }) {
  return <HugeiconsIcon icon={icon} size={size} strokeWidth={2} />
}
