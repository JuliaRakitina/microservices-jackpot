#!/bin/bash
set -e
psql -v ON_ERROR_STOP=1 --username "postgres" --dbname "postgres" <<-EOSQL
  CREATE DATABASE micro_user;
  GRANT ALL PRIVILEGES ON DATABASE micro_user TO postgres;
EOSQL
