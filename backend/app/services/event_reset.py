"""Business rule for wiping a dry run before the real event (scripts/reset_event.py).

Everything the event produced goes: matches, standings, submissions and teams.
Every round goes back to waiting. User accounts are kept by default, so teams
log in with the same usernames and passwords and claim a territory again. If the
dry run used test accounts, team accounts can be deleted too, and organiser
accounts are still kept, so the organisers can run the real event.
"""

from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import event_reset as reset_repository


@dataclass(frozen=True)
class ResetCounts:
    """How many rows each step removed or reset, for the script to print."""

    matches: int
    standings: int
    submissions: int
    teams: int
    rounds: int
    # 0 unless team accounts were asked to be deleted.
    team_accounts: int


async def reset_event(db: AsyncSession, delete_team_accounts: bool = False) -> ResetCounts:
    """Wipe the event's data. Does not commit: the caller commits once at the end.

    With delete_team_accounts, every account with role team is deleted as well.

    The order matters because of foreign keys. Matches, standings and submissions
    point at teams, and accounts point at teams too, so all of those are cleared
    before the teams themselves are deleted.
    """
    matches = await reset_repository.delete_all_matches(db)
    standings = await reset_repository.delete_all_standings(db)
    submissions = await reset_repository.delete_all_submissions(db)
    await reset_repository.unlink_users_from_teams(db)
    teams = await reset_repository.delete_all_teams(db)
    rounds = await reset_repository.reset_all_rounds(db)
    team_accounts = 0
    if delete_team_accounts:
        team_accounts = await reset_repository.delete_team_accounts(db)
    return ResetCounts(matches, standings, submissions, teams, rounds, team_accounts)
