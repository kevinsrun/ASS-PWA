import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const css=readFileSync(new URL('../src/app/globals.css',import.meta.url),'utf8');
const luminance=hex=>{const values=hex.replace('#','').match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);return values[0]*0.2126+values[1]*0.7152+values[2]*0.0722;};
const declarations=[...css.matchAll(/\.inbox-page\{([^}]*--button-primary-bg[^}]*)\}/g)].map(match=>Object.fromEntries([...match[1].matchAll(/--([\w-]+):(#[\da-f]{6})/gi)].map(value=>[value[1],value[2]])));
assert.equal(declarations.length,2);
for(const [index,tokens] of declarations.entries())for(const kind of ['primary','secondary','danger']){const a=luminance(tokens[`button-${kind}-bg`]),b=luminance(tokens[`button-${kind}-text`]);assert.ok((Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)>=4.5,`${index===0?'Light':'Dark'} ${kind} contrast`);}
assert.match(css,/\.inbox-page button\{min-height:44px/);
assert.match(css,/:disabled\{background:var\(--button-secondary-bg\);color:var\(--text-muted\);opacity:1\}/);
console.log('Inbox light/dark primary, secondary and danger text pairs pass WCAG AA. Disabled pairing and 44px touch targets present. This is a token/stylesheet check, not browser theme-state verification.');
