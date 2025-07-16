#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');

async function analyzeSession(sessionPath) {
  const fileStream = fs.createReadStream(sessionPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });
  
  const targetIds = ['toolu_014F6R5piBxVrJdLbwTHigJW', 'toolu_01JMxCAMPpQrn576vDkjCfDn'];
  const findings = [];
  let lineNum = 0;
  let messageCount = 0;
  
  for await (const line of rl) {
    lineNum++;
    try {
      const entry = JSON.parse(line);
      
      // Count messages that would be sent to API
      if (entry.message && (entry.message.role === 'user' || entry.message.role === 'assistant')) {
        messageCount++;
      }
      
      // Search for our tool IDs
      const lineStr = JSON.stringify(entry);
      for (const id of targetIds) {
        if (lineStr.includes(id)) {
          findings.push({
            lineNum,
            messageNum: messageCount,
            toolId: id,
            entry: entry,
            context: determineContext(entry, id)
          });
        }
      }
    } catch (e) {
      // Skip invalid lines
    }
  }
  
  return { sessionPath, findings, totalMessages: messageCount };
}

function determineContext(entry, toolId) {
  // Check if it's in a summary
  if (entry.type === 'summary') {
    return 'IN_SUMMARY';
  }
  
  // Check if it's in a tool_use
  if (entry.message && entry.message.content) {
    for (const content of entry.message.content) {
      if (content.type === 'tool_use' && content.id === toolId) {
        return 'TOOL_USE';
      }
      if (content.type === 'tool_result' && content.tool_use_id === toolId) {
        return 'TOOL_RESULT';
      }
    }
  }
  
  // Check if it's embedded in text
  if (JSON.stringify(entry).includes(toolId)) {
    return 'EMBEDDED_IN_TEXT';
  }
  
  return 'UNKNOWN';
}

async function main() {
  const sessionDir = path.join(
    process.env.HOME || process.env.USERPROFILE,
    '.claude/projects/-Users-zazula-Developer-re-realie-ai'
  );
  
  const files = fs.readdirSync(sessionDir)
    .filter(f => f.endsWith('.jsonl') && !f.endsWith('.backup') && !f.endsWith('.fixed'))
    .sort((a, b) => {
      const statA = fs.statSync(path.join(sessionDir, a));
      const statB = fs.statSync(path.join(sessionDir, b));
      return statB.mtime - statA.mtime;
    });
  
  console.log('Analyzing sessions for problematic tool IDs...\n');
  
  for (const file of files.slice(0, 5)) { // Check last 5 sessions
    const sessionPath = path.join(sessionDir, file);
    const result = await analyzeSession(sessionPath);
    
    console.log(`\n=== ${file} ===`);
    console.log(`Total messages: ${result.totalMessages}`);
    
    if (result.findings.length > 0) {
      console.log(`Found ${result.findings.length} occurrences:`);
      
      for (const finding of result.findings) {
        console.log(`\n  Line ${finding.lineNum} (Message ~${finding.messageNum}):`);
        console.log(`  Tool ID: ${finding.toolId}`);
        console.log(`  Context: ${finding.context}`);
        
        if (finding.context === 'TOOL_USE') {
          console.log(`  Tool: ${finding.entry.message.content.find(c => c.id === finding.toolId).name}`);
        }
        
        // Check if this could be around message 93
        if (finding.messageNum >= 90 && finding.messageNum <= 100) {
          console.log(`  ⚠️  NEAR MESSAGE 93!`);
        }
      }
    } else {
      console.log('No occurrences found');
    }
  }
}

main().catch(console.error);