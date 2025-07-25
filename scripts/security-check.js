#!/usr/bin/env node

/**
 * Security Check & Auto-Fix Script
 * Comprehensive security automation for ChimpGPT deployment
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CONFIG = {
  maxCritical: 0,
  maxHigh: 0,
  maxModerate: 5,
  maxLow: 10,
  autoFix: process.env.NODE_ENV !== 'production',
  backupPackageLock: true,
  testAfterFix: true,
  logFile: path.join(__dirname, '../assets/logs/security-audit.log'),
};

class SecurityManager {
  constructor() {
    this.startTime = Date.now();
    this.vulnerabilities = null;
    this.fixesApplied = false;
    this.backupCreated = false;
  }

  log(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      duration: Date.now() - this.startTime,
      ...data,
    };

    console.log(`[${level.toUpperCase()}] ${message}`);

    // Ensure log directory exists
    const logDir = path.dirname(CONFIG.logFile);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    // Append to log file
    fs.appendFileSync(CONFIG.logFile, JSON.stringify(logEntry) + '\n');
  }

  async runAudit() {
    this.log('info', 'Running security audit...');

    try {
      const auditResult = execSync('npm audit --json', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.vulnerabilities = JSON.parse(auditResult);
      const counts = this.vulnerabilities.metadata.vulnerabilities;

      this.log('info', 'Audit completed', {
        vulnerabilities: counts,
        total: counts.total,
      });

      return counts;
    } catch (error) {
      // npm audit returns non-zero exit code when vulnerabilities are found
      if (error.stdout) {
        this.vulnerabilities = JSON.parse(error.stdout);
        const counts = this.vulnerabilities.metadata.vulnerabilities;

        this.log('warn', 'Vulnerabilities found', {
          vulnerabilities: counts,
          total: counts.total,
        });

        return counts;
      }

      this.log('error', 'Audit failed', { error: error.message });
      throw error;
    }
  }

  evaluateRisk(counts) {
    const risks = [];

    if (counts.critical > CONFIG.maxCritical) {
      risks.push(`Critical: ${counts.critical} (max: ${CONFIG.maxCritical})`);
    }
    if (counts.high > CONFIG.maxHigh) {
      risks.push(`High: ${counts.high} (max: ${CONFIG.maxHigh})`);
    }
    if (counts.moderate > CONFIG.maxModerate) {
      risks.push(`Moderate: ${counts.moderate} (max: ${CONFIG.maxModerate})`);
    }
    if (counts.low > CONFIG.maxLow) {
      risks.push(`Low: ${counts.low} (max: ${CONFIG.maxLow})`);
    }

    const riskLevel =
      counts.critical > 0
        ? 'CRITICAL'
        : counts.high > 0
          ? 'HIGH'
          : counts.moderate > 0
            ? 'MODERATE'
            : counts.low > 0
              ? 'LOW'
              : 'CLEAN';

    this.log('info', `Risk assessment: ${riskLevel}`, {
      riskLevel,
      exceedsLimits: risks.length > 0,
      violations: risks,
    });

    return { riskLevel, violations: risks };
  }

  createBackup() {
    if (!CONFIG.backupPackageLock) return;

    const packageLockPath = path.join(process.cwd(), 'package-lock.json');
    const backupPath = `${packageLockPath}.backup.${Date.now()}`;

    if (fs.existsSync(packageLockPath)) {
      fs.copyFileSync(packageLockPath, backupPath);
      this.backupCreated = true;
      this.log('info', 'Package-lock backup created', { backupPath });
    }
  }

  async applyFixes() {
    if (!CONFIG.autoFix) {
      this.log('info', 'Auto-fix disabled, skipping fixes');
      return false;
    }

    this.log('info', 'Applying security fixes...');
    this.createBackup();

    try {
      // Try regular fix first
      const fixResult = execSync('npm audit fix --json', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const result = JSON.parse(fixResult);
      this.fixesApplied =
        result.audit.metadata.vulnerabilities.total <
        this.vulnerabilities.metadata.vulnerabilities.total;

      this.log('info', 'Security fixes applied', {
        changed: result.changed,
        added: result.added,
        removed: result.removed,
        fixesApplied: this.fixesApplied,
      });

      return true;
    } catch (error) {
      if (error.stdout) {
        const result = JSON.parse(error.stdout);
        this.log('warn', 'Some fixes applied with warnings', {
          changed: result.changed,
          warnings: result.audit?.metadata?.vulnerabilities,
        });
        return true;
      }

      this.log('error', 'Fix application failed', { error: error.message });
      return false;
    }
  }

  async runTests() {
    if (!CONFIG.testAfterFix || !this.fixesApplied) return true;

    this.log('info', 'Running tests after security fixes...');

    try {
      execSync('npm test', { stdio: 'inherit' });
      this.log('info', 'Tests passed after security fixes');
      return true;
    } catch (error) {
      this.log('error', 'Tests failed after security fixes', {
        error: error.message,
      });
      return false;
    }
  }

  generateReport() {
    const duration = Date.now() - this.startTime;
    const report = {
      timestamp: new Date().toISOString(),
      duration: `${duration}ms`,
      vulnerabilities: this.vulnerabilities?.metadata?.vulnerabilities || {},
      fixesApplied: this.fixesApplied,
      backupCreated: this.backupCreated,
      status:
        this.vulnerabilities?.metadata?.vulnerabilities?.total === 0 ? 'SECURE' : 'VULNERABLE',
    };

    this.log('info', 'Security check completed', report);
    return report;
  }
}

async function main() {
  const security = new SecurityManager();
  let exitCode = 0;

  try {
    // Run initial audit
    const counts = await security.runAudit();

    // Evaluate risk
    const risk = security.evaluateRisk(counts);

    // Apply fixes if needed and allowed
    if (counts.total > 0) {
      const fixSuccess = await security.applyFixes();

      if (fixSuccess) {
        // Re-audit after fixes
        const newCounts = await security.runAudit();

        // Run tests if fixes were applied
        const testSuccess = await security.runTests();

        if (!testSuccess) {
          security.log('error', 'Tests failed, consider rolling back');
          exitCode = 1;
        } else if (newCounts.total > 0) {
          security.log('warn', 'Some vulnerabilities remain after fixes');
          exitCode = newCounts.critical > 0 || newCounts.high > 0 ? 1 : 0;
        }
      } else {
        security.log('error', 'Failed to apply security fixes');
        exitCode = 1;
      }
    }

    // Generate final report
    const report = security.generateReport();

    // Output machine-readable result for CI
    if (process.env.CI) {
      console.log(JSON.stringify(report));
    }
  } catch (error) {
    security.log('error', 'Security check failed', { error: error.message });
    exitCode = 1;
  }

  process.exit(exitCode);
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { SecurityManager };
