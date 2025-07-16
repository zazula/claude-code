#!/usr/bin/env node

/**
 * Test script for session repair functionality
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Create a test session with non-sequential tool results
const testSession = [
  {
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "Let me help you with that." },
        { type: "tool_use", id: "test_tool_1", name: "bash", input: { command: "ls" } }
      ]
    }
  },
  {
    message: {
      role: "system",
      content: "API Error: Content policy violation"
    }
  },
  {
    message: {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "test_tool_1", is_error: true, content: "Error: Command failed" }
      ]
    }
  },
  {
    message: {
      role: "assistant",
      content: [
        { type: "tool_use", id: "test_tool_2", name: "read", input: { file: "test.txt" } }
      ]
    }
  },
  {
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "I'll try another approach." }
      ]
    }
  },
  {
    message: {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "test_tool_2", content: "File contents here" }
      ]
    }
  }
];

// Write test session to file
const testFile = path.join(__dirname, 'test-session.jsonl');
const testContent = testSession.map(entry => JSON.stringify(entry)).join('\n') + '\n';
fs.writeFileSync(testFile, testContent);

console.log('Created test session with non-sequential tool results');
console.log('Running session fixer...\n');

try {
  // Run the fixer
  const output = execSync(`node fix-session.js --auto "${testFile}"`, { encoding: 'utf8' });
  console.log(output);
  
  // Check the fixed file
  const fixedContent = fs.readFileSync(testFile, 'utf8');
  const fixedLines = fixedContent.trim().split('\n').map(line => JSON.parse(line));
  
  console.log('\nFixed session structure:');
  fixedLines.forEach((entry, i) => {
    const msg = entry.message;
    if (msg.content && Array.isArray(msg.content)) {
      msg.content.forEach(content => {
        if (content.type === 'tool_use') {
          console.log(`Line ${i + 1}: tool_use (${content.id})`);
        } else if (content.type === 'tool_result') {
          console.log(`Line ${i + 1}: tool_result (${content.tool_use_id})`);
        }
      });
    }
  });
  
  // Verify all tool_results immediately follow their tool_use
  let success = true;
  for (let i = 0; i < fixedLines.length; i++) {
    const entry = fixedLines[i];
    if (entry.message && entry.message.content) {
      for (const content of entry.message.content) {
        if (content.type === 'tool_use') {
          // Check next line has the corresponding tool_result
          const nextEntry = fixedLines[i + 1];
          if (!nextEntry || !nextEntry.message || !nextEntry.message.content) {
            console.error(`\nERROR: No tool_result after tool_use ${content.id}`);
            success = false;
          } else {
            const hasResult = nextEntry.message.content.some(c => 
              c.type === 'tool_result' && c.tool_use_id === content.id
            );
            if (!hasResult) {
              console.error(`\nERROR: tool_result for ${content.id} not immediately after`);
              success = false;
            }
          }
        }
      }
    }
  }
  
  if (success) {
    console.log('\n✅ Session repair test PASSED!');
  } else {
    console.log('\n❌ Session repair test FAILED!');
  }
  
} catch (error) {
  console.error('Test failed:', error.message);
} finally {
  // Cleanup
  fs.unlinkSync(testFile);
  if (fs.existsSync(testFile + '.backup')) {
    fs.unlinkSync(testFile + '.backup');
  }
}