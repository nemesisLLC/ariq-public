// Optional authentication for the existing browser suites. Credentials are sent
// ONLY to the exact ARIQ origin, never to imagery/weather providers.
const {chromium} = require('playwright');
const fs = require('node:fs');
const origin = 'https://ariq-private.nezzoval.workers.dev';
if ((process.env.ARIQ_REVIEW_URL || '').startsWith(origin)) {
  const credential = JSON.parse(fs.readFileSync('.env.access-test.json','utf8'));
  const launch = chromium.launch.bind(chromium);
  chromium.launch = async (...args) => {
    const browser = await launch(...args);
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async options => {
      const context = await newContext(options);
      await context.route(`${origin}/**`, route => route.continue({headers:{
        ...route.request().headers(),
        'CF-Access-Client-Id':credential.client_id,
        'CF-Access-Client-Secret':credential.client_secret,
      }}));
      return context;
    };
    return browser;
  };
}
