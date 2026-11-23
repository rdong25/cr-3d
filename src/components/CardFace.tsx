import { CARDS } from '../cards'
import { usePortrait } from '../portraits'
import type { CardId } from '../types'

interface Props {
  id: CardId
  selected?: boolean
  disabled?: boolean
  /** 'hand' = battle hand, 'mini' = next-card preview, 'deck' = deck builder tile. */
  size?: 'hand' | 'mini' | 'deck'
  onClick?: () => void
}

/** A card: 3D-rendered portrait in a rarity-colored frame, elixir cost gem, name plate. */
export default function CardFace({ id, selected, disabled, size = 'hand', onClick }: Props) {
  const c = CARDS[id]
  const art = usePortrait(id)
  const cls = `gcard ${size} r-${c.rarity} ${selected ? 'sel' : ''} ${disabled ? 'disabled' : ''}`
  const body = (
    <>
      <span className="gcard-art">{art && <img src={art} alt="" draggable={false} />}</span>
      <span className="gcard-shine" />
      {size !== 'mini' && <span className="gcard-name">{c.name}</span>}
      <span className="gcard-cost">{c.cost}</span>
    </>
  )
  return onClick
    ? <button className={cls} onClick={onClick} aria-label={`${c.name}, ${c.cost} elixir`} aria-pressed={selected}>{body}</button>
    : <span className={cls} aria-label={c.name}>{body}</span>
}
