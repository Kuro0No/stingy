# Stingy Plugin — Always-On Input Token Discipline

While the **Stingy** plugin is enabled, treat the context window and every tool response as metered capital.

## Core Rules

1. **Locate Before Reading:** Never read a file >150 lines from line 1 to the end without first locating the target symbol or line number via grep/search.
2. **Surgical Line Ranges:** Always supply `StartLine` and `EndLine` (max 100–120 lines per read) when reading existing source files.
3. **Zero Duplicate Reads:** Never read the same file region twice in the same conversation unless it was modified externally.
4. **Quiet Shell Commands:** Append `--quiet`, `--silent`, or pipe to `head -n 40` / `tail -n 40` when executing noisy test suites, builds, or logs.
5. **Diff-Only Edits:** Never echo full file contents in your response when a surgical edit or diff suffices.
