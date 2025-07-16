#!/usr/bin/env node

/**
 * Safe utilities for Claude Code session operations
 * Provides secure, reusable functions for common operations
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Safely find session files by ID without command injection risk
 */
function findSessionById(sessionId) {
  const projectsDir = path.join(process.env.HOME || process.env.USERPROFILE, '.claude/projects');
  
  // Sanitize session ID to prevent directory traversal
  const safeId = sessionId.replace(/[^a-zA-Z0-9\-_]/g, '');
  
  const results = [];
  
  // Recursively search for matching files
  function searchDir(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          searchDir(fullPath);
        } else if (entry.isFile() && entry.name.includes(safeId) && entry.name.endsWith('.jsonl')) {
          // Skip backup and temporary files
          if (!entry.name.endsWith('.backup') && 
              !entry.name.endsWith('.cleaned') && 
              !entry.name.endsWith('.fixed') &&
              !entry.name.endsWith('.tmp') &&
              !entry.name.endsWith('.pre-deep-clean')) {
            results.push(fullPath);
          }
        }
      }
    } catch (e) {
      // Permission denied or other errors - skip this directory
    }
  }
  
  if (fs.existsSync(projectsDir)) {
    searchDir(projectsDir);
  }
  
  return results;
}

/**
 * File locking mechanism to prevent concurrent modifications
 */
class FileLock {
  constructor(filePath) {
    this.filePath = filePath;
    this.lockPath = filePath + '.lock';
    this.lockId = crypto.randomBytes(16).toString('hex');
  }
  
  async acquire(timeout = 5000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      try {
        // Try to create lock file exclusively
        const fd = fs.openSync(this.lockPath, 'wx');
        fs.writeSync(fd, JSON.stringify({
          pid: process.pid,
          lockId: this.lockId,
          timestamp: Date.now()
        }));
        fs.closeSync(fd);
        return true;
      } catch (e) {
        if (e.code === 'EEXIST') {
          // Lock exists, check if it's stale
          try {
            const lockInfo = JSON.parse(fs.readFileSync(this.lockPath, 'utf8'));
            const lockAge = Date.now() - lockInfo.timestamp;
            
            // If lock is older than 30 seconds, consider it stale
            if (lockAge > 30000) {
              fs.unlinkSync(this.lockPath);
              continue;
            }
            
            // Check if process is still alive
            try {
              process.kill(lockInfo.pid, 0);
              // Process exists, wait a bit
              await new Promise(resolve => setTimeout(resolve, 100));
            } catch (e) {
              // Process doesn't exist, remove stale lock
              fs.unlinkSync(this.lockPath);
            }
          } catch (e) {
            // Can't read lock info, remove it
            try {
              fs.unlinkSync(this.lockPath);
            } catch (e) {}
          }
        } else {
          throw e;
        }
      }
    }
    
    return false;
  }
  
  release() {
    try {
      // Only remove if we own the lock
      const lockInfo = JSON.parse(fs.readFileSync(this.lockPath, 'utf8'));
      if (lockInfo.lockId === this.lockId) {
        fs.unlinkSync(this.lockPath);
      }
    } catch (e) {
      // Lock might already be gone
    }
  }
}

/**
 * Transaction-like file operations with automatic rollback
 */
class FileTransaction {
  constructor(originalPath) {
    this.originalPath = originalPath;
    this.backupPath = originalPath + '.tx-backup';
    this.tempPath = originalPath + '.tx-temp';
    this.lock = new FileLock(originalPath);
    this.locked = false;
  }
  
  async begin() {
    // Acquire lock
    this.locked = await this.lock.acquire();
    if (!this.locked) {
      throw new Error('Could not acquire file lock');
    }
    
    // Create backup
    fs.copyFileSync(this.originalPath, this.backupPath);
    
    // Create working copy
    fs.copyFileSync(this.originalPath, this.tempPath);
    
    return this.tempPath;
  }
  
  async commit() {
    if (!this.locked) {
      throw new Error('Transaction not started');
    }
    
    // Replace original with temp
    fs.renameSync(this.tempPath, this.originalPath);
    
    // Clean up backup
    try {
      fs.unlinkSync(this.backupPath);
    } catch (e) {}
    
    // Release lock
    this.lock.release();
    this.locked = false;
  }
  
  async rollback() {
    if (!this.locked) {
      return;
    }
    
    try {
      // Restore from backup if it exists
      if (fs.existsSync(this.backupPath)) {
        fs.copyFileSync(this.backupPath, this.originalPath);
        fs.unlinkSync(this.backupPath);
      }
      
      // Remove temp file
      if (fs.existsSync(this.tempPath)) {
        fs.unlinkSync(this.tempPath);
      }
    } finally {
      // Always release lock
      this.lock.release();
      this.locked = false;
    }
  }
}

/**
 * Clean old backup files
 */
function cleanOldBackups(directory, maxAge = 7 * 24 * 60 * 60 * 1000) {
  const now = Date.now();
  const backupPatterns = ['.backup', '.fixed', '.cleaned', '.pre-deep-clean', '.tx-backup'];
  
  try {
    const files = fs.readdirSync(directory);
    
    for (const file of files) {
      const fullPath = path.join(directory, file);
      
      // Check if it's a backup file
      if (backupPatterns.some(pattern => file.endsWith(pattern))) {
        try {
          const stats = fs.statSync(fullPath);
          if (now - stats.mtimeMs > maxAge) {
            fs.unlinkSync(fullPath);
            console.log(`Cleaned old backup: ${file}`);
          }
        } catch (e) {}
      }
    }
  } catch (e) {}
}

module.exports = {
  findSessionById,
  FileLock,
  FileTransaction,
  cleanOldBackups
};