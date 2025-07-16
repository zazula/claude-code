#!/usr/bin/env node

// Debug version to test the path resolution

const fs = require('fs');
const path = require('path');

const testPath = '/Users/zazula/Developer/re/realie.ai';
const configPath = path.join(process.env.HOME || process.env.USERPROFILE, '.claude.json');

console.log('Testing path:', testPath);
console.log('Config path:', configPath);

if (!fs.existsSync(configPath)) {
  console.error('Config file does not exist');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

console.log('\nAll project keys:');
Object.keys(config.projects || {}).forEach(key => {
  console.log(`  "${key}"`);
});

// Find exact match
const projectKey = Object.keys(config.projects || {}).find(key => 
  path.resolve(key) === path.resolve(testPath)
);

console.log('\nResolved test path:', path.resolve(testPath));
console.log('Found project key:', projectKey);

if (projectKey) {
  const project = config.projects[projectKey];
  console.log('\nProject config:');
  console.log('  lastSessionId:', project.lastSessionId);
  
  // Try to find sessions
  const projectPath = projectKey.replace(/\//g, '-').replace(/^-/, '');
  const sessionDir = path.join(process.env.HOME || process.env.USERPROFILE, '.claude', 'projects', projectPath);
  
  console.log('\nSession directory:', sessionDir);
  console.log('Directory exists:', fs.existsSync(sessionDir));
  
  if (fs.existsSync(sessionDir)) {
    const files = fs.readdirSync(sessionDir)
      .filter(f => f.endsWith('.jsonl') && !f.endsWith('.backup') && !f.endsWith('.fixed'));
    console.log('\nSession files:');
    files.forEach(f => console.log(`  ${f}`));
  }
}