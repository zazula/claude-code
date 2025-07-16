# Claude Code Wrapper with Session Repair

This wrapper enhances Claude Code with two important fixes:

1. **String Overflow Protection**: Prevents crashes from large outputs
2. **Session Repair**: Automatically fixes broken sessions on resume

## The Session Resume Problem

Claude Code can fail to resume sessions with the error:
```
API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"messages.93: `tool_use` ids were found without `tool_result` blocks immediately after: toolu_014F6R5piBxVrJdLbwTHigJW, toolu_01JMxCAMPpQrn576vDkjCfDn"}}
```

This happens when:
- Tool results with errors are stored in the session
- API error messages or other messages appear between a tool_use and its tool_result
- The Claude API requires tool_result blocks to immediately follow tool_use blocks

## Installation

```bash
npm install
npm link
```

The wrapper will replace the `claude` command with a protected version.

## Features

### Automatic Session Repair
- Detects problematic sessions on resume
- Reorders tool_result messages to immediately follow tool_use blocks
- Creates synthetic error results for missing tool_results
- Backs up original sessions before repair

### String Overflow Protection
- Monitors output size in real-time
- Truncates at 50MB to prevent crashes
- Shows warnings at 10MB threshold

### Shell Snapshot Management
- Automatically creates required directories (~/.claude/shell-snapshots)
- Cleans up stale lock files older than 24 hours
- Prevents "ENOENT: no such file or directory" errors

## Manual Session Repair

You can manually repair a session:

```bash
# By session ID
node fix-session.js fcef873a-5c7e-4b6e-93a8-62b5432347a0

# By file path
node fix-session.js ~/.claude/projects/path/to/session.jsonl

# Auto-fix without prompts
node fix-session.js --auto session.jsonl
```

## How It Works

1. **Session Detection**: When you use `claude -r <session-id>`, the wrapper checks the session
2. **Issue Detection**: Scans for tool_use blocks without immediately following tool_result blocks
3. **Automatic Repair**: Reorders messages to satisfy API requirements
4. **Transparent Resume**: Passes control to Claude Code with the repaired session

## Technical Details

The session repair algorithm:
1. Parses JSONL session files line by line
2. Tracks all tool_use and tool_result pairs
3. Identifies non-sequential results (with intervening messages)
4. Reorders the session to place tool_results immediately after their tool_use
5. Creates synthetic error results for orphaned tool_uses
6. Backs up and replaces the original session file