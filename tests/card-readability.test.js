'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const measure = require('../assets/card-readability');

function card(text, width) {
  const name = {textContent:text};
  const title = {querySelector:()=>name,getBoundingClientRect:()=>({width}),
    scrollWidth:width,clientWidth:width};
  return {querySelector:()=>title,querySelectorAll:()=>[],
    ownerDocument:{defaultView:{getComputedStyle:()=>({font:'16px system-ui'})},
      createElement:()=>({getContext:()=>({measureText:word=>({width:word.length*8})})})}};
}

test('F874 readability accepts natural hyphen breaks but rejects an oversized unbroken word', () => {
  assert.equal(measure(card('Black-throated Gray Warbler',80)).wordBroken,false);
  assert.equal(measure(card('Blackthroated Gray Warbler',80)).wordBroken,true);
  assert.equal(measure(card('Black-throated Gray Warbler',40)).wordBroken,true);
});
