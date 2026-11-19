-- ===========================================================================
-- Sporta — the fabric a product is made of, with optional percentages.
--
-- Additive. `if not exists`, so importing it twice changes nothing. Read with fabric.php: the
-- canonical text is "cotton:80,elastane:20" (percentages add up to 100) or "cotton,polyester"
-- (no percentages), or NULL for "not stated". Nothing here is a foreign key: the value is a
-- short text list that the server parses, and an unknown material is dropped on read.
-- ===========================================================================

-- No `after` clause, on purpose: the column is appended, so every database that runs this (or install.mysql.sql) ends up with
-- the same column order, and the schema records (ops/db/expected-schema.json) do not shift the columns after it.
alter table products add column if not exists fabric varchar(160) null;
