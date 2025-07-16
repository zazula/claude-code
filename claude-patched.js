#!/usr/bin/env node

/**
 * Claude Code Wrapper with String Overflow Protection & Session Repair
 * 
 * This wrapper prevents RangeError: Invalid string length crashes
 * by monitoring and truncating large outputs before they reach Claude Code.
 * It also automatically repairs broken sessions on resume.
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

// Constants
const MAX_OUTPUT_SIZE = 50 * 1024 * 1024; // 50MB safe limit
const WARNING_THRESHOLD = 10 * 1024 * 1024; // 10MB warning
const TRUNCATION_MESSAGE = '\n\n[TRUNCATED: Output too large for Claude Code. Consider using file output for large results.]';

class SafeOutputBuffer {
  constructor(maxSize = MAX_OUTPUT_SIZE) {
    this.chunks = [];
    this.totalSize = 0;
    this.maxSize = maxSize;
    this.truncated = false;
    this.warningShown = false;
  }
  
  append(data) {
    const dataStr = data.toString();
    
    // Show warning at threshold
    if (!this.warningShown && this.totalSize > WARNING_THRESHOLD) {
      console.warn(`⚠️  Large output detected (${Math.round(this.totalSize/1024/1024)}MB). Consider using file output for very large results.`);
      this.warningShown = true;
    }
    
    // Check if adding this data would exceed limit
    if (this.totalSize + dataStr.length > this.maxSize) {
      const remaining = this.maxSize - this.totalSize;
      if (remaining > 0) {
        this.chunks.push(dataStr.slice(0, remaining));
        this.totalSize += remaining;
      }
      this.truncated = true;
      console.error(`❌ Output truncated at ${Math.round(this.maxSize/1024/1024)}MB to prevent Claude Code crash.`);
      return false; // Signal that data was truncated
    }
    
    this.chunks.push(dataStr);
    this.totalSize += dataStr.length;
    return true; // Signal that data was added successfully
  }
  
  toString() {
    let result = this.chunks.join('');
    if (this.truncated) {
      result += TRUNCATION_MESSAGE;
    }
    return result;
  }
  
  getSize() {
    return this.totalSize;
  }
}

// Find the original Claude Code executable
function findClaudeCode() {
  const possiblePaths = [
    '/opt/homebrew/bin/claude-original',
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    path.join(process.env.HOME || '', '.npm-global', 'bin', 'claude'),
    path.join(__dirname, 'node_modules', '.bin', 'claude')
  ];
  
  for (const claudePath of possiblePaths) {
    if (fs.existsSync(claudePath)) {
      // Make sure it's the real Claude Code, not our wrapper
      const content = fs.readFileSync(claudePath, 'utf8');
      if (content.includes('@anthropic-ai/claude-code') && !content.includes('claude-patched.js')) {
        return claudePath;
      }
    }
  }
  
  throw new Error('Original Claude Code not found. Please install @anthropic-ai/claude-code first.');
}

// Check if session needs repair
async function checkAndRepairSession(args) {
  // Check if this is a resume command
  const resumeIndex = args.findIndex(arg => arg === '-r' || arg === '--resume');
  if (resumeIndex === -1) return args;
  
  // Get session ID
  let sessionId = args[resumeIndex + 1];
  if (!sessionId || sessionId.startsWith('-')) {
    // Interactive resume, can't pre-check
    return args;
  }
  
  // Find session file
  let sessionPath;
  try {
    const result = execSync(`find ~/.claude/projects -name "*${sessionId}*" -type f`, { encoding: 'utf8' });
    const matches = result.trim().split('\n').filter(Boolean);
    if (matches.length === 1) {
      sessionPath = matches[0];
    }
  } catch (e) {
    // Can't find session, let Claude handle it
    return args;
  }
  
  if (!sessionPath) return args;
  
  // Quick check for potential issues
  const needsRepair = await checkSessionForIssues(sessionPath);
  if (needsRepair) {
    console.log('⚠️  Session may have tool sequencing issues. Attempting repair...');
    const repaired = await repairSession(sessionPath);
    if (repaired) {
      console.log('✅ Session repaired successfully');
    }
  }
  
  return args;
}

// Quick check for session issues
async function checkSessionForIssues(sessionPath) {
  const fileStream = fs.createReadStream(sessionPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });
  
  const pendingToolUses = new Map();
  let hasIssues = false;
  
  for await (const line of rl) {
    try {
      const entry = JSON.parse(line);
      
      // Track tool_use messages
      if (entry.role === 'assistant' && entry.content) {
        for (const content of entry.content) {
          if (content.type === 'tool_use') {
            pendingToolUses.set(content.id, true);
          }
        }
      }
      
      // Check for intervening non-tool messages
      if (pendingToolUses.size > 0 && entry.role !== 'user') {
        // There's a non-user message while we have pending tool uses
        hasIssues = true;
        break;
      }
      
      // Clear pending uses when we see results
      if (entry.role === 'user' && entry.content) {
        for (const content of entry.content) {
          if (content.type === 'tool_result' && content.tool_use_id) {
            pendingToolUses.delete(content.tool_use_id);
          }
        }
      }
    } catch (e) {
      // Ignore parse errors
    }
  }
  
  rl.close();
  return hasIssues || pendingToolUses.size > 0;
}

// Repair session by reordering tool results
async function repairSession(sessionPath) {
  try {
    // Use our fix-session script with --auto flag
    const fixerPath = path.join(__dirname, 'fix-session.js');
    if (fs.existsSync(fixerPath)) {
      execSync(`node "${fixerPath}" --auto "${sessionPath}"`, { stdio: 'pipe' });
      return true;
    }
  } catch (e) {
    console.error('Failed to repair session:', e.message);
  }
  return false;
}

// Ensure required directories exist
function ensureClaudeDirectories() {
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  const claudeDir = path.join(homeDir, '.claude');
  const shellSnapshotsDir = path.join(claudeDir, 'shell-snapshots');
  
  // Create directories if they don't exist
  [claudeDir, shellSnapshotsDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
        console.log(`📁 Created directory: ${dir}`);
      } catch (e) {
        console.warn(`⚠️  Could not create directory ${dir}: ${e.message}`);
      }
    }
  });
  
  // Clean up stale lock files (older than 24 hours)
  try {
    const files = fs.readdirSync(shellSnapshotsDir);
    const now = Date.now();
    const dayInMs = 24 * 60 * 60 * 1000;
    
    files.filter(f => f.endsWith('.lock')).forEach(lockFile => {
      const filePath = path.join(shellSnapshotsDir, lockFile);
      const stats = fs.statSync(filePath);
      if (now - stats.mtimeMs > dayInMs) {
        fs.unlinkSync(filePath);
        console.log(`🧹 Cleaned stale lock: ${lockFile}`);
      }
    });
  } catch (e) {
    // Ignore errors during cleanup
  }
}

// Main wrapper function
async function runClaudeWithProtection() {
  let claudePath;
  
  try {
    claudePath = findClaudeCode();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  
  console.log('🛡️  Claude Code with string overflow protection & session repair');
  
  // Ensure directories exist
  ensureClaudeDirectories();
  
  // Check and repair session if needed
  const args = await checkAndRepairSession(process.argv.slice(2));
  
  // Spawn the original Claude Code process
  const claude = spawn('node', [claudePath, ...args], {
    stdio: ['inherit', 'pipe', 'pipe']
  });
  
  const outputBuffer = new SafeOutputBuffer();
  const errorBuffer = new SafeOutputBuffer();
  
  // Monitor stdout with size protection
  claude.stdout.on('data', (data) => {
    if (outputBuffer.append(data)) {
      process.stdout.write(data);
    } else {
      // Output was truncated, terminate the process gracefully
      console.error('⚠️  Terminating Claude Code to prevent crash...');
      claude.kill('SIGTERM');
    }
  });
  
  // Monitor stderr with size protection
  claude.stderr.on('data', (data) => {
    if (errorBuffer.append(data)) {
      process.stderr.write(data);
    }
  });
  
  // Handle process events
  claude.on('close', (code) => {
    if (outputBuffer.truncated || errorBuffer.truncated) {
      console.log('\n📊 Output Statistics:');
      console.log(`   Total output: ${Math.round(outputBuffer.getSize()/1024/1024)}MB`);
      console.log(`   Truncated: ${outputBuffer.truncated ? 'Yes' : 'No'}`);
      console.log('\n💡 Tips:');
      console.log('   - Use file output for large results');
      console.log('   - Process data in smaller chunks');
      console.log('   - Consider streaming approaches');
    }
    process.exit(code);
  });
  
  claude.on('error', (error) => {
    console.error('❌ Failed to start Claude Code:', error.message);
    process.exit(1);
  });
  
  // Handle process termination
  process.on('SIGINT', () => {
    claude.kill('SIGINT');
  });
  
  process.on('SIGTERM', () => {
    claude.kill('SIGTERM');
  });
}

// Run the wrapper
if (require.main === module) {
  runClaudeWithProtection().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { SafeOutputBuffer, runClaudeWithProtection };