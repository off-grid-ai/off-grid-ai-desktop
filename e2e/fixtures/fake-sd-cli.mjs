#!/usr/bin/env node

// Native image-runtime boundary for cancellation E2E. It behaves like a running
// sd-cli job and deliberately never completes; the real imagegen owner must kill
// this process when the user presses Stop.

process.stderr.write('sampling step 1 / 20\n')
setInterval(() => {
  process.stderr.write('sampling step 2 / 20\n')
}, 1000)
