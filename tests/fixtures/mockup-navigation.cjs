'use strict';
const http = require('node:http');
const emit = http.Server.prototype.emit;
let delayed = false;
http.Server.prototype.emit = function(event, ...args) {
  if (event === 'request' && args[0].url === '/index.html' && !delayed) {
    delayed = true;
    console.log('CONTROLLED_INITIAL_IFRAME_DELAY=5000');
    setTimeout(() => emit.call(this, event, ...args), 5000);
    return true;
  }
  return emit.call(this, event, ...args);
};
