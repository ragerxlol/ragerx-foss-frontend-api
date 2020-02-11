# ragerx-foss-frontend-api

Open source (BSD-3) api for RagerX compatible pools built with node.js. Please refer to the [Pool Install Instructions](https://github.com/ragerxlol/ragerx-foss-install-instructions) for full details on how to start a RagerX pool.

## Design Theory

The API is designed to do very little processing when a user calls an endpoint. Instead, a main loop collects stats every 30 seconds and stores the results in memory. When a user calls an endpoint, we can just read the info from our in memory cache and serve it to them. Only in the cases of certain paginated apis or graphs do we need to make a call to the database as a result of user action.

User specific endpoints require the `X-JWT-TOKEN` header to be sent with the request which is a JSON Web Token that is provided upon login.

## Configuring the API

Copy `config.example.json` to `config.json`. There are a few critical fields you must change;

```
{
  /* Runtime information */
  "general": {
    /* Where to write the pid file, default will work fine */
    "pidfile": "api.pid",

    /* Optionally set this somewhere in /var/log */
    /* Make sure to set up logrotated */
    "logfile": "logs/api.log",

    /* If you are clustering or running a second instance of the API, */
    /* set this to true to disable multiple processes generating hashrate graphs */
    "secondary": false,

    /* Salt to encrypt passwords with, do not change once you have users registered */
    /* Salt should be in format salt_$POOL_$COIN - i.e. salt_mypool_monero */
    "salt": "",

    /* Secret to encrypt auth tokens with, make it at least 32 random characters */
    /* Important: do not share the secret key with anyone */
    "jwt_secret": ""
  },

  /* Coin config */
  /* You don't need to change this unless you're running something other than Monero */
  "coin": {
    "coin_name": "Monero",
    "coin_symbol": "XMR",
    "coin_units": 1e12,
    "coin_difficulty_target": 120,
    "address_prefixes": [18, 19, 42],
    "explorer_url": "https://moneroblocks.info"
  },

  /* Payout information */
  /* NOTE: this does not actually control payouts, but should reflect values in the Python script */
  /* These values are only used for frontend display */
  "payouts": {
    "payments_blocks_interval": 20,
    "maturity_requirement": 60,
    "min_payout": 50000000000,
    "max_payout": 10000000000000,
    "pool_fee": 3.5
  },

  /* Where to bind the http server */
  "api": {
    /* You shouldn't need to change 127.0.0.1, use nginx reverse proxy instead */
    "hostname": "127.0.0.1",
    /* Change port if it conflicts or you're running multiple APIs */
    "port": 8227
  },

  /* Market information */
  "market": {
    /* We pull market info from cryptocompare, while an API key isn't needed */
    /* it's best to provide one here https://min-api.cryptocompare.com/ */
    "crypto_compare_api": ""
  },

  /* Database connection information */
  "postgres": {
    "db_hostname": "127.0.0.1",
    "db_port": "5432",
    /* Fill out the following fields with PSQL credentials */
    "db_name": "",
    "db_username": "",
    "db_password": ""
  }

}
```

## Building and Development

Install dependencies:
```
yarn install
```

Start a development server:
```
yarn dev
```

Compile and minify for production:
```
yarn build
```

### Contributing

Feel free to send PRs with improvements or other features.

### License

This code is released under the BSD-3-Clause license.
