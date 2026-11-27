-- Personal OS schema v1 (docs/SPEC.md section 3).
-- Conventions: ULID text ids; UTC ISO-8601 timestamps (`*_at`); local calendar days (`day`, `*_day`) as YYYY-MM-DD.
-- Nothing is hard-deleted: rows carry archived_at or a terminal status. Every change writes an events row.

-- Configuration ------------------------------------------------------
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL                      -- JSON
);

CREATE TABLE workstreams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  colour TEXT NOT NULL,
  daily_target_min INTEGER NOT NULL DEFAULT 0 CHECK (daily_target_min >= 0),
  is_core INTEGER NOT NULL DEFAULT 0 CHECK (is_core IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE capacity_template (
  weekday INTEGER PRIMARY KEY CHECK (weekday BETWEEN 0 AND 6),   -- 0 = Monday
  available_min INTEGER NOT NULL CHECK (available_min BETWEEN 0 AND 1440),
  start_time TEXT,
  end_time TEXT
);

CREATE TABLE days (
  day TEXT PRIMARY KEY,
  available_min INTEGER NOT NULL CHECK (available_min BETWEEN 0 AND 1440),
  day_type TEXT NOT NULL DEFAULT 'work' CHECK (day_type IN ('work','leave','sick','light')),
  committed_at TEXT,
  plan_snapshot TEXT,
  closed_at TEXT
);

-- Strategy -----------------------------------------------------------
CREATE TABLE objectives (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  horizon TEXT CHECK (horizon IN ('quarter','year','multi_year')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','achieved','dropped')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  objective_id TEXT REFERENCES objectives(id),
  workstream_id TEXT NOT NULL REFERENCES workstreams(id),
  client_name TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','blocked','done','abandoned')),
  priority INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  due_day TEXT,
  health_note TEXT,
  last_activity_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX projects_status ON projects(status, priority);

CREATE TABLE milestones (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  due_day TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','dropped')),
  done_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX milestones_project ON milestones(project_id);

CREATE TABLE weekly_outcomes (
  id TEXT PRIMARY KEY,
  week TEXT NOT NULL,                      -- ISO week, e.g. 2026-W48
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 3),
  title TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','met','partly','missed')),
  UNIQUE (week, position)
);

-- Work ---------------------------------------------------------------
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  notes TEXT,
  project_id TEXT REFERENCES projects(id),
  milestone_id TEXT REFERENCES milestones(id),
  workstream_id TEXT NOT NULL REFERENCES workstreams(id),
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','done','dropped','backlog')),
  estimate_min INTEGER CHECK (estimate_min IS NULL OR estimate_min > 0),
  planned_day TEXT,
  due_day TEXT,
  is_deliverable INTEGER NOT NULL DEFAULT 0 CHECK (is_deliverable IN (0, 1)),
  is_priority INTEGER NOT NULL DEFAULT 0 CHECK (is_priority IN (0, 1)),
  postpone_count INTEGER NOT NULL DEFAULT 0,
  parent_task_id TEXT REFERENCES tasks(id),
  source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user','ai','quick_add','automation','agent')),
  done_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX tasks_day ON tasks(planned_day, workstream_id);
CREATE INDEX tasks_project ON tasks(project_id, status);
CREATE INDEX tasks_status ON tasks(status);

CREATE TABLE task_dependencies (
  task_id TEXT NOT NULL REFERENCES tasks(id),
  depends_on_id TEXT NOT NULL REFERENCES tasks(id),
  PRIMARY KEY (task_id, depends_on_id),
  CHECK (task_id <> depends_on_id)
);

CREATE TABLE time_blocks (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL REFERENCES days(day),
  workstream_id TEXT NOT NULL REFERENCES workstreams(id),
  task_id TEXT REFERENCES tasks(id),
  project_id TEXT REFERENCES projects(id),
  title TEXT NOT NULL,
  sched_start TEXT NOT NULL,
  sched_end TEXT NOT NULL,
  planned_min INTEGER NOT NULL CHECK (planned_min > 0),
  in_commit INTEGER NOT NULL DEFAULT 0 CHECK (in_commit IN (0, 1)),
  rescheduled_from_id TEXT REFERENCES time_blocks(id),
  state TEXT NOT NULL DEFAULT 'planned' CHECK (state IN ('planned','active','submitted','rescheduled','missed','cancelled')),
  created_at TEXT NOT NULL
);
CREATE INDEX blocks_day ON time_blocks(day);

CREATE TABLE block_submissions (
  id TEXT PRIMARY KEY,
  block_id TEXT NOT NULL UNIQUE REFERENCES time_blocks(id),
  status TEXT NOT NULL CHECK (status IN ('completed','partial','diverted','interrupted','rescheduled','skipped','missed')),
  actual_start TEXT,
  actual_end TEXT,
  focused_min INTEGER NOT NULL DEFAULT 0 CHECK (focused_min >= 0),
  interruption_kind TEXT CHECK (interruption_kind IN ('client','urgent','technical','personal','other')),
  diverted_to TEXT,
  notes TEXT,
  submitted_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user','ai','system','automation'))
);

-- Memory -------------------------------------------------------------
CREATE TABLE ideas (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  notes TEXT,
  kind TEXT NOT NULL DEFAULT 'idea' CHECK (kind IN ('idea','possible_project','opportunity')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','promoted','parked','dropped')),
  promoted_to_type TEXT,
  promoted_to_id TEXT,
  mention_count INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE decisions (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id),
  title TEXT NOT NULL,
  rationale TEXT,
  supersedes_id TEXT REFERENCES decisions(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('blocker','observation','accomplishment','priority_change')),
  project_id TEXT REFERENCES projects(id),
  body TEXT NOT NULL,
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

-- Authored Markdown memory (brain files, project narratives) with full version history.
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,               -- e.g. brain/MASTER_CONTEXT.md
  body TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT 'user',
  archived_at TEXT
);

CREATE TABLE document_versions (
  document_id TEXT NOT NULL REFERENCES documents(id),
  version INTEGER NOT NULL,
  body TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (document_id, version)
);

CREATE TABLE reviews (
  id TEXT PRIMARY KEY,
  period_type TEXT NOT NULL CHECK (period_type IN ('day','week','month')),
  period TEXT NOT NULL,
  metrics TEXT NOT NULL,
  narrative TEXT,
  recommendations TEXT,
  reward TEXT,
  markdown_path TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (period_type, period)
);

-- History and AI -----------------------------------------------------
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('morning','running','evening','weekly','admin')),
  day TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL CHECK (role IN ('user','assistant','tool')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE ai_proposals (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id),
  op TEXT NOT NULL,
  args TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('A','B')),
  status TEXT NOT NULL CHECK (status IN ('applied','pending','accepted','rejected','invalid','undone')),
  explanation TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

-- Append-only activity log and audit trail.
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  day TEXT NOT NULL,
  actor TEXT NOT NULL CHECK (actor IN ('user','ai','automation','agent','system')),
  op TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  proposal_id TEXT REFERENCES ai_proposals(id),
  undone_by TEXT REFERENCES events(id)
);
CREATE INDEX events_day ON events(day);
CREATE INDEX events_entity ON events(entity_type, entity_id);

CREATE TRIGGER events_no_update BEFORE UPDATE OF id, at, day, actor, op, entity_type, entity_id, before_json, after_json ON events
BEGIN
  SELECT RAISE(ABORT, 'events are append-only');
END;

CREATE TRIGGER events_no_delete BEFORE DELETE ON events
BEGIN
  SELECT RAISE(ABORT, 'events are append-only');
END;

-- Full-text search over tasks, projects, ideas, decisions, notes and documents (kept in step by src/ops).
CREATE VIRTUAL TABLE search USING fts5(entity_type UNINDEXED, entity_id UNINDEXED, day UNINDEXED, body);
