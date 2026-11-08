// verify the SDK's bucket matches the Go vectors
const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'shravelle-browser.js'), 'utf8');
const m = src.match(/function fnvBucket\(str\) \{[\s\S]*?\n  \}/)[0];
const fnvBucket = new Function(m + '; return fnvBucket;')();
const vec = [["new-checkout", "user-42", 36], ["a", "b", 90], ["flag.x", "ü-1", 26]];
let ok = true;
for (const [f, u, want] of vec) { const got = fnvBucket(f + "\u0000" + u); console.log(f, u, got, want); if (got !== want) ok = false; }
process.exit(ok ? 0 : 1);
