const fs = require('fs')
const stripJsonComments = require('strip-json-comments')

let config
try {
  config = JSON.parse(stripJsonComments(fs.readFileSync('config.json', 'utf8')))
} catch(e) {
  console.error('Error reading config.json, quitting...')
  process.exit()
}

// Validate a few fields
if(!config.general.salt) {
  console.error('Missing config: general.salt, quitting...')
  process.exit()
}
if(!config.general.jwt_secret) {
  console.error('Missing config: general.jwt_secret, quitting...')
  process.exit()
}
if(!config.market.crypto_compare_api_key) {
  console.warn('Missing cryptocompare api key')
}

module.exports = {
  BLOCK_CACHE: 300,        // number of blocks to cache for faster paging
  BLOCK_PAGE: 15,          // size of pages on frontend
  PAYMENT_CACHE: 300,      // number of payments to cache for faster paging
  PAYMENT_PAGE: 15,        // size of pages on frontend
  CREDITS_DEBITS_PAGE: 15, // size of pages on frontend
  ...config,               // The config.json file
}
