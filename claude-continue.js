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
  
  try {
    if (!fs.existsSync(configPath)) {
      console.error('No Claude configuration found');
      return null;
    }
    
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    
    // Find the project key that matches current directory
    const projectKey = Object.keys(config.projects || {}).find(key => 
      path.resolve(key) === path.resolve(cwd)
    );
    
    if (!projectKey) {
      console.error(`No project configuration found for ${cwd}`);
      return null;
    }
    
    const lastSessionId = config.projects[projectKey].lastSessionId;
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
  
  // Get any additional arguments passed after the script
  const additionalArgs = process.argv.slice(2);
  
  // Spawn claude with -r and the session ID
  const args = ['-r', sessionId, ...additionalArgs];
  
  console.log(`\n🚀 Resuming with: claude ${args.join(' ')}\n`);
  
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