// Site settings (name, logo flag, contact...) are read on every page, so keep them in memory for a few seconds.
const { db } = require('./db');
let cache = null, at = 0;
async function getSite() {
  if (cache && Date.now() - at < 10000) return cache;
  cache = await db.get('SELECT id,name,name_bn,short_name,address,phone,description,title,logo_v FROM settings WHERE id=1');
  at = Date.now();
  return cache;
}
const invalidateSite = () => { cache = null; };
module.exports = { getSite, invalidateSite };
