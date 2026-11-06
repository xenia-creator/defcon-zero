"""Schemas for POST /auth/login (docs/api.md section 2)."""

from typing import Literal

from pydantic import BaseModel

# Literal means "only these exact values". Pydantic rejects anything else, and
# that is how the contract's fixed status and role strings are enforced. It is
# defined once here so a typo cannot create a second spelling elsewhere.
Role = Literal["team", "organiser"]


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"]
    role: Role
    # Organisers do not belong to a team, so this is null for them.
    team_id: int | None
