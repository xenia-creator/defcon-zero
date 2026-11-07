"""The territories teams can claim: the single list used across the app.

Territories are fixed game data, not something that changes during the event,
so they live here rather than in a table. Only claims are stored, in the teams
table. To change the map, edit this dictionary and nothing else.

Change this list only before any team claims, because a claimed code that is
removed here disappears from GET /territories.
"""

# Maps territory_code to its display name. Python dictionaries keep their order,
# so GET /territories returns territories in the order written here.
TERRITORIES: dict[str, str] = {
    "US": "United States",
    "CA": "Canada",
    "MX": "Mexico",
    "BR": "Brazil",
    "AR": "Argentina",
    "CL": "Chile",
    "CO": "Colombia",
    "PE": "Peru",
    "GB": "United Kingdom",
    "FR": "France",
    "DE": "Germany",
    "ES": "Spain",
    "IT": "Italy",
    "NL": "Netherlands",
    "SE": "Sweden",
    "NO": "Norway",
    "PL": "Poland",
    "GR": "Greece",
    "UA": "Ukraine",
    "RU": "Russia",
    "TR": "Turkey",
    "EG": "Egypt",
    "DZ": "Algeria",
    "MA": "Morocco",
    "NG": "Nigeria",
    "KE": "Kenya",
    "ZA": "South Africa",
    "SA": "Saudi Arabia",
    "IR": "Iran",
    "PK": "Pakistan",
    "IN": "India",
    "CN": "China",
    "JP": "Japan",
    "KR": "South Korea",
    "KZ": "Kazakhstan",
    "ID": "Indonesia",
    "TH": "Thailand",
    "VN": "Vietnam",
    "PH": "Philippines",
    "AU": "Australia",
}
