log('Exiting application...');
try {
  if (typeof libc_addr === 'undefined') {
    log('Loading userland.js...');
    include('userland.js');
  }
  fn.register(0x14, 'getpid', [], 'bigint');
  fn.register(0x25, 'kill', ['bigint', 'bigint'], 'bigint');
  var pid = fn.getpid();
  var pid_num = pid instanceof BigInt ? pid.lo : pid;
  log('Current PID: ' + pid_num);
  log('Sending SIGKILL to PID ' + pid_num);
  fn.kill(pid, new BigInt(0, 9));
} catch (e) {
  log('ERROR during exit: ' + e.message);
  if (e.stack) log(e.stack);
}
jsmaf.exit();