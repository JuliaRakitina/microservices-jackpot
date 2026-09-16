#!/usr/bin/env bash
set -euo pipefail

# Values are read from the environment by psql, never embedded in shell SQL.
psql --username "$POSTGRES_USER" --dbname postgres --set ON_ERROR_STOP=1 <<'SQL'
\getenv auth_password AUTH_DB_PASSWORD
\getenv users_password USERS_DB_PASSWORD
\getenv bets_password BETS_DB_PASSWORD
\getenv jackpot_password JACKPOT_DB_PASSWORD
SELECT format('CREATE ROLE jackpot_auth LOGIN PASSWORD %L', :'auth_password') \gexec
SELECT format('CREATE ROLE jackpot_users LOGIN PASSWORD %L', :'users_password') \gexec
SELECT format('CREATE ROLE jackpot_bets LOGIN PASSWORD %L', :'bets_password') \gexec
SELECT format('CREATE ROLE jackpot_jackpot LOGIN PASSWORD %L', :'jackpot_password') \gexec
CREATE DATABASE jackpot_auth OWNER jackpot_auth;
CREATE DATABASE jackpot_users OWNER jackpot_users;
CREATE DATABASE jackpot_bets OWNER jackpot_bets;
CREATE DATABASE jackpot_jackpot OWNER jackpot_jackpot;
REVOKE ALL ON DATABASE jackpot_auth FROM PUBLIC;
REVOKE ALL ON DATABASE jackpot_users FROM PUBLIC;
REVOKE ALL ON DATABASE jackpot_bets FROM PUBLIC;
REVOKE ALL ON DATABASE jackpot_jackpot FROM PUBLIC;
GRANT CONNECT ON DATABASE jackpot_auth TO jackpot_auth;
GRANT CONNECT ON DATABASE jackpot_users TO jackpot_users;
GRANT CONNECT ON DATABASE jackpot_bets TO jackpot_bets;
GRANT CONNECT ON DATABASE jackpot_jackpot TO jackpot_jackpot;
SQL
