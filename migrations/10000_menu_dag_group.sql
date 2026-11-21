-- Optional kitchen DAG display grouping; independent of production components.
ALTER TABLE menu ADD COLUMN dag_group TEXT NOT NULL DEFAULT '';
