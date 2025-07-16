#!/usr/bin/env node

/**
 * Deep Session Cleaner v2 for Claude Code
 * 
 * Safer, more precise cleaning with proper file locking and error handling
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { findSessionById, FileTransaction, cleanOldBackups } = require('./safe-session-utils');

// Known problematic tool IDs that need to be cleaned
const PROBLEMATIC_TOOL_IDS = [
  'toolu_014F6R5piBxVrJdLbwTHigJW',
  'toolu_01JMxCAMPpQrn576vDkjCfDn'
];

async function deepCleanSession(sessionPath, autoFix = false) {
  console.log(`\n🔍 Deep cleaning session: ${sessionPath}`);
  
  const transaction = new FileTransaction(sessionPath);
  let tempPath;
  
  try {
    // Start transaction with file locking
    tempPath = await transaction.begin();
    console.log('🔒 Acquired file lock');
    
    const fileStream = fs.createReadStream(tempPath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });
    
    const cleanedLines = [];
    const removedEntries = [];
    const cleanedEntries = [];
    let lineNum = 0;
    let totalRemoved = 0;
    let totalCleaned = 0;
    
    for await (const line of rl) {
      lineNum++;
      if (!line.trim()) continue;
      
      try {
        const entry = JSON.parse(line);
        let shouldRemove = false;
        let cleanedEntry = entry;
        
        // Check if any problematic ID appears in this entry
        for (const toolId of PROBLEMATIC_TOOL_IDS) {
          const result = preciselCleanEntry(entry, toolId);
          
          if (result.removed) {
            shouldRemove = true;
            totalRemoved++;
            removedEntries.push({
              lineNum,
              toolId,
              reason: result.reason,
              preview: getEntryPreview(entry)
            });
            break;
          } else if (result.cleaned) {
            cleanedEntry = result.entry;
            totalCleaned++;
            cleanedEntries.push({
              lineNum,
              toolId,
              changes: result.changes
            });
          }
        }
        
        if (!shouldRemove) {
          cleanedLines.push(JSON.stringify(cleanedEntry));
        }
      } catch (e) {
        console.error(`Error parsing line ${lineNum}: ${e.message}`);
        cleanedLines.push(line); // Keep original if can't parse
      }
    }
    
    rl.close();
    
    console.log('\n📊 Analysis Complete:');
    console.log(`- Total lines: ${lineNum}`);
    console.log(`- Entries removed: ${totalRemoved}`);
    console.log(`- Entries cleaned: ${totalCleaned}`);
    console.log(`- Clean entries: ${cleanedLines.length}`);
    
    if (removedEntries.length > 0) {
      console.log('\n🗑️  Removed Entries:');
      for (const entry of removedEntries.slice(0, 5)) {
        console.log(`  Line ${entry.lineNum}: ${entry.reason}`);
        console.log(`    Tool ID: ${entry.toolId}`);
        console.log(`    Preview: ${entry.preview}`);
      }
      if (removedEntries.length > 5) {
        console.log(`  ... and ${removedEntries.length - 5} more`);
      }
    }
    
    if (cleanedEntries.length > 0) {
      console.log('\n🧹 Cleaned Entries:');
      for (const entry of cleanedEntries.slice(0, 5)) {
        console.log(`  Line ${entry.lineNum}: ${entry.changes}`);
      }
      if (cleanedEntries.length > 5) {
        console.log(`  ... and ${cleanedEntries.length - 5} more`);
      }
    }
    
    if (totalRemoved > 0 || totalCleaned > 0) {
      if (autoFix || await promptUser('\nApply deep cleaning to session? (y/n): ')) {
        // Write cleaned content back to temp file
        fs.writeFileSync(tempPath, cleanedLines.join('\n') + '\n');
        
        // Commit transaction
        await transaction.commit();
        console.log('✅ Session cleaned and saved successfully');
        
        // Run standard session repair
        await runStandardRepair(sessionPath);
        
        // Clean old backups
        const sessionDir = path.dirname(sessionPath);
        cleanOldBackups(sessionDir);
      } else {
        // User declined, rollback
        await transaction.rollback();
        console.log('❌ Cleaning cancelled');
      }
    } else {
      console.log('\n✅ No problematic tool IDs found in this session!');
      await transaction.rollback();
    }
  } catch (e) {
    console.error('❌ Error during cleaning:', e.message);
    if (transaction) {
      await transaction.rollback();
    }
    throw e;
  }
}

function preciselCleanEntry(entry, toolId) {
  // Check if this is a tool_use with the problematic ID
  if (entry.message && entry.message.role === 'assistant' && entry.message.content) {
    for (const content of entry.message.content) {
      if (content.type === 'tool_use' && content.id === toolId) {
        return { 
          removed: true, 
          reason: 'Tool use with problematic ID'
        };
      }
    }
  }
  
  // Check if this is a tool_result with the problematic ID
  if (entry.message && entry.message.role === 'user' && entry.message.content) {
    for (const content of entry.message.content) {
      if (content.type === 'tool_result' && content.tool_use_id === toolId) {
        return { 
          removed: true, 
          reason: 'Tool result with problematic ID'
        };
      }
    }
  }
  
  // More precise text cleaning
  let cleaned = false;
  const cleanedEntry = JSON.parse(JSON.stringify(entry)); // Deep clone
  const changes = [];
  
  // Create regex that matches the tool ID as a whole word
  const toolIdRegex = new RegExp(`\\b${toolId}\\b`, 'g');
  
  // Clean message content
  if (cleanedEntry.message && cleanedEntry.message.content) {
    for (let i = 0; i < cleanedEntry.message.content.length; i++) {
      const content = cleanedEntry.message.content[i];
      if (content.type === 'text' && content.text && toolIdRegex.test(content.text)) {
        // Check if this is an error message about the tool ID
        const lowerText = content.text.toLowerCase();
        if (lowerText.includes('error') || lowerText.includes('tool_use') || lowerText.includes('tool_result')) {
          // This is likely an error message about the tool - remove just the lines mentioning it
          const lines = content.text.split('\n');
          const filteredLines = lines.filter(line => !line.includes(toolId));
          
          if (filteredLines.length < lines.length) {
            content.text = filteredLines.join('\n').trim();
            cleaned = true;
            changes.push(`Removed ${lines.length - filteredLines.length} error lines mentioning tool ID`);
            
            // If the text is now empty, remove the content block
            if (!content.text.trim()) {
              cleanedEntry.message.content.splice(i, 1);
              i--;
              changes.push('Removed empty text block');
            }
          }
        } else {
          // Not an error message - replace tool ID with placeholder
          content.text = content.text.replace(toolIdRegex, '[REDACTED_TOOL_ID]');
          cleaned = true;
          changes.push('Replaced tool ID with placeholder in text');
        }
      }
    }
  }
  
  // Clean summary content more carefully
  if (cleanedEntry.type === 'summary' && cleanedEntry.summary && toolIdRegex.test(cleanedEntry.summary)) {
    // Only remove lines that are clearly about the error
    const lines = cleanedEntry.summary.split('\n');
    const filteredLines = lines.map(line => {
      if (line.includes(toolId) && (line.includes('error') || line.includes('tool_use') || line.includes('tool_result'))) {
        return '[Line about tool error removed]';
      }
      return line;
    });
    
    cleanedEntry.summary = filteredLines.join('\n').trim();
    cleaned = true;
    changes.push('Cleaned error references from summary');
  }
  
  return { 
    removed: false, 
    cleaned, 
    entry: cleanedEntry,
    changes: changes.join(', ')
  };
}

function getEntryPreview(entry) {
  if (entry.message) {
    if (entry.message.content && entry.message.content[0]) {
      const content = entry.message.content[0];
      if (content.type === 'text') {
        return content.text.substring(0, 50).replace(/\n/g, ' ') + '...';
      } else if (content.type === 'tool_use') {
        return `tool_use: ${content.name || 'unknown'}`;
      } else if (content.type === 'tool_result') {
        return `tool_result`;
      }
    }
    return `${entry.message.role} message`;
  } else if (entry.type === 'summary') {
    return 'Summary entry';
  }
  return 'Unknown entry type';
}

async function runStandardRepair(sessionPath) {
  console.log('\n🔧 Running standard session repair...');
  const { spawn } = require('child_process');
  const fixerPath = path.join(__dirname, 'fix-session.js');
  
  if (fs.existsSync(fixerPath)) {
    return new Promise((resolve, reject) => {
      const child = spawn('node', [fixerPath, '--auto', sessionPath], {
        stdio: 'inherit'
      });
      
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Session repair exited with code ${code}`));
        }
      });
      
      child.on('error', reject);
    });
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

// Enhanced session chain cleaning
async function cleanSessionChain(projectDir) {
  console.log(`\n🔗 Cleaning entire session chain for: ${projectDir}`);
  
  try {
    const files = fs.readdirSync(projectDir)
      .filter(f => f.endsWith('.jsonl') && !f.endsWith('.backup') && !f.endsWith('.cleaned'))
      .sort((a, b) => {
        const statA = fs.statSync(path.join(projectDir, a));
        const statB = fs.statSync(path.join(projectDir, b));
        return statB.mtime - statA.mtime;
      });
    
    console.log(`Found ${files.length} session files`);
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const file of files) {
      const sessionPath = path.join(projectDir, file);
      try {
        await deepCleanSession(sessionPath, true);
        successCount++;
      } catch (e) {
        console.error(`Failed to clean ${file}: ${e.message}`);
        errorCount++;
      }
    }
    
    console.log(`\n✅ Session chain cleaning complete!`);
    console.log(`   Successful: ${successCount}`);
    console.log(`   Failed: ${errorCount}`);
  } catch (e) {
    console.error('Error cleaning session chain:', e.message);
  }
}

// CLI
const args = process.argv.slice(2);
const autoFix = args.includes('--auto');
const chainMode = args.includes('--chain');

if (args.length === 0 || (args.length === 1 && (autoFix || chainMode))) {
  console.log('Usage: deep-clean-session-v2 [options] <session-file-or-project-dir>');
  console.log('\nOptions:');
  console.log('  --auto   Apply fixes without prompting');
  console.log('  --chain  Clean all sessions in a project directory');
  console.log('\nExamples:');
  console.log('  deep-clean-session-v2 session.jsonl');
  console.log('  deep-clean-session-v2 --auto ~/.claude/projects/myproject/session.jsonl');
  console.log('  deep-clean-session-v2 --chain ~/.claude/projects/myproject');
  process.exit(1);
}

const input = args.find(arg => !arg.startsWith('--'));

if (chainMode) {
  // Clean entire session chain
  if (!fs.existsSync(input) || !fs.statSync(input).isDirectory()) {
    console.error('Error: --chain requires a valid project directory');
    process.exit(1);
  }
  cleanSessionChain(input).catch(console.error);
} else {
  // Clean single session
  let sessionPath;
  
  if (fs.existsSync(input)) {
    sessionPath = input;
  } else {
    // Try to find by session ID safely
    const matches = findSessionById(input);
    
    if (matches.length === 0) {
      console.error(`No session found for: ${input}`);
      process.exit(1);
    } else if (matches.length === 1) {
      sessionPath = matches[0];
    } else {
      console.log('Multiple sessions found:');
      matches.forEach((m, i) => console.log(`  ${i + 1}. ${m}`));
      process.exit(1);
    }
  }
  
  deepCleanSession(sessionPath, autoFix).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}