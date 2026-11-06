import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { API_URL } from '../lib/config'
import { useCurrentRound } from '../lib/queries'
import type { GameKey, Round, StandingsResponse, TerritoriesResponse, TroopMovement } from './types'
import { useMockFeed } from './useMockFeed'
import { WarMap } from './WarMap'

const GAME_BY_ROUND: Record<number, GameKey> = {
  1: 'prisoners_dilemma',
  2: 'theatre_of_war',
  3: 'foreign_aid',
}

type LiveStandingsPayload = StandingsResponse & { movements?: TroopMovement[] }

// WarMap driven by live server /standings + /territories (with toggle for scripted showcase loop).
export function WarMapPreview({ roundOverride }: { roundOverride?: 1 | 2 | 3 }) {
  const [mode, setMode] = useState<'live' | 'showcase'>('live')
  const token = useAuth((s) => s.session?.access)
  const { round: mockRound, territories: mockTerritories, standings: mockStandings, movements: mockMovements } = useMockFeed()
  const { data: liveRound } = useCurrentRound()

  const { data: liveStandings } = useQuery<LiveStandingsPayload>({
    queryKey: ['warmap-standings', roundOverride, liveRound?.id],
    queryFn: async () => {
      const headers: Record<string, string> = {}
      if (token) headers.Authorization = `Bearer ${token}`
      const res = await fetch(`${API_URL}/standings`, { headers })
      if (!res.ok) throw new Error('Failed to load standings')
      return res.json()
    },
    refetchInterval: 2_000,
    enabled: mode === 'live',
  })

  const { data: liveTerritories } = useQuery<TerritoriesResponse>({
    queryKey: ['warmap-territories', liveStandings?.nations.length],
    queryFn: async () => {
      const headers: Record<string, string> = {}
      if (token) headers.Authorization = `Bearer ${token}`
      const res = await fetch(`${API_URL}/territories`, { headers })
      if (!res.ok) throw new Error('Failed to load territories')
      return res.json()
    },
    refetchInterval: 3_000,
    enabled: mode === 'live',
  })

  const number = roundOverride ?? liveRound?.number ?? mockRound.number
  const game = GAME_BY_ROUND[number] ?? mockRound.game

  const useLive = mode === 'live' && !!liveStandings && liveStandings.nations.length > 0

  const round: Round = {
    ...mockRound,
    id: liveRound?.id ?? number,
    number,
    game,
    status: (liveRound?.status as Round['status']) ?? liveStandings?.round_status ?? mockRound.status,
    opens_at: liveRound?.opensAt ? new Date(liveRound.opensAt).toISOString() : mockRound.opens_at,
    closes_at: liveRound?.closesAt ? new Date(liveRound.closesAt).toISOString() : mockRound.closes_at,
    server_time: liveStandings?.server_time ?? mockRound.server_time,
  }

  const standings: StandingsResponse = useLive ? liveStandings : mockStandings
  const territories: TerritoriesResponse = useLive && liveTerritories ? liveTerritories : mockTerritories
  const movements = useLive ? (liveStandings.movements ?? []) : mockMovements

  return (
    <div className="relative h-full w-full">
      <WarMap round={round} territories={territories} standings={standings} movements={movements} />
      <div className="pointer-events-auto absolute bottom-3 left-5 z-30 flex items-center gap-1 border border-steel bg-ink/90 p-1 text-[10px] font-mono tracking-widest uppercase shadow-lg">
        <button
          type="button"
          onClick={() => setMode('live')}
          className={`cursor-pointer px-2.5 py-1 transition-colors ${
            mode === 'live' ? 'bg-coop/20 text-coop border border-coop/50 font-bold' : 'text-muted hover:text-paper'
          }`}
        >
          ● Live War Room
        </button>
        <button
          type="button"
          onClick={() => setMode('showcase')}
          className={`cursor-pointer px-2.5 py-1 transition-colors ${
            mode === 'showcase' ? 'bg-amber/20 text-amber border border-amber/50 font-bold' : 'text-muted hover:text-paper'
          }`}
        >
          ▶ Showcase Loop
        </button>
      </div>
    </div>
  )
}
