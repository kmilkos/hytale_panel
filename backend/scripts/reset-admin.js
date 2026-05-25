const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const dbConnector = require('../src/db');
const config = require('../src/config');

async function resetPassword() {
  console.log('[*] Hytale Cluster Manager - Admin Password Reset Utility');

  const args = process.argv.slice(2);
  let newPassword = args[0];
  let isGenerated = false;

  if (!newPassword) {
    newPassword = crypto.randomBytes(6).toString('hex'); // 12 characters
    isGenerated = true;
  }

  if (newPassword.length < 6) {
    console.error('[-] Error: Password must be at least 6 characters long.');
    process.exit(1);
  }

  try {
    const db = dbConnector.connect();
    
    // Hash password
    const hash = await bcrypt.hash(newPassword, config.bcryptCost);
    
    // Check if admin user exists
    const adminUser = db.prepare('SELECT * FROM users WHERE role = ? OR username = ?')
      .get('admin', config.adminUsername);

    if (adminUser) {
      // Update existing admin
      db.prepare('UPDATE users SET password_hash = ?, username = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run(hash, config.adminUsername, adminUser.id);
      console.log(`[+] Success: Password for admin user "${config.adminUsername}" has been reset.`);
    } else {
      // Insert new admin
      db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
        .run(config.adminUsername, hash, 'admin');
      console.log(`[+] Success: Admin user "${config.adminUsername}" created with new password.`);
    }

    if (isGenerated) {
      console.log('\n==================================================');
      console.log(`  New Username: ${config.adminUsername}`);
      console.log(`  New Password: ${newPassword}`);
      console.log('  Please save this password securely.');
      console.log('==================================================\n');
    } else {
      console.log(`[+] Username: ${config.adminUsername}`);
      console.log(`[+] Password: [REDACTED] (Successfully updated to your input)`);
    }

  } catch (err) {
    console.error('[-] Error resetting password:', err.message);
    process.exit(1);
  }
}

resetPassword();
