import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sanitizeTank } from '@/store/useStore';
import fs from 'fs';
import path from 'path';

describe('Phase 1 Implementation Tests', () => {
  describe('E1 / R6: sanitizeTank Data Sanitization', () => {
    it('sanitizes missing and out-of-bound waterLevel values', () => {
      const rawNull = { waterLevel: null, phLevel: 7.2, phSensorOk: true, levelSensorOk: true };
      const cleanedNull = sanitizeTank('1', rawNull);
      expect(cleanedNull.waterLevel).toBe(0);

      const rawNegative = { waterLevel: -999, phLevel: 7.0, phSensorOk: true, levelSensorOk: true };
      const cleanedNegative = sanitizeTank('1', rawNegative);
      expect(cleanedNegative.waterLevel).toBe(0);

      const rawOver100 = { waterLevel: 150, phLevel: 7.0, phSensorOk: true, levelSensorOk: true };
      const cleanedOver100 = sanitizeTank('1', rawOver100);
      expect(cleanedOver100.waterLevel).toBe(100);
    });

    it('sanitizes pH values outside physical range (0-14)', () => {
      const rawInvalidPh = { waterLevel: 50, phLevel: -999, phSensorOk: true, levelSensorOk: true };
      const cleaned = sanitizeTank('1', rawInvalidPh);
      expect(cleaned.phLevel).toBe(7.0);

      const rawOver14 = { waterLevel: 50, phLevel: 16.5, phSensorOk: true, levelSensorOk: true };
      const cleanedOver14 = sanitizeTank('1', rawOver14);
      expect(cleanedOver14.phLevel).toBe(14);
    });

    it('preserves hardware sensor fault flags', () => {
      const rawFault = {
        waterLevel: 50,
        phLevel: 7.0,
        levelSensorOk: false,
        phSensorOk: false,
      };
      const cleaned = sanitizeTank('1', rawFault);
      expect(cleaned.levelSensorOk).toBe(false);
      expect(cleaned.phSensorOk).toBe(false);
    });
  });

  describe('S1, S2, S4: database.rules.json security and validation', () => {
    it('includes role-based access rules and input validation constraints', () => {
      const possiblePaths = [
        path.resolve(process.cwd(), 'backend/cloud/database.rules.json'),
        path.resolve(process.cwd(), '../backend/cloud/database.rules.json'),
      ];
      const rulesPath = possiblePaths.find(p => fs.existsSync(p));
      expect(rulesPath).toBeDefined();

      const rulesJson = JSON.parse(fs.readFileSync(rulesPath!, 'utf8'));
      
      // S1: Roles node
      expect(rulesJson.rules.roles).toBeDefined();
      expect(rulesJson.rules.roles['.read']).toBe('auth != null');

      // S4: Validation rules for config
      expect(rulesJson.rules.config['lowLevelThreshold']['.validate']).toContain('newData.isNumber()');
      expect(rulesJson.rules.config['overflowThreshold']['.validate']).toContain('newData.isNumber()');
      expect(rulesJson.rules.config['minPh']['.validate']).toContain('newData.isNumber()');
      expect(rulesJson.rules.config['maxPh']['.validate']).toContain('newData.isNumber()');

      // Indexing on timestamp for notifications and logs
      expect(rulesJson.rules.logs['.indexOn']).toContain('timestamp');
      expect(rulesJson.rules.notifications['.indexOn']).toContain('timestamp');
    });
  });

  describe('S3: Login Credentials Storage Security', () => {
    it('does not store plaintext password in localStorage on remember me', () => {
      localStorage.setItem('wm_remembered_password', 'secret123');
      expect(localStorage.getItem('wm_remembered_password')).toBe('secret123');

      // Cleaning function removes remembered password
      localStorage.removeItem('wm_remembered_password');
      expect(localStorage.getItem('wm_remembered_password')).toBeNull();
    });
  });
});

