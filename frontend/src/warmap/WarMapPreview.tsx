import { useState } from 'react'
import { useServerNow } from '../lib/clock'
import { useCurrentRound, useStandings, useTerritoryList } from '../lib/queries'
import { boardState, connection, liveNotice } from './liveState'
import type { MapRound, MapTerritory, StandingsNation } from './types'
import { useMockFeed } from './useMockFeed'
import { WarMap, WarMapFault } from './WarMap'

const NO_TERRITORIES: MapTerritory[] = []
const NO_NATIONS: StandingsNation[] = []

// The war map, live by default. The scripted showcase loop is an explicit toggle and is
// always labelled as demo data; the live map never falls back to it.
export function WarMapPreview({ showStandings = true }: { showStandings?: boolean }) {
  const [mode, setMode] = useState<'live' | 'showcase'>('live')

  return (
    // Below 900px the war map grows to its content and the page scrolls (WarMap.css)
    <div className="relative h-full w-full max-[900px]:h-auto max-[900px]:min-h-full">
      {mode === 'live' ? <LiveWarMap showStandings={showStandings} /> : <ShowcaseWarMap showStandings={showStandings} />}

      {mode === 'showcase' && (
        <div
          role="status"
          className="pointer-events-none absolute top-[84px] left-1/2 z-30 -translate-x-1/2 border border-amber/60 bg-ink/90 px-4 py-1.5 font-mono text-[11px] font-bold tracking-[0.2em] whitespace-nowrap text-amber uppercase shadow-lg"
        >
          ▶ Demo data, not live · scripted showcase loop
        </div>
      )}

      <div className="pointer-events-auto absolute bottom-3 left-5 z-30 flex items-center gap-1 border border-steel bg-ink/90 p-1 text-[10px] font-mono tracking-widest uppercase shadow-lg">
        <button
          type="button"
          aria-pressed={mode === 'live'}
          onClick={() => setMode('live')}
          className={`cursor-pointer px-2.5 py-1 transition-colors ${
            mode === 'live' ? 'bg-coop/20 text-coop border border-coop/50 font-bold' : 'text-muted hover:text-paper'
          }`}
        >
          ● Live War Room
        </button>
        <button
          type="button"
          aria-pressed={mode === 'showcase'}
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

/**
 * The real event, from the shared public hooks (docs/api.md v5.3): claimed territories from
 * GET /territories, the round header from GET /rounds/current, standings from GET /standings.
 * No troop movements: the contract has none.
 */
function LiveWarMap({ showStandings }: { showStandings: boolean }) {
  const roundQ = useCurrentRound()
  const standingsQ = useStandings()
  const territoriesQ = useTerritoryList()
  // Synced to the server by useCurrentRound (lib/clock), never the browser's clock alone.
  const now = useServerNow(1000)

  const [retrying, setRetrying] = useState(false)

  const reads = [roundQ, standingsQ, territoriesQ]
  const conn = connection(reads)
  // The polls keep retrying on their own; this is the impatient human's button. "Retrying…" tracks
  // only this press (background polling keeps isFetching true almost constantly).
  const retry = async () => {
    setRetrying(true)
    await Promise.allSettled(reads.map((q) => q.refetch()))
    setRetrying(false)
  }

  if (conn === 'fault') return <WarMapFault onRetry={() => void retry()} retrying={retrying} />

  const round = roundQ.data
  const nations = standingsQ.data?.nations ?? NO_NATIONS
  const mapRound: MapRound | null = round ? { number: round.number, game: round.game, status: round.status } : null

  return (
    <WarMap
      round={mapRound}
      territories={territoriesQ.data?.territories ?? NO_TERRITORIES}
      nations={nations}
      serverTime={now}
      showStandings={showStandings}
      notice={liveNotice({ conn, round, ranked: nations.length })}
      signalLost={conn === 'degraded'}
      board={boardState(round, nations.length)}
    />
  )
}

/** The scripted mini-event (mock.ts), with troop arcs. Only mounted while the toggle is on. */
function ShowcaseWarMap({ showStandings }: { showStandings: boolean }) {
  const { round, territories, frame, movements } = useMockFeed()
  return (
    <WarMap
      round={{ ...round, status: frame.roundStatus }}
      territories={territories}
      nations={frame.nations}
      serverTime={frame.serverTime}
      movements={movements}
      showStandings={showStandings}
      // The scripted loop ranks round 1 as it plays; it is labelled Demo, never live.
      board={{ kind: 'results', resultsRound: round.number, current: { number: round.number, status: frame.roundStatus } }}
      demo
    />
  )
}
