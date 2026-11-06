"""The territories teams can claim: the single list used across the app.

Territories are fixed game data, not something that changes during the event,
so they live here rather than in a table. Only claims are stored, in the teams
table. To change the map, edit this dictionary and nothing else.

TEMPORARY LIST: the 20 codes from the frontend mock plus RU. The final list of
30 or more comes from the war map owner. Replace it before any team claims,
because a claimed code that is removed here disappears from GET /territories.
"""

# Maps territory_code to its display name. Python dictionaries keep their order,
# so GET /territories returns territories in the order written here.
TERRITORIES: dict[str, str] = {
    "AR": "Argentina",
    "AU": "Australia",
    "BR": "Brazil",
    "CA": "Canada",
    "CL": "Chile",
    "DK": "Denmark",
    "EG": "Egypt",
    "FI": "Finland",
    "FR": "France",
    "DE": "Germany",
    "IN": "India",
    "JP": "Japan",
    "KE": "Kenya",
    "MX": "Mexico",
    "NO": "Norway",
    "PE": "Peru",
    "RU": "Russia",
    "ES": "Spain",
    "SE": "Sweden",
    "TR": "Turkey",
    "VN": "Vietnam",
}
