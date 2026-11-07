"""Business rules for teams: the GET /me profile, the territory list, claiming,
and an organiser changing a team's status."""

import re

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.territories import TERRITORIES
from app.models.team import Team
from app.models.user import User
from app.repositories import rounds as rounds_repository
from app.repositories import teams as teams_repository
from app.repositories import users as users_repository
from app.schemas.teams import TeamProfile, TeamStatus, TerritoriesResponse, Territory
from app.services import standings as standings_service
from app.services.auth import ensure_team_account

NATION_NAME_MIN_LENGTH = 3
NATION_NAME_MAX_LENGTH = 24
# Listing the characters, rather than using \w or str.isalpha, is what keeps out
# accented letters, which those would accept. It also keeps out tabs and newlines.
NATION_NAME_ALLOWED = re.compile(r"[A-Za-z0-9 ]+")
NATION_NAME_HAS_LETTER = re.compile(r"[A-Za-z]")

# Which unique constraint refused the claim decides which error the team sees.
# These names are set in models/team.py. The values are (code, message) rather
# than ready-made AppErrors, because Python records traceback details on an
# exception when it is raised, so one object must not be shared between requests.
CLAIM_CONFLICTS = {
    "uq_teams_territory_code": (
        "TERRITORY_TAKEN",
        "This territory has already been claimed.",
    ),
    "uq_teams_nation_name_lower": (
        "NAME_TAKEN",
        "This nation name has already been claimed.",
    ),
}


def build_profile(user: User, team: Team | None) -> TeamProfile:
    """Combine a user and their team, if any, into the GET /me body.

    A team row only exists after claiming, so a user without one has nothing to
    read a status from. The contract says they are active, because nothing has
    happened to them yet. Organisers also have no team and get the same values.
    """
    return TeamProfile(
        id=user.id,
        team_id=user.team_id,
        username=user.username,
        role=user.role,
        nation_name=team.nation_name if team else None,
        territory_code=team.territory_code if team else None,
        status=team.status if team else "active",
    )


async def get_profile(db: AsyncSession, user: User) -> TeamProfile:
    """Return the GET /me body for a logged-in user."""
    if user.team_id is None:
        return build_profile(user, None)
    team = await teams_repository.get_team_by_id(db, user.team_id)
    return build_profile(user, team)


async def list_territories(db: AsyncSession) -> TerritoriesResponse:
    """Return every territory, marking which are taken.

    The list comes from the constant and only the claims come from the database,
    so a territory nobody has claimed needs no row. One query fetches all claims,
    rather than one query per territory, because the frontend polls this route.
    """
    claimed_teams = await teams_repository.list_claimed_teams(db)
    nation_by_code = {team.territory_code: team.nation_name for team in claimed_teams}
    return TerritoriesResponse(
        territories=[
            Territory(
                territory_code=code,
                name=name,
                claimed=code in nation_by_code,
                nation_name=nation_by_code.get(code),
            )
            for code, name in TERRITORIES.items()
        ]
    )


def clean_nation_name(nation_name: str) -> str:
    """Trim the ends and collapse repeated spaces, then apply the contract's rules.

    Cleaning comes first so the rules judge the name that will really be stored,
    and so "Red  Dawn" and "Red Dawn" count as the same name. Only spaces are
    removed. str.strip() with no argument would also remove tabs and newlines,
    letting them through when the rules say they are not allowed.
    """
    cleaned = re.sub(" +", " ", nation_name.strip(" "))
    if not NATION_NAME_MIN_LENGTH <= len(cleaned) <= NATION_NAME_MAX_LENGTH:
        raise invalid_name_error(
            f"Nation name must be {NATION_NAME_MIN_LENGTH} to "
            f"{NATION_NAME_MAX_LENGTH} characters."
        )
    if not NATION_NAME_ALLOWED.fullmatch(cleaned):
        raise invalid_name_error("Nation name can only use A-Z, 0-9 and spaces.")
    if not NATION_NAME_HAS_LETTER.search(cleaned):
        raise invalid_name_error("Nation name must contain at least one letter.")
    return cleaned


def invalid_name_error(message: str) -> AppError:
    return AppError("VALIDATION_ERROR", message, 400)


def ensure_known_territory(territory_code: str) -> None:
    if territory_code not in TERRITORIES:
        raise AppError("VALIDATION_ERROR", "Unknown territory code.", 400)


def conflict_for(exc: IntegrityError) -> AppError | None:
    """Return the contract error for a refused claim, or None if it is unexpected.

    The database names the constraint it enforced in its error text.
    """
    for constraint_name, (code, message) in CLAIM_CONFLICTS.items():
        if constraint_name in str(exc.orig):
            return AppError(code, message, 409)
    return None


async def claim_territory(
    db: AsyncSession, user: User, territory_code: str, nation_name: str
) -> TeamProfile:
    """Create the user's team and link it to them, in one transaction."""
    ensure_team_account(user)
    cleaned_name = clean_nation_name(nation_name)
    ensure_known_territory(territory_code)

    # Locking the user makes two claims by the same user run one at a time, for
    # example after a double click. Without it both would see no team yet, both
    # would insert one, and one team would be left holding a territory with no
    # user. The unique constraints cannot catch that, as the two rows differ.
    locked_user = await users_repository.get_user_for_update(db, user.id)
    if locked_user.team_id is not None:
        raise AppError("ALREADY_CLAIMED", "You have already claimed a territory.", 409)

    # There is deliberately no "is it free?" query first. Two teams could both
    # see it free, so the unique constraints have to decide anyway. Trying the
    # insert and handling the refusal is the one check that cannot be raced.
    try:
        team = await teams_repository.create_team(db, territory_code, cleaned_name)
    except IntegrityError as exc:
        # A failed statement leaves the transaction unusable until rolled back.
        await db.rollback()
        conflict = conflict_for(exc)
        if conflict is None:
            raise
        raise conflict from exc

    locked_user.team_id = team.id
    # The team and the link are saved together or not at all.
    await db.commit()
    return build_profile(locked_user, team)


async def set_team_status(db: AsyncSession, team_id: int, status: TeamStatus) -> TeamProfile:
    """Set a team's status for PATCH /admin/teams/{id}, and return its GET /me body.

    Any status can be set from any other, so an organiser can also undo a
    mistake, for example putting a wrongly eliminated team back to active.

    Disqualifying a team while its round is in review moves it to the bottom of
    that round, so the cut at publish keeps exactly N teams that are not
    disqualified. A team disqualified while its round is running is moved when
    the run saves its results (see round_runs.save_results).

    Setting a disqualified team back to active in review re-ranks the whole
    round from its stored matches, by the run's own rules, so the team returns
    to the place it earned. Other changes, such as eliminating a team by hand,
    leave the ranks as they are.

    Locks are taken in the same order as publish and the end of a run, round
    first and team second. The opposite order could deadlock against them: each
    side would hold the lock the other is waiting for. The round lock is shared,
    so a submit, which also takes a shared lock on its round, never waits for it.
    """
    current_round = await rounds_repository.get_latest_started_round_for_share(db)
    team = await teams_repository.get_team_for_update(db, team_id)
    if team is None:
        raise AppError("NOT_FOUND", "This team does not exist.", 404)

    previous_status = team.status
    team.status = status
    if current_round is not None and current_round.status == "review":
        if status == "disqualified" and previous_status != "disqualified":
            await standings_service.drop_to_bottom(db, current_round.id, team.id)
        elif status == "active" and previous_status == "disqualified":
            # The re-rank reads team statuses, and autoflush sends this team's new
            # status to the database before that query runs, so it counts as
            # active there.
            await standings_service.rerank_round(db, current_round.id, current_round.seed)

    # The status and the new ranks are saved together, so a publish can never
    # see one without the other.
    await db.commit()
    user = await users_repository.get_user_by_team_id(db, team.id)
    return build_profile(user, team)
