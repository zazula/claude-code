#!/usr/bin/env node

/**
 * Safe Claude Continue
 * 
 * This workaround starts a fresh conversation with context from the last session
 * to avoid the tool_use/tool_result sequencing issues in chained sessions.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function getLastMessage() {
  const cwd = process.cwd();
  const projectPath = cwd.replace(/[\/\.]/g, '-');
  const sessionDir = path.join(process.env.HOME || process.env.USERPROFILE, '.claude', 'projects', projectPath);
  
  try {
    // Find most recent session
    const files = fs.readdirSync(sessionDir)
      .filter(f => f.endsWith('.jsonl') && !f.endsWith('.backup') && !f.endsWith('.fixed'))
      .map(f => ({
        name: f,
        path: path.join(sessionDir, f),
        mtime: fs.statSync(path.join(sessionDir, f)).mtime
      }))
      .sort((a, b) => b.mtime - a.mtime);
    
    if (files.length === 0) return null;
    
    // Read the last few messages from the most recent session
    const sessionPath = files[0].path;
    const lines = fs.readFileSync(sessionPath, 'utf8').trim().split('\n');
    
    // Find the last user message
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        if (entry.message && entry.message.role === 'user' && entry.message.content) {
          const content = entry.message.content;
          if (typeof content === 'string') return content;
          if (Array.isArray(content)) {
            const textContent = content.find(c => c.type === 'text');
            if (textContent) return textContent.text;
          }
        }
      } catch (e) {
        // Skip invalid JSON
      }
    }
  } catch (e) {
    console.error('Could not read last session:', e.message);
  }
  
  return null;
}

function main() {
  console.log('🔄 Continuing conversation (safe mode)...\n');
  
  const lastMessage = getLastMessage();
  if (!lastMessage) {
    console.error('No previous conversation found in this directory');
    process.exit(1);
  }
  
  console.log('📝 Last message:', lastMessage.substring(0, 100) + (lastMessage.length > 100 ? '...' : ''));
  console.log('\n🚀 Starting fresh conversation with context...\n');
  
  // Start claude with a continuation prompt
  const continuationPrompt = `I'm continuing our previous conversation. My last message was: "${lastMessage}"\n\nPlease continue where we left off.`;
  
  const claude = spawn('claude', [continuationPrompt], {
    stdio: 'inherit',
    shell: true
  });
  
  claude.on('error', (error) => {
    console.error('Failed to start Claude:', error.message);
    process.exit(1);
  });
  
  claude.on('exit', (code) => {
    process.exit(code || 0);
  });
}

if (require.main === module) {
  main();
}