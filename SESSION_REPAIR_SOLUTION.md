# Claude Code Session Repair Solution

## Problem Summary
Claude Code sessions were failing to resume with the error:
```
messages.93: `tool_use` ids were found without `tool_result` blocks immediately after: toolu_014F6R5piBxVrJdLbwTHigJW, toolu_01JMxCAMPpQrn576vDkjCfDn
```

## Root Cause Analysis
Deep analysis revealed that:
1. The problematic tool IDs consistently appear around messages 144-147 in sessions
2. They are also EMBEDDED IN TEXT in later messages (336-344) as error messages
3. Claude creates new sessions as clones that include the full history with these embedded errors
4. This causes the error to persist even after fixing individual sessions

## Solution Components

### 1. Deep Session Cleaner (`deep-clean-session.js`)
A comprehensive cleaning tool that:
- Removes ALL references to problematic tool IDs
- Cleans both tool_use/tool_result blocks AND embedded text references
- Supports single session or entire session chain cleaning
- Creates backups before modifications
- Runs standard session repair afterward

### 2. Enhanced Wrapper (`claude-patched.js`)
- Automatically runs deep cleaning before resuming sessions
- Prevents string overflow crashes
- Ensures shell snapshot directories exist

### 3. Continue Command Workaround (`claude-continue.js`)
- Works around the broken -c flag in Claude v1.0.53
- Automatically finds and resumes the last session
- Includes deep cleaning before resume

## Usage

### Clean a single session:
```bash
./deep-clean-session.js session-id
./deep-clean-session.js /path/to/session.jsonl
./deep-clean-session.js --auto session.jsonl  # Auto-fix without prompts
```

### Clean entire session chain:
```bash
./deep-clean-session.js --chain ~/.claude/projects/project-dir
```

### Resume sessions (with automatic cleaning):
```bash
# Using the wrapper (recommended)
claude -r session-id

# Using the continue workaround
claudec
```

## Results
Successfully cleaned 9 session files in the test project:
- Removed 4 problematic entries from each session
- Cleaned 2-10 embedded text references per session
- Fixed all tool sequencing issues
- Sessions now resume without errors

## Technical Details
The problematic tool IDs were:
- `toolu_014F6R5piBxVrJdLbwTHigJW`
- `toolu_01JMxCAMPpQrn576vDkjCfDn`

These IDs were embedded in the conversation history as error messages, causing Claude to reject the sessions even after fixing the tool sequencing.