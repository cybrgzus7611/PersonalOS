-- Review hardening: an event can be marked undone once, and that mark never changes or clears.
-- (0001 already makes every other events column immutable and forbids deletes.)
CREATE TRIGGER events_undone_once BEFORE UPDATE OF undone_by ON events
WHEN OLD.undone_by IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'an undone event stays undone');
END;
