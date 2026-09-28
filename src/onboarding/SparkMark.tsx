import { SparklesIcon } from '@hugeicons/core-free-icons'
import { Icon } from './Icon.tsx'

/** Spark's placeholder identity until the product has a real logo. */
export function SparkMark({ withName = false }: { withName?: boolean }) {
  return (
    <span className="spark-mark">
      <span className="spark-mark-tile" aria-hidden>
        <Icon icon={SparklesIcon} size={16} />
      </span>
      {withName && <span className="spark-mark-name">Spark</span>}
    </span>
  )
}
