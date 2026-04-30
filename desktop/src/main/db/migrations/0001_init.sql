-- F-04 placeholder migration. Real domain schema lands in F-05.
-- Records that the runner is wired; subsequent migrations stack on top.
--
-- LOAD-BEARING NO-OP: do not remove or replace this SELECT. The migration
-- runner records 0001 as applied; removing it would shift all subsequent
-- migration numbers and corrupt existing databases.
SELECT 1;
