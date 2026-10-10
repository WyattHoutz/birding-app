'use strict';

// Runs in the browser: measure text inside the card, not document overflow.
function cardReadability(card) {
  const view = card.ownerDocument.defaultView;
  const title = card.querySelector('.name > .ntext');
  const box = title.getBoundingClientRect();
  const canvas = card.ownerDocument.createElement('canvas').getContext('2d');
  const name = title.querySelector('a') || title;
  canvas.font = view.getComputedStyle(name).font;
  const text = (name === title
    ? Array.from(title.childNodes).filter(node => node.nodeType === 3)
      .map(node => node.textContent).join(' ')
    : name.textContent).trim();
  const required = Math.max(...text.split(/[\s-]+/).map(word => canvas.measureText(word).width));
  const actions = Array.from(card.querySelectorAll('.speciesWatchlistAction')).map(action => {
    const bounds = action.getBoundingClientRect();
    const range = card.ownerDocument.createRange();
    range.selectNodeContents(action);
    const rects = Array.from(range.getClientRects()).filter(rect => rect.width && rect.height);
    const clips = [];
    for (let parent = action.parentElement; parent; parent = parent.parentElement) {
      const style = view.getComputedStyle(parent);
      if (/hidden|clip/.test(style.overflowX)) clips.push(parent.getBoundingClientRect());
    }
    return {text: action.textContent, width: bounds.width,
      clipped: action.scrollWidth > action.clientWidth + 1
        || rects.some(rect => rect.left < bounds.left - 1 || rect.right > bounds.right + 1
          || rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1
          || clips.some(clip => rect.left < clip.left - 1 || rect.right > clip.right + 1))};
  });
  return {text, width: box.width, required,
    titleClipped: title.scrollWidth > title.clientWidth + 1,
    wordBroken: required > box.width + 1, actions};
}

module.exports = cardReadability;
