#!/bin/sh
# Uygulamanın bağlandığı kısıtlı rol: süper kullanıcı değil, RLS'yi atlayamaz.
# Tablo yetkileri migration'larda verilir (bkz. prisma/migrations/*_core_foundation).
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE ROLE ${APP_DB_USER} LOGIN PASSWORD '${APP_DB_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO ${APP_DB_USER};
  GRANT USAGE ON SCHEMA public TO ${APP_DB_USER};
EOSQL
