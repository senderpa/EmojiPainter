import fs from 'fs';
import path from 'path';

describe('custom Mystery server upload guard', () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const utils = fs.readFileSync(path.join(repoRoot, '.website_work/gesser-utils.php'), 'utf8');
  const guard = fs.readFileSync(path.join(repoRoot, '.website_work/custom-mystery-upload-guard.php'), 'utf8');

  test('enforces 20 ASCII letters/spaces and preserves submitted casing', () => {
    expect(utils).toContain('function validate_custom_mystery_topic');
    expect(utils).toContain("strlen($collapsed) > 20");
    expect(utils).toContain("preg_match('/^[A-Za-z ]+$/', $collapsed)");
    expect(utils).not.toContain('ucwords(strtolower');
  });

  test('requires the explicit custom source and maps topic id zero to NULL', () => {
    expect(guard).toContain("$source !== 'custom'");
    expect(guard).toContain("Custom mystery topics require is_mystery_paint=1");
    expect(guard).toContain("Custom mystery topics must use topic_id 0");
    expect(guard).toContain("'topic_id' => null");
  });
});

