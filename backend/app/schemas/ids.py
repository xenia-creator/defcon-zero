"""The range of ids the database can hold, shared by schemas, routes and services."""

# The id columns are 32-bit integers. A bigger number in a query does not simply
# find nothing: the database driver refuses it and the request would crash with
# a 500. So every id from a client is checked against this first.
MAX_DATABASE_ID = 2_147_483_647
