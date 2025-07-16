#!/usr/bin/env node

/**
 * Deep Session Cleaner for Claude Code
 * 
 * This tool performs aggressive cleaning of session files to remove ALL references
 * to problematic tool IDs that cause resume errors, including embedded text references.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Known problematic tool IDs that need to be cleaned
const PROBLEMATIC_TOOL_IDS = [
  'toolu_014F6R5piBxVrJdLbwTHigJW',
  'toolu_01JMxCAMPpQrn576vDkjCfDn'
];

async function deepCleanSession(sessionPath, autoFix = false) {
  console.log(`\n🔍 Deep cleaning session: ${sessionPath}`);
  
  const fileStream = fs.createReadStream(sessionPath);
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
      const entryStr = JSON.stringify(entry);
      let shouldRemove = false;
      let cleanedEntry = entry;
      
      // Check if any problematic ID appears in this entry
      for (const toolId of PROBLEMATIC_TOOL_IDS) {
        if (entryStr.includes(toolId)) {
          const result = deepCleanEntry(entry, toolId);
          
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
      }
      
      if (!shouldRemove) {
        cleanedLines.push(JSON.stringify(cleanedEntry));
      }
    } catch (e) {
      console.error(`Error parsing line ${lineNum}: ${e.message}`);
      cleanedLines.push(line); // Keep original if can't parse
    }
  }
  
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
      await saveCleanedSession(sessionPath, cleanedLines, autoFix);
    }
  } else {
    console.log('\n✅ No problematic tool IDs found in this session!');
  }
}

function deepCleanEntry(entry, toolId) {
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
  
  // Clean text content
  let cleaned = false;
  const cleanedEntry = JSON.parse(JSON.stringify(entry)); // Deep clone
  const changes = [];
  
  // Clean message content
  if (cleanedEntry.message && cleanedEntry.message.content) {
    for (let i = 0; i < cleanedEntry.message.content.length; i++) {
      const content = cleanedEntry.message.content[i];
      if (content.type === 'text' && content.text && content.text.includes(toolId)) {
        // Remove lines containing the tool ID
        const lines = content.text.split('\n');
        const filteredLines = lines.filter(line => !line.includes(toolId));
        
        if (filteredLines.length < lines.length) {
          content.text = filteredLines.join('\n').trim();
          cleaned = true;
          changes.push(`Removed ${lines.length - filteredLines.length} lines containing tool ID from text`);
          
          // If the text is now empty or just whitespace, remove the content block
          if (!content.text.trim()) {
            cleanedEntry.message.content.splice(i, 1);
            i--;
            changes.push('Removed empty text block');
          }
        }
      }
    }
  }
  
  // Clean summary content
  if (cleanedEntry.type === 'summary' && cleanedEntry.summary && cleanedEntry.summary.includes(toolId)) {
    const lines = cleanedEntry.summary.split('\n');
    const filteredLines = lines.filter(line => !line.includes(toolId));
    
    if (filteredLines.length < lines.length) {
      cleanedEntry.summary = filteredLines.join('\n').trim();
      cleaned = true;
      changes.push(`Removed ${lines.length - filteredLines.length} lines from summary`);
    }
  }
  
  // Clean any other fields that might contain the ID
  const fieldsToCheck = ['error', 'output', 'result'];
  for (const field of fieldsToCheck) {
    if (cleanedEntry[field] && typeof cleanedEntry[field] === 'string' && cleanedEntry[field].includes(toolId)) {
      const lines = cleanedEntry[field].split('\n');
      const filteredLines = lines.filter(line => !line.includes(toolId));
      
      if (filteredLines.length < lines.length) {
        cleanedEntry[field] = filteredLines.join('\n').trim();
        cleaned = true;
        changes.push(`Cleaned ${field} field`);
      }
    }
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
        return content.text.substring(0, 50) + '...';
      } else if (content.type === 'tool_use') {
        return `tool_use: ${content.name}`;
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

async function saveCleanedSession(sessionPath, cleanedLines, autoFix) {
  const backupPath = sessionPath + '.pre-deep-clean';
  const cleanedPath = sessionPath + '.cleaned';
  
  // Create backup
  fs.copyFileSync(sessionPath, backupPath);
  console.log(`\n📦 Backup created: ${backupPath}`);
  
  // Write cleaned session
  fs.writeFileSync(cleanedPath, cleanedLines.join('\n') + '\n');
  console.log(`✨ Cleaned session: ${cleanedPath}`);
  
  if (autoFix || await promptUser('\nReplace original session with cleaned version? (y/n): ')) {
    fs.renameSync(cleanedPath, sessionPath);
    console.log('✅ Original session replaced with cleaned version.');
    
    // Also run the standard fix-session.js to ensure proper sequencing
    console.log('\n🔧 Running standard session repair...');
    const { execSync } = require('child_process');
    try {
      const fixerPath = path.join(__dirname, 'fix-session.js');
      if (fs.existsSync(fixerPath)) {
        execSync(`node "${fixerPath}" --auto "${sessionPath}"`, { stdio: 'inherit' });
      }
    } catch (e) {
      console.error('Warning: Could not run standard session repair:', e.message);
    }
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
    
    for (const file of files) {
      const sessionPath = path.join(projectDir, file);
      await deepCleanSession(sessionPath, true); // Auto-fix all
    }
    
    console.log('\n✅ Session chain cleaning complete!');
  } catch (e) {
    console.error('Error cleaning session chain:', e.message);
  }
}

// CLI
const args = process.argv.slice(2);
const autoFix = args.includes('--auto');
const chainMode = args.includes('--chain');

if (args.length === 0 || (args.length === 1 && (autoFix || chainMode))) {
  console.log('Usage: deep-clean-session [options] <session-file-or-project-dir>');
  console.log('\nOptions:');
  console.log('  --auto   Apply fixes without prompting');
  console.log('  --chain  Clean all sessions in a project directory');
  console.log('\nExamples:');
  console.log('  deep-clean-session session.jsonl');
  console.log('  deep-clean-session --auto ~/.claude/projects/myproject/session.jsonl');
  console.log('  deep-clean-session --chain ~/.claude/projects/myproject');
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
    // Try to find by session ID
    const { execSync } = require('child_process');
    try {
      const result = execSync(`find ~/.claude/projects -name "*${input}*" -type f`, { encoding: 'utf8' });
      const matches = result.trim().split('\n').filter(Boolean);
      
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
    } catch (e) {
      console.error(`Error searching for session: ${e.message}`);
      process.exit(1);
    }
  }
  
  deepCleanSession(sessionPath, autoFix).catch(console.error);
}