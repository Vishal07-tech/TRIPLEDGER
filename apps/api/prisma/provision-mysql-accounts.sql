-- Run as a MySQL administrator. Replace the migration password placeholder
-- with a unique strong password, then use the same value in MIGRATION_DATABASE_URL.
REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'trip_app_user'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON trip_app.* TO 'trip_app_user'@'localhost';

CREATE USER IF NOT EXISTS 'trip_app_migrator'@'localhost'
  IDENTIFIED BY 'REPLACE_WITH_A_UNIQUE_STRONG_PASSWORD';
ALTER USER 'trip_app_migrator'@'localhost'
  IDENTIFIED BY 'REPLACE_WITH_A_UNIQUE_STRONG_PASSWORD';

GRANT ALL PRIVILEGES ON trip_app.* TO 'trip_app_migrator'@'localhost';
GRANT CREATE, DROP ON *.* TO 'trip_app_migrator'@'localhost';
