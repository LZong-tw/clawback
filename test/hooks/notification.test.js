'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { runHook } = require('../helpers');

describe('notification', () => {
  it('exits 0 without crashing', () => {
    const { exitCode } = runHook('hooks/notification.js', {
      hook_event_name: 'Notification',
      notification_type: 'idle_prompt',
    });
    assert.equal(exitCode, 0);
  });
});
