#!/usr/bin/env node

/**
 * Claude Code Wrapper with String Overflow Protection
 * 
 * This wrapper prevents RangeError: Invalid string length crashes
 * by monitoring and truncating large outputs before they reach Claude Code.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

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

// Main wrapper function
function runClaudeWithProtection() {
  let claudePath;
  
  try {
    claudePath = findClaudeCode();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  
  console.log('🛡️  Claude Code with string overflow protection');
  
  // Spawn the original Claude Code process
  const claude = spawn('node', [claudePath, ...process.argv.slice(2)], {
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
  runClaudeWithProtection();
}

module.exports = { SafeOutputBuffer, runClaudeWithProtection };