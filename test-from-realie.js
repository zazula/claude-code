#!/usr/bin/env node

// Test the claude-continue logic as if we're in realie.ai directory

const originalCwd = process.cwd;
process.cwd = () => '/Users/zazula/Developer/re/realie.ai';

// Now load and run the claude-continue logic
require('./claude-continue.js');