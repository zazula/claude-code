#!/usr/bin/env node

/**
 * Claude Code Session Fixer
 * 
 * This tool fixes session files that have tool_use blocks without immediately 
 * following tool_result blocks, which causes API errors during resume.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

async function fixSession(sessionPath, autoFix = false) {
  console.log(`Analyzing session: ${sessionPath}`);
  
  const tempPath = sessionPath + '.fixed';
  const lines = [];
  const toolUseMap = new Map();
  const issues = [];
  
  // Read the session file
  const fileStream = fs.createReadStream(sessionPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });
  
  let lineNum = 0;
  let pendingToolUses = [];
  
  for await (const line of rl) {
    lineNum++;
    try {
      const entry = JSON.parse(line);
      lines.push({ lineNum, entry, raw: line });
      
      // Track tool_use messages
      if (entry.message && entry.message.role === 'assistant' && entry.message.content) {
        for (const content of entry.message.content) {
          if (content.type === 'tool_use') {
            pendingToolUses.push({
              id: content.id,
              lineNum: lineNum,
              entry: entry
            });
            toolUseMap.set(content.id, { useLineNum: lineNum, resultLineNum: null });
          }
        }
      }
      
      // Track tool_result messages
      if (entry.message && entry.message.role === 'user' && entry.message.content) {
        for (const content of entry.message.content) {
          if (content.type === 'tool_result' && content.tool_use_id) {
            const toolUse = toolUseMap.get(content.tool_use_id);
            if (toolUse) {
              toolUse.resultLineNum = lineNum;
              // Remove from pending if found
              pendingToolUses = pendingToolUses.filter(p => p.id !== content.tool_use_id);
            }
          }
        }
      }
    } catch (e) {
      console.error(`Error parsing line ${lineNum}: ${e.message}`);
    }
  }
  
  // Check for orphaned tool uses
  for (const [toolId, info] of toolUseMap) {
    if (!info.resultLineNum) {
      issues.push({
        type: 'missing_result',
        toolId,
        useLineNum: info.useLineNum
      });
    }
  }
  
  // Check for non-sequential tool results
  let hasNonSequentialResults = false;
  for (const [toolId, info] of toolUseMap) {
    if (info.resultLineNum && info.resultLineNum !== info.useLineNum + 1) {
      // Check if there's a non-tool message in between
      for (let i = info.useLineNum; i < info.resultLineNum - 1; i++) {
        const entry = lines[i]?.entry;
        if (entry && entry.message && entry.message.role !== 'user') {
          hasNonSequentialResults = true;
          issues.push({
            type: 'non_sequential',
            toolId,
            useLineNum: info.useLineNum,
            resultLineNum: info.resultLineNum,
            gap: info.resultLineNum - info.useLineNum - 1
          });
        }
      }
    }
  }
  
  console.log(`\nSession Analysis:`);
  console.log(`- Total lines: ${lineNum}`);
  console.log(`- Tool uses: ${toolUseMap.size}`);
  console.log(`- Issues found: ${issues.length}`);
  
  if (issues.length > 0) {
    console.log('\nIssues:');
    for (const issue of issues) {
      if (issue.type === 'missing_result') {
        console.log(`  - Missing tool_result for ${issue.toolId} (used at line ${issue.useLineNum})`);
      } else if (issue.type === 'non_sequential') {
        console.log(`  - Non-sequential tool_result for ${issue.toolId} (use: ${issue.useLineNum}, result: ${issue.resultLineNum}, gap: ${issue.gap} lines)`);
      }
    }
    
    console.log('\nFix strategy:');
    console.log('1. For missing tool_results, we need to add synthetic error results');
    console.log('2. For non-sequential results, we need to reorder messages');
    
    // Fix the session
    if (autoFix || await promptUser('Would you like to fix these issues? (y/n): ')) {
      await createFixedSession(sessionPath, lines, issues, toolUseMap, autoFix);
    }
  } else {
    console.log('\nNo issues found in this session!');
  }
}

async function createFixedSession(sessionPath, lines, issues, toolUseMap, autoFix = false) {
  const fixedPath = sessionPath + '.fixed';
  const backupPath = sessionPath + '.backup';
  
  console.log('\nCreating fixed session...');
  
  // Create backup
  fs.copyFileSync(sessionPath, backupPath);
  console.log(`Backup created: ${backupPath}`);
  
  // Process lines and fix issues
  const fixedLines = [];
  const processedToolUses = new Set();
  
  for (let i = 0; i < lines.length; i++) {
    const { entry, raw } = lines[i];
    
    // Check if this line has tool_use content
    let hasToolUse = false;
    if (entry.message && entry.message.role === 'assistant' && entry.message.content) {
      for (const content of entry.message.content) {
        if (content.type === 'tool_use' && !processedToolUses.has(content.id)) {
          hasToolUse = true;
          processedToolUses.add(content.id);
          
          // Write the tool_use message
          fixedLines.push(raw);
          
          // Find the corresponding tool_result
          const toolInfo = toolUseMap.get(content.id);
          if (toolInfo && toolInfo.resultLineNum) {
            // Add the tool_result immediately after
            const resultLine = lines[toolInfo.resultLineNum - 1];
            if (resultLine) {
              fixedLines.push(resultLine.raw);
            }
          } else {
            // Create synthetic error result
            const errorResult = {
              role: 'user',
              content: [{
                type: 'tool_result',
                tool_use_id: content.id,
                is_error: true,
                content: 'Error: Tool execution was interrupted or failed. This is a synthetic error added during session repair.'
              }]
            };
            fixedLines.push(JSON.stringify(errorResult));
            console.log(`  Added synthetic error result for tool ${content.id}`);
          }
        }
      }
    }
    
    // Skip if this was a tool_result that we already processed
    let isProcessedToolResult = false;
    if (entry.message && entry.message.role === 'user' && entry.message.content) {
      for (const content of entry.message.content) {
        if (content.type === 'tool_result' && processedToolUses.has(content.tool_use_id)) {
          isProcessedToolResult = true;
          break;
        }
      }
    }
    
    if (!hasToolUse && !isProcessedToolResult) {
      fixedLines.push(raw);
    }
  }
  
  // Write fixed session
  fs.writeFileSync(fixedPath, fixedLines.join('\n') + '\n');
  console.log(`\nFixed session created: ${fixedPath}`);
  console.log(`Original lines: ${lines.length}, Fixed lines: ${fixedLines.length}`);
  
  if (autoFix || await promptUser('\nReplace original session with fixed version? (y/n): ')) {
    fs.renameSync(fixedPath, sessionPath);
    console.log('Original session replaced with fixed version.');
  }
}

function promptUser(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y');
    });
  });
}

// CLI
const args = process.argv.slice(2);
const autoFix = args.includes('--auto');

if (args.length === 0 || (args.length === 1 && autoFix)) {
  console.log('Usage: fix-session [--auto] <session-file-or-id>');
  console.log('\nExamples:');
  console.log('  fix-session fcef873a-5c7e-4b6e-93a8-62b5432347a0');
  console.log('  fix-session ~/.claude/projects/path/to/session.jsonl');
  console.log('  fix-session --auto session.jsonl  # Auto-fix without prompts');
  process.exit(1);
}

const input = args.find(arg => !arg.startsWith('--'));
let sessionPath;

// Check if it's a file path or session ID
if (fs.existsSync(input)) {
  sessionPath = input;
} else {
  // Try to find by session ID
  const { execSync } = require('child_process');
  try {
    const result = execSync(`find ~/.claude/projects -name "*${input}*" -type f`, { encoding: 'utf8' });
    const matches = result.trim().split('\n').filter(Boolean);
    
    if (matches.length === 0) {
      console.error(`No session found for ID: ${input}`);
      process.exit(1);
    } else if (matches.length === 1) {
      sessionPath = matches[0];
    } else {
      console.log('Multiple sessions found:');
      matches.forEach((m, i) => console.log(`  ${i + 1}. ${m}`));
      process.exit(1);
    }
  } catch (e) {
    console.error(`Error searching for session: ${e.message}`);
    process.exit(1);
  }
}

fixSession(sessionPath, autoFix).catch(console.error);