-- M2: weekly outcomes can be cleared without a hard delete (CLAUDE.md: never hard-delete).
-- Rebuilds weekly_outcomes with archived_at; only one active outcome per week and position.
-- Nothing references weekly_outcomes, so the table can be dropped and recreated safely.
CREATE TABLE weekly_outcomes_new (
  id TEXT PRIMARY KEY,
  week TEXT NOT NULL,                      -- ISO week, e.g. 2026-W48
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 3),
  title TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','met','partly','missed')),
  archived_at TEXT
);
INSERT INTO weekly_outcomes_new (id, week, position, title, project_id, status)
  SELECT id, week, position, title, project_id, status FROM weekly_outcomes;
DROP TABLE weekly_outcomes;
ALTER TABLE weekly_outcomes_new RENAME TO weekly_outcomes;
CREATE UNIQUE INDEX weekly_outcomes_slot ON weekly_outcomes(week, position) WHERE archived_at IS NULL;
