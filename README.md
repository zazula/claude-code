# Claude Code Patched

A patched version of @anthropic-ai/claude-code that prevents `RangeError: Invalid string length` crashes when processing large outputs.

## Problem Solved

The original Claude Code crashes with this error when tool outputs exceed JavaScript's maximum string length (~1GB):

```
RangeError: Invalid string length
    at Socket.<anonymous> (file:///opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/cli.js:627:8993)
```

## Solution

This wrapper intercepts output streams and:
- ⚠️  **Warns** at 10MB output
- 🛑 **Truncates** at 50MB to prevent crashes  
- 📊 **Reports** statistics when truncation occurs
- 💡 **Suggests** alternatives for large data

## Installation

```bash
# Install from this repository
npm install -g @zazula/claude-code

# Or install locally
cd claude-code-wrapper
npm install -g .
```

## Usage

Use exactly like the original Claude Code:

```bash
# All normal Claude Code commands work
claude "Help me fix this code"
claude --version
claude --help

# The wrapper automatically protects against large outputs
claude "Generate a huge amount of text"  # Won't crash!
```

## Features

### Automatic Protection
- Monitors output size in real-time
- Prevents string overflow crashes
- Graceful degradation with clear messages

### User Feedback
- Early warnings for large outputs (>10MB)
- Clear truncation messages
- Statistics on output size
- Helpful tips for handling large data

### Compatibility
- Drop-in replacement for original Claude Code
- Same command-line interface
- Same functionality, just safer

## Example Output

```bash
$ claude "Generate a very large dataset"
🛡️  Claude Code with string overflow protection
⚠️  Large output detected (15MB). Consider using file output for very large results.
❌ Output truncated at 50MB to prevent Claude Code crash.

📊 Output Statistics:
   Total output: 50MB
   Truncated: Yes

💡 Tips:
   - Use file output for large results
   - Process data in smaller chunks
   - Consider streaming approaches
```

## How It Works

1. **Wrapper Process**: Spawns the original Claude Code as a child process
2. **Stream Monitoring**: Intercepts stdout/stderr streams
3. **Size Tracking**: Monitors cumulative output size
4. **Safe Truncation**: Stops at safe limits with clear messaging
5. **Graceful Termination**: Kills child process if needed to prevent crashes

## Technical Details

- **Warning Threshold**: 10MB
- **Hard Limit**: 50MB  
- **Buffer Strategy**: Chunked accumulation
- **Termination**: SIGTERM for graceful shutdown
- **Compatibility**: Node.js 18+

## File Structure

```
claude-code-wrapper/
├── package.json          # Package configuration
├── claude-patched.js     # Main wrapper script
├── README.md            # This documentation
└── node_modules/        # Dependencies
```

## Development

To modify the wrapper:

1. Edit `claude-patched.js`
2. Adjust constants:
   - `MAX_OUTPUT_SIZE`: Hard limit (default: 50MB)
   - `WARNING_THRESHOLD`: Warning point (default: 10MB)
3. Test with large outputs
4. Reinstall: `npm install -g .`

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Acknowledgments

- Original Claude Code by Anthropic
- Inspired by the need for more robust large-output handling