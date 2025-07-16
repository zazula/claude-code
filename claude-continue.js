#!/usr/bin/env node

/**
 * Claude Continue Workaround
 * 
 * This script works around the -c bug in Claude Code v1.0.53
 * by finding the last session for the current directory and resuming it.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function findLastSession() {
  const cwd = process.cwd();
  const configPath = path.join(process.env.HOME || process.env.USERPROFILE, '.claude.json');
  
  // Remove debug output for cleaner operation
  
  try {
    if (!fs.existsSync(configPath)) {
      console.error('No Claude configuration found');
      return null;
    }
    
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    
    // Find the project key that matches current directory
    // Find the project key that matches current directory
    
    const projectKey = Object.keys(config.projects || {}).find(key => 
      path.resolve(key) === path.resolve(cwd)
    );
    
    if (!projectKey) {
      console.error(`No project configuration found for ${cwd}`);
      return null;
    }
    
    let lastSessionId = config.projects[projectKey].lastSessionId;
    
    // If no lastSessionId in config, try to find the most recent session file
    if (!lastSessionId) {
      const projectPath = projectKey.replace(/[\/\.]/g, '-');
      const sessionDir = path.join(process.env.HOME || process.env.USERPROFILE, '.claude', 'projects', projectPath);
      
      
      try {
        const allFiles = fs.readdirSync(sessionDir);
        const files = allFiles
          .filter(f => f.endsWith('.jsonl') && !f.endsWith('.backup') && !f.endsWith('.fixed'))
          .map(f => ({
            name: f,
            path: path.join(sessionDir, f),
            mtime: fs.statSync(path.join(sessionDir, f)).mtime
          }))
          .sort((a, b) => b.mtime - a.mtime);
        
        // Debug: show which file we're picking
        if (files.length > 0) {
          console.error(`[DEBUG] Most recent: ${files[0].name} (${new Date(files[0].mtime).toLocaleString()})`)
        }
        
        
        if (files.length > 0) {
          lastSessionId = files[0].name.replace('.jsonl', '');
          console.log(`📁 Found most recent session: ${lastSessionId}`);
        }
      } catch (e) {
        // Directory might not exist or other error
      }
    }
    
    if (!lastSessionId) {
      console.error(`No last session found for ${cwd}`);
      return null;
    }
    
    console.log(`📂 Project: ${projectKey}`);
    console.log(`🔄 Continuing session: ${lastSessionId}`);
    
    return lastSessionId;
  } catch (error) {
    console.error('Error reading Claude configuration:', error.message);
    return null;
  }
}

function main() {
  const sessionId = findLastSession();
  
  if (!sessionId) {
    console.error('\n💡 Tip: Make sure you have a previous Claude session in this directory');
    process.exit(1);
  }
  
  // Always fix the session before resuming to handle chained session issues
  console.log('🔧 Checking session for issues...');
  const sessionPath = path.join(
    process.env.HOME || process.env.USERPROFILE,
    '.claude',
    'projects',
    process.cwd().replace(/[\/\.]/g, '-'),
    `${sessionId}.jsonl`
  );
  
  try {
    const { execSync } = require('child_process');
    const fixerPath = path.join(__dirname, 'fix-session.js');
    if (fs.existsSync(fixerPath) && fs.existsSync(sessionPath)) {
      execSync(`node "${fixerPath}" --auto "${sessionPath}"`, { stdio: 'pipe' });
    }
  } catch (e) {
    console.error('⚠️  Warning: Could not check/fix session:', e.message);
  }
  
  // Get any additional arguments passed after the script
  // Filter out --permission-mode and its value since they'll be added by the shell function
  const additionalArgs = process.argv.slice(2).filter((arg, index, arr) => {
    if (arg === '--permission-mode') return false;
    if (index > 0 && arr[index - 1] === '--permission-mode') return false;
    return true;
  });
  
  // Spawn claude with -r and the session ID
  const args = ['-r', sessionId, ...additionalArgs];
  
  console.log(`\n🚀 Resuming with: claude ${args.join(' ')}\n`);
  console.log('⚠️  Note: Due to a bug in Claude v1.0.53, sessions may fail to resume.');
  console.log('💡 If you get an API error, try starting a new conversation instead.\n');
  
  const claude = spawn('claude', args, {
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