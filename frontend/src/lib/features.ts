/**
 * Features built but switched off, because docs/api.md has no route for them
 * yet. Turn one on once the backend has its route.
 */
export const FEATURES = {
  /** Needs POST /practice/simulate and GET /practice/bots. */
  practice: false,
  /** Needs POST /fairplay/events. Off means no banner either: teams must not be told they are reported when they are not. */
  fairPlayReports: false,
}
