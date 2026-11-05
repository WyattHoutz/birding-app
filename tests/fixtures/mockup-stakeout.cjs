'use strict';
const http = require('node:http');
const WebSocket = require('ws');
const socketModule = require.resolve('ws');
const install = `(function () {
  var add = HTMLImageElement.prototype.addEventListener;
  window.__controlledHeroJobs = [];
  window.__releaseControlledHeroJobs = function () {
    window.__controlledHeroJobs.splice(0).forEach(function (job) { job(); });
  };
  HTMLImageElement.prototype.addEventListener = function (type, listener, options) {
    var image = this;
    if (type !== 'load' || !image.classList.contains('birdpic')) {
      return add.call(image, type, listener, options);
    }
    return add.call(image, type, function (event) {
      var slot = image.closest('.bchero');
      if (!slot) return listener.call(image, event);
      window.__controlledHeroJobs.push(function () {
        listener.call(image, event);
        var seed = image.cloneNode();
        seed.className = 'birdpic isseed';
        slot.appendChild(seed);
      });
    }, options);
  };
})()`;
const emit = http.Server.prototype.emit;
let delayed = false;
http.Server.prototype.emit = function (event, ...args) {
  if (event === 'request') {
    const [request, response] = args;
    if (/^\/index\.html(?:\?|$)/.test(request.url)) {
      const end = response.end;
      response.end = function (body, ...rest) {
        const html = String(body).replace(/<head(?:\s[^>]*)?>/i,
          match => match + '<script>' + install + '</script>');
        return end.call(this, html, ...rest);
      };
    }
    if (request.url === '/assets/birds/shtsan.jpg' && !delayed) {
      delayed = true;
      console.log('CONTROLLED_HERO_IMAGE_DELAY=5000');
      setTimeout(() => emit.call(this, event, ...args), 5000);
      return true;
    }
  }
  return emit.call(this, event, ...args);
};
require.cache[socketModule].exports = class extends WebSocket {
  constructor(...args) {
    super(...args);
    this.on('message', raw => {
      const message = JSON.parse(raw);
      if (message.method === 'Runtime.consoleAPICalled'
        && message.params.args[0]?.value === 'CONTROLLED_HERO_CAPTURE') {
        console.log('CONTROLLED_HERO_CAPTURE=' + message.params.args[1].value);
      }
    });
  }
  send(data) {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.evaluate'
      && message.params.expression.includes('signature: host.innerHTML.length')) {
      message.params.expression = message.params.expression.replace(
        'signature: host.innerHTML.length', `signature: (function () {
          var hero = host.querySelector('.bchero'), image = hero && hero.querySelector('img.birdpic');
          console.log('CONTROLLED_HERO_CAPTURE', JSON.stringify({
            decoded:!!(image && image.complete && image.naturalWidth > 0),
            ratio:hero && hero.style.aspectRatio,
            queued:(w.__controlledHeroJobs || []).length
          }));
          setTimeout(function () { w.__releaseControlledHeroJobs(); }, 0);
          return host.innerHTML.length;
        })()`);
    }
    return super.send(JSON.stringify(message));
  }
};
