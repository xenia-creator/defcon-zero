import { useAuth } from '../lib/auth'
import { WarMap } from './WarMap'
import { useMockFeed } from './useMockFeed'

// WarMap driven by the scripted mock feed, for local preview.
export function WarMapPreview() {
  const { round, territories, standings, movements } = useMockFeed()
  // The app's own logout: clears the stored session, and App then shows the login screen.
  const logout = useAuth((s) => s.logout)
  return (
    <WarMap
      round={round}
      territories={territories}
      standings={standings}
      movements={movements}
      onLogout={() => logout()}
    />
  )
}
