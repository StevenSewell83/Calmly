-- F-04 placeholder demonstrating FTS5 availability. Real search index lands in Epic 6.
-- Creating this virtual table will fail if FTS5 is not compiled in, which catches a
-- broken sqlite build at first boot rather than at search-time.
CREATE VIRTUAL TABLE IF NOT EXISTS _fts5_smoketest USING fts5(content);
