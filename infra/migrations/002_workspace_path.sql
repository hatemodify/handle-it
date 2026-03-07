DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'jobs' AND column_name = 'repo'
  ) THEN
    ALTER TABLE jobs RENAME COLUMN repo TO workspace_path;
  END IF;
END $$;

ALTER TABLE jobs
  DROP CONSTRAINT IF EXISTS jobs_type_repo_check;

ALTER TABLE jobs
  DROP CONSTRAINT IF EXISTS jobs_check;

ALTER TABLE jobs
  DROP CONSTRAINT IF EXISTS jobs_type_workspace_path_check;

ALTER TABLE jobs
  ADD CONSTRAINT jobs_type_workspace_path_check
  CHECK ((type = 'doc' AND workspace_path IS NULL) OR (type = 'code' AND workspace_path IS NOT NULL));
