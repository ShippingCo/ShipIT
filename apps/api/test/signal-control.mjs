// Test-only bridge: Windows child.kill force-terminates instead of delivering
// POSIX signals. Exercise the real registered application handlers through IPC.
// Production startup never imports this module or exposes an IPC control route.
process.on('message', message => {
  if (message !== 'SIGINT' && message !== 'SIGTERM') return;
  if (process.listenerCount(message) === 0) throw new Error('TEST_SIGNAL_HANDLER_MISSING');
  process.emit(message);
  process.disconnect();
});
