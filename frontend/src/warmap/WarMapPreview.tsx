import { WarMap } from './WarMap'
import { useMockFeed } from './useMockFeed'

// WarMap driven by the scripted mock feed, for local preview.
export function WarMapPreview() {
  const { round, territories, standings, movements } = useMockFeed()
  return <WarMap round={round} territories={territories} standings={standings} movements={movements} />
}
