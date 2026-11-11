-- Las fotografías se guardan en la base de datos: así funcionan en servidores sin disco
-- persistente (Render, Railway…) y quedan incluidas en las copias de PostgreSQL.
ALTER TABLE files ADD COLUMN data BYTEA;
ALTER TABLE files ALTER COLUMN storage_name DROP NOT NULL;
